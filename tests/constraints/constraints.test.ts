import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MappingError } from '../../src/index.js';
import { createTestDataLayer, ensureMigrated, truncateAll } from '../setup/test-db.js';
import { makeAgent, makeMissionFixture, makeRun } from '../setup/fixtures.js';
import type { DataLayer } from '../../src/index.js';

/**
 * CONSTRAINT_ENFORCEMENT: the database rejects values Core would never produce,
 * foreign keys hold, decision states cannot be contradictory, and the mapper
 * refuses to hand Core an object that fails the Core contract.
 */
describe('database constraints & mapper validation', () => {
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
    return { agent, mission, run };
  }

  it('rejects an invalid mission status (enum CHECK)', async () => {
    await expect(
      dl.pool.query(
        `INSERT INTO missions (mission_id, name, owner, objective, status, created_at)
         VALUES ('msn_x', 'n', 'o', 'obj', 'not-a-status', now())`,
      ),
    ).rejects.toThrow();
  });

  it('rejects an invalid run risk level (enum CHECK)', async () => {
    const { agent } = await seedRun();
    await expect(
      dl.pool.query(
        `INSERT INTO runs (run_id, request_id, command_id, actor_id, state, risk_level,
           correlation_id, created_at, updated_at)
         VALUES ('run_bad', 'req_1', 'cmd_1', $1, 'created', 'R9', 'cor_1', now(), now())`,
        [agent.actorId],
      ),
    ).rejects.toThrow();
  });

  it('rejects a run referencing a non-existent actor (foreign key)', async () => {
    await expect(
      dl.pool.query(
        `INSERT INTO runs (run_id, request_id, command_id, actor_id, state,
           correlation_id, created_at, updated_at)
         VALUES ('run_fk', 'req_1', 'cmd_1', 'act_missing', 'created', 'cor_1', now(), now())`,
      ),
    ).rejects.toThrow();
  });

  it('rejects an approval referencing a non-existent run (foreign key)', async () => {
    await expect(
      dl.pool.query(
        `INSERT INTO approvals (approval_id, run_id, request_id, command_snapshot,
           risk_level, reason, status, requested_at)
         VALUES ('apr_x', 'run_missing', 'req_1', '{}'::jsonb, 'R3', 'why', 'pending', now())`,
      ),
    ).rejects.toThrow();
  });

  it('rejects a contradictory approval (granted with no decider/time)', async () => {
    const { run } = await seedRun();
    await expect(
      dl.pool.query(
        `INSERT INTO approvals (approval_id, run_id, request_id, command_snapshot,
           risk_level, reason, status, requested_at, decided_at, decided_by)
         VALUES ('apr_bad', $1, 'req_1', '{}'::jsonb, 'R3', 'why', 'granted', now(), NULL, NULL)`,
        [run.runId],
      ),
    ).rejects.toThrow();
  });

  it('rejects an agent actor missing its governance fields (coherence CHECK)', async () => {
    await expect(
      dl.pool.query(
        `INSERT INTO actors (actor_id, actor_type, name)
         VALUES ('act_bad_agent', 'agent', 'NoGovernance')`,
      ),
    ).rejects.toThrow();
  });

  it('rejects an outcome with a currency but no value (coherence CHECK)', async () => {
    const { run } = await seedRun();
    await expect(
      dl.pool.query(
        `INSERT INTO outcomes (outcome_id, run_id, status, currency)
         VALUES ('out_bad', $1, 'pending', 'USD')`,
        [run.runId],
      ),
    ).rejects.toThrow();
  });

  it('rejects a duplicate primary key (raw insert)', async () => {
    await dl.pool.query(
      `INSERT INTO missions (mission_id, name, owner, objective, created_at)
       VALUES ('msn_dup', 'n', 'o', 'obj', now())`,
    );
    await expect(
      dl.pool.query(
        `INSERT INTO missions (mission_id, name, owner, objective, created_at)
         VALUES ('msn_dup', 'n2', 'o', 'obj', now())`,
      ),
    ).rejects.toThrow();
  });

  it('mapper refuses to return data that fails the Core contract (MappingError)', async () => {
    // A permission string that violates Core's capability taxonomy is allowed by
    // the jsonb column but rejected by the Core Actor schema on read.
    await dl.pool.query(
      `INSERT INTO actors (actor_id, actor_type, name, permissions)
       VALUES ('act_corrupt', 'human', 'Corrupt', '["NOT a capability"]'::jsonb)`,
    );
    await expect(dl.actors.get('act_corrupt' as never)).rejects.toBeInstanceOf(MappingError);
  });
});
