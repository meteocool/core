/**
 * The day's board on a socket, and what to do when it closes.
 *
 * The board's socket sends the top twenty when it opens and whenever they
 * change. At midnight UTC it says the day is over and closes (4000): opened
 * again at once, for the new day's board. Any other close is reopened after
 * a few seconds, longer each time it happens again. A socket that never
 * opened was refused or could not be reached; a browser cannot tell which,
 * so the board is read on a timer meanwhile, every ten seconds and every
 * thirty once it has failed again and again, and the socket tried again
 * after a minute, then after five.
 */

/** The close code that ends the day's board. */
export const DAY_OVER = 4000;

/** How the socket has fared: openings that failed in a row, and reopenings after closes in a row. */
export interface SocketMemory {
  failedOpens: number;
  reopens: number;
}

export const FRESH_SOCKET: SocketMemory = { failedOpens: 0, reopens: 0 };

/** Open this long, a socket's next close is taken as the first in a row again, ms. */
const STEADY_MS = 60_000;
/** Failed to open this many times in a row, the board is read less often and the socket tried less often. */
const MANY_FAILURES = 3;

export type SocketStep =
  | { then: "reopen"; afterMs: number }
  | { then: "poll"; everyMs: number; retrySocketMs: number };

/** What to do once the socket has closed: `opened` whether it ever opened, `code` its close code, `openMs` how long it was open. */
export function afterClose(
  { opened, code, openMs }: { opened: boolean; code: number; openMs: number },
  memory: SocketMemory,
): { step: SocketStep; memory: SocketMemory } {
  if (opened && code === DAY_OVER) return { step: { then: "reopen", afterMs: 0 }, memory: FRESH_SOCKET };
  if (opened) {
    const reopens = openMs >= STEADY_MS ? 1 : memory.reopens + 1;
    return { step: { then: "reopen", afterMs: Math.min(60_000, 3_000 * 2 ** (reopens - 1)) }, memory: { failedOpens: 0, reopens } };
  }
  const failedOpens = memory.failedOpens + 1;
  const many = failedOpens >= MANY_FAILURES;
  return {
    step: { then: "poll", everyMs: many ? 30_000 : 10_000, retrySocketMs: many ? 300_000 : 60_000 },
    memory: { failedOpens, reopens: memory.reopens },
  };
}

/** The socket's address for the board's path: the same host as the API, ws(s) for http(s); a relative base is the page's own host. */
export function socketUrl(boardBase: string, page: { protocol: string; host: string }): string {
  const url = new URL(`${boardBase}/board`, `${page.protocol}//${page.host}`);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.href;
}
