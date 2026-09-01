-- ============================================================================
-- Migration 0001 — Initial canonical control-plane state
-- ============================================================================
-- Creates the smallest durable schema that makes the Phase 1 AION Core
-- lifecycle survive process restarts (aion-docs/roadmap/build-order.md Phase 2).
--
-- Scope is deliberately bounded to what the *current* Core contracts require:
--   actors · missions · runs · approvals · events · telemetry_records · outcomes
-- No product/business entities, no learning/analytics tables, no speculative
-- infrastructure (aion-docs/engineering/principles.md #1 Mission Before
-- Infrastructure).
--
-- Conventions (see migrations/README.md):
--   * Canonical identifiers are the AION Core branded IDs (text), used verbatim
--     as primary keys. No surrogate keys except where Core mints no id
--     (telemetry_records).
--   * Timestamps are `timestamptz`, stored/compared in UTC.
--   * Enumerated domains are CHECK constraints mirroring Core's zod enums, so the
--     database rejects values Core would never produce. Core remains the policy
--     authority; these are integrity guards, not business logic.
--   * Flexible/versioned-elsewhere data is `jsonb`; identity, ownership, status,
--     risk, timestamps and foreign keys are relational columns.
-- ============================================================================

-- ── actors ──────────────────────────────────────────────────────────────────
-- Canonical identity for governance and traceability. Every governed action is
-- attributable to a registered actor (aion-docs/architecture/security-model.md:
-- "No ambient authority"). Persists AION Core's Actor contract exactly; the
-- agent-only governance fields are nullable and required by CHECK when the actor
-- is an agent. `permissions`, `allowed_tools`, `forbidden_capabilities` and
-- `escalation_conditions` are stored as jsonb arrays — deliberately NOT
-- normalized into join tables: Core owns permission *semantics*, aion-data only
-- persists the declared allow/deny lists, and premature normalization would add
-- no current enforceability (Core evaluates them in memory). See docs/schema.md.
CREATE TABLE actors (
  actor_id                text PRIMARY KEY,
  actor_type              text NOT NULL
                            CHECK (actor_type IN ('human', 'agent', 'service', 'system')),
  name                    text NOT NULL CHECK (length(name) >= 1),
  permissions             jsonb NOT NULL DEFAULT '[]'::jsonb,
  allowed_tools           jsonb NOT NULL DEFAULT '[]'::jsonb,
  forbidden_capabilities  jsonb NOT NULL DEFAULT '[]'::jsonb,
  max_risk_level          text NOT NULL DEFAULT 'R3'
                            CHECK (max_risk_level IN ('R0', 'R1', 'R2', 'R3')),
  -- Agent-only governance fields (aion-docs/governance/agent-governance.md).
  agent_id                text,
  purpose                 text,
  owner                   text,
  default_risk_level      text
                            CHECK (default_risk_level IN ('R0', 'R1', 'R2', 'R3')),
  escalation_conditions   jsonb NOT NULL DEFAULT '[]'::jsonb,
  cost_budget             numeric CHECK (cost_budget IS NULL OR cost_budget >= 0),
  metadata                jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- DB-managed audit columns (not part of the Core Actor contract).
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  -- An agent is a governed worker: it must carry its identity, purpose, owner
  -- and default risk. Non-agents must not.
  CONSTRAINT actors_agent_fields_coherent CHECK (
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
      AND default_risk_level IS NULL)
  )
);

CREATE UNIQUE INDEX actors_agent_id_key ON actors (agent_id) WHERE agent_id IS NOT NULL;

