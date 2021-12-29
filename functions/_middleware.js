let name
let ogtag

class ElementHandler {
  element(element) {
    element.append(ogtag, { html: true })
  }
}
const rewriter = new HTMLRewriter().on("head", new ElementHandler())

export async function onRequest(context) {
  const {
    request, // same as existing Worker API
    env, // same as existing Worker API
    params, // if filename includes [id] or [[path]]
    waitUntil, // same as ctx.waitUntil in existing Worker API
    next, // used for middleware or to fetch assets
    data, // arbitrary space for passing data between middlewares
  } = context
  let res = await next()
  const { searchParams, pathname } = new URL(request.url)

  if (!(pathname === "/index.html" || pathname === "/")) {
    return res
  }
  name = searchParams.get("latLonZ")
  ogtag = `
    <meta property="og:title" content="meteocool Radar & Lightnig Tracking" />
    <meta property="og:description" content="Free & open-source real-time storm tracking for iOS, Android and the web. Currently available for Central Europe (DWD)." />
    <meta property="og:locale" content="en_US" />
    <meta property="og:locale:alternate" content="de_DE" />
    <meta property="og:type" content="website" />
    <meta property="og:url" content="${request.url}" />
    <meta property="og:image" content="https://api.meteocool.com/v2/preview.png?aspectRatio=wide&${name ? "latLonZ="+name : "default"}" />
  `

  return rewriter.transform(res)
}
