/**
 * The two files that let a shared map link open in the apps when they are
 * installed: Apple's apple-app-site-association for iOS universal links, and
 * Digital Asset Links' assetlinks.json for Android App Links.
 *
 * A shared link (src/lib/shareLink.ts) is always the site's root with the
 * map's state in the query, so only that is claimed. The pages the apps load
 * themselves (ios.html, android.html), the API paths they call and the bare
 * root, which is the website, stay in the browser.
 *
 * Served on every hostname of every environment, but the apps claim only
 * app.meteocool.com (the iOS entitlement, the Android intent filter): a link
 * to next or demo opens in the browser, where it shows the deployment it was
 * made on.
 *
 * Both files must be answered directly, without a redirect, as JSON: Apple's
 * CDN and Android's verifier follow neither a redirect nor an HTML page.
 *
 * Kept free of Worker globals beyond Response, so the tests can run it under
 * Node.
 */

/** Team ID and bundle ID of the iOS app, as its provisioning profile has them. */
const IOS_APP_ID = "4L2672L4VX.org.frcy.app.meteocool";

/** The Android app's package, in both its Play and F-Droid builds. */
const ANDROID_PACKAGE = "com.meteocool";

/**
 * SHA-256 fingerprints of the certificates the Android release builds are
 * signed with, as `AB:CD:...`. Empty for now, so App Links stay unverified and
 * Android asks which app to open a link in. The Play build's is in Play
 * Console under App integrity (the app signing key, not the upload key);
 * F-Droid signs with a key of its own, which needs its own entry.
 */
const ANDROID_CERT_FINGERPRINTS: string[] = [];

export const APPLE_APP_SITE_ASSOCIATION_PATH = "/.well-known/apple-app-site-association";
export const ASSET_LINKS_PATH = "/.well-known/assetlinks.json";

export const appleAppSiteAssociation = {
  applinks: {
    details: [
      {
        appIDs: [IOS_APP_ID],
        components: [
          {
            "/": "/",
            // At least one character: a query is what makes the root a link
            // to somewhere on the map rather than the website.
            "?": "?*",
            comment: "A shared map link: the root, with the map's state in the query",
          },
        ],
      },
    ],
  },
};

export const assetLinks = [
  {
    relation: ["delegate_permission/common.handle_all_urls"],
    target: {
      namespace: "android_app",
      package_name: ANDROID_PACKAGE,
      sha256_cert_fingerprints: ANDROID_CERT_FINGERPRINTS,
    },
  },
];

/** The response for one of the two files, or null for any other path. */
export function appLinksResponse(pathname: string): Response | null {
  const body = pathname === APPLE_APP_SITE_ASSOCIATION_PATH ? appleAppSiteAssociation
    : pathname === ASSET_LINKS_PATH ? assetLinks
    : null;
  if (body === null) return null;
  return new Response(JSON.stringify(body), {
    headers: {
      "Content-Type": "application/json",
      // Apple's CDN fetches it on its own schedule anyway; an hour keeps a
      // change from waiting on a browser's cache as well.
      "Cache-Control": "public, max-age=3600",
    },
  });
}
