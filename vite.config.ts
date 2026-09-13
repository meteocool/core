import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { viteStaticCopy } from "vite-plugin-static-copy";
import { VitePWA } from "vite-plugin-pwa";

// The local stack publishes these on 127.0.0.1; everything is proxied through
// the dev server's own origin so the browser only ever makes same-origin
// requests and there is no CORS to configure. See `make up` in meteocool/ng.
const here = (file: string) => fileURLToPath(new URL(file, import.meta.url));

const API = "http://127.0.0.1:5001";
const DATA = "http://127.0.0.1:5002";
const MINIO = "http://127.0.0.1:9000";

// Cloudflare Pages sets COMMIT_REF; GitHub Actions sets GITHUB_SHA. Webpack read
// only the first, so every CI build shipped an undefined Sentry release.
const commit = process.env.COMMIT_REF ?? process.env.GITHUB_SHA ?? process.env.GIT_COMMIT_HASH ?? "";

export default defineConfig({
  plugins: [
    svelte(),
    viteStaticCopy({
      // Shoelace loads its icons at runtime from the base path set in
      // src/layers/ui.js, so they cannot be bundled.
      targets: [
        {
          src: "node_modules/@shoelace-style/shoelace/dist/assets/*",
          dest: "shoelace/assets",
        },
      ],
    }),
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.js",
      // The entrypoints register the worker themselves, via workbox-window.
      injectRegister: false,
      // The app ships its own manifest at public/assets/manifest.json, which is
      // what the HTML links to; generating a second one would only confuse.
      manifest: false,
      injectManifest: {
        maximumFileSizeToCacheInBytes: 50000000,
        globIgnores: [
          "**/volunteers.png",
          "**/imprint.html",
          "**/_headers",
          "**/_redirects",
          "**/*.map",
          "shoelace/assets/icons/**",
        ],
      },
    }),
  ],
  publicDir: "public",
  build: {
    outDir: "dist",
    sourcemap: true,
    rollupOptions: {
      input: {
        index: here("index.html"),
        ios: here("ios.html"),
        android: here("android.html"),
        imprint: here("imprint.html"),
        privacy: here("privacy.html"),
      },
    },
  },
  define: {
    __GIT_COMMIT_HASH__: JSON.stringify(commit),
  },
  server: {
    host: "127.0.0.1",
    port: 8080,
    proxy: {
      "/socket.io": { target: API, ws: true, changeOrigin: true },
      "/v3": { target: API, changeOrigin: true },
      "/lightning_cache": { target: DATA, changeOrigin: true },
      "/mesocyclones": { target: DATA, changeOrigin: true },
      // minio stands in for the tile CDN.
      "/tiles": { target: MINIO, changeOrigin: true, rewrite: (path) => path.replace(/^\/tiles/, "") },
    },
  },
});
