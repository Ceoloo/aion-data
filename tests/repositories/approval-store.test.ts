import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDataLayer, ensureMigrated, truncateAll } from '../setup/test-db.js';
import { makeAgent, makeApproval, makeCommand, makeMissionFixture, makeRun, makeHuman } from '../setup/fixtures.js';
import type { DataLayer } from '../../src/index.js';

// APPROVAL_DURABILITY: round-trip incl. the immutable command snapshot.
describe('PostgresApprovalStore', () => {
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

  async function seed() {
    const agent = makeAgent();
    const human = makeHuman();
    const mission = makeMissionFixture();
    await dl.actors.save(agent);
    await dl.actors.save(human);
    await dl.missions.save(mission);
    const command = makeCommand(agent, { missionId: mission.missionId });
    const run = makeRun({
      actorId: agent.actorId,
      missionId: mission.missionId,
      commandId: command.commandId,
      requestId: command.requestId,
      state: 'awaiting_approval',
      riskLevel: 'R3',
    });
    await dl.runs.save(run);
    return { agent, human, mission, command, run };
  }

  it('round-trips a pending approval with the full command snapshot', async () => {
    const { command, run } = await seed();
    const approval = makeApproval(run, command);

    await dl.approvals.save(approval);
    const got = await dl.approvals.get(approval.approvalId);

    expect(got).toEqual(approval);
    // The proposed command is preserved verbatim — the run can resume from it.
    expect(got!.command).toEqual(command);
    expect(got!.command.payload).toEqual({ target: 'prod', build: 42 });
  });

  it('records a decision coherently (granted with decider and time)', async () => {
    const { command, run, human } = await seed();
    const approval = makeApproval(run, command);
    await dl.approvals.save(approval);

    const granted = {
      ...approval,
      status: 'granted' as const,
      decidedAt: '2026-02-01T01:00:00.000Z',
      decidedBy: human.actorId,
      note: 'looks good',
    };
    await dl.approvals.save(granted);

    const got = await dl.approvals.get(approval.approvalId);
    expect(got!.status).toBe('granted');
    expect(got!.decidedBy).toBe(human.actorId);
    expect(got!.decidedAt).toBe('2026-02-01T01:00:00.000Z');
    expect(got!.note).toBe('looks good');
  });

  it('lists by status and by run', async () => {
    const { command, run } = await seed();
    const a1 = makeApproval(run, command);
    await dl.approvals.save(a1);

    const pending = await dl.approvals.list('pending');
    expect(pending.map((a) => a.approvalId)).toContain(a1.approvalId);

    const forRun = await dl.approvals.listByRun(run.runId);
    expect(forRun.length).toBe(1);

    const grantedList = await dl.approvals.list('granted');
    expect(grantedList).toEqual([]);
  });

  it('returns undefined for an unknown approval', async () => {
    const { command, run } = await seed();
    const approval = makeApproval(run, command);
    const got = await dl.approvals.get(approval.approvalId);
    expect(got).toBeUndefined();
  });
});
