import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  MockExecutionAdapter,
  capability,
  createExecutionObject,
  newExecutionId,
} from '@aion/core';
import type { PolicyEngineConfig } from '@aion/core';
import {
  createDataLayer,
  toOutcomeReference,
  type DataLayer,
} from '../../src/index.js';
import { buildPostgresControlPlane } from '../setup/orchestrator.js';
import {
  createTestDataLayer,
  ensureMigrated,
  testConnectionString,
  truncateAll,
} from '../setup/test-db.js';
import { makeAgent, makeHuman, makeMissionFixture } from '../setup/fixtures.js';

/**
 * EXECUTION_OBJECT_RESTART_DURABILITY — the Runtime Agent vertical slice.
 *
 * Proves the canonical Execution Object (`aion_execution`) — not only the Run —
 * is the durable unit of machine labor across a process restart:
 *
 *   1. submit gated work → persist Execution Object with a stable executionId
 *   2. discard process (close data layer + control plane)
 *   3. rebuild over the same Postgres
 *   4. reload the SAME Execution Object by id (status awaiting_approval)
 *   5. resume → same executionId transitions to succeeded
 *   6. record a durable business Outcome and expose it on the Execution Object
 *   7. canonical events + trace continuity hold across the restart boundary
 *
 * Mirrors what aion-runtime's Execution Gateway does with createExecutionObject
 * + executions.save, using Core contracts only.
 */
