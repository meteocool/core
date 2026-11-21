import assert from "node:assert/strict";
import test from "node:test";
import { airAt, roughAir, temperatureAt } from "../../src/lib/studio/flight/weather.ts";
import { boltPaths, FLASH_S, flicker, glare, thunderDelay } from "../../src/lib/studio/flight/lightning.ts";
import { boltStrips } from "../../src/layers/weatherPass.ts";

const near = (a: number, b: number, tolerance: number) => assert.ok(Math.abs(a - b) <= tolerance, `${a} is not ${b} ± ${tolerance}`);

/** A field that is the same echo everywhere, or a wall of it east of the aircraft. */
const everywhere = (dbz: number | null) => () => dbz;
const wallEast = (dbz: number) => (east: number) => (east > 0 ? dbz : null);

test("the air cools six and a half degrees a kilometre, from where a station says the ground is", () => {
  near(temperatureAt(0), 15, 1e-9);
  near(temperatureAt(4000), -11, 1e-9);
  near(temperatureAt(4000, 6), -5, 1e-9);
  // No colder above the tropopause.
  near(temperatureAt(13_000), temperatureAt(11_000), 1e-9);
});

test("clear air is calm, dry and does nothing", () => {
  const air = airAt(everywhere(null), 7000, 1500);
  assert.deepEqual([air.turbulence, air.draft, air.cloud, air.rain, air.hail, air.ice, air.icing], [0, 0, 0, 0, 0, 0, 0]);
  assert.equal(air.dbz, null);
});

test("echo is rain where it is warm and under the base, ice where it is cold, hail in a core", () => {
  const low = airAt(everywhere(42), 1000, 1500);
  assert.ok(low.rain > 0.6 && low.ice === 0 && low.cloud === 0, JSON.stringify(low));
  const high = airAt(everywhere(42), 7000, 1500);
  assert.ok(high.ice > 0.6 && high.rain === 0 && high.cloud === 1, JSON.stringify(high));
  assert.equal(airAt(everywhere(45), 3000, 1500).hail, 0);
  assert.ok(airAt(everywhere(60), 3000, 1500).hail > 0.7);
});

test("under the base it rains from the cloud above, though the radar saw nothing there; and warm cloud has some rain in it", () => {
  // Echo from the base up only, as when the beam passes over the bottom of a shower.
  const aloft = (east: number, north: number, up: number) => (1000 + up >= 1500 ? 38 : null);
  const under = airAt(aloft, 1000, 1500);
  assert.ok(under.rain > 0.6 && under.cloud === 0, JSON.stringify(under));
  // Cloud from weak echo, warm: wet, if not much.
  const warm = airAt(everywhere(18), 1800, 1500);
  assert.ok(warm.cloud > 0.5 && warm.rain >= 0.3 * warm.cloud, JSON.stringify(warm));
});

test("strong echo aloft in the cold goes up, heavy rain low down comes down, and both by more the stronger", () => {
  const up = airAt(everywhere(55), 7000, 1500).draft;
  const down = airAt(everywhere(55), 1200, 1500).draft;
  assert.ok(up > 10, `up ${up}`);
  assert.ok(down < -5, `down ${down}`);
  assert.ok(airAt(everywhere(45), 7000, 1500).draft < up);
  assert.equal(airAt(everywhere(25), 7000, 1500).draft, 0);
});

test("the edge of a core is rougher than the same echo spread evenly, and the air beside a storm is not calm", () => {
  const even = airAt(everywhere(30), 6000, 1500).turbulence;
  const edge = airAt((east) => (east > 0 ? 55 : 30), 6000, 1500).turbulence;
  assert.ok(edge > even + 0.2, `${edge} against ${even}`);
  const beside = airAt(wallEast(50), 6000, 1500);
  assert.ok(beside.turbulence > 0.1 && beside.cloud === 0, JSON.stringify(beside));
});

test("ice builds in cloud a little below freezing, and not in the deep cold or the warm", () => {
  assert.ok(airAt(everywhere(30), 3500, 1500).icing > 0.9);
  assert.equal(airAt(everywhere(30), 1600, 1500).icing, 0);
  assert.equal(airAt(everywhere(30), 9000, 1500).icing, 0);
});

