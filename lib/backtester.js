/**
 * Backtester engine - simulates trading strategy on historical data.
 */

import {
  DEFAULT_CONFIG,
  DEFAULT_COSTS,
  getZone,
  calcProfitPct,
  shouldTakeProfit,
  shouldEnterTpZone,
  checkTpZoneExit,
  getHoursUntilShortZone,
  calcTradePnl,
  calcNetPnl
} from './strategy.js'

/**
 * @typedef {Object} Trade
 * @property {Date} entryTime
 * @property {Date} exitTime
 * @property {number} entryPrice
 * @property {number} exitPrice
 * @property {'long' | 'short'} side
 * @property {string} exitReason
 * @property {number} grossPnlPct - PnL before costs
 * @property {number} netPnlPct - PnL after fees, slippage, funding
 * @property {number} durationHours
 * @property {Object} costs - Breakdown of trading costs
 */

/**
 * @typedef {Object} BacktestResult
 * @property {Trade[]} trades
 * @property {number} totalPnlPct
 * @property {number} winRate
 * @property {number} maxDrawdownPct
 * @property {number} sharpeRatio
 * @property {Object} stats
 */

/**
 * Run backtest on historical price data
 * @param {Array} priceData - Array of { timestamp, price, high, low }
 * @param {Object} config - Strategy configuration
 * @param {Object} costs - Trading costs configuration (fees, slippage, funding)
 * @returns {BacktestResult}
 */
export function runBacktest(priceData, config = DEFAULT_CONFIG, costs = DEFAULT_COSTS) {
  const trades = []
  let position = null // { side, entryPrice, entryTime, inTpZone, peakPrice }
  let previousZone = null
  let equity = 100 // Start with 100% equity
  let peakEquity = 100
  let maxDrawdown = 0
  let totalCosts = { fees: 0, slippage: 0, funding: 0 }

  for (let i = 0; i < priceData.length; i++) {
    const candle = priceData[i]
    const { timestamp, price, high, low } = candle
    const currentZone = getZone(timestamp, config)

    // Zone flip - close current position and open new one
    if (previousZone !== null && currentZone !== previousZone) {
      // Close existing position
      if (position) {
        const trade = closeTrade(position, price, timestamp, 'zone-flip', config, costs)
        trades.push(trade)
        equity += trade.netPnlPct
        totalCosts.fees += trade.costs.feesPct * config.leverage
        totalCosts.slippage += trade.costs.slippagePct * config.leverage
        totalCosts.funding += trade.costs.fundingPct * config.leverage
        position = null
      }

      // Open new position in the direction of the new zone
      position = {
        side: currentZone,
        entryPrice: price,
        entryTime: timestamp,
        inTpZone: false,
        peakPrice: null
      }
    }

    // Check profit/loss for open position
    if (position) {
      const profitPct = calcProfitPct(position.entryPrice, price, position.side)

      // Check if using high/low for more realistic simulation
      const worstPrice = position.side === 'long' ? low : high
      const bestPrice = position.side === 'long' ? high : low
      const worstProfitPct = calcProfitPct(position.entryPrice, worstPrice, position.side)
      const bestProfitPct = calcProfitPct(position.entryPrice, bestPrice, position.side)

      // Handle take-profit zone for longs
      if (position.side === 'long' && position.inTpZone) {
        // Update peak
        if (high > position.peakPrice) {
          position.peakPrice = high
        }

        const hoursUntilShort = getHoursUntilShortZone(timestamp, config)
        const exitCheck = checkTpZoneExit(
          low, // Use low for worst case
          position.entryPrice,
          position.peakPrice,
          config.tpZoneTrailingStopPct,
          hoursUntilShort,
          config.tpZoneHoursThreshold
        )

        if (exitCheck.shouldExit) {
          // Estimate exit price based on reason
          let exitPrice = price
          if (exitCheck.reason === 'trailing-stop') {
            exitPrice = position.peakPrice * (1 - config.tpZoneTrailingStopPct / 100)
          } else if (exitCheck.reason === 'below-entry') {
            exitPrice = position.entryPrice * 0.999 // Slight slippage below entry
          }

          const trade = closeTrade(position, exitPrice, timestamp, `tp-${exitCheck.reason}`, config, costs)
          trades.push(trade)
          equity += trade.netPnlPct
          totalCosts.fees += trade.costs.feesPct * config.leverage
          totalCosts.slippage += trade.costs.slippagePct * config.leverage
          totalCosts.funding += trade.costs.fundingPct * config.leverage
          position = null
        }
      }
      // Check regular profit target
      else if (bestProfitPct >= config.profitTargetPct) {
        const targetPrice = position.side === 'long'
          ? position.entryPrice * (1 + config.profitTargetPct / 100)
          : position.entryPrice * (1 - config.profitTargetPct / 100)

        if (position.side === 'long') {
          const hoursUntilShort = getHoursUntilShortZone(timestamp, config)
          if (shouldEnterTpZone(position.side, hoursUntilShort, config.tpZoneHoursThreshold)) {
            // Enter TP zone instead of closing
            position.inTpZone = true
            position.peakPrice = bestPrice
          } else {
            // Close immediately
            const trade = closeTrade(position, targetPrice, timestamp, 'profit-target', config, costs)
            trades.push(trade)
            equity += trade.netPnlPct
            totalCosts.fees += trade.costs.feesPct * config.leverage
            totalCosts.slippage += trade.costs.slippagePct * config.leverage
            totalCosts.funding += trade.costs.fundingPct * config.leverage
            position = null
          }
        } else {
          // Shorts always close at profit target
          const trade = closeTrade(position, targetPrice, timestamp, 'profit-target', config, costs)
          trades.push(trade)
          equity += trade.netPnlPct
          totalCosts.fees += trade.costs.feesPct * config.leverage
          totalCosts.slippage += trade.costs.slippagePct * config.leverage
          totalCosts.funding += trade.costs.fundingPct * config.leverage
          position = null
        }
      }
    }

    // Track drawdown
    if (equity > peakEquity) {
      peakEquity = equity
    }
    const drawdown = ((peakEquity - equity) / peakEquity) * 100
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown
    }

    previousZone = currentZone
  }

  // Close any remaining position at end
  if (position && priceData.length > 0) {
    const lastCandle = priceData[priceData.length - 1]
    const trade = closeTrade(position, lastCandle.price, lastCandle.timestamp, 'backtest-end', config, costs)
    trades.push(trade)
    equity += trade.netPnlPct
    totalCosts.fees += trade.costs.feesPct * config.leverage
    totalCosts.slippage += trade.costs.slippagePct * config.leverage
    totalCosts.funding += trade.costs.fundingPct * config.leverage
  }

  return calculateStats(trades, equity, maxDrawdown, config, costs, totalCosts)
}

