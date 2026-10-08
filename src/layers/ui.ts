/* Imported for side effects (registering the pseudo elements) */
 
import SlAlert from "@shoelace-style/shoelace/dist/components/alert/alert.js";
import SlButton from "@shoelace-style/shoelace/dist/components/button/button.js";
import SlButtonGroup from "@shoelace-style/shoelace/dist/components/button-group/button-group.js";
import SlDialog from "@shoelace-style/shoelace/dist/components/dialog/dialog.js";
import SlDrodown from "@shoelace-style/shoelace/dist/components/dropdown/dropdown.js";
import SlIcon from "@shoelace-style/shoelace/dist/components/icon/icon.js";
import SlIconButton from "@shoelace-style/shoelace/dist/components/icon-button/icon-button.js";
import SlMenu from "@shoelace-style/shoelace/dist/components/menu/menu.js";
import SlMenuItem from "@shoelace-style/shoelace/dist/components/menu-item/menu-item.js";
import SlMenuLabel from "@shoelace-style/shoelace/dist/components/menu-label/menu-label.js";
import SlProgressRing from "@shoelace-style/shoelace/dist/components/progress-ring/progress-ring.js";
import SlRange from "@shoelace-style/shoelace/dist/components/range/range.js";
import SlSelect from "@shoelace-style/shoelace/dist/components/select/select.js";
import SlSpinner from "@shoelace-style/shoelace/dist/components/spinner/spinner.js";
import SlSwitch from "@shoelace-style/shoelace/dist/components/switch/switch.js";
import SlTag from "@shoelace-style/shoelace/dist/components/tag/tag.js";
import SlTooltip from "@shoelace-style/shoelace/dist/components/tooltip/tooltip.js";
import SlResizeObserver from "@shoelace-style/shoelace/dist/components/resize-observer/resize-observer.js";
import { setBasePath } from "@shoelace-style/shoelace/dist/utilities/base-path.js";

import { colorSchemeDark, mapBaseLayer } from "../stores";
import { isDarkBasemap } from "./casing";
import { DeviceDetect as dd } from "../lib/DeviceDetect";
import { onMapMotion } from "../lib/mapMotion";

/**
 * Shoelace's gray scale, which themes/dark.css maps its neutral-* tokens onto,
 * tuned so its internals land on the same dark material as the --mc-* tokens
 * in src/glass.css: sheets equal the dark basemap earth, so the switcher feels
 * like the map went to sleep.
 */
const darkmodeConstants = {
  "sl-color-gray-50": "#262a30",
  "sl-color-gray-700": "#f2f2f7",
  "sl-color-gray-300": "#4a505a",
  "sl-color-gray-200": "#343941",
  "sl-color-gray-600": "#aeb3bb",
};

/** Shoelace's dark theme (themes/dark.css) is scoped to this class and inert otherwise. */
const SHOELACE_DARK_CLASS = "sl-theme-dark";

export type GlassMode = "auto" | "off";

/**
 * Turn the blurred glass material off. src/glass.css then falls back to solid
 * fills everywhere at once. Every blurred region over the WebGL map is a
 * per-frame readback, which a weak WebView cannot afford.
 */
export function setGlassMode(mode: GlassMode) {
  document.documentElement.dataset.glass = mode;
}

/** Whether the glass goes solid while the map moves; the `solidGlassWhileMoving` setting. */
let solidWhileMoving = false;

/**
 * Whether to drop the backdrop blur while the flat map moves. Every blurred
 * surface over the map is blurred again on every frame of a pan or zoom, and
 * profiling put that at about two thirds of the GPU's work per frame; with
 * this on, src/glass.css swaps in the solid fallback for as long as
 * `data-map-moving` is set. Off by default, because the panels visibly change
 * every time the map is touched; lib/slowDevice.ts turns it on, once, for a
 * phone that struggles.
 */
export function setSolidGlassWhileMoving(on: boolean) {
  solidWhileMoving = on;
  if (!on) delete document.documentElement.dataset.mapMoving;
}

onMapMotion((moving) => {
  const root = document.documentElement;
  if (moving && solidWhileMoving) root.dataset.mapMoving = "yes";
  else delete root.dataset.mapMoving;
});

export const NOWCAST_OPACITY = 0.75;

export function setUIConstant(name: string, suite: Record<string, string>) {
  document.documentElement.style.setProperty(`--${name}`, suite[name]);
}

export function unsetUIConstant(name: string) {
  document.documentElement.style.removeProperty(`--${name}`);
}

/** The dark-mode query and its listener, kept so cleanup can detach them. */
let darkModeQuery: MediaQueryList | null = null;
let darkModeHandler: ((event: MediaQueryListEvent) => void) | null = null;

export function initUIConstants() {
  cleanupUIConstants();

  if (window.matchMedia) {
    // One query for both the initial read and the subscription. The old code
    // built two (one of them with a stray space in "(prefers-color-scheme:
    // dark )") and subscribed through the deprecated addListener, which
    // nothing ever detached.
    darkModeQuery = window.matchMedia("(prefers-color-scheme: dark)");
    colorSchemeDark.set(darkModeQuery.matches);

    darkModeHandler = (event) => {
      console.log(`changed to ${event.matches ? "dark" : "light"} mode`);
      colorSchemeDark.set(event.matches);
    };
    darkModeQuery.addEventListener("change", darkModeHandler);
  }

  // dist/ is the webroot, not a path within it: the assets are copied to
  // dist/shoelace/assets and so are served from /shoelace/assets. The base is
  // the directory above them, because Shoelace asks for `assets/icons/<name>`
  // under it; set to the assets themselves, every icon 404ed.
  setBasePath("/shoelace");

  // A four-core Android WebView is better served by the opaque fallback than by
  // blurring the map behind every pill.
  if (dd.isAndroid() && (navigator.hardwareConcurrency ?? 8) <= 4) {
    setGlassMode("off");
  }
}

export function cleanupUIConstants() {
  if (darkModeQuery && darkModeHandler) {
    darkModeQuery.removeEventListener("change", darkModeHandler);
  }
  darkModeQuery = null;
  darkModeHandler = null;
}

/**
 * The floating chrome reads against the map, not against the colour scheme:
 * see the header of src/glass.css. Which basemaps count as dark lives in
 * layers/casing.ts, alongside the casings and the place labels that make the
 * same call.
 */
mapBaseLayer.subscribe((layer) => {
  document.documentElement.dataset.chrome = isDarkBasemap(layer) ? "dark" : "light";
});

// Dark and Light mode
colorSchemeDark.subscribe((isDark) => {
  const root = document.documentElement;
  // src/glass.css keys every --mc-* token on this attribute rather than on a
  // media query, so the wrappers' writes to the store flip the whole system.
  root.dataset.theme = isDark ? "dark" : "light";
  // Shoelace's own internals (neutral-0, panel, overlay, danger-*) follow
  // themes/dark.css, which no --sl-color-gray-* remap reaches.
  root.classList.toggle(SHOELACE_DARK_CLASS, isDark);
  Object.keys(darkmodeConstants).forEach((key) => {
    if (isDark) {
      setUIConstant(key, darkmodeConstants);
    } else {
      unsetUIConstant(key);
    }
  });
});
