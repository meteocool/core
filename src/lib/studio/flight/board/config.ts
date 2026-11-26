/**
 * Whether a flight goes on meteoair's board, and which board.
 *
 * The board is the meteoair board API under the environment's API origin
 * (src/urls.ts), each environment its own board with its own Turnstile
 * widget. Production has none configured, so it has no board: its flights
 * keep the cockpit's score alone.
 *
 * Small and free of the board's own code: Studio asks it before it loads
 * that code at all (lib/studio/flight/board/session.ts, loaded on take-off).
 */

/**
 * The widgets' sitekeys, public: one per environment, allowed only on that
 * environment's own site. A dev server gets Turnstile's test key, which
 * always passes and which only a local board accepts.
 */
export const BOARD_SITEKEYS: Readonly<Record<string, string>> = {
  next: "0x4AAAAAAGUggVX593a_DbQd",
  demo: "0x4AAAAAAGUggCSU7Oj-kdHz",
};
export const TEST_SITEKEY = "1x00000000000000000000AA";

/** What a build is: its Vite mode, whether it is a dev server, and whether this page flies the demo's storm in place of its own weather. */
export interface BoardBuild {
  mode: string;
  dev: boolean;
  demoWeather: boolean;
}

/** The sitekey of the board this build's flights go on; null where they go on none. */
export function boardSitekey({ mode, dev, demoWeather }: BoardBuild): string | null {
  if (dev) return TEST_SITEKEY;
  // The demo's storm flown from another site: its weather is the demo's, its backend the demo's, and its widget not this site's.
  if (demoWeather && mode !== "demo") return null;
  return BOARD_SITEKEYS[mode] ?? null;
}

/**
 * Whether a flight taking off now goes on the board: one in this build's
 * own weather as it is now. A flight through a past moment (a shared link's
 * time, the archive's window, the history's storm) has no board, except the
 * demo's own recorded storm, which the demo's site only ever shows as a
 * window and which is its board's weather.
 */
export function boardFlight({ sitekey, pastWindow, showcase }: {
  sitekey: string | null;
  /** Whether a past window is open on the map. */
  pastWindow: boolean;
  /** Whether that window is the demo's own storm, on its own site. */
  showcase: boolean;
}): boolean {
  if (!sitekey) return false;
  return !pastWindow || showcase;
}
