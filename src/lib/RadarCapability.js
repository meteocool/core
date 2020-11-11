// eslint-disable-next-line import/prefer-default-export
import { reportError } from './Toast';
import { dwdLayer, greyOverlay } from '../layers/radar';

// eslint-disable-next-line import/prefer-default-export
export class RadarCapability {
  constructor(options) {
    this.map = null;
    this.layer = null;
    this.nanobar = options.nanobar;
    this.url = options.tileURL;

    this.numInFlightTiles = 0;
    this.forecastLayers = [];

    window.radar = this;

    this.nanobar.start(this.url);
    fetch(this.url)
      .then((response) => response.json())
      .then((obj) => {
        this.processRadar(obj);
        this.processNowcast(obj);
      })
      .then(() => this.nanobar.finish(this.url))
      .catch((error) => {
        this.nanobar.finish(this.url);
        reportError(error);
      });
  }

  processRadar(obj) {
    const newLayer = dwdLayer(obj.radar.tile_id)[0];
    if (this.map) {
      if (this.layer) {
        if (this.layer.getId() === newLayer.getId()) {
          return;
        }
        this.map.removeLayer(this.layer);
      }
      this.map.addLayer(newLayer);
    }
    this.layer = newLayer;
  }

  processNowcast(obj) {
    this.nowcast = obj.nowcast;
  }

  downloadForecast(cb) {
    console.log(`${this.nowcast.length} nowcast steps available`);
    if (this.nowcast.length === 0) return;

    this.nanobar.start('nowcast');
    this.nowcast.forEach((interval) => {
      const [nowcastLayer, nowcastSource] = dwdLayer(interval.tile_id, 'meteonowcast');
      nowcastLayer.setOpacity(0);

      nowcastSource.on('tileloadstart', () => {
        this.numInFlightTiles += 1;
        this.nanobar.manualUp();
      });
      const doneCb = () => {
        this.nanobar.manualDown();
        this.numInFlightTiles -= 1;
        if (this.numInFlightTiles === 0) {
          Object.values(this.forecastLayers).forEach((layer) => {
            this.map.removeLayer(layer);
            layer.setOpacity(0.5);
          });
          this.nanobar.finish('nowcast');
          if (cb) cb();
        }
      };
      nowcastSource.on('tileloadend', doneCb);
      nowcastSource.on('tileloaderror', doneCb);
      this.forecastLayers[interval] = { layer: nowcastLayer };
      this.map.addLayer(nowcastLayer);
    });
  }
  // let forecastArrayIdx = 0;

  // this.layersFinishedCounter = 0;
  // for (let ahead = 5; ahead <= 5 * this.numForecastLayers; ahead += 5) {
  //  // capture the idx to make it available inside the callback
  //  const idx = forecastArrayIdx;

  //  /* javascript be like: because who the fuck needs proper printf? */
  //  var numStr;
  //  if (ahead === 5) {
  //    numStr = '05';
  //  } else {
  //    numStr = ahead.toString();
  //  }
  //  const url = `https://a.tileserver.unimplemented.org/data/FX_0${numStr}-latest.json`;

  //  $.getJSON({
  //    dataType: 'json',
  //    url,
  //    success: (data) => {
  //      // create new source + transparent layer, which keep track of
  //      // downloaded/still not downloaded tiles.

  //    },
  //  });
  //  forecastArrayIdx++;
  // }

  setTarget(target) {
    this.map.setTarget(target);
  }

  setMap(map) {
    this.map = map;
    this.map.addLayer(greyOverlay());
    if (this.layer) {
      this.map.addLayer(this.layer);
    }
  }
}
