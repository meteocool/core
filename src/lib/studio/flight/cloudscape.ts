/**
 * The sky of a flight: the storms as clouds to fly among, where the map
 * draws them as storms to read.
 *
 * The map's white cloud is the radar's field with a lumpy edge, and from the
 * ground up it is the rain: walls down to the sea, flat on top, which from
 * a cockpit is a curtain and not a cloud. This takes the same field for
 * where the weather is and how tall, and makes the rest up as a painter
 * would: a level base the rain falls out of as a grey veil, sides and tops
 * that swell into puffs with smaller puffs on them, creases between, a
 * sunlit side nearly white against a blue-grey shadowed one, a base darker
 * than its top, a bright rim against the sun, and haze taking the far ones.
 * Not a claim about what the cloud over a given echo looked like.
 *
 * GLSL, handed to the storm layer in place of its own description of the
 * white cloud (`CloudsLayer.setScenic`, which says what the three functions
 * are and what they may use). Here and not there because it is the flight's,
 * and comes with it.
 *
 * ## Cloud or rain
 *
 * A radar does not see cloud. It sees what is falling, or large enough to
 * fall: rain, hail, and the snow and graupel held up inside a storm. So what
 * of its echo is drawn white and what as rain is assumed, as follows.
 *
 * - Above the cloud base, echo is inside cloud: precipitation is made
 *   there, so there is cloud round it. Drawn as cloud, and a little wider
 *   than the echo, since a cloud is wider than what falls from it.
 * - Below the base, echo is rain on its way down, with clear air round it.
 *   Drawn as a grey shaft, streaked, as thin as a veil under weak echo and
 *   as dark as a wall under a core.
 * - Echo that reaches very high belongs to a storm tall enough to have an
 *   anvil: up there the cloud is drawn as a flat sheet, spreading a few
 *   kilometres past the echo, with a level top.
 * - Weak echo aloft is the thin, spread-out part of a storm, or snow that
 *   will not reach the ground: cloud still, but less of it, so it reads as a
 *   sheet beside the towers.
 *
 * The base is one height for every storm in view: where the weather
 * stations round the flight put it (cloudBase.ts), lower on a damp day, and
 * a usual one where there are none.
 */

/** How opaque the cloud is to its own shadows, per kilometre: less than to the eye, or every shadowed side is black. */
const SHADOW_PER_KM = "1.15";

/**
 * The sky with its clouds beginning `baseKm` above the sea (cloudBase.ts
 * says where that is). Another base is another shader: it changes with the
 * weather, not with the frame.
 */
