import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

/** Resolved from this module, not `process.cwd()`. `src/` and `dist/` sit at the same depth. */
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
  /** Runtime environment. */
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  /** Interface to listen on. Defaults to loopback only. */
  HOST: z.string().trim().min(1).default('127.0.0.1'),
  /** TCP port to listen on. */
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  /** Minimum pino log level. */
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
  /** Absolute path to `movies.db`. */
  MOVIES_DB_PATH: dbPath('db/movies.db'),
  /** Absolute path to `ratings.db`. */
  RATINGS_DB_PATH: dbPath('db/ratings.db'),
});

export type Config = z.infer<typeof configSchema>;
export type LogLevel = Config['LOG_LEVEL'];

export class ConfigError extends Error {
  constructor(
    /** One `VARIABLE: problem` message per invalid variable. */
    readonly issues: readonly string[],
  ) {
    super(`Invalid configuration:\n  - ${issues.join('\n  - ')}`);
    this.name = 'ConfigError';
  }
}

/** Parses and validates config. Error messages name the variable but never echo its value. */
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
