// Defense in depth for the headless browser that draws the frames.
// The page only needs local files, so every other request is aborted. A Content-Security-Policy in reel.html
// (connect-src 'none') additionally blocks fetch / XHR / WebSocket from inside the page.
const path = require('path');

const ROOT = path.resolve(__dirname);
const LOCAL = 'file://' + ROOT;
const blocked = [];

async function lockdown(context) {
  await context.route('**/*', route => {
    const url = route.request().url();
    if (url.startsWith(LOCAL) || url.startsWith('data:') || url.startsWith('blob:') || url === 'about:blank') return route.continue();
    blocked.push(url);
    return route.abort('blockedbyclient');
  });
}

// Playwright starts Chromium with --no-sandbox unless chromiumSandbox is true, so the sandbox must be asked for explicitly.
// Chromium cannot use its sandbox as root (typical in containers), and some hosts block unprivileged user namespaces
// (for example Ubuntu 24.04); TOPIC2REEL_NO_SANDBOX=1 is the explicit, visible opt-out for those cases.
function launchOptions() {
  const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
  return { chromiumSandbox: !(isRoot || process.env.TOPIC2REEL_NO_SANDBOX === '1') };
}

const CONTEXT_OPTIONS = {
  viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1,
  serviceWorkers: 'block', acceptDownloads: false, permissions: [], javaScriptEnabled: true,
};

module.exports = { lockdown, launchOptions, CONTEXT_OPTIONS, blocked, ROOT };
