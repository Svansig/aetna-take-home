// OpenAPI type descriptions for request parameters whose Zod schemas parse a
// string into another type. Attached to those schemas with `.meta()`.

/**
 * OpenAPI description of `positiveIntegerParam`: documented as the integer clients
 * send, not as the internal string pipeline.
 */
export const POSITIVE_INTEGER_PARAM_DOC = {
  type: 'integer',
  minimum: 1,
  maximum: Number.MAX_SAFE_INTEGER,
} as const;

/** OpenAPI description of `fourDigitYearParam`: a string, so leading zeros are kept. */
export const FOUR_DIGIT_YEAR_PARAM_DOC = {
  type: 'string',
  pattern: '^(?!0000)[0-9]{4}$',
  minLength: 4,
  maxLength: 4,
} as const;

/** OpenAPI description of the `genre` parameter: a non-empty name or id. */
export const GENRE_PARAM_DOC = { type: 'string', minLength: 1 } as const;
