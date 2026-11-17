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
 * - in a browser, onto the clipboard straight away and into the share dialog
 *   (components/ShareDialog.svelte): the link, selected, the card a messenger
 *   will unfurl it as, and the services to post it on, the platform's own
 *   share sheet among them where there is one.
 */
import { DeviceDetect as dd } from "./DeviceDetect";
import { nativeShare } from "./shareSupport";
import { postToNative } from "./nativeBridge";
import type { NativeShare } from "./nativeBridge";
import type { LinkState } from "./deepLink";
import { shareUrl } from "./shareLink";
import { shareDialog } from "../stores";
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

export { canShare, shareAvailable, shareIcon } from "./shareSupport";

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

  // Written in the press that asked for it, before anything else is awaited:
  // Safari lets a page at the clipboard only that close to the gesture.
  const copied = copyLink(link.url);
  shareDialog.set({ ...link, copied });
}

/** Put `url` on the clipboard; whether it got there. */
export function copyLink(url: string): Promise<boolean> {
  if (typeof navigator.clipboard?.writeText !== "function") return Promise.resolve(false);
  return navigator.clipboard.writeText(url).then(() => true, () => false);
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
