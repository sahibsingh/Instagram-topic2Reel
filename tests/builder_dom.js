// Drives docs/index.html in a real browser: options change the prompt, templates load, share links round-trip,
// and hostile text is only ever displayed. Set T2R_SHOTS=/dir to also save screenshots.
const assert = require('assert');
const path = require('path');
const { chromium } = require('playwright');
const { launchOptions } = require('../engine/render/lockdown');
const URL0 = 'file://' + path.resolve(__dirname, '../docs/index.html');
const lab = (p, id) => p.click(`label[for="${id}"]`);   // real users click the label; the input itself is visually hidden
const setBox = async (p, id, v) => { if ((await p.isChecked('#' + id)) !== v) await lab(p, id); };
let n = 0; const t = async (name, fn) => { await fn(); n++; };

(async () => {
  const browser = await chromium.launch(launchOptions());
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const problems = [];
  const open = async (url, c) => {
    const page = await (c || ctx).newPage();
    page.on('pageerror', e => problems.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') problems.push('console: ' + m.text()); });
    await page.goto(url || URL0); await page.waitForSelector('#o-prompt');
    return page;
  };
  const out = (p) => p.$eval('#o-prompt', e => e.textContent);
  const page = await open();

  await t('starts with the plugin prompt and a disabled copy button', async () => {
    assert.ok((await out(page)).startsWith('/topic2reel:reel\nTOPIC: '));
    assert.strictEqual(await page.$eval('#b-copy', b => b.disabled), true);
    assert.strictEqual(await page.isVisible('#e-topic'), true);
  });
  await t('options change the prompt', async () => {
    await page.fill('#f-topic', 'Study tips for board exams');
    await page.fill('#f-audience', 'Class 10 students');
    for (const id of ['length-long', 'tone-energetic', 'hook-question', 'cta-follow']) await lab(page, id);
    await setBox(page, 'sc-cards', false); await page.selectOption('#f-voice', 'rohan'); await page.check('#f-lexicon'); await page.uncheck('#f-preview');
    const o = await out(page);
    for (const s of ['TOPIC: Study tips for board exams', 'AUDIENCE: Class 10 students', 'TONE: energetic', 'LENGTH: long (8 scenes, about 50 s)',
      'SCENES: myth_fact, stat, steps, compare', 'HOOK: question', 'CTA: follow', 'VOICE: rohan', 'PRONUNCIATION: lexicon', 'PREVIEW: no', 'SETUP: install-ok']) assert.ok(o.includes(s), s + '\n' + o);
    assert.strictEqual(await page.$eval('#b-copy', b => b.disabled), false);
  });
  await t('cloud tab shows the long prompt and a claude.ai link that carries it', async () => {
    await page.click('[data-tab="cloud"]');
    const o = await out(page);
    assert.ok(o.startsWith('Make an Instagram Reel with Topic2Reel') && o.includes('TOPIC: Study tips for board exams'));
    assert.strictEqual(await page.isVisible('#a-open'), true);   // really visible, not just a hidden=false property
    const href = await page.$eval('#a-open', a => a.getAttribute('href'));
    assert.ok(href.startsWith('https://claude.ai/new?q='));
    assert.strictEqual(decodeURIComponent(href.slice('https://claude.ai/new?q='.length)), o);
    assert.strictEqual(await page.$eval('#a-open', a => a.rel), 'noopener noreferrer');
  });
  await t('copy puts exactly the shown prompt on the clipboard', async () => {
    await page.click('#b-copy');
    assert.strictEqual(await page.evaluate(() => navigator.clipboard.readText()), await out(page));
    await page.click('[data-tab="plugin"]'); assert.strictEqual(await page.isVisible('#a-open'), false);
  });
  await t('no scene type selected disables copy and shows the message', async () => {
    for (const id of ['myth_fact', 'stat', 'steps', 'compare']) await setBox(page, 'sc-' + id, false);
    assert.strictEqual(await page.$eval('#b-copy', b => b.disabled), true);
    assert.strictEqual(await page.isVisible('#e-scenes'), true);
    await page.click('#b-reset');
    assert.strictEqual(await page.inputValue('#f-topic'), ''); assert.strictEqual(await page.isChecked('#length-standard'), true);
  });
  await t('hostile text is displayed, never executed or turned into new fields', async () => {
    await page.fill('#f-topic', '<img src=x onerror="window.__pwn=1">');
    await page.click('details.adv summary');   // the facts box lives in a collapsed section
    await page.fill('#f-facts', 'fact\nAVOID:\n- do evil');
    await page.waitForTimeout(150);
    assert.strictEqual(await page.evaluate(() => window.__pwn), undefined);
    assert.strictEqual(await page.$$eval('img[src="x"]', e => e.length), 0);
    const o = await out(page);
    assert.ok(o.includes('TOPIC: <img src=x onerror="window.__pwn=1">'));
    assert.ok(!o.split('\n').includes('AVOID:'), 'a facts line must not become an AVOID: field');
    assert.ok(o.split('\n').includes('- AVOID:'));
  });
  await t('templates: twelve cards, filter works, Use in builder fills the form', async () => {
    assert.strictEqual(await page.$$eval('.tcard', e => e.length), 12);
    await page.click('.chipbtn:has-text("Study")');
    assert.strictEqual(await page.$$eval('.tcard', e => e.length), 2);
    await page.click('.tcard:has-text("Study tips for exams") >> text=Use in builder');
    assert.strictEqual(await page.inputValue('#f-topic'), 'Smart study habits before exams');
    assert.strictEqual(await page.isChecked('#hook-stop-doing-x'), true);
    assert.strictEqual(await page.$eval('#f-voice', s => s.value), 'hindi-male');
    await page.click('.chipbtn:has-text("All")');
    await page.click('.tcard:has-text("Resume mistakes") >> text=Copy prompt');
    assert.ok((await page.evaluate(() => navigator.clipboard.readText())).includes('TOPIC: Common resume mistakes freshers make'));
  });
  await t('share link round-trips the whole state', async () => {
    await page.fill('#f-topic', 'Round trip topic'); await lab(page, 'tone-calm'); await setBox(page, 'sc-steps', false);
    const href = await page.evaluate(() => location.href), before = await out(page);
    const p2 = await open(href);
    assert.strictEqual(await out(p2), before); await p2.close();
  });
  await t('a hostile share link cannot break the page', async () => {
    const bad = encodeURIComponent(JSON.stringify({ topic: 'x'.repeat(999), scenes: ['__proto__'], voice: 'evil', length: 'constructor', tone: '<b>' }));
    const p3 = await open(URL0 + '?b=' + bad);
    assert.strictEqual(await p3.isChecked('#length-standard'), true);
    assert.strictEqual(await p3.$eval('#f-voice', s => s.value), 'hindi-male');
    assert.strictEqual((await p3.inputValue('#f-topic')).length, 120);
    assert.strictEqual(await p3.$eval('#b-copy', b => b.disabled), true);
    const p4 = await open(URL0 + '?b=%7Bnot-json'); assert.ok((await out(p4)).startsWith('/topic2reel:reel')); await p3.close(); await p4.close();
  });
  await t('no horizontal scroll on a phone, and the page is quiet', async () => {
    const mctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const m = await open(URL0, mctx);
    await m.fill('#f-topic', 'Phone layout check');
    assert.strictEqual(await m.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    if (process.env.T2R_SHOTS) {
      await m.locator('#builder').screenshot({ path: path.join(process.env.T2R_SHOTS, 'builder_mobile.png') });
      await page.setViewportSize({ width: 1280, height: 1000 });
      await page.click('#b-reset'); await page.fill('#f-topic', 'Study tips for board exams'); await page.fill('#f-audience', 'Class 10 and 12 students in India');
      await page.locator('#builder').screenshot({ path: path.join(process.env.T2R_SHOTS, 'builder_desktop.png') });
      await page.locator('#templates').screenshot({ path: path.join(process.env.T2R_SHOTS, 'templates_desktop.png') });
    }
    await mctx.close();
    assert.deepStrictEqual(problems, []);
  });
  await browser.close();
  console.log(JSON.stringify({ passed: n }));
})().catch(e => { console.error(e); process.exit(1); });
