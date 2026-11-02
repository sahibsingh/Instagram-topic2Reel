# Changelog

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [SemVer](https://semver.org/).

## [Unreleased]
### Added
- Prompt builder and 12 templates on the demo page (`docs/builder.js`, `docs/app.js`); the skill now reads a brief
  (`TONE`, `LENGTH`, `SCENES`, `HOOK`, `CTA`, `VOICE`, `PRONUNCIATION`, `FACTS`, `AVOID`, `SETUP`).
- `--voice-name` (pick `pratham`, `priyamvada` or `rohan` next to the configured model).
- Tests for the builder (logic, skill/builder agreement, real browser incl. injection and hostile share links).
### Fixed
- Found by running the plugin end to end: relative `--preview` folders were written inside `engine/render/`; the validator accepted
  `highlight` as a bare string and the renderer then crashed; the skill used shell variables that the permission system blocks,
  and told Claude to render in the background so the session ended before the video existed.
- "Open in Claude" stayed visible on the plugin tab (`display` rule overrode the `hidden` attribute).
### Fixed
- Chromium's sandbox is now really on for non-root users. Before, Playwright's default (`--no-sandbox`) was in effect even
  though the code looked like it kept the sandbox. Root and `TOPIC2REEL_NO_SANDBOX=1` still run without it.
### Added
- CI (tests, static checks, a non-blocking sandbox check), Dependabot, issue and pull request templates, CODEOWNERS,
  CONTRIBUTING, `.gitattributes`, `.editorconfig`.
- `tests/sandbox_policy.js` and a test for the sandbox policy.

## [0.1.0] - 2026-11-02
### Added
- Topic to Reel engine: 7 scene types, Hindi voiceover with Piper, music, caption file.
- Claude Code plugin with the `/topic2reel:reel` skill, marketplace manifest, MIT licence.
- Validator with size and length limits, JSON schema, LLM prompt (`prompts/topic_to_spec.md`).
- Pronunciation lexicon (`--lexicon`) and `--phonemes` inspector.
- Demo page (`docs/`), SECURITY.md, 17 tests.
### Security
- Renderer browser has no network (CSP and route blocking), child processes get a filtered environment,
  subprocess timeouts, voice text passed after `--`, absolute voice paths, `.mp4`-only output.
### Fixed
- Colour emoji rendered pale or monochrome (fake bold, translucent fill, fallback font).
