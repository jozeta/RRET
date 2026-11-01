/* ==========================================================================
   Progress analytics (FEAT-006)
   Where is the shooter weak? Error by category and distance band, systematic
   over/under-estimation (bias), a trend over recent rounds, and CSV export.
   Charts are plain SVG: one series each, so a single accent colour (validated
   for >= 3:1 contrast on every theme surface), no legend, a hover tooltip and a
   table view for every chart.
   ========================================================================== */

import { StorageManager } from './storage.js';
import { DISTANCE_BANDS } from './scenario-logic.js';
import { escapeHTML } from './utils.js';

const BAND_ORDER = ['close', 'medium', 'long', 'extreme'];

function mean(values) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

export function bandOf(meters) {
  for (const key of BAND_ORDER) {
    const b = DISTANCE_BANDS[key];
    if (meters >= b.min && meters < b.max) return key;
  }
  return 'extreme';
}

/** Signed error in % (+ = estimated too far). Older records lack signedErrorPct. */
function signedError(h) {
  if (Number.isFinite(h.signedErrorPct)) return h.signedErrorPct;
  if (h.actualDistanceMeters > 0 && Number.isFinite(h.estimatedDistanceMeters)) {
    return ((h.estimatedDistanceMeters - h.actualDistanceMeters) / h.actualDistanceMeters) * 100;
  }
  return null;
}

/** Pure: summarises a newest-first history array. */
export function computeAnalytics(history) {
  const rounds = history.filter(h => h && Number.isFinite(h.errorPct)).slice().reverse(); // oldest first
  const signed = rounds.map(signedError).filter(v => v !== null);

  const group = (keyFn) => {
    const map = new Map();
    rounds.forEach(h => {
      const k = keyFn(h);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(h);
    });
    return map;
  };

  const byCategory = [...group(h => h.targetCategory || 'Unknown').entries()]
    .map(([key, hs]) => ({ key, label: key, rounds: hs.length, meanErrorPct: mean(hs.map(h => h.errorPct)), bias: mean(hs.map(signedError).filter(v => v !== null)) }))
    .sort((a, b) => b.meanErrorPct - a.meanErrorPct);

  const bandGroups = group(h => bandOf(h.actualDistanceMeters));
  const byBand = BAND_ORDER.filter(k => bandGroups.has(k)).map(key => {
    const hs = bandGroups.get(key);
    return { key, label: DISTANCE_BANDS[key].label, rounds: hs.length, meanErrorPct: mean(hs.map(h => h.errorPct)), bias: mean(hs.map(signedError).filter(v => v !== null)) };
  });

  // Trend: rolling mean of |error| over the last 50 rounds (window 5).
  const recent = rounds.slice(-50);
  const trend = recent.map((h, i) => {
    const win = recent.slice(Math.max(0, i - 4), i + 1);
    return { index: rounds.length - recent.length + i + 1, errorPct: h.errorPct, rolling: mean(win.map(w => w.errorPct)), label: h.targetName };
  });

  return {
    rounds: rounds.length,
    within5Pct: rounds.length ? (rounds.filter(h => h.errorPct <= 5).length / rounds.length) * 100 : 0,
    bias: mean(signed),
    byCategory,
    byBand,
    trend
  };
}

function biasSentence(bias) {
  const v = Math.abs(bias);
  if (v < 1) return 'No systematic bias: your misses are balanced between too near and too far.';
  return bias > 0
    ? `You tend to over-estimate (answer too far) by ${v.toFixed(1)}% on average.`
    : `You tend to under-estimate (answer too near) by ${v.toFixed(1)}% on average.`;
}

export class AnalyticsController {
  constructor(app) {
    this.app = app;
    this.tooltip = null;
  }

  init() {
    const btn = document.getElementById('btn-export-history-csv');
    if (btn) btn.addEventListener('click', () => this.exportCSV());
  }

