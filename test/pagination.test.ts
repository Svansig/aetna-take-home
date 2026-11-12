import { describe, expect, it } from 'vitest';
import { PAGE_SIZE, PageQuerySchema, pageWindow, totalPages } from '../src/http/pagination.js';

describe('PageQuerySchema', () => {
  it('defaults to page 1 when omitted', () => {
    expect(PageQuerySchema.parse({})).toEqual({ page: 1 });
  });

  it.each([
    ['1', 1],
    ['2', 2],
    ['100', 100],
    ['01', 1],
    [String(Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER],
  ])('accepts %j as %d', (input, expected) => {
    expect(PageQuerySchema.parse({ page: input })).toEqual({ page: expected });
  });

  it.each([
    '0',
    '00',
    '-1',
    '+1',
    '1.5',
    '1.0',
    'abc',
    '',
    ' 1',
    '1 ',
    '1e2',
    '0x10',
    'Infinity',
    'NaN',
    String(Number.MAX_SAFE_INTEGER + 1),
    '99999999999999999999999',
  ])('rejects %j', (input) => {
    expect(PageQuerySchema.safeParse({ page: input }).success).toBe(false);
  });

  it('rejects a repeated page parameter (parsed as an array)', () => {
    const result = PageQuerySchema.safeParse({ page: ['2', '3'] });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('page must not be repeated');
  });

  it('ignores unknown query parameters', () => {
    expect(PageQuerySchema.parse({ page: '3', sort: 'title', foo: ['a', 'b'] })).toEqual({
      page: 3,
    });
  });
});

describe('totalPages', () => {
  it.each([
    [0, 0],
    [1, 1],
    [50, 1],
    [51, 2],
    [45430, 909],
  ])('%d items -> %d pages', (items, pages) => {
    expect(totalPages(items)).toBe(pages);
  });
});

describe('pageWindow', () => {
  it('computes 1-indexed LIMIT/OFFSET', () => {
    expect(pageWindow(1)).toEqual({ limit: PAGE_SIZE, offset: 0 });
    expect(pageWindow(2)).toEqual({ limit: PAGE_SIZE, offset: 50 });
    expect(pageWindow(909)).toEqual({ limit: PAGE_SIZE, offset: 45400 });
  });

  it.each([0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER])(
    'refuses page %d instead of producing an unsafe offset',
    (page) => {
      expect(() => pageWindow(page)).toThrow(RangeError);
    },
  );
});
