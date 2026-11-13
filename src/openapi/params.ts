// The parameter schemas parse strings into other types, so their OpenAPI types are
// written by hand to describe what clients send.

export const POSITIVE_INTEGER_PARAM_DOC = {
  type: 'integer',
  minimum: 1,
  maximum: Number.MAX_SAFE_INTEGER,
} as const;

/** A string, so leading zeros are kept. */
export const FOUR_DIGIT_YEAR_PARAM_DOC = {
  type: 'string',
  pattern: '^(?!0000)[0-9]{4}$',
  minLength: 4,
  maxLength: 4,
} as const;

export const GENRE_PARAM_DOC = { type: 'string', minLength: 1 } as const;
