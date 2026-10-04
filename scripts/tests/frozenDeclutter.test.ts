import assert from "node:assert/strict";
import test from "node:test";
import Feature from "ol/Feature.js";
import Point from "ol/geom/Point.js";
import VectorLayer from "ol/layer/Vector.js";
import VectorSource from "ol/source/Vector.js";
import VectorTileSource from "ol/source/VectorTile.js";
import { TileSourceEvent } from "ol/source/Tile.js";
import type { FrameState } from "ol/Map.js";

const { declutterAtRest, frozenOut, markBufferCopies } = await import("../../src/layers/frozenDeclutter.ts");
const { reportMapMotion, SETTLE_MS } = await import("../../src/lib/mapMotion.ts");

/**
 * Labels are placed while the map is at rest and frozen while it moves: the
 * ones the last frame at rest placed are drawn as they were, with
 * decluttering off, and nothing else is until the map settles.
 */

const place = (name: string, x = 0, y = 0) => new Feature({ geometry: new Point([x, y]), name });

/** A frame at rest, as movestart hands it over, with what each group placed. */
const restFrame = (placed: Record<string, Feature[]>) => ({
  declutter: Object.fromEntries(Object.entries(placed).map(([group, features]) => [
    group, { all: () => features.map((value) => ({ value })) },
  ])),
}) as unknown as FrameState;

test("a moving map draws what the last frame at rest placed, and nothing else", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const layer = new VectorLayer({ source: new VectorSource(), declutter: "labels" });
  declutterAtRest(layer);
  const [kept, refused] = [place("Essen"), place("Gelsenkirchen")];

  reportMapMotion(true, restFrame({ labels: [kept] }));
  assert.equal(layer.getDeclutter(), undefined, "no placing while it moves");
  assert.equal(frozenOut(layer, kept), false);
  assert.equal(frozenOut(layer, refused), true);

  reportMapMotion(false);
  t.mock.timers.tick(SETTLE_MS);
  assert.equal(layer.getDeclutter(), "labels", "placed afresh at rest");
  assert.equal(frozenOut(layer, refused), false);
});

test("a stop shorter than the settle is not a stop", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const layer = new VectorLayer({ source: new VectorSource(), declutter: "notches" });
  declutterAtRest(layer);
  reportMapMotion(true, restFrame({ notches: [] }));
  reportMapMotion(false);
  t.mock.timers.tick(SETTLE_MS - 1);
  reportMapMotion(true, restFrame({ notches: [] }));
  assert.equal(layer.getDeclutter(), undefined);
  reportMapMotion(false);
  t.mock.timers.tick(SETTLE_MS);
  assert.equal(layer.getDeclutter(), "notches");
});

test("a label is the same label in another tile, by its key", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const layer = new VectorLayer({ source: new VectorSource(), declutter: "places" });
  declutterAtRest(layer, (feature) => feature.get("name"));
  // A zoom changes tile level: the same place, as a new feature.
  reportMapMotion(true, restFrame({ places: [place("Köln")] }));
  assert.equal(frozenOut(layer, place("Köln")), false);
  assert.equal(frozenOut(layer, place("Bonn")), true);
  reportMapMotion(false);
  t.mock.timers.tick(SETTLE_MS);
});

test("a tile's copies of its neighbours' places are drawn by the neighbour only", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const source = new VectorTileSource({});
  markBufferCopies(source);
  const inside = place("Dortmund", 50, 50);
  const copy = place("Hamm", 120, 50);
  const tile = { extent: [0, 0, 100, 100], getFeatures: () => [inside, copy] };
  source.dispatchEvent(new TileSourceEvent("tileloadend", tile as never));

  const layer = new VectorLayer({ source: new VectorSource(), declutter: "tiles" });
  declutterAtRest(layer, (feature) => feature.get("name"));
  reportMapMotion(true, restFrame({ tiles: [inside, copy] }));
  assert.equal(frozenOut(layer, inside), false);
  assert.equal(frozenOut(layer, copy), true, "the copy would be drawn over the original");
  reportMapMotion(false);
  t.mock.timers.tick(SETTLE_MS);
});
