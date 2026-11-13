import { HttpError } from '../http/errors.js';
import { paginate } from '../http/pagination.js';
import type { MovieRepository, MovieSort, RatingSource, RatingStats } from './repository.js';
import type {
  GenreRef,
  MovieDetails,
  MovieListResponse,
  MovieSummary,
  MovieSummaryRecord,
  SortOrder,
} from './schemas.js';

/** A valid movie id that doesn't exist. */
export class MovieNotFoundError extends HttpError {
  constructor(movieId: number) {
    super(404, 'MOVIE_NOT_FOUND', `Movie ${String(movieId)} not found`);
    this.name = 'MovieNotFoundError';
  }
}

/** A valid genre id or name that no movie has. */
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

/** Filters are combined with AND. */
export interface MovieListCriteria {
  /** 1-indexed page number. */
  readonly page: number;
  /** Direction of the listing order. */
  readonly sortOrder: SortOrder;
  /** Only movies released in this year; also switches to chronological order. */
  readonly releaseYear?: number | undefined;
  /** Only movies with this genre. Unknown genres are a 404. */
  readonly genre?: GenreRef | undefined;
}

/**
 * Mean rounded half-up to 2 decimals, or `null` with no ratings. Rounds
 * `sum * 100 / count` rather than `mean * 100`, which avoids float error:
 * 1.005 rounds to 1.01, not 1.00.
 */
export function averageRating({ sum, count }: RatingStats): number | null {
  if (count === 0) return null;
  return Math.round((sum * 100) / count) / 100;
}

const USD = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

/** `4000000` -> `$4,000,000`, independent of the host locale. */
export function formatUsd(dollars: number): string {
  if (!Number.isSafeInteger(dollars) || dollars < 0) {
    throw new RangeError('dollars must be a non-negative safe integer');
  }
  return USD.format(dollars);
}

function toPublicSummary(record: MovieSummaryRecord): MovieSummary {
  return { ...record, budget: formatUsd(record.budget) };
}

/** Movie use cases, independent of Express. */
export class MovieService {
  constructor(
    private readonly repository: MovieRepository,
    private readonly ratings: RatingSource,
  ) {}

  /**
   * One page of movies for every listing URL. An unknown genre is a 404; a known
   * genre with no matches is an empty page. With a year, the order is chronological.
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
      this.repository.listMovies(filter, sort, window).map(toPublicSummary),
    );
  }

  /** One movie with its average rating. */
  getMovieDetails(movieId: number): MovieDetails {
    const movie = this.repository.findMovieById(movieId);
    if (movie === undefined) throw new MovieNotFoundError(movieId);

    return {
      movieId: movie.movieId,
      imdbId: movie.imdbId,
      title: movie.title,
      description: movie.description,
      releaseDate: movie.releaseDate,
      budget: formatUsd(movie.budget),
      runtime: movie.runtime,
      averageRating: averageRating(this.ratings.statsForMovie(movieId)),
      genres: movie.genres,
      originalLanguage: movie.originalLanguage,
      productionCompanies: movie.productionCompanies,
    };
  }
}
