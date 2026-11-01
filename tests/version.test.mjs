// The app version lives in js/version.js; package.json, the service-worker cache
// name and the changelog must agree with it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { APP_VERSION } from '../js/version.js';

const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');

test('version is semver', () => {
  assert.match(APP_VERSION, /^\d+\.\d+\.\d+$/);
});

test('package.json matches js/version.js', () => {
  assert.equal(JSON.parse(read('package.json')).version, APP_VERSION);
});

test('service-worker cache is named after the version', () => {
  assert.match(read('sw.js'), new RegExp(`CACHE_VERSION = 'rret-${APP_VERSION.replace(/\./g, '\\.')}'`));
});

test('CHANGELOG.md has an entry for this version', () => {
  assert.match(read('CHANGELOG.md'), new RegExp(`^## \\[?${APP_VERSION.replace(/\./g, '\\.')}\\]?`, 'm'));
});