test("rough air is still in calm, carries the draft, and is rougher the more turbulence", () => {
  assert.deepEqual(roughAir(12.3, 0), { roll: 0, pitch: 0, vertical: 0 });
  const lifted = roughAir(12.3, 0, 20).vertical;
  assert.ok(lifted > 20 * 0.3 && lifted <= 20, `${lifted}`);
  const spread = (turbulence: number) => {
    let most = 0;
    for (let t = 0; t < 60; t += 0.05) most = Math.max(most, Math.abs(roughAir(t, turbulence).roll));
    return most;
  };
  assert.ok(spread(1) > spread(0.3) * 2.5);
  assert.ok(spread(1) < 30);
});

test("short of a storm's core the air is only rough; from there it is severe, by 62 dBZ as bad as it gets, and its draughts with it", () => {
  for (const dbz of [20, 35, 45]) assert.equal(airAt(everywhere(dbz), 6000, 1500).severity, 0, `${dbz} dBZ`);
  const cores = [50, 55, 60, 62, 70].map((dbz) => airAt(everywhere(dbz), 6000, 1500));
  assert.deepEqual(cores.map((air) => air.turbulence), [1, 1, 1, 1, 1]);
  assert.ok(cores[0].severity > 0.1 && cores[0].severity < 0.3, `${cores[0].severity}`);
  for (let i = 1; i < 4; i++) assert.ok(cores[i].severity > cores[i - 1].severity);
  assert.ok(cores[2].severity > 0.8);
  assert.deepEqual([cores[3].severity, cores[4].severity], [1, 1]);
  // The edge of a heavy core is no better than its middle.
  assert.ok(airAt((east) => (east > 0 ? 62 : 30), 6000, 1500).severity > 0.3);
  assert.equal(airAt((east) => (east > 0 ? 45 : 20), 6000, 1500).severity, 0);
  // The draughts: up to 22 m/s from the echo alone, and most of that again in the worst of it.
  assert.ok(cores[3].draft > 35 && cores[3].draft < 42, `up ${cores[3].draft}`);
  assert.ok(airAt(everywhere(62), 1200, 1500).draft < -15);
  near(airAt(everywhere(45), 7000, 1500).draft, 22 * (11 / 26), 1e-9);
});

test("a core's gusts are the rough air's and more: larger, sharper, and a wing thrown a long way down", () => {
  assert.deepEqual(roughAir(12.3, 1, 5, 0), roughAir(12.3, 1, 5));
  assert.deepEqual(roughAir(12.3, 0, 0, 1), { roll: 0, pitch: 0, vertical: 0 });
  const measure = (severity: number) => {
    let [vertical, roll, pitch, sharpest, lean, bank] = [0, 0, 0, 0, 0, 0];
    let last = roughAir(0, 1, 0, severity).vertical;
    for (let t = 0.05; t < 300; t += 0.05) {
      const gust = roughAir(t, 1, 0, severity);
      vertical = Math.max(vertical, Math.abs(gust.vertical));
      roll = Math.max(roll, Math.abs(gust.roll));
      pitch = Math.max(pitch, Math.abs(gust.pitch));
      sharpest = Math.max(sharpest, Math.abs(gust.vertical - last) / 0.05);
      last = gust.vertical;
      // Where the roll gusts alone would take the bank, nothing flown against them.
      bank += gust.roll * 0.05;
      lean = Math.max(lean, Math.abs(bank));
    }
    return { vertical, roll, pitch, sharpest, lean };
  };
  const [rough, severe, extreme] = [measure(0), measure(0.5), measure(1)];
  assert.ok(rough.vertical < 24 && rough.roll < 30, JSON.stringify(rough));
  assert.ok(severe.vertical > rough.vertical * 1.3 && extreme.vertical > rough.vertical * 1.8, `${rough.vertical}, ${severe.vertical}, ${extreme.vertical}`);
  assert.ok(extreme.vertical < 70);
  assert.ok(extreme.sharpest > rough.sharpest * 2, `${rough.sharpest} against ${extreme.sharpest} m/s a second`);
  assert.ok(extreme.roll > rough.roll * 1.8 && extreme.pitch > rough.pitch * 1.5);
  assert.ok(extreme.lean > rough.lean * 2.5 && extreme.lean > 30, `${rough.lean} against ${extreme.lean} degrees`);
});

