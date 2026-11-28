import assert from "node:assert/strict";
import test from "node:test";
import {
  aheadOf, describeReading, legendPosition, legendValue, MAX_AGE_S, offeredQuantities, settledMode, stepsWithSweep, sweepAt,
  SWEEP_LEGENDS, sweepLegendTicks, tiltNear, velocityTicks, withQuantity, withTilt,
} from "../../src/lib/siteSweeps.ts";
import type { ListedSite, SiteMode } from "../../src/lib/siteSweeps.ts";
import {
  colourAt, RHOHV_STOPS, sweepEncodingTable, SWEEP_NEUTRAL, velocityTable, VELOCITY_CALM, VELOCITY_NO_ECHO, VELOCITY_UNRESOLVED,
} from "../../src/colormaps.ts";
import { motionOf } from "../../src/lib/stormSelection.ts";

const at = (minute: number) => ({ scanned_at: new Date(Date.UTC(2026, 9, 9, 18, minute)).toISOString(), path: `p${minute}` });
const step = (minute: number) => Date.UTC(2026, 9, 9, 18, minute) / 1000;
const SCANS = [at(0), at(5), at(10), at(15)];

test("a step shows the newest sweep scanned by then", () => {
  assert.equal(sweepAt(SCANS, step(12), false)?.path, "p10");
  assert.equal(sweepAt(SCANS, step(10), false)?.path, "p10");
});

test("a step with nothing recent enough shows no sweep rather than old weather", () => {
  assert.equal(sweepAt(SCANS, step(15) + MAX_AGE_S + 1, false), null);
  assert.equal(sweepAt(SCANS, step(-1), false), null);
});

test("the live step shows the newest sweep, whatever its stamp", () => {
  // A site files a cycle whole, minutes after the composite's step.
  assert.equal(sweepAt(SCANS, step(10), true)?.path, "p15");
});

test("a tilt is kept across a change of quantity, else the lowest is taken", () => {
  const tilts = [{ elevation_deg: 0.5, scans: [] }, { elevation_deg: 1.5, scans: [] }, { elevation_deg: 2.5, scans: [] }];
  assert.equal(tiltNear(tilts, 1.49)?.elevation_deg, 1.5);
  assert.equal(tiltNear(tilts, 8.0)?.elevation_deg, 0.5);
  assert.equal(tiltNear([], 0.5), null);
});

test("the sweeps fetched ahead are the next scanned, wrapping round", () => {
  assert.deepEqual(aheadOf(SCANS, SCANS[1]).map((scan) => scan.path), ["p10", "p15", "p0"]);
  assert.deepEqual(aheadOf(SCANS, null, 2).map((scan) => scan.path), ["p0", "p5"]);
});

const t = (key: string, options?: { values?: Record<string, string | number> }) => (
  options?.values ? `${key}(${Object.entries(options.values).map(([k, v]) => `${k}=${v}`).join(",")})` : key
);

test("a reading says the value and where the bin is", () => {
  const bin = { azimuthDeg: 231.4, groundM: 84_250, heightM: 1_920 };
  assert.deepEqual(describeReading({ kind: "value", value: -12.5 }, "velocity", bin, t), {
    value: "site.read.toward(value=12.5)",
    where: "site.read.where(azimuth=231,range=84.3,height=1.9)",
  });
  assert.equal(describeReading({ kind: "value", value: 31 }, "reflectivity", bin, t).value, "site.read.dbz(value=31.0)");
  assert.equal(describeReading({ kind: "unresolved" }, "srv", bin, t).value, "site.read.unresolved");
});

test("the velocity palette is green toward, red away, grey when still, and marks the reserved bytes", () => {
  const table = velocityTable();
  assert.equal(table.length, 256);
  assert.deepEqual(table[0], [0, 0, 0, 0]);
  assert.deepEqual(table[1], VELOCITY_NO_ECHO);
  assert.deepEqual(table[255], VELOCITY_UNRESOLVED);
  assert.deepEqual(table[128], VELOCITY_CALM);
  const toward = table[108]; // -10 m/s
  const away = table[148]; // +10 m/s
  assert.ok(toward[1] > toward[0], "toward is green");
  assert.ok(away[0] > away[1], "away is red");
});

