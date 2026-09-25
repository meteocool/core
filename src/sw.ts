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
import {
  BASEMAP_CACHE, BASEMAP_ROUTE, WEATHER_TILE_CACHE, WEATHER_TILE_ROUTE,
} from "./lib/tileCacheRoutes";

// Two caches, because the two tilesets have opposite needs.
//
// The basemap is versioned into its own path (map.meteocool.com/<version>/),
// so a given URL never changes content and can be served from cache
// indefinitely. The previous pattern here listed cartodb, nextzen, cyclosm and
// openstreetmap.org -- none of which the app requests any more.
registerRoute(
  BASEMAP_ROUTE,
  new CacheFirst({
    cacheName: BASEMAP_CACHE,
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({
        maxEntries: 20000,
        maxAgeSeconds: 30 * 24 * 60 * 60,
        purgeOnQuotaError: true,
      }),
    ],
  }),
);

// Weather tiles are immutable too, per URL: each frame is rendered once under
// its own tile_id, and the timeseries says which id is current. This used to
// be network-first on the theory that a cached radar frame is worse than
// none, but a frame's URL never serves a different frame -- so every loop of
// the player after OpenLayers had evicted a tile, and every reload, went to
// the network for bytes already on disk. The expiry bounds the storage; the
// grid moves on from an id within hours anyway.
registerRoute(
  WEATHER_TILE_ROUTE,
  new CacheFirst({
    cacheName: WEATHER_TILE_CACHE,
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({
        maxEntries: 4000,
        maxAgeSeconds: 2 * 60 * 60,
        purgeOnQuotaError: true,
      }),
    ],
  }),
);

 
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);
self.skipWaiting();
clientsClaim();
