/**
 * A new build of the app held back while something must not be cut off:
 * a flight, its plan or its loading. Taking a new service worker reloads the
 * page (lib/serviceWorker.ts), and the new worker's precache drops the old
 * build's chunks, which a flight still to load would then fail to fetch. So
 * while anything holds, a new worker waits and the page stays as it is;
 * once the last hold lets go, the update goes ahead as it would have.
 */
import { writable } from "svelte/store";

let holds = 0;
/** Whether anything holds updates back now. */
export const updatesHeld = writable(false);

/** Hold updates back until the function returned is called. */
export function holdUpdates(): () => void {
  holds += 1;
  updatesHeld.set(true);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holds -= 1;
    if (holds === 0) updatesHeld.set(false);
  };
}

/** Whether anything holds updates back now. */
export function updatesHeldNow(): boolean {
  return holds > 0;
}
