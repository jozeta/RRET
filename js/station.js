/* ==========================================================================
   Field-shooting station mode (FEAT-004)
   A station is a short series of figures from one target series, shown one at a
   time against a shared countdown, with no feedback until the station is done —
   like a stage in Swedish field shooting (fältskytte). Distances are drawn from
   each figure's own competition window in targets.json.
   ========================================================================== */

import { StorageManager } from './storage.js';
import { calculateScoreAndRating, escapeHTML, sfx } from './utils.js';
import { buildScenario, formatDistance } from './scenario-logic.js';
import { TARGET_CATEGORIES } from './targets.js';
import { toast } from './ui.js';

const FIGURE_COUNTS = [3, 4, 5, 6];
const TIME_LIMITS_S = [60, 90, 120, 180];
// MIL readings shown as columns of the printable range card (lathund).
const LATHUND_MILS = [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.2, 1.4, 1.6, 1.8, 2.0, 2.5, 3.0, 4.0, 5.0];

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export class StationController {
  constructor(app) {
    this.app = app;
    this.active = false;
    this.mode = 'free';
    this.state = null;
    this.clockInterval = null;
    this.setup = { series: 'Swedish Field Shooting', figures: 4, timeLimit: 90 };
  }

  init() {
    this.app.training.station = this;
    document.querySelectorAll('[data-sim-mode]').forEach(btn => {
      btn.addEventListener('click', (e) => this.setMode(e.currentTarget.dataset.simMode));
    });
  }

  get unit() {
    return StorageManager.getSettings().unit === 'imperial' ? 'imperial' : 'metric';
  }

  seriesOptions() {
    const all = this.app.targetsController.getAllTargets();
    return TARGET_CATEGORIES.filter(cat =>
      cat === 'Custom' ? all.some(t => !t.isBuiltIn) : all.some(t => t.category === cat)
    );
  }

  seriesTargets(series) {
    const all = this.app.targetsController.getAllTargets();
    return series === 'Custom' ? all.filter(t => !t.isBuiltIn) : all.filter(t => t.category === series);
  }

  setMode(mode) {
    if (mode === this.mode) return;
    if (this.active && !confirm('Leave the station? Your answers for this station will be discarded.')) return;
    if (mode === 'station' && this.app.sharedSet && this.app.sharedSet.active) {
      this.app.sharedSet.active = null;
      const banner = document.getElementById('shared-set-banner');
      if (banner) { banner.hidden = true; banner.innerHTML = ''; }
    }
    this.cancel();
    this.mode = mode === 'station' ? 'station' : 'free';

    document.querySelectorAll('[data-sim-mode]').forEach(btn => {
      const on = btn.dataset.simMode === this.mode;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-pressed', String(on));
    });
    const panel = document.getElementById('station-panel');
    if (panel) panel.hidden = this.mode !== 'station';
    this.setFreePracticeControlsVisible(this.mode === 'free');

    if (this.mode === 'station') {
      this.renderSetup();
    } else {
      this.app.training.startNewScenario();
    }
  }

  setFreePracticeControlsVisible(visible) {
    const next = document.getElementById('btn-next-scenario');
    if (next) next.hidden = !visible;
    // Revealing answers would defeat a station.
    const solution = document.getElementById('btn-show-solution');
    if (solution) solution.hidden = !visible;
    const title = document.getElementById('sim-card-title');
    if (title && visible) title.textContent = 'Target';
  }

  renderSetup() {
    const body = document.getElementById('station-body');
    if (!body) return;
    this.setClock(null);
    const series = this.seriesOptions();
    if (!series.includes(this.setup.series)) this.setup.series = series[0] || '';
    const opt = (v, cur, label = v) => `<option value="${escapeHTML(String(v))}" ${String(v) === String(cur) ? 'selected' : ''}>${escapeHTML(String(label))}</option>`;

    body.innerHTML = `
      <p class="small text-muted mb-3">Estimate the distance to each figure before time runs out. Results are shown only when the station is finished.</p>
      <div class="row g-2 mb-3">
        <div class="col-12">
          <label for="station-series" class="form-label small text-muted mb-1">Target series</label>
          <select id="station-series" class="form-select-tactical w-100">${series.map(s => opt(s, this.setup.series)).join('')}</select>
        </div>
        <div class="col-6">
          <label for="station-figures" class="form-label small text-muted mb-1">Figures</label>
          <select id="station-figures" class="form-select-tactical w-100">${FIGURE_COUNTS.map(n => opt(n, this.setup.figures)).join('')}</select>
        </div>
        <div class="col-6">
          <label for="station-time" class="form-label small text-muted mb-1">Time limit</label>
          <select id="station-time" class="form-select-tactical w-100">${TIME_LIMITS_S.map(t => opt(t, this.setup.timeLimit, `${t} s`)).join('')}</select>
        </div>
      </div>
      <div class="d-flex gap-2 flex-wrap">
        <button type="button" class="btn btn-tactical btn-tactical-primary flex-grow-1" id="station-start">Start station</button>
        <button type="button" class="btn btn-tactical btn-tactical-outline" id="station-lathund" title="Printable MIL-to-distance table for this series">
          <i class="bi bi-printer" aria-hidden="true"></i> Range card
        </button>
      </div>
    `;
    const read = () => {
      this.setup.series = body.querySelector('#station-series').value;
      this.setup.figures = Number(body.querySelector('#station-figures').value);
      this.setup.timeLimit = Number(body.querySelector('#station-time').value);
    };
    body.querySelector('#station-start').addEventListener('click', () => { read(); this.start(); });
    body.querySelector('#station-lathund').addEventListener('click', () => { read(); this.printLathund(this.setup.series); });
  }

  start() {
    const targets = this.seriesTargets(this.setup.series);
    if (targets.length === 0) {
      toast('That series has no targets.', 'warning');
      return;
    }
    // Distinct figures where possible, repeating only if the series is too small.
    let picks = shuffle(targets);
    while (picks.length < this.setup.figures) picks = picks.concat(shuffle(targets));
    picks = picks.slice(0, this.setup.figures);

    const env = this.app.training.environmentPreference;
    this.state = {
      id: 'station_' + Date.now().toString(36),
      figures: picks.map(t => buildScenario(t, { unit: this.unit, environment: env })),
      answers: [],
      times: [],
      index: 0,
      remainingMs: this.setup.timeLimit * 1000,
      runningSince: null
    };
    this.active = true;
    this.renderRunning();
    this.showFigure(0);
    this.resumeClock();
  }

  renderRunning() {
    const body = document.getElementById('station-body');
    if (!body) return;
    const n = this.state.figures.length;
    body.innerHTML = `
      <div class="d-flex justify-content-between align-items-center mb-2">
        <span class="tactical-font text-tan-light" id="station-progress"></span>
        <button type="button" class="btn btn-sm btn-outline-danger" id="station-abort">Abort</button>
      </div>
      <div class="station-dots" aria-hidden="true">${Array.from({ length: n }, (_, i) => `<span class="station-dot" data-i="${i}"></span>`).join('')}</div>
      <p class="small text-muted mt-2 mb-0">Submit an answer to move to the next figure.</p>
    `;
    body.querySelector('#station-abort').addEventListener('click', () => {
      if (confirm('Abort this station? Answers so far will be discarded.')) {
        this.cancel();
        this.renderSetup();
        this.app.training.startNewScenario();
      }
    });
  }

  showFigure(i) {
    this.state.index = i;
    const n = this.state.figures.length;
    const progress = document.getElementById('station-progress');
    if (progress) progress.textContent = `Figure ${i + 1} of ${n}`;
    document.querySelectorAll('.station-dot').forEach(dot => {
      const k = Number(dot.dataset.i);
      dot.classList.toggle('done', k < i);
      dot.classList.toggle('current', k === i);
    });
    const title = document.getElementById('sim-card-title');
    if (title) title.textContent = `Figure ${i + 1} of ${n}`;
    this.setFreePracticeControlsVisible(false);
    // Stations give no per-figure feedback, so the coach-mode reading isn't asked.
    const milRow = document.getElementById('sim-mil-reading-row');
    if (milRow) milRow.hidden = true;
    this.app.training.loadScenario(this.state.figures[i]);
  }

  /** Called by TrainingManager.submitAnswer while a station is running. */
  recordAnswer(answer) {
    if (!this.active) return;
    const i = this.state.index;
    this.state.answers[i] = answer;
    this.state.times[i] = Math.round(this.app.training.elapsedMs() / 1000);
    sfx.playClick();
    if (i + 1 < this.state.figures.length) this.showFigure(i + 1);
    else this.finish(false);
  }

  // ---- Countdown ----------------------------------------------------------

  remainingMs() {
    if (!this.state) return 0;
    return this.state.remainingMs - (this.state.runningSince ? Date.now() - this.state.runningSince : 0);
  }

  setClock(ms) {
    const el = document.getElementById('station-clock');
    if (!el) return;
    if (ms === null) { el.textContent = '--:--'; el.classList.remove('station-clock-low'); return; }
    const secs = Math.max(0, Math.ceil(ms / 1000));
    el.textContent = `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;
    el.classList.toggle('station-clock-low', secs <= 10);
  }

  resumeClock() {
    if (!this.active || this.state.runningSince || !this.app.training.simulatorVisible) return;
    this.state.runningSince = Date.now();
    if (!this.clockInterval) {
      this.clockInterval = setInterval(() => {
        const ms = this.remainingMs();
        this.setClock(ms);
        if (ms <= 0) this.finish(true);
      }, 200);
    }
  }

  pauseClock() {
    if (this.state && this.state.runningSince) {
      this.state.remainingMs -= Date.now() - this.state.runningSince;
      this.state.runningSince = null;
    }
    if (this.clockInterval) { clearInterval(this.clockInterval); this.clockInterval = null; }
  }

  onSimulatorShown() { if (this.active) this.resumeClock(); }
  onSimulatorHidden() { if (this.active) this.pauseClock(); }

  cancel() {
    this.pauseClock();
    this.active = false;
    this.state = null;
    this.setClock(null);
    this.app.training.applyCoachModeUI();
  }

  // ---- Results ------------------------------------------------------------

  finish(timeUp) {
    if (!this.active) return;
    this.pauseClock();
    this.setClock(Math.max(0, this.state.remainingMs));
    this.active = false;
    this.app.training.applyCoachModeUI();
    const { figures, answers, times } = this.state;
    const unit = this.unit;

    // Lock the last scenario so it can't be re-answered in free mode.
    const current = this.app.training.currentScenario;
    if (current) current.answered = true;
    this.app.training.setFormLocked(true);
    this.app.training.pauseTimer();

    let total = 0;
    let anySaveFailed = false;
    const rows = figures.map((s, i) => {
      const a = answers[i];
      if (!a) {
        return { s, a: null, score: 0 };
      }
      const r = calculateScoreAndRating(a.estimateMeters, s.distance);
      total += r.score;
      const saved = StorageManager.recordRound(
        this.app.training.buildRoundRecord(s, a, r, times[i] || 0, 'station')
      );
      if (!saved.ok) anySaveFailed = true;
      return { s, a, score: r.score, errorPct: r.errorPct };
    });
    if (anySaveFailed) toast('Some results could not be saved (browser storage unavailable or full).', 'warning');
    this.app.updateStatsUI();
    if (total >= figures.length * 80) sfx.playSuccess(); else sfx.playError();

    const body = document.getElementById('station-body');
    if (!body) return;
    const max = figures.length * 100;
    body.innerHTML = `
      <div class="mb-2 ${timeUp ? 'text-warning' : 'text-success'} tactical-font">${timeUp ? 'Time is up' : 'Station complete'}: ${total} of ${max} points</div>
      <div class="table-responsive">
        <table class="table table-dark table-sm align-middle mb-3 station-results">
          <thead><tr><th scope="col">#</th><th scope="col">Figure</th><th scope="col">Actual</th><th scope="col">Yours</th><th scope="col">Error</th><th scope="col">Pts</th></tr></thead>
          <tbody>
            ${rows.map((r, i) => `
              <tr>
                <td>${i + 1}</td>
                <td>${escapeHTML(r.s.target.name)}</td>
                <td class="mono-font">${escapeHTML(formatDistance(r.s.distance, unit))}</td>
                <td class="mono-font">${r.a ? escapeHTML(formatDistance(r.a.estimateMeters, unit)) : '<span class="text-muted">no answer</span>'}</td>
                <td class="mono-font">${r.a ? `${r.errorPct}%` : '–'}</td>
                <td class="mono-font">${r.score}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <div class="d-flex gap-2 flex-wrap">
        <button type="button" class="btn btn-tactical btn-tactical-primary flex-grow-1" id="station-again">New station</button>
        <button type="button" class="btn btn-tactical btn-tactical-outline" id="station-free">Free practice</button>
      </div>
    `;
    body.querySelector('#station-again').addEventListener('click', () => this.renderSetup());
    body.querySelector('#station-free').addEventListener('click', () => this.setMode('free'));
    body.querySelector('#station-again').focus({ preventScroll: true });
  }

  // ---- Printable range card (lathund) --------------------------------------

  /**
   * Builds a printable table: one row per figure in the series, one column per MIL
   * reading, each cell the distance that reading means for that figure's height.
   * Cells far outside the figure's competition window are left blank.
   */
  printLathund(series) {
    const targets = this.seriesTargets(series).slice().sort((a, b) => a.height - b.height);
    if (targets.length === 0) { toast('That series has no targets.', 'warning'); return; }
    const unit = this.unit;
    const area = document.getElementById('print-area');
    if (!area) return;

    const cell = (t, mil) => {
      const meters = (t.height * 1000) / mil;
      if (t.minDistance && t.maxDistance && (meters < t.minDistance * 0.85 || meters > t.maxDistance * 1.15)) return '';
      return escapeHTML(formatDistance(meters, unit).replace(/ (m|yd)$/, ''));
    };
    const sizeStr = (m) => unit === 'imperial' ? `${(m * 39.3701).toFixed(1)} in` : `${Math.round(m * 1000)} mm`;

    area.innerHTML = `
      <h1>RRET range card: ${escapeHTML(series)}</h1>
      <p>Distance (${unit === 'imperial' ? 'yards' : 'meters'}) = figure height × ${unit === 'imperial' ? '27.78 (inches)' : '1000 (meters)'} ÷ MIL reading of the figure's <strong>height</strong>. Blank cells are outside the figure's competition window.</p>
      <table>
        <thead><tr><th>Figure</th><th>Height</th><th>Window</th>${LATHUND_MILS.map(m => `<th>${m}</th>`).join('')}</tr></thead>
        <tbody>
          ${targets.map(t => `<tr><th>${escapeHTML(t.name)}</th><td>${sizeStr(t.height)}</td><td>${t.minDistance && t.maxDistance ? `${t.minDistance}–${t.maxDistance} m` : '–'}</td>${LATHUND_MILS.map(m => `<td>${cell(t, m)}</td>`).join('')}</tr>`).join('')}
        </tbody>
      </table>
      <p class="print-foot">Generated by RRET (jozeta.github.io/RRET). Column headings are MIL readings.</p>
    `;
    area.hidden = false;
    const cleanup = () => { area.hidden = true; area.innerHTML = ''; window.removeEventListener('afterprint', cleanup); };
    window.addEventListener('afterprint', cleanup);
    window.print();
  }
}
