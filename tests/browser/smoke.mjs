#!/usr/bin/env node
// Browser smoke tests (TEST-001, TEST-002, TEST-009). Zero dependencies: a tiny
// static server plus Chrome driven over the DevTools protocol with Node's
// built-in WebSocket (Node >= 22).
//
//   node tests/browser/smoke.mjs                      # finds Chrome automatically
//   CHROME_PATH=/path/to/chrome node tests/browser/smoke.mjs
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, extname, normalize } from 'node:path';
import { tmpdir, homedir } from 'node:os';

const ROOT = new URL('../..', import.meta.url).pathname;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ---- static server ---------------------------------------------------------
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff', '.webmanifest': 'application/manifest+json' };
const server = createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path.endsWith('/')) path += 'index.html';
    const file = normalize(join(ROOT, path));
    if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(body);
  } catch { res.writeHead(404).end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/`;

// ---- Chrome over CDP --------------------------------------------------------
function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    join(homedir(), 'Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell')
  ];
  return candidates.find(p => p && existsSync(p));
}
const chromePath = findChrome();
if (!chromePath) { console.error('No Chrome found; set CHROME_PATH.'); process.exit(2); }

const profile = await mkdtemp(join(tmpdir(), 'rret-smoke-'));
const port = 9400 + Math.floor(Math.random() * 400);
const chrome = spawn(chromePath, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-gpu', 'about:blank'], { stdio: 'ignore' });

let targets;
for (let i = 0; i < 60; i++) {
  try { targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); if (targets.some(t => t.type === 'page')) break; } catch {}
  await sleep(250);
}
const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r, { once: true }));
let msgId = 0; const pending = new Map(); const pageErrors = [];
ws.addEventListener('message', (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
  if (msg.method === 'Runtime.exceptionThrown') pageErrors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') pageErrors.push(msg.params.args.map(a => a.value ?? a.description).join(' '));
  if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') pageErrors.push(`${msg.params.entry.text} ${msg.params.entry.url || ''}`);
});
const send = (method, params = {}) => new Promise((res, rej) => {
  const i = ++msgId; pending.set(i, (msg) => msg.error ? rej(new Error(`${method}: ${msg.error.message}`)) : res(msg.result));
  ws.send(JSON.stringify({ id: i, method, params }));
});
const evaluate = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};
const viewport = (width, height, dpr = 1, mobile = false) => send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: dpr, mobile });
const rectOf = (sel) => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); el.scrollIntoView({ block: 'center', behavior: 'instant' }); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
async function click(sel) {
  const { x, y } = await rectOf(sel);
  for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
  await sleep(60);
}
async function key(k, code, keyCode) {
  for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: k, code, windowsVirtualKeyCode: keyCode, text: type === 'keyDown' && k === 'Enter' ? '\r' : undefined });
  await sleep(60);
}
async function typeText(text) { await send('Input.insertText', { text }); }
async function load(hash = 'simulator', { clear = true } = {}) {
  if (clear) { await send('Page.navigate', { url: BASE }); await waitForApp(); await evaluate('localStorage.clear()'); }
  await send('Page.navigate', { url: `${BASE}?t=${Date.now()}#${hash}` });
  await waitForApp();
  await evaluate(`window.confirm = () => true;`);
}
async function waitForApp() {
  for (let i = 0; i < 80; i++) {
    try { if (await evaluate('!!(window.app && app.training && app.training.currentScenario)')) return; } catch {}
    await sleep(100);
  }
  throw new Error('app did not initialise');
}
const rounds = () => evaluate(`JSON.parse(localStorage.getItem('rret_history_v1') || '[]').length`);

await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
await viewport(1400, 1000);

// ---- tests ------------------------------------------------------------------
const results = [];
async function check(name, fn) {
  const before = pageErrors.length;
  try {
    await fn();
    if (pageErrors.length > before) throw new Error(`page errors: ${pageErrors.slice(before).join(' | ')}`);
    results.push([true, name]);
    console.log(`  ok   ${name}`);
  } catch (e) {
    results.push([false, name]);
    console.log(`  FAIL ${name}\n       ${e.message}`);
  }
}
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

