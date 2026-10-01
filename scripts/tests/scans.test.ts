import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { isBehind, scanTime, VolumeFeed, VOLUME_RETRIES, VOLUME_RETRY_MS } from "../../src/lib/scans.ts";

const at = (hhmm: string) => scanTime(`2026-10-01T${hhmm}:00Z`)!;

test("a run older than the radar is behind it, its own scan is not", () => {
  // Staging at 00:09: the 00:05 composite is out, KONRAD3D's 00:05 run is not.
  assert.ok(isBehind(at("00:00"), at("00:05")));
  assert.ok(!isBehind(at("00:05"), at("00:05")));
  // Ahead of a radar grid not refreshed yet is not behind either.
  assert.ok(!isBehind(at("00:10"), at("00:05")));
});

test("nothing is behind an unknown radar, and nothing unknown is behind", () => {
  assert.ok(!isBehind(at("00:00"), null));
  assert.ok(!isBehind(null, at("00:05")));
  assert.ok(!isBehind(undefined, at("00:05")));
});

test("scanTime reads ISO times as the grid's epoch seconds", () => {
  assert.equal(scanTime("2026-10-01T00:05:00Z"), 1790813100);
  assert.equal(scanTime(null), null);
  assert.equal(scanTime("not a time"), null);
});

const volumes = (hhmm: string | null) => ({ reference_time: hhmm && `2026-10-01T${hhmm}:00Z` });

/** Lets the feed's awaited fetch settle after a timer fires. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

test("the feed asks again until the run's own volumes are built", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const served = [volumes("00:00"), volumes("00:05")];
  const fetch = mock.fn(async () => served.shift() ?? null);
  const seen: Array<string | null | undefined> = [];
  const feed = new VolumeFeed(fetch, (answer) => seen.push(answer.reference_time));

  // The 00:05 run lands while 00:05's volumes are still being built.
  feed.offer(volumes("00:00"));
  feed.follow(at("00:05"));
  assert.equal(fetch.mock.callCount(), 0);

  t.mock.timers.tick(VOLUME_RETRY_MS);
  await settle();
  t.mock.timers.tick(VOLUME_RETRY_MS);
  await settle();
  assert.deepEqual(seen, ["2026-10-01T00:00:00Z", "2026-10-01T00:05:00Z"]);

  // Caught up: no more asks.
  t.mock.timers.tick(VOLUME_RETRY_MS * 5);
  await settle();
  assert.equal(fetch.mock.callCount(), 2);
});

test("the feed gives up on a scan that never gets volumes", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const fetch = mock.fn(async () => volumes("00:00"));
  const feed = new VolumeFeed(fetch, () => {});
  feed.offer(volumes("00:00"));
  feed.follow(at("00:05"));
  for (let i = 0; i < VOLUME_RETRIES + 3; i += 1) {
    t.mock.timers.tick(VOLUME_RETRY_MS);
    await settle();
  }
  assert.equal(fetch.mock.callCount(), VOLUME_RETRIES);
});

test("an older answer landing late does not put the previous scan back", () => {
  const seen: Array<string | null | undefined> = [];
  const feed = new VolumeFeed(async () => null, (answer) => seen.push(answer.reference_time));
  assert.ok(feed.offer(volumes("00:05")));
  assert.ok(!feed.offer(volumes("00:00")));
  assert.ok(!feed.offer(volumes("00:05")));
  assert.deepEqual(seen, ["2026-10-01T00:05:00Z"]);
});

test("stopping drops an ask already in flight", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let release: (value: ReturnType<typeof volumes>) => void = () => {};
  const fetch = mock.fn(() => new Promise<ReturnType<typeof volumes>>((resolve) => { release = resolve; }));
  const seen: unknown[] = [];
  const feed = new VolumeFeed(fetch, (answer) => seen.push(answer));
  feed.offer(volumes("00:00"));
  feed.follow(at("00:05"));
  t.mock.timers.tick(VOLUME_RETRY_MS);
  assert.equal(fetch.mock.callCount(), 1);
  feed.stop();
  release(volumes("00:05"));
  await settle();
  assert.equal(seen.length, 1);
});

test("nothing is waited for without a run or without any volumes", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const fetch = mock.fn(async () => null);
  const feed = new VolumeFeed(fetch, () => {});
  feed.follow(at("00:05"));
  feed.offer(volumes(null));
  feed.follow(at("00:05"));
  feed.offer(volumes("00:00"));
  feed.follow(null);
  t.mock.timers.tick(VOLUME_RETRY_MS * 3);
  await settle();
  assert.equal(fetch.mock.callCount(), 0);
});
