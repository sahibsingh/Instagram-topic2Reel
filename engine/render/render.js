// Usage (called by topic2reel.py; env: SPEC_PATH, DURS=[seconds per scene]):
//   node render.js video out.mp4        -> silent 1080x1920 30fps MP4
//   STILLS='[1.2,5.0]' node render.js stills outdir -> PNG stills at those times
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { lockdown, launchOptions, CONTEXT_OPTIONS } = require('./lockdown');

const FPS = 30;
const MAX_FRAMES = FPS * 600;           // hard cap: 10 minutes of video
const [mode, out] = process.argv.slice(2);

function fail(msg) { console.error(msg); process.exit(2); }
if (!['video', 'stills'].includes(mode) || !out) fail('usage: render.js video|stills OUT');

const spec = JSON.parse(fs.readFileSync(process.env.SPEC_PATH, 'utf8'));
const durs = JSON.parse(process.env.DURS || 'null');
if (!Array.isArray(spec.scenes) || !Array.isArray(durs) || durs.length !== spec.scenes.length) fail('DURS must be an array with one entry per scene');
if (!durs.every(d => Number.isFinite(d) && d >= 0.5 && d <= 60)) fail('each scene duration must be between 0.5 and 60 seconds');
const frames = Math.round(durs.reduce((a, b) => a + b, 0) * FPS);
if (frames > MAX_FRAMES) fail('video too long');

(async () => {
  let browser;
  try { browser = await chromium.launch(launchOptions()); } catch (e) {
    console.error('Chromium could not start with its sandbox: ' + String(e.message).split('\n')[0]);
    console.error('If this host blocks user namespaces (some containers, Ubuntu 24.04), set TOPIC2REEL_NO_SANDBOX=1 after reading SECURITY.md.');
    process.exit(1);
  }
  const context = await browser.newContext(CONTEXT_OPTIONS);
  await lockdown(context);
  const page = await context.newPage();
  let failed = false;
  page.on('pageerror', e => { console.error('PAGE ERROR:', e.message); failed = true; });
  await page.goto('file://' + path.join(__dirname, 'reel.html'));
  await page.evaluate(([d, s]) => { window.DURS = d; window.SPEC = s; }, [durs, spec]);

  if (mode === 'stills') {
    const times = JSON.parse(process.env.STILLS || '[]');
    if (!Array.isArray(times) || !times.every(t => Number.isFinite(t) && t >= 0)) fail('STILLS must be an array of non-negative numbers');
    fs.mkdirSync(out, { recursive: true });
    for (const t of times) {
      const url = await page.evaluate(t => { window.renderAt(t); return document.getElementById('c').toDataURL('image/png'); }, t);
      fs.writeFileSync(path.join(out, `still_${t.toFixed(1).replace('.', '_')}.png`), Buffer.from(url.split(',')[1], 'base64'));
    }
  } else {
    const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '17', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out], { stdio: ['pipe', 'inherit', 'inherit'] });
    const done = new Promise(res => ff.on('close', res));
    for (let n = 0; n < frames; n++) {
      const url = await page.evaluate(t => { window.renderAt(t); return document.getElementById('c').toDataURL('image/jpeg', 0.96); }, n / FPS);
      if (!ff.stdin.write(Buffer.from(url.split(',')[1], 'base64'))) await new Promise(r => ff.stdin.once('drain', r));
      if (n % 150 === 0) console.log(`frame ${n}/${frames}`);
    }
    ff.stdin.end(); await done;
  }
  await browser.close();
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
