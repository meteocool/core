/**
 * meteoair's board, on the flight deck: loaded on take-off, and only for a
 * flight that goes on the board (lib/studio/flight/board/config.ts), so
 * nothing of it, Turnstile's script included, reaches a page before then.
 *
 * `joinBoard` puts the pilot's flight on the board (the session in
 * lib/studio/flight/board/session.ts) and hands the deck what it draws of
 * it: the board's score beside the cockpit's (BoardReadout), its notices
 * (BoardNote), the card with the day's top twenty (BoardCard) and the card
 * for the check the board may ask of the reader (BoardCheck).
 */
import { readable, writable } from "svelte/store";
import type { Readable, Writable } from "svelte/store";
import type { Component } from "svelte";
import { v3APIBaseUrl } from "../../../../urls";
import type { Pilot } from "../../../../lib/studio/flight/pilot";
import type { Feat } from "../../../../lib/studio/flight/score";
import { BoardSession } from "../../../../lib/studio/flight/board/session";
import { frameOf } from "../../../../lib/studio/flight/board/frame";
import { socketUrl } from "../../../../lib/studio/flight/board/socketPlan";
import { turnstileTokens } from "../../../../lib/studio/flight/board/turnstile";
import type { TurnstileSource } from "../../../../lib/studio/flight/board/turnstile";
import type { BoardView } from "../../../../lib/studio/flight/board/view";
import BoardReadout from "./BoardReadout.svelte";
import BoardNote from "./BoardNote.svelte";
import BoardCard from "./BoardCard.svelte";
import BoardCheck from "./BoardCheck.svelte";

/** The cockpit's own score and feats, as the card shows them beside the board's: a few times a second, not every frame. */
export interface CockpitScore {
  points: number;
  feats: readonly Feat[];
}

export interface BoardDeck {
  view: Readable<BoardView>;
  cockpit: Readable<CockpitScore>;
  /** Whether the card with the day's board is up. */
  open: Writable<boolean>;
  Readout: Component<{ board: BoardDeck }>;
  Note: Component<{ board: BoardDeck }>;
  Card: Component<{ board: BoardDeck }>;
  /** The check the board may ask of the reader: whether it is asking, where it is drawn, and the way out. */
  check: Pick<TurnstileSource, "asking" | "place" | "skip">;
  Check: Component<{ board: BoardDeck }>;
  /** The flight over: off the board, and everything let go of. */
  leave(): void;
}

const COCKPIT_EVERY_MS = 400;

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Put `pilot`'s flight on the board whose widget is `sitekey`. */
export function joinBoard(pilot: Pilot, sitekey: string): BoardDeck {
  const base = `${v3APIBaseUrl}/air`;
  const tokens = turnstileTokens(sitekey);
  const session = new BoardSession({
    base,
    socketUrl: socketUrl(base, window.location),
    fetch: (input, init) => window.fetch(input, init),
    tokens,
    storage: storage(),
    WebSocket: typeof window.WebSocket === "function" ? window.WebSocket : null,
    now: () => performance.now(),
    setTimeout: (run, ms) => window.setTimeout(run, ms),
    clearTimeout: (timer) => window.clearTimeout(timer as number | undefined),
  });
  let shownAt = -Infinity;
  const cockpit = readable<CockpitScore>({ points: 0, feats: [] }, (set) => pilot.onFrame((telemetry) => {
    const now = performance.now();
    if (now - shownAt < COCKPIT_EVERY_MS) return;
    shownAt = now;
    set({ points: telemetry.score.points, feats: telemetry.score.feats });
  }));
  const stopFrames = pilot.onFrame((telemetry) => session.frame(frameOf(telemetry)));
  const hidden = () => session.pageHidden();
  const shown = (event: PageTransitionEvent) => { if (event.persisted) session.pageShown(); };
  window.addEventListener("pagehide", hidden);
  window.addEventListener("pageshow", shown);
  return {
    view: session.view,
    cockpit,
    open: writable(false),
    Readout: BoardReadout,
    Note: BoardNote,
    Card: BoardCard,
    check: tokens,
    Check: BoardCheck,
    leave() {
      stopFrames();
      window.removeEventListener("pagehide", hidden);
      window.removeEventListener("pageshow", shown);
      session.leave();
    },
  };
}
