import { fromLonLat } from "ol/proj";
import { containsCoordinate } from "ol/extent";
import type { Extent } from "ol/extent";
import {
  beExclusiveCoverage, beRadarExtent, chExclusiveCoverage, chRadarExtent, czExclusiveCoverage, czRadarExtent,
  frExclusiveCoverage, frRadarExtent, plExclusiveCoverage, plRadarExtent, skExclusiveCoverage, skRadarExtent,
} from "./extents";
import type { CountryNetwork } from "../api/events";

/** Each network's coverage, as `network.ts`'s layers are clipped to it. */
const COVERAGE: [CountryNetwork, number[][][]][] = [
  ["ch", chExclusiveCoverage],
  ["fr", frExclusiveCoverage],
  ["cz", czExclusiveCoverage],
  ["pl", plExclusiveCoverage],
  ["be", beExclusiveCoverage],
  ["sk", skExclusiveCoverage],
];

/**
 * Whether a point lies inside a set of rings, under the nonzero rule.
 *
 * The coverage is wound for this rule and the canvas clip fills with it, so a
 * point counts as a network's exactly where that network's pixels are drawn.
 */
export function insideRings(rings: number[][][], [x, y]: number[]): boolean {
  let winding = 0;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const [x1, y1] = ring[j];
      const [x2, y2] = ring[i];
      const side = (x2 - x1) * (y - y1) - (x - x1) * (y2 - y1);
      if (y1 <= y && y2 > y && side > 0) winding += 1;
      else if (y1 > y && y2 <= y && side < 0) winding -= 1;
    }
  }
  return winding !== 0;
}

/**
 * Which network the map draws at a point, if any draws there but DWD.
 *
 * The forecast strip asks the backend to sample its past from this network,
 * since the bars have to show the radar the map draws under the finger.
 * The coverages overlap by nothing, so at most one matches.
 */
export function networkAt(lat: number, lon: number): CountryNetwork | undefined {
  const point = fromLonLat([lon, lat]);
  return COVERAGE.find(([, rings]) => insideRings(rings, point))?.[0];
}

/** Each network's grid rectangle, which its coverage lies inside: a cheap first test. */
const EXTENT: Record<CountryNetwork, Extent> = {
  ch: chRadarExtent, fr: frRadarExtent, cz: czRadarExtent, pl: plRadarExtent, be: beRadarExtent, sk: skRadarExtent,
};

const RINGS = Object.fromEntries(COVERAGE) as Record<CountryNetwork, number[][][]>;

/**
 * Whether one of these networks draws at a point, in EPSG:3857: inside the
 * ground its layers are cut to. Where meteocool's nowcast covers, for the
 * player's "no forecast here" (lib/nowcast.ts).
 */
export function drawnByAny(networks: readonly CountryNetwork[], point: number[]): boolean {
  return networks.some((network) => containsCoordinate(EXTENT[network], point) && insideRings(RINGS[network], point));
}
