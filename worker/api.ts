/**
 * Forwarding the native apps' API calls to this environment's backend.
 *
 * The apps load their map from an app-specific hostname (app.meteocool.com),
 * which is this Worker's custom domain, and send their push registrations to
 * the same hostname. Moving that one custom domain to another environment's
 * Worker therefore moves the map and the registrations together. With two
 * hostnames, one for the map and one for the API, there would be a window in
 * which the map talks to one backend and the registrations go to another, and
 * a registration on the wrong cluster never produces a notification.
 *
 * Kept free of Worker globals beyond fetch/Request, so the tests can run it
 * under Node.
 */

/** The unversioned routes the shipped apps call, served by ng's legacy router. */
const LEGACY_PATHS = new Set(["/post_location", "/clear_notification", "/unregister"]);

/** The versioned routes that replace them. */
const PREFIXES = ["/v3/mobile/", "/v3/telemetry/"];

export function isAppApiPath(pathname: string): boolean {
  return LEGACY_PATHS.has(pathname) || PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

/** The same request, addressed to `apiOrigin`. */
export function appApiRequest(request: Request, apiOrigin: string): Request {
  const incoming = new URL(request.url);
  // Set on the origin rather than resolved against it: a path such as
  // `//other.host/x` would otherwise resolve to another host.
  const target = new URL(apiOrigin);
  target.pathname = incoming.pathname;
  target.search = incoming.search;
  // `redirect: "manual"`: a redirect from the backend goes back to the app as
  // it is, rather than being followed here with the app none the wiser.
  return new Request(target, new Request(request, { redirect: "manual" }));
}
