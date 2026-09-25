import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  build: {
    emptyOutDir: false,
    lib: {
      entry: resolve(__dirname, 'popup.ts'),
      name: 'ESheepPopup',
      formats: ['iife'],
      fileName: () => 'popup.js',
    },
  },
});
