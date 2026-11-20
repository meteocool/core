/**
 * The flight's sound, made as it plays: every sound is synthesized here
 * with the Web Audio API from noise and oscillators, none is a recording.
 * So it costs the page nothing to download, and it follows the flight
 * continuously: the engines' whine rises with the fan, the wind with the
 * speed, the bumps come as the rough air does.
 *
 * Built on any audio context, a live one or one rendering offline, so what
 * it makes can be measured as well as heard. What to set it to comes from
 * the mix (soundMix.ts) every frame; the context's own lifetime is the
 * flight's sound's (sound.ts).
 *
 * The sounds:
 * - engines: a rumble of low noise, the fan's tone at its blades' passing
 *   frequency (two engines a little apart, so they beat), the buzz of its
 *   tips at high power, and the broadband hiss of the exhaust;
 * - the airflow: noise in a band that rises with the speed, swelling and
 *   dropping as the rough air buffets it, with a low roar for the speed
 *   brake and near the limits;
 * - rough air: low thumps, a rumble under them, the creaks of the cockpit's
 *   panels (a stick-slip train of clicks rung through a resonance) and the
 *   rattles of what is loose in it;
 * - rain hissing and pattering on the windshield, and hail ticking on it;
 * - thunder: a crack that tears, and a long rumble that rolls;
 * - the cockpit's alerts and chimes, and the interface's clicks;
 * - the end of a flight: the airframe breaking up (a crack of metal, its
 *   tearing and groaning, the air rushing in) and an explosion (a boom, its
 *   blast, a long low rumble and the fire crackling after it), heard the
 *   same from every view.
 *
 * Everything goes through one limiter, then the volume, then a soft clip
 * that keeps the last of a peak under full scale.
 */
import type { SoundEvent, SoundLevels } from "./soundMix";

/** The interface's own sounds, for what the reader does. */
export type SoundCue =
  | "view" | "style" | "recordStart" | "recordStop" | "pause" | "resume" | "next" | "restart" | "help" | "unmute" | "takeoff";

/** How fast the continuous sounds follow the mix, seconds: smooth, and quick enough for a view's crossfade. */
const SMOOTH_S = 0.12;

/** Each sound's loudest, against the others: the mix's 0 to 1 is scaled by these. */
const TRIM = {
  rumble: 0.5, whine: 0.07, whineHigh: 0.018, buzz: 0.05, hiss: 0.22,
  wind: 0.55, brake: 0.55, roar: 0.5, turbulence: 0.9,
  rain: 0.22, patter: 0.32, hail: 0.5,
  thunder: 1.1, thump: 0.9, cabin: 0.8, alerts: 0.5, ui: 0.32, warp: 4, crash: 1,
};

/** How many hailstones a second at the hardest. */
const HAIL_RATE = 45;

/** How the stall's cricket repeats, seconds. */
const CRICKET_CYCLE_S = 1;

type Color = "white" | "pink" | "brown";

/** A loop of noise, its ends made to meet so it does not click where it wraps. */
function noiseBuffer(context: BaseAudioContext, seconds: number, color: Color): AudioBuffer {
  const length = Math.round(seconds * context.sampleRate);
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const data = buffer.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, brown = 0;
  for (let i = 0; i < length; i++) {
    const white = Math.random() * 2 - 1;
    if (color === "white") {
      data[i] = white;
    } else if (color === "pink") {
      // Paul Kellet's filter: -3 dB an octave, close enough over the audible range.
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.969 * b2 + white * 0.153852;
      b3 = 0.8665 * b3 + white * 0.3104856;
      b4 = 0.55 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.016898;
      data[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
      b6 = white * 0.115926;
    } else {
      brown = (brown + 0.02 * white) / 1.02;
      data[i] = brown;
    }
  }
  // The drift from one end to the other taken out, then all to one loudness.
  const drift = data[length - 1] - data[0];
  let sum = 0;
  for (let i = 0; i < length; i++) {
    data[i] -= (drift * i) / (length - 1);
    sum += data[i] * data[i];
  }
  const scale = 0.3 / Math.sqrt(sum / length);
  for (let i = 0; i < length; i++) data[i] *= scale;
  return buffer;
}

/**
 * Slow, smooth gusts, -1 to 1, for the rough air's swells: a few sines that
 * fit the loop a whole number of times, so it wraps with no seam, at
 * frequencies that never line up within it.
 */
function gustBuffer(context: BaseAudioContext, seconds: number): AudioBuffer {
  // A low rate is plenty for something this slow; 3 kHz is the lowest every browser takes.
  const rate = 3000;
  const length = Math.round(seconds * rate);
  const buffer = context.createBuffer(1, length, rate);
  const data = buffer.getChannelData(0);
  const partials = Array.from({ length: 9 }, (_, i) => ({
    cycles: Math.round((0.4 + i * 0.75 + Math.random() * 0.5) * seconds),
    phase: Math.random() * Math.PI * 2,
    amplitude: 1 / Math.sqrt(1 + i),
  }));
  let peak = 0;
  for (let i = 0; i < length; i++) {
    const x = i / length;
    let value = 0;
    for (const { cycles, phase, amplitude } of partials) value += amplitude * Math.sin(2 * Math.PI * cycles * x + phase);
    data[i] = value;
    peak = Math.max(peak, Math.abs(value));
  }
  for (let i = 0; i < length; i++) data[i] /= peak;
  return buffer;
}

/** Drops on glass: a loop of short clicks at random, of random strength. */
function patterBuffer(context: BaseAudioContext, seconds: number, perSecond: number): AudioBuffer {
  const { sampleRate } = context;
  const length = Math.round(seconds * sampleRate);
  const buffer = context.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);
  const decay = Math.exp(-1 / (0.0008 * sampleRate));
  for (let n = 0; n < seconds * perSecond; n++) {
    let at = Math.floor(Math.random() * length);
    let value = (Math.random() ** 2) * (Math.random() < 0.5 ? -1 : 1);
    for (let k = 0; k < sampleRate * 0.004; k++, at = (at + 1) % length) {
      data[at] += value * (Math.random() * 2 - 1);
      value *= decay;
    }
  }
  return buffer;
}

/** One click, rung at a frequency: a hailstone, the overspeed's clacker, a drop of the patter. */
function clickBuffer(context: BaseAudioContext, seconds: number, ring: number, decay: number, period = seconds): AudioBuffer {
  const { sampleRate } = context;
  const length = Math.round(period * sampleRate);
  const buffer = context.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < Math.min(length, seconds * sampleRate); i++) {
    const t = i / sampleRate;
    const envelope = Math.exp(-t / decay) * Math.min(1, i / 8);
    data[i] = envelope * (0.55 * Math.sin(2 * Math.PI * ring * t) + 0.45 * (Math.random() * 2 - 1));
  }
  return buffer;
}

