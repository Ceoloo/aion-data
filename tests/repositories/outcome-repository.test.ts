import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { toOutcomeReference } from '../../src/index.js';
import { createTestDataLayer, ensureMigrated, truncateAll } from '../setup/test-db.js';
import { makeAgent, makeMissionFixture, makeRun } from '../setup/fixtures.js';
import type { DataLayer } from '../../src/index.js';

// OUTCOME_PERSISTENCE + Result≠Outcome distinction + Core reference compatibility.
describe('PostgresOutcomeRepository', () => {
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
    const run = makeRun({ actorId: agent.actorId, missionId: mission.missionId, state: 'completed' });
    await dl.runs.save(run);
    return { run, mission };
  }

  it('creates a pending outcome with a Core-minted outcome id and reads it back', async () => {
    const { run, mission } = await seedRun();
    const outcome = await dl.outcomes.create({ runId: run.runId, missionId: mission.missionId });

    expect(outcome.outcomeId).toMatch(/^out_/); // canonical AION Core id prefix
    expect(outcome.status).toBe('pending');

    const got = await dl.outcomes.get(outcome.outcomeId);
    expect(got).toEqual(outcome);
  });

  it('records a REAL business outcome distinct from the execution result', async () => {
    const { run, mission } = await seedRun();
    // Execution result was "deployment succeeded"; the OUTCOME is business value.
    const outcome = await dl.outcomes.create({
      runId: run.runId,
      missionId: mission.missionId,
      status: 'realized',
      outcomeType: 'revenue',
      externalReference: 'invoice_5001',
      value: 5000,
      currency: 'USD',
      measuredAt: '2026-03-01T00:00:00.000Z',
      metadata: { note: 'proposal accepted and paid' },
    });

    const got = await dl.outcomes.get(outcome.outcomeId);
    expect(got!.value).toBe(5000);
    expect(got!.currency).toBe('USD');
    expect(got!.outcomeType).toBe('revenue');
    expect(got!.externalReference).toBe('invoice_5001');
    expect(got!.measuredAt).toBe('2026-03-01T00:00:00.000Z');
  });

  it('lists outcomes by run and by mission', async () => {
    const { run, mission } = await seedRun();
    await dl.outcomes.create({ runId: run.runId, missionId: mission.missionId });
    await dl.outcomes.create({ runId: run.runId, missionId: mission.missionId });

    expect((await dl.outcomes.listByRun(run.runId)).length).toBe(2);
    expect((await dl.outcomes.listByMission(mission.missionId)).length).toBe(2);
  });

  it('create → update → listByRun reflects resolved business outcome on the same run', async () => {
    const { run, mission } = await seedRun();
    const pending = await dl.outcomes.create({
      runId: run.runId,
      missionId: mission.missionId,
      status: 'pending',
    });

    const realized = await dl.outcomes.update(pending.outcomeId, {
      status: 'realized',
      outcomeType: 'revenue',
      value: 1200,
      currency: 'USD',
      measuredAt: '2026-09-01T12:00:00.000Z',
      externalReference: 'inv_p0_42',
    });

    const listed = await dl.outcomes.listByRun(run.runId);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      outcomeId: realized.outcomeId,
      runId: run.runId,
      status: 'realized',
      outcomeType: 'revenue',
      value: 1200,
      currency: 'USD',
      externalReference: 'inv_p0_42',
    });
    expect(listed[0]!.updatedAt >= pending.updatedAt).toBe(true);
  });

  it('updates an outcome as reality resolves', async () => {
    const { run, mission } = await seedRun();
    const outcome = await dl.outcomes.create({ runId: run.runId, missionId: mission.missionId });

    const updated = await dl.outcomes.update(outcome.outcomeId, {
      status: 'realized',
      value: 250,
      currency: 'EUR',
    });
    expect(updated.status).toBe('realized');
    expect(updated.value).toBe(250);
    expect(updated.updatedAt >= outcome.updatedAt).toBe(true);
  });

  it('projects to a Core-valid OutcomeReference (compatibility guarantee)', async () => {
    const { run, mission } = await seedRun();
    const outcome = await dl.outcomes.create({
      runId: run.runId,
      missionId: mission.missionId,
      externalReference: 'inv_1',
    });
    const ref = toOutcomeReference(outcome);
    expect(ref.outcomeId).toBe(outcome.outcomeId);
    expect(ref.runId).toBe(run.runId);
    expect(ref.status).toBe('pending');
    expect(ref.externalReference).toBe('inv_1');
  });
});
