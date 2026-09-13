import type { Socket } from "socket.io-client";
import type NanobarWrapper from "../lib/NanobarWrapper";
import type { ServerToClientEvents, ClientToServerEvents } from "../api/events";

/** The live-update channel every capability that refreshes tiles listens on. */
export type RadarSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/**
 * What App.svelte hands each capability. Every field is optional because the
 * five capabilities take different subsets, and LayerManager passes the object
 * through unchanged.
 */
export interface CapabilityOptions {
  nanobar?: NanobarWrapper;
  socket?: RadarSocket;
  socket_io?: RadarSocket;
  cmap?: string;
  hasBaseLayer?: boolean;
}