  render() {
    const container = document.getElementById('analytics-container');
    if (!container) return;
    const a = computeAnalytics(StorageManager.getHistory());

    if (a.rounds < 3) {
      container.innerHTML = `<p class="text-muted mb-0">Complete at least 3 rounds to see where your estimates go wrong.</p>`;
      return;
    }

    container.innerHTML = `
      <div class="row g-3 mb-3">
        <div class="col-md-4">
          <div class="analytics-tile">
            <div class="analytics-tile-label">Bias</div>
            <div class="analytics-tile-value mono-font">${a.bias >= 0 ? '+' : '−'}${Math.abs(a.bias).toFixed(1)}%</div>
            <div class="analytics-tile-note">${escapeHTML(biasSentence(a.bias))}</div>
          </div>
        </div>
        <div class="col-md-4">
          <div class="analytics-tile">
            <div class="analytics-tile-label">Within 5%</div>
            <div class="analytics-tile-value mono-font">${Math.round(a.within5Pct)}%</div>
            <div class="analytics-tile-note">of ${a.rounds} rounds scored 80 points or more.</div>
          </div>
        </div>
        <div class="col-md-4">
          <div class="analytics-tile">
            <div class="analytics-tile-label">Weakest category</div>
            <div class="analytics-tile-value analytics-tile-text">${escapeHTML(a.byCategory[0] ? a.byCategory[0].label : '–')}</div>
            <div class="analytics-tile-note">${a.byCategory[0] ? `${a.byCategory[0].meanErrorPct.toFixed(1)}% mean error over ${a.byCategory[0].rounds} rounds.` : ''}</div>
          </div>
        </div>
      </div>
      <div class="row g-3">
        <div class="col-lg-6">
          <h3 class="analytics-chart-title">Mean error by category</h3>
          ${this.barChart(a.byCategory)}
        </div>
        <div class="col-lg-6">
          <h3 class="analytics-chart-title">Mean error by distance band</h3>
          ${this.barChart(a.byBand)}
        </div>
        <div class="col-12">
          <h3 class="analytics-chart-title">Error trend, last ${a.trend.length} rounds <span class="text-muted small">(5-round rolling mean)</span></h3>
          ${this.lineChart(a.trend)}
        </div>
      </div>
      <details class="mt-3">
        <summary class="small text-muted">Show the numbers as a table</summary>
        ${this.tables(a)}
      </details>
    `;
    this.bindTooltips(container);
  }

  /** Horizontal bars: <= 24px thick, rounded data end, value label at the end. */
  barChart(rows) {
    if (!rows.length) return '<p class="text-muted small">No data yet.</p>';
    const labelW = 150, barMaxW = 260, rowH = 30, barH = 18, pad = 4;
    const max = Math.max(10, ...rows.map(r => r.meanErrorPct));
    const width = labelW + barMaxW + 60;
    const height = rows.length * rowH + pad * 2;
    const bars = rows.map((r, i) => {
      const y = pad + i * rowH + (rowH - barH) / 2;
      const w = Math.max(2, (r.meanErrorPct / max) * barMaxW);
      const tip = `${r.label}: ${r.meanErrorPct.toFixed(1)}% mean error, bias ${r.bias >= 0 ? '+' : ''}${r.bias.toFixed(1)}%, ${r.rounds} rounds`;
      // Path: square at the baseline, 4px rounded data end.
      const rr = Math.min(4, w / 2);
      const x0 = labelW, x1 = labelW + w;
      const d = `M${x0},${y} H${x1 - rr} Q${x1},${y} ${x1},${y + rr} V${y + barH - rr} Q${x1},${y + barH} ${x1 - rr},${y + barH} H${x0} Z`;
      return `
        <g class="chart-hit" data-tip="${escapeHTML(tip)}" tabindex="0" role="img" aria-label="${escapeHTML(tip)}">
          <rect x="0" y="${pad + i * rowH}" width="${width}" height="${rowH}" fill="transparent"/>
          <text x="${labelW - 8}" y="${y + barH / 2}" class="chart-label" text-anchor="end" dominant-baseline="central">${escapeHTML(r.label.length > 22 ? r.label.slice(0, 21) + '…' : r.label)}</text>
          <path d="${d}" class="chart-bar"/>
          <text x="${x1 + 6}" y="${y + barH / 2}" class="chart-value" dominant-baseline="central">${r.meanErrorPct.toFixed(1)}%</text>
        </g>`;
    }).join('');
    return `<svg class="analytics-chart" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMinYMin meet">
      <line x1="${labelW}" y1="0" x2="${labelW}" y2="${height}" class="chart-axis"/>
      ${bars}
    </svg>`;
  }

