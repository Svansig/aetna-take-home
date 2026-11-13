import { z } from 'zod';
import { POSITIVE_INTEGER_PARAM_DOC } from '../openapi/params.js';
import { positiveIntegerParam } from './params.js';

/** Fixed page size for every paginated list (not configurable by clients). */
export const PAGE_SIZE = 50;

/** Optional 1-indexed `page` query parameter. */
export const PageQuerySchema = z.object({
  /** 1-indexed page number; defaults to 1. */
  page: positiveIntegerParam('page')
    .default(1)
    .meta({
      ...POSITIVE_INTEGER_PARAM_DOC,
      default: 1,
      example: 1,
      description: `1-indexed page number. Each page has ${String(PAGE_SIZE)} items.`,
    }),
});

export type PageQuery = z.infer<typeof PageQuerySchema>;

export const PaginationMetaSchema = z
  .strictObject({
    /** The requested page, even when it is past the end. */
    page: z.int().min(1).meta({ description: 'The requested page number.' }),
    /** Always `PAGE_SIZE`. */
    pageSize: z.literal(PAGE_SIZE).meta({ description: 'Always 50.' }),
    /** Number of items matching the request across all pages. */
    totalItems: z.int().min(0).meta({ description: 'Total number of matching items.' }),
    /** 0 when there are no items. */
    totalPages: z
      .int()
      .min(0)
      .meta({ description: 'ceil(totalItems / pageSize); 0 when there are no items.' }),
  })
  .meta({ id: 'PaginationMeta' });

export type PaginationMeta = z.infer<typeof PaginationMetaSchema>;

/** `{ data: T[], pagination }`, registered as a named OpenAPI component. */
export function paginatedResponseSchema<T extends z.ZodType>(item: T, id: string) {
  return z
    .strictObject({
      /** Items on this page; empty past the end. */
      data: z.array(item),
      /** Position and totals for the whole list. */
      pagination: PaginationMetaSchema,
    })
    .meta({ id });
}

export function totalPages(totalItems: number): number {
  return Math.ceil(totalItems / PAGE_SIZE);
}

/** SQL-style LIMIT/OFFSET for one page. */
export interface PageWindow {
  /** Maximum number of rows to return. */
  readonly limit: number;
  /** Number of rows to skip. */
  readonly offset: number;
}

/** LIMIT/OFFSET for a 1-indexed page. Throws instead of producing an unsafe offset. */
export function pageWindow(page: number): PageWindow {
  const offset = (page - 1) * PAGE_SIZE;
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(offset)) {
    throw new RangeError(`Page ${String(page)} cannot be converted to a safe offset`);
  }
  return { limit: PAGE_SIZE, offset };
}

/** A page of items with its pagination metadata. */
export interface Page<T> {
  /** Items on this page; empty past the end. */
  data: T[];
  /** Position and totals for the whole list. */
  pagination: PaginationMeta;
}

/**
 * One page of `totalItems` items. A page past the end returns empty `data`
 * without calling `fetch`, so huge page numbers never produce an offset.
 */
export function paginate<T>(
  page: number,
  totalItems: number,
  fetch: (window: PageWindow) => T[],
): Page<T> {
  const pages = totalPages(totalItems);
  return {
    data: page <= pages ? fetch(pageWindow(page)) : [],
    pagination: { page, pageSize: PAGE_SIZE, totalItems, totalPages: pages },
  };
}
