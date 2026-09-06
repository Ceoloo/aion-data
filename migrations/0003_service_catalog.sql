-- ============================================================================
-- Migration 0003 — Service Catalog v0 (Mission 001)
-- ============================================================================
-- Versioned invocable services (`name@version`) so agents call catalog entries
-- instead of ad-hoc tools. Seeds Mission 001 revenue services only.
-- ============================================================================

CREATE TABLE services (
  service_id              text PRIMARY KEY,
  service_key             text NOT NULL UNIQUE,
  name                    text NOT NULL,
  version                 integer NOT NULL CHECK (version >= 1),
  capability              text NOT NULL,
  owner                   text NOT NULL CHECK (length(owner) >= 1),
  description             text,
  input_schema_ref        text,
  output_schema_ref       text,
  required_permissions    jsonb NOT NULL DEFAULT '[]'::jsonb,
  agent_compatibility     jsonb NOT NULL DEFAULT '[]'::jsonb,
  tools                   jsonb NOT NULL DEFAULT '[]'::jsonb,
  risk_level              text NOT NULL DEFAULT 'R1'
                            CHECK (risk_level IN ('R0', 'R1', 'R2', 'R3')),
  approval_required       boolean NOT NULL DEFAULT false,
  cost_hint_units         numeric CHECK (cost_hint_units IS NULL OR cost_hint_units >= 0),
  sla_hint                text,
  eval_refs               jsonb NOT NULL DEFAULT '[]'::jsonb,
  consumers               jsonb NOT NULL DEFAULT '[]'::jsonb,
  workflow_id             text,
  status                  text NOT NULL DEFAULT 'active'
                            CHECK (status IN ('active', 'deprecated')),
  metadata                jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (name, version)
);

CREATE INDEX services_capability_idx ON services (capability);
CREATE INDEX services_status_idx ON services (status);
CREATE INDEX services_owner_idx ON services (owner);