-- ── missions ─────────────────────────────────────────────────────────────────
-- The justification for work (aion-docs/engineering/principles.md #7). Persists
-- the durable subset of the Core Mission contract. `created_at` is the Core
-- Mission.createdAt (application-authored); `updated_at` is a DB audit column.
CREATE TABLE missions (
  mission_id        text PRIMARY KEY,
  name              text NOT NULL CHECK (length(name) >= 1),
  description       text NOT NULL DEFAULT '',
  owner             text NOT NULL CHECK (length(owner) >= 1),
  status            text NOT NULL DEFAULT 'active'
                      CHECK (status IN ('draft', 'active', 'paused', 'completed', 'cancelled')),
  objective         text NOT NULL CHECK (length(objective) >= 1),
  success_criteria  jsonb NOT NULL DEFAULT '[]'::jsonb,
  risk_level        text NOT NULL DEFAULT 'R1'
                      CHECK (risk_level IN ('R0', 'R1', 'R2', 'R3')),
  metadata          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at        timestamptz NOT NULL,
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- ── runs ─────────────────────────────────────────────────────────────────────
-- Operational state: one execution of requested work. Enough is persisted to
-- reconstruct and resume a Core run across a restart. `state` is constrained to
-- Core's explicit lifecycle; illegal *transitions* remain enforced in Core
-- (aion-data guards values, not the state machine). `version` supports
-- optimistic concurrency on this mutable row (see docs/phase-2.md — Core's
-- RunRepository port does not yet express an expected version, reported as an
-- architecture gap; the port's save() is last-write-wins upsert).
CREATE TABLE runs (
  run_id          text PRIMARY KEY,
  request_id      text NOT NULL,
  mission_id      text REFERENCES missions (mission_id),
  workflow_id     text,
  command_id      text NOT NULL,
  actor_id        text NOT NULL REFERENCES actors (actor_id),
  state           text NOT NULL
                    CHECK (state IN ('created', 'evaluating', 'awaiting_approval',
                                     'approved', 'executing', 'completed', 'failed',
                                     'denied', 'cancelled')),
  risk_level      text CHECK (risk_level IS NULL OR risk_level IN ('R0', 'R1', 'R2', 'R3')),
  -- The open/closed gate for this run, if one was required. No FK: approvals
  -- reference runs (below), so a FK here would create a circular dependency and
  -- an ordering hazard on insert. Integrity is maintained from the approvals side.
  approval_id     text,
  correlation_id  text NOT NULL,
  version         integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL,
  updated_at      timestamptz NOT NULL
);

CREATE INDEX runs_mission_id_idx ON runs (mission_id);
CREATE INDEX runs_status_idx ON runs (state);
CREATE INDEX runs_request_id_idx ON runs (request_id);
CREATE INDEX runs_actor_id_idx ON runs (actor_id);

-- ── approvals ────────────────────────────────────────────────────────────────
-- Human gates that must survive restarts (aion-docs/governance/human-gates.md).
-- The immutable `command_snapshot` (the full Core Command) is stored here rather
-- than in a dedicated commands table: the only place a command must be
-- reconstructable after restart is to resume the exact gated run, which is
-- precisely this record. This is the intentional "command durability" decision
-- (see docs/phase-2.md). Decision fields must be coherent with status, so the
-- database can never represent a contradictory approval state.
CREATE TABLE approvals (
  approval_id       text PRIMARY KEY,
  run_id            text NOT NULL REFERENCES runs (run_id),
  request_id        text NOT NULL,
  mission_id        text,
  command_snapshot  jsonb NOT NULL,
  risk_level        text NOT NULL
                      CHECK (risk_level IN ('R0', 'R1', 'R2', 'R3')),
  reason            text NOT NULL,
  status            text NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'granted', 'rejected')),
  requested_at      timestamptz NOT NULL,
  decided_at        timestamptz,
  decided_by        text REFERENCES actors (actor_id),
  note              text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  -- A pending gate has no decision; a decided gate has both a time and a
  -- deciding identity. Fails safe: no coherent decision, no resume.
  CONSTRAINT approvals_decision_coherent CHECK (
    (status = 'pending'  AND decided_at IS NULL     AND decided_by IS NULL)
    OR
    (status IN ('granted', 'rejected') AND decided_at IS NOT NULL AND decided_by IS NOT NULL)
  )
);

CREATE INDEX approvals_run_id_idx ON approvals (run_id);
CREATE INDEX approvals_status_idx ON approvals (status);

-- ── events ───────────────────────────────────────────────────────────────────
-- Immutable, append-only facts (aion-docs/engineering/event-standards.md).
-- Persists the Core AionEvent envelope. Trace-spine columns are relational for
-- querying; payload/metadata are jsonb. Deliberately NO foreign keys on the
-- trace ids: an append-only historical log must survive entity lifecycle changes
-- (archival, etc.) and never fail to record a fact. `seq` gives a monotonic
-- total order so events with equal timestamps still retrieve deterministically.
-- The primary key on event_id makes duplicate emission idempotent (INSERT ...
-- ON CONFLICT DO NOTHING in the sink).
CREATE TABLE events (
  event_id        text PRIMARY KEY,
  event_type      text NOT NULL
                    CHECK (event_type IN ('command.received', 'command.rejected',
                                          'policy.allowed', 'policy.denied',
                                          'approval.requested', 'approval.granted',
                                          'approval.rejected', 'execution.started',
                                          'execution.completed', 'execution.failed',
                                          'run.cancelled')),
  occurred_at     timestamptz NOT NULL,
  request_id      text,
  mission_id      text,
  workflow_id     text,
  run_id          text,
  actor_id        text,
  correlation_id  text,
  causation_id    text,
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  seq             bigserial NOT NULL,
  recorded_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX events_run_id_seq_idx ON events (run_id, seq);
CREATE INDEX events_run_id_occurred_at_idx ON events (run_id, occurred_at);
CREATE INDEX events_mission_id_occurred_at_idx ON events (mission_id, occurred_at);
CREATE INDEX events_event_type_occurred_at_idx ON events (event_type, occurred_at);
CREATE INDEX events_correlation_id_seq_idx ON events (correlation_id, seq);

-- ── telemetry_records ────────────────────────────────────────────────────────
-- The observability spine (aion-docs/engineering/observability-standards.md).
-- Core's TelemetryRecord carries NO identity of its own, so aion-data mints a
-- surrogate `telemetry_id` (the one justified surrogate — Core provides none).
-- Append-only like events. Provider-specific values (model, tokens, cost) are
-- first-class only where Core standardizes them; anything vendor-specific stays
-- in metadata (aion-docs: honest, vendor-neutral telemetry).
CREATE TABLE telemetry_records (
  telemetry_id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at             timestamptz NOT NULL,
  operation               text NOT NULL CHECK (length(operation) >= 1),
  status                  text NOT NULL
                            CHECK (status IN ('ok', 'denied', 'pending', 'failed')),
  request_id              text,
  mission_id              text,
  workflow_id             text,
  run_id                  text,
  command_id              text,
  actor_id                text,
  agent_id                text,
  tool_id                 text,
  approval_id             text,
  correlation_id          text,
  actor_type              text
                            CHECK (actor_type IS NULL
                                   OR actor_type IN ('human', 'agent', 'service', 'system')),
  tool_used               text,
  model                   text,
  input_context_reference text,
  decision                text
                            CHECK (decision IS NULL
                                   OR decision IN ('ALLOW', 'DENY', 'REQUIRE_APPROVAL')),
  duration_ms             numeric CHECK (duration_ms IS NULL OR duration_ms >= 0),
  executor                text,
  token_usage             numeric CHECK (token_usage IS NULL OR token_usage >= 0),
  cost                    numeric CHECK (cost IS NULL OR cost >= 0),
  risk_level              text CHECK (risk_level IS NULL OR risk_level IN ('R0', 'R1', 'R2', 'R3')),
  approval_state          text
                            CHECK (approval_state IS NULL
                                   OR approval_state IN ('not_required', 'pending', 'approved', 'rejected')),
  outcome_reference       text,
  metadata                jsonb NOT NULL DEFAULT '{}'::jsonb,
  seq                     bigserial NOT NULL,
  recorded_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX telemetry_run_id_seq_idx ON telemetry_records (run_id, seq);
CREATE INDEX telemetry_run_id_occurred_at_idx ON telemetry_records (run_id, occurred_at);
CREATE INDEX telemetry_mission_id_occurred_at_idx ON telemetry_records (mission_id, occurred_at);
CREATE INDEX telemetry_operation_occurred_at_idx ON telemetry_records (operation, occurred_at);

-- ── outcomes ─────────────────────────────────────────────────────────────────
-- The beginning of the future learning loop, kept strictly distinct from
-- execution results (aion-docs/engineering/principles.md #6): a *result* is what
-- an execution produced; an *outcome* is the real-world consequence. Supersets
-- Core's minimal OutcomeReference (outcome_id, run_id, mission_id, status,
-- external_reference, metadata) with the durable business fields a real outcome
-- needs (type, value, currency, measured_at). Owned locally by aion-data — Core
-- defines no OutcomeRepository port. Learning tables (lessons, recommendations)
-- are deliberately NOT built yet.
CREATE TABLE outcomes (
  outcome_id          text PRIMARY KEY,
  run_id              text NOT NULL REFERENCES runs (run_id),
  mission_id          text REFERENCES missions (mission_id),
  status              text NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'realized', 'failed', 'unknown')),
  outcome_type        text,
  external_reference  text,
  value               numeric,
  currency            text CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
  measured_at         timestamptz,
  metadata            jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  -- A monetary value needs a currency to be meaningful.
  CONSTRAINT outcomes_currency_requires_value CHECK (
    currency IS NULL OR value IS NOT NULL
  )
);

CREATE INDEX outcomes_mission_id_idx ON outcomes (mission_id);
CREATE INDEX outcomes_run_id_idx ON outcomes (run_id);
CREATE INDEX outcomes_status_idx ON outcomes (status);
