import assert from "node:assert/strict";
import test from "node:test";
import { fromLonLat } from "ol/proj";
import { drawnByAny, insideRings, networkAt } from "../../src/layers/networkAt.ts";
import { NOWCAST_DOMAINS } from "../../src/lib/nowcast.ts";

/** A table of places: name, lat, lon, the network drawing there (undefined: DWD's, or none), and why. */
type Place = [string, number, number, string | undefined, string?];

/** Which network draws at each place of a table, by name, to compare whole. */
const drawnAt = (places: Place[]) => Object.fromEntries(places.map(([place, lat, lon]) => [place, networkAt(lat, lon)]));
const expected = (places: Place[]) => Object.fromEntries(places.map(([place, , , network]) => [place, network]));

/*
 * The places the backend's own tests pin on the same coverage document.
 * "de" there is undefined here: DWD's ground
 * has no layer of its own to name. Distances are to each network's nearest
 * radar, in km.
 */

/** Inside a network's own borders that network draws, though another's radar may be nearer. */
const INSIDE: Place[] = [
  ["Munich", 48.14, 11.58, undefined],
  ["Bern", 46.95, 7.45, "ch"],
  ["Paris", 48.86, 2.35, "fr"],
  ["Bordeaux", 44.84, -0.58, "fr", "off DWD's grid"],
  ["Lille", 50.63, 3.06, "fr", "Jabbeke 62, Avesnes 77"],
  ["Prague", 50.08, 14.43, "cz"],
  ["Warsaw", 52.23, 21.01, "pl"],
  ["Brussels", 50.85, 4.35, "be"],
  ["Antwerp", 51.22, 4.40, "be", "Helchteren 72, Herwijnen 86"],
  ["Aachen", 50.78, 6.08, undefined, "Helchteren 57, Essen 93; Germany"],
  ["Bratislava", 48.15, 17.11, "sk"],
  ["Košice", 48.72, 21.26, "sk"],
  ["Vilnius", 54.69, 25.28, "lt", "Vilnius 13"],
  ["Kaunas", 54.90, 23.89, "lt", "Vilnius 84"],
  ["Klaipėda", 55.70, 21.14, "lt", "Laukuva 70"],
  ["Šiauliai", 55.93, 23.32, "lt", "Laukuva 77"],
  ["Białystok", 53.13, 23.16, "pl", "Uzranki 141; Vilnius reaches it"],
  ["Suwałki", 54.10, 22.93, "pl", "Uzranki 103; Vilnius reaches it"],
  ["Tallinn", 59.44, 24.75, "ee", "Harku 10, Vihti 125"],
  ["Tartu", 58.38, 26.72, "ee", "Sürgavere 71"],
  ["Pärnu", 58.39, 24.50, "ee", "Sürgavere 60"],
  ["Dublin", 53.35, -6.26, "ie"],
  ["Cork", 51.90, -8.47, "ie"],
  ["Galway", 53.27, -9.05, "ie"],
  ["Limerick", 52.66, -8.63, "ie"],
  ["Waterford", 52.26, -7.11, "ie", "Shannon 132, Dublin 143"],
  ["Zagreb", 45.81, 15.98, "hr", "Bilogora 95"],
  ["Split", 43.51, 16.44, "hr", "Debeljak 104"],
  ["Rijeka", 45.33, 14.44, "hr", "Goli 43"],
  ["Copenhagen", 55.68, 12.57, "dk", "Stevns 40, Ängelholm 79"],
  ["Aarhus", 56.16, 10.21, "dk", "Samsø 45"],
  ["Odense", 55.40, 10.40, "dk", "Samsø 47"],
  ["Aalborg", 57.05, 9.92, "dk", "Sindal 51"],
  ["Esbjerg", 55.48, 8.46, "dk", "Rømø 34"],
  ["Holstebro", 56.36, 8.62, "dk", "Rømø 132"],
  ["Thyborøn", 56.70, 8.21, "dk", "Sindal 146"],
  ["Rønne", 55.10, 14.71, "dk", "Bornholm 12"],
  ["Nykøbing Falster", 54.77, 11.87, "dk", "Stevns 72; DWD's Rostock 67 is nearer"],
  ["Flensburg", 54.78, 9.44, undefined, "Rømø 72 is nearer; Germany"],
  ["Amsterdam", 52.37, 4.90, "nl", "Herwijnen 62, Helchteren 149"],
  ["Rotterdam", 51.92, 4.48, "nl", "Herwijnen 46, Helchteren 114"],
  ["The Hague", 52.08, 4.30, "nl", "Herwijnen 64, Jabbeke 131"],
  ["Utrecht", 52.09, 5.12, "nl", "Herwijnen 28"],
  ["Eindhoven", 51.44, 5.47, "nl", "Helchteren 41 is nearer, Herwijnen 50"],
  ["Maastricht", 50.85, 5.69, "nl", "Helchteren 32 is nearer, Herwijnen 116"],
  ["Groningen", 53.22, 6.57, "nl", "DWD's Borkum 40 is nearer, Den Helder 123"],
  ["Enschede", 52.22, 6.89, "nl", "DWD's Essen 91 is nearer, Herwijnen 128"],
  ["Arnhem", 51.98, 5.91, "nl", "Herwijnen 55, Essen 97"],
  ["Nijmegen", 51.84, 5.86, "nl"],
  ["Zwolle", 52.52, 6.08, "nl"],
  ["Leeuwarden", 53.20, 5.80, "nl"],
  ["Helsinki", 60.17, 24.94, "fi", "Vihti 50, Harku 88"],
  ["Espoo", 60.21, 24.66, "fi"],
  ["Tampere", 61.50, 23.76, "fi"],
  ["Turku", 60.45, 22.27, "fi"],
  ["Oulu", 65.01, 25.47, "fi"],
  ["Jyväskylä", 62.24, 25.75, "fi"],
  ["Rovaniemi", 66.50, 25.73, "fi"],
  ["Mariehamn", 60.10, 19.94, "fi", "on Åland"],
  ["Vaasa", 63.10, 21.62, "fi", "Vimpeli 111, Örnsköldsvik 172"],
  ["Ivalo", 68.66, 27.55, "fi", "Kaunispää 26, norsg 176"],
  ["Utsjoki", 69.91, 27.03, "fi", "Berlevåg 101 is nearer, Kaunispää 165"],
  ["Stockholm", 59.33, 18.07, "se", "Bålsta 42"],
  ["Uppsala", 59.86, 17.64, "se", "Bålsta 28"],
  ["Umeå", 63.83, 20.26, "se", "Örnsköldsvik 94"],
  ["Luleå", 65.58, 22.15, "se", "Luleå 21"],
  ["Kiruna", 67.86, 20.23, "se", "Kiruna 24"],
  ["Visby", 57.64, 18.30, "se", "Åtvidaberg 150"],
  ["Östersund", 63.18, 14.64, "se", "Östersund 14"],
  ["Malmö", 55.60, 13.00, "se", "Stevns 46 is nearer, Ängelholm 86"],
  ["Helsingborg", 56.05, 12.69, "se", "Ängelholm 37, Stevns 82"],
  ["Gothenburg", 57.71, 11.97, "se", "Sindal 112 is nearer, Ängelholm 159"],
  ["Oslo", 59.91, 10.75, "no", "Hurum 33"],
  ["Bergen", 60.39, 5.32, "no", "Bømlo 61"],
  ["Trondheim", 63.43, 10.40, "no", "Rissa 31"],
  ["Stavanger", 58.97, 5.73, "no"],
  ["Tromsø", 69.65, 18.96, "no"],
  ["Bodø", 67.28, 14.40, "no"],
  ["Kristiansand", 58.15, 7.99, "no"],
  ["Narvik", 68.44, 17.43, "no", "Andøya 106, Kiruna 156"],
  ["Kirkenes", 69.73, 30.05, "no", "Berlevåg 95"],
  ["Alta", 69.97, 23.27, "no", "Hasvik 77"],
];

