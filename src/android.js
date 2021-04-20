import * as Sentry from "@sentry/browser";
import { Integrations } from "@sentry/tracing";
import { CaptureConsole } from "@sentry/integrations";

Sentry.init({
  dsn: "https://ee86f8a6a22f4b7fb267b01e22c07d1e@o347743.ingest.sentry.io/5481137",
  integrations: [new Integrations.BrowserTracing(), new CaptureConsole({ levels: ["error"] })],
  tracesSampleRate: 1.0,
  environment: process.env.NODE_ENV,
  autoSessionTracking: false,
  release: GIT_COMMIT_HASH,
});

import { Workbox } from "workbox-window";
import App from "./App.svelte";

const app = new App({
  target: document.body,
  props: {
    device: "android",
  },
});

export default app;

// Register service worker
if ("serviceWorker" in navigator) {
  const wb = new Workbox("sw.js");
  wb.addEventListener("controlling", (evt) => {
    if (evt.isUpdate) {
      console.log("Reloading page for latest content");
      window.location.reload();
    }
  });
  wb.register();
}
