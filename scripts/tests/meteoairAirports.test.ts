import assert from "node:assert/strict";
import test from "node:test";

const { readTileLayer } = await import("../../src/lib/studio/flight/tileFeatures.ts");
const {
  airportsInTile, airportsOf, designators, joinRunways, LIGHT_FLOATS, nearestAirport, PAPI_ANGLES, runwayAt, runwayLights, widthFor,
} = await import("../../src/lib/studio/flight/airports.ts");
const { AirportWorld, AIRPORT_ZOOM, tilesRound } = await import("../../src/lib/studio/flight/airportWorld.ts");
const { destination, distanceM, offsetM } = await import("../../src/lib/studio/flight/geo.ts");

/**
 * The airports of a flight: what is read out of a basemap tile, how the
 * pieces of a runway the tiles cut are joined up again, what a runway is
 * called, where its lights stand, and which airport is the nearest.
 */

/* ---- a minimal vector tile encoder: a layer of features with text and number properties ---- */
const varint = (n: number): number[] => { const out = []; while (n > 127) { out.push((n & 127) | 128); n = Math.floor(n / 128); } out.push(n); return out; };
const field = (tag: number, payload: number[]) => [...varint((tag << 3) | 2), ...varint(payload.length), ...payload];
const uint = (tag: number, n: number) => [...varint(tag << 3), ...varint(n)];
const text = (s: string) => [...new TextEncoder().encode(s)];
const zigzag = (n: number) => (n << 1) ^ (n >> 31);

interface Made { type: 1 | 2; properties: Record<string, string | number>; parts: number[][] }

function layer(name: string, features: Made[], extent = 4096): number[] {
  const keys: string[] = [];
  const values: Array<string | number> = [];
  const index = <T>(list: T[], item: T) => (list.includes(item) ? list.indexOf(item) : list.push(item) - 1);
  const bodies = features.map(({ type, properties, parts }) => {
    const tags = Object.entries(properties).flatMap(([key, value]) => [index(keys, key), index(values, value)]);
    const geometry: number[] = [];
    let [x, y] = [0, 0];
    for (const part of parts) {
      // Move to the first point, then a line through the rest.
      geometry.push(9, zigzag(part[0] - x), zigzag(part[1] - y));
      if (part.length > 2) geometry.push(((part.length / 2 - 1) << 3) | 2);
      for (let i = 2; i < part.length; i += 2) geometry.push(zigzag(part[i] - part[i - 2]), zigzag(part[i + 1] - part[i - 1]));
      [x, y] = [part[part.length - 2], part[part.length - 1]];
    }
    return field(2, [...field(2, tags.flatMap(varint)), ...uint(3, type), ...field(4, geometry.flatMap(varint))]);
  });
  return field(3, [
    ...field(1, text(name)),
    ...bodies.flat(),
    ...keys.flatMap((key) => field(3, text(key))),
    // A number as a signed integer (field 6), text as text (field 1).
    ...values.flatMap((value) => field(4, typeof value === "number" ? uint(6, zigzag(value)) : field(1, text(value)))),
    ...uint(5, extent),
  ]);
}
const tile = (...layers: number[][]) => new Uint8Array(layers.flat());

const MUNICH = tile(
  layer("landuse", Array.from({ length: 40 }, (_, i) => ({ type: 2 as const, properties: { kind: "forest", n: i }, parts: [[0, 0, 10, 10]] }))),
  layer("roads", [
    { type: 2, properties: { kind: "highway", ref: "A92" }, parts: [[0, 0, 4096, 4096]] },
    { type: 2, properties: { kind: "aeroway", kind_detail: "runway", ref: "08R/26L", min_zoom: 10 }, parts: [[2919, 1032, 3231, 996]] },
    { type: 2, properties: { kind: "aeroway", kind_detail: "runway" }, parts: [[100, 200, 130, 210], [500, 600, 520, 640]] },
    { type: 2, properties: { kind: "aeroway", kind_detail: "taxiway", ref: "A1" }, parts: [[2919, 1040, 3000, 1030, 3100, 1020]] },
  ]),
  layer("pois", [
    { type: 1, properties: { kind: "forest", name: "Wald" }, parts: [[10, 10]] },
    { type: 1, properties: { kind: "aerodrome", name: "Flughafen München", iata: "MUC", elevation: "453" }, parts: [[3100, 1000]] },
  ]),
);

