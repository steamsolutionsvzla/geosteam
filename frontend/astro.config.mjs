// @ts-check
import { defineConfig } from 'astro/config';

export default defineConfig({
  output: 'static',
  server: {
    port: 4321,
  },
  vite: {
    server: {
      proxy: {
        '/api': {
          target: 'http://127.0.0.1:8001',
          changeOrigin: true,
        },
        '/geoserver': {
          target: 'http://127.0.0.1:8001',
          changeOrigin: true,
        },
      },
    },
    optimizeDeps: {
      exclude: ['maplibre-gl'],
    },
  },
});