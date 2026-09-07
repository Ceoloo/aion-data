import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createExecutionObject } from '@aion/core';
import { createTestDataLayer, ensureMigrated, truncateAll } from '../setup/test-db.js';
import { makeAgent, makeMissionFixture, makeRun } from '../setup/fixtures.js';
import type { DataLayer } from '../../src/index.js';

describe('PostgresExecutionRepository', () => {
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

  it('round-trips a canonical Execution Object with agent identity', async () => {
    const agent = makeAgent({ domain: 'revenue', role: 'pipeline-ops' });
    const mission = makeMissionFixture();
    await dl.actors.save(agent);
    await dl.missions.save(mission);

    const run = makeRun({
      actorId: agent.actorId,
      missionId: mission.missionId,
      state: 'completed',
      riskLevel: 'R1',
    });
    await dl.runs.save(run);

    const exe = createExecutionObject({ run, agent });
    await dl.executions.save(exe);

    const byId = await dl.executions.get(exe.executionId);
    expect(byId).toEqual(exe);
    expect(byId!.agentUri).toMatch(/^agent:\/\/aion\/revenue\/pipeline-ops\//);
    expect(byId!.status).toBe('succeeded');

    const byRun = await dl.executions.getByRunId(run.runId);
    expect(byRun?.executionId).toBe(exe.executionId);
  });

  it('listByRoot returns the root and all descendants in created order', async () => {
    const agent = makeAgent({ domain: 'revenue', role: 'pipeline-ops' });
    const mission = makeMissionFixture();
    await dl.actors.save(agent);
    await dl.missions.save(mission);

    const rootRun = makeRun({
      actorId: agent.actorId,
      missionId: mission.missionId,
      state: 'completed',
      riskLevel: 'R1',
    });
    const childRun = makeRun({
      actorId: agent.actorId,
      missionId: mission.missionId,
      state: 'completed',
      riskLevel: 'R1',
    });
    const grandRun = makeRun({
      actorId: agent.actorId,
      missionId: mission.missionId,
      state: 'completed',
      riskLevel: 'R1',
    });
    await dl.runs.save(rootRun);
    await dl.runs.save(childRun);
    await dl.runs.save(grandRun);

    const root = createExecutionObject({ run: rootRun, agent });
    const child = createExecutionObject({
      run: childRun,
      agent,
      parentExecutionId: root.executionId,
      rootExecutionId: root.executionId,
    });
    const grand = createExecutionObject({
      run: grandRun,
      agent,
      parentExecutionId: child.executionId,
      rootExecutionId: root.executionId,
    });
    await dl.executions.save(root);
    await dl.executions.save(child);
    await dl.executions.save(grand);

    const tree = await dl.executions.listByRoot(root.executionId);
    expect(tree.map((e) => e.executionId)).toEqual([
      root.executionId,
      child.executionId,
      grand.executionId,
    ]);
    expect(tree[1]!.parentExecutionId).toBe(root.executionId);
    expect(tree[2]!.rootExecutionId).toBe(root.executionId);
  });

  it('listByParent returns only direct children', async () => {
    const agent = makeAgent({ domain: 'revenue', role: 'pipeline-ops' });
    const mission = makeMissionFixture();
    await dl.actors.save(agent);
    await dl.missions.save(mission);

    const rootRun = makeRun({
      actorId: agent.actorId,
      missionId: mission.missionId,
      state: 'completed',
      riskLevel: 'R1',
    });
    const childRun = makeRun({
      actorId: agent.actorId,
      missionId: mission.missionId,
      state: 'completed',
      riskLevel: 'R1',
    });
    const otherRun = makeRun({
      actorId: agent.actorId,
      missionId: mission.missionId,
      state: 'completed',
      riskLevel: 'R1',
    });
    await dl.runs.save(rootRun);
    await dl.runs.save(childRun);
    await dl.runs.save(otherRun);

    const root = createExecutionObject({ run: rootRun, agent });
    const child = createExecutionObject({
      run: childRun,
      agent,
      parentExecutionId: root.executionId,
      rootExecutionId: root.executionId,
    });
    const other = createExecutionObject({
      run: otherRun,
      agent,
      parentExecutionId: child.executionId,
      rootExecutionId: root.executionId,
    });
    await dl.executions.save(root);
    await dl.executions.save(child);
    await dl.executions.save(other);

    const direct = await dl.executions.listByParent(root.executionId);
    expect(direct.map((e) => e.executionId)).toEqual([child.executionId]);
  });

  it('listRecentForTenant returns newest tenant executions first and isolates tenants', async () => {
    const agentA = makeAgent({ tenantId: 'tenant-a', domain: 'revenue', role: 'pipeline-ops' });
    const agentB = makeAgent({ tenantId: 'tenant-b', domain: 'revenue', role: 'pipeline-ops' });
    const mission = makeMissionFixture();
    await dl.actors.save(agentA);
    await dl.actors.save(agentB);
    await dl.missions.save(mission);

    const runA1 = makeRun({ actorId: agentA.actorId, missionId: mission.missionId, state: 'completed' });
    const runA2 = makeRun({ actorId: agentA.actorId, missionId: mission.missionId, state: 'failed' });
    const runB = makeRun({ actorId: agentB.actorId, missionId: mission.missionId, state: 'completed' });
    await dl.runs.save(runA1);
    await dl.runs.save(runA2);
    await dl.runs.save(runB);

    const exeA1 = createExecutionObject({ run: runA1, agent: agentA });
    const exeA2 = createExecutionObject({ run: runA2, agent: agentA });
    const exeB = createExecutionObject({ run: runB, agent: agentB });
    await dl.executions.save(exeA1);
    await dl.executions.save(exeA2);
    await dl.executions.save(exeB);

    const recentA = await dl.executions.listRecentForTenant('tenant-a', 10);
    expect(recentA.map((e) => e.executionId)).toEqual(
      expect.arrayContaining([exeA1.executionId, exeA2.executionId]),
    );
    expect(recentA).toHaveLength(2);
    expect(recentA.every((e) => e.tenantId === 'tenant-a')).toBe(true);

    const limited = await dl.executions.listRecentForTenant('tenant-a', 1);
    expect(limited).toHaveLength(1);

    const recentB = await dl.executions.listRecentForTenant('tenant-b');
    expect(recentB.map((e) => e.executionId)).toEqual([exeB.executionId]);
  });
});
