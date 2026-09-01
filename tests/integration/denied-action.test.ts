import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MockExecutionAdapter, capability } from '@aion/core';
import type { DataLayer } from '../../src/index.js';
import { buildPostgresControlPlane } from '../setup/orchestrator.js';
import { createTestDataLayer, ensureMigrated, truncateAll } from '../setup/test-db.js';
import { makeAgent, makeMissionFixture } from '../setup/fixtures.js';

/**
 * DENIED_ACTION_DURABILITY.
 *
 *   command → policy DENY → run persisted as denied → denial event persisted →
 *   telemetry persisted → NO execution occurs.
 */
describe('durability: denied action', () => {
  let dl: DataLayer;
  let executed = false;

  beforeAll(async () => {
    dl = createTestDataLayer();
    await ensureMigrated(dl);
  });
  afterAll(async () => {
    await dl.close();
  });
  beforeEach(async () => {
    await truncateAll(dl);
    executed = false;
  });

  it('persists a denied run + denial event + telemetry and never executes', async () => {
    const CAP = 'deployment.execute';
    // The agent is NOT granted the capability → deny-by-default.
    const worker = makeAgent({ permissions: ['research.web'] });
    const mission = makeMissionFixture();
    await dl.actors.save(worker);
    await dl.missions.save(mission);

    // An adapter that would flip `executed` if the orchestrator ever routed to it.
    const spyingAdapter = new MockExecutionAdapter({
      name: 'must-not-run',
      handles: () => {
        executed = true;
        return true;
      },
    });
    const plane = buildPostgresControlPlane(dl, {
      policy: { risk: { capabilityRisk: { [CAP]: 'R1' } } },
      adapters: [spyingAdapter],
    });

    const result = await plane.orchestrator.submit({
      name: 'DeployService',
      actor: worker,
      capability: capability(CAP),
      missionId: mission.missionId,
      payload: {},
    });

    expect(result.status).toBe('denied');
    expect(result.decision.decision).toBe('DENY');
    expect(executed).toBe(false); // NO execution occurred

    // Durable denied run.
    const run = await dl.runs.get(result.run.runId);
    expect(run!.state).toBe('denied');

    // Denial event persisted; no execution events exist.
    const events = await dl.events.listByRun(run!.runId);
    const types = events.map((e) => e.eventType);
    expect(types).toContain('policy.denied');
    expect(types).not.toContain('execution.started');
    expect(types).not.toContain('execution.completed');

    // Telemetry persisted, recording the DENY decision.
    const telemetry = await dl.telemetry.listByRun(run!.runId);
    expect(telemetry.length).toBeGreaterThan(0);
    expect(telemetry.some((t) => t.decision === 'DENY' && t.status === 'denied')).toBe(true);
  });
});
