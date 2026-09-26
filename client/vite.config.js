import { defineConfig } from 'vite';

// A stamp baked into the bundle. Whether a change has actually reached
// the browser has come up over and over — showing the build time in the
// menu turns that from a guess into something you can read off the
// screen. Local time, because the first version printed UTC and that
// just moved the confusion three hours sideways.
const BUILD_STAMP = new Date()
  .toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' });

export default defineConfig({
  define: { __BUILD_STAMP__: JSON.stringify(BUILD_STAMP) },
  server: {
    proxy: {
      '/socket.io': {
        target: 'http://localhost:3000',
        ws: true,
        changeOrigin: true,
      },
    },
  },
});
