import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { Router } from 'express';
import { ErrorResponseSchema } from '../http/errors.js';
import { PAGE_SIZE } from '../http/pagination.js';
import type { ApiVersionId } from '../versions.js';
import {
  MovieDetailsSchema,
  MovieIdParamsSchema,
  MovieListQueryDocSchema,
  MovieListQuerySchema,
  MovieListResponseSchema,
  MoviesByYearQuerySchema,
  MovieYearParamsSchema,
  type MovieDetails,
  type MovieListResponse,
} from './schemas.js';
import type { MovieService } from './service.js';

/** Movie routes, shared by every API version; only the injected service differs. */
export function createMoviesRouter(service: MovieService): Router {
  const router = Router();

  // ZodErrors thrown while parsing become 400s in the central error handler.

  router.get('/movies', (req, res) => {
    const { page, year } = MovieListQuerySchema.parse(req.query);
    if (year === undefined) {
      // Unfiltered: movieId order. `sortOrder` is not read, like any unknown parameter.
      res.json(service.listMovies(page));
      return;
    }
    const { sortOrder } = MoviesByYearQuerySchema.parse(req.query);
    res.json(service.listMoviesByYear(year, page, sortOrder));
  });

  // Registered before `/movies/:movieId` so `/movies/year/...` never reaches it.
  // `{/:year}` is optional so a missing year is a `year` validation error, not a
  // `movieId` one from the details route.
  router.get('/movies/year{/:year}', (req, res) => {
    const { year } = MovieYearParamsSchema.parse(req.params);
    const { page, sortOrder } = MoviesByYearQuerySchema.parse(req.query);
    res.json(service.listMoviesByYear(year, page, sortOrder));
  });

  router.get('/movies/:movieId', (req, res) => {
    // Invalid ids become a 400 and unknown ids a 404 (MovieNotFoundError), both
    // in the central error handler.
    const { movieId } = MovieIdParamsSchema.parse(req.params);
    res.json(service.getMovieDetails(movieId));
  });

  return router;
}

/**
 * The first three movies of page 1 in the supplied V1 database, verbatim. A test
 * checks them against the database so the documentation can't drift.
 */
export const V1_FIRST_PAGE_EXAMPLE: MovieListResponse = {
  data: [
    {
      imdbId: 'tt0094675',
      title: 'Ariel',
      genres: [
        { id: 18, name: 'Drama' },
        { id: 80, name: 'Crime' },
      ],
      releaseDate: '1988-10-21',
      budget: 0,
    },
    {
      imdbId: 'tt0092149',
      title: 'Shadows in Paradise',
      genres: [
        { id: 18, name: 'Drama' },
        { id: 35, name: 'Comedy' },
      ],
      releaseDate: '1986-10-16',
      budget: 0,
    },
    {
      imdbId: 'tt0113101',
      title: 'Four Rooms',
      genres: [
        { id: 80, name: 'Crime' },
        { id: 35, name: 'Comedy' },
      ],
      releaseDate: '1995-12-09',
      budget: 4000000,
    },
  ],
  pagination: { page: 1, pageSize: PAGE_SIZE, totalItems: 45430, totalPages: 909 },
};

/**
 * The first three movies of 1999 (page 1 of 15) in each direction, verbatim from
 * the supplied V1 database. A test checks them against the database. 67 movies of
 * 1999 share the date 1999-01-01, so ascending order shows the movieId tie-break.
 */
