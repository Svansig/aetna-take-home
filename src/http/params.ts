import { z } from 'zod';

/**
 * Zod error message for a single-valued request parameter. A repeated query
 * parameter arrives as an array, which gets its own message; any other invalid
 * input gets `message`.
 */
export function singleValueError(name: string, message: string) {
  return (issue: { input?: unknown }): string =>
    Array.isArray(issue.input) ? `${name} must not be repeated` : message;
}

/**
 * A request parameter holding a positive base-10 integer written as plain digits
 * (no sign, decimal point, exponent or whitespace) and representable as a safe
 * JavaScript integer. Output is a number. A repeated query parameter is rejected.
 * `name` is used in error messages.
 */
export function positiveIntegerParam(name: string) {
  return (
    z
      .string({ error: singleValueError(name, `${name} must be a string`) })
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

/**
 * A request parameter holding a calendar year written as exactly four decimal
 * digits, `0001` through `9999`. Output is the year as a number. A repeated query
 * parameter is rejected.
 */
export function fourDigitYearParam(name: string) {
  const message = `${name} must be a four-digit year from 0001 to 9999`;
  return z
    .string({ error: singleValueError(name, message) })
    .regex(/^\d{4}$/, message)
    .transform(Number)
    .pipe(z.number().min(1, message));
}

/** OpenAPI description of `fourDigitYearParam`: a string, so leading zeros are kept. */
export const FOUR_DIGIT_YEAR_PARAM_DOC = {
  type: 'string',
  pattern: '^(?!0000)[0-9]{4}$',
  minLength: 4,
  maxLength: 4,
} as const;
