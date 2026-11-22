/**
 * Features a build offers, set per Vite mode: on in .env for every mode,
 * off in .env.production, so next and demo offer them and meteocool.com
 * does not.
 *
 * Each hides only the ways in: the menu entries, buttons and settings that
 * lead to the feature. The code ships in every build, and a link straight to
 * it (meteoair.html, `#meteoair`, a flight's `?fly=`, a Studio scene) still
 * opens it, so a feature can be shown to someone before it is offered to all.
 *
 * - `stormStyles`: choosing how the 3D map draws its storms (StylePicker and
 *   the settings' list). Without it the map draws the default style, whatever
 *   a setting or a link asks.
 * - `studio`: meteocool Studio's button on the 3D map, and the setting that
 *   offers it.
 * - `meteoair`: the flight, from the layer switcher's tile, the 3D map's Fly
 *   button and the point menu's "Fly from here".
 */
const offered = (value: string | undefined) => value === "1";

export const FEATURES = {
  stormStyles: offered(import.meta.env.VITE_FEATURE_STORM_STYLES),
  studio: offered(import.meta.env.VITE_FEATURE_STUDIO),
  meteoair: offered(import.meta.env.VITE_FEATURE_METEOAIR),
} as const;
