import assert from "node:assert/strict";
import test from "node:test";
import { fromLonLat } from "ol/proj";
import { containsCoordinate } from "ol/extent";
import Polygon from "ol/geom/Polygon";
import { insideRings } from "../../src/layers/networkAt.ts";
import {
  beExclusiveCoverage, beRadarExtent, chExclusiveCoverage, chRadarExtent, czExclusiveCoverage, czRadarExtent,
  frExclusiveCoverage, frRadarExtent, plExclusiveCoverage, plRadarExtent, radarCoverageInv, skExclusiveCoverage,
  skRadarExtent,
} from "../../src/layers/extents.ts";

/** Each network's coverage, as `network.ts` cuts its layer to it, inside its grid's rectangle. */
const NETWORKS = [
  { code: "ch", extent: chRadarExtent, coverage: chExclusiveCoverage },
  { code: "fr", extent: frRadarExtent, coverage: frExclusiveCoverage },
  { code: "cz", extent: czRadarExtent, coverage: czExclusiveCoverage },
  { code: "pl", extent: plRadarExtent, coverage: plExclusiveCoverage },
  { code: "be", extent: beRadarExtent, coverage: beExclusiveCoverage },
  { code: "sk", extent: skRadarExtent, coverage: skExclusiveCoverage },
];

/**
 * The shapes that decide who draws where (`extents.ts`), checked on a grid
 * of points a tenth of a degree apart over every network's reach.
 */
const GRID: number[][] = [];
for (let lat = 41; lat <= 57.5; lat += 0.1) {
  for (let lon = -6; lon <= 26; lon += 0.1) GRID.push(fromLonLat([lon, lat]));
}

/** The networks drawing at a point. */
const drawing = (point: number[]) => NETWORKS.filter((network) =>
  containsCoordinate(network.extent, point) && insideRings(network.coverage, point));

test("no two networks draw on one point", () => {
  for (const point of GRID) {
    const codes = drawing(point).map((network) => network.code);
    assert.ok(codes.length <= 1, `${codes.join(" and ")} both draw at ${point}`);
  }
});

/**
 * How far a coverage may stray past the wash's hole: both are simplified to
 * 200 m, each on its own, so their edges wander apart by up to that much.
 */
const SIMPLIFIED_M = 400;

test("the no-radar wash has one hole, and every network draws inside it", () => {
  assert.equal(radarCoverageInv.getLinearRingCount(), 2);
  const hole = new Polygon([radarCoverageInv.getLinearRing(1)!.getCoordinates()]);
  for (const point of GRID) {
    if (!drawing(point).length || hole.intersectsCoordinate(point)) continue;
    const [x, y] = hole.getClosestPoint(point);
    assert.ok(Math.hypot(x - point[0], y - point[1]) < SIMPLIFIED_M, `washed out at ${point}`);
  }
});
