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
import { DEFAULT_CONFIG, DEFAULT_COSTS, NADO_FEE_TIERS } from '../lib/strategy.js'

function parseArgs(args) {
  const options = {
    days: 30,
    startDate: null,
    endDate: null,
    interval: '5m',
    showTrades: false,
    profitTarget: DEFAULT_CONFIG.profitTargetPct,
    leverage: DEFAULT_CONFIG.leverage,
    // Cost options
    takerFee: DEFAULT_COSTS.takerFeeBps,
    slippage: DEFAULT_COSTS.slippageBps,
    funding: DEFAULT_COSTS.avgFundingRateBps,
    feeTier: null, // Use specific Nado tier
    noCosts: false, // Disable all costs
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
      case '--taker-fee':
        options.takerFee = parseFloat(next)
        i++
        break
      case '--slippage':
        options.slippage = parseFloat(next)
        i++
        break
      case '--funding':
        options.funding = parseFloat(next)
        i++
        break
      case '--fee-tier':
        options.feeTier = next
        i++
        break
      case '--no-costs':
        options.noCosts = true
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

Cost Options:
  --taker-fee <bps>     Taker fee in basis points (default: 5.0)
  --slippage <bps>      Slippage in basis points (default: 5.0)
  --funding <bps>       Avg funding rate per 8h in bps (default: 1.0)
  --fee-tier <tier>     Use Nado fee tier: base, tier1-tier7 (overrides --taker-fee)
  --no-costs            Disable all trading costs (fees, slippage, funding)

Nado Fee Tiers:
  base   - 5.0 bps taker (default, $0-100k volume)
  tier1  - 4.5 bps ($100k+ volume)
  tier2  - 4.0 bps ($500k+ volume)
  tier3  - 3.5 bps ($1M+ volume)
  tier4  - 3.0 bps ($5M+ volume)
  tier5  - 2.5 bps ($10M+ volume)
  tier6  - 2.0 bps ($50M+ volume)
  tier7  - 1.5 bps ($100M+ volume)

Examples:
  node backtest/run.js --days 90
  node backtest/run.js --start 2025-01-01 --end 2025-06-01 --trades
  node backtest/run.js --interval 1h --profit 0.5
  node backtest/run.js --fee-tier tier3 --slippage 3
  node backtest/run.js --no-costs  # Compare gross vs net
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

  // Build costs
  let costs
  if (options.noCosts) {
    costs = {
      takerFeeBps: 0,
      makerRebateBps: 0,
      slippageBps: 0,
      avgFundingRateBps: 0,
      fundingIntervalHours: 8
    }
  } else {
    // Use fee tier if specified
    let takerFee = options.takerFee
    if (options.feeTier && NADO_FEE_TIERS[options.feeTier]) {
      takerFee = NADO_FEE_TIERS[options.feeTier].takerFeeBps
    }

    costs = {
      ...DEFAULT_COSTS,
      takerFeeBps: takerFee,
      slippageBps: options.slippage,
      avgFundingRateBps: options.funding
    }
  }

  console.log('Configuration:')
  console.log(`  Period:        ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`)
  console.log(`  Interval:      ${options.interval}`)
  console.log(`  Profit Target: ${config.profitTargetPct}%`)
  console.log(`  Leverage:      ${config.leverage}x`)
  console.log(`  Short Zone:    ${config.shortZoneStart.hour}:${String(config.shortZoneStart.minute).padStart(2, '0')} - ${config.shortZoneEnd.hour}:${String(config.shortZoneEnd.minute).padStart(2, '0')} ET`)
  console.log('')
  console.log('Costs:')
  if (options.noCosts) {
    console.log('  (disabled)')
  } else {
    console.log(`  Taker Fee:     ${costs.takerFeeBps} bps${options.feeTier ? ` (${options.feeTier})` : ''}`)
    console.log(`  Slippage:      ${costs.slippageBps} bps`)
    console.log(`  Funding Rate:  ${costs.avgFundingRateBps} bps/8h`)
  }
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
  const result = runBacktest(priceData, config, costs)

  // Show results
  console.log(formatResults(result))

  // Show individual trades if requested
  if (options.showTrades && result.trades.length > 0) {
    console.log('\n═══════════════════════════════════════════════════════════')
    console.log('                    INDIVIDUAL TRADES')
    console.log('═══════════════════════════════════════════════════════════\n')

    for (let i = 0; i < result.trades.length; i++) {
      const t = result.trades[i]
      const netSign = t.netPnlPct >= 0 ? '+' : ''
      console.log(
        `#${String(i + 1).padStart(3)} ${t.side.toUpperCase().padEnd(5)} ` +
        `${t.entryTime.toISOString().slice(0, 16)} → ${t.exitTime.toISOString().slice(0, 16)} ` +
        `$${t.entryPrice.toFixed(0)} → $${t.exitPrice.toFixed(0)} ` +
        `${netSign}${t.netPnlPct.toFixed(2)}% ` +
        `(${t.exitReason})`
      )
    }
    console.log('')
  }

  // Summary line
  const emoji = result.netPnlPct >= 0 ? '✅' : '❌'
  console.log(`${emoji} Backtest complete: ${result.netPnlPct >= 0 ? '+' : ''}${result.netPnlPct.toFixed(2)}% net over ${options.days || Math.round((endDate - startDate) / (24 * 60 * 60 * 1000))} days\n`)
}

main().catch(err => {
  console.error('Backtest error:', err)
  process.exit(1)
})
