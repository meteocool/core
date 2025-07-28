import * as Sentry from "@sentry/browser";
import SENTRY_ARGS from "../lib/sentry.js";

if (process.env.NODE_ENV !== "development") {
  Sentry.init(SENTRY_ARGS);
}

import { Workbox } from "workbox-window";
import App from "../App.svelte";
import { mount } from "svelte";
import { logger } from "../lib/logger.js";

// Register service worker
if ("serviceWorker" in navigator && process.env.NODE_ENV !== "development") {
  const wb = new Workbox("sw.js");
  wb.addEventListener("controlling", (evt) => {
    if (evt.isUpdate) {
      logger.log("Reloading page for latest content");
      window.location.reload();
    }
  });
  try {
    wb.register();
  } catch (error) {
    logger.error(error);
  }
}

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
