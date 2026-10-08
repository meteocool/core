/**
 * The basemaps LayerManager.baseLayerFactory draws. "topographic" is an old
 * name it still answers with the light one.
 */
export const BASE_LAYERS: readonly string[] = ["light", "dark", "osm", "cyclosm", "topographic"];

/**
 * The basemap a `mapBaseLayer` setting means.
 *
 * "system", the default, follows the colour scheme; anything else is a basemap
 * the reader picked. A value of its own rather than "nothing stored", because
 * Settings.set() stores nothing for a value equal to the default -- so with a
 * default that changed with the scheme, picking Dark in dark mode stored
 * nothing, and the map quietly went light again with the system.
 *
 * A basemap no longer drawn follows the scheme too: "satellite", withdrawn
 * with the satellite map, would otherwise have the label, casing and chrome
 * palettes treat the light basemap drawn in its place as dark.
 */
export function resolveBaseLayer(value: unknown, dark: boolean): string {
  const name = typeof value === "string" ? value : "";
  if (BASE_LAYERS.includes(name)) return name;
  return dark ? "dark" : "light";
}
