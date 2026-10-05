import assert from "node:assert/strict";
import test from "node:test";
import Feature from "ol/Feature";
import Polygon from "ol/geom/Polygon";
import LineString from "ol/geom/LineString";
import type Style from "ol/style/Style";
import { cyclosmTheme, darkTheme, lightTheme, osmTheme } from "../../src/layers/base.ts";
import { themeLayers, themeStyleFunction } from "../../src/layers/protomaps.ts";

/**
 * A basemap decodes only the tile layers its theme draws from. Landuse is
 * most of a mid-zoom tile and the default themes draw none of it.
 */

test("light and dark do not decode landuse", () => {
  for (const theme of [lightTheme, darkTheme]) {
    assert.ok(!themeLayers(theme).includes("landuse"));
    assert.ok(themeLayers(theme).includes("landcover"));
  }
});

test("themes with landuse colours still decode it", () => {
  for (const theme of [osmTheme, cyclosmTheme]) assert.ok(themeLayers(theme).includes("landuse"));
});

test("what is left out is what the theme would not have drawn", () => {
  const z10 = 156543.03392804097 / 2 ** 10;
  for (const theme of [lightTheme, darkTheme]) {
    const style = themeStyleFunction(theme);
    for (const kind of Object.keys(osmTheme.landuse)) {
      const feature = new Feature({ geometry: new Polygon([[[0, 0], [1, 0], [1, 1], [0, 0]]]), layer: "landuse", kind });
      assert.equal(style(feature, z10), undefined, `${kind} would have been drawn`);
    }
  }
});

/**
 * A theme that raises its lines splits in two: everything is drawn once,
 * fills under the weather and lines over it, and the water's edge -- which
 * the fills draw on their own underneath -- becomes a line on top.
 */
test("raised lines and fills split light and dark between them", () => {
  for (const theme of [lightTheme, darkTheme]) splitsBetweenThem(theme);
});

function splitsBetweenThem(theme: typeof darkTheme) {
  const z10 = 156543.03392804097 / 2 ** 10;
  const fills = themeStyleFunction(theme, "fills");
  const lines = themeStyleFunction(theme, "lines");
  const square = () => new Polygon([[[0, 0], [1, 0], [1, 1], [0, 0]]]);
  const line = () => new LineString([[0, 0], [1, 1]]);
  const cases: [string, Feature][] = [
    ["earth", new Feature({ geometry: square(), layer: "earth" })],
    ["road", new Feature({ geometry: line(), layer: "roads", kind: "highway" })],
    ["border", new Feature({ geometry: line(), layer: "boundaries", kind: "country" })],
    ["river", new Feature({ geometry: line(), layer: "water", kind: "river" })],
  ];
  for (const [name, feature] of cases) {
    assert.equal(Boolean(fills(feature, z10)) !== Boolean(lines(feature, z10)), true, `${name} drawn by exactly one`);
  }
  assert.equal(lines(cases[0][1], z10), undefined, "the ground stays under the weather");
  assert.ok(lines(cases[1][1], z10), "roads go over it");

  const sea = new Feature({ geometry: square(), layer: "water", kind: "ocean" });
  const filled = fills(sea, z10) as Style;
  const edged = lines(sea, z10) as Style;
  assert.ok(filled.getFill() && !edged.getFill(), "the sea is filled underneath only");
  assert.ok(theme.raised);
  assert.equal(edged.getStroke()?.getColor(), theme.raised.coastline);
}

test("a theme that does not raise its lines draws no coastline", () => {
  const z10 = 156543.03392804097 / 2 ** 10;
  const sea = new Feature({ geometry: new Polygon([[[0, 0], [1, 0], [1, 1], [0, 0]]]), layer: "water" });
  for (const theme of [osmTheme, cyclosmTheme, lightTheme]) {
    assert.equal((themeStyleFunction(theme)(sea, z10) as Style).getStroke(), null);
  }
});
