import type { PageWindow } from '../http/pagination.js';
import type { GenreRef, MovieRecord, MovieSummaryRecord, SortOrder } from './schemas.js';

/** Conditions narrowing a movie listing. Present conditions are combined with AND. */
export interface MovieFilter {
  /** Calendar year (1–9999). Movies without a release date never match. */
  readonly releaseYear?: number | undefined;
  /** A genre the movie must have, by id or by case-insensitive exact name. */
  readonly genre?: GenreRef | undefined;
}

/**
 * Listing order. `releaseDate` sorts by date, then by `movieId` in the same
 * direction for equal dates; `movieId` sorts by the stable primary identifier.
 */
export interface MovieSort {
  readonly by: 'movieId' | 'releaseDate';
  readonly order: SortOrder;
}

/**
 * Movie data access used by `MovieService` (implemented by
 * `SqliteMovieRepository`). Implementations return
 * validated application records (budgets as whole-dollar integers; the service
 * formats them) and order results deterministically.
 */
export interface MovieRepository {
  /** Number of movies matching `filter` (`{}` counts all). */
  countMovies(filter: MovieFilter): number;
  /** One window of the movies matching `filter`, in `sort` order. */
  listMovies(filter: MovieFilter, sort: MovieSort, window: PageWindow): MovieSummaryRecord[];
  /** Whether any movie has the genre. */
  hasGenre(genre: GenreRef): boolean;
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
 * database that uses a different movie id system (see `NaiveSqliteRatingSource`).
 */
export interface RatingSource {
  statsForMovie(movieId: number): RatingStats;
}
