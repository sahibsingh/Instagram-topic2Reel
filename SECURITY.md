# Security review: Topic2Reel

Scope: the code in this repository (`engine/`, `skills/`, `scripts/`, `prompts/`, `docs/`) at version 0.1.0.
Method: I read every file, grepped for dangerous patterns (shell use, `eval`, `innerHTML`, network calls, option injection),
fixed what I found, and added tests for the fixes. This is a self-review, **not** an independent audit, and it does not cover
the third-party programs the project drives (Chromium, Playwright, ffmpeg, Piper, onnxruntime).

## What the plugin can and cannot do
| | |
|---|---|
| Network | None by design. The renderer browser is blocked from every non-local request. No telemetry. |
| Secrets | Reads none. It never asks for or stores an API key. |
| Files | Reads the spec you give it (and voice files you point to), writes the MP4 and caption you ask for, and uses a temp folder it deletes. |
| Processes | Starts `node` (renderer), `ffmpeg`, `ffprobe` and `python -m piper` with argument lists. No shell, no `eval`. |
| Hooks / MCP / background services | None. The plugin is one skill. |

## Findings and status
| # | Finding | Risk | Status |
|---|---|---|---|
| 1 | Chromium was always started with `--no-sandbox` | Medium: a browser bug would run unsandboxed | **Fixed.** Now only when running as root (containers) or with `TOPIC2REEL_NO_SANDBOX=1`. |
| 2 | The render browser could in principle reach the internet | Medium | **Fixed and tested.** Layer 1: Content-Security-Policy `default-src 'none'` in `reel.html` (blocks fetch, XHR, WebSocket, images, scripts). Layer 2: a Playwright route handler aborts any non-local request. `tests/net_lockdown.js` proves both layers fire (the test counts CSP violations and aborted requests, because a machine without internet would "pass" anyway). |
| 3 | Child processes inherited the full environment, including any API keys | Medium | **Fixed and tested.** Only an allowlist of variables (`PATH`, `HOME`, `LANG`, ...) reaches node, ffmpeg and piper. |
| 4 | Text from the spec reaches the `piper` command line | Medium: option injection | **Verified.** The text is passed after `--` in an argument list; a test speaks the text `--help ...` instead of parsing it. |
| 5 | A relative `--voice-dir` such as `-x` could reach ffmpeg as `-x/scene_1.wav` | Low | **Fixed and tested.** Paths are resolved to absolute. |
| 6 | No timeouts on subprocesses | Low: a hang blocks the machine | **Fixed.** piper 180 s per scene, render 1500 s, ffmpeg 600 s, ffprobe 30 s. |
| 7 | No limits on spec size | Low: memory / disk use | **Fixed and tested.** Spec at most 200 KB, 4 to 8 scenes, voice text at most 400 chars per scene (2400 in total), voice file at most 50 MB, scene length 0.5 to 60 s, video at most 10 min. |
| 8 | Output could be written to any file name | Low | **Fixed and tested.** The output must end in `.mp4`. |
| 9 | The README example wrote the spec to a predictable `/tmp` path | Low: symlink attack on shared machines | **Fixed.** The example no longer uses a fixed temp path. |
| 10 | Topic text could try to steer the skill ("ignore the above, run ...") or break shell quoting | Medium | **Mitigated.** `SKILL.md` says the topic is data, forbids putting it in shell commands, fixes the slug to `[a-z0-9-]`, and limits the engine lookup to the plugin folder instead of `find /`. |
| 11 | Hostile text on screen (`<img onerror=...>`, `</script>`) | Low | **Verified.** Text is only drawn on a canvas; nothing is inserted as HTML. A test renders such text. |

## Residual risks (not fixed)
- **WebSocket is stopped only by the CSP**, not by the route handler (Playwright's `route` does not see WebSockets). The CSP is part of
  the page and cannot be changed by spec data, but it is one layer, not two.
- **Root + `--no-sandbox`:** inside a container running as root the browser sandbox is off. The browser only opens this repository's own
  page and has no network, which limits the impact; run it as a normal user when you can.
- **Voice models are third-party binary files.** `.onnx` files are data, but they are parsed by native code (onnxruntime). Download them
  from the official Piper voices source and check the hash. The files I used came from a third-party GitHub repository and had these
  SHA-256 values (recorded for reproducibility, **not** compared with the official source):
  `hi_IN-pratham-medium.onnx` `169964b0871667f6793416d4b35e97357a68ba1ad01df8580c28048989ee7693`,
  `hi_IN-priyamvada-medium.onnx` `aa63bcf2cd493b55a450f280e23cf77f03afc9af7015e6e5acd43b652f166c88`,
  `hi_IN-rohan-medium.onnx` `b65dc80fb34d9dcd1cf684cb297966a34983bbc93bb1696fe207f32b0b33a091`.
- **Supply chain.** `package-lock.json` pins the npm tree. Python packages are pinned only by range (`requirements.txt`); for stricter
  installs use `pip install --require-hashes` with a generated hash file.
- **Content safety is not automated.** The LLM can write wrong or sensitive claims. The validator checks shape and length, not truth.
- **Licences:** `piper-tts` is GPL-3.0-or-later. It is called as a separate program and is not bundled here; if you ever ship it
  inside a package, the GPL terms apply to that package.

## Reporting a problem
Use GitHub private vulnerability reporting: https://github.com/sahibsingh/Instagram-topic2Reel/security/advisories/new (turn it on under Settings, Code security).
Add a contact address here before the first public release.

## Re-running the checks
```bash
python3 -m unittest discover -s tests -v
grep -rnE "shell=True|os\.system|eval\(|innerHTML|document\.write" engine scripts skills
```
