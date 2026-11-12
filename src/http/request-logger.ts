import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';
import { pinoHttp } from 'pino-http';
import type { Logger } from '../logger.js';

/**
 * One structured log line per completed request, plus a per-request child logger
 * (`req.log`) carrying the request id. The id is generated server-side (client
 * supplied ids are not trusted) and echoed in the `X-Request-Id` header.
 */
export function requestLogger(logger: Logger): RequestHandler {
  return pinoHttp({
    logger,
    // Container health probes would otherwise dominate the logs.
    autoLogging: { ignore: (req) => req.url === '/health' },
    genReqId: (_req, res) => {
      const id = randomUUID();
      res.setHeader('X-Request-Id', id);
      return id;
    },
    customLogLevel: (_req, res, err) => {
      if (err || res.statusCode >= 500) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return 'info';
    },
    // Keep request logs compact: method/url/ids only, no header dumps.
    serializers: {
      req: (req: { id: unknown; method: string; url: string }) => ({
        id: req.id,
        method: req.method,
        url: req.url,
      }),
      res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
    },
  });
}
