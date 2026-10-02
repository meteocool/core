import { startSentry } from "../lib/sentry";
import { screenshotRequested } from "../lib/screenshot";

// A screenshot is a page nobody looks at for long (lib/screenshot.ts): no
// error reports, no service worker, no wakes, no position.
const screenshot = screenshotRequested(window.location.href);

if (import.meta.env.PROD && !screenshot) startSentry();

import { Workbox } from "workbox-window";
import { mount } from "svelte";
import { cleanupNetworkStatus, initNetworkStatus } from "../lib/networkStatus";
import { cleanupRequestTiming, initRequestTiming } from "../lib/requestTiming";
import { cleanupDegradedStatus, initDegradedStatus } from "../lib/degradedStatus";
import { cleanupPageZoomGuard, initPageZoomGuard } from "../lib/pageZoom";
import { cleanupWakeup, initWakeup } from "../lib/wakeup";
import { cleanupRecovery, initRecovery } from "../lib/recovery";
import App from "../App.svelte";
import { i18nReady } from "../locale/i18n";
import { linkPlacesView } from "../lib/urlState";

// Register service worker
if ("serviceWorker" in navigator && import.meta.env.PROD && !screenshot) {
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
if (!screenshot) {
  // After initRequestTiming(): the first evaluation reads that rolling window.
  initDegradedStatus();
  initWakeup();
}
initPageZoomGuard();
initRecovery();
window.addEventListener("pagehide", () => {
  cleanupNetworkStatus();
  cleanupRequestTiming();
  cleanupDegradedStatus();
  cleanupPageZoomGuard();
  cleanupWakeup();
  cleanupRecovery();
});

// Held until the chosen language's strings are in (src/locale/i18n.ts),
// so the first paint is not English for a moment before it switches.
const app = i18nReady.then(() => mount(App, {
  target: document.body,
  props: {
    device: "web",
    postInitCb(layermanager) {
      if ("geolocation" in navigator && !screenshot) {
        navigator.geolocation.getCurrentPosition((position) => {
          // Marked either way; flown to only when the link did not say where
          // to look -- otherwise a shared storm is on screen for the second
          // geolocation takes to answer, and then the map leaves it.
          layermanager.updateLocation(position.coords.latitude, position.coords.longitude, 1, 0, !linkPlacesView());
        });
      }
    },
  },
}));

export default app;
