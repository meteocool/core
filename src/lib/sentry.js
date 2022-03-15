import { Integrations } from "@sentry/tracing";
import { CaptureConsole } from "@sentry/integrations";

export const SENTRY_ARGS = {
  dsn: "https://ee86f8a6a22f4b7fb267b01e22c07d1e@o347743.ingest.sentry.io/5481137",
  integrations: [new Integrations.BrowserTracing(), new CaptureConsole({ levels: ["error"] })],
  tracesSampleRate: 1.0,
  environment: process.env.NODE_ENV,
  autoSessionTracking: false,
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
