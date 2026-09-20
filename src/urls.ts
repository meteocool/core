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
const staging = import.meta.env.MODE === "staging";

const pick = <T>(proxiedValue: T, stagingValue: T, productionValue: T): T =>
  (proxied ? proxiedValue : staging ? stagingValue : productionValue);

export const tileBaseUrl = pick(
  "/tiles",
  "https://assets-staging.meteocool.com",
  "https://tiles-a.meteocool.com",
);
export const websocketBaseUrl = pick(
  "",
  "https://staging.meteocool.com",
  "https://api.ng.meteocool.com",
);
export const dataUrl = pick("", "https://data-staging.meteocool.com", "https://data.meteocool.com");
export const v3APIBaseUrl = pick(
  "/v3",
  "https://staging.meteocool.com/v3",
  "https://api.meteocool.com/v3",
);
