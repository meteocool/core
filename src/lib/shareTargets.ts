/**
 * Where the share dialog sends a link: each service's own "post this" page,
 * opened in a new tab with the link and its title filled in.
 *
 * Instagram is not among them. It takes no links from the web, only a
 * picture, so the dialog hands it the preview card instead (ShareDialog).
 *
 * Pure, so the addresses are testable without a page.
 */

export type ShareTarget = "whatsapp" | "telegram" | "facebook" | "x" | "bluesky" | "email";

export interface SharedLink {
  url: string;
  title: string;
}

/** The order the dialog lists them in: messengers first, then the feeds, then mail. */
export const TARGETS: readonly ShareTarget[] = ["whatsapp", "telegram", "facebook", "x", "bluesky", "email"];

/** The page that posts `link` on `target`. */
export function targetUrl(target: ShareTarget, { url, title }: SharedLink): string {
  const u = encodeURIComponent(url);
  const text = encodeURIComponent(title);
  const both = encodeURIComponent(`${title} ${url}`);
  switch (target) {
    case "whatsapp":
      return `https://wa.me/?text=${both}`;
    case "telegram":
      return `https://t.me/share/url?url=${u}&text=${text}`;
    case "facebook":
      return `https://www.facebook.com/sharer/sharer.php?u=${u}`;
    case "x":
      return `https://x.com/intent/post?text=${text}&url=${u}`;
    case "bluesky":
      return `https://bsky.app/intent/compose?text=${both}`;
    case "email":
      return `mailto:?subject=${text}&body=${u}`;
  }
}
