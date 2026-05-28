import { defineConfig } from 'vitest/config';

export default defineConfig({
  cacheDir: '/config/.vite-cache',
  test: {
    include: ['lib/**/__tests__/**/*.test.ts'],
  },
});
