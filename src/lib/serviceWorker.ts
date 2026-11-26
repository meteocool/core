import { Workbox } from "workbox-window";
import { unsupportedBrowser } from "./browserSupport";
import { updatesHeld, updatesHeldNow } from "./updateHold";

/** What a new worker asks the pages as it installs, and what a page tells a waiting one; see src/sw.ts. */
const ASK_UPDATE = "MAY_UPDATE";

/**
 * Install the service worker, and reload onto a new one once it takes over.
 * Not while updates are held (lib/updateHold.ts): a new worker asks the
 * pages as it installs, waits while one holds, and is let in once none does.
 *
 * Registration can fail while the page is fine: the network drops the fetch
 * of sw.js, a browser or an extension refuses service workers, or an automated
 * browser blocks them. Workbox then throws reading the registration it never
 * got. The page works without one, so the failure is logged as a warning, not
 * left as an unhandled rejection.
 */
export function registerServiceWorker(): void {
  if (!("serviceWorker" in navigator) || unsupportedBrowser) return;
  const wb = new Workbox("sw.js");
  let reloadOwed = false;
  wb.addEventListener("controlling", (evt) => {
    if (!evt.isUpdate) return;
    // Taken over all the same (another tab let it in): the reload waits for the hold to end.
    if (updatesHeldNow()) {
      reloadOwed = true;
      return;
    }
    console.log("Reloading page for latest content");
    window.location.reload();
  });
  // A worker waiting, from before this page or held back by it: let in now unless something holds.
  wb.addEventListener("waiting", () => {
    if (!updatesHeldNow()) wb.messageSkipWaiting();
  });
  // The new worker's question as it installs: whether this page holds updates back.
  navigator.serviceWorker.addEventListener("message", (event) => {
    if (event.data?.type !== ASK_UPDATE) return;
    event.ports[0]?.postMessage({ hold: updatesHeldNow() });
  });
  navigator.serviceWorker.startMessages();
  updatesHeld.subscribe((held) => {
    if (held) return;
    if (reloadOwed) {
      window.location.reload();
      return;
    }
    wb.messageSkipWaiting();
  });
  wb.register().catch((error) => console.warn("Service worker not registered", error));
}
