import assert from "node:assert/strict";
import test from "node:test";
import {
  affected, drawn, forecastStoppedShare, headline, inView, noticesFor, noticeText, radarDownInView, shareInView, stalledDomains,
  trusted, TRUST_MS, type Coverage, type DrawnLayers, type Extent4326, type ServiceStatus, type StatusComponent,
} from "../../src/lib/status.ts";
import { STATUS_COVERAGE } from "../../src/layers/statusCoverage.ts";

/**
 * What the backend's status says about the screen: which components are on
 * it, drawn, and late, and which of our notices are for it.
 */

const NOW = 1_794_480_000;

/** Two neighbouring square countries, west and east of 10°E, and a third far off. */
const box = (extent: Extent4326) => ({
  extent,
  covers: (lon: number, lat: number) => lon >= extent[0] && lon <= extent[2] && lat >= extent[1] && lat <= extent[3],
});
const COVERAGE: Coverage = {
  de: box([5, 47, 10, 55]),
  pl: box([10, 47, 20, 55]),
  fi: box([20, 60, 30, 70]),
};
const OVER_DE: Extent4326 = [6, 48, 9, 50];
const OVER_PL: Extent4326 = [15, 50, 18, 52];
const ACROSS: Extent4326 = [8, 48, 12, 50];
const ALL_ON: DrawnLayers = { radar: true, lightning: true, stations: true, storms: true };

const component = (kind: StatusComponent["kind"], state: StatusComponent["state"], domain?: string): StatusComponent => ({
  kind, state, newest: NOW - 600, ...(domain ? { domain } : {}), ...(state === "ok" ? {} : { since: NOW - 300 }),
});
const status = (components: StatusComponent[], notices: ServiceStatus["notices"] = []): ServiceStatus => ({
  server_time: NOW, replay: false, components, notices,
});

test("an answer is trusted for five minutes and not after", () => {
  assert.equal(trusted(1000, 1000 + TRUST_MS - 1), true);
  assert.equal(trusted(1000, 1000 + TRUST_MS), false);
});

test("an answer from the future of this clock is not trusted", () => {
  assert.equal(trusted(5000, 1000), false);
});

test("a component with a domain is in view where that domain's ground is", () => {
  assert.equal(inView(component("radar", "down", "pl"), OVER_PL, COVERAGE), true);
  assert.equal(inView(component("radar", "down", "pl"), OVER_DE, COVERAGE), false);
  assert.equal(inView(component("radar", "down", "pl"), ACROSS, COVERAGE), true);
});

test("a component without a domain is always in view", () => {
  assert.equal(inView(component("lightning", "delayed"), OVER_DE, COVERAGE), true);
  assert.equal(inView(component("stations", "down"), [100, 0, 110, 10], COVERAGE), true);
});

test("a domain the map has no ground for is in no view", () => {
  assert.equal(inView(component("radar", "down", "eu"), OVER_DE, COVERAGE), false);
});

test("a domain in a corner of the view is found and given its share", () => {
  // Poland's ground takes the eastern half of a view from 8°E to 12°E.
  const share = shareInView(COVERAGE.pl!, ACROSS);
  assert.ok(share > 0.45 && share < 0.55, `share ${share}`);
  // A sliver of Finland in the far corner, between the samples a grid over
  // the whole view would take, is still on screen.
  const sliver = shareInView(COVERAGE.fi!, [0, 50, 20.5, 60.5]);
  assert.ok(sliver > 0 && sliver < 0.01, `sliver ${sliver}`);
});

test("the radar and its forecast are drawn with the radar layer", () => {
  const off = { ...ALL_ON, radar: false };
  assert.equal(drawn(component("radar", "down", "de"), ALL_ON), true);
  assert.equal(drawn(component("forecast", "down", "de"), ALL_ON), true);
  assert.equal(drawn(component("radar", "down", "de"), off), false);
  assert.equal(drawn(component("forecast", "down", "de"), off), false);
});

test("lightning, stations and storms are drawn with their own layers", () => {
  const none = { radar: true, lightning: false, stations: false, storms: false };
  for (const kind of ["lightning", "stations", "storms"] as const) {
    assert.equal(drawn(component(kind, "down"), none), false, kind);
    assert.equal(drawn(component(kind, "down"), { ...none, [kind]: true }), true, kind);
  }
});

test("alerts are never drawn: the web sends none", () => {
  assert.equal(drawn(component("alerts", "down", "de"), ALL_ON), false);
});

test("a kind the map does not know is ignored", () => {
  const unknown = { ...component("radar", "down", "de"), kind: "satellite" } as unknown as StatusComponent;
  assert.equal(drawn(unknown, ALL_ON), false);
  assert.deepEqual(affected(status([unknown]), OVER_DE, ALL_ON, COVERAGE), []);
});

