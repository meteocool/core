/* Imported for side effects (registering the pseudo elements) */
/* eslint-disable no-unused-vars */
import SlAlert from "@shoelace-style/shoelace/dist/components/alert/alert";
import SlButton from "@shoelace-style/shoelace/dist/components/button/button";
import SlButtonGroup from "@shoelace-style/shoelace/dist/components/button-group/button-group";
import SlCheckbox from "@shoelace-style/shoelace/dist/components/checkbox/checkbox";
import SlDialog from "@shoelace-style/shoelace/dist/components/dialog/dialog";
import SlDrodown from "@shoelace-style/shoelace/dist/components/dropdown/dropdown";
import SlIcon from "@shoelace-style/shoelace/dist/components/icon/icon";
import SlIconButton from "@shoelace-style/shoelace/dist/components/icon-button/icon-button";
import SlMenu from "@shoelace-style/shoelace/dist/components/menu/menu";
import SlMenuItem from "@shoelace-style/shoelace/dist/components/menu-item/menu-item";
import SlMenuLabel from "@shoelace-style/shoelace/dist/components/menu-label/menu-label";
import SlProgressRing from "@shoelace-style/shoelace/dist/components/progress-ring/progress-ring";
import SlRange from "@shoelace-style/shoelace/dist/components/range/range";
import SlSelect from "@shoelace-style/shoelace/dist/components/select/select";
import SlSpinner from "@shoelace-style/shoelace/dist/components/spinner/spinner";
import SlSwitch from "@shoelace-style/shoelace/dist/components/switch/switch";
import SlTag from "@shoelace-style/shoelace/dist/components/tag/tag";
import SlTooltip from "@shoelace-style/shoelace/dist/components/tooltip/tooltip";
import SlResizeObserver from "@shoelace-style/shoelace/dist/components/resize-observer/resize-observer";
import { setBasePath } from "@shoelace-style/shoelace/dist/utilities/base-path";

import { colorSchemeDark } from "../stores";

export const uiConstantsDefault = {
  "toast-stack-offset": "49px",
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

export function setUIConstant(name, suite = uiConstantsDefault) {
  document.documentElement.style.setProperty(`--${name}`, suite[name]);
}

export function unsetUIConstant(name) {
  document.documentElement.style.removeProperty(`--${name}`);
}

export function resetUIConstantByPrefix(prefix) {
  Object.keys(uiConstantsDefault).map((key) => key.startsWith(prefix)).forEach((key) => setUIConstant(key));
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

  setBasePath("/dist/shoelace/assets/");
}

// Dark and Light mode
colorSchemeDark.subscribe((isDark) => {
  if (isDark) Object.keys(darkmodeConstants).forEach((key) => setUIConstant(key, darkmodeConstants));
  else Object.keys(darkmodeConstants).forEach((key) => unsetUIConstant(key));
});
