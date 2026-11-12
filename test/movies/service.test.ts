import { describe, expect, it, vi } from 'vitest';
import { HttpError } from '../../src/http/errors.js';
import type { PageWindow } from '../../src/http/pagination.js';
import type { MovieRepository, RatingSource } from '../../src/movies/repository.js';
import type { MovieRecord, MovieSummary } from '../../src/movies/schemas.js';
import { averageRating, MovieNotFoundError, MovieService } from '../../src/movies/service.js';

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
    listMovies: vi.fn(({ limit, offset }: PageWindow) => all.slice(offset, offset + limit)),
    listMoviesByReleaseDate: vi.fn(
      (_filter: unknown, _sortOrder: unknown, { limit, offset }: PageWindow) =>
        all.slice(offset, offset + limit),
    ),
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
  it('requests the window for the page and builds pagination metadata', () => {
    const repo = fakeRepository(120);
    const result = new MovieService(repo, fakeRatings()).listMovies(2);

    expect(repo.listMovies).toHaveBeenCalledWith({ limit: 50, offset: 50 });
    expect(result.data.map((m) => m.imdbId)).toEqual(
      Array.from({ length: 50 }, (_, i) => `tt${String(51 + i)}`),
    );
    expect(result.pagination).toEqual({ page: 2, pageSize: 50, totalItems: 120, totalPages: 3 });
  });

  it('returns the partial final page', () => {
    const result = new MovieService(fakeRepository(120), fakeRatings()).listMovies(3);
    expect(result.data).toHaveLength(20);
  });

  it('returns an empty page past the end without querying, preserving the page', () => {
    const repo = fakeRepository(120);
    const result = new MovieService(repo, fakeRatings()).listMovies(4);
    expect(result).toEqual({
      data: [],
      pagination: { page: 4, pageSize: 50, totalItems: 120, totalPages: 3 },
    });
    expect(repo.listMovies).not.toHaveBeenCalled();
  });

  it('never computes an unsafe SQL offset for huge pages', () => {
    const repo = fakeRepository(120);
    const result = new MovieService(repo, fakeRatings()).listMovies(Number.MAX_SAFE_INTEGER);
    expect(result.data).toEqual([]);
    expect(result.pagination.page).toBe(Number.MAX_SAFE_INTEGER);
    expect(repo.listMovies).not.toHaveBeenCalled();
  });

  it('reports totalPages 0 for an empty collection', () => {
    const result = new MovieService(fakeRepository(0), fakeRatings()).listMovies(1);
    expect(result).toEqual({
      data: [],
      pagination: { page: 1, pageSize: 50, totalItems: 0, totalPages: 0 },
    });
  });
});

describe('MovieService.listMoviesByYear', () => {
  it('counts and lists with the same year filter, passing sortOrder and the page window', () => {
    const repo = fakeRepository(120);
    const result = new MovieService(repo, fakeRatings()).listMoviesByYear(1999, 3, 'desc');

    expect(repo.countMovies).toHaveBeenCalledWith({ releaseYear: 1999 });
    expect(repo.listMoviesByReleaseDate).toHaveBeenCalledWith({ releaseYear: 1999 }, 'desc', {
      limit: 50,
      offset: 100,
    });
    expect(repo.listMovies).not.toHaveBeenCalled();
    expect(result.data).toHaveLength(20);
    expect(result.pagination).toEqual({ page: 3, pageSize: 50, totalItems: 120, totalPages: 3 });
  });

  it('returns an empty page for a year with no movies, preserving the page', () => {
    const repo = fakeRepository(0);
    const result = new MovieService(repo, fakeRatings()).listMoviesByYear(1850, 2, 'asc');
    expect(result).toEqual({
      data: [],
      pagination: { page: 2, pageSize: 50, totalItems: 0, totalPages: 0 },
    });
    expect(repo.listMoviesByReleaseDate).not.toHaveBeenCalled();
  });

  it('never computes an unsafe SQL offset for huge pages', () => {
    const repo = fakeRepository(120);
    const service = new MovieService(repo, fakeRatings());
    expect(service.listMoviesByYear(1999, Number.MAX_SAFE_INTEGER, 'asc').data).toEqual([]);
    expect(repo.listMoviesByReleaseDate).not.toHaveBeenCalled();
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
