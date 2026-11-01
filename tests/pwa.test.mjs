// FEAT-008: every app file is precached for offline use, and the manifest is valid.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const sw = readFileSync(join(root, 'sw.js'), 'utf8');

function walk(dir) {
  return readdirSync(join(root, dir)).flatMap(name => {
    const rel = `${dir}/${name}`;
    if (name.startsWith('.') || name === 'README.md') return [];
    return statSync(join(root, rel)).isDirectory() ? walk(rel) : [rel];
  });
}

test('service worker precaches every app file', () => {
  const missing = ['css', 'js', 'data', 'vendor', 'icons'].flatMap(walk).filter(f => !sw.includes(`'${f}'`));
  assert.deepEqual(missing, [], `add these to PRECACHE in sw.js: ${missing.join(', ')}`);
});

test('every precached file exists', () => {
  const listed = [...sw.matchAll(/^\s+'([^']+)',?$/gm)].map(m => m[1]).filter(f => f !== './');
  for (const f of listed) assert.ok(existsSync(join(root, f)), `${f} is precached but missing`);
});

test('manifest is valid and its icons exist', () => {
  const m = JSON.parse(readFileSync(join(root, 'manifest.webmanifest'), 'utf8'));
  assert.equal(m.display, 'standalone');
  for (const icon of m.icons) assert.ok(existsSync(join(root, icon.src)), icon.src);
});

test('no third-party origins are referenced (CSP default-src self)', () => {
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  const css = ['css/style.css', 'css/scope.css', 'css/learn.css'].map(f => readFileSync(join(root, f), 'utf8')).join('\n');
  assert.ok(!/(src|href)="https?:\/\//.test(html.replace(/<a [^>]*>/g, '')), 'external src/href in index.html');
  assert.ok(!/url\(['"]?https?:/.test(css), 'external url() in CSS');
});
