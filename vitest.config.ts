import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // Several tests sweep the entire supplied dataset (every movie, every genre,
    // every page of a genre). They take 2-4 s on a fast workstation and exceed
    // Vitest's 5 s default on 4-vCPU CI runners running files in parallel.
    testTimeout: 30_000,
    // Tests construct their own config/dependencies; never read a developer's .env.
    env: { NODE_ENV: 'test' },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // The process entry point runs in a child process (test/server.test.ts), which
      // V8 coverage doesn't instrument, and in the Docker smoke checks.
      exclude: ['src/server.ts'],
    },
  },
});
