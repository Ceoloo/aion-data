import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createMission } from '@aion/core';
import { createTestDataLayer, ensureMigrated, truncateAll } from '../setup/test-db.js';
import type { DataLayer } from '../../src/index.js';

// MISSION_ROUND_TRIP + JSON metadata + timestamp + upsert semantics.
describe('PostgresMissionRepository', () => {
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

  it('round-trips a mission preserving every field, id, and metadata', async () => {
    const mission = createMission({
      name: 'Launch',
      owner: 'growth',
      objective: 'ship the thing',
      description: 'a fuller description',
      successCriteria: ['users notice', 'no incidents'],
      riskLevel: 'R2',
      metadata: { nested: { a: 1 }, tags: ['x', 'y'] },
    });

    await dl.missions.save(mission);
    const got = await dl.missions.get(mission.missionId);

    expect(got).toBeDefined();
    expect(got).toEqual(mission);
    expect(got!.createdAt).toBe(mission.createdAt); // ISO timestamp preserved
    expect(got!.metadata).toEqual({ nested: { a: 1 }, tags: ['x', 'y'] });
  });

  it('returns undefined for an unknown mission', async () => {
    const mission = createMission({ name: 'x', owner: 'o', objective: 'obj' });
    const got = await dl.missions.get(mission.missionId);
    expect(got).toBeUndefined();
  });

  it('save is an idempotent upsert (last write wins, no duplicate row)', async () => {
    const mission = createMission({ name: 'v1', owner: 'o', objective: 'obj' });
    await dl.missions.save(mission);
    await dl.missions.save({ ...mission, name: 'v2', status: 'paused' });

    const got = await dl.missions.get(mission.missionId);
    expect(got!.name).toBe('v2');
    expect(got!.status).toBe('paused');

    const { rows } = await dl.pool.query('SELECT count(*)::int AS n FROM missions');
    expect(rows[0].n).toBe(1);
  });
});
