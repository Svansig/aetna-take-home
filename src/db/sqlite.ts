import { DatabaseSync } from 'node:sqlite';

export type { DatabaseSync };

/**
 * Open an existing SQLite file read-only. One connection is opened at startup and
 * shared: `node:sqlite` is synchronous, and a read-only connection is safe to reuse
 * for every request in this single-threaded process. Throws if the file is missing
 * or unreadable, so the server fails fast at startup.
 */
export function openReadOnlyDatabase(filePath: string): DatabaseSync {
  return new DatabaseSync(filePath, { readOnly: true });
}

/**
 * Stored data that doesn't match the expected shape. It is never "repaired" or
 * skipped. The central error handler logs it with this context and returns a
 * generic 500. The context identifies the row and the failing fields but holds no
 * record contents.
 */
export class DataIntegrityError extends Error {
  constructor(
    message: string,
    readonly context: { table: string; rowId: unknown; issues: string[] },
  ) {
    super(message);
    this.name = 'DataIntegrityError';
  }
}
