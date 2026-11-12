/**
 * What the backend says is late, and what of it matters on this screen.
 *
 * The API judges once, against its own clock, whether each thing the map
 * draws is arriving (`GET /v3/status`). The map no longer works that out
 * for itself from frame timestamps where it has that answer: it only asks
 * which of the judged components are on screen, drawn, and not `ok`, and
 * which of the notices written for the readers are about where it is.
 *
 * Pure, with no store and no clock: the coverage is passed in as a box and a
 * predicate per domain (layers/statusCoverage.ts), the layers as flags. The
 * wiring is lib/statusFeed.ts.
 */
import type { components } from "../api/generated/api";

type Schemas = components["schemas"];

export type ServiceStatus = Schemas["ServiceStatus"];
export type StatusComponent = Schemas["StatusComponent"];
export type StatusNotice = Schemas["StatusNotice"];
export type StatusKind = StatusComponent["kind"];
export type StatusState = StatusComponent["state"];

/** A lon/lat box: west, south, east, north. */
export type Extent4326 = [number, number, number, number];

/** Where a domain's radar draws: a box around it, and whether a point inside the box is its ground. */
export interface DomainCoverage {
  extent: Extent4326;
  covers: (lon: number, lat: number) => boolean;
}

/** Each domain's ground, by the component's `domain`. */
export type Coverage = Readonly<Record<string, DomainCoverage | undefined>>;

/** Which of the layers that draw a component are on. */
export interface DrawnLayers {
  radar: boolean;
  lightning: boolean;
  stations: boolean;
  storms: boolean;
}

/** The kinds this map knows; any other is ignored, as the API asks. */
export const KNOWN_KINDS: readonly StatusKind[] = ["radar", "forecast", "alerts", "lightning", "stations", "storms"];

/** How long an answer is used with no newer one; past that the map's own rules come back. */
export const TRUST_MS = 5 * 60_000;

/** Whether an answer received at `receivedAt` is still the one to go by. */
export function trusted(receivedAt: number, now: number): boolean {
  return now >= receivedAt && now - receivedAt < TRUST_MS;
}

const known = (component: StatusComponent): boolean => KNOWN_KINDS.includes(component.kind);

const mercatorY = (lat: number): number => Math.log(Math.tan(Math.PI / 4 + (Math.max(-85, Math.min(85, lat)) * Math.PI) / 360));
const latitude = (y: number): number => (Math.atan(Math.exp(y)) - Math.PI / 4) * (360 / Math.PI);

/**
 * The share of the view that a domain's ground takes, from a grid of
 * `samples` × `samples` points over the part of the view inside the
 * domain's box: even in Web Mercator, as lib/forecastCoverage.ts samples.
 * Sampling only the overlap means a domain in a corner of the view is
 * sampled as finely as one filling it.
 */
export function shareInView(coverage: DomainCoverage, view: Extent4326, samples = 12): number {
  const [vw, vs, ve, vn] = view;
  const [cw, cs, ce, cn] = coverage.extent;
  const west = Math.max(vw, cw);
  const east = Math.min(ve, ce);
  const south = Math.max(vs, cs);
  const north = Math.min(vn, cn);
  if (west >= east || south >= north || ve <= vw || vn <= vs) return 0;
  const bottom = mercatorY(south);
  const top = mercatorY(north);
  const viewHeight = mercatorY(vn) - mercatorY(vs);
  if (viewHeight <= 0) return 0;
  let inside = 0;
  for (let row = 0; row < samples; row++) {
    const lat = latitude(bottom + ((row + 0.5) / samples) * (top - bottom));
    for (let column = 0; column < samples; column++) {
      const lon = west + ((column + 0.5) / samples) * (east - west);
      if (coverage.covers(lon, lat)) inside++;
    }
  }
  const overlap = ((east - west) / (ve - vw)) * ((top - bottom) / viewHeight);
  return overlap * (inside / (samples * samples));
}

/**
 * The middle of the screen, where the reader is looking: even in Web
 * Mercator, as the screen is.
 */
export function viewCentre([west, south, east, north]: Extent4326): [number, number] {
  return [(west + east) / 2, latitude((mercatorY(south) + mercatorY(north)) / 2)];
}

/**
 * Whether a component is about the middle of the screen: its domain's
 * ground is there, or it has no domain. What the map says unasked (the
 * pill, the radar's dimming, a notice of ours for a domain) goes by this,
 * so a neighbour whose radar has stopped says nothing over a German map
 * that is live where the reader is looking, however much of a wide screen
 * the neighbour takes. The sheet behind the pill lists it all the same.
 */
export function atCentre(component: StatusComponent, view: Extent4326, coverage: Coverage): boolean {
  if (component.domain == null) return true;
  return coversCentre(component.domain, view, coverage);
}

const coversCentre = (domain: string, view: Extent4326, coverage: Coverage): boolean => {
  const ground = coverage[domain];
  if (!ground) return false;
  const [lon, lat] = viewCentre(view);
  const [west, south, east, north] = ground.extent;
  return lon >= west && lon <= east && lat >= south && lat <= north && ground.covers(lon, lat);
};

/**
 * The share of the view a component is about: its domain's, or all of it
 * for one with no domain. A domain the map has no ground for (a network it
 * does not draw, the merged `eu`) is on no part of it.
 */
