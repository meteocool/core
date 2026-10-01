import assert from "node:assert/strict";
import test from "node:test";
import { correctCtrlClicks, reportsCtrlClickAsRight } from "../../src/lib/ctrlDrag.ts";

/**
 * ⌃-drag on the 3D map in a Mac's Firefox, which reports the ⌃-click as the
 * right button while the drag holds the left one. Uncorrected, MapLibre neither
 * turns nor tilts. Corrected too eagerly, a right-drag elsewhere would be
 * mistaken for a left one and stop turning the map.
 */

const FIREFOX_MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:144.0) Gecko/20100101 Firefox/144.0";
const CHROME_MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const FIREFOX_WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:144.0) Gecko/20100101 Firefox/144.0";

test("only Firefox on a Mac needs correcting", () => {
  assert.equal(reportsCtrlClickAsRight(FIREFOX_MAC, true), true);
  assert.equal(reportsCtrlClickAsRight(CHROME_MAC, true), false);
  assert.equal(reportsCtrlClickAsRight(FIREFOX_WINDOWS, false), false);
});

const map = { contains: (node: Node | null) => node !== null && (node as unknown as { onMap?: boolean }).onMap === true };
const onMap = { onMap: true };
const elsewhere = { onMap: false };

/** A mouse event as the window's capturing listener sees it: before anything else has read it. */
function fire(window: EventTarget, type: string, init: { button: number; ctrlKey: boolean; on: object }) {
  const event = Object.assign(new Event(type), { button: init.button, ctrlKey: init.ctrlKey });
  // `dispatchEvent` would set the target to the window itself; the map's own
  // elements are what a real press lands on.
  Object.defineProperty(event, "target", { value: init.on });
  window.dispatchEvent(event);
  return event as Event & { button: number };
}

test("a ⌃-press reported as the right button reads as the left, and so does its release", () => {
  const window = new EventTarget();
  correctCtrlClicks(map, window);
  assert.equal(fire(window, "mousedown", { button: 2, ctrlKey: true, on: onMap }).button, 0);
  // Released with ctrl already let go, and off the map: still the end of that drag.
  assert.equal(fire(window, "mouseup", { button: 2, ctrlKey: false, on: elsewhere }).button, 0);
  // And the next plain right release is a right release again.
  assert.equal(fire(window, "mouseup", { button: 2, ctrlKey: false, on: onMap }).button, 2);
});

test("a right-drag without ctrl, and a ⌃-press already reported as the left, are left alone", () => {
  const window = new EventTarget();
  correctCtrlClicks(map, window);
  assert.equal(fire(window, "mousedown", { button: 2, ctrlKey: false, on: onMap }).button, 2);
  assert.equal(fire(window, "mouseup", { button: 2, ctrlKey: false, on: onMap }).button, 2);
  assert.equal(fire(window, "mousedown", { button: 0, ctrlKey: true, on: onMap }).button, 0);
});

test("a ⌃-click anywhere but the map keeps its right button", () => {
  const window = new EventTarget();
  correctCtrlClicks(map, window);
  assert.equal(fire(window, "mousedown", { button: 2, ctrlKey: true, on: elsewhere }).button, 2);
  assert.equal(fire(window, "mouseup", { button: 2, ctrlKey: true, on: elsewhere }).button, 2);
});

test("undone, nothing is corrected", () => {
  const window = new EventTarget();
  correctCtrlClicks(map, window)();
  assert.equal(fire(window, "mousedown", { button: 2, ctrlKey: true, on: onMap }).button, 2);
});
