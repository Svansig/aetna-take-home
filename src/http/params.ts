import { z } from 'zod';

/**
 * A request parameter holding a positive base-10 integer written as plain digits
 * (no sign, decimal point, exponent or whitespace) and representable as a safe
 * JavaScript integer. Output is a number. A repeated query parameter arrives as an
 * array and is rejected. `name` is used in error messages.
 */
export function positiveIntegerParam(name: string) {
  return (
    z
      .string({
        error: (issue) =>
          Array.isArray(issue.input) ? `${name} must not be repeated` : `${name} must be a string`,
      })
      .regex(/^\d+$/, `${name} must be a positive base-10 integer`)
      .transform(Number)
      // The regex already guarantees an integer; this bounds it to the safe range.
      .pipe(
        z
          .number()
          .min(1, `${name} must be at least 1`)
          .max(Number.MAX_SAFE_INTEGER, `${name} is too large`),
      )
  );
}

/**
 * OpenAPI description of `positiveIntegerParam`: documented as the integer clients
 * send, not as the internal string pipeline.
 */
export const POSITIVE_INTEGER_PARAM_DOC = {
  type: 'integer',
  minimum: 1,
  maximum: Number.MAX_SAFE_INTEGER,
} as const;
