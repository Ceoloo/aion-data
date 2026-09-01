import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ConcurrencyError, NotFoundError } from '../../src/index.js';
import { createTestDataLayer, ensureMigrated, truncateAll } from '../setup/test-db.js';
import { makeAgent, makeMissionFixture, makeRun } from '../setup/fixtures.js';
import type { DataLayer } from '../../src/index.js';
import type { RunId } from '@aion/core';

// RUN_ROUND_TRIP + list + optimistic concurrency (stale write).
describe('PostgresRunRepository', () => {
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

  async function seedActorAndMission() {
    const agent = makeAgent();
    const mission = makeMissionFixture();
    await dl.actors.save(agent);
    await dl.missions.save(mission);
    return { agent, mission };
  }

  it('round-trips a run preserving state, ids, risk and timestamps', async () => {
    const { agent, mission } = await seedActorAndMission();
    const run = makeRun({
      actorId: agent.actorId,
      missionId: mission.missionId,
      state: 'awaiting_approval',
      riskLevel: 'R3',
    });

    await dl.runs.save(run);
    const got = await dl.runs.get(run.runId);

    expect(got).toEqual(run);
    expect(got!.state).toBe('awaiting_approval');
    expect(got!.riskLevel).toBe('R3');
  });

  it('upserts on save and increments the DB version (not part of the Run contract)', async () => {
    const { agent } = await seedActorAndMission();
    const run = makeRun({ actorId: agent.actorId, state: 'created' });
    await dl.runs.save(run);

    let versioned = await dl.runs.getWithVersion(run.runId);
    expect(versioned!.version).toBe(0);

    await dl.runs.save({ ...run, state: 'evaluating' });
    versioned = await dl.runs.getWithVersion(run.runId);
    expect(versioned!.version).toBe(1);
    expect(versioned!.run.state).toBe('evaluating');
    // The returned Run carries no `version` field — Core sees only its contract.
    expect('version' in versioned!.run).toBe(false);
  });

  it('lists runs', async () => {
    const { agent } = await seedActorAndMission();
    await dl.runs.save(makeRun({ actorId: agent.actorId }));
    await dl.runs.save(makeRun({ actorId: agent.actorId }));
    const runs = await dl.runs.list();
    expect(runs.length).toBe(2);
  });

  it('compareAndSave applies at the expected version and rejects a stale write', async () => {
    const { agent } = await seedActorAndMission();
    const run = makeRun({ actorId: agent.actorId, state: 'created' });
    await dl.runs.save(run);

    const newVersion = await dl.runs.compareAndSave({ ...run, state: 'evaluating' }, 0);
    expect(newVersion).toBe(1);

    // A second writer still holding version 0 must be rejected.
    await expect(
      dl.runs.compareAndSave({ ...run, state: 'executing' }, 0),
    ).rejects.toBeInstanceOf(ConcurrencyError);

    // The stale write did not land.
    const got = await dl.runs.get(run.runId);
    expect(got!.state).toBe('evaluating');
  });

  it('compareAndSave throws NotFound for an absent run', async () => {
    const { agent } = await seedActorAndMission();
    const run = makeRun({ actorId: agent.actorId });
    await expect(dl.runs.compareAndSave(run, 0)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('returns undefined for an unknown run', async () => {
    const got = await dl.runs.get('run_does-not-exist' as RunId);
    expect(got).toBeUndefined();
  });
});
