import assert from "node:assert/strict";
import test, { mock } from "node:test";
import {
  isBehind, isPastItsScan, isVolumeBehind, networkOf, radarScanOf, scanTime, VolumeFeed, VOLUME_RETRIES,
  VOLUME_RETRY_MS,
} from "../../src/lib/scans.ts";

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
  // The first ask is still 00:00's, passed on again: it may hold parts of a
  // run, or another network's, that the last answer did not.
  assert.deepEqual(seen, ["2026-10-01T00:00:00Z", "2026-10-01T00:00:00Z", "2026-10-01T00:05:00Z"]);

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
  assert.deepEqual(seen, ["2026-10-01T00:05:00Z"]);
});

test("an answer as new as the last is passed on: another network's run, or a further part", () => {
  // The list's time is the newest of every network's runs, so Germany's
  // 00:00 run landing after Switzerland's 00:01 leaves it at 00:01.
  const seen: Array<string | null | undefined> = [];
  const feed = new VolumeFeed(async () => null, (answer) => seen.push(answer.reference_time));
  assert.ok(feed.offer(volumes("00:01")));
  assert.ok(feed.offer(volumes("00:01")));
  assert.equal(seen.length, 2);
});

test("a storm is judged against its own network's radar", () => {
  assert.equal(networkOf({ network: "fr" }), "fr");
  // From before volumes were filed by network: DWD's, which was all there was.
  assert.equal(networkOf({ network: null }), "de");
  assert.equal(networkOf({}), "de");
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

const radar = (de: string | null, networks: Record<string, string> = {}, whole = false) => ({
  scan: de && at(de),
  whole,
  networks: Object.fromEntries(Object.entries(networks).map(([code, hhmm]) => [code, { upstream_time: at(hhmm) }])),
});
const storm = (hhmm: string, network?: string) => ({ network, reference_time: `2026-10-01T${hhmm}:00Z` });

test("a storm is judged against its own network's radar, not DWD's", () => {
  // France's composite is on its own clock: 00:04 is its newest, DWD's 00:05.
  const shown = radar("00:05", { fr: "00:04" });
  assert.ok(!isVolumeBehind(storm("00:04", "fr"), shown));
  assert.ok(isVolumeBehind(storm("00:00", "de"), shown));
  // Volumes from before networks were recorded are DWD's.
  assert.ok(isVolumeBehind(storm("00:00"), shown));
  assert.ok(!isVolumeBehind(storm("00:05"), shown));
});

test("under the merged composite every storm is judged against its one frame", () => {
  const shown = radar("00:05", {}, true);
  assert.equal(radarScanOf("fr", shown), at("00:05"));
  assert.ok(isVolumeBehind(storm("00:04", "fr"), shown));
});

test("a storm with no radar drawn under it is not behind", () => {
  assert.ok(!isVolumeBehind(storm("00:00", "fr"), radar("00:05")));
  assert.ok(!isVolumeBehind(storm("00:00"), radar(null)));
});

test("an open storm is past its scan once a newer list of its network comes without it", () => {
  const open = { path: "a/1020/de-1", network: "de", reference_time: "2026-10-01T10:20:00Z" };
  const later = (path: string, network = "de") => ({ path, network, reference_time: "2026-10-01T10:25:00Z" });
  assert.equal(isPastItsScan(open, [later("b/1025/de-1"), later("b/1025/de-2")]), true);
  // Still listed, or nothing newer from its own network: nothing has moved past it.
  assert.equal(isPastItsScan(open, [open, later("b/1025/de-2")]), false);
  assert.equal(isPastItsScan(open, [later("b/1025/ch-1", "ch")]), false);
  // Before the first list, every storm is missing from it.
  assert.equal(isPastItsScan(open, []), false);
  // Volumes from before networks were recorded are DWD's.
  assert.equal(isPastItsScan({ ...open, network: null }, [later("b/1025/de-1")]), true);
});
