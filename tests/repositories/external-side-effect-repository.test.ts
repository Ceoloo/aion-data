import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createExternalSideEffect,
  formatServiceKey,
  hashExternalResult,
  newExecutionId,
} from '@aion/core';
import { createTestDataLayer, ensureMigrated, truncateAll } from '../setup/test-db.js';
import type { DataLayer } from '../../src/index.js';

const FIXED = '2026-09-07T00:10:00.000Z';

describe('PostgresExternalSideEffectRepository', () => {
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

  it('saveOnce inserts once and replays on idempotency collision', async () => {
    const executionId = newExecutionId();
    const effect = createExternalSideEffect({
      executionId,
      tenantId: 'aion-systems',
      serviceKey: formatServiceKey('crm.contact.update', 1),
      idempotencyKey: 'ik_contact_update_1',
      requestedAction: 'contact.update',
      performedAt: FIXED,
      status: 'succeeded',
      externalResourceId: 'ghl_contact_1',
      resultHash: hashExternalResult({ id: 'ghl_contact_1', email: 'a@ex.com' }),
    });

    const first = await dl.externalSideEffects.saveOnce(effect);
    expect(first.inserted).toBe(true);

    const duplicate = createExternalSideEffect({
      executionId,
      tenantId: 'aion-systems',
      serviceKey: formatServiceKey('crm.contact.update', 1),
      idempotencyKey: 'ik_contact_update_1',
      requestedAction: 'contact.update',
      performedAt: FIXED,
      status: 'succeeded',
      externalResourceId: 'ghl_contact_SHOULD_NOT_WIN',
      resultHash: hashExternalResult({ id: 'other' }),
    });
    const second = await dl.externalSideEffects.saveOnce(duplicate);
    expect(second.inserted).toBe(false);
    expect(second.effect.externalResourceId).toBe('ghl_contact_1');
    expect(second.effect.sideEffectId).toBe(effect.sideEffectId);

    const byKey = await dl.externalSideEffects.getByIdempotencyKey(
      'ik_contact_update_1',
    );
    expect(byKey?.sideEffectId).toBe(effect.sideEffectId);

    const listed = await dl.externalSideEffects.listForTenant('aion-systems', {
      executionId,
    });
    expect(listed).toHaveLength(1);
  });

  it('seedMission009 inserts CRM catalog keys', async () => {
    const seed = await dl.services.seedMission009();
    expect(seed.total).toBe(15);
    expect(seed.inserted).toBe(15);
    const again = await dl.services.seedMission009();
    expect(again.inserted).toBe(0);
    const send = await dl.services.getByKey(
      formatServiceKey('crm.message.send', 1),
    );
    expect(send?.riskLevel).toBe('R3');
    expect(send?.approvalRequired).toBe(true);
  });
});
