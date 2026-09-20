import Control from "ol/control/Control";

/**
 * The system's location glyph: an arrow, not a crosshair.
 *
 * A reticle reads as "aim at something"; this button does not aim, it answers
 * "where am I". Every maps app on the platform uses the same north-east arrow
 * for it, so it is the one shape people already know here, and a control that
 * looks like everything else on the map while behaving differently is worse
 * than one that borrows a familiar shape.
 *
 * Outlined rather than filled because this is a one-shot recentre, not a
 * tracking toggle -- filled is what the system uses for "following you".
 *
 * Drawn inline rather than pulled from the icon set: this control builds plain
 * DOM for OpenLayers, outside Svelte, so it has no component to render one in.
 */
/**
 * Nudged down and left, which is what makes it look centred.
 *
 * The path is already centred as a box -- it runs 3 to 21 on both axes inside
 * a 24 viewBox, and the button centres that box exactly. It still read as
 * sitting high and to one side, because a dart is not its bounding box: most
 * of its area is in the head, and the tail that reaches the opposite corner
 * has almost none. Its area centroid is at (13.58, 10.42) rather than at
 * (12, 12), so the eye puts the shape up and to the right of where the box
 * says it is.
 *
 * The translate is exactly that difference, which puts the centroid on the
 * button's centre. Applied to the path rather than to the glyph's coordinates
 * so the shape stays the round numbers it was drawn as, and the correction
 * stays legible as a correction.
 */
const LOCATION_ARROW = `<svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true"
  fill="none" stroke="currentColor" stroke-width="1.8"
  stroke-linejoin="round" stroke-linecap="round">
  <path transform="translate(-1.58 1.58)" d="M21 3 L3 10.1 L11.3 12.7 L13.9 21 Z" />
</svg>`;

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
    button.innerHTML = LOCATION_ARROW;
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
