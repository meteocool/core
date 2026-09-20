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

/** Radar frames: network-first, cached only to survive an offline reload. */
export const WEATHER_TILE_ROUTE = /^https:\/\/tiles-a\.meteocool\.com\/.*\.png$/;

export const BASEMAP_CACHE = "basemap-cache";
export const WEATHER_TILE_CACHE = "weather-tile-cache";
