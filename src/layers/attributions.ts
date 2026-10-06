/*
 * What the map's corner credits, per source. OpenLayers shows a source's
 * credit only while a layer drawing it is in view, and drops duplicates.
 *
 * Names only. The radar networks' licences ask for more than a name -- CC BY
 * 4.0 wants the licence named and linked and the changes indicated, Licence
 * Ouverte the source, IMGW that its data "has been processed by" whoever shows
 * it -- and all of that lives in imprint.html#data, which the imprint credit
 * links as "Licences" beside the base map's credit on every map. Spelled
 * out per provider on the map it ran three lines deep on a phone.
 */
const link = (href: string, text: string) => `<a href="${href}" target="_blank" rel="noopener">${text}</a>`;

export const copernicusAttribution = "Contains modified Copernicus Sentinel data";
export const ororatechAttribution = "© OroraTech";
export const osmAttribution = `© ${link("https://www.openstreetmap.org/copyright", "OpenStreetMap")} contributors`;
export const dwdAttribution = `© ${link("https://www.dwd.de/", "DWD")}`;
export const meteoSwissAttribution = `© ${link("https://www.meteoswiss.admin.ch/", "MeteoSwiss")}`;
export const meteoFranceAttribution = `© ${link("https://meteofrance.com/", "Météo-France")}`;
export const chmiAttribution = `© ${link("https://www.chmi.cz/", "ČHMÚ")}`;
export const imgwAttribution = `© ${link("https://www.imgw.pl/", "IMGW-PIB")}`;
export const noaaAttribution = link("https://www.weather.gov/disclaimer", "NOAA/NWS");
export const blitzortungAttribution = `© ${link("https://www.blitzortung.org/", "Blitzortung.org")}`;
export const mapterhornAttribution = `© ${link("https://mapterhorn.com/attribution", "Mapterhorn")}`;
export const protomapsAttribution = `© ${link("https://protomaps.com", "Protomaps")}`;
export const imprintAttribution = "| <a href=\"/imprint.html\">Imprint</a> · <a href=\"/imprint.html#data\">Licences</a>";

/**
 * The order the corner reads in: the base map's credits, the data's, and the
 * imprint last -- its leading "|" is written to close the line.
 *
 * OpenLayers lists credits in the order their layers were added to the map,
 * which is no order at all here: the lightning layer is built with the page
 * and the radar networks' as their first frames land, so Blitzortung led the
 * line, the imprint came straight after it, and the networks shuffled from
 * one load to the next. A credit not listed keeps its place among the data's.
 */
export const ATTRIBUTION_ORDER = [
  osmAttribution,
  protomapsAttribution,
  mapterhornAttribution,
  dwdAttribution,
  meteoSwissAttribution,
  meteoFranceAttribution,
  chmiAttribution,
  imgwAttribution,
  noaaAttribution,
  copernicusAttribution,
  ororatechAttribution,
  blitzortungAttribution,
  imprintAttribution,
];

/** `credits` in ATTRIBUTION_ORDER; see there. */
export function orderAttributions<T>(credits: T[]): T[] {
  const last = ATTRIBUTION_ORDER.indexOf(imprintAttribution);
  const rank = (credit: T) => {
    const at = ATTRIBUTION_ORDER.indexOf(credit as unknown as string);
    return at === -1 ? last - 0.5 : at;
  };
  return credits
    .map((credit, index) => ({ credit, index, rank: rank(credit) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map(({ credit }) => credit);
}
