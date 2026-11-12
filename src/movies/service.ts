import { HttpError } from '../http/errors.js';
import { PAGE_SIZE, pageWindow, totalPages } from '../http/pagination.js';
import type { MovieRepository, RatingSource, RatingStats } from './repository.js';
import type { MovieDetails, MovieListResponse } from './schemas.js';

/** A valid movie id that doesn't exist. The central handler turns it into a 404. */
export class MovieNotFoundError extends HttpError {
  constructor(movieId: number) {
    super(404, 'MOVIE_NOT_FOUND', `Movie ${String(movieId)} not found`);
    this.name = 'MovieNotFoundError';
  }
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
   * One page of all movies. A page past the end returns an empty `data` array with
   * accurate metadata. Such pages never reach the data query, so no offset is
   * computed for them, however large the page number.
   */
  listMovies(page: number): MovieListResponse {
    const totalItems = this.repository.countMovies();
    const pages = totalPages(totalItems);
    const data = page <= pages ? this.repository.listMovies(pageWindow(page)) : [];
    return {
      data,
      pagination: { page, pageSize: PAGE_SIZE, totalItems, totalPages: pages },
    };
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
