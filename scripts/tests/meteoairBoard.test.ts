import assert from "node:assert/strict";
import test from "node:test";
import { boardFlight, boardSitekey, BOARD_SITEKEYS, TEST_SITEKEY } from "../../src/lib/studio/flight/board/config.ts";
import { backoffMs, retryAfterOf, stepFor } from "../../src/lib/studio/flight/board/answers.ts";
import type { Answer } from "../../src/lib/studio/flight/board/answers.ts";
import { afterClose, DAY_OVER, FRESH_SOCKET, socketUrl } from "../../src/lib/studio/flight/board/socketPlan.ts";
import { bodyOf, gather, newClaims, nextBatch, nextSampleAt, NOTHING, sampleAt, sampleDue, splitOf } from "../../src/lib/studio/flight/board/track.ts";
import { boardCorrection, featStanding, isOwn, NO_BOARD, stoppedBy, SYNC_EVERY_MS, syncDue, withFlight, withState, withTop } from "../../src/lib/studio/flight/board/view.ts";
import { forgetPilot, keepPilot, PILOT_KEY, readPilot } from "../../src/lib/studio/flight/board/pilotStore.ts";
import { frameOf } from "../../src/lib/studio/flight/board/frame.ts";
import { DEFAULT_LIMITS } from "../../src/lib/studio/flight/board/wire.ts";
import type { FlightState, Sample } from "../../src/lib/studio/flight/board/wire.ts";

const http = (status: number, body: unknown = {}, retryAfterS: number | null = null): Answer => ({ kind: "http", status, retryAfterS, body });
const state = (patch: Partial<FlightState> = {}): FlightState => ({
  flight: "f1", points: 0, rank: null, feats: [], clock: 0, refused_total: 0, ended: null, ...patch,
});

/* Which board, and for which flights. */

test("each site flies on its own board's widget, a dev server on the test key, and a build of no known site on none", () => {
  assert.equal(boardSitekey({ mode: "next", dev: false, demoWeather: false }), BOARD_SITEKEYS.next);
  assert.equal(boardSitekey({ mode: "demo", dev: false, demoWeather: false }), BOARD_SITEKEYS.demo);
  assert.equal(boardSitekey({ mode: "development", dev: true, demoWeather: false }), TEST_SITEKEY);
  assert.equal(boardSitekey({ mode: "production", dev: false, demoWeather: false }), BOARD_SITEKEYS.production);
  assert.equal(new Set(Object.values(BOARD_SITEKEYS)).size, 3);
  assert.equal(boardSitekey({ mode: "localstack", dev: false, demoWeather: false }), null);
});

test("a live site flying the demo's storm in place of its own weather has no board", () => {
  assert.equal(boardSitekey({ mode: "next", dev: false, demoWeather: true }), null);
  assert.equal(boardSitekey({ mode: "demo", dev: false, demoWeather: true }), BOARD_SITEKEYS.demo);
});

test("a flight through a past moment starts no board flight, except in the demo's own recorded storm", () => {
  assert.equal(boardFlight({ sitekey: "key", pastWindow: false, showcase: false }), true);
  assert.equal(boardFlight({ sitekey: "key", pastWindow: true, showcase: false }), false);
  assert.equal(boardFlight({ sitekey: "key", pastWindow: true, showcase: true }), true);
  assert.equal(boardFlight({ sitekey: null, pastWindow: false, showcase: false }), false);
});

/* The track. */

test("a sample is kept to a hundredth of a second, five decimals of a degree and a decimetre", () => {
  assert.deepEqual(sampleAt(12.3456, 11.0812345, 48.1522678, 5123.456), [12.35, 11.08123, 48.15227, 5123.5]);
});

test("a sample is taken every second of the flight's clock, and none before it starts", () => {
  assert.equal(sampleDue(0, 0), true);
  assert.equal(sampleDue(0, -0.5), false);
  assert.equal(sampleDue(4, 3.6), false);
  assert.equal(sampleDue(4, 4), true);
});

test("samples keep to a grid of whole seconds, so long frames under warp still give one a second", () => {
  assert.equal(nextSampleAt(4, 4.4), 5);
  // A frame that jumped past the next is followed by the whole second after it, not a run of catching up.
  assert.equal(nextSampleAt(4, 7.3), 8);
});

test("the feats earned since the last look are claimed at the clock they were earned at, never the landing's", () => {
  assert.deepEqual(newClaims(["hail"], ["hail", "core", "landed", "butter"], 12.567), [{ feat: "core", t: 12.57 }]);
  assert.deepEqual(newClaims(["hail"], ["hail"], 3), []);
});

