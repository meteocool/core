/**
 * A flight on meteoair's board: from take-off to landing, what the board is
 * sent and what it says back.
 *
 * At take-off the pilot this browser flies as (becoming one first, where it
 * is none yet) starts a flight on the board; from then on a sample of where
 * the aircraft is goes into the track every second of the flight's clock,
 * and what has gathered is sent every ten seconds, with the feats earned in
 * between. A crash, a landing come to a stop, a new flight in the cockpit
 * (starting again, the next storm) and the page going away each end the
 * board's flight; the cockpit's next one starts another. Meanwhile the
 * day's top twenty come over the board's socket.
 *
 * Nothing here holds up the cockpit: every request is answered in its own
 * time, every failure has its remedy (answers.ts), and where there is no
 * board to be had the flight goes on with the cockpit's score alone.
 *
 * Fed a frame of the flight at a time (`frame`), and given everything it
 * talks to (`BoardDeps`), so it runs the same under test.
 */
import { writable } from "svelte/store";
import type { Readable } from "svelte/store";
import type { Feat } from "../score";
import { backoffMs, isFlightState, retryAfterOf, stepFor } from "./answers";
import type { Answer, Asked } from "./answers";
import { forgetPilot, keepPilot, readPilot } from "./pilotStore";
import type { StoredPilot } from "./pilotStore";
import { afterClose, FRESH_SOCKET } from "./socketPlan";
import type { SocketMemory } from "./socketPlan";
import type { TokenSource } from "./turnstile";
import {
  anything, bodyOf, gather, newClaims, nextBatch, nextSampleAt, NOTHING, putBack, sampleAt, sampleDue, SEND_EVERY_MS, splitOf,
} from "./track";
import type { Gathered } from "./track";
import { NO_BOARD, withFlight, withState, withTop } from "./view";
import type { BoardView } from "./view";
import { DEFAULT_LIMITS } from "./wire";
import type { BoardAnswer, BoardMessage, FlightAnswer, FlightLimits, PilotAnswer } from "./wire";

/** What the session needs of a frame of the cockpit's flight. */
export interface FlightFrame {
  /** Which of the cockpit's flights this is: a new one after every start again, next storm, or crash. */
  flight: number;
  /** Seconds of flight flown in it: faster under warp, still while paused or hidden. */
  flown: number;
  lon: number;
  lat: number;
  /** True altitude, metres above the sea. */
  altitude: number;
  onGround: boolean;
  crashed: boolean;
  /** How fast the last touchdown came down, m/s; null in the air or after none. */
  touchdownSink: number | null;
  /** Landed and come to a stop. */
  stopped: boolean;
  /** The cockpit's score and feats this flight. */
  points: number;
  feats: readonly Feat[];
}

export interface BoardDeps {
  /** The board's base, `<API origin>/v3/air`, and its socket's address. */
  base: string;
  socketUrl: string;
  fetch: typeof fetch;
  tokens: TokenSource;
  storage: Storage | null;
  /** The socket's constructor; null where there is none, and the board is read on a timer. */
  WebSocket: typeof WebSocket | null;
  /** A clock in milliseconds, and timers on it. */
  now: () => number;
  setTimeout: (run: () => void, ms: number) => unknown;
  clearTimeout: (timer: unknown) => void;
}

/** A request that has said nothing for this long is taken as a failed one, ms. */
const REQUEST_MOST_MS = 20_000;
/** Frames this far apart in real time mean the flight was paused or out of sight: a batch goes as soon as it may, ms. */
const AWAY_MS = 2_000;
/** And so soon after, ms: long enough for a sample of the flight resumed to go with it. */
const AWAY_SEND_MS = 1_500;
/** How often an end is tried again when it does not reach the board. */
const END_TRIES = 3;
/** How many times in a row the pilot may be found unknown before the board is given up on for the flight. */
const REPILOTS_MOST = 2;

/** The board's flight under way. */
interface Boarded {
  id: string;
  limits: FlightLimits;
  /** The cockpit's flight it is part of, and how far into it the board's clock starts, s. */
  cockpit: number;
  origin: number;
  /** The cockpit's score when the board's clock started, and its score at each sample's time since. */
  pointsAtOrigin: number;
  pointsAt: Array<[t: number, points: number]>;
  /** When the next sample is due, on the board's clock. */
  nextSample: number;
  feats: readonly Feat[];
  /** The first landing's sink rate, m/s, claimed with the end. */
  landing: number | null;
  wasOnGround: boolean;
  gathered: Gathered;
  /** A batch on its way, not yet answered. */
  sending: Gathered | null;
  /** When the last request went, when the next may at the soonest, ms; failures in a row; at most this many samples, after a 413. */
  sentAt: number;
  notBefore: number;
  failures: number;
  most: number;
  timer: unknown;
  over: boolean;
}

