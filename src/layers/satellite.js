import LayerGroup from 'ol/layer/Group';
import TileLayer from 'ol/layer/Tile';
import XYZ from 'ol/source/XYZ';
import { bordersAndWays } from './vector';
import { centralEuropeExtent } from './extents';
import { copernicusAttribution } from './attributions';
import { tileBaseUrl } from './urls';

// eslint-disable-next-line import/prefer-default-export
export const sentinel2 = () => new LayerGroup({
  title: 'Sentinel-2 (19m/5 days)',
  layers: [
    new TileLayer({
      source: new XYZ({
        url: `${tileBaseUrl}/meteosatellite/sentinel2/{z}/{x}/{-y}.png`,
        tileSize: 256,
        minZoom: 1,
        maxZoom: 13,
        attributions: [copernicusAttribution],
      }),
      zIndex: 5,
      extent: centralEuropeExtent,
    }),
    bordersAndWays(),
  ],
});

// new TileLayer({
//    title: "Sentinel-3 (300m/0.5 days)",
//    source: new XYZ({
//        url: 'https://s3-meteocool.diecktator.xyz/satellite/sentinel3/{z}/{x}/{y}.png',
//        tileSize: 256,
//        minZoom: 1,
//        maxZoom: 14,
//        attributions: [copernicusAttribution],
//    }),
//    enabled: false,
// })