export const cloudscape = (baseKm: number): string => `
/** Where cloud begins, kilometres above the sea: below it is rain. */
const float BASE_KM = ${baseKm.toFixed(2)};
/** How far a puff pushes the cloud's top up, and a crease lets it down, km. */
const float SWELL_KM = 1.7;
/** Where a tall storm's top stops rising and spreads, km, how far out it spreads, and where the sky puts a lid on it. */
const float ANVIL_KM = 8.5;
const float ANVIL_SPREAD_KM = 4.5;
const float LID_KM = 12.6;

vec3 hash33(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}

/**
 * How far to the nearest of a scatter of points, one to a cell: 0 on one,
 * towards 1 between them. Looked for in the eight cells round the point,
 * which is where it nearly always is; the points keep to the middle of
 * their cells so that it is.
 */
float scatter(vec3 p) {
  vec3 base = floor(p - 0.5);
  float nearest = 4.0;
  for (int k = 0; k < 8; k += 1) {
    vec3 cell = base + vec3(float(k & 1), float((k >> 1) & 1), float((k >> 2) & 1));
    vec3 away = cell + 0.5 + (hash33(cell) - 0.5) * 0.8 - p;
    nearest = min(nearest, dot(away, away));
  }
  return min(sqrt(nearest), 1.0);
}

/** Puffs: 1 in the middle of one, 0 in the creases between. Three kilometres across, with ones of half that on them. */
float puffs(vec3 w) {
  float large = 1.0 - scatter(w * vec3(0.32, 0.32, 0.42));
  float small = 1.0 - scatter(w * vec3(0.62, 0.62, 0.8) + 11.0);
  return 0.64 * large + 0.36 * small;
}

/** How much of the way up from rain to cloud a height is: the base, level and a little uneven. */
float aboveBase(vec3 w) {
  float base = BASE_KM + 0.3 * (noise3(vec3(w.xy * 0.2, 1.7)) - 0.5);
  return smoothstep(base - 0.1, base + 0.45, w.z);
}

/** The cloud a point is before its puffs: wider than its rain, and none below the base. For shadows, which need no more. */
float skyBody(vec3 p) {
  vec2 field = sampleField(p);
  return smoothstep(uLow - 6.0, uHigh - 3.0, field.x) * field.y * smoothstep(BASE_KM - 0.2, BASE_KM + 0.5, p.z * uExtentKm.z);
}

/** How deep in a puff the point last asked of skyDensity was, 0 in a crease to 1: its light is asked next, and a crease is in shadow. */
float lastPuff = 1.0;
/** And how heavy the rain there, 0 to 1, where it was under the base: a heavier shaft is darker. */
float lastShaft = 0.0;

/**
 * Rain under the base: a shaft as heavy as its echo is strong, in streaks
 * that run down it. Under the weakest echo next to nothing, which is rain
 * that is seen through; under a core, a wall.
 */
float rainShaft(vec3 w, vec2 field, float above) {
  float heavy = smoothstep(uLow + 2.0, uHigh + 20.0, field.x) * field.y;
  lastShaft = heavy;
  // Streaks: fine across, long down.
  float streak = 0.5 + 0.5 * noise3(vec3(w.xy * 1.7, w.z * 0.12));
  return heavy * heavy * streak * (1.0 - above) * 0.24;
}

float skyDensity(vec3 p, vec2 field) {
  vec3 w = worldKm(p);
  // Where the cloud stands, pushed a kilometre or two this way and that by
  // slow noise, differently at each height: a wall of echo becomes bulges.
  vec3 slow = w * vec3(0.17, 0.17, 0.3);
  vec2 drift = vec2(noise3(slow + 3.1), noise3(slow + 17.7)) - 0.5;
  vec3 from = p - vec3(drift * 3.4, 0.0) / uExtentKm;
  // High up a storm's top has nowhere to go but out: an anvil, a sheet
  // reaching past the echo that feeds it. How much of one this height is.
  float sheet = smoothstep(ANVIL_KM, ANVIL_KM + 1.5, w.z);
  // Nothing there, and nothing under it for a puff to lift up to here: no cloud, and no more worked out.
  vec3 swell = vec3(0.0, 0.0, SWELL_KM / uExtentKm.z) * (1.0 - 0.8 * sheet);
  float reach = max(max(field.x, sampleField(from).x), sampleField(from - 0.9 * swell).x);
  // The echo within the anvil's reach, the strongest of four ways out: what spreads to here.
  float spread = -100.0;
  if (sheet > 0.0) {
    vec2 far = vec2(ANVIL_SPREAD_KM * sheet) / uExtentKm.xy;
    spread = max(max(sampleField(from + vec3(far.x, 0.0, 0.0)).x, sampleField(from - vec3(far.x, 0.0, 0.0)).x),
      max(sampleField(from + vec3(0.0, far.y, 0.0)).x, sampleField(from - vec3(0.0, far.y, 0.0)).x)) - 6.0;
    reach = max(reach, spread);
  }
  if (reach <= uLow - 10.0) return 0.0;

  float above = aboveBase(w);
  // Under the base it is rain, where it falls: the echo as it is, not pushed about as the cloud is.
  float rain = above < 1.0 ? rainShaft(w, field, above) : 0.0;
  if (above <= 0.0) return rain;

  float puff = puffs(w);
  lastPuff = puff;
  // Turrets: stretches a few kilometres across where the top stands higher, and lower between.
  float turret = (noise3(vec3(w.xy * 0.13, 5.0)) - 0.5) * (1.0 - sheet);
  // The field read where the puff pushes it from: tops and sides stand out where a puff is, and sink in the creases.
  vec2 pushed = sampleField(from - (puff - 0.44 + 0.9 * turret) * swell);
  float body = smoothstep(uLow - 10.0, uHigh - 2.0, max(pushed.x, spread)) * max(pushed.y, sheet);
  if (body <= 0.0) return rain;
  // Its edge eaten by the creases, and a little by finer ones; its inside left whole.
  float eaten = 0.6 * (1.0 - puff) + 0.1 * (1.0 - noise3(w * 1.7));
  // An anvil is drawn out, not heaped up: long fibres in place of puffs, and an edge that thins away.
  eaten = mix(eaten, 0.34 * (1.0 - noise3(vec3(w.x * 0.22, w.y * 0.9, 4.0))) + 0.16 * (1.0 - puff), sheet);
  // Weak echo is the thin part of a storm: a sheet of cloud, not a tower of it.
  float thick = mix(0.3, 1.0, smoothstep(uLow - 4.0, uLow + 14.0, pushed.x));
  // Thin, and flat on top, where the air above will not let it higher.
  thick = mix(thick, 0.42, sheet) * (1.0 - smoothstep(LID_KM - 0.9, LID_KM, w.z));
  // Half as thick as the map's cloud, and soft at its edge: a ray's steps
  // are a few hundred metres, and an edge that is cloud or not within one
  // of them comes out as grain.
  return max(smoothstep(0.0, 0.55, (body - eaten) / (1.0 - eaten)) * 0.5 * thick * above, rain);
}

vec3 skyLight(vec3 p, float heightKm, float towardSun) {
  vec3 sun = normalize(SUN);
  // The sun's light, through what cloud stands towards it: three samples, out to four kilometres.
  float depth = 0.0;
  float last = 0.0;
  for (int k = 0; k < 3; k += 1) {
    float at = 0.4 + 0.6 * float(k * k + k);
    depth += skyBody(p + sun * at / uExtentKm) * (at - last);
    last = at;
  }
  depth *= ${SHADOW_PER_KM};
  float direct = exp(-depth);
  // Light scattered many times goes deeper than the first bounce: a shadowed side is blue-grey, not black.
  float sunlit = 0.74 * direct + 0.26 * exp(-0.17 * depth);
  // The sky's light, from above: less under the cloud's own top, and less of it low down.
  float over = skyBody(p + vec3(0.0, 0.0, 1.3 / uExtentKm.z)) * 2.2;
  float open = exp(-0.6 * over);
  float lift = clamp((heightKm - BASE_KM) / 5.0, 0.0, 1.0);
  vec3 ambient = mix(vec3(0.33, 0.38, 0.47), SKYLIGHT, 0.3 + 0.7 * lift) * (0.28 + 0.72 * open);
  // Looking into the sun, the thin edge it shines through is the brightest thing in the sky.
  float rim = pow(max(towardSun, 0.0), 10.0) * direct;
  // A crease between two puffs is shaded by both, whichever way the sun
  // stands; and a puff has a side towards the sun and one away from it, told
  // by whether there is more of it that way: the relief of a cumulus.
  // (Told by a plain noise the size of the puffs, which is near enough and a quarter of the work of asking them again.)
  vec3 here = worldKm(p) * vec3(0.32, 0.32, 0.42);
  float away = noise3(here + sun * 0.22) - noise3(here);
  float crease = mix(0.18, 1.0, smoothstep(0.25, 0.78, lastPuff)) * clamp(1.0 - away * 3.4, 0.3, 1.15);
  vec3 colour = SUNLIGHT * sunlit * crease * (1.08 + 1.6 * rim) + ambient * (0.3 + 0.28 * crease);
  // Rain is grey whatever the sun does, and the heavier the darker.
  float under = 1.0 - smoothstep(BASE_KM - 0.3, BASE_KM + 0.4, heightKm);
  vec3 wet = mix(vec3(0.27, 0.31, 0.37), vec3(0.1, 0.12, 0.16), lastShaft);
  colour = mix(colour, wet * (0.5 + 0.5 * sunlit), under * 0.9);
  // Lightning: a light inside the cloud, where it is, for as long as it flickers.
  if (uGlow.w > 0.0) {
    vec3 from = vec3(worldKm(p).xy, heightKm) - uGlow.xyz;
    colour += vec3(0.78, 0.84, 1.0) * uGlow.w * 2.6 * exp(-dot(from, from) / 26.0);
  }
  // The air between: far clouds go the colour of the horizon.
  return mix(colour, vec3(0.66, 0.8, 1.05), 0.82 * (1.0 - exp(-rayKm / 150.0)));
}
`;
