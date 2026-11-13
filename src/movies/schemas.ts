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
    /** TMDB genre id. */
    id: z.int().meta({ description: 'TMDB genre id.', example: 18 }),
    /** Genre name as stored. */
    name: z.string().meta({ example: 'Drama' }),
  })
  .meta({ id: 'Genre' });

export type Genre = z.infer<typeof GenreSchema>;

/** Fields shared by the listing and the details, except `budget`, which is formatted for clients. */
const summaryRecordShape = {
  /** Primary key in `movies.db` (a TMDB id, not an IMDb id). */
  movieId: z
    .int()
    .min(1)
    .meta({
      description:
        'Numeric movie id (a TMDB id). Use it to fetch the details: ' +
        '`GET /movies/{movieId}`. Not an IMDb id.',
      example: 5,
    }),
  /** IMDb id as stored; a few records have ''. */
  imdbId: z.string().meta({
    description:
      'IMDb identifier, e.g. `tt0113101`, returned as stored. A few ' +
      'source records have an empty string here.',
    example: 'tt0113101',
  }),
  /** Movie title. */
  title: z.string().meta({ example: 'Four Rooms' }),
  /** May be empty. */
  genres: z.array(GenreSchema).meta({ description: 'May be empty.' }),
  /** `YYYY-MM-DD` with no time zone, or `null` when unknown. */
  releaseDate: z.iso.date().nullable().meta({
    description: 'Calendar date (`YYYY-MM-DD`) with no time zone. `null` when unknown.',
    example: '1995-12-09',
  }),
};

/** Internal listing record: public fields with the budget as whole dollars. */
export const MovieSummaryRecordSchema = z.strictObject({
  ...summaryRecordShape,
  /** Whole US dollars, unformatted. */
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
  .strictObject({
    ...summaryRecordShape,
    /** Formatted as `$1,234,567`. */
    budget: usdBudget(),
  })
  .meta({ id: 'MovieSummary' });

export type MovieSummary = z.infer<typeof MovieSummarySchema>;

export const MovieListResponseSchema = paginatedResponseSchema(
  MovieSummarySchema,
  'MovieListResponse',
);

export type MovieListResponse = z.infer<typeof MovieListResponseSchema>;

export const SORT_ORDERS = ['asc', 'desc'] as const;

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

/** A request's `genre`: all digits is a genre id, anything else is a name. */
export type GenreRef =
  | {
      /** TMDB genre id. */
      readonly id: number;
    }
  | {
      /** Genre name, matched case-insensitively. */
      readonly name: string;
    };

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
  /** Release year. */
  year: fourDigitYearParam('year').meta({
    ...FOUR_DIGIT_YEAR_PARAM_DOC,
    description: YEAR_DESCRIPTION,
    example: '1999',
  }),
});

/** `/movies/genre/:genre` path parameter. */
export const MovieGenreParamsSchema = z.object({
  /** Genre id or name. */
  genre: genreParam().meta({
    ...GENRE_PARAM_DOC,
    description: GENRE_DESCRIPTION,
    example: 'Action',
  }),
});

/** Query for `/movies/year/:year`. */
export const MoviesByYearQuerySchema = PageQuerySchema.extend({
  /** Chronological direction; defaults to `asc`. */
  sortOrder: sortOrderParam(SORT_BY_DATE),
});

/** Query for `/movies/genre/:genre`. */
export const MoviesByGenreQuerySchema = PageQuerySchema.extend({
  /** Direction by `movieId`; defaults to `asc`. */
  sortOrder: sortOrderParam(SORT_BY_ID),
});

/** Query for `/movies`. */
export const MovieListQuerySchema = PageQuerySchema.extend({
  // No `example` on the filters: Swagger UI would pre-fill them.
  /** Optional release-year filter; switches to chronological order. */
  year: fourDigitYearParam('year')
    .optional()
    .meta({
      ...FOUR_DIGIT_YEAR_PARAM_DOC,
      description: `Optional filter. ${YEAR_DESCRIPTION}`,
    }),
  /** Optional genre filter. */
  genre: genreParam()
    .optional()
    .meta({ ...GENRE_PARAM_DOC, description: `Optional filter. ${GENRE_DESCRIPTION}` }),
  /** Direction by `movieId`, or chronological with `year`; defaults to `asc`. */
  sortOrder: sortOrderParam(
    `Without \`year\`: ${SORT_BY_ID} With \`year\` (chronological): ${SORT_BY_DATE}`,
  ),
});

/** `/movies/:movieId` path parameter. */
export const MovieIdParamsSchema = z.object({
  /** Primary key in `movies.db`. */
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
    /** TMDB company id. */
    id: z.int().meta({ description: 'TMDB company id.', example: 1 }),
    /** Company name as stored. */
    name: z.string().meta({ example: 'Lucasfilm' }),
  })
  .meta({ id: 'ProductionCompany' });

export type ProductionCompany = z.infer<typeof ProductionCompanySchema>;

const detailRecordShape = {
  /** Plot overview, or `null` when empty. */
  description: z.string().nullable().meta({
    description: 'Plot overview, verbatim from the source. `null` when the source is empty.',
  }),
  /** Minutes as stored, or `null` when empty. */
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
  /** Always `null` in the supplied data. */
  originalLanguage: z
    .string()
    .nullable()
    .meta({
      description:
        'Original language as stored. Always `null`, because the supplied database has no ' +
        'language values.',
      example: null,
    }),
  /** `[]` when the stored JSON is malformed. */
  productionCompanies: z.array(ProductionCompanySchema).meta({
    description:
      'May be empty. The 483 source records whose company data is malformed JSON ' +
      'return `[]` instead of failing the request.',
  }),
};

/** One movie as the repository returns it: no rating, budget unformatted. */
export const MovieRecordSchema = MovieSummaryRecordSchema.extend(detailRecordShape);

export type MovieRecord = z.infer<typeof MovieRecordSchema>;

/** Extends `MovieSummarySchema` so the listing and details contracts can't drift. */
export const MovieDetailsSchema = MovieSummarySchema.extend({
  ...detailRecordShape,
  /** Mean rating (0.5–5.0, 2 decimals), or `null` with no ratings. May belong to another movie. */
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