test("affected leaves out what is ok, off screen or not drawn", () => {
  const answer = status([
    component("radar", "ok", "de"),
    component("radar", "down", "pl"),
    component("alerts", "down", "de"),
    component("stations", "delayed"),
  ]);
  assert.deepEqual(affected(answer, OVER_DE, { ...ALL_ON, stations: false }, COVERAGE), []);
});

test("affected puts down before delayed, then the larger share of the screen first", () => {
  const answer = status([
    component("lightning", "delayed"),
    component("forecast", "delayed", "pl"),
    component("radar", "down", "pl"),
    component("radar", "down", "de"),
  ]);
  // Over 8°E to 12°E, Germany takes half of it and Poland the other half;
  // a view leaning west gives Germany the larger share.
  const view: Extent4326 = [7, 48, 11, 50];
  const order = affected(answer, view, ALL_ON, COVERAGE).map(({ component: c }) => `${c.kind}:${c.domain ?? ""}`);
  assert.deepEqual(order, ["radar:de", "radar:pl", "lightning:", "forecast:pl"]);
});

test("a forecast with no newest left is affected as down", () => {
  const gone: StatusComponent = { kind: "forecast", domain: "de", state: "down", newest: null };
  assert.deepEqual(affected(status([gone]), OVER_DE, ALL_ON, COVERAGE).map((a) => a.component), [gone]);
});

test("an absent component is unknown, not down", () => {
  // Demo lists no stations: nothing about them is late.
  assert.deepEqual(affected(status([component("radar", "ok", "de")]), OVER_DE, ALL_ON, COVERAGE), []);
  assert.equal(radarDownInView(status([]), OVER_DE, COVERAGE), false);
});

test("the radar is out of date only where a down radar is on screen", () => {
  const answer = status([component("radar", "down", "pl"), component("radar", "ok", "de")]);
  assert.equal(radarDownInView(answer, OVER_PL, COVERAGE), true);
  assert.equal(radarDownInView(answer, OVER_DE, COVERAGE), false);
});

test("a delayed radar is not out of date", () => {
  assert.equal(radarDownInView(status([component("radar", "delayed", "de")]), OVER_DE, COVERAGE), false);
});

test("the stopped networks are the radars not ok, Germany's among them", () => {
  const answer = status([
    component("radar", "down", "de"),
    component("radar", "delayed", "pl"),
    component("radar", "ok", "fr"),
    component("forecast", "down", "fi"),
  ]);
  assert.deepEqual(stalledDomains(answer), ["de", "pl"]);
});

test("the forecast is not arriving where it is late and its radar is not", () => {
  const answer = status([component("forecast", "down", "de"), component("radar", "ok", "de")]);
  assert.equal(forecastStoppedShare(answer, OVER_DE, COVERAGE), 1);
});

test("a late forecast under a late radar is the radar's notice, not the forecast's", () => {
  const answer = status([component("forecast", "down", "pl"), component("radar", "down", "pl")]);
  assert.equal(forecastStoppedShare(answer, OVER_PL, COVERAGE), 0);
});

test("a late forecast off screen is nothing here", () => {
  const answer = status([component("forecast", "down", "fi")]);
  assert.equal(forecastStoppedShare(answer, OVER_DE, COVERAGE), 0);
});

const notice = (id: string, level: "info" | "warning", domains: string[] | null, text: Record<string, string> = { en: id }) => ({
  id, level, domains, starts: NOW - 60, ends: null, text,
});

test("our notices are those for everywhere and those for a domain on screen", () => {
  const answer = status([], [notice("pl", "info", ["pl"]), notice("all", "info", null), notice("fi", "info", ["fi"])]);
  assert.deepEqual(noticesFor(answer, OVER_PL, "en", COVERAGE).map((n) => n.id), ["pl", "all"]);
  assert.deepEqual(noticesFor(answer, OVER_DE, "en", COVERAGE).map((n) => n.id), ["all"]);
});

test("a warning comes before an info, otherwise in the order given", () => {
  const answer = status([], [notice("a", "info", null), notice("b", "warning", null), notice("c", "info", null)]);
  assert.deepEqual(noticesFor(answer, OVER_DE, "en", COVERAGE).map((n) => n.id), ["b", "a", "c"]);
});

test("a notice reads in the reader's language, its base language, else English", () => {
  const text = { en: "Serviced", de: "Gewartet" };
  const n = notice("x", "info", null, text);
  assert.equal(noticeText(n, "de"), "Gewartet");
  assert.equal(noticeText(n, "de-AT"), "Gewartet");
  assert.equal(noticeText(n, "pl"), "Serviced");
  assert.equal(noticeText(n, null), "Serviced");
});

