-- ============================================================================
-- Migration 0006 — Mission 007 evaluation_results
-- ============================================================================
-- Durable EvaluationResult rows for performance scorecards / routing
-- recommendations. Ranking is computed at read-time (like economics);
-- this table is the evidence store, not a second ledger of KPIs.
-- Additive only.
-- ============================================================================

CREATE TABLE IF NOT EXISTS evaluation_results (
  evaluation_id         text PRIMARY KEY,
  execution_id          text NOT NULL UNIQUE,
  mission_id            text,
  service_key           text,
  service_version       integer,
  agent_id              text,
  provider              text,
  model                 text,
  workflow_version      text,
  quality_score         double precision NOT NULL
                        CHECK (quality_score >= 0 AND quality_score <= 1),
  success               boolean NOT NULL,
  latency_ms            double precision NOT NULL CHECK (latency_ms >= 0),
  total_cost            double precision NOT NULL CHECK (total_cost >= 0),
  human_intervention    boolean NOT NULL DEFAULT false,
  policy_events         jsonb NOT NULL DEFAULT '[]'::jsonb,
  business_outcome      text,
  economic_value        double precision,
  tenant_id             text,
  evaluated_at          timestamptz NOT NULL,
  metadata              jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS evaluation_results_tenant_service_idx
  ON evaluation_results (tenant_id, service_key);

CREATE INDEX IF NOT EXISTS evaluation_results_tenant_provider_model_idx
  ON evaluation_results (tenant_id, provider, model);

CREATE INDEX IF NOT EXISTS evaluation_results_capability_proxy_idx
  ON evaluation_results (tenant_id, (metadata->>'capability'));

CREATE INDEX IF NOT EXISTS evaluation_results_evaluated_at_idx
  ON evaluation_results (evaluated_at DESC);
