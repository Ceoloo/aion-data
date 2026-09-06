import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createExecutionObject } from '@aion/core';
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

  it('listForTenant filters by tenant_id and optional status', async () => {
    const agent = makeAgent({ tenantId: 'tenant-a' });
    const otherAgent = makeAgent({ tenantId: 'tenant-b' });
    const human = makeHuman();
    const mission = makeMissionFixture();
    await dl.actors.save(agent);
    await dl.actors.save(otherAgent);
    await dl.actors.save(human);
    await dl.missions.save(mission);

    const commandA = makeCommand(agent, { missionId: mission.missionId });
    const runA = makeRun({
      actorId: agent.actorId,
      missionId: mission.missionId,
      commandId: commandA.commandId,
      requestId: commandA.requestId,
      state: 'awaiting_approval',
      riskLevel: 'R3',
    });
    await dl.runs.save(runA);
    const exeA = createExecutionObject({ run: runA, agent });
    await dl.executions.save(exeA);

    const approvalA = {
      ...makeApproval(runA, commandA),
      tenantId: 'tenant-a',
      executionId: exeA.executionId,
    };
    await dl.approvals.save(approvalA);

    const commandB = makeCommand(otherAgent, { missionId: mission.missionId });
    const runB = makeRun({
      actorId: otherAgent.actorId,
      missionId: mission.missionId,
      commandId: commandB.commandId,
      requestId: commandB.requestId,
      state: 'awaiting_approval',
      riskLevel: 'R3',
    });
    await dl.runs.save(runB);
    const exeB = createExecutionObject({ run: runB, agent: otherAgent });
    await dl.executions.save(exeB);
    const approvalB = {
      ...makeApproval(runB, commandB),
      tenantId: 'tenant-b',
      executionId: exeB.executionId,
      status: 'granted' as const,
      decidedAt: '2026-02-01T01:00:00.000Z',
      decidedBy: human.actorId,
    };
    await dl.approvals.save(approvalB);

    const forA = await dl.approvals.listForTenant('tenant-a');
    expect(forA.map((a) => a.approvalId)).toEqual([approvalA.approvalId]);

    const pendingA = await dl.approvals.listForTenant('tenant-a', 'pending');
    expect(pendingA).toHaveLength(1);
    expect(pendingA[0]!.status).toBe('pending');

    const pendingB = await dl.approvals.listForTenant('tenant-b', 'pending');
    expect(pendingB).toEqual([]);

    const grantedB = await dl.approvals.listForTenant('tenant-b', 'granted');
    expect(grantedB.map((a) => a.approvalId)).toEqual([approvalB.approvalId]);
  });

  it('returns undefined for an unknown approval', async () => {
    const { command, run } = await seed();
    const approval = makeApproval(run, command);
    const got = await dl.approvals.get(approval.approvalId);
    expect(got).toBeUndefined();
  });
});
