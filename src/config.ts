import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

/**
 * Project root, derived from this module's location rather than `process.cwd()`.
 * Works for both `src/config.ts` (tsx) and `dist/config.js` (compiled), which sit
 * at the same depth.
 */
export const PROJECT_ROOT = fileURLToPath(new URL('..', import.meta.url));

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

/** Relative paths resolve against the project root so the CWD never matters. */
const dbPath = (defaultPath: string) =>
  z
    .string()
    .trim()
    .min(1)
    .default(defaultPath)
    .transform((p) => path.resolve(PROJECT_ROOT, p));

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().trim().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
  MOVIES_DB_PATH: dbPath('db/movies.db'),
  RATINGS_DB_PATH: dbPath('db/ratings.db'),
});

export type Config = z.infer<typeof configSchema>;
export type LogLevel = Config['LOG_LEVEL'];

export class ConfigError extends Error {
  constructor(readonly issues: readonly string[]) {
    super(`Invalid configuration:\n  - ${issues.join('\n  - ')}`);
    this.name = 'ConfigError';
  }
}

/**
 * Parse and validate configuration from an environment-like object.
 * Pure: takes `env` explicitly so tests never depend on `process.env`.
 * Error messages name the variable but never echo its value.
 */
export function loadConfig(env: Record<string, string | undefined>): Config {
  // Treat empty strings as unset so `PORT=` in a .env file falls back to the default.
  const cleaned = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== ''));
  const result = configSchema.safeParse(cleaned);
  if (!result.success) {
    throw new ConfigError(
      result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
    );
  }
  return result.data;
}
