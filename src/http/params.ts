import { z } from 'zod';

/** Zod error callback that gives repeated query parameters (parsed as arrays) their own message. */
export function singleValueError(name: string, message: string) {
  return (issue: { input?: unknown }): string =>
    Array.isArray(issue.input) ? `${name} must not be repeated` : message;
}

/** Positive integer written as plain digits (no sign, decimal point or exponent), within the safe range. */
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

/** Calendar year written as exactly four digits, `0001` to `9999`. */
export function fourDigitYearParam(name: string) {
  const message = `${name} must be a four-digit year from 0001 to 9999`;
  return z
    .string({ error: singleValueError(name, message) })
    .regex(/^\d{4}$/, message)
    .transform(Number)
    .pipe(z.number().min(1, message));
}
