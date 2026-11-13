import { Router } from 'express';
import {
  MovieGenreParamsSchema,
  MovieIdParamsSchema,
  MovieListQuerySchema,
  MoviesByGenreQuerySchema,
  MoviesByYearQuerySchema,
  MovieYearParamsSchema,
} from './schemas.js';
import type { MovieService } from './service.js';

/** Movie routes over an injected `MovieService`. */
export function createMoviesRouter(service: MovieService): Router {
  const router = Router();

  // Every handler validates all of its parameters before calling the service, so
  // a ZodError (400, via the central error handler) always wins over a 404. All
  // listing URLs share `service.listMovies`.

  router.get('/movies', (req, res) => {
    const { page, sortOrder, year, genre } = MovieListQuerySchema.parse(req.query);
    res.json(service.listMovies({ page, sortOrder, releaseYear: year, genre }));
  });

  // The year and genre routes are registered before `/movies/:movieId` so their
  // paths never reach it. The optional `{/:param}` segment turns a missing value
  // into a validation error for that parameter rather than a `movieId` one.
  router.get('/movies/year{/:year}', (req, res) => {
    const { year } = MovieYearParamsSchema.parse(req.params);
    const { page, sortOrder } = MoviesByYearQuerySchema.parse(req.query);
    res.json(service.listMovies({ page, sortOrder, releaseYear: year }));
  });

  router.get('/movies/genre{/:genre}', (req, res) => {
    const { genre } = MovieGenreParamsSchema.parse(req.params);
    const { page, sortOrder } = MoviesByGenreQuerySchema.parse(req.query);
    res.json(service.listMovies({ page, sortOrder, genre }));
  });

  router.get('/movies/:movieId', (req, res) => {
    // Invalid ids become a 400 and unknown ids a 404 (MovieNotFoundError), both
    // in the central error handler.
    const { movieId } = MovieIdParamsSchema.parse(req.params);
    res.json(service.getMovieDetails(movieId));
  });

  return router;
}
