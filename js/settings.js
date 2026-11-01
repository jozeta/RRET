/* ==========================================================================
   Settings & Theme Controller
   ========================================================================== */

import { StorageManager } from './storage.js';
import { sfx } from './utils.js';
import { toast } from './ui.js';

const CARD_WIDTH_MM = 85.6; // ISO/IEC 7810 ID-1 (bank card)
const DEFAULT_CALIB_PX = Math.round((96 / 25.4) * CARD_WIDTH_MM);

/**
 * Every theme sets every variable, so switching themes never leaves a value from
 * the previous one behind (audit BUG-019).
 */
const THEMES = {
  'dark-tactical': { '--bg-dark-base': '#0b0d0f', '--bg-dark-surface': '#14181c', '--bg-dark-card': '#1b2126', '--olive-primary': '#526348', '--tan-accent': '#c9a572', '--orange-highlight': '#ff8c00' },
  'military-olive': { '--bg-dark-base': '#0d120e', '--bg-dark-surface': '#17211a', '--bg-dark-card': '#1f2d23', '--olive-primary': '#5e7b51', '--tan-accent': '#d4b277', '--orange-highlight': '#ff8c00' },
  'desert-tan': { '--bg-dark-base': '#14110e', '--bg-dark-surface': '#211b16', '--bg-dark-card': '#2e261f', '--olive-primary': '#7a674d', '--tan-accent': '#e3ba83', '--orange-highlight': '#ff8c00' },
  'high-contrast': { '--bg-dark-base': '#000000', '--bg-dark-surface': '#111111', '--bg-dark-card': '#1a1a1a', '--olive-primary': '#00ff66', '--tan-accent': '#ffff00', '--orange-highlight': '#ff6600' }
};

export class SettingsController {
  constructor(app) {
    this.app = app;
    this.settings = StorageManager.getSettings();
  }

  init() {
    this.applyTheme(this.settings.theme);
    this.applySoundSetting();
    this.bindFormEvents();
    this.loadFormValues();
  }

  loadFormValues() {
    const s = this.settings;
    const form = document.getElementById('settings-form');
    if (!form) return;
    const el = (name) => form.elements[name];

    if (el('reticle-select')) el('reticle-select').value = s.reticle;
    if (el('unit-select')) el('unit-select').value = s.unit;
    if (el('theme-select')) el('theme-select').value = s.theme;
    if (el('reticle-color')) el('reticle-color').value = s.reticleColor;
    if (el('reticle-brightness')) el('reticle-brightness').value = s.reticleBrightness;
    if (el('zoom-sensitivity')) el('zoom-sensitivity').value = s.zoomSensitivity;
    if (el('pan-sensitivity')) el('pan-sensitivity').value = s.panSensitivity;
    if (el('sound-toggle')) el('sound-toggle').checked = s.soundEnabled;
    if (el('optics-mode')) el('optics-mode').value = s.opticsMode || 'arcade';
    if (el('scope-profile')) el('scope-profile').value = s.scopeProfile || 'precision';
    if (el('calib-px')) el('calib-px').value = s.screenPxPerMm ? Math.round(s.screenPxPerMm * CARD_WIDTH_MM) : DEFAULT_CALIB_PX;
    if (el('viewing-distance')) el('viewing-distance').value = s.viewingDistanceCm || 60;

    const brightnessVal = document.getElementById('brightness-val');
    if (brightnessVal) brightnessVal.textContent = Math.round(s.reticleBrightness * 100) + '%';
    this.updateCalibrationUI();
  }

  updateCalibrationUI() {
    const form = document.getElementById('settings-form');
    if (!form) return;
    const calib = form.elements['calib-px'];
    const bar = document.getElementById('calibration-bar');
    if (calib && bar) bar.style.width = `${calib.value}px`;
    const realistic = form.elements['optics-mode'] && form.elements['optics-mode'].value === 'realistic';
    const box = document.getElementById('optics-calibration');
    if (box) box.hidden = !realistic;
    const profile = form.elements['scope-profile'];
    if (profile) profile.disabled = !realistic;
    const readout = document.getElementById('calibration-readout');
    if (readout && calib) {
      const pxPerMm = Number(calib.value) / CARD_WIDTH_MM;
      readout.textContent = `${pxPerMm.toFixed(2)} px/mm`;
    }
  }

  bindFormEvents() {
    const form = document.getElementById('settings-form');
    if (!form) return;

    form.addEventListener('input', (e) => this.handleSettingChange(e));
    form.addEventListener('change', (e) => this.handleSettingChange(e));

    const resetStatsBtn = document.getElementById('btn-reset-stats');
    if (resetStatsBtn) {
      resetStatsBtn.addEventListener('click', () => {
        if (confirm('Reset all training statistics and round history? This cannot be undone.')) {
          StorageManager.clearHistoryAndStats();
          if (this.app && this.app.updateStatsUI) this.app.updateStatsUI();
          toast('Statistics reset.', 'success');
        }
      });
    }
  }

  handleSettingChange() {
    const form = document.getElementById('settings-form');
    if (!form) return;
    const el = (name) => form.elements[name];
    const num = (name, fallback) => {
      const v = el(name) ? parseFloat(el(name).value) : NaN;
      return Number.isFinite(v) ? v : fallback;
    };
    const prevUnit = this.settings.unit;

    const updated = {
      reticle: el('reticle-select') ? el('reticle-select').value : this.settings.reticle,
      unit: el('unit-select') ? el('unit-select').value : this.settings.unit,
      theme: el('theme-select') ? el('theme-select').value : this.settings.theme,
      reticleColor: el('reticle-color') ? el('reticle-color').value : this.settings.reticleColor,
      reticleBrightness: num('reticle-brightness', this.settings.reticleBrightness),
      zoomSensitivity: num('zoom-sensitivity', this.settings.zoomSensitivity),
      panSensitivity: num('pan-sensitivity', this.settings.panSensitivity),
      soundEnabled: el('sound-toggle') ? el('sound-toggle').checked : this.settings.soundEnabled,
      opticsMode: el('optics-mode') ? el('optics-mode').value : this.settings.opticsMode,
      scopeProfile: el('scope-profile') ? el('scope-profile').value : this.settings.scopeProfile,
      screenPxPerMm: num('calib-px', DEFAULT_CALIB_PX) / CARD_WIDTH_MM,
      viewingDistanceCm: Math.min(200, Math.max(20, num('viewing-distance', this.settings.viewingDistanceCm || 60)))
    };

    const brightnessVal = document.getElementById('brightness-val');
    if (brightnessVal) brightnessVal.textContent = Math.round(updated.reticleBrightness * 100) + '%';
    this.updateCalibrationUI();

    this.settings = StorageManager.saveSettings(updated);
    this.applyTheme(updated.theme);
    this.applySoundSetting();

    if (this.app && this.app.scope) this.app.scope.updateSettings(updated);
    // Units changed: refresh everything that displays distances (audit BUG-018).
    if (updated.unit !== prevUnit && this.app) {
      if (this.app.training) this.app.training.refreshUnits();
      if (this.app.updateStatsUI) this.app.updateStatsUI();
    }
  }

  applySoundSetting() {
    sfx.enabled = this.settings.soundEnabled;
  }

  applyTheme(themeName) {
    const name = THEMES[themeName] ? themeName : 'dark-tactical';
    document.body.classList.remove(...Object.keys(THEMES).map(t => `theme-${t}`));
    document.body.classList.add(`theme-${name}`);
    const root = document.documentElement;
    Object.entries(THEMES[name]).forEach(([prop, value]) => root.style.setProperty(prop, value));
  }
}
