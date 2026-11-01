// TEST-005 (reticle geometry), TEST-007 (data integrity), coach + analytics maths.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { RETICLE_DESIGNS, RETICLE_CATALOG, reticleItems, reticleSVG } from '../js/reticle-designs.js';
import { TARGET_CATEGORIES, CUSTOM_TARGET_SHAPES } from '../js/targets.js';
import { diagnoseEstimate, classifyMistake } from '../js/coach.js';
import { computeAnalytics, bandOf } from '../js/analytics.js';
import { ART_TYPES } from '../js/target-art.js';
const hasRenderer = (t) => ART_TYPES.has(t) || utilsSrc.includes(`case '${t}'`);

const targets = JSON.parse(readFileSync(new URL('../data/targets.json', import.meta.url)));
const reticles = RETICLE_CATALOG;
const utilsSrc = readFileSync(new URL('../js/utils.js', import.meta.url), 'utf8');

// Reticle geometry is pure MIL data: positions are checked exactly.
const HI = 200; // px per MIL: high magnification, every subdivision drawn
const ticksOnHorizontal = (id, ppm = HI) => [...new Set(reticleItems(id, ppm)
  .filter(it => it.t === 'line' && it.kind === 'tick' && Math.abs(it.x1 - it.x2) < 1e-9 && it.y1 <= 0 && it.y2 >= 0 && it.x1 > 0)
  .map(it => +it.x1.toFixed(6)))].sort((a, b) => a - b);
const near = (a, b) => Math.abs(a - b) < 1e-6;

test('Tremor-style ruler has a tick every 0.2 MIL out to 3.0 MIL (BUG-008)', () => {
  assert.deepEqual(ticksOnHorizontal('tremor_style'), Array.from({ length: 15 }, (_, k) => +((k + 1) / 5).toFixed(6)));
});

test('mil-dot dots sit exactly 1 MIL apart, posts start at 5 MIL', () => {
  const items = reticleItems('mil_dot', HI);
  const dots = items.filter(it => it.t === 'dot' && it.y === 0 && it.x > 0).map(it => it.x).sort((a, b) => a - b);
  assert.deepEqual(dots, [1, 2, 3, 4]);
  const posts = items.filter(it => it.kind === 'post');
  assert.ok(posts.some(p => near(p.x2, -5) || near(p.x1, 5)));
});

test('½-MIL hash reticle: hashes every 0.5 MIL to 10 MIL', () => {
  assert.deepEqual(ticksOnHorizontal('mil_hash'), Array.from({ length: 20 }, (_, k) => (k + 1) / 2));
});

test('fine milling reticle: 0.2 MIL hashes at high power, hidden when they would merge', () => {
  assert.equal(ticksOnHorizontal('fine_milling').length, 50);
  const low = ticksOnHorizontal('fine_milling', 10); // 0.2 MIL = 2 px: too close
  assert.deepEqual(low, Array.from({ length: 10 }, (_, k) => k + 1));
});

test('ranging scale: 50 graduations of 0.1 MIL above the zero bar', () => {
  const items = reticleItems('ranging_ladder', HI).filter(it => it.kind === 'tick' && near(it.x1, -7) && it.x2 > -7);
  const heights = items.map(it => +(6 - it.y1).toFixed(6)).sort((a, b) => a - b);
  assert.deepEqual(heights, Array.from({ length: 50 }, (_, k) => +((k + 1) / 10).toFixed(6)));
});

test('rangefinder curve: gap above the baseline equals 1.7 m at each marked distance', () => {
  const items = reticleItems('pso1_rangefinder', HI);
  const curve = items.find(it => it.t === 'path' && it.points.length > 50);
  const xOf = (d) => -10 + ((d - 200) / 800) * 8;
  for (const d of [200, 300, 400, 600, 800, 1000]) {
    const pt = curve.points.find(([x]) => near(x, xOf(d)));
    assert.ok(pt, `no curve point at ${d} m`);
    assert.ok(near(5 - pt[1], 1700 / d), `${d} m: gap ${5 - pt[1]} MIL, expected ${1700 / d}`);
  }
});

test('every reticle has complete help and a correct worked example', () => {
  for (const d of RETICLE_DESIGNS) {
    assert.ok(d.summary.length > 40, `${d.id} summary`);
    assert.ok(d.marks.length >= 2 && d.measure.length >= 3, `${d.id} help lists`);
    assert.ok(/MIL/.test(d.scale), `${d.id} scale`);
    const ex = d.example;
    assert.ok(ex && ex.note, `${d.id} example`);
    if (ex.rangefinder) continue;
    const dist = (ex.sizeM * 1000) / ex.mil;
    const nums = [...ex.note.matchAll(/(\d+(?:\.\d+)?) m\b/g)].map(m => Number(m[1]));
    assert.ok(nums.some(n => Math.abs(n - dist) <= 1), `${d.id}: note says ${ex.note}, maths gives ${dist.toFixed(1)} m`);
  }
});

