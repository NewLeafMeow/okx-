import fetch from 'node-fetch';
import nodemailer from 'nodemailer';

const EMAIL_USER1 = '2410078546@qq.com';
const EMAIL_PASS1 = 'pbwviuveqmahebag';
const EMAIL_USER2 = '2040223225@qq.com';
const EMAIL_PASS2 = 'ocyqfrucuifkbfia';
const EMAIL_TO = '2410078546@qq.com';

const SYMBOLS = ['BTC-USDT', 'ETH-USDT', 'SOL-USDT', 'LTC-USDT'];
const INTERVAL = '15m';
const EMA_SHORT = 5;
const EMA_MID = 20;
const EMA_LONG = 80;
const MACD_FAST = 6;
const MACD_SLOW = 24;
const MACD_SIGNAL = 9;

const emailAccounts = [
    { user: EMAIL_USER1, pass: EMAIL_PASS1 },
    { user: EMAIL_USER2, pass: EMAIL_PASS2 }
];
let currentIndex = 0; // 当前使用的邮箱索引

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

function calculateMACD(values, fast = MACD_FAST, slow = MACD_SLOW, signal = MACD_SIGNAL) {
    const emaFast = calculateEMA(values, fast);
    const emaSlow = calculateEMA(values, slow);
    const dif = values.map((v, i) => (emaFast[i] != null && emaSlow[i] != null ? emaFast[i] - emaSlow[i] : null));
    const difValid = dif.filter(v => v != null);
    const deaValid = calculateEMA(difValid, signal);
    const dea = Array(dif.length - deaValid.length).fill(null).concat(deaValid);
    const macd = dif.map((v, i) => (v != null && dea[i] != null ? (v - dea[i]) * 2 : null));
    return { dif, dea, macd };
}

function judgeCross(difCurr, deaCurr, difPrev, deaPrev) {
    if (difPrev == null || deaPrev == null || difCurr == null || deaCurr == null) {
        return '无交叉';
    }
    if (difPrev < deaPrev && difCurr > deaCurr) return '金叉';
    if (difPrev > deaPrev && difCurr < deaCurr) return '死叉';
    return '无交叉';
}

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

async function sendSummaryEmail(summaryData) {
    const subject = `多币种${INTERVAL}周期信号汇总 - ${new Date().toLocaleString('zh-CN', { hour12: false })}`;
    let emailContent = `【多币种${INTERVAL}周期多空信号汇总】\n`;
    emailContent += `检测时间：${new Date().toLocaleString('zh-CN', { hour12: false })}\n\n`;

    summaryData.forEach(item => {
        emailContent += `—————— ${item.symbol} ——————\n`;
        if (item.error) {
            emailContent += `状态：获取数据失败\n\n`;
            return;
        }
        emailContent += `最新K线：${item.lastCandle.时间}\n`;
        emailContent += `价格信息：开:${item.lastCandle.开盘价} 高:${item.lastCandle.最高价} 低:${item.lastCandle.最低价} 收:${item.lastCandle.收盘价}\n`;
        emailContent += `涨跌幅：${item.changeRate}\n`;
        emailContent += `EMA指标：短(${EMA_SHORT}):${item.emaShort} 中(${EMA_MID}):${item.emaMid} 长(${EMA_LONG}):${item.emaLong}\n`;
        emailContent += `MACD指标：DIF:${item.dif} DEA:${item.dea} MACD:${item.macd}\n`;
        emailContent += `交叉状态：${item.crossStatus}\n`;
        emailContent += `短期信号：${item.shortTermSignal}\n`;
        emailContent += `长期信号：${item.longTermSignal}\n\n`;
    });

    console.log('汇总邮件内容：\n', emailContent);
    const transporter = getTransporter();
    const currentEmail = emailAccounts[currentIndex].user;

    try {
        await transporter.sendMail({
            from: currentEmail,
            to: EMAIL_TO,
            subject: subject,
            text: emailContent
        });
        console.log(`✅ 邮箱 ${currentEmail} 发送成功，切换至下一个邮箱`);
        // 发送成功后强制切换邮箱（循环使用）
        currentIndex = (currentIndex + 1) % emailAccounts.length;
    } catch (e) {
        console.error(`❌ 邮箱 ${currentEmail} 发送失败：`, e);
        console.log(`⚠️  保留当前邮箱，下次执行时优先重试`);
        // 发送失败不切换，下次继续用当前邮箱重试
    }
}