  /** Single-series line (2px) with an end marker; per-point hover targets. */
  lineChart(points) {
    if (points.length < 2) return '<p class="text-muted small">Not enough rounds yet.</p>';
    const W = 640, H = 180, L = 40, R = 16, T = 12, B = 26;
    const max = Math.max(10, ...points.map(p => p.rolling));
    const x = (i) => L + (i / (points.length - 1)) * (W - L - R);
    const y = (v) => T + (1 - v / max) * (H - T - B);
    const ticks = [0, max / 2, max].map(v => `
      <line x1="${L}" y1="${y(v)}" x2="${W - R}" y2="${y(v)}" class="chart-grid"/>
      <text x="${L - 6}" y="${y(v)}" class="chart-label" text-anchor="end" dominant-baseline="central">${Math.round(v)}%</text>`).join('');
    const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.rolling).toFixed(1)}`).join(' ');
    const last = points[points.length - 1];
    const hits = points.map((p, i) => {
      const tip = `Round ${p.index} (${p.label}): ${p.errorPct.toFixed(1)}% error, rolling mean ${p.rolling.toFixed(1)}%`;
      const cw = (W - L - R) / (points.length - 1);
      return `<g class="chart-hit" data-tip="${escapeHTML(tip)}"><rect x="${x(i) - cw / 2}" y="${T}" width="${cw}" height="${H - T - B}" fill="transparent"/><circle cx="${x(i)}" cy="${y(p.rolling)}" r="4" class="chart-hover-dot"/></g>`;
    }).join('');
    return `<svg class="analytics-chart analytics-chart-line" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMinYMin meet" role="img" aria-label="Rolling mean error over the last ${points.length} rounds, latest ${last.rolling.toFixed(1)}%">
      ${ticks}
      <line x1="${L}" y1="${H - B}" x2="${W - R}" y2="${H - B}" class="chart-axis"/>
      <text x="${L}" y="${H - 6}" class="chart-label">older</text>
      <text x="${W - R}" y="${H - 6}" class="chart-label" text-anchor="end">latest</text>
      <path d="${path}" class="chart-line"/>
      <circle cx="${x(points.length - 1)}" cy="${y(last.rolling)}" r="5" class="chart-end-dot"/>
      <text x="${x(points.length - 1) - 8}" y="${y(last.rolling) - 10}" class="chart-value" text-anchor="end">${last.rolling.toFixed(1)}%</text>
      ${hits}
    </svg>`;
  }

  tables(a) {
    const rows = (list) => list.map(r => `<tr><th scope="row">${escapeHTML(r.label)}</th><td>${r.rounds}</td><td>${r.meanErrorPct.toFixed(1)}%</td><td>${r.bias >= 0 ? '+' : ''}${r.bias.toFixed(1)}%</td></tr>`).join('');
    const head = (first) => `<thead><tr><th scope="col">${first}</th><th scope="col">Rounds</th><th scope="col">Mean error</th><th scope="col">Bias</th></tr></thead>`;
    return `
      <table class="table table-dark table-sm mt-2">${head('Category')}<tbody>${rows(a.byCategory)}</tbody></table>
      <table class="table table-dark table-sm">${head('Distance band')}<tbody>${rows(a.byBand)}</tbody></table>`;
  }

  bindTooltips(container) {
    if (!this.tooltip || !document.body.contains(this.tooltip)) {
      this.tooltip = document.createElement('div');
      this.tooltip.className = 'chart-tooltip';
      this.tooltip.hidden = true;
      document.body.appendChild(this.tooltip);
    }
    const tip = this.tooltip;
    const show = (el, x, y) => {
      tip.textContent = el.dataset.tip;
      tip.hidden = false;
      const r = tip.getBoundingClientRect();
      tip.style.left = `${Math.min(window.innerWidth - r.width - 8, x + 12)}px`;
      tip.style.top = `${Math.max(8, y - r.height - 10)}px`;
      el.classList.add('is-hover');
    };
    const hide = (el) => { tip.hidden = true; el.classList.remove('is-hover'); };
    container.querySelectorAll('.chart-hit').forEach(el => {
      el.addEventListener('mousemove', (e) => show(el, e.clientX, e.clientY));
      el.addEventListener('mouseleave', () => hide(el));
      el.addEventListener('focus', () => { const r = el.getBoundingClientRect(); show(el, r.left + r.width / 2, r.top); });
      el.addEventListener('blur', () => hide(el));
    });
  }

  exportCSV() {
    const history = StorageManager.getHistory();
    if (!history.length) return;
    const cols = ['timestamp', 'mode', 'targetName', 'targetCategory', 'actualDistanceMeters', 'estimatedDistanceMeters', 'errorPct', 'signedErrorPct', 'score', 'milReading', 'timeSeconds', 'unit'];
    const esc = (v) => {
      if (v === undefined || v === null) return '';
      let s = String(v);
      // Neutralise spreadsheet formula injection from user-named targets.
      if (/^[=+\-@\t\r]/.test(s) && typeof v === 'string') s = `'${s}`;
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [cols.join(','), ...history.slice().reverse().map(h => cols.map(c => esc(h[c])).join(','))].join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'rret_history.csv';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