/** The stick shaker's motor: a thud, again and again, as one loop. */
function shakerBuffer(context: BaseAudioContext, rate: number): AudioBuffer {
  const { sampleRate } = context;
  const length = Math.round(sampleRate / rate);
  const buffer = context.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    const envelope = Math.exp(-t / 0.012) * Math.min(1, i / 16);
    data[i] = envelope * (Math.sin(2 * Math.PI * 95 * t) + 0.5 * (Math.random() * 2 - 1));
  }
  return buffer;
}

/**
 * A creak: a panel's stick and slip, a train of clicks whose rate glides as
 * the load on it changes, swelling and dying away.
 */
function creakBuffer(context: BaseAudioContext): AudioBuffer {
  const { sampleRate } = context;
  const seconds = 0.25 + Math.random() * 0.55;
  const length = Math.round(seconds * sampleRate);
  const buffer = context.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);
  const from = 35 + Math.random() * 70;
  const to = from * (0.6 + Math.random() * 1.3);
  let at = 0;
  while (at < length) {
    const x = at / length;
    const envelope = Math.sin(Math.PI * x) ** 0.6 * (0.6 + 0.4 * Math.random());
    const amplitude = envelope * (0.5 + 0.5 * Math.random());
    for (let k = 0; k < 24 && at + k < length; k++) data[at + k] += amplitude * Math.exp(-k / 5) * (k % 2 === 0 ? 1 : -0.6);
    const rate = from + (to - from) * x;
    at += Math.max(8, Math.round((sampleRate / rate) * (0.8 + Math.random() * 0.4)));
  }
  return buffer;
}

/** A rattle: something loose knocking, quick and uneven. */
function rattleBuffer(context: BaseAudioContext): AudioBuffer {
  const { sampleRate } = context;
  const seconds = 0.15 + Math.random() * 0.4;
  const length = Math.round(seconds * sampleRate);
  const buffer = context.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);
  let at = 0;
  while (at < length) {
    const amplitude = (0.4 + 0.6 * Math.random()) * Math.sin(Math.PI * (at / length)) ** 0.4;
    for (let k = 0; k < sampleRate * 0.003 && at + k < length; k++) {
      data[at + k] += amplitude * Math.exp(-k / (sampleRate * 0.0006)) * (Math.random() * 2 - 1);
    }
    at += Math.round(sampleRate / (25 + Math.random() * 45));
  }
  return buffer;
}

/**
 * Metal tearing: the stick and slip of a creak, far harder and longer, each
 * slip a grain of noise; fast as it starts to go and slowing as it parts.
 */
function tearBuffer(context: BaseAudioContext, seconds: number): AudioBuffer {
  const { sampleRate } = context;
  const length = Math.round(seconds * sampleRate);
  const buffer = context.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);
  const from = 110 + Math.random() * 60;
  const to = 18 + Math.random() * 14;
  const grain = Math.round(sampleRate * 0.004);
  let at = 0;
  while (at < length) {
    const x = at / length;
    const envelope = Math.min(1, x / 0.04) * (1 - x) ** 0.7;
    const amplitude = envelope * (0.35 + 0.65 * Math.random());
    for (let k = 0; k < grain && at + k < length; k++) {
      data[at + k] += amplitude * Math.exp(-k / (grain * 0.3)) * (k < 3 ? 1 - k * 0.6 : Math.random() * 2 - 1);
    }
    const rate = from * (to / from) ** x;
    at += Math.max(8, Math.round((sampleRate / rate) * (0.55 + Math.random() * 0.9)));
  }
  return buffer;
}

/** A fire crackling: pops at random, most of them small, many at first and fewer as it burns down. */
function crackleBuffer(context: BaseAudioContext, seconds: number): AudioBuffer {
  const { sampleRate } = context;
  const length = Math.round(seconds * sampleRate);
  const buffer = context.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);
  let at = 0;
  while (at < length) {
    const x = at / length;
    const amplitude = Math.random() ** 3 * (1 - 0.6 * x);
    const decay = sampleRate * (0.0004 + 0.0025 * Math.random() * amplitude);
    for (let k = 0; k < decay * 6 && at + k < length; k++) data[at + k] += amplitude * Math.exp(-k / decay) * (Math.random() * 2 - 1);
    // Thirty-odd a second to begin with, a handful by the end.
    const rate = 34 * (1 - x) ** 1.5 + 5;
    at += Math.max(1, Math.round((-Math.log(1 - Math.random()) / rate) * sampleRate));
  }
  return buffer;
}

/** A thunder's rumble as an envelope: a few rolls, each later one weaker, over a long decay. */
function rollCurve(seconds: number, onset: number, rolls: number): Float32Array {
  const points = 256;
  const curve = new Float32Array(points);
  const bumps = Array.from({ length: rolls }, (_, i) => ({
    at: onset + Math.random() * (seconds - onset) * 0.6 + i * 0.25,
    width: 0.3 + Math.random() * 0.9,
    height: (0.5 + 0.5 * Math.random()) * 0.82 ** i,
  }));
  let peak = 0;
  for (let p = 0; p < points; p++) {
    const t = (p / (points - 1)) * seconds;
    const start = Math.min(1, Math.max(0, (t - onset) / 0.25));
    let value = 0.35 * start * Math.exp(-(t - onset) / (seconds * 0.35));
    for (const { at, width, height } of bumps) value += height * Math.exp(-(((t - at) / width) ** 2));
    curve[p] = t < onset ? 0 : value * Math.min(1, (seconds - t) / 0.6);
    peak = Math.max(peak, curve[p]);
  }
  for (let p = 0; p < points; p++) curve[p] /= peak || 1;
  curve[points - 1] = 0;
  return curve;
}

/** A soft clip: straight up to most of full scale, rounding off into it. */
function softClip(): Float32Array<ArrayBuffer> {
  const points = 2049;
  const curve = new Float32Array(points);
  for (let i = 0; i < points; i++) {
    const x = (i / (points - 1)) * 2 - 1;
    const knee = 0.8;
    const over = Math.abs(x) - knee;
    curve[i] = over <= 0 ? x : Math.sign(x) * (knee + (1 - knee) * 0.98 * Math.tanh(over / (1 - knee)));
  }
  return curve;
}

