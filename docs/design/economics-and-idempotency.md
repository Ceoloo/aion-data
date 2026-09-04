# Design Spec — Execution Evidence, Idempotency & Agent Economics (Persistence)

- **Drives:** aion-docs
  [ADR-003](https://github.com/Ceoloo/aion-docs/blob/main/adr/ADR-003-execution-gateway-and-evidence.md)
  (idempotency, replay safety, receipts) and
  [ADR-004](https://github.com/Ceoloo/aion-docs/blob/main/adr/ADR-004-agent-economics-layer.md)
  (agent economics)
- **Priority:** P0 (receipts/idempotency) / Phase-5 (economics)
- **Status:** Design — **not** an applied migration. This spec proposes DDL; it
  is materialized as a numbered migration only when a mission requires it
  (Mission Before Infrastructure). Migration `0001` is unchanged and immutable.

aion-data owns durability for two aion-docs decisions. Core defines the ports
and contracts
([aion-core/docs/design/execution-gateway.md](https://github.com/Ceoloo/aion-core/blob/main/docs/design/execution-gateway.md));
this spec is the canonical **storage** design behind them, following the
[schema conventions](../schema.md) and
[migration policy](../../migrations/README.md) already in force.

## What this adds to the lineage

```
missions ──< runs ──< approvals
               ├──< events
               ├──< telemetry_records
               ├──< execution_receipts   (NEW — one per governed side effect)
               ├──< outcomes
               └──< agent_economics       (NEW — one per agent-run; derived)
idempotency_keys (NEW — at-most-once ledger; points at the winning receipt)
```

Everything here **supersets** existing records, never forks them: receipts are a
new evidence kind; economics is a new *derived analytics* kind
([data kinds](https://github.com/Ceoloo/aion-docs/blob/main/architecture/data-layer.md)).
Cost inputs come from `execution_receipts` + `telemetry_records`; value inputs
come from `outcomes`.

---

## Part 1 — Idempotency & execution receipts (P0)

Two tables. `execution_receipts` is the authoritative evidence ledger;
`idempotency_keys` is the small, hot claim ledger the gateway reads *before*
dispatch. They are split because their access patterns differ: the claim ledger
is a tiny write-once row on the hot path; the receipt is a wider append-only
evidence record.

### `execution_receipts`

```sql
-- Durable proof that a governed side effect executed at-most-once. Append-only,
-- terminal (succeeded|failed only). Distinct from events (business facts) and
-- telemetry (sampling-tolerant observation). Source of truth for audit and the
-- economics cost inputs. Maps Core's ExecutionReceipt contract exactly; the
-- arguments themselves are NEVER stored — only their canonical hash.
CREATE TABLE execution_receipts (
  receipt_id       text PRIMARY KEY,                 -- Core ReceiptId "rcp_..."
  idempotency_key  text NOT NULL,                    -- the at-most-once scope
  run_id           text NOT NULL REFERENCES runs (run_id),
  request_id       text NOT NULL,
  mission_id       text REFERENCES missions (mission_id),
  capability       text NOT NULL,
  tool_id          text,
  arguments_hash   text NOT NULL
                     CHECK (arguments_hash ~ '^sha256:[0-9a-f]{64}$'),
  risk_level       text NOT NULL CHECK (risk_level IN ('R0','R1','R2','R3')),
  approval_state   text NOT NULL
                     CHECK (approval_state IN ('not_required','pending','approved','rejected')),
  autonomy_tier    text CHECK (autonomy_tier IS NULL
                     OR autonomy_tier IN ('AUTO','MONITOR','APPROVE','DENY')),
  executor         text NOT NULL,                    -- which adapter/runtime ran it
  model            text,                             -- vendor-neutral, honest
  status           text NOT NULL CHECK (status IN ('succeeded','failed')),
  -- Cost captured at source, split where knowable (feeds economics).
  compute_cost     numeric CHECK (compute_cost IS NULL OR compute_cost >= 0),
  tool_cost        numeric CHECK (tool_cost    IS NULL OR tool_cost    >= 0),
  cost_units       numeric NOT NULL DEFAULT 0 CHECK (cost_units >= 0), -- abstract total
  tokens           numeric CHECK (tokens IS NULL OR tokens >= 0),
  result_reference text,                             -- pointer, not the payload
  started_at       timestamptz NOT NULL,
  completed_at     timestamptz NOT NULL,
  metadata         jsonb NOT NULL DEFAULT '{}'::jsonb,
  seq              bigserial NOT NULL,               -- monotonic order, as events
  recorded_at      timestamptz NOT NULL DEFAULT now(),
  -- One authoritative terminal receipt per key. This uniqueness is what makes
  -- "return the prior receipt instead of re-executing" correct.
  CONSTRAINT execution_receipts_key_unique UNIQUE (idempotency_key)
);

CREATE INDEX execution_receipts_run_id_seq_idx  ON execution_receipts (run_id, seq);
CREATE INDEX execution_receipts_mission_id_idx  ON execution_receipts (mission_id);
CREATE INDEX execution_receipts_capability_idx  ON execution_receipts (capability, completed_at);
```

- **Append-only, like `events`/`telemetry_records`.** No routine update/delete
  path; corrections are new records or new outcomes, never edits (migration
  policy: append-only history).
- **No arguments, ever.** Only `arguments_hash` — proving *what* ran without
  storing (possibly sensitive) inputs
  ([observability-standards](https://github.com/Ceoloo/aion-docs/blob/main/engineering/observability-standards.md):
  reference, don't copy).
- **Classification: CONFIDENTIAL** — `result_reference`/metadata may point at
  sensitive records; keep them references.

### `idempotency_keys`

```sql
-- The hot at-most-once claim ledger. The gateway INSERTs a claim before dispatch
-- and resolves the outcome after. Kept narrow so the pre-dispatch read/write is
-- cheap. The (idempotency_key) primary key + arguments_hash column let the
-- gateway distinguish: fresh / replay / in_flight / conflict.
CREATE TABLE idempotency_keys (
  idempotency_key  text PRIMARY KEY,
  run_id           text NOT NULL REFERENCES runs (run_id),
  arguments_hash   text NOT NULL
                     CHECK (arguments_hash ~ '^sha256:[0-9a-f]{64}$'),
  state            text NOT NULL DEFAULT 'in_flight'
                     CHECK (state IN ('in_flight','succeeded','failed')),
  receipt_id       text REFERENCES execution_receipts (receipt_id), -- set when terminal
  claimed_at       timestamptz NOT NULL DEFAULT now(),
  resolved_at      timestamptz,
  -- A terminal claim must point at its receipt; an in-flight claim must not.
  CONSTRAINT idempotency_terminal_has_receipt CHECK (
    (state = 'in_flight' AND receipt_id IS NULL AND resolved_at IS NULL)
    OR
    (state IN ('succeeded','failed') AND receipt_id IS NOT NULL AND resolved_at IS NOT NULL)
  )
);
```

**The claim protocol** (implements Core's `IdempotencyStore.claim`):

1. `INSERT ... ON CONFLICT (idempotency_key) DO NOTHING`.
   - **row inserted** → `fresh`; proceed to dispatch.
   - **conflict** → read the existing row:
     - `arguments_hash` differs → **`conflict`** (key reused for a different
       action) → gateway fails safe.
     - same hash, `state='in_flight'` → **`in_flight`** → gateway does not
       double-dispatch.
     - same hash, terminal → **`replay`**; return the linked receipt; **no
       re-execution**.
2. After the adapter returns, write the `execution_receipts` row, then
   `UPDATE idempotency_keys SET state, receipt_id, resolved_at`. If the receipt
   write fails, the claim stays `in_flight` and a bounded reaper (or the next
   retry after a lease timeout) can reclaim it — so a crash mid-step never
   strands a key as permanently blocking while also never marking a
   never-executed action terminal.

> **Alternative considered:** collapse both into `execution_receipts` with a
> non-terminal state. Rejected for the hot path — the claim must be a tiny
> write-once row read on every dispatch; widening it to the full evidence record
> makes the common case pay for the rare one. The split keeps the guarantee
> obvious and cheap. (Recorded per data-contracts evolution discipline.)

---

## Part 2 — Agent economics (Phase 5, derived)

Economics is a **derived analytics contract**, not operational state. It is
computed *about* runs by aion-data from authoritative cost (receipts/telemetry)
and measured value (outcomes) — never written by a worker
([ADR-004](https://github.com/Ceoloo/aion-docs/blob/main/adr/ADR-004-agent-economics-layer.md)).

### `agent_economics`

```sql
-- One row per agent-run. Trust levels are explicit in the column grouping and
-- documented in docs/schema.md when materialized: cost = authoritative,
-- value = measured, attributed value = estimated (carries method+confidence),
-- roi = derived (a VIEW, not stored as if measured).
CREATE TABLE agent_economics (
  economics_id          text PRIMARY KEY,            -- "aecon_..."
  run_id                text NOT NULL REFERENCES runs (run_id),
  mission_id            text REFERENCES missions (mission_id),
  agent_id              text,                          -- attributable identity
  runtime               text,                          -- execution environment
  model                 text,
  -- cost (AUTHORITATIVE — from receipts + telemetry)
  compute_cost          numeric CHECK (compute_cost IS NULL OR compute_cost >= 0),
  tool_cost             numeric CHECK (tool_cost    IS NULL OR tool_cost    >= 0),
  tokens                numeric CHECK (tokens IS NULL OR tokens >= 0),
  latency_ms            numeric CHECK (latency_ms IS NULL OR latency_ms >= 0),
  -- completion & quality (MEASURED)
  task_result           text CHECK (task_result IS NULL
                          OR task_result IN ('success','failure','partial')),
  eval_score            numeric CHECK (eval_score IS NULL
                          OR (eval_score >= 0 AND eval_score <= 1)),
  -- realized value (MEASURED — from outcomes)
  human_minutes_saved   numeric CHECK (human_minutes_saved IS NULL OR human_minutes_saved >= 0),
  revenue_created       numeric,                        -- measured
  revenue_created_ccy   text CHECK (revenue_created_ccy IS NULL OR revenue_created_ccy ~ '^[A-Z]{3}$'),
  -- attributed value (ESTIMATED — never laundered into "measured")
  revenue_influenced    numeric,
  revenue_influenced_ccy text CHECK (revenue_influenced_ccy IS NULL OR revenue_influenced_ccy ~ '^[A-Z]{3}$'),
  attribution_method    text,                           -- e.g. 'last_touch','model_v1'
  attribution_confidence numeric CHECK (attribution_confidence IS NULL
                          OR (attribution_confidence >= 0 AND attribution_confidence <= 1)),
  computed_at           timestamptz NOT NULL DEFAULT now(),
  metadata              jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT agent_economics_run_unique UNIQUE (run_id),
  CONSTRAINT revenue_created_needs_ccy    CHECK (revenue_created    IS NULL OR revenue_created_ccy    IS NOT NULL),
  CONSTRAINT revenue_influenced_needs_ccy CHECK (revenue_influenced IS NULL OR revenue_influenced_ccy IS NOT NULL),
  CONSTRAINT attribution_coherent CHECK (
    revenue_influenced IS NULL OR (attribution_method IS NOT NULL AND attribution_confidence IS NOT NULL)
  )
);

CREATE INDEX agent_economics_mission_idx ON agent_economics (mission_id);
CREATE INDEX agent_economics_agent_idx   ON agent_economics (agent_id, computed_at);
```

### Derived ROI — views, not stored numbers

The four canonical metrics from
[architecture/agent-economics.md](https://github.com/Ceoloo/aion-docs/blob/main/architecture/agent-economics.md)
are **views** so ROI is always recomputed from inputs and never drifts from
them. Illustrative shape (unit→currency pricing applied via an owned mapping,
not hard-coded):

```sql
CREATE VIEW agent_economics_roi AS
SELECT
  e.agent_id,
  e.mission_id,
  count(*) FILTER (WHERE e.task_result = 'success')            AS successful_tasks,
  sum(coalesce(e.compute_cost,0) + coalesce(e.tool_cost,0))    AS total_agent_cost,
  -- cost per successful task
  sum(coalesce(e.compute_cost,0) + coalesce(e.tool_cost,0))
    / nullif(count(*) FILTER (WHERE e.task_result='success'),0) AS cost_per_successful_task,
  -- automation efficiency (time saved per unit cost)
  sum(coalesce(e.human_minutes_saved,0))
    / nullif(sum(coalesce(e.compute_cost,0)+coalesce(e.tool_cost,0)),0) AS automation_efficiency,
  -- agent utility = successful outcomes x quality / total cost
  sum((e.task_result='success')::int * coalesce(e.eval_score,0))
    / nullif(sum(coalesce(e.compute_cost,0)+coalesce(e.tool_cost,0)),0) AS agent_utility
FROM agent_economics e
GROUP BY e.agent_id, e.mission_id;
```

Revenue ROI is a sibling view once a revenue-attribution method is fixed by ADR
(the brief and ADR-004 defer the method choice to first revenue mission).

## Evolution, lineage, classification

- **Additive.** All of this is new tables/views; migration `0001` is untouched,
  so this is additive-by-default and safe
  ([data-contracts](https://github.com/Ceoloo/aion-docs/blob/main/engineering/data-contracts.md)).
- **Lineage preserved.** Every economics row traces to its receipts
  (`run_id`), telemetry (`run_id`), and outcomes (`run_id`); ROI views trace to
  `agent_economics`. No derived number is severable from its source.
- **Classification.** `execution_receipts` and `agent_economics` are
  **CONFIDENTIAL** (monetary values, external references); documented in
  `docs/schema.md` when materialized. No column is a home for secrets.
- **Ports.** Data supplies the concrete `IdempotencyStore` and `ReceiptSink`
  (Core ports) as repositories alongside the existing postgres repositories;
  economics is written by an aion-data computation job, not a Core port (Core
  does not own derived data).

## What this spec deliberately does NOT do

- Does not apply a migration. It is design; a numbered migration is added when a
  mission needs it.
- Does not choose an event bus, OLAP store, or index engine — deferred to ADR if
  the receipt hot-path or economics aggregation outgrows Postgres.
- Does not fix the revenue-attribution model — ADR-gated at first revenue
  mission.
- Does not build lessons/recommendations tables — those remain later-phase.
