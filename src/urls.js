export const tileBaseUrl = "https://tiles-a.meteocool.com";

// eslint-disable-next-line import/no-mutable-exports
export let apiBaseUrl;
// eslint-disable-next-line import/no-mutable-exports
export let websocketBaseUrl;
export const dataUrl = "https://data.meteocool.com";
// eslint-disable-next-line import/no-mutable-exports
export let v2APIBaseUrl = "https://api.meteocool.com/v2";
if (BACKEND === "local") {
  apiBaseUrl = "http://localhost:5001/api";
  websocketBaseUrl = "http://localhost:5001";
  v2APIBaseUrl = "http://localhost:5003/v2";
} else {
  apiBaseUrl = "https://api.ng.meteocool.com/api";
  websocketBaseUrl = "https://api.ng.meteocool.com";
}
