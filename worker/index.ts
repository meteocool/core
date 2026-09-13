
/**
 * The Worker in front of the static build.
 *
 * Its one job is OpenGraph: a shared meteocool link should preview as the map
 * at the shared location, in the sharer's language, and those tags have to be
 * in the HTML when a crawler fetches it -- no scraper runs the app to find out
 * where it was pointed. So the tags are injected per request from `latLonZ` and
 * `share_lang` rather than baked into index.html.
 *
 * Replaces functions/_middleware.js, which did the same thing as a Cloudflare
 * Pages Function. Two things changed in the move: the meta-tag HTML is built as
 * a local rather than held in module scope -- the Pages version wrote to a
 * module-level `ogtag` on every request, so two overlapping requests could swap
 * each other's language -- and the rewriter only runs when the response is
 * actually HTML.
 */

interface Env {
  ASSETS: Fetcher;
}

const PREVIEW_IMAGE = "https://api.meteocool.com/v3/preview/og.png";

const COPY = {
  de: {
    locale: "de_DE",
    alternate: "en_US",
    title: "meteocool Regenradar & Lightning Tracking",
    description:
      "Kostenfreie Open-Source Echtzeit Regenradar & Storm Tracking App für iOS, Android und das Web.",
  },
  en: {
    locale: "en_US",
    alternate: "de_DE",
    title: "meteocool Open Radar & Lightning Tracking",
    description:
      "Free & open-source real-time storm tracking for iOS, Android and the web. Currently available for Central Europe (DWD).",
  },
} as const;

function escapeAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;");
}

function metaTags(url: string, latLonZ: string | null, lang: string | null): string {
  const copy = lang === "de" ? COPY.de : COPY.en;
  // latLonZ lands in a URL the crawler fetches and in an attribute in our own
  // markup, so it is encoded for both rather than interpolated raw.
  // Commas are left literal: latLonZ is "lat,lon,zoom" and that is the exact
  // shape the preview endpoint has always been sent. encodeURIComponent would
  // turn them into %2C, which is a change to a URL nothing here can test.
  const encoded = latLonZ ? encodeURIComponent(latLonZ).replaceAll("%2C", ",") : null;
  const preview = `${PREVIEW_IMAGE}?aspectRatio=wide&frame=true&${
    encoded ? `latLonZ=${encoded}` : "default"
  }`;

  return `
      <meta property="og:title" content="${escapeAttribute(copy.title)}" />
      <meta property="og:description" content="${escapeAttribute(copy.description)}" />
      <meta property="og:locale" content="${copy.locale}" />
      <meta property="og:locale:alternate" content="${copy.alternate}" />
      <meta property="og:type" content="website" />
      <meta property="og:url" content="${escapeAttribute(url)}" />
      <meta property="og:image" content="${escapeAttribute(preview)}" />
      <meta property="og:image:height" content="630" />
      <meta property="og:image:width" content="1200" />

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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { searchParams, pathname } = new URL(request.url);

    if (pathname !== "/" && pathname !== "/index.html") {
      return env.ASSETS.fetch(request);
    }

    // `html_handling: "none"` in wrangler.jsonc keeps /ios.html and
    // /android.html resolving as themselves, which the native wrappers need --
    // the default would 307 them to /ios and /android. The cost is that "/" no
    // longer maps to index.html on its own, so do it here.
    const assetUrl = new URL(request.url);
    assetUrl.pathname = "/index.html";
    const response = await env.ASSETS.fetch(new Request(assetUrl, request));
    const contentType = response.headers.get("Content-Type") ?? "";
    if (!contentType.includes("text/html")) {
      return response;
    }

    const tags = metaTags(
      request.url,
      searchParams.get("latLonZ"),
      searchParams.get("share_lang"),
    );
    return new HTMLRewriter().on("head", new MetaTagHandler(tags)).transform(response);
  },
};
