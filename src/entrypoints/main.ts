import * as Sentry from "@sentry/browser";
import SENTRY_ARGS from "../lib/sentry";

if (import.meta.env.PROD) {
  Sentry.init(SENTRY_ARGS);
}

import { Workbox } from "workbox-window";
import { mount } from "svelte";
import { cleanupNetworkStatus, initNetworkStatus } from "../lib/networkStatus";
import { cleanupRequestTiming, initRequestTiming } from "../lib/requestTiming";
import { cleanupDegradedStatus, initDegradedStatus } from "../lib/degradedStatus";
import { cleanupPageZoomGuard, initPageZoomGuard } from "../lib/pageZoom";
import { cleanupWakeup, initWakeup } from "../lib/wakeup";
import App from "../App.svelte";
import { linkPlacesView } from "../lib/urlState";

// Register service worker
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  const wb = new Workbox("sw.js");
  wb.addEventListener("controlling", (evt) => {
    if (evt.isUpdate) {
      console.log("Reloading page for latest content");
      window.location.reload();
    }
  });
  try {
    wb.register();
  } catch (error) {
    console.log(error);
  }
}

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
    device: "web",
    postInitCb(layermanager) {
      if ("geolocation" in navigator) {
        navigator.geolocation.getCurrentPosition((position) => {
          // Marked either way; flown to only when the link did not say where
          // to look -- otherwise a shared storm is on screen for the second
          // geolocation takes to answer, and then the map leaves it.
          layermanager.updateLocation(position.coords.latitude, position.coords.longitude, 1, 0, !linkPlacesView());
        });
      }
    },
  },
});

export default app;
