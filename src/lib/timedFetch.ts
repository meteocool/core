/**
 * fetch(), but a request that has stopped moving is given up on.
 *
 * The browser never does. A request on a train, a captive portal or a mobile
 * link that has gone quiet without dropping waits for the operating system's
 * TCP timeout, which takes minutes, and everything that awaits it waits too: the
 * loading bar stays pinned, "Refreshing…" stays up, and the next refresh
 * either queues behind it or is never asked for. The network coming back does
 * not help a request that was sent into the hole before it did.
 *
 * Stalled, not slow: the clock is how long nothing has arrived, reset by the
 * headers and again by every chunk of the body. A storm's volume coming down
 * a 2G link at a few kilobytes a second is never cut off for taking long, and
 * a request that has sent nothing at all for STALL_MS is not a slow one.
 *
 * The rejection is a `RequestStalled`, so a caller can tell "this timed out"
 * from its own abort, and from a server that answered with an error.
 */

import { noteAbandoned } from "./requestTiming";

/** How long without a byte (before the headers, or between chunks) is a stall. */
export const STALL_MS = 15_000;

export class RequestStalled extends Error {
  readonly url: string;

  constructor(url: string, ms: number) {
    super(`${url} stalled: nothing for ${Math.round(ms / 1000)}s`);
    this.name = "RequestStalled";
    this.url = url;
  }
}

const urlOf = (input: RequestInfo | URL): string => (
  typeof input === "string" ? input : input instanceof URL ? input.href : input.url
);

/**
 * Whether a failure says the network is unreliable rather than the request is wrong.
 *
 * What a retry or a later resync can fix: a stall, a connection that failed or
 * dropped (fetch's TypeError), and any 5xx. Not only the gateway answers a
 * proxy or CDN gives when it could not reach the backend: a proxy that loses
 * the connection to the backend halfway answers a plain 500 (Vite's dev
 * server does), and every call this is used for is a GET, safe to repeat.
 */
export function isTransient(error: unknown, status?: number): boolean {
  if (status !== undefined) return status === 408 || status === 429 || status >= 500;
  return error instanceof RequestStalled || error instanceof TypeError;
}

/** Whether the caller itself called this request off. */
export function isAbort(error: unknown): boolean {
  return (error as { name?: string } | null)?.name === "AbortError";
}

export async function timedFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
  stallMs: number = STALL_MS,
): Promise<Response> {
  const url = urlOf(input);
  const controller = new AbortController();
  let stalled = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const disarm = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const arm = () => {
    disarm();
    timer = setTimeout(() => {
      stalled = true;
      controller.abort();
    }, stallMs);
  };

  // The caller's own signal still works, and wins: aborting the request means
  // whatever it means to them, not a stall.
  const outer = init.signal ?? (input instanceof Request ? input.signal : undefined);
  if (outer?.aborted) controller.abort();
  const forward = () => controller.abort();
  outer?.addEventListener("abort", forward, { once: true });
  const release = () => {
    disarm();
    outer?.removeEventListener("abort", forward);
  };

  const translate = (error: unknown): unknown => (stalled ? new RequestStalled(url, stallMs) : error);

  // Its timing entry is recorded all the same, and is not a response time;
  // see noteAbandoned.
  const startedAt = typeof performance === "undefined" ? 0 : performance.now();
  controller.signal.addEventListener("abort", () => {
    if (!stalled) return;
    const absolute = typeof location === "undefined" ? url : new URL(url, location.href).href;
    noteAbandoned(absolute, startedAt);
  }, { once: true });

  arm();
  let response: Response;
  try {
    response = await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    release();
    throw translate(error);
  }
  disarm();
  if (!response.body) {
    release();
    return response;
  }

  // The clock runs only while a chunk is being waited for, so a caller that
  // is slow to read is never mistaken for a network that is slow to send.
  const source = response.body.getReader();
  const body = new ReadableStream<Uint8Array>({
    async pull(sink) {
      arm();
      try {
        const { done, value } = await source.read();
        disarm();
        if (done) {
          release();
          sink.close();
        } else {
          sink.enqueue(value);
        }
      } catch (error) {
        release();
        sink.error(translate(error));
      }
    },
    cancel(reason) {
      release();
      return source.cancel(reason);
    },
  });
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
