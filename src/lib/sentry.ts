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

// The `v4-web` project, which only staging and demo report to: the old
// production build still reports to `web`, and its issues are not ours.
const DSN = "https://9527d5ff2482249661ee40aa73c7c7e7@o347743.ingest.us.sentry.io/4512206228750336";

type Early = { kind: "error"; error: unknown } | { kind: "rejection"; reason: unknown };
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

async function init(): Promise<void> {
  let Sentry: typeof import("./sentryClient");
  try {
    Sentry = await import("./sentryClient");
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
  window.removeEventListener("error", onError);
  window.removeEventListener("unhandledrejection", onRejection);
  for (const item of early.splice(0)) {
    Sentry.captureException(item.kind === "error" ? item.error : item.reason);
  }
}
