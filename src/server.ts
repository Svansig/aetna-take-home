import { createServer } from 'node:http';
import { createApp, createMoviesApi } from './app.js';
import { ConfigError, loadConfig } from './config.js';
import { openReadOnlyDatabase, type DatabaseSync } from './db/sqlite.js';
import { createLogger } from './logger.js';

const SHUTDOWN_TIMEOUT_MS = 10_000;

interface OpenDatabase {
  /** Short label used in logs. */
  name: string;
  /** The open connection. */
  db: DatabaseSync;
}

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

  // One read-only connection per database for the life of the process.
  const databases: OpenDatabase[] = [];
  const closeDatabases = (): string[] =>
    databases.splice(0).map(({ name, db }) => {
      db.close();
      return name;
    });
  const open = (name: string, path: string): DatabaseSync => {
    try {
      const db = openReadOnlyDatabase(path);
      databases.push({ name, db });
      return db;
    } catch (err) {
      // Fail fast. The path goes to the operator log only, never to clients.
      logger.fatal({ err, database: name, path }, 'Cannot open database');
      closeDatabases();
      process.exit(1);
    }
  };
  const moviesDb = open('movies', config.MOVIES_DB_PATH);
  const ratingsDb = open('ratings', config.RATINGS_DB_PATH);
  logger.info({ databases: databases.map((d) => d.name) }, 'Databases opened read-only');

  const app = createApp({ logger, apiRouter: createMoviesApi({ moviesDb, ratingsDb }) });
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

    // Databases are closed only after in-flight requests finish.
    server.close((err) => {
      logger.info({ databases: closeDatabases() }, 'Databases closed');
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
