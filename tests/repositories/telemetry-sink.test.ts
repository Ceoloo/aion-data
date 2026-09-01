import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDataLayer, ensureMigrated, truncateAll } from '../setup/test-db.js';
import { makeAgent, makeMissionFixture, makeRun, makeTelemetry } from '../setup/fixtures.js';
import type { DataLayer } from '../../src/index.js';

// TELEMETRY_PERSISTENCE + numeric-field fidelity + ordered retrieval.
describe('PostgresTelemetrySink', () => {
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

  async function seedRun() {
    const agent = makeAgent();
    const mission = makeMissionFixture();
    await dl.actors.save(agent);
    await dl.missions.save(mission);
    const run = makeRun({ actorId: agent.actorId, missionId: mission.missionId });
    await dl.runs.save(run);
    return { run, mission };
  }

  it('appends a telemetry record and reads it back with numeric fidelity', async () => {
    const { run } = await seedRun();
    const record = makeTelemetry({
      operation: 'execution',
      status: 'ok',
      runId: run.runId,
      durationMs: 1234,
      cost: 7,
      tokenUsage: 512,
      riskLevel: 'R2',
      model: 'mock-model-v1',
    });

    await dl.telemetry.record(record);
    const got = await dl.telemetry.listByRun(run.runId);

    expect(got.length).toBe(1);
    expect(got[0]).toEqual(record);
    // numeric columns come back from pg as strings — mapper restores numbers.
    expect(typeof got[0]!.durationMs).toBe('number');
    expect(got[0]!.durationMs).toBe(1234);
    expect(got[0]!.cost).toBe(7);
    expect(got[0]!.tokenUsage).toBe(512);
  });

  it('appends every submission (no dedup key; each record is a distinct observation)', async () => {
    const { run } = await seedRun();
    const record = makeTelemetry({ operation: 'policy.evaluate', status: 'ok', runId: run.runId });
    await dl.telemetry.record(record);
    await dl.telemetry.record(record);

    const got = await dl.telemetry.listByRun(run.runId);
    expect(got.length).toBe(2);
  });

  it('retrieves telemetry for a run in durable insertion order', async () => {
    const { run } = await seedRun();
    const ops = ['command.received', 'policy.evaluate', 'execution'];
    for (const operation of ops) {
      await dl.telemetry.record(makeTelemetry({ operation, runId: run.runId }));
    }
    const got = await dl.telemetry.listByRun(run.runId);
    expect(got.map((t) => t.operation)).toEqual(ops);
  });
});