/* The map's own ground, from the vendored coverage. */
const POLAND: Extent4326 = [19, 51.5, 21, 52.5];
const BAVARIA: Extent4326 = [11, 48, 12.5, 48.8];

test("Poland's radar is on screen over Poland and not over Bavaria", () => {
  const pl = component("radar", "down", "pl");
  assert.equal(inView(pl, POLAND, STATUS_COVERAGE), true);
  assert.equal(inView(pl, BAVARIA, STATUS_COVERAGE), false);
});

test("Germany's ground is DWD's reach, less the networks'", () => {
  const de = component("radar", "down", "de");
  assert.equal(inView(de, BAVARIA, STATUS_COVERAGE), true);
  assert.equal(inView(de, POLAND, STATUS_COVERAGE), false);
});

test("a neighbour's radar down at the edge of the screen is no headline", () => {
  // Over 8°E to 10.8°E, Poland's ground is the eastern fifth of it.
  const view: Extent4326 = [6, 48, 10.8, 50];
  const late = affected(status([component("radar", "down", "pl"), component("radar", "ok", "de")]), view, ALL_ON, COVERAGE);
  assert.equal(late.length, 1);
  assert.equal(headline(late), null);
  assert.equal(radarDownInView(status([component("radar", "down", "pl")]), view, COVERAGE), false);
});

test("a radar down under the middle of the screen is the headline", () => {
  const answer = status([component("radar", "down", "pl"), component("radar", "ok", "de")]);
  // Germany's ground is under the middle of a view from 6°E to 12°E, Poland's at its edge.
  assert.equal(headline(affected(answer, [6, 48, 12, 50], ALL_ON, COVERAGE)), null);
  assert.equal(headline(affected(answer, [9, 48, 15, 50], ALL_ON, COVERAGE)), "down");
  assert.equal(radarDownInView(answer, [9, 48, 15, 50], COVERAGE), true);
});

test("the middle of the screen decides, not how much of it a late neighbour takes", () => {
  const answer = status([component("radar", "down", "pl"), component("radar", "ok", "de")]);
  const view: Extent4326 = [9, 48, 20, 50]; // middle at 14.5°E, Poland's from 10°E
  assert.equal(headline(affected(answer, view, ALL_ON, COVERAGE)), "down");
  const wide: Extent4326 = [2, 48, 13, 50]; // middle at 7.5°E, Germany's; Poland's 3° of 11
  assert.equal(headline(affected(answer, wide, ALL_ON, COVERAGE)), null);
});

test("anything late without a domain is a delayed headline", () => {
  assert.equal(headline(affected(status([component("lightning", "delayed")]), OVER_DE, ALL_ON, COVERAGE)), "delayed");
});

test("a notice for a domain at the edge of the screen is not shown there", () => {
  const view: Extent4326 = [6, 48, 10.8, 50];
  const answer = status([], [notice("pl", "warning", ["pl", "fi"])]);
  assert.deepEqual(noticesFor(answer, view, "en", COVERAGE), []);
});

/** The outage of 2026-11-12: EUMETNET's feed stopped, every network and its forecast down, DWD's fine. */
const EUMETNET_DOWN = status([
  component("radar", "ok", "de"), component("forecast", "ok", "de"),
  ...Object.keys(STATUS_COVERAGE).filter((domain) => domain !== "de").flatMap((domain) => [
    component("radar", "down", domain), { kind: "forecast" as const, domain, state: "down" as const, newest: null },
  ]),
]);

test("with every network down and DWD's fine, a German screen to its borders hears nothing unasked", () => {
  for (const view of [
    [5.5, 47.2, 15.2, 55.1], // all of Germany, its neighbours' edges in view
    [12, 51.5, 15.5, 53.5], // Berlin to the Polish border
    [6, 48.5, 8.5, 50], // the Saarland and the Palatinate, France in view
  ] as Extent4326[]) {
    const late = affected(EUMETNET_DOWN, view, ALL_ON, STATUS_COVERAGE);
    assert.equal(headline(late), null, `pill over ${view}`);
    assert.equal(radarDownInView(EUMETNET_DOWN, view, STATUS_COVERAGE), false, `dimming over ${view}`);
    assert.equal(forecastStoppedShare(EUMETNET_DOWN, view, STATUS_COVERAGE), 0, `forecast over ${view}`);
  }
});

test("with every network down, a Polish screen is told", () => {
  assert.equal(headline(affected(EUMETNET_DOWN, POLAND, ALL_ON, STATUS_COVERAGE)), "down");
});
