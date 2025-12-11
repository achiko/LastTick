import { config } from './config';
import { logger } from './utils/logger';
import { clobService } from './services/clob-client';
import { testConnection, closePool } from './db/connection';
import { marketRepo, tokenRepo, priceRepo } from './db/repositories';
import { Market } from './types';

// Fetch liquidity/volume from Gamma API and update markets
async function fetchAndUpdateLiquidity(): Promise<number> {
  logger.info('Fetching liquidity data from Gamma API...');
  const pageSize = 500;
  let offset = 0;
  let updated = 0;

  while (true) {
    const url = `${config.gammaApiUrl}/markets?active=true&closed=false&limit=${pageSize}&offset=${offset}`;
    const response = await fetch(url);
    const data = (await response.json()) as any[];

    if (!data || data.length === 0) break;

    for (const m of data) {
      if (m.conditionId && (m.liquidity || m.volume)) {
        await marketRepo.updateLiquidity(
          m.conditionId,
          parseFloat(m.liquidity || '0'),
          parseFloat(m.volume || '0')
        );
        updated++;
      }
    }

    offset += data.length;
    if (data.length < pageSize) break;
  }

  logger.info(`Updated liquidity for ${updated} markets`);
  return updated;
}

class MarketFetcher {
  private isRunning = false;
  private fetchInterval: NodeJS.Timeout | null = null;

  async start(): Promise<void> {
    logger.info('===========================================');
    logger.info('  Polymarket Data Fetcher');
    logger.info('===========================================');

    // Test database connection
    logger.info('Testing database connection...');
    const dbConnected = await testConnection();
    if (!dbConnected) {
      logger.error('Failed to connect to database. Exiting.');
      process.exit(1);
    }

    // Initialize CLOB client
    logger.info('Initializing CLOB client...');
    await clobService.initialize();

    // Initial fetch
    await this.fetchAndStore();

    // Set up interval for periodic fetching
    const intervalMs = config.marketScanIntervalMs;
    logger.info(`Starting periodic fetch every ${intervalMs / 1000} seconds`);

    this.fetchInterval = setInterval(() => {
      this.fetchAndStore();
    }, intervalMs);

    this.isRunning = true;

    // Handle shutdown
    this.setupShutdownHandlers();

    logger.info('Fetcher started successfully!');
  }

  async fetchAndStore(): Promise<void> {
    const startTime = Date.now();
    logger.info('Starting market fetch...');

    try {
      // Fetch all markets
      const markets = await clobService.getMarkets();
      logger.info(`Fetched ${markets.length} markets from API`);

      // Store markets
      let marketsStored = 0;
      let tokensStored = 0;
      let pricesRecorded = 0;

      const priceRecords: Array<{ tokenId: string; price: number }> = [];

      for (const market of markets) {
        try {
          // Store market
          await marketRepo.upsert(market);
          marketsStored++;

          // Store tokens and collect prices
          if (market.tokens && market.tokens.length > 0) {
            for (const token of market.tokens) {
              await tokenRepo.upsert(market.id, token);
              tokensStored++;

              // Collect price for batch insert
              if (token.price !== undefined && token.price !== null) {
                priceRecords.push({
                  tokenId: token.tokenId,
                  price: token.price,
                });
              }
            }
          }
        } catch (error) {
          logger.error('Error storing market', { marketId: market.id, error });
        }
      }

      // Batch insert prices
      if (priceRecords.length > 0) {
        pricesRecorded = await priceRepo.recordMany(priceRecords);
      }

      // Update liquidity/volume from Gamma API
      const liquidityUpdated = await fetchAndUpdateLiquidity();

      const elapsed = Date.now() - startTime;
      logger.info('Fetch complete', {
        marketsStored,
        tokensStored,
        pricesRecorded,
        liquidityUpdated,
        elapsedMs: elapsed,
      });

      // Print stats
      await this.printStats();
    } catch (error) {
      logger.error('Fetch failed', { error });
    }
  }

  async printStats(): Promise<void> {
    const marketCount = await marketRepo.getCount();
    const activeCount = await marketRepo.getActiveCount();
    const tokenCount = await tokenRepo.getCount();
    const priceCount = await priceRepo.getCount();

    logger.info('Database stats', {
      totalMarkets: marketCount,
      activeMarkets: activeCount,
      tokens: tokenCount,
      priceRecords: priceCount,
    });
  }

  async stop(): Promise<void> {
    logger.info('Stopping fetcher...');

    if (this.fetchInterval) {
      clearInterval(this.fetchInterval);
      this.fetchInterval = null;
    }

    await closePool();
    this.isRunning = false;

    logger.info('Fetcher stopped');
  }

  private setupShutdownHandlers(): void {
    const shutdown = async () => {
      logger.info('Received shutdown signal');
      await this.stop();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  }
}

// Run once mode
async function runOnce(): Promise<void> {
  logger.info('Running single fetch...');

  const dbConnected = await testConnection();
  if (!dbConnected) {
    logger.error('Failed to connect to database');
    process.exit(1);
  }

  await clobService.initialize();

  const fetcher = new MarketFetcher();
  await fetcher.fetchAndStore();

  await closePool();
  logger.info('Done!');
  process.exit(0);
}

// Main
const args = process.argv.slice(2);
const isOnce = args.includes('--once');

if (isOnce) {
  runOnce().catch((error) => {
    logger.error('Fatal error', { error });
    process.exit(1);
  });
} else {
  const fetcher = new MarketFetcher();
  fetcher.start().catch((error) => {
    logger.error('Fatal error', { error });
    process.exit(1);
  });
}
