import assert from "node:assert/strict";
import test from "node:test";
import { appLinksResponse, appleAppSiteAssociation, assetLinks } from "../../worker/appLinks.ts";

/**
 * A shared link opens in the apps only if these files come back as JSON, from
 * this URL, without a redirect: neither Apple's CDN nor Android's verifier
 * follows one.
 */

for (const path of ["/.well-known/apple-app-site-association", "/.well-known/assetlinks.json"]) {
  test(`${path} is answered as JSON`, async () => {
    const response = appLinksResponse(path);
    assert.ok(response);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Content-Type"), "application/json");
    assert.equal(response.headers.get("Location"), null);
    await response.json();
  });
}

test("the iOS app claims the map's root with a query, and nothing else", () => {
  const [details] = appleAppSiteAssociation.applinks.details;
  assert.deepEqual(details.appIDs, ["4L2672L4VX.org.frcy.app.meteocool"]);
  assert.equal(details.components.length, 1);
  assert.equal(details.components[0]["/"], "/");
  assert.equal(details.components[0]["?"], "?*");
});

test("the Android app is named by its package", () => {
  assert.equal(assetLinks[0].target.package_name, "com.meteocool");
  assert.deepEqual(assetLinks[0].relation, ["delegate_permission/common.handle_all_urls"]);
  for (const fingerprint of assetLinks[0].target.sha256_cert_fingerprints) {
    assert.match(fingerprint, /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
  }
});

test("other paths are left to the rest of the Worker", () => {
  for (const path of ["/", "/.well-known/", "/.well-known/apple-app-site-association.json", "/apple-app-site-association"]) {
    assert.equal(appLinksResponse(path), null, path);
  }
});
