# AION Data — Canonical Schema

The durable schema is the union of migrations
[`0001`](../migrations/0001_initial_core_state.sql) through
[`0009`](../migrations/0009_revenue_sessions.sql). Phase 2 started with the Core
control-plane tables; later additive migrations added the execution platform,
catalog, governance evidence, and opaque revenue session checkpoints.

Current inventory (plus internal `schema_migrations`):

| Migration | Tables / changes |
|---|---|
| `0001` | `actors`, `missions`, `runs`, `approvals`, `events`, `telemetry_records`, `outcomes` |
| `0002` | `executions`; agent identity columns on `actors` |
| `0003` | `services` |
| `0004` | tenant / hierarchy / approval-binding columns |
| `0005` | `workflows` |
| `0006` | `evaluation_results` |
| `0007` | `autonomy_grants` |
| `0008` | `external_side_effects` |
| `0009` | `revenue_sessions` |

This layer is **complete for the P0 revenue workflow contracts** (outcomes +
`revenue_sessions` + events). It is not incomplete — remaining gaps are
documented limitations (e.g. `revenue_sessions` has no `tenant_id` yet), not
missing tables.

## Ownership boundary

| Concern | Owner |
|---|---|
| Control-plane contracts / policy / orchestration | AION Core |
| Durability, migrations, revision, CHECK constraints | AION Data |
| Opaque revenue session **payload shape** (checkpoint / final_record) | Products (Revenue Copilot) |
| HTTP surface products call | AION Runtime (products do **not** import `@aion/data` directly) |

## Conventions

- **Identifiers are AION Core branded IDs**, used verbatim as primary keys
  (`msn_…`, `run_…`, `apr_…`, `evt_…`, `act_…`, `out_…`, `exe_…`). The only
  surrogate key is `telemetry_records.telemetry_id`, because Core's
  `TelemetryRecord` carries no identity of its own. Core IDs remain externally
  canonical. Product session ids in `revenue_sessions` are opaque text.
- **Timestamps are `timestamptz`**, stored and compared in UTC. Application-authored
  times (a Core `createdAt`, an event's occurred-at) are preserved as sent;
  DB-audit times default to `now()`.
- **Enumerated domains are CHECK constraints** mirroring Core's zod enums, so the
  database rejects values Core would never produce. These are integrity guards,
  not business logic — Core remains the policy authority. Drift between Core
  enum exports and these CHECKs is guarded by `npm run test:contracts`
  (`tests/contracts/enum-drift.test.ts`).
- **Relational vs. JSONB**: identity, ownership, status, risk, timestamps and
  foreign keys are columns; flexible/externally-versioned data (metadata,
  payloads, the command snapshot, declared permission lists, opaque product
  checkpoints) is `jsonb`.

## Lineage

```
missions ──< runs ──< approvals
               │  └── command_snapshot (jsonb: the approved Command)
               ├──< events            (run_id, correlation_id, causation_id)
               ├──< telemetry_records (run_id, correlation_id)
               ├──< outcomes          (run_id, mission_id)
               └──< executions        (run_id UNIQUE; optional tenant scope)
services / workflows          (catalog + reusable plans)
evaluation_results            (evidence for routing / scorecards)
autonomy_grants               (scoped earned autonomy)
external_side_effects         (idempotent CRM mutation ledger)
revenue_sessions              (opaque product checkpoints; revision-gated)
```

Follow a mission to its runs, a run to its approval / events / telemetry /
outcomes / execution, and events to each other via `causation_id`.
`correlation_id` groups one logical operation across events and telemetry.

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
| `agent_uri` | text? | agent only; `agent://aion/{domain}/{role}/{id}`; unique when present. |
| `domain`,`role` | text? | agent only; identity registry axes. |
| `tenant_id` | text? | multi-venture scope. |
| `company_id`,`venture_id`,`project_id` | text? | optional hierarchy (0004). |
| `autonomy_level` | text? | CHECK ∈ {L0..L4}. |
| `allowed_data` | jsonb | data allow-list. |
| `input_contract`,`output_contract` | text? | I/O contract refs. |
| `evaluation_criteria` | jsonb | eval ids / criteria. |
| `observability_requirements` | jsonb | required telemetry/events. |
| `metadata` | jsonb | |
| `created_at`,`updated_at` | timestamptz | DB audit (not in Core contract). |

Constraint `actors_agent_fields_coherent`: agents must carry `agent_id`,
`purpose`, `owner`, `default_risk_level`; non-agents must not (including the
identity-registry columns).

## `executions` (`aion_execution`)

Canonical Execution Object — the atomic unit of AION machine labor. Created by
Runtime's Execution Gateway HTTP surface (reconciled into `aion-runtime`, not a
second gateway). One row per Core `Run` (`run_id` UNIQUE).

