/* ==========================================================================
   Rifle Range Estimation Trainer (RRET) - Main Application Controller
   ========================================================================== */

import { StorageManager } from './storage.js';
import { SettingsController } from './settings.js';
import { TargetsController } from './targets.js';
import { ScopeEngine } from './scope.js';
import { TrainingManager } from './training.js';
import { TutorialController } from './tutorial.js';
import { loadReticles } from './reticles.js';
import { sfx, escapeHTML } from './utils.js';

class Application {
  constructor() {
    this.activePage = 'home';
    this.storage = StorageManager;
    this.reticles = [];
    this.settingsController = new SettingsController(this);
    this.targetsController = new TargetsController(this);
    this.scope = new ScopeEngine('scope-canvas', 'scope-reticle-svg', 'scope-hud-mag');
    this.training = new TrainingManager(this);
    this.tutorial = new TutorialController(this);
  }

  async init() {
    console.log('Initializing Rifle Range Estimation Trainer...');

    // 0. Load reticle catalog & populate dropdowns (must happen before settings
    // form is read/written, since it sets .value on these <select> elements)
    this.reticles = await loadReticles();
    this.populateReticleSelects();

    // 1. Initialize settings & themes
    this.settingsController.init();

    // 2. Initialize target library
    await this.targetsController.init();

    // 3. Initialize Scope canvas
    this.scope.init();
    const currentSettings = StorageManager.getSettings();
    this.scope.updateSettings(currentSettings);

    // 4. Initialize Training simulator & Tutorial
    this.training.init();
    this.tutorial.init();

    // 5. Navigation Router & UI bindings
    this.bindNavigation();
    this.updateStatsUI();

    // 6. Generate initial training scenario in memory
    this.training.startNewScenario();

    // Handle initial hash router if any
    const hash = window.location.hash.replace('#', '');
    if (['home', 'simulator', 'learn', 'targets', 'settings', 'about'].includes(hash)) {
      this.navigateTo(hash);
    } else {
      this.navigateTo('home');
    }

    this.bindScopeControlsBar();
  }

  populateReticleSelects() {
    const optionsHTML = this.reticles.map(r =>
      `<option value="${escapeHTML(r.id)}">${escapeHTML(r.name)}</option>`
    ).join('');

    const simSelect = document.getElementById('sim-reticle-select');
    if (simSelect) simSelect.innerHTML = optionsHTML;

    const settingsSelect = document.querySelector('select[name="reticle-select"]');
    if (settingsSelect) settingsSelect.innerHTML = optionsHTML;
  }

