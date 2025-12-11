import {
  ClobClient,
  Side as ClobSide,
  OrderType as ClobOrderType,
} from '@polymarket/clob-client';
import { Wallet } from '@ethersproject/wallet';
import { config } from '../config';
import { logger } from '../utils/logger';
import {
  Market,
  OrderBook,
  OrderRequest,
  OrderResponse,
  OrderType,
  Side,
} from '../types';

export class PolymarketClobService {
  private client: ClobClient | null = null;
  private isAuthenticated = false;

  async initialize(): Promise<void> {
    try {
      if (!config.privateKey) {
        // Read-only mode without authentication
        this.client = new ClobClient(
          config.clobApiUrl,
          config.chainId as 137 | 80002
        );
        logger.info('CLOB client initialized in read-only mode');
        return;
      }

      // Authenticated mode for trading
      const wallet = new Wallet(config.privateKey);

      // First create client without creds to derive them
      const tempClient = new ClobClient(
        config.clobApiUrl,
        config.chainId as 137 | 80002,
        wallet,
        undefined, // creds - will derive
        undefined, // signatureType
        config.proxyAddress || undefined // funderAddress
      );

      // Derive or create API credentials
      const creds = await tempClient.createOrDeriveApiKey();

      // Now create final client with creds
      this.client = new ClobClient(
        config.clobApiUrl,
        config.chainId as 137 | 80002,
        wallet,
        creds,
        undefined,
        config.proxyAddress || undefined
      );

      this.isAuthenticated = true;
      logger.info('CLOB client initialized with authentication', {
        proxyAddress: config.proxyAddress,
      });
    } catch (error) {
      logger.error('Failed to initialize CLOB client', { error });
      throw error;
    }
  }

  async getMarkets(): Promise<Market[]> {
    if (!this.client) throw new Error('Client not initialized');

    try {
      const allMarkets: Market[] = [];
      let nextCursor: string | undefined = undefined;

      logger.info('Fetching all markets from CLOB API with pagination...');

      // Paginate through all markets using cursor
      while (true) {
        const url = new URL(`${config.clobApiUrl}/markets`);
        if (nextCursor) {
          url.searchParams.set('next_cursor', nextCursor);
        }

        const response = await fetch(url.toString());
        const result = (await response.json()) as {
          data: any[];
          next_cursor: string;
          limit: number;
          count: number;
        };

        if (!result.data || result.data.length === 0) {
          break;
        }

        for (const m of result.data) {
          allMarkets.push(this.mapClobMarketResponse(m));
        }

        logger.debug('Fetched markets page', {
          fetched: result.data.length,
          total: allMarkets.length,
          nextCursor: result.next_cursor,
        });

        // Check if there's more data
        if (!result.next_cursor || result.next_cursor === 'LTE=') {
          break;
        }
        nextCursor = result.next_cursor;
      }

      logger.info('Fetched all markets', { total: allMarkets.length });
      return allMarkets;
    } catch (error) {
      logger.error('Failed to fetch markets', { error });
      throw error;
    }
  }

  async getMarketById(marketId: string): Promise<Market | null> {
    try {
      const response = await fetch(`${config.gammaApiUrl}/markets/${marketId}`);
      if (!response.ok) return null;

      const m = (await response.json()) as any;
      return this.mapMarketResponse(m);
    } catch (error) {
      logger.error('Failed to fetch market', { marketId, error });
      return null;
    }
  }

  private mapMarketResponse(m: any): Market {
    return {
      id: m.id,
      question: m.question,
      conditionId: m.conditionId,
      slug: m.slug,
      resolutionSource: m.resolutionSource,
      endDate: m.endDateIso,
      liquidity: m.liquidity,
      volume: m.volume,
      active: m.active,
      closed: m.closed,
      archived: m.archived,
      tokens: m.tokens?.map((t: any) => ({
        tokenId: t.token_id,
        outcome: t.outcome,
        price: parseFloat(t.price || '0'),
        winner: t.winner,
      })) || [],
      outcomes: m.outcomes ? JSON.parse(m.outcomes) : [],
      outcomePrices: m.outcomePrices ? JSON.parse(m.outcomePrices) : [],
    };
  }

