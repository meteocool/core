import { get } from "svelte/store";
import { fetchSweeps, quietly } from "../api";
import type { Progress } from "../api";
import {
  capLatestObservation, capTimeIndicator, compositeDim, radarColormap, selectedStorm, siteMarksVisible, siteMode,
  siteSweepView,
} from "../stores";
import { tileBaseUrl } from "../urls";
import { decodeSweep, readBin, SweepGone } from "./sweep";
import type { BinReading, Sweep } from "./sweep";
import { binAt, fromSite, reachM, stormRelative } from "./sweepGeometry";
import type { BinAt, Motion, SweepGeometry } from "./sweepGeometry";
import { aheadOf, listedFor, sweepAt, tiltNear } from "./siteSweeps";
import type { ListedScan, ListedSite, OfferedTilt, SiteMode } from "./siteSweeps";
import { beamHeightKm, radarSite } from "./radarSites";
import { motionOf } from "./stormSelection";
import { timedFetch } from "./timedFetch";
import type { SiteSweepLayer } from "../layers/siteSweep";
import type { RadarSiteMarks } from "../layers/radarSiteMarks";
import type { BeamRings } from "../layers/beamRings";

/**
 * Site mode, end to end: the radar marks, the open radar's sweep for the step
 * on screen, and what the tray and the long press read of it.
 *
 * Everything it decides is in `siteSweeps.ts` and `sweepGeometry.ts`, pure;
 * this is the plumbing between the listing, the timeline, the selected storm
 * and the layers. Its state is the stores: `siteMode` says what is open,
 * `siteSweepView` what is shown, and `compositeDim` how faint the composites
 * are drawn under it.
 */

/** How the composites are drawn under an open radar's sweep. */
export const SITE_MODE_COMPOSITES = 0.35;

/** Sweeps kept decoded: a step's, the three ahead, and a few behind for scrubbing back. */
const KEPT_SWEEPS = 16;

/** Where a reading lands, and what is there. */
export interface SweepReading {
  bin: BinAt;
  reading: BinReading;
  quantity: SiteMode["quantity"];
  header: Sweep["header"];
}

/** The manager the page made, for the long press to read through (`readSiteAt`). */
let current: SiteSweepManager | null = null;

/** What the open radar's sweep holds at a point; null with none open or the point outside it. */
export function readSiteAt(lon: number, lat: number): SweepReading | null {
  return current?.readAt(lon, lat) ?? null;
}

/** Make `manager` the one the long press reads through. */
export function readThrough(manager: SiteSweepManager) {
  current = manager;
}

export default class SiteSweepManager {
  private readonly sweeps = new Map<string, Promise<Sweep>>();
  /** The open site as `/sweeps?site=` last answered, newer than the viewport's listing. */
  private openSite: ListedSite | null = null;
  private shown: { scan: ListedScan; sweep: Sweep } | null = null;
  /** The open site's last sweep drawn, kept through a step with none: how far it reaches. */
  private reach: { geometry: SweepGeometry; groundM: number } | null = null;
  /** Bumped on every redraw, so a sweep that lands after the reader has moved on is not drawn. */
  private generation = 0;
  private viewport: [number, number, number, number] | null = null;

  constructor(
    private readonly marks: RadarSiteMarks,
    private readonly layer: SiteSweepLayer,
    private readonly rings: BeamRings,
    private readonly credit: (network: string) => string | null,
  ) {
    siteMode.subscribe((mode) => this.modeChanged(mode));
    capTimeIndicator.subscribe(() => void this.redraw());
    selectedStorm.subscribe(() => void this.redraw());
    radarColormap.subscribe((name) => layer.setPalette(name));
    siteMarksVisible.subscribe((visible) => marks.layer.setVisible(visible));
  }

  /** The map settled on this viewport: list its radars, if the marks are shown. */
  async listViewport(bbox: [number, number, number, number], bar: Progress = quietly) {
    this.viewport = bbox;
    if (!get(siteMarksVisible)) return;
    const answer = await fetchSweeps({ bbox }, bar).catch(() => null);
    if (!answer || this.viewport !== bbox) return;
    const sites = (answer.sites ?? []) as ListedSite[];
    // The open site stays listed while the reader pans away from it.
    if (this.openSite && !sites.some((site) => site.site === this.openSite!.site)) sites.push(this.openSite);
    this.marks.setSites(sites);
  }

  /** Open a radar: reflectivity at its lowest tilt, or what was open if it is the same radar. */
  open(code: string) {
    const current = get(siteMode);
    if (current?.site === code) return;
    const listed = this.marks.site(code);
    const lowest = listed ? Math.min(...listedFor(listed, "reflectivity").map((tilt) => tilt.elevation_deg)) : 0;
    siteMode.set({ site: code, quantity: current?.quantity ?? "reflectivity", elevation: Number.isFinite(lowest) ? lowest : 0 });
  }

  close() {
    siteMode.set(null);
  }

  /** A site published new sweeps (the `sweeps` socket event): refetch it, if it is the one open. */
  async sitePublished(code: string) {
    if (get(siteMode)?.site !== code) return;
    await this.refreshOpenSite(code);
    await this.redraw();
  }

  /**
   * Whether a point is inside the open radar's reach, as its last sweep drawn
   * covered it. False with none open, or none drawn yet.
   */
  reaches(lon: number, lat: number): boolean {
    if (!get(siteMode) || !this.reach) return false;
    const { geometry, groundM } = this.reach;
    return fromSite(geometry.lon, geometry.lat, lon, lat).groundM <= groundM;
  }

