import * as Sentry from "@sentry/browser";
import SENTRY_ARGS from "./lib/sentry";

Sentry.init(SENTRY_ARGS);

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
