# Contributing to Topic2Reel

Thanks for helping. Small, focused pull requests with a test are the easiest to review.

## Set up
```bash
pip install -r requirements.txt
npm ci && npx playwright install chromium
sudo apt install ffmpeg fonts-noto-color-emoji fonts-inter     # or your OS equivalent
python3 engine/topic2reel.py --doctor                           # shows anything still missing
python3 -m unittest discover -s tests -v
```
Voice tests need a Piper model (`export TOPIC2REEL_PIPER_MODEL=/path/voice.onnx`, see `scripts/get_voice.sh`); without one they skip.
On Windows use Git Bash or WSL. If Chromium cannot start with its sandbox on your machine, set `TOPIC2REEL_NO_SANDBOX=1`
after reading SECURITY.md.

## Where things live
| Change | Edit |
|---|---|
| A new scene type | `engine/render/reel.html` (add to `T`), `engine/topic2reel.py` (`SCENE_TYPES` and `validate_spec`), `schema/reel-spec.schema.json`, `prompts/topic_to_spec.md`, an example in `examples/`, tests |
| Voice or audio | `engine/topic2reel.py` (`synth_voice`, the mix in `generate`) |
| The Claude Code workflow | `skills/reel/SKILL.md` |
| The demo page | `docs/index.html` and `docs/media/` |

Preview a spec quickly with `python3 engine/topic2reel.py spec.json --preview out/prev`, and look at the stills before you open a PR.

## Rules that keep this project safe (details in SECURITY.md)
- No network access from the renderer, no `shell=True`, no `eval`, no `innerHTML`. Subprocesses take argument lists.
- Spec and lexicon files are untrusted input: add a limit and a test for every new field.
- On-screen text is Roman script only (no Devanagari font is bundled); Devanagari belongs in `voice`.
- Never commit voice models, API keys, or personal data.
- If you change visuals, regenerate the demo media and say in the PR that the diff contains large files.

## Commits and pull requests
Use a short imperative subject ("Add stat scene count-up"). Fill in the pull request template. CI must be green.
