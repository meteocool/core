import type { BasemapTheme } from "./protomaps";
import { basemapLayer } from "./protomaps";

/**
 * The four basemaps, all drawn from meteocool's own Protomaps tiles.
 *
 * They are deliberately low-contrast: everything here sits under radar
 * reflectivity, lightning and the label overlay, so a basemap that competes
 * with the weather is a basemap that is in the way. The differences between
 * them are about which features earn ink, not about saturation:
 *
 *   light  -- the default. Land, water, motorways, country borders. Almost
 *             nothing else, because the radar covers most of the frame.
 *   dark   -- the same restraint, inverted for dark mode.
 *   osm    -- closer to standard OSM carto: landuse, the full road hierarchy
 *             down to minor roads, buildings, region borders.
 *   cyclosm -- an outdoors read: forests and parks carry the colour, tracks
 *             and paths are drawn, motorways are pushed back.
 */

/** Shared road colours so a theme only has to say which classes it draws. */
const ROAD_CLASSES = ["highway", "major_road", "minor_road", "path", "rail", "ferry"];

export const lightTheme: BasemapTheme = {
  earth: "#f6f4f0",
  water: "#cfe0ec",
  waterway: "#bcd4e4",
  landcover: {
    forest: "#e8eee2",
    glacier: "#f2f6f8",
  },
  landuse: {},
  buildingFill: "#e9e5df",
  roads: {
    highway: { color: "#e3ddd2", width: 1.6 },
    major_road: { color: "#eae5db", width: 1.1 },
    minor_road: { color: "#efebe4", width: 0.8 },
    path: { color: "#e5e0d6", width: 0.5 },
    rail: { color: "#ded8cd", width: 0.6 },
    ferry: { color: "#c3d6e4", width: 0.6 },
  },
  roadKinds: ["highway", "major_road"],
  boundaryCountry: "#9a958c",
  boundaryRegion: null,
};

export const darkTheme: BasemapTheme = {
  earth: "#1c1f24",
  water: "#16232e",
  waterway: "#1d2f3d",
  landcover: {
    forest: "#1f262210",
    glacier: "#242a2f",
  },
  landuse: {},
  buildingFill: "#262a2f",
  roads: {
    highway: { color: "#33383f", width: 1.6 },
    major_road: { color: "#2c3037", width: 1.1 },
    minor_road: { color: "#272b31", width: 0.8 },
    path: { color: "#272b31", width: 0.5 },
    rail: { color: "#2a2e34", width: 0.6 },
    ferry: { color: "#1d2f3d", width: 0.6 },
  },
  roadKinds: ["highway", "major_road"],
  boundaryCountry: "#5c626b",
  boundaryRegion: null,
};

export const osmTheme: BasemapTheme = {
  earth: "#f2efe9",
  water: "#aad3df",
  waterway: "#aad3df",
  landcover: {
    forest: "#c8e0b4",
    grassland: "#ddedc4",
    farmland: "#eef0d5",
    scrub: "#d6e6bf",
    barren: "#eae6dd",
    glacier: "#f1f6f8",
    urban_area: "#eae6e1",
  },
  landuse: {
    forest: "#c8e0b4",
    wood: "#c8e0b4",
    farmland: "#eef0d5",
    meadow: "#ddedc4",
    residential: "#e4e0da",
    commercial: "#efe3e0",
    industrial: "#e6e0e6",
    recreation_ground: "#dffce2",
    nature_reserve: "#d5eac3",
    national_park: "#d5eac3",
    military: "#f0e4e0",
    wetland: "#d6e6e0",
    sand: "#f3ecd3",
  },
  buildingFill: "#d9d0c9",
  buildingStroke: "#c6bbb1",
  roads: {
    highway: { color: "#e892a2", width: 1.8 },
    major_road: { color: "#f7fabf", width: 1.3 },
    minor_road: { color: "#ffffff", width: 0.9 },
    path: { color: "#d4b39a", width: 0.5 },
    rail: { color: "#b0b0b0", width: 0.6 },
    ferry: { color: "#79a3d0", width: 0.6 },
  },
  roadKinds: ROAD_CLASSES,
  boundaryCountry: "#9a70a8",
  boundaryRegion: "#b89ec2",
};

export const cyclosmTheme: BasemapTheme = {
  earth: "#f5f4ee",
  water: "#b9dced",
  waterway: "#9fcbe0",
  landcover: {
    forest: "#a9cf9a",
    grassland: "#d9e8bd",
    farmland: "#f0eedb",
    scrub: "#cadfae",
    barren: "#ece7da",
    glacier: "#eef5f8",
  },
  landuse: {
    forest: "#a9cf9a",
    wood: "#a9cf9a",
    nature_reserve: "#bcdda8",
    national_park: "#bcdda8",
    recreation_ground: "#cdecc6",
    meadow: "#d9e8bd",
    farmland: "#f0eedb",
    wetland: "#c8ded6",
    residential: "#eae7e0",
  },
  buildingFill: "#e0dbd2",
  roads: {
    // CyclOSM's point is what you can ride, so tracks and paths get the ink
    // and motorways are drawn back rather than highlighted.
    highway: { color: "#ded6cc", width: 1.2 },
    major_road: { color: "#e8e2d8", width: 1.0 },
    minor_road: { color: "#ffffff", width: 0.9 },
    path: { color: "#8a6b4f", width: 0.9 },
    rail: { color: "#a8a8a8", width: 0.6 },
    ferry: { color: "#6f9fc4", width: 0.6 },
  },
  roadKinds: ROAD_CLASSES,
  boundaryCountry: "#8f8a80",
  boundaryRegion: "#b0aaa0",
};

export const cartoLight = () => basemapLayer(lightTheme);
export const cartoDark = () => basemapLayer(darkTheme);
export const osm = () => basemapLayer(osmTheme);
export const cyclosm = () => basemapLayer(cyclosmTheme);

/**
 * Whether the separate label overlay should be drawn over this basemap.
 *
 * Every basemap here is label-free by design -- place names belong above the
 * radar, not under it -- so the overlay is wanted over all of them, and over
 * satellite imagery too. It stays a function, and stays called from
 * layers/vector.ts, so that adding a basemap that carries its own labels is a
 * one-line change rather than a re-wiring.
 */
export function supportsVectorLabels(_layer: string): boolean {
  return true;
}
