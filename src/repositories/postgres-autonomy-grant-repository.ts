import type {
  AutonomyGrant,
  AutonomyGrantId,
  AutonomyEnvironment,
} from '@aion/core';
import type { Queryable } from '../db/client.js';
import type { AutonomyGrantRow } from '../types/database.js';
import { toPersistenceError, type DataError } from '../errors/index.js';
import {
  autonomyGrantToColumns,
  rowToAutonomyGrant,
} from '../mappers/autonomy-grant-mapper.js';

/**
 * Mission 008 — durable AutonomyGrant store (scoped earned autonomy).
 */
export class PostgresAutonomyGrantRepository {
  constructor(private readonly db: Queryable) {}

  async get(id: AutonomyGrantId | string): Promise<AutonomyGrant | undefined> {
    try {
      const { rows } = await this.db.query<AutonomyGrantRow>(
        'SELECT * FROM autonomy_grants WHERE grant_id = $1',
        [id],
      );
      const row = rows[0];
      return row ? rowToAutonomyGrant(row) : undefined;
    } catch (err) {
      throw wrap('get autonomy grant', err, { grantId: id });
    }
  }

  async getActive(scope: {
    tenantId: string;
    agentId: string;
    environment: AutonomyEnvironment;
    serviceKey?: string;
    capability?: string;
  }): Promise<AutonomyGrant | undefined> {
    try {
      const { rows } = await this.db.query<AutonomyGrantRow>(
        `SELECT * FROM autonomy_grants
         WHERE status = 'active'
           AND tenant_id = $1
           AND agent_id = $2
           AND environment = $3
           AND COALESCE(service_key, '') = COALESCE($4, '')
           AND COALESCE(capability, '') = COALESCE($5, '')
         LIMIT 1`,
        [
          scope.tenantId,
          scope.agentId,
          scope.environment,
          scope.serviceKey ?? null,
          scope.capability ?? null,
        ],
      );
      const row = rows[0];
      return row ? rowToAutonomyGrant(row) : undefined;
    } catch (err) {
      throw wrap('get active autonomy grant', err, scope);
    }
  }

  async listForTenant(
    tenantId: string,
    opts?: { agentId?: string; status?: string; limit?: number },
  ): Promise<AutonomyGrant[]> {
    const limit = Math.min(Math.max(opts?.limit ?? 100, 1), 500);
    try {
      const params: unknown[] = [tenantId];
      const filters = ['tenant_id = $1'];
      if (opts?.agentId) {
        params.push(opts.agentId);
        filters.push(`agent_id = $${params.length}`);
      }
      if (opts?.status) {
        params.push(opts.status);
        filters.push(`status = $${params.length}`);
      }
      params.push(limit);
      const { rows } = await this.db.query<AutonomyGrantRow>(
        `SELECT * FROM autonomy_grants
         WHERE ${filters.join(' AND ')}
         ORDER BY last_reviewed_at DESC
         LIMIT $${params.length}`,
        params,
      );
      return rows.map(rowToAutonomyGrant);
    } catch (err) {
      throw wrap('list autonomy grants', err, { tenantId });
    }
  }

  async save(grant: AutonomyGrant): Promise<void> {
    const c = autonomyGrantToColumns(grant);
    try {
      // Supersede any other active grant in the same scope before upsert.
      if (grant.status === 'active') {
        await this.db.query(
          `UPDATE autonomy_grants
           SET status = 'superseded',
               revoked_at = COALESCE(revoked_at, now()),
               revoke_reason = COALESCE(revoke_reason, 'superseded by newer grant')
           WHERE status = 'active'
             AND tenant_id = $1
             AND agent_id = $2
             AND environment = $3
             AND COALESCE(service_key, '') = COALESCE($4, '')
             AND COALESCE(capability, '') = COALESCE($5, '')
             AND grant_id <> $6`,
          [
            c.tenant_id,
            c.agent_id,
            c.environment,
            c.service_key,
            c.capability,
            c.grant_id,
          ],
        );
      }
      await this.db.query(
        `INSERT INTO autonomy_grants (
           grant_id, agent_id, service_key, capability, tenant_id, environment,
           current_level, eligible_level, evidence, status, grant_reason,
           granted_by, l4_allowed, max_waive_risk, last_reviewed_at, created_at,
           revoked_at, revoke_reason, metadata
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11,
           $12, $13, $14, $15, $16, $17, $18, $19::jsonb
         )
         ON CONFLICT (grant_id) DO UPDATE SET
           agent_id = EXCLUDED.agent_id,
           service_key = EXCLUDED.service_key,
           capability = EXCLUDED.capability,
           tenant_id = EXCLUDED.tenant_id,
           environment = EXCLUDED.environment,
           current_level = EXCLUDED.current_level,
           eligible_level = EXCLUDED.eligible_level,
           evidence = EXCLUDED.evidence,
           status = EXCLUDED.status,
           grant_reason = EXCLUDED.grant_reason,
           granted_by = EXCLUDED.granted_by,
           l4_allowed = EXCLUDED.l4_allowed,
           max_waive_risk = EXCLUDED.max_waive_risk,
           last_reviewed_at = EXCLUDED.last_reviewed_at,
           revoked_at = EXCLUDED.revoked_at,
           revoke_reason = EXCLUDED.revoke_reason,
           metadata = EXCLUDED.metadata`,
        [
          c.grant_id,
          c.agent_id,
          c.service_key,
          c.capability,
          c.tenant_id,
          c.environment,
          c.current_level,
          c.eligible_level,
          c.evidence,
          c.status,
          c.grant_reason,
          c.granted_by,
          c.l4_allowed,
          c.max_waive_risk,
          c.last_reviewed_at,
          c.created_at,
          c.revoked_at,
          c.revoke_reason,
          c.metadata,
        ],
      );
    } catch (err) {
      throw wrap('save autonomy grant', err, { grantId: grant.grantId });
    }
  }
}

function wrap(
  operation: string,
  err: unknown,
  context: Record<string, unknown>,
): DataError {
  return toPersistenceError(operation, err, context);
}
