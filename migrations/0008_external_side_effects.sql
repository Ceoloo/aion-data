-- ============================================================================
-- Migration 0008 — Mission 009 external_side_effects
-- ============================================================================
-- Durable ledger for live third-party mutations (GoHighLevel and future CRM).
-- Unique idempotency_key prevents duplicate external writes on retry.
-- Additive only. GHL owns CRM state; AION owns governance truth.
-- ============================================================================

CREATE TABLE IF NOT EXISTS external_side_effects (
  side_effect_id         text PRIMARY KEY,
  execution_id           text NOT NULL,
  tenant_id              text NOT NULL,
  service_key            text NOT NULL,
  idempotency_key        text NOT NULL,
  external_resource_id   text,
  external_request_id    text,
  requested_action       text NOT NULL,
  approval_id            text,
  performed_at           timestamptz NOT NULL,
  result_hash            text,
  status                 text NOT NULL
                         CHECK (status IN ('pending', 'succeeded', 'failed', 'replayed')),
  provider               text NOT NULL DEFAULT 'ghl',
  error_code             text,
  error_message          text,
  metadata               jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at             timestamptz NOT NULL DEFAULT now()
);

-- One intended external mutation → one ledger row (retries replay).
CREATE UNIQUE INDEX IF NOT EXISTS external_side_effects_idempotency_uidx
  ON external_side_effects (idempotency_key);

CREATE INDEX IF NOT EXISTS external_side_effects_tenant_exec_idx
  ON external_side_effects (tenant_id, execution_id);

CREATE INDEX IF NOT EXISTS external_side_effects_tenant_service_idx
  ON external_side_effects (tenant_id, service_key);

CREATE INDEX IF NOT EXISTS external_side_effects_external_resource_idx
  ON external_side_effects (external_resource_id)
  WHERE external_resource_id IS NOT NULL;
