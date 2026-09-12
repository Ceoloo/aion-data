# Phase 2 — Canonical Data Foundation

## Scope

Phase 2 builds **the smallest production-quality durable data foundation that
makes the Phase 1 AION Core control plane survive a process restart** — no more.
It answers: how do missions, runs, approvals, events, telemetry, and outcomes
persist; how does a gated run resume after the creating process is gone; and how
does Core reach persistence without becoming database-coupled.

Target proven end-to-end:

```
AION Core → durable Postgres adapters → missions/runs/approvals/events/
telemetry persist → outcomes recordable → process restart → same run resumes.
```

## What was implemented

- **PostgreSQL canonical schema** — at Phase 2 exit: 7 tables (`actors`,
  `missions`, `runs`, `approvals`, `events`, `telemetry_records`, `outcomes`)
  plus a `schema_migrations` ledger, with enum/coherence CHECK constraints,
  foreign keys, and access-pattern indexes. **Additive migrations `0002`–`0009`
  since then** extended the inventory with `executions`, `services`,
  `workflows`, `evaluation_results`, `autonomy_grants`,
  `external_side_effects`, and `revenue_sessions` (see [schema.md](schema.md)).
  The layer is not incomplete for P0 revenue contracts; remaining gaps (e.g.
  `revenue_sessions` without `tenant_id`) are documented limitations.
- **Durable adapters for all five Core ports** — `PostgresMissionRepository`,
  `PostgresRunRepository`, `PostgresApprovalStore`, `PostgresEventSink`,
  `PostgresTelemetrySink` — each implementing the exact AION Core interface.
- **aion-data-local repositories** — including `PostgresActorRepository`,
  `PostgresOutcomeRepository`, executions, services, economics, evaluations,
  autonomy grants, external side effects, and revenue sessions (plus workflows
  once Core gained a matching port).
- **Mappers** translating validated row ⇄ Core contract, with boundary
  validation (a `MappingError` rather than an unchecked cast).
- **Deterministic migration runner** (versioned `.sql`, checksum drift
  detection, idempotent).
- **Injectable data layer** (`createDataLayer({ connectionString })`) with an
  atomic `transaction()` primitive and lifecycle `migrate()`/`close()`.
- **Integration test suite** against a real Postgres, including the three
  required durability scenarios.
- **CI** (GitHub Actions): install → lint → typecheck → migrate → test → build,
  with an ephemeral Postgres service.

## Database choice

**PostgreSQL** via the **`pg`** driver (node-postgres) with **hand-written SQL**
and a **tiny custom migration runner**. No ORM.

- aion-docs does not pre-select a storage engine; Phase 2 selects Postgres as the
  canonical durable store, which the task also directs. The schema stays portable
  PostgreSQL (Supabase-compatible) and avoids Supabase-specific client behavior.
- `pg` is the lightweight, inspectable choice. An ORM was rejected: the mission
  values reviewable schema and migrations over generated "magic"
  (aion-docs/engineering/principles.md — keep it inspectable; do not hide
  architecture). `zod` is used at the boundary only, via Core's own contract
  schemas.
- The migration runner is ~120 lines of plain SQL-file application; a heavyweight
  migration tool was not justified for one initial migration.

## Core port implementations

| Core port | Durable adapter | Notes |
|---|---|---|
| `MissionRepository` | `PostgresMissionRepository` | upsert; get |
| `RunRepository` | `PostgresRunRepository` | upsert; get; list; + `getWithVersion`/`compareAndSave` extension |
| `ApprovalStore` | `PostgresApprovalStore` | get; save; list(status); + `listByRun` extension |
| `EventSink` | `PostgresEventSink` | append-only `emit` (idempotent); read helpers |
| `TelemetrySink` | `PostgresTelemetrySink` | append `record`; read helpers |

A real Core `Orchestrator` is wired to these adapters in
`tests/setup/orchestrator.ts` and exercised by the integration scenarios —
proof that Core runs unchanged on durable storage.

## Persistence boundary

Core depends on the port interfaces, never on `pg` or SQL. Adapters return Core
contract objects (never rows); mappers validate every read through the Core zod
schema. Core is consumed as the **real** `@aion/core` package (pinned, vendored,
built, `file:`-linked) so canonical contracts are never forked. Full detail:
[architecture.md](architecture.md).

## Migration strategy

