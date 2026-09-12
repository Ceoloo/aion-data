import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PostgresRevenueSessionRepository, type DataLayer } from '../../src/index.js';
import { createTestDataLayer, ensureMigrated, truncateAll } from '../setup/test-db.js';

describe('durable revenue sessions', () => {
  let dl: DataLayer;
  let sessions: PostgresRevenueSessionRepository;

  beforeAll(async () => {
    dl = createTestDataLayer();
    await ensureMigrated(dl);
    sessions = new PostgresRevenueSessionRepository(dl.pool);
  });
  beforeEach(async () => {
    await truncateAll(dl);
  });
  afterAll(async () => {
    await dl.close();
  });

  it('create → save checkpoint → finalize → rejects stale writers', async () => {
    await sessions.create('rev_p0', { version: 1, turns: ['hello'] });

    const created = (await sessions.get('rev_p0'))!;
    expect(created.checkpoint).toEqual({ version: 1, turns: ['hello'] });
    expect(created.finalRecord).toBeNull();
    expect(created.revision).toBe(0);
    expect(await sessions.listActive()).toEqual(['rev_p0']);

    await sessions.save({
      ...created,
      checkpoint: { version: 1, turns: ['hello', 'qualify'] },
    });

    const checkpointed = (await sessions.get('rev_p0'))!;
    expect(checkpointed.revision).toBe(1);
    expect(checkpointed.checkpoint).toEqual({ version: 1, turns: ['hello', 'qualify'] });

    // Stale writer still holding revision 0 must fail while session is active.
    await expect(sessions.save(created)).rejects.toThrow(/stale|finalized/);

    await sessions.save({
      ...checkpointed,
      checkpoint: null,
      finalRecord: { sessionId: 'rev_p0', closed: true },
    });

    expect(await sessions.listActive()).toEqual([]);
    expect(await sessions.listFinalized()).toEqual([{ sessionId: 'rev_p0', closed: true }]);

    const finalized = (await sessions.get('rev_p0'))!;
    expect(finalized.checkpoint).toBeNull();
    expect(finalized.revision).toBe(2);

    // Checkpoint writer or resurrect attempt after finalize must fail.
    await expect(
      sessions.save({
        ...checkpointed,
        revision: 2,
        checkpoint: { version: 1, turns: ['resurrect'] },
        finalRecord: null,
      }),
    ).rejects.toThrow(/stale|finalized/);
  });

  it('recovers checkpoints through a fresh repository and rejects stale writers', async () => {
    await sessions.create('call', { version: 1, turns: ['acknowledged'] });
    const row = (await new PostgresRevenueSessionRepository(dl.pool).get('call'))!;
    expect(row.checkpoint).toEqual({ version: 1, turns: ['acknowledged'] });
    await sessions.save({ ...row, checkpoint: { version: 1, turns: ['acknowledged', 'next'] } });
    await expect(sessions.save(row)).rejects.toThrow('stale');
  });

  it('finalizes atomically and prevents resurrection', async () => {
    await sessions.create('call', { version: 1 });
    const row = (await sessions.get('call'))!;
    await sessions.save({ ...row, checkpoint: null, finalRecord: { sessionId: 'call' } });
    expect(await sessions.listActive()).toEqual([]);
    expect(await sessions.listFinalized()).toEqual([{ sessionId: 'call' }]);
    await expect(sessions.save({ ...row, revision: 1 })).rejects.toThrow('finalized');
  });
});
