import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'src/web',
  base: './',
  plugins: [react()],
  build: { outDir: '../../dist', emptyOutDir: true },
  worker: { format: 'es' },
});
