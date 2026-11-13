import type { DatabaseSync, StatementSync } from 'node:sqlite';
import { z } from 'zod';
import { DataIntegrityError } from '../db/sqlite.js';
import type { RatingSource, RatingStats } from './repository.js';

const StatsRowSchema = z.object({
  /** `COUNT(*)` of the movie's ratings. */
  count: z.int().min(0),
  /** `TOTAL(rating)`; 0.0 when there are none. */
  sum: z.number(),
});

/**
 * Ratings from `ratings.db`, **deliberately matched naively**: `movies.movieId`
 * (TMDB) is treated as the same number as `ratings.movieId` (MovieLens), so many
 * averages belong to a different film. Fixing this would need a TMDB-to-MovieLens
 * mapping, which the supplied data doesn't include.
 *
 * `ratings.movieId` has no index and the schema must not change, so each call
 * scans the whole table (about 2 ms).
 */
export class NaiveSqliteRatingSource implements RatingSource {
  private readonly statement: StatementSync;

  constructor(db: DatabaseSync) {
    // TOTAL() returns 0.0 for no rows and always returns a float.
    this.statement = db.prepare(
      'SELECT COUNT(*) AS count, TOTAL(rating) AS sum FROM ratings WHERE movieId = :movieId',
    );
  }

  statsForMovie(movieId: number): RatingStats {
    if (!Number.isSafeInteger(movieId)) {
      throw new RangeError('movieId must be a safe integer');
    }
    const parsed = StatsRowSchema.safeParse(this.statement.get({ movieId }));
    if (!parsed.success) {
      throw new DataIntegrityError('ratings aggregate has an unexpected shape', {
        table: 'ratings',
        rowId: movieId,
        issues: parsed.error.issues.map((i) => i.message),
      });
    }
    return parsed.data;
  }
}
