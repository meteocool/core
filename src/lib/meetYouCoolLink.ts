/**
 * The address "meet you cool" opens at: `#meetyoucool` on any page of the
 * app. Kept apart from the rest of it (meetYouCool.ts), which is in the
 * screen's own chunk: this is all the first load carries.
 */
export const MEET_YOU_COOL_HASH = "#meetyoucool";

/** Whether a location's hash asks for "meet you cool", in whatever case it was typed. */
export function isMeetYouCoolHash(hash: string | null | undefined): boolean {
  return (hash ?? "").toLowerCase() === MEET_YOU_COOL_HASH;
}
