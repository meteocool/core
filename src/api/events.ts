/**
 * The Socket.IO events browsers receive on the `/radar` namespace.
 *
 * OpenAPI cannot describe an event stream, so the map from event name to
 * payload is written by hand. The payload types are generated: the backend
 * exports its producers' models into both schemas, so a field that changes on the publishing side shows up here as a type error
 * instead of as silently missing data. This channel has no request/response
 * round trip that would catch it otherwise.
 */
import type { components } from "./generated/api";

type Schemas = components["schemas"];

/** One strike, in EPSG:3857 metres despite the lat/lon field names. */
export type LightningEvent = Schemas["Strike"];
export type MesocycloneEvent = Schemas["Mesocyclone"];
export type PokeEvent = Schemas["Poke"];
export type SnowEvent = Schemas["SnowRefresh"];
/** A new KONRAD3D run landed. The payload carries no cells; it only says to refetch them. */
export type CellsEvent = Schemas["CellsRefresh"];
/**
 * One EUMETNET network's composite was re-rendered, or the merged one (`eu`), the column maximum of every
 * network (`colmax`), one of its column products (`echotop18`, `echotop45`, `echotop50`, `vil`) or DWD's
 * DMAX (`dmax`); refetch only that frame.
 */
export type NetworkEvent = Schemas["NetworkRefresh"];
/** One of the fifteen national networks with a composite of their own, not one of the frames that share their event. */
export type CountryNetwork = Exclude<
  NetworkEvent["network"],
  "eu" | "colmax" | "dmax" | "echotop18" | "echotop45" | "echotop50" | "vil"
>;
/**
 * One network's run of meteocool's own nowcast is complete: a
 * client showing the nowcast refetches the timeseries. Not a `poke`, which
 * reloads DWD's whole timeseries for every client; Germany's run is never
 * announced.
 */
export type NowcastEvent = Schemas["NowcastRefresh"];
/** Storms have changed; refetch `/storms` for the viewport. */
export type StormsEvent = Schemas["StormsRefresh"];
/** One run's volumes, or one part of a run's, are built; refetch `/cells/volumes`. */
export type VolumesEvent = Schemas["VolumesRefresh"];
/** One radar published new sweeps; site mode refetches `/sweeps` for it if it is the open one. */
export type SweepsEvent = Schemas["SweepsRefresh"];

export interface ServerToClientEvents {
  cells: (cells: CellsEvent) => void;
  lightning: (strike: LightningEvent) => void;
  mesocyclones: (detections: MesocycloneEvent[]) => void;
  network: (network: NetworkEvent) => void;
  nowcast: (nowcast: NowcastEvent) => void;
  poke: (poke: PokeEvent) => void;
  snow: (snow: SnowEvent) => void;
  storms: (storms: StormsEvent) => void;
  sweeps: (sweeps: SweepsEvent) => void;
  volumes: (volumes: VolumesEvent) => void;
}

/** The browser never emits: this channel is one-way. */
export type ClientToServerEvents = Record<string, never>;
