/* ==========================================================================
   Local Storage Management System
   ========================================================================== */

const STORAGE_KEYS = {
  SETTINGS: 'rret_settings_v1',
  STATS: 'rret_stats_v1',
  HISTORY: 'rret_history_v1',
  CUSTOM_TARGETS: 'rret_custom_targets_v1'
};

const DEFAULT_SETTINGS = {
  reticle: 'mil_dot',
  unit: 'metric',
  theme: 'dark-tactical',
  reticleColor: '#ff2a2a',
  reticleBrightness: 1.0,
  zoomSensitivity: 1.0,
  panSensitivity: 1.0,
  soundEnabled: true
};

const DEFAULT_STATS = {
  roundsPlayed: 0,
  totalScore: 0,
  bestScore: 0,
  totalErrorPct: 0,
  personalBestAccuracyPct: 0
};

export class StorageManager {
  /**
   * Load Settings from localStorage with fallback defaults
   */
  static getSettings() {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.SETTINGS);
      return data ? { ...DEFAULT_SETTINGS, ...JSON.parse(data) } : { ...DEFAULT_SETTINGS };
    } catch (e) {
      console.warn('Failed to read settings from storage', e);
      return { ...DEFAULT_SETTINGS };
    }
  }

  /**
   * Save Settings to localStorage
   */
  static saveSettings(settings) {
    try {
      const current = this.getSettings();
      const updated = { ...current, ...settings };
      localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(updated));
      return updated;
    } catch (e) {
      console.error('Failed to save settings to storage', e);
    }
  }

  /**
   * Get user training statistics
   */
  static getStats() {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.STATS);
      return data ? { ...DEFAULT_STATS, ...JSON.parse(data) } : { ...DEFAULT_STATS };
    } catch (e) {
      return { ...DEFAULT_STATS };
    }
  }

  /**
   * Record a completed training round into history & update aggregate stats
   */
  static recordRound(roundData) {
    try {
      const history = this.getHistory();
      history.unshift({
        id: 'rd_' + Date.now(),
        timestamp: new Date().toISOString(),
        ...roundData
      });
      // Keep last 100 rounds
      if (history.length > 100) history.pop();
      localStorage.setItem(STORAGE_KEYS.HISTORY, JSON.stringify(history));

      // Update summary stats
      const stats = this.getStats();
      stats.roundsPlayed += 1;
      stats.totalScore += roundData.score;
      stats.totalErrorPct += roundData.errorPct;
      if (roundData.score > stats.bestScore) {
        stats.bestScore = roundData.score;
      }
      
      const accuracy = 100 - (stats.totalErrorPct / stats.roundsPlayed);
      if (accuracy > stats.personalBestAccuracyPct) {
        stats.personalBestAccuracyPct = Math.max(0, Math.round(accuracy));
      }

      localStorage.setItem(STORAGE_KEYS.STATS, JSON.stringify(stats));
      return { stats, history };
    } catch (e) {
      console.error('Error saving round data', e);
    }
  }

  /**
   * Get history array
   */
  static getHistory() {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.HISTORY);
      return data ? JSON.parse(data) : [];
    } catch (e) {
      return [];
    }
  }

  /**
   * Clear training statistics and round history
   */
  static clearHistoryAndStats() {
    try {
      localStorage.removeItem(STORAGE_KEYS.STATS);
      localStorage.removeItem(STORAGE_KEYS.HISTORY);
    } catch (e) {}
  }

  /**
   * Custom Targets CRUD
   */
  static getCustomTargets() {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.CUSTOM_TARGETS);
      return data ? JSON.parse(data) : [];
    } catch (e) {
      return [];
    }
  }

  static saveCustomTarget(target) {
    const list = this.getCustomTargets();
    const existingIndex = list.findIndex(t => t.id === target.id);
    if (existingIndex >= 0) {
      list[existingIndex] = target;
    } else {
      list.push(target);
    }
    localStorage.setItem(STORAGE_KEYS.CUSTOM_TARGETS, JSON.stringify(list));
    return list;
  }

  static deleteCustomTarget(targetId) {
    const list = this.getCustomTargets().filter(t => t.id !== targetId);
    localStorage.setItem(STORAGE_KEYS.CUSTOM_TARGETS, JSON.stringify(list));
    return list;
  }
}
