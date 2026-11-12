import { Writable } from 'node:stream';
import { createApp } from '../src/app.js';
import { createLogger } from '../src/logger.js';
import { createApiVersions, type ApiVersion } from '../src/versions.js';

/** Captures structured log lines emitted during a test. */
export function createLogCapture() {
  const lines: Record<string, unknown>[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _enc, callback) {
      for (const line of chunk.toString('utf8').split('\n')) {
        if (line.trim()) lines.push(JSON.parse(line) as Record<string, unknown>);
      }
      callback();
    },
  });
  return { lines, logger: createLogger('info', stream) };
}

/** Build the app with injected test dependencies. No network listener is opened. */
export function createTestApp(options: { versions?: ApiVersion[] } = {}) {
  const logs = createLogCapture();
  const app = createApp({
    logger: logs.logger,
    versions: options.versions ?? createApiVersions(),
  });
  return { app, logs: logs.lines };
}
