import assert from "node:assert/strict";
import test from "node:test";
import { previewPath, previewPathFor } from "../../src/lib/sharePreview.ts";
import { TARGETS, targetUrl } from "../../src/lib/shareTargets.ts";

/**
 * The share dialog's two outside ends: the card it shows, which must be the
 * one the Worker names in the link's OpenGraph tags, and the services' own
 * "post this" pages, which must get the link whole.
 */

const LINK = {
  url: "https://meteocool.com/?layer=radar&latLonZ=48.13510,11.58200,9.00&shared=20261006T1234Z",
  title: "Munich & around · meteocool",
};

test("the card is asked for at the link's view, commas as they are", () => {
  assert.equal(previewPathFor(LINK.url),
    "/v3/preview/og.png?aspectRatio=wide&frame=true&latLonZ=48.13510,11.58200,9.00");
});

test("a link without a view gets the default card", () => {
  assert.equal(previewPathFor("https://meteocool.com/?layer=radar"),
    "/v3/preview/og.png?aspectRatio=wide&frame=true&default");
  assert.equal(previewPath(null), "/v3/preview/og.png?aspectRatio=wide&frame=true&default");
});

test("a view that is not one cannot break out of its parameter", () => {
  assert.equal(previewPath("1,2,3&default\"><x"),
    "/v3/preview/og.png?aspectRatio=wide&frame=true&latLonZ=1,2,3%26default%22%3E%3Cx");
});

test("every service gets the whole link back out of its address", () => {
  for (const target of TARGETS) {
    const address = targetUrl(target, LINK);
    const params = new URL(address).searchParams;
    const carried = [...params.values()].join(" ");
    assert.ok(carried.includes(LINK.url), `${target}: ${address}`);
    // The title's own ampersand stays inside its parameter.
    if (target !== "facebook") assert.ok(carried.includes(LINK.title), `${target}: ${address}`);
  }
});

test("messengers get the title and the link as one message", () => {
  assert.equal(new URL(targetUrl("whatsapp", LINK)).searchParams.get("text"), `${LINK.title} ${LINK.url}`);
  assert.equal(new URL(targetUrl("telegram", LINK)).searchParams.get("url"), LINK.url);
  assert.equal(new URL(targetUrl("email", LINK)).searchParams.get("subject"), LINK.title);
});
