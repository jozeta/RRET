// TEST-004: import/export validation (SEC-001, SEC-005, SEC-006, BUG-006).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sanitizeTarget, planImport, extractImportedTargets, LIMITS } from '../js/target-schema.js';
import { renderTargetSVGString } from '../js/utils.js';

const builtIns = JSON.parse(readFileSync(new URL('../data/targets.json', import.meta.url)));
const builtInIds = builtIns.map(t => t.id);
const ok = { id: 'custom_a', name: 'Plate', height: 0.3, width: 0.3 };

test('malicious id is replaced with a safe one (SEC-001)', () => {
  const t = sanitizeTarget({ ...ok, id: 'x"><img src=x onerror=alert(1)>' });
  assert.match(t.id, /^[A-Za-z0-9_-]{1,64}$/);
});

test('only #rrggbb colours survive, so SVG markup cannot be injected (SEC-005)', () => {
  const bad = sanitizeTarget({ ...ok, color: '"><script>alert(1)</script>', borderColor: 'red' });
  assert.equal(bad.color, undefined);
  assert.equal(bad.borderColor, undefined);
  const good = sanitizeTarget({ ...ok, color: '#123abc' });
  assert.equal(good.color, '#123abc');
  assert.ok(!renderTargetSVGString(bad).includes('<script'));
});

test('invalid records are rejected', () => {
  assert.equal(sanitizeTarget(null), null);
  assert.equal(sanitizeTarget({ name: 'x', height: 0, width: 1 }), null);
  assert.equal(sanitizeTarget({ name: '', height: 1, width: 1 }), null);
});

test('non-image data URIs are dropped', () => {
  assert.equal(sanitizeTarget({ ...ok, imageData: 'data:text/html;base64,PHNjcmlwdD4=' }).imageData, '');
});

test('distance window kept only when valid', () => {
  assert.equal(sanitizeTarget({ ...ok, minDistance: 300, maxDistance: 100 }).minDistance, undefined);
  assert.equal(sanitizeTarget({ ...ok, minDistance: '100', maxDistance: '300' }).maxDistance, 300);
});

test('re-importing a full-library export does not duplicate built-ins (BUG-006)', () => {
  const { list, counts } = planImport(builtIns, { builtInIds, existingCustom: [] });
  assert.equal(list.length, 0);
  assert.equal(counts.skippedBuiltIn, builtIns.length);
});

test('importing the same custom file twice is idempotent', () => {
  const file = [ok, { ...ok, id: 'custom_b', name: 'Other' }];
  const first = planImport(file, { builtInIds, existingCustom: [] });
  const second = planImport(file, { builtInIds, existingCustom: first.list });
  assert.equal(second.list.length, 2);
  assert.equal(second.counts.updated, 2);
  assert.equal(second.counts.added, 0);
});

test('oversized images and item counts are limited (SEC-006)', () => {
  const big = { ...ok, id: 'custom_big', imageData: 'data:image/png;base64,' + 'A'.repeat(LIMITS.imageDataChars + 10) };
  const { counts } = planImport([big], { builtInIds, existingCustom: [] });
  assert.equal(counts.imageTooLarge, 1);

  const many = Array.from({ length: LIMITS.importItems + 5 }, (_, i) => ({ ...ok, id: `c_${i}` }));
  const res = planImport(many, { builtInIds, existingCustom: [] });
  assert.equal(res.counts.added, LIMITS.importItems);
  assert.equal(res.counts.overLimit, 5);
});

test('accepts plain arrays and {targets:[...]} envelopes', () => {
  assert.deepEqual(extractImportedTargets([1]), [1]);
  assert.deepEqual(extractImportedTargets({ targets: [2] }), [2]);
  assert.equal(extractImportedTargets({ nope: 1 }), null);
});
