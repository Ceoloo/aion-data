import type pg from 'pg';
import type { Queryable } from './client.js';
import { PersistenceError } from '../errors/index.js';

/** The session setting the tenant RLS policies read (migration 0010). */
export const TENANT_SETTING = 'aion.tenant_id';

/**
 * Supplies the tenant of the unit of work currently executing, or `undefined`
 * when there is none. Typically backed by the host's request context
 * (AsyncLocalStorage); AION Data never decides *which* tenant — it only makes
 * sure every connection it hands out carries the one it is given.
 */
export type TenantContext = () => string | undefined;

/**
 * Tracks the value last applied to each pooled connection, so the setting is
 * only re-issued when a connection is reused for a different tenant.
 */
const applied = new WeakMap<pg.PoolClient, string>();

/**
 * Sets `aion.tenant_id` on a checked-out connection to exactly the current
 * tenant — or to empty (fail closed: only tenant-less rows) when there is none.
 * Session-scoped on purpose: every scoped checkout re-asserts it, so a value
 * can never leak from a previous unit of work into this one.
 */
export async function applyTenant(
  client: pg.PoolClient,
  tenantId: string | undefined,
): Promise<void> {
  const desired = tenantId ?? '';
  if (applied.get(client) === desired) return;
  await client.query('SELECT set_config($1, $2, false)', [TENANT_SETTING, desired]);
  applied.set(client, desired);
}

/**
 * A pool facade whose every query and checkout is bound to the current tenant,
 * so the tenant Row Level Security policies see the caller's tenant instead of
 * an unset setting (which denies all tenant-owned rows to non-owner roles).
 */
export class TenantScopedPool implements Queryable {
  constructor(
    private readonly pool: pg.Pool,
    private readonly tenant: TenantContext,
  ) {}

  /** Checks out a connection already bound to the current tenant. */
  async connect(): Promise<pg.PoolClient> {
    const client = await this.pool.connect();
    try {
      await applyTenant(client, this.tenant());
    } catch (err) {
      // Never hand out a connection whose tenant binding is unknown.
      client.release(err instanceof Error ? err : true);
      throw new PersistenceError('could not bind tenant to database connection', {
        cause: err instanceof Error ? err.message : String(err),
      });
    }
    return client;
  }

  async query<R extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    params?: readonly unknown[],
  ): Promise<pg.QueryResult<R>> {
    const client = await this.connect();
    try {
      return await client.query<R>(text, params as unknown[] | undefined);
    } finally {
      client.release();
    }
  }
}
