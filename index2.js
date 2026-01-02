import fetch from 'node-fetch';
import nodemailer from 'nodemailer';

// ======================= 邮箱配置 =======================
const EMAIL_USER = '2410078546@qq.com';
const EMAIL_PASS = 'pbwviuveqmahebag';
const EMAIL_TO = '2410078546@qq.com';

const transporter = nodemailer.createTransport({
    host: 'smtp.qq.com',
    port: 465,
    secure: true,
    auth: { user: EMAIL_USER, pass: EMAIL_PASS }
});

// ======================= 参数 =======================
const INTERVAL = '15m';
const BOLL_PERIOD = 20;
const BOLL_K = 2;
const BANDWIDTH_RATIO_MAX = 0.06;
const LOWER_MARGIN = 0.0005;
const CONCURRENCY = 10;
const BATCH_DELAY = 500;

// ======================= 工具 =======================
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ======================= 获取交易对 =======================
async function fetchAllSymbols() {
    console.log('[INIT] 获取交易对');
    const res = await fetch(
        'https://www.okx.com/api/v5/public/instruments?instType=SWAP'
    );
    const json = await res.json();
    const list = json?.data
        ?.filter(i => i.instId.endsWith('-USDT-SWAP') && i.state === 'live')
        .map(i => i.instId) || [];
    console.log('[INIT] 数量:', list.length);
    return list;
}

// ======================= K线 =======================
async function fetchKlines(symbol, limit = 50) {
    const res = await fetch(
        `https://www.okx.com/api/v5/market/candles?instId=${symbol}&bar=${INTERVAL}&limit=${limit}`
    );
    const json = await res.json();
    return json.data.reverse().map(k => ({
        high: +k[2],
        low: +k[3],
        close: +k[4]
    }));
}

// ======================= BOLL =======================
function calculateBoll(closes) {
    const slice = closes.slice(-BOLL_PERIOD);
    const ma = slice.reduce((a, b) => a + b) / BOLL_PERIOD;
    const std = Math.sqrt(
        slice.reduce((a, b) => a + (b - ma) ** 2, 0) / BOLL_PERIOD
    );
    return {
        lower: ma - BOLL_K * std,
        upper: ma + BOLL_K * std,
        mid: ma
    };
}

const calcBandwidth = b => (b.upper - b.lower) / b.mid;

// ======================= 横盘判断 =======================
async function checkSymbol(symbol) {
    const candles = await fetchKlines(symbol, BOLL_PERIOD + 10);
    if (candles.length < BOLL_PERIOD + 5) return null;

    const closes = candles.map(c => c.close);
    const bandwidths = [];

    for (let i = 5; i > 0; i--) {
        const boll = calculateBoll(
            closes.slice(-BOLL_PERIOD - i, -i)
        );
        bandwidths.push(calcBandwidth(boll));
    }

    const avg = bandwidths.reduce((a, b) => a + b) / bandwidths.length;
    const ratio = (Math.max(...bandwidths) - Math.min(...bandwidths)) / avg;

    if (ratio <= BANDWIDTH_RATIO_MAX) {
        return { symbol, candles, ratio };
    }
    return null;
}

// ======================= 下轨判断（用 low） =======================
function isAtLower(low, boll) {
    return low < boll.lower ||
        (low >= boll.lower && low <= boll.lower * (1 + LOWER_MARGIN));
}

// ======================= 带宽颜色 =======================
function bandwidthColor(pct) {
    if (pct <= 3) return 'green';
    if (pct <= 5) return 'orange';
    return 'red';
}

// ======================= 邮件 =======================
async function sendEmail(list) {
    if (!list.length) {
        console.log('[MAIL] 无结果');
        return;
    }

    let html = `
    <h3>15分钟横盘筛选结果（${list.length}）</h3>
    <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;text-align:center;">
    <tr>
        <th>交易对</th>
        <th>带宽比</th>
        <th>当前K线在下轨</th>
        <th>已收盘K线在下轨</th>
    </tr>
    `;

    list.forEach(i => {
        const bwColor = bandwidthColor(i.bandwidthValue);
        html += `
        <tr>
            <td>${i.symbol}</td>
            <td style="color:${bwColor}">${i.bandwidthPct}</td>
            <td style="color:${i.currentLower ? 'green' : 'red'}">
                ${i.currentLower ? '√' : '×'}
            </td>
            <td style="color:${i.closedLower ? 'green' : 'red'}">
                ${i.closedLower ? '√' : '×'}
            </td>
        </tr>
        `;
    });

    html += '</table>';

    await transporter.sendMail({
        from: EMAIL_USER,
        to: EMAIL_TO,
        subject: `【15分钟横盘】${list.length} 个`,
        html
    });

    console.log('[MAIL] 已发送');
}

// ======================= 主流程 =======================
async function main() {
    console.log('[START] 扫描开始');

    const symbols = await fetchAllSymbols();
    const result = [];

    for (let i = 0; i < symbols.length; i += CONCURRENCY) {
        const batch = symbols.slice(i, i + CONCURRENCY);
        const results = await Promise.all(batch.map(checkSymbol));

        results.forEach(r => {
            if (!r) return;

            const closes = r.candles.map(c => c.close);

            // 当前K线
            const bollCurrent = calculateBoll(closes);
            const currentLow = r.candles.at(-1).low;
            const currentLower = isAtLower(currentLow, bollCurrent);

            // 已收盘K线
            const bollClosed = calculateBoll(closes.slice(0, -1));
            const closedLow = r.candles.at(-2).low;
            const closedLower = isAtLower(closedLow, bollClosed);

            const pct = +(r.ratio * 100).toFixed(2);

            result.push({
                symbol: r.symbol,
                bandwidthPct: pct + '%',
                bandwidthValue: pct,
                currentLower,
                closedLower
            });

            console.log(
                '[HIT]',
                r.symbol,
                '带宽', pct + '%',
                '当前', currentLower ? '√' : '×',
                '收盘', closedLower ? '√' : '×'
            );
        });

        await sleep(BATCH_DELAY);
    }

    await sendEmail(result);
    console.log('[END] 完成');
}

main();
