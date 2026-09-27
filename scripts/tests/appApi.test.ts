import assert from "node:assert/strict";
import test from "node:test";
import { appApiRequest, isAppApiPath } from "../../worker/api.ts";

/**
 * The Worker behind app.meteocool.com forwards the apps' API calls to its own
 * backend. Forwarding too little loses push registrations; forwarding too much
 * would send the map's own pages and assets to the API.
 */

test("the apps' API routes are forwarded", () => {
  for (const path of ["/post_location", "/clear_notification", "/unregister", "/v3/mobile/location", "/v3/telemetry/pressure"]) {
    assert.ok(isAppApiPath(path), path);
  }
});

test("the map's pages and assets are not", () => {
  for (const path of ["/", "/ios.html", "/assets/index.js", "/v3/radar", "/v3/mobile", "/post_location/x", "/sw.js"]) {
    assert.ok(!isAppApiPath(path), path);
  }
});

test("a forwarded request keeps its method, body, headers and query", async () => {
  const original = new Request("https://app.meteocool.com/post_location?x=1", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: "t" }),
  });
  const forwarded = appApiRequest(original, "https://api-next.meteocool.com");
  assert.equal(forwarded.url, "https://api-next.meteocool.com/post_location?x=1");
  assert.equal(forwarded.method, "POST");
  assert.equal(forwarded.headers.get("Content-Type"), "application/json");
  assert.equal(forwarded.redirect, "manual");
  assert.deepEqual(await forwarded.json(), { token: "t" });
});

test("the path cannot escape the API origin", () => {
  const forwarded = appApiRequest(new Request("https://app.meteocool.com//evil.example/post_location"), "https://api-next.meteocool.com");
  assert.equal(new URL(forwarded.url).host, "api-next.meteocool.com");
});
