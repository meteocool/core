export const tileBaseUrl = "https://tiles-a.meteocool.com";

// eslint-disable-next-line import/no-mutable-exports
export let apiBaseUrl = "https://api.ng.meteocool.com/api";
// eslint-disable-next-line import/no-mutable-exports
export let websocketBaseUrl = "https://api.ng.meteocool.com";
export const dataUrl = "https://data.meteocool.com";
// eslint-disable-next-line import/no-mutable-exports
export let v3APIBaseUrl = "https://api.meteocool.com/v3";

if (BACKEND === "local") {
  apiBaseUrl = "http://localhost:5001/api";
  websocketBaseUrl = "http://localhost:5001";
  v3APIBaseUrl = "http://localhost:5003/v3";
}
