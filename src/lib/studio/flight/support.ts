/**
 * What the 3D map needs of the flight's code while one is under way, handed
 * to it when it takes off (`Stage.setFlying`).
 *
 * Handed over rather than imported there: the 3D map is loaded by everyone
 * who opens it, and the flight only with Studio. Whatever the map calls of
 * the flight's it calls through this, so none of it is in the map's own
 * bundle.
 */
import { makeAircraftLayer } from "../../../layers/aircraftLayer";
import { makeScenicPass } from "../../../layers/scenicPass";
import type { FlightSupport } from "../director";
import { airports } from "./airportLayer";
import { cloudscape } from "./cloudscape";
import { AIRCRAFT_FILES } from "./cockpit";
import { destination, distanceM } from "./geo";
import { peaks } from "./peaks";
import { trackSection } from "./routeSection";
import { flightFine, flightWanted, nearEnoughForFine, withinHold } from "./selection";
import { water } from "./water";
import { reflectivityAt } from "./weather";

export const FLIGHT_SUPPORT: FlightSupport = {
  flightWanted, flightFine, nearEnoughForFine, withinHold, reflectivityAt, makeAircraftLayer, aircraftFiles: AIRCRAFT_FILES,
  destination, distanceM, cloudscape, makeScenicPass, trackSection,
  peaks,
  water,
  airports,
};
