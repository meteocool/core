/**
 * The NWP models meteocompare compares, as open-meteo exposes them.
 *
 * Ported from Flowm/meteocompare (src/domain/models.ts). Each `id` is a value
 * open-meteo accepts in `models=`; `seamless` variants let open-meteo pick the
 * highest-resolution component it has for the point, which we still treat as
 * one logical model.
 */

export type ModelKind = "global" | "regional-cam" | "regional-mid" | "ai" | "ensemble-mean";

export interface ModelDef {
  id: string;
  label: string;
  provider: string;
  kind: ModelKind;
  /** Beyond this lead time open-meteo may return a fallback, or null. */
  maxLeadHours: number;
}

export const MODELS: ModelDef[] = [
  { id: "ecmwf_ifs", label: "ECMWF IFS HRES", provider: "ECMWF", kind: "global", maxLeadHours: 240 },
  { id: "gfs_seamless", label: "NOAA GFS", provider: "NOAA", kind: "global", maxLeadHours: 384 },
  { id: "gem_seamless", label: "EC GEM", provider: "Environment Canada", kind: "regional-mid", maxLeadHours: 240 },
  { id: "ukmo_seamless", label: "UKMO", provider: "UK Met Office", kind: "regional-mid", maxLeadHours: 168 },
  { id: "meteofrance_seamless", label: "Météo-France", provider: "Météo-France", kind: "regional-cam", maxLeadHours: 102 },
  { id: "cma_grapes_global", label: "CMA GRAPES", provider: "CMA", kind: "global", maxLeadHours: 240 },
  { id: "bom_access_global", label: "BOM ACCESS-G", provider: "BOM", kind: "global", maxLeadHours: 240 },
  { id: "jma_seamless", label: "JMA", provider: "JMA", kind: "regional-mid", maxLeadHours: 264 },
  { id: "kma_seamless", label: "KMA", provider: "KMA", kind: "regional-mid", maxLeadHours: 288 },
  { id: "icon_global", label: "DWD ICON", provider: "DWD", kind: "global", maxLeadHours: 180 },
  { id: "icon_eu", label: "DWD ICON-EU", provider: "DWD", kind: "regional-mid", maxLeadHours: 120 },
  { id: "icon_d2", label: "DWD ICON-D2", provider: "DWD", kind: "regional-cam", maxLeadHours: 48 },
  { id: "knmi_harmonie_arome_europe", label: "KNMI Harmonie", provider: "KNMI", kind: "regional-cam", maxLeadHours: 60 },
  { id: "dmi_harmonie_arome_europe", label: "DMI Harmonie", provider: "DMI", kind: "regional-cam", maxLeadHours: 60 },
  { id: "metno_nordic", label: "MET Norway", provider: "MET Norway", kind: "regional-cam", maxLeadHours: 60 },
  { id: "meteoswiss_icon_seamless", label: "MeteoSwiss ICON", provider: "MeteoSwiss", kind: "regional-cam", maxLeadHours: 120 },
  { id: "geosphere_arome_austria", label: "GeoSphere AROME", provider: "GeoSphere Austria", kind: "regional-cam", maxLeadHours: 60 },
  { id: "ecmwf_aifs025_single", label: "ECMWF AIFS", provider: "ECMWF", kind: "ai", maxLeadHours: 360 },
  { id: "gfs_graphcast025", label: "NOAA GraphCast", provider: "NOAA", kind: "ai", maxLeadHours: 384 },
  { id: "ncep_aigfs025", label: "NOAA AIGFS", provider: "NOAA", kind: "ai", maxLeadHours: 384 },
  { id: "ncep_hgefs025_ensemble_mean", label: "NOAA HGEFS mean", provider: "NOAA", kind: "ensemble-mean", maxLeadHours: 384 },
];

export const MODEL_IDS = MODELS.map((m) => m.id);

const BY_ID = new Map(MODELS.map((m) => [m.id, m]));

export function modelById(id: string): ModelDef | undefined {
  return BY_ID.get(id);
}

/**
 * Models sharing a lineage do not corroborate one another: four ICON variants
 * agreeing is one model's opinion, not four. Counting by family keeps a cluster
 * from reading as independent agreement (meteocompare ADR 0006).
 */
const FAMILY: Record<string, string> = {
  icon_global: "icon",
  icon_eu: "icon",
  icon_d2: "icon",
  meteoswiss_icon_seamless: "icon",
  gfs_seamless: "gfs",
  gfs_graphcast025: "gfs",
  ncep_aigfs025: "gfs",
  ncep_hgefs025_ensemble_mean: "gfs",
  ecmwf_ifs: "ecmwf",
  ecmwf_aifs025_single: "ecmwf",
  knmi_harmonie_arome_europe: "harmonie",
  dmi_harmonie_arome_europe: "harmonie",
  metno_nordic: "harmonie",
};

/** Members of one family count as 1 + 0.5 per extra member, not as N. */
export function effectiveModelCount(ids: string[]): number {
  const sizes = new Map<string, number>();
  for (const id of ids) {
    const family = FAMILY[id] ?? id;
    sizes.set(family, (sizes.get(family) ?? 0) + 1);
  }
  let total = 0;
  for (const size of sizes.values()) total += 1 + (size - 1) * 0.5;
  return total;
}
