import assert from "node:assert/strict";
import test from "node:test";
import {
  decideAxis, pullTo, shouldClear, swipeAway, SWIPE_COMMIT, SWIPE_DETENT, SWIPE_SLOP,
} from "../../src/lib/swipeAway.ts";

/**
 * The two rules that decide how a swipe-to-clear feels, shared by the map's
 * strips and the cell hint bar so the two cannot drift apart.
 */

test("a tap is not a swipe", () => {
  // A thumb always moves a pixel or two; every control inside a swipeable
  // thing depends on that reaching the button rather than being swallowed.
  assert.equal(decideAxis(0, 0), "undecided");
  assert.equal(decideAxis(SWIPE_SLOP - 1, SWIPE_SLOP - 1), "undecided");
  assert.equal(decideAxis(-3, 2), "undecided");
});

test("the longer travel wins once there is enough of it", () => {
  assert.equal(decideAxis(-20, 4), "x");
  assert.equal(decideAxis(-4, 20), "y");
  assert.equal(decideAxis(20, -4), "x");
});

test("a vertical drag is somebody else's", () => {
  // The sheet takes it, or the panel scrolls; either way the swipe keeps off.
  assert.equal(decideAxis(2, 30), "y");
});

test("a short pull springs back", () => {
  assert.equal(shouldClear(-10, 300), false);
  assert.equal(shouldClear(-(300 * SWIPE_COMMIT) + 1, 300), false);
});

test("a long pull clears", () => {
  assert.equal(shouldClear(-(300 * SWIPE_COMMIT), 300), true);
  assert.equal(shouldClear(-400, 300), true);
});

test("a rightward pull never clears", () => {
  assert.equal(shouldClear(40, 300), false);
});

test("a zero-width element cannot be cleared by accident", () => {
  // Before layout, every fraction of the width is zero and every drag would
  // otherwise count as having crossed it.
  assert.equal(shouldClear(-5, 0), false);
});

test("a parked panel follows a rightward drag back shut", () => {
  // Parked open at the detent, the finger pushes it back the way it came:
  // half way, then all the way, and no further than shut.
  assert.equal(pullTo(SWIPE_DETENT, 0, 300), SWIPE_DETENT);
  assert.equal(pullTo(SWIPE_DETENT, 40, 300), SWIPE_DETENT - 40);
  assert.equal(pullTo(SWIPE_DETENT, SWIPE_DETENT, 300), 0);
  assert.equal(pullTo(SWIPE_DETENT, 400, 300), 0);
});

test("a pull tracks the finger to the detent, then gives only part of the travel", () => {
  assert.equal(pullTo(0, -50, 300), 50);
  assert.equal(pullTo(0, -SWIPE_DETENT, 300), SWIPE_DETENT);
  const past = pullTo(0, -(SWIPE_DETENT + 100), 300);
  assert.ok(past > SWIPE_DETENT && past < SWIPE_DETENT + 100);
  assert.equal(pullTo(0, -5000, 300), 300);
});

/**
 * The action itself, on a stand-in node: enough of the DOM for its listeners,
 * its pointer capture and its width.
 */
function fakeNode() {
  const node = new EventTarget() as EventTarget & Record<string, unknown>;
  Object.assign(node, {
    setPointerCapture() {},
    hasPointerCapture() { return true; },
    releasePointerCapture() {},
    getBoundingClientRect() { return { width: 300 }; },
  });
  return node;
}

function pointer(type: string, x: number, target?: EventTarget): Event {
  const event = new Event(type);
  Object.assign(event, { pointerId: 1, button: 0, clientX: x, clientY: 10 });
  if (target) Object.defineProperty(event, "target", { value: target });
  return event;
}

test("a swipe begun on a button inside keeps going when the button loses the pointer", () => {
  // A touch is captured by what it lands on (the hint's Details button),
  // and taking it for the dock makes the button lose it. That loss bubbles
  // up to the dock, and was read as the swipe ending: it stopped dead.
  const node = fakeNode();
  const button = new EventTarget();
  const moves: number[] = [];
  let ended = 0;
  swipeAway(node as unknown as HTMLElement, { onMove: (dx) => moves.push(dx), onEnd: () => { ended += 1; } });

  node.dispatchEvent(pointer("pointerdown", 200));
  node.dispatchEvent(pointer("pointermove", 180));
  node.dispatchEvent(pointer("lostpointercapture", 180, button));
  node.dispatchEvent(pointer("pointermove", 150));

  assert.equal(ended, 0);
  assert.deepEqual(moves, [-20, -50]);

  node.dispatchEvent(pointer("pointerup", 150));
  assert.equal(ended, 1);
});

test("losing the pointer itself still ends the swipe", () => {
  const node = fakeNode();
  let ended = 0;
  swipeAway(node as unknown as HTMLElement, { onMove: () => {}, onEnd: () => { ended += 1; } });
  node.dispatchEvent(pointer("pointerdown", 200));
  node.dispatchEvent(pointer("pointermove", 180));
  node.dispatchEvent(pointer("lostpointercapture", 180));
  assert.equal(ended, 1);
});
