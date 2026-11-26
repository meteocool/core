import assert from "node:assert/strict";
import test from "node:test";
import { get } from "svelte/store";
import { BoardSession } from "../../src/lib/studio/flight/board/session.ts";
import type { BoardDeps, FlightFrame } from "../../src/lib/studio/flight/board/session.ts";
import { PILOT_KEY } from "../../src/lib/studio/flight/board/pilotStore.ts";

/**
 * The board's session, against a scripted board: a fetch that answers each
 * request from a list of answers per route, Turnstile handing out numbered
 * tokens, and a clock and timers the test moves on itself.
 */

const PILOT = "0123456789abcdef0123456789abcdef";
const FLIGHT = "0123456789abcdef01234567";

type Reply = { status: number; body?: unknown; retryAfter?: string } | "network";
interface Sent { method: string; path: string; body: Record<string, unknown> | null; auth: string | null; keepalive: boolean }

function harness(script: Record<string, Reply[]> = {}, stored: string | null = null) {
  let now = 0;
  let order = 0;
  const timers: Array<{ at: number; order: number; run: () => void; id: number }> = [];
  let ids = 0;
  const sent: Sent[] = [];
  const kept = new Map<string, string>();
  if (stored) kept.set(PILOT_KEY, stored);
  let tokens = 0;
  const defaults: Record<string, Reply> = {
    "POST /pilots": { status: 201, body: { pilot: PILOT, callsign: "D-ABCD" } },
    "POST /flights": { status: 201, body: { flight: FLIGHT, started_at: "x", callsign: "D-ABCD", limits: { batch_interval_s: 5, max_samples: 64, max_bytes: 8192, max_feats: 8, flight_s: 3600, max_refused: 60 } } },
    "GET /board": { status: 200, body: { day: "2026-11-26", top: [] } },
  };
  const routeOf = (path: string) => path.replace(/\/flights\/[0-9a-f]+\//, "/flights/{id}/");
  const fetch = (async (input: string, init: RequestInit = {}) => {
    const path = input.replace("/v3/air", "");
    const method = init.method ?? "GET";
    const headers = (init.headers ?? {}) as Record<string, string>;
    sent.push({ method, path, body: init.body ? JSON.parse(String(init.body)) : null, auth: headers.Authorization ?? null, keepalive: Boolean(init.keepalive) });
    const route = `${method} ${routeOf(path)}`;
    const reply = script[route]?.shift() ?? defaults[route]
      ?? (route.endsWith("/track") || route.endsWith("/end")
        ? { status: 200, body: { flight: FLIGHT, points: 10, rank: 2, feats: [], clock: 0, refused_total: 0, ended: route.endsWith("/end") ? { at: "x", reason: "ended" } : null, granted: [], claims_refused: [] } }
        : { status: 404, body: {} });
    if (reply === "network") throw new TypeError("network");
    return {
      status: reply.status,
      ok: reply.status < 300,
      headers: { get: (name: string) => (name === "Retry-After" ? reply.retryAfter ?? null : null) },
      json: async () => reply.body,
    } as unknown as Response;
  }) as unknown as typeof globalThis.fetch;
  const deps: BoardDeps = {
    base: "/v3/air",
    socketUrl: "ws://test/v3/air/board",
    fetch,
    tokens: { token: async () => `token-${++tokens}`, dispose: () => undefined },
    storage: {
      getItem: (key: string) => kept.get(key) ?? null,
      setItem: (key: string, value: string) => { kept.set(key, value); },
      removeItem: (key: string) => { kept.delete(key); },
    } as unknown as Storage,
    WebSocket: null,
    now: () => now,
    setTimeout: (run, ms) => { const id = ++ids; timers.push({ at: now + ms, order: ++order, run, id }); return id; },
    clearTimeout: (id) => { const index = timers.findIndex((timer) => timer.id === id); if (index >= 0) timers.splice(index, 1); },
  };
  const settle = async () => { for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setImmediate(resolve)); };
  /** Move the clock on by `ms`, running every timer that comes due on the way. */
  const advance = async (ms: number) => {
    const until = now + ms;
    await settle();
    for (;;) {
      timers.sort((a, b) => a.at - b.at || a.order - b.order);
      const next = timers[0];
      if (!next || next.at > until) break;
      timers.shift();
      now = Math.max(now, next.at);
      next.run();
      await settle();
    }
    now = until;
    await settle();
  };
  const session = new BoardSession(deps);
  let flown = 0;
  const frame = (patch: Partial<FlightFrame> = {}): FlightFrame => ({
    flight: 1, flown, lon: 11, lat: 48, altitude: 5000, onGround: false, crashed: false, touchdownSink: null, stopped: false,
    points: flown * 3, feats: [], ...patch,
  });
  /** Fly `seconds` of real time at a frame every tenth of a second, `warp` seconds of flight each. */
  const fly = async (seconds: number, patch: Partial<FlightFrame> = {}, warp = 1) => {
    for (let i = 0; i < seconds * 10; i += 1) {
      flown += 0.1 * warp;
      session.frame(frame(patch));
      await advance(100);
    }
  };
  const posts = (path: RegExp) => sent.filter((one) => one.method === "POST" && path.test(one.path));
  return { session, sent, kept, posts, fly, advance, frame, view: () => get(session.view), tokenCount: () => tokens, flownNow: () => flown };
}

