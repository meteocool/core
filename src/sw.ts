/* eslint no-use-before-define: 0 */
/// <reference lib="webworker" />

declare const self: ServiceWorkerGlobalScope & {
  /** Injected at build time by vite-plugin-pwa's injectManifest. */
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};
import { clientsClaim } from "workbox-core";
import { registerRoute } from "workbox-routing";
import { CacheFirst } from "workbox-strategies";
import { ExpirationPlugin } from "workbox-expiration";
import { CacheableResponsePlugin } from "workbox-cacheable-response";
import { cleanupOutdatedCaches, precacheAndRoute } from "workbox-precaching";

// The hosts the basemap and label layers actually request -- see
// src/layers/base.js and src/layers/vector.js. The previous pattern listed
// maptiler and cartocdn, which nothing requests, and cartodb-basemaps-b, while
// base.js asks for -a and -c, so basemap tiles were never cached at all.
registerRoute(
  /^https:\/\/(?:cartodb-basemaps-[ac]\.global\.ssl\.fastly\.net|tile\.nextzen\.org|[abc]\.tile-cyclosm\.openstreetmap\.fr|tile\.openstreetmap\.org)\/.*\.(?:png|mvt)/,
  new CacheFirst({
    cacheName: "tile-cache",
    plugins: [
      new CacheableResponsePlugin({
        statuses: [0, 200],
      }),
      new ExpirationPlugin({
        maxEntries: 20000,
        maxAgeSeconds: 7 * 24 * 60 * 60,
        purgeOnQuotaError: true,
      }),
    ],
  }),
);

 
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);
self.skipWaiting();
clientsClaim();
