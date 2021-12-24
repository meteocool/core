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
    <meta property="og:title" content="meteocool" />
    <meta property="og:type" content="website" />
    <meta property="og:url" content="${request.url}" />
    <meta property="og:image" content="https://api.meteocool.com/v2/preview.png?${name ? name : "default"}" />
  `

  return rewriter.transform(res)
}