Versioned `NNNN_name.sql` files applied in ascending order, each once, inside its
own transaction, recorded with a sha256 checksum in `schema_migrations`. Re-runs
are no-ops; an already-applied file whose content changed is a drift error, not a
silent re-apply. Forward-only. Rules: [migrations/README.md](../migrations/README.md).

## Security model

Least privilege: separate application (DML-only) and migration/admin (DDL) roles;
append-only grants for `events`/`telemetry_records`; injectable per-environment
connection strings; no secrets in the repo. RLS is deliberately deferred (no
public client / no validated multi-tenancy) with the ownership columns already in
place for a future ADR-backed introduction. Full detail:
[security.md](security.md).

## Concurrency + idempotency

- **Optimistic concurrency**: `runs.version` increments on each update;
  `compareAndSave(run, expectedVersion)` rejects a stale write with a
  `ConcurrencyError`. (Default `save` is last-write-wins to honor the Core port —
  see the architecture issue below.)
- **Idempotent event append**: `events.event_id` is the primary key and `emit`
  is `INSERT … ON CONFLICT DO NOTHING`, so a duplicate/retried event never
  duplicates or mutates history.
- **Idempotent entity save**: mission/run/approval/actor `save` is an upsert on
  the Core id — a retry converges, never duplicates.
- **Approval decision replay**: the coherence CHECK prevents contradictory
  states; decision authority/one-shot semantics remain a Core rule.
- **Telemetry**: no dedup key (Core provides none); each `record` is a distinct
  observation. Documented, not silently deduped.

## Event model

Events are immutable, append-only, past-tense facts. The sink exposes only
`emit` (no update/delete). Causal traceability is preserved via `causation_id`
(direct cause) and `correlation_id` (one logical operation), and a monotonic
`seq` gives a stable total order for retrieval by run. Corrections, if ever
needed, are new compensating events — never edits.

## Outcome model

