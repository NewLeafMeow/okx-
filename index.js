import fetch from 'node-fetch';
import nodemailer from 'nodemailer';
// 新增：导入绘图库
import { createCanvas, registerFont } from 'canvas';

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
// 新增：K线图配置（30根K线）
const KLINE_COUNT = 30; // 只取最新30根15分钟K线
const CANVAS_WIDTH = 800; // 画布宽度
const CANVAS_HEIGHT = 400; // 画布高度

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

        // 新增：只保留最新30根K线（符合需求）
        return candles.slice(-KLINE_COUNT);
    } catch (e) {
        console.error(`${symbol} 获取 K 线出错:`, e);
        return [];
    }
}

// 新增：生成单币种K线图（Base64格式）
function generateKlineChart(symbol, candles, emaFast, emaMed, emaSlow) {
    // 1. 创建画布
    const canvas = createCanvas(CANVAS_WIDTH, CANVAS_HEIGHT);
    const ctx = canvas.getContext('2d');

    // 2. 画布背景
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // 3. 提取30根K线的关键数据（过滤无效EMA）
    const closes = candles.map(c => c.收盘价);
    const highs = candles.map(c => c.最高价);
    const lows = candles.map(c => c.最低价);
    const opens = candles.map(c => c.开盘价);

    // 4. 计算价格范围（留10%边距，避免K线超出画布）
    const allPrices = [...highs, ...lows];
    const priceMin = Math.min(...allPrices) * 0.95;
    const priceMax = Math.max(...allPrices) * 1.05;
    const priceRange = priceMax - priceMin;

    // 5. 计算X轴每根K线的宽度和间距
    const klineWidth = 12; // K线柱宽度
    const klineGap = 4; // K线间距
    const xStart = 50; // X轴起始位置
    const yBottom = CANVAS_HEIGHT - 40; // Y轴底部位置
    const yTop = 40; // Y轴顶部位置
    const yRange = yBottom - yTop;

    // 6. 绘制坐标轴（X轴时间、Y轴价格）
    ctx.fillStyle = '#888';
    ctx.font = '12px Arial';

    // Y轴：绘制5个价格刻度
    for (let i = 0; i <= 4; i++) {
        const y = yBottom - (i / 4) * yRange;
        const price = priceMin + (i / 4) * priceRange;
        ctx.fillText(price.toFixed(2), 10, y + 4); // 价格文本
        ctx.beginPath();
        ctx.moveTo(xStart - 5, y);
        ctx.lineTo(xStart, y);
        ctx.strokeStyle = '#444';
        ctx.stroke(); // 刻度线
    }

    // X轴：绘制5个时间刻度（均匀分布在30根K线中）
    const timeStep = Math.floor(KLINE_COUNT / 4);
    for (let i = 0; i <= 4; i++) {
        const idx = Math.min(i * timeStep, KLINE_COUNT - 1);
        const x = xStart + idx * (klineWidth + klineGap);
        const time = candles[idx].时间.split(' ')[1].slice(0, 5); // 只取时分（如14:30）
        ctx.fillText(time, x - 10, yBottom + 15); // 时间文本
        ctx.beginPath();
        ctx.moveTo(x, yBottom);
        ctx.lineTo(x, yBottom + 5);
        ctx.strokeStyle = '#444';
        ctx.stroke(); // 刻度线
    }

    // 7. 绘制EMA均线（快/中/慢）
    const drawEMA = (emaData, color, label) => {
        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        let firstValid = true;

        for (let i = 0; i < KLINE_COUNT; i++) {
            if (emaData[i] == null) continue; // 跳过无效EMA值
            const x = xStart + i * (klineWidth + klineGap);
            const y = yBottom - ((emaData[i] - priceMin) / priceRange) * yRange;

            if (firstValid) {
                ctx.moveTo(x, y);
                firstValid = false;
            } else {
                ctx.lineTo(x, y);
            }
        }
        ctx.stroke();

        // 绘制均线标签（右上角）
        ctx.fillStyle = color;
        ctx.fillText(label, CANVAS_WIDTH - 120, 25 + (label.includes('快') ? 0 : label.includes('中') ? 15 : 30));
    };

    // 绘制3条EMA均线
    drawEMA(emaFast, '#ff7f0e', `EMA${EMA_FAST}（快）`);
    drawEMA(emaMed, '#2ca02c', `EMA${EMA_MED}（中）`);
    drawEMA(emaSlow, '#1f77b4', `EMA${EMA_SLOW}（慢）`);

    // 8. 绘制K线柱（阳线红色、阴线绿色）
    for (let i = 0; i < KLINE_COUNT; i++) {
        const open = opens[i];
        const close = closes[i];
        const high = highs[i];
        const low = lows[i];
        const x = xStart + i * (klineWidth + klineGap);

        // 计算K线柱和影线的Y坐标
        const openY = yBottom - ((open - priceMin) / priceRange) * yRange;
        const closeY = yBottom - ((close - priceMin) / priceRange) * yRange;
        const highY = yBottom - ((high - priceMin) / priceRange) * yRange;
        const lowY = yBottom - ((low - priceMin) / priceRange) * yRange;

        // 区分阳线（涨）和阴线（跌）
        const isBullish = close >= open;
        ctx.fillStyle = isBullish ? '#ff4d4f' : '#52c41a'; // 阳线红、阴线绿
        ctx.strokeStyle = isBullish ? '#ff4d4f' : '#52c41a';

        // 绘制K线柱（矩形）
        const barHeight = Math.abs(closeY - openY);
        const barTop = Math.min(openY, closeY);
        ctx.fillRect(x - klineWidth/2, barTop, klineWidth, barHeight || 1); // 防止高度为0

        // 绘制影线（上下引线）
        ctx.beginPath();
        ctx.moveTo(x, highY);
        ctx.lineTo(x, lowY);
        ctx.lineWidth = 1;
        ctx.stroke();
    }

    // 9. 绘制标题（币种+周期）
    ctx.fillStyle = '#fff';
    ctx.font = '16px Arial Bold';
    ctx.fillText(`${symbol} ${INTERVAL} K线图（最新${KLINE_COUNT}根）`, xStart, 25);

    // 10. 转成Base64编码（邮件可直接嵌入）
    return canvas.toDataURL('image/png');
}

