import Control from "ol/control/Control";

type LocateHandler = () => void;

export interface GeolocateControlOptions {
  onLocate: LocateHandler;
  className?: string;
  title?: string;
}

/**
 * A "locate me" button in the map's own control stack.
 *
 * The app has always been able to centre on the user -- the entrypoints ask for
 * a position once at startup -- but there was no way to ask again after panning
 * away. In the native wrappers this stays unused: they have their own control.
 */
export default class GeolocateControl extends Control {
  private button: HTMLButtonElement;

  private locateHandler: LocateHandler;

  constructor(options: GeolocateControlOptions) {
    const title = options.title ?? "Locate me";
    const element = document.createElement("div");
    element.className = `ol-unselectable ol-control ${options.className ?? "ol-geolocate"}`;

    const button = document.createElement("button");
    button.type = "button";
    button.title = title;
    button.setAttribute("aria-label", title);
    button.textContent = "⌖";
    // A browser with geolocation switched off would otherwise offer a button
    // whose only outcome is a permission error.
    button.disabled = !("geolocation" in navigator);

    element.appendChild(button);
    super({ element });

    this.button = button;
    this.locateHandler = options.onLocate;
    // A <button> already fires click on Enter and Space, so there is no
    // separate key handler here.
    this.button.addEventListener("click", () => this.handleClick());
  }

  private handleClick() {
    if (this.button.disabled) return;
    this.locateHandler();
  }
}
