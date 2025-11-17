import fetch from 'node-fetch';
import nodemailer from 'nodemailer';

const EMAIL_USER1 = '2410078546@qq.com';
const EMAIL_PASS1 = 'pbwviuveqmahebag';
const EMAIL_USER2 = '2040223225@qq.com';
const EMAIL_PASS2 = 'ocyqfrucuifkbfia';
const EMAIL_TO = '2410078546@qq.com';

const SYMBOLS = ['BTC-USDT', 'ETH-USDT', 'SOL-USDT', 'LTC-USDT'];
const INTERVAL = '15m';
const EMA_FAST = 12;
const EMA_MED = 26;
const EMA_SLOW = 50;

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

function calculateEMA(values, period) {
    const k = 2 / (period + 1);
    const ema = [];
    for (let i = 0; i < values.length; i++) {
        if (i < period - 1) {
            ema.push(null);
        } else if (i === period - 1) {
            const sum = values.slice(0, period).reduce((a, b) => a + b, 0);
            ema.push(sum / period);
        } else {
            ema.push(values[i] * k + ema[i - 1] * (1 - k));
        }
    }
    return ema;
}

function calculateMACD(values, fast = 12, slow = 26, signal = 9) {
    const emaFast = calculateEMA(values, fast);
    const emaSlow = calculateEMA(values, slow);

    const dif = values.map((v, i) => (emaFast[i] != null && emaSlow[i] != null ? emaFast[i] - emaSlow[i] : null));
    const difValid = dif.filter(v => v != null);
    const deaValid = calculateEMA(difValid, signal);
    const dea = Array(dif.length - deaValid.length).fill(null).concat(deaValid);
    const macd = dif.map((v, i) => (v != null && dea[i] != null ? (v - dea[i]) * 2 : null));

    return { dif, dea, macd };
}

// 新增：计算涨跌幅
function calculatePriceChangeRate(lastClose, prevClose) {
    return ((lastClose - prevClose) / prevClose) * 100;
}

async function fetchKlines(symbol) {
    try {
        console.log(`开始获取 ${symbol} K 线...`);
        const url = `https://www.okx.com/api/v5/market/candles?instId=${symbol}&bar=${INTERVAL}&limit=100`;
        const res = await fetch(url);
        const json = await res.json();
        if (!json.data || !json.data.length) throw new Error('获取 K 线失败');

        let rawData = json.data.reverse().slice(0, -1);
        const candles = rawData.map(item => {
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

        return candles;
    } catch (e) {
        console.error(`${symbol} 获取 K 线出错:`, e);
        return [];
    }
}

async function sendSignalEmail(signal, symbol, type) {
    const subject = type === 'buy' ? `${symbol} 做多信号` : `${symbol} 做空信号`;
    const info = `${symbol} ${type === 'buy' ? '做多' : '做空'}信号触发！\n` +
        `EMA快:${signal.emaFast.toFixed(2)}, EMA中:${signal.emaMed.toFixed(2)}, EMA慢:${signal.emaSlow.toFixed(2)}\n` +
        `DIF:${signal.dif.toFixed(6)}, DEA:${signal.dea.toFixed(6)}, MACD:${signal.macd.toFixed(6)}\n` +
        `周期: ${INTERVAL}`;
    console.log(info);

    const transporter = getTransporter();
    try {
        await transporter.sendMail({
            from: emailAccounts[currentIndex].user,
            to: EMAIL_TO,
            subject: subject,
            text: info
        });
        console.log(`邮件发送成功（${subject}），使用邮箱: ${emailAccounts[currentIndex].user}`);
        currentIndex = (currentIndex + 1) % emailAccounts.length;
    } catch (e) {
        console.error(`邮箱 ${emailAccounts[currentIndex].user} 发送 ${subject} 失败:`, e);
    }
}

async function checkSingleSymbolSignal(symbol) {
    const candles = await fetchKlines(symbol);
    if (!candles.length) {
        console.log(`${symbol} 未获取到 K 线，跳过检测`);
        return;
    }

    const closes = candles.map(c => c.收盘价);
    const emaFast = calculateEMA(closes, EMA_FAST);
    const emaMed = calculateEMA(closes, EMA_MED);
    const emaSlow = calculateEMA(closes, EMA_SLOW);
    const macd = calculateMACD(closes);

    const last = closes.length - 1;
    const lastCandle = candles[last];
    // 计算最新K线涨跌幅
    let changeRate = '-';
    if (last >= 1) {
        const prevClose = candles[last - 1].收盘价;
        changeRate = calculatePriceChangeRate(lastCandle.收盘价, prevClose).toFixed(4) + '%';
    }

    console.log(`\n—————— ${symbol} 最新已收盘 K 线和关键指标 ——————`);
    console.log(
        `${lastCandle.时间} | 开:${lastCandle.开盘价} 高:${lastCandle.最高价} 低:${lastCandle.最低价} 收:${lastCandle.收盘价} | ` +
        `涨跌幅:${changeRate} | ` +
        `EMA快:${emaFast[last]?.toFixed(2) || '-'} EMA中:${emaMed[last]?.toFixed(2) || '-'} EMA慢:${emaSlow[last]?.toFixed(2) || '-'} | ` +
        `DIF:${macd.dif[last]?.toFixed(6) || '-'} DEA:${macd.dea[last]?.toFixed(6) || '-'} MACD:${macd.macd[last]?.toFixed(6) || '-'}`
    );

    if (emaFast[last] > emaMed[last] && emaMed[last] > emaSlow[last] && macd.dif[last] > macd.dea[last]) {
        const signal = {
            emaFast: emaFast[last],
            emaMed: emaMed[last],
            emaSlow: emaSlow[last],
            dif: macd.dif[last],
            dea: macd.dea[last],
            macd: macd.macd[last]
        };
        console.log(`${symbol} 检测到做多信号！`);
        await sendSignalEmail(signal, symbol, 'buy');
    } else if (emaFast[last] < emaMed[last] && emaMed[last] < emaSlow[last] && macd.dif[last] < macd.dea[last]) {
        const signal = {
            emaFast: emaFast[last],
            emaMed: emaMed[last],
            emaSlow: emaSlow[last],
            dif: macd.dif[last],
            dea: macd.dea[last],
            macd: macd.macd[last]
        };
        console.log(`${symbol} 检测到做空信号！`);
        await sendSignalEmail(signal, symbol, 'sell');
    } else {
        console.log(`${symbol} 无多空信号`);
    }
}

async function main() {
    console.log('开始执行多币种多空信号检测...');
    for (const symbol of SYMBOLS) {
        await checkSingleSymbolSignal(symbol);
    }
    console.log('\n所有币种检测完成，程序退出（等待下一次定时触发）');
}

main();
