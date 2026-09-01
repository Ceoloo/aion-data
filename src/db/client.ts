import pg from 'pg';
import type { DataLayerConfig } from './config.js';

const { Pool } = pg;

/**
 * A minimal query surface satisfied by both a pooled {@link pg.Pool} and a
 * checked-out {@link pg.PoolClient}. Repositories depend on this, not on `Pool`
 * directly, so the exact same repository code runs both against the pool
 * (autocommit per call) and inside a transaction (bound to one client). This is
 * the seam that keeps transactions a first-class capability without threading a
 * client argument through every method.
 */
export interface Queryable {
  query<R extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    params?: readonly unknown[],
  ): Promise<pg.QueryResult<R>>;
}

/**
 * Creates a connection pool from injectable config. Timestamps come back as
 * native `Date` objects (node-postgres default for timestamptz), which the
 * mappers convert to UTC ISO-8601 strings for Core.
 */
export function createPool(config: DataLayerConfig): pg.Pool {
  const poolConfig: pg.PoolConfig = {
    connectionString: config.connectionString,
    application_name: config.applicationName ?? 'aion-data',
  };
  if (config.maxConnections !== undefined) poolConfig.max = config.maxConnections;
  if (config.idleTimeoutMs !== undefined) {
    poolConfig.idleTimeoutMillis = config.idleTimeoutMs;
  }
  if (config.connectionTimeoutMs !== undefined) {
    poolConfig.connectionTimeoutMillis = config.connectionTimeoutMs;
  }
  if (config.statementTimeoutMs !== undefined) {
    poolConfig.statement_timeout = config.statementTimeoutMs;
  }
  if (config.ssl !== undefined) poolConfig.ssl = config.ssl;

  return new Pool(poolConfig);
}

export type { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
