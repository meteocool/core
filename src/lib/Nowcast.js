// eslint-disable-next-line import/prefer-default-export
import { dwdLayer } from '../layers/radar';
import { cap } from '../NowcastPlayback.svelte';

// eslint-disable-next-line import/prefer-default-export
export class Nowcast {
  constructor(options) {
    this.settings = options.settings;
    this.nanobar = options.nanobar;
    this.setMap(options.map);

    this.downloaded = false;
    this.currentIndex = -1;
    this.numInFlightTiles = 0;

    this.nowcast = [];
    this.forecastLayers = {};
    this.observers = [];

    window.nc = this;
  }

  setMap(map) {
    this.map = map;
  }

  // getMainLayer() {
  //  if (this.map == null) {
  //    return null;
  //  }
  //  const layers = this.map.getLayers().getArray().filter((layer) => layer.get('mainLayer'));
  //  if (layers.length > 0) {
  //    return layers[0];
  //  }
  //  return null;
  // }

  processNowcast(nowcasts, baseTime, processedTime, mainLayer) {
    this.nowcast = nowcasts;
    this.mainLayer = mainLayer;
    this.baseTime = baseTime;
    this.processedTime = processedTime;
  }

  notify(subject, body) {
    console.log(`emitting event regarding ${subject}`);
    this.observers.forEach((h) => {
      h(subject, body);
    });
  }

  downloadNowcast(cb) {
    this.downloaded = false;

    console.log(`${this.nowcast.length} nowcast steps available`);
    if (this.nowcast.length === 0) {
      this.notify('update', {
        layers: {},
        baseTime: this.baseTime,
        processedTime: this.processedTime,
        complete: false,
      });
      return;
    }

    this.nanobar.start('nowcast');
    const self = this;
    this.nowcast.forEach((interval) => {
      const [nowcastLayer, nowcastSource] = dwdLayer(interval.tile_id, { nowcastLayer: true }, 'meteonowcast');
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
            this.map.removeLayer(layer.layer);
            layer.layer.setOpacity(0.85);
          });
          this.nanobar.finish('nowcast');
          self.downloaded = true;
          if (cb) cb();
          nowcastSource.on('tileloadend', null);
          nowcastSource.on('tileloaderror', null);
          self.notify('update', {
            layers: this.forecastLayers,
            baseTime: this.baseTime,
            processedTime: this.processedTime,
            complete: true,
          });
        }
      };
      nowcastSource.on('tileloadend', doneCb);
      nowcastSource.on('tileloaderror', doneCb);
      this.forecastLayers[interval.prediction_time] = {
        layer: nowcastLayer,
        absTime: self.baseTime + interval.prediction_time * 60,
      };
      this.map.addLayer(nowcastLayer);
    });
  }

  addObserver(cb) {
    this.observers.push(cb);
  }

  setForecastLayer(num) {
    if (num === this.currentIndex) { return; }
    if (!this.downloaded) {
      console.log('Forecast not downloaded');
      return;
    }

    let i;
    if (!(num.toString() in this.forecastLayers)) {
      console.log(`Time step ${num} not available`);
      i = -1;
    } else {
      i = num;
    }

    if (this.currentIndex === -1 && i === -1) {
      return;
    }

    if (i === -1) {
      this.map.addLayer(this.mainLayer);
    } else {
      this.map.getLayers().getArray().filter((layer) => layer.get('preloadee')).forEach((layer) => {
        this.map.removeLayer(layer);
        layer.setOpacity(0.85);
        layer.unset('preloadee');
      });
      this.forecastLayers[i].layer.setOpacity(0.85);
      this.map.addLayer(this.forecastLayers[i].layer);
    }

    if (this.currentIndex === -1) {
      this.map.removeLayer(this.mainLayer);
    } else {
      this.map.removeLayer(this.forecastLayers[this.currentIndex].layer);
    }

    this.currentIndex = i;

    // preload next layer
    let nextLayer = i + 5;
    if (nextLayer.toString() in this.forecastLayers) {
      this.forecastLayers[nextLayer].layer.setOpacity(0);
      this.forecastLayers[nextLayer].layer.set('preloadee', true);
      this.map.addLayer(this.forecastLayers[nextLayer].layer);
      console.log(`Preloading ${nextLayer}`);
    } else {
      console.log(`Preloading not available for ${nextLayer}`);
    }

    nextLayer = i + 10;
    if (nextLayer.toString() in this.forecastLayers) {
      this.forecastLayers[nextLayer].layer.setOpacity(0);
      this.forecastLayers[nextLayer].layer.set('preloadee', true);
      this.map.addLayer(this.forecastLayers[nextLayer].layer);
      console.log(`Preloading ${nextLayer}`);
    } else {
      console.log(`Preloading not available for ${nextLayer}`);
    }
  }
}