async function checkSingleSymbolSignal(symbol) {
    const result = { symbol };
    const candles = await fetchKlines(symbol);
    if (!candles.length) {
        console.log(`${symbol} 未获取到 K 线，跳过检测`);
        result.error = true;
        result.shortTermSignal = '获取数据失败';
        result.longTermSignal = '获取数据失败';
        return result;
    }

    const closes = candles.map(c => c.收盘价);
    const emaShort = calculateEMA(closes, EMA_SHORT);
    const emaMid = calculateEMA(closes, EMA_MID);
    const emaLong = calculateEMA(closes, EMA_LONG);
    const macd = calculateMACD(closes);

    const lastIdx = closes.length - 1;
    const prevIdx = lastIdx - 1;
    const lastCandle = candles[lastIdx];
    let changeRate = '-';
    if (lastIdx >= 1) {
        const prevClose = candles[prevIdx].收盘价;
        changeRate = calculatePriceChangeRate(lastCandle.收盘价, prevClose).toFixed(4) + '%';
    }

    const formatVal = (val, fixed = 2) => val != null ? val.toFixed(fixed) : '-';
    const emaShortStr = formatVal(emaShort[lastIdx]);
    const emaMidStr = formatVal(emaMid[lastIdx]);
    const emaLongStr = formatVal(emaLong[lastIdx]);
    const difCurr = macd.dif[lastIdx];
    const deaCurr = macd.dea[lastIdx];
    const difPrev = macd.dif[prevIdx];
    const deaPrev = macd.dea[prevIdx];
    const difStr = formatVal(difCurr, 6);
    const deaStr = formatVal(deaCurr, 6);
    const macdStr = formatVal(macd.macd[lastIdx], 6);
    const crossStatus = judgeCross(difCurr, deaCurr, difPrev, deaPrev);

    let shortTermSignal = '无短期信号';
    if (emaShort[lastIdx] > emaMid[lastIdx] && crossStatus === '金叉') {
        shortTermSignal = '🔴 短期做多信号';
    } else if (emaShort[lastIdx] < emaMid[lastIdx] && crossStatus === '死叉') {
        shortTermSignal = '🔵 短期做空信号';
    }

    let longTermSignal = '无长期信号';
    if (emaShort[lastIdx] > emaMid[lastIdx] && emaMid[lastIdx] > emaLong[lastIdx] && crossStatus === '金叉') {
        longTermSignal = '🔥 长期做多信号';
    } else if (emaShort[lastIdx] < emaMid[lastIdx] && emaMid[lastIdx] < emaLong[lastIdx] && crossStatus === '死叉') {
        longTermSignal = '❄️ 长期做空信号';
    }

    console.log(`\n—————— ${symbol} 最新已收盘 K 线和关键指标 ——————`);
    console.log(
        `${lastCandle.时间} | 开:${lastCandle.开盘价} 高:${lastCandle.最高价} 低:${lastCandle.最低价} 收:${lastCandle.收盘价} | ` +
        `涨跌幅:${changeRate} | ` +
        `EMA(短${EMA_SHORT}):${emaShortStr} 中${EMA_MID}:${emaMidStr} 长${EMA_LONG}:${emaLongStr} | ` +
        `MACD(DIF:${difStr} DEA:${deaStr} MACD:${macdStr}) | ` +
        `交叉:${crossStatus} | 短期信号:${shortTermSignal} | 长期信号:${longTermSignal}`
    );

    return {
        symbol,
        error: false,
        lastCandle,
        changeRate,
        emaShort: emaShortStr,
        emaMid: emaMidStr,
        emaLong: emaLongStr,
        dif: difStr,
        dea: deaStr,
        macd: macdStr,
        crossStatus,
        shortTermSignal,
        longTermSignal
    };
}

async function main() {
    console.log('====== 开始执行多币种多空信号检测 ======');
    const summaryData = [];
    for (const symbol of SYMBOLS) {
        const result = await checkSingleSymbolSignal(symbol);
        summaryData.push(result);
    }

    console.log('\n====== 所有币种检测完成，开始发送汇总邮件 ======');
    await sendSummaryEmail(summaryData);
    console.log('====== 邮件发送流程结束，等待下一次定时触发 ======');
}

main();
