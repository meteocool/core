/**
 * What search engines are told: which pages to index, under which one URL,
 * and where the list of them is.
 *
 * Only the environment that names a canonical origin (production's
 * meteocool.com, wrangler.jsonc) is indexed. Every other host's pages answer
 * with a noindex header, so next and demo never compete with the live site;
 * robots.txt still lets them be crawled, since a crawler that may not fetch a
 * page never sees that header and can keep the bare URL indexed.
 *
 * Each page has one URL: `/index.html` and the extensionless names redirect
 * to it, and every page names it as canonical, so a shared link's query
 * (src/lib/shareLink.ts) and app.meteocool.com, where the apps open those
 * links, fold into meteocool.com's root.
 *
 * Kept free of Worker globals beyond Response, so the tests can run it under
 * Node.
 */

/** The pages worth a search result, by their one URL. The app wrappers (ios.html, android.html) are not among them. */
export const INDEXED_PATHS = ["/", "/meteoair.html", "/imprint.html", "/privacy.html"] as const;

/** Another name a page is reached by, and the URL it is redirected to. */
const ALIASES: Record<string, string> = {
  "/index.html": "/",
  "/meteoair": "/meteoair.html",
  "/meteoair/": "/meteoair.html",
  "/imprint": "/imprint.html",
  "/imprint/": "/imprint.html",
  "/privacy": "/privacy.html",
  "/privacy/": "/privacy.html",
};

export const ROBOTS_PATH = "/robots.txt";
export const SITEMAP_PATH = "/sitemap.xml";

/** The 301 for a page's other name, keeping the query, or null for any other URL. */
export function aliasRedirect(url: URL): Response | null {
  const target = ALIASES[url.pathname];
  if (target === undefined) return null;
  return new Response(null, {
    status: 301,
    headers: { Location: `${target}${url.search}`, "Cache-Control": "public, max-age=86400" },
  });
}

/** The page's one URL on the canonical origin, without its query; null for a page not indexed. */
export function canonicalUrl(pathname: string, canonicalOrigin: string): string | null {
  const path = ALIASES[pathname] ?? pathname;
  return (INDEXED_PATHS as readonly string[]).includes(path) ? `${canonicalOrigin}${path}` : null;
}

/** Whether a host's pages may be indexed: only the canonical origin's own, by its hostname, whatever the scheme. */
export function isIndexedOrigin(origin: string, canonicalOrigin: string | undefined): boolean {
  return canonicalOrigin !== undefined && new URL(origin).host === new URL(canonicalOrigin).host;
}

export function robotsTxt(origin: string, canonicalOrigin: string | undefined): string {
  const lines = ["User-agent: *", "Allow: /"];
  // A sitemap lists one host's URLs, so only that host names it.
  if (isIndexedOrigin(origin, canonicalOrigin)) lines.push("", `Sitemap: ${canonicalOrigin}${SITEMAP_PATH}`);
  return `${lines.join("\n")}\n`;
}

// No lastmod, changefreq or priority: Google ignores the last two, and a
// lastmod it cannot trust (the map's changes every five minutes) it ignores
// for the whole file.
export function sitemapXml(canonicalOrigin: string): string {
  const urls = INDEXED_PATHS.map((path) => `  <url><loc>${canonicalOrigin}${path}</loc></url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`;
}

/** robots.txt or the sitemap for this host, or null for any other path. */
export function seoFileResponse(url: URL, canonicalOrigin: string | undefined): Response | null {
  if (url.pathname === ROBOTS_PATH) {
    return new Response(robotsTxt(url.origin, canonicalOrigin), {
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" },
    });
  }
  if (url.pathname === SITEMAP_PATH) {
    if (!isIndexedOrigin(url.origin, canonicalOrigin)) return new Response("Not Found", { status: 404 });
    return new Response(sitemapXml(canonicalOrigin!), {
      headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" },
    });
  }
  return null;
}
