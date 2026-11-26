/**
 * The Worker in front of the static build.
 *
 * Its one job is OpenGraph: a shared meteocool link should preview as the map
 * at the shared location, in the sharer's language, and those tags have to be
 * in the HTML when a crawler fetches it, since no scraper runs the app to find
 * out where it was pointed. So the tags are injected per request from `latLonZ` and
 * `share_lang` rather than baked into index.html.
 *
 * Replaces functions/_middleware.js, which did the same thing as a Cloudflare
 * Pages Function. Two things changed in the move: the meta-tag HTML is built as
 * a local instead of held in module scope (the Pages version wrote to a
 * module-level `ogtag` on every request, so two overlapping requests could swap
 * each other's language), and the rewriter only runs when the response is HTML.
 *
 * It also forwards the native apps' API calls to this environment's backend
 * (api.ts), answers the files that open shared links in the apps
 * (appLinks.ts), the byte ranges a streamed soundtrack asks for
 * (ranges.ts), and what search engines are told about each page (seo.ts).
 */

import {
  appApiRequest,
  isAppApiPath,
  isAppApiRead,
  isAppDataPath,
  isPreviewRead,
  isVolumePath,
  volumeRedirect,
} from "./api";
import { appLinksResponse } from "./appLinks";
import { isStreamedPath, withByteRange } from "./ranges";
import { alternateLocales, previewCopy } from "./previewCopy";
import { aliasRedirect, canonicalUrl, seoFileResponse } from "./seo";
import { PREVIEW_HEIGHT, PREVIEW_WIDTH, previewPathOf } from "../src/lib/sharePreview";

interface Env {
  ASSETS: Fetcher;
  /**
   * Origin serving `/v3/preview/og.png`, set per environment in
   * wrangler.jsonc. The Worker is bundled by wrangler rather than Vite, so
   * `--mode` does not reach it and a hardcoded default would have next and
   * demo advertising another environment's preview image in their OpenGraph
   * tags. Falls back to production so a deploy that forgets the var behaves as
   * it always did.
   */
  PREVIEW_ORIGIN?: string;
  /**
   * The preview Worker, which the apps' preview requests are handed to,
   * addressed to PREVIEW_ORIGIN (api.ts). Unbound, those paths 404.
   */
  PREVIEW?: Fetcher;
  /**
   * Origin of the API this environment's build talks to, set per environment
   * in wrangler.jsonc. The apps' API calls are forwarded there (api.ts).
   * Unset, nothing is forwarded and those paths 404, so a missing var shows up
   * as failed registrations rather than registrations on the wrong backend.
   */
  API_ORIGIN?: string;
  /**
   * Origin of this environment's data service, which the iOS app's AR view
   * reads through this hostname (api.ts). Unset, those paths 404.
   */
  DATA_ORIGIN?: string;
  /** Origin of this environment's asset host, where storm volumes live. */
  ASSET_ORIGIN?: string;
  /**
   * The one origin whose pages are indexed, which every hostname of this
   * environment names as its pages' canonical URL (seo.ts). Production's
   * alone: unset, as on next and demo, every page is noindexed.
   */
  CANONICAL_ORIGIN?: string;
}

const DEFAULT_PREVIEW_ORIGIN = "https://api.meteocool.com";

function escapeAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;");
}

function metaTags(
  url: string,
  params: URLSearchParams,
  lang: string | null,
  previewOrigin: string,
): string {
  const copy = previewCopy(lang);
  const alternates = alternateLocales(copy)
    .map((locale) => `<meta property="og:locale:alternate" content="${locale}" />`)
    .join("\n      ");
  // The same card the share dialog shows the sender (src/lib/sharePreview.ts):
  // the link's view, at the moment it shows.
  const preview = `${previewOrigin}${previewPathOf(params)}`;

  return `
      <meta property="og:title" content="${escapeAttribute(copy.title)}" />
      <meta property="og:description" content="${escapeAttribute(copy.description)}" />
      <meta property="og:locale" content="${copy.locale}" />
      ${alternates}
      <meta property="og:type" content="website" />
      <meta property="og:url" content="${escapeAttribute(url)}" />
      <meta property="og:image" content="${escapeAttribute(preview)}" />
      <meta property="og:image:height" content="${PREVIEW_HEIGHT}" />
      <meta property="og:image:width" content="${PREVIEW_WIDTH}" />

      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content="${escapeAttribute(copy.title)}" />
      <meta name="twitter:description" content="${escapeAttribute(copy.description)}" />

      <meta name="description" content="${escapeAttribute(copy.description)}" />
    `;
}

