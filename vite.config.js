import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// pdfjs-dist 4.x ships top-level await, so the build target must be esnext.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: { target: 'esnext' },
  optimizeDeps: {
    exclude: ['pdfjs-dist'],
    esbuildOptions: { target: 'esnext' },
  },
});
