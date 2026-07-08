import { defineConfig } from 'vite';

export default defineConfig({
  // Keep the historical AudioMass dev port so existing bookmarks/docs still work.
  server: {
    port: 5055,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
