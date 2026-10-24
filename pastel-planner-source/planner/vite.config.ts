import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Single-file build so the app can be hosted as one self-contained HTML page.
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  build: { target: 'es2020', chunkSizeWarningLimit: 4000 },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
} as any);
