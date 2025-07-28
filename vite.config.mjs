import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { VitePWA } from 'vite-plugin-pwa';
import { cloudflare } from '@cloudflare/vite-plugin';
import sveltePreprocess from 'svelte-preprocess';
import { resolve } from 'path';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [
    cloudflare(),
    svelte({
      preprocess: sveltePreprocess(),
      compilerOptions: {
        runes: true,
        dev: process.env.NODE_ENV === 'development'
      },
    }),
    VitePWA({
      strategies: 'generateSW',
      registerType: 'autoUpdate',
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,jpg,jpeg,gif,webp,svg,ico}'],
        maximumFileSizeToCacheInBytes: 50000000,
      },
      devOptions: {
        enabled: false, // Disable in development
      },
    }),
  ],
  build: {
    rollupOptions: {
      input: {
        main: resolve(fileURLToPath(new URL('.', import.meta.url)), 'index.html'),
        android: resolve(fileURLToPath(new URL('.', import.meta.url)), 'android.html'),
        ios: resolve(fileURLToPath(new URL('.', import.meta.url)), 'ios.html'),
        imprint: resolve(fileURLToPath(new URL('.', import.meta.url)), 'imprint.html'),
        privacy: resolve(fileURLToPath(new URL('.', import.meta.url)), 'privacy.html'),
      },
      output: {
        // Manual chunk splitting for better optimization
        manualChunks: {
          vendor: ['svelte'],
          openlayers: ['ol'],
          chartjs: ['chart.js', 'chartjs-chart-error-bars', 'chartjs-plugin-datalabels'],
          shoelace: ['@shoelace-style/shoelace'],
          lucide: ['@lucide/svelte'],
          socketio: ['socket.io-client'],
          utils: ['date-fns', 'idb', 'javascript-state-machine', 'nanobar'],
        },
      },
    },
    target: 'es2020',
    minify: 'esbuild',
    sourcemap: true,
    outDir: 'dist',
  },
  resolve: {
    alias: {
      '@': resolve(fileURLToPath(new URL('.', import.meta.url)), 'src'),
    },
  },
  define: {
    GIT_COMMIT_HASH: JSON.stringify(process.env.COMMIT_REF || ''),
    BACKEND: JSON.stringify(process.env.BACKEND || ''),
  },
  optimizeDeps: {
    include: ['ol', 'chart.js', '@shoelace-style/shoelace'],
    exclude: ['svelte'],
  },
  server: {
    host: '127.0.0.1',
    port: 3000,
    fs: {
      // Allow serving files from one level up to the project root
      allow: ['..'],
    },
  },
  // Handle static assets
  assetsInclude: ['**/*.webp', '**/*.png', '**/*.jpg', '**/*.jpeg', '**/*.gif', '**/*.svg'],
});