import assert from "node:assert/strict";
import test from "node:test";
import { AirspaceSession } from "../../src/lib/studio/flight/airspace/session.ts";
import { encodeLook, INTACT } from "../../src/lib/studio/flight/airspace/look.ts";
import { PAUSED, writeSnapshot } from "../../src/lib/studio/flight/airspace/wire.ts";
import type { OwnState } from "../../src/lib/studio/flight/airspace/wire.ts";

/**
 * The airspace's session against a scripted socket, on a clock and timers
 * the test moves on itself.
 */

const PILOT = "0123456789abcdef0123456789abcdef";
const FIRST = "0123456789abcdef01234567";
const SECOND = "fedcba9876543210fedcba98";

class FakeSocket {
  static made: FakeSocket[] = [];
  url: string;
  binaryType = "blob";
  sent: Array<string | ArrayBuffer> = [];
  closedWith: number | null = null;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  constructor(url: string) {
    this.url = url;
    FakeSocket.made.push(this);
  }
  send(data: string | ArrayBuffer) {
    this.sent.push(typeof data === "string" ? data : data.slice(0));
  }
  close(code: number) {
    this.closedWith = code;
  }
  /** As the airspace would. */
  open() { this.onopen?.(); }
  say(message: object) { this.onmessage?.({ data: JSON.stringify(message) }); }
  drop(code: number) { this.onclose?.({ code }); }
  texts() { return this.sent.filter((data): data is string => typeof data === "string").map((data) => JSON.parse(data)); }
  states() { return this.sent.filter((data): data is ArrayBuffer => typeof data !== "string").map((data) => new DataView(data)); }
}

function harness() {
  FakeSocket.made = [];
  let now = 0;
  let ids = 0;
  const timers: Array<{ at: number; run: () => void; id: number }> = [];
  const session = new AirspaceSession({
    socketUrl: "ws://test/v3/air/airspace",
    WebSocket: FakeSocket as unknown as typeof WebSocket,
    now: () => now,
    setTimeout: (run, ms) => { const id = ++ids; timers.push({ at: now + ms, run, id }); return id; },
    clearTimeout: (id) => { const index = timers.findIndex((timer) => timer.id === id); if (index >= 0) timers.splice(index, 1); },
  });
  const own: OwnState = { flags: 0, lon: 9.5, lat: 50.4, altitude: 10_000, east: 200, north: 0, up: 0, heading: 90, pitch: 2, roll: 0, look: encodeLook(INTACT) };
  /** Move on `ms`, a cockpit frame every 50 ms unless `paused`, running the timers due. */
  const advance = (ms: number, boarded: { pilot: string; flight: string } | null, options: { paused?: boolean; crashed?: boolean } = {}) => {
    const until = now + ms;
    while (now < until) {
      now = Math.min(until, now + 50);
      if (!options.paused) session.frame(own, Boolean(options.crashed), boarded);
      for (;;) {
        timers.sort((a, b) => a.at - b.at);
        if (!timers[0] || timers[0].at > now) break;
        timers.shift()!.run();
      }
    }
  };
  const socket = (i = -1) => FakeSocket.made.at(i)!;
  return { session, advance, socket, own };
}

const joined = { type: "joined", id: 17, callsign: "D-ABCD", send_hz: 1, limits: { send_hz_most: 5, frames_per_s_most: 8, silent_ms: 10_000 } };

test("no socket before the board has a flight; then one, joined with the credential in the frame and not the address", () => {
  const { advance, socket } = harness();
  advance(2000, null);
  assert.equal(FakeSocket.made.length, 0);
  advance(100, { pilot: PILOT, flight: FIRST });
  assert.equal(FakeSocket.made.length, 1);
  assert.equal(socket().url, "ws://test/v3/air/airspace");
  assert.ok(!socket().url.includes(PILOT));
  assert.equal(socket().binaryType, "arraybuffer");
  socket().open();
  assert.deepEqual(socket().texts(), [{ type: "join", pilot: PILOT, flight: FIRST }]);
});

test("states go as often as the airspace asks, and a new board flight is joined again on the same socket", () => {
  const { advance, socket } = harness();
  const boarded = { pilot: PILOT, flight: FIRST };
  advance(100, boarded);
  socket().open();
  socket().say(joined);
  advance(3000, boarded);
  assert.equal(socket().states().length, 3);
  const [state] = socket().states();
  assert.equal(state.byteLength, 36);
  assert.equal(state.getUint8(0), 1);
  socket().say({ type: "rate", send_hz: 5 });
  advance(2000, boarded);
  assert.ok(socket().states().length >= 12 && socket().states().length <= 14, String(socket().states().length));
  // Counted one more each.
  const counters = socket().states().map((view) => view.getUint16(2, true));
  counters.forEach((counter, i) => assert.equal(counter, i));
  advance(100, { pilot: PILOT, flight: SECOND });
  assert.equal(FakeSocket.made.length, 1);
  assert.deepEqual(socket().texts().at(-1), { type: "join", pilot: PILOT, flight: SECOND });
});

