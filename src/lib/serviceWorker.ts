import { Workbox } from "workbox-window";
import { unsupportedBrowser } from "./browserSupport";

/**
 * Install the service worker, and reload onto a new one once it takes over.
 *
 * A registration that fails is not the page failing: the network dropping
 * the fetch of sw.js, a browser or an extension that refuses service workers,
 * an automated browser that blocks them -- Workbox then throws reading the
 * registration it never got. The page works without one, so that is a
 * warning, where each entry point used to leave it an unhandled rejection.
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
