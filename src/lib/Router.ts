/**
 * URL parsing.
 *
 * Effectively dead: ParseURL tested `.length` on a URLSearchParams, which has
 * no such property, so the condition was always false and parseFragment was
 * never reached. URL state is actually handled in Settings.set() and in
 * LayerManager's moveend handler. Kept because window.pu is a debugging handle.
 */
export default class Router {
  static ParseURL() {
    const params = new URL(window.location.href).searchParams;
    // Was `params.length`, which is undefined on URLSearchParams.
    const entries = [...params.entries()];
    if (entries.length > 1) {
      Router.parseFragment(entries[1][1]);
    }
  }

  static parseFragment(fragment: string): string[][] {
    return fragment
      .split("&")
      .map((e) => {
        const parts = e.split("=");
        if (parts.length === 2) {
          return [parts[0], parts[1]];
        }
        if (parts.length === 1) {
          return [parts[0], "true"];
        }
        return [];
      });
  }
}

export function ParseURL() {
  return new URL(document.location.href).searchParams.entries();
}

window.pu = ParseURL;
