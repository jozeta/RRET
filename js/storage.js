/* ==========================================================================
   Local Storage Management System
   ========================================================================== */

import { sanitizeTarget } from './target-schema.js';

const STORAGE_KEYS = {
  SETTINGS: 'rret_settings_v1',
  STATS: 'rret_stats_v1', // legacy (schema 1): aggregates are now derived from history
  HISTORY: 'rret_history_v1',
  CUSTOM_TARGETS: 'rret_custom_targets_v1',
  SIM_PREFS: 'rret_sim_prefs_v1',
  SCHEMA: 'rret_schema',
  BACKUP: 'rret_backup_v1'
};

const SCHEMA_VERSION = 4;
export const HISTORY_LIMIT = 1000;

const DEFAULT_SETTINGS = {
  reticle: 'mil_dot',
  unit: 'metric',
  theme: 'lada-glass',
  reticleColor: '#111111', // black etched; illuminated colours are options
  reticleBrightness: 1.0,
  zoomSensitivity: 1.0,
  panSensitivity: 1.0,
  soundEnabled: true,
  // Optics scale. 'realistic' (default): the target appears as large as through a
  // real scope at that magnification, viewed from viewingDistanceCm. 'arcade': the
  // original enlarged scale (1 MIL = 18 px x zoom, roughly 8x a real 1x view).
  opticsMode: 'realistic',
  scopeProfile: 'full',
  screenPxPerMm: null, // set by the calibration slider
  screenCalibrated: false, // true once the user has actually moved the slider
  viewingDistanceCm: 60,
  // Coach mode (FEAT-003): also ask for the MIL reading.
  coachMode: false
};

const DEFAULT_SIM_PREFS = {
  environment: 'random',
  categories: [],
  distance: 'any',
  realism: [] // 'mirage' | 'sway' | 'grass' | 'acquire' | 'lowlight'
};

/** Pure: removes repeat submissions of the same scenario (audit BUG-002/003),
 *  keeping the first (chronologically earliest) answer. `history` is newest-first. */
export function dedupeHistory(history) {
  const seen = new Set();
  const keptOldestFirst = [];
  for (let i = history.length - 1; i >= 0; i--) {
    const h = history[i];
    if (h && h.scenarioId) {
      if (seen.has(h.scenarioId)) continue;
      seen.add(h.scenarioId);
    }
    keptOldestFirst.push(h);
  }
  return keptOldestFirst.reverse();
}

/** Pure: aggregate stats from a newest-first history array. */
export function computeStats(history) {
  const stats = {
    roundsPlayed: 0, totalScore: 0, bestScore: 0, totalErrorPct: 0, personalBestAccuracyPct: 0,
    within5: 0, currentStreak: 0, bestStreak: 0
  };
  // Walk oldest -> newest so "best accuracy" is the best running average reached.
  for (let i = history.length - 1; i >= 0; i--) {
    const h = history[i];
    if (!h || !Number.isFinite(h.score) || !Number.isFinite(h.errorPct)) continue;
    stats.roundsPlayed += 1;
    stats.totalScore += h.score;
    stats.totalErrorPct += h.errorPct;
    if (h.score > stats.bestScore) stats.bestScore = h.score;
    // "Within 5%" is the 80-point band; a streak is consecutive rounds inside it.
    if (h.errorPct <= 5) {
      stats.within5 += 1;
      stats.currentStreak += 1;
      if (stats.currentStreak > stats.bestStreak) stats.bestStreak = stats.currentStreak;
    } else {
      stats.currentStreak = 0;
    }
    const running = Math.max(0, Math.round(100 - stats.totalErrorPct / stats.roundsPlayed));
    if (running > stats.personalBestAccuracyPct) stats.personalBestAccuracyPct = running;
  }
  return stats;
}

function readJSON(key, fallback) {
  try {
    const data = localStorage.getItem(key);
    return data ? JSON.parse(data) : fallback;
  } catch (e) {
    return fallback;
  }
}

/** Writes JSON; never throws. Returns { ok, error, quotaExceeded }. */
function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return { ok: true };
  } catch (e) {
    const quotaExceeded = !!e && (e.name === 'QuotaExceededError' || e.code === 22 || e.code === 1014);
    console.error(`Failed to write ${key}`, e);
    return { ok: false, error: e, quotaExceeded };
  }
}

export class StorageManager {
  /**
   * One-time data migrations. Schema 2 (audit fixes): history may contain the same
   * scenario recorded twice or more (BUG-002/003). The raw data is backed up once,
   * history is de-duplicated, and the separately-stored aggregates are dropped in
   * favour of computing them from history.
   */
  static migrate() {
    let version = 1;
    try { version = Number(localStorage.getItem(STORAGE_KEYS.SCHEMA)) || 1; } catch (e) { return; }
    if (version >= SCHEMA_VERSION) return;
    try {
      if (version < 2) this.migrateToV2();
      if (version < 3) this.migrateToV3();
      if (version < 4) this.migrateToV4();
      localStorage.setItem(STORAGE_KEYS.SCHEMA, String(SCHEMA_VERSION));
    } catch (e) {
      console.warn('Storage migration failed', e);
    }
  }

