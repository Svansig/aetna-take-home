import { describe, expect, it, vi } from 'vitest';
import { HttpError } from '../../src/http/errors.js';
import type { PageWindow } from '../../src/http/pagination.js';
import type { MovieRepository, RatingSource } from '../../src/movies/repository.js';
import type { MovieRecord, MovieSummary } from '../../src/movies/schemas.js';
import type { MovieListCriteria } from '../../src/movies/service.js';
import {
  averageRating,
  GenreNotFoundError,
  MovieNotFoundError,
  MovieService,
} from '../../src/movies/service.js';

const movie = (n: number): MovieSummary => ({
  imdbId: `tt${String(n)}`,
  title: `Fixture ${String(n)}`,
  genres: [],
  releaseDate: null,
  budget: 0,
});

/** In-memory repository over `count` synthetic movies, recording its calls. */
function fakeRepository(count: number) {
  const all = Array.from({ length: count }, (_, i) => movie(i + 1));
  const repository = {
    countMovies: vi.fn(() => count),
    listMovies: vi.fn((_filter: unknown, _sort: unknown, { limit, offset }: PageWindow) =>
      all.slice(offset, offset + limit),
    ),
    hasGenre: vi.fn(() => true),
    findMovieById: vi.fn((): MovieRecord | undefined => undefined),
  } satisfies MovieRepository;
  return repository;
}

/** Rating source with fixed stats per movie id (default: no ratings). */
function fakeRatings(stats: Record<number, { sum: number; count: number }> = {}) {
  return {
    statsForMovie: vi.fn((movieId: number) => stats[movieId] ?? { sum: 0, count: 0 }),
  } satisfies RatingSource;
}

describe('MovieService.listMovies', () => {
  const list = (repo: ReturnType<typeof fakeRepository>, criteria: Partial<MovieListCriteria>) =>
    new MovieService(repo, fakeRatings()).listMovies({ page: 1, sortOrder: 'asc', ...criteria });

  it('requests the window for the page and builds pagination metadata', () => {
    const repo = fakeRepository(120);
    const result = list(repo, { page: 2 });

    expect(repo.listMovies).toHaveBeenCalledWith(
      { releaseYear: undefined, genre: undefined },
      { by: 'movieId', order: 'asc' },
      { limit: 50, offset: 50 },
    );
    expect(result.data.map((m) => m.imdbId)).toEqual(
      Array.from({ length: 50 }, (_, i) => `tt${String(51 + i)}`),
    );
    expect(result.pagination).toEqual({ page: 2, pageSize: 50, totalItems: 120, totalPages: 3 });
  });

  it('returns the partial final page', () => {
    expect(list(fakeRepository(120), { page: 3 }).data).toHaveLength(20);
  });

  it('returns an empty page past the end without querying, preserving the page', () => {
    const repo = fakeRepository(120);
    expect(list(repo, { page: 4 })).toEqual({
      data: [],
      pagination: { page: 4, pageSize: 50, totalItems: 120, totalPages: 3 },
    });
    expect(repo.listMovies).not.toHaveBeenCalled();
  });

  it('never computes an unsafe SQL offset for huge pages', () => {
    const repo = fakeRepository(120);
    const result = list(repo, { page: Number.MAX_SAFE_INTEGER, releaseYear: 1999 });
    expect(result.data).toEqual([]);
    expect(result.pagination.page).toBe(Number.MAX_SAFE_INTEGER);
    expect(repo.listMovies).not.toHaveBeenCalled();
  });

  it('reports totalPages 0 for an empty result', () => {
    expect(list(fakeRepository(0), { releaseYear: 1850 })).toEqual({
      data: [],
      pagination: { page: 1, pageSize: 50, totalItems: 0, totalPages: 0 },
    });
  });

  it.each([
    [{}, 'movieId'],
    [{ genre: { id: 28 } }, 'movieId'],
    [{ releaseYear: 1999 }, 'releaseDate'],
    [{ releaseYear: 1999, genre: { name: 'Action' } }, 'releaseDate'],
  ] as const)('sorts %o by %s, in the requested direction', (filters, by) => {
    const repo = fakeRepository(10);
    list(repo, { ...filters, sortOrder: 'desc' });
    const filter = { releaseYear: undefined, genre: undefined, ...filters };
    expect(repo.countMovies).toHaveBeenCalledWith(filter);
    expect(repo.listMovies).toHaveBeenCalledWith(
      filter,
      { by, order: 'desc' },
      {
        limit: 50,
        offset: 0,
      },
    );
  });

  it('checks the genre first and throws a 404 GenreNotFoundError for an unknown one', () => {
    const repo = fakeRepository(10);
    repo.hasGenre.mockReturnValue(false);
    for (const [genre, message] of [
      [{ id: 99 }, 'Genre 99 not found'],
      [{ name: 'Space "Western"' }, 'Genre "Space \\"Western\\"" not found'],
    ] as const) {
      let error: unknown;
      try {
        list(repo, { genre, releaseYear: 1999 });
      } catch (err) {
        error = err;
      }
      expect(error).toBeInstanceOf(GenreNotFoundError);
      expect(error).toMatchObject({ status: 404, code: 'GENRE_NOT_FOUND', message });
    }
    expect(repo.hasGenre).toHaveBeenCalledWith({ id: 99 });
    expect(repo.countMovies).not.toHaveBeenCalled();
    expect(repo.listMovies).not.toHaveBeenCalled();
  });

  it('returns an empty 200 page for a known genre with no matches under the year', () => {
    const repo = fakeRepository(0);
    expect(list(repo, { genre: { id: 28 }, releaseYear: 1850, page: 2 }).pagination).toEqual({
      page: 2,
      pageSize: 50,
      totalItems: 0,
      totalPages: 0,
    });
  });

  it('does not check genres when there is no genre filter', () => {
    const repo = fakeRepository(10);
    list(repo, { releaseYear: 1999 });
    expect(repo.hasGenre).not.toHaveBeenCalled();
  });
});

