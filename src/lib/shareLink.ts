/**
 * A link to what is on screen, made to be sent, and what its receiver is told
 * once it has aged.
 *
 * The link is the page's own deep link (lib/deepLink.ts) with one thing added:
 * when it was shared. Weather does not keep. A link to "this storm" or "rain
 * over Munich" sent an hour ago opens on the weather now, and the receiver
 * should know that what they were sent has moved on, or they read the map as
 * the thing the sender meant.
 *
 * Always on the site's root rather than the page that made it: the apps load
 * ios.html and android.html, which a receiver without the app should never
 * land on, and only the root gets the Worker's link preview (worker/index.ts),
 * whose language `share_lang` picks.
 *
 * Pure, so the rules are testable without a page; lib/share.ts does the
 * sending.
 */
import { linkSearch } from "./deepLink";
import type { LinkState } from "./deepLink";

/**
 * How old a link gets before its receiver is told. The radar steps every five
 * minutes; after three steps a storm has moved a few kilometres and grown or
 * died, which is the point where "what you were sent" and "what you see" part.
 */
export const STALE_AFTER_S = 15 * 60;

/**
 * How far the sender's clock may run ahead of the receiver's. A link from
 * further in the future than this says nothing true about its age.
 */
const SKEW_S = 5 * 60;

/** The languages the Worker's link preview is written in, besides English. */
const PREVIEW_LANGUAGES = ["de"];

/**
 * The URL to send for `state`, stamped `now` (unix seconds).
 *
 * `language` is the sender's: the preview a messenger unfurls is in theirs,
 * which is the best guess at the receiver's too. English is the preview's
 * default and not written.
 */
export function shareUrl(origin: string, state: LinkState, now: number, language?: string | null): string {
  const lang = (language ?? "").slice(0, 2).toLowerCase();
  const foreign = PREVIEW_LANGUAGES.includes(lang) ? `share_lang=${lang}` : "";
  const search = linkSearch(foreign, { ...state, shared: Math.floor(now / 60) * 60 });
  return `${origin.replace(/\/+$/, "")}/${search}`;
}

/**
 * When an opened link was shared, if that is long enough ago to say so; null
 * for a fresh link, one without a stamp, and one from a clock that is wrong.
 */
export function staleSince(link: LinkState, now: number): number | null {
  if (link.shared === undefined) return null;
  const age = now - link.shared;
  if (age < -SKEW_S) return null;
  return age >= STALE_AFTER_S ? link.shared : null;
}

/**
 * A link's age in the unit a person would say it in: minutes for the first
 * hour, hours for the first two days, days after that. Whole units, rounded,
 * for `Intl.RelativeTimeFormat`.
 */
export function linkAge(seconds: number): [number, "minute" | "hour" | "day"] {
  const minutes = Math.max(0, Math.round(seconds / 60));
  if (minutes < 60) return [minutes, "minute"];
  const hours = Math.round(minutes / 60);
  if (hours < 48) return [hours, "hour"];
  return [Math.round(hours / 24), "day"];
}

/**
 * Which notice an aged link gets: one about a storm, which will have moved,
 * or one about the map, whose weather will have.
 */
export function staleNotice(link: LinkState): "share.stale_storm" | "share.stale" {
  return link.cell || link.cloud ? "share.stale_storm" : "share.stale";
}