test("a first flight makes the browser a pilot, starts a flight, and sends a sample a second of flight in batches ten seconds apart", async () => {
  const board = harness();
  await board.fly(25);
  const [made] = board.posts(/^\/pilots$/);
  assert.deepEqual(made.body, { turnstile: "token-1" });
  assert.equal(made.auth, null);
  const [started] = board.posts(/^\/flights$/);
  assert.deepEqual(started.body, { turnstile: "token-2" });
  assert.equal(started.auth, `Bearer ${PILOT}`);
  assert.equal(JSON.parse(board.kept.get(PILOT_KEY)!).callsign, "D-ABCD");
  const batches = board.posts(/\/track$/);
  assert.equal(batches.length, 2);
  const samples = batches.flatMap((batch) => batch.body!.samples as number[][]);
  // Every second of the clock, from its start, in order.
  samples.forEach((sample, i) => { if (i) assert.ok(Math.abs(sample[0] - samples[i - 1][0] - 1) < 0.15); });
  assert.ok(samples[0][0] < 0.2);
  assert.equal(board.view().phase, "flying");
  assert.equal(board.view().points, 10);
  assert.equal(board.view().callsign, "D-ABCD");
});

test("a pilot kept from before starts its flight straight away", async () => {
  const board = harness({}, JSON.stringify({ pilot: PILOT, callsign: "OE-KXR" }));
  await board.fly(1);
  assert.equal(board.posts(/^\/pilots$/).length, 0);
  assert.equal(board.posts(/^\/flights$/).length, 1);
});

test("under warp ten seconds of real time hold forty samples, in one batch", async () => {
  const board = harness({}, JSON.stringify({ pilot: PILOT, callsign: "OE-KXR" }));
  await board.fly(10.5, {}, 4);
  const [batch] = board.posts(/\/track$/);
  assert.ok((batch.body!.samples as unknown[]).length >= 39);
});

test("a feat the cockpit earns goes with the next batch, at its clock; the landing never does", async () => {
  const board = harness({}, JSON.stringify({ pilot: PILOT, callsign: "OE-KXR" }));
  await board.fly(3);
  await board.fly(9, { feats: ["core", "landed"] });
  const [batch] = board.posts(/\/track$/);
  assert.deepEqual((batch.body!.feats as Array<{ feat: string }>).map((claim) => claim.feat), ["core"]);
});

test("a 429 with Retry-After waits that long, and sends what was refused with what gathered meanwhile", async () => {
  const board = harness({ "POST /flights/{id}/track": [{ status: 429, retryAfter: "8" }] }, JSON.stringify({ pilot: PILOT, callsign: "OE-KXR" }));
  await board.fly(11);
  const [refused] = board.posts(/\/track$/);
  await board.fly(6);
  assert.equal(board.posts(/\/track$/).length, 1);
  await board.fly(3);
  const [, again] = board.posts(/\/track$/);
  const first = (refused.body!.samples as number[][])[0][0];
  assert.equal((again.body!.samples as number[][])[0][0], first);
  assert.ok((again.body!.samples as unknown[]).length > (refused.body!.samples as unknown[]).length);
});

test("with the board out of reach the batches back off, ten seconds then twenty, and the flight is not held up", async () => {
  const board = harness({ "POST /flights/{id}/track": ["network", "network"] }, JSON.stringify({ pilot: PILOT, callsign: "OE-KXR" }));
  await board.fly(10.5);
  assert.equal(board.posts(/\/track$/).length, 1);
  assert.equal(board.view().reachable, false);
  await board.fly(10);
  assert.equal(board.posts(/\/track$/).length, 2);
  await board.fly(15);
  assert.equal(board.posts(/\/track$/).length, 2);
  await board.fly(6);
  assert.equal(board.posts(/\/track$/).length, 3);
  assert.equal(board.view().reachable, true);
});

test("a pilot the board does not know is forgotten, and the browser becomes a pilot again for a new flight", async () => {
  const board = harness({ "POST /flights": [{ status: 401, body: { detail: "unknown pilot" } }] }, JSON.stringify({ pilot: "f".repeat(32), callsign: "OE-KXR" }));
  await board.fly(2);
  assert.equal(board.posts(/^\/pilots$/).length, 1);
  assert.equal(board.posts(/^\/flights$/).length, 2);
  assert.equal(board.posts(/^\/flights$/)[1].auth, `Bearer ${PILOT}`);
  assert.equal(board.view().phase, "flying");
});

