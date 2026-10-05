import assert from "node:assert/strict";
import test from "node:test";
import { appApiRequest, isAppApiPath, isAppDataPath, isVolumePath, volumeRedirect } from "../../worker/api.ts";

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

test("the AR view's data routes are forwarded, and nothing else of the data service", () => {
  for (const path of ["/cells/volumes", "/cells/current", "/cells/tracks", "/cells/tracks/2026100402050000012345",
    "/lightning_cache", "/mesocyclones/all/"]) {
    assert.ok(isAppDataPath(path), path);
  }
  for (const path of ["/cells", "/cells/tracks/abc", "/cells/volumes/x", "/mesocyclones/7", "/ios.html", "/sw.js"]) {
    assert.ok(!isAppDataPath(path), path);
  }
});

test("only storm volumes are redirected to the asset host", () => {
  assert.ok(isVolumePath("/meteoradar/volumes/20261004T020500/de-G1374918628.mcvx"));
  assert.ok(isVolumePath("/meteoradar/volumes/20260922T011500/R12345.mcvx"));
  // Tiles: zoom-10, a zoom-11 core tile and a coarse zoom-9 one.
  assert.ok(isVolumePath("/meteoradar/volumes/20261005T015000/de-T100053300344.mcvx"));
  assert.ok(isVolumePath("/meteoradar/volumes/20261005T015000/fr-T110106600689.mcvx"));
  assert.ok(isVolumePath("/meteoradar/volumes/20261005T015000/de-T090026600172.mcvx"));
  for (const path of ["/meteoradar/abc/1/2/3.png", "/meteoradar/volumes/20261004T020500/../x.mcvx",
    "/meteoradar/volumes/20261004T020500/de-G1374918628.mcvx/x", "/meteonowcast/volumes/20261004T020500/de-G1374918628.mcvx",
    "/meteoradar/volumes/20261005T015000/de-T1000533003.mcvx", "/meteoradar/volumes/20261005T015000/de-T10005330034412.mcvx"]) {
    assert.ok(!isVolumePath(path), path);
  }
  const response = volumeRedirect(
    new Request("https://app.meteocool.com/meteoradar/volumes/20261004T020500/de-G1374918628.mcvx?x=1"),
    "https://assets-staging.meteocool.com",
  );
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("Location"),
    "https://assets-staging.meteocool.com/meteoradar/volumes/20261004T020500/de-G1374918628.mcvx");
});

