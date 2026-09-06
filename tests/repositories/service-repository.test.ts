import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildMission001Catalog, buildMission002Catalog } from '@aion/core';
import { createTestDataLayer, ensureMigrated, truncateAll } from '../setup/test-db.js';
import type { DataLayer } from '../../src/index.js';

describe('PostgresServiceRepository', () => {
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

  it('round-trips a service definition by key', async () => {
    const [svc] = buildMission001Catalog();
    await dl.services.save(svc!);
    const got = await dl.services.getByKey(svc!.serviceKey);
    expect(got).toEqual(svc);
    expect(got!.capability).toBe(svc!.name);
  });

  it('seeds Mission 001 catalog idempotently', async () => {
    const first = await dl.services.seedMission001();
    expect(first.inserted).toBe(11);
    expect(first.total).toBe(11);

    const second = await dl.services.seedMission001();
    expect(second.inserted).toBe(0);

    const active = await dl.services.list('active');
    expect(active).toHaveLength(11);
    expect(active.map((s) => s.serviceKey).sort()).toEqual([
      'revenue.context@1',
      'revenue.conversationstate@1',
      'revenue.extraction@1',
      'revenue.followup.execute@1',
      'revenue.lead.enrich@1',
      'revenue.lead.research@1',
      'revenue.lead.score@1',
      'revenue.nextaction@1',
      'revenue.objection@1',
      'revenue.outreach.generate@1',
      'revenue.signals@1',
    ]);
  });

  it('seeds Mission 002 Media catalog idempotently alongside Mission 001', async () => {
    await dl.services.seedMission001();
    const first = await dl.services.seedMission002();
    expect(first.inserted).toBe(6);
    expect(first.total).toBe(6);
    const second = await dl.services.seedMission002();
    expect(second.inserted).toBe(0);
    const active = await dl.services.list('active');
    expect(active).toHaveLength(17);
    expect(active.map((s) => s.serviceKey)).toEqual(
      expect.arrayContaining([
        'media.trend.research@1',
        'media.post.publish@1',
        'revenue.lead.research@1',
      ]),
    );
  });

});
