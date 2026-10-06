/**
 * The middle of the map element, as opposed to the View's centre.
 *
 * The flat maps' shared View carries the bottom tray as padding, so its centre
 * is the middle of what the tray leaves visible -- and it moves whenever the
 * tray changes height: OpenLayers keeps what is on screen in place and moves
 * the centre instead. That makes it the wrong thing to write down or to hand
 * across. A page is built with no tray, the tray arrives, and the centre the
 * View then reports is half a tray from the one it was given, so every reload
 * of a URL moved the map by that much. The 3D map, which has no tray, took the
 * View's centre for the middle of its own element and shifted the same way on
 * every switch.
 *
 * The element's middle stays put through all of that, and it is what MapLibre
 * calls its centre, so it is the one both maps and the URL agree on.
 */
import type View from "ol/View";
import type { Coordinate } from "ol/coordinate";

/**
 * What OpenLayers moves the View's centre by when `padding` goes to none, in
 * map units at `resolution` -- the arithmetic of its own padding setter. Added
 * to the View's centre it gives the element's middle; subtracted, back again.
 */
export function paddingOffset(padding: number[] | undefined, resolution: number): Coordinate {
  const [top, right, bottom, left] = padding ?? [0, 0, 0, 0];
  return [(resolution / 2) * (right - left), -(resolution / 2) * (bottom - top)];
}

/** Where the middle of the map element is, or undefined before the View has a centre. */
export function elementCentre(view: View): Coordinate | undefined {
  const centre = view.getCenter();
  if (!centre) return undefined;
  const [dx, dy] = paddingOffset(view.padding, view.getResolution() ?? 0);
  return [centre[0] + dx, centre[1] + dy];
}

/**
 * Put the middle of the map element at `coordinate`.
 *
 * Measured at the current resolution, so a caller changing the zoom as well
 * sets it first.
 */
export function setElementCentre(view: View, coordinate: Coordinate): void {
  const [dx, dy] = paddingOffset(view.padding, view.getResolution() ?? 0);
  view.setCenter([coordinate[0] - dx, coordinate[1] - dy]);
}
