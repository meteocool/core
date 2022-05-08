import * as Sentry from "@sentry/browser";
import SENTRY_ARGS from "../lib/sentry.js";

Sentry.init(SENTRY_ARGS);

// eslint-disable-next-line import/order
import { Workbox } from "workbox-window";
import App from "../App.svelte";
import { DeviceDetect as dd } from "../lib/DeviceDetect";

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

const app = new App({
  target: document.body,
  props: {
    device: "ios",
    postInitCb() {
      if (dd.isIos()) {
        window.webkit.messageHandlers.scriptHandler.postMessage("requestSettings");
      }
    },
  },
});

export default app;
