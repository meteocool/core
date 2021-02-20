// eslint-disable-next-line import/prefer-default-export
export const tileBaseUrl = "https://tiles-a.meteocool.com";

export let apiBaseUrl;
export let websocketBaseUrl;
if (BACKEND === "local") {
  apiBaseUrl = "http://localhost:5000/api";
  websocketBaseUrl = "http://localhost:5000";
} else {
  apiBaseUrl = "https://api.ng.meteocool.com/api";
  websocketBaseUrl = "https://api.ng.meteocool.com";
}