export class SoundGraph {
  private readonly context: BaseAudioContext;
  private readonly targets = new Map<AudioParam, number>();
  private readonly white: AudioBuffer;
  private readonly brown: AudioBuffer;
  private readonly hailTicks: AudioBuffer[];
  private readonly volume: GainNode;
  private readonly scene: GainNode;
  private readonly ui: GainNode;
  private readonly busses: Record<"engine" | "wind" | "thunder" | "thump" | "cabin" | "alerts" | "hail" | "crash", GainNode>;
  private readonly filters: Record<"engine" | "wind" | "thunder", BiquadFilterNode>;
  private readonly engine: {
    rumble: GainNode; rumbleFilter: BiquadFilterNode; whine: GainNode; whineFilter: BiquadFilterNode;
    fans: OscillatorNode[]; high: OscillatorNode; buzz: GainNode; buzzOsc: OscillatorNode; hiss: GainNode; hissFilter: BiquadFilterNode;
  };
  private readonly wind: { gain: GainNode; filter: BiquadFilterNode; brake: GainNode; roar: GainNode; buffet: GainNode; rumble: GainNode };
  private readonly gusts: AudioBufferSourceNode;
  private readonly rain: { hiss: GainNode; patter: GainNode; peak: BiquadFilterNode; patterFilter: BiquadFilterNode };
  private readonly warp: { gain: GainNode; filter: BiquadFilterNode; on: boolean };
  private readonly alerts: {
    overspeed: GainNode; shaker: GainNode; cricket: GainNode; cricketGate: GainNode; terrain: GainNode;
    cricketAt: number; terrainOn: boolean; terrainSources: AudioScheduledSourceNode[];
  };
  private readonly sources: AudioScheduledSourceNode[] = [];
  private hailAt = 0;
  /** Stops the gear's motor, while it runs. */
  private motor: ((at: number) => void) | null = null;

  constructor(context: BaseAudioContext, destination: AudioNode = context.destination) {
    this.context = context;
    // Into a node, or into a parameter it then moves.
    const gain = (value: number, to?: AudioNode | AudioParam) => {
      const node = context.createGain();
      node.gain.value = value;
      if (to instanceof AudioNode) node.connect(to);
      else if (to) node.connect(to);
      return node;
    };
    const filter = (type: BiquadFilterType, frequency: number, q: number, to?: AudioNode) => {
      const node = context.createBiquadFilter();
      node.type = type;
      node.frequency.value = frequency;
      node.Q.value = q;
      if (to) node.connect(to);
      return node;
    };
    const loop = (buffer: AudioBuffer, to: AudioNode, rate = 1) => {
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      source.playbackRate.value = rate;
      source.connect(to);
      source.start(0, Math.random() * buffer.duration);
      this.sources.push(source);
      return source;
    };
    const oscillator = (type: OscillatorType, frequency: number, to: AudioNode) => {
      const node = context.createOscillator();
      node.type = type;
      node.frequency.value = frequency;
      node.connect(to);
      node.start();
      this.sources.push(node);
      return node;
    };

    // The end of the chain: a limiter, the volume, a soft clip.
    const limiter = context.createDynamicsCompressor();
    limiter.threshold.value = -12;
    limiter.knee.value = 6;
    limiter.ratio.value = 16;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.25;
    this.volume = gain(0);
    const clip = context.createWaveShaper();
    clip.curve = softClip();
    limiter.connect(this.volume).connect(clip).connect(destination);
    this.scene = gain(0, limiter);
    this.ui = gain(TRIM.ui, limiter);

    this.white = noiseBuffer(context, 4.3, "white");
    const pink = noiseBuffer(context, 5.1, "pink");
    this.brown = noiseBuffer(context, 6.7, "brown");
    this.hailTicks = [2600, 3300, 4100, 5200].map((ring) => clickBuffer(context, 0.03, ring, 0.004));

    this.filters = {
      engine: filter("lowpass", 16000, 0.5, this.scene),
      wind: filter("lowpass", 9000, 0.5, this.scene),
      thunder: filter("lowpass", 9000, 0.5, this.scene),
    };
    this.busses = {
      engine: gain(1, this.filters.engine),
      wind: gain(1, this.filters.wind),
      thunder: gain(1, this.filters.thunder),
      thump: gain(TRIM.thump, this.scene),
      cabin: gain(0, this.scene),
      alerts: gain(0, this.scene),
      hail: gain(0, this.scene),
      // The end of the flight is no view's own, and is not lost in the cut to black that follows it: past the scene, as the clicks are.
      crash: gain(TRIM.crash, limiter),
    };

    // The engines.
    const engine = this.busses.engine;
    const rumble = gain(0, engine);
    const rumbleFilter = filter("lowpass", 120, 0.7, rumble);
    loop(this.brown, rumbleFilter);
    const whine = gain(0, engine);
    const whineFilter = filter("bandpass", 1500, 2.5, whine);
    // Two engines never turn quite together: their tones beat, slowly at idle.
    const fans = [oscillator("triangle", 1500, whineFilter), oscillator("triangle", 1500, whineFilter)];
    const highGain = gain(TRIM.whineHigh / TRIM.whine, whine);
    const high = oscillator("sine", 3500, highGain);
    // The fan never holds a speed exactly: its tone wanders a few cents.
    const wander = gain(7);
    loop(gustBuffer(context, 23), wander, 0.6);
    for (const fan of [...fans, high]) wander.connect(fan.detune);
    const buzz = gain(0, engine);
    const buzzOsc = oscillator("sawtooth", 70, filter("lowpass", 1400, 0.8, buzz));
    const hiss = gain(0, engine);
    const hissFilter = filter("bandpass", 1500, 0.6, hiss);
    loop(pink, hissFilter);
    this.engine = { rumble, rumbleFilter, whine, whineFilter, fans, high, buzz, buzzOsc, hiss, hissFilter };

    // The airflow, and what rough air does to it: everything in it goes through the buffet's swells.
    const buffet = gain(1, this.busses.wind);
    const depth = gain(0, buffet.gain);
    this.gusts = loop(gustBuffer(context, 17), depth);
    const windGain = gain(0, buffet);
    const windFilter = filter("bandpass", 600, 0.5, windGain);
    loop(pink, windFilter);
    const brake = gain(0, buffet);
    loop(this.brown, filter("bandpass", 170, 0.9, brake));
    const roar = gain(0, buffet);
    loop(this.white, filter("lowpass", 800, 0.6, roar));
    const turbulence = gain(0, buffet);
    loop(this.brown, filter("lowpass", 85, 0.9, turbulence), 0.8);
    this.wind = { gain: windGain, filter: windFilter, brake, roar, buffet: depth, rumble: turbulence };

    // Rain on the windshield: a hiss and a patter.
    const rainHiss = gain(0, this.scene);
    const peak = filter("peaking", 3500, 1, rainHiss);
    peak.gain.value = 6;
    loop(this.white, filter("highpass", 1800, 0.7, peak), 0.93);
    const patter = gain(0, this.scene);
    const patterFilter = filter("bandpass", 3000, 0.9, patter);
    loop(patterBuffer(context, 3.7, 700), patterFilter);
    this.rain = { hiss: rainHiss, patter, peak, patterFilter };

    // Time warp's whoosh.
    const warpGain = gain(0, this.ui);
    const warpFilter = filter("bandpass", 400, 2.2, warpGain);
    loop(this.white, warpFilter, 1.07);
    this.warp = { gain: warpGain, filter: warpFilter, on: false };

    // The alerts that sound for as long as their warning lasts.
    const alerts = this.busses.alerts;
    const overspeed = gain(0, alerts);
    loop(clickBuffer(context, 0.02, 2300, 0.005, 1 / 11), filter("bandpass", 2300, 1.5, overspeed));
    const shaker = gain(0, alerts);
    loop(shakerBuffer(context, 17), filter("lowpass", 600, 0.7, shaker));
    const cricketGate = gain(0, alerts);
    const cricket = gain(0, cricketGate);
    const chirp = gain(0.5, cricket);
    oscillator("sine", 2900, chirp);
    // Chirping: the tone switched on and off two dozen times a second.
    oscillator("square", 24, gain(0.5, chirp.gain));
    const terrain = gain(0, alerts);
    this.alerts = { overspeed, shaker, cricket, cricketGate, terrain, cricketAt: 0, terrainOn: false, terrainSources: [] };
  }

