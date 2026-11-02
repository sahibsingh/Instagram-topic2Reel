// Proves the render browser cannot reach the network, and that BOTH protection layers are really active.
// The machine running this may have no internet at all, so "request failed" alone proves nothing. We count:
//   csp_violations  -> the page's Content-Security-Policy refused the request (layer 1)
//   route_blocked   -> Playwright's route handler aborted the request (layer 2, tested on a page WITHOUT a CSP)
const { chromium } = require('playwright');
const path = require('path');
const { lockdown, launchOptions, CONTEXT_OPTIONS, blocked } = require('../engine/render/lockdown');

const attempts = () => new Promise(resolve => {
  const wait = setup => new Promise(r => { const t = setTimeout(() => r('TIMEOUT'), 8000); setup(v => { clearTimeout(t); r(v); }); });
  Promise.all([
    fetch('https://example.com/x').then(() => 'LOADED', () => 'BLOCKED'),
    wait(done => { try { const w = new WebSocket('wss://example.com'); w.onopen = () => done('LOADED'); w.onerror = () => done('BLOCKED'); } catch { done('BLOCKED'); } }),
    wait(done => { const i = new Image(); i.onload = () => done('LOADED'); i.onerror = () => done('BLOCKED'); i.src = 'https://example.com/a.png'; }),
    wait(done => { const s = document.createElement('script'); s.onload = () => done('LOADED'); s.onerror = () => done('BLOCKED'); s.src = 'https://example.com/a.js'; document.head.appendChild(s); }),
  ]).then(([fetchR, websocket, image, script]) => resolve({ fetch: fetchR, websocket, image, script }));
});

(async () => {
  const browser = await chromium.launch(launchOptions());
  const context = await browser.newContext(CONTEXT_OPTIONS);
  await lockdown(context);

  // Phase 1: the real render page (has the CSP)
  const p1 = await context.newPage();
  let csp = 0;
  p1.on('console', m => { if (/Content Security Policy/i.test(m.text())) csp++; });
  await p1.goto('file://' + path.resolve(__dirname, '../engine/render/reel.html'));
  const phase1 = await p1.evaluate(attempts);

  // Phase 2: a page with no CSP, so only the route handler stands in the way
  const p2 = await context.newPage();
  await p2.setContent('<!doctype html><html><head></head><body></body></html>');
  const phase2 = await p2.evaluate(attempts);

  const out = { phase1, phase2, csp_violations: csp, route_blocked: blocked.length };
  console.log(JSON.stringify(out));
  await browser.close();
  const allBlocked = [...Object.values(phase1), ...Object.values(phase2)].every(v => v === 'BLOCKED');
  process.exit(allBlocked && csp >= 1 && blocked.length >= 1 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