export const V1_YEAR_1999_EXAMPLES = {
  asc: {
    data: [
      {
        imdbId: 'tt0183717',
        title: "Rock 'n' Roll Frankenstein",
        genres: [
          { id: 35, name: 'Comedy' },
          { id: 27, name: 'Horror' },
        ],
        releaseDate: '1999-01-01',
        budget: 0,
      },
      {
        imdbId: 'tt0211219',
        title: 'Barenaked in America',
        genres: [{ id: 99, name: 'Documentary' }],
        releaseDate: '1999-01-01',
        budget: 0,
      },
      {
        imdbId: 'tt0373960',
        title: 'She and Her Cat: Their Standing Points',
        genres: [
          { id: 16, name: 'Animation' },
          { id: 10749, name: 'Romance' },
        ],
        releaseDate: '1999-01-01',
        budget: 0,
      },
    ],
    pagination: { page: 1, pageSize: PAGE_SIZE, totalItems: 723, totalPages: 15 },
  },
  desc: {
    data: [
      {
        imdbId: 'tt0129023',
        title: 'Dark Harbor',
        genres: [
          { id: 53, name: 'Thriller' },
          { id: 18, name: 'Drama' },
        ],
        releaseDate: '1999-12-31',
        budget: 0,
      },
      {
        imdbId: 'tt0293092',
        title: "Dexter's Laboratory: Ego Trip",
        genres: [
          { id: 16, name: 'Animation' },
          { id: 35, name: 'Comedy' },
          { id: 10751, name: 'Family' },
          { id: 878, name: 'Science Fiction' },
        ],
        releaseDate: '1999-12-31',
        budget: 0,
      },
      {
        imdbId: 'tt0247613',
        title: 'Peppermint Candy',
        genres: [{ id: 18, name: 'Drama' }],
        releaseDate: '1999-12-31',
        budget: 0,
      },
    ],
    pagination: { page: 1, pageSize: PAGE_SIZE, totalItems: 723, totalPages: 15 },
  },
} satisfies Record<'asc' | 'desc', MovieListResponse>;

/** A valid year with no movies in the supplied V1 database (checked by a test). */
export const V1_EMPTY_YEAR_EXAMPLE = {
  year: 1850,
  response: {
    data: [],
    pagination: { page: 1, pageSize: PAGE_SIZE, totalItems: 0, totalPages: 0 },
  },
} satisfies { year: number; response: MovieListResponse };

/**
 * Real V1 detail responses, verbatim. A test checks them against the supplied
 * databases. Star Wars shows the naive rating association: 3.69 comes from
 * MovieLens movie 11, while Star Wars' real MovieLens id 260 averages 4.22.
 * Capote shows both a `null` rating and the malformed-company fallback.
 */
export const V1_DETAILS_EXAMPLES = {
  11: {
    imdbId: 'tt0076759',
    title: 'Star Wars',
    description:
      'Princess Leia is captured and held hostage by the evil Imperial forces in their effort ' +
      'to take over the galactic Empire. Venturesome Luke Skywalker and dashing captain Han ' +
      'Solo team together with the loveable robot duo R2-D2 and C-3PO to rescue the beautiful ' +
      'princess and restore peace and justice in the Empire.',
    releaseDate: '1977-05-25',
    budget: 11000000,
    runtime: 121,
    averageRating: 3.69,
    genres: [
      { id: 12, name: 'Adventure' },
      { id: 28, name: 'Action' },
      { id: 878, name: 'Science Fiction' },
    ],
    originalLanguage: null,
    productionCompanies: [
      { id: 1, name: 'Lucasfilm' },
      { id: 306, name: 'Twentieth Century Fox Film Corporation' },
    ],
  },
  398: {
    imdbId: 'tt0379725',
    title: 'Capote',
    description:
      "A biopic of the writer, Truman Capote and his assignment for The New Yorker to write the non-fiction book, 'In Cold Blood'.",
    releaseDate: '2005-09-30',
    budget: 7000000,
    runtime: 114,
    averageRating: null,
    genres: [
      { id: 80, name: 'Crime' },
      { id: 18, name: 'Drama' },
    ],
    originalLanguage: null,
    productionCompanies: [],
  },
} satisfies Record<number, MovieDetails>;

