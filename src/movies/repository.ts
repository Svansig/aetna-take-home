import type { MovieSummary } from './schemas.js';

/**
 * Movie data access used by `MovieService`. Each API version supplies its own
 * implementation (V1: original SQLite database). Implementations return
 * validated application records and order results deterministically.
 */
export interface MovieRepository {
  countMovies(): number;
  /** Movies ordered by their stable primary identifier, ascending. */
  listMovies(window: { limit: number; offset: number }): MovieSummary[];
}
