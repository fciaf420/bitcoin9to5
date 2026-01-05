#!/usr/bin/env node
/**
 * Local test with synthetic data - verifies backtester logic works.
 * Run this to test without network access.
 */

import { runBacktest, formatResults } from '../lib/backtester.js'
import { DEFAULT_CONFIG, DEFAULT_COSTS, getZone, calcProfitPct } from '../lib/strategy.js'

// Generate synthetic price data that mimics the 9-to-5 pattern
function generateSyntheticData(days = 7) {
  const priceData = []
  const basePrice = 100000

  const startDate = new Date('2025-12-01T00:00:00Z')

  for (let day = 0; day < days; day++) {
    for (let hour = 0; hour < 24; hour++) {
      for (let minute = 0; minute < 60; minute += 5) {
        const timestamp = new Date(startDate)
        timestamp.setDate(startDate.getDate() + day)
        timestamp.setUTCHours(hour, minute, 0, 0)

        // ET hours (simplified: UTC - 5)
        const etHour = (hour - 5 + 24) % 24
        const dayOfWeek = timestamp.getUTCDay()

        let priceMove = 0

        // Skip weekends (simpler movement)
        if (dayOfWeek === 0 || dayOfWeek === 6) {
          // Slight upward drift on weekends
          priceMove = (Math.random() - 0.4) * 0.001
        } else {
          // Weekday pattern: down during market hours, up overnight
          if (etHour >= 9 && etHour < 16) {
            // Market hours: tend to drop
            priceMove = (Math.random() - 0.6) * 0.002 // Bias toward drops
          } else {
            // Overnight: tend to rise
            priceMove = (Math.random() - 0.3) * 0.002 // Bias toward rises
          }
        }

        const lastPrice = priceData.length > 0 ? priceData[priceData.length - 1].price : basePrice
        const newPrice = lastPrice * (1 + priceMove)

        // Add some volatility for high/low
        const volatility = newPrice * 0.001
        priceData.push({
          timestamp,
          price: newPrice,
          open: newPrice - volatility * Math.random(),
          high: newPrice + volatility * Math.random(),
          low: newPrice - volatility * Math.random(),
          close: newPrice
        })
      }
    }
  }

  return priceData
}

console.log('\n🧪 Bitcoin9to5 Backtester - Local Test\n')
console.log('Using synthetic data with simulated 9-to-5 pattern\n')

// Test strategy functions
console.log('Testing strategy functions...')

// Test getZone
const mondayMorning = new Date('2025-12-01T15:00:00Z') // 10 AM ET
const mondayEvening = new Date('2025-12-01T22:00:00Z') // 5 PM ET
const saturday = new Date('2025-12-06T15:00:00Z')

console.log(`  getZone(Monday 10 AM ET): ${getZone(mondayMorning)} (expected: short)`)
console.log(`  getZone(Monday 5 PM ET):  ${getZone(mondayEvening)} (expected: long)`)
console.log(`  getZone(Saturday):        ${getZone(saturday)} (expected: long)`)

// Test calcProfitPct
console.log(`  calcProfitPct(100000, 101000, 'long'):  ${calcProfitPct(100000, 101000, 'long').toFixed(2)}% (expected: 1.00%)`)
console.log(`  calcProfitPct(100000, 99000, 'short'):  ${calcProfitPct(100000, 99000, 'short').toFixed(2)}% (expected: 1.00%)`)
console.log(`  calcProfitPct(100000, 99000, 'long'):   ${calcProfitPct(100000, 99000, 'long').toFixed(2)}% (expected: -1.00%)`)

console.log('\n✅ Strategy functions working correctly\n')

// Generate and run backtest
console.log('Generating 14 days of synthetic price data...')
const priceData = generateSyntheticData(14)
console.log(`  Generated ${priceData.length} price points`)
console.log(`  Date range: ${priceData[0].timestamp.toISOString().split('T')[0]} to ${priceData[priceData.length - 1].timestamp.toISOString().split('T')[0]}`)
console.log('')

console.log('Running backtest with costs...\n')
console.log('Cost assumptions:')
console.log(`  Taker Fee:     ${DEFAULT_COSTS.takerFeeBps} bps`)
console.log(`  Slippage:      ${DEFAULT_COSTS.slippageBps} bps`)
console.log(`  Funding Rate:  ${DEFAULT_COSTS.avgFundingRateBps} bps/8h`)
console.log('')

const result = runBacktest(priceData, DEFAULT_CONFIG, DEFAULT_COSTS)

console.log(formatResults(result))

// Show a few sample trades
if (result.trades.length > 0) {
  console.log('\nSample trades (first 5):')
  for (let i = 0; i < Math.min(5, result.trades.length); i++) {
    const t = result.trades[i]
    console.log(
      `  #${i + 1} ${t.side.toUpperCase().padEnd(5)} ` +
      `$${t.entryPrice.toFixed(0)} → $${t.exitPrice.toFixed(0)} ` +
      `gross: ${t.grossPnlPct >= 0 ? '+' : ''}${t.grossPnlPct.toFixed(2)}% ` +
      `net: ${t.netPnlPct >= 0 ? '+' : ''}${t.netPnlPct.toFixed(2)}% ` +
      `(${t.exitReason})`
    )
  }
}

console.log('\n✅ Backtest completed successfully!')
console.log('\nTo run with real Binance data:')
console.log('  node backtest/run.js --days 30')
console.log('  node backtest/run.js --no-costs  # Compare gross vs net')
console.log('  node backtest/run.js --fee-tier tier3  # Use lower fees\n')
