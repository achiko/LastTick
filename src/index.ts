import { config } from './config';
import { logger } from './utils/logger';
import { clobService } from './services/clob-client';
import { wsService } from './services/websocket';
import { marketScanner } from './core/market-scanner';
import { opportunityDetector } from './core/opportunity-detector';
import { executor } from './core/executor';
import { positionManager } from './core/position-manager';
import { Opportunity, TradeStatus } from './types';

class PolymarketArbitrageBot {
  private isRunning = false;
  private statusInterval: NodeJS.Timeout | null = null;

  async start(): Promise<void> {
    logger.info('===========================================');
    logger.info('  Polymarket Endgame Arbitrage Bot');
    logger.info('===========================================');
    logger.info('Starting bot...', {
      minCertaintyPrice: config.minCertaintyPrice,
      maxBuyPrice: config.maxBuyPrice,
      maxPositionSize: config.maxPositionSize,
      maxTotalExposure: config.maxTotalExposure,
    });

    try {
      // Initialize CLOB client
      logger.info('Initializing CLOB client...');
      await clobService.initialize();

      if (!clobService.canTrade()) {
        logger.warn('Running in READ-ONLY mode (no private key configured)');
        logger.warn('Set PRIVATE_KEY in .env to enable trading');
      }

      // Connect WebSocket
      logger.info('Connecting to WebSocket...');
      await wsService.connect();

      // Start market scanner
      logger.info('Starting market scanner...');
      await marketScanner.start();

      // Wait a bit for initial market scan
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Subscribe to market updates via WebSocket
      await opportunityDetector.subscribeToMarkets();

      // Start opportunity detector
      logger.info('Starting opportunity detector...');
      await opportunityDetector.start();

      // Set up event handlers
      this.setupEventHandlers();

      // Start status reporting
      this.startStatusReporting();

      this.isRunning = true;
      logger.info('Bot started successfully!');
      logger.info('Monitoring markets for arbitrage opportunities...');

      // Handle graceful shutdown
      this.setupShutdownHandlers();
    } catch (error) {
      logger.error('Failed to start bot', { error });
      throw error;
    }
  }

  private setupEventHandlers(): void {
    // Handle detected opportunities
    opportunityDetector.on('opportunity', async (opportunity: Opportunity) => {
      logger.info('Processing opportunity', {
        marketId: opportunity.marketId,
        tokenId: opportunity.tokenId,
        price: opportunity.currentPrice,
        expectedProfit: opportunity.expectedProfit.toFixed(4),
      });

      // Check if we can open a new position
      if (
        !positionManager.canOpenNewPosition(
          config.defaultOrderSize,
          opportunity.currentPrice
        )
      ) {
        logger.warn('Cannot open position: risk limits reached');
        return;
      }

      // Check positions per market limit
      const existingPositions = positionManager.getPositionsByMarket(
        opportunity.marketId
      );
      if (existingPositions.length >= config.maxPositionsPerMarket) {
        logger.debug('Max positions per market reached', {
          marketId: opportunity.marketId,
          count: existingPositions.length,
        });
        return;
      }

      // Execute the trade
      if (clobService.canTrade()) {
        const trade = await executor.executeOpportunity(opportunity);
        if (trade && trade.status === TradeStatus.MATCHED) {
          positionManager.addPosition(trade);
        }
      } else {
        logger.info('SIMULATED TRADE (read-only mode)', {
          tokenId: opportunity.tokenId,
          price: opportunity.currentPrice,
          expectedProfit: opportunity.expectedProfit.toFixed(4),
        });
      }
    });

    // Handle trade execution events
    executor.on('trade_executed', (trade) => {
      logger.info('Trade executed event received', { tradeId: trade.id });
    });

    executor.on('trade_failed', (trade, error) => {
      logger.error('Trade failed event received', {
        tradeId: trade.id,
        error,
      });
    });

    // Handle WebSocket events
    wsService.on('connected', () => {
      logger.info('WebSocket reconnected, resubscribing to markets');
      opportunityDetector.subscribeToMarkets();
    });

    wsService.on('disconnected', () => {
      logger.warn('WebSocket disconnected');
    });

    wsService.on('max_reconnect_failed', () => {
      logger.error('Max WebSocket reconnection attempts failed');
      this.stop();
    });
  }

  private startStatusReporting(): void {
    // Print status every 60 seconds
    this.statusInterval = setInterval(() => {
      this.printStatus();
    }, 60000);
  }

  private printStatus(): void {
    const watchedMarkets = marketScanner.getWatchedMarkets();
    const openPositions = positionManager.getOpenPositions();
    const stats = positionManager.getStats();

    logger.info('=== Bot Status ===', {
      watchedMarkets: watchedMarkets.size,
      openPositions: openPositions.length,
      totalExposure: positionManager.getTotalExposure().toFixed(2),
      dailyPnL: positionManager.getDailyPnL().toFixed(2),
      totalTrades: stats.totalTrades,
      winRate: stats.winRate.toFixed(1) + '%',
      wsConnected: wsService.isConnected(),
    });
  }

  async stop(): Promise<void> {
    logger.info('Stopping bot...');

    this.isRunning = false;

    if (this.statusInterval) {
      clearInterval(this.statusInterval);
      this.statusInterval = null;
    }

    opportunityDetector.stop();
    marketScanner.stop();
    wsService.disconnect();

    positionManager.printSummary();

    logger.info('Bot stopped');
  }

  private setupShutdownHandlers(): void {
    const shutdown = async () => {
      logger.info('Received shutdown signal');
      await this.stop();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    process.on('uncaughtException', (error) => {
      logger.error('Uncaught exception', { error });
      this.stop().then(() => process.exit(1));
    });
    process.on('unhandledRejection', (reason) => {
      logger.error('Unhandled rejection', { reason });
    });
  }
}

// Main entry point
const bot = new PolymarketArbitrageBot();

bot.start().catch((error) => {
  logger.error('Fatal error starting bot', { error });
  process.exit(1);
});
