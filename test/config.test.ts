import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig, PROJECT_ROOT } from '../src/config.js';

describe('loadConfig', () => {
  it('applies safe local defaults when nothing is set', () => {
    const config = loadConfig({});
    expect(config).toMatchObject({
      NODE_ENV: 'development',
      HOST: '127.0.0.1',
      PORT: 3000,
      LOG_LEVEL: 'info',
      MOVIES_DB_PATH: path.join(PROJECT_ROOT, 'db/movies.db'),
      RATINGS_DB_PATH: path.join(PROJECT_ROOT, 'db/ratings.db'),
    });
  });

  it('defines only the single-version settings', () => {
    expect(Object.keys(loadConfig({})).sort()).toEqual([
      'HOST',
      'LOG_LEVEL',
      'MOVIES_DB_PATH',
      'NODE_ENV',
      'PORT',
      'RATINGS_DB_PATH',
    ]);
  });

  it('parses explicit values', () => {
    const config = loadConfig({
      NODE_ENV: 'production',
      HOST: '0.0.0.0',
      PORT: '8080',
      LOG_LEVEL: 'warn',
      MOVIES_DB_PATH: '/data/movies.db',
      RATINGS_DB_PATH: '/data/ratings.db',
    });
    expect(config).toMatchObject({
      NODE_ENV: 'production',
      HOST: '0.0.0.0',
      PORT: 8080,
      LOG_LEVEL: 'warn',
      MOVIES_DB_PATH: '/data/movies.db',
      RATINGS_DB_PATH: '/data/ratings.db',
    });
  });

  it('resolves relative database paths against the project root, not the CWD', () => {
    const config = loadConfig({ MOVIES_DB_PATH: './somewhere/movies.db' });
    expect(config.MOVIES_DB_PATH).toBe(path.join(PROJECT_ROOT, 'somewhere/movies.db'));
  });

  it('treats empty strings as unset', () => {
    expect(loadConfig({ PORT: '', LOG_LEVEL: '' })).toMatchObject({
      PORT: 3000,
      LOG_LEVEL: 'info',
    });
  });

  it('ignores removed and unknown variables', () => {
    const config = loadConfig({
      V1_MOVIES_DB_PATH: '/old/movies.db',
      V2_DB_PATH: '   ',
      SOMETHING_ELSE: 'x',
    });
    expect(config).not.toHaveProperty('V2_DB_PATH');
    expect(config).not.toHaveProperty('V1_MOVIES_DB_PATH');
    expect(config.MOVIES_DB_PATH).toBe(path.join(PROJECT_ROOT, 'db/movies.db'));
  });

  it.each([
    ['PORT', 'not-a-number'],
    ['PORT', '0'],
    ['PORT', '70000'],
    ['PORT', '3000.5'],
    ['NODE_ENV', 'staging'],
    ['LOG_LEVEL', 'verbose'],
    ['HOST', '   '],
    ['MOVIES_DB_PATH', '   '],
    ['RATINGS_DB_PATH', '   '],
  ])('rejects invalid %s=%j', (key, value) => {
    expect(() => loadConfig({ [key]: value })).toThrow(ConfigError);
  });

  it('reports every invalid variable by name without echoing values', () => {
    try {
      loadConfig({ PORT: 'secret-ish', NODE_ENV: 'nope' });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      const { issues, message } = err as ConfigError;
      expect(issues).toHaveLength(2);
      expect(message).toMatch(/PORT/);
      expect(message).toMatch(/NODE_ENV/);
      expect(message).not.toMatch(/secret-ish/);
    }
  });
});
