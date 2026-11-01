// Every dev-server run is proxied: vite.config.ts forwards /v3, /socket.io,
// /lightning_cache, /mesocyclones and /tiles to a backend, so the bases here
// are relative paths and the page only ever talks to its own origin. That
// leaves nothing to configure for CORS, which matters because the deployed
// APIs stall on a cross-origin browser request instead of rejecting it.
//
// `npm run dev` proxies to staging; `npm run dev-local` (`--mode localstack`)
// to the stack `make up` publishes on 127.0.0.1. Either way the page sees the
// same relative URLs, so the choice of backend lives in one file.
const proxied = import.meta.env.DEV;

// A build talks to one of three backends. Vite's default mode, production's
// (meteocool.com and app.meteocool.com), gets the production cluster on its
// own hostnames; `--mode next` (next.meteocool.com) the staging cluster's
// live feeds; `--mode demo` (demo.meteocool.com) the one replaying a recorded
// storm. The API, the websocket and `v3` are one origin on each.
const demo = import.meta.env.MODE === "demo";
const next = import.meta.env.MODE === "next";
// What the staging cluster's hostnames carry after `api`, `data` and
// `assets`: the API's suffix is the environment's, the stores' is the cluster's.
const api = demo ? "-demo" : next ? "-next" : "";
const store = demo ? "-demo" : next ? "-staging" : "";
const apiOrigin = `https://api${api}.meteocool.com`;

const pick = <T>(proxiedValue: T, deployedValue: T): T => (proxied ? proxiedValue : deployedValue);

export const tileBaseUrl = pick("/tiles", `https://assets${store}.meteocool.com`);
export const websocketBaseUrl = pick("", apiOrigin);
export const dataUrl = pick("", `https://data${store}.meteocool.com`);
// Self-hosted Nominatim, for the reverse lookups in lib/reverseGeocode.ts.
// One per cluster: next and demo share staging's.
export const geocodingUrl = pick("/geocoding", `https://geocoding${demo || next ? "-staging" : ""}.meteocool.com`);

export const v3APIBaseUrl = pick("/v3", `${apiOrigin}/v3`);
