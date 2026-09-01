/**
 * AION Data domain errors.
 *
 * Errors crossing the persistence boundary are machine-readable — a stable
 * `code` plus structured `details` — never opaque strings
 * (aion-docs/engineering/api-standards.md: "Errors are structured and honest").
 * This mirrors AION Core's error philosophy so a consumer can branch on `code`
 * without string matching, but the two hierarchies stay separate: Data does not
 * import Core's error classes, keeping the dependency one-directional.
 */

export const DATA_ERROR_CODES = [
  'CONFIG',
  'MIGRATION',
  'MAPPING',
  'PERSISTENCE',
  'CONCURRENCY',
  'NOT_FOUND',
] as const;
export type DataErrorCode = (typeof DATA_ERROR_CODES)[number];

/** Base class for all AION Data errors. */
export abstract class DataError extends Error {
  abstract readonly code: DataErrorCode;
  readonly details: Record<string, unknown>;

  constructor(message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = new.target.name;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }

  toJSON(): {
    name: string;
    code: DataErrorCode;
    message: string;
    details: Record<string, unknown>;
  } {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      details: this.details,
    };
  }
}

/** Invalid or missing configuration (e.g. no connection string). */
export class ConfigError extends DataError {
  readonly code = 'CONFIG';
}

/** A migration failed to apply, or the migration set is inconsistent. */
export class MigrationError extends DataError {
  readonly code = 'MIGRATION';
}

/**
 * Persisted data failed to validate against its Core contract on the way out.
 * This is the persistence boundary refusing to hand Core an object it would not
 * itself have produced — never an unchecked cast (aion-docs data-contracts).
 */
export class MappingError extends DataError {
  readonly code = 'MAPPING';
}

/** An underlying database operation failed. */
export class PersistenceError extends DataError {
  readonly code = 'PERSISTENCE';
}

/**
 * An optimistic-concurrency check failed: the row changed since it was read.
 * Raised by the version-checked write path (compareAndSave).
 */
export class ConcurrencyError extends DataError {
  readonly code = 'CONCURRENCY';
}

/** A referenced entity does not exist. */
export class NotFoundError extends DataError {
  readonly code = 'NOT_FOUND';
}

/** Type guard for AION Data errors. */
export function isDataError(value: unknown): value is DataError {
  return value instanceof DataError;
}

/**
 * Normalizes a caught error for a persistence operation: an existing
 * {@link DataError} (e.g. a {@link MappingError} raised by the boundary
 * validation) is preserved as-is; anything else is wrapped as a
 * {@link PersistenceError}. This keeps precise error codes from being masked by
 * a repository's catch-all.
 */
export function toPersistenceError(
  op: string,
  err: unknown,
  details: Record<string, unknown> = {},
): DataError {
  if (isDataError(err)) return err;
  return new PersistenceError(`failed to ${op}`, {
    ...details,
    cause: err instanceof Error ? err.message : String(err),
  });
}
