import { z } from 'zod';
import { PageQuerySchema, paginatedResponseSchema } from '../http/pagination.js';
import { fourDigitYearParam, positiveIntegerParam, singleValueError } from '../http/params.js';
import {
  FOUR_DIGIT_YEAR_PARAM_DOC,
  GENRE_PARAM_DOC,
  POSITIVE_INTEGER_PARAM_DOC,
} from '../openapi/params.js';

export const GenreSchema = z
  .strictObject({
    id: z.int().meta({ description: 'TMDB genre id.', example: 18 }),
    name: z.string().meta({ example: 'Drama' }),
  })
  .meta({ id: 'Genre' });

export type Genre = z.infer<typeof GenreSchema>;

/**
 * Fields shared by the listing and the details, as the repository returns them.
 * `budget` is still the stored whole-dollar integer here; the service formats it
 * for clients (see `formatUsd`).
 */
const summaryRecordShape = {
  movieId: z
    .int()
    .min(1)
    .meta({
      description:
        'Numeric movie id (a TMDB id). Use it to fetch the details: ' +
        '`GET /movies/{movieId}`. Not an IMDb id.',
      example: 5,
    }),
  imdbId: z.string().meta({
    description:
      'IMDb identifier, e.g. `tt0113101`, returned as stored. A few ' +
      'source records have an empty string here.',
    example: 'tt0113101',
  }),
  title: z.string().meta({ example: 'Four Rooms' }),
  genres: z.array(GenreSchema).meta({ description: 'May be empty.' }),
  releaseDate: z.iso.date().nullable().meta({
    description: 'Calendar date (`YYYY-MM-DD`) with no time zone. `null` when unknown.',
    example: '1995-12-09',
  }),
};

/** Internal listing record: public fields with the budget as whole dollars. */
export const MovieSummaryRecordSchema = z.strictObject({
  ...summaryRecordShape,
  budget: z.int().min(0),
});

export type MovieSummaryRecord = z.infer<typeof MovieSummaryRecordSchema>;

/** `$1,234,567`: whole US dollars, dollar sign and thousands separators, no cents. */
export const USD_PATTERN = /^\$\d{1,3}(,\d{3})*$/;

const usdBudget = () =>
  z
    .string()
    .regex(USD_PATTERN)
    .meta({
      description:
        'Production budget in whole US dollars, formatted with a dollar sign and ' +
        'thousands separators, with no decimal portion. A stored `0` (usually "not recorded") is `$0`.',
      example: '$4,000,000',
    });

export const MovieSummarySchema = z
  .strictObject({ ...summaryRecordShape, budget: usdBudget() })
  .meta({ id: 'MovieSummary' });

export type MovieSummary = z.infer<typeof MovieSummarySchema>;

export const MovieListResponseSchema = paginatedResponseSchema(
  MovieSummarySchema,
  'MovieListResponse',
);

export type MovieListResponse = z.infer<typeof MovieListResponseSchema>;

export const SORT_ORDERS = ['asc', 'desc'] as const;

/** Listing direction. Case-sensitive. */
export type SortOrder = (typeof SORT_ORDERS)[number];

const sortOrderParam = (description: string) =>
  z
    .enum(SORT_ORDERS, {
      error: singleValueError('sortOrder', 'sortOrder must be "asc" or "desc"'),
    })
    .default('asc')
    .meta({ description });

const SORT_BY_ID = '`asc` (default) or `desc` by `movieId`.';
const SORT_BY_DATE =
  '`asc` (default): `releaseDate` ascending, then `movieId` ascending for movies released ' +
  'on the same day. `desc`: `releaseDate` descending, then `movieId` descending.';

const YEAR_DESCRIPTION =
  'Release year as exactly four digits, `0001` to `9999`. A valid year with no movies ' +
  'returns an empty page, not a 404.';

/**
 * A genre reference as parsed from a request: all decimal digits is a TMDB genre
 * id, anything else is a genre name (matched case-insensitively, exactly otherwise).
 */
export type GenreRef = { readonly id: number } | { readonly name: string };

