import assert from "node:assert/strict";
import test from "node:test";
import {
  NOWCAST_DOMAINS, chartFrames, domainsAt, domainsWithRun, nowcastRuns,
} from "../../src/lib/nowcast.ts";

/**
 * meteocool's own nowcast outside Germany: which runs a timeseries carries,
 * which of them draw on a step, and the chart's bars at
 * a point one of the networks draws.
 */

const NOW = 1_700_000_100;
const STEP = 300;

/** A run issued at `issued`, with a lead on each of `leads` steps, each reading `dbz`. */
function run(issued: number, leads: number, dbz: number | null = null) {
  const steps: Record<string, { tile_id: string; source: string; dbz?: number | null }> = {};
  for (let i = 1; i <= leads; i += 1) steps[issued + i * STEP] = { tile_id: `t${i}`, source: "nowcast_phys", dbz };
  return steps;
}

test("the runs are read from their nowcast_ keys, and nothing else under products is one", () => {
  const runs = nowcastRuns({
    nowcast_fr: run(NOW, 12),
    nowcast_ch: run(NOW, 12),
    nowcast_de: run(NOW, 24),
    nowcast_pl: {},
    dmax: { [NOW]: { tile_id: "d", source: "observation" } },
  });
  assert.deepEqual(Object.keys(runs).sort(), ["ch", "fr"]);
  assert.deepEqual(domainsWithRun(runs), ["ch", "fr"]);
  assert.deepEqual(nowcastRuns(undefined), {});
  assert.deepEqual(NOWCAST_DOMAINS, ["ch", "fr", "cz", "pl"]);
});

test("a step draws the runs with a lead valid there, and none past their last", () => {
  const runs = nowcastRuns({ nowcast_fr: run(NOW, 12), nowcast_cz: run(NOW - STEP, 12) });
  assert.deepEqual(domainsAt(runs, NOW + STEP), ["fr", "cz"]);
  assert.deepEqual(domainsAt(runs, NOW + 12 * STEP), ["fr"]);
  assert.deepEqual(domainsAt(runs, NOW + 13 * STEP), []);
  assert.deepEqual(domainsAt(runs, NOW - STEP), []);
});

test("the chart's forecast bars come from the point's run, and stop at its last lead", () => {
  const frames = {
    [NOW]: { source: "observation", dbz: 30 },
    [NOW + STEP]: { source: "nowcast_phys", dbz: null },
    [NOW + 2 * STEP]: { source: "nowcast_phys", dbz: null },
    [NOW + 3 * STEP]: { source: "nowcast_phys", dbz: null },
    [NOW + 4 * STEP]: null,
  };
  const chart = chartFrames(frames, { [NOW + STEP]: { dbz: 25 }, [NOW + 2 * STEP]: { dbz: 12.5 } });
  assert.equal(chart[NOW]?.dbz, 30);
  assert.equal(chart[NOW + STEP]?.dbz, 25);
  assert.equal(chart[NOW + 2 * STEP]?.dbz, 12.5);
  // Past the run: no forecast, not dry.
  assert.equal(chart[NOW + 3 * STEP]?.dbz, null);
  assert.equal(chart[NOW + 4 * STEP], null);
  // The response is left as it came.
  assert.equal(frames[NOW + STEP]?.dbz, null);
});

test("without a run for the point, the chart is WN's as ever", () => {
  const frames = { [NOW + STEP]: { source: "nowcast_phys", dbz: 18 } };
  assert.equal(chartFrames(frames, undefined), frames);
});
