import { EventEmitter } from 'events';
import { logger } from '../utils/logger';
import { config } from '../config';
import {
  Position,
  PositionStatus,
  Trade,
  TradeStatus,
  TradingStats,
} from '../types';
import fs from 'fs';
import path from 'path';

const POSITIONS_FILE = 'data/positions.json';
const STATS_FILE = 'data/stats.json';

export class PositionManager extends EventEmitter {
  private positions: Map<string, Position> = new Map();
  private completedTrades: Trade[] = [];
  private stats: TradingStats = {
    totalTrades: 0,
    winningTrades: 0,
    losingTrades: 0,
    totalProfit: 0,
    totalLoss: 0,
    winRate: 0,
    averageProfit: 0,
    largestWin: 0,
    largestLoss: 0,
  };
  private dailyPnL = 0;
  private dailyStartDate: string = new Date().toDateString();

  constructor() {
    super();
    this.ensureDataDir();
    this.loadState();
  }

  private ensureDataDir(): void {
    const dataDir = 'data';
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
  }

  private loadState(): void {
    try {
      if (fs.existsSync(POSITIONS_FILE)) {
        const data = JSON.parse(fs.readFileSync(POSITIONS_FILE, 'utf-8'));
        for (const pos of data.positions || []) {
          pos.timestamp = new Date(pos.timestamp);
          this.positions.set(pos.id, pos);
        }
        logger.info('Loaded positions from disk', { count: this.positions.size });
      }

      if (fs.existsSync(STATS_FILE)) {
        this.stats = JSON.parse(fs.readFileSync(STATS_FILE, 'utf-8'));
        logger.info('Loaded stats from disk', { stats: this.stats });
      }
    } catch (error) {
      logger.error('Failed to load state', { error });
    }
  }

  private saveState(): void {
    try {
      const positionsData = {
        positions: Array.from(this.positions.values()),
        lastUpdated: new Date().toISOString(),
      };
      fs.writeFileSync(POSITIONS_FILE, JSON.stringify(positionsData, null, 2));

      fs.writeFileSync(STATS_FILE, JSON.stringify(this.stats, null, 2));
    } catch (error) {
      logger.error('Failed to save state', { error });
    }
  }

  addPosition(trade: Trade): Position {
    // Check daily reset
    this.checkDailyReset();

    const position: Position = {
      id: trade.id,
      marketId: trade.marketId,
      tokenId: trade.tokenId,
      outcome: '', // Will be set when we have market info
      entryPrice: trade.price,
      size: trade.size,
      timestamp: trade.timestamp,
      status: PositionStatus.OPEN,
    };

    this.positions.set(position.id, position);
    this.stats.totalTrades++;

    logger.info('Position added', {
      id: position.id,
      tokenId: position.tokenId,
      entryPrice: position.entryPrice,
      size: position.size,
      cost: (position.entryPrice * position.size).toFixed(2),
    });

    this.saveState();
    this.emit('position_opened', position);

    return position;
  }

  resolvePosition(
    positionId: string,
    resolvedPrice: number,
    isWinner: boolean
  ): void {
    const position = this.positions.get(positionId);
    if (!position) {
      logger.warn('Position not found for resolution', { positionId });
      return;
    }

    // Calculate P&L
    const cost = position.entryPrice * position.size;
    const payout = isWinner ? position.size : 0; // Winner pays $1 per share
    const pnl = payout - cost;

    if (isWinner) {
      position.status = PositionStatus.RESOLVED_WIN;
      this.stats.winningTrades++;
      this.stats.totalProfit += pnl;
      if (pnl > this.stats.largestWin) {
        this.stats.largestWin = pnl;
      }
    } else {
      position.status = PositionStatus.RESOLVED_LOSS;
      this.stats.losingTrades++;
      this.stats.totalLoss += Math.abs(pnl);
      if (Math.abs(pnl) > this.stats.largestLoss) {
        this.stats.largestLoss = Math.abs(pnl);
      }
    }

    // Update daily P&L
    this.dailyPnL += pnl;

    // Update win rate
    const totalResolved = this.stats.winningTrades + this.stats.losingTrades;
    this.stats.winRate = totalResolved > 0
      ? (this.stats.winningTrades / totalResolved) * 100
      : 0;

    // Update average profit
    this.stats.averageProfit = totalResolved > 0
      ? (this.stats.totalProfit - this.stats.totalLoss) / totalResolved
      : 0;

    logger.info('Position resolved', {
      id: positionId,
      isWinner,
      cost: cost.toFixed(2),
      payout: payout.toFixed(2),
      pnl: pnl.toFixed(2),
      dailyPnL: this.dailyPnL.toFixed(2),
    });

    this.saveState();
    this.emit('position_resolved', position, pnl);
  }

  private checkDailyReset(): void {
    const today = new Date().toDateString();
    if (today !== this.dailyStartDate) {
      logger.info('Daily reset', {
        previousDate: this.dailyStartDate,
        previousPnL: this.dailyPnL.toFixed(2),
      });
      this.dailyPnL = 0;
      this.dailyStartDate = today;
    }
  }

  getOpenPositions(): Position[] {
    return Array.from(this.positions.values()).filter(
      (p) => p.status === PositionStatus.OPEN
    );
  }

  getTotalExposure(): number {
    return this.getOpenPositions().reduce(
      (sum, p) => sum + p.entryPrice * p.size,
      0
    );
  }

  canOpenNewPosition(size: number, price: number): boolean {
    const newExposure = this.getTotalExposure() + size * price;

    // Check total exposure limit
    if (newExposure > config.maxTotalExposure) {
      logger.debug('Cannot open position: max exposure reached', {
        currentExposure: this.getTotalExposure(),
        newExposure,
        limit: config.maxTotalExposure,
      });
      return false;
    }

    // Check daily loss limit
    if (this.dailyPnL < -config.dailyLossLimit) {
      logger.debug('Cannot open position: daily loss limit reached', {
        dailyPnL: this.dailyPnL,
        limit: config.dailyLossLimit,
      });
      return false;
    }

    return true;
  }

  getPositionsByMarket(marketId: string): Position[] {
    return Array.from(this.positions.values()).filter(
      (p) => p.marketId === marketId && p.status === PositionStatus.OPEN
    );
  }

  getStats(): TradingStats {
    return { ...this.stats };
  }

  getDailyPnL(): number {
    this.checkDailyReset();
    return this.dailyPnL;
  }

  printSummary(): void {
    const openPositions = this.getOpenPositions();
    const totalExposure = this.getTotalExposure();

    logger.info('=== Position Summary ===', {
      openPositions: openPositions.length,
      totalExposure: totalExposure.toFixed(2),
      dailyPnL: this.dailyPnL.toFixed(2),
      totalTrades: this.stats.totalTrades,
      winRate: this.stats.winRate.toFixed(1) + '%',
      netProfit: (this.stats.totalProfit - this.stats.totalLoss).toFixed(2),
    });
  }
}

export const positionManager = new PositionManager();
