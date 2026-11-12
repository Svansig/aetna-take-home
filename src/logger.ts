import { pino, type DestinationStream, type Logger } from 'pino';
import type { LogLevel } from './config.js';

export type { Logger };

/**
 * Structured JSON logger writing to stdout. Pretty-printing is a dev-time concern
 * handled by piping through `pino-pretty` (see `npm run dev`), so the application
 * always emits the same machine-readable format.
 */
export function createLogger(level: LogLevel, destination?: DestinationStream): Logger {
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