test("only the features asked for are read, with their properties and their parts", () => {
  const roads = readTileLayer(MUNICH, "roads", (properties) => properties.kind === "aeroway");
  assert.equal(roads.extent, 4096);
  assert.equal(roads.features.length, 3);
  assert.deepEqual(roads.features[0].properties, { kind: "aeroway", kind_detail: "runway", ref: "08R/26L", min_zoom: 10 });
  assert.deepEqual(roads.features[0].parts, [[2919, 1032, 3231, 996]]);
  assert.deepEqual(roads.features[1].parts, [[100, 200, 130, 210], [500, 600, 520, 640]]);
  assert.deepEqual(roads.features[2].parts, [[2919, 1040, 3000, 1030, 3100, 1020]]);
});

test("a tile without the layer, or one that is not a tile, has no features", () => {
  assert.deepEqual(readTileLayer(MUNICH, "transit", () => true).features, []);
  assert.deepEqual(readTileLayer(new Uint8Array([0x1a, 0xff, 0xff, 0xff]), "roads", () => true).features, []);
  assert.deepEqual(readTileLayer(new ArrayBuffer(0), "roads", () => true).features, []);
});

test("a tile's runways, taxiways and airport names are placed on the earth", () => {
  const found = airportsInTile(MUNICH, 9, 272, 177);
  assert.equal(found.runways.length, 3);
  assert.equal(found.runways[0].ref, "08R/26L");
  assert.equal(found.runways[1].ref, null);
  // Munich's southern runway: four kilometres, a little north of east.
  const [{ from, to }] = found.runways;
  assert.ok(Math.abs(distanceM(from[0], from[1], to[0], to[1]) - 4000) < 150);
  assert.ok(Math.abs(from[0] - 11.75) < 0.02 && Math.abs(from[1] - 48.34) < 0.02);
  assert.equal(found.taxiways.length, 1);
  assert.equal(found.taxiways[0].length, 6);
  assert.deepEqual(found.names.map(({ name, iata, elevation }) => ({ name, iata, elevation })), [{ name: "Flughafen München", iata: "MUC", elevation: 453 }]);
});

test("a runway is called by its mapped name, each half the way it points", () => {
  assert.deepEqual(designators(82, "08R/26L"), ["08R", "26L"]);
  assert.deepEqual(designators(262, "08R/26L"), ["26L", "08R"]);
  // Mapped the other way round, and with one name only.
  assert.deepEqual(designators(70, "25C/07C"), ["07C", "25C"]);
  assert.deepEqual(designators(180, "18"), ["18", "36"]);
  assert.deepEqual(designators(2, "18"), ["36", "18"]);
});

test("a runway nobody named is named from the way it points", () => {
  assert.deepEqual(designators(93), ["09", "27"]);
  assert.deepEqual(designators(274, null), ["27", "09"]);
  assert.deepEqual(designators(2), ["36", "18"]);
  assert.deepEqual(designators(357), ["36", "18"]);
  assert.deepEqual(designators(184, "grass"), ["18", "36"]);
});

/** A point `metres` along `bearing` from another. */
const along = (from: [number, number], bearing: number, metres: number) => destination(from[0], from[1], bearing, metres);

test("the pieces two tiles hold of one runway are joined into it", () => {
  const start: [number, number] = [11.75, 48.34];
  const pieces = [
    { from: start, to: along(start, 82, 2100), ref: "08R/26L" },
    // The next tile's piece, overlapping the first across the edge, drawn the other way.
    { from: along(start, 82, 4000), to: along(start, 82, 2000), ref: "08R/26L" },
    // A stub past the end with no name of its own.
    { from: along(start, 82, 4000), to: along(start, 82, 4060), ref: null },
  ];
  const [runway, ...others] = joinRunways(pieces);
  assert.equal(others.length, 0);
  assert.ok(Math.abs(runway.length - 4060) < 2);
  assert.deepEqual(runway.names, ["08R", "26L"]);
  assert.equal(runway.width, widthFor(4060));
  assert.equal(runway.lighting, "full");
});

test("two runways side by side stay two, and a stub of one is no runway", () => {
  const start: [number, number] = [11.5, 48.24];
  const beside = along(start, 162, 100);
  const runways = joinRunways([
    { from: start, to: along(start, 72, 800), ref: "07/25" },
    { from: beside, to: along(beside, 72, 1400), ref: null },
    { from: [12, 48], to: along([12, 48], 10, 90), ref: "01/19" },
  ]);
  assert.equal(runways.length, 2);
  assert.deepEqual(runways.map((runway) => runway.lighting), ["basic", "none"]);
});

