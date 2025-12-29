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
const NEAR_RATE = 1.00002;

// ======================= 获取所有币种 =======================
async function fetchAllSymbols() {
    const url = 'https://www.okx.com/api/v5/public/instruments?instType=SWAP';
    const res = await fetch(url);
    const json = await res.json();

    return json.data
        .filter(i => i.instId.endsWith('-USDT-SWAP') && i.state === 'live')
        .map(i => i.instId);
}

// ======================= K线 =======================
async function fetchKlines(symbol) {
    try {
        const url = `https://www.okx.com/api/v5/market/candles?instId=${symbol}&bar=${INTERVAL}&limit=60`;
        const res = await fetch(url);
        const json = await res.json();
        if (!json.data) return [];

        return json.data.reverse().map(i => ({
            close: Number(i[4])
        }));
    } catch {
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
        lower: ma - k * std
    };
}

// ======================= 单币判断 =======================
async function checkSymbol(symbol) {
    const candles = await fetchKlines(symbol);
    if (candles.length < BOLL_PERIOD + 3) return null;

    const closes = candles.map(c => c.close);

    const current = closes[closes.length - 1]; // 当前未收盘
    const closed = closes[closes.length - 2];  // 最后一根已收盘
    const history = closes.slice(0, -2);

    const bollForClosed = calculateBoll(history, BOLL_PERIOD, BOLL_K);
    const bollForCurrent = calculateBoll(history.concat(closed), BOLL_PERIOD, BOLL_K);

    if (!bollForClosed || !bollForCurrent) return null;

    const hitCurrent = current <= bollForCurrent.lower * NEAR_RATE;
    const hitClosed = closed <= bollForClosed.lower * NEAR_RATE;

    if (!hitCurrent && !hitClosed) return null;

    console.log(
        `[命中] ${symbol} | 当前=${hitCurrent ? '是' : '否'} | 已收盘=${hitClosed ? '是' : '否'}`
    );

    return {
        symbol,
        current,
        closed,
        lowerCurrent: bollForCurrent.lower.toFixed(6),
        lowerClosed: bollForClosed.lower.toFixed(6),
        hitCurrent,
        hitClosed
    };
}

// ======================= 邮件 =======================
async function sendEmail(list, title) {
    if (!list.length) return;

    let text = `【${title}】\n`;
    text += `时间：${new Date().toLocaleString('zh-CN', { hour12: false })}\n\n`;

    list.forEach(i => {
        text += `${i.symbol}\n`;
        text += `价格：${title.includes('未收盘') ? i.current : i.closed}\n`;
        text += `下轨：${title.includes('未收盘') ? i.lowerCurrent : i.lowerClosed}\n\n`;
    });

    const transporter = getTransporter();
    await transporter.sendMail({
        from: emailAccounts[currentIndex].user,
        to: EMAIL_TO,
        subject: title,
        text
    });

    currentIndex = (currentIndex + 1) % emailAccounts.length;
}

// ======================= 主流程 =======================
async function main() {
    console.log('15分钟 Boll 下轨扫描启动');

    const symbols = await fetchAllSymbols();
    const currentHitList = [];
    const closedHitList = [];

    for (const s of symbols) {
        const res = await checkSymbol(s);
        if (!res) continue;

        if (res.hitCurrent) currentHitList.push(res);
        if (res.hitClosed) closedHitList.push(res);
    }

    await sendEmail(currentHitList, '【当前未收盘K线 · Boll 下轨预警】');
    await sendEmail(closedHitList, '【最后已收盘K线 · Boll 下轨预警】');

    console.log('扫描完成');
}

main();
