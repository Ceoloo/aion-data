import {
  buildCapabilityScorecard,
  evaluationHasPolicyDenial,
  type CapabilityScorecard,
  type EvaluationResult,
  type EvaluationId,
  type ExecutionId,
  type RoutingCandidateKey,
  type ServiceKey,
} from '@aion/core';
import type { Queryable } from '../db/client.js';
import type { EvaluationResultRow } from '../types/database.js';
import { toPersistenceError, type DataError } from '../errors/index.js';
import {
  evaluationToColumns,
  rowToEvaluation,
} from '../mappers/evaluation-mapper.js';

/**
 * Mission 007 — durable EvaluationResult store + scorecard aggregation.
 *
 * Scorecards are derived at read-time from evaluation_results (same discipline
 * as economics: no second invented KPI ledger).
 */
export class PostgresEvaluationRepository {
  constructor(private readonly db: Queryable) {}

  async get(id: EvaluationId): Promise<EvaluationResult | undefined> {
    try {
      const { rows } = await this.db.query<EvaluationResultRow>(
        'SELECT * FROM evaluation_results WHERE evaluation_id = $1',
        [id],
      );
      const row = rows[0];
      return row ? rowToEvaluation(row) : undefined;
    } catch (err) {
      throw wrap('get evaluation', err, { evaluationId: id });
    }
  }

  async getByExecutionId(
    executionId: ExecutionId | string,
  ): Promise<EvaluationResult | undefined> {
    try {
      const { rows } = await this.db.query<EvaluationResultRow>(
        'SELECT * FROM evaluation_results WHERE execution_id = $1',
        [executionId],
      );
      const row = rows[0];
      return row ? rowToEvaluation(row) : undefined;
    } catch (err) {
      throw wrap('get evaluation by execution', err, { executionId });
    }
  }

  async listForTenant(
    tenantId: string,
    opts?: { serviceKey?: string; limit?: number },
  ): Promise<EvaluationResult[]> {
    const limit = Math.min(Math.max(opts?.limit ?? 100, 1), 500);
    try {
      const { rows } = opts?.serviceKey
        ? await this.db.query<EvaluationResultRow>(
            `SELECT * FROM evaluation_results
             WHERE tenant_id = $1 AND service_key = $2
             ORDER BY evaluated_at DESC
             LIMIT $3`,
            [tenantId, opts.serviceKey, limit],
          )
        : await this.db.query<EvaluationResultRow>(
            `SELECT * FROM evaluation_results
             WHERE tenant_id = $1
             ORDER BY evaluated_at DESC
             LIMIT $2`,
            [tenantId, limit],
          );
      return rows.map(rowToEvaluation);
    } catch (err) {
      throw wrap('list evaluations for tenant', err, { tenantId });
    }
  }

  async save(ev: EvaluationResult): Promise<void> {
    const c = evaluationToColumns(ev);
    try {
      await this.db.query(
        `INSERT INTO evaluation_results (
           evaluation_id, execution_id, mission_id, service_key, service_version,
           agent_id, provider, model, workflow_version, quality_score, success,
           latency_ms, total_cost, human_intervention, policy_events,
           business_outcome, economic_value, tenant_id, evaluated_at, metadata
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
           $12, $13, $14, $15::jsonb, $16, $17, $18, $19, $20::jsonb
         )
         ON CONFLICT (execution_id) DO UPDATE SET
           evaluation_id = EXCLUDED.evaluation_id,
           mission_id = EXCLUDED.mission_id,
           service_key = EXCLUDED.service_key,
           service_version = EXCLUDED.service_version,
           agent_id = EXCLUDED.agent_id,
           provider = EXCLUDED.provider,
           model = EXCLUDED.model,
           workflow_version = EXCLUDED.workflow_version,
           quality_score = EXCLUDED.quality_score,
           success = EXCLUDED.success,
           latency_ms = EXCLUDED.latency_ms,
           total_cost = EXCLUDED.total_cost,
           human_intervention = EXCLUDED.human_intervention,
           policy_events = EXCLUDED.policy_events,
           business_outcome = EXCLUDED.business_outcome,
           economic_value = EXCLUDED.economic_value,
           tenant_id = EXCLUDED.tenant_id,
           evaluated_at = EXCLUDED.evaluated_at,
           metadata = EXCLUDED.metadata`,
        [
          c.evaluation_id,
          c.execution_id,
          c.mission_id,
          c.service_key,
          c.service_version,
          c.agent_id,
          c.provider,
          c.model,
          c.workflow_version,
          c.quality_score,
          c.success,
          c.latency_ms,
          c.total_cost,
          c.human_intervention,
          c.policy_events,
          c.business_outcome,
          c.economic_value,
          c.tenant_id,
          c.evaluated_at,
          c.metadata,
        ],
      );
    } catch (err) {
      throw wrap('save evaluation', err, { evaluationId: ev.evaluationId });
    }
  }

