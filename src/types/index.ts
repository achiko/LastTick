// Market types
export interface Market {
  id: string;
  question: string;
  conditionId: string;
  slug: string;
  resolutionSource: string;
  endDate: string;
  liquidity: string;
  volume: string;
  active: boolean;
  closed: boolean;
  archived: boolean;
  tokens: Token[];
  outcomes: string[];
  outcomePrices: string[];
}

export interface Token {
  tokenId: string;
  outcome: string;
  price: number;
  winner: boolean;
}

// Order book types
export interface OrderBook {
  market: string;
  assetId: string;
  hash: string;
  timestamp: string;
  bids: PriceLevel[];
  asks: PriceLevel[];
  minOrderSize: string;
  tickSize: string;
}

export interface PriceLevel {
  price: string;
  size: string;
}

// Trading types
export interface Opportunity {
  marketId: string;
  tokenId: string;
  outcome: string;
  currentPrice: number;
  expectedProfit: number;
  confidence: number;
  timestamp: Date;
}

export interface Position {
  id: string;
  marketId: string;
  tokenId: string;
  outcome: string;
  entryPrice: number;
  size: number;
  timestamp: Date;
  status: PositionStatus;
}

export enum PositionStatus {
  OPEN = 'OPEN',
  PENDING_RESOLUTION = 'PENDING_RESOLUTION',
  RESOLVED_WIN = 'RESOLVED_WIN',
  RESOLVED_LOSS = 'RESOLVED_LOSS',
}

export interface Trade {
  id: string;
  marketId: string;
  tokenId: string;
  side: 'BUY' | 'SELL';
  price: number;
  size: number;
  timestamp: Date;
  orderId?: string;
  status: TradeStatus;
}

export enum TradeStatus {
  PENDING = 'PENDING',
  MATCHED = 'MATCHED',
  CONFIRMED = 'CONFIRMED',
  FAILED = 'FAILED',
}

// Order types
export enum OrderType {
  GTC = 'GTC', // Good-Til-Cancelled
  GTD = 'GTD', // Good-Til-Date
  FOK = 'FOK', // Fill-Or-Kill
}

export enum Side {
  BUY = 'BUY',
  SELL = 'SELL',
}

export interface OrderRequest {
  tokenId: string;
  price: number;
  size: number;
  side: Side;
  orderType: OrderType;
  expiration?: number;
}

export interface OrderResponse {
  success: boolean;
  orderId?: string;
  errorMsg?: string;
  orderHashes?: string[];
}

// WebSocket event types
export interface PriceChangeEvent {
  type: 'price_change';
  market: string;
  assetId: string;
  price: string;
  timestamp: string;
}

export interface TradeEvent {
  type: 'trade';
  market: string;
  price: string;
  size: string;
  side: string;
  timestamp: string;
}

// Bot state types
export interface BotState {
  isRunning: boolean;
  totalTrades: number;
  totalProfit: number;
  dailyProfit: number;
  dailyLoss: number;
  openPositions: Position[];
  watchedMarkets: Map<string, Market>;
}

// Resolution types
export interface ResolutionInfo {
  marketId: string;
  resolvedOutcome: string;
  confidence: number;
  source: string;
  timestamp: Date;
}

// Statistics
export interface TradingStats {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  totalProfit: number;
  totalLoss: number;
  winRate: number;
  averageProfit: number;
  largestWin: number;
  largestLoss: number;
}
