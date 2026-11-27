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
 *
 * And, while the flight is on the board, its airspace: the other aircraft
 * near it (lib/studio/flight/airspace/session.ts), their callsigns over
 * them (TrafficLabels) and their marks on the chart. What draws them, and
 * the model they are drawn as, come only once one has been heard
 * (trafficDraw.ts).
 */
import { get, readable, writable } from "svelte/store";
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
import TrafficLabels from "./TrafficLabels.svelte";
import { flightStatus } from "../../../../lib/studio/store";
import { broken } from "../../../../lib/studio/flight/damage";
import { AirspaceSession } from "../../../../lib/studio/flight/airspace/session";
import { blankOwn, writeOwn } from "../../../../lib/studio/flight/airspace/own";
import { sharedOf } from "../../../../lib/studio/flight/airspace/shared";
import type { TrafficShared } from "../../../../lib/studio/flight/airspace/shared";
import { syntheticSky } from "../../../../lib/studio/flight/airspace/synthetic";
import { airspaceUrl } from "../../../../lib/studio/flight/airspace/wire";

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
  /** The other aircraft of the airspace: what is heard of them and what was drawn, and the callsigns over the near ones. */
  traffic: TrafficShared;
  Labels: Component<{ board: BoardDeck; pilot: Pilot }>;
  /** The flight over: off the board, and everything let go of. */
  leave(): void;
}

const COCKPIT_EVERY_MS = 400;
/** The most aircraft a synthetic sky (`?traffic=`) is filled with. */
const SYNTHETIC_MOST = 1000;

/** How many aircraft the page asks its sky be filled with, for measuring: `?traffic=300`; none without. */
function syntheticCount(): number {
  const asked = Number(new URLSearchParams(window.location.search).get("traffic"));
  return Number.isInteger(asked) && asked > 0 ? Math.min(asked, SYNTHETIC_MOST) : 0;
}

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
  const airspace = new AirspaceSession({
    socketUrl: airspaceUrl(base, window.location),
    WebSocket: typeof window.WebSocket === "function" ? window.WebSocket : null,
    now: () => performance.now(),
    setTimeout: (run, ms) => window.setTimeout(run, ms),
    clearTimeout: (timer) => window.clearTimeout(timer as number | undefined),
  });
  const traffic = sharedOf(airspace.traffic);
  const own = blankOwn();
  let ownWritten = false;
  let status = get(flightStatus);
  const stopStatus = flightStatus.subscribe((next) => { status = next; });
  let stopDrawing: (() => void) | null = null;
  let left = false;
  /** What draws the aircraft, fetched once the first has been heard. */
  const drawWhenHeard = () => {
    if (traffic.renderer !== "none" || !traffic.traffic.list.length) return;
    traffic.renderer = "loading";
    import("./trafficDraw").then(({ drawTraffic }) => drawTraffic(pilot, traffic)).then((stop) => {
      if (left) {
        stop();
        return;
      }
      stopDrawing = stop;
      traffic.renderer = "ready";
    }, (error: unknown) => {
      traffic.renderer = "failed";
      console.warn("The other aircraft cannot be drawn", error);
    });
  };
  const stopFrames = pilot.onFrame((telemetry) => {
    session.frame(frameOf(telemetry));
    writeOwn(own, telemetry, status, pilot.airframe);
    ownWritten = true;
    airspace.frame(own, Boolean(telemetry.state.crash) || broken(pilot.airframe), session.onBoard());
    drawWhenHeard();
  });
  const synthetic = syntheticCount();
  const stopSynthetic = synthetic ? syntheticSky(synthetic, airspace.traffic, () => (ownWritten ? own : null), () => performance.now(), (run, ms) => {
    const timer = window.setInterval(run, ms);
    return () => window.clearInterval(timer);
  }) : null;
  // Within reach of the console and of a test: what is heard, and what was drawn of it last frame.
  (window as unknown as { flightTraffic?: object }).flightTraffic = {
    get heard() { return traffic.traffic.list.length; },
    get drawn() { return { ...traffic.drawn }; },
    get charted() { return traffic.charted; },
    get renderer() { return traffic.renderer; },
    get labels() { return traffic.labels.filter((label) => label.shown).map((label) => label.callsign); },
    get joined() { return airspace.id; },
  };
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
    traffic,
    Labels: TrafficLabels,
    leave() {
      left = true;
      stopFrames();
      stopStatus();
      stopSynthetic?.();
      airspace.leave();
      stopDrawing?.();
      stopDrawing = null;
      delete (window as unknown as { flightTraffic?: object }).flightTraffic;
      window.removeEventListener("pagehide", hidden);
      window.removeEventListener("pageshow", shown);
      session.leave();
    },
  };
}
