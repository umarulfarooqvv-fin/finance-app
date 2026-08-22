import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/* Node environment only. Like the blueprint's suite, these tests are weighted
   toward the money maths and the invariants rather than the UI — there is no
   component-testing layer, and adding one would test React more than it tests
   the engine. */
export default defineConfig({
  resolve: {
    // Mirrors the `@/*` path alias in tsconfig.json.
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // See tests/stubs/server-only.ts for why this is safe.
      'server-only': fileURLToPath(new URL('./tests/stubs/server-only.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    reporters: ['default'],
  },
});
