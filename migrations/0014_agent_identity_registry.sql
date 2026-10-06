-- ============================================================================
-- Migration 0014 — Agent Identity Registry fields (AIO-44 / SIS-AG-02)
-- ============================================================================
-- Extends `actors` with the mandatory registry columns from Security
-- Infrastructure Standard v1 §3.9 so every production agent can carry:
--   permission_tier, delegated_authority, policy_version,
--   execution_evidence, revocation_state
-- plus operational fields: environment, credential_method,
-- approval_requirements, last_activity.
--
-- Additive only. Existing rows default revocation_state='active'; other new
-- columns stay NULL until registration fills them. Non-agents must not carry
-- registry columns (extended actors_agent_fields_coherent).
-- ============================================================================

ALTER TABLE actors
  ADD COLUMN action_tier              text
    CHECK (action_tier IS NULL OR action_tier IN ('observe', 'assist', 'execute')),
  ADD COLUMN delegated_authority      jsonb,
  ADD COLUMN policy_version           text,
  ADD COLUMN execution_evidence       text,
  ADD COLUMN revocation_state         text NOT NULL DEFAULT 'active'
    CHECK (revocation_state IN ('active', 'suspended', 'revoked')),
  ADD COLUMN environment              text
    CHECK (environment IS NULL OR environment IN ('development', 'staging', 'production')),
  ADD COLUMN credential_method        text,
  ADD COLUMN approval_requirements    jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN last_activity            timestamptz;

CREATE INDEX actors_revocation_state_idx ON actors (revocation_state);
CREATE INDEX actors_policy_version_idx ON actors (policy_version)
  WHERE policy_version IS NOT NULL;
CREATE INDEX actors_action_tier_idx ON actors (action_tier)
  WHERE action_tier IS NOT NULL;

-- Non-agents must not carry agent-only registry columns.
ALTER TABLE actors DROP CONSTRAINT actors_agent_fields_coherent;
ALTER TABLE actors ADD CONSTRAINT actors_agent_fields_coherent CHECK (
  (actor_type = 'agent'
    AND agent_id IS NOT NULL
    AND purpose IS NOT NULL
    AND owner IS NOT NULL
    AND default_risk_level IS NOT NULL)
  OR
  (actor_type <> 'agent'
    AND agent_id IS NULL
    AND purpose IS NULL
    AND owner IS NULL
    AND default_risk_level IS NULL
    AND agent_uri IS NULL
    AND domain IS NULL
    AND role IS NULL
    AND autonomy_level IS NULL
    AND input_contract IS NULL
    AND output_contract IS NULL
    AND action_tier IS NULL
    AND delegated_authority IS NULL
    AND policy_version IS NULL
    AND execution_evidence IS NULL
    AND environment IS NULL
    AND credential_method IS NULL
    AND last_activity IS NULL)
);