describe('durability: Execution Object survives restart with stable id + outcome', () => {
  const CAP = 'deployment.execute';
  const policy: PolicyEngineConfig = {
    risk: { capabilityRisk: { [CAP]: 'R3' } },
  };
  const adapters = () => [
    new MockExecutionAdapter({
      name: 'mock-deploy-runtime',
      capabilities: [capability(CAP)],
      output: { deployed: true },
      model: 'mock-model-v1',
      cost: { units: 5, tokens: 200 },
    }),
  ];

  let seed: DataLayer;

  beforeAll(async () => {
    seed = createTestDataLayer();
    await ensureMigrated(seed);
  });
  beforeEach(async () => {
    await truncateAll(seed);
  });
  afterEach(async () => {
    await truncateAll(seed);
  });

  it('persists a stable executionId, state machine, events, completion, and outcome across restart', async () => {
    // ── Pre-restart process ────────────────────────────────────────────────
    const dl1 = createDataLayer({ connectionString: testConnectionString() });
    const worker = makeAgent({
      permissions: [CAP],
      maxRiskLevel: 'R3',
      domain: 'revenue',
      role: 'pipeline-ops',
    });
    const human = makeHuman('Release Manager');
    const mission = makeMissionFixture({ riskLevel: 'R2' });
    await dl1.actors.save(worker);
    await dl1.actors.save(human);
    await dl1.missions.save(mission);

    const plane1 = buildPostgresControlPlane(dl1, { policy, adapters: adapters() });
    const stableExecutionId = newExecutionId();

    const submitted = await plane1.orchestrator.submit({
      name: 'DeployService',
      actor: worker,
      capability: capability(CAP),
      missionId: mission.missionId,
      executionId: stableExecutionId,
      payload: { target: 'prod', build: 42 },
    });

    expect(submitted.status).toBe('awaiting_approval');
    expect(submitted.run.state).toBe('awaiting_approval');
    expect(submitted.approval).toBeDefined();
    expect(submitted.command.executionId).toBe(stableExecutionId);

    // Gateway-equivalent: materialize the canonical Execution Object now.
    const pausedExe = createExecutionObject({
      run: submitted.run,
      agent: worker,
      executionId: stableExecutionId,
      outcomeSummary: 'awaiting human gate before deploy',
      auditTrace: [
        {
          at: submitted.run.createdAt,
          event: 'execution.created',
          detail: { runId: submitted.run.runId, state: submitted.run.state },
        },
        {
          at: submitted.run.updatedAt,
          event: 'approval.requested',
          detail: { approvalId: submitted.approval!.approvalId },
        },
      ],
    });
    await dl1.executions.save(pausedExe);

    expect(pausedExe.executionId).toBe(stableExecutionId);
    expect(pausedExe.status).toBe('awaiting_approval');
    expect(pausedExe.runId).toBe(submitted.run.runId);

    const runId = submitted.run.runId;
    const correlationId = submitted.run.correlationId;
    const approvalId = submitted.approval!.approvalId;

    // ── Simulate process restart: only Postgres survives. ──────────────────
    await dl1.close();

    const dl2 = createDataLayer({ connectionString: testConnectionString() });
    const plane2 = buildPostgresControlPlane(dl2, { policy, adapters: adapters() });

    // Stable execution id remains queryable after restart.
    const reloadedExe = await dl2.executions.get(stableExecutionId);
    expect(reloadedExe).toBeDefined();
    expect(reloadedExe!.executionId).toBe(stableExecutionId);
    expect(reloadedExe!.status).toBe('awaiting_approval');
    expect(reloadedExe!.runId).toBe(runId);
    expect(reloadedExe!.correlationId).toBe(correlationId);
    expect(reloadedExe!.outcomeSummary).toBe('awaiting human gate before deploy');

    const byRun = await dl2.executions.getByRunId(runId);
    expect(byRun?.executionId).toBe(stableExecutionId);

    const reloadedRun = await dl2.runs.get(runId);
    expect(reloadedRun!.state).toBe('awaiting_approval');

    // ── Resume after restart → same run + same executionId complete. ───────
    const resumed = await plane2.orchestrator.resume({
      approvalId,
      approve: true,
      decidedBy: human.actorId,
    });

    expect(resumed.status).toBe('completed');
    expect(resumed.run.runId).toBe(runId);
    expect(resumed.run.state).toBe('completed');
    expect(resumed.result?.status).toBe('succeeded');
    expect(resumed.command.executionId).toBe(stableExecutionId);
    expect(resumed.outcomeReference).toBeDefined();

    // Durable business outcome (distinct from execution result), then expose it
    // on the Execution Object — the production vertical-slice contract.
    const outcome = await dl2.outcomes.create({
      runId,
      missionId: mission.missionId,
      status: 'realized',
      outcomeType: 'deployment',
      value: 14,
      currency: 'USD',
      externalReference: 'conversion_report_q1',
      measuredAt: resumed.run.updatedAt,
    });
    const outcomeReference = toOutcomeReference(outcome);

    const completedExe = createExecutionObject({
      run: resumed.run,
      agent: worker,
      result: resumed.result,
      executionId: stableExecutionId,
      outcomeId: outcome.outcomeId,
      outcomeSummary: 'deploy realized — conversion +14 USD',
      revenueAttributed: 14,
      auditTrace: [
        ...(reloadedExe!.auditTrace ?? []),
        {
          at: resumed.run.updatedAt,
          event: 'approval.granted',
          detail: { approvalId },
        },
        {
          at: resumed.run.updatedAt,
          event: 'execution.completed',
          detail: { units: resumed.result?.cost.units ?? 0 },
        },
        {
          at: resumed.run.updatedAt,
          event: 'outcome.recorded',
          detail: { outcomeId: outcome.outcomeId, status: outcome.status },
        },
      ],
    });
    await dl2.executions.save(completedExe);

    const finalExe = await dl2.executions.get(stableExecutionId);
    expect(finalExe).toBeDefined();
    expect(finalExe!.executionId).toBe(stableExecutionId);
    expect(finalExe!.status).toBe('succeeded');
    expect(finalExe!.outcomeId).toBe(outcome.outcomeId);
    expect(finalExe!.outcomeSummary).toBe('deploy realized — conversion +14 USD');
    expect(finalExe!.revenueAttributed).toBe(14);
    expect(finalExe!.cost.units).toBe(5);
    expect(finalExe!.auditTrace.some((e) => e.event === 'outcome.recorded')).toBe(true);

    // Only one Execution Object and one Run — no duplicate after restart/resume.
    expect((await dl2.runs.list()).length).toBe(1);
    expect((await dl2.executions.listRecentForTenant(worker.tenantId!, 10)).length).toBe(1);

    // Canonical events + TRACE_CONTINUITY across the restart boundary.
    const events = await dl2.events.listByRun(runId);
    const eventTypes = events.map((e) => e.eventType);
    expect(eventTypes).toContain('command.received');
    expect(eventTypes).toContain('approval.requested');
    expect(eventTypes).toContain('approval.granted');
    expect(eventTypes).toContain('execution.started');
    expect(eventTypes).toContain('execution.completed');
    expect(events.every((e) => e.correlationId === correlationId)).toBe(true);

    // Outcome is exposable as a Core OutcomeReference.
    expect(outcomeReference.outcomeId).toBe(outcome.outcomeId);
    expect(outcomeReference.runId).toBe(runId);
    expect(outcomeReference.status).toBe('realized');
    expect((await dl2.outcomes.listByRun(runId))[0]!.outcomeId).toBe(outcome.outcomeId);

    await dl2.close();
  });

  it('records failed Execution Object status + execution.failed across a rebuild', async () => {
    const dl1 = createDataLayer({ connectionString: testConnectionString() });
    const worker = makeAgent({ permissions: [CAP], maxRiskLevel: 'R2' });
    const mission = makeMissionFixture();
    await dl1.actors.save(worker);
    await dl1.missions.save(mission);

    const plane1 = buildPostgresControlPlane(dl1, {
      policy: { risk: { capabilityRisk: { [CAP]: 'R1' } } },
      adapters: [
        new MockExecutionAdapter({
          name: 'failing-runtime',
          capabilities: [capability(CAP)],
          behavior: 'fail',
          error: { code: 'DEPLOY_FAILED', message: 'target unreachable', retryable: true },
        }),
      ],
    });

    const executionId = newExecutionId();
    const result = await plane1.orchestrator.submit({
      name: 'DeployService',
      actor: worker,
      capability: capability(CAP),
      missionId: mission.missionId,
      executionId,
      payload: {},
    });

    expect(result.status).toBe('failed');
    const failedExe = createExecutionObject({
      run: result.run,
      agent: worker,
      result: result.result,
      executionId,
      outcomeSummary: 'deploy failed — no business outcome realized',
    });
    await dl1.executions.save(failedExe);
    await dl1.close();

    const dl2 = createDataLayer({ connectionString: testConnectionString() });
    const reloaded = await dl2.executions.get(executionId);
    expect(reloaded).toBeDefined();
    expect(reloaded!.executionId).toBe(executionId);
    expect(reloaded!.status).toBe('failed');

    const events = await dl2.events.listByRun(result.run.runId);
    const types = events.map((e) => e.eventType);
    expect(types).toContain('execution.started');
    expect(types).toContain('execution.failed');
    expect(types).not.toContain('execution.completed');

    await dl2.close();
  });
});