| Column | Type | Notes |
|---|---|---|
| `execution_id` | text PK | Core `ExecutionId` (`exe_…`). |
| `actor_id` | text FK → actors | |
| `agent_uri` | text? | denormalized attributable agent handle. |
| `tenant_id`,`domain` | text? | identity scope. |
| `company_id`,`venture_id`,`project_id` | text? | optional hierarchy (0004). |
| `parent_execution_id` | text? FK → executions | lineage. |
| `root_execution_id` | text? | lineage root. |
| `run_id` | text FK → runs UNIQUE | |
| `request_id`,`command_id`,`correlation_id` | text | refs. |
| `mission_id` | text? FK → missions | |
| `workflow_id` | text? | |
| `status` | text | CHECK lifecycle statuses incl. succeeded/failed. |
| `autonomy_level` | text | CHECK ∈ {L0..L4}, default L1. |
| `risk_level` | text? | CHECK ∈ {R0..R3}. |
| `approval_id` | text? | no FK (mirrors runs). |
| `cost` | jsonb | cost breakdown. |
| `outcome_id` | text? | Core OutcomeId; no FK. |
| `outcome_summary` | text? | |
| `revenue_attributed` | numeric? | ROI field. |
| `audit_trace` | jsonb | append-only audit entries. |
| `started_at`,`completed_at` | timestamptz? | |
| `metadata` | jsonb | |
| `created_at`,`updated_at` | timestamptz | application-authored. |

Repository helpers include tenant-scoped `listRecentForTenant`. Design note —
permissions on actors are stored as **jsonb arrays, not normalized** into join
tables. Core owns permission *semantics* and evaluates them in memory; premature
normalization would add no current enforceability.

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
| `execution_id` | text? | binding to execution (0004). |
| `tenant_id` | text? | tenant binding (0004). |
| `command_snapshot` | jsonb | the approved Command (deterministic resume). |
| `risk_level` | text | CHECK ∈ {R0..R3}. |
| `reason` | text | why the gate fired. |
| `status` | text | CHECK ∈ {pending, granted, rejected}. |
| `requested_at` | timestamptz | |
| `decided_at` | timestamptz? | |
| `decided_by` | text? | **FK → actors**. |
| `note` | text? | |
| `expires_at`,`consumed_at` | timestamptz? | replay / expiry DENY support (0004). |
| `created_at`,`updated_at` | timestamptz | DB audit. |

Constraint `approvals_decision_coherent`: `pending` ⇒ no decider/time; `granted`
/`rejected` ⇒ both decider and time present. The database cannot hold a
contradictory approval state. Approval *authority* (no self-approval, single
decision) stays a Core policy rule — not reimplemented in SQL.

Indexes: `run_id`, `status`, `execution_id`, `tenant_id`.

## `events`

Immutable, append-only facts (Core `AionEvent`). No update/delete path;
corrections are new (compensating) events. P0 revenue workflow depends on this
log for durable audit of what happened during a session/run.

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
P0 revenue workflow: create → update as reality resolves → `listByRun` /
`listByMission`.

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

## `services`

Versioned invocable catalog entries (`name@version`) so agents call catalog
entries instead of ad-hoc tools (migration `0003`).

| Column | Type | Notes |
|---|---|---|
| `service_id` | text PK | |
| `service_key` | text UNIQUE | Stable key. |
| `name`,`version` | text / int | UNIQUE (`name`, `version`); version ≥ 1. |
| `capability`,`owner` | text | owner non-empty. |
| `description` | text? | |
| `input_schema_ref`,`output_schema_ref` | text? | |
| `required_permissions`,`agent_compatibility`,`tools`,`eval_refs`,`consumers` | jsonb | defaults `[]`. |
| `risk_level` | text | CHECK ∈ {R0..R3}, default R1. |
| `approval_required` | boolean | default false. |
| `cost_hint_units` | numeric? | ≥ 0. |
| `sla_hint` | text? | |
| `workflow_id` | text? | |
| `status` | text | CHECK ∈ {active, deprecated}. |
| `metadata` | jsonb | |
| `created_at`,`updated_at` | timestamptz | |

## `workflows`

Reusable Workflow definitions — ordered capability steps for MissionOrchestrator
plans that survive restart (migration `0005`).

| Column | Type | Notes |
|---|---|---|
| `workflow_id` | text PK | |
| `name` | text | |
| `description` | text | default ''. |
| `version` | text | default `1.0.0`. |
| `steps` | jsonb | ordered capability steps. |
| `metadata` | jsonb | |
| `created_at`,`updated_at` | timestamptz | |

## `evaluation_results`

Durable EvaluationResult evidence for performance scorecards / routing
recommendations (migration `0006`). Ranking is computed at read-time; this table
is the evidence store, not a second KPI ledger.

