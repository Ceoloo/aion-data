# AION Data — Canonical Schema

The Phase 2 schema is created by
[`migrations/0001_initial_core_state.sql`](../migrations/0001_initial_core_state.sql).
It is deliberately bounded to what the current AION Core contracts require:
seven canonical tables plus the internal `schema_migrations` ledger.

## Conventions

- **Identifiers are AION Core branded IDs**, used verbatim as primary keys
  (`msn_…`, `run_…`, `apr_…`, `evt_…`, `act_…`, `out_…`). The only surrogate key
  is `telemetry_records.telemetry_id`, because Core's `TelemetryRecord` carries no
  identity of its own. Core IDs remain externally canonical.
- **Timestamps are `timestamptz`**, stored and compared in UTC. Application-authored
  times (a Core `createdAt`, an event's occurred-at) are preserved as sent;
  DB-audit times default to `now()`.
- **Enumerated domains are CHECK constraints** mirroring Core's zod enums, so the
  database rejects values Core would never produce. These are integrity guards,
  not business logic — Core remains the policy authority.
- **Relational vs. JSONB**: identity, ownership, status, risk, timestamps and
  foreign keys are columns; flexible/externally-versioned data (metadata,
  payloads, the command snapshot, declared permission lists) is `jsonb`.

## Lineage

```
missions ──< runs ──< approvals
               │  └── command_snapshot (jsonb: the approved Command)
               ├──< events            (run_id, correlation_id, causation_id)
               ├──< telemetry_records (run_id, correlation_id)
               └──< outcomes          (run_id, mission_id)
```

Follow a mission to its runs, a run to its approval / events / telemetry /
outcomes, and events to each other via `causation_id`. `correlation_id` groups
one logical operation across events and telemetry.

---

## `actors`

Canonical, attributable identities (aion-docs/architecture/security-model.md: no
ambient authority). Persists the Core `Actor` contract exactly; agent-only
governance fields are nullable and required by CHECK when `actor_type='agent'`.

| Column | Type | Notes |
|---|---|---|
| `actor_id` | text PK | Core `ActorId`. |
| `actor_type` | text | CHECK ∈ {human, agent, service, system}. |
| `name` | text | non-empty. |
| `permissions` | jsonb | granted capabilities (allow-list). |
| `allowed_tools` | jsonb | tool allow-list. |
| `forbidden_capabilities` | jsonb | deny-list (overrides grants). |
| `max_risk_level` | text | CHECK ∈ {R0..R3}, default R3. |
| `agent_id` | text? | agent only; unique when present. |
| `purpose`,`owner` | text? | agent only. |
| `default_risk_level` | text? | agent only; CHECK ∈ {R0..R3}. |
| `escalation_conditions` | jsonb | agent escalation triggers. |
| `cost_budget` | numeric? | ≥ 0. |
| `metadata` | jsonb | |
| `created_at`,`updated_at` | timestamptz | DB audit (not in Core contract). |

Constraint `actors_agent_fields_coherent`: agents must carry `agent_id`,
`purpose`, `owner`, `default_risk_level`; non-agents must not.

Design note — permissions are stored as **jsonb arrays, not normalized** into
join tables. Core owns permission *semantics* and evaluates them in memory;
Phase 2 persists the declared allow/deny lists. Premature normalization would add
no current enforceability. Revisit if/when Data must query across permissions.

## `missions`

The justification for work. The durable subset of the Core `Mission` contract.

| Column | Type | Notes |
|---|---|---|
| `mission_id` | text PK | Core `MissionId`. |
| `name` | text | non-empty. |
| `description` | text | default ''. |
| `owner` | text | accountable human/team. |
| `status` | text | CHECK ∈ {draft, active, paused, completed, cancelled}. |
| `objective` | text | non-empty. |
| `success_criteria` | jsonb | string array. |
| `risk_level` | text | CHECK ∈ {R0..R3}, default R1. |
| `metadata` | jsonb | |
| `created_at` | timestamptz | Core `Mission.createdAt`. |
| `updated_at` | timestamptz | DB audit (not in Core contract). |

## `runs`

Operational state: one execution of requested work. Enough to reconstruct/resume
a Core run after a restart.

| Column | Type | Notes |
|---|---|---|
| `run_id` | text PK | Core `RunId`. |
| `request_id` | text | anchors the trace. |
| `mission_id` | text? | **FK → missions**. |
| `workflow_id` | text? | |
| `command_id` | text | |
| `actor_id` | text | **FK → actors**. |
| `state` | text | CHECK ∈ the 9 Core run states. |
| `risk_level` | text? | CHECK ∈ {R0..R3}. |
| `approval_id` | text? | the run's gate; **no FK** (see below). |
| `correlation_id` | text | groups events/telemetry. |
| `version` | integer | DB optimistic-concurrency counter (not in Core contract). |
| `created_at`,`updated_at` | timestamptz | Core `Run.createdAt`/`updatedAt`. |

Indexes: `mission_id`, `state`, `request_id`, `actor_id`.

`approval_id` has **no** foreign key: `approvals.run_id` already references
`runs`, so a FK back would be circular and create an insert-ordering hazard.
Integrity is maintained from the approvals side. State *values* are constrained;
state *transitions* remain enforced by Core's lifecycle machine, not the DB.

## `approvals`

Human gates that survive restarts. The immutable `command_snapshot` (the full
Core `Command`) lives here — see the command-durability decision in
[phase-2.md](phase-2.md#command-durability-decision).

| Column | Type | Notes |
|---|---|---|
| `approval_id` | text PK | Core `ApprovalId`. |
| `run_id` | text | **FK → runs**. |
| `request_id` | text | |
| `mission_id` | text? | |
| `command_snapshot` | jsonb | the approved Command (deterministic resume). |
| `risk_level` | text | CHECK ∈ {R0..R3}. |
| `reason` | text | why the gate fired. |
| `status` | text | CHECK ∈ {pending, granted, rejected}. |
| `requested_at` | timestamptz | |
| `decided_at` | timestamptz? | |
| `decided_by` | text? | **FK → actors**. |
| `note` | text? | |
| `created_at`,`updated_at` | timestamptz | DB audit. |

Constraint `approvals_decision_coherent`: `pending` ⇒ no decider/time; `granted`
/`rejected` ⇒ both decider and time present. The database cannot hold a
contradictory approval state. Approval *authority* (no self-approval, single
decision) stays a Core policy rule — not reimplemented in SQL.

Indexes: `run_id`, `status`.

## `events`

Immutable, append-only facts (Core `AionEvent`). No update/delete path;
corrections are new (compensating) events.

| Column | Type | Notes |
|---|---|---|
| `event_id` | text PK | Core `EventId`; PK makes re-emit idempotent. |
| `event_type` | text | CHECK ∈ the 11 Core event types. |
| `occurred_at` | timestamptz | Core `timestamp`. |
| `request_id`,`mission_id`,`workflow_id`,`run_id`,`actor_id`,`correlation_id`,`causation_id` | text? | trace spine; **no FKs** (see below). |
| `payload`,`metadata` | jsonb | |
| `seq` | bigserial | monotonic insertion order. |
| `recorded_at` | timestamptz | DB insert time. |

Indexes: `(run_id, seq)`, `(run_id, occurred_at)`, `(mission_id, occurred_at)`,
`(event_type, occurred_at)`, `(correlation_id, seq)`.

The trace-id columns have **no foreign keys**: an append-only historical log must
survive entity lifecycle changes (archival, etc.) and never fail to record a
fact. This is a deliberate deviation from strict referential integrity for the
logs, per aion-docs guidance on immutable logging.

## `telemetry_records`

The observability spine (Core `TelemetryRecord`). Append-only.

| Column | Type | Notes |
|---|---|---|
| `telemetry_id` | uuid PK | DB surrogate — Core provides no id. |
| `occurred_at` | timestamptz | Core `timestamp`. |
| `operation`,`status` | text | status CHECK ∈ {ok, denied, pending, failed}. |
| id-chain columns | text? | request/mission/workflow/run/command/actor/agent/tool/approval/correlation. |
| `actor_type` | text? | CHECK ∈ actor types. |
| `tool_used`,`model`,`input_context_reference`,`executor`,`outcome_reference` | text? | |
| `decision` | text? | CHECK ∈ {ALLOW, DENY, REQUIRE_APPROVAL}. |
| `duration_ms`,`token_usage`,`cost` | numeric? | ≥ 0. |
| `risk_level` | text? | CHECK ∈ {R0..R3}. |
| `approval_state` | text? | CHECK ∈ {not_required, pending, approved, rejected}. |
| `metadata` | jsonb | provider-specific values stay here. |
| `seq` | bigserial | insertion order. |
| `recorded_at` | timestamptz | |

Indexes: `(run_id, seq)`, `(run_id, occurred_at)`, `(mission_id, occurred_at)`,
`(operation, occurred_at)`. No FKs, for the same append-only reason as `events`.
No provider-specific top-level columns are invented; vendor values live in
`metadata` until standardization is justified.

## `outcomes`

The seed of the future learning loop, kept strictly distinct from execution
results (aion-docs principle #6). Supersets Core's minimal `OutcomeReference`.

| Column | Type | Notes |
|---|---|---|
| `outcome_id` | text PK | Core `OutcomeId` (minted by Data). |
| `run_id` | text | **FK → runs**. |
| `mission_id` | text? | **FK → missions**. |
| `status` | text | CHECK ∈ {pending, realized, failed, unknown}. |
| `outcome_type` | text? | extension: coarse classification. |
| `external_reference` | text? | pointer to the real-world record. |
| `value` | numeric? | extension: measured business value. |
| `currency` | text? | extension: ISO-4217 (CHECK `^[A-Z]{3}$`). |
| `measured_at` | timestamptz? | extension. |
| `metadata` | jsonb | |
| `created_at`,`updated_at` | timestamptz | |

Constraint `outcomes_currency_requires_value`: a currency requires a value.
Indexes: `mission_id`, `run_id`, `status`. The extension columns (type/value/
currency/measured_at) are owned by aion-data; `toOutcomeReference()` always
projects an outcome down to a Core-valid `OutcomeReference`.

## `schema_migrations`

Internal migration ledger: `version` (PK), `name`, `checksum` (sha256 of the SQL),
`applied_at`. Drives the deterministic runner (see
[migrations/README.md](../migrations/README.md)).

## Data classification (documentation-level)

Phase 2 tags table categories against a simple taxonomy so future access controls
have a reference. Nothing here should ever hold a secret; secrets live in the
`aion-infra` secret store.

| Table | Classification | Sensitivity notes |
|---|---|---|
| `actors` | INTERNAL | Names/owners; no credentials. May reference people. |
| `missions` | INTERNAL | Business intent. |
| `runs` | INTERNAL | Operational state. |
| `approvals` | CONFIDENTIAL | Command snapshot may carry action payloads; decision identities. |
| `events` | CONFIDENTIAL | Payloads describe what happened; keep sensitive data by-reference. |
| `telemetry_records` | INTERNAL | Operational facts; context is referenced, not copied. |
| `outcomes` | CONFIDENTIAL | May carry monetary value / external references. |

Payloads and metadata should carry **references**, not sensitive raw data
(aion-docs/observability-standards.md). No column is a home for secrets.
