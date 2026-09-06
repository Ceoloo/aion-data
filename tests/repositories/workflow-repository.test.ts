import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createWorkflow, capability } from '@aion/core';
import { createTestDataLayer, ensureMigrated, truncateAll } from '../setup/test-db.js';
import type { DataLayer } from '../../src/index.js';

describe('PostgresWorkflowRepository', () => {
  let dl: DataLayer;

  beforeAll(async () => {
    dl = createTestDataLayer();
    await ensureMigrated(dl);
  });
  afterAll(async () => {
    await dl.close();
  });
  beforeEach(async () => {
    await truncateAll(dl);
  });

  it('round-trips a workflow preserving steps, version, and metadata', async () => {
    const workflow = createWorkflow({
      name: 'client-money-ghl-v0',
      description: 'Mission 004 client money path (mock GHL)',
      version: '1.0.0',
      steps: [
        {
          name: 'research',
          capability: capability('revenue.lead.research'),
          riskLevel: 'R1',
        },
        {
          name: 'ghl-upsert',
          capability: capability('client.ghl.contact.upsert'),
          riskLevel: 'R1',
          description: 'Mock GoHighLevel contact upsert',
        },
      ],
      metadata: { mission: '004', provider: 'ghl' },
    });

    await dl.workflows.save(workflow);
    const got = await dl.workflows.get(workflow.workflowId);

    expect(got).toEqual(workflow);
    expect(got!.steps).toHaveLength(2);
    expect(got!.steps[1]!.capability).toBe('client.ghl.contact.upsert');
    expect(got!.metadata).toEqual({ mission: '004', provider: 'ghl' });
  });

  it('returns undefined for an unknown workflow', async () => {
    const workflow = createWorkflow({
      name: 'missing',
      steps: [{ name: 'x', capability: capability('revenue.lead.research'), riskLevel: 'R1' }],
    });
    const got = await dl.workflows.get(workflow.workflowId);
    expect(got).toBeUndefined();
  });

  it('save is an idempotent upsert (last write wins)', async () => {
    const workflow = createWorkflow({
      name: 'v1',
      steps: [{ name: 'a', capability: capability('revenue.lead.research'), riskLevel: 'R1' }],
    });
    await dl.workflows.save(workflow);
    await dl.workflows.save({
      ...workflow,
      name: 'v2',
      version: '2.0.0',
      description: 'updated',
    });

    const got = await dl.workflows.get(workflow.workflowId);
    expect(got!.name).toBe('v2');
    expect(got!.version).toBe('2.0.0');
    expect(got!.description).toBe('updated');

    const { rows } = await dl.pool.query('SELECT count(*)::int AS n FROM workflows');
    expect(rows[0].n).toBe(1);
  });

  it('list returns workflows ordered by name then version', async () => {
    const a = createWorkflow({
      name: 'alpha',
      version: '1.0.0',
      steps: [{ name: 's', capability: capability('revenue.lead.research'), riskLevel: 'R1' }],
    });
    const b = createWorkflow({
      name: 'beta',
      version: '1.0.0',
      steps: [{ name: 's', capability: capability('revenue.lead.research'), riskLevel: 'R1' }],
    });
    const a2 = createWorkflow({
      name: 'alpha',
      version: '2.0.0',
      steps: [{ name: 's', capability: capability('revenue.lead.research'), riskLevel: 'R1' }],
    });
    await dl.workflows.save(b);
    await dl.workflows.save(a2);
    await dl.workflows.save(a);

    const listed = await dl.workflows.list();
    expect(listed.map((w) => `${w.name}@${w.version}`)).toEqual([
      'alpha@1.0.0',
      'alpha@2.0.0',
      'beta@1.0.0',
    ]);
  });
});
