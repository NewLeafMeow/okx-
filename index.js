import fetch from 'node-fetch';
import nodemailer from 'nodemailer';

// ======================= 邮箱配置 =======================
const EMAIL_USER1 = '2410078546@qq.com';
const EMAIL_PASS1 = 'pbwviuveqmahebag';
const EMAIL_USER2 = '2040223225@qq.com';
const EMAIL_PASS2 = 'ocyqfrucuifkbfia';
const EMAIL_TO = '2410078546@qq.com';

const emailAccounts = [
    { user: EMAIL_USER1, pass: EMAIL_PASS1 },
    { user: EMAIL_USER2, pass: EMAIL_PASS2 }
];
let currentIndex = 0;

function getTransporter() {
    const account = emailAccounts[currentIndex];
    return nodemailer.createTransport({
        host: 'smtp.qq.com',
        port: 465,
        secure: true,
        auth: account
    });
}

// ======================= 参数配置 =======================
const INTERVAL = '15m';
const BOLL_PERIOD = 20;
const BOLL_K = 2;
const NEAR_RATE = 1.00002; // 下轨附近（可自行调整）

// ======================= 获取所有币种 =======================
async function fetchAllSymbols() {
    console.log('[INFO] 正在获取 OKX USDT 永续合约...');
    const url = 'https://www.okx.com/api/v5/public/instruments?instType=SWAP';
    const res = await fetch(url);
    const json = await res.json();

    const symbols = json.data
        .filter(i => i.instId.endsWith('-USDT-SWAP') && i.state === 'live')
        .map(i => i.instId);

    console.log(`[INFO] 获取到币种数量：${symbols.length}`);
    return symbols;
}

// ======================= K线 =======================
async function fetchKlines(symbol) {
    try {
        const url = `https://www.okx.com/api/v5/market/candles?instId=${symbol}&bar=${INTERVAL}&limit=50`;
        const res = await fetch(url);
        const json = await res.json();
        if (!json.data) return [];

        // 保留未收盘 K 线
        return json.data
            .reverse()
            .map(i => ({
                ts: Number(i[0]),
                close: Number(i[4])
            }));
    } catch (e) {
        console.log(`[异常] ${symbol} 获取K线失败`);
        return [];
    }
}

// ======================= Bollinger =======================
function calculateBoll(closes, period, k) {
    if (closes.length < period) return null;

    const slice = closes.slice(-period);
    const ma = slice.reduce((a, b) => a + b, 0) / period;
    const variance = slice.reduce((a, b) => a + Math.pow(b - ma, 2), 0) / period;
    const std = Math.sqrt(variance);

    return {
        mid: ma,
        upper: ma + k * std,
        lower: ma - k * std
    };
}

// ======================= 单币判断 =======================
async function checkSymbol(symbol) {
    const candles = await fetchKlines(symbol);

    // 至少需要：未收盘 + 已收盘 + Boll 历史
    if (candles.length < BOLL_PERIOD + 2) {
        console.log(`[跳过] ${symbol} K线数量不足`);
        return null;
    }

    const closes = candles.map(c => c.close);

    // 当前未收盘
    const current = closes[closes.length - 1];
    // 未收盘前一根（已收盘）
    const prev = closes[closes.length - 2];

    // Boll 只用已收盘K线（不包含当前）
    const boll = calculateBoll(closes.slice(0, -1), BOLL_PERIOD, BOLL_K);
    if (!boll) {
        console.log(`[跳过] ${symbol} Boll 计算失败`);
        return null;
    }

    const hitCurrent = current <= boll.lower * NEAR_RATE;
    const hitPrev = prev <= boll.lower * NEAR_RATE;

    if (hitCurrent || hitPrev) {
        console.log(
            `[命中] ${symbol} | 当前=${current} | 下轨=${boll.lower.toFixed(6)}`
        );

        return {
            symbol,
            last: current,
            lower: boll.lower.toFixed(6)
        };
    } else {
        console.log(
            `[未命中] ${symbol} | 当前=${current} | 下轨=${boll.lower.toFixed(6)}`
        );
    }

    return null;
}

// ======================= 邮件 =======================
async function sendEmail(list) {
    if (!list.length) {
        console.log('[INFO] 本轮无命中，不发送邮件');
        return;
    }

    let text = `【15分钟 Boll 下轨预警（含未收盘）】\n`;
    text += `时间：${new Date().toLocaleString('zh-CN', { hour12: false })}\n\n`;

    list.forEach(i => {
        text += `${i.symbol}\n`;
        text += `当前价：${i.last}\n`;
        text += `下轨：${i.lower}\n\n`;
    });

    console.log('[INFO] 正在发送邮件...');
    const transporter = getTransporter();

    try {
        await transporter.sendMail({
            from: emailAccounts[currentIndex].user,
            to: EMAIL_TO,
            subject: 'OKX 全币种 Boll 下轨预警（实时）',
            text
        });

        console.log(`[成功] 邮件已发送（${emailAccounts[currentIndex].user}）`);
        currentIndex = (currentIndex + 1) % emailAccounts.length;
    } catch (e) {
        console.log('[失败] 邮件发送异常', e.message);
    }
}

// ======================= 主流程 =======================
async function main() {
    console.log('========================================');
    console.log('15分钟 Boll 下轨扫描（含未收盘）启动');
    console.log(`时间：${new Date().toLocaleString('zh-CN', { hour12: false })}`);
    console.log('========================================');

    const symbols = await fetchAllSymbols();
    const hitList = [];

    for (const s of symbols) {
        try {
            const res = await checkSymbol(s);
            if (res) hitList.push(res);
        } catch {
            console.log(`[异常] ${s} 扫描失败`);
        }
    }

    console.log('========================================');
    console.log(`扫描完成 | 命中数量：${hitList.length}`);
    console.log('========================================');

    await sendEmail(hitList);
}

main();
