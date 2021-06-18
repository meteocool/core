import { View } from "ol";
import { fromLonLat } from "ol/proj";

// eslint-disable-next-line import/prefer-default-export
export const mainView = new View({
  constrainResolution: true,
  zoom: 6,
  center: fromLonLat([10.66, 50.42]),
});
