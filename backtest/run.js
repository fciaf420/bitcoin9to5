#!/usr/bin/env node
/**
 * Backtest CLI - Run backtests on historical Binance data
 *
 * Usage:
 *   node backtest/run.js                    # Last 30 days
 *   node backtest/run.js --days 90          # Last 90 days
 *   node backtest/run.js --start 2025-01-01 --end 2025-06-01
 *   node backtest/run.js --interval 1h      # Use 1-hour candles
 *   node backtest/run.js --trades           # Show individual trades
 */

import { loadHistoricalData, candlesToPricePoints } from '../lib/data-loader.js'
import { runBacktest, formatResults } from '../lib/backtester.js'
import { DEFAULT_CONFIG } from '../lib/strategy.js'

function parseArgs(args) {
  const options = {
    days: 30,
    startDate: null,
    endDate: null,
    interval: '5m',
    showTrades: false,
    profitTarget: DEFAULT_CONFIG.profitTargetPct,
    leverage: DEFAULT_CONFIG.leverage,
    help: false
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    const next = args[i + 1]

    switch (arg) {
      case '--days':
      case '-d':
        options.days = parseInt(next, 10)
        i++
        break
      case '--start':
      case '-s':
        options.startDate = new Date(next)
        i++
        break
      case '--end':
      case '-e':
        options.endDate = new Date(next)
        i++
        break
      case '--interval':
      case '-i':
        options.interval = next
        i++
        break
      case '--trades':
      case '-t':
        options.showTrades = true
        break
      case '--profit':
      case '-p':
        options.profitTarget = parseFloat(next)
        i++
        break
      case '--leverage':
      case '-l':
        options.leverage = parseFloat(next)
        i++
        break
      case '--help':
      case '-h':
        options.help = true
        break
    }
  }

  return options
}

function showHelp() {
  console.log(`
Bitcoin9to5 Backtester
======================

Run simulated trades on historical Binance BTCUSDT perpetual futures data.

Usage:
  node backtest/run.js [options]

Options:
  --days, -d <n>        Days of data to fetch (default: 30)
  --start, -s <date>    Start date (YYYY-MM-DD)
  --end, -e <date>      End date (YYYY-MM-DD)
  --interval, -i <int>  Candle interval: 1m, 5m, 15m, 1h, 4h (default: 5m)
  --trades, -t          Show individual trade details
  --profit, -p <pct>    Profit target percentage (default: 1.0)
  --leverage, -l <x>    Leverage multiplier (default: 10)
  --help, -h            Show this help message

Examples:
  node backtest/run.js --days 90
  node backtest/run.js --start 2025-01-01 --end 2025-06-01 --trades
  node backtest/run.js --interval 1h --profit 0.5
`)
}

async function main() {
  const args = process.argv.slice(2)
  const options = parseArgs(args)

  if (options.help) {
    showHelp()
    process.exit(0)
  }

  console.log('\n🔄 Bitcoin9to5 Backtester\n')

  // Determine date range
  let startDate, endDate

  if (options.startDate && options.endDate) {
    startDate = options.startDate
    endDate = options.endDate
  } else {
    endDate = new Date()
    startDate = new Date(endDate.getTime() - options.days * 24 * 60 * 60 * 1000)
  }

  // Build config
  const config = {
    ...DEFAULT_CONFIG,
    profitTargetPct: options.profitTarget,
    leverage: options.leverage
  }

  console.log('Configuration:')
  console.log(`  Period:        ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`)
  console.log(`  Interval:      ${options.interval}`)
  console.log(`  Profit Target: ${config.profitTargetPct}%`)
  console.log(`  Leverage:      ${config.leverage}x`)
  console.log(`  Short Zone:    ${config.shortZoneStart.hour}:${String(config.shortZoneStart.minute).padStart(2, '0')} - ${config.shortZoneEnd.hour}:${String(config.shortZoneEnd.minute).padStart(2, '0')} ET`)
  console.log('')

  // Load data
  const candles = await loadHistoricalData({
    symbol: 'BTCUSDT',
    interval: options.interval,
    startDate,
    endDate
  })

  if (candles.length === 0) {
    console.error('No data loaded!')
    process.exit(1)
  }

  console.log('')

  // Convert to backtester format
  const priceData = candlesToPricePoints(candles)

  // Run backtest
  console.log('Running backtest...\n')
  const result = runBacktest(priceData, config)

  // Show results
  console.log(formatResults(result))

  // Show individual trades if requested
  if (options.showTrades && result.trades.length > 0) {
    console.log('\n═══════════════════════════════════════════════════════════')
    console.log('                    INDIVIDUAL TRADES')
    console.log('═══════════════════════════════════════════════════════════\n')

    for (let i = 0; i < result.trades.length; i++) {
      const t = result.trades[i]
      const pnlSign = t.pnlPct >= 0 ? '+' : ''
      console.log(
        `#${String(i + 1).padStart(3)} ${t.side.toUpperCase().padEnd(5)} ` +
        `${t.entryTime.toISOString().slice(0, 16)} → ${t.exitTime.toISOString().slice(0, 16)} ` +
        `$${t.entryPrice.toFixed(0)} → $${t.exitPrice.toFixed(0)} ` +
        `${pnlSign}${t.pnlPct.toFixed(2)}% ` +
        `(${t.exitReason})`
      )
    }
    console.log('')
  }

  // Summary line
  const emoji = result.totalPnlPct >= 0 ? '✅' : '❌'
  console.log(`${emoji} Backtest complete: ${result.totalPnlPct >= 0 ? '+' : ''}${result.totalPnlPct.toFixed(2)}% over ${options.days || Math.round((endDate - startDate) / (24 * 60 * 60 * 1000))} days\n`)
}

main().catch(err => {
  console.error('Backtest error:', err)
  process.exit(1)
})
