-- ============================================================================
-- Migration 0007 — Mission 008 autonomy_grants
-- ============================================================================
-- Durable scoped AutonomyGrant rows (agent × service × tenant × environment).
-- Earned autonomy is never a blanket agent-wide raise. Additive only.
-- ============================================================================

CREATE TABLE IF NOT EXISTS autonomy_grants (
  grant_id            text PRIMARY KEY,
  agent_id            text NOT NULL,
  service_key         text,
  capability          text,
  tenant_id           text NOT NULL,
  environment         text NOT NULL
                      CHECK (environment IN ('staging', 'production')),
  current_level       text NOT NULL
                      CHECK (current_level IN ('L0', 'L1', 'L2', 'L3', 'L4')),
  eligible_level      text NOT NULL
                      CHECK (eligible_level IN ('L0', 'L1', 'L2', 'L3', 'L4')),
  evidence            jsonb NOT NULL DEFAULT '{}'::jsonb,
  status              text NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active', 'revoked', 'expired', 'superseded')),
  grant_reason        text NOT NULL,
  granted_by          text NOT NULL DEFAULT 'policy'
                      CHECK (granted_by IN ('policy', 'human')),
  l4_allowed          boolean NOT NULL DEFAULT false,
  max_waive_risk      text NOT NULL DEFAULT 'R2'
                      CHECK (max_waive_risk IN ('R0', 'R1', 'R2', 'R3')),
  last_reviewed_at    timestamptz NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  revoked_at          timestamptz,
  revoke_reason       text,
  metadata            jsonb NOT NULL DEFAULT '{}'::jsonb
);

-- At most one active grant per scope.
CREATE UNIQUE INDEX IF NOT EXISTS autonomy_grants_active_scope_uidx
  ON autonomy_grants (
    tenant_id,
    agent_id,
    COALESCE(service_key, capability, '*'),
    environment
  )
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS autonomy_grants_tenant_agent_idx
  ON autonomy_grants (tenant_id, agent_id);

CREATE INDEX IF NOT EXISTS autonomy_grants_tenant_service_idx
  ON autonomy_grants (tenant_id, service_key);
