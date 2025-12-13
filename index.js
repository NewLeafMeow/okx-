import fetch from 'node-fetch';
import nodemailer from 'nodemailer';

// ------------------------- 邮箱配置 -------------------------
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
        auth: { user: account.user, pass: account.pass }
    });
}

// ------------------------- 配置 -------------------------
const SYMBOLS = ['BTC-USDT', 'ETH-USDT', 'SOL-USDT', 'LTC-USDT'];
const INTERVAL = '15m';
const EMA_SHORT_PERIOD = 20; // EMA20，回踩位置
const EMA_LONG_PERIOD = 50;  // EMA50，顺势方向
const VOLUME_MA_PERIOD = 20; // 成交量均线

// ------------------------- EMA计算 -------------------------
function calculateEMA(closes, period) {
    const ema = [];
    const k = 2 / (period + 1);
    for (let i = 0; i < closes.length; i++) {
        if (i < period - 1) {
            ema.push(null);
        } else if (i === period - 1) {
            const sum = closes.slice(0, period).reduce((a, b) => a + b, 0);
            ema.push(sum / period);
        } else {
            ema.push(closes[i] * k + ema[i - 1] * (1 - k));
        }
    }
    return ema;
}

// ------------------------- 成交量均线 -------------------------
function calculateMAVol(volumeArr, period) {
    const ma = [];
    for (let i = 0; i < volumeArr.length; i++) {
        if (i < period - 1) {
            ma.push(null);
        } else {
            const sum = volumeArr.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
            ma.push(sum / period);
        }
    }
    return ma;
}

// ------------------------- 涨跌幅 -------------------------
function calculatePriceChangeRate(lastClose, prevClose) {
    return ((lastClose - prevClose) / prevClose * 100).toFixed(4) + '%';
}

// ------------------------- 获取K线 -------------------------
async function fetchKlines(symbol) {
    try {
        const url = `https://www.okx.com/api/v5/market/candles?instId=${symbol}&bar=${INTERVAL}&limit=100`;
        const res = await fetch(url);
        const json = await res.json();
        if (!json.data || !json.data.length) throw new Error('获取K线失败');
        const rawData = json.data.reverse().slice(0, -1);
        return rawData.map(item => {
            const [ts, o, h, l, c, vol] = item;
            return {
                ts: Number(ts),
                时间: new Date(Number(ts)).toLocaleString('zh-CN', { hour12: false }),
                开盘价: Number(o),
                最高价: Number(h),
                最低价: Number(l),
                收盘价: Number(c),
                成交量: Number(vol)
            };
        });
    } catch (e) {
        console.error(`${symbol} 获取K线出错:`, e);
        return [];
    }
}

// ------------------------- 核心短线信号 -------------------------
async function checkSingleSymbolSignal(symbol) {
    const result = { symbol };
    const candles = await fetchKlines(symbol);
    if (!candles.length) {
        result.error = true;
        result.signal = '获取数据失败';
        return result;
    }

    const closes = candles.map(c => c.收盘价);
    const volumes = candles.map(c => c.成交量);
    const emaShort = calculateEMA(closes, EMA_SHORT_PERIOD); // EMA20
    const emaLong = calculateEMA(closes, EMA_LONG_PERIOD);   // EMA50
    const volMA = calculateMAVol(volumes, VOLUME_MA_PERIOD);

    const lastIdx = closes.length - 1;
    const lastCandle = candles[lastIdx];

    // 顺势信号判断
    let signal = '📊 观望信号';
    const lastClose = lastCandle.收盘价;
    const lastEMA50 = emaLong[lastIdx];
    const lastEMA20 = emaShort[lastIdx];
    const lastVolMA = volMA[lastIdx];
    const lastVol = volumes[lastIdx];
    const prevClose = closes[lastIdx - 1];
    const changeRate = calculatePriceChangeRate(lastClose, prevClose);

    if (lastEMA50 != null && lastEMA20 != null && lastVolMA != null) {
        // 顺势判断
        if (lastClose > lastEMA50) {
            // 多头方向
            if (lastClose >= lastEMA20 && lastVol > lastVolMA) {
                signal = '🔴 做多信号（顺势+回踩+放量）';
            }
        } else if (lastClose < lastEMA50) {
            // 空头方向
            if (lastClose <= lastEMA20 && lastVol > lastVolMA) {
                signal = '🔵 做空信号（顺势+回踩+放量）';
            }
        }
    }

    return {
        symbol,
        error: false,
        lastCandle,
        changeRate,
        emaShort: lastEMA20?.toFixed(2) || '-',
        emaLong: lastEMA50?.toFixed(2) || '-',
        volMA: lastVolMA?.toFixed(2) || '-',
        signal
    };
}

// ------------------------- 汇总邮件 -------------------------
async function sendSummaryEmail(summaryData) {
    const subject = `多币种${INTERVAL}顺势短线信号汇总 - ${new Date().toLocaleString('zh-CN', { hour12: false })}`;
    let content = `【多币种${INTERVAL}顺势短线信号】\n检测时间：${new Date().toLocaleString('zh-CN', { hour12: false })}\n`;
    content += `规则：EMA50 定方向 + EMA20 回踩位置 + 成交量确认\n\n`;

    summaryData.forEach(item => {
        content += `———— ${item.symbol} ————\n`;
        if (item.error) {
            content += `状态：获取数据失败\n\n`;
            return;
        }
        content += `最新K线：${item.lastCandle.时间}\n`;
        content += `开:${item.lastCandle.开盘价} 高:${item.lastCandle.最高价} 低:${item.lastCandle.最低价} 收:${item.lastCandle.收盘价}\n`;
        content += `涨跌幅：${item.changeRate}\n`;
        content += `EMA20:${item.emaShort} EMA50:${item.emaLong} 成交量MA:${item.volMA}\n`;
        content += `交易信号：${item.signal}\n\n`;
    });

    console.log(content);

    const transporter = getTransporter();
    try {
        await transporter.sendMail({
            from: emailAccounts[currentIndex].user,
            to: EMAIL_TO,
            subject,
            text: content
        });
        console.log(`汇总邮件发送成功，邮箱: ${emailAccounts[currentIndex].user}`);
        currentIndex = (currentIndex + 1) % emailAccounts.length;
    } catch (e) {
        console.error(`邮箱 ${emailAccounts[currentIndex].user} 发送失败:`, e);
    }
}

// ------------------------- 主函数 -------------------------
async function main() {
    console.log(`开始执行多币种${INTERVAL}顺势短线信号检测...`);
    const summaryData = [];
    for (const symbol of SYMBOLS) {
        const res = await checkSingleSymbolSignal(symbol);
        summaryData.push(res);
    }
    await sendSummaryEmail(summaryData);
    console.log('汇总邮件发送完成，程序退出');
}

main();
