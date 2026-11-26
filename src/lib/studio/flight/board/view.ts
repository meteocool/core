/**
 * What the cockpit shows of the board: this flight's score as the board
 * works it out, where it stands, which of the cockpit's feats the board has
 * granted, why the board stopped counting a flight, and the day's top
 * twenty with the pilot's own entry marked. Each answer is merged in here.
 */
import type { Feat } from "../score";
import type { BoardAnswer, BoardEntry, EndReason, FlightState } from "./wire";

/**
 * Where the board stands for this flight: getting on it, on it, over
 * (`ended` says why), or not to be had for this flight (Turnstile refused,
 * the board refused the page): then the cockpit's score is all there is.
 */
export type BoardPhase = "joining" | "flying" | "over" | "unavailable";

export interface BoardView {
  phase: BoardPhase;
  /** The pilot's name on the board; null until it has one. */
  callsign: string | null;
  /** The board's score for this flight, and where it stands among the other pilots' best today (null below a full board); null until it has said. */
  points: number | null;
  rank: number | null;
  /** The cockpit's own score as of the newest position the board has answered for: what the board's is compared with. */
  cockpitThen: number | null;
  /** The feats the board granted this flight, and those it would not: those stay the cockpit's alone. */
  granted: Feat[];
  refused: Feat[];
  /** Why this flight is over, once it is. */
  ended: EndReason | null;
  /** Whether the last request reached the board; false while it is being tried again. */
  reachable: boolean;
  /** The day's top twenty, and the day; empty until the board has been read. */
  day: string | null;
  top: BoardEntry[];
  /** Whether the top twenty come over the socket as they change, or are read on a timer. */
  live: boolean;
  /** The pilot's flights this page has started: what marks their entry on the board. */
  flights: string[];
}

export const NO_BOARD: BoardView = {
  phase: "joining", callsign: null, points: null, rank: null, cockpitThen: null, granted: [], refused: [], ended: null, reachable: true,
  day: null, top: [], live: false, flights: [],
};

const FEAT_NAMES: readonly Feat[] = ["stElmo", "hail", "lightning", "iced", "severe", "core", "landed", "butter"];
const feats = (names: readonly string[] | undefined): Feat[] => (names ?? []).filter((name): name is Feat => FEAT_NAMES.includes(name as Feat));

/** A new flight on the board: its id kept, its score and feats not yet said. */
export function withFlight(view: BoardView, flight: string, callsign: string): BoardView {
  return {
    ...view, phase: "flying", callsign, points: 0, rank: null, cockpitThen: 0, granted: [], refused: [], ended: null, reachable: true,
    flights: view.flights.includes(flight) ? view.flights : [...view.flights, flight],
  };
}

/** A flight's state, as a batch, an end or a 409 answered it; `cockpitThen` the cockpit's score at the newest position it answered for. */
export function withState(view: BoardView, state: FlightState, cockpitThen: number | null = view.cockpitThen): BoardView {
  const granted = [...new Set([...view.granted, ...feats(state.feats), ...feats(state.granted)])];
  const refusedNow = feats(state.claims_refused?.map((claim) => claim.feat));
  const refused = [...new Set([...view.refused, ...refusedNow])].filter((feat) => !granted.includes(feat));
  return {
    ...view,
    phase: state.ended ? "over" : view.phase === "joining" ? "flying" : view.phase,
    points: state.points,
    rank: state.rank,
    cockpitThen,
    granted,
    refused,
    ended: state.ended?.reason ?? view.ended,
    reachable: true,
  };
}

/** The day's top twenty, from the socket or a read of the board. */
export function withTop(view: BoardView, answer: BoardAnswer, live: boolean): BoardView {
  return { ...view, day: answer.day, top: Array.isArray(answer.top) ? answer.top.slice(0, 20) : [], live };
}

/** Whether an entry on the board is the pilot's own: one of the flights this page started, or their callsign. */
export function isOwn(entry: BoardEntry, view: Pick<BoardView, "flights" | "callsign">): boolean {
  return view.flights.includes(entry.flight) || (view.callsign !== null && entry.callsign === view.callsign);
}

/** How a feat the cockpit earned stands on the board: granted, refused (the cockpit's alone), or not yet said. */
export function featStanding(feat: Feat, view: Pick<BoardView, "granted" | "refused">): "board" | "cockpit" | "checking" {
  if (view.granted.includes(feat)) return "board";
  if (view.refused.includes(feat)) return "cockpit";
  return "checking";
}

/** Why the board stopped counting this flight, where it was the board that did: not the pilot's own end, nor none. */
export function stoppedBy(view: Pick<BoardView, "ended">): Exclude<EndReason, "ended"> | null {
  return view.ended && view.ended !== "ended" ? view.ended : null;
}

/**
 * Whether the two scores differ by enough to say so: by more than fifty
 * points and more than a twentieth. The board's batches arrive behind the
 * cockpit, so a few seconds' points apart is not a difference.
 */
export function scoresDiffer(cockpit: number, board: number | null): boolean {
  if (board === null) return false;
  const gap = Math.abs(cockpit - board);
  return gap > 50 && gap > 0.05 * Math.max(cockpit, board);
}
