import assert from "node:assert/strict";
import test from "node:test";
import { closeRing, scaleRing } from "../../src/lib/cellGeometry.ts";
import { cellVolume, exponentForMean, profile, shoelace } from "../../src/lib/cellVolume.ts";
import { volumeCollection, footprintCollection } from "../../src/lib/cellExtrusions.ts";
import type { CellCurrent } from "../../src/api/index.ts";

/**
 * The model that turns three numbers a threshold into a solid.
 *
 * Almost nothing here fails loudly. A profile whose mean does not match the
 * reported volume still draws a plausible storm, a core placed at the wrong
 * height still looks like a core, and rings that overlap still render -- they
 * just flicker on someone else's GPU. So the properties are asserted directly.
 */

/** Shoelace area of a ring, in squared degrees; only ratios matter here. */
const area = (ring: number[][]): number => {
  let sum = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
};

const SQUARE: [number, number][] = [[9, 51], [11, 51], [11, 53], [9, 53]];
const CENTRE: [number, number] = [10, 52];

/** One cell carrying a real 22-digit KONRAD3D code, the value that overflowed. */
const CELL = {
  code: "2026092012050010000000",
  lon: 10,
  lat: 52,
  severity: 2,
  echo_bottom_m: 1200,
  polygon: SQUARE.map(([lon, lat]) => [lon, lat]),
  structure: [
    { dbz: 30, area_km2: 95, top_m: 9200, volume_km3: 400 },
    { dbz: 45, area_km2: 30, top_m: 7600, volume_km3: 100 },
    { dbz: 55, area_km2: 4, top_m: 6100, volume_km3: 12 },
  ],
} as unknown as CellCurrent;

/* ---- the geometry it is built on --------------------------------------- */

test("a shell scaled to a quarter of the area is half the width", () => {
  const scaled = scaleRing(SQUARE, CENTRE, 0.25);

  assert.ok(Math.abs(area(scaled) / area(SQUARE) - 0.25) < 1e-9);
  assert.deepEqual(scaled[0], [9.5, 51.5]);
});

test("scaling to the full area leaves the ring alone", () => {
  assert.deepEqual(scaleRing(SQUARE, CENTRE, 1), SQUARE);
});

test("a threshold with no area collapses rather than inverting", () => {
  const scaled = scaleRing(SQUARE, CENTRE, 0);

  assert.ok(scaled.every((p) => p[0] === CENTRE[0] && p[1] === CENTRE[1]));
});

test("rings are closed, because GeoJSON requires first === last", () => {
  const closed = closeRing(SQUARE);

  assert.equal(closed.length, SQUARE.length + 1);
  assert.deepEqual(closed[0], closed[closed.length - 1]);
});

test("a ring that already closes is not closed twice", () => {
  const already: [number, number][] = [...SQUARE, SQUARE[0]];

  assert.equal(closeRing(already).length, already.length);
});

/* ---- the profile, which is where the volume enters --------------------- */

/**
 * The exponent is solved for, so the one thing worth checking is that the
 * answer round-trips: a body shaped by it really does average the fill its
 * reported volume asks for. Get this wrong and every storm still draws, just
 * consistently too fat or too thin -- which reads as the radar being wrong.
 */
test("the solved exponent gives a profile of the mean it was asked for", () => {
  [0.12, 0.25, 0.4, 0.55, 0.7, 0.9].forEach((wanted) => {
    const exponent = exponentForMean(wanted);
    let sum = 0;
    const n = 400;
    for (let k = 0; k < n; k += 1) sum += profile((k + 0.5) / n, exponent);
    assert.ok(
      Math.abs(sum / n - wanted) < 0.02,
      `mean ${sum / n} for wanted ${wanted}`,
    );
  });
});

test("a fuller body is a less tapered one", () => {
  assert.ok(exponentForMean(0.3) > exponentForMean(0.6));
});

test("the profile never widens with height", () => {
  [0.5, 1, 3].forEach((exponent) => {
    for (let k = 1; k <= 40; k += 1) {
      assert.ok(profile(k / 40, exponent) <= profile((k - 1) / 40, exponent) + 1e-12);
    }
  });
});

/* ---- the model --------------------------------------------------------- */

test("a storm with volume to spare stands on its echo base", () => {
  const model = cellVolume(CELL)!;

  assert.equal(model.base, 1200);
  assert.equal(model.top, 9200);
});

/**
 * The case the extruded-shell model could not express: reflectivity aloft with
 * clear air underneath. It is not a rendering nicety -- a cloud holding its
 * water and a storm already raining it out look identical from above, and the
 * difference is the whole reason for drawing this in three dimensions.
 */