  /** Set the continuous sounds to a frame's mix; also keeps the repeating alerts and the hail going. */
  set(levels: SoundLevels, time = this.context.currentTime): void {
    const to = (param: AudioParam, value: number, tau = SMOOTH_S) => this.to(param, value, time, tau);
    to(this.volume.gain, levels.volume, 0.08);
    to(this.scene.gain, levels.world, 0.1);

    const { engine } = levels;
    to(this.filters.engine.frequency, engine.cutoff);
    to(this.engine.rumble.gain, engine.rumble * TRIM.rumble);
    to(this.engine.rumbleFilter.frequency, engine.rumbleHz);
    to(this.engine.whine.gain, engine.whine * TRIM.whine);
    to(this.engine.whineFilter.frequency, engine.whineHz);
    to(this.engine.fans[0].frequency, engine.whineHz);
    to(this.engine.fans[1].frequency, engine.whineHz * 1.0016);
    to(this.engine.high.frequency, engine.whineHz * 2.37);
    to(this.engine.buzz.gain, engine.buzz * TRIM.buzz);
    to(this.engine.buzzOsc.frequency, engine.buzzHz);
    to(this.engine.hiss.gain, engine.hiss * TRIM.hiss);
    to(this.engine.hissFilter.frequency, engine.hissHz);

    const { wind } = levels;
    to(this.filters.wind.frequency, wind.cutoff);
    to(this.wind.gain.gain, wind.gain * TRIM.wind);
    to(this.wind.filter.frequency, wind.hz);
    to(this.wind.buffet.gain, wind.buffet * 0.8, 0.3);
    to(this.gusts.playbackRate, 0.7 + 1.6 * wind.buffet, 0.5);
    to(this.wind.brake.gain, wind.brake * TRIM.brake, 0.25);
    to(this.wind.roar.gain, wind.roar * TRIM.roar, 0.3);
    to(this.wind.rumble.gain, levels.rumble * TRIM.turbulence, 0.3);

    to(this.rain.hiss.gain, levels.rain.gain * TRIM.rain, 0.25);
    to(this.rain.patter.gain, levels.rain.gain * TRIM.patter, 0.25);
    to(this.rain.peak.frequency, levels.rain.hz);
    to(this.rain.patterFilter.frequency, levels.rain.hz * 0.85);
    to(this.busses.hail.gain, levels.rain.hail > 0 ? TRIM.hail : 0, 0.2);

    to(this.busses.thunder.gain, levels.thunder.gain * TRIM.thunder);
    to(this.filters.thunder.frequency, levels.thunder.cutoff);
    to(this.busses.cabin.gain, levels.cabin * TRIM.cabin);
    to(this.busses.alerts.gain, levels.alerts.gain * TRIM.alerts, 0.05);

    this.setWarp(levels.warp > 0, time);
    this.hail(levels.rain.hail, time);
    this.repeat(levels.alerts, time);
  }

  /** The loudness of everything, 0 to 1, from `at` on. */
  setVolume(volume: number, at = this.context.currentTime, tau = 0.06): void {
    this.to(this.volume.gain, volume, at, tau);
  }

  /** Quieten the flight's sounds but not the reader's own: for a pause, whose click still sounds. */
  setWorld(level: number, at = this.context.currentTime): void {
    this.to(this.scene.gain, level, at, 0.04);
  }

  /** Start a sound of the flight's. */
  play(event: SoundEvent, time = this.context.currentTime): void {
    const t = time + 0.01;
    switch (event.kind) {
      case "thunder": this.thunder(event.distance, event.strength, t); break;
      case "thump": this.thump(event.strength, t); break;
      case "creak": this.creak(event.strength, t); break;
      case "rattle": this.rattle(event.strength, t); break;
      case "seatbelt": this.bell(t); break;
      case "low":
        this.tone("sine", 740, t, 0.16, 0.5, this.busses.alerts);
        this.tone("sine", 988, t + 0.2, 0.2, 0.5, this.busses.alerts);
        break;
      case "apOff":
        // Three falling tones, the autopilot let go.
        [1175, 932, 740].forEach((hz, i) => this.tone("triangle", hz, t + i * 0.17, 0.14, 0.6, this.busses.alerts));
        break;
      case "apOn":
        this.tone("sine", 1568, t, 0.6, 0.35, this.busses.alerts, undefined, 0.25);
        this.tone("sine", 3136, t, 0.3, 0.08, this.busses.alerts, undefined, 0.12);
        break;
      case "detent":
        this.burst(this.white, t, 0.004, 0.5, this.busses.cabin, filterOf(this.context, "bandpass", 2400, 2));
        this.tone("sine", 140, t, 0.02, 0.5, this.busses.cabin, undefined, 0.01);
        break;
      case "gearMotor": this.gearMotor(event.seconds, t); break;
      case "gearLock":
        // A heavy thud through the floor, and the clack of the lock.
        this.thump(event.strength * 0.8, t);
        this.burst(this.white, t, 0.07, 0.45 * event.strength, this.busses.cabin, filterOf(this.context, "bandpass", 1500, 1.4));
        break;
      case "whoops":
        this.whoop(t);
        this.whoop(t + 0.55);
        break;
      case "attention": this.attention(event.rank, t); break;
      case "breakup": this.breakup(event.strength, t); break;
      case "explosion": this.explosion(event.strength, t); break;
    }
  }

