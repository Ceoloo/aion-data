import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDataLayer, ensureMigrated, truncateAll } from '../setup/test-db.js';
import { makeAgent, makeHuman } from '../setup/fixtures.js';
import type { DataLayer } from '../../src/index.js';

// Actor round-trip for both a plain (human) actor and a governed agent.
describe('PostgresActorRepository', () => {
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

  it('round-trips a human actor without agent governance fields', async () => {
    const human = makeHuman('Dana');
    await dl.actors.save(human);
    const got = await dl.actors.get(human.actorId);
    expect(got).toEqual(human);
    expect(got!.actorType).toBe('human');
  });

  it('round-trips a governed agent with all governance fields', async () => {
    const agent = makeAgent({ permissions: ['deployment.execute', 'research.web'], maxRiskLevel: 'R2' });
    await dl.actors.save(agent);
    const got = await dl.actors.get(agent.actorId);

    expect(got).toEqual(agent);
    if (!got || got.actorType !== 'agent') throw new Error('expected agent');
    expect(got.agentId).toBe(agent.agentId);
    expect(got.purpose).toBe(agent.purpose);
    expect(got.owner).toBe(agent.owner);
    expect(got.defaultRiskLevel).toBe('R1');
    expect(got.maxRiskLevel).toBe('R2');
    expect(got.permissions).toEqual(agent.permissions);
    expect(got.escalationConditions).toEqual(agent.escalationConditions);
    expect(got.costBudget).toBe(100);
  });

  it('upserts and lists actors', async () => {
    const human = makeHuman('Eve');
    await dl.actors.save(human);
    await dl.actors.save({ ...human, name: 'Eve Renamed' });
    const list = await dl.actors.list();
    expect(list.length).toBe(1);
    expect(list[0]!.name).toBe('Eve Renamed');
  });
});
