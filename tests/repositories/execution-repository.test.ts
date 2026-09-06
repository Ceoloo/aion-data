import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createExecutionObject } from '@aion/core';
import { createTestDataLayer, ensureMigrated, truncateAll } from '../setup/test-db.js';
import { makeAgent, makeMissionFixture, makeRun } from '../setup/fixtures.js';
import type { DataLayer } from '../../src/index.js';

describe('PostgresExecutionRepository', () => {
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

  it('round-trips a canonical Execution Object with agent identity', async () => {
    const agent = makeAgent({ domain: 'revenue', role: 'pipeline-ops' });
    const mission = makeMissionFixture();
    await dl.actors.save(agent);
    await dl.missions.save(mission);

    const run = makeRun({
      actorId: agent.actorId,
      missionId: mission.missionId,
      state: 'completed',
      riskLevel: 'R1',
    });
    await dl.runs.save(run);

    const exe = createExecutionObject({ run, agent });
    await dl.executions.save(exe);

    const byId = await dl.executions.get(exe.executionId);
    expect(byId).toEqual(exe);
    expect(byId!.agentUri).toMatch(/^agent:\/\/aion\/revenue\/pipeline-ops\//);
    expect(byId!.status).toBe('succeeded');

    const byRun = await dl.executions.getByRunId(run.runId);
    expect(byRun?.executionId).toBe(exe.executionId);
  });
});
