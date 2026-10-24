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

// A build talks to one of two backends. `--mode demo` (demo.meteocool.com)
// gets the one replaying a recorded storm; every other build, production's
// (Vite's default mode, meteocool.com) and `--mode next`'s alike, the one on
// the live feeds. The API, the websocket and `v3` are one origin on both.
const demo = import.meta.env.MODE === "demo";
const backend = demo ? "demo" : "staging";
const apiOrigin = demo ? "https://api-demo.meteocool.com" : "https://api-next.meteocool.com";

const pick = <T>(proxiedValue: T, deployedValue: T): T => (proxied ? proxiedValue : deployedValue);

export const tileBaseUrl = pick("/tiles", `https://assets-${backend}.meteocool.com`);
export const websocketBaseUrl = pick("", apiOrigin);
export const dataUrl = pick("", `https://data-${backend}.meteocool.com`);
// Self-hosted Nominatim, for the reverse lookups in lib/reverseGeocode.ts.
// Both backends share one.
export const geocodingUrl = pick("/geocoding", "https://geocoding-staging.meteocool.com");

export const v3APIBaseUrl = pick("/v3", `${apiOrigin}/v3`);
