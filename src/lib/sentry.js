import * as Sentry from "@sentry/browser";

export const SENTRY_ARGS = {
  dsn: "https://ee86f8a6a22f4b7fb267b01e22c07d1e@o347743.ingest.sentry.io/5481137",
  integrations: [
    Sentry.browserTracingIntegration(),
    Sentry.captureConsoleIntegration({ levels: ["error"] })
  ],
  tracesSampleRate: 1.0,
  environment: process.env.NODE_ENV,
  autoSessionTracking: true,
  release: GIT_COMMIT_HASH,
  autoBreadcrumbs: {
    xhr: true,
    console: true,
    dom: true,
    location: false,
    sentry: true,
  },
};

export { SENTRY_ARGS as default };
