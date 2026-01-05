/**
 * Pure trading strategy functions - no side effects, no API calls.
 * Used by both the live bot and backtester.
 */

// Default configuration
export const DEFAULT_CONFIG = {
  profitTargetPct: 1.0,
  tpZoneTrailingStopPct: 0.5,
  tpZoneHoursThreshold: 6,
  leverage: 10,
  shortZoneStart: { hour: 9, minute: 29 },
  shortZoneEnd: { hour: 16, minute: 1 }
}

/**
 * Nado fee structure (basis points)
 * Source: https://docs.nado.xyz
 *
 * Volume-based tiers - fees decrease as 30-day volume increases:
 * - Taker fees: 5 bps (base) down to 1.5 bps (highest tier)
 * - Maker rebates: 0 bps (base) up to -0.8 bps (highest tier)
 *
 * The bot uses IOC market orders = always taker
 */
export const NADO_FEE_TIERS = {
  // Tier name: { minVolume (USD), takerFeeBps, makerRebateBps }
  base:     { minVolume: 0,         takerFeeBps: 5.0,  makerRebateBps: 0 },
  tier1:    { minVolume: 100000,    takerFeeBps: 4.5,  makerRebateBps: -0.2 },
  tier2:    { minVolume: 500000,    takerFeeBps: 4.0,  makerRebateBps: -0.4 },
  tier3:    { minVolume: 1000000,   takerFeeBps: 3.5,  makerRebateBps: -0.5 },
  tier4:    { minVolume: 5000000,   takerFeeBps: 3.0,  makerRebateBps: -0.6 },
  tier5:    { minVolume: 10000000,  takerFeeBps: 2.5,  makerRebateBps: -0.7 },
  tier6:    { minVolume: 50000000,  takerFeeBps: 2.0,  makerRebateBps: -0.8 },
  tier7:    { minVolume: 100000000, takerFeeBps: 1.5,  makerRebateBps: -0.8 }
}

// Default cost configuration for backtesting
export const DEFAULT_COSTS = {
  // Trading fees (Nado base tier - conservative estimate)
  takerFeeBps: 5.0,           // 0.05% per trade (taker)
  makerRebateBps: 0,          // No rebate at base tier

  // Slippage estimate for market orders
  slippageBps: 5.0,           // 0.05% estimated slippage

  // Funding rate (paid/received every 8 hours for perps)
  // Positive = longs pay shorts, Negative = shorts pay longs
  avgFundingRateBps: 1.0,     // ~0.01% per 8h (typical in neutral markets)
  fundingIntervalHours: 8
}

// US market holidays
export const HOLIDAYS = new Set([
  '2025-12-25',
  '2026-01-01',
  '2026-01-19',
  '2026-02-16',
  '2026-04-03',
  '2026-05-25',
  '2026-06-19',
  '2026-07-06',
  '2026-09-07',
  '2026-11-26',
  '2026-12-25'
])

/**
 * Determine trading zone based on timestamp
 * @param {Date} date - The timestamp to check
 * @param {Object} config - Zone timing config
 * @returns {'long' | 'short'}
 */
export function getZone(date, config = DEFAULT_CONFIG) {
  const hour = date.getUTCHours() - 5 // Convert to ET (simplified, doesn't handle DST)
  const minute = date.getUTCMinutes()
  const dayOfWeek = date.getUTCDay() // 0 = Sunday, 6 = Saturday

  // Weekend = long
  if (dayOfWeek === 0 || dayOfWeek === 6) return 'long'

  // Holiday = long
  const dateStr = date.toISOString().split('T')[0]
  if (HOLIDAYS.has(dateStr)) return 'long'

  const { shortZoneStart, shortZoneEnd } = config
  const afterOpen = hour > shortZoneStart.hour ||
    (hour === shortZoneStart.hour && minute >= shortZoneStart.minute)
  const beforeClose = hour < shortZoneEnd.hour ||
    (hour === shortZoneEnd.hour && minute < shortZoneEnd.minute)

  return (afterOpen && beforeClose) ? 'short' : 'long'
}

/**
 * Calculate profit percentage for a position
 * @param {number} entryPrice
 * @param {number} currentPrice
 * @param {'long' | 'short'} side
 * @returns {number} Profit percentage (can be negative)
 */
export function calcProfitPct(entryPrice, currentPrice, side) {
  const priceDiff = side === 'short'
    ? entryPrice - currentPrice
    : currentPrice - entryPrice
  return (priceDiff / entryPrice) * 100
}

/**
 * Check if profit target has been hit
 * @param {number} entryPrice
 * @param {number} currentPrice
 * @param {'long' | 'short'} side
 * @param {number} targetPct
 * @returns {boolean}
 */
export function shouldTakeProfit(entryPrice, currentPrice, side, targetPct = DEFAULT_CONFIG.profitTargetPct) {
  const profitPct = calcProfitPct(entryPrice, currentPrice, side)
  return profitPct >= targetPct
}

/**
 * Check if should enter take-profit zone (longs only)
 * @param {'long' | 'short'} side
 * @param {number} hoursUntilShort
 * @param {number} threshold
 * @returns {boolean}
 */
export function shouldEnterTpZone(side, hoursUntilShort, threshold = DEFAULT_CONFIG.tpZoneHoursThreshold) {
  return side === 'long' && hoursUntilShort > threshold
}

/**
 * Check if should exit take-profit zone
 * @param {number} currentPrice
 * @param {number} entryPrice
 * @param {number} peakPrice
 * @param {number} trailingStopPct
 * @param {number} hoursUntilShort
 * @param {number} hoursThreshold
 * @returns {{ shouldExit: boolean, reason: string | null }}
 */
