import { z } from 'zod';
import { POSITIVE_INTEGER_PARAM_DOC, positiveIntegerParam } from './params.js';

/** Fixed page size for every paginated list (not configurable by clients). */
export const PAGE_SIZE = 50;

/**
 * `page` query parameter: optional, 1-indexed, a positive base-10 integer (see
 * `positiveIntegerParam`). Repeated `?page=` values are rejected. Unknown query
 * parameters are stripped by `z.object`, not rejected.
 */
export const PageQuerySchema = z.object({
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
    page: z.int().min(1).meta({ description: 'The requested page number.' }),
    pageSize: z.literal(PAGE_SIZE).meta({ description: 'Always 50.' }),
    totalItems: z.int().min(0).meta({ description: 'Total number of matching items.' }),
    totalPages: z
      .int()
      .min(0)
      .meta({ description: 'ceil(totalItems / pageSize); 0 when there are no items.' }),
  })
  .meta({ id: 'PaginationMeta' });

export type PaginationMeta = z.infer<typeof PaginationMetaSchema>;

/** `{ data: T[], pagination }`, registered as a named OpenAPI component. */
export function paginatedResponseSchema<T extends z.ZodType>(item: T, id: string) {
  return z.strictObject({ data: z.array(item), pagination: PaginationMetaSchema }).meta({ id });
}

export function totalPages(totalItems: number): number {
  return Math.ceil(totalItems / PAGE_SIZE);
}

/** SQL-style LIMIT/OFFSET for one page. */
export interface PageWindow {
  readonly limit: number;
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

/**
 * One page of a list of `totalItems` items, using the shared pagination rules. A
 * page past the end returns an empty `data` array with accurate metadata, and
 * `fetch` is not called, so no offset is computed for it however large the page.
 */
export function paginate<T>(
  page: number,
  totalItems: number,
  fetch: (window: PageWindow) => T[],
): { data: T[]; pagination: PaginationMeta } {
  const pages = totalPages(totalItems);
  return {
    data: page <= pages ? fetch(pageWindow(page)) : [],
    pagination: { page, pageSize: PAGE_SIZE, totalItems, totalPages: pages },
  };
}