test("inside its own borders a network draws, though another's radar is nearer", () => {
  assert.deepEqual(drawnAt(INSIDE), expected(INSIDE));
});

/** Outside every border the nearest radar that reaches draws, whatever its network, DWD's within its 150 km outline. */
const BEYOND: Place[] = [
  ["Luxembourg", 49.61, 6.13, "be", "Wideumont 56, Neuheilenbach 63"],
  ["Norwich", 52.63, 1.30, "be", "Jabbeke 201, Den Helder 238"],
  ["Vienna", 48.21, 16.37, "sk", "Malý Javorník 58, Skalky 147"],
  ["Győr", 47.69, 17.63, "sk", "Malý Javorník 72"],
  ["Sopron", 47.68, 16.58, "sk", "Malý Javorník 77, Skalky 203"],
  ["Szombathely", 47.23, 16.62, "sk", "Malý Javorník 121, Bilogora 156"],
  ["Miskolc", 48.10, 20.78, "sk", "Kojšovská hoľa 77"],
  ["Uzhhorod", 48.62, 22.30, "sk", "Kojšovská hoľa 98, Rzeszów 167"],
  ["Budapest", 47.50, 19.04, "sk", "Španí laz 84"],
  ["Debrecen", 47.53, 21.63, "sk", "Kojšovská hoľa 147; Romania's Oradea, 54, is dormant"],
  ["Linz", 48.31, 14.29, "cz", "Brdy 154; Isen 163 is past DWD's outline"],
  ["Salzburg", 47.80, 13.04, undefined, "Isen 82"],
  ["Kiel", 54.32, 10.12, undefined, "Boostedt 36, Rømø 139"],
  ["Ljubljana", 46.06, 14.51, "hr", "Goli 119"],
  ["Maribor", 46.55, 15.65, "hr", "Bilogora 141, Malý Javorník 221"],
  ["Klagenfurt", 46.62, 14.31, "hr", "Goli 178"],
  ["Trieste", 45.65, 13.78, "hr", "Goli 75"],
  ["Pécs", 46.07, 18.23, "hr", "Bilogora 82"],
  ["Siófok", 46.90, 18.05, "hr", "Bilogora 131, Malý Javorník 165"],
  ["Sarajevo", 43.86, 18.41, "hr", "Uljenje 131"],
  ["Szeged", 46.25, 20.15, "hr", "Gradište 165, Španí laz 231"],
  ["Subotica", 46.10, 19.67, "hr", "Gradište 129"],
  ["Novi Sad", 45.27, 19.83, "hr", "Gradište 89"],
  ["Belgrade", 44.79, 20.45, "hr", "Gradište 144"],
  ["Timișoara", 45.75, 21.23, "hr", "Gradište 208; Romania is dormant"],
  ["Jelgava", 56.65, 23.72, "lt", "Laukuva 148, Sürgavere 231"],
  ["Liepāja", 56.51, 21.01, "lt", "Laukuva 126"],
  ["Daugavpils", 55.87, 26.54, "lt", "Vilnius 166"],
  ["Valmiera", 57.54, 25.43, "ee", "Sürgavere 105"],
  ["Pskov", 57.82, 28.33, "ee", "Sürgavere 181"],
  ["Kaliningrad", 54.71, 20.51, "pl", "Uzranki 112, Laukuva 149"],
  ["Sovetsk", 55.08, 21.89, "lt", "Laukuva 63, Uzranki 140"],
  ["Grodno", 53.68, 23.83, "lt", "Vilnius 134, Uzranki 161"],
  ["Lida", 53.89, 25.30, "lt", "Vilnius 83"],
  ["Minsk", 53.90, 27.56, "lt", "Vilnius 179"],
  ["Vyborg", 60.71, 28.75, "fi", "Anjalankoski 92, Kesälahti 145"],
  ["St Petersburg", 59.94, 30.31, "fi", "Anjalankoski 206, Kesälahti 221"],
  ["Belfast", 54.60, -5.93, "ie", "Dublin 132"],
  ["Derry", 55.00, -7.32, "ie", "Dublin 188"],
  ["Holyhead", 53.31, -4.63, "ie", "Dublin 108"],
  ["Douglas", 54.15, -4.48, "ie", "Dublin 141"],
  ["Liverpool", 53.41, -2.98, "ie", "Dublin 217"],
  ["Andorra la Vella", 42.51, 1.52, "fr", "Opoul and Toulouse 119"],
  ["Barcelona", 41.39, 2.17, "fr", "Opoul 179; Spain is dormant"],
  ["Bilbao", 43.26, -2.93, "fr", "Momuy 192"],
  ["Zaragoza", 41.65, -0.89, "fr", "Momuy 221"],
];

