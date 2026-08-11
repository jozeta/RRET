/* ==========================================================================
   Settings & Theme Controller
   ========================================================================== */

import { StorageManager } from './storage.js';
import { sfx } from './utils.js';

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

    if (form.elements['reticle-select']) form.elements['reticle-select'].value = s.reticle;
    if (form.elements['unit-select']) form.elements['unit-select'].value = s.unit;
    if (form.elements['theme-select']) form.elements['theme-select'].value = s.theme;
    if (form.elements['reticle-color']) form.elements['reticle-color'].value = s.reticleColor;
    if (form.elements['reticle-brightness']) form.elements['reticle-brightness'].value = s.reticleBrightness;
    if (form.elements['zoom-sensitivity']) form.elements['zoom-sensitivity'].value = s.zoomSensitivity;
    if (form.elements['pan-sensitivity']) form.elements['pan-sensitivity'].value = s.panSensitivity;
    if (form.elements['sound-toggle']) form.elements['sound-toggle'].checked = s.soundEnabled;

    const brightnessVal = document.getElementById('brightness-val');
    if (brightnessVal) brightnessVal.textContent = Math.round(s.reticleBrightness * 100) + '%';
  }

  bindFormEvents() {
    const form = document.getElementById('settings-form');
    if (!form) return;

    form.addEventListener('input', (e) => {
      this.handleSettingChange(e);
    });

    form.addEventListener('change', (e) => {
      this.handleSettingChange(e);
    });

    const resetStatsBtn = document.getElementById('btn-reset-stats');
    if (resetStatsBtn) {
      resetStatsBtn.addEventListener('click', () => {
        if (confirm('Are you sure you want to reset all training statistics and round history? This cannot be undone.')) {
          StorageManager.clearHistoryAndStats();
          if (this.app && this.app.updateStatsUI) {
            this.app.updateStatsUI();
          }
          alert('Statistics successfully reset.');
        }
      });
    }
  }

  handleSettingChange(e) {
    const form = document.getElementById('settings-form');
    if (!form) return;

    const updated = {
      reticle: form.elements['reticle-select'] ? form.elements['reticle-select'].value : this.settings.reticle,
      unit: form.elements['unit-select'] ? form.elements['unit-select'].value : this.settings.unit,
      theme: form.elements['theme-select'] ? form.elements['theme-select'].value : this.settings.theme,
      reticleColor: form.elements['reticle-color'] ? form.elements['reticle-color'].value : this.settings.reticleColor,
      reticleBrightness: form.elements['reticle-brightness'] ? parseFloat(form.elements['reticle-brightness'].value) : this.settings.reticleBrightness,
      zoomSensitivity: form.elements['zoom-sensitivity'] ? parseFloat(form.elements['zoom-sensitivity'].value) : this.settings.zoomSensitivity,
      panSensitivity: form.elements['pan-sensitivity'] ? parseFloat(form.elements['pan-sensitivity'].value) : this.settings.panSensitivity,
      soundEnabled: form.elements['sound-toggle'] ? form.elements['sound-toggle'].checked : this.settings.soundEnabled
    };

    const brightnessVal = document.getElementById('brightness-val');
    if (brightnessVal) brightnessVal.textContent = Math.round(updated.reticleBrightness * 100) + '%';

    this.settings = StorageManager.saveSettings(updated);
    this.applyTheme(updated.theme);
    this.applySoundSetting();

    if (this.app && this.app.scope) {
      this.app.scope.updateSettings(updated);
    }
  }

  applySoundSetting() {
    sfx.enabled = this.settings.soundEnabled;
  }

  applyTheme(themeName) {
    document.body.classList.remove('theme-dark-tactical', 'theme-military-olive', 'theme-desert-tan', 'theme-high-contrast');
    document.body.classList.add(`theme-${themeName}`);

    const root = document.documentElement;
    if (themeName === 'military-olive') {
      root.style.setProperty('--bg-dark-base', '#0d120e');
      root.style.setProperty('--bg-dark-surface', '#17211a');
      root.style.setProperty('--bg-dark-card', '#1f2d23');
      root.style.setProperty('--olive-primary', '#5e7b51');
      root.style.setProperty('--tan-accent', '#d4b277');
    } else if (themeName === 'desert-tan') {
      root.style.setProperty('--bg-dark-base', '#14110e');
      root.style.setProperty('--bg-dark-surface', '#211b16');
      root.style.setProperty('--bg-dark-card', '#2e261f');
      root.style.setProperty('--olive-primary', '#7a674d');
      root.style.setProperty('--tan-accent', '#e3ba83');
    } else if (themeName === 'high-contrast') {
      root.style.setProperty('--bg-dark-base', '#000000');
      root.style.setProperty('--bg-dark-surface', '#111111');
      root.style.setProperty('--bg-dark-card', '#1a1a1a');
      root.style.setProperty('--olive-primary', '#00ff66');
      root.style.setProperty('--tan-accent', '#ffff00');
      root.style.setProperty('--orange-highlight', '#ff6600');
    } else {
      // Default Dark Tactical
      root.style.setProperty('--bg-dark-base', '#0b0d0f');
      root.style.setProperty('--bg-dark-surface', '#14181c');
      root.style.setProperty('--bg-dark-card', '#1b2126');
      root.style.setProperty('--olive-primary', '#526348');
      root.style.setProperty('--tan-accent', '#c9a572');
      root.style.setProperty('--orange-highlight', '#ff8c00');
    }
  }
}
