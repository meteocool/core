/**
 * The URL patterns the service worker caches tiles for.
 *
 * Shared with the diagnostics panel, which reports whether the tiles this build
 * requests are covered by these routes. A panel with its own copy of the
 * patterns would go on saying "cached" long after the worker stopped matching.
 *
 * Kept free of workbox imports so the app bundle can read it without pulling
 * the worker's dependencies in.
 */

/** Versioned basemap vectors: immutable per URL, so cache-first. */
export const BASEMAP_ROUTE = /^https:\/\/map\.meteocool\.com\/.*\.mvt$/;

/**
 * Versioned terrain, from the same host: immutable per URL as well. Its own
 * cache, because a terrain tile is a 120-160 kB image where a basemap tile is
 * a few kB of vectors, and sharing one entry cap would let the 3D map's relief
 * push the flat map's streets out.
 */
export const TERRAIN_ROUTE = /^https:\/\/map\.meteocool\.com\/mapterhorn-[^/]+\/.*\.webp$/;

/**
 * Radar frames: cache-first.
 *
 * Every frame's tiles live under a `tile_id` that names that one rendering,
 * so a URL never changes content: the timeseries decides which frame is
 * current, without asking for the tile again. Matched on production's tile
 * host and the cluster's `assets-<environment>` ones alike, so a staging or
 * demo build is cached the same way.
 */
export const WEATHER_TILE_ROUTE = /^https:\/\/(?:tiles-a|assets-[a-z]+)\.meteocool\.com\/.+\.png$/;

export const BASEMAP_CACHE = "basemap-cache";
export const TERRAIN_CACHE = "terrain-cache";
export const WEATHER_TILE_CACHE = "weather-tile-cache";
