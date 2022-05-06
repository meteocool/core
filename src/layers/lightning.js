import VectorSource from "ol/source/Vector";
import { Cluster } from "ol/source.js";
import VectorLayer from "ol/layer/Vector";
import Style from "ol/style/Style";
import Icon from "ol/style/Icon";
import MVT from "ol/format/MVT";
import VectorTileSource from "ol/source/VectorTile";
import VectorTileLayer from "ol/layer/VectorTile";
import { Fill, RegularShape, Stroke } from "ol/style";
import lightningstrike from "../../public/assets/lightning.png";
import { blitzortungAttribution, imprintAttribution } from "./attributions";
import { tileBaseUrl } from "../urls";
import { LightningColors } from "../colormaps";

const styleCache = {};
const STRIKE_MINS = 1000 * 60;

const styleFactory = (age, size) => {
  if (age < 5) {
    age = 0;
  }
  if (!(age in styleCache)) {
    styleCache[age] = {};
  }
  if (!styleCache[age][size]) {
    // XXX oh god i'm so sorry
    const opacity = Math.max(Math.min(1 - (age / 30 * 0.8) - 0.2, 1), 0);
    // console.log("new size + age: " + size + ", " + age + ", opacity: " + opacity);

    styleCache[age][size] = new Style({
      image: new Icon({
        src: lightningstrike,
        opacity,
        scale: 0.2 * (size / 40),
      }),
    });
  }
  return styleCache[age][size];
};

const crossCache = {};
const greyCross = new Style({
  image: new RegularShape({
    fill: new Fill({ color: "#aaaaaa" }),
    stroke: new Stroke({
      color: "#aaaaaa",
      width: 3,
    }),
    points: 4,
    radius: 8,
    radius2: 0,
    angle: 0,
  }),
  zIndex: 0,
});

const crossFactory = (ts, zIndexOffset = 0) => {
  const then = ts;
  const now = +new Date();
  const minutes = (now - then) / 1000 / 60;
  const index = Math.round(Math.min(LightningColors.length - 1, Math.max(0, minutes)));
  if (minutes > 120) {
    return greyCross;
  }
  if (index in crossCache) {
    return crossCache[index];
  }
  const cross = new Style({
    image: new RegularShape({
      fill: new Fill({ color: LightningColors[Math.min(index - Math.max(-20 * index, -30), LightningColors.length - 1)] }),
      stroke: new Stroke({
        color: LightningColors[Math.min(index - Math.max(-20 * index, -30), LightningColors.length - 1)],
        width: 3,
      }),
      points: 4,
      radius: 8,
      radius2: 0,
      angle: 0,
    }),
    zIndex: (120 - index) + zIndexOffset,
  });
  crossCache[index] = cross;
  return cross;
};

export default function makeLightningLayer() {
  const ss = new VectorSource({
    features: [],
  });
  const clusters = new Cluster({
    distance: 8,
    source: ss,
    attributions: [blitzortungAttribution, imprintAttribution],
  });
  return [ss, new VectorLayer({
    source: clusters,
    zIndex: 100,
    style: (feature) => {
      const size = feature.get("features").length;
      const now = new Date().getTime();
      let age = 0;
      let textsize = 24;
      if (size > 1) {
        feature.get("features")
          .forEach((f) => {
            age += (now - f.getId()) / STRIKE_MINS;
          });
        // age max = 60, divide by 3 to reduce to 20 age levels max        age = Math.min(Math.round(age / size / 2.5) + 1, 20);
        if (size > 13) {
          textsize = 40;
        } else if (size > 9) {
          textsize = 34;
        } else if (size > 3) {
          textsize = 29;
        }
      } else {
        age = (Math.round((now - feature.get("features")[0].getId()) / STRIKE_MINS / 2.5)) + 1;
      }
      return styleFactory(age, textsize);
    },
  })];
}

export const lightningLayerGL = (tileId, map) => {
  const URL = `${tileBaseUrl}/meteoradar/${tileId}/{z}/{x}/{y}.pbf`;
  return new VectorTileLayer({
    zIndex: 90,
    source: new VectorTileSource({
      format: new MVT(),
      attributions: [blitzortungAttribution],
      url: URL,
      maxZoom: 9,
      minZoom: 0,
    }),
    style: (feature) => crossFactory(feature.get("time_wall") * 1000),
  });
};

export const lightningLayerDumb = (tileId, map) => new VectorLayer({
  zIndex: 91,
  source: new VectorSource({}),
  style: (feature) => crossFactory(feature.get("time_wall"), 1000),
});