export class BoardSession {
  private readonly state = writable<BoardView>(NO_BOARD);
  readonly view: Readable<BoardView> = { subscribe: this.state.subscribe };

  private pilot: StoredPilot | null;
  private boarded: Boarded | null = null;
  /** The cockpit's flight the board is on, or asked to be; null before the first frame. */
  private cockpit: number | null = null;
  /** Bumped whenever what is under way is let go of: whatever answers after that is for a flight that is gone. */
  private generation = 0;
  private repilots = 0;
  private last: FlightFrame | null = null;
  private lastFrameAt = 0;
  /** Whether the board's flight was ended by the page going away, to start another should the page come back. */
  private endedByPage = false;
  private left = false;

  private socket: WebSocket | null = null;
  private socketMemory: SocketMemory = FRESH_SOCKET;
  private socketTimer: unknown = null;
  private pollTimer: unknown = null;
  private pollEvery = 0;

  private readonly deps: BoardDeps;

  constructor(deps: BoardDeps) {
    this.deps = deps;
    this.pilot = readPilot(deps.storage);
    if (this.pilot) this.patch({ callsign: this.pilot.callsign });
    this.openSocket();
  }

  /** A frame of the cockpit's flight. */
  frame(frame: FlightFrame): void {
    if (this.left) return;
    const now = this.deps.now();
    const away = this.last !== null && now - this.lastFrameAt > AWAY_MS;
    this.last = frame;
    this.lastFrameAt = now;
    if (frame.flight !== this.cockpit) {
      // Another of the cockpit's flights: the last one's ends, and this one goes on the board.
      this.endBoarded(null);
      this.cockpit = frame.flight;
      this.endedByPage = false;
      this.repilots = 0;
      void this.board(frame.flight);
      return;
    }
    const boarded = this.boarded;
    if (!boarded || boarded.over) return;
    const t = frame.flown - boarded.origin;
    if (frame.crashed) {
      // A crash ends it, with no landing.
      this.endBoarded(null);
      return;
    }
    if (sampleDue(boarded.nextSample, t)) {
      boarded.nextSample = nextSampleAt(boarded.nextSample, t);
      boarded.gathered = gather(boarded.gathered, { samples: [sampleAt(t, frame.lon, frame.lat, frame.altitude)] }, boarded.limits);
      boarded.pointsAt.push([t, frame.points]);
      if (boarded.pointsAt.length > 4 * boarded.limits.max_samples) boarded.pointsAt.splice(0, boarded.pointsAt.length - 2 * boarded.limits.max_samples);
    }
    const claims = newClaims(boarded.feats, frame.feats, t);
    boarded.feats = frame.feats;
    if (claims.length) boarded.gathered = gather(boarded.gathered, { feats: claims }, boarded.limits);
    if (frame.onGround && !boarded.wasOnGround && frame.touchdownSink !== null && boarded.landing === null) boarded.landing = frame.touchdownSink;
    boarded.wasOnGround = frame.onGround;
    if (frame.stopped && boarded.landing !== null) {
      this.endBoarded(boarded.landing);
      return;
    }
    // Back from a pause or another tab: what is waiting goes as soon as it may, with the first of the flight since.
    if (away) this.schedule(boarded, AWAY_SEND_MS);
  }

  /** The page going away: the flight ends with what has gathered, on a request that outlives the page. */
  pageHidden(): void {
    const boarded = this.boarded;
    if (!boarded || boarded.over || !this.pilot) return;
    boarded.over = true;
    this.deps.clearTimeout(boarded.timer);
    const gathered = boarded.sending ? putBack(boarded.sending, boarded.gathered, boarded.limits) : boarded.gathered;
    void this.ask("end", `/flights/${boarded.id}/end`, bodyOf(nextBatch(gathered, boarded.limits).batch), true);
    this.endedByPage = true;
    this.generation += 1;
    this.patch({ phase: "over", ended: "ended" });
  }

  /** The page back from the browser's cache after going away: the flight in the cockpit goes on, and so does a new one on the board. */
  pageShown(): void {
    if (this.left || !this.endedByPage || this.cockpit === null) return;
    this.endedByPage = false;
    void this.board(this.cockpit);
  }

