"""Run:  python3 -m unittest discover -s tests -v
Tests that need Node/Playwright or a Piper voice model are skipped when those are missing."""
from __future__ import annotations

import copy
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "engine"))
import topic2reel as t2r  # noqa: E402

EXAMPLES = sorted((ROOT / "examples").glob("*.json"))
HAS_NODE = bool(shutil.which("node")) and subprocess.run(["node", "-e", "require('playwright')"], capture_output=True, cwd=ROOT).returncode == 0
PIPER_MODEL = os.environ.get("TOPIC2REEL_PIPER_MODEL")


def good_spec() -> dict:
    return copy.deepcopy(json.loads((ROOT / "examples" / "study_tips.json").read_text(encoding="utf-8")))


class Validation(unittest.TestCase):
    def test_examples_are_valid(self):
        self.assertTrue(EXAMPLES)
        for p in EXAMPLES:
            with self.subTest(p.name):
                self.assertEqual(t2r.validate_spec(t2r.load_spec(p)), [])

    def test_rejections(self):
        def mut(fn):
            s = good_spec(); fn(s); return s
        cases = {
            "devanagari on screen": mut(lambda s: s["scenes"][0].__setitem__("headline", ["भूखा रहना"])),
            "unknown scene type": mut(lambda s: s["scenes"][0].__setitem__("type", "script")),
            "too few scenes": mut(lambda s: s.__setitem__("scenes", s["scenes"][:3])),
            "too many scenes": mut(lambda s: s.__setitem__("scenes", s["scenes"] * 2)),
            "three headline lines": mut(lambda s: s["scenes"][0].__setitem__("headline", ["a", "b", "c"])),
            "headline line too long": mut(lambda s: s["scenes"][0].__setitem__("headline", ["x" * 40])),
            "hashtag without #": mut(lambda s: s.__setitem__("hashtags", ["nope"])),
            "caption not a string": mut(lambda s: s.__setitem__("caption", {"a": 1})),
            "ascii instead of emoji": mut(lambda s: s["scenes"][0].__setitem__("emoji", "abc")),
            "bad stamp": mut(lambda s: s["scenes"][0].__setitem__("stamp", "maybe")),
            "scene not an object": mut(lambda s: s["scenes"].__setitem__(0, "x")),
            "voice text too long in total": mut(lambda s: (s.__setitem__("scenes", (s["scenes"] + s["scenes"])[:8]),
                                                           [sc.__setitem__("voice", "अ" * 399) for sc in s["scenes"]])),
        }
        for name, spec in cases.items():
            with self.subTest(name):
                self.assertTrue(t2r.validate_spec(spec), f"{name} should be rejected")

    def test_spec_size_cap_and_shape(self):
        with tempfile.TemporaryDirectory() as td:
            big = Path(td, "big.json"); big.write_text(json.dumps({"x": "a" * (t2r.MAX_SPEC_BYTES + 10)}))
            with self.assertRaises(t2r.SpecError): t2r.load_spec(big)
            arr = Path(td, "arr.json"); arr.write_text("[1, 2]")
            with self.assertRaises(t2r.SpecError): t2r.load_spec(arr)


class Safety(unittest.TestCase):
    def setUp(self):
        self.td = tempfile.TemporaryDirectory(); self.tmp = Path(self.td.name)
        self.spec_path = self.tmp / "spec.json"; self.spec_path.write_text(json.dumps(good_spec()), encoding="utf-8")

    def tearDown(self):
        self.td.cleanup()

    def test_output_must_be_mp4(self):
        with self.assertRaises(t2r.SpecError): t2r.generate(self.spec_path, self.tmp / "out.sh")

    def test_piper_model_must_be_an_onnx_file(self):
        spec = good_spec()
        for bad in ("/etc/passwd", str(self.tmp / "missing.onnx"), None):
            with self.subTest(bad), self.assertRaises(t2r.SpecError):
                t2r.synth_voice(spec, "piper", self.tmp, bad, None)

    def test_voice_dir_paths_become_absolute(self):
        # a directory called "-x" must never reach ffmpeg as a relative "-x/..." argument (read as an option)
        spec = good_spec(); old = Path.cwd()
        os.chdir(self.tmp)
        try:
            d = Path("-x"); d.mkdir()
            for i in range(1, len(spec["scenes"]) + 1): (d / f"scene_{i}.wav").write_bytes(b"RIFF")
            files = t2r.synth_voice(spec, "dir", self.tmp, None, "-x")
        finally:
            os.chdir(old)
        self.assertEqual(len(files), len(spec["scenes"]))
        for f in files:
            self.assertTrue(f.is_absolute()); self.assertFalse(str(f).startswith("-"))

    def test_child_process_env_hides_secrets(self):
        os.environ["FAKE_API_KEY"] = "do-not-leak"; os.environ["ANTHROPIC_API_KEY"] = "do-not-leak"
        try:
            env = t2r._render_env(self.spec_path, [4.0])
        finally:
            del os.environ["FAKE_API_KEY"]; del os.environ["ANTHROPIC_API_KEY"]
        self.assertNotIn("FAKE_API_KEY", env); self.assertNotIn("ANTHROPIC_API_KEY", env)
        self.assertIn("SPEC_PATH", env)