  /** Start one of the interface's sounds. */
  cue(kind: SoundCue, time = this.context.currentTime): void {
    const t = time + 0.005;
    const ui = this.ui;
    const blip = (hz: number, at: number, seconds: number, level = 0.6, end?: number) => this.tone("sine", hz, at, seconds, level, ui, end);
    switch (kind) {
      case "view": blip(1700, t, 0.035, 0.6, 1300); this.burst(this.white, t, 0.003, 0.25, ui); break;
      case "style": blip(1250, t, 0.05, 0.55, 1650); break;
      case "help": blip(1500, t, 0.03, 0.45); break;
      case "recordStart": blip(880, t, 0.07); blip(1320, t + 0.09, 0.09); break;
      case "recordStop": blip(1320, t, 0.07); blip(880, t + 0.09, 0.09); break;
      case "pause": blip(700, t, 0.09, 0.6, 470); break;
      case "resume": blip(470, t, 0.09, 0.6, 700); break;
      case "next": blip(450, t, 0.16, 0.45, 1500); this.whoosh(t, 0.35, 600, 2400); break;
      case "restart": blip(1300, t, 0.14, 0.45, 600); this.whoosh(t, 0.35, 2000, 500); break;
      case "unmute": blip(1000, t, 0.04, 0.5); blip(1500, t + 0.06, 0.05, 0.5); break;
      case "takeoff": this.whoosh(t, 1.4, 250, 1800, 0.9); blip(784, t + 0.35, 0.25, 0.3); blip(1175, t + 0.55, 0.4, 0.3); break;
    }
  }

  /** Stop everything and let go of the graph. */
  dispose(): void {
    for (const source of [...this.sources, ...this.alerts.terrainSources]) {
      try {
        source.stop();
      } catch {
        // Never started, or already stopped.
      }
    }
    this.volume.disconnect();
  }

  /** Ease a parameter towards a value, and only when it moves: a frame mostly changes nothing. */
  private to(param: AudioParam, value: number, at: number, tau: number): void {
    const last = this.targets.get(param);
    if (last !== undefined && Math.abs(value - last) <= 1e-4 + Math.abs(last) * 0.003) return;
    this.targets.set(param, value);
    param.cancelScheduledValues(at);
    param.setTargetAtTime(value, at, tau);
  }

  /** The time-warp whoosh: sweeping up as Shift goes down, airy while held, and down again. */
  private setWarp(on: boolean, time: number): void {
    if (on === this.warp.on) return;
    this.warp.on = on;
    const { frequency } = this.warp.filter;
    const gain = this.warp.gain.gain;
    frequency.cancelScheduledValues(time);
    gain.cancelScheduledValues(time);
    this.targets.delete(gain);
    frequency.setValueAtTime(frequency.value, time);
    if (on) {
      frequency.exponentialRampToValueAtTime(2400, time + 0.5);
      frequency.setTargetAtTime(1300, time + 0.5, 0.6);
      gain.setTargetAtTime(TRIM.warp, time, 0.06);
      gain.setTargetAtTime(TRIM.warp * 0.55, time + 0.5, 0.5);
    } else {
      frequency.exponentialRampToValueAtTime(300, time + 0.35);
      gain.setTargetAtTime(0, time, 0.1);
    }
  }

  /** Hailstones on the glass, at random, as many a second as the mix says. */
  private hail(level: number, time: number): void {
    const ahead = time + 0.12;
    if (level <= 0) {
      this.hailAt = ahead;
      return;
    }
    this.hailAt = Math.max(this.hailAt, time);
    const rate = HAIL_RATE * level;
    while (this.hailAt < ahead) {
      const source = this.context.createBufferSource();
      source.buffer = this.hailTicks[Math.floor(Math.random() * this.hailTicks.length)];
      source.playbackRate.value = 0.8 + Math.random() * 0.5;
      const gain = this.context.createGain();
      gain.gain.value = (0.25 + 0.75 * Math.random() ** 2) * (0.5 + 0.5 * level);
      const pan = this.context.createStereoPanner();
      pan.pan.value = Math.random() * 1.4 - 0.7;
      source.connect(gain).connect(pan).connect(this.busses.hail);
      source.start(this.hailAt);
      source.onended = () => source.disconnect();
      this.hailAt += -Math.log(1 - Math.random()) / rate;
    }
  }

  /** Keep the repeating alerts going, a cycle ahead, while their warnings last. */
  private repeat(alerts: SoundLevels["alerts"], time: number): void {
    const { overspeed, shaker, cricketGate, cricket } = this.alerts;
    this.to(overspeed.gain, alerts.overspeed ? 1.4 : 0, time, 0.01);
    this.to(shaker.gain, alerts.stall ? 1 : 0, time, 0.01);
    this.to(cricketGate.gain, alerts.stall ? 0.35 : 0, time, 0.01);
    if (alerts.stall) {
      if (this.alerts.cricketAt < time) this.alerts.cricketAt = time + 0.02;
      while (this.alerts.cricketAt < time + 0.15) {
        const at = this.alerts.cricketAt;
        cricket.gain.setTargetAtTime(1, at, 0.004);
        cricket.gain.setTargetAtTime(0, at + 0.45, 0.004);
        this.alerts.cricketAt += CRICKET_CYCLE_S;
      }
    } else if (this.alerts.cricketAt !== 0) {
      cricket.gain.cancelScheduledValues(time);
      cricket.gain.setTargetAtTime(0, time, 0.01);
      this.alerts.cricketAt = 0;
    }

    // The pull-up warning's whoops are started by the mix, a pair at a time; here they are let through, and cut short as it ends.
    const terrain = this.alerts.terrain;
    if (alerts.terrain) {
      this.to(terrain.gain, 1, time, 0.01);
      this.alerts.terrainOn = true;
    } else if (this.alerts.terrainOn) {
      this.to(terrain.gain, 0, time, 0.01);
      for (const source of this.alerts.terrainSources) {
        try {
          source.stop(time + 0.06);
        } catch {
          // Already stopped.
        }
      }
      this.alerts.terrainSources = [];
      this.alerts.terrainOn = false;
    }
  }

