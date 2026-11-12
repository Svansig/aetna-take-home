import { describe, expect, it } from 'vitest';
import { NaiveSqliteRatingSource } from '../../src/movies/naive-sqlite-rating-source.js';
import { createFixtureRatingsDb, suppliedRatingsDb } from '../helpers.js';

describe('NaiveSqliteRatingSource (fixtures)', () => {
  const source = new NaiveSqliteRatingSource(
    createFixtureRatingsDb([
      [11, 3],
      [11, 4],
      [11, 4.5],
      [260, 5],
      [260, 5],
    ]),
  );

  it('aggregates exactly the ratings whose movieId equals the requested number', () => {
    expect(source.statsForMovie(11)).toEqual({ count: 3, sum: 11.5 });
    expect(source.statsForMovie(260)).toEqual({ count: 2, sum: 10 });
  });

  it('returns a zero count, not NaN or null, when nothing matches', () => {
    expect(source.statsForMovie(12)).toEqual({ count: 0, sum: 0 });
  });

  it('refuses unsafe ids before reaching SQLite', () => {
    expect(() => source.statsForMovie(Number.MAX_SAFE_INTEGER + 1)).toThrow(RangeError);
  });
});

describe('NaiveSqliteRatingSource (supplied ratings.db)', () => {
  const source = new NaiveSqliteRatingSource(suppliedRatingsDb());

  it('uses the raw numeric id: movies.db id 11 (Star Wars) gets MovieLens movie 11', () => {
    expect(source.statsForMovie(11)).toEqual({ count: 82, sum: 302.5 });
  });

  it("does not translate ids: Star Wars' real MovieLens id 260 is a different aggregate", () => {
    expect(source.statsForMovie(260)).toEqual({ count: 291, sum: 1228.5 });
  });

  it('agrees with an independent GROUP BY aggregate (first 500 rated ids)', () => {
    const rows = suppliedRatingsDb()
      .prepare(
        'SELECT movieId, COUNT(*) AS count, SUM(rating) AS sum FROM ratings GROUP BY movieId',
      )
      .all() as { movieId: number; count: number; sum: number }[];
    expect(rows).toHaveLength(9066);
    expect(rows.reduce((n, r) => n + r.count, 0)).toBe(100004);
    for (const row of rows.slice(0, 500)) {
      expect(source.statsForMovie(row.movieId)).toEqual({ count: row.count, sum: row.sum });
    }
  });
});