function munich() {
  const south: [number, number] = [11.751, 48.3406];
  const north: [number, number] = [11.767, 48.3628];
  const field: [number, number] = [11.56, 48.239];
  return airportsOf([
    {
      runways: [{ from: south, to: along(south, 82, 2500), ref: "08R/26L" }, { from: north, to: along(north, 82, 4000), ref: "08L/26R" }],
      taxiways: [new Float32Array([11.76, 48.35, 11.77, 48.351])],
      names: [{ lon: 11.786, lat: 48.354, name: "Flughafen München", iata: "MUC", elevation: 453 }],
    },
    {
      runways: [{ from: along(south, 82, 2400), to: along(south, 82, 4000), ref: "08R/26L" }, { from: field, to: along(field, 72, 800), ref: "07/25" }],
      taxiways: [],
      names: [],
    },
  ]);
}

test("runways near each other are one airport, with the nearest name and its taxiways", () => {
  const airports = munich();
  assert.equal(airports.length, 2);
  const [large, small] = airports;
  assert.equal(large.iata, "MUC");
  assert.equal(large.elevation, 453);
  assert.deepEqual(large.runways.map((runway) => Math.round(runway.length / 100)), [40, 40]);
  assert.equal(large.taxiways.length, 1);
  assert.ok(Math.abs(large.lon - 11.786) < 0.01 && Math.abs(large.lat - 48.354) < 0.01);
  // Twenty kilometres off, with no name on the map.
  assert.equal(small.name, null);
  assert.deepEqual(small.runways[0].names, ["07", "25"]);
});

test("a runway's lights stand along its edges, across its ends and out along each approach", () => {
  const [airport] = munich();
  const runway = airport.runways[0];
  const lights = runwayLights(runway, [airport.lon, airport.lat]);
  assert.equal(lights.length % LIGHT_FLOATS, 0);
  const [fromEast, fromNorth] = offsetM(airport.lon, airport.lat, runway.from[0], runway.from[1]);
  const radians = (runway.bearing * Math.PI) / 180;
  /** Each light as how far along the runway and across it, with its colour and what else it does. */
  const placed = [];
  for (let at = 0; at < lights.length; at += LIGHT_FLOATS) {
    const [east, north] = [lights[at] - fromEast, lights[at + 1] - fromNorth];
    placed.push({
      along: east * Math.sin(radians) + north * Math.cos(radians), across: east * Math.cos(radians) - north * Math.sin(radians),
      colour: lights.slice(at + 3, at + 6), aim: lights.slice(at + 6, at + 8), extra: lights[at + 8],
    });
  }
  const edge = placed.filter((light) => Math.abs(Math.abs(light.across) - runway.width / 2) < 0.01 && light.aim[0] === 0 && light.aim[1] === 0);
  assert.ok(edge.length >= 2 * Math.floor(runway.length / 60));
  assert.ok(edge.every((light) => light.along > -0.01 && light.along < runway.length + 0.01));
  // Green across the start as an approach sees it, red across the far end; so both at each end.
  const green = placed.filter((light) => light.colour[1] > light.colour[0]);
  assert.ok(green.length >= 10);
  assert.ok(green.every((light) => light.along < 0 || light.along > runway.length));
  // An approach's lights reach nine hundred metres out, each way.
  assert.ok(Math.abs(Math.min(...placed.map((light) => light.along)) + 900) < 1);
  assert.ok(Math.abs(Math.max(...placed.map((light) => light.along)) - runway.length - 900) < 1);
  // Those before the start shine back at the approach: against the way the runway runs.
  const before = placed.filter((light) => light.along < -10);
  assert.ok(before.every((light) => light.aim[0] * Math.sin(radians) + light.aim[1] * Math.cos(radians) < -0.99));
  // The slope indicator: four each way, on the left of the approach, the highest angle nearest the runway.
  const papi = placed.filter((light) => light.extra > 0);
  assert.equal(papi.length, 8);
  const first = papi.filter((light) => light.along < runway.length / 2).sort((a, b) => Math.abs(a.across) - Math.abs(b.across));
  assert.deepEqual(first.map((light) => Number(light.extra.toFixed(2))), PAPI_ANGLES);
  assert.ok(first.every((light) => light.across < -runway.width / 2));
  // And some of the approach's flash, each in its own turn.
  const turns = placed.filter((light) => light.extra < 0 && light.along < 0).map((light) => -light.extra);
  assert.ok(turns.length >= 5 && new Set(turns).size === turns.length && turns.every((turn) => turn > 0 && turn <= 1.01));
});

