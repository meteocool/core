/**
 * How long the dry-day outlook stays away once closed.
 *
 * The strip comes back on its own whenever the conditions for it hold, which
 * on a dry week is every page load. Closing it says "not this", and a reload
 * an hour later asking again would be the nag it was closed for. So closing
 * it puts it away for a day, across reloads: by then the forecast is a
 * different one and worth offering again.
 *
 * Stored as the time it was closed rather than the time it may return, so a
 * change to how long it stays away applies to closings already on record.
 */

export const OUTLOOK_SNOOZE_MS = 24 * 3_600_000;
export const OUTLOOK_DISMISSED_KEY = "dryOutlookDismissedAt";

/** Whether a closing stored as `stored` still keeps the strip away at `now`. */
export function snoozedAt(stored: string | null, now: number): boolean {
  if (stored === null) return false;
  const at = Number(stored);
  // A closing in the future is a clock that was wrong then or is now: let the
  // strip back rather than hide it until that date comes round.
  return Number.isFinite(at) && at <= now && now - at < OUTLOOK_SNOOZE_MS;
}

/** Whether the reader closed the strip less than a day ago. */
export function outlookSnoozed(now = Date.now()): boolean {
  try {
    return snoozedAt(localStorage.getItem(OUTLOOK_DISMISSED_KEY), now);
  } catch {
    // No storage (a private window, a webview without it): nothing on record.
    return false;
  }
}

/** Record that the reader closed the strip, now. */
export function snoozeOutlook(now = Date.now()): void {
  try {
    localStorage.setItem(OUTLOOK_DISMISSED_KEY, String(now));
  } catch {
    // See outlookSnoozed: the closing then lasts for this page load.
  }
}
