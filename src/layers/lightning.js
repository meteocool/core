import VectorSource from 'ol/source/Vector';
import { Cluster } from 'ol/source.js';
import VectorLayer from 'ol/layer/Vector';
import Style from 'ol/style/Style';
import Icon from 'ol/style/Icon';
import WebGLPointsLayer from 'ol/layer/WebGLPoints';
import MVT from 'ol/format/MVT';
import VectorTileSource from 'ol/source/VectorTile';
import VectorTileLayer from 'ol/layer/VectorTile';
import { Fill, RegularShape, Stroke } from 'ol/style';
import lightningstrike from '../../public/assets/lightning.png';
import { blitzortungAttribution, imprintAttribution } from './attributions';
import { tileBaseUrl } from '../urls';

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
const lightningColors = [
  '#fed470',
  '#fecf6b',
  '#feca66',
  '#fec45f',
  '#febf5a',
  '#feba55',
  '#feb54f',
  '#feaf4b',
  '#feab49',
  '#fea647',
  '#fea145',
  '#fd9c42',
  '#fd9740',
  '#fd923e',
  '#fd8c3c',
  '#fd8439',
  '#fd7c37',
  '#fd7435',
  '#fc6a32',
  '#fc6330',
  '#fc5b2e',
  '#fc532b',
  '#fa4a29',
  '#f74327',
  '#f43d25',
  '#f13624',
  '#ed2e21',
  '#e92720',
  '#e6211e',
  '#e2191c',
  '#dd161d',
  '#d9131f',
  '#d41020',
  '#ce0c22',
  '#c90823',
  '#c40524',
  '#c00225',
  '#b70026',
  '#b00026',
  '#a80026',
  '#a10026',
  '#970026',
  '#8f0026',
  '#880026',
];
const crossFactory = (ts) => {
  const then = new Date(ts * 1000).getTime();
  const now = Date.now();
  const minutes = Math.floor((now - then) / 1000 / 60);
  const index = Math.min(lightningColors.length - 1, minutes);
  if (index in crossCache) {
    return crossCache[index];
  }
  const cross = new Style({
    image: new RegularShape({
      fill: new Fill({ color: lightningColors[index] }),
      stroke: new Stroke({
        color: lightningColors[index],
        width: 3,
      }),
      points: 4,
      radius: 8,
      radius2: 0,
      angle: 0,
    }),
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
      const size = feature.get('features').length;
      const now = new Date().getTime();
      let age = 0;
      let textsize = 24;
      if (size > 1) {
        feature.get('features')
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
        age = (Math.round((now - feature.get('features')[0].getId()) / STRIKE_MINS / 2.5)) + 1;
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
      maxZoom: 5,
      minZoom: 0,
    }),
    style: (feature) => crossFactory(feature.get('time_wall')),
  });
};

export const lightningLayerDumb = (tileId, map) => new VectorLayer({
  zIndex: 91,
  source: new VectorSource({}),
  style: (feature) => crossFactory(feature.get('time_wall')),
});
