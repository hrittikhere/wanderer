import { defineConfig } from 'vite';

// The example links the library from the repository root ("file:../.."), and
// the root's own node_modules holds React too. Deduping makes the library use
// the example's React in production builds, as the dev server already does;
// two copies fail with "Invalid hook call".
export default defineConfig({
  resolve: { dedupe: ['react', 'react-dom'] },
});
