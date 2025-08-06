/**
 * Cloudflare Worker for meteocool - handles OpenGraph meta tags and serves static assets
 * Migrated from functions/_middleware.js to work with Cloudflare Workers static assets
 */

class MetaTagHandler {
  constructor(metaTags) {
    this.metaTags = metaTags
  }

  element(element) {
    // Append the OpenGraph meta tags to the head element
    element.append(this.metaTags, { html: true })
  }
}

export default {
  async fetch(request, env) {
    const { searchParams, pathname } = new URL(request.url)

    // Only process index.html and root path for meta tag injection
    if (pathname === '/index.html' || pathname === '/') {
      const latLonZ = searchParams.get('latLonZ')
      const shareLang = searchParams.get('share_lang')

      // Generate OpenGraph meta tags based on language and location
      let metaTags
      if (shareLang === 'de') {
        metaTags = `
          <meta property="og:title" content="meteocool Regenradar & Lightning Tracking" />
          <meta property="og:description" content="Kostenfreie Open-Source Echtzeit Regenradar & Storm Tracking App für iOS, Android und das Web." />
          <meta property="og:locale" content="de_DE" />
          <meta property="og:locale:alternate" content="en_US" />
          <meta property="og:type" content="website" />
          <meta property="og:url" content="${request.url}" />
          <meta property="og:image" content="https://api.meteocool.com/v3/preview/og.png?aspectRatio=wide&frame=true&${latLonZ ? 'latLonZ=' + latLonZ : 'default'}" />
          <meta property="og:image:height" content="630" />
          <meta property="og:image:width" content="1200" />
          <meta name="twitter:card" content="summary_large_image" />
          <meta name="twitter:title" content="meteocool Regenradar & Lightning Tracking" />
          <meta name="twitter:description" content="Kostenfreie Open-Source Echtzeit Regenradar & Storm Tracking App für iOS, Android und das Web." />
          <meta name="description" content="Kostenfreie Open-Source Echtzeit Regenradar & Storm Tracking App für iOS, Android und das Web." />
        `
      } else {
        metaTags = `
          <meta property="og:title" content="meteocool Open Radar & Lightning Tracking" />
          <meta property="og:description" content="Free & open-source real-time storm tracking for iOS, Android and the web. Currently available for Central Europe (DWD)." />
          <meta property="og:locale" content="en_US" />
          <meta property="og:locale:alternate" content="de_DE" />
          <meta property="og:type" content="website" />
          <meta property="og:url" content="${request.url}" />
          <meta property="og:image" content="https://api.meteocool.com/v3/preview/og.png?aspectRatio=wide&frame=true&${latLonZ ? 'latLonZ=' + latLonZ : 'default'}" />
          <meta property="og:image:height" content="630" />
          <meta property="og:image:width" content="1200" />
          <meta name="twitter:card" content="summary_large_image" />
          <meta name="twitter:title" content="meteocool Open Radar & Lightning Tracking" />
          <meta name="twitter:description" content="Free & open-source real-time storm tracking for iOS, Android and the web. Currently available for Central Europe (DWD)." />
          <meta name="description" content="Free & open-source real-time storm tracking for iOS, Android and the web. Currently available for Central Europe (DWD)." />
        `
      }

      // Fetch the static asset from the ASSETS binding
      const assetResponse = await env.ASSETS.fetch(request)

      // Check if the response is HTML before applying HTMLRewriter
      const contentType = assetResponse.headers.get('Content-Type')
      if (contentType && contentType.includes('text/html')) {
        // Use HTMLRewriter to inject meta tags into the head element
        return new HTMLRewriter().on('head', new MetaTagHandler(metaTags)).transform(assetResponse)
      }

      // Return the asset response as-is if it's not HTML
      return assetResponse
    }

    // For all other paths, serve static assets directly
    return env.ASSETS.fetch(request)
  },
}
