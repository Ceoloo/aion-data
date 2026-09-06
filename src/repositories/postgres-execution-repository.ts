import type { ExecutionObject, ExecutionId, RunId } from '@aion/core';
import type { Queryable } from '../db/client.js';
import type { ExecutionRow } from '../types/database.js';
import { toPersistenceError, type DataError } from '../errors/index.js';
import {
  executionToColumns,
  rowToExecution,
} from '../mappers/execution-mapper.js';

/**
 * Durable Execution Object repository — LOCAL to aion-data.
 *
 * Persists Core's canonical `aion_execution` so Runtime's Execution Gateway
 * HTTP surface (reconciled into aion-runtime — not a second gateway) can create
 * and serve the enterprise labor unit. Core defines the contract and factory;
 * Data owns durability.
 */
export class PostgresExecutionRepository {
  constructor(private readonly db: Queryable) {}

  async get(id: ExecutionId): Promise<ExecutionObject | undefined> {
    try {
      const { rows } = await this.db.query<ExecutionRow>(
        'SELECT * FROM executions WHERE execution_id = $1',
        [id],
      );
      const row = rows[0];
      return row ? rowToExecution(row) : undefined;
    } catch (err) {
      throw wrap('get execution', err, { executionId: id });
    }
  }

  async getByRunId(runId: RunId): Promise<ExecutionObject | undefined> {
    try {
      const { rows } = await this.db.query<ExecutionRow>(
        'SELECT * FROM executions WHERE run_id = $1',
        [runId],
      );
      const row = rows[0];
      return row ? rowToExecution(row) : undefined;
    } catch (err) {
      throw wrap('get execution by run', err, { runId });
    }
  }

  async save(exe: ExecutionObject): Promise<void> {
    const c = executionToColumns(exe);
    try {
      await this.db.query(
        `INSERT INTO executions (
           execution_id, actor_id, agent_uri, tenant_id, domain,
           company_id, venture_id, project_id, parent_execution_id, root_execution_id,
           run_id, request_id, command_id, mission_id, workflow_id,
           correlation_id, status, autonomy_level, risk_level, approval_id,
           cost, outcome_id, outcome_summary, revenue_attributed, audit_trace,
           started_at, completed_at, metadata, created_at, updated_at
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
           $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
           $21::jsonb, $22, $23, $24, $25::jsonb, $26, $27, $28::jsonb, $29, $30
         )
         ON CONFLICT (execution_id) DO UPDATE SET
           actor_id = EXCLUDED.actor_id,
           agent_uri = EXCLUDED.agent_uri,
           tenant_id = EXCLUDED.tenant_id,
           domain = EXCLUDED.domain,
           company_id = EXCLUDED.company_id,
           venture_id = EXCLUDED.venture_id,
           project_id = EXCLUDED.project_id,
           parent_execution_id = EXCLUDED.parent_execution_id,
           root_execution_id = EXCLUDED.root_execution_id,
           status = EXCLUDED.status,
           autonomy_level = EXCLUDED.autonomy_level,
           risk_level = EXCLUDED.risk_level,
           approval_id = EXCLUDED.approval_id,
           cost = EXCLUDED.cost,
           outcome_id = EXCLUDED.outcome_id,
           outcome_summary = EXCLUDED.outcome_summary,
           revenue_attributed = EXCLUDED.revenue_attributed,
           audit_trace = EXCLUDED.audit_trace,
           started_at = EXCLUDED.started_at,
           completed_at = EXCLUDED.completed_at,
           metadata = EXCLUDED.metadata,
           updated_at = EXCLUDED.updated_at`,
        [
          c.execution_id, c.actor_id, c.agent_uri, c.tenant_id, c.domain,
          c.company_id, c.venture_id, c.project_id, c.parent_execution_id,
          c.root_execution_id,
          c.run_id, c.request_id, c.command_id, c.mission_id, c.workflow_id,
          c.correlation_id, c.status, c.autonomy_level, c.risk_level,
          c.approval_id, c.cost, c.outcome_id, c.outcome_summary,
          c.revenue_attributed, c.audit_trace, c.started_at, c.completed_at,
          c.metadata, c.created_at, c.updated_at,
        ],
      );
    } catch (err) {
      throw wrap('save execution', err, { executionId: exe.executionId });
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
