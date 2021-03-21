import {
  SlAlert,
  SlButton,
  SlIconButton,
  SlIcon,
  SlSpinner,
  setAssetPath,
  SlProgressRing,
  SlTag,
  SlDropdown,
  SlDialog,
  SlSelect,
  SlMenuItem,
  SlCheckbox,
  SlMenu,
  SlButtonGroup,
  SlTooltip,
  SlMenuLabel,
  SlRange,
  SlSwitch,
} from "@shoelace-style/shoelace";
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
};

export const NOWCAST_TRANSPARENCY = 0.65;

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

  setAssetPath(document.currentScript.src);
  customElements.define("sl-button", SlButton);
  customElements.define("sl-icon", SlIcon);
  customElements.define("sl-icon-button", SlIconButton);
  customElements.define("sl-spinner", SlSpinner);
  customElements.define("sl-alert", SlAlert);
  customElements.define("sl-progress-ring", SlProgressRing);
  customElements.define("sl-tag", SlTag);
  customElements.define("sl-dialog", SlDialog);
  customElements.define("sl-range", SlRange);
  customElements.define("sl-select", SlSelect);
  customElements.define("sl-dropdown", SlDropdown);
  customElements.define("sl-menu-item", SlMenuItem);
  customElements.define("sl-menu-label", SlMenuLabel);
  customElements.define("sl-menu", SlMenu);
  customElements.define("sl-checkbox", SlCheckbox);
  customElements.define("sl-button-group", SlButtonGroup);
  customElements.define("sl-tooltip", SlTooltip);
  customElements.define("sl-switch", SlSwitch);
}

// Dark and Light mode
colorSchemeDark.subscribe((isDark) => {
  if (isDark) Object.keys(darkmodeConstants).forEach((key) => setUIConstant(key, darkmodeConstants));
  else Object.keys(darkmodeConstants).forEach((key) => unsetUIConstant(key));
});
