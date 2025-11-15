import fetch from 'node-fetch'; // 用于发起 HTTP 请求
import nodemailer from 'nodemailer'; // 用于发送邮件
import 'dotenv/config'; // 加载 .env 配置文件

// -------------------- 配置 --------------------
const SYMBOL = process.env.SYMBOL || 'BTC-USDT'; // 交易对
const INTERVAL = process.env.INTERVAL || '15m';  // K 线周期
const POLL_INTERVAL = Number(process.env.POLL_INTERVAL) || 500; // 轮询间隔（秒）
const EMA_FAST = 12;  // 快速 EMA 周期
const EMA_MED = 26;   // 中速 EMA 周期
const EMA_SLOW = 50;  // 慢速 EMA 周期

// 多邮箱配置，轮流发送
const emailAccounts = [
    { user: process.env.EMAIL_USER1, pass: process.env.EMAIL_PASS1 },
    { user: process.env.EMAIL_USER2, pass: process.env.EMAIL_PASS2 }
];
let currentIndex = 0; // 当前使用的邮箱索引

// -------------------- 邮件发送器 --------------------
// 根据当前邮箱索引返回 nodemailer transporter
function getTransporter() {
    const account = emailAccounts[currentIndex];
    return nodemailer.createTransport({
        host: 'smtp.qq.com',
        port: 465,
        secure: true,
        auth: { user: account.user, pass: account.pass }
    });
}

// -------------------- EMA 计算 --------------------
function calculateEMA(values, period) {
    const k = 2 / (period + 1); // EMA 系数
    const ema = [];
    for (let i = 0; i < values.length; i++) {
        if (i < period - 1) {
            ema.push(null); // 前 period-1 个数据无法计算 EMA
        } else if (i === period - 1) {
            // 第一个 EMA 用简单平均
            const sum = values.slice(0, period).reduce((a, b) => a + b, 0);
            ema.push(sum / period);
        } else {
            // 递推公式计算 EMA
            ema.push(values[i] * k + ema[i - 1] * (1 - k));
        }
    }
    return ema;
}

// -------------------- MACD 计算 --------------------
function calculateMACD(values, fast = 12, slow = 26, signal = 9) {
    const emaFast = calculateEMA(values, fast); // 快 EMA
    const emaSlow = calculateEMA(values, slow); // 慢 EMA

    // DIF = 快 EMA - 慢 EMA
    const dif = values.map((v, i) => (emaFast[i] != null && emaSlow[i] != null ? emaFast[i] - emaSlow[i] : null));

    // DEA = DIF 的 EMA（信号线）
    const difValid = dif.filter(v => v != null);
    const deaValid = calculateEMA(difValid, signal);
    const dea = Array(dif.length - deaValid.length).fill(null).concat(deaValid);

    // MACD 柱状图 = (DIF - DEA) * 2
    const macd = dif.map((v, i) => (v != null && dea[i] != null ? (v - dea[i]) * 2 : null));

    return { dif, dea, macd };
}

// -------------------- 获取 K 线数据 --------------------
async function fetchKlines() {
    try {
        console.log('开始获取 K 线...');
        const url = `https://www.okx.com/api/v5/market/candles?instId=${SYMBOL}&bar=${INTERVAL}&limit=100`;
        const res = await fetch(url);
        const json = await res.json();
        if (!json.data || !json.data.length) throw new Error('获取 K 线失败');

        // 最新在前 → 升序排列
        let rawData = json.data.reverse();

        // 去掉未收盘的 K 线
        rawData = rawData.slice(0, -1);

        // 格式化 K 线数据
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
        console.error('获取 K 线出错:', e);
        return [];
    }
}

// -------------------- 买入信号判断 --------------------
function checkBuySignal(candles) {
    const closes = candles.map(c => c.收盘价);
    const emaFast = calculateEMA(closes, EMA_FAST);
    const emaMed = calculateEMA(closes, EMA_MED);
    const emaSlow = calculateEMA(closes, EMA_SLOW);
    const macd = calculateMACD(closes);

    const last = closes.length - 1;
    if (last < 0) return null; // 没有 K 线

    const lastCandle = candles[last];

    // 打印最新已收盘 K 线和指标
    console.log('—————— 最新已收盘 K 线和关键指标 ——————');
    console.log(
        `${lastCandle.时间} | 开:${lastCandle.开盘价} 高:${lastCandle.最高价} 低:${lastCandle.最低价} 收:${lastCandle.收盘价} | ` +
        `EMA快:${emaFast[last]?.toFixed(2) || '-'} EMA中:${emaMed[last]?.toFixed(2) || '-'} EMA慢:${emaSlow[last]?.toFixed(2) || '-'} | ` +
        `DIF:${macd.dif[last]?.toFixed(6) || '-'} DEA:${macd.dea[last]?.toFixed(6) || '-'} MACD:${macd.macd[last]?.toFixed(6) || '-'}`
    );

    // 判断金叉：EMA 顺序符合且 DIF > DEA
    if (emaFast[last] > emaMed[last] && emaMed[last] > emaSlow[last]) {
        if (macd.dif[last] > macd.dea[last]) { // 金叉信号
            return {
                emaFast: emaFast[last],
                emaMed: emaMed[last],
                emaSlow: emaSlow[last],
                dif: macd.dif[last],
                dea: macd.dea[last],
                macd: macd.macd[last]
            };
        }
    }

    console.log('没有买入信号');
    return null;
}

// -------------------- 发送邮件 --------------------
async function notifyBuy(signal) {
    const info = `做多信号触发！\nEMA快:${signal.emaFast.toFixed(2)}, EMA中:${signal.emaMed.toFixed(2)}, EMA慢:${signal.emaSlow.toFixed(2)}\nDIF:${signal.dif.toFixed(6)}, DEA:${signal.dea.toFixed(6)}, MACD:${signal.macd.toFixed(6)}\n交易对: ${process.env.SYMBOL}, 周期: ${process.env.INTERVAL}`;
    console.log(info);

    const transporter = getTransporter(); // 获取当前邮箱 transporter
    try {
        await transporter.sendMail({
            from: emailAccounts[currentIndex].user,
            to: process.env.EMAIL_TO,
            subject: `${process.env.SYMBOL} 做多信号`,
            text: info
        });
        console.log(`邮件发送成功，使用邮箱: ${emailAccounts[currentIndex].user}`);

        // 成功发送后切换到下一个邮箱
        currentIndex = (currentIndex + 1) % emailAccounts.length;
    } catch (e) {
        console.error(`邮箱 ${emailAccounts[currentIndex].user} 发送失败:`, e);
    }
}

// -------------------- 轮询主函数 --------------------
async function poll() {
    console.log('轮询开始...');
    const candles = await fetchKlines();
    if (!candles.length) {
        console.log('未获取到 K 线，跳过本轮轮询');
        return;
    }
    const signal = checkBuySignal(candles);
    if (signal) {
        console.log('准备发送邮件通知...');
        await notifyBuy(signal); // 发送邮件
    }
}

// 每 POLL_INTERVAL 秒轮询一次
setInterval(poll, POLL_INTERVAL * 1000);
poll(); // 启动立即执行一次
