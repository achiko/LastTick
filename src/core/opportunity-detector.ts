import { EventEmitter } from 'events';
import { clobService } from '../services/clob-client';
import { wsService } from '../services/websocket';
import { marketScanner } from './market-scanner';
import { logger } from '../utils/logger';
import { config } from '../config';
import { Opportunity, OrderBook, PriceChangeEvent } from '../types';

export class OpportunityDetector extends EventEmitter {
  private isRunning = false;
  private checkInterval: NodeJS.Timeout | null = null;
  private lastPrices: Map<string, number> = new Map();

  async start(): Promise<void> {
    if (this.isRunning) return;

    this.isRunning = true;
    logger.info('Starting opportunity detector');

    // Subscribe to WebSocket price updates
    this.setupWebSocketListeners();

    // Also run periodic checks for order book analysis
    this.checkInterval = setInterval(
      () => this.scanOrderBooks(),
      config.orderBookRefreshMs
    );

    // Initial scan
    await this.scanOrderBooks();
  }

  stop(): void {
    this.isRunning = false;
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    logger.info('Opportunity detector stopped');
  }

  private setupWebSocketListeners(): void {
    wsService.on('price_change', (event: PriceChangeEvent) => {
      this.handlePriceChange(event);
    });

    wsService.on('book', (data: any) => {
      this.handleBookUpdate(data);
    });
  }

  private handlePriceChange(event: PriceChangeEvent): void {
    const price = parseFloat(event.price);
    const previousPrice = this.lastPrices.get(event.assetId);
    this.lastPrices.set(event.assetId, price);

    // Check if this is a potential opportunity
    // Price is high (near certainty) but below $1.00
    if (price >= config.minCertaintyPrice && price <= config.maxBuyPrice) {
      logger.debug('Potential opportunity from price change', {
        assetId: event.assetId,
        price,
        previousPrice,
      });

      // Trigger detailed order book check
      this.checkOrderBook(event.assetId);
    }
  }

  private handleBookUpdate(data: any): void {
    // Handle real-time order book updates
    if (data.asks && data.asks.length > 0) {
      const bestAsk = parseFloat(data.asks[0].price);
      if (bestAsk >= config.minCertaintyPrice && bestAsk <= config.maxBuyPrice) {
        this.analyzeOpportunity(data.asset_id, {
          market: data.market || data.condition_id,
          assetId: data.asset_id,
          hash: data.hash || '',
          timestamp: data.timestamp || new Date().toISOString(),
          bids: data.bids || [],
          asks: data.asks || [],
          minOrderSize: data.min_tick_size || '1',
          tickSize: data.tick_size || '0.01',
        });
      }
    }
  }

  private async scanOrderBooks(): Promise<void> {
    if (!this.isRunning) return;

    const highPriceTokens = marketScanner.getHighPriceTokens();

    for (const { marketId, token, market } of highPriceTokens) {
      try {
        await this.checkOrderBook(token.tokenId);
      } catch (error) {
        logger.error('Error checking order book', { tokenId: token.tokenId, error });
      }
    }
  }

  private async checkOrderBook(tokenId: string): Promise<void> {
    const orderBook = await clobService.getOrderBook(tokenId);
    if (!orderBook) return;

    await this.analyzeOpportunity(tokenId, orderBook);
  }

  private async analyzeOpportunity(
    tokenId: string,
    orderBook: OrderBook
  ): Promise<void> {
    // Check if there's available liquidity at a good price
    if (!orderBook.asks || orderBook.asks.length === 0) {
      return;
    }

    const bestAsk = parseFloat(orderBook.asks[0].price);
    const askSize = parseFloat(orderBook.asks[0].size);

    // Opportunity conditions:
    // 1. Best ask is above minimum certainty threshold (outcome is very likely)
    // 2. Best ask is below our max buy price (room for profit)
    // 3. There's enough liquidity
    if (
      bestAsk >= config.minCertaintyPrice &&
      bestAsk <= config.maxBuyPrice &&
      askSize >= parseFloat(orderBook.minOrderSize)
    ) {
      const expectedProfit = (1 - bestAsk) * Math.min(askSize, config.maxPositionSize);
      const profitPercentage = ((1 - bestAsk) / bestAsk) * 100;

      // Only emit if profit exceeds threshold
      if (expectedProfit >= config.minProfitThreshold) {
        // Find the market info
        const markets = marketScanner.getWatchedMarkets();
        let marketId = '';
        let outcome = '';

        for (const [id, market] of markets) {
          const token = market.tokens.find((t) => t.tokenId === tokenId);
          if (token) {
            marketId = id;
            outcome = token.outcome;
            break;
          }
        }

        const opportunity: Opportunity = {
          marketId,
          tokenId,
          outcome,
          currentPrice: bestAsk,
          expectedProfit,
          confidence: bestAsk * 100, // Using price as proxy for confidence
          timestamp: new Date(),
        };

        logger.info('Opportunity detected', {
          marketId,
          tokenId,
          outcome,
          price: bestAsk,
          size: askSize,
          expectedProfit: expectedProfit.toFixed(4),
          profitPercentage: profitPercentage.toFixed(2) + '%',
        });

        this.emit('opportunity', opportunity);
      }
    }
  }

  // Subscribe to specific tokens for monitoring
  async subscribeToMarkets(): Promise<void> {
    const tokenIds = marketScanner.getTokenIds();

    if (tokenIds.length > 0) {
      wsService.subscribeToAssets(tokenIds);
      logger.info('Subscribed to market tokens', { count: tokenIds.length });
    }
  }

  getLastPrice(tokenId: string): number | undefined {
    return this.lastPrices.get(tokenId);
  }
}

export const opportunityDetector = new OpportunityDetector();
