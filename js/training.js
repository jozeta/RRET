/* ==========================================================================
   Training Simulator & Distance Estimation Manager
   ========================================================================== */

import { StorageManager } from './storage.js';
import { calculateDistance, calculateMIL, calculateScoreAndRating, sfx, metersToYards, yardsToMeters } from './utils.js';
import { TARGET_CATEGORIES } from './targets.js';

const ENVIRONMENTS = ['forest', 'field', 'snow', 'mountain', 'desert', 'urban', 'range', 'fog', 'rain', 'dusk'];

// Hunting-category targets (deer, elk, bear, etc.) only ever appear against a
// forest or mountain backdrop — the other environments (range, urban, fog...)
// don't make sense for a game animal scenario.
const HUNTING_ENVIRONMENTS = ['forest', 'mountain'];

const DISTANCE_BANDS = {
  close: { min: 0, max: 200 },
  medium: { min: 200, max: 500 },
  long: { min: 500, max: 850 },
  extreme: { min: 850, max: Infinity }
};

export class TrainingManager {
  constructor(app) {
    this.app = app;
    this.currentScenario = null;
    this.shotTimerStart = null;
    this.shotTimerInterval = null;
    this.elapsedSeconds = 0;
    // 'random' (default) picks a new environment each scenario; any other value
    // pins every scenario to that environment until changed.
    this.environmentPreference = 'random';
    // Empty set = no restriction (draw from every category). Populated = only
    // draw random scenarios from these categories.
    this.categoryFilter = new Set();
    // 'any' (default) = no restriction; otherwise a key into DISTANCE_BANDS.
    this.distanceFilter = 'any';
  }

  init() {
    this.bindEvents();
    this.renderCategoryFilterUI();
  }

  setDistanceFilter(value) {
    this.distanceFilter = value;
  }

