/* eslint no-use-before-define: 0 */

import { clientsClaim } from "workbox-core";
import { registerRoute } from "workbox-routing";
import { CacheFirst } from "workbox-strategies";
import { ExpirationPlugin } from "workbox-expiration";
import { CacheableResponsePlugin } from "workbox-cacheable-response";
import { cleanupOutdatedCaches, precacheAndRoute } from "workbox-precaching";

registerRoute(
  new RegExp("https://(?:api.maptiler.com|basemaps.cartocdn.com|tile.nextzen.org|cartodb-basemaps-b.global.ssl.fastly.net)/.*.(png|mvt)"),
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
registerRoute(
  new RegExp("https://tiles-(a|b|c)\\.meteocool\\.com/meteonowcast/.*\\.png"),
  new CacheFirst({
    cacheName: "nowcast-tile-cache",
    plugins: [
      new CacheableResponsePlugin({
        statuses: [0, 200, 404],
      }),
      new ExpirationPlugin({
        maxEntries: 20000,
        maxAgeSeconds: 7 * 60,
        purgeOnQuotaError: true,
      }),
    ],
  }),
);
registerRoute(
  new RegExp("https://tiles-(a|b|c)\\.meteocool\\.com/meteoradar/.*\\.png"),
  new CacheFirst({
    cacheName: "radar-tile-cache",
    plugins: [
      new CacheableResponsePlugin({
        statuses: [0, 200, 404],
      }),
      new ExpirationPlugin({
        maxEntries: 20000,
        maxAgeSeconds: 7 * 60,
        purgeOnQuotaError: true,
      }),
    ],
  }),
);

/* eslint-disable no-restricted-globals, no-underscore-dangle */
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);
self.skipWaiting();
clientsClaim();
