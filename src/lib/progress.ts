import NanobarWrapper from "./NanobarWrapper";

/**
 * The one loading bar along the top of the screen, and everything it tracks.
 *
 * It used to move only for the requests a caller remembered to hand it, which
 * left most of what the app downloads -- a cell's history, a storm's volume,
 * the 3D map's library, a place name -- happening with nothing on screen to
 * say so. Every API call now drives it by default, and so does anything else
 * big enough to be waited on.
 *
 * Made on first use, not at import: nanobar builds its element in the page,
 * and the tests import modules that import this one without a page to build in.
 */
let bar: NanobarWrapper | null = null;

export function progress(): NanobarWrapper {
  bar ??= new NanobarWrapper({});
  return bar;
}

/**
 * Run a download with the bar moving until it is done, body and all.
 *
 * Downloads under the same `id` share a step; different ids each add one, so
 * a batch of volumes fills the bar as it lands rather than jumping to the end.
 */
export async function tracked<T>(id: string, work: () => Promise<T>): Promise<T> {
  const shown = progress();
  shown.start(id);
  try {
    return await work();
  } finally {
    shown.finish(id);
  }
}