  /**
   * A tone where the cockpit would speak and the browser cannot: a tick for
   * a height or the levers, two beeps for a bank, and two of two notes for
   * a warning. The pull-up warning has its whoops.
   */
  private attention(rank: number, t: number): void {
    const alerts = this.busses.alerts;
    if (rank <= 0) {
      this.tone("sine", 1000, t, 0.06, 0.35, alerts);
    } else if (rank === 1) {
      for (const at of [t, t + 0.22]) this.tone("triangle", 1480, at, 0.13, 0.5, alerts);
    } else if (rank === 2) {
      for (const at of [t, t + 0.34]) {
        this.tone("triangle", 1320, at, 0.12, 0.5, alerts);
        this.tone("triangle", 990, at + 0.13, 0.14, 0.5, alerts);
      }
    }
  }

  /** One "whoop" of the terrain warning: a tone sweeping up. */
  private whoop(at: number): void {
    const oscillator = this.context.createOscillator();
    oscillator.type = "sawtooth";
    oscillator.frequency.setValueAtTime(330, at);
    oscillator.frequency.exponentialRampToValueAtTime(1250, at + 0.42);
    const gain = this.context.createGain();
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(0.45, at + 0.03);
    gain.gain.setValueAtTime(0.45, at + 0.38);
    gain.gain.linearRampToValueAtTime(0, at + 0.45);
    oscillator.connect(filterOf(this.context, "lowpass", 2600, 0.7)).connect(gain).connect(this.alerts.terrain);
    oscillator.start(at);
    oscillator.stop(at + 0.47);
    const sources = this.alerts.terrainSources;
    sources.push(oscillator);
    oscillator.onended = () => {
      oscillator.disconnect();
      const index = sources.indexOf(oscillator);
      if (index >= 0) sources.splice(index, 1);
    };
  }

  /**
   * Thunder: near, a crack that tears for a moment before the rumble; far,
   * the rumble alone, later, lower and softer. The rumble rolls in a few
   * swells and drifts across.
   */
  private thunder(distance: number, strength: number, t: number): void {
    const context = this.context;
    const bus = this.busses.thunder;
    const near = distance < 0.35;
    if (near) {
      const crack = context.createGain();
      crack.gain.setValueAtTime(0, t);
      crack.gain.linearRampToValueAtTime(0.9 * strength, t + 0.003);
      crack.gain.setTargetAtTime(0, t + 0.01, 0.05);
      // The tearing: a few more cracks in its first quarter second.
      for (let i = 0, at = t + 0.03; i < 6; i++, at += 0.02 + Math.random() * 0.05) {
        crack.gain.setTargetAtTime((0.3 + 0.5 * Math.random()) * strength, at, 0.002);
        crack.gain.setTargetAtTime(0, at + 0.008, 0.03);
      }
      this.burst(this.white, t, 0.8, 1, bus, filterOf(context, "highpass", 600, 0.7), crack);
    }
    const seconds = 5 + 6 * distance + Math.random() * 2;
    const onset = near ? 0.05 : 0.3 + distance * 1.2;
    const rumble = context.createGain();
    rumble.gain.value = 0;
    rumble.gain.setValueCurveAtTime(rollCurve(seconds, onset, 3 + Math.floor(Math.random() * 4)), t, seconds);
    const level = context.createGain();
    level.gain.value = strength * (1 - 0.75 * distance) * 1.6;
    const lowpass = filterOf(context, "lowpass", 140 + 500 * (1 - distance), 0.7);
    lowpass.frequency.setTargetAtTime(70 + 80 * (1 - distance), t + onset + 0.5, seconds * 0.3);
    const pan = context.createStereoPanner();
    const side = Math.random() * 1.2 - 0.6;
    pan.pan.setValueAtTime(side, t);
    pan.pan.linearRampToValueAtTime(-side * 0.5, t + seconds);
    const source = context.createBufferSource();
    source.buffer = this.brown;
    source.connect(lowpass).connect(rumble).connect(level).connect(pan).connect(bus);
    // A little of the rumble's crackle, higher, to say it is a storm and not a lorry.
    const grit = context.createGain();
    grit.gain.value = 0.25 * (1 - distance);
    const gritSource = context.createBufferSource();
    gritSource.buffer = this.white;
    gritSource.connect(filterOf(context, "bandpass", 450, 0.8)).connect(grit).connect(rumble);
    for (const one of [source, gritSource]) {
      one.loop = true;
      one.start(t, Math.random() * 3);
      one.stop(t + seconds);
      one.onended = () => one.disconnect();
    }
  }

  /** A bump of rough air: a low thud and a dull knock under it. */
  private thump(strength: number, t: number, to: AudioNode = this.busses.thump): void {
    const context = this.context;
    const oscillator = context.createOscillator();
    const from = 48 + Math.random() * 24;
    oscillator.frequency.setValueAtTime(from, t);
    oscillator.frequency.exponentialRampToValueAtTime(from * 0.55, t + 0.3);
    const gain = context.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(strength, t + 0.008);
    gain.gain.setTargetAtTime(0, t + 0.03, 0.09);
    oscillator.connect(gain).connect(to);
    oscillator.start(t);
    oscillator.stop(t + 0.7);
    oscillator.onended = () => oscillator.disconnect();
    const knock = context.createGain();
    knock.gain.setValueAtTime(0, t);
    knock.gain.linearRampToValueAtTime(strength * 0.9, t + 0.005);
    knock.gain.setTargetAtTime(0, t + 0.015, 0.06);
    this.burst(this.brown, t, 0.5, 1, to, filterOf(context, "lowpass", 260 + Math.random() * 120, 0.8), knock);
  }

  /** A gain that jumps up at `t` and dies away: the shape of something struck. */
  private struck(t: number, level: number, attack: number, decay: number): GainNode {
    const gain = this.context.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(level, t + attack);
    gain.gain.setTargetAtTime(0, t + attack, decay);
    return gain;
  }

