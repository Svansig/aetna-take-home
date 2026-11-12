import type { PageWindow } from '../http/pagination.js';
import type { MovieRecord, MovieSummary, SortOrder } from './schemas.js';

/** Conditions narrowing a movie listing. */
export interface MovieFilter {
  /** Calendar year (1–9999). Movies without a release date never match. */
  readonly releaseYear: number;
}

/**
 * Movie data access used by `MovieService`. Each API version supplies its own
 * implementation (V1: original SQLite database). Implementations return
 * validated application records and order results deterministically.
 */
export interface MovieRepository {
  /** Number of movies, or of movies matching `filter`. */
  countMovies(filter?: MovieFilter): number;
  /** All movies ordered by their stable primary identifier, ascending. */
  listMovies(window: PageWindow): MovieSummary[];
  /**
   * Movies matching `filter`, ordered by release date and then by the primary
   * identifier, both in `sortOrder` direction, so equal dates are deterministic.
   */
  listMoviesByReleaseDate(
    filter: MovieFilter,
    sortOrder: SortOrder,
    window: PageWindow,
  ): MovieSummary[];
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
