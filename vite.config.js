import { defineConfig } from 'vite';

// base relativa: funciona no GitHub Pages (/app-geoperfil/) e abrindo o build localmente.
export default defineConfig({
  base: './',
  build: { outDir: 'dist', sourcemap: true },
  test: { environment: 'node', include: ['tests/**/*.test.js'] },
});
