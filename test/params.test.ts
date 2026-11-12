import { describe, expect, it } from 'vitest';
import { fourDigitYearParam } from '../src/http/params.js';
import {
  MovieGenreParamsSchema,
  MovieListQuerySchema,
  MoviesByGenreQuerySchema,
  MoviesByYearQuerySchema,
} from '../src/movies/schemas.js';

describe('fourDigitYearParam', () => {
  const year = fourDigitYearParam('year');

  it.each([
    ['0001', 1],
    ['0999', 999],
    ['1900', 1900],
    ['1977', 1977],
    ['1999', 1999],
    ['2026', 2026],
    ['9999', 9999],
  ])('accepts %j as %d', (input, expected) => {
    expect(year.parse(input)).toBe(expected);
  });

  it.each([
    '0',
    '99',
    '999',
    '0000',
    '10000',
    '-1999',
    '+1999',
    '-999',
    '1999.5',
    'abc',
    '1e3',
    '',
    ' 1999',
    '1999 ',
    '１９９９', // full-width digits
  ])('rejects %j', (input) => {
    const result = year.safeParse(input);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(
      'year must be a four-digit year from 0001 to 9999',
    );
  });

  it.each([undefined, 1999, null])('rejects the non-string %j', (input) => {
    expect(year.safeParse(input).success).toBe(false);
  });

  it('rejects a repeated parameter (parsed as an array)', () => {
    expect(year.safeParse(['1999', '2000']).error?.issues[0]?.message).toBe(
      'year must not be repeated',
    );
  });
});

describe.each([
  ['MoviesByYearQuerySchema', MoviesByYearQuerySchema],
  ['MoviesByGenreQuerySchema', MoviesByGenreQuerySchema],
  ['MovieListQuerySchema', MovieListQuerySchema],
])('%s sortOrder', (_name, schema) => {
  it('defaults to page 1, ascending', () => {
    expect(schema.parse({})).toEqual({ page: 1, sortOrder: 'asc' });
  });

  it('accepts asc and desc, ignoring unknown parameters', () => {
    expect(schema.parse({ page: '2', sortOrder: 'desc', x: '1' })).toEqual({
      page: 2,
      sortOrder: 'desc',
    });
  });

  it.each(['random', 'bogus', 'ascending', 'descending', 'ASC', 'Desc', '1', '', ['asc', 'desc']])(
    'rejects sortOrder %j',
    (sortOrder) => {
      expect(schema.safeParse({ sortOrder }).success).toBe(false);
    },
  );
});

describe('MovieListQuerySchema filters', () => {
  it('leaves both filters undefined when omitted', () => {
    expect(MovieListQuerySchema.parse({})).toEqual({ page: 1, sortOrder: 'asc' });
  });

  it('parses year and genre together', () => {
    expect(
      MovieListQuerySchema.parse({ year: '1999', genre: 'Action', page: '3', sortOrder: 'desc' }),
    ).toEqual({ page: 3, sortOrder: 'desc', year: 1999, genre: { name: 'Action' } });
  });

  it.each([
    [{ year: '99', genre: 'Action' }, 'year'],
    [{ year: '1999', genre: '0' }, 'genre'],
    [{ year: '1999', genre: '' }, 'genre'],
    [{ genre: ['Action', 'Drama'] }, 'genre'],
  ])('rejects %o on %s', (query, path) => {
    const result = MovieListQuerySchema.safeParse(query);
    expect(result.error?.issues.map((i) => i.path.join('.'))).toEqual([path]);
  });
});

describe('genre parameter', () => {
  const parse = (genre: unknown) => MovieGenreParamsSchema.safeParse({ genre });

  it.each([
    ['28', { id: 28 }],
    ['028', { id: 28 }],
    ['18', { id: 18 }],
    [String(Number.MAX_SAFE_INTEGER), { id: Number.MAX_SAFE_INTEGER }],
    ['Action', { name: 'Action' }],
    ['action', { name: 'action' }],
    ['Science Fiction', { name: 'Science Fiction' }],
    ['TV Movie', { name: 'TV Movie' }],
    // Not all digits, so these are names (and simply unknown ones, a 404 later).
    ['-28', { name: '-28' }],
    ['28.0', { name: '28.0' }],
    ['1e3', { name: '1e3' }],
    ['28a', { name: '28a' }],
    [' Action', { name: ' Action' }],
  ])('reads %j as %o', (input, expected) => {
    expect(parse(input).data).toEqual({ genre: expected });
  });

  it.each([
    ['0', 'genre id must be a positive integer no larger than 2^53-1'],
    ['000', 'genre id must be a positive integer no larger than 2^53-1'],
    [
      String(Number.MAX_SAFE_INTEGER + 1),
      'genre id must be a positive integer no larger than 2^53-1',
    ],
    ['99999999999999999999999', 'genre id must be a positive integer no larger than 2^53-1'],
    ['', 'genre must not be empty'],
    ['   ', 'genre must not be empty'],
    [undefined, 'genre must be a genre id or name'],
    [['Action', 'Drama'], 'genre must not be repeated'],
  ])('rejects %j: %s', (input, message) => {
    expect(parse(input).error?.issues.map((i) => i.message)).toEqual([message]);
  });
});
