import VectorSource from "ol/source/Vector";
import VectorLayer from "ol/layer/Vector";
import Style from "ol/style/Style";
import Icon from "ol/style/Icon";
import mesocycloneIcon from "../../public/assets/mesocyclone.png";

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

    let size;
    if (intensity > 4) {
      size = 55;
    } else if (intensity > 3) {
      size = 46;
    } else if (intensity > 2) {
      size = 38;
    } else if (intensity > 1) {
      size = 30;
    } else {
      size = 22;
    }

    mesoStyleCache[age][intensity] = new Style({
      image: new Icon({
        src: mesocycloneIcon,
        opacity,
        scale: 0.2 * (size / 40),
      }),
    });
  }
  return mesoStyleCache[age][intensity];
};

export default function makeMesocycloneLayer() {
  const ss = new VectorSource({
    features: [],
  });
  return [ss, new VectorLayer({
    source: ss,
    zIndex: 101,
    style: (feature) => mesoStyleFactory((new Date().getTime() - feature.getId()) / 1000 / 1000,
      feature.get("intensity")),
  })];
}