await check('app loads without console errors', async () => {
  await load();
  assert(await evaluate(`document.querySelector('.page-view.active').id`) === 'page-simulator', 'simulator not shown');
});

await check('TEST-001: every procedural shape fills its declared box (BUG-001)', async () => {
  const short = await evaluate(`(async () => {
    const { renderTargetSVGString } = await import('./js/utils.js');
    const types = [...new Set(app.targetsController.builtInTargets.map(t => t.svgType))];
    const out = [];
    for (const t of types) {
      const target = app.targetsController.builtInTargets.find(x => x.svgType === t);
      const S = 400;
      const url = URL.createObjectURL(new Blob([renderTargetSVGString({ ...target }, S, S)], { type: 'image/svg+xml' }));
      const img = new Image(); await new Promise(r => { img.onload = r; img.src = url; });
      const c = new OffscreenCanvas(S, S); const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, S, S).data;
      let x0 = S, y0 = S, x1 = -1, y1 = -1;
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if (d[(y * S + x) * 4 + 3] > 40) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      const w = (x1 - x0 + 1) / S, h = (y1 - y0 + 1) / S;
      if (w < 0.99 || h < 0.99) out.push(t + ' ' + w.toFixed(2) + 'x' + h.toFixed(2));
    }
    return out;
  })()`);
  assert(short.length === 0, `shapes not filling their box: ${short.join(', ')}`);
});

await check('TEST-002: one click on SUBMIT records exactly one round (BUG-002)', async () => {
  await load();
  await click('#sim-estimated-distance');
  await typeText(String(await evaluate('Math.round(app.training.currentScenario.distance)')));
  await click('#btn-submit-estimate');
  assert(await rounds() === 1, `expected 1 round, got ${await rounds()}`);
});

await check('TEST-002: answered scenario cannot be scored again (BUG-003)', async () => {
  await evaluate(`app.training.submitAnswer(); document.getElementById('sim-estimate-form').requestSubmit();`);
  assert(await rounds() === 1, `expected 1 round, got ${await rounds()}`);
  assert(await evaluate(`document.getElementById('btn-submit-estimate').disabled`), 'submit not disabled');
});

await check('Enter key submits once', async () => {
  await click('#btn-next-scenario');
  await click('#sim-estimated-distance');
  await typeText('300');
  await key('Enter', 'Enter', 13);
  assert(await rounds() === 2, `expected 2 rounds, got ${await rounds()}`);
});

await check('category filter does not break zoom; highlight survives zoom changes (BUG-004)', async () => {
  await load();
  await click('#sim-category-filter-buttons [data-category="Steel"]');
  const z = await evaluate('app.scope.zoom');
  assert(Number.isFinite(z), `zoom is ${z}`);
  await click('#zoom-presets [data-zoom="10"]');
  assert(await evaluate(`document.querySelector('#sim-category-filter-buttons [data-category="Steel"]').classList.contains('active')`), 'Steel highlight lost');
});

await check('impossible filter combo keeps the scenario and says so (BUG-005)', async () => {
  await load();
  await evaluate(`app.training.categoryFilter = new Set(['Hunting']); app.training.renderCategoryFilterUI(); app.training.setDistanceFilter('long');`);
  const before = await evaluate('app.training.currentScenario.id');
  await click('#btn-next-scenario');
  assert(await evaluate('app.training.currentScenario.id') === before, 'scenario changed despite empty pool');
  assert(/No targets match/.test(await evaluate(`document.getElementById('sim-filter-status').textContent`)), 'no status message');
  const pool = await evaluate(`app.training.getFilteredTargetPool().length`);
  assert(pool === 0, 'pool not empty');
});

await check('filters persist across reloads (BUG-017)', async () => {
  await load('simulator', { clear: false });
  assert(await evaluate(`app.training.categoryFilter.has('Hunting') && app.training.distanceFilter === 'long'`), 'filters not restored');
});

