import { Workflow } from '@aion/core';
import type { WorkflowRow } from '../types/database.js';
import { MappingError } from '../errors/index.js';
import { metadataObject } from './_shared.js';

/**
 * Workflow ⇄ row mapping (Mission 004).
 *
 * Steps are stored as jsonb and re-validated against the Core Workflow
 * contract on read so Data never hands Core an invalid plan definition.
 */
export function rowToWorkflow(row: WorkflowRow): Workflow {
  const steps = Array.isArray(row.steps) ? row.steps : JSON.parse(String(row.steps));
  const parsed = Workflow.safeParse({
    workflowId: row.workflow_id,
    name: row.name,
    description: row.description,
    version: row.version,
    steps,
    metadata: metadataObject(row.metadata),
  });
  if (!parsed.success) {
    throw new MappingError('persisted workflow failed Core contract validation', {
      workflowId: row.workflow_id,
      issues: parsed.error.issues,
    });
  }
  return parsed.data;
}

export function workflowToColumns(workflow: Workflow): {
  workflow_id: string;
  name: string;
  description: string;
  version: string;
  steps: string;
  metadata: string;
} {
  return {
    workflow_id: workflow.workflowId,
    name: workflow.name,
    description: workflow.description,
    version: workflow.version,
    steps: JSON.stringify(workflow.steps),
    metadata: JSON.stringify(workflow.metadata),
  };
}