test("a token Turnstile's check refused is replaced once; refused again, the flight has no board", async () => {
  const board = harness({ "POST /flights": [{ status: 403 }, { status: 403 }] }, JSON.stringify({ pilot: PILOT, callsign: "OE-KXR" }));
  await board.fly(15);
  const starts = board.posts(/^\/flights$/);
  assert.equal(starts.length, 2);
  assert.notEqual(starts[0].body!.turnstile, starts[1].body!.turnstile);
  assert.equal(board.view().phase, "unavailable");
  assert.equal(board.posts(/\/track$/).length, 0);
});

test("a crash ends the board's flight with no landing, and the cockpit's next flight starts another", async () => {
  const board = harness({}, JSON.stringify({ pilot: PILOT, callsign: "OE-KXR" }));
  await board.fly(3);
  await board.fly(1, { crashed: true, onGround: true, touchdownSink: 12 });
  const [end] = board.posts(/\/end$/);
  assert.equal(end.body!.landing, undefined);
  assert.ok((end.body!.samples as unknown[]).length >= 2);
  await board.fly(1, { flight: 2 });
  assert.equal(board.posts(/^\/flights$/).length, 2);
});

test("a landing come to a stop ends the flight with the first touchdown's sink", async () => {
  const board = harness({}, JSON.stringify({ pilot: PILOT, callsign: "OE-KXR" }));
  await board.fly(3);
  await board.fly(0.5, { onGround: true, touchdownSink: 0.42 });
  await board.fly(0.5, { onGround: false });
  await board.fly(0.5, { onGround: true, touchdownSink: 2.5 });
  await board.fly(0.2, { onGround: true, touchdownSink: 2.5, stopped: true });
  const ends = board.posts(/\/end$/);
  assert.equal(ends.length, 1);
  assert.deepEqual(ends[0].body!.landing, { sink: 0.42 });
  assert.equal(board.view().phase, "over");
  assert.equal(board.view().ended, "ended");
});

test("a flight the board has ended is shown over and no more is sent", async () => {
  const over = { flight: FLIGHT, points: 300, rank: null, feats: [], clock: 10, refused_total: 61, ended: { at: "x", reason: "refused" } };
  const board = harness({ "POST /flights/{id}/track": [{ status: 409, body: over }] }, JSON.stringify({ pilot: PILOT, callsign: "OE-KXR" }));
  await board.fly(25);
  assert.equal(board.posts(/\/track$/).length, 1);
  assert.equal(board.view().phase, "over");
  assert.equal(board.view().ended, "refused");
  assert.equal(board.view().points, 300);
});

test("a flight the board does not know is started again", async () => {
  const board = harness({ "POST /flights/{id}/track": [{ status: 404 }] }, JSON.stringify({ pilot: PILOT, callsign: "OE-KXR" }));
  await board.fly(11);
  assert.equal(board.posts(/^\/flights$/).length, 2);
});

test("a batch too big for the board goes again in halves", async () => {
  const board = harness({ "POST /flights/{id}/track": [{ status: 413 }] }, JSON.stringify({ pilot: PILOT, callsign: "OE-KXR" }));
  await board.fly(17);
  const [big, half] = board.posts(/\/track$/);
  assert.equal((half.body!.samples as unknown[]).length, Math.floor((big.body!.samples as unknown[]).length / 2));
});

test("back from a pause, what was waiting goes as soon as the board allows", async () => {
  const board = harness({}, JSON.stringify({ pilot: PILOT, callsign: "OE-KXR" }));
  await board.fly(11);
  assert.equal(board.posts(/\/track$/).length, 1);
  await board.fly(2);
  // Paused: no frames for half a minute.
  await board.advance(30_000);
  const before = board.posts(/\/track$/).length;
  // Back: the flight's first seconds go at once, not on the next turn of the timer.
  await board.fly(2);
  assert.equal(board.posts(/\/track$/).length, before + 1);
});

test("the page going away ends the flight on a request that outlives it", async () => {
  const board = harness({}, JSON.stringify({ pilot: PILOT, callsign: "OE-KXR" }));
  await board.fly(4);
  board.session.pageHidden();
  const [end] = board.posts(/\/end$/);
  assert.equal(end.keepalive, true);
  assert.ok((end.body!.samples as unknown[]).length >= 3);
});

test("leaving the flight ends it on the board, and the board is let go of", async () => {
  const board = harness({}, JSON.stringify({ pilot: PILOT, callsign: "OE-KXR" }));
  await board.fly(4);
  board.session.leave();
  await board.advance(1000);
  assert.equal(board.posts(/\/end$/).length, 1);
  await board.fly(20);
  assert.equal(board.posts(/\/track$/).length, 0);
});

test("without a socket the day's board is read every thirty seconds", async () => {
  const board = harness();
  await board.advance(61_000);
  assert.equal(board.sent.filter((one) => one.method === "GET" && one.path === "/board").length, 3);
  assert.equal(board.view().day, "2026-11-26");
});

test("the pilot's credential goes in the Authorization header and nowhere else", async () => {
  const board = harness();
  await board.fly(12);
  for (const request of board.sent) {
    assert.ok(!request.path.includes(PILOT));
    assert.ok(!JSON.stringify(request.body ?? {}).includes(PILOT));
  }
});
