import assert from "node:assert/strict";
import test from "node:test";
import { aliasRedirect, canonicalUrl, INDEXED_PATHS, robotsTxt, seoFileResponse } from "../../worker/seo.ts";

/**
 * Production's pages are indexed under one URL each; next's and demo's, and
 * the apps' wrappers, are not, and only production lists a sitemap.
 */

const PRODUCTION = "https://meteocool.com";

test("a page's other names redirect to its one URL, keeping the query", () => {
  const cases: Array<[string, string]> = [
    ["/index.html?latLonZ=48,11,8", "/?latLonZ=48,11,8"],
    ["/meteoair", "/meteoair.html"],
    ["/imprint/", "/imprint.html"],
    ["/privacy", "/privacy.html"],
  ];
  for (const [from, to] of cases) {
    const response = aliasRedirect(new URL(`${PRODUCTION}${from}`));
    assert.ok(response, from);
    assert.equal(response.status, 301);
    assert.equal(response.headers.get("Location"), to);
  }
  for (const path of ["/", "/ios.html", "/android.html", "/meteoair.html", "/v3/preview/og.png"]) {
    assert.equal(aliasRedirect(new URL(`${PRODUCTION}${path}`)), null, path);
  }
});

test("indexed pages name production's URL as canonical; the apps' wrappers name none", () => {
  for (const path of INDEXED_PATHS) assert.equal(canonicalUrl(path, PRODUCTION), `${PRODUCTION}${path}`);
  assert.equal(canonicalUrl("/index.html", PRODUCTION), `${PRODUCTION}/`);
  assert.equal(canonicalUrl("/ios.html", PRODUCTION), null);
  assert.equal(canonicalUrl("/android.html", PRODUCTION), null);
});

test("robots.txt lets every host be crawled, and only production names its sitemap", () => {
  assert.match(robotsTxt(PRODUCTION, PRODUCTION), /^Sitemap: https:\/\/meteocool\.com\/sitemap\.xml$/m);
  assert.doesNotMatch(robotsTxt("https://app.meteocool.com", PRODUCTION), /Sitemap/);
  assert.doesNotMatch(robotsTxt("https://next.meteocool.com", undefined), /Sitemap/);
  for (const robots of [robotsTxt(PRODUCTION, PRODUCTION), robotsTxt("https://demo.meteocool.com", undefined)]) {
    assert.doesNotMatch(robots, /Disallow/);
  }
});

test("the sitemap is production's alone and lists every indexed page", async () => {
  const sitemap = seoFileResponse(new URL(`${PRODUCTION}/sitemap.xml`), PRODUCTION);
  assert.ok(sitemap);
  assert.equal(sitemap.status, 200);
  assert.match(sitemap.headers.get("Content-Type") ?? "", /^application\/xml/);
  const body = await sitemap.text();
  for (const path of INDEXED_PATHS) assert.ok(body.includes(`<loc>${PRODUCTION}${path}</loc>`), path);

  assert.equal(seoFileResponse(new URL("https://next.meteocool.com/sitemap.xml"), undefined)?.status, 404);
  assert.equal(seoFileResponse(new URL("https://app.meteocool.com/sitemap.xml"), PRODUCTION)?.status, 404);
  assert.equal(seoFileResponse(new URL(`${PRODUCTION}/`), PRODUCTION), null);
});
