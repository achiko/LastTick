import { pool } from '../connection';
import { logger } from '../../utils/logger';

export interface PriceRecord {
  id: number;
  token_id: string;
  price: number;
  recorded_at: Date;
}

export const priceRepo = {
  async record(tokenId: string, price: number): Promise<void> {
    await pool.query(
      'INSERT INTO price_history (token_id, price) VALUES ($1, $2)',
      [tokenId, price]
    );
  },

  async recordMany(prices: Array<{ tokenId: string; price: number }>): Promise<number> {
    if (prices.length === 0) return 0;

    // Batch insert in chunks to avoid PostgreSQL parameter limit (~32K params)
    const BATCH_SIZE = 5000; // 5000 records = 10000 params
    let totalInserted = 0;

    for (let i = 0; i < prices.length; i += BATCH_SIZE) {
      const batch = prices.slice(i, i + BATCH_SIZE);
      const values: any[] = [];
      const placeholders: string[] = [];

      batch.forEach((p, j) => {
        const offset = j * 2;
        placeholders.push(`($${offset + 1}, $${offset + 2})`);
        values.push(p.tokenId, p.price);
      });

      const query = `INSERT INTO price_history (token_id, price) VALUES ${placeholders.join(', ')}`;
      await pool.query(query, values);
      totalInserted += batch.length;
    }

    return totalInserted;
  },

  async getLatest(tokenId: string): Promise<PriceRecord | null> {
    const result = await pool.query(
      'SELECT * FROM price_history WHERE token_id = $1 ORDER BY recorded_at DESC LIMIT 1',
      [tokenId]
    );
    return result.rows[0] || null;
  },

  async getHistory(tokenId: string, limit: number = 100): Promise<PriceRecord[]> {
    const result = await pool.query(
      'SELECT * FROM price_history WHERE token_id = $1 ORDER BY recorded_at DESC LIMIT $2',
      [tokenId, limit]
    );
    return result.rows;
  },

  async getHistoryInRange(
    tokenId: string,
    startTime: Date,
    endTime: Date
  ): Promise<PriceRecord[]> {
    const result = await pool.query(
      `SELECT * FROM price_history
       WHERE token_id = $1 AND recorded_at BETWEEN $2 AND $3
       ORDER BY recorded_at ASC`,
      [tokenId, startTime, endTime]
    );
    return result.rows;
  },

  async getHighProbabilityOutcomes(minPrice: number = 0.90): Promise<any[]> {
    const result = await pool.query(
      `SELECT DISTINCT ON (ph.token_id)
         ph.token_id,
         ph.price,
         ph.recorded_at,
         t.outcome,
         t.market_id,
         m.question,
         m.end_date,
         m.slug
       FROM price_history ph
       JOIN tokens t ON t.token_id = ph.token_id
       JOIN markets m ON m.id = t.market_id
       WHERE ph.price >= $1
         AND m.active = true
         AND m.closed = false
       ORDER BY ph.token_id, ph.recorded_at DESC`,
      [minPrice]
    );
    return result.rows;
  },

  async getCount(): Promise<number> {
    const result = await pool.query('SELECT COUNT(*) FROM price_history');
    return parseInt(result.rows[0].count);
  },

  async cleanup(olderThanDays: number = 30): Promise<number> {
    const result = await pool.query(
      `DELETE FROM price_history WHERE recorded_at < NOW() - INTERVAL '${olderThanDays} days'`
    );
    return result.rowCount || 0;
  },
};
