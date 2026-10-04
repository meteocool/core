import assert from "node:assert/strict";
import test from "node:test";
import Feature from "ol/Feature";
import Polygon from "ol/geom/Polygon";
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
