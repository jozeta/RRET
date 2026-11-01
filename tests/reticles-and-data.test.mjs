// TEST-005 (reticle geometry), TEST-007 (data integrity), coach + analytics maths.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ScopeEngine } from '../js/scope.js';
import { TARGET_CATEGORIES, CUSTOM_TARGET_SHAPES } from '../js/targets.js';
import { diagnoseEstimate } from '../js/coach.js';
import { computeAnalytics, bandOf } from '../js/analytics.js';

const targets = JSON.parse(readFileSync(new URL('../data/targets.json', import.meta.url)));
const reticles = JSON.parse(readFileSync(new URL('../data/reticles.json', import.meta.url)));
const utilsSrc = readFileSync(new URL('../js/utils.js', import.meta.url), 'utf8');

// Reticle generators only use helper methods, so they run without a DOM.
const engine = Object.create(ScopeEngine.prototype);
const PX = 100; // px per MIL
const C = 500;

function verticalTickXs(svg, y = C) {
  // x positions of short vertical lines crossing the horizontal axis
  const xs = new Set();
  for (const m of svg.matchAll(/<line x1="([\d.-]+)" y1="([\d.-]+)" x2="([\d.-]+)" y2="([\d.-]+)"/g)) {
    const [x1, y1, x2, y2] = m.slice(1).map(Number);
    if (x1 === x2 && y1 < y && y2 > y && y2 - y1 < 40) xs.add(+(x1 - C).toFixed(6));
  }
  return [...xs].sort((a, b) => a - b);
}

test('Tremor reticle has fine ticks every 0.2 MIL out to 3.0 MIL (BUG-008)', () => {
  const xs = verticalTickXs(engine.generateTremorStyleSVG(C, PX, '#f00')).filter(x => x > 0 && x <= 3 * PX + 1e-6);
  const expected = Array.from({ length: 15 }, (_, k) => +(((k + 1) / 5) * PX).toFixed(6));
  assert.deepEqual(xs, expected);
});

test('MIL-dot hashes sit at exact half-MIL positions', () => {
  const xs = verticalTickXs(engine.generateMILDotSVG(C, PX, '#f00')).filter(x => x > 0);
  for (const x of xs) assert.ok(Math.abs((x / PX) * 2 - Math.round((x / PX) * 2)) < 1e-9, `${x / PX} MIL`);
  assert.ok(xs.includes(0.5 * PX) && xs.includes(9.5 * PX));
});

test('every reticle in reticles.json has a generator', () => {
  const src = readFileSync(new URL('../js/scope.js', import.meta.url), 'utf8');
  for (const r of reticles) assert.ok(src.includes(`case '${r.id}'`) || r.id === 'mil_dot', r.id);
});

test('targets.json integrity (TEST-007)', () => {
  const ids = new Set();
  for (const t of targets) {
    assert.ok(!ids.has(t.id), `duplicate id ${t.id}`); ids.add(t.id);
    assert.match(t.id, /^[A-Za-z0-9_-]{1,64}$/);
    assert.ok(TARGET_CATEGORIES.includes(t.category), `${t.id} category ${t.category}`);
    assert.ok(t.width > 0 && t.height > 0, `${t.id} size`);
    assert.ok(t.minDistance > 0 && t.minDistance <= t.maxDistance, `${t.id} window`);
    assert.ok(utilsSrc.includes(`case '${t.svgType}'`), `${t.id} svgType ${t.svgType} has no renderer`);
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
    assert.ok(utilsSrc.includes(`case '${s.value}'`), s.value);
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
