import * as Sentry from "@sentry/browser";
import SENTRY_ARGS from "../lib/sentry";

Sentry.init(SENTRY_ARGS);

import { Workbox } from "workbox-window";
import { mount } from "svelte";
import { cleanupNetworkStatus, initNetworkStatus } from "../lib/networkStatus";
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

initNetworkStatus();
window.addEventListener("pagehide", cleanupNetworkStatus);

const app = mount(App, {
  target: document.body,
  props: {
    device: "ios",
    postInitCb() {
      if (dd.isIos()) {
        window.webkit?.messageHandlers.scriptHandler.postMessage("requestSettings");
      }
    },
  },
});

export default app;
