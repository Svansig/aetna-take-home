import type { DatabaseSync, StatementSync } from 'node:sqlite';
import { z } from 'zod';
import { DataIntegrityError } from '../db/sqlite.js';
import type { RatingSource, RatingStats } from './repository.js';

const StatsRowSchema = z.object({ count: z.int().min(0), sum: z.number() });

/**
 * V1 rating source over the original supplied `ratings.db`.
 *
 * **Deliberately naive.** It matches `movies.movieId` (a TMDB id) to
 * `ratings.movieId` (a MovieLens id) as if they were the same number. They are
 * different id systems, so for many movies the ratings belong to an unrelated
 * film. For example, movieId 11 (Star Wars) picks up MovieLens movie 11's ratings
 * (average 3.69), while Star Wars' real MovieLens id is 260 (average 4.22). V1
 * keeps this behaviour on purpose to reflect the supplied data. A corrected
 * mapping is planned for V2.
 *
 * `ratings.movieId` has no index and the schema must not change, so each call
 * scans the 100,004-row table (about 2 ms).
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
