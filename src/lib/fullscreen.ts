/**
 * The page over the whole screen, where the browser lets a page ask for it:
 * the flight, and the page it has to itself. Not on an iPhone, whose Safari
 * gives a page no such thing.
 *
 * Asked for from a click or a key, as the browser requires; Escape is the
 * browser's own way back out, and reaches the page only once it is out.
 */
import { readable } from "svelte/store";

type FullscreenDocument = Document & {
  webkitFullscreenEnabled?: boolean;
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => void;
};
type FullscreenElement = HTMLElement & { webkitRequestFullscreen?: () => void };

const page = (): FullscreenDocument | null => (typeof document === "undefined" ? null : document);

/** Whether this browser puts a page over the whole screen at all. */
export function fullscreenSupported(): boolean {
  const doc = page();
  return Boolean(doc && (doc.fullscreenEnabled ?? doc.webkitFullscreenEnabled));
}

const isFullscreen = (): boolean => {
  const doc = page();
  return Boolean(doc && (doc.fullscreenElement ?? doc.webkitFullscreenElement));
};

/** Whether the page has the whole screen now, whoever put it there or took it back. */
export const fullscreen = readable(false, (set) => {
  const doc = page();
  if (!doc) return undefined;
  const changed = () => set(isFullscreen());
  changed();
  doc.addEventListener("fullscreenchange", changed);
  doc.addEventListener("webkitfullscreenchange", changed);
  return () => {
    doc.removeEventListener("fullscreenchange", changed);
    doc.removeEventListener("webkitfullscreenchange", changed);
  };
});

/** Onto the whole screen, or back off it. A browser that refuses is left as it is. */
export function toggleFullscreen(): void {
  const doc = page();
  if (!doc || !fullscreenSupported()) return;
  try {
    if (isFullscreen()) {
      if (doc.exitFullscreen) void doc.exitFullscreen().catch(() => undefined);
      else doc.webkitExitFullscreen?.();
      return;
    }
    const root = doc.documentElement as FullscreenElement;
    if (root.requestFullscreen) void root.requestFullscreen().catch(() => undefined);
    else root.webkitRequestFullscreen?.();
  } catch {
    // Refused outright (an embedding page that does not allow it): nothing to do.
  }
}
