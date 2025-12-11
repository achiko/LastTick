import WebSocket from 'ws';
import { EventEmitter } from 'events';
import { logger } from '../utils/logger';
import { PriceChangeEvent, TradeEvent } from '../types';

const WS_URL = 'wss://ws-subscriptions-clob.polymarket.com/ws/market';

interface WebSocketMessage {
  type: string;
  [key: string]: any;
}

export class PolymarketWebSocket extends EventEmitter {
  private ws: WebSocket | null = null;
  private subscribedAssets: Set<string> = new Set();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelay = 1000;
  private pingInterval: NodeJS.Timeout | null = null;
  private isConnecting = false;

  async connect(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN || this.isConnecting) {
      return;
    }

    this.isConnecting = true;

    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(WS_URL);

        this.ws.on('open', () => {
          logger.info('WebSocket connected');
          this.reconnectAttempts = 0;
          this.isConnecting = false;
          this.startPingInterval();

          // Resubscribe to previously subscribed assets
          for (const assetId of this.subscribedAssets) {
            this.subscribeToAsset(assetId);
          }

          this.emit('connected');
          resolve();
        });

        this.ws.on('message', (data: WebSocket.Data) => {
          try {
            const message = JSON.parse(data.toString()) as WebSocketMessage;
            this.handleMessage(message);
          } catch (error) {
            logger.error('Failed to parse WebSocket message', { error, data: data.toString() });
          }
        });

        this.ws.on('close', (code, reason) => {
          logger.warn('WebSocket closed', { code, reason: reason.toString() });
          this.isConnecting = false;
          this.stopPingInterval();
          this.emit('disconnected');
          this.attemptReconnect();
        });

        this.ws.on('error', (error) => {
          logger.error('WebSocket error', { error });
          this.isConnecting = false;
          reject(error);
        });

        this.ws.on('pong', () => {
          logger.debug('Received pong');
        });
      } catch (error) {
        this.isConnecting = false;
        reject(error);
      }
    });
  }

  private handleMessage(message: WebSocketMessage): void {
    // Handle different message types
    if (message.event_type === 'book') {
      // Order book update
      this.emit('book', message);
    } else if (message.event_type === 'price_change') {
      const priceEvent: PriceChangeEvent = {
        type: 'price_change',
        market: message.market || message.condition_id,
        assetId: message.asset_id,
        price: message.price,
        timestamp: message.timestamp,
      };
      this.emit('price_change', priceEvent);
    } else if (message.event_type === 'last_trade_price') {
      const tradeEvent: TradeEvent = {
        type: 'trade',
        market: message.market || message.condition_id,
        price: message.price,
        size: message.size || '0',
        side: message.side || 'unknown',
        timestamp: message.timestamp,
      };
      this.emit('trade', tradeEvent);
    } else if (message.event_type === 'tick_size_change') {
      this.emit('tick_size_change', message);
    } else {
      // Generic message
      this.emit('message', message);
    }
  }

  subscribeToAsset(assetId: string): void {
    this.subscribedAssets.add(assetId);

    if (this.ws?.readyState !== WebSocket.OPEN) {
      logger.debug('WebSocket not open, will subscribe after connection', { assetId });
      return;
    }

    const subscribeMsg = {
      type: 'market',
      assets_ids: [assetId],
    };

    this.ws.send(JSON.stringify(subscribeMsg));
    logger.debug('Subscribed to asset', { assetId });
  }

  subscribeToAssets(assetIds: string[]): void {
    for (const assetId of assetIds) {
      this.subscribedAssets.add(assetId);
    }

    if (this.ws?.readyState !== WebSocket.OPEN) {
      logger.debug('WebSocket not open, will subscribe after connection');
      return;
    }

    const subscribeMsg = {
      type: 'market',
      assets_ids: assetIds,
    };

    this.ws.send(JSON.stringify(subscribeMsg));
    logger.debug('Subscribed to assets', { count: assetIds.length });
  }

  unsubscribeFromAsset(assetId: string): void {
    this.subscribedAssets.delete(assetId);
    // Note: Polymarket WS doesn't have explicit unsubscribe
  }

  private startPingInterval(): void {
    this.stopPingInterval();
    this.pingInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.ping();
      }
    }, 30000); // Ping every 30 seconds
  }

  private stopPingInterval(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  private async attemptReconnect(): Promise<void> {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      logger.error('Max reconnection attempts reached');
      this.emit('max_reconnect_failed');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);

    logger.info('Attempting to reconnect', {
      attempt: this.reconnectAttempts,
      delay,
    });

    await new Promise((resolve) => setTimeout(resolve, delay));

    try {
      await this.connect();
    } catch (error) {
      logger.error('Reconnection failed', { error });
    }
  }

  disconnect(): void {
    this.stopPingInterval();
    this.subscribedAssets.clear();

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    logger.info('WebSocket disconnected');
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  getSubscribedAssets(): string[] {
    return Array.from(this.subscribedAssets);
  }
}

export const wsService = new PolymarketWebSocket();
