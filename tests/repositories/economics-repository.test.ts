import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createExecutionObject } from '@aion/core';
import { createTestDataLayer, ensureMigrated, truncateAll } from '../setup/test-db.js';
import {
  makeAgent,
  makeApproval,
  makeCommand,
  makeHuman,
  makeMissionFixture,
  makeRun,
} from '../setup/fixtures.js';
import type { DataLayer } from '../../src/index.js';

describe('PostgresEconomicsRepository', () => {
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

  it('rollupByMission aggregates executions, approvals, cost, revenue, ROI', async () => {
    const agent = makeAgent({
      domain: 'revenue',
      role: 'pipeline-ops',
      tenantId: 'aion-systems',
    });
    const human = makeHuman();
    const mission = makeMissionFixture();
    await dl.actors.save(agent);
    await dl.actors.save(human);
    await dl.missions.save(mission);

    const successRun = makeRun({
      actorId: agent.actorId,
      missionId: mission.missionId,
      state: 'completed',
      riskLevel: 'R1',
    });
    const failRun = makeRun({
      actorId: agent.actorId,
      missionId: mission.missionId,
      state: 'failed',
      riskLevel: 'R1',
    });
    const deniedRun = makeRun({
      actorId: agent.actorId,
      missionId: mission.missionId,
      state: 'denied',
      riskLevel: 'R2',
    });
    const gatedRun = makeRun({
      actorId: agent.actorId,
      missionId: mission.missionId,
      state: 'completed',
      riskLevel: 'R2',
    });
    await dl.runs.save(successRun);
    await dl.runs.save(failRun);
    await dl.runs.save(deniedRun);
    await dl.runs.save(gatedRun);

    const success = createExecutionObject({
      run: successRun,
      agent,
      revenueAttributed: 100,
      result: {
        status: 'succeeded',
        executor: 'test',
        startedAt: '2026-02-01T00:00:00.000Z',
        completedAt: '2026-02-01T00:00:00.010Z',
        durationMs: 10,
        cost: { units: 5, tokens: 50 },
        metadata: {},
      },
    });
    const failed = createExecutionObject({
      run: failRun,
      agent,
      result: {
        status: 'failed',
        executor: 'test',
        startedAt: '2026-02-01T00:00:00.000Z',
        completedAt: '2026-02-01T00:00:00.005Z',
        durationMs: 5,
        cost: { units: 3 },
        error: { code: 'X', message: 'fail', retryable: false },
        metadata: {},
      },
    });
    // Override status — createExecutionObject maps failed run → failed.
    const denied = {
      ...createExecutionObject({ run: deniedRun, agent }),
      status: 'denied' as const,
      cost: { units: 0 },
    };
    const gated = createExecutionObject({
      run: gatedRun,
      agent,
      result: {
        status: 'succeeded',
        executor: 'test',
        startedAt: '2026-02-01T00:00:00.000Z',
        completedAt: '2026-02-01T00:00:00.020Z',
        durationMs: 20,
        cost: { units: 7 },
        metadata: {},
      },
    });
    await dl.executions.save(success);
    await dl.executions.save(failed);
    await dl.executions.save(denied);
    await dl.executions.save(gated);

    const cmd = makeCommand(agent, { missionId: mission.missionId });
    const approval = {
      ...makeApproval(gatedRun, cmd),
      status: 'granted' as const,
      decidedAt: '2026-02-01T01:00:00.000Z',
      decidedBy: human.actorId,
      executionId: gated.executionId,
      tenantId: 'aion-systems',
    };
    await dl.approvals.save(approval);

    await dl.outcomes.create({
      runId: successRun.runId,
      missionId: mission.missionId,
      outcomeType: 'revenue',
      status: 'realized',
      value: 50,
      currency: 'USD',
    });

    const rollup = await dl.economics.rollupByMission(
      mission.missionId,
      'aion-systems',
    );

    expect(rollup.missionId).toBe(mission.missionId);
    expect(rollup.tenantId).toBe('aion-systems');
    expect(rollup.totalExecutions).toBe(4);
    expect(rollup.successCount).toBe(2);
    expect(rollup.failureCount).toBe(1);
    expect(rollup.policyDenials).toBe(1);
    expect(rollup.approvals).toBe(1);
    expect(rollup.humanInterventions).toBe(1);
    expect(rollup.totalCostUnits).toBe(15); // 5+3+0+7
    expect(rollup.totalDurationMs).toBe(35); // 10+5+0+20
    expect(rollup.outcomeCount).toBe(1);
    expect(rollup.attributedEconomicValue).toBe(150); // 100 revenue + 50 outcome
    expect(rollup.roi).toBe(10); // 150/15
  });

  it('rollupByScope aggregates holding (tenant) and company slice', async () => {
    const agent = makeAgent({
      domain: 'revenue',
      role: 'pipeline-ops',
      tenantId: 'aion-systems',
    });
    // Patch company onto agent via save of execution scopes.
    const mission = makeMissionFixture();
    await dl.actors.save(agent);
    await dl.missions.save(mission);

    const runA = makeRun({
      actorId: agent.actorId,
      missionId: mission.missionId,
      state: 'completed',
      riskLevel: 'R1',
    });
    const runB = makeRun({
      actorId: agent.actorId,
      missionId: mission.missionId,
      state: 'completed',
      riskLevel: 'R1',
    });
    await dl.runs.save(runA);
    await dl.runs.save(runB);

    const exeA = {
      ...createExecutionObject({
        run: runA,
        agent,
        companyId: 'co_alpha',
        revenueAttributed: 40,
        result: {
          status: 'succeeded',
          executor: 'test',
          startedAt: '2026-02-01T00:00:00.000Z',
          completedAt: '2026-02-01T00:00:00.010Z',
          durationMs: 10,
          cost: { units: 4 },
          metadata: {},
        },
      }),
      companyId: 'co_alpha',
    };
    const exeB = {
      ...createExecutionObject({
        run: runB,
        agent,
        companyId: 'co_beta',
        revenueAttributed: 10,
        result: {
          status: 'succeeded',
          executor: 'test',
          startedAt: '2026-02-01T00:00:00.000Z',
          completedAt: '2026-02-01T00:00:00.010Z',
          durationMs: 10,
          cost: { units: 6 },
          metadata: {},
        },
      }),
      companyId: 'co_beta',
    };
    await dl.executions.save(exeA);
    await dl.executions.save(exeB);

    const holding = await dl.economics.rollupByScope({
      tenantId: 'aion-systems',
    });
    expect(holding.totalExecutions).toBe(2);
    expect(holding.totalCostUnits).toBe(10);
    expect(holding.attributedEconomicValue).toBe(50);
    expect(holding.roi).toBe(5);

    const company = await dl.economics.rollupByScope({
      tenantId: 'aion-systems',
      companyId: 'co_alpha',
    });
    expect(company.totalExecutions).toBe(1);
    expect(company.totalCostUnits).toBe(4);
    expect(company.attributedEconomicValue).toBe(40);
    expect(company.roi).toBe(10);
  });

  it('tenant filter excludes other tenants from mission rollup', async () => {
    const agentA = makeAgent({ tenantId: 'tenant-a' });
    const agentB = makeAgent({ tenantId: 'tenant-b' });
    const mission = makeMissionFixture();
    await dl.actors.save(agentA);
    await dl.actors.save(agentB);
    await dl.missions.save(mission);

    const runA = makeRun({
      actorId: agentA.actorId,
      missionId: mission.missionId,
      state: 'completed',
      riskLevel: 'R1',
    });
    const runB = makeRun({
      actorId: agentB.actorId,
      missionId: mission.missionId,
      state: 'completed',
      riskLevel: 'R1',
    });
    await dl.runs.save(runA);
    await dl.runs.save(runB);

    await dl.executions.save(
      createExecutionObject({
        run: runA,
        agent: agentA,
        revenueAttributed: 10,
        result: {
          status: 'succeeded',
          executor: 'test',
          startedAt: '2026-02-01T00:00:00.000Z',
          completedAt: '2026-02-01T00:00:00.001Z',
          durationMs: 1,
          cost: { units: 1 },
          metadata: {},
        },
      }),
    );
    await dl.executions.save(
      createExecutionObject({
        run: runB,
        agent: agentB,
        revenueAttributed: 99,
        result: {
          status: 'succeeded',
          executor: 'test',
          startedAt: '2026-02-01T00:00:00.000Z',
          completedAt: '2026-02-01T00:00:00.001Z',
          durationMs: 1,
          cost: { units: 9 },
          metadata: {},
        },
      }),
    );

    const rollup = await dl.economics.rollupByMission(mission.missionId, 'tenant-a');
    expect(rollup.totalExecutions).toBe(1);
    expect(rollup.totalCostUnits).toBe(1);
    expect(rollup.attributedEconomicValue).toBe(10);
  });
});
