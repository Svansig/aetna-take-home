import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PROJECT_ROOT } from '../src/config.js';

/** A port that was free a moment ago, from the OS. */
async function freePort(): Promise<number> {
  const probe = createServer().listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const { port } = probe.address() as { port: number };
  probe.close();
  await once(probe, 'close');
  return port;
}

/**
 * Runs the real entry point (`src/server.ts` through tsx) as a child process with
 * only the defaults, so it opens the supplied `db/movies.db` and `db/ratings.db`.
 */
describe('server process', () => {
  it('starts with the two supplied databases and closes both on SIGTERM', async () => {
    const port = await freePort();
    const child = spawn(process.execPath, ['--import', 'tsx', path.join('src', 'server.ts')], {
      cwd: PROJECT_ROOT,
      // Only what the process needs: no developer .env, no inherited DB paths.
      env: { PATH: process.env.PATH, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const logs: Record<string, unknown>[] = [];
    let stderr = '';
    let buffered = '';
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')));
    const listening = new Promise<void>((resolve) => {
      child.stdout.on('data', (chunk: Buffer) => {
        buffered += chunk.toString('utf8');
        const lines = buffered.split('\n');
        buffered = lines.pop() ?? '';
        for (const line of lines.filter((l) => l.trim())) {
          const entry = JSON.parse(line) as Record<string, unknown>;
          logs.push(entry);
          if (entry.msg === 'Server listening') resolve();
        }
      });
    });
    const exited = once(child, 'exit') as Promise<[number | null, NodeJS.Signals | null]>;

    try {
      await Promise.race([
        listening,
        exited.then(() => {
          throw new Error(`server exited before listening:\n${stderr}`);
        }),
      ]);

      const base = `http://127.0.0.1:${String(port)}`;
      expect((await fetch(`${base}/health`)).status).toBe(200);
      const details = await fetch(`${base}/api/v1/movies/11`);
      expect(details.status).toBe(200);
      expect(await details.json()).toMatchObject({ title: 'Star Wars', averageRating: 3.69 });
      expect((await fetch(`${base}/api/v2/movies`)).status).toBe(404);
    } finally {
      child.kill('SIGTERM');
    }

    const [code] = await exited;
    expect(stderr).toBe('');
    expect(code).toBe(0);
    expect(logs.find((l) => l.msg === 'Databases opened read-only')).toMatchObject({
      databases: ['movies', 'ratings'],
    });
    expect(logs.find((l) => l.msg === 'Databases closed')).toMatchObject({
      databases: ['movies', 'ratings'],
    });
    expect(logs.at(-1)).toMatchObject({ msg: 'Shutdown complete' });
  });
});
