import {
  MissionEconomicsRollup,
  ScopeEconomicsRollup,
  computeRoi,
  type EconomicsScopeDims,
  type MissionId,
} from '@aion/core';
import type { Queryable } from '../db/client.js';
import { toPersistenceError, type DataError } from '../errors/index.js';

/**
 * Mission 005 — derive economics rollups via SQL over durable execution truth.
 *
 * Aggregates executions → mission / scope (project → venture → company →
 * holding=tenant). No second ledger table; Holding is the tenant portfolio
 * aggregate without a dedicated Holding relation.
 */

interface RollupRow {
  total_executions: string | number;
  success_count: string | number;
  failure_count: string | number;
  policy_denials: string | number;
  approvals: string | number;
  human_interventions: string | number;
  total_cost_units: string | number;
  total_duration_ms: string | number;
  outcome_count: string | number;
  revenue_attributed: string | number;
  outcome_value: string | number;
}

function num(v: string | number | null | undefined): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function metricsFromRow(row: RollupRow | undefined, computedAt: string) {
  const totalCostUnits = num(row?.total_cost_units);
  const attributedEconomicValue =
    num(row?.revenue_attributed) + num(row?.outcome_value);
  return {
    totalExecutions: Math.trunc(num(row?.total_executions)),
    successCount: Math.trunc(num(row?.success_count)),
    failureCount: Math.trunc(num(row?.failure_count)),
    policyDenials: Math.trunc(num(row?.policy_denials)),
    approvals: Math.trunc(num(row?.approvals)),
    humanInterventions: Math.trunc(num(row?.human_interventions)),
    totalCostUnits,
    totalDurationMs: num(row?.total_duration_ms),
    outcomeCount: Math.trunc(num(row?.outcome_count)),
    attributedEconomicValue,
    roi: computeRoi(attributedEconomicValue, totalCostUnits),
    computedAt,
  };
}

/** Aggregation over `filtered_executions` CTE — mission-linked side tables. */
const MISSION_ROLLUP_SQL = `
WITH filtered_executions AS (
  SELECT * FROM executions
  WHERE mission_id = $1
    AND ($2::text IS NULL OR tenant_id = $2)
)
SELECT
  COALESCE(COUNT(e.execution_id), 0) AS total_executions,
  COALESCE(COUNT(e.execution_id) FILTER (WHERE e.status = 'succeeded'), 0) AS success_count,
  COALESCE(COUNT(e.execution_id) FILTER (WHERE e.status = 'failed'), 0) AS failure_count,
  COALESCE(COUNT(e.execution_id) FILTER (WHERE e.status = 'denied'), 0) AS policy_denials,
  COALESCE((
    SELECT COUNT(*)::numeric FROM approvals a
    WHERE a.mission_id = $1
       OR a.run_id IN (SELECT run_id FROM filtered_executions)
       OR a.execution_id IN (SELECT execution_id FROM filtered_executions)
  ), 0) AS approvals,
  COALESCE((
    SELECT COUNT(*)::numeric FROM approvals a
    WHERE a.status IN ('granted', 'rejected')
      AND (
        a.mission_id = $1
        OR a.run_id IN (SELECT run_id FROM filtered_executions)
        OR a.execution_id IN (SELECT execution_id FROM filtered_executions)
      )
  ), 0) AS human_interventions,
  COALESCE(SUM(COALESCE((e.cost->>'units')::numeric, 0)), 0) AS total_cost_units,
  COALESCE(SUM(
    CASE
      WHEN e.started_at IS NOT NULL AND e.completed_at IS NOT NULL
        THEN EXTRACT(EPOCH FROM (e.completed_at - e.started_at)) * 1000
      ELSE 0
    END
  ), 0) AS total_duration_ms,
  COALESCE((
    SELECT COUNT(*)::numeric FROM outcomes o
    WHERE o.mission_id = $1
       OR o.run_id IN (SELECT run_id FROM filtered_executions)
  ), 0) AS outcome_count,
  COALESCE(SUM(COALESCE(e.revenue_attributed, 0)), 0) AS revenue_attributed,
  COALESCE((
    SELECT SUM(COALESCE(o.value, 0))::numeric FROM outcomes o
    WHERE o.status = 'realized'
      AND (
        o.mission_id = $1
        OR o.run_id IN (SELECT run_id FROM filtered_executions)
      )
  ), 0) AS outcome_value
FROM filtered_executions e
`;