const record: MovieRecord = {
  imdbId: 'tt0000007',
  title: 'Fixture 7',
  description: null,
  releaseDate: '2000-01-01',
  budget: 0,
  runtime: 90.5,
  genres: [{ id: 18, name: 'Drama' }],
  originalLanguage: null,
  productionCompanies: [],
};

describe('MovieService.getMovieDetails', () => {
  it('combines the movie record with its rounded average rating', () => {
    const repo = fakeRepository(0);
    repo.findMovieById.mockReturnValue(record);
    const ratings = fakeRatings({ 7: { sum: 11, count: 3 } });

    const details = new MovieService(repo, ratings).getMovieDetails(7);

    expect(repo.findMovieById).toHaveBeenCalledWith(7);
    expect(ratings.statsForMovie).toHaveBeenCalledWith(7);
    expect(details).toEqual({ ...record, averageRating: 3.67 });
    expect(Object.keys(details)).toEqual([
      'imdbId',
      'title',
      'description',
      'releaseDate',
      'budget',
      'runtime',
      'averageRating',
      'genres',
      'originalLanguage',
      'productionCompanies',
    ]);
  });

  it('returns averageRating null (not 0) when no ratings match', () => {
    const repo = fakeRepository(0);
    repo.findMovieById.mockReturnValue(record);
    expect(new MovieService(repo, fakeRatings()).getMovieDetails(7).averageRating).toBeNull();
  });

  it('throws a 404 MovieNotFoundError for an unknown id, without querying ratings', () => {
    const ratings = fakeRatings();
    const service = new MovieService(fakeRepository(0), ratings);
    let error: unknown;
    try {
      service.getMovieDetails(999);
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(MovieNotFoundError);
    expect(error).toBeInstanceOf(HttpError);
    expect(error).toMatchObject({ status: 404, code: 'MOVIE_NOT_FOUND' });
    expect(ratings.statsForMovie).not.toHaveBeenCalled();
  });
});

describe('averageRating', () => {
  it.each([
    [{ sum: 0, count: 0 }, null],
    [{ sum: 4, count: 1 }, 4],
    [{ sum: 302.5, count: 82 }, 3.69], // naive Star Wars (movieId 11): 3.6890…
    [{ sum: 1228.5, count: 291 }, 4.22], // MovieLens 260: 4.2216…
    [{ sum: 10, count: 3 }, 3.33],
    [{ sum: 11, count: 3 }, 3.67],
    // Exact halves round up, despite binary floating point:
    [{ sum: 100.5, count: 100 }, 1.01], // 1.005 (1.005 * 100 is 100.49999… in floating point)
    [{ sum: 17, count: 8 }, 2.13], // 2.125
    [{ sum: 4.5, count: 2 }, 2.25],
  ])('%o -> %s', (stats, expected) => {
    const result = averageRating(stats);
    expect(result).toBe(expected);
    if (result !== null) expect(result).toBeTypeOf('number');
  });
});
