# AION Data — Architecture

AION Data is the durable **system of record** for the AION control plane. Its one
architectural job: let the Phase 1 AION Core lifecycle run against a real database
**without Core learning that a database exists**.

## The boundary

```
┌─────────────────────────────────────────────────────────────┐
│ AION CORE  (Phase 1)                                          │
│  • Orchestrator, PolicyEngine, ApprovalGate, RiskEvaluator   │
│  • Contracts: Mission, Actor, Command, Run, ApprovalRequest, │
│    AionEvent, TelemetryRecord, OutcomeReference, …           │
│  • PORTS (interfaces): MissionRepository, RunRepository,      │
│    ApprovalStore, EventSink, TelemetrySink                    │
└───────────────▲──────────────────────────────────────────────┘
                │ depends on interfaces only (never on pg/SQL)
                │ implemented by
┌───────────────┴──────────────────────────────────────────────┐
│ AION DATA  (Phase 2)                                          │
│  • Postgres adapters: Postgres{Mission,Run,Approval,Event,   │
│    Telemetry}…  ← satisfy the Core ports exactly             │
│  • Mappers: validated row ⇄ Core contract                    │
│  • Migrations, constraints, indexes, transactions            │
│  • Local repos: Actor, Outcome (no Core port exists)         │
└───────────────▲──────────────────────────────────────────────┘
                │ SQL
┌───────────────┴──────────────────────────────────────────────┐
│ PostgreSQL                                                    │
└──────────────────────────────────────────────────────────────┘
```

Allowed dependency direction (aion-docs/repositories/dependency-rules.md):
`aion-core → aion-data`. Data **never** depends on Core for behavior; it depends
on Core only for the **contract shapes** it must persist. Data never imports a
product, and Core never imports `pg`.

## How Core stays database-agnostic

1. **Core owns the ports.** `MissionRepository`, `RunRepository`, `ApprovalStore`,
   `EventSink`, `TelemetrySink` are declared in `aion-core/src/ports`. AION Data
   `implements` them; Core is wired to the interface, so swapping in-memory for
   Postgres changes no Core code. `tests/setup/orchestrator.ts` builds a **real**
   Core `Orchestrator` on the Postgres adapters — the same kernel that runs on the
   in-memory adapters — which is the proof of agnosticism.

2. **Contracts cross the boundary; rows do not.** Every adapter returns Core
   contract objects, never raw rows. Row shapes live in `src/types/database.ts`
   and are translated by `src/mappers/*`. Nothing SQL-shaped leaks into Core.

3. **Mappers validate on the way out.** Each `rowTo*` mapper re-parses the
   row-derived object through the Core zod schema (`Mission`, `Run`,
   `ApprovalRequest`, `AionEvent`, `TelemetryRecord`, `Actor`) before returning
   it. Persisted data that would violate a Core contract raises a `MappingError`
   at the boundary instead of handing Core an invalid object. There is no
   unchecked `as` cast at the persistence seam.

4. **Consuming the real Core, not a copy.** Forking canonical contracts is
   forbidden (dependency-rules #4). Core is not published to a registry and ships
   only `dist` via its `files` field (uncommitted), so a `github:` install yields
   an empty package. `scripts/setup-core.mjs` therefore clones the **pinned** Core
   commit into `vendor/aion-core`, builds it, and `package.json` links it with
   `file:vendor/aion-core`. AION Data thus always validates against the authentic
   Core schemas.

## Request lifecycle, made durable

The Core Orchestrator drives the lifecycle; AION Data persists each transition.

```
submit(command)
  └─ runRepository.save(run: created)                → runs
  └─ events.emit(command.received)                   → events (append-only)
  └─ telemetry.record(command.received)              → telemetry_records
  └─ runRepository.save(run: evaluating)             → runs
  └─ policyEngine.evaluate(command)                  (Core; no DB)
       ├─ DENY               → run: denied, policy.denied event, telemetry
       ├─ REQUIRE_APPROVAL   → run: awaiting_approval, approvalStore.save(request
       │                        incl. command snapshot), approval.requested event
       └─ ALLOW              → execute → run: completed|failed, events, telemetry

resume(decision)                       (after a process restart)
  └─ approvalGate.decide → approvalStore.get/save    → approvals
  └─ runRepository.get(approval.runId)               → the SAME run
  └─ execute → run: completed, approval.granted + execution.* events, telemetry
```

The command that a human approved is stored **with the approval** (an immutable
`command_snapshot`), so `resume` reconstructs the exact original intent and
continues the *same* run rather than starting a new one.

## Transactions & the unit-of-work

`withTransaction(pool, fn)` and `DataLayer.transaction(fn)` provide atomic
multi-write boundaries (all-or-nothing). Repositories accept a `Queryable`
(satisfied by both a pool and a transaction client), so the identical repository
code runs autocommit per call or bound to one transaction.

Core's Phase 1 ports are single-method (`save`/`emit`/`record`) and the
orchestrator calls them independently, so it does **not** currently ask Data for
cross-port atomicity — each port call autocommits, matching the in-memory
semantics it replaces. The transaction primitive is provided for consumers and to
make the gap explicit rather than hidden. See
[phase-2.md](phase-2.md#architecture-issues-discovered).

## Ownership summary

| Concern | Owner |
|---|---|
| Behavior: what runs, who may, whether it needs approval | **aion-core** |
| Runtime contracts (Mission, Run, Event, …) | **aion-core** |
| Durable schema, migrations, constraints, indexes, lineage | **aion-data** |
| Persistence access patterns | **aion-data** |
| Provisioning, environments, secret store | **aion-infra** (Phase 3) |
| Product/business entities | later phases, elsewhere |

The database persists truth; Core governs behavior. That line is the whole point
of Phase 2.
