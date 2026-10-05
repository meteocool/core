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
import { DeviceDetect as dd } from "../lib/DeviceDetect";

registerServiceWorker();

initNetworkStatus();
initRequestTiming();
// After initRequestTiming(): the first evaluation reads that rolling window.
initDegradedStatus();
// After initDegradedStatus() and initNetworkStatus(): the machine reads both verdicts.
initConnectionStatus();
initPageZoomGuard();
initWakeup();
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