@unittest.skipUnless(HAS_NODE, "needs node + playwright")
class Browser(unittest.TestCase):
    def test_render_browser_has_no_network(self):
        r = subprocess.run(["node", str(ROOT / "tests" / "net_lockdown.js")], capture_output=True, text=True, cwd=ROOT, timeout=120)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        res = json.loads(r.stdout.strip().splitlines()[-1])
        self.assertEqual(set(res["phase1"].values()) | set(res["phase2"].values()), {"BLOCKED"})
        self.assertGreaterEqual(res["csp_violations"], 1, "CSP layer did not fire")
        self.assertGreaterEqual(res["route_blocked"], 1, "route-abort layer did not fire")

    def test_sandbox_policy_and_real_launch(self):
        r = subprocess.run(["node", str(ROOT / "tests" / "sandbox_policy.js")], capture_output=True, text=True, cwd=ROOT, timeout=120)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        res = json.loads(r.stdout.strip().splitlines()[-1])
        self.assertEqual(res["policy"], {"user": True, "root": False, "optOut": False})

    def test_hostile_text_is_only_drawn_never_executed(self):
        spec = good_spec()
        spec["scenes"][0]["headline"] = ["<img src=x onerror=1>", "'\";alert(1);//"]
        spec["scenes"][0]["badge"] = "</script><b>x</b>"
        with tempfile.TemporaryDirectory() as td:
            p = Path(td, "spec.json"); p.write_text(json.dumps(spec), encoding="utf-8")
            self.assertEqual(t2r.validate_spec(spec), [])
            shots = t2r.preview(p, Path(td, "prev"))
            self.assertEqual(len(shots), len(spec["scenes"]))


@unittest.skipUnless(PIPER_MODEL and Path(PIPER_MODEL).is_file(), "needs TOPIC2REEL_PIPER_MODEL")
class Voice(unittest.TestCase):
    def test_text_that_looks_like_an_option_is_spoken_not_parsed(self):
        spec = good_spec(); spec["scenes"] = spec["scenes"][:4]
        for sc in spec["scenes"]: sc["voice"] = "--help नमस्ते दोस्तों"
        with tempfile.TemporaryDirectory() as td:
            files = t2r.synth_voice(spec, "piper", Path(td), PIPER_MODEL, None)
            with wave.open(str(files[0])) as w:
                self.assertGreater(w.getnframes() / w.getframerate(), 0.5)


class Lexicon(unittest.TestCase):
    def test_whole_words_only(self):
        lex = {"फ्रेंड": "फ़्रेंड"}
        self.assertEqual(t2r.apply_lexicon("फ्रेंड और फ्रेंड्स", lex), "फ़्रेंड और फ्रेंड्स")

    def test_single_pass_no_cascade(self):
        self.assertEqual(t2r.apply_lexicon("a b", {"a": "b", "b": "c"}), "b c")

    def test_keys_are_literal_text_not_regex(self):
        self.assertEqual(t2r.apply_lexicon("abc a.c", {"a.c": "X"}), "abc X")

    def test_empty_lexicon_changes_nothing(self):
        self.assertEqual(t2r.apply_lexicon("नमस्ते", None), "नमस्ते")
        self.assertEqual(t2r.apply_lexicon("नमस्ते", {}), "नमस्ते")

    def test_shipped_example_is_valid(self):
        lex = t2r.load_lexicon(ROOT / "examples" / "lexicon" / "hinglish.json")
        self.assertIn("फ्रेंड", lex)

    def test_bad_lexicons_are_rejected(self):
        with tempfile.TemporaryDirectory() as td:
            def write(obj, name="l.json"):
                f = Path(td, name); f.write_text(obj if isinstance(obj, str) else json.dumps(obj), encoding="utf-8"); return f
            for name, obj in {"array": [1], "non-string value": {"a": 1}, "empty key": {"": "x"},
                              "long value": {"a": "x" * 81}, "control char": {"a": "x\u0007"},
                              "too many": {str(i): "x" for i in range(t2r.MAX_LEXICON_ENTRIES + 1)}}.items():
                with self.subTest(name), self.assertRaises(t2r.SpecError):
                    t2r.load_lexicon(write(obj))
            with self.assertRaises(t2r.SpecError):
                t2r.load_lexicon(write({"a": "x" * (t2r.MAX_LEXICON_BYTES + 5)}, "big.json"))

    @unittest.skipUnless(PIPER_MODEL and Path(PIPER_MODEL).is_file(), "needs TOPIC2REEL_PIPER_MODEL")
    def test_nukta_respelling_changes_the_phoneme_but_native_words_stay(self):
        lex = {"फिट": "फ़िट"}
        self.assertTrue(t2r.show_phonemes("फिट", PIPER_MODEL).startswith("pʰ"))
        self.assertTrue(t2r.show_phonemes("फिट", PIPER_MODEL, lex).startswith("f"))
        self.assertEqual(t2r.show_phonemes("फल", PIPER_MODEL, lex), t2r.show_phonemes("फल", PIPER_MODEL))


if __name__ == "__main__":
    unittest.main()