class MetaTagHandler {
  constructor(private readonly tags: string) {}

  element(element: Element) {
    element.append(this.tags, { html: true });
  }
}

/**
 * An HTML page as search engines should see it, with `tags` added to its
 * head: an indexed page on production's hostnames with its canonical link,
 * and any other noindexed. Anything but HTML passes through untouched.
 */
function forSearch(response: Response, url: URL, env: Env, tags = ""): Response {
  if (!(response.headers.get("Content-Type") ?? "").includes("text/html")) return response;

  const canonical = env.CANONICAL_ORIGIN ? canonicalUrl(url.pathname, env.CANONICAL_ORIGIN) : null;
  const head = `${tags}${canonical ? `<link rel="canonical" href="${escapeAttribute(canonical)}" />\n` : ""}`;
  const page = head ? new HTMLRewriter().on("head", new MetaTagHandler(head)).transform(response) : response;
  // A page without one URL to fold into: next's and demo's, and the apps' wrappers.
  return canonical ? page : withHeader(page, "X-Robots-Tag", "noindex");
}

function withHeader(response: Response, name: string, value: string): Response {
  const copy = new Response(response.body, response);
  copy.headers.set(name, value);
  return copy;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const { searchParams, pathname } = url;

    const appLinks = appLinksResponse(pathname);
    if (appLinks) return appLinks;
    const seoFile = seoFileResponse(url, env.CANONICAL_ORIGIN);
    if (seoFile) return seoFile;
    if (request.method === "GET" || request.method === "HEAD") {
      const redirect = aliasRedirect(url);
      if (redirect) return redirect;
    }

    if (env.API_ORIGIN && (isAppApiPath(pathname) || isAppApiRead(request.method, pathname))) {
      return fetch(appApiRequest(request, env.API_ORIGIN));
    }
    if (env.PREVIEW && env.PREVIEW_ORIGIN && isPreviewRead(request.method, pathname)) {
      return env.PREVIEW.fetch(appApiRequest(request, env.PREVIEW_ORIGIN));
    }
    if (env.DATA_ORIGIN && isAppDataPath(pathname)) {
      return fetch(appApiRequest(request, env.DATA_ORIGIN));
    }
    if (env.ASSET_ORIGIN && isVolumePath(pathname)) {
      return volumeRedirect(request, env.ASSET_ORIGIN);
    }

    if (isStreamedPath(pathname)) {
      // Asked for whole: the static assets ignore `Range`, which is cut here instead.
      const whole = new Request(request);
      whole.headers.delete("Range");
      return withByteRange(request, await env.ASSETS.fetch(whole));
    }
    if (pathname !== "/") {
      return forSearch(await env.ASSETS.fetch(request), url, env);
    }

    // `html_handling: "none"` in wrangler.jsonc keeps /ios.html and
    // /android.html resolving as themselves, which the native wrappers need
    // (the default would 307 them to /ios and /android). The cost is that "/" no
    // longer maps to index.html on its own, so do it here.
    const assetUrl = new URL(request.url);
    assetUrl.pathname = "/index.html";
    const response = await env.ASSETS.fetch(new Request(assetUrl, request));
    const tags = metaTags(
      request.url,
      searchParams,
      searchParams.get("share_lang"),
      env.PREVIEW_ORIGIN ?? DEFAULT_PREVIEW_ORIGIN,
    );
    return forSearch(response, url, env, tags);
  },
};
