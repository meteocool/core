import { crc32, deflateSync } from "node:zlib";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Page, Route } from "@playwright/test";

/**
 * The UI tests' backend: answers recorded once (`npm run test:ui:record`,
 * tests/ui/record.ts) and replayed, so a run depends on nothing but the
 * repository. See tests/ui/README.md.
 */

export const FIXTURES = path.join(import.meta.dirname, "fixtures");
const API_DIR = path.join(FIXTURES, "api");
const RECORDING = path.join(FIXTURES, "recording.json");

/** When and from where the answers were recorded. */
export interface Recording {
  /** Epoch milliseconds: the clock every test starts on, so "now" is the data's now. */
  recordedAt: number;
  source: string;
}

/** One recorded answer. */
export interface RecordedResponse {
  status: number;
  contentType: string;
  /** Parsed, for a JSON answer, so a re-recording's diff is readable. */
  json?: unknown;
  text?: string;
}

/**
 * The requests that are the backend's, by path on the dev server, which
 * proxies them (vite.config.ts). Recorded and replayed.
 */
const API_PATHS = [/^\/v3\//, /^\/cells\//, /^\/mesocyclones\//, /^\/lightning_cache/, /^\/geocoding\//];

/** Map tiles: radar frames, value tiles and the basemap. Drawn blank, never recorded. */
const TILE_PATHS = [/^\/tiles\//];
const TILE_HOSTS = ["map.meteocool.com"];

export const isApi = (url: URL): boolean => isLocal(url) && API_PATHS.some((p) => p.test(url.pathname));
export const isTile = (url: URL): boolean =>
  (isLocal(url) && TILE_PATHS.some((p) => p.test(url.pathname))) || TILE_HOSTS.includes(url.hostname);
export const isLocal = (url: URL): boolean => url.hostname === "localhost" || url.hostname === "127.0.0.1";

/**
 * Where an answer is kept: by method and path. The query is left out on
 * purpose: it carries the viewport and the time (`cells/tracks?bbox=…&since=…`),
 * which differ from run to run, and one answer per endpoint is what a test
 * needs.
 */
export function fixtureFile(method: string, url: URL): string {
  const name = `${method} ${url.pathname}`.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "");
  return path.join(API_DIR, `${name}.json`);
}

export function readRecording(): Recording {
  if (!existsSync(RECORDING)) {
    throw new Error("No UI test recording: run `npm run test:ui:record` (see tests/ui/README.md).");
  }
  return JSON.parse(readFileSync(RECORDING, "utf8")) as Recording;
}

/** A 256-pixel transparent PNG, what every raster tile is answered with. */
export const EMPTY_PNG = ((size: number) => {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  // One filter byte and a row of transparent pixels, per row.
  const pixels = Buffer.alloc(size * (1 + size * 4));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(pixels)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
})(256);

/** A blank tile of whichever kind was asked for: an empty vector tile is a valid one. */
export function fulfilBlankTile(route: Route, url: URL): Promise<void> {
  if (/\.(pbf|mvt)$/.test(url.pathname)) {
    return route.fulfill({ status: 200, contentType: "application/x-protobuf", body: Buffer.alloc(0) });
  }
  return route.fulfill({ status: 200, contentType: "image/png", body: EMPTY_PNG });
}

/**
 * The live lightning feed (socket.io over a websocket, App.svelte), stood in
 * for by one that connects and stays quiet. Refused instead, the client
 * would retry over polling and the page report the connection as degraded.
 *
 * Engine.IO v4: the server opens with its parameters, the client asks for
 * the default namespace with `40`, and the server confirms it. The ping
 * interval is longer than any test, so silence never reads as a dead line.
 */
export async function quietLightningSocket(page: Page): Promise<void> {
  await page.routeWebSocket(/\/socket\.io\//, (ws) => {
    const open = { sid: "ui-test", upgrades: [], pingInterval: 3_600_000, pingTimeout: 3_600_000, maxPayload: 1_000_000 };
    ws.send(`0${JSON.stringify(open)}`);
    ws.onMessage((message) => {
      if (typeof message === "string" && message.startsWith("40")) ws.send(`40${JSON.stringify({ sid: "ui-test-ns" })}`);
    });
  });
}
