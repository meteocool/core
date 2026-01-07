import TileLayer from 'ol/layer/Tile'
import { TileWMS } from 'ol/source'
import { createTileLoadFunction } from '../lib/tileFetch'

const tileLoadFunction = createTileLoadFunction()

export const noaaBREF = () =>
  new TileLayer({
    source: new TileWMS({
      url: 'https://opengeo.ncep.noaa.gov/geoserver/conus/conus_bref_qcd/ows?version=1.3.0',
      params: { LAYERS: 'conus_bref_qcd', TILED: true, SRS: 'EPSG:3857' },
      projection: 'EPSG:3857',
      zIndex: 80,
      attributions: ['© NOAA'],
      tileLoadFunction,
    }),
    zIndex: 80,
    opacity: 0.8,
  })
