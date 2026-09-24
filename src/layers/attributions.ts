/*
 * What the map's corner credits, per source. OpenLayers shows a source's
 * credit only while a layer drawing it is in view, and drops duplicates.
 *
 * The radar networks' licences ask for more than a name: CC BY 4.0 wants the
 * licence named and linked and the changes indicated, Licence Ouverte the
 * source, and IMGW that its data "has been processed by" whoever shows it.
 * Every radar here is processed -- composited, reprojected, despeckled,
 * coloured -- so each credit links its licence, and the imprint's link sits
 * beside one to the long form in imprint.html.
 */
const link = (href: string, text: string) => `<a href="${href}" target="_blank" rel="noopener">${text}</a>`;
const ccBy = link("https://creativecommons.org/licenses/by/4.0/", "CC BY 4.0");
const licenceOuverte = link("https://www.etalab.gouv.fr/licence-ouverte-open-licence/", "Licence Ouverte 2.0");

export const copernicusAttribution = "Contains modified Copernicus Sentinel data";
export const ororatechAttribution = "© OroraTech";
export const osmAttribution = `© ${link("https://www.openstreetmap.org/copyright", "OpenStreetMap")} contributors`;
export const dwdAttribution = `© ${link("https://www.dwd.de/", "DWD")} (${ccBy})`;
export const meteoSwissAttribution = `© ${link("https://www.meteoswiss.admin.ch/", "MeteoSwiss")} (${ccBy})`;
export const meteoFranceAttribution = `© ${link("https://meteofrance.com/", "Météo-France")} (${licenceOuverte})`;
export const chmiAttribution = `© ${link("https://www.chmi.cz/", "ČHMÚ")} (${ccBy})`;
export const imgwAttribution = `© ${link("https://www.imgw.pl/", "IMGW-PIB")} (${ccBy})`;
export const blitzortungAttribution = `© ${link("https://www.blitzortung.org/", "Blitzortung.org")}`;
export const protomapsAttribution = `© ${link("https://protomaps.com", "Protomaps")}`;
export const imprintAttribution = "| <a href=\"/imprint.html\">Imprint</a> · <a href=\"/imprint.html#data\">Data licences</a>";
