// Under `--mode local` every base is a relative path, so the page talks to the
// Vite dev server's own origin and the proxy in vite.config.ts forwards to the
// local stack. Same-origin means there is no CORS to configure anywhere.
const local = import.meta.env.MODE === "local";

export const tileBaseUrl = local ? "/tiles" : "https://tiles-a.meteocool.com";
export const apiBaseUrl = local ? "/api" : "https://api.ng.meteocool.com/api";
export const websocketBaseUrl = local ? "" : "https://api.ng.meteocool.com";
export const dataUrl = local ? "" : "https://data.meteocool.com";
export const v3APIBaseUrl = local ? "/v3" : "https://api.meteocool.com/v3";
