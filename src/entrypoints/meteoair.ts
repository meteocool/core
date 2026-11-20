/**
 * The flight's own page (meteoair.html): the app's radar map filling the
 * window with nothing over it, the page's words on top
 * (components/meteoair/Landing.svelte), and the flight a button away.
 *
 * A page for a browser on a desktop, where index.html is as much the map the
 * apps wrap: nothing here asks where the reader is, and the app's own chrome
 * is never made (`studioFlightOnly`). The same page is index.html opened at
 * `#meteoair` (lib/studio/flightPage.ts).
 */
import { startSentry } from "../lib/sentry";

if (import.meta.env.PROD) startSentry();

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
import { enterFlightPage, showFlightPage } from "../lib/studio/flightPage";
import type { LayerManager } from "../lib/LayerManager";

if (import.meta.env.PROD) registerServiceWorker();

// Before the app is made: it is built without its chrome from the start.
enterFlightPage();

initNetworkStatus();
initRequestTiming();
// After initRequestTiming(): the first evaluation reads that rolling window.
initDegradedStatus();
// After initDegradedStatus() and initNetworkStatus(): the machine reads both verdicts.
initConnectionStatus();
initWakeup();
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

// Held until the chosen language's strings are in (src/locale/i18n.ts). Not
// at all where the page has said the browser cannot run it (src/browserCheck.js).
const app = unsupportedBrowser ? null : i18nReady.then(() => {
  let layerManager: LayerManager | null = null;
  const mounted = mount(App, {
    target: document.body,
    props: {
      device: "web",
      postInitCb(made: LayerManager) { layerManager = made; },
    },
  });
  // After the app, whose map it stands over and switches.
  if (layerManager) void showFlightPage(layerManager);
  return mounted;
});

export default app;
