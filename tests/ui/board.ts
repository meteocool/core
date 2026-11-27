import type { Page, Route, WebSocketRoute } from "@playwright/test";

/**
 * meteoair's board, stood in for: the board API's answers scripted here
 * rather than recorded (a recording would hold a real pilot's credential,
 * and the board's answers depend on the flight flown), its socket, and
 * Turnstile's script, which never comes from the network in a test: a
 * stand-in that renders nothing and hands out Turnstile's test token, at
 * once or, where a test wants the reader asked, when the test answers.
 *
 * Every page gets the stand-in (test.ts), answering as a board that takes
 * everything; a spec scripts other answers with `scriptBoard`, and reads
 * what the page asked of it with `boardAsked`.
 */

export const STAND_IN_PILOT = "0123456789abcdef0123456789abcdef";
export const STAND_IN_FLIGHT = "0123456789abcdef01234567";
export const STAND_IN_CALLSIGN = "D-ETST";
export const TEST_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";

/** A request the page made of the board, or of Turnstile. */
export interface BoardAsked {
  method: string;
  /** The path under `/v3/air`, or `turnstile` for Turnstile's script, `socket` for the board's socket. */
  path: string;
  body: Record<string, unknown> | null;
  authorization: string | null;
}

/** An answer: a status and a body, a Retry-After, or no answer at all (a network error). */
export type BoardReply = { status: number; body?: unknown; retryAfter?: number } | "network";

/** The day's top twenty the stand-in socket sends: someone else ahead, and the pilot's own flight. */
export const STAND_IN_TOP = [
  { rank: 1, callsign: "OE-KXR", points: 5120, feats: ["core", "hail"], flying: false, flight: "ffffffffffffffffffffffff" },
  { rank: 2, callsign: STAND_IN_CALLSIGN, points: 1234, feats: ["core"], flying: true, flight: STAND_IN_FLIGHT },
];

const TURNSTILE_STAND_IN = `
  window.turnstile = {
    render(container, options) {
      const id = "stand-in-" + Math.random().toString(36).slice(2);
      (window.__turnstileWidgets ||= {})[id] = options;
      return id;
    },
    execute(id) {
      const options = window.__turnstileWidgets[id];
      const answer = () => options.callback(${JSON.stringify(TEST_TOKEN)});
      // A page that set __turnstileAsks is asked each time, and answers with __turnstileAnswer().
      if (window.__turnstileAsks) {
        options["before-interactive-callback"]?.();
        window.__turnstileAnswer = () => { options["after-interactive-callback"]?.(); answer(); };
      } else {
        setTimeout(answer, 10);
      }
    },
    reset() {},
    remove(id) { delete window.__turnstileWidgets[id]; },
  };
`;

/** What the page said on the airspace's socket: its address, its text frames, and how many states it sent. */
export interface AirspaceHeard {
  urls: string[];
  texts: Array<Record<string, unknown>>;
  states: number;
  /** Where the page's aircraft last said it was. */
  at: { lon: number; lat: number; altitude: number } | null;
}

/** An aircraft the stand-in airspace says is near: so far north and east of the page's own, metres, with a callsign. */
export interface ScriptedAircraft {
  id: number;
  callsign: string;
  north: number;
  east: number;
}

interface Stand {
  asked: BoardAsked[];
  script: Record<string, BoardReply[]>;
  socket: "open" | "refuse";
  airspace: "open" | "refuse";
  aircraft: ScriptedAircraft[];
  heard: AirspaceHeard;
}

