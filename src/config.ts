import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

function getEnvVar(key: string, defaultValue?: string): string {
  const value = process.env[key] || defaultValue;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function getEnvNumber(key: string, defaultValue: number): number {
  const value = process.env[key];
  return value ? parseFloat(value) : defaultValue;
}

export const config = {
  // API URLs
  clobApiUrl: getEnvVar('CLOB_API_URL', 'https://clob.polymarket.com'),
  gammaApiUrl: getEnvVar('GAMMA_API_URL', 'https://gamma-api.polymarket.com'),

  // Wallet
  privateKey: getEnvVar('PRIVATE_KEY', ''),
  proxyAddress: getEnvVar('POLYMARKET_PROXY_ADDRESS', ''),

  // Chain
  chainId: 137, // Polygon mainnet

  // Trading thresholds
  minProfitThreshold: getEnvNumber('MIN_PROFIT_THRESHOLD', 0.005),
  maxPositionSize: getEnvNumber('MAX_POSITION_SIZE', 500),
  maxTotalExposure: getEnvNumber('MAX_TOTAL_EXPOSURE', 5000),
  defaultOrderSize: getEnvNumber('DEFAULT_ORDER_SIZE', 100),

  // Price thresholds for opportunity detection
  minCertaintyPrice: getEnvNumber('MIN_CERTAINTY_PRICE', 0.98),
  maxBuyPrice: getEnvNumber('MAX_BUY_PRICE', 0.995),

  // Timing
  marketScanIntervalMs: getEnvNumber('MARKET_SCAN_INTERVAL_MS', 30000),
  orderBookRefreshMs: getEnvNumber('ORDER_BOOK_REFRESH_MS', 1000),

  // Market scanning
  marketFetchLimit: getEnvNumber('MARKET_FETCH_LIMIT', 500),

  // Risk management
  dailyLossLimit: getEnvNumber('DAILY_LOSS_LIMIT', 500),
  maxPositionsPerMarket: getEnvNumber('MAX_POSITIONS_PER_MARKET', 1),

  // Logging
  logLevel: getEnvVar('LOG_LEVEL', 'info'),
} as const;

export type Config = typeof config;
