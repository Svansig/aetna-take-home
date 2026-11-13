import type { ErrorRequestHandler, RequestHandler } from 'express';
import { z } from 'zod';

/** Public JSON error body shared by every endpoint. */
export const ErrorResponseSchema = z
  .object({
    /** The error itself. */
    error: z.object({
      /** Stable, machine-readable error code. */
      code: z.string().meta({ example: 'NOT_FOUND' }),
      /** Human-readable explanation. */
      message: z.string().meta({ example: 'Route GET /nope not found' }),
      /** Field-level problems; only present for validation errors. */
      details: z
        .array(
          z.object({
            /** Dotted path of the invalid field. */
            path: z.string().meta({ example: 'page' }),
            /** What is wrong with it. */
            message: z.string(),
          }),
        )
        .optional()
        .meta({ description: 'Field-level problems; present for validation errors.' }),
      /** Same value as the `X-Request-Id` header. */
      requestId: z
        .string()
        .optional()
        .meta({ description: 'Correlates the response with server logs.' }),
    }),
  })
  .meta({ id: 'ErrorResponse', description: 'Standard error envelope.' });

export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

/** An error whose status, code and message are safe to show to clients. */
export class HttpError extends Error {
  constructor(
    /** HTTP status code. */
    readonly status: number,
    /** Machine-readable code for `ErrorResponse.error.code`. */
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

/**
 * Express's own 4xx errors, e.g. a malformed `%`-encoding in a path. Under the
 * http-errors convention, their messages are safe to expose unless `expose` is false.
 */
function isExposedClientError(err: unknown): err is { status: number; message: string } {
  if (typeof err !== 'object' || err === null) return false;
  const { status, expose, message } = err as Record<string, unknown>;
  return (
    expose !== false &&
    typeof status === 'number' &&
    status >= 400 &&
    status < 500 &&
    typeof message === 'string'
  );
}

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(new HttpError(404, 'NOT_FOUND', `Route ${req.method} ${req.path} not found`));
};

/** Client errors get a descriptive body; anything else is logged and answered with a generic 500. */
export const errorHandler: ErrorRequestHandler = (err: unknown, req, res, next) => {
  if (res.headersSent) {
    // Too late to send a JSON body; let Express close the connection.
    next(err);
    return;
  }

  const requestId = typeof req.id === 'string' ? req.id : undefined;
  let status: number;
  let body: ErrorResponse['error'];

  if (err instanceof z.ZodError) {
    status = 400;
    body = {
      code: 'VALIDATION_ERROR',
      message: 'Request validation failed',
      details: err.issues.map((issue) => ({
        path: issue.path.map(String).join('.'),
        message: issue.message,
      })),
    };
  } else if (err instanceof HttpError) {
    status = err.status;
    body = { code: err.code, message: err.message };
  } else if (isExposedClientError(err)) {
    status = err.status;
    body = { code: 'BAD_REQUEST', message: err.message };
  } else {
    status = 500;
    body = { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' };
    req.log.error({ err }, 'Unhandled error while processing request');
  }

  res.status(status).json({ error: { ...body, requestId } } satisfies ErrorResponse);
};
