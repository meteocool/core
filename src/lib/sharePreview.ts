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

/** A minute as a link writes it, UTC: `20261123T1405Z`. */
const MOMENT = /^\d{8}T\d{4}Z$/;

/**
 * The moment a link shows, as it writes it: a past window (`from`, `to`)
 * and the frame on screen (`t`). The card is drawn at it, so a link to a
 * past storm previews as that storm, not as the sky when it is unfurled.
 */
export interface PreviewMoment {
  from?: string | null;
  to?: string | null;
  t?: string | null;
}

/** The moment's part of the card's query: each value well-formed, a window only whole. */
function momentQuery({ from, to, t }: PreviewMoment): string {
  const parts: string[] = [];
  if (from && to && MOMENT.test(from) && MOMENT.test(to)) parts.push(`from=${from}`, `to=${to}`);
  if (t && MOMENT.test(t)) parts.push(`t=${t}`);
  return parts.map((part) => `&${part}`).join("");
}

/**
 * The card's path and query for a link's `latLonZ` ("lat,lon,zoom") and the
 * moment it shows; the default view's card, now, without either.
 *
 * latLonZ lands in a URL that is fetched and in an attribute in markup, so it
 * is encoded rather than interpolated raw. Commas are left literal: that is
 * the shape the preview endpoint has always been sent. The moment's values
 * are passed only in their one spelling, which needs no encoding.
 */
export function previewPath(latLonZ: string | null, moment: PreviewMoment = {}): string {
  const encoded = latLonZ ? encodeURIComponent(latLonZ).replaceAll("%2C", ",") : null;
  return `/v3/preview/og.png?aspectRatio=wide&frame=true&${encoded ? `latLonZ=${encoded}` : "default"}${momentQuery(moment)}`;
}

/** The card for a share link, by the view and the moment the link opens on. */
export function previewPathFor(link: string): string {
  return previewPathOf(new URL(link).searchParams);
}

/** The card for a link's query: what the Worker reads off the page's own address. */
export function previewPathOf(params: URLSearchParams): string {
  return previewPath(params.get("latLonZ"), { from: params.get("from"), to: params.get("to"), t: params.get("t") });
}