await check('browser Back returns to the previous page (BUG-009)', async () => {
  await load('home');
  await click('.nav-link-tactical[data-page-target="targets"]');
  await sleep(150);
  await evaluate('history.back()');
  await sleep(300);
  assert(await evaluate(`document.querySelector('.page-view.active').id`) === 'page-home', 'still on targets');
});

await check('arrow keys pan the scope while the empty answer box is focused (BUG-011)', async () => {
  await load();
  await click('#sim-estimated-distance');
  const before = await evaluate('app.scope.panY');
  await key('ArrowUp', 'ArrowUp', 38);
  assert(await evaluate('app.scope.panY') !== before, 'did not pan');
  assert(await evaluate(`document.getElementById('sim-estimated-distance').value`) === '', 'answer changed');
});

await check('gentle trackpad scroll changes zoom gently (BUG-012)', async () => {
  await evaluate('app.scope.setZoom(5)');
  const { x, y } = await rectOf('#scope-viewport');
  for (let i = 0; i < 12; i++) await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY: -4 });
  await sleep(100);
  const z = await evaluate('app.scope.zoom');
  assert(z > 5 && z < 6, `zoom ${z}`);
});

await check('HiDPI canvas is backed by device pixels (BUG-013)', async () => {
  await viewport(1400, 1000, 2);
  await evaluate(`window.dispatchEvent(new Event('resize'))`);
  await sleep(250);
  const r = await evaluate(`(() => { const c = document.getElementById('scope-canvas'); return c.width / c.getBoundingClientRect().width; })()`);
  await viewport(1400, 1000, 1);
  assert(Math.abs(r - 2) < 0.02, `backing ratio ${r}`);
});

await check('scenery moves with the target when panning (UI-008)', async () => {
  const moved = await evaluate(`(() => {
    const s = app.scope; s.setZoom(10); s.render();
    const g0 = s.scene.groundY; const x0 = s.scene.x(0);
    s.panByPixels(-90, 40); s.render();
    return { dy: s.scene.groundY - g0, dx: s.scene.x(0) - x0 };
  })()`);
  assert(Math.abs(moved.dx + 90) < 0.5 && Math.abs(moved.dy - 40) < 0.5, JSON.stringify(moved));
});