  /** What the open sweep holds at a point, for the long press; null outside it or with none open. */
  readAt(lon: number, lat: number): SweepReading | null {
    const mode = get(siteMode);
    if (!mode || !this.shown) return null;
    const { header, bins } = this.shown.sweep;
    const bin = binAt(header, lon, lat);
    if (!bin) return null;
    let reading = readBin(header.encoding, bins[bin.ray * header.nbins + bin.bin]);
    const motion = this.motion();
    if (mode.quantity === "srv" && motion && reading.kind === "value") {
      reading = { kind: "value", value: stormRelative(reading.value, bin.azimuthDeg, motion) };
    }
    return { bin, reading, quantity: mode.quantity, header };
  }

  private motion(): Motion | null {
    const storm = get(selectedStorm);
    return storm ? motionOf(storm) : null;
  }

  private async modeChanged(mode: SiteMode | null) {
    this.marks.setOpen(mode?.site ?? null);
    compositeDim.set(mode ? SITE_MODE_COMPOSITES : 1);
    if (!mode) {
      this.openSite = null;
      this.shown = null;
      this.reach = null;
      this.sweeps.clear();
      this.generation++;
      this.layer.release();
      this.layer.setAttribution(null);
      this.rings.clear();
      siteSweepView.set(null);
      return;
    }
    if (this.openSite?.site !== mode.site) {
      this.openSite = this.marks.site(mode.site) ?? null;
      this.reach = null;
      this.sweeps.clear();
      await this.refreshOpenSite(mode.site);
    }
    await this.redraw();
  }

  private async refreshOpenSite(code: string) {
    const answer = await fetchSweeps({ site: code }, quietly).catch(() => null);
    const site = (answer?.sites ?? []).find((listed) => listed.site === code) as ListedSite | undefined;
    if (site && get(siteMode)?.site === code) this.openSite = site;
  }

  /** Draw what the step on screen should show of the open site, fetching it if need be. */
  private async redraw() {
    const mode = get(siteMode);
    const site = this.openSite;
    if (!mode || !site) return;
    const generation = ++this.generation;
    const tilts = listedFor(site, mode.quantity);
    const tilt = tiltNear(tilts, mode.elevation);
    const step = get(capTimeIndicator);
    const newest = get(capLatestObservation);
    const live = step === 0 || step === newest;
    const scan = tilt ? sweepAt(tilt.scans, step, live) : null;
    const motion = this.motion();
    const view = {
      site,
      tilts: this.offered(site, mode),
      hasVelocity: listedFor(site, "velocity").length > 0,
      hasMotion: motion !== null,
    };
    this.layer.setAttribution(this.credit(site.network));
    if (!scan) {
      this.shown = null;
      this.layer.show(null);
      this.rings.clear();
      siteSweepView.set({ ...view, status: "none", startedAt: null, scannedAt: null, nyquist: null, dealiased: null, dealiaser: null });
      return;
    }
    if (this.shown?.scan.path !== scan.path) {
      siteSweepView.update((current) => ({
        ...view,
        status: "loading",
        startedAt: current?.startedAt ?? null,
        scannedAt: current?.scannedAt ?? null,
        nyquist: current?.nyquist ?? null,
        dealiased: current?.dealiased ?? null,
        dealiaser: current?.dealiaser ?? null,
      }));
    }
    let sweep: Sweep;
    try {
      sweep = await this.load(scan.path);
    } catch {
      if (generation !== this.generation) return;
      this.shown = null;
      this.layer.show(null);
      siteSweepView.set({ ...view, status: "failed", startedAt: null, scannedAt: scan.scanned_at, nyquist: null, dealiased: null, dealiaser: null });
      return;
    }
    if (generation !== this.generation) return;
    this.shown = { scan, sweep };
    this.reach = { geometry: sweep.header, groundM: reachM(sweep.header) };
    this.layer.show({ sweep, mode: mode.quantity, motion });
    this.rings.show(sweep.header);
    siteSweepView.set({
      ...view,
      status: "shown",
      startedAt: sweep.header.started_at,
      scannedAt: sweep.header.scanned_at,
      nyquist: sweep.header.nyquist_m_s,
      dealiased: sweep.header.encoding === "vrad-u8" ? sweep.header.dealiased : null,
      dealiaser: sweep.header.dealiaser,
    });
    // The next few, so a step forward finds its sweep already here.
    for (const next of aheadOf(tilt!.scans, scan)) void this.load(next.path).catch(() => undefined);
  }

  /** Every tilt of what is open, lowest first, each with its beam's height 100 km out. */
  private offered(site: ListedSite, mode: SiteMode): OfferedTilt[] {
    const height = this.shown?.sweep.header.height_m ?? radarSite(site.site)?.heightM ?? 0;
    return listedFor(site, mode.quantity).map((tilt) => ({
      elevation: tilt.elevation_deg,
      beamKmAt100: beamHeightKm(100, tilt.elevation_deg, height),
    }));
  }

  /** One sweep, from the ones held or the bucket; the oldest held is let go past `KEPT_SWEEPS`. */
  private load(path: string): Promise<Sweep> {
    const held = this.sweeps.get(path);
    if (held) {
      // Most recently used last.
      this.sweeps.delete(path);
      this.sweeps.set(path, held);
      return held;
    }
    const loading = (async () => {
      const response = await timedFetch(`${tileBaseUrl}/${path}`);
      if (response.status === 403 || response.status === 404) throw new SweepGone(path, response.status);
      if (!response.ok) throw new Error(`sweep ${path}: ${response.status}`);
      return decodeSweep(await response.arrayBuffer());
    })();
    loading.catch(() => this.sweeps.delete(path));
    this.sweeps.set(path, loading);
    while (this.sweeps.size > KEPT_SWEEPS) this.sweeps.delete(this.sweeps.keys().next().value!);
    return loading;
  }
}
