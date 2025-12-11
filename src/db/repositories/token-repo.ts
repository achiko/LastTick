import { pool } from '../connection';
import { logger } from '../../utils/logger';
import { Token } from '../../types';

export interface DbToken {
  id: number;
  token_id: string;
  market_id: string;
  outcome: string;
  created_at: Date;
}

export const tokenRepo = {
  async upsert(marketId: string, token: Token): Promise<void> {
    const query = `
      INSERT INTO tokens (token_id, market_id, outcome)
      VALUES ($1, $2, $3)
      ON CONFLICT (token_id) DO UPDATE SET
        outcome = EXCLUDED.outcome
    `;

    await pool.query(query, [token.tokenId, marketId, token.outcome]);
  },

  async upsertMany(marketId: string, tokens: Token[]): Promise<number> {
    let count = 0;
    for (const token of tokens) {
      try {
        await this.upsert(marketId, token);
        count++;
      } catch (error) {
        logger.error('Failed to upsert token', { tokenId: token.tokenId, error });
      }
    }
    return count;
  },

  async getByMarketId(marketId: string): Promise<DbToken[]> {
    const result = await pool.query(
      'SELECT * FROM tokens WHERE market_id = $1',
      [marketId]
    );
    return result.rows;
  },

  async getByTokenId(tokenId: string): Promise<DbToken | null> {
    const result = await pool.query(
      'SELECT * FROM tokens WHERE token_id = $1',
      [tokenId]
    );
    return result.rows[0] || null;
  },

  async getAllTokenIds(): Promise<string[]> {
    const result = await pool.query('SELECT token_id FROM tokens');
    return result.rows.map((r) => r.token_id);
  },

  async getCount(): Promise<number> {
    const result = await pool.query('SELECT COUNT(*) FROM tokens');
    return parseInt(result.rows[0].count);
  },
};