/** A snapshot of `aircraft` round `at`, as the airspace sends one: little-endian, 8 bytes and 36 for each. */
function snapshotOf(clock: number, at: { lon: number; lat: number; altitude: number }, aircraft: readonly ScriptedAircraft[]): Buffer {
  const buffer = Buffer.alloc(8 + 36 * aircraft.length);
  buffer.writeUInt8(2, 0);
  buffer.writeUInt16LE(aircraft.length, 2);
  buffer.writeUInt32LE(clock >>> 0, 4);
  aircraft.forEach((plane, i) => {
    const o = 8 + 36 * i;
    const lat = at.lat + plane.north / 111_195;
    const lon = at.lon + plane.east / (111_195 * Math.cos((at.lat * Math.PI) / 180));
    buffer.writeUInt16LE(plane.id, o);
    buffer.writeUInt8(0, o + 2);
    buffer.writeUInt8(2, o + 3);
    buffer.writeInt32LE(Math.round(lon * 1e7), o + 4);
    buffer.writeInt32LE(Math.round(lat * 1e7), o + 8);
    buffer.writeInt32LE(Math.round(at.altitude * 100), o + 12);
    buffer.writeInt16LE(1400, o + 16);
    buffer.writeUInt16LE(16384, o + 22);
    // Its look: version 1, nothing wrong with it.
    buffer.writeUInt8(1, o + 28);
    buffer.writeUInt8(255, o + 35);
  });
  return buffer;
}

const stands = new WeakMap<Page, Stand>();

