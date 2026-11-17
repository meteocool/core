/**
 * The picture a shared link previews as: the map at the link's view, as a
 * wide card.
 *
 * One builder for both ends of a share. The Worker (worker/index.ts) puts it
 * in the OpenGraph tags a messenger reads when it unfurls the link; the share
 * dialog (components/ShareDialog.svelte) shows the same card to the sender
 * before they send it, so what they see is what the receiver will.
 *
 * Pure and free of DOM types: the Worker is checked without them.
 */

/** The card's size, which the OpenGraph tags state alongside it. */
export const PREVIEW_WIDTH = 1200;
export const PREVIEW_HEIGHT = 630;

/**
 * The card's path and query for a link's `latLonZ` ("lat,lon,zoom"); the
 * default view's card without one.
 *
 * latLonZ lands in a URL that is fetched and in an attribute in markup, so it
 * is encoded rather than interpolated raw. Commas are left literal: that is
 * the shape the preview endpoint has always been sent.
 */
export function previewPath(latLonZ: string | null): string {
  const encoded = latLonZ ? encodeURIComponent(latLonZ).replaceAll("%2C", ",") : null;
  return `/v3/preview/og.png?aspectRatio=wide&frame=true&${encoded ? `latLonZ=${encoded}` : "default"}`;
}

/** The card for a share link, by the view the link opens on. */
export function previewPathFor(link: string): string {
  return previewPath(new URL(link).searchParams.get("latLonZ"));
}
