/**
 * Whether a share can go anywhere, and the glyph its buttons wear: the cheap
 * half of lib/share.ts, without the link building behind it, so the map's
 * control stack (LayerManager) can ask without importing the whole app.
 */
import { readable } from "svelte/store";
import { faArrowUpFromBracket } from "@fortawesome/free-solid-svg-icons/faArrowUpFromBracket";
import { faShareNodes } from "@fortawesome/free-solid-svg-icons/faShareNodes";
import { DeviceDetect as dd } from "./DeviceDetect";

/** Whether the host the page runs in presents a share sheet for it. */
export function nativeShare(): boolean {
  return typeof window !== "undefined" && window.nativeCapabilities?.share === true;
}

/** Whether a share can go anywhere from here; see lib/share.ts's comment. */
export function canShare(): boolean {
  if (dd.isApp()) return nativeShare();
  if (typeof navigator === "undefined") return false;
  return typeof navigator.share === "function" || typeof navigator.clipboard?.writeText === "function";
}

/**
 * `canShare()` for the share buttons. Asked when the first one renders rather
 * than at import: App.svelte says which host the page runs in during its own
 * setup, after this module has loaded.
 */
export const shareAvailable = readable(false, (set) => {
  set(canShare());
});

/**
 * The share glyph: the three joined dots on Android, the app and its
 * browsers, where that is the system's; the box with an arrow out of it
 * everywhere else, Apple's and the web's alike, as the one people recognise
 * without a label.
 */
export function shareIcon() {
  const android = dd.isAndroid()
    || (typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent));
  return android ? faShareNodes : faArrowUpFromBracket;
}
