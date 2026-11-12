import { z } from 'zod';

/** Fixed page size for every paginated list (not configurable by clients). */
export const PAGE_SIZE = 50;

/**
 * `page` query parameter: optional, 1-indexed, a base-10 integer written as plain
 * digits (no sign, decimal point, exponent or whitespace) and representable as a
 * safe JavaScript integer. Repeated `?page=` values reach us as an array and are
 * rejected. Unknown query parameters are stripped by `z.object`, not rejected.
 */
export const PageQuerySchema = z.object({
  page: z
    .string({
      error: (issue) =>
        Array.isArray(issue.input) ? 'page must not be repeated' : 'page must be a string',
    })
    .regex(/^\d+$/, 'page must be a positive base-10 integer')
    .transform(Number)
    // The regex already guarantees an integer; this bounds it to the safe range.
    .pipe(
      z
        .number()
        .min(1, 'page must be at least 1')
        .max(Number.MAX_SAFE_INTEGER, 'page is too large'),
    )
    .default(1)
    // Documented as an integer (what clients send), not as the internal string pipeline.
    .meta({
      type: 'integer',
      minimum: 1,
      maximum: Number.MAX_SAFE_INTEGER,
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

/** LIMIT/OFFSET for a 1-indexed page. Throws instead of producing an unsafe offset. */
export function pageWindow(page: number): { limit: number; offset: number } {
  const offset = (page - 1) * PAGE_SIZE;
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(offset)) {
    throw new RangeError(`Page ${String(page)} cannot be converted to a safe offset`);
  }
  return { limit: PAGE_SIZE, offset };
}
