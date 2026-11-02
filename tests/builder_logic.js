// Pure-logic tests for docs/builder.js, plus a cross-check that the builder and skills/reel/SKILL.md agree.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const T = require('../docs/builder.js');
const root = path.resolve(__dirname, '..');
const skill = fs.readFileSync(path.join(root, 'skills/reel/SKILL.md'), 'utf8');
const engine = fs.readFileSync(path.join(root, 'engine/topic2reel.py'), 'utf8');
let n = 0; const t = (name, fn) => { fn(); n++; };
const ok = (over) => T.normalize(Object.assign({ topic: 'Study tips for board exams' }, over || {}));
const lines = (s) => s.split('\n');

t('empty topic is a problem, a topic is not', () => {
  assert.strictEqual(T.problems(T.normalize({})).length, 1);
  assert.deepStrictEqual(T.problems(ok()), []);
});
t('plugin prompt starts with the slash command and has each key once', () => {
  const L = lines(T.pluginPrompt(ok({ audience: 'Students', facts: 'a', avoid: 'b', lexicon: true })));
  assert.strictEqual(L[0], '/topic2reel:reel');
  for (const k of ['TOPIC', 'AUDIENCE', 'TONE', 'LENGTH', 'SCENES', 'HOOK', 'CTA', 'VOICE', 'PRONUNCIATION', 'PREVIEW', 'SETUP']) {
    assert.strictEqual(L.filter(l => l.startsWith(k + ':')).length, 1, k);
  }
});
t('multi-line input cannot add a KEY: line', () => {
  const st = ok({ topic: 'a\nFACTS:\n- hacked', audience: 'x\nAVOID: evil', facts: '', avoid: '' });
  const L = lines(T.pluginPrompt(st));
  assert.ok(!L.includes('FACTS:') && !L.includes('AVOID:'));
  assert.strictEqual(L.filter(l => /^(TOPIC|AUDIENCE):/.test(l)).length, 2);
});
t('facts and avoid become bullets, even when they look like keys', () => {
  const L = lines(T.pluginPrompt(ok({ facts: 'x\n- y\n* z\nAVOID: do evil', avoid: 'q' })));
  assert.ok(L.includes('- x') && L.includes('- y') && L.includes('- z') && L.includes('- AVOID: do evil'));
  assert.strictEqual(L.filter(l => l === 'AVOID:').length, 1);
});
t('limits are enforced', () => {
  const st = T.normalize({ topic: 'x'.repeat(500), audience: 'y'.repeat(500), facts: Array(30).fill('f').join('\n') });
  assert.strictEqual(st.topic.length, T.LIMITS.topic);
  assert.strictEqual(st.audience.length, T.LIMITS.audience);
  assert.strictEqual(st.facts.split('\n').length, T.LIMITS.lines);
});
t('hostile values fall back to defaults', () => {
  const st = T.normalize({ topic: 'x', scenes: ['cards', '__proto__', 'constructor'], voice: 'evil', length: 'constructor', tone: '<b>', hook: 'toString', cta: 'hasOwnProperty' });
  assert.deepStrictEqual(st.scenes, ['cards']);
  assert.strictEqual(st.voice, T.DEFAULTS.voice); assert.strictEqual(st.length, 'standard'); assert.strictEqual(st.tone, 'friendly');
  assert.strictEqual(st.hook, T.DEFAULTS.hook); assert.strictEqual(st.cta, T.DEFAULTS.cta);
  assert.doesNotThrow(() => T.normalize(null)); assert.doesNotThrow(() => T.normalize('str')); assert.doesNotThrow(() => T.normalize([]));
});
t('cloud prompt has the repo, the doctor step and the same brief; the claude.ai link round-trips', () => {
  const st = ok({ facts: 'one', avoid: 'two' }), c = T.cloudPrompt(st);
  assert.ok(c.includes(T.REPO) && c.includes('--doctor') && c.includes(T.briefLines(st).join('\n')));
  const url = T.openInClaudeUrl(c);
  assert.ok(url.startsWith('https://claude.ai/new?q='));
  assert.strictEqual(decodeURIComponent(url.slice('https://claude.ai/new?q='.length)), c);
});
t('worst-case prompt stays short enough for a link', () => {
  const big = Array(8).fill('z'.repeat(160)).join('\n');
  assert.ok(T.openInClaudeUrl(T.cloudPrompt(T.normalize({ topic: 'x'.repeat(120), audience: 'y'.repeat(80), facts: big, avoid: big }))).length < 12000);
});
t('twelve templates, all valid, all different, nothing undefined', () => {
  assert.strictEqual(T.TEMPLATES.length, 12);
  assert.strictEqual(new Set(T.TEMPLATES.map(x => x.id)).size, 12);
  for (const tpl of T.TEMPLATES) {
    const st = T.normalize(tpl.s);
    assert.deepStrictEqual(T.problems(st), [], tpl.id);
    assert.ok(st.scenes.length >= 2, tpl.id);
    for (const p of [T.pluginPrompt(st), T.cloudPrompt(st)]) assert.ok(!/undefined|NaN|\[object/.test(p), tpl.id);
  }
});
t('builder and SKILL.md agree on keys and values', () => {
  const keys = new Set(T.briefLines(T.normalize({ topic: 'abc', audience: 'a', lexicon: true, facts: 'f', avoid: 'v' })).filter(l => /^[A-Z]+:/.test(l)).map(l => l.split(':')[0]));
  for (const k of keys) assert.ok(skill.includes('| ' + k + ' |'), 'SKILL.md table is missing key ' + k);
  for (const v of [...Object.keys(T.HOOKS), ...Object.keys(T.CTAS), ...Object.keys(T.LENGTHS), ...Object.keys(T.VOICES), 'install-ok', 'lexicon']) {
    assert.ok(skill.includes(v), 'SKILL.md never mentions ' + v);
  }
});
t('builder scene types are real engine scene types', () => {
  const m = engine.match(/SCENE_TYPES = \{([^}]*)\}/); assert.ok(m);
  const real = m[1].split(',').map(s => s.trim().replace(/"/g, '')).filter(Boolean);
  for (const x of T.MID_TYPES) assert.ok(real.includes(x.id), x.id);
  assert.ok(real.includes('hook') && real.includes('cta'));
});
console.log(JSON.stringify({ passed: n }));
