/**
 * The cockpit on the airspace of the meteoair board API: while a flight is
 * on the board, a socket that says where this aircraft is and hears where
 * the others near it are. For drawing them only: nothing on it counts for
 * the score.
 *
 * The socket is opened once the board has started a flight, and `join`ed
 * with the board's pilot credential (in that frame and nowhere else) and
 * the board's flight; joined again, on the same socket, for each new board
 * flight. The aircraft's state goes as often as the airspace asks, from a
 * timer rather than the cockpit's frames, so a paused flight (which has
 * none) still says where it stands. A flight the board has ended is said
 * `leave` to, but a wreck is still sent for a few seconds first, so the
 * others see it come down. A close is answered as its code says (plan.ts);
 * nothing here ever holds up the flight or the board.
 *
 * Given everything it talks to (`AirspaceDeps`), so it runs the same under
 * test, and the frames it is fed are written in place by its caller.
 */
import { afterClose, FRESH, FrameBudget, sendEveryMs } from "./plan";
import type { SocketMemory } from "./plan";
import { Traffic } from "./traffic";
import { DEFAULT_LIMITS, encodeState, limitsOf, PAUSED, readMessage, STATE_BYTES } from "./wire";
import type { AirspaceLimits, OwnState } from "./wire";

export interface AirspaceDeps {
  socketUrl: string;
  /** The socket's constructor; null where there is none, and then there is no airspace. */
  WebSocket: typeof WebSocket | null;
  now: () => number;
  setTimeout: (run: () => void, ms: number) => unknown;
  clearTimeout: (timer: unknown) => void;
}

/** Which of the board's flights the cockpit is on, and as which pilot. */
export interface Boarded {
  pilot: string;
  flight: string;
}

/** With no frame from the cockpit for this long, its flight is paused (or out of sight): said so, standing still, ms. */
const STILL_AFTER_MS = 700;
/** A wreck is sent this long after the board's flight has ended, ms: the others see it come down and burn. */
const WRECK_MS = 12_000;
/** Joined to nothing this long, the socket is let go of; the next flight opens another, ms. */
const IDLE_MS = 45_000;

export class AirspaceSession {
  readonly traffic = new Traffic();
  /** Our own id and callsign in the airspace, once joined. */
  id: number | null = null;
  callsign: string | null = null;

  private readonly deps: AirspaceDeps;
  private socket: WebSocket | null = null;
  private opened = false;
  private openedAt = 0;
  private memory: SocketMemory = FRESH;
  private reopenTimer: unknown = null;
  private sendTimer: unknown = null;
  private idleTimer: unknown = null;
  private limits: AirspaceLimits = DEFAULT_LIMITS;
  private everyMs = 1000;
  private budget = new FrameBudget(DEFAULT_LIMITS.frames_per_s_most);
  private counter = 0;
  private readonly bytes = new DataView(new ArrayBuffer(STATE_BYTES));

  /** The board's flight wanted on the airspace; the one joined on the socket; and the one the airspace has said no more to. */
  private wanted: Boarded | null = null;
  private joined: string | null = null;
  private refused: string | null = null;
  /** Until when a wreck is still sent after its board flight ended, on the page's clock. */
  private wreckUntil = -Infinity;
  /** The cockpit's newest state, and when it came. */
  private own: OwnState | null = null;
  private ownAt = -Infinity;
  private crashed = false;
  private left = false;
  private readonly heardListeners = new Set<() => void>();

  constructor(deps: AirspaceDeps) {
    this.deps = deps;
  }

  /** Be told each time a snapshot has been heard. */
  onHeard(listener: () => void): () => void {
    this.heardListeners.add(listener);
    return () => this.heardListeners.delete(listener);
  }

  /**
   * A frame of the cockpit's flight: its aircraft's state (`own`, kept, and
   * read again when the next state goes: written in place by the caller),
   * whether it has crashed or broken up, and the board's flight it is on,
   * null for none.
   */
  frame(own: OwnState, crashed: boolean, boarded: Boarded | null): void {
    if (this.left) return;
    this.own = own;
    this.ownAt = this.deps.now();
    this.crashed = crashed;
    if (boarded && (boarded.flight !== this.wanted?.flight || boarded.pilot !== this.wanted.pilot)) this.want(boarded);
    else if (!boarded && this.wanted) this.unwant();
  }

  /** The flight over: off the airspace, and the socket let go of. */
  leave(): void {
    if (this.left) return;
    this.sayLeave();
    this.left = true;
    this.wanted = null;
    for (const timer of [this.reopenTimer, this.sendTimer, this.idleTimer]) this.deps.clearTimeout(timer);
    this.close();
    this.traffic.clear();
  }

  private want(boarded: Boarded): void {
    this.wanted = { ...boarded };
    this.wreckUntil = -Infinity;
    this.deps.clearTimeout(this.idleTimer);
    this.idleTimer = null;
    // A new board flight: whatever the airspace said of the last is past.
    if (boarded.flight !== this.refused) this.refused = null;
    if (this.refused) return;
    if (this.socket && this.opened) this.sayJoin();
    else if (!this.socket && this.reopenTimer === null) this.open();
  }

  /** The board's flight over: a wreck is sent on a while, the rest is left at once. */
  private unwant(): void {
    this.wanted = null;
    if (this.crashed && this.joined) this.wreckUntil = this.deps.now() + WRECK_MS;
    else this.sayLeave();
  }

