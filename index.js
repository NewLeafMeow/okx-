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
const EMA_SHORT = 20;
const EMA_LONG = 60;
const NEAR_RATE = 1.002; // 下轨/上轨允许0.2%偏差
const EMA_ANGLE_THRESHOLD = 0.005; // 0.5%
const VOLUME_MULTIPLE = 1.5; // 成交量允许1.5倍波动

// ======================= 获取币种 =======================
async function fetchAllSymbols() {
    const url = 'https://www.okx.com/api/v5/public/instruments?instType=SWAP';
    const res = await fetch(url);
    const json = await res.json();
    return json.data
        .filter(i => i.instId.endsWith('-USDT-SWAP') && i.state === 'live')
        .map(i => i.instId);
}

// ======================= 获取 K 线 =======================
async function fetchKlines(symbol) {
    try {
        const url = `https://www.okx.com/api/v5/market/candles?instId=${symbol}&bar=${INTERVAL}&limit=100`;
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

// ======================= EMA =======================
function calculateEMA(closes, period) {
    if (closes.length < period) return null;
    const k = 2 / (period + 1);
    let ema = closes[0];
    for (let i = 1; i < closes.length; i++) {
        ema = closes[i] * k + ema * (1 - k);
    }
    return ema;
}

// ======================= BOLL =======================
function calculateBoll(closes, period, k) {
    if (closes.length < period) return null;
    const slice = closes.slice(-period);
    const ma = slice.reduce((a, b) => a + b, 0) / period;
    const variance = slice.reduce((a, b) => a + Math.pow(b - ma, 2), 0) / period;
    const std = Math.sqrt(variance);
    return { lower: ma - k * std, middle: ma, upper: ma + k * std };
}

// ======================= 震荡判断 =======================
function isSideway(closes, volumes) {
    if (closes.length < EMA_LONG) return false;

    const emaShort = calculateEMA(closes.slice(-EMA_SHORT), EMA_SHORT);
    const emaLong = calculateEMA(closes.slice(-EMA_LONG), EMA_LONG);
    if (!emaShort || !emaLong) return false;

    // 均线角度小，趋势弱
    const angleDiff = Math.abs(emaShort - emaLong) / emaLong;
    if (angleDiff > EMA_ANGLE_THRESHOLD) return false;

    // 成交量平稳
    const recentVol = volumes.slice(-5);
    const avgVol = recentVol.reduce((a,b)=>a+b,0)/recentVol.length;
    if (recentVol.some(v => v > avgVol * VOLUME_MULTIPLE)) return false;

    return true;
}

// ======================= 单币判断 =======================
async function checkSymbol(symbol) {
    const candles = await fetchKlines(symbol);
    if (candles.length < BOLL_PERIOD + 3) return null;

    const closes = candles.map(c=>c.close);
    const volumes = candles.map(c=>c.volume);

    if (!isSideway(closes, volumes)) return null;

    const current = closes[closes.length - 1]; // 当前未收盘
    const closed = closes[closes.length - 2];  // 最后一根已收盘
    const history = closes.slice(0, -2);

    const bollClosed = calculateBoll(history, BOLL_PERIOD, BOLL_K);
    const bollCurrent = calculateBoll(history.concat(closed), BOLL_PERIOD, BOLL_K);

    if (!bollClosed || !bollCurrent) return null;

    // 假突破回归条件
    const hitLong = closed <= bollClosed.lower * NEAR_RATE && current >= bollCurrent.lower;
    const hitShort = closed >= bollClosed.upper / NEAR_RATE && current <= bollCurrent.upper;

    if (!hitLong && !hitShort) return null;

    console.log(`[命中] ${symbol} | 做多=${hitLong} | 做空=${hitShort} | 当前价=${current} | 下轨=${bollCurrent.lower.toFixed(6)} 上轨=${bollCurrent.upper.toFixed(6)}`);

    return {
        symbol,
        current,
        closed,
        lowerCurrent: bollCurrent.lower.toFixed(6),
        upperCurrent: bollCurrent.upper.toFixed(6),
        lowerClosed: bollClosed.lower.toFixed(6),
        upperClosed: bollClosed.upper.toFixed(6),
        hitLong,
        hitShort
    };
}

// ======================= 邮件 =======================
async function sendEmail(list, title) {
    if (!list.length) return;

    let text = `【${title}】\n时间：${new Date().toLocaleString('zh-CN',{hour12:false})}\n\n`;

    list.forEach(i=>{
        text += `${i.symbol}\n`;
        text += `当前价格：${i.current}\n`;
        if(title.includes('做多')) {
            text += `BOLL 下轨：${i.lowerCurrent}\n\n`;
        } else {
            text += `BOLL 上轨：${i.upperCurrent}\n\n`;
        }
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
    const longList = [];
    const shortList = [];

    for(const s of symbols) {
        const res = await checkSymbol(s);
        if(!res) continue;
        if(res.hitLong) longList.push(res);
        if(res.hitShort) shortList.push(res);
    }

    await sendEmail(longList, '【做多信号 · 假突破回归】');
    await sendEmail(shortList, '【做空信号 · 假突破回归】');

    console.log('扫描完成');
}

main();