  /**
   * Aggregate scorecards for a tenant, grouped by provider+model
   * (and optional serviceKey / capability filter).
   */
  async scorecardsForTenant(
    tenantId: string,
    opts?: {
      serviceKey?: ServiceKey | string;
      capability?: string;
      computedAt?: string;
    },
  ): Promise<CapabilityScorecard[]> {
    try {
      const params: unknown[] = [tenantId];
      const filters: string[] = ['tenant_id = $1'];
      if (opts?.serviceKey) {
        params.push(opts.serviceKey);
        filters.push(`service_key = $${params.length}`);
      }
      if (opts?.capability) {
        params.push(opts.capability);
        filters.push(
          `(metadata->>'capability' = $${params.length} OR service_key LIKE $${params.length} || '@%')`,
        );
      }
      const { rows } = await this.db.query<EvaluationResultRow>(
        `SELECT * FROM evaluation_results WHERE ${filters.join(' AND ')}`,
        params,
      );
      const evaluations = rows.map(rowToEvaluation);
      return aggregateScorecards(evaluations, {
        capability: opts?.capability,
        computedAt: opts?.computedAt,
      });
    } catch (err) {
      throw wrap('scorecards for tenant', err, { tenantId });
    }
  }
}

function aggregateScorecards(
  evaluations: EvaluationResult[],
  opts?: { capability?: string; computedAt?: string },
): CapabilityScorecard[] {
  type Acc = {
    candidate: RoutingCandidateKey;
    sampleCount: number;
    successCount: number;
    sumQuality: number;
    sumLatencyMs: number;
    sumCost: number;
    policyDenialCount: number;
    humanInterventionCount: number;
    attributedEconomicValue: number;
  };
  const groups = new Map<string, Acc>();
  for (const ev of evaluations) {
    const candidate: RoutingCandidateKey = {
      ...(opts?.capability ? { capability: opts.capability } : {}),
      ...(ev.serviceKey ? { serviceKey: ev.serviceKey } : {}),
      ...(ev.provider ? { provider: ev.provider } : {}),
      ...(ev.model ? { model: ev.model } : {}),
      ...(ev.workflowVersion ? { workflowVersion: ev.workflowVersion } : {}),
      ...(ev.agentId ? { agentId: ev.agentId } : {}),
    };
    const key = [
      candidate.capability ?? '',
      candidate.serviceKey ?? '',
      candidate.provider ?? '',
      candidate.model ?? '',
      candidate.workflowVersion ?? '',
      candidate.agentId ?? '',
    ].join('|');
    let acc = groups.get(key);
    if (!acc) {
      acc = {
        candidate,
        sampleCount: 0,
        successCount: 0,
        sumQuality: 0,
        sumLatencyMs: 0,
        sumCost: 0,
        policyDenialCount: 0,
        humanInterventionCount: 0,
        attributedEconomicValue: 0,
      };
      groups.set(key, acc);
    }
    acc.sampleCount += 1;
    if (ev.success) acc.successCount += 1;
    acc.sumQuality += ev.qualityScore;
    acc.sumLatencyMs += ev.latencyMs;
    acc.sumCost += ev.totalCost;
    if (evaluationHasPolicyDenial(ev)) acc.policyDenialCount += 1;
    if (ev.humanIntervention) acc.humanInterventionCount += 1;
    acc.attributedEconomicValue += ev.economicValue ?? 0;
  }
  return [...groups.values()].map((acc) =>
    buildCapabilityScorecard({
      ...acc,
      computedAt: opts?.computedAt,
    }),
  );
}

function wrap(
  operation: string,
  err: unknown,
  context: Record<string, unknown>,
): DataError {
  return toPersistenceError(operation, err, context);
}
