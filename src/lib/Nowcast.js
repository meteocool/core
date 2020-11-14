// eslint-disable-next-line import/prefer-default-export
import { dwdLayer } from '../layers/radar';

// eslint-disable-next-line import/prefer-default-export
export class Nowcast {
  constructor(options) {
    this.settings = options.settings;
    this.nanobar = options.nanobar;
    this.map = options.map;
    this.nowcast = [];
    this.forecastLayers = {};
    this.appHandlers = [];
    window.nc = this;
  }

  setMap(map) {
    this.map = map;
  }

  processNowcast(nowcasts) {
    this.nowcast = nowcasts;
    this.downloadNowcast(nowcasts);
  }

  downloadNowcast(cb) {
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

  hook(handler, action) {
    console.log(`emitting event ${action} to handler: ${handler}`);
    this.appHandlers.forEach((h) => {
      h(handler, action);
    });
  }

  playInProgress() {
    return this.currentForecastNo !== -1 && !this.playPaused;
  }

  smartDownloadAndPlay() {
    if (this.playInProgress()) {
      clearTimeout(this.activeForecastTimeout);
      document.getElementById('nowcastIcon').src = './player-play.png';
      document.getElementById('nowcastIcon').style.display = '';
      this.playPaused = true;
      return;
    }

    if (!this.forecastDownloaded) {
      document.getElementById('nowcastIcon').style.display = 'none';
      document.getElementById('nowcastLoading').style.display = '';
      this.downloadForecast(() => {
        document.getElementById('nowcastLoading').style.display = 'none';
        document.getElementById('nowcastIcon').style.display = '';
        document.getElementById('nowcastIcon').src = './player-pause.png';
        this.playForecast();
      });
    } else {
      document.getElementById('nowcastIcon').style.display = '';
      document.getElementById('nowcastIcon').src = './player-pause.png';
      this.playForecast();
    }
  }

  switchMainLayer(newLayer) {
    // invalidate old forecast
    if (this.playInProgress()) {
      this.removeForecast();
    }
    this.stopPlay();
    // reset internal forecast state
    this.invalidateLayers();

    // first add & fetch the new layer, then remove the old one to avoid
    // having no layer at all at some point.
    this.map.addLayer(newLayer);
    this.map.removeLayer(this.mainLayer);
    this.mainLayer = newLayer;
  }

  // invalidate (i.e. throw away) downloaded forecast stuff AND reset map to a
  // defined state.
  invalidateLayers() {
    this.forecastDownloaded = false;
    // this.forecastLayers.forEach((layer) => {
    //  if (layer) {
    //    this.map.removeLayer(layer["layer"]);
    //    layer = false;
    //  }
    // });
    this.hook('scriptHandler', 'forecastInvalid');
  }

  setForecastLayer(num) {
    if (num === this.currentForecastNo) { return 1; }
    if (!this.forecastDownloaded) { return 2; }
    if (this.playInProgress()) { return 3; }
    // if (num > this.numForecastLayers - 1) { return 4; }

    this.playPaused = true;

    if (num === -1) {
      this.map.addLayer(this.mainLayer);
    } else {
      this.map.addLayer(this.forecastLayers[num].layer);
    }

    if (this.currentForecastNo === -1) {
      this.map.removeLayer(this.mainLayer);
    } else {
      this.map.removeLayer(this.forecastLayers[this.currentForecastNo].layer);
    }

    this.currentForecastNo = num;
    return true;
  }

  // bring map back to a defined state, without touching the forecast stuff
  clear() {
    this.map.getLayers().forEach((layer) => {
      this.map.removeLayer(layer);
    });
  }

  stopPlay() {
    this.currentForecastNo = -1;
    this.playPaused = false;
    const elem = document.getElementById('nowcastIcon');
    if (elem) {
      elem.src = './player-play.png';
      elem.style.display = '';
      $('#forecastTimeWrapper').css('display', 'none');
      this.hook('scriptHandler', 'playFinished');
    }
  }

  playForecast(e) {
    if (!this.forecastDownloaded) {
      console.log('not all forecasts downloaded yet');
      return;
    }
    this.playPaused = false;

    if (this.currentForecastNo === this.forecastLayers.length - 1) {
      // we're past the last downloaded layer, so end the play
      this.map.addLayer(this.mainLayer);
      this.map.removeLayer(this.forecastLayers[this.currentForecastNo].layer);
      this.stopPlay();
      $('#forecastTimeWrapper').css('display', 'none');
      return;
    }

    if (this.currentForecastNo < 0) {
      // play not yet in progress, remove main layer
      this.map.removeLayer(this.mainLayer);
      this.hook('scriptHandler', 'playStarted');
      if (!this.enableIOSHooks) {
        $('#forecastTimeWrapper').css('display', 'block');
      }
    } else {
      // remove previous layer
      this.map.removeLayer(this.forecastLayers[this.currentForecastNo].layer);
    }
    this.currentForecastNo++;
    this.map.addLayer(this.forecastLayers[this.currentForecastNo].layer);

    if (this.currentForecastNo >= 0) {
      const layerTime = (parseInt(this.forecastLayers[this.currentForecastNo].version) + (this.currentForecastNo + 1) * 5 * 60) * 1000;
      const dt = new Date(layerTime);
      const dtStr = `${(`0${dt.getHours()}`).slice(-2)}:${(`0${dt.getMinutes()}`).slice(-2)}`;
      $('.forecastTimeInner').html(dtStr);
      this.hook('layerTimeHandler', layerTime);
    }
    this.activeForecastTimeout = window.setTimeout(() => { this.playForecast(); }, 600);
  }

  removeForecast() {
    if (this.currentForecastNo >= 0) {
      this.map.removeLayer(this.forecastLayers[this.currentForecastNo].layer);
    }
    this.hook('scriptHandler', 'playFinished');
    this.currentForecastNo = -1;
  }

  forecastReady(readyness) {
    if (readyness) {
      document.getElementById('nowcastLoading').style.display = 'none';
      document.getElementById('nowcastIcon').style.display = '';
      document.getElementById('nowcastIcon').src = './player-play.png';
    } else {
      document.getElementById('nowcastLoading').style.display = '';
      document.getElementById('nowcastIcon').style.display = 'none';
    }
  }
}
