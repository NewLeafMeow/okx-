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
const NEAR_RATE = 1.003; // 下轨 1% 内（你之后可以改成 1.003）

// ======================= 获取所有币种 =======================
async function fetchAllSymbols() {
    console.log('[INFO] 正在获取欧易所有 USDT 永续合约...');
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

        return json.data
            .reverse()
            .slice(0, -1) // 丢掉未收盘K线
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
    if (candles.length < BOLL_PERIOD + 1) {
        console.log(`[跳过] ${symbol} K线数量不足`);
        return null;
    }

    const closes = candles.map(c => c.close);

    const last = closes[closes.length - 1];
    const prev = closes[closes.length - 2];

    const bollNow = calculateBoll(closes.slice(0, -1), BOLL_PERIOD, BOLL_K);
    const bollPrev = calculateBoll(closes.slice(0, -2), BOLL_PERIOD, BOLL_K);

    if (!bollNow || !bollPrev) {
        console.log(`[跳过] ${symbol} Boll 计算失败`);
        return null;
    }

    const hitNow = last <= bollNow.lower * NEAR_RATE;
    const hitPrev = prev <= bollPrev.lower * NEAR_RATE;

    if (hitNow || hitPrev) {
        console.log(
            `[命中] ${symbol} | 收盘=${last} | 下轨=${bollNow.lower.toFixed(4)}`
        );

        return {
            symbol,
            last,
            lower: bollNow.lower.toFixed(4)
        };
    } else {
        console.log(
            `[未命中] ${symbol} | 收盘=${last} | 下轨=${bollNow.lower.toFixed(4)}`
        );
    }

    return null;
}

// ======================= 邮件 =======================
async function sendEmail(list) {
    if (!list.length) {
        console.log('[INFO] 本轮无任何币种命中，下游不发送邮件');
        return;
    }

    let text = `【15分钟 Boll 下轨预警】\n`;
    text += `时间：${new Date().toLocaleString('zh-CN', { hour12: false })}\n\n`;

    list.forEach(i => {
        text += `${i.symbol}\n`;
        text += `收盘价：${i.last}\n`;
        text += `下轨：${i.lower}\n\n`;
    });

    console.log('[INFO] 正在发送邮件...');
    const transporter = getTransporter();

    try {
        await transporter.sendMail({
            from: emailAccounts[currentIndex].user,
            to: EMAIL_TO,
            subject: '欧易全币种 Boll 下轨预警',
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
    console.log('15分钟 Boll 下轨扫描启动');
    console.log(`时间：${new Date().toLocaleString('zh-CN', { hour12: false })}`);
    console.log('========================================');

    const symbols = await fetchAllSymbols();
    const hitList = [];

    for (const s of symbols) {
        try {
            const res = await checkSymbol(s);
            if (res) hitList.push(res);
        } catch (e) {
            console.log(`[异常] ${s} 扫描失败`);
        }
    }

    console.log('========================================');
    console.log(`扫描完成 | 命中数量：${hitList.length}`);
    console.log('========================================');

    await sendEmail(hitList);
}

main();
