/**
 * A drag with the middle button turns and tilts the 3D map, as an orbit does
 * in SketchUp and most other 3D tools.
 *
 * MapLibre's mouse handlers know the left button and the right one and nothing
 * else: a middle press starts no gesture at all, and on Windows and Linux the
 * browser takes it for autoscroll or a paste instead. So a middle drag on the
 * map is told, before MapLibre reads it, that it is a right drag (which
 * turns and tilts already) in all three places MapLibre looks: the press's
 * `button`, every move's `buttons`, which it checks to notice a release
 * outside the window, and the release's `button`, which has to match the
 * press's for the drag to end.
 *
 * Ctrl is let go of as well, since ctrl and the right button is MapLibre's
 * roll, which is off; a middle drag turns and tilts whatever is held.
 */

const MIDDLE = 1;
const RIGHT = 2;
/** The middle and right buttons' bits in `MouseEvent.buttons`, which do not follow `button`'s numbering. */
const MIDDLE_HELD = 4;
const RIGHT_HELD = 2;

type MouseLike = Pick<MouseEvent, "button" | "buttons" | "ctrlKey" | "target" | "preventDefault">;

/** `button` and the rest are getters on the prototype, so a property of the event's own shadows them for every later reader. */
function shadow(event: MouseLike, key: "button" | "buttons" | "ctrlKey", value: number | boolean): void {
  Object.defineProperty(event, key, { value, configurable: true });
}

/** The held buttons with the middle one standing in as the right. */
export function middleHeldAsRight(buttons: number): number {
  return buttons & MIDDLE_HELD ? (buttons & ~MIDDLE_HELD) | RIGHT_HELD : buttons;
}

function asRightDrag(event: MouseLike): void {
  shadow(event, "button", RIGHT);
  shadow(event, "buttons", middleHeldAsRight(event.buttons));
  shadow(event, "ctrlKey", false);
}

/**
 * Have middle drags that start on `surface` turn and tilt, and return the
 * undo. On the window and capturing, so it runs ahead of every listener
 * MapLibre has, on the map and on the document alike.
 */
export function middleDragTurnsAndTilts(
  surface: Pick<Node, "contains">,
  target: Pick<EventTarget, "addEventListener" | "removeEventListener"> = window,
): () => void {
  let dragging = false;
  const on = (event: MouseLike) => surface.contains(event.target as Node | null);

  const down = (event: Event) => {
    const press = event as unknown as MouseLike;
    if (press.button !== MIDDLE || !on(press)) return;
    dragging = true;
    // Autoscroll, and on Linux a paste of the primary selection.
    press.preventDefault();
    asRightDrag(press);
  };
  const move = (event: Event) => {
    if (!dragging) return;
    const motion = event as unknown as MouseLike;
    // Let go outside the window, where no release reaches the page. MapLibre
    // finds the right button missing as well and ends the drag on its own.
    if (!(motion.buttons & MIDDLE_HELD)) {
      dragging = false;
      return;
    }
    shadow(motion, "buttons", middleHeldAsRight(motion.buttons));
  };
  // Wherever it lands: the drag may well have wandered off the map.
  const up = (event: Event) => {
    const release = event as unknown as MouseLike;
    if (!dragging || release.button !== MIDDLE) return;
    dragging = false;
    asRightDrag(release);
  };
  // Firefox on Linux pastes on the click that follows, not on the press.
  const auxclick = (event: Event) => {
    const click = event as unknown as MouseLike;
    if (click.button === MIDDLE && on(click)) click.preventDefault();
  };

  // `{ capture: true }`, not `true`: see lib/ctrlDrag.ts.
  const capture = { capture: true };
  const listeners: [string, (event: Event) => void][] = [
    ["mousedown", down],
    ["mousemove", move],
    ["mouseup", up],
    ["auxclick", auxclick],
  ];
  for (const [type, listener] of listeners) target.addEventListener(type, listener, capture);
  return () => {
    for (const [type, listener] of listeners) target.removeEventListener(type, listener, capture);
  };
}
