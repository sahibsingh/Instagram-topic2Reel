# Topic2Reel

**Type a topic. Get a ready-to-post Instagram Reel**: animated 9:16 scenes, Hindi voiceover, music and a caption with hashtags.
It runs on your own machine, needs no API key, and ships as a Claude Code plugin plus a plain command-line tool.

```
topic ──► spec.json (written by Claude, or any LLM, from prompts/topic_to_spec.md)
      ──► engine/topic2reel.py ──► reel.mp4 + reel.caption.txt
```

- **Repository:** https://github.com/sahibsingh/Instagram-topic2Reel
- **Demo page:** `docs/index.html` (static); once GitHub Pages is on (Settings, Pages, `/docs`) it is served at https://sahibsingh.github.io/Instagram-topic2Reel/
- **Security notes:** [SECURITY.md](SECURITY.md)

## What you get
| | |
|---|---|
| Output | 1080×1920, 30 fps MP4, about 30–45 s, plus a caption file |
| Visuals | 7 scene types (hook, cards, myth/fact, stat, steps, compare, call to action) drawn in code, no stock footage |
| Voice | Hindi voiceover with [Piper](https://github.com/OHF-Voice/piper1-gpl) (optional; without it you get music only) |
| Cost | Free. About 2 minutes of CPU time for a 35 s reel |

## Use it as a Claude Code plugin
```text
/plugin marketplace add sahibsingh/Instagram-topic2Reel
/plugin install topic2reel@topic2reel
/topic2reel:reel study tips for board exams
```
> These commands follow Claude Code's plugin documentation as I know it. This repository's plugin has **not** been loaded in a
> live Claude Code session yet; the engine, the tests and the page are what has been run. To try it from a local folder:
> `git clone https://github.com/sahibsingh/Instagram-topic2Reel.git && claude --plugin-dir ./Instagram-topic2Reel`.

Claude then runs the workflow in `skills/reel/SKILL.md`: check the machine, write the spec, validate, preview, render, report.

## Use it from the command line
```bash
python3 engine/topic2reel.py --doctor                                         # what is missing on this machine?
python3 engine/topic2reel.py examples/study_tips.json --validate
python3 engine/topic2reel.py examples/study_tips.json --preview out/prev      # a few still frames, about 10 s
python3 engine/topic2reel.py examples/study_tips.json -o out/study.mp4 --voice piper --piper-model "$TOPIC2REEL_PIPER_MODEL"
python3 engine/topic2reel.py examples/study_tips.json -o out/silent.mp4 --voice none
python3 engine/topic2reel.py spec.json -o out/x.mp4 --voice dir --voice-dir ./my_voice   # your own scene_1.wav ... scene_N.wav
```
From Python: `from topic2reel import generate; generate("spec.json", "out/reel.mp4", voice="none")`.
Behind your own feature flag, ask your LLM for a spec with `prompts/topic_to_spec.md` as the system prompt, check it with
`validate_spec`, then call `generate`.

## Install
```bash
pip install -r requirements.txt             # numpy, piper-tts (GPL-3.0, see below)
npm ci && npx playwright install chromium   # the renderer (package-lock.json is committed)
sudo apt install ffmpeg fonts-noto-color-emoji fonts-inter   # or your OS equivalent
scripts/get_voice.sh hi_IN-pratham-medium   # downloads a Hindi voice, prints the export line
export TOPIC2REEL_PIPER_MODEL=~/.topic2reel/voices/hi_IN-pratham-medium.onnx
python3 engine/topic2reel.py --doctor
```
`scripts/get_voice.sh` uses Piper's own downloader and has not been run on the machine that built this repo (no access to
Hugging Face there). Voice models are not stored in this repository (about 63 MB each).

## The spec
`{ "caption", "hashtags", "scenes": [4 to 8 scenes] }`, schema in `schema/reel-spec.schema.json`, examples in `examples/`.
Every scene has `type`, `headline` (1–2 short lines), `voice`, and optional `highlight` and `caption`.

| `type` | extra fields | looks like |
|---|---|---|
| `hook` | `emoji`, `stamp`, `badge` | big emoji sticker with a red cross or green tick |
| `cards` | `items[{emoji,label}]` | grid of icon cards popping in |
| `myth_fact` | `emoji`, `myth`, `fact` | myth bubble flips into a green fact bubble |
| `stat` | `value`, `emoji`, `label`, `sub` | big number, counts up if numeric |
| `steps` | `items[{text,emoji}]` | checklist that ticks off |
| `compare` | `left`, `right` | the wrong way vs the better way |
| `cta` | `emoji`, `primary`, `secondary` | save / share buttons and hearts |

A scene lasts as long as its voice line plus about one second; without voice it lasts 4.4 s.

## Limits
- **On-screen text must be Roman script** (Hinglish is fine). No Devanagari font is bundled, so the validator rejects it;
  Devanagari is only for `voice`.
- Visuals are emoji and shapes, so they fit any topic but look simpler than hand-drawn scenes.
- Voice quality depends on the Piper voice, and English loanwords can be mispronounced. Re-spell them in Devanagari in `voice`.
- The facts come from the LLM that writes the spec. Read health, money and legal topics before posting.
- The music is a small synthesized beat. Swap in a trending audio when you upload.

## Pronunciation
English loanwords can come out wrong. Two tools help, and neither needs you to listen first:
```bash
# what will Piper actually say? (phonemes)
python3 engine/topic2reel.py --phonemes "अपनी फ्रेंड को भेजो" --piper-model "$TOPIC2REEL_PIPER_MODEL"
# respell words for the voice only (the on-screen text is not touched)
python3 engine/topic2reel.py spec.json -o out/x.mp4 --voice piper --lexicon examples/lexicon/hinglish.json
```
A lexicon is a JSON object `{"written": "respelling"}`; whole words only, one pass, plain text (never a regex).
`examples/lexicon/hinglish.json` gives English `f` to words like फ़िट and फ़्रेंड (Piper says `pʰ` for a plain फ, `f` for फ़) while
Hindi words such as फल keep `pʰ`. It is **off by default**; the phonemes were checked, the resulting sound was not listened to.

## Tests
```bash
python3 -m unittest discover -s tests -v    # 17 tests; the browser and voice ones skip if Node/Piper are missing
```

## Layout
```
.claude-plugin/   plugin.json, marketplace.json
skills/reel/      the /reel workflow for Claude
engine/           topic2reel.py (CLI + library) and render/ (the scene renderer, runs in a locked-down headless Chromium)
prompts/ schema/ examples/
tests/  scripts/  docs/ (demo page)
```

## Licence
The code in this repository is released under the [MIT License](LICENSE). Note that `piper-tts` is **GPL-3.0-or-later**: this project
only calls it as a separate program and does not bundle it. Each Piper voice has its own licence, so check it before commercial use.