test("paused, it says so and stands still", () => {
  const { advance, socket } = harness();
  const boarded = { pilot: PILOT, flight: FIRST };
  advance(100, boarded);
  socket().open();
  socket().say(joined);
  advance(3000, boarded, { paused: true });
  const last = socket().states().at(-1)!;
  assert.equal(last.getUint8(1) & PAUSED, PAUSED);
  assert.equal(last.getInt16(16, true), 0);
});

test("the board's flight over: left at once, or a wreck sent on a while first", () => {
  const landed = harness();
  landed.advance(100, { pilot: PILOT, flight: FIRST });
  landed.socket().open();
  landed.socket().say(joined);
  landed.advance(2000, { pilot: PILOT, flight: FIRST });
  landed.advance(100, null);
  assert.deepEqual(landed.socket().texts().at(-1), { type: "leave" });
  const sent = landed.socket().states().length;
  landed.advance(5000, null);
  assert.equal(landed.socket().states().length, sent);

  const wreck = harness();
  wreck.advance(100, { pilot: PILOT, flight: FIRST });
  wreck.socket().open();
  wreck.socket().say(joined);
  wreck.advance(2000, { pilot: PILOT, flight: FIRST });
  wreck.advance(5000, null, { crashed: true });
  assert.ok(wreck.socket().states().length >= 6);
  assert.ok(!wreck.socket().texts().some((message) => message.type === "leave"));
  wreck.advance(10_000, null, { crashed: true });
  assert.deepEqual(wreck.socket().texts().at(-1), { type: "leave" });
});

test("closes: another tab's or a refused flight waits for the next; the network reopens and joins again", () => {
  const { advance, socket } = harness();
  advance(100, { pilot: PILOT, flight: FIRST });
  socket().open();
  socket().say(joined);
  socket().drop(4409);
  advance(120_000, { pilot: PILOT, flight: FIRST });
  assert.equal(FakeSocket.made.length, 1, "not this flight again");
  advance(100, { pilot: PILOT, flight: SECOND });
  assert.equal(FakeSocket.made.length, 2, "the next flight tries afresh");
  socket().open();
  socket().say(joined);
  socket().drop(1006);
  advance(2900, { pilot: PILOT, flight: SECOND });
  assert.equal(FakeSocket.made.length, 2);
  advance(200, { pilot: PILOT, flight: SECOND });
  assert.equal(FakeSocket.made.length, 3);
  socket().open();
  assert.deepEqual(socket().texts(), [{ type: "join", pilot: PILOT, flight: SECOND }]);
});

test("a socket that never opens is tried again after 30 s, then a minute", () => {
  const { advance, socket } = harness();
  const boarded = { pilot: PILOT, flight: FIRST };
  advance(100, boarded);
  socket().drop(1006);
  advance(29_000, boarded);
  assert.equal(FakeSocket.made.length, 1);
  advance(1100, boarded);
  assert.equal(FakeSocket.made.length, 2);
  socket().drop(1006);
  advance(59_000, boarded);
  assert.equal(FakeSocket.made.length, 2);
  advance(1100, boarded);
  assert.equal(FakeSocket.made.length, 3);
});

test("snapshots and names are heard; the end of the flight lets everything go", () => {
  const { session, advance, socket } = harness();
  const boarded = { pilot: PILOT, flight: FIRST };
  advance(100, boarded);
  socket().open();
  socket().say(joined);
  socket().say({ type: "names", names: { 23: "F-BSKE" } });
  const own: OwnState = { flags: 0, lon: 9.6, lat: 50.4, altitude: 9000, east: 0, north: 200, up: 0, heading: 0, pitch: 0, roll: 0, look: encodeLook(INTACT) };
  socket().onmessage?.({ data: writeSnapshot(1000, [{ id: 23, ageMs: 0, state: own }]) });
  assert.equal(session.traffic.list.length, 1);
  assert.equal(session.traffic.list[0].callsign, "F-BSKE");
  session.leave();
  assert.deepEqual(socket().texts().at(-1), { type: "leave" });
  assert.equal(socket().closedWith, 1000);
  assert.equal(session.traffic.list.length, 0);
});
