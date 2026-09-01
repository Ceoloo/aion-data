import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDataLayer, ensureMigrated, truncateAll } from '../setup/test-db.js';
import { makeAgent, makeEvent, makeMissionFixture, makeRun } from '../setup/fixtures.js';
import type { DataLayer } from '../../src/index.js';
import { newCorrelationId } from '@aion/core';

// EVENT_APPEND + append-only idempotency + ordered retrieval.
describe('PostgresEventSink', () => {
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

  it('appends an event and reads it back, preserving payload/lineage', async () => {
    const { run, mission } = await seedRun();
    const correlationId = newCorrelationId();
    const event = makeEvent({
      eventType: 'execution.completed',
      runId: run.runId,
      missionId: mission.missionId,
      correlationId,
      payload: { executor: 'mock', status: 'succeeded' },
    });

    await dl.events.emit(event);
    const got = await dl.events.listByRun(run.runId);

    expect(got.length).toBe(1);
    expect(got[0]).toEqual(event);
    expect(got[0]!.payload).toEqual({ executor: 'mock', status: 'succeeded' });
    expect(got[0]!.correlationId).toBe(correlationId);
  });

  it('is idempotent on duplicate event id (append-only, no duplicate, no mutation)', async () => {
    const { run } = await seedRun();
    const event = makeEvent({ eventType: 'command.received', runId: run.runId, payload: { v: 1 } });

    await dl.events.emit(event);
    // Re-deliver the same event id with a different payload — must be ignored.
    await dl.events.emit({ ...event, payload: { v: 999 } });

    const got = await dl.events.listByRun(run.runId);
    expect(got.length).toBe(1);
    expect(got[0]!.payload).toEqual({ v: 1 }); // original preserved
  });

  it('retrieves events for a run in durable insertion order', async () => {
    const { run } = await seedRun();
    const types = ['command.received', 'policy.allowed', 'execution.started', 'execution.completed'] as const;
    for (const eventType of types) {
      await dl.events.emit(makeEvent({ eventType, runId: run.runId }));
    }
    const got = await dl.events.listByRun(run.runId);
    expect(got.map((e) => e.eventType)).toEqual([...types]);
  });

  it('filters by type and by mission', async () => {
    const { run, mission } = await seedRun();
    await dl.events.emit(makeEvent({ eventType: 'policy.denied', runId: run.runId, missionId: mission.missionId }));
    await dl.events.emit(makeEvent({ eventType: 'command.received', runId: run.runId, missionId: mission.missionId }));

    expect((await dl.events.listByType('policy.denied')).length).toBe(1);
    expect((await dl.events.listByMission(mission.missionId)).length).toBe(2);
  });
});
