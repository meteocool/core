"""Render the cockpit's callouts into public/audio/callout-*.mp3.

From the repository root, with uv and ffmpeg (with libmp3lame):

    uv run --no-project --with piper-tts==1.8.0 --with faster-whisper==1.2.1 \\
      python -I scripts/callouts.py

The words are those of src/lib/studio/flight/calloutClips.ts, each file
named by its `calloutFile`. The voice is Piper's en_US "bryce" (medium),
which its author recorded and dedicated to the public domain; its notice is
scripts/licences/callouts.txt. A voice under another licence needs its
notice there instead (CC BY 4.0 owes the attribution), then
`npm run licences`.

Piper's takes are random, and on a single short word it often runs on into
babble. So each callout is rendered several ways (a full stop or an
exclamation, three settings of its noise, a respelling where one helps),
each take is transcribed by Whisper, and the shortest that says the words
and nothing else is kept: babble is heard as more words, and makes a take
longer besides. It is then trimmed, band-limited like a
cockpit speaker, lightly compressed and peaked at -1 dBFS. The model files
and the takes are kept in the ignored .cache/voice. Reruns give different
takes: listen to what changed before committing it.
"""

import re
import subprocess
import sys
import urllib.request
import wave
from pathlib import Path

import numpy as np
from faster_whisper import WhisperModel
from piper import PiperVoice, SynthesisConfig

VOICE = "en_US-bryce-medium"
MODEL_URL = "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/bryce/medium"
# A little quicker than the voice reads, as a callout is said.
LENGTH_SCALE = 0.85
# Each callout's words, and the spellings Piper is given for them.
CALLOUTS = {
    "Five hundred": ["Five hundred"],
    "One hundred": ["One hundred"],
    "Fifty": ["Fifty", "Fiftee"],
    "Thirty": ["Thirty", "Thirtee"],
    "Twenty": ["Twenty"],
    "Ten": ["Ten", "Tenn"],
    "Retard, retard": ["Retard, retard"],
    "Bank angle, bank angle": ["Bank angle, bank angle"],
    "Too low, gear": ["Too low, gear"],
    "Sink rate": ["Sink rate"],
    "Pull up, pull up": ["Pull up, pull up"],
}
FORMS = ["{}.", "{}!"]
# Piper's noise_scale and noise_w_scale: its default, and two calmer.
NOISE = [(0.667, 0.8), (0.4, 0.3), (0.2, 0.1)]
# What Whisper may write for words said right: digits, and a homophone.
SAME = {"500": "five hundred", "100": "one hundred", "50": "fifty", "30": "thirty", "20": "twenty", "10": "ten", "sync": "sink"}
SHAPE = ",".join([
    "silenceremove=start_periods=1:start_threshold=-50dB",
    "areverse", "silenceremove=start_periods=1:start_threshold=-50dB", "areverse",
    "highpass=f=280", "lowpass=f=4800", "acompressor=threshold=-20dB:ratio=3:attack=4:release=60",
])

root = Path(__file__).resolve().parent.parent
cache = root / ".cache/voice"
out = root / "public/audio"


def words_of(text: str) -> str:
    text = re.sub(r"[^a-z0-9 ]", " ", text.lower().replace("-", " "))
    return " ".join(SAME.get(word, word) for word in text.split())


def slug(words: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", words.lower()).strip("-")


def heard(whisper: WhisperModel, path: Path) -> tuple[str, float]:
    """What Whisper hears in a take, and when its sound ends (before the silence Piper adds), seconds."""
    with wave.open(str(path)) as f:
        rate = f.getframerate()
        pcm = np.frombuffer(f.readframes(f.getnframes()), dtype=np.int16).astype(np.float32) / 32768
    duration = len(pcm) / rate
    loud = np.flatnonzero(np.abs(pcm) > 10 ** (-40 / 20))
    sounding = (loud[-1] + 1) / rate if loud.size else 0.0
    pcm16 = np.interp(np.arange(0, duration, 1 / 16000), np.arange(len(pcm)) / rate, pcm).astype(np.float32)
    segments, _ = whisper.transcribe(pcm16, language="en", beam_size=5)
    return " ".join(segment.text.strip() for segment in segments), sounding


def peak(path: Path) -> float:
    run = subprocess.run(["ffmpeg", "-nostdin", "-hide_banner", "-nostats", "-i", str(path), "-af", f"{SHAPE},volumedetect",
                          "-f", "null", "-"], capture_output=True, text=True, check=True)
    return float(re.search(r"max_volume: (-?[0-9.]+) dB", run.stderr).group(1))


def main() -> None:
    takes = cache / "takes"
    takes.mkdir(parents=True, exist_ok=True)
    for name in (f"{VOICE}.onnx", f"{VOICE}.onnx.json"):
        if not (cache / name).exists():
            urllib.request.urlretrieve(f"{MODEL_URL}/{name}", cache / name)
    voice = PiperVoice.load(str(cache / f"{VOICE}.onnx"))
    whisper = WhisperModel("small.en", compute_type="int8")
    failed = []
    for words, spellings in CALLOUTS.items():
        clean = []
        for s, spelling in enumerate(spellings):
            for f, form in enumerate(FORMS):
                for n, (noise, width) in enumerate(NOISE):
                    take = takes / f"{slug(words)}-{s}{f}{n}.wav"
                    with wave.open(str(take), "wb") as file:
                        voice.synthesize_wav(form.format(spelling), file, syn_config=SynthesisConfig(
                            length_scale=LENGTH_SCALE, noise_scale=noise, noise_w_scale=width))
                    said, sounding = heard(whisper, take)
                    print(f"  {take.name}: {said!r}, {sounding:.2f} s", file=sys.stderr)
                    if words_of(said) == words_of(words):
                        clean.append((sounding, take))
        if not clean:
            failed.append(words)
            print(f"{words}: no clean take", file=sys.stderr)
            continue
        sounding, take = min(clean)
        gain = -1 - peak(take)
        target = out / f"callout-{slug(words)}.mp3"
        subprocess.run(["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i", str(take), "-af",
                        f"{SHAPE},volume={gain:.2f}dB,afade=t=in:d=0.005,areverse,afade=t=in:d=0.015,areverse,apad=pad_dur=0.04",
                        "-ac", "1", "-ar", "44100", "-c:a", "libmp3lame", "-b:a", "64k", str(target)], check=True)
        print(f"{target.name:36} {words!r}: {len(clean)} clean, kept {take.name} ({sounding:.2f} s, {gain:+.1f} dB)")
    if failed:
        sys.exit(f"no clean take of {failed}: run again")


if __name__ == "__main__":
    main()
