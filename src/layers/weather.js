import LayerGroup from 'ol/layer/Group';
import TileLayer from 'ol/layer/Tile';
import XYZ from 'ol/source/XYZ';
import { bordersAndWays } from './vector';
import { centralEuropeExtent } from './extents';
import { copernicusAttribution, imprintAttribution } from './attributions';
import { tileBaseUrl } from './urls';

// eslint-disable-next-line import/prefer-default-export
export const weatherLayer = (tileID) => new LayerGroup({
  title: tileID,
  layers: [
    new TileLayer({
      source: new XYZ({
        url: `${tileBaseUrl}/meteomodels/${tileID}/{z}/{x}/{-y}.png`,
        minZoom: 1,
        maxZoom: 14,
        attributions: [imprintAttribution],
      }),
      zIndex: 5,
      extent: centralEuropeExtent,
      preload: Infinity,
      opacity: 0.7,
    }),
  ],
});
