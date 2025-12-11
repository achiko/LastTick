import { pool } from '../connection';
import { logger } from '../../utils/logger';
import { Market } from '../../types';

export interface DbMarket {
  id: string;
  question: string;
  condition_id: string | null;
  slug: string | null;
  resolution_source: string | null;
  end_date: Date | null;
  liquidity: number;
  volume: number;
  active: boolean;
  closed: boolean;
  archived: boolean;
  created_at: Date;
  updated_at: Date;
}

export const marketRepo = {
  async upsert(market: Market): Promise<void> {
    const query = `
      INSERT INTO markets (id, question, condition_id, slug, resolution_source, end_date, liquidity, volume, active, closed, archived)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT (id) DO UPDATE SET
        question = EXCLUDED.question,
        condition_id = EXCLUDED.condition_id,
        slug = EXCLUDED.slug,
        resolution_source = EXCLUDED.resolution_source,
        end_date = EXCLUDED.end_date,
        liquidity = EXCLUDED.liquidity,
        volume = EXCLUDED.volume,
        active = EXCLUDED.active,
        closed = EXCLUDED.closed,
        archived = EXCLUDED.archived,
        updated_at = NOW()
    `;

    const values = [
      market.id,
      market.question,
      market.conditionId,
      market.slug,
      market.resolutionSource,
      market.endDate ? new Date(market.endDate) : null,
      parseFloat(market.liquidity || '0'),
      parseFloat(market.volume || '0'),
      market.active,
      market.closed,
      market.archived,
    ];

    await pool.query(query, values);
  },

  async upsertMany(markets: Market[]): Promise<number> {
    let count = 0;
    for (const market of markets) {
      try {
        await this.upsert(market);
        count++;
      } catch (error) {
        logger.error('Failed to upsert market', { marketId: market.id, error });
      }
    }
    return count;
  },

  async getById(id: string): Promise<DbMarket | null> {
    const result = await pool.query('SELECT * FROM markets WHERE id = $1', [id]);
    return result.rows[0] || null;
  },

  async getActive(): Promise<DbMarket[]> {
    const result = await pool.query(
      'SELECT * FROM markets WHERE active = true AND closed = false ORDER BY end_date ASC'
    );
    return result.rows;
  },

  async getEndingSoon(hoursAhead: number = 24): Promise<DbMarket[]> {
    const result = await pool.query(
      `SELECT * FROM markets
       WHERE active = true
         AND closed = false
         AND end_date > NOW()
         AND end_date < NOW() + INTERVAL '${hoursAhead} hours'
       ORDER BY end_date ASC`
    );
    return result.rows;
  },

  async getCount(): Promise<number> {
    const result = await pool.query('SELECT COUNT(*) FROM markets');
    return parseInt(result.rows[0].count);
  },

  async getActiveCount(): Promise<number> {
    const result = await pool.query(
      'SELECT COUNT(*) FROM markets WHERE active = true AND closed = false'
    );
    return parseInt(result.rows[0].count);
  },

  async updateLiquidity(conditionId: string, liquidity: number, volume: number): Promise<void> {
    await pool.query(
      `UPDATE markets SET liquidity = $2, volume = $3, updated_at = NOW() WHERE id = $1`,
      [conditionId, liquidity, volume]
    );
  },
};