Outcomes are kept strictly distinct from execution results (principle #6): a
*result* is what an execution produced ("deployment succeeded"); an *outcome* is
the real-world consequence ("conversion +14%", "$5,000 collected"). The
`outcomes` table supersets Core's minimal `OutcomeReference` with durable business
fields (`value`, `currency`, `outcome_type`, `measured_at`), and every record
projects back to a Core-valid `OutcomeReference` via `toOutcomeReference()`.
Lessons and recommendations are **not** built.

## Durability tests (the key proofs)

### Run + approval resume

`tests/integration/durability-resume.test.ts`:

1. A high-risk (R3) command is submitted → policy returns REQUIRE_APPROVAL → the
   run persists as `awaiting_approval` and an approval request persists **with
   the command snapshot**.
2. The process is simulated to restart: the first data layer and control plane
   are discarded and a **brand-new** data layer + Core `Orchestrator` are built
   over the same database.
3. The run and pending approval are reloaded purely from durable state.
4. A human grants the gate → the **same** run resumes, executes, and completes.
5. Assertions confirm: same `run_id`, exactly one run (no second execution),
   the approval durably `granted` by the human, the full event sequence
   (`command.received → approval.requested → approval.granted →
   execution.completed`), telemetry persisted, and trace continuity (all events
   share the run's `correlation_id`) across the restart boundary. Lineage
   Mission → Run → Approval → Events → Telemetry → Outcome is queried.

### Execution Object vertical slice

`tests/integration/execution-object-durability.test.ts`:

1. Submit gated work with a minted Core `executionId` and persist the canonical
   Execution Object (`aion_execution`) via `createExecutionObject` (same shape
   Runtime's gateway writes).
2. Discard the process and rebuild Core + Data over the same Postgres.
3. Reload the **same** Execution Object by id — status remains
   `awaiting_approval`.
4. Resume → Execution Object transitions to `succeeded` with the **same**
   `executionId`, cost recorded, canonical events continuous, and a durable
   Outcome linked/exposed on the object (`outcomeId` + Core
   `OutcomeReference`).
5. A second case proves a failed Execution Object + `execution.failed` event
   survive a rebuild.

**Result: passes.** Durability changes behavior from "works in memory" to
"survives process restart" without changing Core's architectural role.

## Test results

Run against PostgreSQL 16 (`npm run check`):

```
lint       ✓  (eslint, 0 problems)
typecheck  ✓  (tsc --noEmit, 0 errors)
migrations ✓  (applied cleanly; idempotent; checksum drift detected)
tests      ✓  47 passed / 47  (12 files)
build      ✓  (tsc → dist)
```

Coverage maps to the exit gate: MIGRATIONS_APPLY, MISSION_ROUND_TRIP,
RUN_ROUND_TRIP, APPROVAL_DURABILITY, EVENT_APPEND, TELEMETRY_PERSISTENCE,
OUTCOME_PERSISTENCE, IDEMPOTENCY, CONSTRAINT_ENFORCEMENT, TRACE_CONTINUITY,
PROCESS_RESTART_RESUME, DENIED_ACTION_DURABILITY, FAILED_EXECUTION_DURABILITY —
plus optimistic-concurrency and mapper-validation tests.

## Dependencies

Runtime: `@aion/core` (the real, vendored contracts/ports), `pg` (Postgres
driver), `zod` (boundary validation, same major as Core). Dev: `typescript`,
`tsx`, `vitest`, `eslint` (+ typescript-eslint), `@types/pg`, `@types/node`,
`dotenv`. No ORM, no broker, no cache — none is justified by the current mission.

## Deliberate deferrals (NOT built)

Lessons/recommendations/learning workers; analytics/BI/warehouse/lakehouse;
vectors; Kafka/Redis/Elasticsearch/streaming/CDC/ETL; ML feature stores;
multi-tenant platform features and RLS; normalized product/business schema
(CRM, sales, content, portal — opaque `revenue_sessions` jsonb is allowed);
`tenant_id` on `revenue_sessions` (known limitation; needs explicit rollback /
backfill plan before migration); cloud/Terraform/Kubernetes/multi-region
topology; speculative partitioning/sharding; telemetry retention automation.
These belong to later phases or `aion-infra`.

## Architecture issues discovered

Reported rather than silently worked around (Phase 2 §31):

1. **No optimistic-version parameter on `RunRepository.save`.** Core's port
   cannot express an *expected version*, so a version-checked save cannot flow
   through the port. Data honors the port with a last-write-wins upsert and
   provides `compareAndSave`/`getWithVersion` as a documented **extension** on the
   concrete class. A future Core revision could add an optional expected-version
   parameter (additive) if durable optimistic concurrency becomes a Core-level
   requirement. **Recommendation: Core contract revision (additive), not urgent.**

2. **No cross-port unit-of-work.** The orchestrator calls `runRepository.save`,
   `events.emit`, and `telemetry.record` as independent awaits, so a
   run-state + event + telemetry transition is not atomic across ports. Data
   provides `transaction()` and repositories that bind to one client, but Core
   would need a unit-of-work handle threaded through the ports to use it. In
   Phase 1/2 this is acceptable (single-writer orchestrator, idempotent append),
   but it should be an ADR before multi-writer or higher-throughput phases.
   **Recommendation: ADR when concurrency/throughput warrants it.**

3. **Capabilities/permissions persisted as JSONB, not normalized.** Deliberate
   for now (Core evaluates them in memory; no cross-permission queries yet).
   Revisit if Data must query across permissions. **Recommendation: revisit on a
   real query requirement.**

4. **Event envelope has no `command_id`.** The task's suggested event envelope
   listed `command_id?`, but Core's `AionEvent` does not carry one; the schema
   follows Core (authoritative). No action needed unless Core adds it.

No conflict with aion-docs was found that required rewriting Core or inventing a
divergent schema; the risk taxonomy (R0–R3), event names, and contract field
names all follow Core/aion-docs exactly.

## Exit criteria — met

- [x] AION Core operates against durable Postgres adapters.
- [x] missions / runs / approvals / events / telemetry persist.
- [x] outcomes can be recorded (distinct from results).
- [x] a process restart can resume the same run safely.
- [x] all 13 named exit tests pass; lint/typecheck/build green; CI defined.

## Next-phase implications

- Phase 3 (`aion-infra`) provisions the roles in [security.md](security.md),
  environment isolation, the managed secret store, and the production Postgres —
  Phase 2's role model and injectable config are ready for it.
- Phase 5–6 (outcome instrumentation, learning loops) build on `outcomes` and the
  append-only event log; the six-data-kinds distinction is preserved so lessons
  and recommendations can be added without collapsing lineage.
- Recommended Core follow-ups: the optional expected-version parameter and a
  unit-of-work handle, if/when concurrency requirements make them real.
