#!/usr/bin/env node
/**
 * Parameter Optimizer - Find optimal strategy parameters via grid search
 *
 * Usage:
 *   node backtest/optimize.js --days 30
 *   node backtest/optimize.js --param profitTarget --range 0.5,2.0,0.25
 *   node backtest/optimize.js --param shortStart --range 8,11,0.5
 *   node backtest/optimize.js --multi  # Optimize multiple params together
 */

import { loadHistoricalData, candlesToPricePoints } from '../lib/data-loader.js'
import { runBacktest } from '../lib/backtester.js'
import { DEFAULT_CONFIG, DEFAULT_COSTS } from '../lib/strategy.js'

function parseArgs(args) {
  const options = {
    days: 30,
    startDate: null,
    endDate: null,
    interval: '5m',
    param: 'profitTarget', // Parameter to optimize
    range: null, // min,max,step
    multi: false, // Multi-parameter optimization
    metric: 'netPnl', // Metric to optimize: netPnl, sharpe, winRate
    top: 10, // Show top N results
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
      case '--param':
      case '-p':
        options.param = next
        i++
        break
      case '--range':
      case '-r':
        options.range = next.split(',').map(Number)
        i++
        break
      case '--multi':
      case '-m':
        options.multi = true
        break
      case '--metric':
        options.metric = next
        i++
        break
      case '--top':
        options.top = parseInt(next, 10)
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
Parameter Optimizer
===================

Find optimal strategy parameters using grid search over historical data.

Usage:
  node backtest/optimize.js [options]

Options:
  --days, -d <n>        Days of data to use (default: 30)
  --start, -s <date>    Start date (YYYY-MM-DD)
  --end, -e <date>      End date (YYYY-MM-DD)
  --interval, -i <int>  Candle interval (default: 5m)
  --param, -p <name>    Parameter to optimize (see below)
  --range, -r <vals>    Range as min,max,step (e.g., 0.5,2.0,0.25)
  --multi, -m           Multi-parameter optimization (predefined grid)
  --metric <name>       Metric to optimize: netPnl, sharpe, winRate (default: netPnl)
  --top <n>             Show top N results (default: 10)
  --help, -h            Show this help message

Parameters:
  profitTarget    Profit target percentage (default range: 0.5-2.0)
  shortStart      Short zone start hour ET (default range: 8-11)
  shortEnd        Short zone end hour ET (default range: 14-17)
  tpThreshold     TP zone hours threshold (default range: 4-10)
  trailingStop    Trailing stop percentage (default range: 0.25-1.0)
  leverage        Leverage multiplier (default range: 5-20)

Examples:
  node backtest/optimize.js --days 60 --param profitTarget
  node backtest/optimize.js --param shortStart --range 8,11,0.5
  node backtest/optimize.js --multi --days 90 --metric sharpe
`)
}

// Parameter definitions with default ranges
const PARAM_DEFS = {
  profitTarget: {
    key: 'profitTargetPct',
    range: [0.5, 2.0, 0.25],
    format: v => `${v.toFixed(2)}%`
  },
  shortStart: {
    key: 'shortZoneStart.hour',
    range: [8, 11, 0.5],
    format: v => `${Math.floor(v)}:${v % 1 === 0.5 ? '30' : '00'}`
  },
  shortEnd: {
    key: 'shortZoneEnd.hour',
    range: [14, 17, 0.5],
    format: v => `${Math.floor(v)}:${v % 1 === 0.5 ? '30' : '00'}`
  },
  tpThreshold: {
    key: 'tpZoneHoursThreshold',
    range: [4, 10, 1],
    format: v => `${v}h`
  },
  trailingStop: {
    key: 'tpZoneTrailingStopPct',
    range: [0.25, 1.0, 0.25],
    format: v => `${v.toFixed(2)}%`
  },
  leverage: {
    key: 'leverage',
    range: [5, 20, 5],
    format: v => `${v}x`
  }
}

function setNestedValue(obj, path, value) {
  const keys = path.split('.')
  let current = obj
  for (let i = 0; i < keys.length - 1; i++) {
    current = current[keys[i]]
  }
  current[keys[keys.length - 1]] = value
}

function generateRange(min, max, step) {
  const values = []
  for (let v = min; v <= max + 0.0001; v += step) {
    values.push(Math.round(v * 1000) / 1000) // Avoid floating point issues
  }
  return values
}

function runSingleParamOptimization(priceData, paramName, range, costs, metric) {
  const paramDef = PARAM_DEFS[paramName]
  if (!paramDef) {
    console.error(`Unknown parameter: ${paramName}`)
    console.log('Available:', Object.keys(PARAM_DEFS).join(', '))
    process.exit(1)
  }

  const [min, max, step] = range || paramDef.range
  const values = generateRange(min, max, step)

  console.log(`\nOptimizing ${paramName} from ${min} to ${max} (step ${step})`)
  console.log(`Testing ${values.length} values...\n`)

  const results = []

  for (const value of values) {
    const config = JSON.parse(JSON.stringify(DEFAULT_CONFIG))

    // Handle nested keys like shortZoneStart.hour
    if (paramDef.key.includes('.')) {
      setNestedValue(config, paramDef.key, value)
      // Also set minute based on fractional hour
      if (paramDef.key.endsWith('.hour')) {
        const minuteKey = paramDef.key.replace('.hour', '.minute')
        setNestedValue(config, minuteKey, value % 1 === 0.5 ? 30 : 0)
      }
    } else {
      config[paramDef.key] = value
    }

    const result = runBacktest(priceData, config, costs)

    results.push({
      value,
      formatted: paramDef.format(value),
      netPnl: result.netPnlPct,
      grossPnl: result.grossPnlPct,
      sharpe: result.sharpeRatio,
      winRate: result.winRate,
      maxDrawdown: result.maxDrawdownPct,
      trades: result.stats.totalTrades
    })

    process.stdout.write(`  ${paramDef.format(value).padEnd(10)} → Net: ${result.netPnlPct >= 0 ? '+' : ''}${result.netPnlPct.toFixed(2)}%\n`)
  }

  // Sort by chosen metric
  const sortKey = metric === 'sharpe' ? 'sharpe' : metric === 'winRate' ? 'winRate' : 'netPnl'
  results.sort((a, b) => b[sortKey] - a[sortKey])

  return results
}

function runMultiParamOptimization(priceData, costs, metric, topN) {
  // Define grid for multi-param optimization
  const grid = {
    profitTarget: [0.5, 0.75, 1.0, 1.25, 1.5],
    shortStartHour: [8, 9, 10],
    shortEndHour: [15, 16, 17],
    tpThreshold: [4, 6, 8]
  }

  const totalCombos = grid.profitTarget.length *
    grid.shortStartHour.length *
    grid.shortEndHour.length *
    grid.tpThreshold.length

  console.log(`\nMulti-parameter optimization`)
  console.log(`Testing ${totalCombos} combinations...\n`)

  const results = []
  let count = 0

  for (const pt of grid.profitTarget) {
    for (const ss of grid.shortStartHour) {
      for (const se of grid.shortEndHour) {
        for (const tp of grid.tpThreshold) {
          const config = {
            ...DEFAULT_CONFIG,
            profitTargetPct: pt,
            shortZoneStart: { hour: ss, minute: 29 },
            shortZoneEnd: { hour: se, minute: 1 },
            tpZoneHoursThreshold: tp
          }

          const result = runBacktest(priceData, config, costs)

          results.push({
            params: { profitTarget: pt, shortStart: ss, shortEnd: se, tpThreshold: tp },
            netPnl: result.netPnlPct,
            grossPnl: result.grossPnlPct,
            sharpe: result.sharpeRatio,
            winRate: result.winRate,
            maxDrawdown: result.maxDrawdownPct,
            trades: result.stats.totalTrades
          })

          count++
          if (count % 20 === 0) {
            process.stdout.write(`\r  Progress: ${count}/${totalCombos} (${(count / totalCombos * 100).toFixed(0)}%)`)
          }
        }
      }
    }
  }

  console.log(`\r  Completed ${totalCombos} combinations        \n`)

  // Sort by chosen metric
  const sortKey = metric === 'sharpe' ? 'sharpe' : metric === 'winRate' ? 'winRate' : 'netPnl'
  results.sort((a, b) => b[sortKey] - a[sortKey])

  return results
}

async function main() {
  const args = process.argv.slice(2)
  const options = parseArgs(args)

  if (options.help) {
    showHelp()
    process.exit(0)
  }

  console.log('\n🔍 Bitcoin9to5 Parameter Optimizer\n')

  // Determine date range
  let startDate, endDate
  if (options.startDate && options.endDate) {
    startDate = options.startDate
    endDate = options.endDate
  } else {
    endDate = new Date()
    startDate = new Date(endDate.getTime() - options.days * 24 * 60 * 60 * 1000)
  }

  console.log(`Period: ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`)
  console.log(`Metric: ${options.metric}`)

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

  const priceData = candlesToPricePoints(candles)
  console.log(`Loaded ${priceData.length} price points`)

  let results

  if (options.multi) {
    results = runMultiParamOptimization(priceData, DEFAULT_COSTS, options.metric, options.top)

    // Display top results
    console.log('\n═══════════════════════════════════════════════════════════')
    console.log(`                    TOP ${options.top} COMBINATIONS`)
    console.log('═══════════════════════════════════════════════════════════\n')

    console.log('Rank  Profit  Short Zone   TP-Hrs  Net PnL   Sharpe  Win%   DD%')
    console.log('────  ──────  ───────────  ──────  ────────  ──────  ─────  ────')

    for (let i = 0; i < Math.min(options.top, results.length); i++) {
      const r = results[i]
      const p = r.params
      console.log(
        `#${String(i + 1).padStart(2)}   ` +
        `${p.profitTarget.toFixed(1)}%   ` +
        `${p.shortStart}:29-${p.shortEnd}:01  ` +
        `${String(p.tpThreshold).padStart(2)}h     ` +
        `${r.netPnl >= 0 ? '+' : ''}${r.netPnl.toFixed(1).padStart(6)}%  ` +
        `${r.sharpe.toFixed(2).padStart(5)}   ` +
        `${r.winRate.toFixed(0).padStart(3)}%   ` +
        `${r.maxDrawdown.toFixed(1)}%`
      )
    }
  } else {
    results = runSingleParamOptimization(priceData, options.param, options.range, DEFAULT_COSTS, options.metric)

    // Display results
    console.log('\n═══════════════════════════════════════════════════════════')
    console.log(`                    OPTIMIZATION RESULTS`)
    console.log('═══════════════════════════════════════════════════════════\n')

    console.log(`Parameter: ${options.param}`)
    console.log(`Best value: ${results[0].formatted}`)
    console.log('')

    console.log('Value       Net PnL    Gross PnL   Sharpe   Win%   Trades')
    console.log('──────────  ─────────  ──────────  ──────   ─────  ──────')

    for (const r of results) {
      console.log(
        `${r.formatted.padEnd(10)}  ` +
        `${r.netPnl >= 0 ? '+' : ''}${r.netPnl.toFixed(2).padStart(7)}%  ` +
        `${r.grossPnl >= 0 ? '+' : ''}${r.grossPnl.toFixed(2).padStart(8)}%  ` +
        `${r.sharpe.toFixed(2).padStart(5)}   ` +
        `${r.winRate.toFixed(0).padStart(3)}%   ` +
        `${String(r.trades).padStart(4)}`
      )
    }
  }

  console.log('\n═══════════════════════════════════════════════════════════')
  console.log('✅ Optimization complete\n')
}

main().catch(err => {
  console.error('Optimizer error:', err)
  process.exit(1)
})
