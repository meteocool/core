import Feature from "ol/Feature";
import Point from "ol/geom/Point";
import VectorSource from "ol/source/Vector";
import VectorLayer from "ol/layer/Vector";
import Style from "ol/style/Style";
import Icon from "ol/style/Icon";
import { fromLonLat } from "ol/proj";
import type { FeatureLike } from "ol/Feature";
import { isDarkBasemap, watchBasemap } from "./casing";
import type { ListedSite } from "../lib/siteSweeps";

/**
 * A mark on every radar that has published sweeps lately: the way into site mode.
 *
 * From the `/sweeps` listing, not from the table of every radar there is
 * (`lib/radarSites.ts`): a radar with nothing published lately has nothing to
 * open, and a mark that opens nothing is worse than none. Tapping one opens
 * that radar's own sweep (App.svelte).
 *
 * A small disc with a radar's dish drawn in it, unlike anything else on the
 * map, and decluttered among themselves only: France's and Germany's radars
 * stand closer than a finger at the zoom they appear from. The open site's
 * mark is drawn filled, so it reads as the one the map is showing.
 */

/** Below this the marks are clutter: a whole network fits in a thumb's width. */
export const MIN_ZOOM = 6;

/** Drawn at twice its size and scaled down, so it stays crisp on a retina screen. */
const RENDER_SCALE = 2;

interface Palette {
  fill: string;
  edge: string;
  ink: string;
  open: string;
}

const LIGHT: Palette = { fill: "rgba(255, 255, 255, 0.94)", edge: "rgba(17, 20, 26, 0.35)", ink: "#11141a", open: "#2a6fdb" };
const DARK: Palette = { fill: "rgba(24, 28, 36, 0.92)", edge: "rgba(255, 255, 255, 0.35)", ink: "#f2f4f7", open: "#5b9bff" };

let palette = LIGHT;
const styles = new Map<string, Style>();

/** The mark as an SVG, 22x22 at 1x: a disc, a dish and its beam. */
function markSvg(open: boolean): string {
  const s = RENDER_SCALE;
  const disc = open ? palette.open : palette.fill;
  const ink = open ? "#ffffff" : palette.ink;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${22 * s}" height="${22 * s}" viewBox="0 0 22 22">`
    + `<circle cx="11" cy="11" r="10" fill="${disc}" stroke="${palette.edge}"/>`
    + `<path d="M6 14.5 A6 6 0 0 1 14.5 6" fill="none" stroke="${ink}" stroke-width="1.8" stroke-linecap="round"/>`
    + `<path d="M8.5 13.5 L14 8" stroke="${ink}" stroke-width="1.6" stroke-linecap="round"/>`
    + `<circle cx="14.6" cy="7.4" r="1.4" fill="${ink}"/>`
    + `<path d="M7 16.5 L12 16.5" stroke="${ink}" stroke-width="1.6" stroke-linecap="round"/>`
    + "</svg>";
}

function markStyle(feature: FeatureLike): Style {
  const open = feature.get("open") === true;
  const key = `${palette.fill}:${open}`;
  let style = styles.get(key);
  if (!style) {
    style = new Style({
      image: new Icon({
        src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markSvg(open))}`,
        scale: 1 / RENDER_SCALE,
      }),
      // The open site above the rest, so it never gives way in the declutter.
      zIndex: open ? 1 : 0,
    });
    styles.set(key, style);
  }
  return style;
}

export interface RadarSiteMarks {
  layer: VectorLayer<VectorSource>;
  /** Replace the sites with the newest listing's. */
  setSites(sites: ListedSite[]): void;
  /** Which site is open, if any. */
  setOpen(site: string | null): void;
  /** A site the listing holds, by its code. */
  site(code: string): ListedSite | undefined;
}

export default function makeRadarSiteMarks(): RadarSiteMarks {
  const source: VectorSource = new VectorSource({ features: [] });
  const bySite = new Map<string, ListedSite>();
  let open: string | null = null;

  const fill = () => {
    source.clear(true);
    source.addFeatures([...bySite.values()].map((site) => new Feature({
      geometry: new Point(fromLonLat([site.lon, site.lat])),
      radarSite: site.site,
      open: site.site === open,
    })));
  };

  const layer = new VectorLayer({
    source,
    // Over the cloud tags at 203 and the tracked cells at 202: a radar is a
    // fixed place, and the open one is what the tray is about.
    zIndex: 205,
    minZoom: MIN_ZOOM,
    declutter: "radar-sites",
    style: markStyle,
  });

  watchBasemap((basemap) => (isDarkBasemap(basemap) ? DARK : LIGHT), (next) => {
    palette = next;
    styles.clear();
    layer.changed();
  });

  return {
    layer,
    setSites(sites) {
      bySite.clear();
      for (const site of sites) bySite.set(site.site, site);
      fill();
    },
    setOpen(site) {
      if (site === open) return;
      open = site;
      fill();
    },
    site(code) {
      return bySite.get(code);
    },
  };
}