  /**
   * Toggle-button category filter for the simulator's random scenario picker
   * (separate from the Target Library page's single-select category tabs).
   * "All" clears the filter; clicking an active category removes it.
   */
  renderCategoryFilterUI() {
    const container = document.getElementById('sim-category-filter-buttons');
    if (!container) return;

    const isAllActive = this.categoryFilter.size === 0;
    const buttonsHTML = [
      `<button type="button" class="btn-zoom-step ${isAllActive ? 'active' : ''}" data-category="All">All</button>`,
      ...TARGET_CATEGORIES.map(cat => `
        <button type="button" class="btn-zoom-step ${this.categoryFilter.has(cat) ? 'active' : ''}" data-category="${cat}">${cat}</button>
      `)
    ];
    container.innerHTML = buttonsHTML.join('');

    container.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', (e) => {
        this.toggleCategoryFilter(e.currentTarget.dataset.category);
        sfx.playClick();
      });
    });
  }

  toggleCategoryFilter(category) {
    if (category === 'All') {
      this.categoryFilter.clear();
    } else if (this.categoryFilter.has(category)) {
      this.categoryFilter.delete(category);
    } else {
      this.categoryFilter.add(category);
    }
    this.renderCategoryFilterUI();
  }

  /** Targets a random scenario is allowed to draw from, respecting categoryFilter
   *  and distanceFilter. */
  getFilteredTargetPool() {
    let pool = this.app.targetsController.getAllTargets();

    if (this.categoryFilter.size > 0) {
      pool = pool.filter(t => {
        // 'Custom' means user-created, regardless of what category text they typed;
        // everything else matches the target's category field exactly, matching how
        // the Target Library page's own category tabs filter (see targets.js).
        if (this.categoryFilter.has('Custom') && !t.isBuiltIn) return true;
        return this.categoryFilter.has(t.category);
      });
    }

    if (this.distanceFilter !== 'any') {
      const band = DISTANCE_BANDS[this.distanceFilter];
      pool = pool.filter(t => {
        // A target with no declared range isn't constrained to any particular
        // band, so it stays eligible everywhere rather than being excluded.
        if (!t.minDistance || !t.maxDistance) return true;
        return t.minDistance <= band.max && t.maxDistance >= band.min;
      });
    }

    return pool;
  }

  /**
   * The [min,max] meters to actually roll a scenario distance within, given the
   * active distance-band filter (if any). Returns null to signal "use the generic
   * weighted fallback range" (no target-specific range, no active filter).
   */
  getEffectiveDistanceRange(target) {
    const band = this.distanceFilter !== 'any' ? DISTANCE_BANDS[this.distanceFilter] : null;

    if (target.minDistance && target.maxDistance) {
      if (!band) return { min: target.minDistance, max: target.maxDistance };
      // Clamp to the overlap of the target's own range and the selected band —
      // picking "Close" shouldn't still be able to roll a target's own 300m max.
      const min = Math.max(target.minDistance, band.min);
      const max = Math.min(target.maxDistance, band.max);
      return min <= max ? { min, max } : { min: target.minDistance, max: target.maxDistance };
    }

    if (band) {
      return { min: Math.max(1, band.min), max: Number.isFinite(band.max) ? band.max : 1200 };
    }

    return null;
  }

  /**
   * Resolves which environment a scenario should actually use for the given
   * target + the current environment preference. Hunting-category targets are
   * restricted to forest/mountain regardless of preference: 'random' picks
   * between just those two, and an explicit but incompatible pick (e.g. "Urban")
   * still falls back to a forest/mountain roll rather than being honored as-is.
   */
  resolveEnvironment(target, pref) {
    const isHunting = target && target.category === 'Hunting';
    if (isHunting) {
      if (pref !== 'random' && HUNTING_ENVIRONMENTS.includes(pref)) return pref;
      return HUNTING_ENVIRONMENTS[Math.floor(Math.random() * HUNTING_ENVIRONMENTS.length)];
    }
    return pref === 'random'
      ? ENVIRONMENTS[Math.floor(Math.random() * ENVIRONMENTS.length)]
      : pref;
  }

  /**
   * Called from the simulator's environment dropdown. Applies immediately to the
   * in-progress scenario (same target/distance, just a different backdrop) rather
   * than waiting for the next scenario, so the choice reads as instant feedback.
   */
  setEnvironmentPreference(pref) {
    this.environmentPreference = pref;
    if (this.currentScenario) {
      this.currentScenario.environment = this.resolveEnvironment(this.currentScenario.target, pref);
      this.updateScenarioUI();
      this.app.scope.setScenario(this.currentScenario);
    }
  }

  startNewScenario(forcedTarget = null) {
    let pool = this.getFilteredTargetPool();
    if (pool.length === 0) {
      // The active category filter matches nothing (e.g. only "Custom" selected
      // but no custom targets exist yet) — fall back to the full library rather
      // than silently doing nothing.
      pool = this.app.targetsController.getAllTargets();
    }
    if (!forcedTarget && pool.length === 0) return;

    const target = forcedTarget || pool[Math.floor(Math.random() * pool.length)];

    let distance;
    const effectiveRange = this.getEffectiveDistanceRange(target);
    if (effectiveRange) {
      // Target's official distance range (from PDF column 4 for built-ins, or a
      // user-set range for custom targets), clamped to the active distance-band
      // filter if one is selected.
      distance = Math.round(effectiveRange.min + Math.random() * (effectiveRange.max - effectiveRange.min));
    } else {
      // Fallback weighted distance range
      const distanceRanges = [
        { min: 50, max: 200, weight: 0.25 },
        { min: 200, max: 500, weight: 0.45 },
        { min: 500, max: 850, weight: 0.20 },
        { min: 850, max: 1200, weight: 0.10 }
      ];
      
      const rand = Math.random();
      let cumulative = 0;
      let selectedRange = distanceRanges[1];
      for (const r of distanceRanges) {
        cumulative += r.weight;
        if (rand <= cumulative) {
          selectedRange = r;
          break;
        }
      }

      distance = Math.round(
        selectedRange.min + Math.random() * (selectedRange.max - selectedRange.min)
      );
    }

    // Random small offset from reticle center (-3 to +3 MILs)
    const offsetX = Number((Math.random() * 6 - 3).toFixed(1));
    const offsetY = Number((Math.random() * 4 - 2).toFixed(1));

    const environment = this.resolveEnvironment(target, this.environmentPreference);

    const milHeight = Number(calculateMIL(target.height, distance).toFixed(2));
    const milWidth = Number(calculateMIL(target.width, distance).toFixed(2));

    this.currentScenario = {
      id: 'scen_' + Date.now(),
      target,
      distance,
      offsetX,
      offsetY,
      environment,
      milHeight,
      milWidth
    };

    // Update UI HUD & Scope
    this.updateScenarioUI();
    this.app.scope.setScenario(this.currentScenario);
    this.resetTimer();
    this.startTimer();
  }

  updateScenarioUI() {
    if (!this.currentScenario) return;
    const s = this.currentScenario;
    const settings = StorageManager.getSettings();
    const isImperial = settings.unit === 'imperial';

    // Target Info Card
    const targetNameEl = document.getElementById('sim-target-name');
    if (targetNameEl) targetNameEl.textContent = s.target.name;

    const targetCategoryEl = document.getElementById('sim-target-category');
    if (targetCategoryEl) targetCategoryEl.textContent = s.target.category || 'Field Target';

    const targetHeightEl = document.getElementById('sim-target-height');
    if (targetHeightEl) {
      if (isImperial) {
        const heightInches = (s.target.height * 39.3701).toFixed(1);
        targetHeightEl.textContent = `${heightInches} in (${s.target.height} m)`;
      } else {
        const heightCm = Math.round(s.target.height * 100);
        targetHeightEl.textContent = `${s.target.height} m (${heightCm} cm)`;
      }
    }

    const targetWidthEl = document.getElementById('sim-target-width');
    if (targetWidthEl) {
      if (isImperial) {
        const widthInches = (s.target.width * 39.3701).toFixed(1);
        targetWidthEl.textContent = `${widthInches} in (${s.target.width} m)`;
      } else {
        const widthCm = Math.round(s.target.width * 100);
        targetWidthEl.textContent = `${s.target.width} m (${widthCm} cm)`;
      }
    }

    const envEl = document.getElementById('sim-environment');
    if (envEl) envEl.textContent = s.environment.toUpperCase();

    // Reset input form
    const inputEl = document.getElementById('sim-estimated-distance');
    if (inputEl) {
      inputEl.value = '';
      inputEl.placeholder = isImperial ? 'Distance in yards' : 'Distance in meters';
      inputEl.focus();
    }

    const unitLabel = document.getElementById('sim-unit-label');
    if (unitLabel) unitLabel.textContent = isImperial ? 'YARDS' : 'METERS';

    // Hide result card
    const resultCard = document.getElementById('sim-result-card');
    if (resultCard) resultCard.style.display = 'none';
  }

  startTimer() {
    this.shotTimerStart = Date.now();
    this.elapsedSeconds = 0;
    const timerEl = document.getElementById('sim-shot-timer');

    if (this.shotTimerInterval) clearInterval(this.shotTimerInterval);
    this.shotTimerInterval = setInterval(() => {
      this.elapsedSeconds = Math.floor((Date.now() - this.shotTimerStart) / 1000);
      if (timerEl) {
        const mins = String(Math.floor(this.elapsedSeconds / 60)).padStart(2, '0');
        const secs = String(this.elapsedSeconds % 60).padStart(2, '0');
        timerEl.textContent = `${mins}:${secs}`;
      }
    }, 1000);
  }

  stopTimer() {
    if (this.shotTimerInterval) {
      clearInterval(this.shotTimerInterval);
      this.shotTimerInterval = null;
    }
  }

  resetTimer() {
    this.stopTimer();
    const timerEl = document.getElementById('sim-shot-timer');
    if (timerEl) timerEl.textContent = '00:00';
  }

  submitAnswer() {
    if (!this.currentScenario) return;

    const inputEl = document.getElementById('sim-estimated-distance');
    if (!inputEl || !inputEl.value) {
      alert('Please enter your estimated distance.');
      return;
    }

    const userVal = parseFloat(inputEl.value);
    if (isNaN(userVal) || userVal <= 0) {
      alert('Please enter a valid positive distance.');
      return;
    }

    this.stopTimer();

    const settings = StorageManager.getSettings();
    const isImperial = settings.unit === 'imperial';

    // Convert estimated distance to meters for math check if imperial
    let estimatedMeters = isImperial ? yardsToMeters(userVal) : userVal;
    const actualMeters = this.currentScenario.distance;

    const evalResult = calculateScoreAndRating(estimatedMeters, actualMeters);

    // Save round to LocalStorage
    const roundRecord = {
      scenarioId: this.currentScenario.id,
      targetName: this.currentScenario.target.name,
      actualDistanceMeters: actualMeters,
      estimatedDistanceMeters: Math.round(estimatedMeters),
      errorMeters: evalResult.errorAbs,
      errorPct: evalResult.errorPct,
      score: evalResult.score,
      timeSeconds: this.elapsedSeconds
    };

    StorageManager.recordRound(roundRecord);
    this.app.updateStatsUI();

    // Play feedback SFX
    if (evalResult.score >= 80) {
      sfx.playSuccess();
    } else {
      sfx.playError();
    }

    // Display Result Breakdown Card
    this.showResultBreakdown(userVal, actualMeters, evalResult, isImperial);
  }

  showResultBreakdown(userVal, actualMeters, result, isImperial) {
    const resultCard = document.getElementById('sim-result-card');
    if (!resultCard) return;

    const s = this.currentScenario;
    const targetSize = s.target.height;
    const milHeight = s.milHeight;

    const displayActual = isImperial ? Math.round(metersToYards(actualMeters)) + ' yards' : actualMeters + ' meters';
    const displayEstimated = isImperial ? Math.round(userVal) + ' yards' : userVal + ' meters';

    document.getElementById('res-score-badge').className = `badge ${result.badgeClass} fs-6 p-2`;
    document.getElementById('res-score-badge').textContent = `${result.score} PTS (${result.rating})`;

    document.getElementById('res-actual-dist').textContent = displayActual;
    document.getElementById('res-estimated-dist').textContent = displayEstimated;
    document.getElementById('res-error-m').textContent = `${result.errorAbs} m (${result.errorPct}%)`;

    // Step by Step Formula Callout
    const formulaMath = `
      Distance = (Target Height x 1000) / MIL Reading<br>
      Distance = (${targetSize} m × 1000) / ${milHeight} MIL<br>
      Distance = ${actualMeters} meters (${Math.round(metersToYards(actualMeters))} yards)
    `;
    document.getElementById('res-math-breakdown').innerHTML = formulaMath;

    resultCard.style.display = 'block';
    resultCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  bindEvents() {
    const submitBtn = document.getElementById('btn-submit-estimate');
    if (submitBtn) {
      submitBtn.addEventListener('click', () => {
        this.submitAnswer();
      });
    }

    const nextBtn = document.getElementById('btn-next-scenario');
    if (nextBtn) {
      nextBtn.addEventListener('click', () => {
        this.startNewScenario();
      });
    }

    const form = document.getElementById('sim-estimate-form');
    if (form) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        this.submitAnswer();
      });
    }
  }
}
