import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MockExecutionAdapter, capability } from '@aion/core';
import type { DataLayer } from '../../src/index.js';
import { buildPostgresControlPlane } from '../setup/orchestrator.js';
import { createTestDataLayer, ensureMigrated, truncateAll } from '../setup/test-db.js';
import { makeAgent, makeMissionFixture } from '../setup/fixtures.js';

/**
 * FAILED_EXECUTION_DURABILITY.
 *
 *   allowed command → run executing → mock adapter fails → run persisted as
 *   failed → execution.failed event persisted → telemetry persisted.
 *
 * A failure is a first-class, observable fact — not a gap.
 */
describe('durability: failed execution', () => {
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

  it('persists a failed run + execution.failed event + telemetry', async () => {
    const CAP = 'deployment.execute';
    const worker = makeAgent({ permissions: [CAP], maxRiskLevel: 'R2' });
    const mission = makeMissionFixture();
    await dl.actors.save(worker);
    await dl.missions.save(mission);

    const plane = buildPostgresControlPlane(dl, {
      policy: { risk: { capabilityRisk: { [CAP]: 'R1' } } }, // low risk → allowed, no gate
      adapters: [
        new MockExecutionAdapter({
          name: 'failing-runtime',
          capabilities: [capability(CAP)],
          behavior: 'fail',
          error: { code: 'DEPLOY_FAILED', message: 'target unreachable', retryable: true },
        }),
      ],
    });

    const result = await plane.orchestrator.submit({
      name: 'DeployService',
      actor: worker,
      capability: capability(CAP),
      missionId: mission.missionId,
      payload: {},
    });

    expect(result.status).toBe('failed');
    expect(result.result?.status).toBe('failed');
    expect(result.result?.error?.code).toBe('DEPLOY_FAILED');

    // Durable failed run.
    const run = await dl.runs.get(result.run.runId);
    expect(run!.state).toBe('failed');

    // execution.started then execution.failed persisted.
    const events = await dl.events.listByRun(run!.runId);
    const types = events.map((e) => e.eventType);
    expect(types).toContain('execution.started');
    expect(types).toContain('execution.failed');
    expect(types).not.toContain('execution.completed');

    // Telemetry persisted with a failed execution status.
    const telemetry = await dl.telemetry.listByRun(run!.runId);
    expect(telemetry.some((t) => t.operation === 'execution' && t.status === 'failed')).toBe(true);
  });
});