  bindNavigation() {
    const links = document.querySelectorAll('[data-page-target]');
    links.forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const targetPage = e.currentTarget.dataset.pageTarget;
        this.navigateTo(targetPage);
      });
    });
  }

  navigateTo(pageId) {
    this.activePage = pageId;
    window.location.hash = pageId;

    // Toggle active view sections
    document.querySelectorAll('.page-view').forEach(sec => {
      sec.classList.remove('active');
    });

    const targetSec = document.getElementById(`page-${pageId}`);
    if (targetSec) {
      targetSec.classList.add('active');
    }

    // Toggle navbar links active class
    document.querySelectorAll('.nav-link-tactical').forEach(link => {
      if (link.dataset.pageTarget === pageId) {
        link.classList.add('active');
      } else {
        link.classList.remove('active');
      }
    });

    sfx.playClick();

    // Refresh canvas on entering simulator tab
    if (pageId === 'simulator') {
      setTimeout(() => {
        this.scope.resizeCanvas();
        this.scope.render();
      }, 50);
    }
  }

  startScenarioWithTarget(target) {
    this.training.startNewScenario(target);
  }

  updateStatsUI() {
    const stats = StorageManager.getStats();
    const history = StorageManager.getHistory();

    const roundsPlayedEl = document.getElementById('stat-rounds-played');
    if (roundsPlayedEl) roundsPlayedEl.textContent = stats.roundsPlayed;

    const bestScoreEl = document.getElementById('stat-best-score');
    if (bestScoreEl) bestScoreEl.textContent = stats.bestScore;

    const avgErrorEl = document.getElementById('stat-avg-error');
    if (avgErrorEl) {
      const avg = stats.roundsPlayed > 0 ? (stats.totalErrorPct / stats.roundsPlayed).toFixed(1) : 0;
      avgErrorEl.textContent = `${avg}%`;
    }

    const accuracyEl = document.getElementById('stat-accuracy-pct');
    if (accuracyEl) {
      const acc = stats.roundsPlayed > 0 ? Math.max(0, Math.round(100 - (stats.totalErrorPct / stats.roundsPlayed))) : 0;
      accuracyEl.textContent = `${acc}%`;
    }

    const bestAccuracyEl = document.getElementById('stat-best-accuracy');
    if (bestAccuracyEl) bestAccuracyEl.textContent = `${stats.personalBestAccuracyPct}%`;

    // History Table Rendering
    const historyTableBody = document.getElementById('history-table-body');
    if (historyTableBody) {
      if (history.length === 0) {
        historyTableBody.innerHTML = `
          <tr>
            <td colspan="7" class="text-center text-muted py-4">No training rounds completed yet. Launch the simulator to practice!</td>
          </tr>
        `;
      } else {
        const settings = StorageManager.getSettings();
        const isImperial = settings.unit === 'imperial';

        historyTableBody.innerHTML = history.slice(0, 15).map(h => {
          const dateStr = new Date(h.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          const actualStr = isImperial ? `${Math.round(h.actualDistanceMeters * 1.09361)} yd` : `${h.actualDistanceMeters} m`;
          const estStr = isImperial ? `${Math.round(h.estimatedDistanceMeters * 1.09361)} yd` : `${h.estimatedDistanceMeters} m`;
          const errorStr = isImperial
            ? `${Math.round(h.errorMeters * 1.09361)} yd (${h.errorPct}%)`
            : `${h.errorMeters}m (${h.errorPct}%)`;
          const timeStr = Number.isFinite(h.timeSeconds)
            ? `${String(Math.floor(h.timeSeconds / 60)).padStart(2, '0')}:${String(h.timeSeconds % 60).padStart(2, '0')}`
            : '--:--';

          return `
            <tr>
              <td class="mono-font text-muted small">${dateStr}</td>
              <td class="tactical-font text-tan-light">${escapeHTML(h.targetName)}</td>
              <td class="mono-font text-orange-highlight">${actualStr}</td>
              <td class="mono-font">${estStr}</td>
              <td class="mono-font ${h.errorPct <= 5 ? 'text-success' : 'text-warning'}">${errorStr}</td>
              <td class="mono-font text-muted small">${timeStr}</td>
              <td><span class="badge ${h.score >= 80 ? 'bg-success' : 'bg-warning text-dark'}">${h.score} PTS</span></td>
            </tr>
          `;
        }).join('');
      }
    }
  }

  bindScopeControlsBar() {
    // Zoom presets
    document.querySelectorAll('.btn-zoom-step').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const val = parseFloat(e.currentTarget.dataset.zoom);
        this.scope.setZoom(val);
        sfx.playClick();
      });
    });

    // Reticle switcher quick dropdown
    const reticleSel = document.getElementById('sim-reticle-select');
    if (reticleSel) {
      reticleSel.addEventListener('change', (e) => {
        this.scope.updateSettings({ reticle: e.target.value });
        sfx.playClick();
      });
    }

    // Environment switcher quick dropdown
    const environmentSel = document.getElementById('sim-environment-select');
    if (environmentSel) {
      environmentSel.addEventListener('change', (e) => {
        this.training.setEnvironmentPreference(e.target.value);
        sfx.playClick();
      });
    }

    // Distance-range filter — takes effect on the next generated scenario.
    const distanceSel = document.getElementById('sim-distance-filter');
    if (distanceSel) {
      distanceSel.addEventListener('change', (e) => {
        this.training.setDistanceFilter(e.target.value);
        sfx.playClick();
      });
    }

    // D-Pad Pan Controls
    const dpadUp = document.getElementById('dpad-up');
    const dpadDown = document.getElementById('dpad-down');
    const dpadLeft = document.getElementById('dpad-left');
    const dpadRight = document.getElementById('dpad-right');
    const dpadReset = document.getElementById('dpad-reset');

    if (dpadUp) dpadUp.addEventListener('click', () => this.scope.panByPixels(0, 20));
    if (dpadDown) dpadDown.addEventListener('click', () => this.scope.panByPixels(0, -20));
    if (dpadLeft) dpadLeft.addEventListener('click', () => this.scope.panByPixels(20, 0));
    if (dpadRight) dpadRight.addEventListener('click', () => this.scope.panByPixels(-20, 0));
    if (dpadReset) dpadReset.addEventListener('click', () => this.scope.centerTarget());
  }
}

// Instantiate and start app on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  window.app = new Application();
  window.app.init();
});
