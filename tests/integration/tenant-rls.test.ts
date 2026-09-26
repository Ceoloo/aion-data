import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  buildAutonomyEvidence,
  createAutonomyGrant,
  formatServiceKey,
  newAgentId,
} from '@aion/core';
import { createDataLayer, type DataLayer } from '../../src/index.js';
import {
  createTestDataLayer,
  ensureMigrated,
  testConnectionString,
  truncateAll,
} from '../setup/test-db.js';

/**
 * Tenant RLS (migration 0010) as seen by a NON-OWNER application role — the
 * way aion-runtime's `aion_app` sees it. RLS is ENABLEd (not FORCEd), which
 * already binds non-owner roles, so without `tenantContext` tenant-owned rows
 * are neither writable nor visible; with it, each unit of work sees exactly
 * its tenant.
 */
const PROBE_ROLE = 'aion_rls_probe';
const PROBE_PASSWORD = 'aion_rls_probe';
const SERVICE_KEY = formatServiceKey('revenue.followup.execute', 1);

function probeUrl(): string {
  const url = new URL(testConnectionString());
  url.username = PROBE_ROLE;
  url.password = PROBE_PASSWORD;
  return url.toString();
}

function grantFor(tenantId: string) {
  return createAutonomyGrant({
    agentId: newAgentId(),
    tenantId,
    environment: 'staging',
    currentLevel: 'L2',
    eligibleLevel: 'L2',
    evidence: buildAutonomyEvidence({
      sampleCount: 5,
      successCount: 5,
      policyViolationCount: 0,
      humanInterventionCount: 0,
      sumEvalScore: 5,
      costs: Array(5).fill(1),
    }),
    grantReason: 'qualified',
    l4Allowed: false,
    serviceKey: SERVICE_KEY,
    createdAt: '2026-09-26T00:00:00.000Z',
    lastReviewedAt: '2026-09-26T00:00:00.000Z',
  });
}

describe('tenant RLS through a non-owner role', () => {
  let admin: DataLayer;
  let current: string | undefined;
  let scoped: DataLayer;
  let unscoped: DataLayer;

  beforeAll(async () => {
    admin = createTestDataLayer();
    await ensureMigrated(admin);
    await admin.pool.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${PROBE_ROLE}') THEN
          CREATE ROLE ${PROBE_ROLE} LOGIN PASSWORD '${PROBE_PASSWORD}' NOSUPERUSER NOBYPASSRLS;
        END IF;
      END $$;`);
    await admin.pool.query(`GRANT USAGE ON SCHEMA public TO ${PROBE_ROLE}`);
    await admin.pool.query(
      `GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO ${PROBE_ROLE}`,
    );
    scoped = createDataLayer({ connectionString: probeUrl(), tenantContext: () => current });
    unscoped = createDataLayer({ connectionString: probeUrl() });
  });

  afterAll(async () => {
    await scoped.close();
    await unscoped.close();
    await admin.close();
  });

  beforeEach(async () => {
    current = undefined;
    await truncateAll(admin);
  });

  it('without a tenant context, tenant-owned writes are rejected by RLS', async () => {
    await expect(unscoped.autonomyGrants.save(grantFor('tenant-a'))).rejects.toThrow();
  });

  it('with a tenant context, each tenant reads and writes only its own rows', async () => {
    const a = grantFor('tenant-a');
    const b = grantFor('tenant-b');
    current = 'tenant-a';
    await scoped.autonomyGrants.save(a);
    current = 'tenant-b';
    await scoped.autonomyGrants.save(b);

    current = 'tenant-a';
    expect((await scoped.autonomyGrants.get(a.grantId))?.grantId).toBe(a.grantId);
    expect(await scoped.autonomyGrants.get(b.grantId)).toBeUndefined();

    current = undefined;
    expect(await scoped.autonomyGrants.get(a.grantId)).toBeUndefined();

    // Both rows exist (owner view) — isolation, not loss.
    const { rows } = await admin.pool.query('SELECT count(*)::int AS n FROM autonomy_grants');
    expect(rows[0]?.n).toBe(2);
  });

  it('binds transactions to the tenant too', async () => {
    current = 'tenant-a';
    const a = grantFor('tenant-a');
    await scoped.transaction((repos) => repos.autonomyGrants.save(a));
    expect((await scoped.autonomyGrants.get(a.grantId))?.tenantId).toBe('tenant-a');
  });
});
