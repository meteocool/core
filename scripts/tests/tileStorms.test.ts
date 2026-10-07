import assert from "node:assert/strict";
import test from "node:test";
import { stormsOf, tileEdges, type StormTile } from "../../src/lib/tileStorms.ts";
import type { CutawayHeader } from "../../src/lib/cellCutaway.ts";

/**
 * A tile of 4 by 4 voxels inside an apron of one, two levels high, with
 * echo of `dbz` in the columns `echo` says yes to, or of what it says: x
 * east, row north.
 */
function tile(
  z: number, x: number, y: number, echo: (column: number, row: number) => boolean | number, dbz = 40,
): StormTile {
  const [nx, ny, nz] = [6, 6, 2];
  const header = {
    nx, ny, nz, tile: [z, x, y], apron: [1, 1, 0], dbz_floor: -32, dbz_scale: 2, network: "de",
  } as unknown as CutawayHeader;
  const voxels = new Uint8Array(nx * ny * nz * 2);
  for (let row = 1; row < ny - 1; row += 1) {
    for (let column = 1; column < nx - 1; column += 1) {
      const found = echo(column - 1, row - 1);
      if (found === false) continue;
      // Only the upper level, as an anvil: the column's strongest is what counts.
      const at = ((1 * ny + row) * nx + column) * 2;
      voxels[at] = ((found === true ? dbz : found) + 32) * 2;
      voxels[at + 1] = 255;
    }
  }
  return { network: "de", tile: [z, x, y], system: null, edges: tileEdges({ header, voxels }) };
}

const everywhere = () => true;

test("a tile's edges run in map order, north to south down its sides", () => {
  // Echo in the north-west corner only.
  const { edges } = tile(10, 0, 0, (column, row) => column === 0 && row === 3);
  assert.deepEqual([...edges!.north], [1, 0, 0, 0]);
  assert.deepEqual([...edges!.west], [1, 0, 0, 0]);
  assert.deepEqual([...edges!.south], [0, 0, 0, 0]);
  assert.deepEqual([...edges!.east], [0, 0, 0, 0]);
});

test("tiles whose echo runs across a seam are one storm", () => {
  // The old scan's tiles carry no system: each peeled to its own floor.
  const storms = stormsOf([
    ["west", tile(10, 100, 200, everywhere)],
    ["east", tile(10, 101, 200, everywhere)],
    ["south", tile(10, 101, 201, everywhere)],
  ]);
  assert.equal(new Set(storms.values()).size, 1);
});

test("tiles that only abut, with no echo at the seam, stay apart", () => {
  const storms = stormsOf([
    ["west", tile(10, 100, 200, (column) => column < 2)],
    ["east", tile(10, 101, 200, everywhere)],
    // Too weak to join anything: below the seed.
    ["weak", tile(10, 102, 200, everywhere, 20)],
  ]);
  assert.equal(new Set(storms.values()).size, 3);
});

test("a tile joins by its own storm, not by another one in it", () => {
  // Two storms side by side in the middle tile, its peak in the western one:
  // along a front, every storm would otherwise be one.
  const split = (column: number) => (column === 0 ? 50 : column === 3 ? 30 : false);
  const storms = stormsOf([
    ["west", tile(10, 100, 200, everywhere)],
    ["middle", tile(10, 101, 200, split)],
    ["east", tile(10, 102, 200, everywhere)],
  ]);
  assert.equal(storms.get("middle"), storms.get("west"));
  assert.notEqual(storms.get("east"), storms.get("west"));
});

test("diagonal neighbours do not touch", () => {
  const storms = stormsOf([["a", tile(10, 100, 200, everywhere)], ["b", tile(10, 101, 201, everywhere)]]);
  assert.notEqual(storms.get("a"), storms.get("b"));
});

test("a coarse tile joins the finer ones along its side", () => {
  // Zoom 9 (0, 0) spans zoom 10 x 0..1, y 0..1; its east side meets x 2.
  const storms = stormsOf([
    ["coarse", tile(9, 0, 0, everywhere)],
    ["north", tile(10, 2, 0, everywhere)],
    ["south", tile(10, 2, 1, everywhere)],
    ["far", tile(10, 2, 2, everywhere)],
  ]);
  assert.equal(storms.get("north"), storms.get("coarse"));
  assert.equal(storms.get("south"), storms.get("coarse"));
  // Past the coarse tile's corner, joined through `south`.
  assert.equal(storms.get("far"), storms.get("coarse"));
  const cornered = stormsOf([["coarse", tile(9, 0, 0, everywhere)], ["far", tile(10, 2, 2, everywhere)]]);
  assert.notEqual(cornered.get("far"), cornered.get("coarse"));
});

test("the list's own storms keep their names and are never joined to each other", () => {
  const named = (system: string, x: number) => ({ ...tile(10, x, 200, everywhere), system });
  const storms = stormsOf([
    ["a", named("T1", 100)],
    ["b", named("T2", 101)],
    ["c", tile(10, 102, 200, everywhere)],
    ["d", named("T1", 105)],
  ]);
  assert.deepEqual(Object.fromEntries(storms), { a: "T1", b: "T2", c: "T2", d: "T1" });
});

test("other networks and boxes from before tiles join nothing", () => {
  const storms = stormsOf([
    ["de", tile(10, 100, 200, everywhere)],
    ["nl", { ...tile(10, 101, 200, everywhere), network: "nl" }],
    ["box", { network: "de", tile: null, system: null, edges: null }],
  ]);
  assert.equal(new Set(storms.values()).size, 3);
});
