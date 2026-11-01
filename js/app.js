/* ==========================================================================
   Rifle Range Estimation Trainer (RRET) - Main Application Controller
   ========================================================================== */

import { StorageManager } from './storage.js';
import { SettingsController } from './settings.js';
import { TargetsController } from './targets.js';
import { ScopeEngine } from './scope.js';
import { TrainingManager } from './training.js';
import { TutorialController } from './tutorial.js';
import { StationController } from './station.js';
import { AnalyticsController } from './analytics.js';
import { ReticleHelp } from './reticle-help.js';
import { loadReticles } from './reticles.js';
import { sfx, escapeHTML } from './utils.js';
import { formatDistance } from './scenario-logic.js';
import { APP_VERSION } from './version.js';

const PAGES = ['home', 'simulator', 'learn', 'targets', 'settings', 'about'];

class Application {
  constructor() {
    StorageManager.migrate();
    this.activePage = null;
    this.storage = StorageManager;
    this.reticles = [];
    this.settingsController = new SettingsController(this);
    this.targetsController = new TargetsController(this);
    this.scope = new ScopeEngine('scope-canvas', 'scope-reticle-svg', 'scope-hud-mag');
    this.training = new TrainingManager(this);
    this.station = new StationController(this);
    this.tutorial = new TutorialController(this);
    this.analytics = new AnalyticsController(this);
    this.reticleHelp = new ReticleHelp(this);
  }

  async init() {
    // Version: visible in the footer/About page so it's easy to tell which build a tab runs.
    document.querySelectorAll('.app-version').forEach(el => { el.textContent = `v${APP_VERSION}`; });
    console.info(`RRET v${APP_VERSION}`);

    // 0. Reticle catalog first: it fills the <select>s the settings form writes to.
    this.reticles = await loadReticles();
    this.scope.reticleCatalog = this.reticles;
    this.populateReticleSelects();

    // 1. Settings & theme
    this.settingsController.init();

    // 2. Target library
    await this.targetsController.init();

    // 3. Scope
    this.scope.init();
    this.scope.updateSettings(StorageManager.getSettings());

    // 4. Training, station mode, tutorial, analytics
    this.training.init();
    this.station.init();
    this.tutorial.init();
    this.analytics.init();
    this.reticleHelp.init();

    this.updateOpticsNote();

    // 5. Navigation & stats
    this.bindNavigation();
    this.bindScopeControlsBar();
    this.updateStatsUI();

    // 6. First scenario (the timer only starts once the simulator is visible)
    this.training.startNewScenario();

    // 7. Route to the page in the URL
    this.showPage(this.pageFromHash(), { initial: true });

    // 8. Offline support (FEAT-008)
    this.registerServiceWorker();
  }

