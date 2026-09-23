// Every dev-server run is proxied: vite.config.ts forwards /v3, /socket.io,
// /lightning_cache, /mesocyclones and /tiles to a backend, so the bases here
// are relative paths and the page only ever talks to its own origin. That
// leaves nothing to configure for CORS -- which matters, because the deployed
// APIs stall on a cross-origin browser request rather than rejecting it.
//
// `npm run dev` proxies to staging; `npm run dev-local` (`--mode localstack`)
// to the stack `make up` publishes on 127.0.0.1. Either way the page sees the
// same relative URLs, so the choice of backend lives in one file.
const proxied = import.meta.env.DEV;

// `--mode staging` points a BUILD at the staging cluster on meteocloud. This is
// not cosmetic: the staging Worker is built from the same source as production,
// so without a mode of its own it would ship pointing at the production backend
// and look entirely healthy while doing it.
//
// The v4 backend merged the old Flask and FastAPI services, so `api`, `v3` and
// the websocket are all one origin here, where production still has three.
//
// `--mode demo` is the same cluster's second environment, which replays a
// recorded storm while staging ingests the live feeds (meteocool/ng,
// doc/staging-and-demo.md). Its data and tile hostnames are staging's with
// `demo` in place of `staging`, and it shares staging's geocoder. The API is the
// exception: demo.meteocool.com itself is this Worker, so the API behind it is
// api-demo.meteocool.com where staging's is staging.meteocool.com.
const demo = import.meta.env.MODE === "demo";
const cluster = demo || import.meta.env.MODE === "staging";
const environment = demo ? "demo" : "staging";
const apiOrigin = demo ? "https://api-demo.meteocool.com" : "https://staging.meteocool.com";

const pick = <T>(proxiedValue: T, clusterValue: T, productionValue: T): T =>
  (proxied ? proxiedValue : cluster ? clusterValue : productionValue);

export const tileBaseUrl = pick(
  "/tiles",
  `https://assets-${environment}.meteocool.com`,
  "https://tiles-a.meteocool.com",
);
export const websocketBaseUrl = pick(
  "",
  apiOrigin,
  "https://api.ng.meteocool.com",
);
export const dataUrl = pick("", `https://data-${environment}.meteocool.com`, "https://data.meteocool.com");
// Self-hosted Nominatim, for the reverse lookups in lib/reverseGeocode.ts.
//
// Empty in production on purpose: the instance lives on the staging cluster
// only for now, and an empty base is how reverseGeocode.ts is told to go
// straight to BigDataCloud. Point this at a production hostname on the day one
// exists, and nothing else has to change.
export const geocodingUrl = pick(
  "/geocoding",
  "https://geocoding-staging.meteocool.com",
  "",
);

export const v3APIBaseUrl = pick(
  "/v3",
  `${apiOrigin}/v3`,
  "https://api.meteocool.com/v3",
);
