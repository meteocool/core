import { mapBaseLayer } from "../stores";

/**
 * The colour a mark is outlined in so it survives whatever it lands on.
 *
 * Shared by the storm layer's forecast cone and the live-cell ring, which had
 * the same rule written out twice. Light over a dark map and dark over a light
 * one: the casing is meant to be the background the mark sits on, and a white
 * one over the dark basemap inverts that -- the outline becomes the loudest
 * thing on screen and whatever it was drawn around is reduced to a core inside
 * it.
 */
export const LIGHT_CASING = "rgba(255, 255, 255, 0.75)";
export const DARK_CASING = "rgba(12, 16, 22, 0.75)";

/** The basemaps a light casing would be the loudest thing on. */
const DARK_BASEMAPS = new Set(["dark", "satellite"]);

/**
 * Whether what is drawn underneath is dark, so anything laid over it inverts.
 *
 * Exported because three places need the same answer and each used to carry
 * its own copy of the set: the casings and inks here, the place labels in
 * layers/vector.ts, and the floating chrome's data-chrome attribute in
 * layers/ui.ts. Three copies is two that can drift.
 */
export const isDarkBasemap = (basemap: string): boolean => DARK_BASEMAPS.has(basemap);

export const casingFor = (basemap: string): string => (
  isDarkBasemap(basemap) ? DARK_CASING : LIGHT_CASING
);

/**
 * The opposite choice, for a mark that is the line rather than the backing.
 *
 * A casing matches the map because it is standing in for the background. A
 * mark drawn on its own -- the ring around a live cell, which has no coloured
 * line inside it to protect -- has to do the reverse and contrast, or it is a
 * dark ring on a dark map. Same two colours, picked the other way round, and
 * opaque: nothing is showing through this one on purpose.
 */
export const LIGHT_INK = "rgba(255, 255, 255, 0.95)";
export const DARK_INK = "rgba(17, 20, 26, 0.9)";

export const inkFor = (basemap: string): string => (
  isDarkBasemap(basemap) ? LIGHT_INK : DARK_INK
);

/**
 * Follow the basemap, calling `onChange` when the picked value actually
 * changes.
 *
 * A layer cannot read this per feature -- OpenLayers calls a style function
 * with nowhere to thread state through -- so each one holds the current value
 * and redraws itself when told. Generic over what is picked so the label
 * palettes in layers/vector.ts can ride it too; values are compared by
 * identity, so a `pick` returning objects has to return shared ones. Returns
 * the unsubscriber.
 */
export function watchBasemap<T>(
  pick: (basemap: string) => T,
  onChange: (value: T) => void,
): () => void {
  let current: T | undefined;
  let seen = false;
  return mapBaseLayer.subscribe((name) => {
    const next = pick(String(name));
    if (seen && next === current) return;
    seen = true;
    current = next;
    onChange(next);
  });
}

export const watchCasing = (onChange: (colour: string) => void) => watchBasemap(casingFor, onChange);
export const watchInk = (onChange: (colour: string) => void) => watchBasemap(inkFor, onChange);
