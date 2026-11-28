/**
 * The cockpit's voice as recordings: every callout the mix can give
 * (soundMix.ts) is a short file, decoded once at the flight's start and
 * played through the flight's graph like any other sound.
 *
 * Not the browser's own voice: on iOS, speaking takes the page's audio
 * away from Web Audio, and after a callout the flight's sound could stay
 * silent until the next one was spoken. Through the graph, the voice sits
 * in the same mix as the rest, a recording carries the words, and the
 * first callout comes as quickly as the last.
 *
 * The files are rendered by scripts/callouts.py, which lists the same
 * words; a test checks that each one the mix can say has its file.
 */

const AUDIO = `${import.meta.env?.BASE_URL ?? "/"}audio/`;

/** Every callout's words, as the mix gives them. */
export const CALLOUT_WORDS = [
  "Five hundred", "One hundred", "Fifty", "Thirty", "Twenty", "Ten",
  "Retard, retard", "Bank angle, bank angle", "Too low, gear", "Sink rate", "Pull up, pull up",
] as const;

/** The file a callout's words are in: "Bank angle, bank angle" is callout-bank-angle-bank-angle.mp3. */
export function calloutFile(words: string): string {
  return `callout-${words.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}.mp3`;
}

/** The callouts' recordings, each decoded as it arrives; a callout whose file is not there yet, or failed, has none. */
export class CalloutClips {
  private readonly buffers = new Map<string, AudioBuffer>();
  private disposed = false;

  constructor(context: BaseAudioContext) {
    for (const words of CALLOUT_WORDS) {
      void fetch(`${AUDIO}${calloutFile(words)}`)
        .then((response) => {
          if (!response.ok) throw new Error(`${response.status}`);
          return response.arrayBuffer();
        })
        .then((bytes) => context.decodeAudioData(bytes))
        .then((buffer) => {
          if (!this.disposed) this.buffers.set(words, buffer);
        })
        .catch((error: unknown) => {
          if (!this.disposed) console.warn("A callout recording did not load", words, error);
        });
    }
  }

  /** The recording of these words, where it has arrived. */
  get(words: string): AudioBuffer | null {
    return this.buffers.get(words) ?? null;
  }

  dispose(): void {
    this.disposed = true;
    this.buffers.clear();
  }
}
