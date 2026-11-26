/**
 * What the meteoair board API sends and takes, under `<API origin>/v3/air`.
 * All JSON; an error is `{"detail": "..."}`; a pilot's credential goes in
 * `Authorization: Bearer <pilot>` and nowhere else.
 */
import type { Feat } from "../score";

/** A position of the aircraft: the flight's clock (s), longitude and latitude (degrees), true altitude (m above the sea). */
export type Sample = [t: number, lon: number, lat: number, altitude: number];

/** A feat the cockpit earned, at the flight's clock it was earned at. */
export interface FeatClaim {
  feat: Feat;
  t: number;
}

/** `POST /pilots`, 201. */
export interface PilotAnswer {
  pilot: string;
  callsign: string;
}

/** The flight's limits, as `POST /flights` gives them. */
export interface FlightLimits {
  batch_interval_s: number;
  max_samples: number;
  max_bytes: number;
  max_feats: number;
  flight_s: number;
  max_refused: number;
}

/** `POST /flights`, 201. */
export interface FlightAnswer {
  flight: string;
  started_at: string;
  callsign: string;
  limits: FlightLimits;
}

/** Why a flight is over: its pilot ended it, or the board did (its track refused, its time up, unheard, another flight started). */
export type EndReason = "ended" | "refused" | "time" | "idle" | "replaced";

/** A flight's state: the answer to a batch, to an end, and the body of a 409. */
export interface FlightState {
  flight: string;
  points: number;
  rank: number | null;
  feats: string[];
  clock: number;
  refused_total: number;
  ended: { at: string; reason: EndReason } | null;
  granted?: string[];
  claims_refused?: Array<{ feat: string }>;
}

/** A batch of the track, and the end of a flight, which may carry its landing. */
export interface TrackBody {
  samples?: Sample[];
  feats?: FeatClaim[];
  clock?: number;
  landing?: { sink: number };
}

/** One of the day's top twenty. */
export interface BoardEntry {
  rank: number;
  callsign: string;
  points: number;
  feats: string[];
  flying: boolean;
  flight: string;
}

/** `GET /board`, and the socket's `board` message. */
export interface BoardAnswer {
  day: string;
  top: BoardEntry[];
}

export type BoardMessage = ({ type: "board" } & BoardAnswer) | { type: "day_over" };

/** The flight's limits until a start has said them. */
export const DEFAULT_LIMITS: FlightLimits = {
  batch_interval_s: 5, max_samples: 64, max_bytes: 8192, max_feats: 8, flight_s: 3600, max_refused: 60,
};
