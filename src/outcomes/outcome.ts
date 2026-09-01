import type { OutcomeId, RunId, MissionId } from '@aion/core';
import type { OutcomeStatus } from '@aion/core';

/**
 * OutcomeRecord — aion-data's durable outcome model.
 *
 * AION Core defines only a minimal {@link OutcomeReference} (outcomeId, runId,
 * missionId, status, externalReference, metadata) and no persistence port for
 * it (aion-core/src/contracts/outcome.ts). aion-data therefore OWNS the durable
 * outcome record, supersetting that reference with the business-outcome fields a
 * real learning loop will need — while preserving the hard distinction Core
 * draws (principles.md #6):
 *
 *   Execution Result  ≠  Business Outcome
 *   "proposal sent"       "proposal accepted and $5,000 collected"
 *
 * Every OutcomeRecord maps down to a Core-valid OutcomeReference (see
 * outcome-mapper.ts), so Core's compatibility contract always holds. Lessons and
 * recommendations are deliberately NOT modelled yet (Phase 2 non-goal).
 */
export interface OutcomeRecord {
  /** Minted by aion-data when the durable record is created. */
  outcomeId: OutcomeId;
  /** The run whose result may have led to this outcome. Required by Core. */
  runId: RunId;
  missionId?: MissionId;
  status: OutcomeStatus;
  /** Optional coarse classification, e.g. "revenue", "conversion". */
  outcomeType?: string;
  /** Pointer to the real-world record (an invoice id, say) — not the data. */
  externalReference?: string;
  /** Measured business value, when the outcome is quantified. */
  value?: number;
  /** ISO-4217 currency code, required alongside a monetary `value`. */
  currency?: string;
  /** When the outcome was measured (UTC ISO-8601). */
  measuredAt?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/** Fields a caller supplies to create an outcome; identity is minted by Data. */
export interface CreateOutcomeInput {
  runId: RunId;
  missionId?: MissionId;
  status?: OutcomeStatus;
  outcomeType?: string;
  externalReference?: string;
  value?: number;
  currency?: string;
  measuredAt?: string;
  metadata?: Record<string, unknown>;
}

/** Fields that may be updated on an existing outcome as reality resolves. */
export interface UpdateOutcomeInput {
  status?: OutcomeStatus;
  outcomeType?: string;
  externalReference?: string;
  value?: number;
  currency?: string;
  measuredAt?: string;
  metadata?: Record<string, unknown>;
}
