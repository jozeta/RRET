/* ==========================================================================
   Training Simulator & Distance Estimation Manager
   ========================================================================== */

import { StorageManager } from './storage.js';
import { calculateScoreAndRating, sfx, metersToYards, yardsToMeters, escapeHTML } from './utils.js';
import { TARGET_CATEGORIES } from './targets.js';
import {
  DISTANCE_BANDS, filterTargetPool, buildScenario, resolveEnvironment,
  formatDistance, formatSize, formulaLine
} from './scenario-logic.js';
import { diagnoseEstimate } from './coach.js';
import { setFieldError, toast } from './ui.js';

export const REALISM_LAYERS = ['mirage', 'sway', 'grass', 'acquire', 'lowlight'];

const ENV_LABELS = { forest: 'Forest', field: 'Field', snow: 'Snow', mountain: 'Mountain', desert: 'Desert', urban: 'City', range: 'Shooting range', fog: 'Fog', rain: 'Rain', dusk: 'Dusk' };

const isCoarsePointer = () => window.matchMedia && window.matchMedia('(pointer: coarse)').matches;

export class TrainingManager {
  constructor(app) {
    this.app = app;
    this.currentScenario = null;

    // Shot timer: accumulates only while the simulator is visible (audit BUG-014).
    this.timerAccumMs = 0;
    this.timerRunningSince = null;
    this.timerInterval = null;
    this.simulatorVisible = false;

    // Persisted simulator preferences (audit BUG-017).
    const prefs = StorageManager.getSimPrefs();
    this.environmentPreference = prefs.environment;
    this.categoryFilter = new Set(prefs.categories.filter(c => TARGET_CATEGORIES.includes(c)));
    this.distanceFilter = DISTANCE_BANDS[prefs.distance] ? prefs.distance : 'any';
    this.realism = new Set(prefs.realism.filter(r => REALISM_LAYERS.includes(r)));

    // Optional station mode controller (FEAT-004) registers itself here.
    this.station = null;
  }

