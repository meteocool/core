/**
 * How place names are set: the flat map's labels (./vector) and the 3D map's
 * (./maplibreStyle) read both from here, so the two agree on what a city
 * looks like and in what ink.
 */

/**
 * A label's colours, picked to match whatever is drawn underneath it.
 *
 * The halo is always the basemap's own colour, softened, never a contrasting
 * one. Labels crowd, and at 11px the halo of one glyph merges into its
 * neighbours and into the counters of a, e and o. A halo in the basemap's
 * colour that merges just disappears back into the map; a contrasting one
 * merges into a plate. The old black-on-opaque-white labels did that over the
 * dark basemap: the white halo was the only part of the label with any
 * contrast against #1c1f24, so a cluster of village names read as a bright
 * smear with black holes punched in it. The casings in ./casing follow the
 * same rule and match the background.
 */
export interface LabelPalette {
  /** Country, region and city. */
  ink: string;
  /** Town, village and hamlet: a step back, so the tiers part by luminance. */
  mutedInk: string;
  halo: string;
  /** Multiplier on the tier halo widths, for backdrops that need more. */
  haloScale: number;
}

/**
 * Near-black and near-white rather than the pure endpoints: #000 on #f6f4f0,
 * or #fff on #1c1f24, is more contrast than small type wants and makes it buzz.
 *
 * The muted step is deliberately small. These labels sit over *radar*, not
 * over the basemap, and reflectivity runs the whole luminance range. A muted
 * ink picked as a step back from the earth colour collapses as soon as the
 * town lands on a green or yellow cell, which at this zoom is most of the
 * interesting ones. Size and weight carry the hierarchy; the ink only has to
 * hint at it.
 */
export const lightLabels: LabelPalette = {
  ink: "#1b1e23",
  mutedInk: "#3a4048",
  halo: "rgba(246, 244, 240, 0.85)",
  haloScale: 1,
};

export const darkLabels: LabelPalette = {
  ink: "#eef1f5",
  mutedInk: "#ccd3dc",
  halo: "rgba(28, 31, 36, 0.85)",
  haloScale: 1,
};

/** The family the labels are set in. */
export const LABEL_FAMILY = "Calibri";

/** One weight of place name. */
export interface LabelTier {
  /** Type size, px. */
  size: number;
  bold: boolean;
  /**
   * The halo as OpenLayers takes it: a stroke centred on the glyph outline,
   * with the fill drawn over the top, so half of it is what shows.
   */
  halo: number;
  /** Which label wins where two collide: the higher. */
  rank: number;
  /** Takes the palette's muted ink. */
  muted: boolean;
}

/**
 * The tiers, country down to hamlet.
 *
 * The halos used to run 4 / 3 / 3 / 2 / 1.5, widest on the largest type and
 * thinnest on the smallest, which made halo thickness part of the hierarchy.
 * Size and weight already carry the hierarchy, though, and the small labels
 * are the ones that most need lifting off a busy cell, so the halos are now
 * uniform except for the country tier. Thinning them at 11px only guarded
 * against the halo merging across letterforms, and a halo the colour of what
 * is behind it can merge freely.
 */
export const LABEL_TIERS = {
  country: { size: 18, bold: true, halo: 2.6, rank: 100, muted: false },
  region: { size: 16, bold: false, halo: 2.2, rank: 90, muted: false },
  city: { size: 13, bold: true, halo: 2.2, rank: 92, muted: false },
  locality: { size: 12, bold: false, halo: 2.0, rank: 90, muted: true },
  micro: { size: 11, bold: false, halo: 2.0, rank: 88, muted: true },
} satisfies Record<string, LabelTier>;

export type LabelTierName = keyof typeof LABEL_TIERS;

/** The tier of each Protomaps `kind_detail`; anything not listed is a locality. */
export const TIER_OF_DETAIL: Record<string, LabelTierName> = {
  country: "country",
  region: "region",
  city: "city",
  town: "locality",
  village: "micro",
  hamlet: "micro",
  isolated_dwelling: "micro",
};

/**
 * Which tier a place gets. Protomaps carries `kind_detail`
 * (country/city/town/village/hamlet/isolated_dwelling) and a `min_zoom` the
 * caller has already checked, so this is only about weight, not about whether
 * to draw at all.
 */
export function tierOfPlace(kind: unknown, detail: unknown): LabelTierName {
  if (kind === "country") return "country";
  return TIER_OF_DETAIL[String(detail)] ?? "locality";
}
