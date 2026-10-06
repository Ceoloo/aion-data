-- ============================================================================
-- Migration 0014 — Agent Identity Registry fields (AIO-44 / SIS-AG-02)
-- ============================================================================
-- Extends durable `actors` with production registry columns so every agent can
-- carry: permission tier, delegated authority, policy version, execution
-- evidence, revocation state, and operational inventory metadata.
-- Additive only. Existing agent rows keep NULL/defaults until inventory pass.
-- ============================================================================

ALTER TABLE actors
  ADD COLUMN action_tier                  text
    CHECK (action_tier IS NULL OR action_tier IN ('observe', 'assist', 'execute')),
  ADD COLUMN delegated_authority_id       text,
  ADD COLUMN delegated_authority_evidence text,
  ADD COLUMN policy_version               text,
  ADD COLUMN execution_evidence           text,
  ADD COLUMN revocation_state             text
    CHECK (revocation_state IS NULL OR revocation_state IN ('active', 'suspended', 'revoked')),
  ADD COLUMN environment                  text
    CHECK (environment IS NULL OR environment IN ('development', 'staging', 'production')),
  ADD COLUMN credential_method            text,
  ADD COLUMN approval_requirements        jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN last_activity_at             timestamptz;

CREATE INDEX actors_revocation_state_idx ON actors (revocation_state)
  WHERE actor_type = 'agent' AND revocation_state IS NOT NULL;
CREATE INDEX actors_policy_version_idx ON actors (policy_version)
  WHERE actor_type = 'agent' AND policy_version IS NOT NULL;

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
    AND delegated_authority_id IS NULL
    AND delegated_authority_evidence IS NULL
    AND policy_version IS NULL
    AND execution_evidence IS NULL
    AND revocation_state IS NULL
    AND environment IS NULL
    AND credential_method IS NULL
    AND last_activity_at IS NULL)
);
