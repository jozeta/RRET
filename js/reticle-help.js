/* ==========================================================================
   Reticle help: how a reticle works, where its marks are, and how to range
   with it — with a drawing of the reticle and a worked example measurement.
   Opened from the simulator ("How it works"), the Learn page and Settings.
   ========================================================================== */

import { RETICLE_BY_ID, reticleSVG } from './reticle-designs.js';
import { escapeHTML } from './utils.js';

/** Which part of each reticle the help drawing shows (MIL centre and scale). */
const VIEWS = {
  pso1_rangefinder: { x: -4.5, y: 2.6, ppm: 34 },
  ranging_ladder: { x: -4, y: 3.4, ppm: 36 },
  duplex_bdc: { x: 0, y: 1.5, ppm: 24 },
  german_number4: { x: 0, y: 0.5, ppm: 40 },
  circle_dot: { x: 0, y: 0, ppm: 15 },
  christmas_tree: { x: 0, y: 2, ppm: 26 },
  tremor_style: { x: 0, y: 1, ppm: 46 },
  fine_milling: { x: 1, y: -0.5, ppm: 60 }
};

const W = 520;
const H = 340;
const n2 = (v) => Math.round(v * 100) / 100;

/** The example target (a dark figure) and a brass dimension bracket, in MIL. */
function exampleOverlay(design, view) {
  const ex = design.example;
  if (!ex) return '';
  const ppm = view.ppm;
  const X = (x) => n2(W / 2 + (x - view.x) * ppm);
  const Y = (y) => n2(H / 2 + (y - view.y) * ppm);
  let x0, x1, yTop, yBase, label;

  if (ex.rangefinder) {
    const xOf = (d) => -10 + ((d - 200) / 800) * 8;
    const hMil = 1700 / ex.rangefinder;
    const cx = xOf(ex.rangefinder);
    yBase = 5; yTop = 5 - hMil;
    const wMil = hMil * 0.28;
    x0 = cx - wMil / 2; x1 = cx + wMil / 2;
    label = `${n2(hMil)} MIL = 1.7 m at ${ex.rangefinder} m`;
    return person(X, Y, cx, yBase, hMil) + bracket(X, Y, x1 + 0.25, yTop, yBase, label);
  }
  if (ex.ladder) {
    yBase = 6; yTop = 6 - ex.mil; x0 = -6.55; x1 = -5.75;
  } else if (ex.toPost) {
    yBase = 0; yTop = -ex.mil; x0 = ex.x - 0.35; x1 = ex.x + 0.35;
  } else {
    yBase = 0; yTop = -ex.mil;
    const wMil = Math.min(ex.mil * 0.75, 1.6);
    x0 = ex.x - wMil / 2; x1 = ex.x + wMil / 2;
  }
  label = `${ex.mil} MIL`;
  const r = Math.min(6, (x1 - x0) * ppm * 0.25);
  const fig = `<rect x="${X(x0)}" y="${Y(yTop)}" width="${n2((x1 - x0) * ppm)}" height="${n2((yBase - yTop) * ppm)}" rx="${n2(r)}" fill="#3c4a40" fill-opacity="0.85"/>`;
  return fig + bracket(X, Y, x1 + 0.25, yTop, yBase, label);
}

function person(X, Y, cx, yBase, hMil) {
  const head = hMil * 0.13;
  const bodyW = hMil * 0.26;
  return `<g fill="#3c4a40" fill-opacity="0.9">
    <circle cx="${X(cx)}" cy="${Y(yBase - hMil + head)}" r="${n2(Math.abs(Y(0) - Y(head)))}"/>
    <rect x="${X(cx - bodyW / 2)}" y="${Y(yBase - hMil + head * 2)}" width="${n2(Math.abs(X(bodyW) - X(0)))}" height="${n2(Math.abs(Y(hMil - head * 2) - Y(0)))}" rx="3"/>
  </g>`;
}

function bracket(X, Y, x, yTop, yBase, label) {
  const tick = 6;
  return `<g stroke="#a8812f" stroke-width="1.6" fill="none">
      <path d="M ${X(x) - tick} ${Y(yTop)} H ${X(x)} V ${Y(yBase)} H ${X(x) - tick}"/>
    </g>
    <text x="${n2(X(x) + 6)}" y="${n2((Y(yTop) + Y(yBase)) / 2)}" font-size="13" font-weight="700" fill="#7a5c1c" dominant-baseline="central" font-family="Archivo, sans-serif">${escapeHTML(label)}</text>`;
}

/** Help-diagram SVG for a reticle (also used for small previews). */
export function reticleDiagram(id, { width = W, height = H, withExample = true, view: viewOverride = null } = {}) {
  const design = RETICLE_BY_ID[id];
  const view = viewOverride || VIEWS[id] || { x: 0, y: 0, ppm: 26 };
  const cx = width / 2 - view.x * view.ppm;
  const cy = height / 2 - view.y * view.ppm;
  return `<svg viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-label="${escapeHTML(design.name)} reticle${withExample && design.example ? ' with an example measurement' : ''}">
    <rect width="${width}" height="${height}" rx="10" fill="#e3e8e2"/>
    ${withExample ? exampleOverlay(design, view) : ''}
    ${reticleSVG(id, { ppm: view.ppm, cx, cy, color: '#151515', fontPx: Math.max(10, Math.min(13, view.ppm * 0.38)) })}
  </svg>`;
}

export class ReticleHelp {
  constructor(app) {
    this.app = app;
    this.currentId = null;
  }

  init() {
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-reticle-help]');
      if (!btn) return;
      e.preventDefault();
      const id = btn.dataset.reticle
        || (btn.dataset.reticleFrom && document.querySelector(btn.dataset.reticleFrom)?.value)
        || document.getElementById('sim-reticle-select')?.value
        || this.app.scope.reticleType;
      this.open(id);
    });
    const use = document.getElementById('reticle-help-use');
    if (use) {
      use.addEventListener('click', () => {
        if (!this.currentId) return;
        this.app.setReticle(this.currentId);
        window.bootstrap.Modal.getOrCreateInstance(document.getElementById('reticle-help-modal')).hide();
        this.app.navigateTo('simulator');
      });
    }
  }

  open(id) {
    const d = RETICLE_BY_ID[id];
    if (!d) return;
    this.currentId = id;
    document.getElementById('reticle-help-title').textContent = d.name;
    document.getElementById('reticle-help-family').textContent = `${d.family} · ${d.scale}`;
    const list = (items, tag) => `<${tag} class="reticle-help-list">${items.map(i => `<li>${escapeHTML(i)}</li>`).join('')}</${tag}>`;
    document.getElementById('reticle-help-body').innerHTML = `
      <figure class="reticle-help-figure">
        ${reticleDiagram(id)}
        ${d.example ? `<figcaption>${escapeHTML(d.example.note)}</figcaption>` : ''}
      </figure>
      <p class="reticle-help-summary">${escapeHTML(d.summary)}</p>
      <div class="row g-4">
        <div class="col-md-6">
          <h3 class="h6">The marks</h3>
          ${list(d.marks, 'ul')}
        </div>
        <div class="col-md-6">
          <h3 class="h6">How to measure</h3>
          ${list(d.measure, 'ol')}
        </div>
      </div>
      <p class="small text-muted mb-0 mt-3">This reticle is drawn in first focal plane: the marks keep their MIL value at every magnification. Very fine marks are hidden at low power, where they would merge; zoom in to see them.</p>
    `;
    window.bootstrap.Modal.getOrCreateInstance(document.getElementById('reticle-help-modal')).show();
  }
}
