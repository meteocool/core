import assert from "node:assert/strict";
import test from "node:test";
import { fromLonLat } from "ol/proj";
import { boundingExtent, containsCoordinate } from "ol/extent";
import Polygon from "ol/geom/Polygon";
import { insideRings } from "../../src/layers/networkAt.ts";
import {
  beBordersNearDwd, beExclusiveCoverage, beRadarExtent, chBorders, chExclusiveCoverage, chRadarExtent,
  czBordersNearDwd, czExclusiveCoverage, czRadarExtent, dkBordersNearDwd, dkExclusiveCoverage, dkRadarExtent,
  dwdCoverageInv, eeBordersNearDwd, eeExclusiveCoverage, eeRadarExtent, fiBordersNearDwd, fiExclusiveCoverage,
  fiRadarExtent, frBordersNearDwd, frExclusiveCoverage, frRadarExtent, hrBordersNearDwd, hrExclusiveCoverage,
  hrRadarExtent, ieBordersNearDwd, ieExclusiveCoverage, ieRadarExtent, ltBordersNearDwd, ltExclusiveCoverage,
  ltRadarExtent, nlBordersNearDwd, nlExclusiveCoverage, nlRadarExtent, noBordersNearDwd, noExclusiveCoverage,
  noRadarExtent, plBordersNearDwd, plExclusiveCoverage, plRadarExtent, radarCoverageInv, seBordersNearDwd,
  seExclusiveCoverage, seRadarExtent, skBordersNearDwd, skExclusiveCoverage, skRadarExtent,
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
  { code: "lt", extent: ltRadarExtent, coverage: ltExclusiveCoverage, hole: ltBordersNearDwd },
  { code: "ee", extent: eeRadarExtent, coverage: eeExclusiveCoverage, hole: eeBordersNearDwd },
  { code: "ie", extent: ieRadarExtent, coverage: ieExclusiveCoverage, hole: ieBordersNearDwd },
  { code: "hr", extent: hrRadarExtent, coverage: hrExclusiveCoverage, hole: hrBordersNearDwd },
  { code: "dk", extent: dkRadarExtent, coverage: dkExclusiveCoverage, hole: dkBordersNearDwd },
  { code: "nl", extent: nlRadarExtent, coverage: nlExclusiveCoverage, hole: nlBordersNearDwd },
  { code: "fi", extent: fiRadarExtent, coverage: fiExclusiveCoverage, hole: fiBordersNearDwd },
  { code: "se", extent: seRadarExtent, coverage: seExclusiveCoverage, hole: seBordersNearDwd },
  { code: "no", extent: noRadarExtent, coverage: noExclusiveCoverage, hole: noBordersNearDwd },
];

/**
 * The shapes that decide who draws where (`extents.ts`), checked on a grid
 * of points a tenth of a degree apart over every network's reach.
 */
const GRID: number[][] = [];
for (let lat = 40.5; lat <= 73; lat += 0.1) {
  for (let lon = -12.8; lon <= 35.6; lon += 0.1) GRID.push(fromLonLat([lon, lat]));
}

/** The networks drawing at a point. */
const drawing = (point: number[]) => NETWORKS.filter((network) =>
  containsCoordinate(network.extent, point) && insideRings(network.coverage, point));

/** The networks drawing at each point of the grid, worked out once for every test. */
const DRAWN = GRID.map(drawing);

test("no two networks draw on one point", () => {
  for (const [i, point] of GRID.entries()) {
    const codes = DRAWN[i].map((network) => network.code);
    assert.ok(codes.length <= 1, `${codes.join(" and ")} both draw at ${point}`);
  }
});

/**
 * How far a coverage may stray past the wash's hole: both are simplified to
 * 200 m, each on its own, so their edges wander apart by up to that much.
 */
const SIMPLIFIED_M = 400;

/** The wash's rings after the world's: a hole per part, and the islands inside them. */
const WASH_RINGS = radarCoverageInv.getCoordinates().slice(1);
const WASH_EXTENTS = WASH_RINGS.map((ring) => boundingExtent(ring));

