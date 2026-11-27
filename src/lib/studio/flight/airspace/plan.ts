/**
 * When the airspace's socket is opened, how often the cockpit's state goes
 * on it, and what to do when it closes.
 *
 * A socket that never opened was refused or could not be reached: a
 * browser cannot tell which, so it is tried again after 30 s, then after
 * twice as long each time, up to five minutes. A socket that closes says why
 * in its code, and each code has its remedy (`afterClose`). None of it ever
 * holds the flight or the board up.
 */

/** A socket that never opened is tried again after this long, doubling each time up to the most, ms. */
export const OPEN_AGAIN_MS = 30_000;
export const OPEN_AGAIN_MOST_MS = 300_000;
/** A socket that closed for no reason of the cockpit's is opened again after this long, doubling, up to the most, ms. */
export const REOPEN_MS = 3_000;
export const REOPEN_MOST_MS = 60_000;
/** Open and joined this long, the next close is taken as the first in a row again, ms. */
export const STEADY_MS = 60_000;

/** The close codes the airspace says why with. */
export const CLOSE = {
  unreadable: 4400,
  unknown: 4401,
  silent: 4408,
  elsewhere: 4409,
  tooMany: 4429,
  unflyable: 4403,
} as const;

/** How the socket has fared: openings that failed in a row, and reopenings in a row. */
export interface SocketMemory {
  failedOpens: number;
  reopens: number;
}

export const FRESH: SocketMemory = { failedOpens: 0, reopens: 0 };

/**
 * After a close: open again in so long; wait for the board's next flight
 * (`nextFlight`), and open for that; or do nothing more for this one
 * (`notThisFlight`): what the board's next flight does is the same.
 */
export type CloseStep =
  | { then: "reopen"; afterMs: number }
  | { then: "nextFlight" };

/**
 * What to do once the socket has closed: `opened` whether it ever opened,
 * `code` its close code, `openMs` how long it was open. The code's table:
 * a frame it could not read, frames too often, states it would not take,
 * and another tab with the same pilot all leave this flight off the
 * airspace; a flight the airspace does not know is joined again once the
 * board has started another; anything else (silence, a restart, the
 * network) is opened again, backing off.
 */
export function afterClose(
  { opened, code, openMs }: { opened: boolean; code: number; openMs: number },
  memory: SocketMemory,
): { step: CloseStep; memory: SocketMemory } {
  if (!opened) {
    const failedOpens = memory.failedOpens + 1;
    return {
      step: { then: "reopen", afterMs: Math.min(OPEN_AGAIN_MOST_MS, OPEN_AGAIN_MS * 2 ** (failedOpens - 1)) },
      memory: { failedOpens, reopens: memory.reopens },
    };
  }
  switch (code) {
    case CLOSE.unreadable:
    case CLOSE.tooMany:
    case CLOSE.unflyable:
    case CLOSE.elsewhere:
    case CLOSE.unknown:
      return { step: { then: "nextFlight" }, memory: FRESH };
    case CLOSE.silent:
      return { step: { then: "reopen", afterMs: 0 }, memory: { failedOpens: 0, reopens: memory.reopens } };
    default: {
      const reopens = openMs >= STEADY_MS ? 1 : memory.reopens + 1;
      return { step: { then: "reopen", afterMs: Math.min(REOPEN_MOST_MS, REOPEN_MS * 2 ** (reopens - 1)) }, memory: { failedOpens: 0, reopens } };
    }
  }
}

/** How often to send, as the airspace asks: held to what it allows at most, and never slower than once in five seconds. */
export function sendEveryMs(sendHz: unknown, mostHz: number): number {
  const asked = typeof sendHz === "number" && Number.isFinite(sendHz) && sendHz > 0 ? sendHz : 1;
  return 1000 / Math.min(Math.max(asked, 0.2), Math.max(mostHz, 0.2));
}

/**
 * The frames sent in the last second, as a ring of when: whether another
 * may go now without passing `most` a second. One fewer than the most is
 * kept for: a `join` or a `leave` must always find room.
 */
export class FrameBudget {
  private readonly sent: number[];
  private next = 0;

  constructor(most: number) {
    this.sent = Array.from({ length: Math.max(1, Math.floor(most)) }, () => -Infinity);
  }

  /** Whether a state may go at `now` (ms); a text frame passes `spare` and may take the last place. */
  may(now: number, spare = false): boolean {
    let within = 0;
    for (const at of this.sent) if (now - at < 1000) within += 1;
    return within < this.sent.length - (spare ? 0 : 1);
  }

  took(now: number): void {
    this.sent[this.next] = now;
    this.next = (this.next + 1) % this.sent.length;
  }
}