// 修改：邮件改为HTML格式（支持嵌入图片）
async function sendSummaryEmail(summaryData) {
    const subject = `多币种${INTERVAL}周期信号汇总（含K线图） - ${new Date().toLocaleString('zh-CN', { hour12: false })}`;
    
    // 构建HTML邮件内容（支持图片嵌入）
    let emailContent = `
    <html>
        <body style="font-family: Arial, sans-serif; line-height: 1.6;">
            <h2 style="color: #2c3e50;">【多币种${INTERVAL}周期多空信号汇总】</h2>
            <p style="color: #666;">检测时间：${new Date().toLocaleString('zh-CN', { hour12: false })}</p>
            <hr style="border: 1px solid #eee; margin: 20px 0;">
    `;

    // 遍历每个币种，添加信息+K线图
    for (const item of summaryData) {
        emailContent += `
            <div style="margin-bottom: 30px;">
                <h3 style="color: #34495e;">—————— ${item.symbol} ——————</h3>
        `;

        if (item.error) {
            emailContent += `<p style="color: #e74c3c;">状态：获取数据失败</p>`;
        } else {
            emailContent += `
                <p><strong>最新K线：</strong>${item.lastCandle.时间}</p>
                <p><strong>价格信息：</strong>开:${item.lastCandle.开盘价} 高:${item.lastCandle.最高价} 低:${item.lastCandle.最低价} 收:${item.lastCandle.收盘价}</p>
                <p><strong>涨跌幅：</strong>${item.changeRate}</p>
                <p><strong>指标信息：</strong>EMA快:${item.emaFast} EMA中:${item.emaMed} EMA慢:${item.emaSlow}</p>
                <p><strong>MACD信息：</strong>DIF:${item.dif} DEA:${item.dea} MACD:${item.macd}</p>
                <p><strong>信号状态：</strong><span style="color: ${item.signal.includes('做多') ? '#e74c3c' : item.signal.includes('做空') ? '#3498db' : '#95a5a6'};">${item.signal}</span></p>
                <!-- 嵌入K线图（Base64） -->
                <p><strong>K线图：</strong><br><img src="${item.klineImg}" style="max-width: 100%; height: auto;"></p>
            `;
        }

        emailContent += `</div><hr style="border: 1px solid #eee;">`;
    }

    emailContent += `</body></html>`;

    console.log('汇总邮件（含K线图）内容生成完成，开始发送...');

    const transporter = getTransporter();
    try {
        await transporter.sendMail({
            from: emailAccounts[currentIndex].user,
            to: EMAIL_TO,
            subject: subject,
            html: emailContent, // 改为HTML格式（关键）
            text: '你的邮箱不支持HTML，请升级后查看（含K线图和信号汇总）' // 纯文本备用
        });
        console.log(`汇总邮件发送成功，使用邮箱: ${emailAccounts[currentIndex].user}`);
        currentIndex = (currentIndex + 1) % emailAccounts.length;
    } catch (e) {
        console.error(`邮箱 ${emailAccounts[currentIndex].user} 发送汇总邮件失败:`, e);
    }
}

// 修改：新增生成K线图逻辑，返回Base64
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
    let changeRate = '-';
    if (last >= 1) {
        const prevClose = candles[last - 1].收盘价;
        changeRate = calculatePriceChangeRate(lastCandle.收盘价, prevClose).toFixed(4) + '%';
    }

    const formatVal = (val, fixed = 2) => val != null ? val.toFixed(fixed) : '-';
    const emaFastStr = formatVal(emaFast[last]);
    const emaMedStr = formatVal(emaMed[last]);
    const emaSlowStr = formatVal(emaSlow[last]);
   