/**
 * Whether the wash is drawn at a point. OpenLayers winds every ring after
 * the world's as a hole before it fills, under the nonzero rule: the world
 * counts one, each ring around the point one less, and the wash is drawn
 * wherever the count is not zero. So inside one ring it is open, and inside
 * an island, which lies inside a hole, it is drawn again.
 */
function washed(point: number[]): boolean {
  return WASH_RINGS.filter((ring, i) => containsCoordinate(WASH_EXTENTS[i], point) && insideRings([ring], point)).length !== 1;
}

/** The rings no other ring holds: the parts, each a hole in the world. */
const PARTS = WASH_RINGS.filter((ring) => !WASH_RINGS.some((other) => other !== ring && insideRings([other], ring[0])));
/** The rings inside a part: ground no radar reaches though radars ring it. */
const ISLANDS = WASH_RINGS.filter((ring) => !PARTS.includes(ring));

const at = (lat: number, lon: number) => fromLonLat([lon, lat]);

test("the no-radar wash has a hole for the continent and one for Ireland, touching nowhere", () => {
  assert.equal(PARTS.length, 2);
  const munich = at(48.14, 11.58);
  const dublin = at(53.35, -6.26);
  assert.deepEqual(PARTS.map((ring) => insideRings([ring], munich)).sort(), [false, true]);
  assert.deepEqual(PARTS.map((ring) => insideRings([ring], dublin)).sort(), [false, true]);
  // Disjoint: no point of either lies inside the other.
  const [one, other] = PARTS;
  assert.ok(!one.some((point) => insideRings([other], point)));
  assert.ok(!other.some((point) => insideRings([one], point)));
});

/** The ground no radar reaches though radars ring it (the backend's known holes): a point inside each. */
const KNOWN_ISLANDS = {
  "the Niedere Tauern": at(47.29, 13.93),
  "the northern Apennines south-west of Bologna": at(44.26, 11.02),
  "the Baltic between Gotland, Latvia and Estonia": at(57.68, 20.30),
  "the fells west of Arjeplog": at(66.16, 16.75),
};

test("the wash rings the islands no radar reaches, and only those", () => {
  assert.equal(ISLANDS.length, Object.keys(KNOWN_ISLANDS).length);
  for (const [name, point] of Object.entries(KNOWN_ISLANDS)) {
    assert.equal(ISLANDS.filter((ring) => insideRings([ring], point)).length, 1, name);
    assert.ok(washed(point), `${name} is not washed`);
  }
});

test("the wash is open over every network's radars and drawn where none reaches", () => {
  const open = {
    Munich: at(48.14, 11.58), Dublin: at(53.35, -6.26), Belfast: at(54.60, -5.93), Amsterdam: at(52.37, 4.90),
    Copenhagen: at(55.68, 12.57), Helsinki: at(60.17, 24.94), Tromsø: at(69.65, 18.96), Riga: at(56.95, 24.11),
    Zagreb: at(45.81, 15.98), Kiruna: at(67.86, 20.23),
  };
  for (const [name, point] of Object.entries(open)) assert.ok(!washed(point), `${name} is washed`);
  const none = {
    Manchester: at(53.48, -2.24), Birmingham: at(52.49, -1.89), Glasgow: at(55.86, -4.25),
    Bucharest: at(44.43, 26.10), Madrid: at(40.42, -3.70),
  };
  for (const [name, point] of Object.entries(none)) assert.ok(washed(point), `${name} is not washed`);
});

test("every network draws where the wash is open", () => {
  for (const [i, point] of GRID.entries()) {
    if (!DRAWN[i].length || !washed(point)) continue;
    assert.ok(nearEdge(WASH_RINGS, point, SIMPLIFIED_M), `washed out at ${point}`);
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
  for (const [i, point] of GRID.entries()) {
    if (!outline.intersectsCoordinate(point)) continue;
    for (const network of DRAWN[i]) {
      const holed = insideRings(network.hole, point) || nearEdge(network.hole, point, SIMPLIFIED_M);
      assert.ok(holed, `${network.code} draws over DWD at ${point}`);
    }
  }
});
