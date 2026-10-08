import { startSentry } from "../lib/sentry";
import { screenshotRequested } from "../lib/screenshot";

// A screenshot is a page nobody looks at for long (lib/screenshot.ts): no
// error reports, no service worker, no wakes, no position.
const screenshot = screenshotRequested(window.location.href);

if (import.meta.env.PROD && !screenshot) startSentry();

import { registerServiceWorker } from "../lib/serviceWorker";
import { mount } from "svelte";
import { cleanupNetworkStatus, initNetworkStatus } from "../lib/networkStatus";
import { cleanupRequestTiming, initRequestTiming } from "../lib/requestTiming";
import { cleanupDegradedStatus, initDegradedStatus } from "../lib/degradedStatus";
import { cleanupConnectionStatus, initConnectionStatus } from "../lib/connectionStatus";
import { cleanupPageZoomGuard, initPageZoomGuard } from "../lib/pageZoom";
import { cleanupWakeup, initWakeup } from "../lib/wakeup";
import { cleanupRecovery, initRecovery } from "../lib/recovery";
import App from "../App.svelte";
import { i18nReady } from "../locale/i18n";
import { unsupportedBrowser } from "../lib/browserSupport";
import { linkPlacesView } from "../lib/urlState";

if (import.meta.env.PROD && !screenshot) registerServiceWorker();

initNetworkStatus();
initRequestTiming();
if (!screenshot) {
  // After initRequestTiming(): the first evaluation reads that rolling window.
  initDegradedStatus();
  // After initDegradedStatus() and initNetworkStatus(): the machine reads both verdicts.
  initConnectionStatus();
  initWakeup();
}
initPageZoomGuard();
initRecovery();
window.addEventListener("pagehide", () => {
  cleanupNetworkStatus();
  cleanupRequestTiming();
  cleanupDegradedStatus();
  cleanupConnectionStatus();
  cleanupPageZoomGuard();
  cleanupWakeup();
  cleanupRecovery();
});

// Held until the chosen language's strings are in (src/locale/i18n.ts),
// so the first paint is not English for a moment before it switches. Not at
// all where the page has said the browser cannot run it (src/browserCheck.js).
const app = unsupportedBrowser ? null : i18nReady.then(() => mount(App, {
  target: document.body,
  props: {
    device: "web",
    postInitCb(layermanager) {
      if ("geolocation" in navigator && !screenshot) {
        navigator.geolocation.getCurrentPosition((position) => {
          // Marked either way, but flown to only when the link did not say
          // where to look. Otherwise a shared storm is on screen for the second
          // geolocation takes to answer, and then the map leaves it.
          layermanager.updateLocation(position.coords.latitude, position.coords.longitude, 1, 0, !linkPlacesView());
        });
      }
    },
  },
}));

export default app;
