// TEST-006: storage, migration and quota handling (BUG-002/003, BUG-007, ARCH-008).
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeLocalStorage } from './helpers.mjs';

installFakeLocalStorage();
const { StorageManager, dedupeHistory, computeStats } = await import('../js/storage.js');

beforeEach(() => installFakeLocalStorage());

const round = (scenarioId, score, errorPct) => ({ scenarioId, score, errorPct, targetName: 't' });

test('dedupeHistory keeps one entry per scenario, the earliest answer', () => {
  // newest first: s2 answered twice, s1 answered three times
  const h = [round('s2', 0, 50), round('s2', 100, 0), round('s1', 60, 8), round('s1', 60, 8), round('s1', 90, 2)];
  const d = dedupeHistory(h);
  assert.deepEqual(d.map(x => x.scenarioId), ['s2', 's1']);
  assert.equal(d[0].score, 100);
  assert.equal(d[1].score, 90);
});

test('computeStats derives aggregates from history', () => {
  const s = computeStats([round('b', 60, 10), round('a', 100, 0)]);
  assert.equal(s.roundsPlayed, 2);
  assert.equal(s.totalScore, 160);
  assert.equal(s.bestScore, 100);
  assert.equal(s.totalErrorPct, 10);
  assert.equal(s.personalBestAccuracyPct, 100);
});

test('migration backs up, de-duplicates and drops the stale aggregate', () => {
  localStorage.setItem('rret_history_v1', JSON.stringify([round('s1', 80, 4), round('s1', 80, 4)]));
  localStorage.setItem('rret_stats_v1', JSON.stringify({ roundsPlayed: 2 }));
  StorageManager.migrate();
  assert.equal(StorageManager.getHistory().length, 1);
  assert.equal(StorageManager.getStats().roundsPlayed, 1);
  assert.equal(localStorage.getItem('rret_stats_v1'), null);
  assert.ok(JSON.parse(localStorage.getItem('rret_backup_v1')).history.length === 2);
  // Idempotent
  StorageManager.migrate();
  assert.equal(StorageManager.getHistory().length, 1);
});

test('quota errors are returned, not thrown (BUG-007)', () => {
  installFakeLocalStorage({ quotaChars: 2000 });
  const res = StorageManager.saveCustomTarget({ id: 'c1', name: 'big', height: 1, width: 1, description: 'x'.repeat(5000) });
  // description is capped at 500 chars by the sanitizer on read, but the write here is raw
  assert.equal(res.ok, false);
  assert.equal(res.quotaExceeded, true);
});

test('stored custom targets are re-validated on read (SEC-004)', () => {
  localStorage.setItem('rret_custom_targets_v1', JSON.stringify([
    { id: 'ok_1', name: 'Fine', height: 1, width: 1 },
    { id: 'bad"id', name: 'Renamed', height: 1, width: 1, color: 'javascript:1' },
    { name: 'no size' }
  ]));
  const list = StorageManager.getCustomTargets();
  assert.equal(list.length, 2);
  assert.match(list[1].id, /^[A-Za-z0-9_-]+$/);
  assert.equal(list[1].color, undefined);
});

test('settings merge defaults and survive corrupt JSON', () => {
  localStorage.setItem('rret_settings_v1', '{not json');
  assert.equal(StorageManager.getSettings().unit, 'metric');
  StorageManager.saveSettings({ unit: 'imperial' });
  assert.equal(StorageManager.getSettings().unit, 'imperial');
  assert.equal(StorageManager.getSettings().reticle, 'mil_dot');
});

test('simulator preferences persist (BUG-017)', () => {
  StorageManager.saveSimPrefs({ categories: ['Steel'], distance: 'long' });
  const p = StorageManager.getSimPrefs();
  assert.deepEqual(p.categories, ['Steel']);
  assert.equal(p.distance, 'long');
  assert.equal(p.environment, 'random');
});

test('true-size optics are the default, and old saved settings switch once', () => {
  assert.equal(StorageManager.getSettings().opticsMode, 'realistic');
  assert.equal(StorageManager.getSettings().scopeProfile, 'full');
  localStorage.setItem('rret_schema', '2');
  localStorage.setItem('rret_settings_v1', JSON.stringify({ opticsMode: 'arcade', unit: 'imperial' }));
  StorageManager.migrate();
  const s = StorageManager.getSettings();
  assert.equal(s.opticsMode, 'realistic');
  assert.equal(s.unit, 'imperial');
  // A later deliberate choice of the enlarged view is kept.
  StorageManager.saveSettings({ opticsMode: 'arcade' });
  StorageManager.migrate();
  assert.equal(StorageManager.getSettings().opticsMode, 'arcade');
});
