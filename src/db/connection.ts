import { Pool, PoolConfig } from 'pg';
import { logger } from '../utils/logger';

const poolConfig: PoolConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'polymarket',
  user: process.env.DB_USER || 'polymarket',
  password: process.env.DB_PASSWORD || 'polymarket123',
  max: parseInt(process.env.DB_POOL_SIZE || '20'),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
};

export const pool = new Pool(poolConfig);

// Log pool events
pool.on('connect', () => {
  logger.debug('New database connection established');
});

pool.on('error', (err) => {
  logger.error('Unexpected database error', { error: err.message });
});

// Test connection
export async function testConnection(): Promise<boolean> {
  try {
    const client = await pool.connect();
    const result = await client.query('SELECT NOW()');
    client.release();
    logger.info('Database connection successful', {
      timestamp: result.rows[0].now,
    });
    return true;
  } catch (error) {
    logger.error('Database connection failed', { error });
    return false;
  }
}

// Graceful shutdown
export async function closePool(): Promise<void> {
  await pool.end();
  logger.info('Database pool closed');
}

// Helper for transactions
export async function withTransaction<T>(
  callback: (client: any) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
