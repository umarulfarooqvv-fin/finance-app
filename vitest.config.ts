import { defineConfig } from 'vitest/config';

/* Node environment only. Like the blueprint's suite, these tests are weighted
   toward the money maths and the invariants rather than the UI — there is no
   component-testing layer, and adding one would test React more than it tests
   the engine. */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    reporters: ['default'],
  },
});