| Column | Type | Notes |
|---|---|---|
| `evaluation_id` | text PK | |
| `execution_id` | text UNIQUE | |
| `mission_id`,`service_key`,`agent_id`,`provider`,`model`,`workflow_version` | text? | |
| `service_version` | integer? | |
| `quality_score` | double | 0..1. |
| `success` | boolean | |
| `latency_ms`,`total_cost` | double | ≥ 0. |
| `human_intervention` | boolean | default false. |
| `policy_events` | jsonb | |
| `business_outcome` | text? | |
| `economic_value` | double? | |
| `tenant_id` | text? | |
| `evaluated_at` | timestamptz | |
| `metadata` | jsonb | |
| `created_at` | timestamptz | |

## `autonomy_grants`

Scoped earned AutonomyGrant rows — agent × service/capability × tenant ×
environment (migration `0007`). Never a blanket agent-wide raise.

| Column | Type | Notes |
|---|---|---|
| `grant_id` | text PK | |
| `agent_id` | text | |
| `service_key`,`capability` | text? | scope axes. |
| `tenant_id` | text | |
| `environment` | text | CHECK ∈ {staging, production}. |
| `current_level`,`eligible_level` | text | CHECK ∈ {L0..L4}. |
| `evidence` | jsonb | |
| `status` | text | CHECK ∈ {active, revoked, expired, superseded}. |
| `grant_reason` | text | |
| `granted_by` | text | CHECK ∈ {policy, human}. |
| `l4_allowed` | boolean | default false. |
| `max_waive_risk` | text | CHECK ∈ {R0..R3}, default R2. |
| `last_reviewed_at` | timestamptz | |
| `created_at` | timestamptz | |
| `revoked_at` | timestamptz? | |
| `revoke_reason` | text? | |
| `metadata` | jsonb | |

Unique partial index: at most one **active** grant per scope.

## `external_side_effects`

Idempotent ledger for live third-party mutations (e.g. GoHighLevel)
(migration `0008`). Unique `idempotency_key` prevents duplicate external writes
on retry. GHL owns CRM state; AION owns governance truth.

| Column | Type | Notes |
|---|---|---|
| `side_effect_id` | text PK | |
| `execution_id` | text | |
| `tenant_id` | text | |
| `service_key` | text | |
| `idempotency_key` | text UNIQUE | |
| `external_resource_id`,`external_request_id` | text? | |
| `requested_action` | text | |
| `approval_id` | text? | |
| `performed_at` | timestamptz | |
| `result_hash` | text? | |
| `status` | text | CHECK ∈ {pending, succeeded, failed, replayed}. |
| `provider` | text | default `ghl`. |
| `error_code`,`error_message` | text? | |
| `metadata` | jsonb | |
| `created_at` | timestamptz | |

## `revenue_sessions`

Opaque, versioned product checkpoints for Revenue Copilot (migration
`0009_revenue_sessions.sql`).

**Ownership:** products own the opaque `checkpoint` / `final_record` JSON shape
and versioning inside those blobs. Data owns durability, the active-vs-finalized
exclusivity CHECK, and optimistic `revision` on `UPDATE`. Consumers reach this
store through Runtime HTTP — not direct `@aion/data` imports from product code.

A row is either an active checkpoint **or** a finalized record (CHECK enforces
exclusivity). `revision` provides stale-writer protection on `save`. List APIs:
`listActive()` (session ids) and `listFinalized()` (final records). Internal
single-tenant storage — never grant anonymous / browser roles.

| Column | Type | Notes |
|---|---|---|
| `session_id` | text PK | Product session id |
| `checkpoint` | jsonb | Active opaque checkpoint (null when finalized) |
| `final_record` | jsonb | Finalized opaque record (null while active) |
| `revision` | integer | Optimistic concurrency |
| `updated_at` | timestamptz | |

### Known limitation — no `tenant_id`

`revenue_sessions` currently **lacks `tenant_id`**. Multi-tenant isolation for
sessions is therefore application/Runtime responsibility today. Adding
`tenant_id` is deliberately **out of this pass**: it is a prod-risk schema change
that needs an explicit rollback plan and backfill strategy. Do not treat this as
schema incompleteness of the P0 durability contract — create / checkpoint /
finalize / stale rejection already work.

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
| `executions` | INTERNAL | Labor unit; may carry tenant scope. |
| `services` | INTERNAL | Catalog metadata. |
| `workflows` | INTERNAL | Plan definitions. |
| `evaluation_results` | INTERNAL | Performance evidence; may be tenant-scoped. |
| `autonomy_grants` | CONFIDENTIAL | Earned authority; tenant-scoped. |
| `external_side_effects` | CONFIDENTIAL | External mutation ledger; tenant-scoped. |
| `revenue_sessions` | CONFIDENTIAL | Opaque product checkpoints / finals; may embed PII by reference. |

Payloads and metadata should carry **references**, not sensitive raw data
(aion-docs/observability-standards.md). No column is a home for secrets.
