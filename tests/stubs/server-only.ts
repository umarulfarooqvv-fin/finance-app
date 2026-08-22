/* The real `server-only` package throws on import outside a React Server
   Component, which is exactly its job in the app and exactly wrong in a unit
   test. Vitest aliases the package here so server-side modules can have their
   pure logic tested directly. The guarantee is unaffected: the alias exists
   only in vitest.config.ts, so a client component importing server code still
   fails the real build. */
export {};
