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

import { colorSchemeDark } from "../stores";

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

const darkmodeConstants = {
  "sl-color-white": "#3F3F3F",
  "sl-color-black": "#FFFFFF",
  "sl-color-gray-50": "#3F3F3F",
  "sl-color-gray-700": "#FFFFFF",
  "sl-color-gray-300": "#717171",
  "sl-color-gray-200": "#8b8b8b",
  "sl-color-info-100": "#3F3F3F",
  "sl-color-primary-text": "#ffffff",
  "sl-color-gray-600": "#d6d6d6",
  "sl-color-info-700": "#c2c2c2",
  "sl-color-primary-600": "#38BDF8",
  // CSS people be like https://codepen.io/sosuke/pen/Pjoqqp
  "svg-dark-to-light": "invert(99%) sepia(0%) saturate(469%) hue-rotate(31deg) brightness(119%) contrast(100%)",
};

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

export function initUIConstants() {
  Object.keys(uiConstantsDefault).forEach((key) => setUIConstant(key));

  if (window.matchMedia) {
    colorSchemeDark.set(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark )").matches);
  }

  if (window.matchMedia) {
    window.matchMedia("(prefers-color-scheme: dark)")
      .addListener((e) => {
        console.log(`changed to ${e.matches ? "dark" : "light"} mode`);
        colorSchemeDark.set(e.matches);
      });
  }

  // dist/ is the webroot, not a path within it: the assets are copied to
  // dist/shoelace/assets and so are served from /shoelace/assets.
  setBasePath("/shoelace/assets");
}

// Dark and Light mode
colorSchemeDark.subscribe((isDark) => {
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
