import { reticleDiagram } from './reticle-help.js';
import { escapeHTML } from './utils.js';

/* ==========================================================================
   Learn page: diagrams, calculator, quiz and reticle previews
   ========================================================================== */

export class TutorialController {
  constructor(app) {
    this.app = app;
  }

  init() {
    this.renderDiagrams();
    this.renderReticleMatrix();
    this.bindCalculator();
    this.bindQuizEvents();
  }

  renderDiagrams() {
    // 1. MIL / Subtension Geometry Diagram
    const milDiagram = document.getElementById('diagram-mil-subtension');
    if (milDiagram) {
      milDiagram.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 700 240" width="100%">
          <defs>
            <marker id="arrow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#c9a572"/>
            </marker>
          </defs>
          
          <!-- Shooter Eye -->
          <circle cx="40" cy="120" r="14" fill="#526348" stroke="#708563" stroke-width="2"/>
          <text x="40" y="155" fill="#9ba7b4" font-family="'Archivo', sans-serif" font-size="12" text-anchor="middle">Shooter (eye)</text>

          <!-- Angular Rays -->
          <line x1="40" y1="120" x2="620" y2="40" stroke="#ff8c00" stroke-width="1.8" stroke-dasharray="4 4"/>
          <line x1="40" y1="120" x2="620" y2="200" stroke="#ff8c00" stroke-width="1.8" stroke-dasharray="4 4"/>

          <!-- 100m Marker -->
          <line x1="280" y1="88" x2="280" y2="152" stroke="#c9a572" stroke-width="3"/>
          <line x1="40" y1="175" x2="280" y2="175" stroke="#c9a572" stroke-width="1" marker-end="url(#arrow)"/>
          <text x="160" y="195" fill="#c9a572" font-family="'Roboto Mono', monospace" font-size="13" text-anchor="middle">100 METERS</text>
          <text x="295" y="125" fill="#c9a55a" font-family="'Roboto Mono', monospace" font-size="13">10 cm (0.1m)</text>

          <!-- 1000m Marker -->
          <line x1="620" y1="40" x2="620" y2="200" stroke="#ff8c00" stroke-width="3"/>
          <line x1="40" y1="215" x2="620" y2="215" stroke="#ff8c00" stroke-width="1" marker-end="url(#arrow)"/>
          <text x="330" y="232" fill="#c9a55a" font-family="'Roboto Mono', monospace" font-size="13" text-anchor="middle">1000 METERS</text>
          <text x="630" y="125" fill="#c9a55a" font-family="'Roboto Mono', monospace" font-size="14" font-weight="bold">1 METER (100cm)</text>

          <!-- MIL Arc Angle -->
          <path d="M 120 109 A 80 80 0 0 1 120 131" fill="none" stroke="#ff8c00" stroke-width="2"/>
          <text x="135" y="124" fill="#c9a55a" font-family="'Archivo', sans-serif" font-size="14" font-weight="bold">1 MIL (1 mrad)</text>
        </svg>
      `;
    }

    // 2. FFP vs SFP Comparison Diagram
    const ffpDiagram = document.getElementById('diagram-ffp-vs-sfp');
    if (ffpDiagram) {
      ffpDiagram.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 700 240" width="100%">
          <!-- FFP Box -->
          <g transform="translate(20, 10)">
            <rect x="0" y="0" width="310" height="210" rx="10" fill="#14181c" stroke="#526348" stroke-width="2"/>
            <text x="155" y="28" fill="#708563" font-family="'Archivo', sans-serif" font-size="15" font-weight="bold" text-anchor="middle">First focal plane (FFP)</text>
            
            <circle cx="155" cy="110" r="60" fill="#0b0d0f" stroke="#c9a572" stroke-width="2"/>
            <!-- Target & Reticle grow together -->
            <polygon points="145,90 165,90 170,100 170,130 140,130 140,100" fill="#1e242b" stroke="#ffffff"/>
            <line x1="95" y1="110" x2="215" y2="110" stroke="#ff8c00" stroke-width="2"/>
            <line x1="155" y1="50" x2="155" y2="170" stroke="#ff8c00" stroke-width="2"/>
            <circle cx="125" cy="110" r="3" fill="#c9a55a"/>
            <circle cx="185" cy="110" r="3" fill="#c9a55a"/>
            
            <text x="155" y="190" fill="#9ba7b4" font-family="Inter, sans-serif" font-size="11" text-anchor="middle">Reticle & Target scale ALWAYS at 1:1 ratio</text>
          </g>

          <!-- SFP Box -->
          <g transform="translate(370, 10)">
            <rect x="0" y="0" width="310" height="210" rx="10" fill="#14181c" stroke="#2a343d" stroke-width="2"/>
            <text x="155" y="28" fill="#9ba7b4" font-family="'Archivo', sans-serif" font-size="15" font-weight="bold" text-anchor="middle">Second focal plane (SFP)</text>
            
            <circle cx="155" cy="110" r="60" fill="#0b0d0f" stroke="#2a343d" stroke-width="2"/>
            <!-- Target grows on zoom, reticle stays FIXED size -->
            <polygon points="145,90 165,90 170,100 170,130 140,130 140,100" fill="#1e242b" stroke="#ffffff"/>
            <line x1="115" y1="110" x2="195" y2="110" stroke="#9ba7b4" stroke-width="1.2"/>
            <line x1="155" y1="70" x2="155" y2="150" stroke="#9ba7b4" stroke-width="1.2"/>

            <text x="155" y="190" fill="#ef4444" font-family="Inter, sans-serif" font-size="11" text-anchor="middle">Reticle stays fixed. MILs valid ONLY at max zoom!</text>
          </g>
        </svg>
      `;
    }

    // 3. Slope / Angle Compensation Diagram
    const angleDiagram = document.getElementById('diagram-angle-compensation');
    if (angleDiagram) {
      angleDiagram.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 220" width="100%">
          <path d="M 40 180 L 440 180 L 440 60 Z" fill="rgba(82, 99, 72, 0.15)" stroke="#526348" stroke-width="2"/>
          
          <!-- Shooter on hill base -->
          <circle cx="40" cy="180" r="10" fill="#c9a55a"/>
          <text x="40" y="205" fill="#9ba7b4" font-family="'Archivo', sans-serif" font-size="12" text-anchor="middle">Shooter</text>

          <!-- Target at top of slope -->
          <polygon points="430,45 450,45 450,60 430,60" fill="#ef4444"/>
          <text x="440" y="35" fill="#ef4444" font-family="'Archivo', sans-serif" font-size="12" text-anchor="middle">Target</text>

          <!-- Slanted Line of Sight -->
          <line x1="40" y1="180" x2="440" y2="60" stroke="#ff8c00" stroke-width="2" stroke-dasharray="4 4"/>
          <text x="210" y="110" fill="#c9a55a" font-family="'Roboto Mono', monospace" font-size="12" transform="rotate(-16, 210, 110)">Line-of-Sight Range (300m)</text>

          <!-- Horizontal Distance -->
          <line x1="40" y1="180" x2="440" y2="180" stroke="#c9a572" stroke-width="2.5"/>
          <text x="240" y="200" fill="#c9a572" font-family="'Roboto Mono', monospace" font-size="12" text-anchor="middle">True Horizontal Range (260m)</text>

          <!-- Angle Arc -->
          <path d="M 100 180 A 60 60 0 0 0 92 163" fill="none" stroke="#ffaa00" stroke-width="2"/>
          <text x="115" y="172" fill="#ffaa00" font-family="'Roboto Mono', monospace" font-size="12">30&deg;</text>
        </svg>
      `;
    }
  }


  renderReticleMatrix() {
    const container = document.getElementById('learn-reticles-comparison-grid');
    if (!container) return;

    const reticles = (this.app && this.app.reticles) || [];
    // Previews are drawn by the same engine as the scope, so they can't drift.
    // eslint-disable-next-line no-unsanitized/property -- reviewed: strings escaped with escapeHTML, other values numeric or fixed; imported targets re-validated
    container.innerHTML = reticles.map(r => `
      <div class="col-md-6 col-lg-4 col-xl-3">
        <div class="reticle-preview-card d-flex flex-column">
          <div class="reticle-preview-svg">
            ${reticleDiagram(r.id, { width: 220, height: 150, withExample: false, view: { x: 0, y: 0, ppm: 9 } })}
          </div>
          <h3 class="h6 mb-1 mt-2">${escapeHTML(r.name)}</h3>
          <p class="small text-muted mb-1">${escapeHTML(r.scale)}</p>
          <p class="small text-muted mb-3 flex-grow-1">${escapeHTML(r.description)}</p>
          <div class="d-flex gap-2">
            <button type="button" class="btn btn-sm btn-tactical-outline flex-grow-1" data-reticle-help data-reticle="${escapeHTML(r.id)}">How it works</button>
            <button type="button" class="btn btn-sm btn-tactical-secondary btn-preview-select" data-reticle="${escapeHTML(r.id)}">Use</button>
          </div>
        </div>
      </div>
    `).join('');

    container.querySelectorAll('.btn-preview-select').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const reticleId = e.currentTarget.dataset.reticle;
        if (this.app && this.app.setReticle) {
          this.app.setReticle(reticleId);
          this.app.navigateTo('simulator');
        }
      });
    });
  }

  bindCalculator() {
    const unitSel = document.getElementById('calc-unit');
    const presetSel = document.getElementById('calc-preset');
    const sizeInput = document.getElementById('calc-size-input');
    const milInput = document.getElementById('calc-mil-input');

    const sizeLabel = document.getElementById('calc-size-label');
    const resultDist = document.getElementById('calc-result-distance');
    const resultFormula = document.getElementById('calc-result-formula');

    if (!unitSel || !sizeInput || !milInput) return;

    const num = (el) => {
      const v = parseFloat(String(el.value).replace(',', '.'));
      return Number.isFinite(v) && v > 0 ? v : null;
    };

    // Shows the result only for valid input; otherwise says what is missing
    // instead of silently substituting a default value.
    const updateCalc = () => {
      const isImperial = unitSel.value === 'imperial';
      sizeLabel.textContent = isImperial ? 'Target size (inches)' : 'Target size (metres)';
      const sizeVal = num(sizeInput);
      const milVal = num(milInput);
      if (sizeVal === null || milVal === null) {
        resultDist.textContent = '–';
        resultFormula.textContent = sizeVal === null
          ? 'Enter the target size (a number above 0).'
          : 'Enter your MIL reading (a number above 0).';
        return;
      }
      if (isImperial) {
        const yards = (sizeVal * 27.778) / milVal;
        resultDist.textContent = `${Math.round(yards)} yards`;
        resultFormula.textContent = `(${sizeVal} in × 27.78) ÷ ${milVal} MIL = ${Math.round(yards)} yards`;
      } else {
        const meters = (sizeVal * 1000) / milVal;
        resultDist.textContent = `${Math.round(meters)} m`;
        resultFormula.textContent = `(${sizeVal} m × 1000) ÷ ${milVal} MIL = ${Math.round(meters)} m`;
      }
    };

    unitSel.addEventListener('change', () => {
      const v = num(sizeInput);
      if (v !== null) {
        sizeInput.value = unitSel.value === 'imperial' ? (v * 39.3701).toFixed(1) : (v / 39.3701).toFixed(3);
      }
      updateCalc();
    });

    presetSel.addEventListener('change', (e) => {
      const val = e.target.value;
      if (val !== 'custom') {
        let sizeM = parseFloat(val);
        if (unitSel.value === 'imperial') {
          sizeInput.value = (sizeM * 39.3701).toFixed(1);
        } else {
          sizeInput.value = sizeM.toFixed(2);
        }
        updateCalc();
      }
    });

    sizeInput.addEventListener('input', updateCalc);
    milInput.addEventListener('input', updateCalc);

    updateCalc();
  }

  /** Shuffle each question's options and re-letter them, so the right answer
   *  isn't always in the same place. */
  shuffleQuiz() {
    document.querySelectorAll('.quiz-card').forEach(card => {
      const row = card.querySelector('.row');
      if (!row) return;
      const cols = [...row.children];
      for (let i = cols.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [cols[i], cols[j]] = [cols[j], cols[i]];
      }
      cols.forEach((col, k) => {
        const btn = col.querySelector('.quiz-option-btn');
        if (btn) btn.textContent = `${'ABCD'[k]}) ${btn.textContent.replace(/^[A-D]\)\s*/, '')}`;
        row.appendChild(col);
      });
    });
  }

  bindQuizEvents() {
    this.shuffleQuiz();
    const quizButtons = document.querySelectorAll('.quiz-option-btn');
    quizButtons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        const selected = e.currentTarget;
        const parentCard = selected.closest('.quiz-card');
        const isCorrect = selected.dataset.correct === 'true';

        parentCard.querySelectorAll('.quiz-option-btn').forEach(b => {
          b.classList.remove('correct', 'incorrect');
        });

        if (isCorrect) {
          selected.classList.add('correct');
        } else {
          selected.classList.add('incorrect');
        }

        const feedbackEl = parentCard.querySelector('.quiz-feedback');
        if (feedbackEl) {
          feedbackEl.style.display = 'block';
          // Each quiz-card carries its own feedback text via data attributes so
          // multiple questions don't all show the same hardcoded explanation.
          if (isCorrect) {
            feedbackEl.className = 'quiz-feedback text-success mt-2 font-mono small';
            feedbackEl.textContent = parentCard.dataset.feedbackCorrect || 'Correct!';
          } else {
            feedbackEl.className = 'quiz-feedback text-danger mt-2 font-mono small';
            feedbackEl.textContent = parentCard.dataset.feedbackIncorrect || 'Incorrect, try again.';
          }
        }
      });
    });
  }
}