test("what gathers keeps only the newest sixty-four samples: the oldest are dropped", () => {
  const samples: Sample[] = Array.from({ length: 70 }, (_, t) => [t, 0, 0, 0]);
  const gathered = gather(NOTHING, { samples }, DEFAULT_LIMITS);
  assert.equal(gathered.samples.length, 64);
  assert.equal(gathered.samples[0][0], 6);
  assert.equal(gathered.samples.at(-1)![0], 69);
});

test("a batch keeps to the board's limits on samples, feats and bytes, oldest first, the rest for the next", () => {
  const samples: Sample[] = Array.from({ length: 40 }, (_, t) => [t, 11.12345, 48.12345, 5123.4]);
  const feats = Array.from({ length: 10 }, (_, t) => ({ feat: "core" as const, t }));
  const { batch, rest } = nextBatch({ samples, feats }, { ...DEFAULT_LIMITS, max_samples: 30, max_feats: 8 });
  assert.equal(batch.samples.length, 30);
  assert.equal(batch.feats.length, 8);
  assert.equal(rest.samples[0][0], 30);
  assert.equal(rest.feats.length, 2);
  const small = nextBatch({ samples, feats: [] }, { ...DEFAULT_LIMITS, max_bytes: 400 });
  assert.ok(JSON.stringify(bodyOf(small.batch)).length <= 400);
  assert.equal(small.batch.samples.length + small.rest.samples.length, 40);
});

test("forty samples at warp fit in one batch", () => {
  const samples: Sample[] = Array.from({ length: 40 }, (_, t) => sampleAt(1000 + t + 0.37, 11.0812345, 48.1522678, 5123.45));
  const { batch } = nextBatch({ samples, feats: [] }, DEFAULT_LIMITS);
  assert.equal(batch.samples.length, 40);
});

test("a batch too big for the board goes again in halves", () => {
  assert.equal(splitOf(40), 20);
  assert.equal(splitOf(1), 1);
  const samples: Sample[] = Array.from({ length: 40 }, (_, t) => [t, 0, 0, 0]);
  assert.equal(nextBatch({ samples, feats: [] }, DEFAULT_LIMITS, 20).batch.samples.length, 20);
});

test("a batch's body carries only what it has, and the end its landing", () => {
  assert.deepEqual(bodyOf(NOTHING), {});
  assert.deepEqual(bodyOf(NOTHING, { sink: 0.41234 }), { landing: { sink: 0.412 } });
  assert.deepEqual(bodyOf({ samples: [[1, 2, 3, 4]], feats: [] }), { samples: [[1, 2, 3, 4]] });
});

/* The answers. */

test("taken answers are taken", () => {
  assert.equal(stepFor(http(200), "track").do, "take");
  assert.equal(stepFor(http(201), "start").do, "take");
});

test("a 429 with Retry-After waits that long; one without, or a network error, backs off", () => {
  assert.deepEqual(stepFor(http(429, {}, 7), "track"), { do: "wait", ms: 7000 });
  assert.equal(stepFor(http(429), "track").do, "backoff");
  assert.equal(stepFor({ kind: "network" }, "track").do, "backoff");
});

test("the back-off is ten seconds, doubling to a minute", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 9].map(backoffMs), [10_000, 20_000, 40_000, 60_000, 60_000, 60_000]);
});

test("a 503 waits for its Retry-After, and backs off without one", () => {
  assert.deepEqual(stepFor(http(503, {}, 5), "start"), { do: "wait", ms: 5000 });
  assert.equal(stepFor(http(503), "start").do, "backoff");
});

test("an unknown pilot becomes a pilot again", () => {
  assert.equal(stepFor(http(401), "start").do, "repilot");
  assert.equal(stepFor(http(401), "track").do, "repilot");
});

test("a refused token is tried once more with a new one, then the board is unavailable for the flight", () => {
  assert.equal(stepFor(http(403), "pilot").do, "token");
  assert.equal(stepFor(http(403), "start").do, "token");
  assert.equal(stepFor(http(403), "start", true).do, "unavailable");
  assert.equal(stepFor(http(403), "track").do, "unavailable");
});

test("no such flight starts a new one; a flight over shows its final state", () => {
  assert.equal(stepFor(http(404), "track").do, "restart");
  const over = state({ points: 900, ended: { at: "x", reason: "idle" } });
  assert.deepEqual(stepFor(http(409, over), "track"), { do: "over", state: over });
  assert.deepEqual(stepFor(http(409, { detail: "over" }), "track"), { do: "over", state: null });
});