test("a storm's motion is its newest step's, in metres per second", () => {
  const selection = {
    id: null, summary: null, detail: null, volume: null,
    cell: { series: [{ speed_kmh: 36, heading_deg: 70 }] },
  } as unknown as Parameters<typeof motionOf>[0];
  assert.deepEqual(motionOf(selection), { speedMs: 10, headingDeg: 70 });
  assert.equal(motionOf({ ...selection, cell: null }), null);
});

test("the velocity legend labels every 5 m/s where the strip has room, coarser where it has not", () => {
  const values = (span: number, width: number) => velocityTicks(span, width).map((tick) => tick.value);
  assert.deepEqual(values(30, 1100), [-30, -25, -20, -15, -10, -5, 0, 5, 10, 15, 20, 25, 30]);
  // A phone's strip: 5 m/s apart ran +25 into the end-aligned 30.
  assert.deepEqual(values(30, 300), [-30, -20, -10, 0, 10, 20, 30]);
  assert.deepEqual(values(60, 300), [-60, -40, -20, 0, 20, 40, 60]);
  // Unmeasured yet: the coarsest, never a crowd.
  assert.deepEqual(values(30, 0), [-20, 0, 20]);
  // Every label has its room, the end ones included.
  for (const [span, width] of [[8, 300], [30, 300], [32.5, 307], [45, 300], [60, 640], [30, 1100]]) {
    const ticks = velocityTicks(span, width);
    ticks.slice(1).forEach((tick, i) => assert.ok((tick.at - ticks[i].at) * width >= 40, `${span} m/s on ${width} px`));
    assert.ok(ticks.every((tick) => tick.at >= 0 && tick.at <= 1));
  }
});

test("an open radar plays the observed steps it has a sweep for, and none after now", () => {
  const scans = [at(0), at(5), at(30)];
  const steps = [-5, 0, 5, 10, 15, 20, 25, 30, 35, 40].map(step);
  // 20 and 25: the sweep at 5 is more than two cycles old. 35 and 40: forecast.
  assert.deepEqual(stepsWithSweep(scans, steps, step(30)), [0, 5, 10, 15, 30].map(step));
  // The live step shows the newest sweep, filed after it.
  assert.deepEqual(stepsWithSweep([at(0), at(7)], [0, 5].map(step), step(5)), [0, 5].map(step));
});

/**
 * A German radar as next lists it: six tilts of reflectivity and velocity,
 * the coefficient and ZDR at its lowest, shear and divergence at the three
 * lowest of the velocity's.
 */
const tilts = (...elevations: number[]) => elevations.map((elevation_deg) => ({ elevation_deg, scans: [at(0)] }));
const DWD: ListedSite = {
  site: "deess", network: "de", lat: 51.4, lon: 6.97, newest: "2026-10-09T18:00:00Z",
  reflectivity: tilts(0.5, 1.5, 2.5, 3.5, 4.5, 5.5),
  velocity: tilts(0.5, 1.5, 2.5, 3.5, 4.5, 5.5),
  rhohv: tilts(0.5),
  zdr: tilts(0.5),
  shear: tilts(0.5, 1.5, 2.5),
  divergence: tilts(0.5, 1.5, 2.5),
};
const mode = (quantity: SiteMode["quantity"], elevation: number, returnTo?: number): SiteMode => (
  returnTo === undefined ? { site: "deess", quantity, elevation } : { site: "deess", quantity, elevation, returnTo }
);

