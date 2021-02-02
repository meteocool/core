import { View } from "ol";
import { fromLonLat } from "ol/proj";

// eslint-disable-next-line import/prefer-default-export
export const mainView = new View({
  constrainResolution: true,
  zoom: 7,
  center: fromLonLat([11, 49]),
});
