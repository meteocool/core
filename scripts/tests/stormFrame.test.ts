import assert from "node:assert/strict";
import test from "node:test";
import { framingCamera, locateStorm, OPEN_FILL, WORLD_METRES_AT_ZOOM_0 } from "../../src/lib/stormFrame.ts";
import type { CutawayHeader } from "../../src/lib/cellCutaway.ts";

/** A box shaped like the ones the backend builds: 40 by 40 by 16 km at 250 m and 500 m. */
const header: CutawayHeader = {
  code: "G1445718707",
  reference_time: "2026-10-01T11:00:00Z",
  lon: 7.0689,
  lat: 54.5708,
  nx: 160,
  ny: 160,
  nz: 32,
  step_m: [250, 250, 500],
  origin_m: [-20000, -20000, 0],
  dbz_floor: -32,
  dbz_scale: 2,
  sites: ["deasb"],
  coverage: 0.87,
  tier: 2,
};

/** One voxel's reflectivity, in kilometres from the box's middle and up from the ground. */
type Field = (eastKm: number, northKm: number, upKm: number) => number | null;

/** Fill a box from `field`; null is no echo, and `unmeasured` is where no beam went. */
function box(field: Field, unmeasured: Field = () => null): Uint8Array {
  const { nx, ny, nz, step_m: step } = header;
  const voxels = new Uint8Array(nx * ny * nz * 2);
  for (let z = 0; z < nz; z += 1) {
    for (let y = 0; y < ny; y += 1) {
      for (let x = 0; x < nx; x += 1) {
        const at = ((z * ny + y) * nx + x) * 2;
        const east = ((x + 0.5) * step[0]) / 1000 - 20;
        const north = ((y + 0.5) * step[1]) / 1000 - 20;
        const up = ((z + 0.5) * step[2]) / 1000;
        const blind = unmeasured(east, north, up);
        if (blind !== null) {
          voxels[at] = (blind - header.dbz_floor) * header.dbz_scale;
          continue;
        }
        const dbz = field(east, north, up);
        voxels[at] = dbz === null ? 0 : Math.max(0, (dbz - header.dbz_floor) * header.dbz_scale);
        voxels[at + 1] = 200;
      }
    }
  }
  return voxels;
}

/** A round storm: `dbz` within `radiusKm` of its middle, up to `topKm`. */
const disc = (eastKm: number, northKm: number, radiusKm: number, topKm: number, dbz: number): Field => (
  (east, north, up) => (Math.hypot(east - eastKm, north - northKm) <= radiusKm && up <= topKm ? dbz : null)
);

/** The first of the fields that has echo here. */
const layered = (...fields: Field[]): Field => (east, north, up) => {
  for (const field of fields) {
    const dbz = field(east, north, up);
    if (dbz !== null) return dbz;
  }
  return null;
};

/**
 * Weak shower echo across the whole box, as in the German Bight volumes once
 * the list held every shower: 21 to 24 dBZ, low down, everywhere.
 */
const showers: Field = (east, north, up) => (up <= 3 ? 21 + ((Math.floor(east) + Math.floor(north)) & 3) : null);

const near = (actual: number, expected: number, within: number) => (
  assert.ok(Math.abs(actual - expected) <= within, `${actual} is not within ${within} of ${expected}`)
);

/** A phone held upright, with the controls along the top and the sheet at rest. */
const phone = { width: 375, height: 812, top: 64, bottom: 812 * (1 - 0.32) };

test("a shower in a field of weak echo is framed on the shower, not on its box", () => {
  // The regression: everything above 20 dBZ spans the box, so a camera framed
  // on all of it stood 40 km back and the storm was a speck.
  const storm = locateStorm(header, box(layered(disc(0, 0, 5, 7, 29), showers)));
  near(storm.halfKm[0], 5, 0.5);
  near(storm.halfKm[1], 5, 0.5);
  near(storm.centreKm[0], 0, 0.5);
  near(storm.centreKm[1], 0, 0.5);
});

test("a neighbouring storm in the same box is left out of the frame", () => {
  const storm = locateStorm(header, box(layered(disc(0, 0, 4, 7, 40), disc(13, 9, 5, 10, 50))));
  near(storm.halfKm[0], 4, 0.5);
  near(storm.centreKm[0], 0, 0.5);
});