test("the tray offers each quantity only where the listing has it", () => {
  assert.deepEqual(offeredQuantities(DWD, mode("velocity", 1.5)), ["reflectivity", "velocity", "srv", "rhohv", "zdr", "shear", "divergence"]);
  // A Swiss radar: velocity, no moments, no shear.
  const swiss: ListedSite = { ...DWD, rhohv: [], zdr: [], shear: [], divergence: [] };
  assert.deepEqual(offeredQuantities(swiss, mode("velocity", 0.5)), ["reflectivity", "velocity", "srv"]);
  // Reflectivity alone, from a listing that predates the moments.
  const old: ListedSite = { site: "deess", network: "de", lat: 51.4, lon: 6.97, newest: "", reflectivity: tilts(0.5) };
  assert.deepEqual(offeredQuantities(old, mode("reflectivity", 0.5)), ["reflectivity"]);
});

test("shear and divergence are offered only at a tilt they are listed for", () => {
  assert.ok(offeredQuantities(DWD, mode("velocity", 2.5)).includes("shear"));
  assert.ok(!offeredQuantities(DWD, mode("velocity", 4.5)).includes("shear"));
  assert.ok(!offeredQuantities(DWD, mode("velocity", 4.5)).includes("divergence"));
  // Opened from a link with no tilt, which says 0 for the lowest.
  assert.ok(offeredQuantities(DWD, mode("velocity", 0)).includes("shear"));
  // On the coefficient, which took the reader to the lowest tilt, by the tilt they had.
  assert.ok(!offeredQuantities(DWD, mode("rhohv", 0.5, 4.5)).includes("shear"));
});

test("picking the coefficient or ZDR takes the reader to the lowest tilt, and leaving it back to theirs", () => {
  const onCc = withQuantity(DWD, mode("velocity", 2.5), "rhohv");
  assert.deepEqual(onCc, mode("rhohv", 0.5, 2.5));
  // From one to the other, the tilt they had is kept.
  const onZdr = withQuantity(DWD, onCc, "zdr");
  assert.deepEqual(onZdr, mode("zdr", 0.5, 2.5));
  assert.deepEqual(withQuantity(DWD, onZdr, "reflectivity"), mode("reflectivity", 2.5));
});

test("any other change of quantity keeps the tilt", () => {
  assert.deepEqual(withQuantity(DWD, mode("velocity", 1.5), "shear"), mode("shear", 1.5));
  assert.deepEqual(withQuantity(DWD, mode("shear", 1.5), "srv"), mode("srv", 1.5));
});

test("stepping shear or divergence to a tilt without them falls back to velocity", () => {
  assert.deepEqual(withTilt(DWD, mode("shear", 0.5), 2.5), mode("shear", 2.5));
  assert.deepEqual(withTilt(DWD, mode("shear", 0.5), 4.5), mode("velocity", 4.5));
  assert.deepEqual(withTilt(DWD, mode("divergence", 1.5), 5.5), mode("velocity", 5.5));
  assert.deepEqual(withTilt(DWD, mode("reflectivity", 0.5), 5.5), mode("reflectivity", 5.5));
});

test("a mode the listing cannot draw is settled on one it can", () => {
  // Shear gone from the tilt in a newer cycle: velocity; with no velocity either, reflectivity.
  assert.deepEqual(settledMode({ ...DWD, shear: tilts(0.5) }, mode("shear", 1.5)), mode("velocity", 1.5));
  assert.deepEqual(settledMode({ ...DWD, velocity: [], shear: [] }, mode("shear", 1.5)), mode("reflectivity", 1.5));
  // Another radar opened on the coefficient: its own lowest tilt, or reflectivity at the reader's where it has none.
  assert.deepEqual(settledMode({ ...DWD, rhohv: tilts(0.494) }, mode("rhohv", 0.5, 2.5)), mode("rhohv", 0.494, 2.5));
  assert.deepEqual(settledMode({ ...DWD, rhohv: [] }, mode("rhohv", 0.5, 2.5)), mode("reflectivity", 2.5));
  // A shear tilt a little off the velocity's is the same tilt: Denmark lists 0.472 against 0.494.
  assert.deepEqual(settledMode({ ...DWD, shear: tilts(0.472) }, mode("shear", 0.494)), mode("shear", 0.494));
  // A link with no tilt says 0, the lowest: shear is there.
  assert.deepEqual(settledMode(DWD, mode("shear", 0)), mode("shear", 0));
  assert.deepEqual(settledMode({ ...DWD, velocity: tilts(0.648, 0.956), shear: tilts(0.472) }, mode("divergence", 0)), mode("divergence", 0));
  // What it can draw is left as it is.
  const drawable = mode("velocity", 4.5);
  assert.equal(settledMode(DWD, drawable), drawable);
  assert.equal(settledMode(DWD, mode("rhohv", 0.5, 2.5)).returnTo, 2.5);
});

