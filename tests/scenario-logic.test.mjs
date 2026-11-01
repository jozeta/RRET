// TEST-003: scenario generation rules and result formatting.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  filterTargetPool, effectiveDistanceRange, rollDistanceMeters, resolveEnvironment,
  buildScenario, createRng, formatDistance, formulaLine, DISTANCE_BANDS, MIN_SCENARIO_DISTANCE_M
} from '../js/scenario-logic.js';
import { metersToYards } from '../js/utils.js';

const builtIns = JSON.parse(readFileSync(new URL('../data/targets.json', import.meta.url)));
const custom = { id: 'custom_x', name: 'Mine', category: 'Steel', width: 0.3, height: 0.3, isBuiltIn: false };

test('empty filter returns the whole library', () => {
  assert.equal(filterTargetPool(builtIns).length, builtIns.length);
});

test('category filter: "Custom" matches user targets whatever their category text', () => {
  const pool = filterTargetPool([...builtIns, custom], { categories: ['Custom'] });
  assert.deepEqual(pool.map(t => t.id), ['custom_x']);
});

test('combined filters can legitimately be empty (BUG-005 must not fall back)', () => {
  assert.equal(filterTargetPool(builtIns, { categories: ['Hunting'], distance: 'long' }).length, 0);
});

test('every built-in in a band pool overlaps that band', () => {
  for (const key of Object.keys(DISTANCE_BANDS)) {
    const band = DISTANCE_BANDS[key];
    for (const t of filterTargetPool(builtIns, { distance: key })) {
      assert.ok(t.minDistance <= band.max && t.maxDistance >= band.min, `${t.id} in ${key}`);
    }
  }
});

test('distance range is clamped to the band overlap', () => {
  const t = { minDistance: 100, maxDistance: 400 };
  assert.deepEqual(effectiveDistanceRange(t, 'close'), { min: 100, max: 200 });
  assert.deepEqual(effectiveDistanceRange(t, 'any'), { min: 100, max: 400 });
  // Hand-picked target outside the band keeps its own window.
  assert.deepEqual(effectiveDistanceRange(t, 'extreme'), { min: 100, max: 400 });
});

test('targets without a range never roll closer than the floor (BUG-020)', () => {
  const r = effectiveDistanceRange({}, 'close');
  assert.equal(r.min, MIN_SCENARIO_DISTANCE_M);
  const rng = createRng(1);
  for (let i = 0; i < 500; i++) assert.ok(rollDistanceMeters({}, 'close', 'metric', rng) >= MIN_SCENARIO_DISTANCE_M);
});

test('rolled distances stay inside the target window', () => {
  const rng = createRng('window');
  for (const t of builtIns) {
    for (let i = 0; i < 20; i++) {
      const d = rollDistanceMeters(t, 'any', 'metric', rng);
      assert.ok(d >= t.minDistance && d <= t.maxDistance, `${t.id}: ${d}`);
    }
  }
});

test('imperial distances are whole yards so a whole-yard answer can score 100 (BUG-022)', () => {
  const rng = createRng('yards');
  for (let i = 0; i < 300; i++) {
    const d = rollDistanceMeters(builtIns[i % builtIns.length], 'any', 'imperial', rng);
    const yd = metersToYards(d);
    assert.ok(Math.abs(yd - Math.round(yd)) < 1e-9, `${yd} yd`);
  }
});

test('hunting targets only get forest or mountain', () => {
  const deer = builtIns.find(t => t.category === 'Hunting');
  const rng = createRng(7);
  for (const pref of ['random', 'urban', 'fog', 'forest', 'mountain']) {
    for (let i = 0; i < 30; i++) assert.ok(['forest', 'mountain'].includes(resolveEnvironment(deer, pref, rng)));
  }
  assert.equal(resolveEnvironment(deer, 'mountain', rng), 'mountain');
});

test('seeded RNG makes scenarios reproducible', () => {
  const a = buildScenario(builtIns[0], { rng: createRng('seed') });
  const b = buildScenario(builtIns[0], { rng: createRng('seed') });
  assert.equal(a.distance, b.distance);
  assert.equal(a.environment, b.environment);
});

test('formatting uses the active unit (BUG-010)', () => {
  assert.equal(formatDistance(457.2, 'imperial'), '500 yd');
  assert.equal(formatDistance(412.4, 'metric'), '412 m');
  assert.match(formulaLine(0.5, 500, 'imperial', 'Height'), /= 547 yd$/);
  assert.match(formulaLine(0.5, 500, 'metric', 'Height'), /= 500 m$/);
});

test('formula arithmetic reproduces the distance at short and long range', () => {
  for (const [size, d] of [[0.036, 37], [0.45, 300], [1.8, 1173]]) {
    const line = formulaLine(size, d, 'metric', 'H');
    assert.match(line, new RegExp(`= ${d} m$`), line);
  }
});
