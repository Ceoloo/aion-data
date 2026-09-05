import type { Queryable } from '../db/client.js';

export interface RevenueSessionRow {
  sessionId: string;
  checkpoint: unknown | null;
  finalRecord: unknown | null;
  revision: number;
}

/** Payloads are opaque to Data; callers validate their versioned product shape. */
export class PostgresRevenueSessionRepository {
  constructor(private readonly db: Queryable) {}

  async get(sessionId: string): Promise<RevenueSessionRow | undefined> {
    const { rows } = await this.db.query(
      'SELECT * FROM revenue_sessions WHERE session_id = $1', [sessionId],
    );
    const row = rows[0];
    return row ? {
      sessionId: row.session_id as string,
      checkpoint: row.checkpoint as unknown,
      finalRecord: row.final_record as unknown,
      revision: row.revision as number,
    } : undefined;
  }

  async create(sessionId: string, checkpoint: unknown): Promise<void> {
    await this.db.query(
      'INSERT INTO revenue_sessions (session_id, checkpoint) VALUES ($1, $2::jsonb)',
      [sessionId, JSON.stringify(checkpoint)],
    );
  }

  /** Atomic checkpoint or finalization, with stale-writer protection. */
  async save(row: RevenueSessionRow): Promise<void> {
    const result = await this.db.query(
      `UPDATE revenue_sessions SET checkpoint=$2::jsonb, final_record=$3::jsonb,
         revision=revision+1, updated_at=now()
       WHERE session_id=$1 AND revision=$4 AND final_record IS NULL`,
      [row.sessionId, row.checkpoint === null ? null : JSON.stringify(row.checkpoint),
        row.finalRecord === null ? null : JSON.stringify(row.finalRecord), row.revision],
    );
    if (result.rowCount !== 1) throw new Error('stale or finalized revenue session');
  }

  async listFinalized(): Promise<unknown[]> {
    const { rows } = await this.db.query(
      'SELECT final_record FROM revenue_sessions WHERE final_record IS NOT NULL ORDER BY updated_at',
    );
    return rows.map((row) => row.final_record as unknown);
  }

  async listActive(): Promise<string[]> {
    const { rows } = await this.db.query(
      'SELECT session_id FROM revenue_sessions WHERE checkpoint IS NOT NULL ORDER BY updated_at',
    );
    return rows.map((row) => row.session_id as string);
  }
}
