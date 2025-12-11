-- Polymarket Analytics Database Schema

-- Markets table
CREATE TABLE IF NOT EXISTS markets (
  id VARCHAR(100) PRIMARY KEY,  -- condition_id is 66 chars (0x + 64 hex)
  question TEXT NOT NULL,
  condition_id VARCHAR(100),
  slug VARCHAR(255),
  resolution_source TEXT,
  end_date TIMESTAMP WITH TIME ZONE,
  liquidity DECIMAL(20, 6),
  volume DECIMAL(20, 6),
  active BOOLEAN DEFAULT true,
  closed BOOLEAN DEFAULT false,
  archived BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Tokens (outcomes) table
CREATE TABLE IF NOT EXISTS tokens (
  id SERIAL PRIMARY KEY,
  token_id VARCHAR(100) UNIQUE NOT NULL,  -- numeric string ~78 chars
  market_id VARCHAR(100) REFERENCES markets(id) ON DELETE CASCADE,
  outcome VARCHAR(500),  -- some outcomes are long
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Price history table
CREATE TABLE IF NOT EXISTS price_history (
  id BIGSERIAL PRIMARY KEY,
  token_id VARCHAR(100) NOT NULL,
  price DECIMAL(10, 6),
  recorded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for efficient price history queries
CREATE INDEX IF NOT EXISTS idx_price_history_token_time
  ON price_history(token_id, recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_price_history_recorded_at
  ON price_history(recorded_at DESC);

-- Opportunities table
CREATE TABLE IF NOT EXISTS opportunities (
  id SERIAL PRIMARY KEY,
  market_id VARCHAR(100) REFERENCES markets(id) ON DELETE CASCADE,
  token_id VARCHAR(100),
  outcome VARCHAR(255),
  price DECIMAL(10, 6),
  expected_profit DECIMAL(10, 6),
  confidence DECIMAL(5, 2),
  detected_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_opportunities_detected_at
  ON opportunities(detected_at DESC);

-- Trades table
CREATE TABLE IF NOT EXISTS trades (
  id SERIAL PRIMARY KEY,
  market_id VARCHAR(100) REFERENCES markets(id) ON DELETE CASCADE,
  token_id VARCHAR(100),
  side VARCHAR(10),
  price DECIMAL(10, 6),
  size DECIMAL(20, 6),
  cost DECIMAL(20, 6),
  order_id VARCHAR(100),
  status VARCHAR(20),
  pnl DECIMAL(20, 6),
  executed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trades_executed_at
  ON trades(executed_at DESC);

-- Market snapshots for tracking changes over time
CREATE TABLE IF NOT EXISTS market_snapshots (
  id BIGSERIAL PRIMARY KEY,
  market_id VARCHAR(100) NOT NULL,
  liquidity DECIMAL(20, 6),
  volume DECIMAL(20, 6),
  recorded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_market_snapshots_market_time
  ON market_snapshots(market_id, recorded_at DESC);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger for markets table
DROP TRIGGER IF EXISTS update_markets_updated_at ON markets;
CREATE TRIGGER update_markets_updated_at
  BEFORE UPDATE ON markets
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Useful views

-- Markets ending soon with high probability outcomes
CREATE OR REPLACE VIEW markets_ending_soon AS
SELECT
  m.id,
  m.question,
  m.slug,
  m.end_date,
  m.liquidity,
  m.volume,
  t.token_id,
  t.outcome,
  ph.price as current_price,
  EXTRACT(EPOCH FROM (m.end_date - NOW())) / 3600 as hours_until_end
FROM markets m
JOIN tokens t ON t.market_id = m.id
LEFT JOIN LATERAL (
  SELECT price
  FROM price_history
  WHERE token_id = t.token_id
  ORDER BY recorded_at DESC
  LIMIT 1
) ph ON true
WHERE m.active = true
  AND m.closed = false
  AND m.end_date > NOW()
  AND m.end_date < NOW() + INTERVAL '24 hours'
ORDER BY m.end_date ASC;

-- High probability outcomes (>90%)
CREATE OR REPLACE VIEW high_probability_outcomes AS
SELECT
  m.id as market_id,
  m.question,
  m.slug,
  m.end_date,
  t.token_id,
  t.outcome,
  ph.price as current_price,
  EXTRACT(EPOCH FROM (m.end_date - NOW())) / 3600 as hours_until_end
FROM markets m
JOIN tokens t ON t.market_id = m.id
LEFT JOIN LATERAL (
  SELECT price
  FROM price_history
  WHERE token_id = t.token_id
  ORDER BY recorded_at DESC
  LIMIT 1
) ph ON true
WHERE m.active = true
  AND m.closed = false
  AND ph.price >= 0.90
ORDER BY ph.price DESC;

-- Daily stats
CREATE OR REPLACE VIEW daily_stats AS
SELECT
  DATE(executed_at) as date,
  COUNT(*) as total_trades,
  SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) as winning_trades,
  SUM(CASE WHEN pnl <= 0 THEN 1 ELSE 0 END) as losing_trades,
  SUM(pnl) as total_pnl,
  AVG(pnl) as avg_pnl,
  SUM(cost) as total_volume
FROM trades
GROUP BY DATE(executed_at)
ORDER BY date DESC;
