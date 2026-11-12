import { createServer } from 'node:http';
import { createApp } from './app.js';
import { ConfigError, loadConfig } from './config.js';
import { openReadOnlyDatabase, type DatabaseSync } from './db/sqlite.js';
import { createLogger } from './logger.js';
import { createApiVersions } from './versions.js';

const SHUTDOWN_TIMEOUT_MS = 10_000;

function main(): void {
  let config;
  try {
    config = loadConfig(process.env);
  } catch (err) {
    if (err instanceof ConfigError) {
      // The logger isn't configured yet. The message names variables but not their values.
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }

  const logger = createLogger(config.LOG_LEVEL);

  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'Uncaught exception');
    process.exit(1);
  });
  process.on('unhandledRejection', (reason) => {
    logger.fatal({ err: reason }, 'Unhandled promise rejection');
    process.exit(1);
  });

  let v1MoviesDb: DatabaseSync;
  try {
    v1MoviesDb = openReadOnlyDatabase(config.V1_MOVIES_DB_PATH);
  } catch (err) {
    // Fail fast. The path goes to the operator log only, never to clients.
    logger.fatal({ err, path: config.V1_MOVIES_DB_PATH }, 'Cannot open V1 movies database');
    process.exit(1);
  }

  const app = createApp({ logger, versions: createApiVersions({ v1MoviesDb }) });
  const server = createServer(app);

  server.on('error', (err) => {
    logger.fatal({ err }, 'HTTP server error');
    process.exit(1);
  });

  server.listen(config.PORT, config.HOST, () => {
    logger.info(
      { host: config.HOST, port: config.PORT, nodeEnv: config.NODE_ENV },
      'Server listening',
    );
  });

  let shuttingDown = false;
  const shutdown = (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Shutting down: no longer accepting connections');

    setTimeout(() => {
      logger.error('Shutdown timed out; forcing exit');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS).unref();

    // Stops accepting new connections, closes idle keep-alive sockets and waits
    // for in-flight requests to finish; only then is the database closed.
    server.close((err) => {
      v1MoviesDb.close();
      if (err) {
        logger.error({ err }, 'Error during shutdown');
        process.exit(1);
      }
      logger.info('Shutdown complete');
      process.exit(0);
    });
  };

  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}

main();
