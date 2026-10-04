import assert from "node:assert/strict";
import test from "node:test";
import { middleDragTurnsAndTilts, middleHeldAsRight } from "../../src/lib/middleDrag.ts";

/**
 * A middle drag on the 3D map, which MapLibre ignores unless it reads as a
 * right drag: on the press, on every move and on the release. A middle press
 * anywhere else, or any other button, is nobody's business here.
 */

const map = { contains: (node: Node | null) => node !== null && (node as unknown as { onMap?: boolean }).onMap === true };
const onMap = { onMap: true };
const elsewhere = { onMap: false };

type Fired = Event & { button: number; buttons: number; ctrlKey: boolean };

/** A mouse event as the window's capturing listener sees it: before anything else has read it. */
function fire(window: EventTarget, type: string, init: { button: number; buttons: number; ctrlKey?: boolean; on: object }): Fired {
  const event = Object.assign(new Event(type, { cancelable: true }), {
    button: init.button,
    buttons: init.buttons,
    ctrlKey: init.ctrlKey ?? false,
  });
  // `dispatchEvent` would set the target to the window itself.
  Object.defineProperty(event, "target", { value: init.on });
  window.dispatchEvent(event);
  return event as Fired;
}

test("the middle button's bit becomes the right's, and nothing else changes", () => {
  assert.equal(middleHeldAsRight(4), 2);
  assert.equal(middleHeldAsRight(4 | 1), 2 | 1);
  assert.equal(middleHeldAsRight(1), 1);
  assert.equal(middleHeldAsRight(0), 0);
});

test("a middle drag on the map reads as a right drag from press to release", () => {
  const window = new EventTarget();
  middleDragTurnsAndTilts(map, window);
  const press = fire(window, "mousedown", { button: 1, buttons: 4, ctrlKey: true, on: onMap });
  assert.equal(press.button, 2);
  assert.equal(press.buttons, 2);
  assert.equal(press.ctrlKey, false, "ctrl and the right button would be a roll");
  assert.equal(press.defaultPrevented, true, "no autoscroll, no paste");
  // Wandered off the map, still the same drag.
  assert.equal(fire(window, "mousemove", { button: 0, buttons: 4, on: elsewhere }).buttons, 2);
  assert.equal(fire(window, "mouseup", { button: 1, buttons: 0, on: elsewhere }).button, 2);
  // Over: the next move is left as it is.
  assert.equal(fire(window, "mousemove", { button: 0, buttons: 4, on: onMap }).buttons, 4);
});

test("a release outside the window ends the drag at the next move", () => {
  const window = new EventTarget();
  middleDragTurnsAndTilts(map, window);
  fire(window, "mousedown", { button: 1, buttons: 4, on: onMap });
  assert.equal(fire(window, "mousemove", { button: 0, buttons: 0, on: onMap }).buttons, 0);
  assert.equal(fire(window, "mouseup", { button: 1, buttons: 0, on: onMap }).button, 1);
});

test("left and right drags, and a middle press off the map, are left alone", () => {
  const window = new EventTarget();
  middleDragTurnsAndTilts(map, window);
  assert.equal(fire(window, "mousedown", { button: 2, buttons: 2, on: onMap }).button, 2);
  assert.equal(fire(window, "mousemove", { button: 0, buttons: 2, on: onMap }).buttons, 2);
  assert.equal(fire(window, "mousedown", { button: 0, buttons: 1, on: onMap }).button, 0);
  const outside = fire(window, "mousedown", { button: 1, buttons: 4, on: elsewhere });
  assert.equal(outside.button, 1);
  assert.equal(outside.defaultPrevented, false);
  assert.equal(fire(window, "auxclick", { button: 1, buttons: 0, on: elsewhere }).defaultPrevented, false);
});

test("a middle click on the map pastes nothing", () => {
  const window = new EventTarget();
  middleDragTurnsAndTilts(map, window);
  assert.equal(fire(window, "auxclick", { button: 1, buttons: 0, on: onMap }).defaultPrevented, true);
});

test("undone, nothing is changed", () => {
  const window = new EventTarget();
  middleDragTurnsAndTilts(map, window)();
  assert.equal(fire(window, "mousedown", { button: 1, buttons: 4, on: onMap }).button, 1);
});
