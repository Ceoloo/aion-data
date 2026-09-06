-- ============================================================================
-- Migration 0004 — Mission 003 tenant scope + execution lineage + approval binding
-- ============================================================================
-- Adds optional hierarchy columns (company / venture / project) on actors and
-- executions, parent/root lineage on executions, and approval binding fields
-- (execution_id, tenant_id, expires_at, consumed_at) so Runtime can DENY
-- cross-tenant access, approval replay, and cross-execution approval reuse.
-- Additive only.
-- ============================================================================

-- ── actors: optional hierarchy beneath tenant ───────────────────────────────
ALTER TABLE actors
  ADD COLUMN company_id text,
  ADD COLUMN venture_id text,
  ADD COLUMN project_id text;

CREATE INDEX actors_company_id_idx ON actors (company_id) WHERE company_id IS NOT NULL;
CREATE INDEX actors_venture_id_idx ON actors (venture_id) WHERE venture_id IS NOT NULL;
CREATE INDEX actors_project_id_idx ON actors (project_id) WHERE project_id IS NOT NULL;

-- ── executions: scope + lineage ─────────────────────────────────────────────
ALTER TABLE executions
  ADD COLUMN company_id text,
  ADD COLUMN venture_id text,
  ADD COLUMN project_id text,
  ADD COLUMN parent_execution_id text REFERENCES executions (execution_id),
  ADD COLUMN root_execution_id text;

CREATE INDEX executions_company_id_idx ON executions (company_id) WHERE company_id IS NOT NULL;
CREATE INDEX executions_venture_id_idx ON executions (venture_id) WHERE venture_id IS NOT NULL;
CREATE INDEX executions_project_id_idx ON executions (project_id) WHERE project_id IS NOT NULL;
CREATE INDEX executions_parent_execution_id_idx
  ON executions (parent_execution_id) WHERE parent_execution_id IS NOT NULL;
CREATE INDEX executions_root_execution_id_idx
  ON executions (root_execution_id) WHERE root_execution_id IS NOT NULL;

-- ── approvals: bound to execution + tenant; expiry + consume for replay DENY ─
ALTER TABLE approvals
  ADD COLUMN execution_id text,
  ADD COLUMN tenant_id text,
  ADD COLUMN expires_at timestamptz,
  ADD COLUMN consumed_at timestamptz;

CREATE INDEX approvals_execution_id_idx
  ON approvals (execution_id) WHERE execution_id IS NOT NULL;
CREATE INDEX approvals_tenant_id_idx
  ON approvals (tenant_id) WHERE tenant_id IS NOT NULL;
