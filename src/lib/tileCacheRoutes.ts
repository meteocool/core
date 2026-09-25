/**
 * The URL patterns the service worker caches tiles for.
 *
 * Shared rather than written twice: the diagnostics panel reports whether the
 * tiles this build actually requests are covered by these routes, and a panel
 * that keeps its own copy of the patterns would go on saying "cached" long
 * after the worker stopped matching.
 *
 * Kept free of workbox imports so the app bundle can read it without pulling
 * the worker's dependencies in.
 */

/** Versioned basemap vectors: immutable per URL, so cache-first. */
export const BASEMAP_ROUTE = /^https:\/\/map\.meteocool\.com\/.*\.mvt$/;

/**
 * Radar frames: cache-first.
 *
 * Every frame's tiles live under a `tile_id` that names that one rendering,
 * so a URL never changes content -- which frame is current is decided by the
 * timeseries, not by re-asking for the tile. Matched on production's tile
 * host and the cluster's `assets-<environment>` ones alike, so a staging or
 * demo build is cached the same way.
 */
export const WEATHER_TILE_ROUTE = /^https:\/\/(?:tiles-a|assets-[a-z]+)\.meteocool\.com\/.+\.png$/;

export const BASEMAP_CACHE = "basemap-cache";
export const WEATHER_TILE_CACHE = "weather-tile-cache";
