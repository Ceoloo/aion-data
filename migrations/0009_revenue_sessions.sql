-- Mission-001: opaque, versioned product checkpoints. Product code owns the
-- payload shape; Data owns persistence. Internal single-tenant service only.
CREATE TABLE revenue_sessions (
  session_id text PRIMARY KEY,
  checkpoint jsonb,
  final_record jsonb,
  revision integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((checkpoint IS NOT NULL AND final_record IS NULL)
      OR (checkpoint IS NULL AND final_record IS NOT NULL))
);
-- Grants remain a migration/deployment responsibility; never grant anonymous
-- or browser roles access to these PII-bearing records.
