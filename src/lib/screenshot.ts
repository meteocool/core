/**
 * Screenshot mode: the map as a picture, for a renderer that loads the page
 * headless and photographs it -- the Open Graph cards, and the square images
 * the apps attach to rain notifications.
 *
 * `?screenshot=yes` takes everything off the map but its credits, fetches
 * only what the picture shows and never refreshes it, and says when the
 * picture is finished: `data-screenshot-ready` on <html>, for a
 * `waitForSelector("html[data-screenshot-ready]")`. That replaces waiting for
 * the network to go quiet, which a page with a socket and tile prefetches
 * reaches seconds after the map is drawn, and the stylesheet a renderer had
 * to inject to hide the buttons, for want of a switch.
 *
 * The setting is URL-sourced (App.svelte), so nothing about it is stored.
 */

/** The attribute on <html> that says the picture is finished, and why. */
export const SCREENSHOT_READY_ATTRIBUTE = "data-screenshot-ready";

/** The class on <html> the stylesheet keys on; see global.css. */
export const SCREENSHOT_CLASS = "screenshot";

/**
 * How long a picture may take before it is declared finished regardless.
 *
 * A card with the basemap alone beats a renderer that times out: under
 * timedFetch's 15 s stall, so a radar request that neither answers nor fails
 * does not hold the picture up until it is abandoned.
 */
export const SCREENSHOT_FALLBACK_MS = 8_000;

/** Whether a `screenshot` setting's value asks for screenshot mode. Only "yes" does, as with `toolbar`. */
export function isScreenshot(value: unknown): boolean {
  return value === "yes";
}

/** The same, read off an address: for the entrypoint, which runs before Settings exists. */
export function screenshotRequested(href: string): boolean {
  return isScreenshot(new URL(href).searchParams.get("screenshot"));
}

/** The part of an OpenLayers map `whenDrawn` listens to. */
export interface DrawnMap {
  render(): void;
  once(type: "postrender" | "rendercomplete", listener: () => void): unknown;
}

/** Why the picture was declared finished: drawn, or out of time. */
export type ReadyReason = "rendered" | "timeout";

/**
 * Call `ready` once, when the map has drawn everything `data` brought it.
 *
 * `rendercomplete` alone is the trap. The basemap finishes long before the
 * radar's frame list arrives, and a map with no radar layer yet is a map with
 * nothing left to load, so the first one says complete over an empty sky.
 * It is only listened for once `data` -- the requests whose answers add the
 * radar's layers and the strikes -- has settled, either way, and only from
 * the first frame drawn after that: a verdict on an earlier frame can still
 * be on its way out, and would call complete a map that has not yet asked for
 * the new layers' tiles. A failed or empty radar settles too, and the picture
 * is the basemap alone. `fallbackMs` is for a request that does neither.
 */
export function whenDrawn(
  map: DrawnMap,
  data: Promise<unknown>,
  ready: (reason: ReadyReason) => void,
  fallbackMs = SCREENSHOT_FALLBACK_MS,
): void {
  let done = false;
  const finish = (reason: ReadyReason) => {
    if (done) return;
    done = true;
    clearTimeout(fallback);
    ready(reason);
  };
  const fallback = setTimeout(() => finish("timeout"), fallbackMs);
  const settled = () => {
    if (done) return;
    map.once("postrender", () => map.once("rendercomplete", () => finish("rendered")));
    map.render();
  };
  data.then(settled, settled);
}

/** Say on <html> that the picture is finished. */
export function markScreenshotReady(reason: ReadyReason): void {
  document.documentElement.setAttribute(SCREENSHOT_READY_ATTRIBUTE, reason);
}
