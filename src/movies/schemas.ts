import { z } from 'zod';
import { PageQuerySchema, paginatedResponseSchema } from '../http/pagination.js';
import {
  FOUR_DIGIT_YEAR_PARAM_DOC,
  fourDigitYearParam,
  POSITIVE_INTEGER_PARAM_DOC,
  positiveIntegerParam,
  singleValueError,
} from '../http/params.js';

export const GenreSchema = z
  .strictObject({
    id: z.int().meta({ description: 'TMDB genre id.', example: 18 }),
    name: z.string().meta({ example: 'Drama' }),
  })
  .meta({ id: 'Genre' });

export type Genre = z.infer<typeof GenreSchema>;

export const MovieSummarySchema = z
  .strictObject({
    imdbId: z.string().meta({
      description:
        'IMDb identifier, e.g. `tt0113101`. V1 returns the stored value as-is. A few ' +
        'source records have an empty string here.',
      example: 'tt0113101',
    }),
    title: z.string().meta({ example: 'Four Rooms' }),
    genres: z.array(GenreSchema).meta({ description: 'May be empty.' }),
    releaseDate: z.iso.date().nullable().meta({
      description: 'Calendar date (`YYYY-MM-DD`) with no time zone. `null` when unknown.',
      example: '1995-12-09',
    }),
    budget: z.int().min(0).meta({
      description:
        'Production budget in whole US dollars (USD), as stored. `0` is returned as `0`.',
      example: 4000000,
    }),
  })
  .meta({ id: 'MovieSummary' });

export type MovieSummary = z.infer<typeof MovieSummarySchema>;

export const MovieListResponseSchema = paginatedResponseSchema(
  MovieSummarySchema,
  'MovieListResponse',
);

export type MovieListResponse = z.infer<typeof MovieListResponseSchema>;

export const SORT_ORDERS = ['asc', 'desc'] as const;

/** Chronological direction for year-filtered listings. Case-sensitive. */
export type SortOrder = (typeof SORT_ORDERS)[number];

const sortOrderParam = z
  .enum(SORT_ORDERS, {
    error: singleValueError('sortOrder', 'sortOrder must be "asc" or "desc"'),
  })
  .default('asc');

const SORT_ORDER_DESCRIPTION =
  'Chronological direction. `asc` (default): `releaseDate` ascending, then `movieId` ' +
  'ascending for movies released on the same day. `desc`: `releaseDate` descending, ' +
  'then `movieId` descending. Case-sensitive.';

const YEAR_DESCRIPTION =
  'Release year as exactly four digits, `0001` to `9999`. A valid year with no movies ' +
  'returns an empty page, not a 404.';

/** `/movies/year/:year` path parameter. */
export const MovieYearParamsSchema = z.object({
  year: fourDigitYearParam('year').meta({
    ...FOUR_DIGIT_YEAR_PARAM_DOC,
    description: YEAR_DESCRIPTION,
    example: '1999',
  }),
});

/** Query for `/movies/year/:year`: the shared `page` plus `sortOrder`. Unknown keys are ignored. */
export const MoviesByYearQuerySchema = PageQuerySchema.extend({
  sortOrder: sortOrderParam.meta({ description: SORT_ORDER_DESCRIPTION }),
});

/**
 * Query for `/movies`: the shared `page` plus an optional `year` filter. `sortOrder`
 * is not part of this schema, because it only applies once `year` is present; the
 * route then reads it with `MoviesByYearQuerySchema`. Without `year` it stays an
 * ignored unknown parameter, as before.
 */
export const MovieListQuerySchema = PageQuerySchema.extend({
  // No `example`: Swagger UI would pre-fill it and turn "list all" into a filtered request.
  year: fourDigitYearParam('year')
    .optional()
    .meta({
      ...FOUR_DIGIT_YEAR_PARAM_DOC,
      description: `Optional filter. ${YEAR_DESCRIPTION} Omit it to list all movies.`,
    }),
});

/** OpenAPI-only view of the `/movies` query, including the year-only `sortOrder`. */
export const MovieListQueryDocSchema = MovieListQuerySchema.extend({
  sortOrder: sortOrderParam.meta({
    description: `Only applies together with \`year\`; ignored otherwise. ${SORT_ORDER_DESCRIPTION}`,
  }),
});

/** `:movieId` path parameter: the numeric id from movies.db, not an IMDb id. */
export const MovieIdParamsSchema = z.object({
  movieId: positiveIntegerParam('movieId').meta({
    ...POSITIVE_INTEGER_PARAM_DOC,
    description:
      'Numeric `movieId` from the movies database (a TMDB id), not an IMDb id. ' +
      'A positive base-10 integer.',
    example: 11,
  }),
});

export const ProductionCompanySchema = z
  .strictObject({
    id: z.int().meta({ description: 'TMDB company id.', example: 1 }),
    name: z.string().meta({ example: 'Lucasfilm' }),
  })
  .meta({ id: 'ProductionCompany' });

export type ProductionCompany = z.infer<typeof ProductionCompanySchema>;

/**
 * Single-movie details: the five listing fields, reused from `MovieSummarySchema`
 * so the two contracts can't drift, plus the detail-only fields.
 */
export const MovieDetailsSchema = MovieSummarySchema.extend({
  description: z.string().nullable().meta({
    description: 'Plot overview, verbatim from the source. `null` when the source is empty.',
  }),
  runtime: z
    .number()
    .min(0)
    .nullable()
    .meta({
      description:
        'Running time in minutes, as stored (not rounded). `null` when the source value is ' +
        'empty. `0` is returned as stored.',
      example: 121,
    }),
  averageRating: z
    .number()
    .min(0.5)
    .max(5)
    .nullable()
    .meta({
      description:
        'Mean user rating on a 0.5–5.0 scale, rounded to 2 decimal places. `null` when no ' +
        'ratings match. **V1 caveat:** ratings are matched by numeric movie id across ' +
        'databases that use different id systems (TMDB vs MovieLens), so V1 averages may ' +
        'belong to a different movie.',
      example: 3.69,
    }),
  originalLanguage: z
    .string()
    .nullable()
    .meta({
      description:
        'Original language as stored. Always `null` in V1, because the supplied database ' +
        'has no language values.',
      example: null,
    }),
  productionCompanies: z.array(ProductionCompanySchema).meta({
    description:
      'May be empty. In V1, the 483 source records whose company data is malformed JSON ' +
      'return `[]` instead of failing the request.',
  }),
}).meta({ id: 'MovieDetails' });

export type MovieDetails = z.infer<typeof MovieDetailsSchema>;

/** What a movie repository returns for one movie: everything except the rating. */
export type MovieRecord = Omit<MovieDetails, 'averageRating'>;
