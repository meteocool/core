import * as Sentry from "@sentry/browser";
import SENTRY_ARGS from "../lib/sentry";

if (import.meta.env.PROD) {
  Sentry.init(SENTRY_ARGS);
}

import { Workbox } from "workbox-window";
import { mount } from "svelte";
import { cleanupNetworkStatus, initNetworkStatus } from "../lib/networkStatus";
import App from "../App.svelte";

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
window.addEventListener("pagehide", cleanupNetworkStatus);

const app = mount(App, {
  target: document.body,
  props: {
    device: "web",
    postInitCb(layermanager) {
      if ("geolocation" in navigator) {
        navigator.geolocation.getCurrentPosition((position) => {
          layermanager.updateLocation(position.coords.latitude, position.coords.longitude, 1, 0);
        });
      }
    },
  },
});

export default app;
