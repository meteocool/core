import * as Sentry from "@sentry/browser";

export const SENTRY_ARGS = {
  dsn: "https://ee86f8a6a22f4b7fb267b01e22c07d1e@o347743.ingest.sentry.io/5481137",
  integrations: [
    Sentry.browserTracingIntegration(),
    Sentry.captureConsoleIntegration({ levels: ["error"] }),
  ],
  tracesSampleRate: 1.0,
  environment: import.meta.env.MODE,
  // Empty in a local build; set from COMMIT_REF or GITHUB_SHA in CI.
  release: __GIT_COMMIT_HASH__ || undefined,
};

export { SENTRY_ARGS as default };
