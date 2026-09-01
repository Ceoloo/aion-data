import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { MockExecutionAdapter, capability } from '@aion/core';
import type { PolicyEngineConfig } from '@aion/core';
import { createDataLayer, type DataLayer } from '../../src/index.js';
import { buildPostgresControlPlane } from '../setup/orchestrator.js';
import {
  createTestDataLayer,
  ensureMigrated,
  testConnectionString,
  truncateAll,
} from '../setup/test-db.js';
import { makeAgent, makeHuman, makeMissionFixture } from '../setup/fixtures.js';

/**
 * PROCESS_RESTART_RESUME + TRACE_CONTINUITY — the most important Phase 2 test.
 *
 * A high-risk command pauses at a human gate; the awaiting run and its approval
 * request are persisted. The process is then simulated to restart (the first
 * data layer and control plane are discarded and a brand-new data layer + Core
 * Orchestrator are built over the same database). The gate is granted after the
 * "restart", and the SAME run resumes to completion — proving durability changes
 * behaviour from "works in memory" to "survives process restart" without
 * changing Core's architectural role.
 */
describe('durability: process restart → approval → resume same run', () => {
  const CAP = 'deployment.execute';
  const policy: PolicyEngineConfig = {
    risk: { capabilityRisk: { [CAP]: 'R3' } }, // R3 always requires a human gate
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
  afterEach(async () => {
    await truncateAll(seed);
  });

  it('pauses at the gate, survives a restart, and resumes the same run to completion', async () => {
    // ── Pre-restart process ────────────────────────────────────────────────
    const dl1 = createDataLayer({ connectionString: testConnectionString() });
    const worker = makeAgent({ permissions: [CAP], maxRiskLevel: 'R3' });
    const human = makeHuman('Release Manager');
    const mission = makeMissionFixture({ riskLevel: 'R2' });
    await dl1.actors.save(worker);
    await dl1.actors.save(human);
    await dl1.missions.save(mission);

    const plane1 = buildPostgresControlPlane(dl1, { policy, adapters: adapters() });
    const submitted = await plane1.orchestrator.submit({
      name: 'DeployService',
      actor: worker,
      capability: capability(CAP),
      missionId: mission.missionId,
      payload: { target: 'prod', build: 42 },
    });

    expect(submitted.status).toBe('awaiting_approval');
    expect(submitted.run.state).toBe('awaiting_approval');
    expect(submitted.approval).toBeDefined();
    const runId = submitted.run.runId;
    const correlationId = submitted.run.correlationId;

    // The awaiting run and its approval (with command snapshot) are durable.
    const persistedRun = await dl1.runs.get(runId);
    expect(persistedRun!.state).toBe('awaiting_approval');
    expect(persistedRun!.approvalId).toBe(submitted.approval!.approvalId);

    // ── Simulate a process restart: nothing survives but the database. ──────
    await dl1.close();

    const dl2 = createDataLayer({ connectionString: testConnectionString() });
    const plane2 = buildPostgresControlPlane(dl2, { policy, adapters: adapters() });

    // Reload purely from durable state.
    const reloadedRun = await dl2.runs.get(runId);
    expect(reloadedRun).toBeDefined();
    expect(reloadedRun!.state).toBe('awaiting_approval');

    const pending = await dl2.approvals.list('pending');
    expect(pending.length).toBe(1);
    const approval = pending[0]!;
    expect(approval.runId).toBe(runId);
    // The original intent is intact for a deterministic resume.
    expect(approval.command.capability).toBe(CAP);
    expect(approval.command.payload).toEqual({ target: 'prod', build: 42 });

    // ── Human grants the gate after restart; the SAME run resumes. ──────────
    const resumed = await plane2.orchestrator.resume({
      approvalId: approval.approvalId,
      approve: true,
      decidedBy: human.actorId,
    });

    expect(resumed.status).toBe('completed');
    expect(resumed.run.runId).toBe(runId); // the SAME run, not a new one
    expect(resumed.run.state).toBe('completed');
    expect(resumed.result?.status).toBe('succeeded');
    expect(resumed.result?.output).toEqual({ deployed: true });

    // Durable final state.
    const finalRun = await dl2.runs.get(runId);
    expect(finalRun!.state).toBe('completed');

    // Only one run ever existed — resume did not spawn a second execution.
    expect((await dl2.runs.list()).length).toBe(1);

    // The approval is now durably granted with the human decider.
    const decided = await dl2.approvals.get(approval.approvalId);
    expect(decided!.status).toBe('granted');
    expect(decided!.decidedBy).toBe(human.actorId);

    // ── Events + telemetry persisted, and TRACE_CONTINUITY holds. ──────────
    const events = await dl2.events.listByRun(runId);
    const eventTypes = events.map((e) => e.eventType);
    expect(eventTypes).toContain('command.received');
    expect(eventTypes).toContain('approval.requested');
    expect(eventTypes).toContain('approval.granted');
    expect(eventTypes).toContain('execution.completed');
    // Every event of this run shares its correlation id — one connected trace
    // across the restart boundary.
    expect(events.every((e) => e.correlationId === correlationId)).toBe(true);

    const telemetry = await dl2.telemetry.listByRun(runId);
    expect(telemetry.length).toBeGreaterThan(0);
    expect(telemetry.some((t) => t.operation === 'execution' && t.status === 'ok')).toBe(true);

    // ── Full lineage is queryable: Mission → Run → Approval → Events →
    //    Telemetry → Outcome. ────────────────────────────────────────────────
    expect(finalRun!.missionId).toBe(mission.missionId);
    const outcome = await dl2.outcomes.create({
      runId,
      missionId: mission.missionId,
      status: 'realized',
      outcomeType: 'deployment',
      value: 14,
      currency: 'USD',
      externalReference: 'conversion_report_q1',
    });
    expect((await dl2.outcomes.listByRun(runId))[0]!.outcomeId).toBe(outcome.outcomeId);

    await dl2.close();
  });
});
