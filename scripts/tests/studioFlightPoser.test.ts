import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseModel, PartPoser, posedParts, smearedParts } from "../../src/lib/studio/flight/model.ts";
import type { AircraftModel, PartPositions } from "../../src/lib/studio/flight/model.ts";
import { outsideEye } from "../../src/lib/studio/flight/view.ts";

const bytes = readFileSync(new URL("../../public/models/a320/a320.bin", import.meta.url));
const model: AircraftModel = parseModel(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));

const eye = new Float32Array(outsideEye({ heading: 30, pitch: 4, roll: -12 }, { yaw: 160, pitch: -10 }, 55).modelView);
const light: [number, number, number] = [0.3, -0.5, -0.81];

test("the poser puts every part where posedParts and smearedParts do, to the last bit", () => {
  const poser = new PartPoser(model.parts);
  const cases: PartPositions[] = [
    { gear: 1, flaps: 0, spoilers: 0 },
    { gear: 0.4, flaps: 0.7, spoilers: 1, ailerons: -0.6, elevator: 0.3, rudder: 1, fans: 123, stickPitch: 0.5, thrustLevers: 0.8, gearLever: 1 },
    { gear: 0, flaps: 1, spoilers: 0.2, fans: 359.5 },
  ];
  for (const positions of cases) {
    for (const sweep of [0, 0.5, 7, 500]) {
      const before = JSON.stringify(positions);
      poser.pose(positions, sweep, eye, light);
      assert.equal(JSON.stringify(positions), before, "the positions are left as they were");
      const posed = posedParts(model.parts, positions, eye, light);
      assert.deepEqual([...poser.posed.keys()].sort(), [...posed.keys()].sort());
      for (const [name, part] of posed) {
        assert.deepEqual([...poser.posed.get(name)!.modelView], [...part.modelView], name);
        assert.deepEqual(poser.posed.get(name)!.light, part.light, name);
      }
      const smeared = smearedParts(model.parts, positions, sweep, eye, light);
      assert.deepEqual([...poser.smeared.keys()].sort(), [...smeared.keys()].sort());
      for (const [name, smear] of smeared) {
        const mine = poser.smeared.get(name)!;
        assert.equal(mine.opacity, smear.opacity);
        assert.equal(mine.count, smear.copies.length);
        smear.copies.forEach((copy, i) => {
          assert.deepEqual([...mine.copies[i].modelView], [...copy.modelView], `${name} ${i}`);
          assert.deepEqual(mine.copies[i].light, copy.light, `${name} ${i}`);
        });
      }
    }
  }
});

test("asked again, the poser answers in the same maps and the same numbers' places", () => {
  const poser = new PartPoser(model.parts);
  poser.pose({ gear: 0.5, flaps: 0.5, spoilers: 0.5, fans: 10 }, 300, eye, light);
  const first = poser.posed.get("fan.left") ?? [...poser.posed.values()][0];
  const smear = [...poser.smeared.values()][0];
  poser.pose({ gear: 0.6, flaps: 0.4, spoilers: 0.5, fans: 20 }, 300, eye, light);
  assert.ok(poser.posed.size > 0);
  assert.ok([...poser.posed.values()].includes(first));
  assert.ok([...poser.smeared.values()].includes(smear));
});
