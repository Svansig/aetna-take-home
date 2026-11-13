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

  // Handlers validate every parameter before calling the service, so a 400 always wins over a 404.

  router.get('/movies', (req, res) => {
    const { page, sortOrder, year, genre } = MovieListQuerySchema.parse(req.query);
    res.json(service.listMovies({ page, sortOrder, releaseYear: year, genre }));
  });

  // Registered before `/movies/:movieId`. The optional `{/:param}` segment makes a
  // missing value a validation error for that parameter, not for `movieId`.
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
    const { movieId } = MovieIdParamsSchema.parse(req.params);
    res.json(service.getMovieDetails(movieId));
  });

  return router;
}
