import assert from "node:assert/strict";
import test from "node:test";

const { forgetEarlierFrames, staleOnlyWhileLoading } = await import("../../src/layers/valueTiles.ts");

/**
 * An earlier frame's tiles stand in for the frame on screen while it loads,
 * and only then: kept on, they were drawn an hour later over ground the
 * reader zoomed or panned back to, and the map jumped from then to now.
 */
function fakeLayer() {
  const handlers: Record<string, () => void> = {};
  // Two tiles of the frame on screen, one each of two earlier frames.
  const cached = new Map(["now/1", "now/2", "frame-1/1", "frame-2/1"].map((key) => [key, key.split("/")[0]]));
  const disposed: string[] = [];
  const tileRepresentationCache = {
    getKeys: () => [...cached.keys()],
    peek: (key: string) => ({ tile: { key: cached.get(key)! }, dispose: () => disposed.push(key) }),
    remove: (key: string) => cached.delete(key),
  };
  const renderer = { renderComplete: false, stale: ["frame-1", "frame-2"], getStaleKeys() { return this.stale; }, tileRepresentationCache };
  const layer = {
    on: (type: string, handler: () => void) => { handlers[type] = handler; },
    getRenderer: () => renderer,
    getSource: () => ({ getKey: () => "now" }),
  };
  return { layer, renderer, cached, disposed, render: () => handlers.postrender?.() };
}

test("earlier frames stand in while the frame on screen is loading", () => {
  const { layer, renderer, render } = fakeLayer();
  staleOnlyWhileLoading(layer as never);
  render();
  assert.deepEqual(renderer.stale, ["frame-1", "frame-2"]);
});

test("once the frame on screen is drawn, no earlier frame stands in again", () => {
  const { layer, renderer, render } = fakeLayer();
  staleOnlyWhileLoading(layer as never);
  renderer.renderComplete = true;
  render();
  assert.deepEqual(renderer.stale, []);
});

test("closing the player drops every earlier frame's tiles once the frame on screen is drawn", () => {
  const { layer, renderer, cached, disposed, render } = fakeLayer();
  staleOnlyWhileLoading(layer as never);
  forgetEarlierFrames();
  // Still loading: the earlier frames are what stands in, so they stay.
  render();
  assert.equal(cached.size, 4);
  renderer.renderComplete = true;
  render();
  assert.deepEqual([...cached.keys()], ["now/1", "now/2"]);
  assert.deepEqual(disposed, ["frame-1/1", "frame-2/1"]);
});

test("without the player closing, earlier frames' tiles stay cached for the next loop", () => {
  const { layer, renderer, cached, render } = fakeLayer();
  staleOnlyWhileLoading(layer as never);
  renderer.renderComplete = true;
  render();
  assert.equal(cached.size, 4);
});
