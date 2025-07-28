import * as Sentry from "@sentry/browser";

export const SENTRY_ARGS = {
  dsn: import.meta.env.VITE_SENTRY_DSN || "",
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
