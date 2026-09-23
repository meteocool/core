/**
 * The Socket.IO events browsers receive on the `/radar` namespace.
 *
 * OpenAPI cannot describe an event stream, so the map from event name to
 * payload is written by hand -- but the payload *types* are not: ng exports the
 * producers' pydantic models into both schemas (see scripts/export_openapi.py),
 * so a field that changes on the publishing side lands here as a type error
 * rather than as silently missing data. There is no request/response round trip
 * on this channel to notice it any other way.
 */
import type { components } from "./generated/api";

type Schemas = components["schemas"];

/** One strike, in EPSG:3857 metres despite the lat/lon field names. */
export type LightningEvent = Schemas["Strike"];
export type MesocycloneEvent = Schemas["Mesocyclone"];
export type PokeEvent = Schemas["Poke"];
export type SnowEvent = Schemas["SnowRefresh"];
/** A new KONRAD3D run landed; the payload is a nudge, not the cells. */
export type CellsEvent = Schemas["CellsRefresh"];
/** One EUMETNET network's composite was re-rendered; refetch only that network's frame. */
export type NetworkEvent = Schemas["NetworkRefresh"];

export interface ServerToClientEvents {
  cells: (cells: CellsEvent) => void;
  lightning: (strike: LightningEvent) => void;
  mesocyclones: (detections: MesocycloneEvent[]) => void;
  network: (network: NetworkEvent) => void;
  poke: (poke: PokeEvent) => void;
  snow: (snow: SnowEvent) => void;
}

/** The browser never emits: this channel is one-way. */
export type ClientToServerEvents = Record<string, never>;
