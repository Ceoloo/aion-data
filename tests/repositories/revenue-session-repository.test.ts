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
  beforeEach(async () => { await truncateAll(dl); });
  afterAll(async () => { await dl.close(); });
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