test("a storm whose centroid falls outside its own echo is still the one found", () => {
  // A crescent: the box is centred on the centroid, which is in the gap.
  const crescent: Field = (east, north, up) => {
    const r = Math.hypot(east, north);
    return r >= 2 && r <= 6 && east > -2 && up <= 8 ? 35 : null;
  };
  const storm = locateStorm(header, box(layered(crescent, disc(-15, -15, 3, 6, 45))));
  near(storm.centreKm[0], 2, 0.5);
  near(storm.halfKm[1], 6, 0.5);
});

test("the storm's height is how high its echo reaches over it", () => {
  const storm = locateStorm(header, box(layered(disc(0, 0, 5, 9, 45), showers)));
  // From the ground to 9 km, measured from the middle of a 16 km box.
  near(storm.centreKm[2] + storm.halfKm[2], 9 - 8, 0.5);
});

test("a storm is measured above the threshold its list entry gives", () => {
  const cored = layered(disc(0, 0, 3, 8, 38), disc(0, 0, 9, 4, 27));
  near(locateStorm(header, box(cored)).halfKm[0], 9, 0.5);
  near(locateStorm(header, box(cored), 30).halfKm[0], 4, 0.5);
});

test("where no beam went does not count, whatever the byte says", () => {
  const blind: Field = (east) => (east > 10 ? 60 : null);
  const storm = locateStorm(header, box(disc(0, 0, 5, 7, 40), blind));
  near(storm.halfKm[0], 5, 0.5);
});

test("a shower weaker than its threshold is framed on everything visible", () => {
  const storm = locateStorm(header, box(disc(6, 0, 5, 4, 22)));
  near(storm.centreKm[0], 6, 0.5);
  near(storm.halfKm[0], 5, 0.5);
});

test("an empty box is framed whole", () => {
  const storm = locateStorm(header, box(() => null));
  assert.deepEqual(storm.centreKm, [0, 0, 0]);
  assert.deepEqual(storm.halfKm, [20, 20, 8]);
});

test("an opened storm's cut spans the phone's width", () => {
  const storm = locateStorm(header, box(layered(disc(0, 0, 5, 7, 29), showers)));
  const camera = framingCamera({ header, extentM: [40000, 40000, 16000], ...storm }, 90, phone, 76, 13);
  // Undo the zoom at the storm's foot: the ground there spans the storm and
  // the margin, which is 10 km over OPEN_FILL. The old framing, on the whole
  // box, stood back to zoom 9 and drew this storm a quarter as wide.
  const tilt = (76 * Math.PI) / 180;
  const focal = phone.height / 2 / Math.tan((36.8699 * Math.PI) / 360);
  const above = Math.atan(-camera.offsetY / focal);
  const atMiddle = (WORLD_METRES_AT_ZOOM_0 * Math.cos((header.lat * Math.PI) / 180)) / 2 ** camera.zoom;
  const atFoot = (atMiddle * Math.cos(tilt)) / Math.cos(tilt + above);
  near((atFoot * phone.width) / 1000, (2 * storm.halfKm[0]) / OPEN_FILL, 0.5);
  const whole = framingCamera(
    { header, extentM: [40000, 40000, 16000], centreKm: [0, 0, 0], halfKm: [20, 20, 8] }, 90, phone, 76, 13,
  );
  assert.ok(camera.zoom - whole.zoom > 1.5, `zoom ${camera.zoom} stands back almost as far as the box's ${whole.zoom}`);
});

test("the storm stands between the controls and the sheet", () => {
  const storm = locateStorm(header, box(disc(0, 0, 5, 12, 50)));
  const camera = framingCamera({ header, extentM: [40000, 40000, 16000], ...storm }, 0, phone, 76, 13);
  const foot = phone.height / 2 + camera.offsetY;
  assert.ok(foot > phone.top && foot < phone.bottom, `the storm's foot is at ${foot}px`);
});

test("a tiny shower is not framed past the map's closest zoom", () => {
  const camera = framingCamera(
    { header, extentM: [40000, 40000, 16000], centreKm: [0, 0, -7], halfKm: [0.1, 0.1, 0.1] },
    0, phone, 76, 13,
  );
  assert.equal(camera.zoom, 13);
});

test("the camera is centred on the storm, not on the box", () => {
  const storm = locateStorm(header, box(disc(8, -6, 4, 6, 40)));
  const camera = framingCamera({ header, extentM: [40000, 40000, 16000], ...storm }, 0, phone, 76, 13);
  near((camera.lon - header.lon) * 111.32 * Math.cos((header.lat * Math.PI) / 180), 8, 0.3);
  near((camera.lat - header.lat) * 111.32, -6, 0.3);
});
