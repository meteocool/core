/**
 * Everything a flight needs before it can start, loaded once for the page,
 * with how far along it is: the flight's code (Studio's chunk), the
 * aircraft's model and textures, decoded; the flight's theme and its
 * suspenseful piece; and the sounds the flight makes up for itself. The
 * menus' own piece comes before all of it (`loadMenuMusic`): it is what is
 * heard first. The flight's music takes it and a second theme in turn after
 * the theme; the flight fetches whichever of them it has not got once it is
 * ready, one after the other, uncounted: neither is heard before the theme
 * has played.
 * Once it is done the flight starts with all of it there: the aircraft
 * drawn, the deck's buttons and the cockpit's controls answering, the sound
 * and the music playing.
 *
 * It starts when the reader takes off, not before: it is large, and a
 * phone's data may be counted, so neither the meteoair page nor the flight's
 * plan loads it ahead. A flight asked for from the map or by a link starts
 * it as it boards. Until it is done the flight shows how far it is
 * (components/studio/flight/FlightLoading.svelte). Whatever is fetched is
 * kept (assets.ts, and the modules' own), so asking again costs nothing and
 * a second flight never waits.
 *
 * Progress is counted in bytes where they are known: the files' own, and an
 * estimate for the code, whose chunks say nothing of their size. What fails
 * says so; asking again tries again from where it failed. Only the music is
 * let go without: a flight without it is still a flight.
 *
 * Small, and free of the flight's code, which it loads: the meteoair page
 * loads it at once.
 */
import { writable } from "svelte/store";
import { AIRCRAFT_BYTES, AIRCRAFT_FILES, AIRCRAFT_MODEL, fetchAsset, forgetAsset } from "./assets";
import { FLIGHT_ROTATION, pieceLoaded, setSoundtrack, SOUNDTRACK } from "./soundtrack";
import type { PieceName } from "./soundtrack";

/** How the loading stands: not begun, under way, done, or failed; and how much has come, bytes, of how much. */
export interface FlightLoad {
  state: "idle" | "loading" | "ready" | "failed";
  loaded: number;
  total: number;
}

export const flightLoad = writable<FlightLoad>({ state: "idle", loaded: 0, total: 0 });

/** What the flight's code counts as, bytes, against the files: about what its chunks weigh on the wire. */
const CODE_BYTES = 450_000;
/** What the textures count as, bytes, until each has said its size. */
const TEXTURE_BYTES = 1_000_000;
/** The longest the code may take to come, ms, before the loading is said to have failed. */
const CODE_MOST_MS = 60_000;

/** About what a flight fetches, bytes, the menus' music aside: what the meteoair page warns a phone of. */
export const FLIGHT_BYTES = CODE_BYTES + AIRCRAFT_BYTES + TEXTURE_BYTES + SOUNDTRACK.theme.bytes + SOUNDTRACK.tension.bytes;

let loading: Promise<void> | null = null;

/** Fetch a piece of the soundtrack and hand it to the music, once; told of its bytes. A failure is let go: music is not needed to fly. */
function loadPiece(name: PieceName, progress?: (loaded: number, total: number) => void): Promise<boolean> {
  const { url, bytes } = SOUNDTRACK[name];
  if (pieceLoaded(name)) {
    progress?.(bytes, bytes);
    return Promise.resolve(true);
  }
  return fetchAsset(url, bytes, progress).then((buffer) => {
    setSoundtrack(name, buffer);
    // The music keeps its own copy, to play from.
    forgetAsset(url);
    return true;
  }, (error: unknown) => {
    console.warn("The soundtrack did not load", error);
    return false;
  });
}

/** The menus' music: first, before what the flight needs, which it is not part of. */
export function loadMenuMusic(): Promise<boolean> {
  return loadPiece("menu");
}

/** The share of a load that has come, 0 to 1. */
export function shareOf(load: FlightLoad): number {
  return load.state === "ready" ? 1 : load.total > 0 ? Math.min(1, load.loaded / load.total) : 0;
}

/** Load everything a flight needs, or have it already; again after a failure. */
export function preloadFlight(): Promise<void> {
  if (loading) return loading;
  const parts: Record<string, [number, number]> = {
    code: [0, CODE_BYTES], model: [0, AIRCRAFT_BYTES], textures: [0, TEXTURE_BYTES],
    theme: [0, SOUNDTRACK.theme.bytes], tension: [0, SOUNDTRACK.tension.bytes],
  };
  // Once this try has failed, what of it still comes in says nothing more: the failure stands until the next.
  let over = false;
  const report = (state: FlightLoad["state"]) => {
    if (over) return;
    let [loaded, total] = [0, 0];
    for (const [got, of] of Object.values(parts)) {
      loaded += Math.min(got, of);
      total += of;
    }
    flightLoad.set({ state, loaded, total });
  };
  const counted = (part: string) => (got: number, of: number) => {
    parts[part] = [got, Math.max(of, got)];
    report("loading");
  };
  report("loading");

  const within = <T>(promise: Promise<T>, ms: number) => Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("the flight's code did not come")), ms)),
  ]);
  const code = within(import("../../../components/studio/Studio.svelte"), CODE_MOST_MS).then(() => {
    parts.code = [CODE_BYTES, CODE_BYTES];
    report("loading");
  });
  const model = fetchAsset(`${AIRCRAFT_FILES}${AIRCRAFT_MODEL}`, AIRCRAFT_BYTES, counted("model"));
  const aircraft = within(import("./warm"), CODE_MOST_MS).then(({ warmFlight }) => warmFlight((got, of, known) => {
    parts.textures = [got, known ? of : Math.max(of, TEXTURE_BYTES)];
    report("loading");
  }));
  const piece = (name: PieceName) => loadPiece(name, counted(name)).then((loaded) => {
    // A flight without its music is still a flight.
    if (!loaded) parts[name] = [parts[name][1], parts[name][1]];
  });

  const all = Promise.all([code, model, aircraft, piece("theme"), piece("tension")]).then(() => {
    report("ready");
    // The rest of the flight's music, in the order it plays; nothing for what is had already.
    void FLIGHT_ROTATION.reduce((after, name) => after.then(() => loadPiece(name)), Promise.resolve(true));
  }, (error: unknown) => {
    console.warn("The flight did not load", error);
    loading = null;
    report("failed");
    over = true;
    throw error;
  });
  loading = all;
  return all;
}