test("a reading of the coefficient, ZDR, shear or divergence says its value in the legend's unit", () => {
  const bin = { azimuthDeg: 10, groundM: 20_000, heightM: 500 };
  const value = (reading: Parameters<typeof describeReading>[0], quantity: SiteMode["quantity"]) => describeReading(reading, quantity, bin, t).value;
  assert.equal(value({ kind: "value", value: 0.9712 }, "rhohv"), "site.read.cc(value=0.97)");
  assert.equal(value({ kind: "value", value: 1.625 }, "zdr"), "site.read.zdr(value=+1.6)");
  assert.equal(value({ kind: "value", value: -0.4 }, "zdr"), "site.read.zdr(value=-0.4)");
  assert.equal(value({ kind: "value", value: 0.01 }, "zdr"), "site.read.zdr(value=0.0)");
  assert.equal(value({ kind: "value", value: 4.2e-3 }, "shear"), "site.read.cyclonic(value=4.2)");
  assert.equal(value({ kind: "value", value: -1e-3 }, "shear"), "site.read.anticyclonic(value=1.0)");
  assert.equal(value({ kind: "value", value: 6e-3 }, "divergence"), "site.read.divergent(value=6.0)");
  assert.equal(value({ kind: "value", value: -2e-4 }, "divergence"), "site.read.convergent(value=0.2)");
  assert.equal(value({ kind: "value", value: 0 }, "shear"), "site.read.rate_zero(value=0.0)");
});

test("a bin with no value says why, never a number", () => {
  const bin = { azimuthDeg: 10, groundM: 20_000, heightM: 500 };
  assert.equal(describeReading({ kind: "too_weak" }, "rhohv", bin, t).value, "site.read.too_weak");
  assert.equal(describeReading({ kind: "masked" }, "shear", bin, t).value, "site.read.masked");
  assert.equal(describeReading({ kind: "no_estimate" }, "divergence", bin, t).value, "site.read.no_estimate");
});

test("not measured, no estimate, masked and too weak are drawn apart from every reading", () => {
  for (const encoding of ["rhohv-u8", "zdr-u8", "shear-u8", "divshear-u8"] as const) {
    const table = sweepEncodingTable(encoding)!;
    assert.equal(table.length, 256);
    assert.deepEqual(table[0], [0, 0, 0, 0], `${encoding} 0`);
    assert.deepEqual(table[1], VELOCITY_NO_ECHO, `${encoding} 1`);
    const values = table.slice(2, 255);
    const same = (a: number[], b: number[]) => a.every((c, i) => c === b[i]);
    assert.ok(values.every((rgba) => !same(rgba, [0, 0, 0, 0]) && !same(rgba, VELOCITY_NO_ECHO)), encoding);
  }
  assert.equal(sweepEncodingTable("vrad-u8"), null);
  assert.equal(sweepEncodingTable("rvp6-u8"), null);
});

