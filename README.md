# bitcoin9to5

BTC perpetual futures trading bot for Nado exchange.

**Premise:** BTC tends to drop during US market hours and rise overnight. The bot exploits this by shorting 9-to-5 and going long the rest of the time.

## Quick Start

```bash
npm install
npm run wizard   # Interactive setup guide
```

## Strategy

**Zones:**
- **Short zone**: 9:29 AM - 4:01 PM ET weekdays
- **Long zone**: Overnight, weekends, and holidays

At each zone change, the bot flips direction—closing any existing position and opening a new one in the zone's direction.

**Profit-taking:** When price moves 1% in your favor, the bot closes for profit (~10% gain at 10x leverage).

**Take-profit zone (longs only):** When a long hits the profit target with 6+ hours until short zone, the bot enters a "TP zone" instead of closing immediately:
- Tracks the peak price since entering TP zone
- Closes if price drops 0.5% from peak (trailing stop)
- Closes if price falls below original entry
- Closes when 6 hours from short zone (time-based exit)

## Commands

```bash
# Interactive wizard (recommended for new users)
npm run wizard

# Run the bot
PRIVATE_KEY="0x..." node bot.js
node bot.js --close              # Close any open position

# Backtesting
npm run backtest                 # 30-day backtest with Binance data
npm run backtest -- --days 90    # 90-day backtest
npm run backtest -- --trades     # Show individual trades
npm run backtest -- --no-costs   # Compare gross vs net PnL

# Parameter optimization
npm run optimize                 # Optimize profit target
npm run optimize -- --multi      # Full grid search
npm run optimize -- --param shortStart  # Optimize zone times

# Local test (no network required)
npm test
```

## Backtesting

The backtester uses historical data from Binance Futures to simulate strategy performance.

```bash
node backtest/run.js --help
```

**Options:**
- `--days <n>` - Days of history (default: 30)
- `--start <date>` - Start date (YYYY-MM-DD)
- `--end <date>` - End date (YYYY-MM-DD)
- `--interval <int>` - Candle interval: 1m, 5m, 15m, 1h, 4h
- `--trades` - Show individual trade details
- `--profit <pct>` - Profit target percentage
- `--leverage <x>` - Leverage multiplier

**Cost Options:**
- `--taker-fee <bps>` - Taker fee in basis points (default: 5.0)
- `--slippage <bps>` - Slippage estimate (default: 5.0)
- `--funding <bps>` - Avg funding rate per 8h (default: 1.0)
- `--fee-tier <tier>` - Use Nado fee tier: base, tier1-tier7
- `--no-costs` - Disable all trading costs

**Example output:**
```
═══════════════════════════════════════════════════════════
                    BACKTEST RESULTS
═══════════════════════════════════════════════════════════

Gross PnL:          +45.23%
Net PnL:            +38.67%
Win Rate:           72.5%
Max Drawdown:       8.34%
Sharpe Ratio:       1.85

───────────────────────────────────────────────────────────
                   KELLY CRITERION
───────────────────────────────────────────────────────────

Win/Loss Ratio:     2.15
Edge per Trade:     +4.23%
Half Kelly:         18.5% (recommended)
```

## Parameter Optimization

Find optimal strategy parameters via grid search:

```bash
# Optimize profit target (0.5% to 2.0%)
node backtest/optimize.js --param profitTarget

# Optimize short zone start time
node backtest/optimize.js --param shortStart --range 8,11,0.5

# Full multi-parameter optimization
node backtest/optimize.js --multi --days 90

# Optimize for Sharpe ratio instead of PnL
node backtest/optimize.js --metric sharpe
```

## Trading Costs

The backtester models realistic trading costs:

| Cost Type | Default | Description |
|-----------|---------|-------------|
| Taker Fee | 5.0 bps | Nado base tier (0.05%) |
| Slippage | 5.0 bps | Market order slippage |
| Funding | 1.0 bps/8h | Perpetual funding rate |

**Nado Fee Tiers:**
| Tier | 30-Day Volume | Taker Fee |
|------|---------------|-----------|
| base | $0-100k | 5.0 bps |
| tier1 | $100k+ | 4.5 bps |
| tier2 | $500k+ | 4.0 bps |
| tier3 | $1M+ | 3.5 bps |
| tier4 | $5M+ | 3.0 bps |
| tier5 | $10M+ | 2.5 bps |
| tier6 | $50M+ | 2.0 bps |
| tier7 | $100M+ | 1.5 bps |

## Kelly Criterion

Backtest results include Kelly Criterion analysis for optimal position sizing:

- **Full Kelly** - Theoretical optimal bet size
- **Half Kelly** - Recommended for real trading (safer)
- **Quarter Kelly** - Conservative approach

The Kelly formula: `K = W - [(1-W) / R]` where W = win rate, R = win/loss ratio.

## Configuration

Edit `bot.js` or use the wizard to adjust:
- `TARGET_LEVERAGE` - Leverage multiplier (default: 10)
- `PROFIT_TARGET_PCT` - Price move % to take profit (default: 1.0)
- `TP_ZONE_TRAILING_STOP_PCT` - Trailing stop % for TP zone (default: 0.5)
- `TP_ZONE_HOURS_THRESHOLD` - Hours before short zone to enter/exit TP zone (default: 6)

## Adaptive Learning

The bot learns optimal zone transition times from price data:
- Collects prices every 5 min during transition windows
- Finds the time with the biggest drop (morning) or rise (evening)
- Auto-reschedules daily at 6 PM ET
- State files: `.market-data.json`, `.zone-config.json`

## Requirements

- Node.js 18+
- Ethereum wallet with private key
- Collateral deposited on [Nado](https://nado.xyz)

## Project Structure

```
bitcoin9to5/
├── bot.js              # Main trading bot
├── lib/
│   ├── strategy.js     # Pure trading logic & Kelly math
│   ├── backtester.js   # Backtest simulation engine
│   └── data-loader.js  # Binance historical data fetcher
├── backtest/
│   ├── run.js          # Backtest CLI
│   ├── optimize.js     # Parameter optimizer
│   └── test-local.js   # Local test with synthetic data
├── scripts/
│   └── wizard.js       # Interactive setup TUI
└── .bot-state.json     # Runtime state (gitignored)
```

## License

MIT
