import VectorTileLayer from 'ol/layer/VectorTile';
import VectorTileSource from 'ol/source/VectorTile';
import TopoJSON from 'ol/format/TopoJSON';
import {Stroke, Style, Fill, Text} from 'ol/style';
import {centralEuropeExtent} from './extents';
import {
  imprintAttribution,
  osmAttribution,
  wofAttribution
} from './attributions';

const boundaryStyle = new Style({
  stroke: new Stroke({
    color: '#454542',
    width: 2
  }),
  zIndex: 1
});

const getBoundaryStyle = function (feature) {
  const kind = feature.get('kind');
  if (kind !== 'country') {
    return null;
  }
  return boundaryStyle;
};

const countryStyle = new Style({
  text: new Text({
    font: '18px Calibri,sans-serif',
    fill: new Fill({
      color: '#000'
    }),
    overflow: true,
    stroke: new Stroke({
      color: '#fff',
      width: 4
    }),
    zIndex: 100
  })
});

const regionStyle = new Style({
  text: new Text({
    font: '16px Calibri,sans-serif',
    fill: new Fill({
      color: '#000'
    }),
    overflow: true,
    stroke: new Stroke({
      color: '#fff',
      width: 3
    }),
    zIndex: 90
  })
});

const localityStyle = new Style({
  text: new Text({
    font: '12px Calibri,sans-serif',
    fill: new Fill({
      color: '#000'
    }),
    overflow: true,
    stroke: new Stroke({
      color: '#fff',
      width: 2
    }),
    zIndex: 90
  })
});

const microLabelStyle = new Style({
  text: new Text({
    font: '11px Calibri,sans-serif',
    fill: new Fill({
      color: '#000'
    }),
    overflow: true,
    stroke: new Stroke({
      color: '#fff',
      width: 1.5
    }),
    zIndex: 90
  })
});

// eslint-disable-next-line import/prefer-default-export
export const bordersAndWays = () =>
  new VectorTileLayer({
    extent: centralEuropeExtent,
    zIndex: 99,
    declutter: true,
    source: new VectorTileSource({
      attributions: [wofAttribution, osmAttribution, imprintAttribution],
      format: new TopoJSON({
        layerName: 'layer',
        layers: ['boundaries', 'places']
      }),
      maxZoom: 17,
      url:
        'https://tile.nextzen.org/tilezen/vector/v1/all/{z}/{x}/{y}.topojson?api_key=qW-EcxRGQcanc6upJoSHSA'
    }),
    style(feature) {
      let style;
      switch (feature.get('layer')) {
        case 'places':
          switch (feature.get('kind')) {
            case 'country':
              style = countryStyle;
              break;
            case 'region':
              style = regionStyle;
              break;
            case 'locality':
              style = localityStyle;
              break;
            default:
              style = microLabelStyle;
          }
          style.getText().setText(feature.get('name:de'));
          return style;
        case 'boundaries':
          return getBoundaryStyle(feature);
        default:
          return null;
      }
    }
  });
