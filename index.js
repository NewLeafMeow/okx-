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
const NEAR_RATE = 1.0005; // 接触下轨/上轨的容差
const EMA_PERIOD = 20;
const VOLUME_MULTIPLIER = 1.5; // 放宽成交量限制
const EMA_ANGLE_MAX = 0.03;    // 放宽 EMA 角度差限制

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
async function fetchKlines(symbol, limit = 100) {
    try {
        const url = `https://www.okx.com/api/v5/market/candles?instId=${symbol}&bar=${INTERVAL}&limit=${limit}`;
        const res = await fetch(url);
        const json = await res.json();
        if (!json.data) return [];
        return json.data.reverse().map(i => ({
            close: Number(i[4]),
            volume: Number(i[5])
        }));
    } catch {
        return [];
    }
}

// ======================= Bollinger Bands =======================
function calculateBoll(closes, period, k) {
    if (closes.length < period) return null;
    const slice = closes.slice(-period);
    const ma = slice.reduce((a, b) => a + b, 0) / period;
    const variance = slice.reduce((a, b) => a + Math.pow(b - ma, 2), 0) / period;
    const std = Math.sqrt(variance);
    return { lower: ma - k * std, upper: ma + k * std, mid: ma };
}

// ======================= EMA =======================
function calculateEMA(closes, period) {
    if (closes.length < period) return null;
    const k = 2 / (period + 1);
    let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < closes.length; i++) {
        ema = closes[i] * k + ema * (1 - k);
    }
    return ema;
}

// ======================= 单币判断 =======================
async function checkSymbol(symbol) {
    const candles = await fetchKlines(symbol, 100);
    if (candles.length < BOLL_PERIOD + 5) return null;

    const closes = candles.map(c => c.close);
    const volumes = candles.map(c => c.volume);

    // Bollinger
    const boll = calculateBoll(closes.slice(-BOLL_PERIOD-1), BOLL_PERIOD, BOLL_K);
    if (!boll) return null;
    const currentPrice = closes[closes.length - 1];
    const lastPrice = closes[closes.length - 2];

    // 做多/做空信号
    const buySignal = currentPrice <= boll.lower * NEAR_RATE;
    const sellSignal = currentPrice >= boll.upper / NEAR_RATE;

    // 震荡判断：EMA 角度 + 成交量
    const emaStart = calculateEMA(closes.slice(-EMA_PERIOD-5, -5), EMA_PERIOD);
    const emaEnd = calculateEMA(closes.slice(-EMA_PERIOD), EMA_PERIOD);
    const emaAngle = Math.abs((emaEnd - emaStart) / emaStart);
    const recentVolAvg = volumes.slice(-5).reduce((a,b)=>a+b,0)/5;
    const maxVol = Math.max(...volumes.slice(-5));
    const isRange = emaAngle < EMA_ANGLE_MAX && maxVol <= recentVolAvg * VOLUME_MULTIPLIER;

    return {
        symbol,
        currentPrice,
        buySignal,
        sellSignal,
        lower: boll.lower,
        upper: boll.upper,
        isRange,
        recentVol: volumes.slice(-5),
        recentVolAvg
    };
}

// ======================= 邮件 =======================
async function sendEmail(list, title) {
    if (!list.length) return;

    let text = `【${title}】\n时间：${new Date().toLocaleString('zh-CN', { hour12: false })}\n\n`;
    list.forEach(i => {
        text += `${i.symbol} | 做多=${i.buySignal} | 做空=${i.sellSignal} | 当前价=${i.currentPrice} | 下轨=${i.lower.toFixed(6)} | 上轨=${i.upper.toFixed(6)} | 震荡=${i.isRange}\n`;
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
    console.log('15分钟震荡行情BOLL扫描启动');

    const symbols = await fetchAllSymbols();
    const hitList = [];

    for (const s of symbols) {
        const res = await checkSymbol(s);
        if (!res) continue;
        if (res.buySignal || res.sellSignal) hitList.push(res);
    }

    await sendEmail(hitList, '【BOLL震荡行情信号】');

    hitList.forEach(i => {
        console.log(`[命中] ${i.symbol} | 做多=${i.buySignal} | 做空=${i.sellSignal} | 当前价=${i.currentPrice} | 下轨=${i.lower.toFixed(6)} | 上轨=${i.upper.toFixed(6)} | 震荡=${i.isRange}`);
    });

    console.log('扫描完成');
}

main();
