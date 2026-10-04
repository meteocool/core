import assert from "node:assert/strict";
import test from "node:test";
import type { TestContext } from "node:test";
import { blankTile, fillTemplate, present } from "../../src/layers/indexedTiles.ts";
import { loadValueTile } from "../../src/layers/valueTiles.ts";
import { sourceTile } from "../../src/lib/tileIndex.ts";

/** The fixture tileIndex.test.ts uses: zoom 5 a 2x2 rectangle from (16, 20), TMS y. */
const index = {
  "4": { x: 8, y: 10, w: 1, h: 1, bits: "gA==" },
  "5": { x: 16, y: 20, w: 2, h: 2, bits: "kA==" },
};

const TEMPLATE = "https://tiles.example/meteoradar/v/{z}/{x}/{-y}.png";

/** A page's worth of globals: a canvas for the blank, fetch and the decoder. */
function browser(t: TestContext, answer: (url: string) => Response) {
  const fetched: string[] = [];
  const decoded: (ImageBitmapOptions | undefined)[] = [];
  const saved = {
    document: globalThis.document,
    fetch: globalThis.fetch,
    createImageBitmap: globalThis.createImageBitmap,
  };
  Object.assign(globalThis, {
    document: { createElement: () => ({ width: 0, height: 0 }) },
    fetch: async (input: RequestInfo | URL) => {
      fetched.push(String(input));
      return answer(String(input));
    },
    createImageBitmap: async (_blob: Blob, options?: ImageBitmapOptions) => {
      decoded.push(options);
      return { width: 512, height: 512, close() {} };
    },
  });
  t.after(() => Object.assign(globalThis, saved));
  return { fetched, decoded };
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
  const tile = await loadValueTile(TEMPLATE, index, 5, 17, 11, []);
  assert.equal(tile, blankTile());
  assert.deepEqual(fetched, []);
});

test("a tile the frame has is fetched and decoded as its bytes", async (t) => {
  const { fetched, decoded } = browser(t, () => new Response(new Uint8Array([137, 80, 78, 71])));
  const tile = await loadValueTile(TEMPLATE, index, 5, 16, 11, []);
  assert.deepEqual(fetched, ["https://tiles.example/meteoradar/v/5/16/20.png"]);
  // No colour management and no premultiplying: a value one off is another class.
  assert.deepEqual(decoded, [{ colorSpaceConversion: "none", premultiplyAlpha: "none" }]);
  assert.equal((tile as ImageBitmap).width, 512);
});

test("a 404 is a blank, not a failure", async (t) => {
  browser(t, () => new Response("", { status: 404 }));
  assert.equal(await loadValueTile(TEMPLATE, null, 5, 16, 11, []), blankTile());
});

test("any other refusal fails the tile, to be asked for again", async (t) => {
  browser(t, () => new Response("", { status: 503 }));
  await assert.rejects(loadValueTile(TEMPLATE, null, 5, 16, 11, []), /503/);
});
