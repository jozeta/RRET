/* ==========================================================================
   Shareable scenario sets (club / coach sessions)
   A link carries a seed plus the filters and field conditions; everyone who
   opens it gets the identical sequence of targets, distances and scenes.
   Only built-in targets are used, and distances are always rolled in metres,
   so the sequence is the same on every device and in either unit system.
   ========================================================================== */

import { StorageManager } from './storage.js';
import { createRng, filterTargetPool, buildScenario, DISTANCE_BANDS, ENVIRONMENTS } from './scenario-logic.js';
import { TARGET_CATEGORIES } from './targets.js';
import { toast } from './ui.js';

const REALISM = ['mirage', 'sway', 'grass', 'acquire', 'lowlight'];
const SIZES = [5, 10, 20];

/** Pure: parse "#simulator?set=abc&n=10&cats=..." into set parameters, or null. */
export function parseSetParams(hash) {
  const q = hash.split('?')[1];
  if (!q) return null;
  const p = new URLSearchParams(q);
  const seed = p.get('set');
  if (!seed || !/^[a-z0-9]{4,16}$/i.test(seed)) return null;
  const n = Number(p.get('n'));
  const cats = (p.get('cats') || '').split(',').filter(c => TARGET_CATEGORIES.includes(c) && c !== 'Custom');
  const band = DISTANCE_BANDS[p.get('band')] ? p.get('band') : 'any';
  const env = ENVIRONMENTS.includes(p.get('env')) ? p.get('env') : 'random';
  const fx = (p.get('fx') || '').split(',').filter(f => REALISM.includes(f));
  return { seed, count: SIZES.includes(n) ? n : 10, cats, band, env, fx };
}

/** Pure: build the hash for a set. */
export function setHash({ seed, count, cats, band, env, fx }) {
  const p = new URLSearchParams({ set: seed, n: String(count) });
  if (cats.length) p.set('cats', cats.join(','));
  if (band !== 'any') p.set('band', band);
  if (env !== 'random') p.set('env', env);
  if (fx.length) p.set('fx', fx.join(','));
  return `#simulator?${p.toString()}`;
}

/** Pure: the scenarios of a set, given the built-in target list. */
export function generateSet(params, builtIns) {
  const rng = createRng(params.seed);
  let pool = filterTargetPool(builtIns, { categories: params.cats, distance: params.band });
  if (pool.length === 0) pool = builtIns;
  const out = [];
  for (let i = 0; i < params.count; i++) {
    const target = pool[Math.floor(rng() * pool.length)];
    const s = buildScenario(target, { distance: params.band, unit: 'metric', environment: params.env, rng });
    s.id = `set_${params.seed}_${i + 1}`;
    out.push(s);
  }
  return out;
}

export class SharedSetController {
  constructor(app) {
    this.app = app;
    this.active = null; // { params, scenarios, index }
  }

  init() {
    const btn = document.getElementById('btn-share-set');
    if (btn) btn.addEventListener('click', () => this.share());
    const banner = document.getElementById('shared-set-banner');
    if (banner) banner.addEventListener('click', (e) => { if (e.target.closest('[data-leave-set]')) this.leave(); });
  }

  /** Called at start-up: starts a set if the URL carries one. Returns true if it did. */
  startFromHash(hash) {
    const params = parseSetParams(hash);
    if (!params) return false;
    const builtIns = this.app.targetsController.builtInTargets;
    if (!builtIns.length) return false;
    if (this.app.station.active) this.app.station.cancel();
    this.active = { params, scenarios: generateSet(params, builtIns), index: -1 };
    this.app.training.realism = new Set(params.fx);
    this.app.scope.setRealism(params.fx);
    document.querySelectorAll('#sim-realism input').forEach(cb => {
      cb.checked = params.fx.includes(cb.value);
      cb.closest('.realism-chip')?.classList.toggle('active', cb.checked);
    });
    this.next();
    toast(`Shared set loaded: ${params.count} targets. Everyone with this link gets the same ones.`, 'info', 6000);
    return true;
  }

  /** Advances to the next scenario of the set; returns false when the set is done. */
  next() {
    const a = this.active;
    if (!a) return false;
    if (a.index + 1 >= a.scenarios.length) {
      this.finish();
      return true;
    }
    a.index += 1;
    this.app.training.loadScenario({ ...a.scenarios[a.index], answered: false });
    this.renderBanner();
    return true;
  }

  results() {
    const a = this.active;
    const ids = new Set(a.scenarios.map(s => s.id));
    // newest first; keep the first answer per scenario
    const seen = new Set();
    return StorageManager.getHistory().filter(h => {
      if (!ids.has(h.scenarioId) || seen.has(h.scenarioId)) return false;
      seen.add(h.scenarioId);
      return true;
    });
  }

  finish() {
    const r = this.results();
    const n = this.active.scenarios.length;
    const within = r.filter(h => h.errorPct <= 5).length;
    const mean = r.length ? r.reduce((t, h) => t + h.errorPct, 0) / r.length : 0;
    const banner = document.getElementById('shared-set-banner');
    if (banner) {
      banner.hidden = false;
      banner.innerHTML = `<strong>Set complete.</strong> ${r.length} of ${n} answered, ${within} within 5%, mean error ${mean.toFixed(1)}%. <button type="button" class="btn-link-help" data-leave-set>Back to free practice</button>`;
    }
    this.active.index = n; // stays "done" until left
  }

  leave({ startNew = true } = {}) {
    this.active = null;
    const banner = document.getElementById('shared-set-banner');
    if (banner) { banner.hidden = true; banner.innerHTML = ''; }
    if (location.hash.includes('?')) history.replaceState(null, '', '#simulator');
    if (startNew) this.app.training.startNewScenario();
  }

  renderBanner() {
    const banner = document.getElementById('shared-set-banner');
    if (!banner || !this.active) return;
    const { index, scenarios } = this.active;
    banner.hidden = false;
    banner.innerHTML = `Shared set: target <strong>${index + 1} of ${scenarios.length}</strong>. <button type="button" class="btn-link-help" data-leave-set>Leave set</button>`;
  }

  /** Builds a link for a new set from the current filters and copies it. */
  async share() {
    const t = this.app.training;
    const count = Number(document.getElementById('share-set-size')?.value) || 10;
    const params = {
      seed: Math.random().toString(36).slice(2, 10),
      count,
      cats: [...t.categoryFilter].filter(c => c !== 'Custom'),
      band: t.distanceFilter,
      env: t.environmentPreference,
      fx: [...t.realism]
    };
    const url = `${location.origin}${location.pathname}${setHash(params)}`;
    const out = document.getElementById('share-set-link');
    if (out) { out.hidden = false; out.value = url; out.select(); }
    try {
      await navigator.clipboard.writeText(url);
      toast('Link copied. Send it to your club; everyone gets the same targets.', 'success', 6000);
    } catch (e) {
      toast('Copy the link from the box below the button.', 'info', 6000);
    }
  }
}

export const SHARE_SIZES = SIZES;
