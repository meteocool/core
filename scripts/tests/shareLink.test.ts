import assert from "node:assert/strict";
import test from "node:test";
import { linkSearch, parseLink } from "../../src/lib/deepLink.ts";
import { STALE_AFTER_S, linkAge, shareUrl, staleNotice, staleSince } from "../../src/lib/shareLink.ts";

/**
 * A shared link says when it was shared, so whoever opens it later can be
 * told that the weather in it has moved on. What is held down here: the stamp
 * round-trips, it never outlives the first write of the address bar, and the
 * notice fires for an old link and stays quiet for a fresh or a wrong one.
 */

const CELL = "2026100402050000012345";
// 2026-10-06T12:34:56Z
const NOW = Date.UTC(2026, 9, 6, 12, 34, 56) / 1000;

test("a shared link is the root with the view and the stamp, to the minute", () => {
  const url = shareUrl("https://app.meteocool.com", {
    layer: "radar", view: { lat: 48.1351, lon: 11.582, zoom: 9 },
  }, NOW);
  assert.equal(url, "https://app.meteocool.com/?layer=radar&latLonZ=48.13510,11.58200,9.00&shared=20261006T1234Z");
  assert.equal(parseLink(new URL(url).search).shared, Date.UTC(2026, 9, 6, 12, 34) / 1000);
});

test("a link from an app's page leaves the page for the site's root", () => {
  // The apps load ios.html?version=...; none of that is anyone else's business.
  const url = shareUrl("https://app.meteocool.com/", { layer: "cells3d", cell: CELL }, NOW);
  assert.equal(url, `https://app.meteocool.com/?layer=cells3d&cell=${CELL}&shared=20261006T1234Z`);
});

test("the preview is asked for in German for a German sender, and in English otherwise", () => {
  assert.match(shareUrl("https://next.meteocool.com", { layer: "radar" }, NOW, "de-AT"), /^https:\/\/next\.meteocool\.com\/\?share_lang=de&layer=radar&/);
  assert.doesNotMatch(shareUrl("https://next.meteocool.com", { layer: "radar" }, NOW, "fr"), /share_lang/);
  assert.doesNotMatch(shareUrl("https://next.meteocool.com", { layer: "radar" }, NOW, null), /share_lang/);
});

test("the stamp is dropped by the first state the page writes", () => {
  // urlState writes currentState(), which never carries a stamp: the address
  // bar stops saying "shared an hour ago" as soon as the reader is looking.
  const opened = "?layer=radar&latLonZ=48.13510,11.58200,9.00&shared=20261006T1234Z";
  assert.equal(linkSearch(opened, { layer: "radar", view: { lat: 48.1351, lon: 11.582, zoom: 9 } }),
    "?layer=radar&latLonZ=48.13510,11.58200,9.00");
});

test("a stamp that does not parse is ignored", () => {
  assert.equal(parseLink("?shared=yesterday").shared, undefined);
  assert.equal(parseLink("?shared=20261306T1234Z").shared, undefined);
  assert.equal(parseLink("?shared=1759750000").shared, undefined);
});

test("only a link older than the threshold is called stale", () => {
  const shared = NOW - STALE_AFTER_S;
  assert.equal(staleSince({ shared }, NOW), shared);
  assert.equal(staleSince({ shared: NOW - STALE_AFTER_S + 60 }, NOW), null);
  assert.equal(staleSince({}, NOW), null, "an unstamped link is someone's bookmark, not a share");
});

test("a link from a clock running ahead is not called fresh or stale", () => {
  assert.equal(staleSince({ shared: NOW + 3 * 3600 }, NOW), null);
  // A minute or two ahead is just clocks disagreeing; still not stale.
  assert.equal(staleSince({ shared: NOW + 120 }, NOW), null);
});

test("a storm's link gets the storm's notice, anything else the map's", () => {
  assert.equal(staleNotice({ cell: CELL }), "share.stale_storm");
  assert.equal(staleNotice({ cloud: "meteoradar/volumes/20260924T194500/R39853139.mcvx" }), "share.stale_storm");
  assert.equal(staleNotice({ layer: "radar", point: [48.1, 11.5] }), "share.stale");
});

test("an age is said in minutes, then hours, then days", () => {
  assert.deepEqual(linkAge(20 * 60), [20, "minute"]);
  assert.deepEqual(linkAge(59 * 60 + 20), [59, "minute"]);
  assert.deepEqual(linkAge(95 * 60), [2, "hour"]);
  assert.deepEqual(linkAge(47 * 3600), [47, "hour"]);
  assert.deepEqual(linkAge(3 * 86400 + 3600), [3, "day"]);
  assert.deepEqual(linkAge(-30), [0, "minute"]);
});
