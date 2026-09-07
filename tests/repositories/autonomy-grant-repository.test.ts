import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  buildAutonomyEvidence,
  createAutonomyGrant,
  newAgentId,
  formatServiceKey,
} from '@aion/core';
import { createTestDataLayer, ensureMigrated, truncateAll } from '../setup/test-db.js';
import type { DataLayer } from '../../src/index.js';

const FIXED = '2026-09-06T23:40:00.000Z';

describe('PostgresAutonomyGrantRepository', () => {
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

  it('save + getActive round-trips and isolates tenants', async () => {
    const agentId = newAgentId();
    const grant = createAutonomyGrant({
      agentId,
      tenantId: 'tenant-a',
      environment: 'staging',
      currentLevel: 'L4',
      eligibleLevel: 'L4',
      evidence: buildAutonomyEvidence({
        sampleCount: 25,
        successCount: 25,
        policyViolationCount: 0,
        humanInterventionCount: 0,
        sumEvalScore: 24,
        costs: Array(25).fill(1),
      }),
      grantReason: 'qualified',
      l4Allowed: true,
      serviceKey: formatServiceKey('revenue.followup.execute', 1),
      createdAt: FIXED,
      lastReviewedAt: FIXED,
    });
    await dl.autonomyGrants.save(grant);

    const loaded = await dl.autonomyGrants.getActive({
      tenantId: 'tenant-a',
      agentId,
      environment: 'staging',
      serviceKey: formatServiceKey('revenue.followup.execute', 1),
    });
    expect(loaded?.grantId).toBe(grant.grantId);
    expect(loaded?.currentLevel).toBe('L4');

    const other = await dl.autonomyGrants.getActive({
      tenantId: 'tenant-b',
      agentId,
      environment: 'staging',
      serviceKey: formatServiceKey('revenue.followup.execute', 1),
    });
    expect(other).toBeUndefined();

    const listed = await dl.autonomyGrants.listForTenant('tenant-a');
    expect(listed).toHaveLength(1);
    expect(await dl.autonomyGrants.listForTenant('tenant-b')).toHaveLength(0);
  });

  it('save supersedes prior active grant in same scope (deterministic reload)', async () => {
    const agentId = newAgentId();
    const first = createAutonomyGrant({
      agentId,
      tenantId: 'aion-systems',
      environment: 'staging',
      currentLevel: 'L3',
      eligibleLevel: 'L3',
      evidence: buildAutonomyEvidence({
        sampleCount: 10,
        successCount: 10,
        policyViolationCount: 0,
        humanInterventionCount: 0,
        sumEvalScore: 9,
      }),
      grantReason: 'first',
      createdAt: FIXED,
      lastReviewedAt: FIXED,
    });
    await dl.autonomyGrants.save(first);

    const second = createAutonomyGrant({
      agentId,
      tenantId: 'aion-systems',
      environment: 'staging',
      currentLevel: 'L4',
      eligibleLevel: 'L4',
      evidence: buildAutonomyEvidence({
        sampleCount: 25,
        successCount: 25,
        policyViolationCount: 0,
        humanInterventionCount: 0,
        sumEvalScore: 24,
      }),
      grantReason: 'promoted',
      l4Allowed: true,
      createdAt: FIXED,
      lastReviewedAt: FIXED,
    });
    await dl.autonomyGrants.save(second);

    const active = await dl.autonomyGrants.getActive({
      tenantId: 'aion-systems',
      agentId,
      environment: 'staging',
    });
    expect(active?.grantId).toBe(second.grantId);
    expect(active?.currentLevel).toBe('L4');

    const prior = await dl.autonomyGrants.get(first.grantId);
    expect(prior?.status).toBe('superseded');

    // Reload same tip → same active grant.
    const again = await dl.autonomyGrants.getActive({
      tenantId: 'aion-systems',
      agentId,
      environment: 'staging',
    });
    expect(again?.grantId).toBe(second.grantId);
  });
});
