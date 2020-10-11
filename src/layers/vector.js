import VectorTileLayer from 'ol/layer/VectorTile';
import VectorTileSource from 'ol/source/VectorTile';
import TopoJSON from 'ol/format/TopoJSON';
import { Stroke, Style } from 'ol/style';
import { centralEuropeExtent } from './extents';
import { osmAttribution, wofAttribution } from './attributions';

const roadStyleCache = {};
const boundaryStyleCache = {};
const roadColor = {
  major_road: '#776',
  minor_road: '#ccb',
  highway: '#ffa333',
};
const boundaryStyle = function (feature) {
  const kind = feature.get('kind');
  if (kind !== 'country') {
    return null;
  }
  let style = boundaryStyleCache[kind];
  if (!style) {
    style = new Style({
      stroke: new Stroke({
        color: '#454542',
        width: 2,
      }),
      zIndex: 1,
    });
    roadStyleCache[kind] = style;
  }
  return style;
};
const roadStyle = function (feature) {
  const kind = feature.get('kind');
  const railway = feature.get('railway');
  const sortKey = feature.get('sort_key');
  const styleKey = `${kind}/${railway}/${sortKey}`;
  let style = roadStyleCache[styleKey];
  if (!style) {
    let color; let
      width;
    if (railway) {
      color = '#7de';
      width = 1;
    } else {
      color = roadColor[kind];
      width = kind === 'highway' ? 1.5 : 1;
    }
    style = new Style({
      stroke: new Stroke({
        color,
        width,
      }),
      zIndex: sortKey,
    });
    roadStyleCache[styleKey] = style;
  }
  return style;
};

// eslint-disable-next-line import/prefer-default-export
export const bordersAndWays = () => new VectorTileLayer({
  extent: centralEuropeExtent,
  zIndex: 99,
  source: new VectorTileSource({
    attributions: [wofAttribution, osmAttribution],
    format: new TopoJSON({
      layerName: 'layer',
      layers: ['roads', 'boundaries'],
    }),
    maxZoom: 18,
    url: 'https://tile.nextzen.org/tilezen/vector/v1/all/{z}/{x}/{y}.topojson?api_key=qW-EcxRGQcanc6upJoSHSA',
  }),
  style(feature/* , resolution */) {
    switch (feature.get('layer')) {
      case 'roads':
        return roadStyle(feature);
      case 'boundaries':
        return boundaryStyle(feature);
      default:
        return null;
    }
  },
});
