import VectorSource from "ol/source/Vector";
import VectorLayer from "ol/layer/Vector";
import Style from "ol/style/Style";
import Icon from "ol/style/Icon";
import CircleStyle from "ol/style/Circle";
import Fill from "ol/style/Fill";
import Stroke from "ol/style/Stroke";
import Text from "ol/style/Text";
import mesocycloneIcon from "../assets/mesocyclone.png";
import type { FeatureLike } from "ol/Feature";
import { mesoScale } from "../lib/mesocyclones";
import type { RotationSignature } from "../lib/rotationSignatures";

/**
 * DWD's mesocyclone detections and meteocool's rotation signatures, one
 * layer: DWD's as the icon they always were, sized by their intensity
 * class; ours a ring with the rotation glyph, sized by the
 * couplet's rotational velocity, drawn solid once the radar has seen it in
 * two cycles running and dashed before that. A different mark, so nobody
 * reads ours as DWD's: ours says the velocity rotates here, no more.
 */

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

/** Ours: the ring's radius from the couplet, 9 px at 5 m/s to 15 at 20 and more. */
const SIGNATURE_RED = "rgb(200, 10, 40)";
const signatureStyleCache = new Map<string, Style>();

function signatureStyle(signature: RotationSignature | undefined): Style {
  const vrot = signature?.vrot_m_s ?? 8;
  const radius = Math.round(9 + 6 * Math.min(1, Math.max(0, (vrot - 5) / 15)));
  const persistent = Boolean(signature?.persistent);
  const key = `${radius}:${persistent}`;
  let style = signatureStyleCache.get(key);
  if (!style) {
    style = new Style({
      image: new CircleStyle({
        radius,
        fill: new Fill({ color: "rgba(255, 255, 255, 0.18)" }),
        stroke: new Stroke({ color: SIGNATURE_RED, width: 2.5, lineDash: persistent ? undefined : [4, 3] }),
      }),
      text: new Text({
        text: "↻",
        font: `700 ${Math.round(radius * 1.3)}px sans-serif`,
        fill: new Fill({ color: SIGNATURE_RED }),
        stroke: new Stroke({ color: "rgba(255, 255, 255, 0.9)", width: 2 }),
        offsetY: 1,
      }),
    });
    signatureStyleCache.set(key, style);
  }
  return style;
}

/** The feature source, and the layer that draws it. */
export default function makeMesocycloneLayer(): [VectorSource, VectorLayer<VectorSource>] {
  const ss = new VectorSource({
    features: [],
  });
  return [ss, new VectorLayer({
    source: ss,
    zIndex: 201,
    style: (feature: FeatureLike) => {
      if (feature.get("source") === "meteocool") return signatureStyle(feature.get("signature") as RotationSignature | undefined);
      const time = Number(String(feature.getId()).replace(/^dwd:/, ""));
      return mesoStyleFactory((new Date().getTime() - time) / 1000 / 1000, feature.get("intensity"));
    },
  })];
}
