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

// 新增：统一发送汇总邮件
async function sendSummaryEmail(summaryData) {
    const subject = `多币种${INTERVAL}周期信号汇总 - ${new Date().toLocaleString('zh-CN', { hour12: false })}`;
    
    // 构建邮件内容
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
        emailContent += `指标信息：EMA快:${item.emaFast} EMA中:${item.emaMed} EMA慢:${item.emaSlow}\n`;
        emailContent += `MACD信息：DIF:${item.dif} DEA:${item.dea} MACD:${item.macd}\n`;
        emailContent += `信号状态：${item.signal}\n\n`;
    });

    console.log('汇总邮件内容：\n', emailContent);

    const transporter = getTransporter();
    try {
        await transporter.sendMail({
            from: emailAccounts[currentIndex].user,
            to: EMAIL_TO,
            subject: subject,
            text: emailContent
        });
        console.log(`汇总邮件发送成功，使用邮箱: ${emailAccounts[currentIndex].user}`);
        currentIndex = (currentIndex + 1) % emailAccounts.length;
    } catch (e) {
        console.error(`邮箱 ${emailAccounts[currentIndex].user} 发送汇总邮件失败:`, e);
    }
}

// 修改：返回单币种检测结果，不单独发邮件
async function checkSingleSymbolSignal(symbol) {
    const result = { symbol };
    const candles = await fetchKlines(symbol);
    
    if (!candles.length) {
        console.log(`${symbol} 未获取到 K 线，跳过检测`);
        result.error = true;
        result.signal = '获取数据失败';
        return result;
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

    // 格式化指标（处理null情况）
    const formatVal = (val, fixed = 2) => val != null ? val.toFixed(fixed) : '-';
    const emaFastStr = formatVal(emaFast[last]);
    const emaMedStr = formatVal(emaMed[last]);
    const emaSlowStr = formatVal(emaSlow[last]);
    const difStr = formatVal(macd.dif[last], 6);
    const deaStr = formatVal(macd.dea[last], 6);
    const macdStr = formatVal(macd.macd[last], 6);

    console.log(`\n—————— ${symbol} 最新已收盘 K 线和关键指标 ——————`);
    console.log(
        `${lastCandle.时间} | 开:${lastCandle.开盘价} 高:${lastCandle.最高价} 低:${lastCandle.最低价} 收:${lastCandle.收盘价} | ` +
        `涨跌幅:${changeRate} | ` +
        `EMA快:${emaFastStr} EMA中:${emaMedStr} EMA慢:${emaSlowStr} | ` +
        `DIF:${difStr} DEA:${deaStr} MACD:${macdStr}`
    );

    // 判断信号
    let signal = '无多空信号';
    if (emaFast[last] > emaMed[last] && emaMed[last] > emaSlow[last] && macd.dif[last] > macd.dea[last]) {
        signal = '🔴 做多信号';
        console.log(`${symbol} 检测到做多信号！`);
    } else if (emaFast[last] < emaMed[last] && emaMed[last] < emaSlow[last] && macd.dif[last] < macd.dea[last]) {
        signal = '🔵 做空信号';
        console.log(`${symbol} 检测到做空信号！`);
    } else {
        console.log(`${symbol} 无多空信号`);
    }

    // 返回单币种结果
    return {
        symbol,
        error: false,
        lastCandle,
        changeRate,
        emaFast: emaFastStr,
        emaMed: emaMedStr,
        emaSlow: emaSlowStr,
        dif: difStr,
        dea: deaStr,
        macd: macdStr,
        signal
    };
}

async function main() {
    console.log('开始执行多币种多空信号检测...');
    // 新增：汇总所有币种结果
    const summaryData = [];
    
    // 遍历所有币种，收集检测结果
    for (const symbol of SYMBOLS) {
        const result = await checkSingleSymbolSignal(symbol);
        summaryData.push(result);
    }

    console.log('\n所有币种检测完成，开始发送汇总邮件...');
    // 统一发送汇总邮件
    await sendSummaryEmail(summaryData);
    
    console.log('汇总邮件发送完成，程序退出（等待下一次定时触发）');
}

main();
