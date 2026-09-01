/**
 * Shared conversion helpers for the persistence boundary.
 *
 * node-postgres returns `timestamptz` as Date, `numeric`/`bigint` as string
 * (to avoid precision loss), and `jsonb` as already-parsed values. These helpers
 * normalize those into the shapes Core contracts expect (UTC ISO-8601 strings,
 * numbers, string arrays) before validation.
 */

/** Date → UTC ISO-8601 string (the single timestamp representation Core uses). */
export function toIso(d: Date): string {
  return d.toISOString();
}

/** Nullable Date → ISO string or undefined. */
export function toIsoOrUndefined(d: Date | null): string | undefined {
  return d === null ? undefined : d.toISOString();
}

/** node-postgres numeric (string) → number, preserving null as undefined. */
export function numberOrUndefined(v: string | null): number | undefined {
  return v === null ? undefined : Number(v);
}

/** Coerces a jsonb value into a string array (defaults to empty). */
export function stringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((item) => String(item));
}

/** Coerces a jsonb value into a metadata record (defaults to empty object). */
export function metadataObject(v: unknown): Record<string, unknown> {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    return v as Record<string, unknown>;
  }
  return {};
}