test("a 404 on becoming a pilot or starting a flight is a board that is not there", () => {
  assert.equal(stepFor(http(404), "start").do, "unavailable");
});

test("too much in a batch splits it; a malformed one is given up on", () => {
  assert.equal(stepFor(http(413), "track").do, "split");
  assert.equal(stepFor(http(400), "track").do, "unavailable");
});

test("Retry-After is read as seconds or as a date", () => {
  assert.equal(retryAfterOf("12", 0), 12);
  assert.equal(retryAfterOf(new Date(30_000).toUTCString(), 0), 30);
  assert.equal(retryAfterOf(null, 0), null);
  assert.equal(retryAfterOf("soon", 0), null);
});

/* The socket. */

test("at midnight the socket is opened again at once, for the new day", () => {
  assert.deepEqual(afterClose({ opened: true, code: DAY_OVER, openMs: 5000 }, FRESH_SOCKET).step, { then: "reopen", afterMs: 0 });
});

test("a socket that closes is reopened after a few seconds, longer each time in a row", () => {
  let memory = FRESH_SOCKET;
  const waits = [];
  for (let i = 0; i < 6; i += 1) {
    const { step, memory: next } = afterClose({ opened: true, code: 1006, openMs: 1000 }, memory);
    memory = next;
    assert.equal(step.then, "reopen");
    waits.push(step.then === "reopen" ? step.afterMs : 0);
  }
  assert.deepEqual(waits, [3000, 6000, 12000, 24000, 48000, 60000]);
  // Open for a good while, the next close is the first in a row again.
  assert.deepEqual(afterClose({ opened: true, code: 1006, openMs: 120_000 }, memory).step, { then: "reopen", afterMs: 3000 });
});

test("a socket that never opens is read on a timer instead, every ten seconds, the socket tried again after a minute", () => {
  const first = afterClose({ opened: false, code: 1006, openMs: 0 }, FRESH_SOCKET);
  assert.deepEqual(first.step, { then: "poll", everyMs: 10_000, retrySocketMs: 60_000 });
  const second = afterClose({ opened: false, code: 1006, openMs: 0 }, first.memory);
  const third = afterClose({ opened: false, code: 1006, openMs: 0 }, second.memory);
  assert.deepEqual(third.step, { then: "poll", everyMs: 30_000, retrySocketMs: 300_000 });
});

test("the socket is on the API's own host, secure where the API is", () => {
  assert.equal(socketUrl("https://api-next.meteocool.com/v3/air", { protocol: "https:", host: "next.meteocool.com" }),
    "wss://api-next.meteocool.com/v3/air/board");
  assert.equal(socketUrl("/v3/air", { protocol: "http:", host: "127.0.0.1:8080" }), "ws://127.0.0.1:8080/v3/air/board");
});

/* What the cockpit shows. */

test("a batch's answer gives the board's points and rank, and its feats granted or refused", () => {
  let view = withFlight(NO_BOARD, "f1", "D-ABCD");
  view = withState(view, state({ points: 120, rank: 3, granted: ["core"], feats: ["core"], claims_refused: [{ feat: "stElmo" }] }), 130);
  assert.equal(view.phase, "flying");
  assert.equal(view.points, 120);
  assert.equal(view.rank, 3);
  assert.equal(view.cockpitThen, 130);
  assert.equal(featStanding("core", view), "board");
  assert.equal(featStanding("stElmo", view), "cockpit");
  assert.equal(featStanding("hail", view), "checking");
});

test("a feat granted after it was refused once is on the board", () => {
  let view = withState(withFlight(NO_BOARD, "f1", "D-ABCD"), state({ claims_refused: [{ feat: "hail" }] }));
  view = withState(view, state({ granted: ["hail"], feats: ["hail"] }));
  assert.equal(featStanding("hail", view), "board");
});

test("a flight the board ended says why; one the pilot ended says nothing", () => {
  const stopped = withState(withFlight(NO_BOARD, "f1", "D-ABCD"), state({ ended: { at: "x", reason: "refused" } }));
  assert.equal(stopped.phase, "over");
  assert.equal(stoppedBy(stopped), "refused");
  const landed = withState(withFlight(NO_BOARD, "f1", "D-ABCD"), state({ ended: { at: "x", reason: "ended" } }));
  assert.equal(stoppedBy(landed), null);
});

test("a new flight forgets the last one's score and feats, but keeps its id among the pilot's", () => {
  const first = withState(withFlight(NO_BOARD, "f1", "D-ABCD"), state({ points: 500, granted: ["core"] }));
  const second = withFlight(first, "f2", "D-ABCD");
  assert.equal(second.points, 0);
  assert.deepEqual(second.granted, []);
  assert.deepEqual(second.flights, ["f1", "f2"]);
});

