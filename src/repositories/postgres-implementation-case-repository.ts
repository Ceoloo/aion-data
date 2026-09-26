import type {
  ImplementationCase,
  ImplementationCaseId,
} from '@aion/core';
import type { Queryable } from '../db/client.js';
import type { ImplementationCaseRow } from '../types/database.js';
import { toPersistenceError, type DataError } from '../errors/index.js';
import {
  implementationCaseToColumns,
  rowToImplementationCase,
} from '../mappers/implementation-case-mapper.js';

/**
 * IE-001 — durable ImplementationCase store (tenant-scoped delivery records).
 */
export class PostgresImplementationCaseRepository {
  constructor(private readonly db: Queryable) {}

  async get(
    id: ImplementationCaseId | string,
  ): Promise<ImplementationCase | undefined> {
    try {
      const { rows } = await this.db.query<ImplementationCaseRow>(
        'SELECT * FROM implementation_cases WHERE case_id = $1',
        [id],
      );
      const row = rows[0];
      return row ? rowToImplementationCase(row) : undefined;
    } catch (err) {
      throw wrap('get implementation case', err, { caseId: id });
    }
  }

  async listForTenant(
    tenantId: string,
    opts?: { deliveryStatus?: string; limit?: number },
  ): Promise<ImplementationCase[]> {
    const limit = Math.min(Math.max(opts?.limit ?? 100, 1), 500);
    try {
      const params: unknown[] = [tenantId];
      const filters = ['tenant_id = $1'];
      if (opts?.deliveryStatus) {
        params.push(opts.deliveryStatus);
        filters.push(`delivery_status = $${params.length}`);
      }
      params.push(limit);
      const { rows } = await this.db.query<ImplementationCaseRow>(
        `SELECT * FROM implementation_cases
         WHERE ${filters.join(' AND ')}
         ORDER BY updated_at DESC
         LIMIT $${params.length}`,
        params,
      );
      return rows.map(rowToImplementationCase);
    } catch (err) {
      throw wrap('list implementation cases', err, { tenantId });
    }
  }

  async save(caseRecord: ImplementationCase): Promise<void> {
    const c = implementationCaseToColumns(caseRecord);
    try {
      await this.db.query(
        `INSERT INTO implementation_cases (
           case_id, tenant_id, client_ref, client_name, owner_id,
           commercial_status, delivery_status, next_action, blockers,
           evidence_links, intake, recommendation, blueprint, provisioning,
           created_at, updated_at, metadata
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb,
           $11::jsonb, $12::jsonb, $13::jsonb, $14::jsonb, $15, $16, $17::jsonb
         )
         ON CONFLICT (case_id) DO UPDATE SET
           tenant_id = EXCLUDED.tenant_id,
           client_ref = EXCLUDED.client_ref,
           client_name = EXCLUDED.client_name,
           owner_id = EXCLUDED.owner_id,
           commercial_status = EXCLUDED.commercial_status,
           delivery_status = EXCLUDED.delivery_status,
           next_action = EXCLUDED.next_action,
           blockers = EXCLUDED.blockers,
           evidence_links = EXCLUDED.evidence_links,
           intake = EXCLUDED.intake,
           recommendation = EXCLUDED.recommendation,
           blueprint = EXCLUDED.blueprint,
           provisioning = EXCLUDED.provisioning,
           updated_at = EXCLUDED.updated_at,
           metadata = EXCLUDED.metadata`,
        [
          c.case_id,
          c.tenant_id,
          c.client_ref,
          c.client_name,
          c.owner_id,
          c.commercial_status,
          c.delivery_status,
          c.next_action,
          c.blockers,
          c.evidence_links,
          c.intake,
          c.recommendation,
          c.blueprint,
          c.provisioning,
          c.created_at,
          c.updated_at,
          c.metadata,
        ],
      );
    } catch (err) {
      throw wrap('save implementation case', err, { caseId: caseRecord.caseId });
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