test("a strip with no name has no lights, a short named runway no approach's", () => {
  const strip = joinRunways([{ from: [10, 50], to: along([10, 50], 30, 900), ref: null }])[0];
  assert.deepEqual(runwayLights(strip, [10, 50]), []);
  const short = joinRunways([{ from: [10, 50], to: along([10, 50], 30, 900), ref: "03/21" }])[0];
  const lights = runwayLights(short, [10, 50]);
  const furthest = Math.max(...Array.from({ length: lights.length / LIGHT_FLOATS }, (_, i) => Math.hypot(lights[i * LIGHT_FLOATS], lights[i * LIGHT_FLOATS + 1])));
  assert.ok(lights.length > 0 && furthest < 920);
});

test("the nearest airport is found, with the runway most nearly straight ahead on the way in", () => {
  const airports = munich();
  const west = nearestAirport(airports, 11.62, 48.42);
  assert.equal(west?.airport.iata, "MUC");
  assert.ok(["08L", "08R"].includes(west!.name));
  assert.ok(Math.abs(west!.course - 82) < 1);
  assert.ok(west!.distance > 8_000 && west!.distance < 20_000);
  const east = nearestAirport(airports, 12.1, 48.37);
  assert.ok(["26L", "26R"].includes(east!.name));
  // Nearer the small field than the large airport.
  assert.deepEqual(nearestAirport(airports, 11.55, 48.23)?.airport.runways[0].names, ["07", "25"]);
  // An airliner over the small field is still sent to the large one, unless the small one is all there is.
  const long = (runway: { length: number }) => runway.length >= 1400;
  assert.equal(nearestAirport(airports, 11.55, 48.23, long)?.airport.iata, "MUC");
  assert.deepEqual(nearestAirport(airports.slice(1), 11.55, 48.23, long)?.airport.runways[0].names, ["07", "25"]);
  assert.equal(nearestAirport([], 11.5, 48.3), null);
});

test("a place on a runway is on it, named the way the aircraft is going", () => {
  const airports = munich();
  const runway = airports[0].runways.find((each) => each.names[0] === "08L")!;
  const on = along(runway.from, runway.bearing, 1200);
  assert.equal(runwayAt(airports, on[0], on[1], 85)?.name, "08L");
  assert.equal(runwayAt(airports, on[0], on[1], 260)?.name, "26R");
  const beside = along(on, runway.bearing + 90, 80);
  assert.equal(runwayAt(airports, beside[0], beside[1], 85), null);
  const short = along(runway.from, runway.bearing + 180, 50);
  assert.equal(runwayAt(airports, short[0], short[1], 85), null);
});

test("the tiles round a place are its own and the eight about it, the nearest first", () => {
  const tiles = tilesRound(11.786, 48.354);
  assert.equal(tiles.length, 9);
  assert.deepEqual(tiles[0], [545, 354]);
  assert.equal(new Set(tiles.map(([x, y]) => `${x}/${y}`)).size, 9);
  // Round the earth at the date line, and no further than its top.
  assert.ok(tilesRound(179.99, 0).some(([x]) => x === 0));
  assert.equal(tilesRound(0, 85.05).length, 6);
});

test("the world fetches the tiles about the aircraft once, and forgets those far behind", async () => {
  const asked: string[] = [];
  const world = new AirportWorld(async (zoom: number, x: number, y: number) => {
    asked.push(`${zoom}/${x}/${y}`);
    // The one tile with an airport in it: the middle of the first nine.
    return x === 545 && y === 354 ? MUNICH.slice().buffer : null;
  }, () => 0);
  const settle = async () => { for (let i = 0; i < 40; i += 1) await new Promise((resolve) => setImmediate(resolve)); };
  world.look(11.786, 48.354);
  await settle();
  assert.equal(asked.length, 9);
  assert.equal(asked[0], `${AIRPORT_ZOOM}/545/354`);
  assert.equal(world.version, 1);
  assert.deepEqual(world.airports.map((airport) => airport.iata).filter(Boolean), ["MUC"]);
  world.look(11.786, 48.354);
  await settle();
  assert.equal(asked.length, 9);
  // Far to the east: its airport is dropped with its tile.
  for (const lon of [13.9, 15.9, 17.9]) {
    world.look(lon, 48.354);
    await settle();
  }
  assert.equal(world.airports.length, 0);
});

test("a tile that would not load is asked for again, but not at once", async () => {
  let clock = 0;
  let calls = 0;
  const world = new AirportWorld(async () => {
    calls += 1;
    throw new Error("offline");
  }, () => clock);
  const settle = async () => { for (let i = 0; i < 40; i += 1) await new Promise((resolve) => setImmediate(resolve)); };
  world.look(0, 0);
  await settle();
  assert.equal(calls, 9);
  world.look(0, 0);
  await settle();
  assert.equal(calls, 9);
  clock = 60_000;
  world.look(0, 0);
  await settle();
  assert.equal(calls, 18);
});
