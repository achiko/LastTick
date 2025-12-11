
import { EventEmitter } from 'events';
import { clobService } from '../services/clob-client';
import { logger } from '../utils/logger';
import { config } from '../config';
import {
  Opportunity,
  OrderRequest,
  OrderResponse,
  OrderType,
  Side,
  Trade,
  TradeStatus,
} from '../types';

export class OrderExecutor extends EventEmitter {
  private isEnabled = true;
  private pendingOrders: Map<string, Trade> = new Map();
  private executionQueue: Opportunity[] = [];
  private isProcessing = false;

  async executeOpportunity(opportunity: Opportunity): Promise<Trade | null> {
    if (!this.isEnabled) {
      logger.warn('Order execution is disabled');
      return null;
    }

    if (!clobService.canTrade()) {
      logger.warn('CLOB client not authenticated for trading');
      return null;
    }

    // Calculate order size
    const orderSize = this.calculateOrderSize(opportunity);
    if (orderSize <= 0) {
      logger.warn('Order size too small', { opportunity });
      return null;
    }

    const trade: Trade = {
      id: this.generateTradeId(),
      marketId: opportunity.marketId,
      tokenId: opportunity.tokenId,
      side: 'BUY',
      price: opportunity.currentPrice,
      size: orderSize,
      timestamp: new Date(),
      status: TradeStatus.PENDING,
    };

    logger.info('Executing trade', {
      tradeId: trade.id,
      tokenId: opportunity.tokenId,
      price: opportunity.currentPrice,
      size: orderSize,
    });

    const orderRequest: OrderRequest = {
      tokenId: opportunity.tokenId,
      price: opportunity.currentPrice,
      size: orderSize,
      side: Side.BUY,
      orderType: OrderType.FOK, // Fill-Or-Kill for immediate execution
    };

    try {
      const response = await clobService.placeOrder(orderRequest);

      if (response.success) {
        trade.orderId = response.orderId;
        trade.status = TradeStatus.MATCHED;

        logger.info('Trade executed successfully', {
          tradeId: trade.id,
          orderId: response.orderId,
          price: trade.price,
          size: trade.size,
          cost: (trade.price * trade.size).toFixed(2),
        });

        this.emit('trade_executed', trade);
      } else {
        trade.status = TradeStatus.FAILED;
        logger.warn('Trade execution failed', {
          tradeId: trade.id,
          error: response.errorMsg,
        });

        this.emit('trade_failed', trade, response.errorMsg);
      }

      return trade;
    } catch (error) {
      trade.status = TradeStatus.FAILED;
      logger.error('Trade execution error', { tradeId: trade.id, error });
      this.emit('trade_failed', trade, error);
      return trade;
    }
  }

  private calculateOrderSize(opportunity: Opportunity): number {
    // Base order size from config
    let orderSize = config.defaultOrderSize;

    // Scale based on expected profit (higher profit = larger position)
    const profitMultiplier = opportunity.expectedProfit / config.minProfitThreshold;
    if (profitMultiplier > 1) {
      orderSize *= Math.min(profitMultiplier, 2); // Cap at 2x base size
    }

    // Cap at max position size
    orderSize = Math.min(orderSize, config.maxPositionSize);

    // Round to reasonable precision
    return Math.floor(orderSize * 100) / 100;
  }

  private generateTradeId(): string {
    return `trade_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  }

  // Queue-based execution for handling multiple opportunities
  queueOpportunity(opportunity: Opportunity): void {
    this.executionQueue.push(opportunity);
    this.processQueue();
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessing || this.executionQueue.length === 0) {
      return;
    }

    this.isProcessing = true;

    while (this.executionQueue.length > 0) {
      const opportunity = this.executionQueue.shift()!;

      // Check if opportunity is still valid (price might have changed)
      if (Date.now() - opportunity.timestamp.getTime() > 5000) {
        logger.debug('Opportunity expired', { tokenId: opportunity.tokenId });
        continue;
      }

      await this.executeOpportunity(opportunity);

      // Small delay between executions to avoid rate limiting
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    this.isProcessing = false;
  }

  enable(): void {
    this.isEnabled = true;
    logger.info('Order execution enabled');
  }

  disable(): void {
    this.isEnabled = false;
    logger.info('Order execution disabled');
  }

  isExecutionEnabled(): boolean {
    return this.isEnabled;
  }

  getPendingTrades(): Trade[] {
    return Array.from(this.pendingOrders.values());
  }

  getQueueLength(): number {
    return this.executionQueue.length;
  }
}

export const executor = new OrderExecutor();
