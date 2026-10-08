/**
 * Scrollbars that show while something scrolls, and not otherwise.
 *
 * A phone's are like that already: a few pixels of thumb, over the content,
 * gone a moment after the scroll stops. A desktop browser with a mouse draws
 * the classic kind instead: a grey gutter and thumb down the side of every
 * drawer and popup, whether or not anyone is scrolling it. glass.css narrows
 * those to a thin, transparent strip; this marks whichever element is being
 * scrolled, and the thumb is drawn only on that one, until it settles.
 *
 * One listener for the page: `scroll` does not bubble, but it is seen on the
 * way down, so a capturing listener on the document hears every scroller,
 * including the ones mounted later.
 */

/** The class glass.css draws the thumb under. */
const SCROLLING = "mc-scrolling";

/** How long the thumb stays after the last scroll, as an overlay scrollbar's does. */
const LINGER_MS = 900;

let installed = false;

export function installScrollbars(): void {
  if (installed || typeof document === "undefined") return;
  installed = true;
  const timers = new WeakMap<Element, number>();
  document.addEventListener("scroll", (event) => {
    const target = event.target;
    // The document's own scroll targets the document, which the app never
    // scrolls; only elements carry a scrollbar of their own.
    if (!(target instanceof Element)) return;
    target.classList.add(SCROLLING);
    const pending = timers.get(target);
    if (pending !== undefined) window.clearTimeout(pending);
    timers.set(target, window.setTimeout(() => {
      target.classList.remove(SCROLLING);
      timers.delete(target);
    }, LINGER_MS));
  }, { capture: true, passive: true });
}
