import { fromLonLat } from "ol/proj";
import { chExclusiveCoverage, czExclusiveCoverage, frExclusiveCoverage, plExclusiveCoverage } from "./extents";
import type { CountryNetwork } from "../api/events";

/** Each network's coverage, as `network.ts`'s layers are clipped to it. */
const COVERAGE: [CountryNetwork, number[][][]][] = [
  ["ch", chExclusiveCoverage],
  ["fr", frExclusiveCoverage],
  ["cz", czExclusiveCoverage],
  ["pl", plExclusiveCoverage],
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