test("beyond every border the nearest radar that reaches draws, whatever its network", () => {
  assert.deepEqual(drawnAt(BEYOND), expected(BEYOND));
});

/**
 * On a seam two radars are nearly equally far, so their beams equally high,
 * and either answer would be right; pinned so that a move of the seam is
 * noticed. Narva (Anjalankoski 180, Sürgavere 183, on the border river) and
 * Tornio/Haparanda, one town across a border, are left out.
 */
const SEAMS: Place[] = [
  ["Riga", 56.95, 24.11, "lt", "Laukuva 189.0, Sürgavere 190.2"],
  ["Murmansk", 68.97, 33.08, "no", "Berlevåg 233, Kaunispää 236"],
  ["Graz", 47.07, 15.44, "sk", "Malý Javorník 184, Bilogora 189"],
];

test("on a seam between two networks' radars the nearer one draws", () => {
  assert.deepEqual(drawnAt(SEAMS), expected(SEAMS));
});

/** Where no network draws: past every radar, or reached only by a dormant network's (Romania's, Spain's). */
const NONE: Place[] = [
  ["Manchester", 53.48, -2.24, undefined, "Dublin 266"],
  ["Birmingham", 52.49, -1.89, undefined, "Dublin 311, Jabbeke 371"],
  ["Glasgow", 55.86, -4.25, undefined, "Dublin 300"],
  ["Cardiff", 51.48, -3.18, undefined, "Dublin 301, Plabennec 348"],
  ["Bucharest", 44.43, 26.10, undefined],
  ["Cluj-Napoca", 46.77, 23.59, undefined],
  ["Constanța", 44.18, 28.63, undefined],
  ["Chișinău", 47.01, 28.86, undefined],
  ["Ruse", 43.85, 25.97, undefined],
  ["Madrid", 40.42, -3.70, undefined],
  ["Seville", 37.39, -5.98, undefined],
  ["Málaga", 36.72, -4.42, undefined],
  ["Palma", 39.57, 2.65, undefined],
  ["Gibraltar", 36.14, -5.35, undefined],
  ["Tangier", 35.77, -5.80, undefined],
  ["Odesa", 46.48, 30.72, undefined],
];