  init() {
    this.bindEvents();
    this.renderCategoryFilterUI();
    const envSel = document.getElementById('sim-environment-select');
    if (envSel) envSel.value = this.environmentPreference;
    const distSel = document.getElementById('sim-distance-filter');
    if (distSel) distSel.value = this.distanceFilter;
    this.applyCoachModeUI();
    this.bindRealism();
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.pauseTimer();
      else if (this.simulatorVisible) this.resumeTimer();
    });
  }

  get unit() {
    return StorageManager.getSettings().unit === 'imperial' ? 'imperial' : 'metric';
  }

  persistPrefs() {
    StorageManager.saveSimPrefs({
      environment: this.environmentPreference,
      categories: [...this.categoryFilter],
      distance: this.distanceFilter,
      realism: [...this.realism]
    });
  }

  /** Field-condition switches (mirage, sway, grass, find the target, low light). */
  bindRealism() {
    const box = document.getElementById('sim-realism');
    if (!box) return;
    box.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      cb.checked = this.realism.has(cb.value);
      cb.closest('.realism-chip')?.classList.toggle('active', cb.checked);
      cb.addEventListener('change', () => {
        if (cb.checked) this.realism.add(cb.value); else this.realism.delete(cb.value);
        cb.closest('.realism-chip')?.classList.toggle('active', cb.checked);
        this.persistPrefs();
        this.app.scope.setRealism([...this.realism]);
        if (cb.value === 'lowlight' && cb.checked && /^#(0|1)/.test(StorageManager.getSettings().reticleColor)) {
          toast('A black reticle is hard to see in low light. An illuminated reticle (Settings) helps, as on a real scope.', 'info', 6000);
        }
      });
    });
    this.app.scope.setRealism([...this.realism]);
  }

  setDistanceFilter(value) {
    this.distanceFilter = DISTANCE_BANDS[value] ? value : 'any';
    this.persistPrefs();
    this.updateFilterStatus();
  }

  /**
   * Toggle-button category filter for the simulator's random scenario picker.
   * "All" clears the filter; clicking an active category removes it. Buttons are
   * identified by data-category — never by a styling class (audit BUG-004).
   */
  renderCategoryFilterUI() {
    const container = document.getElementById('sim-category-filter-buttons');
    if (!container) return;

    const isAllActive = this.categoryFilter.size === 0;
    const button = (cat, active) =>
      `<button type="button" class="btn-zoom-step btn-filter-category ${active ? 'active' : ''}" data-category="${escapeHTML(cat)}" aria-pressed="${active}">${escapeHTML(cat)}</button>`;
    container.innerHTML = [button('All', isAllActive), ...TARGET_CATEGORIES.map(cat => button(cat, this.categoryFilter.has(cat)))].join('');

    container.querySelectorAll('button[data-category]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        this.toggleCategoryFilter(e.currentTarget.dataset.category);
        sfx.playClick();
      });
    });
    this.updateFilterStatus();
  }

  toggleCategoryFilter(category) {
    if (category === 'All') this.categoryFilter.clear();
    else if (this.categoryFilter.has(category)) this.categoryFilter.delete(category);
    else this.categoryFilter.add(category);
    this.persistPrefs();
    this.renderCategoryFilterUI();
  }

  getFilteredTargetPool() {
    return filterTargetPool(this.app.targetsController.getAllTargets(), {
      categories: [...this.categoryFilter],
      distance: this.distanceFilter
    });
  }

  /** "N targets match" next to the filters, or a warning when nothing does (BUG-005). */
  updateFilterStatus() {
    const el = document.getElementById('sim-filter-status');
    if (!el || !this.app.targetsController) return;
    const n = this.getFilteredTargetPool().length;
    el.classList.toggle('text-warning', n === 0);
    el.classList.toggle('text-muted', n > 0);
    el.textContent = n === 0
      ? 'No targets match these filters. Change a filter to get new scenarios.'
      : `${n} target${n === 1 ? '' : 's'} match`;
  }

  /**
   * Called from the simulator's environment dropdown. Applies immediately to the
   * in-progress scenario (same target/distance, new backdrop).
   */
  setEnvironmentPreference(pref) {
    this.environmentPreference = pref;
    this.persistPrefs();
    if (this.currentScenario) {
      this.currentScenario.environment = resolveEnvironment(this.currentScenario.target, pref);
      this.updateScenarioUI({ keepInput: true });
      this.app.scope.setScenario(this.currentScenario);
    }
  }

  /**
   * Starts a new random scenario (or one for `forcedTarget`). Returns false and
   * keeps the current scenario when the active filters match no targets, rather
   * than silently ignoring them (audit BUG-005).
   */
  startNewScenario(forcedTarget = null) {
    if (this.station && this.station.active && !forcedTarget) return false;
    // In a shared set, "Next target" means the next target of the set.
    const set = this.app.sharedSet;
    if (set && set.active && !forcedTarget) return set.next();
    if (set && set.active && forcedTarget) set.leave({ startNew: false });
    let target = forcedTarget;
    if (!target) {
      let pool = this.getFilteredTargetPool();
      if (pool.length === 0) {
        this.updateFilterStatus();
        const all = this.app.targetsController.getAllTargets();
        if (this.currentScenario || all.length === 0) {
          if (all.length > 0) toast('No targets match the current filters, so no new scenario was started.', 'warning');
          return false;
        }
        // First scenario of the session with saved filters that match nothing:
        // there is nothing on screen to keep, so show any target and say why.
        toast('Your saved filters match no targets, so this first scenario uses the whole library. Adjust the filters under Scenario options.', 'warning', 8000);
        pool = all;
      }
      target = pool[Math.floor(Math.random() * pool.length)];
    }

    const scenario = buildScenario(target, {
      distance: this.distanceFilter,
      unit: this.unit,
      environment: this.environmentPreference
    });
    this.loadScenario(scenario);
    return true;
  }

  /** Shows a scenario in the scope and resets the answer form and timer. */
  loadScenario(scenario) {
    this.currentScenario = scenario;
    this.updateScenarioUI();
    this.app.scope.setScenario(scenario);
    this.resetTimer();
    if (this.simulatorVisible) this.resumeTimer();
  }

  updateScenarioUI({ keepInput = false } = {}) {
    if (!this.currentScenario) return;
    const s = this.currentScenario;
    const unit = this.unit;

    const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
    set('sim-target-name', s.target.name);
    set('sim-target-category', s.target.category || 'Field Target');
    set('sim-target-height', formatSize(s.target.height, unit));
    set('sim-target-width', formatSize(s.target.width, unit));
    set('sim-environment', ENV_LABELS[s.environment] || s.environment);
    set('sim-unit-label', unit === 'imperial' ? 'yards' : 'meters');

    const inputEl = document.getElementById('sim-estimated-distance');
    const milEl = document.getElementById('sim-mil-reading');
    if (inputEl) {
      if (!keepInput) inputEl.value = '';
      inputEl.placeholder = unit === 'imperial' ? 'Distance in yards' : 'Distance in meters';
      setFieldError(inputEl, '');
    }
    if (milEl && !keepInput) { milEl.value = ''; setFieldError(milEl, ''); }
    this.setFormLocked(!!s.answered);

    if (!keepInput) {
      const resultCard = document.getElementById('sim-result-card');
      if (resultCard) resultCard.style.display = 'none';
      // Auto-focus only with a fine pointer: on phones it pops the keyboard and
      // scrolls the scope out of view (audit BUG-011).
      if (inputEl && this.simulatorVisible && !isCoarsePointer()) inputEl.focus({ preventScroll: true });
    }
  }

  /** After an answer, lock the form so the same scenario can't be scored twice (BUG-003). */
  setFormLocked(locked) {
    const inputEl = document.getElementById('sim-estimated-distance');
    const milEl = document.getElementById('sim-mil-reading');
    const submitBtn = document.getElementById('btn-submit-estimate');
    if (inputEl) inputEl.disabled = locked;
    if (milEl) milEl.disabled = locked;
    if (submitBtn) submitBtn.disabled = locked;
    const solutionBtn = document.getElementById('btn-show-solution');
    if (solutionBtn) solutionBtn.disabled = locked;
  }

  /** Re-render unit-dependent labels after a units change, keeping typed input (BUG-018). */
  refreshUnits() {
    this.updateScenarioUI({ keepInput: true });
    const card = document.getElementById('sim-result-card');
    if (card && card.style.display !== 'none' && this.lastResult) this.showResultBreakdown(this.lastResult);
  }

  applyCoachModeUI() {
    const on = !!StorageManager.getSettings().coachMode;
    const row = document.getElementById('sim-mil-reading-row');
    if (row) row.hidden = !on;
    const toggle = document.getElementById('sim-coach-toggle');
    if (toggle) toggle.checked = on;
  }

  // ---- Shot timer ---------------------------------------------------------

  elapsedMs() {
    return this.timerAccumMs + (this.timerRunningSince ? Date.now() - this.timerRunningSince : 0);
  }

  renderTimer() {
    const timerEl = document.getElementById('sim-shot-timer');
    if (!timerEl) return;
    const secs = Math.floor(this.elapsedMs() / 1000);
    timerEl.textContent = `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;
  }

  resumeTimer() {
    if (!this.currentScenario || this.currentScenario.answered || this.timerRunningSince) return;
    this.timerRunningSince = Date.now();
    if (!this.timerInterval) this.timerInterval = setInterval(() => this.renderTimer(), 250);
  }

  pauseTimer() {
    if (this.timerRunningSince) {
      this.timerAccumMs += Date.now() - this.timerRunningSince;
      this.timerRunningSince = null;
    }
    if (this.timerInterval) { clearInterval(this.timerInterval); this.timerInterval = null; }
    this.renderTimer();
  }

  resetTimer() {
    this.pauseTimer();
    this.timerAccumMs = 0;
    this.renderTimer();
  }

  onSimulatorShown() {
    this.simulatorVisible = true;
    this.app.scope.setVisible(true);
    if (!document.hidden) this.resumeTimer();
  }

  onSimulatorHidden() {
    this.simulatorVisible = false;
    this.app.scope.setVisible(false);
    this.pauseTimer();
  }

  // ---- Answering ----------------------------------------------------------

  /** Reads and validates the answer form. Returns { estimateMeters, userMil } or null. */
  readAnswer() {
    const inputEl = document.getElementById('sim-estimated-distance');
    const milEl = document.getElementById('sim-mil-reading');
    const unit = this.unit;
    const raw = inputEl ? inputEl.value.trim().replace(',', '.') : '';
    const userVal = parseFloat(raw);
    if (!raw || !Number.isFinite(userVal) || userVal <= 0) {
      setFieldError(inputEl, `Enter your estimated distance in ${unit === 'imperial' ? 'yards' : 'meters'} (a number above 0).`);
      if (inputEl) inputEl.focus();
      return null;
    }
    setFieldError(inputEl, '');

    let userMil = null;
    const coachOn = !!StorageManager.getSettings().coachMode;
    if (coachOn && milEl) {
      const milRaw = milEl.value.trim().replace(',', '.');
      if (milRaw) {
        userMil = parseFloat(milRaw);
        if (!Number.isFinite(userMil) || userMil <= 0) {
          setFieldError(milEl, 'Enter the MIL value you read (a number above 0), or leave it empty.');
          milEl.focus();
          return null;
        }
      }
      setFieldError(milEl, '');
    }

    return {
      userVal,
      unit,
      estimateMeters: unit === 'imperial' ? yardsToMeters(userVal) : userVal,
      userMil
    };
  }

  submitAnswer() {
    const s = this.currentScenario;
    if (!s || s.answered) return;
    const answer = this.readAnswer();
    if (!answer) return;

    if (this.station && this.station.active) {
      this.station.recordAnswer(answer);
      return;
    }

    this.pauseTimer();
    s.answered = true;
    this.setFormLocked(true);

    const evalResult = calculateScoreAndRating(answer.estimateMeters, s.distance);
    const diagnostics = answer.userMil ? diagnoseEstimate(s, answer.userMil, answer.estimateMeters) : null;
    const timeSeconds = Math.round(this.elapsedMs() / 1000);

    const saved = StorageManager.recordRound(this.buildRoundRecord(s, answer, evalResult, timeSeconds, 'free'));
    if (!saved.ok) toast('This round could not be saved (browser storage unavailable or full).', 'warning');
    this.app.updateStatsUI();

    if (evalResult.score >= 80) sfx.playSuccess();
    else sfx.playError();

    this.lastResult = { scenario: s, answer, evalResult, diagnostics };
    this.showResultBreakdown(this.lastResult);
  }

  buildRoundRecord(s, answer, evalResult, timeSeconds, mode) {
    return {
      scenarioId: s.id,
      mode,
      targetId: s.target.id,
      targetName: s.target.name,
      targetCategory: s.target.isBuiltIn ? s.target.category : 'Custom',
      actualDistanceMeters: Math.round(s.distance * 10) / 10,
      estimatedDistanceMeters: Math.round(answer.estimateMeters),
      errorMeters: evalResult.errorAbs,
      errorPct: evalResult.errorPct,
      signedErrorPct: Number((((answer.estimateMeters - s.distance) / s.distance) * 100).toFixed(2)),
      score: evalResult.score,
      unit: answer.unit,
      milReading: answer.userMil || undefined,
      realism: this.realism.size ? [...this.realism] : undefined,
      timeSeconds
    };
  }

  /**
   * Reveals the answer without scoring the round: the scenario is locked like an
   * answered one, but nothing is written to history, so stats stay honest.
   */
  revealSolution() {
    const s = this.currentScenario;
    if (!s || s.answered || (this.station && this.station.active)) return;
    this.pauseTimer();
    s.answered = true;
    s.revealed = true;
    this.setFormLocked(true);
    this.lastResult = { scenario: s, answer: null, evalResult: null, diagnostics: null, revealed: true };
    this.showResultBreakdown(this.lastResult);
  }

  showResultBreakdown({ scenario: s, answer, evalResult: result, diagnostics, revealed = false }) {
    const resultCard = document.getElementById('sim-result-card');
    if (!resultCard) return;
    const unit = this.unit;

    const badge = document.getElementById('res-score-badge');
    const title = document.getElementById('res-title');
    if (revealed) {
      badge.className = 'badge bg-secondary fs-6 p-2';
      badge.textContent = 'Not scored';
      if (title) title.textContent = 'Solution';
    } else {
      badge.className = `badge ${result.badgeClass} fs-6 p-2`;
      badge.textContent = `${result.score} PTS (${result.rating})`;
      if (title) title.textContent = 'Result';
    }

    document.getElementById('res-actual-dist').textContent = formatDistance(s.distance, unit, { long: true });
    document.getElementById('res-estimated-dist').textContent = answer ? formatDistance(answer.estimateMeters, unit, { long: true }) : '–';
    if (answer) {
      const errAbs = Math.abs(answer.estimateMeters - s.distance);
      const errStr = unit === 'imperial' ? `${Math.round(metersToYards(errAbs))} yd` : `${Math.round(errAbs)} m`;
      document.getElementById('res-error-m').textContent = `${errStr} (${result.errorPct}%)`;
    } else {
      document.getElementById('res-error-m').textContent = '–';
    }

    // Both dimensions, in the active unit, plus what the user's answer implies.
    const lines = [
      formulaLine(s.target.height, s.distance, unit, 'Height'),
      formulaLine(s.target.width, s.distance, unit, 'Width')
    ];
    if (answer) {
      const impliedMilH = (s.target.height * 1000) / answer.estimateMeters;
      const impliedMilW = (s.target.width * 1000) / answer.estimateMeters;
      lines.push(`Your answer implies ${impliedMilH.toFixed(2)} MIL tall / ${impliedMilW.toFixed(2)} MIL wide (true: ${s.milHeight.toFixed(2)} / ${s.milWidth.toFixed(2)} MIL).`);
    } else {
      lines.push(`In the scope the target measures ${s.milHeight.toFixed(2)} MIL tall and ${s.milWidth.toFixed(2)} MIL wide (see the orange brackets).`);
    }
    const math = document.getElementById('res-math-breakdown');
    math.innerHTML = lines.map(l => `<div>${escapeHTML(l)}</div>`).join('');

    const coachEl = document.getElementById('res-coach');
    if (coachEl) {
      if (diagnostics) {
        const sign = (v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
        const dimLabel = diagnostics.dimension === 'height' ? 'height' : 'width';
        coachEl.innerHTML = `
          <div class="fw-semibold mb-1">Where the error came from</div>
          <div>Reading: you read <strong>${diagnostics.userMil.toFixed(2)} MIL</strong> (${dimLabel}); true is ${diagnostics.trueMil.toFixed(2)} MIL → <strong>${sign(diagnostics.readingErrorPct)}</strong></div>
          <div>Maths: your reading implies ${escapeHTML(formatDistance(diagnostics.impliedMeters, unit))}; you entered ${escapeHTML(formatDistance(answer.estimateMeters, unit))} → <strong>${sign(diagnostics.mathErrorPct)}</strong></div>
          ${diagnostics.verdict ? `<div class="mt-1 text-warning">${escapeHTML(diagnostics.verdict)}</div>` : ''}
        `;
        coachEl.hidden = false;
      } else {
        coachEl.hidden = true;
        coachEl.innerHTML = '';
      }
    }

    this.app.scope.showTruthOverlay(true);
    resultCard.style.display = 'block';
    resultCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    const nextBtn = document.getElementById('btn-next-scenario');
    if (nextBtn && !isCoarsePointer()) nextBtn.focus({ preventScroll: true });
  }

  bindEvents() {
    // Only the form's submit event: the SUBMIT button is type="submit", so a click
    // listener on it as well recorded every answer twice (audit BUG-002).
    const form = document.getElementById('sim-estimate-form');
    if (form) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        this.submitAnswer();
      });
    }

    const nextBtn = document.getElementById('btn-next-scenario');
    if (nextBtn) nextBtn.addEventListener('click', () => this.startNewScenario());

    const solutionBtn = document.getElementById('btn-show-solution');
    if (solutionBtn) solutionBtn.addEventListener('click', () => this.revealSolution());

    const coachToggle = document.getElementById('sim-coach-toggle');
    if (coachToggle) {
      coachToggle.addEventListener('change', (e) => {
        StorageManager.saveSettings({ coachMode: e.target.checked });
        this.applyCoachModeUI();
      });
    }
  }
}
