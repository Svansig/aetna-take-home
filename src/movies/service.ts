import { PAGE_SIZE, pageWindow, totalPages } from '../http/pagination.js';
import type { MovieRepository } from './repository.js';
import type { MovieListResponse } from './schemas.js';

/** Movie use cases, shared by every API version and independent of Express. */
export class MovieService {
  constructor(private readonly repository: MovieRepository) {}

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
}
