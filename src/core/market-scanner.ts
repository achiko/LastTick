import { clobService } from '../services/clob-client';
import { logger } from '../utils/logger';
import { config } from '../config';
import { Market, Token } from '../types';

interface WatchedMarket extends Market {
  addedAt: Date;
  highPriceToken: Token | null;
}

export class MarketScanner {
  private watchedMarkets: Map<string, WatchedMarket> = new Map();
  private scanInterval: NodeJS.Timeout | null = null;

  async start(): Promise<void> {
    logger.info('Starting market scanner');
    await this.scan();

    // Set up periodic scanning
    this.scanInterval = setInterval(
      () => this.scan(),
      config.marketScanIntervalMs
    );
  }

  stop(): void {
    if (this.scanInterval) {
      clearInterval(this.scanInterval);
      this.scanInterval = null;
    }
    logger.info('Market scanner stopped');
  }

  async scan(): Promise<void> {
    try {
      logger.debug('Scanning for markets near resolution');
      const markets = await clobService.getMarkets();

      const eligibleMarkets = this.filterEligibleMarkets(markets);
      logger.info('Scan complete', {
        totalMarkets: markets.length,
        eligibleMarkets: eligibleMarkets.length,
      });

      // Update watched markets
      for (const market of eligibleMarkets) {
        if (!this.watchedMarkets.has(market.id)) {
          const highPriceToken = this.findHighPriceToken(market);
          this.watchedMarkets.set(market.id, {
            ...market,
            addedAt: new Date(),
            highPriceToken,
          });
          logger.info('Added market to watchlist', {
            id: market.id,
            question: market.question.substring(0, 50),
            endDate: market.endDate,
            highPriceOutcome: highPriceToken?.outcome,
            highPrice: highPriceToken?.price,
          });
        }
      }

      // Remove markets that are no longer eligible
      for (const [id, market] of this.watchedMarkets) {
        if (!eligibleMarkets.find((m) => m.id === id)) {
          this.watchedMarkets.delete(id);
          logger.debug('Removed market from watchlist', { id });
        }
      }
    } catch (error) {
      logger.error('Market scan failed', { error });
    }
  }

  private filterEligibleMarkets(markets: Market[]): Market[] {
    const now = new Date();
    const eligibleMarkets: Market[] = [];

    for (const market of markets) {
      // Skip if not active or already closed
      if (!market.active || market.closed || market.archived) {
        continue;
      }

      // Check if end date is approaching (within 24 hours)
      const endDate = new Date(market.endDate);
      const hoursUntilEnd = (endDate.getTime() - now.getTime()) / (1000 * 60 * 60);

      // We want markets that are very close to resolution
      // but still have time for the outcome to be known and price to lag
      if (hoursUntilEnd > 0 && hoursUntilEnd <= 24) {
        // Check if any token has high probability (near certainty)
        const hasHighProbToken = market.tokens.some(
          (t) => t.price >= config.minCertaintyPrice
        );

        if (hasHighProbToken) {
          eligibleMarkets.push(market);
        }
      }

      // Also check for markets where price already indicates near-certainty
      // even if end date is further out (outcome may already be known)
      if (hoursUntilEnd > 24) {
        const hasVeryHighProbToken = market.tokens.some((t) => t.price >= 0.99);
        if (hasVeryHighProbToken) {
          eligibleMarkets.push(market);
        }
      }
    }

    return eligibleMarkets;
  }

  private findHighPriceToken(market: Market): Token | null {
    let highestPrice = 0;
    let highestToken: Token | null = null;

    for (const token of market.tokens) {
      if (token.price > highestPrice) {
        highestPrice = token.price;
        highestToken = token;
      }
    }

    return highestToken;
  }

  getWatchedMarkets(): Map<string, WatchedMarket> {
    return this.watchedMarkets;
  }

  getWatchedMarketIds(): string[] {
    return Array.from(this.watchedMarkets.keys());
  }

  getTokenIds(): string[] {
    const tokenIds: string[] = [];
    for (const market of this.watchedMarkets.values()) {
      for (const token of market.tokens) {
        tokenIds.push(token.tokenId);
      }
    }
    return tokenIds;
  }

  getHighPriceTokens(): Array<{ marketId: string; token: Token; market: WatchedMarket }> {
    const result: Array<{ marketId: string; token: Token; market: WatchedMarket }> = [];

    for (const [marketId, market] of this.watchedMarkets) {
      if (market.highPriceToken) {
        result.push({
          marketId,
          token: market.highPriceToken,
          market,
        });
      }
    }

    return result;
  }

  async refreshMarket(marketId: string): Promise<Market | null> {
    const market = await clobService.getMarketById(marketId);
    if (market && this.watchedMarkets.has(marketId)) {
      const watched = this.watchedMarkets.get(marketId)!;
      const highPriceToken = this.findHighPriceToken(market);
      this.watchedMarkets.set(marketId, {
        ...market,
        addedAt: watched.addedAt,
        highPriceToken,
      });
    }
    return market;
  }
}

export const marketScanner = new MarketScanner();
