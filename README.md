# LastTick

Trading bot and analytics platform for Polymarket prediction markets. Implements the "endgame arbitrage" strategy - capturing micro-profits by buying near-certain outcomes (98-99%+ probability) before market resolution.

## Strategy Overview

The bot replicates the Sharky6999 strategy:

1. Monitor markets about to resolve where outcome is already known
2. Buy at $0.98-$0.99 when the winning side hasn't hit $1.00 yet
3. Wait for resolution, auto-claim at $1.00
4. Repeat with small position sizes ($100-$500)

## Features

- **Data Fetcher**: Fetches all markets from Polymarket CLOB and Gamma APIs
- **PostgreSQL Database**: Stores markets, tokens, price history, and liquidity data
- **Analytics Queries**: Find high-probability outcomes with good liquidity
- **Trading Bot**: Automated order execution (configurable)

## Quick Start

### Prerequisites
- Node.js 18+
- Docker (for PostgreSQL)
- Polymarket account with proxy wallet

### Setup

```bash
# Install dependencies
npm install

# Copy environment file
cp .env.example .env
# Edit .env with your credentials

# Start PostgreSQL
npm run db:up

# Fetch market data
npm run fetch:once

# Run continuous fetcher
npm run fetch
```

## Commands

| Command | Description |
|---------|-------------|
| `npm run build` | Compile TypeScript |
| `npm run dev` | Run trading bot |
| `npm run fetch` | Run continuous data fetcher |
| `npm run fetch:once` | Run single data fetch |
| `npm run print` | Print markets ending in 24h |
| `npm run db:up` | Start PostgreSQL container |
| `npm run db:down` | Stop PostgreSQL container |
| `npm run db:logs` | View database logs |

## Configuration

Edit `.env` file:

```env
# Polymarket API
CLOB_API_URL=https://clob.polymarket.com
GAMMA_API_URL=https://gamma-api.polymarket.com

# Wallet (required for trading)
PRIVATE_KEY=your_private_key_here
POLYMARKET_PROXY_ADDRESS=your_proxy_wallet_address

# Trading Configuration
MIN_PROFIT_THRESHOLD=0.005
MAX_POSITION_SIZE=500
MIN_CERTAINTY_PRICE=0.98
MAX_BUY_PRICE=0.995

# Database
DB_HOST=localhost
DB_PORT=5432
DB_NAME=polymarket
DB_USER=polymarket
DB_PASSWORD=polymarket123
```

## Database Schema

### Tables

- **markets**: Market metadata (question, end_date, liquidity, volume)
- **tokens**: Outcome tokens (Yes/No) for each market
- **price_history**: Historical prices for tracking probability changes
- **opportunities**: Detected arbitrage opportunities
- **trades**: Executed trades and P&L

### Key Queries

**Find high-probability outcomes with liquidity:**
```sql
SELECT
  t.outcome,
  ph.price,
  m.question,
  m.liquidity::numeric(12,2),
  m.end_date
FROM price_history ph
JOIN tokens t ON t.token_id = ph.token_id
JOIN markets m ON m.id = t.market_id
WHERE ph.price >= 0.95
  AND m.active = true
  AND m.closed = false
  AND m.liquidity > 10000
  AND m.end_date > NOW()
  AND m.end_date < NOW() + INTERVAL '7 days'
ORDER BY m.liquidity DESC, ph.price DESC
LIMIT 20;
```

**Markets ending soon:**
```sql
SELECT * FROM markets_ending_soon;
```

**High probability outcomes:**
```sql
SELECT * FROM high_probability_outcomes;
```

## Project Structure

```
polymarket/
├── src/
│   ├── index.ts              # Trading bot entry point
│   ├── fetcher.ts            # Data fetcher service
│   ├── print.ts              # Print markets utility
│   ├── config.ts             # Configuration
│   ├── types/                # TypeScript types
│   ├── services/
│   │   ├── clob-client.ts    # Polymarket API client
│   │   └── websocket.ts      # Real-time data
│   ├── core/
│   │   ├── market-scanner.ts
│   │   ├── opportunity-detector.ts
│   │   ├── executor.ts
│   │   └── position-manager.ts
│   ├── db/
│   │   ├── connection.ts     # PostgreSQL pool
│   │   ├── schema.sql        # Database schema
│   │   └── repositories/     # Data access layer
│   └── utils/
│       └── logger.ts
├── docker-compose.yml        # PostgreSQL container
├── package.json
├── tsconfig.json
└── .env.example
```

## Data Sources

The bot uses two Polymarket APIs:

| API | Data | Endpoint |
|-----|------|----------|
| **CLOB API** | Tokens, prices, order books | `clob.polymarket.com` |
| **Gamma API** | Liquidity, volume, metadata | `gamma-api.polymarket.com` |

Both APIs are paginated and the fetcher combines data from both.

## Database Stats (Example)

```
Total Markets:    222,798
Active Markets:   17,409
Tokens:          426,045
Price Records:   468,544

```

## Risk Considerations

| Risk | Mitigation |
|------|------------|
| Competition from other bots | Low-latency execution |
| Gas fees eating profits | Minimum profit threshold |
| Wrong resolution prediction | 99%+ certainty threshold |
| API rate limits | Respect limits, backoff |
| Wallet security | Dedicated bot wallet |

## License

ISC
