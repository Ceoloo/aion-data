import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ROUTING_MIN_SAMPLES,
  createEvaluationResult,
  formatServiceKey,
  newExecutionId,
  recommendRoute,
} from '@aion/core';
import { createTestDataLayer, ensureMigrated, truncateAll } from '../setup/test-db.js';
import type { DataLayer } from '../../src/index.js';

describe('PostgresEvaluationRepository', () => {
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

  it('save + getByExecutionId round-trips EvaluationResult', async () => {
    const executionId = newExecutionId();
    const ev = createEvaluationResult({
      executionId,
      serviceKey: formatServiceKey('revenue.call.analyze', 1),
      serviceVersion: 1,
      provider: 'provider-a',
      model: 'model-a',
      qualityScore: 0.94,
      success: true,
      latencyMs: 1900,
      totalCost: 0.18,
      tenantId: 'aion-systems',
      economicValue: 12,
      metadata: { capability: 'revenue.call.analyze' },
      evaluatedAt: '2026-09-06T22:00:00.000Z',
    });
    await dl.evaluations.save(ev);
    const loaded = await dl.evaluations.getByExecutionId(executionId);
    expect(loaded?.evaluationId).toBe(ev.evaluationId);
    expect(loaded?.provider).toBe('provider-a');
    expect(loaded?.qualityScore).toBe(0.94);
    expect(loaded?.tenantId).toBe('aion-systems');
  });

  it('listForTenant isolates tenants', async () => {
    await dl.evaluations.save(
      createEvaluationResult({
        executionId: newExecutionId(),
        qualityScore: 0.9,
        success: true,
        latencyMs: 100,
        totalCost: 1,
        tenantId: 'tenant-a',
        provider: 'a',
        evaluatedAt: '2026-09-06T22:00:00.000Z',
      }),
    );
    await dl.evaluations.save(
      createEvaluationResult({
        executionId: newExecutionId(),
        qualityScore: 0.5,
        success: false,
        latencyMs: 200,
        totalCost: 2,
        tenantId: 'tenant-b',
        provider: 'b',
        evaluatedAt: '2026-09-06T22:00:00.000Z',
      }),
    );
    const a = await dl.evaluations.listForTenant('tenant-a');
    const b = await dl.evaluations.listForTenant('tenant-b');
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(a[0]?.provider).toBe('a');
    expect(b[0]?.provider).toBe('b');
  });

  it('scorecardsForTenant ranks providers and gates insufficient samples', async () => {
    const serviceKey = formatServiceKey('revenue.call.analyze', 1);
    const seed = async (
      provider: string,
      n: number,
      opts: { success: boolean; quality: number; cost: number; deny?: boolean },
    ) => {
      for (let i = 0; i < n; i++) {
        await dl.evaluations.save(
          createEvaluationResult({
            executionId: newExecutionId(),
            serviceKey,
            provider,
            model: `${provider}-model`,
            qualityScore: opts.quality,
            success: opts.success,
            latencyMs: 1000,
            totalCost: opts.cost,
            tenantId: 'aion-systems',
            policyEvents: opts.deny
              ? [{ kind: 'policy.denied', decision: 'DENY' }]
              : [],
            metadata: { capability: 'revenue.call.analyze' },
            evaluatedAt: '2026-09-06T22:00:00.000Z',
          }),
        );
      }
    };

    await seed('provider-a', ROUTING_MIN_SAMPLES, {
      success: true,
      quality: 0.94,
      cost: 0.18,
    });
    await seed('provider-b', ROUTING_MIN_SAMPLES, {
      success: true,
      quality: 0.96,
      cost: 0.42,
    });
    await seed('provider-c', ROUTING_MIN_SAMPLES - 1, {
      success: true,
      quality: 0.99,
      cost: 0.05,
    });
    await seed('provider-dirty', ROUTING_MIN_SAMPLES, {
      success: false,
      quality: 0.4,
      cost: 0.2,
      deny: true,
    });

    const cards = await dl.evaluations.scorecardsForTenant('aion-systems', {
      capability: 'revenue.call.analyze',
      computedAt: '2026-09-06T22:00:00.000Z',
    });
    const other = await dl.evaluations.scorecardsForTenant('aion-media', {
      capability: 'revenue.call.analyze',
    });
    expect(other).toHaveLength(0);

    const rec = recommendRoute({
      tenantId: 'aion-systems',
      capability: 'revenue.call.analyze',
      scorecards: cards,
      computedAt: '2026-09-06T22:00:00.000Z',
    });
    expect(rec.recommended?.provider).toBeDefined();
    expect(rec.recommended?.provider).not.toBe('provider-c');
    expect(rec.recommended?.provider).not.toBe('provider-dirty');
    const cCard = cards.find((c) => c.candidate.provider === 'provider-c');
    expect(cCard?.eligible).toBe(false);

    // Identical recompute → identical recommendation.
    const cards2 = await dl.evaluations.scorecardsForTenant('aion-systems', {
      capability: 'revenue.call.analyze',
      computedAt: '2026-09-06T22:00:00.000Z',
    });
    const rec2 = recommendRoute({
      tenantId: 'aion-systems',
      capability: 'revenue.call.analyze',
      scorecards: cards2,
      computedAt: '2026-09-06T22:00:00.000Z',
    });
    expect(rec2.recommended).toEqual(rec.recommended);
    expect(rec2.rankings.map((r) => r.scorecard.rankingScore)).toEqual(
      rec.rankings.map((r) => r.scorecard.rankingScore),
    );
  });
});
