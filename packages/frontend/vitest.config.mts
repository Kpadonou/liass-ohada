import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { globalSetup: ['./scripts/restaurants-integration.setup.mjs'] },
});
