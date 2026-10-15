import { defineConfig } from 'vite';

export default defineConfig({
  publicDir: 'client',
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
    target: 'es2022',
  },
});
