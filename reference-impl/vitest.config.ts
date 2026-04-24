import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    globals: false,
    // CLI-level tests chain 3+ `npx tsx cli.ts` spawns (~1.8s each); the default 5 s timeout was
    // reliably exceeded by advance-rfc/spike/plan flows. v0.5.2 bumps it to a generous 15 s.
    testTimeout: 15_000,
  },
});
