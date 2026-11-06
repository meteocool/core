import VectorSource from "ol/source/Vector";
import VectorLayer from "ol/layer/Vector";
import Style from "ol/style/Style";
import Icon from "ol/style/Icon";
import mesocycloneIcon from "../assets/mesocyclone.png";
import type { FeatureLike } from "ol/Feature";
import { mesoScale } from "../lib/mesocyclones";

const mesoStyleCache = {};

const mesoStyleFactory = (age, intensity) => {
  if (age < 5) {
    age = 0;
  }
  if (!(age in mesoStyleCache)) {
    mesoStyleCache[age] = {};
  }
  if (!mesoStyleCache[age][intensity]) {
    let opacity;
    if (age > 5) {
      opacity = 0.8;
    }
    if (age > 10) {
      opacity = 0.6;
    }
    if (age > 20) {
      opacity = 0.4;
    }
    if (age > 40) {
      opacity = 0.2;
    }
    if (age > 50) {
      opacity = 0.1;
    }

    mesoStyleCache[age][intensity] = new Style({
      image: new Icon({
        src: mesocycloneIcon,
        opacity,
        // Its size by intensity, which a tap measures against too (lib/mesocyclones.ts).
        scale: mesoScale(intensity),
      }),
    });
  }
  return mesoStyleCache[age][intensity];
};

/** The feature source, and the layer that draws it. */
export default function makeMesocycloneLayer(): [VectorSource, VectorLayer<VectorSource>] {
  const ss = new VectorSource({
    features: [],
  });
  return [ss, new VectorLayer({
    source: ss,
    zIndex: 201,
    style: (feature: FeatureLike) => mesoStyleFactory(
      (new Date().getTime() - Number(feature.getId())) / 1000 / 1000,
      feature.get("intensity"),
    ),
  })];
}
