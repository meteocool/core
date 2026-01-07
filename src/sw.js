/* eslint no-use-before-define: 0 */
import { clientsClaim } from 'workbox-core'
import { registerRoute } from 'workbox-routing'
import { NetworkFirst } from 'workbox-strategies'
import { ExpirationPlugin } from 'workbox-expiration'
import { CacheableResponsePlugin } from 'workbox-cacheable-response'
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching'

registerRoute(
  /^https:\/\/(map|tiles-a)\.meteocool\.com\/.*\.(png|mvt)$/,
  new NetworkFirst({
    cacheName: 'tile-cache',
    networkTimeoutSeconds: 4,
    plugins: [
      new CacheableResponsePlugin({
        statuses: [0, 200],
      }),
      new ExpirationPlugin({
        maxEntries: 20000,
        maxAgeSeconds: 2 * 60 * 60,
        purgeOnQuotaError: true,
      }),
    ],
  }),
)

cleanupOutdatedCaches()
precacheAndRoute(self.__WB_MANIFEST)
self.skipWaiting()
clientsClaim()
