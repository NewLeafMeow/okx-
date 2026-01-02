import fetch from 'node-fetch';
import nodemailer from 'nodemailer';

// ======================= 邮箱配置 =======================
const EMAIL_USER = '2040223225@qq.com';
const EMAIL_PASS = 'ocyqfrucuifkbfia';
const EMAIL_TO = '2410078546@qq.com';

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
            close: Number(i[4]),
            low: Number(i[3])
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
    const lows = candles.map(c => c.low);

    const currentLow = lows[lows.length - 1];   // 当前K线最低价
    const closedLow = lows[lows.length - 2];    // 最后一根已收盘最低价
    const history = closes.slice(0, -2);

    const bollForClosed = calculateBoll(history, BOLL_PERIOD, BOLL_K);
    const bollForCurrent = calculateBoll(history.concat(closes[closes.length - 2]), BOLL_PERIOD, BOLL_K);

    if (!bollForClosed || !bollForCurrent) return null;

    const hitCurrent = currentLow <= bollForCurrent.lower * NEAR_RATE;
    const hitClosed = closedLow <= bollForClosed.lower * NEAR_RATE;

    if (!hitCurrent && !hitClosed) return null;

    return {
        symbol,
        current: currentLow,
        closed: closedLow,
        lowerCurrent: bollForCurrent.lower.toFixed(6),
        lowerClosed: bollForClosed.lower.toFixed(6),
        hitCurrent,
        hitClosed
    };
}

// ======================= 邮件 =======================
async function sendEmail(list) {
    if (!list.length) return;

    let html = `<h2>【Boll 下轨预警汇总】</h2>`;
    html += `<p>时间：${new Date().toLocaleString('zh-CN', { hour12: false })}</p>`;
    html += `<table border="1" cellpadding="5" cellspacing="0">
                <tr>
                    <th>币种</th>
                    <th>当前最低价</th>
                    <th>当前下轨</th>
                    <th>已收盘最低价</th>
                    <th>已收盘下轨</th>
                </tr>`;

    list.forEach(i => {
        html += `<tr>
                    <td>${i.symbol}</td>
                    <td style="color:${i.hitCurrent ? 'green' : 'black'}">${i.current}</td>
                    <td>${i.lowerCurrent}</td>
                    <td style="color:${i.hitClosed ? 'red' : 'black'}">${i.closed}</td>
                    <td>${i.lowerClosed}</td>
                 </tr>`;
    });

    html += `</table>`;

    const transporter = nodemailer.createTransport({
        host: 'smtp.qq.com',
        port: 465,
        secure: true,
        auth: { user: EMAIL_USER, pass: EMAIL_PASS }
    });

    await transporter.sendMail({
        from: EMAIL_USER,
        to: EMAIL_TO,
        subject: '【Boll 下轨预警汇总】',
        html
    });
}

// ======================= 主流程 =======================
async function main() {
    console.log('15分钟 Boll 下轨扫描启动');

    const symbols = await fetchAllSymbols();
    const hitList = [];

    for (const s of symbols) {
        const res = await checkSymbol(s);
        if (res) hitList.push(res);
    }

    await sendEmail(hitList);

    console.log('扫描完成');
}

main();