const genreParam = () =>
  z
    .string({ error: singleValueError('genre', 'genre must be a genre id or name') })
    .transform((value, ctx): GenreRef => {
      if (/^\d+$/.test(value)) {
        const id = Number(value);
        if (id >= 1 && Number.isSafeInteger(id)) return { id };
        ctx.addIssue({
          code: 'custom',
          message: 'genre id must be a positive integer no larger than 2^53-1',
        });
        return z.NEVER;
      }
      if (value.trim() === '') {
        ctx.addIssue({ code: 'custom', message: 'genre must not be empty' });
        return z.NEVER;
      }
      return { name: value };
    });

const GENRE_DESCRIPTION =
  'A genre id (all digits, e.g. `28`) or a genre name (e.g. `Action`, `science fiction`). ' +
  'Names match case-insensitively but otherwise exactly: no partial matches. An unknown ' +
  'genre is a 404.';

/** `/movies/year/:year` path parameter. */
export const MovieYearParamsSchema = z.object({
  year: fourDigitYearParam('year').meta({
    ...FOUR_DIGIT_YEAR_PARAM_DOC,
    description: YEAR_DESCRIPTION,
    example: '1999',
  }),
});

/** `/movies/genre/:genre` path parameter. */
export const MovieGenreParamsSchema = z.object({
  genre: genreParam().meta({
    ...GENRE_PARAM_DOC,
    description: GENRE_DESCRIPTION,
    example: 'Action',
  }),
});

/** Query for `/movies/year/:year`: `page` and chronological `sortOrder`. Unknown keys are ignored. */
export const MoviesByYearQuerySchema = PageQuerySchema.extend({
  sortOrder: sortOrderParam(SORT_BY_DATE),
});

/** Query for `/movies/genre/:genre`: `page` and `sortOrder` by movieId. Unknown keys are ignored. */
export const MoviesByGenreQuerySchema = PageQuerySchema.extend({
  sortOrder: sortOrderParam(SORT_BY_ID),
});

/**
 * Query for `/movies`: `page`, `sortOrder` and the optional `year` and `genre`
 * filters, combined with AND. Unknown keys are ignored.
 */
export const MovieListQuerySchema = PageQuerySchema.extend({
  // No `example` on the filters: Swagger UI would pre-fill it and turn "list all"
  // into a filtered request.
  year: fourDigitYearParam('year')
    .optional()
    .meta({
      ...FOUR_DIGIT_YEAR_PARAM_DOC,
      description: `Optional filter. ${YEAR_DESCRIPTION}`,
    }),
  genre: genreParam()
    .optional()
    .meta({ ...GENRE_PARAM_DOC, description: `Optional filter. ${GENRE_DESCRIPTION}` }),
  sortOrder: sortOrderParam(
    `Without \`year\`: ${SORT_BY_ID} With \`year\` (chronological): ${SORT_BY_DATE}`,
  ),
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

const detailRecordShape = {
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
  originalLanguage: z
    .string()
    .nullable()
    .meta({
      description:
        'Original language as stored. Always `null`, because the supplied database has no ' +
        'language values.',
      example: null,
    }),
  productionCompanies: z.array(ProductionCompanySchema).meta({
    description:
      'May be empty. The 483 source records whose company data is malformed JSON ' +
      'return `[]` instead of failing the request.',
  }),
};

/** What a movie repository returns for one movie: everything except the rating, budget unformatted. */
export const MovieRecordSchema = MovieSummaryRecordSchema.extend(detailRecordShape);

export type MovieRecord = z.infer<typeof MovieRecordSchema>;

/**
 * Single-movie details: the listing fields, reused from `MovieSummarySchema` so
 * the two contracts can't drift, plus the detail-only fields.
 */
export const MovieDetailsSchema = MovieSummarySchema.extend({
  ...detailRecordShape,
  averageRating: z
    .number()
    .min(0.5)
    .max(5)
    .nullable()
    .meta({
      description:
        'Mean user rating on a 0.5–5.0 scale, rounded to 2 decimal places. `null` when no ' +
        'ratings match. **Caveat:** ratings are matched by numeric movie id across ' +
        'databases that use different id systems (TMDB vs MovieLens), so averages may ' +
        'belong to a different movie.',
      example: 3.69,
    }),
}).meta({ id: 'MovieDetails' });

export type MovieDetails = z.infer<typeof MovieDetailsSchema>;
