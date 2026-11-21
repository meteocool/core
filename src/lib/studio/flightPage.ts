/**
 * The flight's own page: the radar map with nothing over it, that page's
 * words, and the flight a button away (components/meteoair/Landing.svelte).
 *
 * It is meteoair.html, and any page of the web app opened at `#meteoair`.
 * Which of the two the page is has to be settled before the app is made
 * (`studioFlightOnly`), so a hash that comes or goes afterwards loads the
 * page again. This is all the first load carries of it: the words are a
 * chunk of their own.
 */
import { mount } from "svelte";
import type { LayerManager } from "../LayerManager";
import { studioFlightOnly } from "./store";
import { readFlightLink } from "./flightLink";
import { holdSideways } from "../sideways";

export const FLIGHT_PAGE_HASH = "#meteoair";

/** The class on <html> the stylesheet keys on; see global.css. */
export const FLIGHT_PAGE_CLASS = "mc-flight-page";

const TITLE = "meteoair · fly through live clouds";

/**
 * Where the radar map is, from the flight's own page: the same page without
 * `#meteoair` where the hash made it the flight's (the web app's, or the
 * apps' own), and the page beside meteoair.html where that made it.
 */
export function radarMapHref(): string {
  if (isFlightPageHash(window.location.hash)) return `${window.location.pathname}${window.location.search}`;
  return new URL("./", window.location.href).href;
}

/** Whether a location's hash asks for the flight's page, in whatever case it was typed. */
export function isFlightPageHash(hash: string | null | undefined): boolean {
  return (hash ?? "").toLowerCase() === FLIGHT_PAGE_HASH;
}

/** Make this the flight's page. Before the app is made, which is then built without its chrome. */
export function enterFlightPage(): void {
  studioFlightOnly.set(true);
  document.documentElement.classList.add(FLIGHT_PAGE_CLASS);
  document.title = TITLE;
}

/**
 * The page's words, over the map the app has made; or, for a flight's link
 * (`?fly=`, lib/studio/flightLink.ts), that flight, straight away. Read
 * here, on the page's own address: nothing on this page writes to it.
 */
export async function showFlightPage(layerManager: LayerManager): Promise<void> {
  const link = readFlightLink(window.location.search);
  // In the apps the whole page is the flight's, on its side for as long as it is up (lib/sideways.ts).
  holdSideways();
  const { default: Landing } = await import("../../components/meteoair/Landing.svelte");
  mount(Landing, { target: document.body, props: { layerManager, link } });
}

/**
 * Load the page again when its hash starts or stops asking for the flight's
 * page: `asked` is what it said when the page was made.
 */
export function followFlightPageHash(asked: boolean): void {
  window.addEventListener("hashchange", () => {
    if (isFlightPageHash(window.location.hash) !== asked) window.location.reload();
  });
}
