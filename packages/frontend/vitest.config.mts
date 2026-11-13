import { defineConfig } from 'vitest/config';
export default defineConfig({
  // The loopback Restaurants integration runtime owns one in-memory table.
  // Serial files prevent independent integration specs from resetting each other's evidence.
  test: {
    fileParallelism: false,
    globalSetup: ['./scripts/restaurants-integration.setup.mjs'],
  },
});
