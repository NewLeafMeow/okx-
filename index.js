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

// ======================= 配置 =======================
const INTERVAL = '15m';
const BOLL_PERIOD = 20;
const BOLL_K = 2;
const NEAR_RATE = 1.01; // 下轨 1% 内

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
    const url = `https://www.okx.com/api/v5/market/candles?instId=${symbol}&bar=${INTERVAL}&limit=50`;
    const res = await fetch(url);
    const json = await res.json();
    if (!json.data) return [];

    return json.data.reverse().slice(0, -1).map(i => ({
        ts: Number(i[0]),
        close: Number(i[4])
    }));
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

// ======================= 信号检测 =======================
async function checkSymbol(symbol) {
    const candles = await fetchKlines(symbol);
    if (candles.length < BOLL_PERIOD + 1) return null;

    const closes = candles.map(c => c.close);

    const last = closes[closes.length - 1];
    const prev = closes[closes.length - 2];

    const bollNow = calculateBoll(closes.slice(0, -1), BOLL_PERIOD, BOLL_K);
    const bollPrev = calculateBoll(closes.slice(0, -2), BOLL_PERIOD, BOLL_K);

    if (!bollNow || !bollPrev) return null;

    if (
        last <= bollNow.lower * NEAR_RATE ||
        prev <= bollPrev.lower * NEAR_RATE
    ) {
        return {
            symbol,
            last,
            lower: bollNow.lower.toFixed(4)
        };
    }

    return null;
}

// ======================= 邮件 =======================
async function sendEmail(list) {
    if (!list.length) return;

    let text = `【15分钟 Boll 下轨预警】\n时间：${new Date().toLocaleString('zh-CN', { hour12: false })}\n\n`;

    list.forEach(i => {
        text += `${i.symbol}\n收盘价：${i.last}\n下轨：${i.lower}\n\n`;
    });

    const transporter = getTransporter();
    await transporter.sendMail({
        from: emailAccounts[currentIndex].user,
        to: EMAIL_TO,
        subject: '欧易全币种 Boll 下轨预警',
        text
    });

    currentIndex = (currentIndex + 1) % emailAccounts.length;
}

// ======================= 主流程 =======================
async function main() {
    console.log('开始扫描欧易所有 USDT 永续合约...');
    const symbols = await fetchAllSymbols();
    const hitList = [];

    for (const s of symbols) {
        try {
            const res = await checkSymbol(s);
            if (res) hitList.push(res);
        } catch (e) {}
    }

    console.log(`命中 ${hitList.length} 个`);
    await sendEmail(hitList);
}

main();
