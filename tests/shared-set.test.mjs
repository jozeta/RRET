// Shareable scenario sets: links round-trip, and the same seed gives the same set.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseSetParams, setHash, generateSet } from '../js/shared-set.js';

const builtIns = JSON.parse(readFileSync(new URL('../data/targets.json', import.meta.url))).map(t => ({ ...t, isBuiltIn: true }));

test('a set link round-trips its parameters', () => {
  const p = { seed: 'abc123xy', count: 20, cats: ['Hunting', 'Steel'], band: 'medium', env: 'forest', fx: ['mirage', 'sway'] };
  assert.deepEqual(parseSetParams(setHash(p)), p);
});

test('bad link parameters are rejected or ignored', () => {
  assert.equal(parseSetParams('#simulator'), null);
  assert.equal(parseSetParams('#simulator?set=<script>'), null);
  const p = parseSetParams('#simulator?set=abcd1234&n=999&cats=Bogus,Steel&band=far&env=moon&fx=x,grass');
  assert.deepEqual([p.count, p.cats, p.band, p.env, p.fx], [10, ['Steel'], 'any', 'random', ['grass']]);
});

test('the same seed gives everyone the same targets, distances and scenes', () => {
  const p = { seed: 'club2026', count: 10, cats: [], band: 'any', env: 'random', fx: [] };
  const a = generateSet(p, builtIns);
  const b = generateSet(p, builtIns);
  assert.deepEqual(a.map(s => [s.target.id, s.distance, s.environment]), b.map(s => [s.target.id, s.distance, s.environment]));
  const c = generateSet({ ...p, seed: 'other999' }, builtIns);
  assert.notDeepEqual(a.map(s => s.target.id), c.map(s => s.target.id));
});

test('sets respect the category and distance filters', () => {
  const set = generateSet({ seed: 'filter01', count: 20, cats: ['Hunting'], band: 'close', env: 'random', fx: [] }, builtIns);
  for (const s of set) {
    assert.equal(s.target.category, 'Hunting');
    assert.ok(s.distance <= 200, `${s.target.id} at ${s.distance} m`);
  }
});
