/**
 * Data loader for historical price data from Binance.
 * No authentication required for public market data.
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CACHE_DIR = join(__dirname, '..', 'backtest', 'data')

const BINANCE_FUTURES_URL = 'https://fapi.binance.com'

/**
 * Fetch klines from Binance Futures API
 * @param {string} symbol - Trading pair (e.g., 'BTCUSDT')
 * @param {string} interval - Candle interval (1m, 5m, 15m, 1h, 4h, 1d)
 * @param {number} startTime - Start timestamp in ms
 * @param {number} endTime - End timestamp in ms
 * @param {number} limit - Max 1000
 * @returns {Promise<Array>}
 */
async function fetchKlines(symbol, interval, startTime, endTime, limit = 1000) {
  const url = new URL(`${BINANCE_FUTURES_URL}/fapi/v1/klines`)
  url.searchParams.set('symbol', symbol)
  url.searchParams.set('interval', interval)
  url.searchParams.set('startTime', startTime.toString())
  url.searchParams.set('endTime', endTime.toString())
  url.searchParams.set('limit', limit.toString())

  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`Binance API error: ${res.status} ${await res.text()}`)
  }
  return res.json()
}

/**
 * Parse Binance kline data to simplified format
 * @param {Array} kline - Raw Binance kline
 * @returns {Object}
 */
function parseKline(kline) {
  return {
    timestamp: new Date(kline[0]),
    open: parseFloat(kline[1]),
    high: parseFloat(kline[2]),
    low: parseFloat(kline[3]),
    close: parseFloat(kline[4]),
    volume: parseFloat(kline[5]),
    closeTime: new Date(kline[6])
  }
}

/**
 * Load historical data with caching
 * @param {Object} options
 * @param {string} options.symbol - Trading pair (default: BTCUSDT)
 * @param {string} options.interval - Candle interval (default: 5m)
 * @param {Date} options.startDate - Start date
 * @param {Date} options.endDate - End date
 * @param {boolean} options.useCache - Use cached data if available (default: true)
 * @returns {Promise<Array>}
 */
export async function loadHistoricalData({
  symbol = 'BTCUSDT',
  interval = '5m',
  startDate,
  endDate,
  useCache = true
}) {
  const startTime = startDate.getTime()
  const endTime = endDate.getTime()

  // Check cache
  const cacheFile = join(CACHE_DIR, `${symbol}_${interval}_${startDate.toISOString().split('T')[0]}_${endDate.toISOString().split('T')[0]}.json`)

  if (useCache && existsSync(cacheFile)) {
    console.log(`Loading from cache: ${cacheFile}`)
    const cached = JSON.parse(readFileSync(cacheFile, 'utf8'))
    return cached.map(c => ({ ...c, timestamp: new Date(c.timestamp), closeTime: new Date(c.closeTime) }))
  }

  console.log(`Fetching ${symbol} ${interval} data from Binance...`)
  console.log(`  From: ${startDate.toISOString()}`)
  console.log(`  To:   ${endDate.toISOString()}`)

  const allCandles = []
  let currentStart = startTime

  // Calculate interval in ms for pagination
  const intervalMs = {
    '1m': 60 * 1000,
    '5m': 5 * 60 * 1000,
    '15m': 15 * 60 * 1000,
    '1h': 60 * 60 * 1000,
    '4h': 4 * 60 * 60 * 1000,
    '1d': 24 * 60 * 60 * 1000
  }[interval] || 5 * 60 * 1000

  while (currentStart < endTime) {
    const batchEnd = Math.min(currentStart + (1000 * intervalMs), endTime)

    const klines = await fetchKlines(symbol, interval, currentStart, batchEnd)

    if (klines.length === 0) break

    for (const kline of klines) {
      allCandles.push(parseKline(kline))
    }

    // Move to next batch
    const lastTime = klines[klines.length - 1][0]
    currentStart = lastTime + intervalMs

    // Rate limiting - Binance allows 1200 requests/min
    await sleep(100)

    // Progress
    const progress = ((currentStart - startTime) / (endTime - startTime) * 100).toFixed(1)
    process.stdout.write(`\r  Progress: ${progress}% (${allCandles.length} candles)`)
  }

  console.log(`\n  Fetched ${allCandles.length} candles`)

  // Cache the data
  if (!existsSync(CACHE_DIR)) {
    mkdirSync(CACHE_DIR, { recursive: true })
  }
  writeFileSync(cacheFile, JSON.stringify(allCandles, null, 2))
  console.log(`  Cached to: ${cacheFile}`)

  return allCandles
}

/**
 * Load data for a specific number of days back from now
 * @param {number} days - Number of days to load
 * @param {string} interval - Candle interval
 * @returns {Promise<Array>}
 */
export async function loadRecentData(days = 30, interval = '5m') {
  const endDate = new Date()
  const startDate = new Date(endDate.getTime() - days * 24 * 60 * 60 * 1000)

  return loadHistoricalData({
    symbol: 'BTCUSDT',
    interval,
    startDate,
    endDate
  })
}

/**
 * Convert candles to the format used by the backtester
 * @param {Array} candles - Raw candles from Binance
 * @returns {Array} Backtester-compatible price points
 */
export function candlesToPricePoints(candles) {
  return candles.map(c => ({
    timestamp: c.timestamp,
    price: c.close,
    high: c.high,
    low: c.low,
    open: c.open
  }))
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

export default { loadHistoricalData, loadRecentData, candlesToPricePoints }
