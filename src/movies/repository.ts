import type { PageWindow } from '../http/pagination.js';
import type { GenreRef, MovieRecord, MovieSummaryRecord, SortOrder } from './schemas.js';

/** Conditions narrowing a movie listing. Present conditions are combined with AND. */
export interface MovieFilter {
  /** Calendar year (1–9999). Movies without a release date never match. */
  readonly releaseYear?: number | undefined;
  /** A genre the movie must have, by id or by case-insensitive exact name. */
  readonly genre?: GenreRef | undefined;
}

/** Listing order. Equal `releaseDate`s are ordered by `movieId` in the same direction. */
export interface MovieSort {
  /** Primary sort column. */
  readonly by: 'movieId' | 'releaseDate';
  /** Direction for the sort column and the `movieId` tie-break. */
  readonly order: SortOrder;
}

/** Movie data access. Returns validated records, with budgets as whole-dollar integers. */
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
  /** Number of matching ratings. */
  readonly count: number;
  /** Sum of the matching ratings. */
  readonly sum: number;
}

/** Kept separate from `MovieRepository` because ratings live in another database with different movie ids. */
export interface RatingSource {
  statsForMovie(movieId: number): RatingStats;
}
