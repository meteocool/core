import LayerGroup from 'ol/layer/Group';
import TileLayer from 'ol/layer/Tile';
import XYZ from 'ol/source/XYZ';
import { bordersAndWays } from './vector';
import { centralEuropeExtent } from './extents';
import { copernicusAttribution, imprintAttribution } from './attributions';
import { tileBaseUrl } from './urls';

// eslint-disable-next-line import/prefer-default-export
export const sentinel2 = () => new LayerGroup({
  title: 'Sentinel-2 (19m/5 days)',
  layers: [
    new TileLayer({
      source: new XYZ({
        // url: `${tileBaseUrl}/meteosatellite/sentinel2grid/{z}/{x}/{-y}.png`,
        url: 'https://ot-tiles-dev.s3.eu-central-1.amazonaws.com/s2_msi_worldgrid/{z}/{x}/{-y}.png',
        minZoom: 1,
        maxZoom: 14,
        attributions: [copernicusAttribution, imprintAttribution],
      }),
      zIndex: 5,
      extent: centralEuropeExtent,
      preload: Infinity,
    }),
    bordersAndWays(),
  ],
});
