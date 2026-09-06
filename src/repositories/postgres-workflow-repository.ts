import type { Workflow, WorkflowId, WorkflowRepository } from '@aion/core';
import type { Queryable } from '../db/client.js';
import type { WorkflowRow } from '../types/database.js';
import { toPersistenceError, type DataError } from '../errors/index.js';
import { rowToWorkflow, workflowToColumns } from '../mappers/workflow-mapper.js';

/**
 * Durable {@link WorkflowRepository} (Mission 004).
 *
 * Stores reusable multi-step workflow definitions so MissionOrchestrator can
 * reload plans after Runtime restart.
 */
export class PostgresWorkflowRepository implements WorkflowRepository {
  constructor(private readonly db: Queryable) {}

  async get(id: WorkflowId): Promise<Workflow | undefined> {
    try {
      const { rows } = await this.db.query<WorkflowRow>(
        'SELECT * FROM workflows WHERE workflow_id = $1',
        [id],
      );
      const row = rows[0];
      return row ? rowToWorkflow(row) : undefined;
    } catch (err) {
      throw wrap('get workflow', err, { workflowId: id });
    }
  }

  async save(workflow: Workflow): Promise<void> {
    const c = workflowToColumns(workflow);
    try {
      await this.db.query(
        `INSERT INTO workflows (
           workflow_id, name, description, version, steps, metadata
         ) VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)
         ON CONFLICT (workflow_id) DO UPDATE SET
           name = EXCLUDED.name,
           description = EXCLUDED.description,
           version = EXCLUDED.version,
           steps = EXCLUDED.steps,
           metadata = EXCLUDED.metadata,
           updated_at = now()`,
        [c.workflow_id, c.name, c.description, c.version, c.steps, c.metadata],
      );
    } catch (err) {
      throw wrap('save workflow', err, { workflowId: workflow.workflowId });
    }
  }

  async list(): Promise<Workflow[]> {
    try {
      const { rows } = await this.db.query<WorkflowRow>(
        'SELECT * FROM workflows ORDER BY name ASC, version ASC',
      );
      return rows.map(rowToWorkflow);
    } catch (err) {
      throw wrap('list workflows', err, {});
    }
  }
}

function wrap(op: string, err: unknown, details: Record<string, unknown>): DataError {
  return toPersistenceError(op, err, details);
}
