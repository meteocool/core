import assert from "node:assert/strict";
import test from "node:test";
import { fromLonLat } from "ol/proj";
import { containsCoordinate } from "ol/extent";
import Polygon from "ol/geom/Polygon";
import { insideRings } from "../../src/layers/networkAt.ts";
import {
  beBordersNearDwd, beExclusiveCoverage, beRadarExtent, chBorders, chExclusiveCoverage, chRadarExtent,
  czBordersNearDwd, czExclusiveCoverage, czRadarExtent, dwdCoverageInv, frBordersNearDwd, frExclusiveCoverage,
  frRadarExtent, plBordersNearDwd, plExclusiveCoverage, plRadarExtent, radarCoverageInv, skBordersNearDwd,
  skExclusiveCoverage, skRadarExtent,
} from "../../src/layers/extents.ts";

/**
 * Each network's coverage, as `network.ts` cuts its layer to it, inside its
 * grid's rectangle, and its hole in DWD's tiles (`networkHoles.ts`).
 */
const NETWORKS = [
  { code: "ch", extent: chRadarExtent, coverage: chExclusiveCoverage, hole: chBorders },
  { code: "fr", extent: frRadarExtent, coverage: frExclusiveCoverage, hole: frBordersNearDwd },
  { code: "cz", extent: czRadarExtent, coverage: czExclusiveCoverage, hole: czBordersNearDwd },
  { code: "pl", extent: plRadarExtent, coverage: plExclusiveCoverage, hole: plBordersNearDwd },
  { code: "be", extent: beRadarExtent, coverage: beExclusiveCoverage, hole: beBordersNearDwd },
  { code: "sk", extent: skRadarExtent, coverage: skExclusiveCoverage, hole: skBordersNearDwd },
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

/** Whether a point is within some distance of any ring's edge. */
function nearEdge(rings: number[][][], [x, y]: number[], distance: number): boolean {
  return rings.some((ring) => ring.some(([x1, y1], i) => {
    const [x2, y2] = ring[(i + 1) % ring.length];
    const length = (x2 - x1) ** 2 + (y2 - y1) ** 2;
    const along = length ? Math.max(0, Math.min(1, ((x - x1) * (x2 - x1) + (y - y1) * (y2 - y1)) / length)) : 0;
    return Math.hypot(x - (x1 + along * (x2 - x1)), y - (y1 + along * (y2 - y1))) < distance;
  }));
}

test("wherever a network draws inside DWD's outline, DWD's tiles are holed for it", () => {
  // Beyond every border a network now wins ground DWD's radars reach too,
  // Eindhoven's or Luxembourg's; DWD's tiles must give way there as well.
  const outline = new Polygon([dwdCoverageInv.getLinearRing(1)!.getCoordinates()]);
  for (const point of GRID) {
    if (!outline.intersectsCoordinate(point)) continue;
    for (const network of drawing(point)) {
      const holed = insideRings(network.hole, point) || nearEdge(network.hole, point, SIMPLIFIED_M);
      assert.ok(holed, `${network.code} draws over DWD at ${point}`);
    }
  }
});