  // Map CLOB API response (different field names than Gamma API)
  private mapClobMarketResponse(m: any): Market {
    return {
      id: m.condition_id, // CLOB uses condition_id as the main identifier
      question: m.question,
      conditionId: m.condition_id,
      slug: m.market_slug,
      resolutionSource: m.description,
      endDate: m.end_date_iso,
      liquidity: '0', // CLOB API doesn't return liquidity
      volume: '0', // CLOB API doesn't return volume
      active: m.active,
      closed: m.closed,
      archived: m.archived,
      tokens: m.tokens?.map((t: any) => ({
        tokenId: t.token_id,
        outcome: t.outcome,
        price: typeof t.price === 'number' ? t.price : parseFloat(t.price || '0'),
        winner: t.winner,
      })) || [],
      outcomes: m.tokens?.map((t: any) => t.outcome) || [],
      outcomePrices: m.tokens?.map((t: any) => t.price?.toString() || '0') || [],
    };
  }

  async getOrderBook(tokenId: string): Promise<OrderBook | null> {
    if (!this.client) throw new Error('Client not initialized');

    try {
      const book = await this.client.getOrderBook(tokenId);
      return {
        market: book.market,
        assetId: book.asset_id,
        hash: book.hash,
        timestamp: book.timestamp,
        bids: book.bids.map((b: any) => ({ price: b.price, size: b.size })),
        asks: book.asks.map((a: any) => ({ price: a.price, size: a.size })),
        minOrderSize: book.min_order_size || '0',
        tickSize: book.tick_size || '0.01',
      };
    } catch (error) {
      logger.error('Failed to fetch order book', { tokenId, error });
      return null;
    }
  }

  async getMidpoint(tokenId: string): Promise<number | null> {
    if (!this.client) throw new Error('Client not initialized');

    try {
      const midpoint = await this.client.getMidpoint(tokenId);
      return parseFloat(midpoint.mid);
    } catch (error) {
      logger.error('Failed to fetch midpoint', { tokenId, error });
      return null;
    }
  }

  async getSpread(tokenId: string): Promise<{ bid: number; ask: number } | null> {
    if (!this.client) throw new Error('Client not initialized');

    try {
      const spread = await this.client.getSpread(tokenId);
      return {
        bid: parseFloat(spread.bid),
        ask: parseFloat(spread.ask),
      };
    } catch (error) {
      logger.error('Failed to fetch spread', { tokenId, error });
      return null;
    }
  }

  async placeOrder(request: OrderRequest): Promise<OrderResponse> {
    if (!this.client || !this.isAuthenticated) {
      return {
        success: false,
        errorMsg: 'Client not authenticated for trading',
      };
    }

    try {
      logger.info('Placing order', {
        tokenId: request.tokenId,
        side: request.side,
        price: request.price,
        size: request.size,
        orderType: request.orderType,
      });

      // Create signed order using CLOB client's types
      const orderArgs = {
        tokenID: request.tokenId,
        price: request.price,
        size: request.size,
        side: request.side === Side.BUY ? ClobSide.BUY : ClobSide.SELL,
      };

      const signedOrder = await this.client.createOrder(orderArgs);

      // Map to CLOB order type
      let clobOrderType: ClobOrderType;
      switch (request.orderType) {
        case OrderType.FOK:
          clobOrderType = ClobOrderType.FOK;
          break;
        case OrderType.GTD:
          clobOrderType = ClobOrderType.GTD;
          break;
        default:
          clobOrderType = ClobOrderType.GTC;
      }

      const response = await this.client.postOrder(signedOrder, clobOrderType);

      if (response.success) {
        logger.info('Order placed successfully', {
          orderId: response.orderID,
          orderHashes: response.orderHashes,
        });
        return {
          success: true,
          orderId: response.orderID,
          orderHashes: response.orderHashes,
        };
      } else {
        logger.warn('Order placement failed', { errorMsg: response.errorMsg });
        return {
          success: false,
          errorMsg: response.errorMsg,
        };
      }
    } catch (error) {
      logger.error('Error placing order', { error, request });
      return {
        success: false,
        errorMsg: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async cancelOrder(orderId: string): Promise<boolean> {
    if (!this.client || !this.isAuthenticated) {
      logger.warn('Cannot cancel order: not authenticated');
      return false;
    }

    try {
      await this.client.cancelOrder({ orderID: orderId });
      logger.info('Order cancelled', { orderId });
      return true;
    } catch (error) {
      logger.error('Failed to cancel order', { orderId, error });
      return false;
    }
  }

  async getOpenOrders(): Promise<any[]> {
    if (!this.client || !this.isAuthenticated) {
      return [];
    }

    try {
      const orders = await this.client.getOpenOrders();
      return orders;
    } catch (error) {
      logger.error('Failed to fetch open orders', { error });
      return [];
    }
  }

  isReady(): boolean {
    return this.client !== null;
  }

  canTrade(): boolean {
    return this.isAuthenticated;
  }
}

export const clobService = new PolymarketClobService();