export function registerMoviesDocs(
  registry: OpenAPIRegistry,
  { basePath, version }: { basePath: string; version: ApiVersionId },
): void {
  const totals = V1_FIRST_PAGE_EXAMPLE.pagination;
  const tag = `Movies (${version})`;
  const validationError = (path: string, message: string) => ({
    error: {
      code: 'VALIDATION_ERROR',
      message: 'Request validation failed',
      details: [{ path, message }],
      requestId: '6f1c1c3e-2b8e-4d55-9b0c-2f1f5a3c9e21',
    },
  });
  const serverError = {
    description: 'Unexpected error. Details are logged server-side, never returned.',
    content: { 'application/json': { schema: ErrorResponseSchema } },
  };
  const yearExamples = {
    year1999: {
      summary: '1999, ascending (default): first 3 of 50 movies on page 1',
      value: V1_YEAR_1999_EXAMPLES.asc,
    },
    year1999Desc: {
      summary: '1999, sortOrder=desc: first 3 of 50 movies on page 1',
      value: V1_YEAR_1999_EXAMPLES.desc,
    },
    emptyYear: {
      summary: `${String(V1_EMPTY_YEAR_EXAMPLE.year)}: a valid year with no movies`,
      value: V1_EMPTY_YEAR_EXAMPLE.response,
    },
  };
  const yearRules = [
    '* `year` is exactly four digits, `0001` to `9999` (e.g. `1999`, `0001`). Anything',
    '  else (`99`, `10000`, `-1999`, `1999.5`, `abc`, empty) is a `400`.',
    '* Results are chronological: `releaseDate` ascending by default, then `movieId`',
    '  ascending for movies released on the same day. `sortOrder=desc` reverses both,',
    '  so page boundaries are deterministic in either direction.',
    '* Movies without a release date never match a year.',
    '* `totalItems` and `totalPages` count only the matching movies. A valid year with no',
    '  movies returns `200` with `data: []`, `totalItems: 0` and `totalPages: 0`.',
  ];

  registry.registerPath({
    method: 'get',
    path: `${basePath}/movies`,
    operationId: `listMovies${version.toUpperCase()}`,
    tags: [tag],
    summary: 'List all movies, optionally for one release year',
    description: [
      `Returns every movie, ${String(PAGE_SIZE)} per page, ordered by the internal movie id`,
      '(ascending). The order is stable but has no meaning to clients.',
      '',
      'With `year`, returns only the movies released that year, in chronological order,',
      'exactly like `GET /movies/year/{year}` with the same `page` and `sortOrder`.',
      '`sortOrder` only applies together with `year`; without it, it is ignored.',
      '',
      ...yearRules,
      '',
      '* `page` is 1-indexed and defaults to 1. The page size is fixed.',
      '* A page past the end returns `200` with `data: []` and accurate `pagination`.',
      '* `budget` is in whole US dollars. `releaseDate` is a `YYYY-MM-DD` date or `null`.',
      '* Unknown query parameters are ignored. A repeated `page`, `year` or `sortOrder`',
      '  is rejected.',
    ].join('\n'),
    request: { query: MovieListQueryDocSchema },
    responses: {
      200: {
        description: 'One page of movies.',
        content: {
          'application/json': {
            schema: MovieListResponseSchema,
            examples: {
              firstPage: {
                summary: 'Page 1 (truncated here to its first 3 of 50 movies)',
                value: V1_FIRST_PAGE_EXAMPLE,
              },
              pastTheEnd: {
                summary: 'A page past the end',
                value: { data: [], pagination: { ...totals, page: 1000 } },
              },
              ...yearExamples,
            },
          },
        },
      },
      400: {
        description: 'Invalid `page`, `year` or `sortOrder` parameter.',
        content: {
          'application/json': {
            schema: ErrorResponseSchema,
            examples: {
              page: { value: validationError('page', 'page must be at least 1') },
              year: {
                value: validationError('year', 'year must be a four-digit year from 0001 to 9999'),
              },
            },
          },
        },
      },
      500: serverError,
    },
  });

  registry.registerPath({
    method: 'get',
    path: `${basePath}/movies/year/{year}`,
    operationId: `listMoviesByYear${version.toUpperCase()}`,
    tags: [tag],
    summary: 'List movies released in a year',
    description: [
      `Returns the movies released in \`year\`, ${String(PAGE_SIZE)} per page, in chronological`,
      'order. Equivalent to `GET /movies?year={year}` with the same `page` and `sortOrder`.',
      '',
      ...yearRules,
      '',
      '* `page` is 1-indexed and defaults to 1. The page size is fixed.',
      '* A page past the end returns `200` with `data: []` and accurate `pagination`.',
      '* `budget` is in whole US dollars. `releaseDate` is a `YYYY-MM-DD` date.',
      '* Unknown query parameters are ignored. A repeated `page` or `sortOrder` is rejected.',
    ].join('\n'),
    request: { params: MovieYearParamsSchema, query: MoviesByYearQuerySchema },
    responses: {
      200: {
        description: 'One page of the movies released in the year.',
        content: {
          'application/json': { schema: MovieListResponseSchema, examples: yearExamples },
        },
      },
      400: {
        description: 'Invalid `year`, `page` or `sortOrder` parameter.',
        content: {
          'application/json': {
            schema: ErrorResponseSchema,
            examples: {
              year: {
                value: validationError('year', 'year must be a four-digit year from 0001 to 9999'),
              },
              sortOrder: {
                value: validationError('sortOrder', 'sortOrder must be "asc" or "desc"'),
              },
            },
          },
        },
      },
      500: serverError,
    },
  });

  registry.registerPath({
    method: 'get',
    path: `${basePath}/movies/{movieId}`,
    operationId: `getMovieDetails${version.toUpperCase()}`,
    tags: [tag],
    summary: 'Get movie details',
    description: [
      'Returns one movie, looked up by its numeric `movieId` (the id used by the movies',
      'database, not an IMDb id).',
      '',
      '* `budget` is in whole US dollars. `0` is returned as stored and often means the',
      '  budget was not recorded in the original dataset.',
      '* `runtime` is in minutes, or `null` when the source value is empty.',
      '* `averageRating` is the mean of matching ratings on a 0.5–5.0 scale, rounded to 2',
      '  decimal places. It is `null` (never `0`) when no ratings match.',
      '* `description`, `releaseDate` and `originalLanguage` are `null` when the source',
      '  value is empty. `originalLanguage` is always `null` in V1, because the supplied',
      '  database has no language values.',
      '* `productionCompanies` is `[]` for the 483 V1 records whose company data is',
      '  malformed JSON. The request still succeeds and no repair is attempted.',
      '',
      '**Known V1 limitation: ratings may belong to a different movie.** The movies',
      'database uses TMDB ids and the ratings database uses MovieLens ids. V1',
      'deliberately joins them by the raw number (`movies.movieId = ratings.movieId`),',
      'so many averages come from an unrelated film. For example, Star Wars',
      "(`movieId` 11) reports 3.69, the average for MovieLens movie 11. Star Wars' real",
      'MovieLens id is 260, which averages 4.22. A corrected mapping is planned for V2',
      'and is not implemented.',
    ].join('\n'),
    request: { params: MovieIdParamsSchema },
    responses: {
      200: {
        description: 'The movie.',
        content: {
          'application/json': {
            schema: MovieDetailsSchema,
            examples: {
              starWars: {
                summary: 'movieId 11: Star Wars (naive V1 rating: 3.69, not 4.22)',
                value: V1_DETAILS_EXAMPLES[11],
              },
              capote: {
                summary: 'movieId 398: Capote (no matching ratings; malformed company JSON)',
                value: V1_DETAILS_EXAMPLES[398],
              },
            },
          },
        },
      },
      400: {
        description: 'Invalid `movieId` (not a positive base-10 integer, or too large).',
        content: {
          'application/json': {
            schema: ErrorResponseSchema,
            example: validationError('movieId', 'movieId must be a positive base-10 integer'),
          },
        },
      },
      404: {
        description: 'No movie has this `movieId`.',
        content: {
          'application/json': {
            schema: ErrorResponseSchema,
            example: {
              error: {
                code: 'MOVIE_NOT_FOUND',
                message: 'Movie 1 not found',
                requestId: '6f1c1c3e-2b8e-4d55-9b0c-2f1f5a3c9e21',
              },
            },
          },
        },
      },
      500: serverError,
    },
  });
}
