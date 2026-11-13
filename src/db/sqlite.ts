import { DatabaseSync } from 'node:sqlite';

export type { DatabaseSync };

/**
 * Opens an existing SQLite file read-only; throws if it's missing. A single
 * connection is shared by all requests, which is safe because `node:sqlite` is
 * synchronous.
 */
export function openReadOnlyDatabase(filePath: string): DatabaseSync {
  return new DatabaseSync(filePath, { readOnly: true });
}

/** Logged with a `DataIntegrityError`. Must not hold record contents. */
export interface DataIntegrityContext {
  /** Table the bad row came from. */
  table: string;
  /** Primary key of the bad row, if it could be read. */
  rowId: unknown;
  /** One message per failing field. */
  issues: string[];
}

/**
 * Stored data with an unexpected shape. It is never repaired or skipped, and
 * clients get a generic 500.
 */
export class DataIntegrityError extends Error {
  constructor(
    message: string,
    readonly context: DataIntegrityContext,
  ) {
    super(message);
    this.name = 'DataIntegrityError';
  }
}
