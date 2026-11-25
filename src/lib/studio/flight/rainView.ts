/**
 * Where the flight's page first looks: at rain, close enough that it fills
 * at least half of the map the page leaves showing.
 *
 * The rain is the radar's storm boxes (`/cells/volumes`): every zoom-10 tile
 * a storm covers above its seed threshold, abutting and never overlapping.
 * The view chosen is the one that shows the most of them while they cover
 * half of it; where nothing is that dense, the one they cover the most of.
 */
import { fetchCurrentVolumes } from "../../../api";

/** Web Mercator's half-width, m. */
const HALF = 20037508.342789244;
/** The share of the map the rain should cover. */
export const RAIN_SHARE = 0.5;
/** The zooms looked at, widest first: not wider than a country, not closer than a valley. */
const ZOOMS = Array.from({ length: 21 }, (_, i) => 5 + i * 0.25);

/** A storm box in Web Mercator metres: west, south, east, north. */
export type Box = readonly [number, number, number, number];

/** Where to look: the rain's middle in Web Mercator, metres a pixel, and the share of the view it covers. */
export interface RainView {
  x: number;
  y: number;
  resolution: number;
  share: number;
}

/** A z/x/y tile's box in Web Mercator. */
export function tileBox([z, x, y]: readonly [number, number, number]): Box {
  const size = (2 * HALF) / 2 ** z;
  return [-HALF + x * size, HALF - (y + 1) * size, -HALF + (x + 1) * size, HALF - y * size];
}

/** Metres a pixel at `zoom`, in Web Mercator. */
const resolutionAt = (zoom: number) => (2 * HALF) / 256 / 2 ** zoom;

/**
 * The view onto `boxes` for a region of the screen `width` by `height` px:
 * the most rain at `RAIN_SHARE` of it or more, else the largest share. Null
 * where there is no rain at all.
 */
export function rainView(boxes: readonly Box[], width: number, height: number): RainView | null {
  if (!boxes.length || width <= 0 || height <= 0) return null;
  const centres = boxes.map(([w, s, e, n]) => [(w + e) / 2, (s + n) / 2] as const);
  let best: (RainView & { covered: number }) | null = null;
  let densest: (RainView & { covered: number }) | null = null;
  for (const zoom of ZOOMS) {
    const resolution = resolutionAt(zoom);
    const halfW = (width * resolution) / 2;
    const halfH = (height * resolution) / 2;
    const area = 4 * halfW * halfH;
    for (const [x, y] of centres) {
      let covered = 0;
      for (const [w, s, e, n] of boxes) {
        const dx = Math.min(e, x + halfW) - Math.max(w, x - halfW);
        if (dx <= 0) continue;
        const dy = Math.min(n, y + halfH) - Math.max(s, y - halfH);
        if (dy > 0) covered += dx * dy;
      }
      const share = covered / area;
      if (share >= RAIN_SHARE && (!best || covered > best.covered)) best = { x, y, resolution, share, covered };
      if (!densest || share > densest.share) densest = { x, y, resolution, share, covered };
    }
  }
  const chosen = best ?? densest;
  return chosen && { x: chosen.x, y: chosen.y, resolution: chosen.resolution, share: chosen.share };
}

/** The radar's storm boxes now, or at `at` (unix seconds) in a past window; none where the list does not come. */
export async function rainBoxes(at: number | null = null): Promise<Box[]> {
  try {
    const { volumes } = await fetchCurrentVolumes(undefined, { at });
    return (volumes ?? []).flatMap((volume) => (volume.tile && !volume.coarse ? [tileBox(volume.tile as [number, number, number])] : []));
  } catch {
    return [];
  }
}
