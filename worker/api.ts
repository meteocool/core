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
 * The same holds for the iOS app's AR storm view, which reads the data
 * service (storms, cells, tracks, lightning) and fetches storm volumes from
 * the asset host: both go through this hostname too, so the AR view moves
 * with the map when the domain does. Data paths are forwarded; a volume is a
 * redirect, so its bytes do not pass through the Worker.
 *
 * And for the iOS app's Live Activity, which reads the API's radar time series
 * and a square preview card of the user's location through this hostname.
 * Those are reads, forwarded for GET alone. The preview is not the cluster's
 * to answer: ng's preview-edge Worker takes `/v3/preview/*` on each API
 * hostname, and a fetch from this Worker to a hostname in its own zone goes
 * straight to the origin, past any Worker routed there. So the preview goes
 * over a service binding instead, addressed to this environment's preview
 * origin, whose hostname is how preview-edge picks the frontend it renders.
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

/** The API's read-only routes the apps call, forwarded for GET only. */
const API_READ_PATHS = new Set(["/v3/radar/timeseries"]);

export function isAppApiRead(method: string, pathname: string): boolean {
  return method === "GET" && API_READ_PATHS.has(pathname);
}

/** A preview card, served by ng's preview-edge Worker. */
export function isPreviewRead(method: string, pathname: string): boolean {
  return method === "GET" && pathname.startsWith("/v3/preview/");
}

/** The data service's routes the AR view reads; see ng's services/data. */
const DATA_PATHS = new Set(["/cells/volumes", "/cells/current", "/cells/tracks", "/lightning_cache", "/mesocyclones/all/"]);

export function isAppDataPath(pathname: string): boolean {
  return DATA_PATHS.has(pathname) || /^\/cells\/tracks\/\d{22}$/.test(pathname);
}

/**
 * A storm's volume file, as the data service names it: bucket first, then
 * the scan and the box: a map tile (`T` + zoom + x + y) since tiles, a
 * storm's peak (`G`) or a cell (`R`) before them, as `lib/deepLink.ts` reads
 * them. Nothing else under the asset host is redirected.
 */
const VOLUME_PATH = /^\/meteoradar\/volumes\/\d{8}T\d{6}\/(?:[a-z]{2}-)?(?:T\d{12}|G\d{10}|R\d{1,12})\.mcvx$/;

export function isVolumePath(pathname: string): boolean {
  return VOLUME_PATH.test(pathname);
}

/** Where a volume path lives on `assetOrigin`. */
export function volumeRedirect(request: Request, assetOrigin: string): Response {
  const target = new URL(assetOrigin);
  target.pathname = new URL(request.url).pathname;
  // Temporary: the domain may move to another environment's Worker, whose
  // asset host is another one. The volumes themselves are immutable.
  return Response.redirect(target.toString(), 302);
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
