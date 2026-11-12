import { HttpError } from '../http/errors.js';
import { paginate } from '../http/pagination.js';
import type { MovieRepository, MovieSort, RatingSource, RatingStats } from './repository.js';
import type { GenreRef, MovieDetails, MovieListResponse, SortOrder } from './schemas.js';

/** A valid movie id that doesn't exist. The central handler turns it into a 404. */
export class MovieNotFoundError extends HttpError {
  constructor(movieId: number) {
    super(404, 'MOVIE_NOT_FOUND', `Movie ${String(movieId)} not found`);
    this.name = 'MovieNotFoundError';
  }
}

/** A valid genre id or name that no movie in this version's data has. */
export class GenreNotFoundError extends HttpError {
  constructor(genre: GenreRef) {
    super(
      404,
      'GENRE_NOT_FOUND',
      'id' in genre
        ? `Genre ${String(genre.id)} not found`
        : `Genre ${JSON.stringify(genre.name)} not found`,
    );
    this.name = 'GenreNotFoundError';
  }
}

/** What to list: a page, a direction and optional filters (combined with AND). */
export interface MovieListCriteria {
  readonly page: number;
  readonly sortOrder: SortOrder;
  readonly releaseYear?: number | undefined;
  readonly genre?: GenreRef | undefined;
}

/**
 * Arithmetic mean rounded half-up to 2 decimal places, or `null` with no ratings.
 * The rounding works on `sum * 100 / count` instead of `mean * 100`. Ratings have
 * at most 2 decimals, so `sum * 100` is an exact integer, and an exact half lands
 * exactly on .5. For example, a true mean of 1.005 rounds to 1.01, not 1.00.
 */
export function averageRating({ sum, count }: RatingStats): number | null {
  if (count === 0) return null;
  return Math.round((sum * 100) / count) / 100;
}

/** Movie use cases, shared by every API version and independent of Express. */
export class MovieService {
  constructor(
    private readonly repository: MovieRepository,
    private readonly ratings: RatingSource,
  ) {}

  /**
   * One page of movies, for every listing URL (all, by year, by genre, combined).
   *
   * - An unknown genre is a 404, even when other filters would match nothing anyway.
   *   A known genre with no matches under the other filters is an empty page.
   * - With a year, the order is chronological (ties broken by movie id in the same
   *   direction); without one, it is by movie id.
   * - A page past the end returns an empty `data` array with accurate metadata and
   *   never reaches the data query.
   */
  listMovies({ page, sortOrder, releaseYear, genre }: MovieListCriteria): MovieListResponse {
    if (genre !== undefined && !this.repository.hasGenre(genre)) {
      throw new GenreNotFoundError(genre);
    }
    const filter = { releaseYear, genre };
    const sort: MovieSort = {
      by: releaseYear === undefined ? 'movieId' : 'releaseDate',
      order: sortOrder,
    };
    return paginate(page, this.repository.countMovies(filter), (window) =>
      this.repository.listMovies(filter, sort, window),
    );
  }

  /** Details for one movie, with its average rating from the version's rating source. */
  getMovieDetails(movieId: number): MovieDetails {
    const movie = this.repository.findMovieById(movieId);
    if (movie === undefined) throw new MovieNotFoundError(movieId);

    return {
      imdbId: movie.imdbId,
      title: movie.title,
      description: movie.description,
      releaseDate: movie.releaseDate,
      budget: movie.budget,
      runtime: movie.runtime,
      averageRating: averageRating(this.ratings.statsForMovie(movieId)),
      genres: movie.genres,
      originalLanguage: movie.originalLanguage,
      productionCompanies: movie.productionCompanies,
    };
  }
}
