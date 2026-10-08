/**
 * What kind of failure a reader was shown, for grouping them in Sentry.
 *
 * Each "could not be loaded" line with a Retry button is reported
 * (`reportShown` in lib/sentry.ts) under the surface it was shown on and one of
 * these kinds. Without that, the component logged the error to the console at
 * most, and nothing left the reader's browser. Grouping by kind makes an issue
 * read "the CAPPI, a chunk that would not load" instead of one issue per error
 * message, URL and browser wording.
 */

export type FailureKind = "chunk" | "network" | "stalled" | "webgl" | `http-${number}` | "other";

/* Every browser words the same failure its own way: Chrome's "Failed to
   fetch", Firefox's "NetworkError when attempting to fetch resource", Safari's
   "Load failed", none of which says anything in particular. */
const NETWORK = /failed to fetch|networkerror|load failed|network connection was lost|internet connection appears to be offline/i;
/* A chunk of the app's own: what a tab that outlived the deploy it came from
   asks for, or a first open on a network that is down. */
const CHUNK = /dynamically imported module|importing a module script failed|unable to preload css|chunkloaderror|loading chunk/i;

export function failureKind(error: unknown): FailureKind {
  const named = error as { name?: unknown; message?: unknown; status?: unknown } | null;
  const message = typeof named?.message === "string" ? named.message : String(error);
  if (typeof named?.status === "number") return `http-${named.status}`;
  if (named?.name === "RequestStalled" || named?.name === "TimeoutError") return "stalled";
  if (CHUNK.test(message)) return "chunk";
  if (NETWORK.test(message)) return "network";
  if (/webgl/i.test(message)) return "webgl";
  return "other";
}