test("a flash flickers: brightest at once, dark between strokes, over within its time", () => {
  near(flicker(0), 1, 1e-9);
  assert.ok(flicker(0.06) < 0.3);
  assert.ok(flicker(0.151) > 0.7);
  assert.equal(flicker(FLASH_S + 0.01), 0);
  assert.equal(flicker(-0.1), 0);
});

test("a bolt comes down from its top to the strike, the same every time, with branches that stop in the air", () => {
  const paths = boltPaths(4242, 2800);
  assert.deepEqual(paths, boltPaths(4242, 2800));
  assert.notDeepEqual(paths, boltPaths(4243, 2800));
  const [channel, ...branches] = paths;
  near(channel[0][2], 2800, 1e-9);
  assert.deepEqual(channel[channel.length - 1], [0, 0, 0]);
  for (let i = 1; i < channel.length; i += 1) assert.ok(channel[i][2] < channel[i - 1][2]);
  assert.ok(branches.length >= 1 && branches.length <= 3);
  for (const branch of branches) assert.ok(branch[branch.length - 1][2] > 0);
  // A strip of six corners for every stretch of every path, eight numbers each.
  const stretches = paths.reduce((sum, path) => sum + path.length - 1, 0);
  assert.equal(boltStrips(paths.map((points) => ({ points, brightness: 1 }))).length, stretches * 6 * 8);
});

test("a flash overhead lights the glass, one a dozen kilometres off does not; thunder takes three seconds a kilometre", () => {
  near(glare(0), 1, 1e-9);
  assert.equal(glare(15_000), 0);
  assert.ok(glare(3000) > glare(8000));
  near(thunderDelay(3430), 10, 1e-9);
});

test("a storm's top is the highest its echo reaches, and none where there is no echo to read", async () => {
  const { echoTop } = await import("../../src/lib/studio/flight/marks.ts");
  // Echo up to 11.2 km, fading out above it.
  const storm = (altitude: number) => (altitude <= 11_200 ? 40 : altitude <= 12_000 ? 10 : null);
  near(echoTop(storm)!, 11_250, 1e-9);
  assert.equal(echoTop(() => null), null);
  assert.equal(echoTop(() => 5), null);
});

test("the freezing level is where a standard atmosphere, warmer or colder as the stations say, comes to zero", async () => {
  const { cloudBase, freezingLevel } = await import("../../src/lib/studio/flight/cloudBase.ts");
  near(freezingLevel(), 2307.7, 0.1);
  near(freezingLevel(6.5), 3307.7, 0.1);
  assert.equal(freezingLevel(-30), 0);
  // Stations at 400 m and 20 degrees are 7.6 warmer than standard there.
  const station = (spread: number) => ({ lon: 10, lat: 50, elevation: 400, temperature: 20, dewPoint: 20 - spread });
  near(cloudBase([station(8), station(10), station(12)], 10, 50)!.warmer, 20 - (15 - 2.6), 1e-9);
});

test("the briefing says where it freezes, and minds a level in the ice", async () => {
  const { briefing, planFrom } = await import("../../src/lib/studio/flight/plan.ts");
  const plan = planFrom({ lon: 10, lat: 50, heading: 90, altitude: 7300, target: null }, "sky");
  const line = (altitude: number, base?: { km: number; stations: number; warmer: number }) => (
    briefing({ ...plan, altitude }, [], null, base).find((each) => each.item === "freezing")!
  );
  assert.match(line(7300).text, /^FL076 · ICE IN CLD TO FL177 · STD ATMOS$/);
  assert.equal(line(7300).caution, false);
  assert.match(line(4000).text, /FL131 IS IN IT/);
  assert.equal(line(4000).caution, true);
  assert.match(line(7300, { km: 1.2, stations: 5, warmer: 6.5 }).text, /^FL109 · ICE IN CLD TO FL209$/);
});
