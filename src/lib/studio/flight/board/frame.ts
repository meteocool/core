/**
 * A frame of the cockpit's flight, as the board's session reads it
 * (session.ts): from the pilot's telemetry, the little the board is sent or
 * decides by.
 */
import type { Telemetry } from "../pilot";
import type { FlightFrame } from "./session";

export function frameOf(telemetry: Pick<Telemetry, "state" | "score" | "flight" | "flown">): FlightFrame {
  const { state, score } = telemetry;
  const crashed = Boolean(state.crash);
  return {
    flight: telemetry.flight,
    flown: telemetry.flown,
    lon: state.lon,
    lat: state.lat,
    altitude: state.altitude,
    onGround: state.onGround,
    crashed,
    touchdownSink: state.onGround && state.touchdown ? state.touchdown.sink : null,
    // As the cockpit says a landing has stopped: on its wheels, touched down, and still.
    stopped: state.onGround && state.touchdown !== null && state.tas === 0 && !crashed,
    points: score.points,
    feats: score.feats,
  };
}
