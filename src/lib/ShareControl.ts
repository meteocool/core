import Control from "ol/control/Control";
import type { IControl } from "maplibre-gl";
import { t } from "../locale/t";
import { shareIcon } from "./shareSupport";

/**
 * The platform's share glyph (see `shareIcon`), inline for the same reason as
 * the locate arrow (GeolocateControl.ts): these controls are plain DOM,
 * outside Svelte. Asked per button rather than at import, which is before
 * App.svelte has said which device the page runs on.
 */
function shareGlyph(): string {
  const [width, height, , , path] = shareIcon().icon;
  return `<svg viewBox="0 0 ${width} ${height}" width="17" height="17" aria-hidden="true"
  fill="currentColor"><path d="${path}" /></svg>`;
}

/** The share button itself, for either map's control stack. */
function shareButton(): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  const title = t("share.share");
  button.title = title;
  button.setAttribute("aria-label", title);
  button.innerHTML = shareGlyph();
  // The frame on screen, parked or live, and any tapped point: what a link
  // from here says (lib/urlState.ts). Loaded on the first press: the link
  // building behind it reaches most of the app, which the map's control
  // stack has no business importing.
  button.addEventListener("click", () => {
    import("./share").then(({ share }) => share({ anchor: button }));
  });
  return button;
}

/**
 * "Send this map to someone", as a disc under the locate disc.
 *
 * Always there, whatever the map is doing, rather than only in the player:
 * what is worth sending is as often the live map as a frame. Not made where a
 * share cannot go anywhere (see `canShare`), rather than a button that does
 * nothing.
 */
export default class ShareControl extends Control {
  constructor() {
    const element = document.createElement("div");
    element.className = "ol-unselectable ol-control ol-share";
    element.appendChild(shareButton());
    super({ element });
  }
}

/** The same disc on the 3D map, as a one-button MapLibre group like the locate disc. */
export function maplibreShareControl(): IControl {
  const element = document.createElement("div");
  element.className = "maplibregl-ctrl maplibregl-ctrl-group mc-share";
  element.appendChild(shareButton());
  return {
    onAdd: () => element,
    onRemove: () => element.remove(),
  };
}
