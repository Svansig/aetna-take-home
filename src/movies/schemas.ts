import { z } from 'zod';
import { paginatedResponseSchema } from '../http/pagination.js';

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
