import fetch from 'node-fetch';
import nodemailer from 'nodemailer';

// 邮箱配置（保持不变）
const EMAIL_USER1 = '2410078546@qq.com';
const EMAIL_PASS1 = 'pbwviuveqmahebag';
const EMAIL_USER2 = '2040223225@qq.com';
const EMAIL_PASS2 = 'ocyqfrucuifkbfia';
const EMAIL_TO = '2410078546@qq.com';

// 交易对与周期配置（保持15分钟，可按需修改）
const SYMBOLS = ['BTC-USDT', 'ETH-USDT', 'SOL-USDT', 'LTC-USDT'];
const INTERVAL = '15m';
// BOLL核心参数（中轨周期20，标准差2.0，适配15分钟K线）
const BOLL_PERIOD = 20;
const BOLL_STD = 2.0;

const emailAccounts = [
    { user: EMAIL_USER1, pass: EMAIL_PASS1 },
    { user: EMAIL_USER2, pass: EMAIL_PASS2 }
];
let currentIndex = 0;

// 邮箱 transporter 生成（保持不变）
function getTransporter() {
    const account = emailAccounts[currentIndex];
    return nodemailer.createTransport({
        host: 'smtp.qq.com',
        port: 465,
        secure: true,
        auth: { user: account.user, pass: account.pass }
    });
}

/**
 * 新增：计算BOLL指标（中轨+上轨+下轨）
 * @param {Array} closes - 收盘价数组
 * @returns {Object} bollData - 包含中轨、上轨、下轨数组
 */
function calculateBOLL(closes) {
    const boll = {
        middle: [], // 中轨（EMA(20)）
        upper: [],  // 上轨（中轨+2倍标准差）
        lower: []   // 下轨（中轨-2倍标准差）
    };
    const k = 2 / (BOLL_PERIOD + 1); // EMA平滑系数

    // 计算中轨（EMA(20)）
    for (let i = 0; i < closes.length; i++) {
        if (i < BOLL_PERIOD - 1) {
            boll.middle.push(null); // 前19根K线无EMA值
        } else if (i === BOLL_PERIOD - 1) {
            // 第20根K线：取前20根收盘价平均值作为初始EMA
            const sum = closes.slice(0, BOLL_PERIOD).reduce((a, b) => a + b, 0);
            boll.middle.push(sum / BOLL_PERIOD);
        } else {
            // 后续K线：EMA = 当期收盘价*k + 前一期EMA*(1-k)
            boll.middle.push(closes[i] * k + boll.middle[i - 1] * (1 - k));
        }
    }

    // 计算上轨和下轨（基于中轨+标准差）
    for (let i = 0; i < closes.length; i++) {
        if (i < BOLL_PERIOD - 1) {
            boll.upper.push(null);
            boll.lower.push(null);
            continue;
        }
        // 取当前K线及前19根K线的中轨值，计算标准差
        const recentMiddle = boll.middle.slice(i - BOLL_PERIOD + 1, i + 1);
        const avg = recentMiddle.reduce((a, b) => a + b, 0) / BOLL_PERIOD;
        const std = Math.sqrt(
            recentMiddle.reduce((a, b) => a + Math.pow(b - avg, 2), 0) / BOLL_PERIOD
        );
        // 上轨=中轨+2倍标准差，下轨=中轨-2倍标准差
        boll.upper.push(boll.middle[i] + BOLL_STD * std);
        boll.lower.push(boll.middle[i] - BOLL_STD * std);
    }

    return boll;
}

// 涨跌幅计算（保持不变）
function calculatePriceChangeRate(lastClose, prevClose) {
    return ((lastClose - prevClose) / prevClose) * 100;
}

// 获取K线数据（保持不变，仅保留需要的字段）
async function fetchKlines(symbol) {
    try {
        console.log(`开始获取 ${symbol} ${INTERVAL} K线...`);
        const url = `https://www.okx.com/api/v5/market/candles?instId=${symbol}&bar=${INTERVAL}&limit=100`;
        const res = await fetch(url);
        const json = await res.json();
        if (!json.data || !json.data.length) throw new Error('获取K线失败');

        // 反转K线顺序（按时间正序排列），剔除最后一根未收盘K线
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
        console.error(`${symbol} 获取K线出错:`, e);
        return [];
    }
}