  /** The cockpit's flight over: the board's ends, and the board is let go of. */
  leave(): void {
    if (this.left) return;
    this.endBoarded(null);
    this.left = true;
    this.generation += 1;
    this.closeSocket();
    this.deps.tokens.dispose();
  }

  private patch(change: Partial<BoardView>): void {
    this.state.update((view) => ({ ...view, ...change }));
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => { this.deps.setTimeout(resolve, ms); });
  }

  /** A request to the board, and its answer as `stepFor` reads it. */
  private async ask(asked: Asked, path: string, body: unknown, keepalive = false): Promise<Answer> {
    const controller = keepalive ? null : new AbortController();
    const timer = controller ? this.deps.setTimeout(() => controller.abort(), REQUEST_MOST_MS) : null;
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (asked !== "pilot" && this.pilot) headers.Authorization = `Bearer ${this.pilot.pilot}`;
      const response = await this.deps.fetch(`${this.deps.base}${path}`, {
        method: "POST", headers, body: JSON.stringify(body), keepalive, signal: controller?.signal, credentials: "omit",
      });
      const answer = await response.json().catch(() => null) as unknown;
      return { kind: "http", status: response.status, retryAfterS: retryAfterOf(response.headers.get("Retry-After"), Date.now()), body: answer };
    } catch {
      return { kind: "network" };
    } finally {
      if (timer !== null) this.deps.clearTimeout(timer);
    }
  }

  /** A fresh Turnstile token; null where none can be had, which leaves this flight off the board. */
  private async token(): Promise<string | null> {
    try {
      return await this.deps.tokens.token();
    } catch {
      return null;
    }
  }

  /** Put the cockpit's flight `cockpit` on the board: a pilot first, where there is none, then a flight. */
  private async board(cockpit: number): Promise<void> {
    const generation = ++this.generation;
    const current = () => generation === this.generation && !this.left && this.cockpit === cockpit;
    this.patch({ phase: "joining", points: null, rank: null, granted: [], refused: [], ended: null });
    const unavailable = () => { if (current()) this.patch({ phase: "unavailable" }); };
    let failures = 0;
    let tokenRetried = false;
    const retry = async (step: { do: string; ms?: number }) => {
      failures = step.do === "backoff" ? failures + 1 : failures;
      if (step.do === "backoff") this.patch({ reachable: false });
      await this.wait(step.do === "wait" ? step.ms! : backoffMs(failures));
    };

    while (!this.pilot) {
      const token = await this.token();
      if (!current()) return;
      if (token === null) return unavailable();
      const answer = await this.ask("pilot", "/pilots", { turnstile: token });
      if (!current()) return;
      const step = stepFor(answer, "pilot", tokenRetried);
      if (step.do === "take") {
        const made = step.body as Partial<PilotAnswer> | null;
        if (typeof made?.pilot !== "string" || typeof made.callsign !== "string") return unavailable();
        this.pilot = { pilot: made.pilot, callsign: made.callsign };
        keepPilot(this.deps.storage, this.pilot);
        this.patch({ callsign: made.callsign, reachable: true });
      } else if (step.do === "token") {
        tokenRetried = true;
      } else if (step.do === "wait" || step.do === "backoff") {
        await retry(step);
        if (!current()) return;
      } else {
        return unavailable();
      }
    }

    tokenRetried = false;
    failures = 0;
    for (;;) {
      const token = await this.token();
      if (!current()) return;
      if (token === null) return unavailable();
      const answer = await this.ask("start", "/flights", { turnstile: token });
      if (!current()) return;
      const step = stepFor(answer, "start", tokenRetried);
      if (step.do === "take") {
        const started = step.body as Partial<FlightAnswer> | null;
        if (typeof started?.flight !== "string") return unavailable();
        this.repilots = 0;
        this.takeOff(started as FlightAnswer, cockpit);
        return;
      }
      if (step.do === "token") {
        tokenRetried = true;
      } else if (step.do === "repilot") {
        this.forget();
        if (this.repilots > REPILOTS_MOST) return unavailable();
        // From the start, with the generation this one holds.
        this.generation -= 1;
        return this.board(cockpit);
      } else if (step.do === "wait" || step.do === "backoff") {
        await retry(step);
        if (!current()) return;
      } else {
        return unavailable();
      }
    }
  }

  /** The pilot is unknown to this board: forgotten here too. */
  private forget(): void {
    this.repilots += 1;
    this.pilot = null;
    forgetPilot(this.deps.storage);
  }

  /** On the board: its clock starts now, at the seconds the cockpit has flown so far. */
  private takeOff(started: FlightAnswer, cockpit: number): void {
    const frame = this.last;
    const limits = { ...DEFAULT_LIMITS, ...(started.limits ?? {}) };
    this.boarded = {
      id: started.flight, limits, cockpit, origin: frame?.flown ?? 0, pointsAtOrigin: frame?.points ?? 0, pointsAt: [],
      nextSample: 0, feats: frame?.feats ?? [], landing: null, wasOnGround: frame?.onGround ?? false,
      gathered: NOTHING, sending: null, sentAt: this.deps.now(), notBefore: 0, failures: 0, most: Infinity, timer: null, over: false,
    };
    const callsign = started.callsign ?? this.pilot?.callsign ?? "";
    if (this.pilot && callsign && callsign !== this.pilot.callsign) {
      this.pilot = { ...this.pilot, callsign };
      keepPilot(this.deps.storage, this.pilot);
    }
    this.state.update((view) => withFlight(view, started.flight, callsign));
    this.schedule(this.boarded, SEND_EVERY_MS);
  }

  /** The next batch, in `ms` or as soon after as the board allows. */
  private schedule(boarded: Boarded, ms: number): void {
    if (boarded.over) return;
    this.deps.clearTimeout(boarded.timer);
    const now = this.deps.now();
    const soonest = Math.max(boarded.notBefore, boarded.sentAt + boarded.limits.batch_interval_s * 1000);
    boarded.timer = this.deps.setTimeout(() => void this.send(boarded), Math.max(ms, soonest - now, 0));
  }

  /** The cockpit's score at the board's clock `t`, from the board's start. */
  private cockpitAt(boarded: Boarded, t: number): number | null {
    // The samples' clock is rounded to the hundredth as it is sent.
    let points: number | null = null;
    for (const [sampled, then] of boarded.pointsAt) if (sampled <= t + 0.01) points = then;
    return points === null ? null : points - boarded.pointsAtOrigin;
  }

  private async send(boarded: Boarded): Promise<void> {
    boarded.timer = null;
    if (boarded.over || boarded.sending || this.boarded !== boarded) return;
    if (!anything(boarded.gathered)) {
      this.schedule(boarded, SEND_EVERY_MS);
      return;
    }
    const { batch, rest } = nextBatch(boarded.gathered, boarded.limits, boarded.most);
    boarded.gathered = rest;
    boarded.sending = batch;
    boarded.sentAt = this.deps.now();
    const answer = await this.ask("track", `/flights/${boarded.id}/track`, bodyOf(batch));
    boarded.sending = null;
    if (boarded.over || this.boarded !== boarded || this.left) return;
    const step = stepFor(answer, "track");
    const keep = () => { boarded.gathered = putBack(batch, boarded.gathered, boarded.limits); };
    switch (step.do) {
      case "take": {
        if (!isFlightState(step.body)) break;
        const newest = batch.samples.at(-1)?.[0];
        this.state.update((view) => withState(view, step.body as never, newest === undefined ? view.cockpitThen : this.cockpitAt(boarded, newest)));
        boarded.failures = 0;
        boarded.most = Infinity;
        if (step.body.ended) {
          boarded.over = true;
          return;
        }
        break;
      }
      case "wait":
        keep();
        boarded.notBefore = this.deps.now() + step.ms;
        this.schedule(boarded, step.ms);
        return;
      case "backoff":
        keep();
        boarded.failures += 1;
        this.patch({ reachable: false });
        this.schedule(boarded, backoffMs(boarded.failures));
        return;
      case "split":
        keep();
        boarded.most = splitOf(batch.samples.length);
        this.schedule(boarded, 0);
        return;
      case "over":
        boarded.over = true;
        if (step.state) this.state.update((view) => withState(view, step.state!));
        else this.patch({ phase: "over" });
        return;
      case "repilot":
        boarded.over = true;
        this.forget();
        if (this.repilots > REPILOTS_MOST) this.patch({ phase: "unavailable" });
        else void this.board(boarded.cockpit);
        return;
      case "restart":
        boarded.over = true;
        void this.board(boarded.cockpit);
        return;
      default:
        boarded.over = true;
        this.patch({ phase: "unavailable" });
        return;
    }
    this.schedule(boarded, SEND_EVERY_MS);
  }

  /**
   * End the board's flight, with the landing where there was one: what has
   * gathered goes with it, and so does a batch still on its way, whose
   * samples the board ignores where it has them already. A start still
   * under way is let go of; the board ends it with the next.
   */
  private endBoarded(landing: number | null): void {
    const boarded = this.boarded;
    if (!boarded) {
      // Not on the board yet: whatever is asking for it is for a flight that is over.
      this.generation += 1;
      return;
    }
    this.boarded = null;
    if (boarded.over) return;
    boarded.over = true;
    this.deps.clearTimeout(boarded.timer);
    const gathered = boarded.sending ? putBack(boarded.sending, boarded.gathered, boarded.limits) : boarded.gathered;
    const body = bodyOf(nextBatch(gathered, boarded.limits).batch, landing === null ? null : { sink: landing });
    const newest = body.samples?.at(-1)?.[0];
    const cockpitThen = newest === undefined ? null : this.cockpitAt(boarded, newest);
    const generation = this.generation;
    void (async () => {
      for (let tries = 1; ; tries += 1) {
        const answer = await this.ask("end", `/flights/${boarded.id}/end`, body);
        const step = stepFor(answer, "end");
        // What it says is shown only while nothing newer is on the board.
        const shown = () => generation === this.generation && !this.left;
        if ((step.do === "take" || step.do === "over") && shown()) {
          const state = step.do === "take" ? step.body : step.state;
          if (isFlightState(state)) this.state.update((view) => withState(view, state, cockpitThen ?? view.cockpitThen));
          else this.patch({ phase: "over", ended: "ended" });
        }
        if ((step.do !== "wait" && step.do !== "backoff") || tries >= END_TRIES) {
          if (shown() && step.do !== "take" && step.do !== "over") this.patch({ phase: "over", ended: "ended" });
          return;
        }
        await this.wait(step.do === "wait" ? step.ms : backoffMs(tries));
      }
    })();
    this.patch({ phase: "over" });
  }

  /* The day's top twenty: on the board's socket, or read on a timer where it cannot be had. */

  private openSocket(): void {
    if (this.left) return;
    const Socket = this.deps.WebSocket;
    if (!Socket) {
      this.poll(30_000);
      return;
    }
    let opened = false;
    let openedAt = 0;
    let socket: WebSocket;
    try {
      socket = new Socket(this.deps.socketUrl);
    } catch {
      this.afterSocket(false, 1006, 0);
      return;
    }
    this.socket = socket;
    socket.onopen = () => {
      opened = true;
      openedAt = this.deps.now();
      this.socketMemory = { ...this.socketMemory, failedOpens: 0 };
      this.stopPolling();
    };
    socket.onmessage = (event: MessageEvent) => {
      let message: BoardMessage | null = null;
      try {
        message = JSON.parse(String(event.data)) as BoardMessage;
      } catch {
        return;
      }
      if (message?.type === "board") this.state.update((view) => withTop(view, message as BoardAnswer, true));
    };
    socket.onclose = (event: CloseEvent) => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.afterSocket(opened, event.code, opened ? this.deps.now() - openedAt : 0);
    };
  }

  private afterSocket(opened: boolean, code: number, openMs: number): void {
    if (this.left) return;
    const { step, memory } = afterClose({ opened, code, openMs }, this.socketMemory);
    this.socketMemory = memory;
    this.patch({ live: false });
    if (step.then === "reopen") {
      this.socketTimer = this.deps.setTimeout(() => this.openSocket(), step.afterMs);
      return;
    }
    this.poll(step.everyMs);
    this.socketTimer = this.deps.setTimeout(() => this.openSocket(), step.retrySocketMs);
  }

  private poll(everyMs: number): void {
    if (this.pollTimer !== null && this.pollEvery === everyMs) return;
    this.stopPolling();
    this.pollEvery = everyMs;
    const read = async () => {
      try {
        const response = await this.deps.fetch(`${this.deps.base}/board`, { credentials: "omit" });
        const answer = await response.json() as BoardAnswer;
        if (response.ok && this.pollTimer !== null && !this.left) this.state.update((view) => withTop(view, answer, false));
      } catch {
        // Read again on the next turn.
      }
    };
    const turn = () => {
      void read();
      this.pollTimer = this.deps.setTimeout(turn, everyMs);
    };
    turn();
  }

  private stopPolling(): void {
    if (this.pollTimer !== null) this.deps.clearTimeout(this.pollTimer);
    this.pollTimer = null;
    this.pollEvery = 0;
  }

  private closeSocket(): void {
    this.deps.clearTimeout(this.socketTimer);
    this.socketTimer = null;
    this.stopPolling();
    const socket = this.socket;
    this.socket = null;
    try {
      socket?.close(1000);
    } catch {
      // Closed already.
    }
  }
}
