import assert from "node:assert/strict";
import test from "node:test";
import { FEATS, landedScore, NO_SCORE, rateOf, scored } from "../../src/lib/studio/flight/score.ts";
import type { FlightScore, ScoreSample } from "../../src/lib/studio/flight/score.ts";

const CLEAR: ScoreSample = { dbz: null, cloud: 0, charge: 0, hail: 0, glare: 0, frost: 0, severity: 0, flying: true };

const fly = (seconds: number, sample: ScoreSample, from: FlightScore = NO_SCORE) => {
  let score = from;
  for (let t = 0; t < seconds - 1e-9; t += 0.1) score = scored(score, sample, 0.1).score;
  return score;
};

test("the stronger the echo inside a cloud, the faster the points come; none out of cloud", () => {
  assert.equal(rateOf(60, 1), 20);
  assert.equal(rateOf(48, 1), 8);
  assert.equal(rateOf(38, 1), 3);
  assert.equal(rateOf(25, 1), 1);
  assert.equal(rateOf(10, 1), 0);
  assert.equal(rateOf(60, 0.1), 0);
  assert.equal(rateOf(null, 1), 0);
  assert.ok(Math.abs(fly(10, { ...CLEAR, dbz: 48, cloud: 1 }).points - 80) < 1e-6);
});

test("nothing scores on the ground or as a wreck", () => {
  const score = fly(10, { ...CLEAR, dbz: 60, cloud: 1, charge: 1, flying: false });
  assert.equal(score.points, 0);
  assert.deepEqual(score.feats, []);
});

test("St Elmo's fire earns its bonus once, after it has held a moment", () => {
  const charged = { ...CLEAR, charge: 0.8 };
  assert.deepEqual(fly(1, charged).feats, []);
  const score = fly(2, charged);
  assert.deepEqual(score.feats, ["stElmo"]);
  assert.equal(score.points, FEATS.stElmo.points);
  // Never twice in a flight.
  assert.equal(fly(10, charged, score).points, FEATS.stElmo.points);
});

test("a bonus let go of before it holds starts again", () => {
  let score = fly(1, { ...CLEAR, charge: 0.8 });
  score = fly(0.3, CLEAR, score);
  score = fly(1, { ...CLEAR, charge: 0.8 }, score);
  assert.deepEqual(score.feats, []);
});

test("ten seconds in a storm's core is a bonus on top of its points", () => {
  const score = fly(10.5, { ...CLEAR, dbz: 58, cloud: 1 });
  assert.ok(score.feats.includes("core"));
  assert.ok(Math.abs(score.points - (10.5 * 20 + FEATS.core.points)) < 1e-6);
});

test("a landing scores, a butter one more, each once", () => {
  const firm = landedScore(NO_SCORE, 2);
  assert.deepEqual(firm.earned, ["landed"]);
  const butter = landedScore(firm.score, 0.3);
  assert.deepEqual(butter.earned, ["butter"]);
  assert.equal(butter.score.points, FEATS.landed.points + FEATS.butter.points);
  assert.deepEqual(landedScore(butter.score, 0.3).earned, []);
});
