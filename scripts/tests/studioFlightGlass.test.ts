import assert from "node:assert/strict";
import test from "node:test";
import { chargeOf, daylightOf, wetted } from "../../src/lib/studio/flight/glass.ts";
import { skyLighting } from "../../src/layers/aircraftRenderer.ts";

const fly = (seconds: number, from: number, air: Parameters<typeof wetted>[1]) => {
  let wet = from;
  for (let t = 0; t < seconds; t += 0.1) wet = wetted(wet, air, 0.1);
  return wet;
};

test("rain wets the windshield within a couple of seconds; warm cloud a little", () => {
  assert.ok(fly(3, 0, { rain: 1, cloud: 0, temperature: 10, tas: 130 }) > 0.95);
  const cloud = fly(5, 0, { rain: 0, cloud: 1, temperature: 10, tas: 130 });
  assert.ok(cloud > 0.4 && cloud < 0.5, String(cloud));
});

test("below freezing what strikes the glass is not water", () => {
  assert.equal(fly(5, 0, { rain: 1, cloud: 1, temperature: -10, tas: 130 }), 0);
});

test("out of the rain, the air blows the glass dry at speed; standing, it dries slowly", () => {
  const dry = { rain: 0, cloud: 0, temperature: 10 };
  assert.ok(fly(8, 1, { ...dry, tas: 130 }) < 0.05);
  assert.ok(fly(8, 1, { ...dry, tas: 0 }) > 0.8);
});

test("St Elmo's fire takes a storm's cloud, more where it is cold, and more with lightning nearby", () => {
  assert.equal(chargeOf({ cloud: 0, dbz: 55, temperature: -5 }), 0);
  assert.equal(chargeOf({ cloud: 1, dbz: 25, temperature: -5 }), 0);
  const warm = chargeOf({ cloud: 1, dbz: 50, temperature: 12 });
  const cold = chargeOf({ cloud: 1, dbz: 50, temperature: -5 });
  assert.ok(warm > 0 && cold > warm, `${warm} ${cold}`);
  assert.ok(chargeOf({ cloud: 1, dbz: 30, temperature: -5 }, 1) > 0.5);
  assert.ok(chargeOf({ cloud: 1, dbz: 70, temperature: -5 }, 1) <= 1);
});

test("cloud takes the sun off the flight deck, and a storm the sky's light too", () => {
  assert.deepEqual(daylightOf(0, null), { sun: 1, sky: 1 });
  const cloud = daylightOf(1, 20);
  assert.ok(cloud.sun < 0.1 && cloud.sky > 0.7, JSON.stringify(cloud));
  const storm = daylightOf(1, 55);
  assert.ok(storm.sun < cloud.sun && storm.sky < 0.4, JSON.stringify(storm));
});

test("the sky's light keeps its lighting in clear air, and in cloud keeps no side lit and none black", () => {
  assert.deepEqual(skyLighting([0.62, 0.42, 0.1]), [0.62, 0.42, 0.1]);
  const [ambient, lit, away] = skyLighting([0.62, 0.42, 0.1], 0, 0.35);
  assert.equal(lit, 0);
  assert.ok(ambient > 0.4 && away > 0, `${ambient} ${away}`);
});
