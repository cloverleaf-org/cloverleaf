import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['conformance/tests/**/*.test.ts'],
    globals: false,
  },
});