test("the coefficient reads red for rain, yellow for the melting layer and violet for clutter", () => {
  const table = sweepEncodingTable("rhohv-u8")!;
  assert.deepEqual(table[197].slice(0, 3), [0xee, 0x52, 0x53]); // 0.98
  assert.deepEqual(table[182].slice(0, 3), [0xfe, 0xca, 0x57]); // 0.92
  assert.deepEqual(table[102].slice(0, 3), [0x6c, 0x5c, 0xe7]); // 0.60
  // Held past either end.
  assert.deepEqual(colourAt(RHOHV_STOPS, 0.05).slice(0, 3), [0x1a, 0x1a, 0x2e]);
  assert.deepEqual(colourAt(RHOHV_STOPS, 1.2).slice(0, 3), [0xf8, 0xa5, 0xc2]);
});

test("shear and divergence are neutral within their noise, warm one way and cool the other past it", () => {
  const shear = sweepEncodingTable("shear-u8")!;
  for (const byte of [118, 128, 138]) assert.deepEqual(shear[byte], SWEEP_NEUTRAL, `shear byte ${byte}`);
  assert.notDeepEqual(shear[139], SWEEP_NEUTRAL);
  const [cyclonic, anticyclonic] = [shear[168], shear[88]]; // ±4e-3
  assert.ok(cyclonic[0] > cyclonic[2], "cyclonic is warm");
  assert.ok(anticyclonic[2] > anticyclonic[0], "anticyclonic is cool");
  // Past 5e-3, saturated: one colour, not the scale's red.
  assert.deepEqual(shear[180], shear[254]);
  const divergence = sweepEncodingTable("divshear-u8")!;
  for (const byte of [121, 128, 135]) assert.deepEqual(divergence[byte], SWEEP_NEUTRAL, `divergence byte ${byte}`);
  const [divergent, convergent] = [divergence[153], divergence[103]]; // ±5e-3
  assert.ok(divergent[0] > divergent[1], "divergent is red, as velocity's outbound");
  assert.ok(convergent[1] > convergent[0], "convergent is green, as velocity's inbound");
});

test("a legend's axis gives each of its knots an even share of the strip, and reads back", () => {
  const { knots } = SWEEP_LEGENDS.rhohv!;
  assert.equal(legendPosition(knots, 0.2), 0);
  assert.equal(legendPosition(knots, 1.05), 1);
  assert.ok(Math.abs(legendPosition(knots, 0.9) - 4 / 7) < 1e-9);
  // 0.8 to 1 takes 3/7 of the strip, where a linear one would give it under a quarter.
  assert.ok(Math.abs(legendPosition(knots, 1) - legendPosition(knots, 0.8) - 3 / 7) < 1e-9);
  for (const value of [0.3, 0.83, 0.97, 1.02]) assert.ok(Math.abs(legendValue(knots, legendPosition(knots, value)) - value) < 1e-9);
  assert.equal(legendPosition(knots, -1), 0);
  assert.equal(legendPosition(knots, 2), 1);
});

test("a legend labels every tick where there is room, every second where there is not, keeping 0", () => {
  const labels = (quantity: "rhohv" | "zdr" | "shear" | "divergence", width: number) => sweepLegendTicks(SWEEP_LEGENDS[quantity]!, width).map((tick) => tick.label);
  assert.deepEqual(labels("zdr", 800), ["-2", "-1", "0", "+1", "+2", "+3", "+4", "+5", "+6"]);
  assert.deepEqual(labels("zdr", 200), ["-2", "0", "+2", "+4", "+6"]);
  assert.deepEqual(labels("shear", 400), ["-5", "-3", "0", "+3", "+5"]);
  assert.deepEqual(labels("divergence", 400), ["-10", "-5", "0", "+5", "+10"]);
  assert.deepEqual(labels("rhohv", 600), ["0.2", "0.5", "0.7", "0.8", "0.9", "0.95", "1"]);
  for (const quantity of ["rhohv", "zdr", "shear", "divergence"] as const) {
    for (const width of [120, 200, 320, 800]) {
      const ticks = sweepLegendTicks(SWEEP_LEGENDS[quantity]!, width);
      ticks.slice(1).forEach((tick, i) => assert.ok((tick.at - ticks[i].at) * width >= 30, `${quantity} on ${width} px`));
    }
  }
});
