import { ConfigError } from '../errors/index.js';

/**
 * Database configuration.
 *
 * Configuration is INJECTABLE (aion-docs/architecture/environments.md: separate
 * credentials per environment; no ambient global connection). Nothing in
 * AION Data reads `process.env` at import time — the connection string is passed
 * explicitly into {@link createDataLayer}. `fromEnv` is a convenience for
 * entrypoints (scripts, tests) that DO want env-driven config, kept at the edge.
 */
export interface DataLayerConfig {
  /** PostgreSQL connection string, e.g. postgresql://user:pass@host:5432/db. */
  connectionString: string;
  /** Max pooled connections. Defaults to node-postgres' default (10). */
  maxConnections?: number;
  /** Statement timeout in ms applied to pooled connections, if set. */
  statementTimeoutMs?: number;
  /** Idle connection timeout in ms. */
  idleTimeoutMs?: number;
  /** Connection acquisition timeout in ms. */
  connectionTimeoutMs?: number;
  /** SSL configuration passed through to node-postgres. */
  ssl?: boolean | { rejectUnauthorized?: boolean; ca?: string };
  /** Application name reported to Postgres (aids audit/observability). */
  applicationName?: string;
}

/**
 * Builds a {@link DataLayerConfig} from environment variables. Intended for
 * operational entrypoints only. `key` selects which URL var to read so scripts
 * can pick the migration/admin connection over the application one.
 */
export function configFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  key = 'DATABASE_URL',
): DataLayerConfig {
  const connectionString = env[key] ?? env.DATABASE_URL;
  if (!connectionString) {
    throw new ConfigError(
      `no database connection string: set ${key} (or DATABASE_URL)`,
      { key },
    );
  }
  const config: DataLayerConfig = {
    connectionString,
    applicationName: env.PGAPPNAME ?? 'aion-data',
  };
  if (env.PGMAXCONNECTIONS) {
    config.maxConnections = Number(env.PGMAXCONNECTIONS);
  }
  return config;
}
