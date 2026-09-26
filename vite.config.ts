import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { viteStaticCopy } from "vite-plugin-static-copy";
import { VitePWA } from "vite-plugin-pwa";

const here = (file: string) => fileURLToPath(new URL(file, import.meta.url));

/**
 * Where the dev server proxies to.
 *
 * Everything the page talks to goes through the dev server's own origin, so
 * the browser only ever makes same-origin requests and there is no CORS to
 * configure. src/urls.ts emits relative bases for every dev run to match.
 * That is not a convenience: api.meteocool.com stalls on any cross-origin
 * browser request -- it answers a plain curl in 65ms and times out once an
 * `Origin` header is present -- so a dev server talking to it directly cannot
 * load radar at all.
 *
 * `npm run dev` proxies to the staging cluster. `npm run dev-local`
 * (`--mode localstack`) proxies to the stack `make up` publishes on 127.0.0.1
 * in meteocool/ng. Either default can be overridden per-origin:
 *   MC_API=https://api.meteocool.com MC_SOCKET=https://api.ng.meteocool.com \
 *   MC_DATA=https://data.meteocool.com MC_TILES=https://tiles-a.meteocool.com \
 *   npm run dev
 */
function proxyTargets(mode: string) {
  const localStack = mode === "localstack";
  const API = process.env.MC_API
    ?? (localStack ? "http://127.0.0.1:5001" : "https://staging.meteocool.com");
  return {
    API,
    SOCKET: process.env.MC_SOCKET ?? API,
    DATA: process.env.MC_DATA
      ?? (localStack ? "http://127.0.0.1:5002" : "https://data-staging.meteocool.com"),
    TILES: process.env.MC_TILES
      ?? (localStack ? "http://127.0.0.1:9000" : "https://assets-staging.meteocool.com"),
    // `docker compose --profile geocoding up nominatim` in meteocool/ng is what
    // listens on 8080 locally; it holds Monaco and nothing else, so the staging
    // instance is usually the more useful target even for a local stack.
    GEOCODING: process.env.MC_GEOCODING
      ?? (localStack ? "http://127.0.0.1:8080" : "https://geocoding-staging.meteocool.com"),
  };
}

// Cloudflare Pages sets COMMIT_REF; GitHub Actions sets GITHUB_SHA. Webpack read
// only the first, so every CI build shipped an undefined Sentry release.
const commit = process.env.COMMIT_REF ?? process.env.GITHUB_SHA ?? process.env.GIT_COMMIT_HASH ?? "";

/*
 * Production is not built from here.
 *
 * meteocool.com is the old frontend on the old backend, served by the
 * Cloudflare Pages project `core`, and the apps in the stores still depend on
 * it. That project is wired to this GitHub repository with `develop` as its
 * production branch, so on 2026-09-25 every push to develop built this Vite
 * app and put it on meteocool.com, in front of an API it was not written for.
 * Pages builds run with CF_PAGES=1, and a build that fails leaves the live
 * deployment alone -- so this refuses. Staging and demo deploy as Workers from
 * .github/workflows/deploy.yml, which never sets this. Production's cutover,
 * when it comes, is a deliberate change to the Pages project, not a push.
 */
if (process.env.CF_PAGES && !process.env.MC_ALLOW_PAGES_BUILD) {
  throw new Error(
    "Refusing to build under Cloudflare Pages: meteocool.com is the old frontend "
    + "and the store apps depend on it. See vite.config.ts.",
  );
}

export default defineConfig(({ mode }) => {
  const { API, SOCKET, DATA, TILES, GEOCODING } = proxyTargets(mode);

  return {
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
        filename: "sw.ts",
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
    // MapLibre loads its worker with `{ type: "module" }`, so the bundle Vite
    // emits for it has to be an ES module too.
    worker: {
      format: "es",
    },
    server: {
      host: "127.0.0.1",
      port: 8080,
      proxy: {
        "/socket.io": { target: SOCKET, ws: true, changeOrigin: true },
        "/v3": { target: API, changeOrigin: true },
        "/lightning_cache": { target: DATA, changeOrigin: true },
        "/cells": { target: DATA, changeOrigin: true },
      "/mesocyclones": { target: DATA, changeOrigin: true },
        // The tile CDN, or minio standing in for it locally.
        "/tiles": { target: TILES, changeOrigin: true, rewrite: (path) => path.replace(/^\/tiles/, "") },
        "/geocoding": {
          target: GEOCODING,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/geocoding/, ""),
        },
      },
    },
  };
});
