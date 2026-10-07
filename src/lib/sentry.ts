/**
 * Error reporting, started once the page is up rather than before it.
 *
 * The SDK is a tenth of the app's JavaScript, and it used to be parsed and
 * initialised before the map could start. Now it is a chunk of its own,
 * fetched after `load` when the browser is idle. Errors thrown before then are
 * kept and handed to it, so nothing from the startup path is lost -- which is
 * where most of the interesting ones happen.
 *
 * Tracing is sampled at one visit in twenty. At 1.0 every visit uploaded a
 * page-load transaction with a span per tile request, tens of kilobytes on a
 * phone for a number that only needs a sample to be right.
 */
import type { BrowserOptions } from "@sentry/browser";
import { unsupportedBrowser } from "./browserSupport";
import { failureKind } from "./shownFailure";
import { isAbort } from "./timedFetch";

// The `v4-web` project, which only staging and demo report to: the old
// production build still reports to `web`, and its issues are not ours.
const DSN = "https://9527d5ff2482249661ee40aa73c7c7e7@o347743.ingest.us.sentry.io/4512206228750336";

type Shown = { surface: string; error: unknown; context: Record<string, unknown> };
type Early = { kind: "error"; error: unknown } | { kind: "rejection"; reason: unknown } | ({ kind: "shown" } & Shown);
const early: Early[] = [];
/** Held at most, for a page that cannot fetch the SDK for a while: the first ones are the telling ones. */
const EARLY_KEPT = 50;
const keep = (item: Early) => { if (early.length < EARLY_KEPT) early.push(item); };
const onError = (event: ErrorEvent) => { keep({ kind: "error", error: event.error ?? event.message }); };
const onRejection = (event: PromiseRejectionEvent) => { keep({ kind: "rejection", reason: event.reason }); };

/**
 * Whether this is somebody's test rather than a reader's visit: a build served
 * from a machine of our own (an emulator reaches it as 10.0.2.2), or a browser
 * driven by automation, the profiling and screenshot harnesses among them.
 * What goes wrong there is about the harness -- a service worker it blocks, no
 * GPU, a backend the build was never pointed at -- and it was a quarter of
 * the issues the current code raised.
 */
function testRun(): boolean {
  const host = window.location.hostname;
  return navigator.webdriver === true
    || host === "localhost" || host.endsWith(".localhost") || host === "[::1]"
    || /^(127|10)\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./.test(host);
}

/** Start reporting when the browser has time for it; safe to call more than once. */
export function startSentry(): void {
  if (typeof window === "undefined" || started || unsupportedBrowser || testRun()) return;
  started = true;
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  const go = () => {
    const idle = window.requestIdleCallback ?? ((cb: () => void) => setTimeout(cb, 1));
    idle(() => { void init(); });
  };
  if (document.readyState === "complete") go();
  else window.addEventListener("load", go, { once: true });
}

let started = false;
let sentry: typeof import("@sentry/browser") | null = null;

/**
 * A failure the reader was shown -- "The 3D map could not be loaded", "Volume
 * unavailable", a Retry button -- reported under the surface it was shown on.
 *
 * Grouped by surface and kind of failure (lib/shownFailure.ts) rather than by
 * message, and a warning rather than an error: the page coped, but a reader
 * saw it fail, and that is worth finding out about. Not reported: a request
 * called off on purpose, and a failure while the browser knows it is offline,
 * which no change of ours would have prevented. A few of each kind a page,
 * since a Retry or a wake asks again and fails the same way. Where reporting
 * is off -- a local build, a test run -- it goes to the console instead.
 *
 * Only for what a reader sees fail and we could fix: not the status pill,
 * whose offline and degraded are the network's and the backend's weather
 * rather than a bug, and which the API client already reports where it is one.
 */
export function reportShown(surface: string, error: unknown, context: Record<string, unknown> = {}): void {
  if (isAbort(error)) return;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;
  const kind = failureKind(error);
  const key = `${surface}/${kind}`;
  const count = (reported.get(key) ?? 0) + 1;
  reported.set(key, count);
  if (count > SHOWN_KEPT) return;
  const shown = { surface, error, context };
  if (sentry) sendShown(sentry, shown);
  else if (started) keep({ kind: "shown", ...shown });
  else console.warn(`Shown to the reader (${surface}, ${kind}):`, error, context);
}

/** Reports a page of each surface and kind: the first say what it is, the rest how often, which the counts below do not need. */
const SHOWN_KEPT = 3;
const reported = new Map<string, number>();

function sendShown(client: typeof import("@sentry/browser"), { surface, error, context }: Shown): void {
  const kind = failureKind(error);
  client.captureException(error instanceof Error ? error : new Error(String(error)), {
    level: "warning",
    tags: { shown: surface, failure: kind },
    fingerprint: ["shown", surface, kind],
    contexts: { shown: { surface, kind, ...context } },
  });
}

async function init(): Promise<void> {
  let Sentry: typeof import("@sentry/browser");
  try {
    Sentry = await import("@sentry/browser");
  } catch {
    // Offline at load, most likely: the errors are kept, and handed over once
    // the network is back and the chunk with it.
    window.addEventListener("online", () => { void init(); }, { once: true });
    return;
  }
  const options: BrowserOptions = {
    dsn: DSN,
    integrations: [
      Sentry.browserTracingIntegration({
        // socket.io's long polls, one after the other by design: as spans they
        // only had Sentry flag the page for requests it could have run at once.
        shouldCreateSpanForRequest: (url) => !url.includes("/socket.io/"),
      }),
      Sentry.captureConsoleIntegration({ levels: ["error"] }),
    ],
    tracesSampleRate: 0.05,
    // Not ours to fix: Cloudflare's analytics beacon, which the edge puts in
    // every page and which throws on browsers too old for it, and extensions.
    denyUrls: [
      /cloudflareinsights\.com/,
      /\/beacon\.min\.js/,
      /^(chrome|moz|safari(-web)?)-extension:\/\//,
    ],
    environment: import.meta.env.MODE,
    // Empty in a local build; set from COMMIT_REF or GITHUB_SHA in CI.
    release: __GIT_COMMIT_HASH__ || undefined,
  };
  Sentry.init(options);
  sentry = Sentry;
  window.removeEventListener("error", onError);
  window.removeEventListener("unhandledrejection", onRejection);
  for (const item of early.splice(0)) {
    if (item.kind === "shown") sendShown(Sentry, item);
    else Sentry.captureException(item.kind === "error" ? item.error : item.reason);
  }
}