/**
 * Close a trade and calculate PnL with costs
 * @param {Object} position
 * @param {number} exitPrice
 * @param {Date} exitTime
 * @param {string} reason
 * @param {Object} config
 * @param {Object} costs
 * @returns {Trade}
 */
function closeTrade(position, exitPrice, exitTime, reason, config, costs) {
  const durationHours = (exitTime - position.entryTime) / (1000 * 60 * 60)

  const { grossPnlPct, netPnlPct, costs: costBreakdown } = calcNetPnl(
    position.entryPrice,
    exitPrice,
    position.side,
    config.leverage,
    durationHours,
    costs
  )

  return {
    entryTime: position.entryTime,
    exitTime,
    entryPrice: position.entryPrice,
    exitPrice,
    side: position.side,
    exitReason: reason,
    grossPnlPct,
    netPnlPct,
    durationHours,
    costs: costBreakdown
  }
}

/**
 * Calculate aggregate statistics
 * @param {Trade[]} trades
 * @param {number} finalEquity
 * @param {number} maxDrawdown
 * @param {Object} config
 * @param {Object} costs
 * @param {Object} totalCosts
 * @returns {BacktestResult}
 */
function calculateStats(trades, finalEquity, maxDrawdown, config, costs, totalCosts) {
  const winningTrades = trades.filter(t => t.netPnlPct > 0)
  const losingTrades = trades.filter(t => t.netPnlPct <= 0)

  const longTrades = trades.filter(t => t.side === 'long')
  const shortTrades = trades.filter(t => t.side === 'short')

  const netPnlPct = finalEquity - 100
  const grossPnlPct = trades.reduce((a, t) => a + t.grossPnlPct, 0)

  // Calculate Sharpe ratio (simplified - using trade returns)
  const returns = trades.map(t => t.netPnlPct)
  const avgReturn = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0
  const stdDev = returns.length > 1
    ? Math.sqrt(returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / (returns.length - 1))
    : 0
  const sharpeRatio = stdDev > 0 ? (avgReturn / stdDev) * Math.sqrt(252) : 0

  // Group by exit reason
  const byReason = {}
  for (const trade of trades) {
    if (!byReason[trade.exitReason]) {
      byReason[trade.exitReason] = { count: 0, grossPnl: 0, netPnl: 0 }
    }
    byReason[trade.exitReason].count++
    byReason[trade.exitReason].grossPnl += trade.grossPnlPct
    byReason[trade.exitReason].netPnl += trade.netPnlPct
  }

  return {
    trades,
    grossPnlPct,
    netPnlPct,
    totalPnlPct: netPnlPct, // Alias for backwards compatibility
    winRate: trades.length > 0 ? (winningTrades.length / trades.length) * 100 : 0,
    maxDrawdownPct: maxDrawdown,
    sharpeRatio,
    stats: {
      totalTrades: trades.length,
      winningTrades: winningTrades.length,
      losingTrades: losingTrades.length,
      avgWin: winningTrades.length > 0
        ? winningTrades.reduce((a, t) => a + t.netPnlPct, 0) / winningTrades.length
        : 0,
      avgLoss: losingTrades.length > 0
        ? losingTrades.reduce((a, t) => a + t.netPnlPct, 0) / losingTrades.length
        : 0,
      avgTradeDuration: trades.length > 0
        ? trades.reduce((a, t) => a + t.durationHours, 0) / trades.length
        : 0,
      longStats: {
        count: longTrades.length,
        winRate: longTrades.length > 0
          ? (longTrades.filter(t => t.netPnlPct > 0).length / longTrades.length) * 100
          : 0,
        grossPnl: longTrades.reduce((a, t) => a + t.grossPnlPct, 0),
        netPnl: longTrades.reduce((a, t) => a + t.netPnlPct, 0)
      },
      shortStats: {
        count: shortTrades.length,
        winRate: shortTrades.length > 0
          ? (shortTrades.filter(t => t.netPnlPct > 0).length / shortTrades.length) * 100
          : 0,
        grossPnl: shortTrades.reduce((a, t) => a + t.grossPnlPct, 0),
        netPnl: shortTrades.reduce((a, t) => a + t.netPnlPct, 0)
      },
      byExitReason: byReason,
      totalCosts,
      costs,
      config
    }
  }
}

