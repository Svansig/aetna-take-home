import type { MovieRecord, MovieSummary } from './schemas.js';

/**
 * Movie data access used by `MovieService`. Each API version supplies its own
 * implementation (V1: original SQLite database). Implementations return
 * validated application records and order results deterministically.
 */
export interface MovieRepository {
  countMovies(): number;
  /** Movies ordered by their stable primary identifier, ascending. */
  listMovies(window: { limit: number; offset: number }): MovieSummary[];
  /** One movie by its numeric `movieId`, or `undefined` if there is none. */
  findMovieById(movieId: number): MovieRecord | undefined;
}

/** Raw rating aggregate for one movie. `sum` is 0 when `count` is 0. */
export interface RatingStats {
  readonly count: number;
  readonly sum: number;
}

/**
 * Where a movie's ratings come from, given the movies database's `movieId`.
 * This is separate from `MovieRepository` because ratings live in another
 * database, and the way the two are associated differs by version. V1 matches
 * ids naively; V2 is planned to use a corrected id mapping.
 */
export interface RatingSource {
  statsForMovie(movieId: number): RatingStats;
}