  /**
   * Schema 3: true-size optics become the default. Every saved settings object
   * carried opticsMode 'arcade' (the only mode until now, saved along with any
   * other setting), so switch it once; users can still choose the enlarged view.
   */
  static migrateToV3() {
    const stored = readJSON(STORAGE_KEYS.SETTINGS, null);
    if (!stored || typeof stored !== 'object') return;
    if (stored.opticsMode === 'arcade' || stored.opticsMode === undefined) {
      writeJSON(STORAGE_KEYS.SETTINGS, { ...stored, opticsMode: 'realistic', scopeProfile: 'full' });
    }
  }

  /** Schema 4: the default reticle became black (etched). Switch saved settings
   *  that still hold the old red default, which was never a deliberate choice. */
  static migrateToV4() {
    const stored = readJSON(STORAGE_KEYS.SETTINGS, null);
    if (stored && typeof stored === 'object' && stored.reticleColor === '#ff2a2a') {
      writeJSON(STORAGE_KEYS.SETTINGS, { ...stored, reticleColor: '#111111' });
    }
  }

  static migrateToV2() {
    const history = readJSON(STORAGE_KEYS.HISTORY, []);
    if (!localStorage.getItem(STORAGE_KEYS.BACKUP) && (history.length || localStorage.getItem(STORAGE_KEYS.STATS))) {
      writeJSON(STORAGE_KEYS.BACKUP, {
        createdAt: new Date().toISOString(),
        history,
        stats: readJSON(STORAGE_KEYS.STATS, null)
      });
    }
    writeJSON(STORAGE_KEYS.HISTORY, Array.isArray(history) ? dedupeHistory(history) : []);
    localStorage.removeItem(STORAGE_KEYS.STATS);
  }

  static getSettings() {
    const stored = readJSON(STORAGE_KEYS.SETTINGS, {});
    return { ...DEFAULT_SETTINGS, ...(stored && typeof stored === 'object' ? stored : {}) };
  }

  /** Merges `settings` into the stored settings and returns the merged result
   *  (even if persisting failed, so the session keeps working). */
  static saveSettings(settings) {
    const updated = { ...this.getSettings(), ...settings };
    writeJSON(STORAGE_KEYS.SETTINGS, updated);
    return updated;
  }

  static getSimPrefs() {
    const stored = readJSON(STORAGE_KEYS.SIM_PREFS, {});
    const prefs = { ...DEFAULT_SIM_PREFS, ...(stored && typeof stored === 'object' ? stored : {}) };
    if (!Array.isArray(prefs.categories)) prefs.categories = [];
    if (!Array.isArray(prefs.realism)) prefs.realism = [];
    return prefs;
  }

  static saveSimPrefs(prefs) {
    const updated = { ...this.getSimPrefs(), ...prefs };
    writeJSON(STORAGE_KEYS.SIM_PREFS, updated);
    return updated;
  }

  static getStats() {
    return computeStats(this.getHistory());
  }

  /** Record a completed round. Returns { ok, error }. */
  static recordRound(roundData) {
    const history = this.getHistory();
    history.unshift({
      id: 'rd_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      timestamp: new Date().toISOString(),
      ...roundData
    });
    if (history.length > HISTORY_LIMIT) history.length = HISTORY_LIMIT;
    return writeJSON(STORAGE_KEYS.HISTORY, history);
  }

  static getHistory() {
    const history = readJSON(STORAGE_KEYS.HISTORY, []);
    return Array.isArray(history) ? history : [];
  }

  static clearHistoryAndStats() {
    try {
      localStorage.removeItem(STORAGE_KEYS.STATS);
      localStorage.removeItem(STORAGE_KEYS.HISTORY);
    } catch (e) {}
  }

  /**
   * Custom targets. Stored data is re-validated on read: the origin
   * (jozeta.github.io) is shared with other sites, so stored records are untrusted.
   */
  static getCustomTargets() {
    const list = readJSON(STORAGE_KEYS.CUSTOM_TARGETS, []);
    if (!Array.isArray(list)) return [];
    return list.map(t => sanitizeTarget(t)).filter(Boolean);
  }

  /** Replace the whole custom-target list in one write. Returns { ok, error, quotaExceeded }. */
  static saveCustomTargets(list) {
    return writeJSON(STORAGE_KEYS.CUSTOM_TARGETS, list);
  }

  static saveCustomTarget(target) {
    const list = this.getCustomTargets();
    const existingIndex = list.findIndex(t => t.id === target.id);
    if (existingIndex >= 0) list[existingIndex] = target;
    else list.push(target);
    return this.saveCustomTargets(list);
  }

  static deleteCustomTarget(targetId) {
    return this.saveCustomTargets(this.getCustomTargets().filter(t => t.id !== targetId));
  }
}
