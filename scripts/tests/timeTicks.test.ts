import assert from "node:assert/strict";
import test from "node:test";
import { STEPS_MINUTES, timeTicks } from "../../src/lib/timeTicks.ts";

const MIN = 60_000;
/** 16:00 on an arbitrary day, so a tick landing on the clock is readable. */
const at = (h: number, m: number) => Date.UTC(2026, 8, 20, h, m) as number;
const hhmm = (t: number) => new Date(t).toISOString().slice(11, 16);

test("ticks land on the clock, not on the data", () => {
  // A cell tracked from 16:07 to 16:52 used to be labelled 16:07 and 16:52.
  const ticks = timeTicks(at(16, 7), at(16, 52)).map(hhmm);
  assert.ok(ticks.includes("16:15"));
  assert.ok(ticks.includes("16:30"));
  assert.ok(ticks.includes("16:45"));
});

test("some tick is always shown, however short the window", () => {
  // A cell seen twice still has to say what the chart is showing.
  assert.ok(timeTicks(at(16, 0), at(16, 3)).length >= 2);
  assert.ok(timeTicks(at(16, 0), at(16, 0) + 30_000).length >= 2);
});

test("an end close to a step tick is dropped rather than printed over it", () => {
  // The charts showed this: 14:35 landed hard against 15:00 on an hourly axis.
  const ticks = timeTicks(at(14, 35), at(18, 28)).map(hhmm);
  assert.ok(!ticks.includes("14:35"), ticks.join(" "));
  assert.ok(!ticks.includes("18:28"), ticks.join(" "));
  assert.ok(ticks.includes("15:00") && ticks.includes("18:00"));
});

test("an end far from any tick is still labelled", () => {
  const ticks = timeTicks(at(16, 5), at(17, 55), 4).map(hhmm);
  assert.ok(ticks.includes("16:05"), ticks.join(" "));
});

test("the ends are labelled unless a tick is already there", () => {
  const exact = timeTicks(at(16, 0), at(17, 0)).map(hhmm);
  // On the hour at both ends, so no extra end labels crowd in beside them.
  assert.equal(exact[0], "16:00");
  assert.equal(exact[exact.length - 1], "17:00");
  assert.ok(new Set(exact).size === exact.length);
});

test("a long track steps up rather than printing forty labels", () => {
  const ticks = timeTicks(at(8, 0), at(20, 0));
  assert.ok(ticks.length <= 8, `got ${ticks.length}`);
});

test("every step is a whole hour or divides one", () => {
  // So a run reads 15, 30, 45 rather than 13, 26, 39.
  STEPS_MINUTES.forEach((m) => assert.ok(60 % m === 0 || m % 60 === 0));
});

test("nothing is emitted twice, and they run forwards", () => {
  const ticks = timeTicks(at(16, 7), at(18, 22));
  assert.deepEqual([...ticks].sort((a, b) => a - b), ticks);
  assert.equal(new Set(ticks).size, ticks.length);
});

test("a degenerate window does not hang or invent a range", () => {
  assert.deepEqual(timeTicks(at(16, 0), at(16, 0)), [at(16, 0)]);
  assert.deepEqual(timeTicks(at(16, 0), at(15, 0)), [at(16, 0)]);
  assert.deepEqual(timeTicks(Number.NaN, at(16, 0)), []);
});

test("ticks stay inside the window they label", () => {
  const from = at(16, 7);
  const to = at(17, 41);
  timeTicks(from, to).forEach((t) => {
    assert.ok(t >= from && t <= to, `${hhmm(t)} outside ${hhmm(from)}-${hhmm(to)}`);
  });
});

test("the step scales with the span rather than the count of readings", () => {
  const short = timeTicks(at(16, 0), at(16, 40));
  const long = timeTicks(at(16, 0), at(22, 0));
  const gap = (ticks: number[]) => ticks[2] - ticks[1];
  assert.ok(gap(long) > gap(short));
  assert.ok(gap(short) >= 5 * MIN);
});
