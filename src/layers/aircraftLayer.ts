/**
 * The aircraft of Studio's flight as a layer of the 3D map: drawn into the
 * same picture as the ground and the storms, so a recording has it.
 *
 * But not in the map's coordinates (aircraftRenderer.ts draws it, straight
 * to the camera): the map's nearest drawable distance is hundreds of metres
 * from a camera this high, and its coordinates are too coarse for a panel a
 * metre from the eye. The aircraft is nearer than anything else on the map,
 * so it is drawn last, over everything, with the depth started afresh.
 */
import type { CustomLayerInterface, Map as GlMap } from "maplibre-gl";
import { loadAircraft, makeAircraftRenderer, OUTSIDE_RANGE } from "./aircraftRenderer";
import type { AircraftRenderer, AircraftScreen, AircraftView } from "./aircraftRenderer";

import { layCoresLate } from "./scenicPass";
import { makeWeatherPass } from "./weatherPass";
import type { WeatherPass, WeatherView } from "./weatherPass";

export type { AircraftScreen, AircraftView } from "./aircraftRenderer";
export type { WeatherView } from "./weatherPass";

export interface AircraftLayer extends CustomLayerInterface {
  setView(view: AircraftView | null): void;
  setScreens(screens: AircraftScreen[]): void;
  /** The weather going past the eye this frame (weatherPass.ts): under the aircraft, and from outside round it too; none for null. */
  setWeather(weather: WeatherView | null): void;
}

export function makeAircraftLayer(id: string, base: string): AircraftLayer {
  let renderer: AircraftRenderer | null = null;
  let view: AircraftView | null = null;
  let screens: AircraftScreen[] = [];
  let weatherPass: WeatherPass | null = null;
  let weather: WeatherView | null = null;

  return {
    id,
    type: "custom",
    renderingMode: "3d",

    setView(next) {
      view = next;
    },

    setScreens(next) {
      screens = next;
    },

    setWeather(next) {
      weather = next;
    },

    onAdd(map: GlMap, gl: WebGLRenderingContext | WebGL2RenderingContext) {
      const mine = makeAircraftRenderer(gl as WebGL2RenderingContext);
      renderer = mine;
      weatherPass = makeWeatherPass(gl as WebGL2RenderingContext);
      void loadAircraft(base).then(({ model, images }) => {
        // Taken off the map meanwhile: a style change, or the flight over.
        if (renderer !== mine) return;
        mine.upload(model, images);
        map.triggerRepaint();
      }, (error: unknown) => {
        console.warn("The aircraft's model did not load", error);
      });
    },

    onRemove() {
      renderer?.dispose();
      renderer = null;
      weatherPass?.dispose();
      weatherPass = null;
    },

    render() {
      // The weather outside first: the aircraft is drawn over it, and from the cockpit hides all of it but what the windows show.
      if (weather) weatherPass?.draw(weather);
      // The core of a storm seen through, over the cloud round the eye that would hide it, and under the aircraft.
      layCoresLate();
      const drew = view && renderer ? renderer.draw(view, screens) : false;
      // From outside, what goes past nearer than the aircraft is over it, and what is beyond it behind it.
      if (weather) weatherPass?.drawNear(weather, OUTSIDE_RANGE, drew);
    },
  };
}
