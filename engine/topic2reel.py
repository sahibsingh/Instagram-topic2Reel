#!/usr/bin/env python3
"""topic2reel: JSON spec -> 9:16 reel (animated scenes + optional Hindi voiceover + music).

Standalone: depends on nothing outside this folder.  Typical use:

    python3 topic2reel.py examples/fitness.json -o out/fitness.mp4 --voice piper --piper-model /path/hi_IN-pratham-medium.onnx
    python3 topic2reel.py spec.json --validate          # check a spec only
    python3 topic2reel.py spec.json --preview out/prev  # fast still frames, no voice, no video

Library use:  from topic2reel import generate;  generate("spec.json", "out.mp4", voice="none")
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
import wave
from pathlib import Path

HERE = Path(__file__).resolve().parent
LEAD_IN, TAIL, MIN_SCENE, DEFAULT_SCENE = 0.55, 0.6, 3.6, 4.4
SCENE_TYPES = {"hook", "cards", "myth_fact", "stat", "steps", "compare", "cta"}
DEVANAGARI = re.compile(r"[ऀ-ॿ]")
MAX_SPEC_BYTES, MAX_TOTAL_VOICE_CHARS, MAX_VOICE_BYTES = 200_000, 2400, 50_000_000
PIPER_TIMEOUT, RENDER_TIMEOUT, FFMPEG_TIMEOUT = 180, 1500, 600   # seconds
VOICE_EXTS = ("wav", "mp3", "m4a", "ogg")
# Only these variables reach the Node/Chromium child process (keeps API keys and tokens out of it).
CHILD_ENV_KEYS = ("PATH", "HOME", "LANG", "LC_ALL", "TMPDIR", "NODE_PATH", "PLAYWRIGHT_BROWSERS_PATH",
                  "XDG_CACHE_HOME", "XDG_CONFIG_HOME", "TOPIC2REEL_NO_SANDBOX")


class SpecError(ValueError):
    pass


def load_spec(path: str | Path) -> dict:
    """Read a spec file with a size cap; the result must be a JSON object."""
    p = Path(path)
    if p.stat().st_size > MAX_SPEC_BYTES:
        raise SpecError(f"spec file too large (limit {MAX_SPEC_BYTES} bytes)")
    data = json.loads(p.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise SpecError("spec must be a JSON object")
    return data


# ---------------------------------------------------------------- validation
def _emoji_ok(v: object) -> bool:
    return isinstance(v, str) and 0 < len(v) <= 12 and not v.isascii()


def _text(path: str, v: object, errs: list[str], max_len: int, screen: bool = True) -> None:
    if not isinstance(v, str) or not v.strip():
        errs.append(f"{path}: must be a non-empty string"); return
    if len(v) > max_len:
        errs.append(f"{path}: too long ({len(v)} > {max_len})")
    if screen and DEVANAGARI.search(v):
        errs.append(f"{path}: on-screen text must be Roman script (no Devanagari font is bundled); keep Devanagari only in 'voice'")


MAX_LEXICON_BYTES, MAX_LEXICON_ENTRIES = 100_000, 300


def load_lexicon(path: str | Path) -> dict[str, str]:
    """Pronunciation lexicon: {"written form": "respelling used only for the voice"}. Plain strings, never regexes."""
    p = Path(path).expanduser()
    if p.stat().st_size > MAX_LEXICON_BYTES:
        raise SpecError(f"lexicon file too large (limit {MAX_LEXICON_BYTES} bytes)")
    data = json.loads(p.read_text(encoding="utf-8"))
    if not isinstance(data, dict) or len(data) > MAX_LEXICON_ENTRIES:
        raise SpecError(f"lexicon must be a JSON object with at most {MAX_LEXICON_ENTRIES} entries")
    for k, v in data.items():
        if not (isinstance(k, str) and isinstance(v, str) and 1 <= len(k) <= 40 and 1 <= len(v) <= 80):
            raise SpecError(f"lexicon entry {k!r}: key must be 1-40 chars and value 1-80 chars, both strings")
        if any(ord(c) < 32 for c in k + v):
            raise SpecError(f"lexicon entry {k!r}: control characters are not allowed")
    return data


def apply_lexicon(text: str, lexicon: dict[str, str] | None) -> str:
    """Replace whole words in one pass (no cascading). A Devanagari word is only matched when it is not
    glued to more Devanagari, so an entry for फ्रेंड does not touch फ्रेंड्स."""
    if not lexicon:
        return text
    keys = sorted(lexicon, key=len, reverse=True)
    dev = "\u0900-\u097F"
    rx = re.compile(f"(?<![{dev}])(" + "|".join(re.escape(k) for k in keys) + f")(?![{dev}])")
    return rx.sub(lambda m: lexicon[m.group(1)], text)


def show_phonemes(text: str, piper_model: str, lexicon: dict[str, str] | None = None) -> str:
    """What Piper will actually say, as phonemes. Lets you check a pronunciation without listening."""
    from piper import PiperVoice
    model = Path(piper_model).expanduser().resolve()
    if model.suffix != ".onnx" or not model.is_file():
        raise SpecError("--phonemes needs --piper-model /path/to/<voice>.onnx")
    voice = PiperVoice.load(str(model))
    return " ".join("".join("".join(p) for p in voice.phonemize(w)) for w in apply_lexicon(text, lexicon).split())


def validate_spec(spec: object) -> list[str]:
    errs: list[str] = []
    if not isinstance(spec, dict):
        return ["spec must be a JSON object"]
    scenes = spec.get("scenes")
    if not isinstance(scenes, list) or not 4 <= len(scenes) <= 8:
        return ["scenes: need a list of 4 to 8 scenes"]
    voice_chars = sum(len(s["voice"]) for s in scenes if isinstance(s, dict) and isinstance(s.get("voice"), str))
    if voice_chars > MAX_TOTAL_VOICE_CHARS:
        errs.append(f"voice: {voice_chars} characters in total, limit is {MAX_TOTAL_VOICE_CHARS}")
    _text("caption", spec.get("caption"), errs, 600, screen=False)
    tags = spec.get("hashtags")
    if not isinstance(tags, list) or not all(isinstance(t, str) and t.startswith("#") for t in tags):
        errs.append("hashtags: list of strings starting with '#'")
    for i, sc in enumerate(scenes):
        p = f"scenes[{i}]"
        if not isinstance(sc, dict):
            errs.append(f"{p}: must be an object"); continue
        t = sc.get("type")
        if t not in SCENE_TYPES:
            errs.append(f"{p}.type: must be one of {sorted(SCENE_TYPES)}"); continue
        hl = sc.get("headline")
        if not isinstance(hl, list) or not 1 <= len(hl) <= 2:
            errs.append(f"{p}.headline: list of 1-2 short lines")
        else:
            for k, line in enumerate(hl): _text(f"{p}.headline[{k}]", line, errs, 24)
        for k, w in enumerate(sc.get("highlight") or []): _text(f"{p}.highlight[{k}]", w, errs, 24)
        if sc.get("caption") is not None: _text(f"{p}.caption", sc["caption"], errs, 48)
        _text(f"{p}.voice", sc.get("voice"), errs, 400, screen=False)
        if t == "hook":
            if not _emoji_ok(sc.get("emoji")): errs.append(f"{p}.emoji: one emoji required")
            if sc.get("stamp") not in (None, "no", "yes"): errs.append(f"{p}.stamp: 'no' | 'yes' | omitted")
            if sc.get("badge") is not None: _text(f"{p}.badge", sc["badge"], errs, 26)
        elif t == "cards":
            items = sc.get("items")
            if not isinstance(items, list) or not 2 <= len(items) <= 6: errs.append(f"{p}.items: 2-6 cards")
            else:
                for k, it in enumerate(items):
                    if not isinstance(it, dict) or not _emoji_ok(it.get("emoji")): errs.append(f"{p}.items[{k}].emoji: one emoji required")
                    else: _text(f"{p}.items[{k}].label", it.get("label"), errs, 18)
                hi = sc.get("highlight_index")
                if hi is not None and not (isinstance(hi, int) and 0 <= hi < len(items)): errs.append(f"{p}.highlight_index out of range")
        elif t == "myth_fact":
            if not _emoji_ok(sc.get("emoji")): errs.append(f"{p}.emoji: one emoji required")
            _text(f"{p}.myth", sc.get("myth"), errs, 90); _text(f"{p}.fact", sc.get("fact"), errs, 90)
        elif t == "stat":
            _text(f"{p}.value", sc.get("value"), errs, 10)
            if sc.get("emoji") is not None and not _emoji_ok(sc["emoji"]): errs.append(f"{p}.emoji: one emoji")
            if sc.get("label") is not None: _text(f"{p}.label", sc["label"], errs, 60)
            if sc.get("sub") is not None: _text(f"{p}.sub", sc["sub"], errs, 40)
        elif t == "steps":
            items = sc.get("items")
            if not isinstance(items, list) or not 2 <= len(items) <= 5: errs.append(f"{p}.items: 2-5 steps")
            else:
                for k, it in enumerate(items):
                    if not isinstance(it, dict): errs.append(f"{p}.items[{k}]: object"); continue
                    _text(f"{p}.items[{k}].text", it.get("text"), errs, 60)
                    if it.get("emoji") is not None and not _emoji_ok(it["emoji"]): errs.append(f"{p}.items[{k}].emoji: one emoji")
        elif t == "compare":
            for side in ("left", "right"):
                s = sc.get(side)
                if not isinstance(s, dict) or not _emoji_ok(s.get("emoji")): errs.append(f"{p}.{side}.emoji: one emoji required")
                else: _text(f"{p}.{side}.label", s.get("label"), errs, 40)
        elif t == "cta":
            for k in ("primary", "secondary", "handle"):
                if sc.get(k) is not None: _text(f"{p}.{k}", sc[k], errs, 24)
    return errs


# ---------------------------------------------------------------- audio
def _duration(path: Path) -> float:
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
                       capture_output=True, text=True, check=True, timeout=30, env=_child_env())
    return float(r.stdout.strip())


def synth_voice(spec: dict, mode: str, work: Path, piper_model: str | None, voice_dir: str | None,
                lexicon: dict[str, str] | None = None) -> list[Path] | None:
    n = len(spec["scenes"])
    if mode == "none":
        return None
    files: list[Path] = []
    if mode == "piper":
        model = Path(piper_model).expanduser().resolve() if piper_model else None
        if model is None or model.suffix != ".onnx" or not model.is_file():
            raise SpecError("--voice piper needs --piper-model /path/to/<voice>.onnx (or env TOPIC2REEL_PIPER_MODEL)")
        for i, sc in enumerate(spec["scenes"], 1):
            out = work / f"scene_{i}.wav"
            # the text goes after "--" so it can never be read as an option; no shell is involved
            subprocess.run([sys.executable, "-m", "piper", "-m", str(model), "-f", str(out), "--", apply_lexicon(sc["voice"], lexicon)],
                           check=True, timeout=PIPER_TIMEOUT, env=_child_env())
            files.append(out)
    elif mode == "dir":
        if not voice_dir:
            raise SpecError("--voice dir needs --voice-dir (scene_1.wav|mp3|m4a|ogg ... scene_N)")
        base = Path(voice_dir).expanduser().resolve()   # absolute, so a name like "-x" is never read as an ffmpeg option
        for i in range(1, n + 1):
            found = next((p for e in VOICE_EXTS if (p := base / f"scene_{i}.{e}").is_file()), None)
            if not found:
                raise SpecError(f"missing voice file for scene {i} in {base}")
            if found.stat().st_size > MAX_VOICE_BYTES:
                raise SpecError(f"{found.name} is larger than {MAX_VOICE_BYTES // 1_000_000} MB")
            files.append(found)
    else:
        raise SpecError(f"unknown voice mode {mode}")
    return files


def make_music(path: Path, seconds: float, bpm: int = 108, sr: int = 44100) -> None:
    import numpy as np
    n = int(seconds * sr); out = np.zeros(n); beat = 60 / bpm; rng = np.random.default_rng(7)

    def add(start: float, sig):
        i = int(start * sr); j = min(n, i + len(sig))
        if i < n: out[i:j] += sig[: j - i]

    kt = np.arange(int(.28 * sr)) / sr
    kick = np.sin(2 * np.pi * (45 + 110 * np.exp(-kt * 28)) * kt) * np.exp(-kt * 9) * .9
    ht = np.arange(int(.05 * sr)) / sr; hat = rng.standard_normal(len(ht)) * np.exp(-ht * 90) * .12
    ct = np.arange(int(.12 * sr)) / sr; clap = rng.standard_normal(len(ct)) * np.exp(-ct * 38) * .22
    bass, arp = [55.0, 55.0, 65.41, 73.42], [220.0, 261.63, 329.63, 392.0, 329.63, 261.63, 329.63, 440.0]
    k = 0
    while k * beat < seconds:
        add(k * beat, kick)
        if k % 2: add(k * beat, clap)
        add(k * beat + beat / 2, hat)
        bt = np.arange(int(beat * sr)) / sr
        add(k * beat, np.sin(2 * np.pi * bass[(k // 4) % 4] * bt) * np.exp(-bt * 2.2) * .35); k += 1
    step, m = beat / 2, 0
    while m * step < seconds:
        pt = np.arange(int(step * 1.6 * sr)) / sr; f = arp[m % len(arp)]
        add(m * step, (np.sin(2 * np.pi * f * pt) + .3 * np.sin(4 * np.pi * f * pt)) * np.exp(-pt * 7) * .16); m += 1
    fade = int(.8 * sr)
    out[:int(.05 * sr)] *= np.linspace(0, 1, int(.05 * sr)); out[-fade:] *= np.linspace(1, 0, fade)
    pcm = (out / (np.max(np.abs(out)) or 1) * .85 * 32767).astype("<i2")
    with wave.open(str(path), "wb") as wf:
        wf.setnchannels(1); wf.setsampwidth(2); wf.setframerate(sr); wf.writeframes(pcm.tobytes())


# ---------------------------------------------------------------- pipeline
def _child_env() -> dict[str, str]:
    return {k: v for k, v in os.environ.items() if k in CHILD_ENV_KEYS}


def _render_env(spec_path: Path, durs: list[float], **extra: str) -> dict[str, str]:
    base = _child_env()
    return {**base, "SPEC_PATH": str(spec_path), "DURS": json.dumps(durs), **extra}


def generate(spec_path: str | Path, out_path: str | Path, voice: str = "none", piper_model: str | None = None,
             voice_dir: str | None = None, music: bool = True, lexicon_path: str | Path | None = None) -> Path:
    spec_path, out_path = Path(spec_path).resolve(), Path(out_path).resolve()
    if out_path.suffix.lower() != ".mp4":
        raise SpecError("output file must end with .mp4")
    spec = load_spec(spec_path)
    errs = validate_spec(spec)
    if errs:
        raise SpecError("invalid spec:\n  " + "\n  ".join(errs))
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="topic2reel_") as td:
        work = Path(td)
        lexicon = load_lexicon(lexicon_path) if lexicon_path else None
        voices = synth_voice(spec, voice, work, piper_model, voice_dir, lexicon)
        durs = [DEFAULT_SCENE] * len(spec["scenes"])
        if voices:
            durs = [max(MIN_SCENE, _duration(v) + LEAD_IN + TAIL) for v in voices]
        total = sum(durs)
        silent = work / "silent.mp4"
        subprocess.run(["node", str(HERE / "render" / "render.js"), "video", str(silent)], check=True,
                       env=_render_env(spec_path, durs), cwd=HERE / "render", timeout=RENDER_TIMEOUT)
        cmd = ["ffmpeg", "-y", "-loglevel", "error", "-i", str(silent)]
        filters: list[str] = []
        labels: list[str] = []
        idx = 1
        if music:
            wav = work / "music.wav"; make_music(wav, total); cmd += ["-i", str(wav)]
            filters.append(f"[{idx}:a]volume={0.20 if voices else 0.7}[m]"); labels.append("[m]"); idx += 1
        if voices:
            acc = 0.0
            for k, (v, d) in enumerate(zip(voices, durs)):
                cmd += ["-i", str(v)]; s = int((acc + LEAD_IN) * 1000); acc += d
                filters.append(f"[{idx}:a]adelay={s}|{s},volume=0.9[v{k}]"); labels.append(f"[v{k}]"); idx += 1
        if labels:
            filters.append("".join(labels) + f"amix=inputs={len(labels)}:normalize=0:duration=longest,alimiter=limit=0.95[a]")
            cmd += ["-filter_complex", ";".join(filters), "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k"]
        else:
            cmd += ["-c:v", "copy", "-an"]
        cmd += ["-t", f"{total:.3f}", str(out_path)]
        subprocess.run(cmd, check=True, timeout=FFMPEG_TIMEOUT, env=_child_env())
    tags = " ".join(spec["hashtags"])
    out_path.with_suffix(".caption.txt").write_text(f"{spec['caption']}\n\n{tags}\n", encoding="utf-8")
    return out_path


def preview(spec_path: str | Path, out_dir: str | Path) -> list[Path]:
    spec_path = Path(spec_path).resolve()
    spec = load_spec(spec_path)
    errs = validate_spec(spec)
    if errs:
        raise SpecError("invalid spec:\n  " + "\n  ".join(errs))
    durs = [DEFAULT_SCENE] * len(spec["scenes"])
    times, acc = [], 0.0
    for d in durs: times.append(round(acc + d * 0.88, 1)); acc += d
    subprocess.run(["node", str(HERE / "render" / "render.js"), "stills", str(out_dir)], check=True,
                   env=_render_env(spec_path, durs, STILLS=json.dumps(times)), cwd=HERE / "render", timeout=180)
    return sorted(Path(out_dir).glob("still_*.png"))


def doctor(piper_model: str | None) -> int:
    """Check the machine can run the kit. Returns 1 if a required piece is missing."""
    import importlib.util
    import shutil
    checks: list[tuple[str, bool, str, bool]] = []

    def add(name: str, ok: bool, hint: str, required: bool = True) -> None:
        checks.append((name, ok, hint, required))

    for tool in ("node", "ffmpeg", "ffprobe"):
        add(tool, bool(shutil.which(tool)), f"install {tool}")
    add("python: numpy", importlib.util.find_spec("numpy") is not None, "pip install numpy")
    add("node: playwright", subprocess.run(["node", "-e", "require('playwright')"], capture_output=True).returncode == 0
        if shutil.which("node") else False, "npm i -g playwright && npx playwright install chromium")
    fonts = subprocess.run(["fc-list"], capture_output=True, text=True).stdout if shutil.which("fc-list") else ""
    add("font: Noto Color Emoji", "Noto Color Emoji" in fonts, "install fonts-noto-color-emoji (emoji would render as boxes)")
    add("font: Inter", "Inter" in fonts, "install Inter (falls back to DejaVu Sans without it)", required=False)
    add("python: piper-tts (voice)", importlib.util.find_spec("piper") is not None, "pip install piper-tts  (only for --voice piper)", required=False)
    add("piper voice model (.onnx)", bool(piper_model) and Path(piper_model).is_file(),
        "set TOPIC2REEL_PIPER_MODEL=/path/hi_IN-<voice>-medium.onnx  (only for --voice piper)", required=False)
    for name, ok, hint, required in checks:
        print(f"{'OK     ' if ok else ('MISSING' if required else 'optional')}  {name}" + ("" if ok else f"   -> {hint}"))
    return 0 if all(ok for _, ok, _, req in checks if req) else 1


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("spec", nargs="?"); ap.add_argument("-o", "--out", default="out/reel.mp4")
    ap.add_argument("--doctor", action="store_true", help="check required tools, fonts and voice model")
    ap.add_argument("--validate", action="store_true"); ap.add_argument("--preview", metavar="DIR")
    ap.add_argument("--voice", choices=["piper", "dir", "none"], default=os.environ.get("TOPIC2REEL_VOICE", "none"))
    ap.add_argument("--piper-model", default=os.environ.get("TOPIC2REEL_PIPER_MODEL"))
    ap.add_argument("--voice-dir", default=os.environ.get("TOPIC2REEL_VOICE_DIR"))
    ap.add_argument("--no-music", action="store_true")
    ap.add_argument("--lexicon", default=os.environ.get("TOPIC2REEL_LEXICON"), help="JSON file of respellings applied to the voice text only")
    ap.add_argument("--phonemes", metavar="TEXT", help="print the phonemes Piper will say for TEXT (needs --piper-model)")
    a = ap.parse_args()
    if a.doctor:
        return doctor(a.piper_model)
    if a.phonemes is not None:
        try:
            print(show_phonemes(a.phonemes, a.piper_model or "", load_lexicon(a.lexicon) if a.lexicon else None)); return 0
        except (SpecError, OSError, json.JSONDecodeError) as e:
            print(f"error: {e}", file=sys.stderr); return 1
    if not a.spec:
        ap.error("spec is required (or use --doctor)")
    try:
        if a.validate:
            errs = validate_spec(load_spec(a.spec))
            print("OK" if not errs else "INVALID:\n  " + "\n  ".join(errs)); return 1 if errs else 0
        if a.preview:
            print("\n".join(map(str, preview(a.spec, a.preview)))); return 0
        print("done:", generate(a.spec, a.out, a.voice, a.piper_model, a.voice_dir, not a.no_music, a.lexicon)); return 0
    except (SpecError, subprocess.CalledProcessError, subprocess.TimeoutExpired, json.JSONDecodeError, OSError) as e:
        print(f"error: {e}", file=sys.stderr); return 1


if __name__ == "__main__":
    sys.exit(main())
