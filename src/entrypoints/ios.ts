import { startSentry } from "../lib/sentry";

if (import.meta.env.PROD) startSentry();

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
initRequestTiming();
// After initRequestTiming(): the first evaluation reads that rolling window.
initDegradedStatus();
initPageZoomGuard();
initWakeup();
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
    device: "ios",
    postInitCb() {
      if (dd.isIos()) {
        window.webkit?.messageHandlers.scriptHandler.postMessage("requestSettings");
      }
    },
  },
}));

export default app;