  /**
   * The airframe giving way, over half a second to a second and a half by
   * how much of it goes: the crack of metal failing, with the ring of the
   * skin and a thud through the structure; the tearing, a groan low in the
   * frame under a ripping edge, slowing as the piece parts; and the air
   * rushing through where it was. To one side, as a wing is.
   */
  private breakup(strength: number, t: number): void {
    const context = this.context;
    const amount = Math.min(Math.max(strength, 0), 1);
    const level = 0.45 + 0.55 * amount;
    const seconds = 0.5 + amount;
    const pan = context.createStereoPanner();
    pan.pan.value = (Math.random() < 0.5 ? -1 : 1) * (0.25 + 0.4 * Math.random());
    pan.connect(this.busses.crash);

    // The crack: a snap of noise, and the skin ringing at a few pitches that are no chord.
    this.burst(this.white, t, 0.12, 1, pan, filterOf(context, "highpass", 1800, 0.7), this.struck(t, 1.5 * level, 0.001, 0.022));
    const ring = 700 + Math.random() * 500;
    for (const [ratio, gain, decay] of [[1, 1, 0.16], [2.32, 0.7, 0.11], [3.87, 0.5, 0.08], [5.9, 0.3, 0.05]]) {
      const partial = filterOf(context, "bandpass", ring * ratio, 28);
      this.burst(this.white, t, decay * 6, 1, pan, partial, this.struck(t, 9 * gain * level, 0.001, decay));
    }
    this.thump(1.1 * level, t, pan);

    // The tearing, from a moment after: the groan, and the rip over it.
    const tear = context.createBufferSource();
    tear.buffer = tearBuffer(context, seconds);
    const low = 190 + Math.random() * 120;
    const groan = context.createGain();
    groan.gain.value = 7 * level;
    for (const [hz, q] of [[low, 7], [low * 2.6, 9], [low * 4.3, 10]]) {
      const body = filterOf(context, "bandpass", hz, q);
      body.frequency.setValueAtTime(hz, t + 0.04);
      body.frequency.exponentialRampToValueAtTime(hz * 0.6, t + 0.04 + seconds);
      tear.connect(body).connect(groan);
    }
    const rip = context.createGain();
    rip.gain.value = 0.9 * level;
    tear.connect(filterOf(context, "highpass", 2200, 0.7)).connect(rip);
    groan.connect(pan);
    rip.connect(pan);
    tear.start(t + 0.04);
    tear.onended = () => tear.disconnect();

    // The air: in with a rush as it opens, and falling away.
    const air = filterOf(context, "bandpass", 500, 0.8);
    air.frequency.setValueAtTime(500, t + 0.05);
    air.frequency.exponentialRampToValueAtTime(1900, t + 0.05 + seconds * 0.35);
    air.frequency.exponentialRampToValueAtTime(900, t + 0.05 + seconds + 0.6);
    const rush = context.createGain();
    rush.gain.setValueAtTime(0, t + 0.05);
    rush.gain.linearRampToValueAtTime(0.8 * level, t + 0.05 + seconds * 0.3);
    rush.gain.setTargetAtTime(0, t + 0.05 + seconds * 0.5, 0.15 + seconds * 0.22);
    this.burst(this.white, t + 0.05, seconds + 1.2, 1, pan, air, rush);
  }

  /**
   * An explosion, larger and longer with `strength`: a boom falling away
   * below hearing, the blast's burst of noise closing down over it, a low
   * rumble that rolls on for seconds, what was thrown up coming down, and
   * the fire crackling as it dies back.
   */
  private explosion(strength: number, t: number): void {
    const context = this.context;
    const amount = Math.min(Math.max(strength, 0), 1);
    const level = 0.5 + 0.5 * amount;
    const bus = this.busses.crash;

    // The boom: two low tones dropping, the lower one the longer.
    for (const [from, to, gain, decay] of [[82, 30, 1.2, 0.28], [47, 21, 1.1, 0.55]]) {
      const oscillator = context.createOscillator();
      oscillator.frequency.setValueAtTime(from, t);
      oscillator.frequency.exponentialRampToValueAtTime(to, t + decay * 2.5);
      oscillator.connect(this.struck(t, gain * level, 0.006, decay * (0.7 + 0.3 * amount))).connect(bus);
      oscillator.start(t);
      oscillator.stop(t + decay * 8);
      oscillator.onended = () => oscillator.disconnect();
    }

    // The blast: all of the noise at once, closing down to a roar.
    const blast = filterOf(context, "lowpass", 7000, 0.6);
    blast.frequency.setValueAtTime(7000, t);
    blast.frequency.exponentialRampToValueAtTime(350, t + 0.7);
    this.burst(this.white, t, 1.6, 1, bus, blast, this.struck(t, 2.2 * level, 0.002, 0.16 + 0.12 * amount));

    // The rumble after it, rolling as it goes; a little to one side and drifting back.
    const seconds = 2.5 + 3 * amount;
    const roll = new Float32Array(160);
    const swells = 0.7 + Math.random() * 0.8;
    const phase = Math.random() * Math.PI * 2;
    for (let p = 1; p < roll.length - 1; p++) {
      const at = (p / (roll.length - 1)) * seconds;
      roll[p] = Math.exp(-at / (seconds * 0.35)) * (1 + 0.3 * Math.sin(2 * Math.PI * swells * at + phase)) * Math.min(1, (seconds - at) / 0.5);
    }
    const rumble = context.createGain();
    rumble.gain.value = 0;
    rumble.gain.setValueCurveAtTime(roll, t, seconds);
    const lowpass = filterOf(context, "lowpass", 420, 0.7);
    lowpass.frequency.setTargetAtTime(90, t + 0.3, seconds * 0.25);
    const rumbleLevel = context.createGain();
    rumbleLevel.gain.value = 3 * level;
    const pan = context.createStereoPanner();
    const side = Math.random() * 0.8 - 0.4;
    pan.pan.setValueAtTime(side, t);
    pan.pan.linearRampToValueAtTime(0, t + seconds);
    const source = context.createBufferSource();
    source.buffer = this.brown;
    source.loop = true;
    source.connect(lowpass).connect(rumble).connect(rumbleLevel).connect(pan).connect(bus);
    source.start(t, Math.random() * 3);
    source.stop(t + seconds);
    source.onended = () => source.disconnect();

    // What it threw up, landing.
    for (let i = 0, at = t + 0.25; i < 2 + Math.round(4 * amount); i++, at += 0.08 + Math.random() * 0.35) {
      this.thump((0.3 + 0.5 * Math.random()) * level, at, bus);
    }

    // The fire: its crackle and the low flutter of the flames, dying back over a few seconds.
    const burning = 3 + 3 * amount;
    const fire = context.createGain();
    fire.gain.setValueAtTime(0, t + 0.15);
    fire.gain.linearRampToValueAtTime(level, t + 0.5);
    fire.gain.setTargetAtTime(0, t + 0.8, burning * 0.25);
    fire.connect(bus);
    const crackle = context.createBufferSource();
    crackle.buffer = crackleBuffer(context, burning);
    const pops = context.createGain();
    pops.gain.value = 1.6;
    crackle.connect(filterOf(context, "highpass", 900, 0.7)).connect(pops).connect(fire);
    crackle.start(t + 0.15);
    const flames = context.createBufferSource();
    flames.buffer = this.brown;
    flames.loop = true;
    const flutter = context.createGain();
    flutter.gain.value = 1.2;
    flames.connect(filterOf(context, "bandpass", 260, 0.6)).connect(flutter).connect(fire);
    flames.start(t + 0.15, Math.random() * 3);
    flames.stop(t + 0.15 + burning);
    crackle.onended = () => crackle.disconnect();
    flames.onended = () => flames.disconnect();
  }

