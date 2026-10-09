/**
 * Sending someone what is on screen.
 *
 * The link is lib/shareLink.ts's. How it leaves depends on where the page runs:
 *
 * - in an app, through the host's own share sheet (`share:` to native), and
 *   only when the host says it has one (`nativeCapabilities.share`). An app
 *   build from before sharing has no handler for the message, and a webview's
 *   own `navigator.share` is missing on Android and patchy on iOS, so there
 *   the buttons stay hidden rather than do nothing;
 * - in a browser, through the Web Share API where there is one (phones,
 *   Safari, Chrome on Windows), and otherwise onto the clipboard with a word
 *   that it is there.
 */
import { readable } from "svelte/store";
import { faArrowUpFromBracket } from "@fortawesome/free-solid-svg-icons/faArrowUpFromBracket";
import { faShareNodes } from "@fortawesome/free-solid-svg-icons/faShareNodes";
import { DeviceDetect as dd } from "./DeviceDetect";
import { postToNative } from "./nativeBridge";
import type { NativeShare } from "./nativeBridge";
import type { LinkState } from "./deepLink";
import { shareUrl } from "./shareLink";
import { reportBrief } from "./Toast";
import { currentState } from "./urlState";
import { currentLocale, t } from "../locale/t";

export interface ShareRequest {
  /**
   * What to change about what is on screen before it is sent: the point a
   * long press asked about, say, which is not what the map is centred on.
   */
  change?: Partial<LinkState>;
  /** What the link is about, in a few words: a storm's place. None for the map as a whole. */
  subject?: string | null;
  /** The control the share was asked from, which an iPad's popover points at. */
  anchor?: Element | null;
}

/** Whether the host the page runs in presents a share sheet for it. */
function nativeShare(): boolean {
  return typeof window !== "undefined" && window.nativeCapabilities?.share === true;
}

/** Whether a share can go anywhere from here; see the module comment. */
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

/** The link and title for what is on screen, changed by `request`; null before the map is up. */
export function shareLink(request: ShareRequest = {}): { url: string; title: string } | null {
  const state = currentState();
  if (!state) return null;
  const url = shareUrl(window.location.origin, { ...state, ...request.change }, Date.now() / 1000, currentLocale());
  const title = request.subject ? t("share.title_about", { values: { subject: request.subject } }) : t("share.title");
  return { url, title };
}

/** Send what is on screen, through whichever way out this page has. */
export async function share(request: ShareRequest = {}): Promise<void> {
  const link = shareLink(request);
  if (!link) return;

  if (dd.isApp()) {
    if (!nativeShare()) return;
    const message: NativeShare = { ...link };
    const rect = request.anchor?.getBoundingClientRect();
    if (rect) Object.assign(message, { x: rect.x, y: rect.y, width: rect.width, height: rect.height });
    postToNative(`share:${JSON.stringify(message)}`);
    return;
  }

  if (typeof navigator.share === "function") {
    try {
      await navigator.share(link);
      return;
    } catch (error) {
      // Closed without picking anything: that was the reader's answer.
      if ((error as DOMException)?.name === "AbortError") return;
      // Refused for some other reason (no user gesture left, a policy):
      // the clipboard still works.
    }
  }
  try {
    await navigator.clipboard.writeText(link.url);
    reportBrief(t("share.copied"), "success", "link-45deg");
  } catch {
    reportBrief(t("share.copy_failed"), "warning", "exclamation-triangle");
  }
}

/**
 * The host's way in, for a share it starts itself rather than a button here:
 * iOS offers one when the reader takes a screenshot.
 */
export function exposeShareLink(): () => void {
  window.shareLink = () => shareLink();
  return () => {
    delete window.shareLink;
  };
}
