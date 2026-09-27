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

const DSN = "https://ee86f8a6a22f4b7fb267b01e22c07d1e@o347743.ingest.sentry.io/5481137";

type Early = { kind: "error"; error: unknown } | { kind: "rejection"; reason: unknown };
const early: Early[] = [];
const onError = (event: ErrorEvent) => { early.push({ kind: "error", error: event.error ?? event.message }); };
const onRejection = (event: PromiseRejectionEvent) => { early.push({ kind: "rejection", reason: event.reason }); };

/** Start reporting when the browser has time for it; safe to call more than once. */
export function startSentry(): void {
  if (typeof window === "undefined" || started) return;
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
  const Sentry = await import("@sentry/browser");
  const options: BrowserOptions = {
    dsn: DSN,
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.captureConsoleIntegration({ levels: ["error"] }),
    ],
    tracesSampleRate: 0.05,
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
