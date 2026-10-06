import assert from "node:assert/strict";
import test from "node:test";
import type { TestContext } from "node:test";
import { crc32, deflateSync } from "node:zlib";
import { blankTile, fillTemplate, present } from "../../src/layers/indexedTiles.ts";
import { frameOnStep, loadValueTile, templateOf } from "../../src/layers/valueTiles.ts";
import { sourceTile } from "../../src/lib/tileIndex.ts";
import { maskPath, tileExtent } from "../../src/layers/tileMask.ts";

/** The fixture tileIndex.test.ts uses: zoom 5 a 2x2 rectangle from (16, 20), TMS y. */
const index = {
  "4": { x: 8, y: 10, w: 1, h: 1, bits: "gA==" },
  "5": { x: 16, y: 20, w: 2, h: 2, bits: "kA==" },
};

const TEMPLATE = "https://tiles.example/meteoradar/v/{z}/{x}/{-y}.png";

/** A page's worth of globals: a canvas for the blank, and fetch. */
function browser(t: TestContext, answer: (url: string) => Response) {
  const fetched: string[] = [];
  const saved = { document: globalThis.document, fetch: globalThis.fetch };
  Object.assign(globalThis, {
    document: { createElement: () => ({ width: 0, height: 0 }) },
    fetch: async (input: RequestInfo | URL) => {
      fetched.push(String(input));
      return answer(String(input));
    },
  });
  t.after(() => Object.assign(globalThis, saved));
  return { fetched };
}

/** A tile as the backend writes it: an 8-bit greyscale PNG, unfiltered rows. */
function valueTile(values: Uint8Array, size: number): Uint8Array {
  const chunk = (type: string, body: Uint8Array) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(body.length);
    head.write(type, 4, "latin1");
    const tail = Buffer.alloc(4);
    tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])));
    return Buffer.concat([head, body, tail]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size);
  header.writeUInt32BE(size, 4);
  header.set([8, 0, 0, 0, 0], 8);
  const rows = new Uint8Array(size * (size + 1));
  for (let y = 0; y < size; y++) rows.set(values.subarray(y * size, (y + 1) * size), y * (size + 1) + 1);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(rows)),
    chunk("IEND", new Uint8Array(0)),
  ]);
}

test("the template is filled with the frame's own TMS row", () => {
  // XYZ row 11 at zoom 5 is TMS row 20: the first row of the fixture's rectangle.
  assert.equal(fillTemplate(TEMPLATE, 5, 16, 11), "https://tiles.example/meteoradar/v/5/16/20.png");
  assert.equal(present(index, 5, 16, 11), true);
  assert.equal(present(index, 5, 17, 11), false);
});

test("past a frame's depth the tile comes out of its ancestor's", () => {
  assert.deepEqual(sourceTile(index, 6, 33, 22), { z: 5, x: 16, y: 11, scale: 2, column: 1, row: 0 });
});

test("a tile the frame does not have is a blank, and nothing is fetched", async (t) => {
  const { fetched } = browser(t, () => new Response("", { status: 500 }));
  const tile = await loadValueTile(TEMPLATE, index, 5, 17, 11, [], null);
  assert.equal(tile, blankTile());
  assert.deepEqual(fetched, []);
});

test("a tile the frame has is fetched and decoded to exactly its bytes", async (t) => {
  // Every class byte and every RVP6 one: a value one off is another class.
  const values = Uint8Array.from({ length: 512 * 512 }, (_, i) => (i * 7) & 255);
  const { fetched } = browser(t, () => new Response(valueTile(values, 512)));
  const tile = await loadValueTile(TEMPLATE, index, 5, 16, 11, [], null);
  assert.deepEqual(fetched, ["https://tiles.example/meteoradar/v/5/16/20.png"]);
  assert.deepEqual(tile, values);
});

test("a tile of another size than the source's fails rather than being drawn askew", async (t) => {
  browser(t, () => new Response(valueTile(new Uint8Array(256 * 256), 256)));
  await assert.rejects(loadValueTile(TEMPLATE, index, 5, 16, 11, [], null), /256 px tile where 512/);
});

test("a 404 is a blank, not a failure", async (t) => {
  browser(t, () => new Response("", { status: 404 }));
  assert.equal(await loadValueTile(TEMPLATE, null, 5, 16, 11, [], null), blankTile());
});

test("any other refusal fails the tile, to be asked for again", async (t) => {
  browser(t, () => new Response("", { status: 503 }));
  await assert.rejects(loadValueTile(TEMPLATE, null, 5, 16, 11, [], null), /503/);
});

test("a tile outside the ground a network keeps to is a blank, and nothing is fetched", async (t) => {
  const { fetched } = browser(t, () => new Response(valueTile(new Uint8Array(512 * 512), 512)));
  // A square the size of tile 5/0/0, far from tile 5/16/11.
  const [west, south, east, north] = tileExtent(5, 0, 0);
  const keep = maskPath([[[west, south], [east, south], [east, north], [west, north]]]);
  assert.equal(await loadValueTile(TEMPLATE, index, 5, 16, 11, [], keep), blankTile());
  assert.deepEqual(fetched, []);
});

const DMAX = "/tiles/meteoradar/dmax-1/{z}/{x}/{-y}.png";

test("a frame on its own step is named by its tiles", () => {
  assert.equal(frameOnStep(DMAX, 1_000_200, 1_000_200), DMAX);
  assert.equal(frameOnStep(DMAX, null, 1_000_200), DMAX, "a frame with no scan time is taken as its step's");
});

test("a frame standing on another step is named apart, so each step keeps its own holes", () => {
  // DMAX's newest, a cycle behind, on the live step: holed for every network
  // there, and for only those with a composite on its own step.
  const live = frameOnStep(DMAX, 1_000_200, 1_000_500);
  assert.notEqual(live, frameOnStep(DMAX, 1_000_200, 1_000_200));
  assert.equal(templateOf(live), DMAX, "the same tiles are fetched");
  assert.equal(templateOf(DMAX), DMAX);
});
