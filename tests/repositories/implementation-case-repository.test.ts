import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  applyIntake,
  approveBlueprint,
  attachBlueprintDraft,
  createImplementationCase,
  draftBlueprintFromCase,
} from '@aion/core';
import { createTestDataLayer, ensureMigrated, truncateAll } from '../setup/test-db.js';
import type { DataLayer } from '../../src/index.js';

const FIXED = '2026-09-07T12:00:00.000Z';

describe('PostgresImplementationCaseRepository', () => {
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

  it('save + get + listForTenant isolates tenants through intake→approve', async () => {
    let c = createImplementationCase({
      tenantId: 'tenant-a',
      clientRef: 'client-acme',
      clientName: 'Acme',
      ownerId: 'ops-1',
      createdAt: FIXED,
    });
    c = applyIntake(
      c,
      {
        businessContext: 'Leads fall through',
        primaryBottleneck: 'leads_lost_inquiry_followup',
        measurableProblem: 'No follow-up SLA',
        namedOwner: 'ops-1',
        accessReady: true,
        approvedScope: true,
        deliveryCapacityFeasible: true,
        completedBy: 'ops-1',
      },
      FIXED,
    );
    const draft = draftBlueprintFromCase({
      caseRecord: c,
      packageKey: 'revenue_os',
      deliveryOwner: 'ops-1',
      now: FIXED,
    });
    c = attachBlueprintDraft(c, draft, FIXED);
    c = approveBlueprint(c, 'ops-1', FIXED);
    await dl.implementationCases.save(c);

    const other = createImplementationCase({
      tenantId: 'tenant-b',
      clientRef: 'client-other',
      clientName: 'Other',
      ownerId: 'ops-2',
      createdAt: FIXED,
    });
    await dl.implementationCases.save(other);

    const loaded = await dl.implementationCases.get(c.caseId);
    expect(loaded?.deliveryStatus).toBe('blueprint_approved');
    expect(loaded?.recommendation?.recommendedPackage).toBe('revenue_os');
    expect(loaded?.blueprint?.approvedBy).toBe('ops-1');

    const listA = await dl.implementationCases.listForTenant('tenant-a');
    expect(listA).toHaveLength(1);
    expect(listA[0]?.caseId).toBe(c.caseId);

    const listB = await dl.implementationCases.listForTenant('tenant-b');
    expect(listB).toHaveLength(1);
    expect(listB[0]?.clientRef).toBe('client-other');
  });
});
