/**
 * ⌃-drag turns and tilts the 3D map in a Mac's Firefox too.
 *
 * MapLibre turns the map on a drag with the right button, or with ctrl and the
 * left, and tilts it on either. Firefox on a Mac reports a ⌃-click as the
 * right button -- `button` 2, ctrl still down -- while the drag that follows
 * holds the left one, and so neither takes: the turn wants ctrl with the left
 * button, and the tilt, which does start, checks on every move that the right
 * button is still held, finds the left one, and drops the drag. The gesture
 * the 3D map's guide shows did nothing at all. MapLibre has it open
 * (maplibre-gl-js#6565); Mapbox GL has carried this same correction since
 * 2016 (mapbox-gl-js#3131).
 *
 * So the press, and the release that ends it, are told they were the left
 * button before MapLibre reads them. A real ⌃-right-drag reads the same there
 * and becomes the same gesture, which costs nothing: the right button alone
 * already turns and tilts, and MapLibre's roll, the one thing ⌃-right does,
 * is off.
 */

/** Whether this browser reports a ⌃-click as the right button: Firefox on a Mac. */
export function reportsCtrlClickAsRight(userAgent: string, mac: boolean): boolean {
  return mac && /\bFirefox\//.test(userAgent);
}

type Press = Pick<MouseEvent, "button" | "ctrlKey" | "target">;

/** Whether a press is a ⌃-click that such a browser has reported as the right button. */
export function isCtrlClickAsRight(event: Pick<Press, "button" | "ctrlKey">): boolean {
  return event.button === 2 && event.ctrlKey;
}

/** `button` is a getter on the prototype, so a property of the event's own shadows it for every later reader. */
function asLeftButton(event: Press): void {
  Object.defineProperty(event, "button", { value: 0, configurable: true });
}

/**
 * Correct ⌃-clicks on `container` before MapLibre sees them, and return the
 * undo. On the window and capturing, so it runs ahead of every listener
 * MapLibre has, on the map and on the document alike.
 */
export function correctCtrlClicks(
  container: Pick<Node, "contains">,
  target: Pick<EventTarget, "addEventListener" | "removeEventListener"> = window,
): () => void {
  let pressed = false;
  const down = (event: Event) => {
    const press = event as unknown as Press;
    if (!isCtrlClickAsRight(press) || !container.contains(press.target as Node | null)) return;
    pressed = true;
    asLeftButton(press);
  };
  // MapLibre ends a drag on a release of the button that started it, and ctrl
  // may well have been let go by then; so any release, wherever it lands.
  const up = (event: Event) => {
    if (!pressed) return;
    pressed = false;
    const release = event as unknown as Press;
    if (release.button === 2) asLeftButton(release);
  };
  // `{ capture: true }`, not `true`: Node 22's EventTarget, which the tests
  // run on, does not match a bare `true` on removal, so the undo undid nothing.
  const capture = { capture: true };
  target.addEventListener("mousedown", down, capture);
  target.addEventListener("mouseup", up, capture);
  return () => {
    target.removeEventListener("mousedown", down, capture);
    target.removeEventListener("mouseup", up, capture);
  };
}
