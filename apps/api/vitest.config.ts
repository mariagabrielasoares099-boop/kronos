import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Resolves the path aliases declared in tsconfig.json, including the ones
  // added by `nest g library`. Requires Vite 8, which ships this option.
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.spec.ts'],
    // Os testes de integracao abrem pool/app Nest; na 1a execucao (cache frio) 5 s nao bastam.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