await check('result card uses the active unit (BUG-010)', async () => {
  await load();
  await evaluate(`app.settingsController.settings = app.storage.saveSettings({ unit: 'imperial' }); app.training.refreshUnits();`);
  await click('#sim-estimated-distance');
  await typeText('300');
  await click('#btn-submit-estimate');
  const txt = await evaluate(`document.getElementById('res-error-m').textContent + ' | ' + document.getElementById('res-math-breakdown').textContent`);
  assert(/yd/.test(txt) && !/ m \(/.test(txt), txt);
});

await check('coach mode shows reading vs maths error (FEAT-003)', async () => {
  await load();
  await click('#sim-coach-toggle');
  await click('#sim-mil-reading');
  await typeText(String(await evaluate('app.training.currentScenario.milHeight.toFixed(2)')));
  await click('#sim-estimated-distance');
  await typeText('250');
  await click('#btn-submit-estimate');
  const text = await evaluate(`document.getElementById('res-coach').textContent`);
  assert(/Reading:/.test(text) && /Maths:/.test(text), text);
  assert(await evaluate('app.scope.truthOverlay'), 'truth brackets not shown');
});

await check('custom preset target is stored as a vector shape (BUG-015)', async () => {
  await load('targets');
  await click('#btn-new-target');
  await sleep(500);
  await click('#target-name'); await typeText('Smoke plate');
  await click('#target-height'); await typeText('0.3');
  await click('#target-width'); await typeText('0.3');
  await click('#target-form button[type="submit"]');
  await sleep(300);
  const t = await evaluate(`JSON.parse(localStorage.getItem('rret_custom_targets_v1')).find(t => t.name === 'Smoke plate')`);
  assert(t && t.type === 'svg_shape' && !t.imageData, JSON.stringify(t));
});

await check('export -> import round trip is idempotent (BUG-006)', async () => {
  const counts = await evaluate(`(async () => {
    const before = app.targetsController.allTargets.length;
    app.targetsController.importTargetsFromText(JSON.stringify(app.targetsController.allTargets));
    app.targetsController.importTargetsFromText(JSON.stringify(app.targetsController.customTargets));
    const ids = app.targetsController.allTargets.map(t => t.id);
    return { before, after: ids.length, dup: ids.length - new Set(ids).size };
  })()`);
  assert(counts.after === counts.before && counts.dup === 0, JSON.stringify(counts));
});

await check('station mode: answer every figure, get a summary, rounds recorded (FEAT-004)', async () => {
  await load();
  await click('[data-sim-mode="station"]');
  await evaluate(`document.getElementById('station-figures').value = '3'`);
  await click('#station-start');
  for (let i = 0; i < 3; i++) {
    await click('#sim-estimated-distance');
    await typeText('200');
    await click('#btn-submit-estimate');
  }
  assert(/Station complete/.test(await evaluate(`document.getElementById('station-body').textContent`)), 'no summary');
  const station = await evaluate(`JSON.parse(localStorage.getItem('rret_history_v1')).filter(h => h.mode === 'station').length`);
  assert(station === 3, `station rounds ${station}`);
});

await check('analytics render after a few rounds (FEAT-006)', async () => {
  await click('.nav-link-tactical[data-page-target="home"]');
  await sleep(300);
  assert(await evaluate(`document.querySelectorAll('#analytics-container svg .chart-bar').length`) > 0, 'no bars');
});

await check('realistic optics uses the calibration (FEAT-001)', async () => {
  const ppm = await evaluate(`(() => { app.scope.updateSettings({ opticsMode: 'realistic', screenPxPerMm: 4, viewingDistanceCm: 50, scopeProfile: 'precision' }); const v = { ppm: app.scope.pxPerMILAt(10), min: app.scope.minZoom }; app.scope.updateSettings({ opticsMode: 'arcade' }); return v; })()`);
  assert(Math.abs(ppm.ppm - 20) < 1e-9 && ppm.min === 5, JSON.stringify(ppm));
});

await check('phone layout: answer bar visible with the scope, no sideways scroll, menu closes (UI-001, BUG-016)', async () => {
  await viewport(390, 844, 2, true);
  await load('home');
  await click('.navbar-toggler');
  await sleep(400);
  await click('#navbarContent [data-page-target="simulator"]');
  await sleep(500);
  const r = await evaluate(`(() => {
    const bar = document.getElementById('sim-estimate-form').getBoundingClientRect();
    const scope = document.getElementById('scope-viewport').getBoundingClientRect();
    return { barTop: bar.top, barBottom: bar.bottom, scopeTop: scope.top, h: innerHeight, overflow: document.documentElement.scrollWidth - innerWidth, menuOpen: document.getElementById('navbarContent').classList.contains('show') };
  })()`);
  await viewport(1400, 1000);
  assert(!r.menuOpen, 'menu still open');
  assert(r.overflow <= 0, `horizontal overflow ${r.overflow}px`);
  assert(r.barBottom <= r.h + 1 && r.barTop > r.scopeTop, JSON.stringify(r));
});

await check('works offline after the first visit (FEAT-008)', async () => {
  await load('home');
  await evaluate(`navigator.serviceWorker.ready.then(() => new Promise(r => setTimeout(r, 1500)))`);
  await send('Network.enable');
  await send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  try {
    await send('Page.navigate', { url: `${BASE}#simulator` });
    await waitForApp();
  } finally {
    await send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  }
  // Offline fetch failures logged by the browser are expected here.
  pageErrors.length = 0;
});

// ---- teardown ---------------------------------------------------------------
ws.close();
chrome.kill('SIGKILL');
server.close();
await rm(profile, { recursive: true, force: true }).catch(() => {});
const failed = results.filter(r => !r[0]);
console.log(`\n${results.length - failed.length}/${results.length} browser checks passed`);
process.exit(failed.length ? 1 : 0);