// 发送汇总邮件（修改为纯BOLL信号展示）
async function sendSummaryEmail(summaryData) {
    const subject = `多币种${INTERVAL}周期BOLL信号汇总 - ${new Date().toLocaleString('zh-CN', { hour12: false })}`;
    
    let emailContent = `【多币种${INTERVAL}周期BOLL交易信号汇总】\n`;
    emailContent += `检测时间：${new Date().toLocaleString('zh-CN', { hour12: false })}\n`;
    emailContent += `BOLL参数：中轨周期${BOLL_PERIOD}，标准差${BOLL_STD}\n`;
    emailContent += `信号规则：仅基于BOLL指标 → 跌破下轨→做多，涨破上轨→做空\n\n`;

    summaryData.forEach(item => {
        emailContent += `—————— ${item.symbol} ——————\n`;
        if (item.error) {
            emailContent += `状态：获取数据失败\n\n`;
            return;
        }
        emailContent += `最新K线：${item.lastCandle.时间}\n`;
        emailContent += `价格信息：开:${item.lastCandle.开盘价.toFixed(2)} 高:${item.lastCandle.最高价.toFixed(2)} 低:${item.lastCandle.最低价.toFixed(2)} 收:${item.lastCandle.收盘价.toFixed(2)}\n`;
        emailContent += `涨跌幅：${item.changeRate}\n`;
        emailContent += `BOLL指标：上轨:${item.bollUpper} 中轨:${item.bollMiddle} 下轨:${item.bollLower}\n`;
        emailContent += `价格位置：${item.pricePosition}\n`;
        emailContent += `交易信号：${item.signal}\n\n`;
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

/**
 * 单币种BOLL信号检测（核心逻辑）
 * 信号规则：仅基于BOLL指标 → 跌破下轨→做多，涨破上轨→做空（无成交量验证）
 */
async function checkSingleSymbolSignal(symbol) {
    const result = { symbol };
    const candles = await fetchKlines(symbol);
    
    if (!candles.length) {
        console.log(`${symbol} 未获取到K线，跳过检测`);
        result.error = true;
        result.signal = '获取数据失败';
        return result;
    }

    const closes = candles.map(c => c.收盘价);
    const boll = calculateBOLL(closes);
    const lastIdx = closes.length - 1; // 最新一根K线的索引
    const lastCandle = candles[lastIdx];

    // 格式化指标值（保留2位小数，无值显示"-"）
    const formatVal = (val) => val != null ? val.toFixed(2) : '-';
    const bollUpper = formatVal(boll.upper[lastIdx]);
    const bollMiddle = formatVal(boll.middle[lastIdx]);
    const bollLower = formatVal(boll.lower[lastIdx]);

    // 计算涨跌幅
    let changeRate = '-';
    if (lastIdx >= 1) {
        const prevClose = candles[lastIdx - 1].收盘价;
        changeRate = calculatePriceChangeRate(lastCandle.收盘价, prevClose).toFixed(4) + '%';
    }

    // 价格位置描述（适配新信号规则）
    let pricePosition = '轨道内波动';
    if (boll.upper[lastIdx] && lastCandle.收盘价 > boll.upper[lastIdx]) {
        pricePosition = '涨破上轨（超买）';
    } else if (boll.lower[lastIdx] && lastCandle.收盘价 < boll.lower[lastIdx]) {
        pricePosition = '跌破下轨（超卖）';
    } else if (boll.middle[lastIdx] && lastCandle.收盘价 > boll.middle[lastIdx]) {
        pricePosition = '中轨上方（多头偏强）';
    } else if (boll.middle[lastIdx] && lastCandle.收盘价 < boll.middle[lastIdx]) {
        pricePosition = '中轨下方（空头偏强）';
    }

    // BOLL交易信号判断（核心修改：仅BOLL指标，无成交量验证）
    let signal = '📊 观望信号';
    if (boll.upper[lastIdx] && boll.middle[lastIdx] && boll.lower[lastIdx]) {
        const lastClose = lastCandle.收盘价;

        // 1. 做多信号：跌破下轨（超卖）
        if (lastClose < boll.lower[lastIdx]) {
            signal = '🔴 做多信号（跌破下轨，超卖反弹）';
        }

        // 2. 做空信号：涨破上轨（超买）
        else if (lastClose > boll.upper[lastIdx]) {
            signal = '🔵 做空信号（涨破上轨，超买回落）';
        }

        // 3. 回踩强化信号：突破后回踩确认（无成交量要求）
        const prevCandle = candles[lastIdx - 1];
        const isBackstepLower = prevCandle.收盘价 < boll.lower[lastIdx] && lastClose >= boll.lower[lastIdx]; // 跌破后回踩下轨不破
        const isBackstepUpper = prevCandle.收盘价 > boll.upper[lastIdx] && lastClose <= boll.upper[lastIdx]; // 涨破后回踩上轨不破
        if (isBackstepLower) {
            signal = '🔴 做多信号（回踩下轨支撑，反弹确认）';
        }
        if (isBackstepUpper) {
            signal = '🔵 做空信号（回踩上轨压力，回落确认）';
        }
    }

    // 打印日志（移除成交量展示）
    console.log(`\n—————— ${symbol} 最新已收盘K线 ——————`);
    console.log(
        `${lastCandle.时间} | 开:${lastCandle.开盘价.toFixed(2)} 高:${lastCandle.最高价.toFixed(2)} 低:${lastCandle.最低价.toFixed(2)} 收:${lastCandle.收盘价.toFixed(2)} | ` +
        `涨跌幅:${changeRate} | ` +
        `BOLL（上:${bollUpper} 中:${bollMiddle} 下:${bollLower}） | ` +
        `信号:${signal}`
    );

    return {
        symbol,
        error: false,
        lastCandle,
        changeRate,
        bollUpper,
        bollMiddle,
        bollLower,
        pricePosition,
        signal
    };
}

// 主函数（保持不变，批量检测+发送汇总邮件）
async function main() {
    console.log(`开始执行多币种${INTERVAL}周期BOLL信号检测...`);
    const summaryData = [];
    
    for (const symbol of SYMBOLS) {
        const result = await checkSingleSymbolSignal(symbol);
        summaryData.push(result);
    }

    console.log('\n所有币种检测完成，开始发送汇总邮件...');
    await sendSummaryEmail(summaryData);
    console.log('汇总邮件发送完成，程序退出（等待下一次定时触发）');
}

main();