export function checkTpZoneExit(currentPrice, entryPrice, peakPrice, trailingStopPct, hoursUntilShort, hoursThreshold) {
  // Below entry - protect capital
  if (currentPrice < entryPrice) {
    return { shouldExit: true, reason: 'below-entry' }
  }

  // Trailing stop hit
  const dropFromPeak = ((peakPrice - currentPrice) / peakPrice) * 100
  if (dropFromPeak >= trailingStopPct) {
    return { shouldExit: true, reason: 'trailing-stop' }
  }

  // Time-based exit
  if (hoursUntilShort <= hoursThreshold) {
    return { shouldExit: true, reason: 'time-exit' }
  }

  return { shouldExit: false, reason: null }
}

/**
 * Calculate hours until next short zone
 * @param {Date} date - Current timestamp
 * @param {Object} config - Zone config
 * @returns {number}
 */
export function getHoursUntilShortZone(date, config = DEFAULT_CONFIG) {
  const etHour = date.getUTCHours() - 5 // Simplified ET conversion
  const etMinute = date.getUTCMinutes()
  const dayOfWeek = date.getUTCDay()

  const { shortZoneStart } = config
  const targetMinutes = shortZoneStart.hour * 60 + shortZoneStart.minute
  const currentMinutes = etHour * 60 + etMinute

  let hoursUntil = 0

  // If it's a weekday and before short zone start
  if (dayOfWeek >= 1 && dayOfWeek <= 5 && currentMinutes < targetMinutes) {
    hoursUntil = (targetMinutes - currentMinutes) / 60
  } else {
    // Calculate days until next weekday
    let daysUntil = 1
    let nextDay = (dayOfWeek + 1) % 7
    while (nextDay === 0 || nextDay === 6) {
      daysUntil++
      nextDay = (nextDay + 1) % 7
    }
    // Hours until end of day + hours into target day
    const hoursToMidnight = (24 * 60 - currentMinutes) / 60
    const hoursAfterMidnight = targetMinutes / 60
    hoursUntil = hoursToMidnight + (daysUntil - 1) * 24 + hoursAfterMidnight
  }

  return hoursUntil
}

/**
 * Calculate PnL from a trade (without costs)
 * @param {number} entryPrice
 * @param {number} exitPrice
 * @param {'long' | 'short'} side
 * @param {number} leverage
 * @returns {number} PnL percentage (leveraged)
 */
export function calcTradePnl(entryPrice, exitPrice, side, leverage = DEFAULT_CONFIG.leverage) {
  const pricePct = calcProfitPct(entryPrice, exitPrice, side)
  return pricePct * leverage
}

/**
 * Calculate trading costs for a round-trip trade
 * @param {number} notionalValue - Position size in USD
 * @param {number} durationHours - How long position was held
 * @param {'long' | 'short'} side - Position side (affects funding)
 * @param {Object} costs - Cost configuration
 * @returns {{ totalCostPct: number, breakdown: Object }}
 */
export function calcTradingCosts(notionalValue, durationHours, side, costs = DEFAULT_COSTS) {
  // Entry + exit fees (both are taker orders)
  const entryFeePct = costs.takerFeeBps / 100
  const exitFeePct = costs.takerFeeBps / 100
  const totalFeesPct = entryFeePct + exitFeePct

  // Slippage on entry + exit
  const entrySlippagePct = costs.slippageBps / 100
  const exitSlippagePct = costs.slippageBps / 100
  const totalSlippagePct = entrySlippagePct + exitSlippagePct

  // Funding payments (every 8 hours)
  // Positive funding = longs pay shorts
  const fundingPeriods = Math.floor(durationHours / costs.fundingIntervalHours)
  const fundingPerPeriodPct = costs.avgFundingRateBps / 100
  // Longs pay when funding is positive, shorts receive
  const fundingMultiplier = side === 'long' ? 1 : -1
  const totalFundingPct = fundingPeriods * fundingPerPeriodPct * fundingMultiplier

  const totalCostPct = totalFeesPct + totalSlippagePct + totalFundingPct

  return {
    totalCostPct,
    breakdown: {
      feesPct: totalFeesPct,
      slippagePct: totalSlippagePct,
      fundingPct: totalFundingPct,
      fundingPeriods
    }
  }
}

/**
 * Calculate net PnL after all costs
 * @param {number} entryPrice
 * @param {number} exitPrice
 * @param {'long' | 'short'} side
 * @param {number} leverage
 * @param {number} durationHours
 * @param {Object} costs
 * @returns {{ grossPnlPct: number, netPnlPct: number, costs: Object }}
 */
export function calcNetPnl(entryPrice, exitPrice, side, leverage, durationHours, costs = DEFAULT_COSTS) {
  const grossPnlPct = calcTradePnl(entryPrice, exitPrice, side, leverage)

  // Costs are applied to notional value, then multiplied by leverage for equity impact
  const notionalValue = 1 // Normalized
  const { totalCostPct, breakdown } = calcTradingCosts(notionalValue, durationHours, side, costs)

  // Costs reduce PnL (leverage amplifies the cost impact on equity)
  const leveragedCostPct = totalCostPct * leverage
  const netPnlPct = grossPnlPct - leveragedCostPct

  return {
    grossPnlPct,
    netPnlPct,
    costs: {
      ...breakdown,
      totalCostPct,
      leveragedCostPct
    }
  }
}
