import { describe, expect, it } from 'vitest';
import { fourDigitYearParam } from '../src/http/params.js';
import { MovieListQuerySchema, MoviesByYearQuerySchema } from '../src/movies/schemas.js';

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

describe('MoviesByYearQuerySchema', () => {
  it('defaults to page 1, ascending', () => {
    expect(MoviesByYearQuerySchema.parse({})).toEqual({ page: 1, sortOrder: 'asc' });
  });

  it('accepts asc and desc, ignoring unknown parameters', () => {
    expect(MoviesByYearQuerySchema.parse({ page: '2', sortOrder: 'desc', x: '1' })).toEqual({
      page: 2,
      sortOrder: 'desc',
    });
  });

  it.each(['random', 'ascending', 'descending', 'ASC', '1', '', ['asc', 'desc']])(
    'rejects sortOrder %j',
    (sortOrder) => {
      expect(MoviesByYearQuerySchema.safeParse({ sortOrder }).success).toBe(false);
    },
  );
});

describe('MovieListQuerySchema', () => {
  it('leaves year undefined when omitted and does not read sortOrder', () => {
    expect(MovieListQuerySchema.parse({ sortOrder: 'bogus' })).toEqual({ page: 1 });
  });

  it('parses an optional year', () => {
    expect(MovieListQuerySchema.parse({ year: '1999', page: '3' })).toEqual({
      page: 3,
      year: 1999,
    });
  });
});
