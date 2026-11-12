import { Router } from 'express';
import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';

export type ApiVersionId = 'v1' | 'v2';

/**
 * A mountable API version. Shared HTTP infrastructure (logging, docs, errors,
 * 404s) lives in `createApp`; a version only contributes its router and the
 * OpenAPI paths for the routes it serves.
 *
 * Both versions are intended to share route handlers, public schemas and
 * business logic, differing only in the data-access dependencies they are
 * constructed with (V1: original supplied databases; V2: rebuilt dataset).
 */
export interface ApiVersion {
  readonly id: ApiVersionId;
  readonly router: Router;
  /** Register this version's operations; `basePath` is e.g. `/api/v1`. */
  readonly registerDocs?: (registry: OpenAPIRegistry, basePath: string) => void;
}

export const apiBasePath = (id: ApiVersionId): string => `/api/${id}`;

/**
 * Composition root for the versioned APIs.
 *
 * Phase 0: both versions are mounted with no operations, so every request under
 * `/api/v1` or `/api/v2` falls through to the shared 404 handler. Later phases
 * construct each version's data-access dependencies here (from `Config`) and pass
 * them into shared router factories.
 */
export function createApiVersions(): ApiVersion[] {
  return [
    { id: 'v1', router: Router() },
    { id: 'v2', router: Router() },
  ];
}