  /** A creak of the cockpit's panels, somewhere around the reader. */
  private creak(strength: number, t: number): void {
    const context = this.context;
    const source = context.createBufferSource();
    source.buffer = creakBuffer(context);
    const ring = 500 + Math.random() * 1200;
    const body = filterOf(context, "bandpass", ring, 5);
    const overtone = filterOf(context, "bandpass", ring * 2.3, 8);
    const gain = context.createGain();
    gain.gain.value = strength * 6.5;
    const pan = context.createStereoPanner();
    pan.pan.value = Math.random() * 1.6 - 0.8;
    source.connect(body).connect(gain);
    source.connect(overtone).connect(gain);
    gain.connect(pan).connect(this.busses.cabin);
    source.start(t);
    source.onended = () => source.disconnect();
  }

  /** Something loose rattling. */
  private rattle(strength: number, t: number): void {
    const context = this.context;
    const source = context.createBufferSource();
    source.buffer = rattleBuffer(context);
    const gain = context.createGain();
    gain.gain.value = strength * 0.7;
    const pan = context.createStereoPanner();
    pan.pan.value = Math.random() * 1.6 - 0.8;
    const ring = filterOf(context, "peaking", 3000 + Math.random() * 2000, 2);
    ring.gain.value = 8;
    source.connect(filterOf(context, "highpass", 1500, 0.7)).connect(ring).connect(gain).connect(pan).connect(this.busses.cabin);
    source.start(t);
    source.onended = () => source.disconnect();
  }

  /**
   * The gear's hydraulics for `seconds`: a whine that strains a little as
   * it works, over a low rumble; heard in the cockpit. One already running
   * (the gear sent back on its way) gives way to it.
   */
  private gearMotor(seconds: number, t: number): void {
    const context = this.context;
    this.motor?.(t);
    const length = Math.max(seconds, 0.8);
    const gain = context.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.35, t + 0.3);
    gain.gain.setValueAtTime(0.35, t + length - 0.4);
    gain.gain.linearRampToValueAtTime(0, t + length);
    const whine = context.createOscillator();
    whine.type = "sawtooth";
    whine.frequency.setValueAtTime(240, t);
    whine.frequency.linearRampToValueAtTime(300, t + length);
    whine.connect(filterOf(context, "bandpass", 760, 2.5)).connect(gain);
    const rumble = context.createBufferSource();
    rumble.buffer = this.brown;
    rumble.loop = true;
    rumble.connect(filterOf(context, "lowpass", 170, 0.7)).connect(gain);
    gain.connect(this.busses.cabin);
    whine.start(t);
    rumble.start(t, Math.random() * (this.brown.duration - 1));
    const stop = (at: number) => {
      for (const source of [whine, rumble]) {
        try {
          source.stop(at);
        } catch {
          // Already stopped.
        }
      }
    };
    stop(t + length + 0.05);
    whine.onended = () => {
      whine.disconnect();
      gain.disconnect();
    };
    rumble.onended = () => rumble.disconnect();
    this.motor = (at) => {
      gain.gain.cancelScheduledValues(at);
      gain.gain.setTargetAtTime(0, at, 0.05);
      stop(at + 0.3);
    };
  }

  /** The seat-belt sign's chime: one soft bell. */
  private bell(t: number): void {
    const partials: Array<[number, number, number]> = [[1, 1, 0.9], [2, 0.2, 0.5], [2.76, 0.25, 0.4], [4.07, 0.07, 0.25]];
    for (const [ratio, level, decay] of partials) {
      this.tone("sine", 1050 * ratio, t, decay * 4, level * 0.5, this.busses.cabin, undefined, decay);
    }
  }

  /**
   * A tone: up in a few milliseconds, held, and off without a click; with
   * `decay`, it rings away from its start instead. `end` glides the pitch.
   */
  private tone(
    type: OscillatorType, hz: number, t: number, seconds: number, level: number, to: AudioNode, end?: number, decay?: number,
  ): void {
    const oscillator = this.context.createOscillator();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(hz, t);
    if (end !== undefined) oscillator.frequency.exponentialRampToValueAtTime(end, t + seconds);
    const gain = this.context.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(level, t + 0.004);
    let stop: number;
    if (decay !== undefined) {
      gain.gain.setTargetAtTime(0, t + 0.004, decay);
      stop = t + Math.max(seconds, decay * 7);
    } else {
      gain.gain.setValueAtTime(level, t + Math.max(0.005, seconds - 0.012));
      gain.gain.linearRampToValueAtTime(0, t + seconds);
      stop = t + seconds + 0.01;
    }
    oscillator.connect(gain).connect(to);
    oscillator.start(t);
    oscillator.stop(stop);
    oscillator.onended = () => oscillator.disconnect();
  }

  /** A burst of noise through a filter, shaped by `envelope` (or a quick click's own). */
  private burst(buffer: AudioBuffer, t: number, seconds: number, level: number, to: AudioNode, through?: AudioNode, envelope?: GainNode): void {
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    let gain = envelope;
    if (!gain) {
      gain = this.context.createGain();
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(level, t + 0.0015);
      gain.gain.setTargetAtTime(0, t + 0.002, seconds / 3);
    }
    if (through) source.connect(through).connect(gain);
    else source.connect(gain);
    gain.connect(to);
    // The noise is a loop with no seam: a long burst that starts late in it goes round.
    source.loop = true;
    source.start(t, Math.random() * (buffer.duration - 1));
    source.stop(t + seconds + 0.05);
    source.onended = () => source.disconnect();
  }

  /** Air rushing past, sweeping from one pitch to another. */
  private whoosh(t: number, seconds: number, from: number, to: number, level = 0.6): void {
    const filter = filterOf(this.context, "bandpass", from, 1.8);
    filter.frequency.setValueAtTime(from, t);
    filter.frequency.exponentialRampToValueAtTime(to, t + seconds);
    const gain = this.context.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(level, t + seconds * 0.4);
    gain.gain.linearRampToValueAtTime(0, t + seconds);
    this.burst(this.white, t, seconds, 1, this.ui, filter, gain);
  }
}

function filterOf(context: BaseAudioContext, type: BiquadFilterType, frequency: number, q: number): BiquadFilterNode {
  const node = context.createBiquadFilter();
  node.type = type;
  node.frequency.value = frequency;
  node.Q.value = q;
  return node;
}
