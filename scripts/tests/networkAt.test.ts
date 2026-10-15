import assert from "node:assert/strict";
import test from "node:test";
import { fromLonLat } from "ol/proj";
import { drawnByAny, insideRings, networkAt } from "../../src/layers/networkAt.ts";

test("each network owns its own country", () => {
  assert.equal(networkAt(46.95, 7.45), "ch"); // Bern
  assert.equal(networkAt(48.86, 2.35), "fr"); // Paris
  assert.equal(networkAt(44.84, -0.58), "fr"); // Bordeaux, off DWD's grid
  assert.equal(networkAt(50.08, 14.43), "cz"); // Prague
  assert.equal(networkAt(52.23, 21.01), "pl"); // Warsaw
  assert.equal(networkAt(50.85, 4.35), "be"); // Brussels
  assert.equal(networkAt(48.15, 17.11), "sk"); // Bratislava
  assert.equal(networkAt(48.72, 21.26), "sk"); // Košice
});

/*
 * Outside every border the nearest radar that reaches wins, whatever network
 * it is, DWD's within its 150 km outline. The places ng's handoff for Belgium
 * and Slovakia measured (doc/handoff-core-belgium-slovakia.md there), with
 * the nearest radar of each network that reaches; undefined is DWD's.
 */
const BEYOND_BORDERS: [string, number, number][] = [
  ["Amsterdam", 52.37, 4.90],
  ["Rotterdam", 51.92, 4.48],
  ["The Hague", 52.08, 4.30],
  ["Utrecht", 52.09, 5.12],
  ["Eindhoven", 51.44, 5.47],
  ["Maastricht", 50.85, 5.69],
  ["Luxembourg", 49.61, 6.13],
  ["Enschede", 52.22, 6.89],
  ["Arnhem", 51.98, 5.91],
  ["Nijmegen", 51.84, 5.86],
  ["Zwolle", 52.52, 6.08],
  ["Vienna", 48.21, 16.37],
  ["Győr", 47.69, 17.63],
  ["Sopron", 47.68, 16.58],
  ["Miskolc", 48.10, 20.78],
  ["Uzhhorod", 48.62, 22.30],
  ["Linz", 48.31, 14.29],
  ["Budapest", 47.50, 19.04],
  ["Debrecen", 47.53, 21.63],
];

const drawnAt = () => Object.fromEntries(BEYOND_BORDERS.map(([place, lat, lon]) => [place, networkAt(lat, lon)]));

test("beyond every border the nearest radar that reaches draws, whatever its network", () => {
  assert.deepEqual(drawnAt(), {
    Amsterdam: "be", // Helchteren 149 km, Essen 178: past DWD's outline
    Rotterdam: "be", // Helchteren 114, Essen 181, Avesnes 205
    "The Hague": "be", // RMI 131, Avesnes 220
    Utrecht: "be", // RMI 115, Essen 149
    Eindhoven: "be", // RMI 41, DWD 104
    Maastricht: "be", // RMI 32, DWD 102
    Luxembourg: "be", // Wideumont 56, Neuheilenbach 63
    Enschede: undefined, // Essen 91, RMI 164
    Arnhem: undefined, // Essen 97, Helchteren 107
    Nijmegen: undefined,
    Zwolle: undefined,
    Vienna: "sk", // Malý Javorník 58, Skalky 147
    Győr: "sk", // SHMÚ 72, CHMI 211
    Sopron: "sk", // SHMÚ 77, CHMI 203
    Miskolc: "sk", // SHMÚ 77, Rzeszów 242
    Uzhhorod: "sk", // SHMÚ 98, IMGW 167
    Linz: "cz", // Brdy 154, SHMÚ 213; Isen 163 is past DWD's outline
    Budapest: "sk", // only SHMÚ reaches
    Debrecen: "sk",
  });
});

test("inside a country its own network draws, though another's radar is nearer", () => {
  // Aachen: RMI's Helchteren is 57 km off, DWD's Essen 93; Germany is DWD's.
  assert.equal(networkAt(50.78, 6.08), undefined);
  // Lille: Jabbeke is 62 km off, Avesnes 77; France is Meteo-France's.
  assert.equal(networkAt(50.63, 3.06), "fr");
});

test("a ring wound the other way is a hole, under the nonzero rule", () => {
  const outer = [[0, 0], [10, 0], [10, 10], [0, 10]];
  const hole = [[4, 4], [4, 6], [6, 6], [6, 4]];
  assert.equal(insideRings([outer, hole], [2, 2]), true);
  assert.equal(insideRings([outer, hole], [5, 5]), false);
  assert.equal(insideRings([outer, hole], [12, 5]), false);
});

test("a network's nowcast covers its own ground, and none of another's", () => {
  const paris = fromLonLat([2.35, 48.86]);
  const warsaw = fromLonLat([21.01, 52.23]);
  const munich = fromLonLat([11.58, 48.14]);
  assert.equal(drawnByAny(["fr"], paris), true);
  assert.equal(drawnByAny(["ch", "cz", "pl"], paris), false);
  assert.equal(drawnByAny(["fr", "pl"], warsaw), true);
  assert.equal(drawnByAny(["ch", "fr", "cz", "pl", "be", "sk"], munich), false);
  assert.equal(drawnByAny(["be"], fromLonLat([4.35, 50.85])), true); // Brussels
  assert.equal(drawnByAny(["sk"], fromLonLat([17.11, 48.15])), true); // Bratislava
  assert.equal(drawnByAny([], paris), false);
});
