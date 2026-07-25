import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['app/**/*.test.ts', 'package/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
  resolve: {
    alias: {
      '@wheresthefx/core': path.resolve(__dirname, 'package/core/src'),
      '@wheresthefx/db': path.resolve(__dirname, 'package/db/src'),
    },
  },
});