test("where only a dormant network's radars reach, or none, no network draws", () => {
  assert.deepEqual(drawnAt(NONE), expected(NONE));
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
  assert.equal(drawnByAny(["ch", "fr", "cz", "pl", "be", "sk", "lt", "ee", "hr", "dk", "nl", "fi", "se", "no"], munich), false);
  assert.equal(drawnByAny(["be"], fromLonLat([4.35, 50.85])), true); // Brussels
  assert.equal(drawnByAny(["sk"], fromLonLat([17.11, 48.15])), true); // Bratislava
  assert.equal(drawnByAny(["nl"], fromLonLat([4.90, 52.37])), true); // Amsterdam
  assert.equal(drawnByAny(["be"], fromLonLat([4.90, 52.37])), false);
  assert.equal(drawnByAny(["dk", "se"], fromLonLat([12.57, 55.68])), true); // Copenhagen
  assert.equal(drawnByAny([], paris), false);
});

test("Ireland's nowcast covers Ireland's ground", () => {
  for (const [, lat, lon] of [["Dublin", 53.35, -6.26], ["Cork", 51.90, -8.47], ["Belfast", 54.60, -5.93]] as const) {
    assert.equal(networkAt(lat, lon), "ie");
    assert.equal(drawnByAny(NOWCAST_DOMAINS, fromLonLat([lon, lat])), true);
  }
});
