import type pg from 'pg';
import type { Queryable } from './client.js';
import { PersistenceError } from '../errors/index.js';

/**
 * Runs `fn` inside a single database transaction.
 *
 * A durability boundary that spans several writes (persist a run + its approval
 * request + the emitted event, say) must be atomic — all or nothing. This helper
 * checks out one client, BEGINs, and COMMITs on success or ROLLBACKs on any
 * throw, then always releases the client. The error thrown by `fn` propagates
 * unchanged (so a MappingError stays a MappingError); only a failure of the
 * transaction machinery itself is wrapped as a {@link PersistenceError}.
 *
 * NOTE (see docs/phase-2.md): AION Core's persistence PORTS are single-method
 * (save/emit/record) and the orchestrator calls them independently, so the
 * Phase 1 lifecycle does not yet ask Data for cross-port atomicity — each port
 * call autocommits. This primitive exists so that atomic multi-write boundaries
 * are available to consumers now, and so the gap in Core's ports (no
 * unit-of-work handle) is documented rather than hidden.
 */
export async function withTransaction<T>(
  pool: pg.Pool,
  fn: (tx: Queryable) => Promise<T>,
): Promise<T> {
  let client: pg.PoolClient;
  try {
    client = await pool.connect();
  } catch (err) {
    throw new PersistenceError('could not acquire a database connection', {
      cause: err instanceof Error ? err.message : String(err),
    });
  }

  try {
    await client.query('BEGIN');
  } catch (err) {
    client.release();
    throw new PersistenceError('could not begin transaction', {
      cause: err instanceof Error ? err.message : String(err),
    });
  }

  let result: T;
  try {
    result = await fn(client);
  } catch (fnErr) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Rollback failure is secondary to the original error; surface the latter.
    } finally {
      client.release();
    }
    throw fnErr;
  }

  try {
    await client.query('COMMIT');
  } catch (err) {
    client.release();
    throw new PersistenceError('could not commit transaction', {
      cause: err instanceof Error ? err.message : String(err),
    });
  }

  client.release();
  return result;
}
