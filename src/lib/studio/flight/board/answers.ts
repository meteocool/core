/**
 * What to do with each answer the board gives, or with none: the board's
 * failures, each with its remedy. Whatever the board says, the flight goes
 * on in the cockpit; these decide only what happens to the board's side.
 */
import type { FlightState } from "./wire";

/** An answer as the browser has it: none (a network error, or a refusal without CORS), or a status, its Retry-After in seconds and its body. */
export type Answer = { kind: "network" } | { kind: "http"; status: number; retryAfterS: number | null; body: unknown };

/** Which request it answers: becoming a pilot and starting a flight take a Turnstile token, a batch and an end do not. */
export type Asked = "pilot" | "start" | "track" | "end";

export type Step =
  /** Taken: carry on with what it said. */
  | { do: "take"; body: unknown }
  /** Asked again, as it was, after so long; what gathers meanwhile goes with it. */
  | { do: "wait"; ms: number }
  /** Asked again after the next of a growing wait (`backoffMs`). */
  | { do: "backoff" }
  /** The pilot is not known here: forget it, become a pilot again, start a new flight. */
  | { do: "repilot" }
  /** Turnstile refused the token: a new one, once; after that, `unavailable`. */
  | { do: "token" }
  /** No board for this flight: the cockpit's score alone. */
  | { do: "unavailable" }
  /** No such flight: start a new one. */
  | { do: "restart" }
  /** The flight is over; its final state. */
  | { do: "over"; state: FlightState | null }
  /** Too much in one batch: send it in halves. */
  | { do: "split" };

/** The longest the board's Retry-After is waited, s: anything longer is backed off from instead. */
const RETRY_AFTER_MOST_S = 600;

/** Whether a body is a flight's state. */
export function isFlightState(body: unknown): body is FlightState {
  const state = body as Partial<FlightState> | null;
  return typeof state === "object" && state !== null && typeof state.flight === "string" && typeof state.points === "number";
}

/**
 * What to do with `answer` to `asked`; `tokenRetried` whether this request
 * already went again with a fresh token after a 403.
 */
export function stepFor(answer: Answer, asked: Asked, tokenRetried = false): Step {
  if (answer.kind === "network") return { do: "backoff" };
  const { status, retryAfterS, body } = answer;
  const waitable = retryAfterS !== null && retryAfterS >= 0 && retryAfterS <= RETRY_AFTER_MOST_S;
  if (status >= 200 && status < 300) return { do: "take", body };
  if (status === 429 || status === 503) return waitable ? { do: "wait", ms: Math.max(1, retryAfterS) * 1000 } : { do: "backoff" };
  if (status === 401) return { do: "repilot" };
  if (status === 403) {
    // A batch and an end carry no token: their 403 is the board refusing this page outright.
    if (asked === "track" || asked === "end" || tokenRetried) return { do: "unavailable" };
    return { do: "token" };
  }
  if (status === 404) return asked === "track" || asked === "end" ? { do: "restart" } : { do: "unavailable" };
  if (status === 409) return { do: "over", state: isFlightState(body) ? body : null };
  if (status === 413) return { do: "split" };
  if (status >= 500) return { do: "backoff" };
  // A 400, or anything else: a request the board will never take as it is.
  return { do: "unavailable" };
}

/** The waits after one network failure after another, ms: ten seconds, doubling, a minute at most. */
export function backoffMs(failures: number): number {
  return Math.min(60_000, 10_000 * 2 ** Math.max(0, failures - 1));
}

/** Seconds in a Retry-After header: a number of seconds, or a date, from `now` (ms); null for none or nonsense. */
export function retryAfterOf(header: string | null, now: number): number | null {
  if (header === null || header.trim() === "") return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds);
  const at = Date.parse(header);
  return Number.isFinite(at) ? Math.max(0, (at - now) / 1000) : null;
}
