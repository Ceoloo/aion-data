import type {
  ApprovalId,
  ApprovalRequest,
  ApprovalStatus,
  ApprovalStore,
  RunId,
} from '@aion/core';
import type { Queryable } from '../db/client.js';
import type { ApprovalRow } from '../types/database.js';
import { toPersistenceError, type DataError } from '../errors/index.js';
import { approvalToColumns, rowToApprovalRequest } from '../mappers/approval-mapper.js';

/**
 * Durable {@link ApprovalStore} backed by PostgreSQL.
 *
 * Human gates survive restarts here (aion-docs/governance/human-gates.md). The
 * immutable command snapshot travels in `command_snapshot`, so a decision made
 * after a process restart resumes the exact original run. `save` upserts on
 * `approval_id`; the DB's coherence CHECK guarantees a decided approval always
 * carries a decider and a decision time, so a contradictory state cannot be
 * persisted. Approval authority (no self-approval, single decision) remains a
 * Core policy rule — it is NOT reimplemented in SQL.
 */
export class PostgresApprovalStore implements ApprovalStore {
  constructor(private readonly db: Queryable) {}

  async get(id: ApprovalId): Promise<ApprovalRequest | undefined> {
    try {
      const { rows } = await this.db.query<ApprovalRow>(
        'SELECT * FROM approvals WHERE approval_id = $1',
        [id],
      );
      const row = rows[0];
      return row ? rowToApprovalRequest(row) : undefined;
    } catch (err) {
      throw wrap('get approval', err, { approvalId: id });
    }
  }

  async save(request: ApprovalRequest): Promise<void> {
    const c = approvalToColumns(request);
    try {
      await this.db.query(
        `INSERT INTO approvals (
           approval_id, run_id, request_id, mission_id, command_snapshot,
           risk_level, reason, status, requested_at, decided_at, decided_by, note
         ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT (approval_id) DO UPDATE SET
           status = EXCLUDED.status,
           decided_at = EXCLUDED.decided_at,
           decided_by = EXCLUDED.decided_by,
           note = EXCLUDED.note,
           updated_at = now()`,
        [
          c.approval_id, c.run_id, c.request_id, c.mission_id, c.command_snapshot,
          c.risk_level, c.reason, c.status, c.requested_at, c.decided_at,
          c.decided_by, c.note,
        ],
      );
    } catch (err) {
      throw wrap('save approval', err, { approvalId: request.approvalId });
    }
  }

  async list(status?: ApprovalStatus): Promise<ApprovalRequest[]> {
    try {
      const { rows } = status
        ? await this.db.query<ApprovalRow>(
            'SELECT * FROM approvals WHERE status = $1 ORDER BY requested_at, approval_id',
            [status],
          )
        : await this.db.query<ApprovalRow>(
            'SELECT * FROM approvals ORDER BY requested_at, approval_id',
          );
      return rows.map(rowToApprovalRequest);
    } catch (err) {
      throw wrap('list approvals', err, { status });
    }
  }

  /**
   * Convenience: all approvals for a run (an example of a durable-correctness
   * capability Core's port cannot express — "fetch pending approvals by run" —
   * reported in docs/phase-2.md). Not part of the Core ApprovalStore port.
   */
  async listByRun(runId: RunId, status?: ApprovalStatus): Promise<ApprovalRequest[]> {
    try {
      const { rows } = status
        ? await this.db.query<ApprovalRow>(
            'SELECT * FROM approvals WHERE run_id = $1 AND status = $2 ORDER BY requested_at',
            [runId, status],
          )
        : await this.db.query<ApprovalRow>(
            'SELECT * FROM approvals WHERE run_id = $1 ORDER BY requested_at',
            [runId],
          );
      return rows.map(rowToApprovalRequest);
    } catch (err) {
      throw wrap('list approvals by run', err, { runId });
    }
  }
}

function wrap(op: string, err: unknown, details: Record<string, unknown>): DataError {
  return toPersistenceError(op, err, details);
}