test("the pilot's own entry on the board is marked, by their flight or their callsign", () => {
  const view = withFlight(NO_BOARD, "f2", "D-ABCD");
  const entry = { rank: 1, callsign: "OE-KXR", points: 10, feats: [], flying: false, flight: "f9" };
  assert.equal(isOwn(entry, view), false);
  assert.equal(isOwn({ ...entry, flight: "f2" }, view), true);
  assert.equal(isOwn({ ...entry, callsign: "D-ABCD" }, view), true);
});

test("the board's top twenty are kept, and no more", () => {
  const top = Array.from({ length: 25 }, (_, i) => ({ rank: i + 1, callsign: `X${i}`, points: 100 - i, feats: [], flying: false, flight: `${i}` }));
  const view = withTop(NO_BOARD, { day: "2026-11-26", top }, true);
  assert.equal(view.top.length, 20);
  assert.equal(view.live, true);
  assert.equal(view.day, "2026-11-26");
});

test("the board's correction is its score less the cockpit's as of the same position, for a flight it counts", () => {
  const flying = { phase: "flying" as const, points: 1200, cockpitThen: 1300 };
  assert.equal(boardCorrection(flying), -100);
  assert.equal(boardCorrection({ ...flying, phase: "over" }), -100);
  assert.equal(boardCorrection({ ...flying, phase: "joining" }), null);
  assert.equal(boardCorrection({ ...flying, phase: "unavailable" }), null);
  assert.equal(boardCorrection({ ...flying, points: null }), null);
  assert.equal(boardCorrection({ ...flying, cockpitThen: null }), null);
});

test("a correction is taken in at once where a feat's points are in it, otherwise now and then", () => {
  assert.equal(syncDue(-1000, 0, 0), true);
  assert.equal(syncDue(-10, 0, 1000), false);
  assert.equal(syncDue(-10, 0, SYNC_EVERY_MS), true);
  assert.equal(syncDue(-10, -10, SYNC_EVERY_MS), false);
  assert.equal(syncDue(-10.4, -10, SYNC_EVERY_MS), false);
});

/* The pilot kept. */

const memoryStorage = () => {
  const kept = new Map<string, string>();
  return {
    getItem: (key: string) => kept.get(key) ?? null,
    setItem: (key: string, value: string) => { kept.set(key, value); },
    removeItem: (key: string) => { kept.delete(key); },
    kept,
  };
};

test("a pilot is kept, read back and forgotten", () => {
  const storage = memoryStorage();
  assert.equal(readPilot(storage), null);
  keepPilot(storage, { pilot: "0123456789abcdef0123456789abcdef", callsign: "D-ABCD" });
  assert.deepEqual(readPilot(storage), { pilot: "0123456789abcdef0123456789abcdef", callsign: "D-ABCD" });
  forgetPilot(storage);
  assert.equal(readPilot(storage), null);
});

test("what does not read as a pilot is none", () => {
  const storage = memoryStorage();
  storage.setItem(PILOT_KEY, "{oops");
  assert.equal(readPilot(storage), null);
  storage.setItem(PILOT_KEY, JSON.stringify({ pilot: "not hex", callsign: "D-ABCD" }));
  assert.equal(readPilot(storage), null);
  assert.equal(readPilot(null), null);
});

/* The cockpit's frame. */

test("a frame says the touchdown's sink only on the ground, and a stop only for a landing come to rest", () => {
  const base = {
    flight: 2, flown: 30,
    score: { points: 10, rate: 0, feats: ["core" as const], held: {}, synced: 0 },
  };
  const air = { lon: 1, lat: 2, altitude: 3000, onGround: false, touchdown: null, crash: null, tas: 120 };
  const rolling = { ...air, onGround: true, touchdown: { sink: 0.4 }, tas: 40 };
  const frame = (s: object) => frameOf({ ...base, state: s } as never);
  assert.equal(frame(air).touchdownSink, null);
  assert.equal(frame(rolling).touchdownSink, 0.4);
  assert.equal(frame(rolling).stopped, false);
  assert.equal(frame({ ...rolling, tas: 0 }).stopped, true);
  assert.equal(frame({ ...rolling, tas: 0, crash: "impact" }).stopped, false);
  assert.equal(frame({ ...air, crash: "impact" }).crashed, true);
  // The cockpit's own points go to the board, not the correction it took from it.
  assert.equal(frameOf({ ...base, score: { ...base.score, points: 60, synced: 50 }, state: air } as never).points, 10);
});
