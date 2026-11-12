import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // Tests construct their own config/dependencies; never read a developer's .env.
    env: { NODE_ENV: 'test' },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // The process entry point is exercised by the smoke/Docker checks, not unit tests.
      exclude: ['src/server.ts'],
    },
  },
});
