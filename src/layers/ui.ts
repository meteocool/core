/* Imported for side effects (registering the pseudo elements) */
 
import SlAlert from "@shoelace-style/shoelace/dist/components/alert/alert.js";
import SlButton from "@shoelace-style/shoelace/dist/components/button/button.js";
import SlButtonGroup from "@shoelace-style/shoelace/dist/components/button-group/button-group.js";
import SlCheckbox from "@shoelace-style/shoelace/dist/components/checkbox/checkbox.js";
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

/**
 * Shoelace dropped these token names between 2.0-beta and 2.0 stable, but
 * meteocool's own CSS is written against them -- and the dark-mode set below
 * defines them, so only *light* mode lost them. Restoring them here as the
 * light-mode defaults keeps every existing `var(--sl-color-white)` working
 * rather than rewriting them across a dozen components.
 */
const shoelaceBetaAliases = {
  "sl-color-white": "var(--sl-color-neutral-0)",
  "sl-color-black": "var(--sl-color-neutral-1000)",
  "sl-color-info-100": "var(--sl-color-sky-100)",
  "sl-color-info-200": "var(--sl-color-sky-200)",
  "sl-color-info-700": "var(--sl-color-sky-700)",
  "sl-color-primary-text": "var(--sl-color-neutral-0)",
  "svg-dark-to-light": "none",
};

export const uiConstantsDefault = {
  "toast-stack-offset": "49px",
  ...shoelaceBetaAliases,
};

/**
 * The legacy --sl-color-* names components still read, tuned so they land on
 * the same dark material as the --mc-* tokens in src/glass.css: sheets equal
 * the dark basemap earth, so the switcher feels like the map went to sleep
 * rather than like a different app. Keys are unchanged so nothing that reads
 * them breaks.
 */
const darkmodeConstants = {
  "sl-color-white": "#1c1f24",
  "sl-color-black": "#f2f2f7",
  "sl-color-gray-50": "#262a30",
  "sl-color-gray-700": "#f2f2f7",
  "sl-color-gray-300": "#4a505a",
  "sl-color-gray-200": "#343941",
  "sl-color-gray-600": "#aeb3bb",
  "sl-color-info-100": "#262a30",
  // Was never remapped, so the legend strip's border stayed sky-blue in dark.
  "sl-color-info-200": "rgba(255, 255, 255, 0.16)",
  // Read by NowcastPlayback through getComputedStyle for Chart.js: must stay a plain colour.
  "sl-color-info-700": "#c2c7cf",
  "sl-color-primary-text": "#ffffff",
  // System blue, the same hue as --mc-accent in dark.
  "sl-color-primary-600": "#0a84ff",
  // CSS people be like https://codepen.io/sosuke/pen/Pjoqqp
  "svg-dark-to-light": "invert(99%) sepia(0%) saturate(469%) hue-rotate(31deg) brightness(119%) contrast(100%)",
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

export const NOWCAST_OPACITY = 0.75;

export function setUIConstant(name: string, suite: Record<string, string> = uiConstantsDefault) {
  document.documentElement.style.setProperty(`--${name}`, suite[name]);
}

export function unsetUIConstant(name: string) {
  document.documentElement.style.removeProperty(`--${name}`);
}

export function resetUIConstantByPrefix(prefix: string) {
  // .map produced booleans, which were then passed as CSS variable names.
  Object.keys(uiConstantsDefault).filter((key) => key.startsWith(prefix)).forEach((key) => setUIConstant(key));
}

/** The dark-mode query and its listener, kept so cleanup can detach them. */
let darkModeQuery: MediaQueryList | null = null;
let darkModeHandler: ((event: MediaQueryListEvent) => void) | null = null;

export function initUIConstants() {
  cleanupUIConstants();
  Object.keys(uiConstantsDefault).forEach((key) => setUIConstant(key));

  if (window.matchMedia) {
    // One query for both the initial read and the subscription. The old code
    // built two -- one of them with a stray space in "(prefers-color-scheme:
    // dark )" -- and subscribed through the deprecated addListener, which
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
  // dist/shoelace/assets and so are served from /shoelace/assets.
  setBasePath("/shoelace/assets");

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
  // Shoelace's own internals -- neutral-0, panel, overlay, danger-* -- follow
  // themes/dark.css, which no --sl-color-gray-* remap could ever reach.
  root.classList.toggle(SHOELACE_DARK_CLASS, isDark);
  Object.keys(darkmodeConstants).forEach((key) => {
    if (isDark) {
      setUIConstant(key, darkmodeConstants);
    } else if (key in uiConstantsDefault) {
      // Leaving dark mode restores the light default rather than unsetting:
      // several of these names are Shoelace beta tokens that no longer exist
      // in 2.x, so unsetting them leaves the variable undefined.
      setUIConstant(key);
    } else {
      unsetUIConstant(key);
    }
  });
});
