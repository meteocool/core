import assert from "node:assert/strict";
import test from "node:test";

const { staleOnlyWhileLoading } = await import("../../src/layers/valueTiles.ts");

/**
 * An earlier frame's tiles stand in for the frame on screen while it loads,
 * and only then: kept on, they were drawn an hour later over ground the
 * reader zoomed or panned back to, and the map jumped from then to now.
 */
function fakeLayer() {
  const handlers: Record<string, () => void> = {};
  const renderer = { renderComplete: false, stale: ["frame-1", "frame-2"], getStaleKeys() { return this.stale; } };
  const layer = { on: (type: string, handler: () => void) => { handlers[type] = handler; }, getRenderer: () => renderer };
  return { layer, renderer, render: () => handlers.postrender?.() };
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
