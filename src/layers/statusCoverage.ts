import { fromLonLat } from "ol/proj";
import { containsCoordinate } from "ol/extent";
import {
  beExclusiveCoverage, beRadarExtent4326, chExclusiveCoverage, chRadarExtent4326, czExclusiveCoverage,
  czRadarExtent4326, dkExclusiveCoverage, dkRadarExtent4326, dwdCoverageInv, dwdRadarExtent4326, eeExclusiveCoverage,
  eeRadarExtent4326, fiExclusiveCoverage, fiRadarExtent4326, frExclusiveCoverage, frRadarExtent4326, hrExclusiveCoverage,
  hrRadarExtent4326, ieExclusiveCoverage, ieRadarExtent4326, ltExclusiveCoverage, ltRadarExtent4326, nlExclusiveCoverage,
  nlRadarExtent4326, noExclusiveCoverage, noRadarExtent4326, plExclusiveCoverage, plRadarExtent4326, seExclusiveCoverage,
  seRadarExtent4326, skExclusiveCoverage, skRadarExtent4326,
} from "./extents";
import { insideRings, networkAt } from "./networkAt";
import type { Coverage, DomainCoverage, Extent4326 } from "../lib/status";

/**
 * Each domain's ground, as lib/status.ts asks for it: the ground the map
 * draws that domain's radar on. A network's is its exclusive coverage, the
 * shape its layer is cut to (the vendored `spec/coverage.json`); Germany's
 * is DWD's reach less every network's, which is where DWD's tiles draw.
 */
const ground = (extent: Extent4326, rings: number[][][]): DomainCoverage => {
  const box = fromExtent4326(extent);
  return {
    extent,
    covers: (lon, lat) => {
      const point = fromLonLat([lon, lat]);
      return containsCoordinate(box, point) && insideRings(rings, point);
    },
  };
};

function fromExtent4326([west, south, east, north]: Extent4326): number[] {
  return [...fromLonLat([west, south]), ...fromLonLat([east, north])];
}

/* DWD's reach, the hole in the wash a forecast step draws (dwd.ts). */
const dwdReach = [dwdCoverageInv.getLinearRing(1)!.getCoordinates()];

export const STATUS_COVERAGE: Coverage = {
  de: {
    extent: dwdRadarExtent4326,
    covers: (lon, lat) => insideRings(dwdReach, fromLonLat([lon, lat])) && networkAt(lat, lon) === undefined,
  },
  ch: ground(chRadarExtent4326, chExclusiveCoverage),
  fr: ground(frRadarExtent4326, frExclusiveCoverage),
  cz: ground(czRadarExtent4326, czExclusiveCoverage),
  pl: ground(plRadarExtent4326, plExclusiveCoverage),
  be: ground(beRadarExtent4326, beExclusiveCoverage),
  sk: ground(skRadarExtent4326, skExclusiveCoverage),
  lt: ground(ltRadarExtent4326, ltExclusiveCoverage),
  ee: ground(eeRadarExtent4326, eeExclusiveCoverage),
  ie: ground(ieRadarExtent4326, ieExclusiveCoverage),
  hr: ground(hrRadarExtent4326, hrExclusiveCoverage),
  dk: ground(dkRadarExtent4326, dkExclusiveCoverage),
  nl: ground(nlRadarExtent4326, nlExclusiveCoverage),
  fi: ground(fiRadarExtent4326, fiExclusiveCoverage),
  se: ground(seRadarExtent4326, seExclusiveCoverage),
  no: ground(noRadarExtent4326, noExclusiveCoverage),
};

/** Whether one of these domains' ground is at a point: the networks' own, or Germany's. */
export function drawnByDomains(domains: readonly string[], lon: number, lat: number): boolean {
  return domains.some((domain) => STATUS_COVERAGE[domain]?.covers(lon, lat) ?? false);
}