test("a body too thin for its column hangs under its own top", () => {
  const wispy = {
    ...CELL,
    structure: [
      { dbz: 30, area_km2: 95, top_m: 9200, volume_km3: 400 },
      // 2 km3 over 40 km2 is 50 m of echo: nothing like enough to fill the
      // eight kilometres between the echo base and this threshold's top.
      { dbz: 45, area_km2: 40, top_m: 8000, volume_km3: 2 },
    ],
  } as unknown as CellCurrent;

  const rooted = cellVolume(CELL)!;
  const lifted = cellVolume(wispy)!;
  const lowest = (model: ReturnType<typeof cellVolume>) => Math.min(
    ...model!.bands.flatMap((band) => band.rings.map(() => band.base)),
  );

  // Both cells share an echo base, so the envelope still starts there...
  assert.equal(lifted.base, rooted.base);
  // ...but the thin threshold is nowhere near it.
  const bandsWith45 = lifted.bands.filter((band) => band.rings.some((r) => r.dbz === 45));
  assert.ok(bandsWith45.length > 0, "the thin threshold is still drawn");
  assert.ok(
    Math.min(...bandsWith45.map((band) => band.base)) > lowest(lifted) + 3000,
    "and it floats at least three kilometres clear of the base",
  );
});

test("a cell with no structure is not a model", () => {
  assert.equal(cellVolume({ ...CELL, structure: [] } as unknown as CellCurrent), null);
});

/**
 * Every piece of the model has to be disjoint from every other one, and no two
 * faces may share a plane. That is the whole reason it is built as bands of
 * rings rather than nested solids: coplanar walls are what made the previous
 * model flicker, and an outer solid drawn over an inner one is what made the
 * cores disappear.
 */
test("bands stack without overlapping", () => {
  const { bands } = cellVolume(CELL)!;

  bands.forEach((band, index) => {
    assert.ok(band.top > band.base);
    if (index) assert.ok(band.base >= bands[index - 1].top - 1e-6);
  });
});

test("the rings of a band never touch, so no two walls are coplanar", () => {
  const { bands } = cellVolume(CELL)!;

  bands.forEach((band) => {
    band.rings.forEach((ring, index) => {
      assert.ok(ring.outer > ring.inner, "a ring encloses something");
      const next = band.rings[index + 1];
      if (next) assert.ok(ring.inner > next.outer, "with clearance to the one inside");
    });
  });
});

test("only the innermost ring of a band is opaque", () => {
  const { bands } = cellVolume(CELL)!;

  bands.forEach((band) => {
    band.rings.forEach((ring, index) => {
      const innermost = index === band.rings.length - 1;
      assert.equal(ring.alpha === 1, innermost);
      assert.equal(ring.inner === 0, innermost);
    });
  });
});

test("a ring is never stronger than the one outside it", () => {
  cellVolume(CELL)!.bands.forEach((band) => {
    band.rings.forEach((ring, index) => {
      const next = band.rings[index + 1];
      if (next) assert.ok(next.dbz >= ring.dbz);
    });
  });
});

/**
 * A centroid outside its own outline sends every inner ring off the edge of
 * the storm, and at the limit collapses the model into a sliver pointing at
 * empty air. The fields are independent, so nothing but this stops it.
 */
test("a centroid that has drifted off its outline does not drag the model with it", () => {
  const adrift = { ...CELL, lon: 40, lat: 12 } as unknown as CellCurrent;
  const model = cellVolume(adrift)!;

  assert.ok(model.centre[0] > 9 && model.centre[0] < 11);
  assert.ok(model.centre[1] > 51 && model.centre[1] < 53);
});

/* ---- and the GeoJSON it is handed to MapLibre as ----------------------- */

/**
 * MapLibre 6 encodes a GeoJSON source's tiles as MVT inside its worker, and an
 * MVT feature id is a uint64 varint -- so whatever sits in `id` is coerced to a
 * number. A KONRAD3D code is 22 digits, around 2e21, well past the 10-byte
 * ceiling: every tile of the source throws, the source is marked errored, and
 * the map comes up with a basemap and no storms on it. It surfaces only as an
 * `error` event, so nothing reaches the console and nothing looks wrong.
 */
test("no feature carries an id a uint64 varint cannot hold", () => {
  const rings = volumeCollection([CELL]).features;
  const feet = footprintCollection([CELL]).features;

  assert.ok(rings.length > 0);
  assert.ok(feet.length > 0);
  [...rings, ...feet].forEach((feature) => {
    assert.equal(feature.id, undefined);
    assert.equal(feature.properties.code, CELL.code);
  });
});