/**
 * Format backtest results for display
 * @param {BacktestResult} result
 * @returns {string}
 */
export function formatResults(result) {
  const { stats } = result
  const totalCostsPct = stats.totalCosts.fees + stats.totalCosts.slippage + stats.totalCosts.funding

  const lines = [
    '═══════════════════════════════════════════════════════════',
    '                    BACKTEST RESULTS',
    '═══════════════════════════════════════════════════════════',
    '',
    `Gross PnL:          ${result.grossPnlPct >= 0 ? '+' : ''}${result.grossPnlPct.toFixed(2)}%`,
    `Net PnL:            ${result.netPnlPct >= 0 ? '+' : ''}${result.netPnlPct.toFixed(2)}%`,
    `Win Rate:           ${result.winRate.toFixed(1)}%`,
    `Max Drawdown:       ${result.maxDrawdownPct.toFixed(2)}%`,
    `Sharpe Ratio:       ${result.sharpeRatio.toFixed(2)}`,
    '',
    '───────────────────────────────────────────────────────────',
    '                    TRADING COSTS',
    '───────────────────────────────────────────────────────────',
    '',
    `Total Costs:        -${totalCostsPct.toFixed(2)}%`,
    `  Fees:             -${stats.totalCosts.fees.toFixed(2)}% (${stats.costs.takerFeeBps} bps/trade)`,
    `  Slippage:         -${stats.totalCosts.slippage.toFixed(2)}% (${stats.costs.slippageBps} bps/trade)`,
    `  Funding:          ${stats.totalCosts.funding >= 0 ? '-' : '+'}${Math.abs(stats.totalCosts.funding).toFixed(2)}%`,
    '',
    '───────────────────────────────────────────────────────────',
    '                      TRADE STATS',
    '───────────────────────────────────────────────────────────',
    '',
    `Total Trades:       ${stats.totalTrades}`,
    `  Winners:          ${stats.winningTrades} (${result.winRate.toFixed(1)}%)`,
    `  Losers:           ${stats.losingTrades}`,
    `Avg Win:            +${stats.avgWin.toFixed(2)}%`,
    `Avg Loss:           ${stats.avgLoss.toFixed(2)}%`,
    `Avg Duration:       ${stats.avgTradeDuration.toFixed(1)} hours`,
    '',
    '───────────────────────────────────────────────────────────',
    '                    LONG vs SHORT',
    '───────────────────────────────────────────────────────────',
    '',
    `Long Trades:        ${stats.longStats.count} (${stats.longStats.winRate.toFixed(1)}% win)`,
    `  Gross PnL:        ${stats.longStats.grossPnl >= 0 ? '+' : ''}${stats.longStats.grossPnl.toFixed(2)}%`,
    `  Net PnL:          ${stats.longStats.netPnl >= 0 ? '+' : ''}${stats.longStats.netPnl.toFixed(2)}%`,
    `Short Trades:       ${stats.shortStats.count} (${stats.shortStats.winRate.toFixed(1)}% win)`,
    `  Gross PnL:        ${stats.shortStats.grossPnl >= 0 ? '+' : ''}${stats.shortStats.grossPnl.toFixed(2)}%`,
    `  Net PnL:          ${stats.shortStats.netPnl >= 0 ? '+' : ''}${stats.shortStats.netPnl.toFixed(2)}%`,
    '',
    '───────────────────────────────────────────────────────────',
    '                    EXIT REASONS',
    '───────────────────────────────────────────────────────────',
    ''
  ]

  for (const [reason, data] of Object.entries(stats.byExitReason)) {
    lines.push(`${reason.padEnd(20)} ${String(data.count).padStart(4)} trades  ${data.netPnl >= 0 ? '+' : ''}${data.netPnl.toFixed(2)}%`)
  }

  lines.push('')
  lines.push('═══════════════════════════════════════════════════════════')

  return lines.join('\n')
}

export default { runBacktest, formatResults }
