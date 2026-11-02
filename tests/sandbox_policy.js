// 1) The sandbox policy: on for normal users, off only for root or an explicit opt-out.
// 2) When this process is a normal user and has not opted out, really start Chromium and check its command line.
const { chromium } = require('playwright');
const { execSync } = require('child_process');
const { launchOptions } = require('../engine/render/lockdown');

function policy(uid, optOut) {
  const realUid = process.getuid, realEnv = process.env.TOPIC2REEL_NO_SANDBOX;
  process.getuid = () => uid;
  if (optOut) process.env.TOPIC2REEL_NO_SANDBOX = '1'; else delete process.env.TOPIC2REEL_NO_SANDBOX;
  const out = launchOptions().chromiumSandbox;
  process.getuid = realUid;
  if (realEnv === undefined) delete process.env.TOPIC2REEL_NO_SANDBOX; else process.env.TOPIC2REEL_NO_SANDBOX = realEnv;
  return out;
}

(async () => {
  const result = { policy: { user: policy(1000, false), root: policy(0, false), optOut: policy(1000, true) }, real: 'skipped' };
  if (process.getuid() !== 0 && process.env.TOPIC2REEL_NO_SANDBOX !== '1') {
    try {
      const b = await chromium.launch(launchOptions()); await b.newPage();
      const main = execSync("ps -eo args | grep -E 'headless_shell|chrome' | grep -v grep || true").toString().split('\n').filter(Boolean).find(l => !/--type=/.test(l)) || '';
      result.real = /--no-sandbox/.test(main) ? 'FAILED: browser runs with --no-sandbox' : 'ok: sandbox is on';
      await b.close();
    } catch (e) { result.real = 'FAILED: ' + String(e.message).split('\n')[0]; }
  }
  console.log(JSON.stringify(result));
  const ok = result.policy.user === true && result.policy.root === false && result.policy.optOut === false && !result.real.startsWith('FAILED');
  process.exit(ok ? 0 : 1);
})();
