-- ============================================================================
-- Migration 0009 — IE-001 implementation_cases
-- ============================================================================
-- Authoritative ImplementationCase records: commercial handoff → intake →
-- package recommendation → versioned blueprint → provisioning checklist.
-- Tenant-scoped operational delivery state (not a CRM fork). Additive only.
-- ============================================================================

CREATE TABLE IF NOT EXISTS implementation_cases (
  case_id              text PRIMARY KEY,
  tenant_id            text NOT NULL,
  client_ref           text NOT NULL,
  client_name          text NOT NULL,
  owner_id             text NOT NULL,
  commercial_status    text NOT NULL DEFAULT 'prospect'
                       CHECK (commercial_status IN (
                         'prospect', 'signed', 'paid', 'on_hold', 'declined', 'churned'
                       )),
  delivery_status      text NOT NULL DEFAULT 'draft'
                       CHECK (delivery_status IN (
                         'draft', 'intake_complete', 'recommendation_ready',
                         'blueprint_draft', 'blueprint_approved', 'provisioning',
                         'accepted', 'live', 'on_hold', 'declined'
                       )),
  next_action          text,
  blockers             jsonb NOT NULL DEFAULT '[]'::jsonb,
  evidence_links       jsonb NOT NULL DEFAULT '[]'::jsonb,
  intake               jsonb,
  recommendation       jsonb,
  blueprint            jsonb,
  provisioning         jsonb,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  metadata             jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS implementation_cases_tenant_updated_idx
  ON implementation_cases (tenant_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS implementation_cases_tenant_delivery_idx
  ON implementation_cases (tenant_id, delivery_status);

CREATE INDEX IF NOT EXISTS implementation_cases_tenant_client_idx
  ON implementation_cases (tenant_id, client_ref);
