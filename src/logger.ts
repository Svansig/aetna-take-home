import { pino, type DestinationStream, type Logger } from 'pino';
import type { LogLevel } from './config.js';

export type { Logger };

/**
 * JSON logger to stdout. Pretty-printing is done outside the app by `pino-pretty` in `npm run dev`.
 *
 * Stdout writes are synchronous. Pino's default async destination can reorder or drop the last
 * lines when the process exits mid-write, which loses the shutdown logs.
 */
export function createLogger(
  level: LogLevel,
  destination: DestinationStream = pino.destination({ dest: 1, sync: true }),
): Logger {
  return pino(
    {
      level,
      base: { service: 'movie-services' },
      // Defence in depth: never log credentials if a client happens to send them.
      redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
    },
    destination,
  );
}