  registerServiceWorker() {
    if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
    navigator.serviceWorker.register('sw.js').catch(err => console.info('Offline mode unavailable:', err.message));
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

  /** Shows the "calibrate your screen" hint while true-size optics are uncalibrated. */
  updateOpticsNote() {
    const note = document.getElementById('optics-note');
    if (!note) return;
    const s = StorageManager.getSettings();
    note.hidden = !(s.opticsMode === 'realistic' && !s.screenCalibrated);
  }

  /** Changes and persists the reticle from anywhere (simulator, Learn page). */
  setReticle(reticleId) {
    this.settingsController.settings = StorageManager.saveSettings({ reticle: reticleId });
    this.scope.updateSettings({ reticle: reticleId });
  }

  pageFromHash() {
    const hash = window.location.hash.replace('#', '');
    return PAGES.includes(hash) ? hash : 'home';
  }

  /**
   * Hash-driven router: links only change location.hash and the hashchange handler
   * shows the page, so browser Back/Forward work (audit BUG-009).
   */
  bindNavigation() {
    document.querySelectorAll('[data-page-target]').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        this.navigateTo(e.currentTarget.dataset.pageTarget);
      });
    });
    window.addEventListener('hashchange', () => this.showPage(this.pageFromHash()));
  }

  navigateTo(pageId) {
    if (!PAGES.includes(pageId)) return;
    if (window.location.hash !== `#${pageId}`) {
      window.location.hash = pageId; // triggers hashchange -> showPage
    } else {
      this.showPage(pageId);
    }
  }

  showPage(pageId, { initial = false } = {}) {
    const previous = this.activePage;
    this.activePage = pageId;

    document.querySelectorAll('.page-view').forEach(sec => sec.classList.remove('active'));
    const targetSec = document.getElementById(`page-${pageId}`);
    if (targetSec) targetSec.classList.add('active');

    document.querySelectorAll('.nav-link-tactical').forEach(link => {
      const active = link.dataset.pageTarget === pageId;
      link.classList.toggle('active', active);
      if (active) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });

    // Close the mobile menu after choosing a page (audit BUG-016).
    const collapseEl = document.getElementById('navbarContent');
    if (collapseEl && collapseEl.classList.contains('show') && window.bootstrap) {
      window.bootstrap.Collapse.getOrCreateInstance(collapseEl, { toggle: false }).hide();
    }

    if (!initial && previous !== pageId) {
      sfx.playClick();
      window.scrollTo({ top: 0 });
    }

    if (pageId === 'simulator') {
      // The canvas has no size while its page is hidden; size it once visible.
      requestAnimationFrame(() => this.scope.resizeCanvas());
      this.training.onSimulatorShown();
      this.station.onSimulatorShown();
    } else if (previous === 'simulator') {
      this.training.onSimulatorHidden();
      this.station.onSimulatorHidden();
    }
    if (pageId === 'home') this.analytics.render();
  }

  startScenarioWithTarget(target) {
    if (this.station.active) this.station.cancel();
    this.training.startNewScenario(target);
  }

  updateStatsUI() {
    const stats = StorageManager.getStats();
    const history = StorageManager.getHistory();
    const unit = StorageManager.getSettings().unit;

    const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
    set('stat-rounds-played', stats.roundsPlayed);
    set('stat-best-score', stats.bestScore);
    const avg = stats.roundsPlayed > 0 ? stats.totalErrorPct / stats.roundsPlayed : 0;
    set('stat-avg-error', `${avg.toFixed(1)}%`);
    set('stat-accuracy-pct', `${stats.roundsPlayed > 0 ? Math.max(0, Math.round(100 - avg)) : 0}%`);
    set('stat-best-accuracy', `${stats.personalBestAccuracyPct}%`);

    const historyTableBody = document.getElementById('history-table-body');
    if (historyTableBody) {
      if (history.length === 0) {
        historyTableBody.innerHTML = `
          <tr>
            <td colspan="7" class="text-center text-muted py-4">No training rounds completed yet. Launch the simulator to practice!</td>
          </tr>
        `;
      } else {
        historyTableBody.innerHTML = history.slice(0, 15).map(h => {
          const d = new Date(h.timestamp);
          const dateStr = Number.isNaN(d.getTime()) ? '–'
            : d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
          const errAbs = Math.abs((h.estimatedDistanceMeters || 0) - (h.actualDistanceMeters || 0));
          const timeStr = Number.isFinite(h.timeSeconds)
            ? `${String(Math.floor(h.timeSeconds / 60)).padStart(2, '0')}:${String(h.timeSeconds % 60).padStart(2, '0')}`
            : '--:--';
          const score = Number(h.score) || 0;
          const errPct = Number(h.errorPct) || 0;

          return `
            <tr>
              <td class="mono-font text-muted small">${escapeHTML(dateStr)}</td>
              <td class="tactical-font text-tan-light">${escapeHTML(h.targetName)}${h.mode === 'station' ? ' <span class="badge badge-olive">station</span>' : ''}</td>
              <td class="mono-font text-orange-highlight">${escapeHTML(formatDistance(h.actualDistanceMeters, unit))}</td>
              <td class="mono-font">${escapeHTML(formatDistance(h.estimatedDistanceMeters, unit))}</td>
              <td class="mono-font ${errPct <= 5 ? 'text-success' : 'text-warning'}">${escapeHTML(formatDistance(errAbs, unit))} (${errPct}%)</td>
              <td class="mono-font text-muted small">${timeStr}</td>
              <td><span class="badge ${score >= 80 ? 'bg-success' : 'bg-warning text-dark'}">${score} PTS</span></td>
            </tr>
          `;
        }).join('');
      }
    }
    if (this.activePage === 'home') this.analytics.render();
  }

  bindScopeControlsBar() {
    // Zoom presets: bound by data-zoom inside the preset group only, never by the
    // shared styling class (audit BUG-004 / ARCH-002).
    document.querySelectorAll('#zoom-presets [data-zoom]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        this.scope.setZoom(parseFloat(e.currentTarget.dataset.zoom));
        this.scope.hideHint();
        sfx.playClick();
      });
    });

    const reticleSel = document.getElementById('sim-reticle-select');
    if (reticleSel) {
      reticleSel.addEventListener('change', (e) => {
        this.setReticle(e.target.value);
        sfx.playClick();
      });
    }

    const environmentSel = document.getElementById('sim-environment-select');
    if (environmentSel) {
      environmentSel.addEventListener('change', (e) => {
        this.training.setEnvironmentPreference(e.target.value);
        sfx.playClick();
      });
    }

    const distanceSel = document.getElementById('sim-distance-filter');
    if (distanceSel) {
      distanceSel.addEventListener('change', (e) => {
        this.training.setDistanceFilter(e.target.value);
        sfx.playClick();
      });
    }

    const pan = (dx, dy) => () => this.scope.panByPixels(dx, dy);
    const bind = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener('click', fn); };
    bind('dpad-up', pan(0, 20));
    bind('dpad-down', pan(0, -20));
    bind('dpad-left', pan(20, 0));
    bind('dpad-right', pan(-20, 0));
    bind('dpad-reset', () => this.scope.centerTarget());
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.app = new Application();
  window.app.init();
});
