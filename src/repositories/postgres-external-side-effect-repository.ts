import type {
  ExternalSideEffect,
  ExternalSideEffectId,
} from '@aion/core';
import type { Queryable } from '../db/client.js';
import type { ExternalSideEffectRow } from '../types/database.js';
import { toPersistenceError, type DataError } from '../errors/index.js';
import {
  externalSideEffectToColumns,
  rowToExternalSideEffect,
} from '../mappers/external-side-effect-mapper.js';

/**
 * Mission 009 — durable external side-effect ledger (idempotent CRM mutations).
 */
export class PostgresExternalSideEffectRepository {
  constructor(private readonly db: Queryable) {}

  async get(
    id: ExternalSideEffectId | string,
  ): Promise<ExternalSideEffect | undefined> {
    try {
      const { rows } = await this.db.query<ExternalSideEffectRow>(
        'SELECT * FROM external_side_effects WHERE side_effect_id = $1',
        [id],
      );
      const row = rows[0];
      return row ? rowToExternalSideEffect(row) : undefined;
    } catch (err) {
      throw wrap('get external side-effect', err, { sideEffectId: id });
    }
  }

  async getByIdempotencyKey(
    idempotencyKey: string,
  ): Promise<ExternalSideEffect | undefined> {
    try {
      const { rows } = await this.db.query<ExternalSideEffectRow>(
        'SELECT * FROM external_side_effects WHERE idempotency_key = $1',
        [idempotencyKey],
      );
      const row = rows[0];
      return row ? rowToExternalSideEffect(row) : undefined;
    } catch (err) {
      throw wrap('get external side-effect by idempotency', err, {
        idempotencyKey,
      });
    }
  }

  async listForTenant(
    tenantId: string,
    opts?: { executionId?: string; limit?: number },
  ): Promise<ExternalSideEffect[]> {
    const limit = Math.min(Math.max(opts?.limit ?? 100, 1), 500);
    try {
      const params: unknown[] = [tenantId];
      const filters = ['tenant_id = $1'];
      if (opts?.executionId) {
        params.push(opts.executionId);
        filters.push(`execution_id = $${params.length}`);
      }
      params.push(limit);
      const { rows } = await this.db.query<ExternalSideEffectRow>(
        `SELECT * FROM external_side_effects
         WHERE ${filters.join(' AND ')}
         ORDER BY performed_at DESC
         LIMIT $${params.length}`,
        params,
      );
      return rows.map(rowToExternalSideEffect);
    } catch (err) {
      throw wrap('list external side-effects', err, { tenantId });
    }
  }

  /**
   * Insert-or-return existing by idempotency_key.
   * Returns `{ effect, inserted }` so callers can distinguish first write vs replay.
   */
  async saveOnce(
    effect: ExternalSideEffect,
  ): Promise<{ effect: ExternalSideEffect; inserted: boolean }> {
    const existing = await this.getByIdempotencyKey(effect.idempotencyKey);
    if (existing) {
      return { effect: existing, inserted: false };
    }
    const c = externalSideEffectToColumns(effect);
    try {
      await this.db.query(
        `INSERT INTO external_side_effects (
           side_effect_id, execution_id, tenant_id, service_key, idempotency_key,
           external_resource_id, external_request_id, requested_action, approval_id,
           performed_at, result_hash, status, provider, error_code, error_message, metadata
         ) VALUES (
           $1, $2, $3, $4, $5,
           $6, $7, $8, $9,
           $10, $11, $12, $13, $14, $15, $16::jsonb
         )`,
        [
          c.side_effect_id,
          c.execution_id,
          c.tenant_id,
          c.service_key,
          c.idempotency_key,
          c.external_resource_id,
          c.external_request_id,
          c.requested_action,
          c.approval_id,
          c.performed_at,
          c.result_hash,
          c.status,
          c.provider,
          c.error_code,
          c.error_message,
          c.metadata,
        ],
      );
      return { effect, inserted: true };
    } catch (err) {
      // Unique race: another writer won — return their row.
      const raced = await this.getByIdempotencyKey(effect.idempotencyKey);
      if (raced) {
        return { effect: raced, inserted: false };
      }
      throw wrap('save external side-effect', err, {
        idempotencyKey: effect.idempotencyKey,
      });
    }
  }
}

function wrap(
  op: string,
  err: unknown,
  details: Record<string, unknown>,
): DataError {
  return toPersistenceError(op, err, details);
}