test('reticle SVG renders every design with no NaN and thin lines', () => {
  for (const d of RETICLE_DESIGNS) {
    for (const ppm of [2.3, 14, 57, 450]) {
      const svg = reticleSVG(d.id, { ppm, cx: 300, cy: 300 });
      assert.ok(!/NaN|undefined/.test(svg), `${d.id} @ ${ppm}`);
      const widths = [...svg.matchAll(/<line [^>]*stroke-width="([\d.]+)"(?![^>]*butt)/g)].map(m => Number(m[1]));
      assert.ok(widths.every(w => w >= 0.9 && w <= 3), `${d.id} @ ${ppm}: line widths ${Math.min(...widths)}-${Math.max(...widths)}`);
    }
  }
});

test('targets.json integrity (TEST-007)', () => {
  const ids = new Set();
  for (const t of targets) {
    assert.ok(!ids.has(t.id), `duplicate id ${t.id}`); ids.add(t.id);
    assert.match(t.id, /^[A-Za-z0-9_-]{1,64}$/);
    assert.ok(TARGET_CATEGORIES.includes(t.category), `${t.id} category ${t.category}`);
    assert.ok(t.width > 0 && t.height > 0, `${t.id} size`);
    assert.ok(t.minDistance > 0 && t.minDistance <= t.maxDistance, `${t.id} window`);
    assert.ok(hasRenderer(t.svgType), `${t.id} svgType ${t.svgType} has no renderer`);
    const m = t.description.match(/Width ([\d.,]+) ?(mm|cm), Height ([\d.,]+) ?(mm|cm)/);
    if (m) {
      const f = (v, u) => parseFloat(v.replace(',', '.')) / (u === 'mm' ? 1000 : 100);
      assert.ok(Math.abs(f(m[1], m[2]) - t.width) < 1e-9 && Math.abs(f(m[3], m[4]) - t.height) < 1e-9, `${t.id} description dims`);
    }
  }
});

test('custom shape list only offers rendered shapes', () => {
  for (const s of CUSTOM_TARGET_SHAPES) {
    if (s.value === 'rect') continue; // intentional default
    assert.ok(hasRenderer(s.value), s.value);
  }
});

test('coach diagnostics separate reading error from maths error (FEAT-003)', () => {
  const scenario = { target: { height: 0.5, width: 0.25 }, distance: 500 }; // 1.0 MIL tall, 0.5 wide
  const d = diagnoseEstimate(scenario, 1.1, 500);
  assert.equal(d.dimension, 'height');
  assert.ok(Math.abs(d.readingErrorPct - 10) < 1e-9);
  assert.ok(Math.abs(d.impliedMeters - 454.5454545) < 1e-6);
  assert.ok(d.mathErrorPct > 9.9 && d.mathErrorPct < 10.1);
  // Width reading is detected
  assert.equal(diagnoseEstimate(scenario, 0.5, 500).dimension, 'width');
  assert.equal(diagnoseEstimate(scenario, 0, 500), null);
});

test('analytics: bias sign and grouping (FEAT-006)', () => {
  const h = [
    { errorPct: 10, signedErrorPct: 10, targetCategory: 'Steel', actualDistanceMeters: 600, estimatedDistanceMeters: 660, score: 60 },
    { errorPct: 2, signedErrorPct: 2, targetCategory: 'Steel', actualDistanceMeters: 100, estimatedDistanceMeters: 102, score: 90 },
    { errorPct: 4, targetCategory: 'PRS', actualDistanceMeters: 300, estimatedDistanceMeters: 288, score: 80 } // legacy: no signedErrorPct
  ];
  const a = computeAnalytics(h);
  assert.equal(a.rounds, 3);
  assert.ok(Math.abs(a.bias - (10 + 2 - 4) / 3) < 1e-9);
  assert.equal(a.byCategory[0].key, 'Steel');
  assert.deepEqual(a.byBand.map(b => b.key), ['close', 'medium', 'long']);
  assert.equal(bandOf(850), 'extreme');
});

test('data dimensions match the drawn artwork exactly (animals, people, IPSC)', async () => {
  const { buildArt } = await import('../js/target-art.js');
  for (const t of targets) {
    if (!ART_TYPES.has(t.svgType) || t.svgType === 'prs_popper') continue;
    const a = buildArt(t.svgType, t);
    const scale = t.svgType === 'ipsc_mini' ? 2 / 3 : 1; // mini is the metric art at 2/3 scale
    assert.ok(Math.abs(a.widthCm * scale / 100 - t.width) < 0.002, `${t.id} width ${t.width} vs art ${(a.widthCm * scale / 100).toFixed(3)}`);
    assert.ok(Math.abs(a.heightCm * scale / 100 - t.height) < 0.002, `${t.id} height ${t.height} vs art ${(a.heightCm * scale / 100).toFixed(3)}`);
  }
});

test('every reticle states what its marks are worth', () => {
  assert.ok(reticles.length >= 12);
  for (const r of reticles) assert.ok(typeof r.scale === 'string' && /MIL/.test(r.scale), `${r.id} has no scale legend`);
});

test('coach messages name the real cause of a miss', () => {
  assert.match(classifyMistake(1, 0.2), /Good reading and correct arithmetic/);
  assert.match(classifyMistake(0.5, 6), /reading was good.*arithmetic/i);
  assert.match(classifyMistake(10, 0), /too big.*too close/);
  assert.match(classifyMistake(-10, 0), /too small.*too far/);
  assert.match(classifyMistake(12, 4), /^Mostly the reading/);
  assert.match(classifyMistake(4, 12), /^Mostly the arithmetic/);
});
