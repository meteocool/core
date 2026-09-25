/*
 * What the map's corner credits, per source. OpenLayers shows a source's
 * credit only while a layer drawing it is in view, and drops duplicates.
 *
 * Names only. The radar networks' licences ask for more than a name -- CC BY
 * 4.0 wants the licence named and linked and the changes indicated, Licence
 * Ouverte the source, IMGW that its data "has been processed by" whoever shows
 * it -- and all of that lives in imprint.html#data, which the imprint credit
 * links as "Data licences" beside the base map's credit on every map. Spelled
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
export const protomapsAttribution = `© ${link("https://protomaps.com", "Protomaps")}`;
export const imprintAttribution = "| <a href=\"/imprint.html\">Imprint</a> · <a href=\"/imprint.html#data\">Data licences</a>";
