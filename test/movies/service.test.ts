import { describe, expect, it, vi } from 'vitest';
import type { MovieRepository } from '../../src/movies/repository.js';
import type { MovieSummary } from '../../src/movies/schemas.js';
import { MovieService } from '../../src/movies/service.js';

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
    listMovies: vi.fn(({ limit, offset }: { limit: number; offset: number }) =>
      all.slice(offset, offset + limit),
    ),
  } satisfies MovieRepository;
  return repository;
}

describe('MovieService.listMovies', () => {
  it('requests the window for the page and builds pagination metadata', () => {
    const repo = fakeRepository(120);
    const result = new MovieService(repo).listMovies(2);

    expect(repo.listMovies).toHaveBeenCalledWith({ limit: 50, offset: 50 });
    expect(result.data.map((m) => m.imdbId)).toEqual(
      Array.from({ length: 50 }, (_, i) => `tt${String(51 + i)}`),
    );
    expect(result.pagination).toEqual({ page: 2, pageSize: 50, totalItems: 120, totalPages: 3 });
  });

  it('returns the partial final page', () => {
    const result = new MovieService(fakeRepository(120)).listMovies(3);
    expect(result.data).toHaveLength(20);
  });

  it('returns an empty page past the end without querying, preserving the page', () => {
    const repo = fakeRepository(120);
    const result = new MovieService(repo).listMovies(4);
    expect(result).toEqual({
      data: [],
      pagination: { page: 4, pageSize: 50, totalItems: 120, totalPages: 3 },
    });
    expect(repo.listMovies).not.toHaveBeenCalled();
  });

  it('never computes an unsafe SQL offset for huge pages', () => {
    const repo = fakeRepository(120);
    const result = new MovieService(repo).listMovies(Number.MAX_SAFE_INTEGER);
    expect(result.data).toEqual([]);
    expect(result.pagination.page).toBe(Number.MAX_SAFE_INTEGER);
    expect(repo.listMovies).not.toHaveBeenCalled();
  });

  it('reports totalPages 0 for an empty collection', () => {
    const result = new MovieService(fakeRepository(0)).listMovies(1);
    expect(result).toEqual({
      data: [],
      pagination: { page: 1, pageSize: 50, totalItems: 0, totalPages: 0 },
    });
  });
});
