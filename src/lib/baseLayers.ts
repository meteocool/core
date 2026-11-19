/**
 * The basemaps LayerManager.baseLayerFactory draws. "topographic" is an old
 * name it still answers with the light one.
 */
export const BASE_LAYERS: readonly string[] = ["light", "dark", "osm", "cyclosm", "satellite", "topographic"];

/**
 * The basemap a `mapBaseLayer` setting means.
 *
 * "system", the default, follows the colour scheme; anything else is a basemap
 * the reader picked. It needs a value of its own because Settings.set() stores
 * nothing for a value equal to the default: with a default that changed with
 * the scheme, picking Dark in dark mode stored nothing, and the map went light
 * again with the system.
 *
 * A basemap no longer drawn follows the scheme too, or the label, casing
 * and chrome palettes would be picked for one the map does not show.
 * "satellite" was one until the satellite imagery came back as a basemap; a
 * reader who had the old satellite map stored gets the imagery again.
 */
export function resolveBaseLayer(value: unknown, dark: boolean): string {
  const name = typeof value === "string" ? value : "";
  if (BASE_LAYERS.includes(name)) return name;
  return dark ? "dark" : "light";
}
