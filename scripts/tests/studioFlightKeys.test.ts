import assert from "node:assert/strict";
import { test } from "node:test";
import { Keys } from "../../src/lib/studio/flight/controls.ts";

/** A window and a document to listen on, and a key's event as the browser sends it. */
function page() {
  const scope = globalThis as unknown as { window: EventTarget; document: EventTarget & { hidden: boolean } };
  scope.window = new EventTarget();
  scope.document = Object.assign(new EventTarget(), { hidden: false });
  const send = (type: "keydown" | "keyup", code: string, key: string, extra: Partial<KeyboardEvent> = {}) => {
    scope.window.dispatchEvent(Object.assign(new Event(type), { code, key, metaKey: false, ctrlKey: false, altKey: false, repeat: false, ...extra }));
  };
  return { send };
}

test("an arrow whose keyup a Cmd shortcut swallowed does not stay held", () => {
  const { send } = page();
  const keys = new Keys(() => undefined);
  keys.start();
  try {
    send("keydown", "ArrowRight", "ArrowRight");
    assert.equal(keys.read().roll, 1);
    // Cmd-Shift-4 over it: the arrow's keyup never comes, only Cmd's.
    send("keydown", "MetaLeft", "Meta", { metaKey: true });
    send("keyup", "MetaLeft", "Meta");
    assert.equal(keys.read().roll, 0);
    // Still held, it comes back with its repeat.
    send("keydown", "ArrowRight", "ArrowRight", { repeat: true });
    assert.equal(keys.read().roll, 1);
    // A new aircraft starts with nothing held.
    keys.letGo();
    assert.equal(keys.read().roll, 0);
  } finally {
    keys.stop();
  }
});

test("a key that flies says so; Shift, a shortcut and the others' keys do not", () => {
  const { send } = page();
  let flown = 0;
  const actions: string[] = [];
  const keys = new Keys((action) => actions.push(action), () => { flown += 1; });
  keys.start();
  try {
    send("keydown", "ShiftLeft", "Shift");
    send("keydown", "KeyV", "v");
    send("keydown", "KeyH", "h");
    send("keydown", "ArrowUp", "ArrowUp", { ctrlKey: true });
    assert.equal(flown, 0);
    assert.deepEqual(actions, ["view", "help"]);
    send("keydown", "ArrowUp", "ArrowUp");
    assert.equal(flown, 1);
  } finally {
    keys.stop();
  }
});
