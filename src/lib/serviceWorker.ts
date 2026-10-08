import { Workbox } from "workbox-window";
import { unsupportedBrowser } from "./browserSupport";

/**
 * Install the service worker, and reload onto a new one once it takes over.
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
  wb.addEventListener("controlling", (evt) => {
    if (evt.isUpdate) {
      console.log("Reloading page for latest content");
      window.location.reload();
    }
  });
  wb.register().catch((error) => console.warn("Service worker not registered", error));
}