/** Aggregation over scope-filtered executions (holding = tenant). */
const SCOPE_ROLLUP_SQL = `
WITH filtered_executions AS (
  SELECT * FROM executions
  WHERE tenant_id = $1
    AND ($2::text IS NULL OR company_id = $2)
    AND ($3::text IS NULL OR venture_id = $3)
    AND ($4::text IS NULL OR project_id = $4)
)
SELECT
  COALESCE(COUNT(e.execution_id), 0) AS total_executions,
  COALESCE(COUNT(e.execution_id) FILTER (WHERE e.status = 'succeeded'), 0) AS success_count,
  COALESCE(COUNT(e.execution_id) FILTER (WHERE e.status = 'failed'), 0) AS failure_count,
  COALESCE(COUNT(e.execution_id) FILTER (WHERE e.status = 'denied'), 0) AS policy_denials,
  COALESCE((
    SELECT COUNT(*)::numeric FROM approvals a
    WHERE a.run_id IN (SELECT run_id FROM filtered_executions)
       OR a.execution_id IN (SELECT execution_id FROM filtered_executions)
  ), 0) AS approvals,
  COALESCE((
    SELECT COUNT(*)::numeric FROM approvals a
    WHERE a.status IN ('granted', 'rejected')
      AND (
        a.run_id IN (SELECT run_id FROM filtered_executions)
        OR a.execution_id IN (SELECT execution_id FROM filtered_executions)
      )
  ), 0) AS human_interventions,
  COALESCE(SUM(COALESCE((e.cost->>'units')::numeric, 0)), 0) AS total_cost_units,
  COALESCE(SUM(
    CASE
      WHEN e.started_at IS NOT NULL AND e.completed_at IS NOT NULL
        THEN EXTRACT(EPOCH FROM (e.completed_at - e.started_at)) * 1000
      ELSE 0
    END
  ), 0) AS total_duration_ms,
  COALESCE((
    SELECT COUNT(*)::numeric FROM outcomes o
    WHERE o.run_id IN (SELECT run_id FROM filtered_executions)
  ), 0) AS outcome_count,
  COALESCE(SUM(COALESCE(e.revenue_attributed, 0)), 0) AS revenue_attributed,
  COALESCE((
    SELECT SUM(COALESCE(o.value, 0))::numeric FROM outcomes o
    WHERE o.status = 'realized'
      AND o.run_id IN (SELECT run_id FROM filtered_executions)
  ), 0) AS outcome_value
FROM filtered_executions e
`;

export class PostgresEconomicsRepository {
  constructor(private readonly db: Queryable) {}

  /**
   * Derive mission-level economics. When `tenantId` is provided, only that
   * tenant's executions are included (Mission 003 isolation at the read path).
   */
  async rollupByMission(
    missionId: MissionId,
    tenantId?: string,
  ): Promise<MissionEconomicsRollup> {
    const computedAt = new Date().toISOString();
    try {
      const { rows } = await this.db.query<RollupRow>(MISSION_ROLLUP_SQL, [
        missionId,
        tenantId ?? null,
      ]);
      const metrics = metricsFromRow(rows[0], computedAt);
      return MissionEconomicsRollup.parse({
        missionId,
        ...(tenantId ? { tenantId } : {}),
        ...metrics,
      });
    } catch (err) {
      throw wrap('rollup by mission', err, { missionId, tenantId });
    }
  }

  /**
   * Derive scope-level economics (project / venture / company / holding=tenant).
   * Deeper dims are ANDed when present. Holding = tenant-only filter.
   */
  async rollupByScope(scope: EconomicsScopeDims): Promise<ScopeEconomicsRollup> {
    const computedAt = new Date().toISOString();
    try {
      const { rows } = await this.db.query<RollupRow>(SCOPE_ROLLUP_SQL, [
        scope.tenantId,
        scope.companyId ?? null,
        scope.ventureId ?? null,
        scope.projectId ?? null,
      ]);
      const metrics = metricsFromRow(rows[0], computedAt);
      return ScopeEconomicsRollup.parse({
        scope,
        ...metrics,
      });
    } catch (err) {
      throw wrap('rollup by scope', err, { ...scope });
    }
  }
}

function wrap(
  op: string,
  err: unknown,
  details: Record<string, unknown>,
): DataError {
  return toPersistenceError(op, err, details);
}
