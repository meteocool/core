/**
 * Which standing notices a reader has closed for good.
 *
 * A notice is identified by its own text, not by a name the call site picks.
 * That is the whole design: reword a warning and it becomes a different
 * notice, so the reader is told again and no call site has to remember to bump
 * a version when the copy changes. For a standing condition it is also the
 * right failure mode -- a genuinely new problem always gets through, and the
 * only thing a reader can silence is the exact sentence they read and
 * dismissed.
 *
 * Kept as pure string functions, away from `lib/Toast.ts`, so the rule can be
 * tested without a DOM or a Settings instance.
 */

/**
 * A notice's key: FNV-1a over the message, in base 36.
 *
 * Eight characters rather than the sentence itself, because this ends up in
 * localStorage and a ledger of full warning texts is both larger and more
 * revealing than it needs to be. Collisions silence an unrelated notice, which
 * at 32 bits over a handful of messages is not a risk worth paying to avoid.
 */
export function noticeKey(message: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < message.length; i += 1) {
    h ^= message.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** The keys in a stored ledger, which is a comma-separated list. */
export function parseLedger(stored: string): string[] {
  return stored.split(",").filter(Boolean);
}

/** Whether this exact message has been dismissed before. */
export function isDismissed(stored: string, message: string): boolean {
  return parseLedger(stored).includes(noticeKey(message));
}

/**
 * The ledger with this message recorded, or unchanged if it already is.
 *
 * Returns the string to store rather than mutating anything, so the caller
 * owns every read and write of the setting.
 */
export function withDismissal(stored: string, message: string): string {
  const keys = parseLedger(stored);
  const key = noticeKey(message);
  return keys.includes(key) ? stored : [...keys, key].join(",");
}
