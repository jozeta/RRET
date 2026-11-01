// Run with: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateDistance, calculateMIL, calculateScoreAndRating,
  metersToYards, yardsToMeters, inchesToMeters, escapeHTML, isSafeImageDataURI
} from '../js/utils.js';

test('MIL formula: 1 m target at 1000 m reads 1 MIL', () => {
  assert.equal(calculateMIL(1, 1000), 1);
  assert.equal(calculateDistance(1, 1), 1000);
});

test('distance and MIL are inverses', () => {
  for (const [size, dist] of [[0.5, 300], [1.8, 742], [0.04, 25]]) {
    const mil = calculateMIL(size, dist);
    assert.ok(Math.abs(calculateDistance(size, mil) - dist) < 1e-9);
  }
});

test('invalid readings/distances return 0 instead of Infinity', () => {
  assert.equal(calculateDistance(1, 0), 0);
  assert.equal(calculateDistance(1, -2), 0);
  assert.equal(calculateMIL(1, 0), 0);
});

test('unit conversions round-trip', () => {
  assert.ok(Math.abs(yardsToMeters(metersToYards(500)) - 500) < 1e-9);
  assert.ok(Math.abs(inchesToMeters(1) - 0.0254) < 1e-12);
});

test('scoring bands match the README table', () => {
  const cases = [
    [1000, 100], // 0%
    [1005, 100], // 0.5%
    [1010, 95],  // 1%
    [1020, 90],  // 2%
    [1050, 80],  // 5%
    [1100, 60],  // 10%
    [1101, 0],   // >10%
    [900, 60]    // under-estimates score symmetrically
  ];
  for (const [est, expected] of cases) {
    assert.equal(calculateScoreAndRating(est, 1000).score, expected, `estimate ${est}`);
  }
});

test('empty or non-positive estimate is a miss', () => {
  const r = calculateScoreAndRating(0, 400);
  assert.equal(r.score, 0);
  assert.equal(r.rating, 'Miss');
});

test('escapeHTML neutralises markup', () => {
  assert.equal(escapeHTML('<img src=x onerror="a">'), '&lt;img src=x onerror=&quot;a&quot;&gt;');
});

test('isSafeImageDataURI rejects non-image and script payloads', () => {
  assert.equal(isSafeImageDataURI('data:image/png;base64,iVBORw0KGgo='), true);
  assert.equal(isSafeImageDataURI('javascript:alert(1)'), false);
  assert.equal(isSafeImageDataURI('data:text/html;base64,PHNjcmlwdD4='), false);
});
