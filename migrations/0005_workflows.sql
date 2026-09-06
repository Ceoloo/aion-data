-- ============================================================================
-- Migration 0005 — Mission 004 workflows + lineage query support
-- ============================================================================
-- Persists reusable Workflow definitions (ordered capability steps) so the
-- MissionOrchestrator can load plans after restart. Lineage indexes already
-- exist from 0004; this migration only adds the workflows table.
-- Additive only.
-- ============================================================================

CREATE TABLE IF NOT EXISTS workflows (
  workflow_id   text PRIMARY KEY,
  name          text NOT NULL,
  description   text NOT NULL DEFAULT '',
  version       text NOT NULL DEFAULT '1.0.0',
  steps         jsonb NOT NULL DEFAULT '[]'::jsonb,
  metadata      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS workflows_name_idx ON workflows (name);