export function viewShare(component: StatusComponent, view: Extent4326, coverage: Coverage): number {
  if (component.domain == null) return 1;
  const ground = coverage[component.domain];
  return ground ? shareInView(ground, view) : 0;
}

/** Whether a component is about anything on screen: its domain's ground is, or it has no domain. */
export function inView(component: StatusComponent, view: Extent4326, coverage: Coverage): boolean {
  return viewShare(component, view, coverage) > 0;
}

/**
 * Whether the map draws a component: the radar and its forecast with the
 * radar layer, the others with their own. Never `alerts`, which the web
 * does not send; nor a kind it does not know.
 */
export function drawn(component: StatusComponent, layers: DrawnLayers): boolean {
  switch (component.kind) {
    case "radar":
    case "forecast":
      return layers.radar;
    case "lightning":
      return layers.lightning;
    case "stations":
      return layers.stations;
    case "storms":
      return layers.storms;
    default:
      return false;
  }
}

const WORSE: Record<StatusState, number> = { down: 2, delayed: 1, ok: 0 };

/** A component that is late here, how much of the screen it is about, and whether it is about its middle. */
export interface Affected {
  component: StatusComponent;
  share: number;
  atCentre: boolean;
}

/**
 * What is late on this screen: the components in view, drawn and not `ok`,
 * `down` before `delayed`, then the one with more of the screen first.
 */
export function affected(status: ServiceStatus, view: Extent4326, layers: DrawnLayers, coverage: Coverage): Affected[] {
  return status.components
    .filter((component) => known(component) && component.state !== "ok" && drawn(component, layers))
    .map((component) => ({
      component, share: viewShare(component, view, coverage), atCentre: atCentre(component, view, coverage),
    }))
    .filter(({ share }) => share > 0)
    .sort((a, b) => (WORSE[b.component.state] - WORSE[a.component.state]) || (b.share - a.share));
}

/**
 * What the pill says of what is late: `down` when a radar that is down is
 * under the middle of the screen, `delayed` when anything else late is
 * (one without a domain always is), else nothing.
 */
export function headline(late: readonly Affected[]): "down" | "delayed" | null {
  const central = late.filter((a) => a.atCentre);
  if (central.some((a) => a.component.kind === "radar" && a.component.state === "down")) return "down";
  return central.length ? "delayed" : null;
}

/**
 * A notice's text in the reader's language: the exact tag, else its
 * language alone (`de` for `de-AT`), else English, which is always there.
 */
export function noticeText(notice: StatusNotice, locale: string | null | undefined): string {
  const tag = (locale ?? "en").toLowerCase();
  return notice.text[tag] ?? notice.text[tag.split("-")[0]] ?? notice.text.en ?? Object.values(notice.text)[0] ?? "";
}

/** A notice of ours, ready to show. */
export interface ShownNotice {
  id: string;
  level: StatusNotice["level"];
  text: string;
}

/**
 * Our notices for this screen: those for everywhere, and those for a
 * domain under its middle; `warning` before `info`, otherwise in the order
 * given.
 */
export function noticesFor(status: ServiceStatus, view: Extent4326, locale: string | null | undefined, coverage: Coverage): ShownNotice[] {
  const here = (notice: StatusNotice) => notice.domains == null
    || notice.domains.some((domain) => coversCentre(domain, view, coverage));
  const rank = (notice: StatusNotice) => (notice.level === "warning" ? 0 : 1);
  return status.notices
    .filter(here)
    .map((notice, index) => ({ notice, index }))
    .sort((a, b) => (rank(a.notice) - rank(b.notice)) || (a.index - b.index))
    .map(({ notice }) => ({ id: notice.id, level: notice.level, text: noticeText(notice, locale) }));
}

/** A domain's `radar` component, if the status lists one. */
const radarOf = (status: ServiceStatus, domain: string | null | undefined): StatusComponent | undefined => (
  status.components.find((component) => component.kind === "radar" && component.domain === domain)
);

/** The domains whose radar the status says is not arriving, `de` among them. */
export function stalledDomains(status: ServiceStatus): string[] {
  return status.components
    .filter((component) => component.kind === "radar" && component.state !== "ok" && component.domain != null)
    .map((component) => component.domain as string);
}

/** Whether a radar that is `down` is under the middle of the screen: the radar shown there is not now any more. */
export function radarDownInView(status: ServiceStatus, view: Extent4326, coverage: Coverage): boolean {
  return status.components.some((component) => component.kind === "radar" && component.state === "down"
    && atCentre(component, view, coverage));
}

/**
 * The share of the screen whose forecast is not arriving while its radar
 * is: a `forecast` that is not `ok`, where the domain's radar is not
 * listed as late (that has a notice of its own, and is the forecast's
 * reason too).
 */
export function forecastStoppedShare(status: ServiceStatus, view: Extent4326, coverage: Coverage): number {
  return status.components
    .filter((component) => component.kind === "forecast" && component.state !== "ok"
      && (radarOf(status, component.domain)?.state ?? "ok") === "ok")
    .reduce((sum, component) => sum + viewShare(component, view, coverage), 0);
}

/** Whether a forecast that is not arriving while its radar is lies under the middle of the screen. */
export function forecastStoppedAtCentre(status: ServiceStatus, view: Extent4326, coverage: Coverage): boolean {
  return status.components.some((component) => component.kind === "forecast" && component.state !== "ok"
    && (radarOf(status, component.domain)?.state ?? "ok") === "ok" && atCentre(component, view, coverage));
}