test("a ring's hole is wound against its exterior, or it fills solid", () => {
  const holed = volumeCollection([CELL]).features
    .filter((feature) => feature.geometry.coordinates.length > 1);

  assert.ok(holed.length > 0, "the model has rings with holes in them");
  holed.forEach((feature) => {
    const [outer, inner] = feature.geometry.coordinates as [number, number][][];
    assert.ok(shoelace(outer) > 0, "exterior counter-clockwise");
    assert.ok(shoelace(inner) < 0, "hole clockwise");
    assert.ok(area(inner) < area(outer));
  });
});

test("every drawn ring has somewhere to stand", () => {
  volumeCollection([CELL]).features.forEach((feature) => {
    const { base, top } = feature.properties;
    assert.ok(top > base);
    assert.ok(base >= 0);
  });
});

/* ---- measured outlines, when the API sends them ------------------------- */

/**
 * Two 45 dBZ cores well apart, which is the case a scaled outline cannot
 * express at all: shrinking the cell's one polygon puts a single lozenge
 * between them, where the radar saw two.
 *
 * 45 rather than 55 because that is the threshold this cell's model actually
 * makes a core of -- 55 covers 4 km2 of a 95 km2 storm, under the share a band
 * needs before it is worth drawing as a column rather than left inside the
 * glass.
 */
const WEST: [number, number][] = [[9.2, 51.2], [9.6, 51.2], [9.6, 51.6], [9.2, 51.6]];
const EAST: [number, number][] = [[10.4, 52.4], [10.8, 52.4], [10.8, 52.8], [10.4, 52.8]];
const CORE_DBZ = 45;

const MEASURED = {
  ...CELL,
  structure: [
    { dbz: 30, area_km2: 95, top_m: 9200, volume_km3: 400 },
    { dbz: 45, area_km2: 30, top_m: 7600, volume_km3: 100, rings: [WEST, EAST] },
    { dbz: 55, area_km2: 4, top_m: 6100, volume_km3: 12 },
  ],
} as unknown as CellCurrent;

const cores = (cell: CellCurrent) =>
  volumeCollection([cell]).features
    .filter((f) => f.properties.tier === 0 && f.properties.dbz === CORE_DBZ);

test("a measured threshold is drawn as the separate cores it is", () => {
  const before = cores(CELL);
  const after = cores(MEASURED);

  // Same bands, but each one now carries two solids instead of one.
  assert.ok(before.length > 0);
  assert.equal(after.length, before.length * 2);
});

test("the measured cores stay where they were measured", () => {
  const centres = cores(MEASURED).map((f) => {
    const ring = f.geometry.coordinates[0];
    return ring.reduce((sum, [lon]) => sum + lon, 0) / ring.length;
  });

  // One around 9.4, one around 10.6 -- not one in the middle at 10.
  assert.ok(Math.min(...centres) < 9.8);
  assert.ok(Math.max(...centres) > 10.2);
});

test("a measured core is still sized by the volume profile", () => {
  // The shape is measured at the ground; the area at each height is not.
  const byBand = new Map<number, number>();
  for (const f of cores(MEASURED)) {
    const base = f.properties.base;
    byBand.set(base, (byBand.get(base) ?? 0) + area(f.geometry.coordinates[0]));
  }
  const areas = [...byBand.entries()].sort((a, b) => a[0] - b[0]).map(([, value]) => value);

  assert.ok(areas.length > 1);
  assert.ok(areas.every((value, i) => i === 0 || value <= areas[i - 1] + 1e-12));
});

test("the glass around a measured core is cut to that core's shape", () => {
  const holed = volumeCollection([MEASURED]).features
    .filter((f) => f.properties.tier === 1 && f.geometry.coordinates.length > 1);

  assert.ok(holed.length > 0);
  // Two holes, one per core, rather than the single concentric one.
  assert.ok(holed.some((f) => f.geometry.coordinates.length === 3));
});

test("a null ring list is the same as none at all", () => {
  const explicit = {
    ...CELL,
    structure: (CELL.structure ?? []).map((layer) => ({ ...layer, rings: null })),
  } as unknown as CellCurrent;

  assert.deepEqual(volumeCollection([explicit]), volumeCollection([CELL]));
});

test("rings too short to be polygons are ignored rather than drawn", () => {
  const broken = {
    ...CELL,
    structure: [
      { dbz: 30, area_km2: 95, top_m: 9200, volume_km3: 400 },
      { dbz: 45, area_km2: 30, top_m: 7600, volume_km3: 100, rings: [[[9, 51], [10, 52]]] },
    ],
  } as unknown as CellCurrent;

  assert.doesNotThrow(() => volumeCollection([broken]));
  assert.deepEqual(cores(broken as CellCurrent).length > 0, true);
});