const routeOf = (path: string) => path.replace(/\/flights\/[0-9a-f]+\//, "/flights/{id}/");

function flightState(ended: boolean): object {
  return {
    flight: STAND_IN_FLIGHT, points: 1234, rank: 2, feats: [], clock: 10, refused_total: 0,
    ended: ended ? { at: new Date().toISOString(), reason: "ended" } : null,
    granted: [], claims_refused: [],
  };
}

/** What a board that takes everything answers. */
function taken(method: string, route: string): BoardReply {
  if (method === "POST" && route === "/pilots") return { status: 201, body: { pilot: STAND_IN_PILOT, callsign: STAND_IN_CALLSIGN } };
  if (method === "POST" && route === "/flights") {
    return {
      status: 201,
      body: {
        flight: STAND_IN_FLIGHT, started_at: new Date().toISOString(), callsign: STAND_IN_CALLSIGN,
        limits: { batch_interval_s: 5, max_samples: 64, max_bytes: 8192, max_feats: 8, flight_s: 3600, max_refused: 60 },
      },
    };
  }
  if (method === "POST" && route === "/flights/{id}/track") return { status: 200, body: flightState(false) };
  if (method === "POST" && route === "/flights/{id}/end") return { status: 200, body: flightState(true) };
  if (method === "GET" && route === "/board") return { status: 200, body: { day: "2026-11-26", top: STAND_IN_TOP } };
  return { status: 404, body: { detail: "not found" } };
}

async function answer(route: Route, stand: Stand): Promise<void> {
  const request = route.request();
  const url = new URL(request.url());
  const path = url.pathname.replace(/^\/v3\/air/, "");
  let body: Record<string, unknown> | null = null;
  try {
    body = request.postDataJSON() as Record<string, unknown> | null;
  } catch {
    body = null;
  }
  stand.asked.push({ method: request.method(), path, body, authorization: (await request.allHeaders()).authorization ?? null });
  const key = `${request.method()} ${routeOf(path)}`;
  const reply = stand.script[key]?.shift() ?? taken(request.method(), routeOf(path));
  if (reply === "network") return route.abort("failed");
  return route.fulfill({
    status: reply.status,
    contentType: "application/json",
    headers: reply.retryAfter === undefined ? {} : { "Retry-After": String(reply.retryAfter) },
    body: JSON.stringify(reply.body ?? {}),
  });
}

/** Stand the board and Turnstile in for `page`. Registered after test.ts's catch-all, so it answers first. */
export async function standInBoard(page: Page): Promise<void> {
  const stand: Stand = {
    asked: [], script: {}, socket: "open", airspace: "open", aircraft: [], heard: { urls: [], texts: [], states: 0, at: null },
  };
  stands.set(page, stand);
  await page.route(/^https:\/\/challenges\.cloudflare\.com\//, (route) => {
    stand.asked.push({ method: route.request().method(), path: "turnstile", body: null, authorization: null });
    return route.fulfill({ status: 200, contentType: "text/javascript", body: TURNSTILE_STAND_IN });
  });
  await page.route((url) => url.pathname.startsWith("/v3/air/") || url.pathname === "/v3/air", (route) => answer(route, stand));
  await page.routeWebSocket(/\/v3\/air\/board$/, (ws: WebSocketRoute) => {
    stand.asked.push({ method: "GET", path: "socket", body: null, authorization: null });
    if (stand.socket === "refuse") {
      void ws.close({ code: 1011, reason: "refused" });
      return;
    }
    ws.send(JSON.stringify({ type: "board", day: "2026-11-26", top: STAND_IN_TOP }));
  });
  // The airspace: joined as the page asks, and, where a spec has scripted any, aircraft near it five times a second.
  await page.routeWebSocket(/\/v3\/air\/airspace$/, (ws: WebSocketRoute) => {
    stand.heard.urls.push(ws.url());
    if (stand.airspace === "refuse") {
      void ws.close({ code: 1011, reason: "refused" });
      return;
    }
    let timer: ReturnType<typeof setInterval> | null = null;
    const started = Date.now();
    ws.onMessage((message) => {
      if (typeof message === "string") {
        const text = JSON.parse(message) as Record<string, unknown>;
        stand.heard.texts.push(text);
        if (text.type !== "join") return;
        ws.send(JSON.stringify({
          type: "joined", id: 7, callsign: STAND_IN_CALLSIGN, send_hz: 5,
          limits: { send_hz_most: 5, frames_per_s_most: 8, near: 32, near_m: 25000, near_hz: 5, far: 200, far_m: 20100000, far_every_ms: 2000, silent_ms: 10000 },
        }));
        let named = 0;
        timer ??= setInterval(() => {
          if (!stand.heard.at || !stand.aircraft.length) return;
          // Their callsigns before they are first in a snapshot.
          if (named !== stand.aircraft.length) {
            ws.send(JSON.stringify({ type: "names", names: Object.fromEntries(stand.aircraft.map((plane) => [plane.id, plane.callsign])) }));
            named = stand.aircraft.length;
          }
          ws.send(snapshotOf(Date.now() - started, stand.heard.at, stand.aircraft));
        }, 200);
        return;
      }
      stand.heard.states += 1;
      const state = Buffer.from(message);
      if (state.length === 36 && state.readUInt8(0) === 1) {
        stand.heard.at = { lon: state.readInt32LE(4) / 1e7, lat: state.readInt32LE(8) / 1e7, altitude: state.readInt32LE(12) / 100 };
      }
    });
    ws.onClose(() => { if (timer) clearInterval(timer); });
  });
}

/** Script the board's next answers to a route, `POST /flights/{id}/track` say, in order; after them it takes everything again. */
export function scriptBoard(
  page: Page, script: Record<string, BoardReply[]>, options: { socket?: "open" | "refuse"; airspace?: "open" | "refuse"; aircraft?: ScriptedAircraft[] } = {},
): void {
  const stand = stands.get(page);
  if (!stand) throw new Error("The page has no stand-in board.");
  for (const [route, replies] of Object.entries(script)) stand.script[route] = [...(stand.script[route] ?? []), ...replies];
  if (options.socket) stand.socket = options.socket;
  if (options.airspace) stand.airspace = options.airspace;
  if (options.aircraft) stand.aircraft = options.aircraft;
}

/** What the page has said on the airspace's socket so far. */
export function airspaceHeard(page: Page): AirspaceHeard {
  return stands.get(page)?.heard ?? { urls: [], texts: [], states: 0, at: null };
}

/** What the page has asked of the board and of Turnstile so far. */
export function boardAsked(page: Page): BoardAsked[] {
  return stands.get(page)?.asked ?? [];
}