  private open(): void {
    const Socket = this.deps.WebSocket;
    if (!Socket || this.left || !this.wanted || this.socket) return;
    this.opened = false;
    let socket: WebSocket;
    try {
      socket = new Socket(this.deps.socketUrl);
    } catch {
      this.closed(false, 1006, 0);
      return;
    }
    socket.binaryType = "arraybuffer";
    this.socket = socket;
    socket.onopen = () => {
      if (this.socket !== socket) return;
      this.opened = true;
      this.openedAt = this.deps.now();
      this.memory = { ...this.memory, failedOpens: 0 };
      if (this.wanted) this.sayJoin();
      else this.close();
    };
    socket.onmessage = (event: MessageEvent) => {
      if (this.socket !== socket) return;
      if (typeof event.data === "string") this.told(event.data);
      else if (event.data instanceof ArrayBuffer) {
        if (this.traffic.hear(event.data, this.deps.now()) >= 0) for (const listener of this.heardListeners) listener();
      }
    };
    socket.onclose = (event: CloseEvent) => {
      if (this.socket !== socket) return;
      const wasOpen = this.opened;
      this.socket = null;
      this.opened = false;
      this.closed(wasOpen, event.code, wasOpen ? this.deps.now() - this.openedAt : 0);
    };
  }

  private told(data: string): void {
    const message = readMessage(data);
    if (!message) return;
    switch (message.type) {
      case "joined":
        this.id = Number.isInteger(message.id) ? message.id : null;
        this.callsign = typeof message.callsign === "string" ? message.callsign : null;
        this.limits = limitsOf(message.limits);
        this.budget = new FrameBudget(this.limits.frames_per_s_most);
        this.traffic.setLimits(this.limits);
        this.everyMs = sendEveryMs(message.send_hz, this.limits.send_hz_most);
        this.schedule();
        break;
      case "rate":
        this.everyMs = sendEveryMs(message.send_hz, this.limits.send_hz_most);
        this.schedule();
        break;
      case "names":
        if (message.names && typeof message.names === "object") this.traffic.name(message.names);
        break;
      case "ended":
        // The board says this flight is over: nothing more is heard of it until the next join.
        this.joined = null;
        this.wreckUntil = -Infinity;
        this.idle();
        break;
    }
  }

  private closed(opened: boolean, code: number, openMs: number): void {
    this.joined = null;
    this.id = null;
    this.deps.clearTimeout(this.sendTimer);
    this.sendTimer = null;
    if (this.left) return;
    const { step, memory } = afterClose({ opened, code, openMs }, this.memory);
    this.memory = memory;
    if (step.then === "nextFlight") {
      // Not this flight again; the board's next one is tried afresh.
      this.refused = this.wanted?.flight ?? null;
      return;
    }
    this.reopenTimer = this.deps.setTimeout(() => {
      this.reopenTimer = null;
      this.open();
    }, step.afterMs);
  }

  private sayJoin(): void {
    const wanted = this.wanted;
    if (!wanted || !this.socket || !this.opened) return;
    if (this.joined === wanted.flight) return;
    // A join always goes: the frame budget keeps room for it.
    this.sendText({ type: "join", pilot: wanted.pilot, flight: wanted.flight });
    this.joined = wanted.flight;
    this.schedule();
  }

  private sayLeave(): void {
    if (this.joined && this.socket && this.opened) this.sendText({ type: "leave" });
    this.joined = null;
    this.idle();
  }

  /** Joined to nothing: the socket is let go of after a while, unless a flight comes. */
  private idle(): void {
    this.deps.clearTimeout(this.idleTimer);
    this.idleTimer = this.deps.setTimeout(() => {
      this.idleTimer = null;
      if (!this.wanted && !this.joined) this.close();
    }, IDLE_MS);
  }

  private sendText(message: object): void {
    try {
      this.socket?.send(JSON.stringify(message));
      this.budget.took(this.deps.now());
    } catch {
      // Closing: its close says what next.
    }
  }

  private schedule(): void {
    this.deps.clearTimeout(this.sendTimer);
    this.sendTimer = this.joined ? this.deps.setTimeout(() => this.tick(), this.everyMs) : null;
  }

  private tick(): void {
    this.sendTimer = null;
    if (this.left || !this.joined) return;
    const now = this.deps.now();
    if (!this.wanted && now >= this.wreckUntil) {
      this.sayLeave();
      return;
    }
    this.sendState(now);
    this.schedule();
  }

  private sendState(now: number): void {
    const own = this.own;
    if (!own || !this.socket || !this.opened || !this.budget.may(now)) return;
    // No frame for a while: paused or out of sight, and standing still.
    const still = now - this.ownAt > STILL_AFTER_MS;
    const flags = own.flags;
    const [east, north, up] = [own.east, own.north, own.up];
    if (still) {
      own.flags |= PAUSED;
      own.east = 0;
      own.north = 0;
      own.up = 0;
    }
    encodeState(own, this.counter, this.bytes);
    own.flags = flags;
    own.east = east;
    own.north = north;
    own.up = up;
    this.counter = (this.counter + 1) & 0xffff;
    try {
      this.socket.send(this.bytes.buffer);
      this.budget.took(now);
    } catch {
      // As above.
    }
  }

  private close(): void {
    const socket = this.socket;
    this.socket = null;
    this.opened = false;
    this.joined = null;
    this.deps.clearTimeout(this.sendTimer);
    this.sendTimer = null;
    try {
      socket?.close(1000);
    } catch {
      // Closed already.
    }
  }
}
