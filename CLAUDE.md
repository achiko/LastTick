# CLAUDE.md - Project Context for Claude Code

## Project Overview

Polymarket trading bot and analytics platform. Implements "endgame arbitrage" - buying near-certain outcomes (98-99%+) before market resolution.

## Tech Stack

- **Language**: TypeScript
- **Runtime**: Node.js
- **Database**: PostgreSQL (Docker)
- **APIs**: Polymarket CLOB & Gamma APIs
- **Wallet**: ethers.js v5 (required by @polymarket/clob-client)

## Key Files

| File | Purpose |
|------|---------|
| `src/fetcher.ts` | Data fetcher service - fetches from CLOB + Gamma APIs |
| `src/index.ts` | Trading bot entry point |
| `src/services/clob-client.ts` | Polymarket API client |
| `src/db/connection.ts` | PostgreSQL connection pool |
| `src/db/repositories/*.ts` | Data access layer |
| `src/db/schema.sql` | Database schema |
| `docker-compose.yml` | PostgreSQL container config |

## Important Patterns

### API Data Sources

```
CLOB API (clob.polymarket.com):
- Tokens with prices
- Order books
- Uses cursor pagination (next_cursor)
- condition_id is 66 chars (0x + 64 hex)

Gamma API (gamma-api.polymarket.com):
- Liquidity, volume data
- Uses offset pagination
- conditionId matches CLOB's condition_id
```

### Database IDs

- Market ID = condition_id (VARCHAR 100)
- Token ID = numeric string ~78 chars (VARCHAR 100)

### Batch Operations

Price inserts use 5000-record batches to avoid PostgreSQL parameter limit (~32K params).

## Common Commands

```bash
# Development
npm run fetch:once    # Single data fetch
npm run fetch         # Continuous fetcher
npm run dev           # Run trading bot
npm run print         # Print markets ending soon

# Database
npm run db:up         # Start PostgreSQL
npm run db:down       # Stop PostgreSQL
docker exec polymarket_db psql -U polymarket -d polymarket -c "SQL"
```

## SQL Queries

### Find ending markets
```sql
SELECT t.outcome, ph.price, m.question, m.liquidity::numeric(12,2), m.end_date
FROM price_history ph
JOIN tokens t ON t.token_id = ph.token_id
JOIN markets m ON m.id = t.market_id
WHERE ph.price >= 0.95 AND m.active = true AND m.closed = false
  AND m.liquidity > 10000 AND m.end_date > NOW()
  AND m.end_date < NOW() + INTERVAL '7 days'
ORDER BY m.liquidity DESC, ph.price DESC LIMIT 20;
```

### Database stats
```sql
SELECT COUNT(*) as markets,
  (SELECT COUNT(*) FROM tokens) as tokens,
  (SELECT COUNT(*) FROM price_history) as prices
FROM markets;
```

## Known Issues

1. **ethers version**: Must use ethers v5.x (not v6) - @polymarket/clob-client dependency
2. **API key 400 error**: Expected on first run - SDK tries to create key, fails if exists, then derives existing
3. **Large datasets**: 234K+ markets, 468K+ tokens - be mindful of query performance

## Configuration

Key env vars in `.env`:
- `PRIVATE_KEY` - Wallet private key for trading
- `POLYMARKET_PROXY_ADDRESS` - Polymarket proxy wallet
- `MIN_CERTAINTY_PRICE` - Minimum price to consider (default 0.98)
- `MAX_BUY_PRICE` - Maximum buy price (default 0.995)

## Data Flow

```
1. Fetcher runs
2. CLOB API -> markets, tokens, prices
3. Gamma API -> liquidity, volume updates
4. PostgreSQL stores all data
5. Opportunity detector queries for high-prob outcomes
6. Executor places orders via CLOB client
```
