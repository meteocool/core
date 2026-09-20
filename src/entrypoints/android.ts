import * as Sentry from "@sentry/browser";
import SENTRY_ARGS from "../lib/sentry";

Sentry.init(SENTRY_ARGS);

import { Workbox } from "workbox-window";
import { mount } from "svelte";
import { cleanupNetworkStatus, initNetworkStatus } from "../lib/networkStatus";
import { cleanupRequestTiming, initRequestTiming } from "../lib/requestTiming";
import { cleanupDegradedStatus, initDegradedStatus } from "../lib/degradedStatus";
import { cleanupPageZoomGuard, initPageZoomGuard } from "../lib/pageZoom";
import { cleanupWakeup, initWakeup } from "../lib/wakeup";
import App from "../App.svelte";
import { DeviceDetect as dd } from "../lib/DeviceDetect";

initNetworkStatus();
initRequestTiming();
// After initRequestTiming(): the first evaluation reads that rolling window.
initDegradedStatus();
initPageZoomGuard();
initWakeup();
window.addEventListener("pagehide", () => {
  cleanupNetworkStatus();
  cleanupRequestTiming();
  cleanupDegradedStatus();
  cleanupPageZoomGuard();
  cleanupWakeup();
});

const app = mount(App, {
  target: document.body,
  props: {
    device: "android",
    postInitCb() {
      if (dd.isAndroid()) {
        Android?.requestSettings();
      }
    },
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
