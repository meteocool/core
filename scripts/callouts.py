"""Render the cockpit's callouts into public/audio/callout-*.mp3.

From the repository root, with uv and ffmpeg (with libmp3lame):

    uv run --no-project --with kokoro-onnx==0.6.1 --with faster-whisper==1.2.1 \\
      python -I scripts/callouts.py [words ...]

Named callouts ("Sink rate") are rendered alone; none named, all of them.

The words are those of src/lib/studio/flight/calloutClips.ts, each file
named by its `calloutFile`. The voice is Kokoro-82M's "am_fenrir", a US
male voice; the model is Apache-2.0, and its notice, with the CC BY audio
it was trained on, is scripts/licences/callouts.txt. Another voice or
model needs its own notice there, then `npm run licences`.

Kokoro says the same text the same way every time, so each callout is
rendered a few ways (a respelling where one helps, a full stop or an
exclamation, a little quicker or slower), in the order they are preferred, and each is transcribed by
Whisper: the first that says the words and nothing else is kept. It is
then trimmed, its lowest and highest frequencies taken off as a cockpit
speaker would, lightly compressed and peaked at -1 dBFS. The model files
and the takes are kept in the ignored .cache/voice.
"""

import hashlib
import re
import subprocess
import sys
import urllib.request
import wave
from pathlib import Path

import numpy as np
from faster_whisper import WhisperModel
from kokoro_onnx import Kokoro

VOICE = "am_fenrir"
LANG = "en-us"
MODEL_URL = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0"
MODEL_FILES = {
    "kokoro-v1.0.onnx": "7d5df8ecf7d4b1878015a32686053fd0eebe2bc377234608764cc0ef3636a6c5",
    "voices-v1.0.bin": "bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d",
}
# Each callout's words, and how Kokoro is given them, preferred first: in this voice "sink rate" is
# heard as "think great" unless the words run together, as the real callout says them.
CALLOUTS = {
    "Five hundred": ["Five hundred"], "One hundred": ["One hundred"], "Fifty": ["Fifty"], "Thirty": ["Thirty"],
    "Twenty": ["Twenty"], "Ten": ["Ten"], "Retard, retard": ["Retard, retard"],
    "Bank angle, bank angle": ["Bank angle, bank angle"], "Too low, gear": ["Too low, gear"],
    "Sink rate": ["Sink rate", "Sink-rate"], "Pull up, pull up": ["Pull up, pull up"],
}
# The ways each is said, preferred first: a little quicker than the voice reads, as a callout is said.
WAYS = [("{}.", 1.1), ("{}!", 1.1), ("{}.", 1.0), ("{}!", 1.0), ("{}.", 1.2), ("{}!", 1.2)]
# What Whisper may write for words said right: digits, and homophones.
SAME = {"500": "five hundred", "100": "one hundred", "50": "fifty", "30": "thirty", "20": "twenty", "10": "ten",
        "sync": "sink", "to": "too", "sinkrate": "sink rate"}
SHAPE = ",".join([
    "silenceremove=start_periods=1:start_threshold=-55dB",
    "areverse", "silenceremove=start_periods=1:start_threshold=-55dB", "areverse",
    "highpass=f=150", "lowpass=f=7000", "acompressor=threshold=-20dB:ratio=2.5:attack=5:release=80",
])

root = Path(__file__).resolve().parent.parent
cache = root / ".cache/voice"
out = root / "public/audio"


def words_of(text: str) -> str:
    text = re.sub(r"[^a-z0-9 ]", " ", text.lower().replace("-", " "))
    return " ".join(SAME.get(word, word) for word in text.split())


def slug(words: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", words.lower()).strip("-")


def fetch(name: str, sha256: str) -> Path:
    path = cache / name
    if not path.exists():
        urllib.request.urlretrieve(f"{MODEL_URL}/{name}", path)
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    if digest != sha256:
        sys.exit(f"{name} is not the file this script was made for: {digest}")
    return path


def heard(whisper: WhisperModel, audio: np.ndarray, rate: int) -> str:
    """What Whisper hears in a take."""
    pcm16 = np.interp(np.arange(0, len(audio) / rate, 1 / 16000), np.arange(len(audio)) / rate, audio).astype(np.float32)
    segments, _ = whisper.transcribe(pcm16, language="en", beam_size=5)
    return " ".join(segment.text.strip() for segment in segments)


def peak(path: Path) -> float:
    run = subprocess.run(["ffmpeg", "-nostdin", "-hide_banner", "-nostats", "-i", str(path), "-af", f"{SHAPE},volumedetect",
                          "-f", "null", "-"], capture_output=True, text=True, check=True)
    return float(re.search(r"max_volume: (-?[0-9.]+) dB", run.stderr).group(1))


def main() -> None:
    takes = cache / "takes"
    takes.mkdir(parents=True, exist_ok=True)
    kokoro = Kokoro(str(fetch("kokoro-v1.0.onnx", MODEL_FILES["kokoro-v1.0.onnx"])),
                    str(fetch("voices-v1.0.bin", MODEL_FILES["voices-v1.0.bin"])))
    whisper = WhisperModel("small.en", compute_type="int8")
    failed = []
    only = set(sys.argv[1:])
    for words, spellings in CALLOUTS.items():
        if only and words not in only:
            continue
        kept = None
        for text, speed in ((form.format(spelling), speed) for spelling in spellings for form, speed in WAYS):
            # Kokoro's own trim is left off: it cuts into a quiet first consonant, the s of "sink".
            audio, rate = kokoro.create(text, voice=VOICE, speed=speed, lang=LANG, trim=False)
            audio = np.asarray(audio, dtype=np.float32)
            said = heard(whisper, audio, rate)
            print(f"  {text!r} at {speed}: heard {said!r}", file=sys.stderr)
            if words_of(said) == words_of(words):
                kept = (audio, rate, text, speed)
                break
        if kept is None:
            failed.append(words)
            print(f"{words}: no way of saying it was heard right", file=sys.stderr)
            continue
        audio, rate, text, speed = kept
        take = takes / f"{slug(words)}.wav"
        with wave.open(str(take), "wb") as file:
            file.setnchannels(1)
            file.setsampwidth(2)
            file.setframerate(rate)
            file.writeframes((np.clip(audio, -1, 1) * 32767).astype(np.int16).tobytes())
        gain = -1 - peak(take)
        target = out / f"callout-{slug(words)}.mp3"
        subprocess.run(["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i", str(take), "-af",
                        f"{SHAPE},volume={gain:.2f}dB,afade=t=in:d=0.005,areverse,afade=t=in:d=0.015,areverse,apad=pad_dur=0.04",
                        "-ac", "1", "-ar", "44100", "-c:a", "libmp3lame", "-b:a", "96k", str(target)], check=True)
        print(f"{target.name:36} {words!r}: said as {text!r} at {speed}, {gain:+.1f} dB")
    if failed:
        sys.exit(f"not heard right: {failed}")


if __name__ == "__main__":
    main()
