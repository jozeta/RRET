/* ==========================================================================
   Learn Page & Interactive Tutorial Engine (Vector Optics Academy Edition)
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
          <text x="40" y="155" fill="#9ba7b4" font-family="'Rajdhani', sans-serif" font-size="12" text-anchor="middle">SHOOTER (EYE)</text>

          <!-- Angular Rays -->
          <line x1="40" y1="120" x2="620" y2="40" stroke="#ff8c00" stroke-width="1.8" stroke-dasharray="4 4"/>
          <line x1="40" y1="120" x2="620" y2="200" stroke="#ff8c00" stroke-width="1.8" stroke-dasharray="4 4"/>

          <!-- 100m Marker -->
          <line x1="280" y1="88" x2="280" y2="152" stroke="#c9a572" stroke-width="3"/>
          <line x1="40" y1="175" x2="280" y2="175" stroke="#c9a572" stroke-width="1" marker-end="url(#arrow)"/>
          <text x="160" y="195" fill="#c9a572" font-family="'Roboto Mono', monospace" font-size="13" text-anchor="middle">100 METERS</text>
          <text x="295" y="125" fill="#ff8c00" font-family="'Roboto Mono', monospace" font-size="13">10 cm (0.1m)</text>

          <!-- 1000m Marker -->
          <line x1="620" y1="40" x2="620" y2="200" stroke="#ff8c00" stroke-width="3"/>
          <line x1="40" y1="215" x2="620" y2="215" stroke="#ff8c00" stroke-width="1" marker-end="url(#arrow)"/>
          <text x="330" y="232" fill="#ff8c00" font-family="'Roboto Mono', monospace" font-size="13" text-anchor="middle">1000 METERS</text>
          <text x="630" y="125" fill="#ff8c00" font-family="'Roboto Mono', monospace" font-size="14" font-weight="bold">1 METER (100cm)</text>

          <!-- MIL Arc Angle -->
          <path d="M 120 109 A 80 80 0 0 1 120 131" fill="none" stroke="#ff8c00" stroke-width="2"/>
          <text x="135" y="124" fill="#ff8c00" font-family="'Rajdhani', sans-serif" font-size="14" font-weight="bold">1 MIL (1 mrad)</text>
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
            <text x="155" y="28" fill="#708563" font-family="'Rajdhani', sans-serif" font-size="15" font-weight="bold" text-anchor="middle">FIRST FOCAL PLANE (FFP)</text>
            
            <circle cx="155" cy="110" r="60" fill="#0b0d0f" stroke="#c9a572" stroke-width="2"/>
            <!-- Target & Reticle grow together -->
            <polygon points="145,90 165,90 170,100 170,130 140,130 140,100" fill="#1e242b" stroke="#ffffff"/>
            <line x1="95" y1="110" x2="215" y2="110" stroke="#ff8c00" stroke-width="2"/>
            <line x1="155" y1="50" x2="155" y2="170" stroke="#ff8c00" stroke-width="2"/>
            <circle cx="125" cy="110" r="3" fill="#ff8c00"/>
            <circle cx="185" cy="110" r="3" fill="#ff8c00"/>
            
            <text x="155" y="190" fill="#9ba7b4" font-family="Inter, sans-serif" font-size="11" text-anchor="middle">Reticle & Target scale ALWAYS at 1:1 ratio</text>
          </g>

          <!-- SFP Box -->
          <g transform="translate(370, 10)">
            <rect x="0" y="0" width="310" height="210" rx="10" fill="#14181c" stroke="#2a343d" stroke-width="2"/>
            <text x="155" y="28" fill="#9ba7b4" font-family="'Rajdhani', sans-serif" font-size="15" font-weight="bold" text-anchor="middle">SECOND FOCAL PLANE (SFP)</text>
            
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
          <circle cx="40" cy="180" r="10" fill="#ff8c00"/>
          <text x="40" y="205" fill="#9ba7b4" font-family="'Rajdhani', sans-serif" font-size="12" text-anchor="middle">SHOOTER</text>

          <!-- Target at top of slope -->
          <polygon points="430,45 450,45 450,60 430,60" fill="#ef4444"/>
          <text x="440" y="35" fill="#ef4444" font-family="'Rajdhani', sans-serif" font-size="12" text-anchor="middle">TARGET</text>

          <!-- Slanted Line of Sight -->
          <line x1="40" y1="180" x2="440" y2="60" stroke="#ff8c00" stroke-width="2" stroke-dasharray="4 4"/>
          <text x="210" y="110" fill="#ff8c00" font-family="'Roboto Mono', monospace" font-size="12" transform="rotate(-16, 210, 110)">Line-of-Sight Range (300m)</text>

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

  /**
   * Small illustrative preview SVGs keyed by reticle id. Names, descriptions,
   * and feature tags come from data/reticles.json (via app.reticles) so there's
   * a single source of truth shared with the simulator/settings dropdowns —
   * only the presentational mini-diagram lives here.
   */
  static RETICLE_PREVIEW_SVG = {
    mil_dot: `<line x1="10" y1="70" x2="190" y2="70" stroke="#ff2a2a" stroke-width="2"/><line x1="100" y1="10" x2="100" y2="130" stroke="#ff2a2a" stroke-width="2"/><circle cx="70" cy="70" r="3" fill="#ff2a2a"/><circle cx="130" cy="70" r="3" fill="#ff2a2a"/><circle cx="100" cy="40" r="3" fill="#ff2a2a"/><circle cx="100" cy="100" r="3" fill="#ff2a2a"/>`,
    christmas_tree: `<line x1="10" y1="40" x2="190" y2="40" stroke="#ff2a2a" stroke-width="2"/><line x1="100" y1="10" x2="100" y2="130" stroke="#ff2a2a" stroke-width="2"/><circle cx="80" cy="65" r="2.5" fill="#ff2a2a"/><circle cx="120" cy="65" r="2.5" fill="#ff2a2a"/><circle cx="65" cy="90" r="2.5" fill="#ff2a2a"/><circle cx="135" cy="90" r="2.5" fill="#ff2a2a"/><circle cx="50" cy="115" r="2.5" fill="#ff2a2a"/><circle cx="150" cy="115" r="2.5" fill="#ff2a2a"/>`,
    tremor_style: `<line x1="10" y1="50" x2="190" y2="50" stroke="#ff2a2a" stroke-width="1.8"/><line x1="100" y1="10" x2="100" y2="130" stroke="#ff2a2a" stroke-width="1.8"/><line x1="85" y1="45" x2="85" y2="55" stroke="#ff2a2a" stroke-width="1.5"/><line x1="115" y1="45" x2="115" y2="55" stroke="#ff2a2a" stroke-width="1.5"/><circle cx="75" cy="75" r="2" fill="#ff2a2a"/><circle cx="125" cy="75" r="2" fill="#ff2a2a"/>`,
    mrad_grid: `<line x1="10" y1="70" x2="190" y2="70" stroke="#ff2a2a" stroke-width="2"/><line x1="100" y1="10" x2="100" y2="130" stroke="#ff2a2a" stroke-width="2"/><line x1="60" y1="62" x2="60" y2="78" stroke="#ff2a2a" stroke-width="1.5"/><line x1="140" y1="62" x2="140" y2="78" stroke="#ff2a2a" stroke-width="1.5"/><text x="60" y="94" fill="#ff2a2a" font-size="10" font-family="'Roboto Mono'" text-anchor="middle">2</text><text x="140" y="94" fill="#ff2a2a" font-size="10" font-family="'Roboto Mono'" text-anchor="middle">2</text>`,
    duplex_bdc: `<line x1="10" y1="40" x2="70" y2="40" stroke="#ff2a2a" stroke-width="6"/><line x1="130" y1="40" x2="190" y2="40" stroke="#ff2a2a" stroke-width="6"/><line x1="70" y1="40" x2="130" y2="40" stroke="#ff2a2a" stroke-width="1.5"/><line x1="100" y1="10" x2="100" y2="40" stroke="#ff2a2a" stroke-width="6"/><line x1="100" y1="40" x2="100" y2="130" stroke="#ff2a2a" stroke-width="1.5"/><line x1="90" y1="65" x2="110" y2="65" stroke="#ff2a2a" stroke-width="2"/><line x1="85" y1="90" x2="115" y2="90" stroke="#ff2a2a" stroke-width="2"/><line x1="80" y1="115" x2="120" y2="115" stroke="#ff2a2a" stroke-width="2"/>`,
    german_number4: `<line x1="10" y1="70" x2="75" y2="70" stroke="#ff2a2a" stroke-width="8"/><line x1="125" y1="70" x2="190" y2="70" stroke="#ff2a2a" stroke-width="8"/><line x1="100" y1="95" x2="100" y2="135" stroke="#ff2a2a" stroke-width="8"/><line x1="75" y1="70" x2="125" y2="70" stroke="#ff2a2a" stroke-width="1.5"/><line x1="100" y1="10" x2="100" y2="95" stroke="#ff2a2a" stroke-width="1.5"/>`,
    circle_dot: `<circle cx="100" cy="70" r="45" fill="none" stroke="#ff2a2a" stroke-width="3"/><circle cx="100" cy="70" r="3" fill="#ff2a2a"/><line x1="100" y1="70" x2="100" y2="130" stroke="#ff2a2a" stroke-width="1.8"/>`,
    crosshair_only: `<line x1="10" y1="70" x2="190" y2="70" stroke="#ff2a2a" stroke-width="1.2"/><line x1="100" y1="10" x2="100" y2="130" stroke="#ff2a2a" stroke-width="1.2"/><circle cx="100" cy="70" r="1.5" fill="#ff2a2a"/>`
  };

  renderReticleMatrix() {
    const container = document.getElementById('learn-reticles-comparison-grid');
    if (!container) return;

    const reticles = (this.app && this.app.reticles) || [];
    const previews = TutorialController.RETICLE_PREVIEW_SVG;

    container.innerHTML = reticles.map(r => `
      <div class="col-md-6 col-lg-3">
        <div class="reticle-preview-card d-flex flex-column">
          <div class="reticle-preview-svg">
            <svg viewBox="0 0 200 140" width="100%" height="100%">
              ${previews[r.id] || ''}
            </svg>
          </div>
          <h5 class="tactical-font text-tan-light mb-1">${r.name}</h5>
          <p class="small text-muted mb-3 flex-grow-1">${r.description}</p>
          <button class="btn btn-sm btn-tactical-outline w-100 btn-preview-select" data-reticle="${r.id}">
            Select in Simulator
          </button>
        </div>
      </div>
    `).join('');

    container.querySelectorAll('.btn-preview-select').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const reticleId = e.currentTarget.dataset.reticle;
        if (this.app && this.app.scope) {
          // updateSettings() itself keeps #sim-reticle-select in sync now.
          this.app.scope.updateSettings({ reticle: reticleId });
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

    const updateCalc = () => {
      const isImperial = unitSel.value === 'imperial';
      const sizeVal = parseFloat(sizeInput.value) || 0.65;
      const milVal = parseFloat(milInput.value) || 1.0;

      if (isImperial) {
        sizeLabel.textContent = 'TARGET SIZE (inches)';
        // Distance (yards) = (Size (in) * 27.77) / MIL
        const yards = Math.round((sizeVal * 27.77) / Math.max(0.1, milVal));
        resultDist.textContent = `${yards} yards`;
        resultFormula.textContent = `Formula: (${sizeVal}" × 27.77) / ${milVal} MIL = ${yards} yards`;
      } else {
        sizeLabel.textContent = 'TARGET SIZE (meters)';
        // Distance (m) = (Size (m) * 1000) / MIL
        const meters = Math.round((sizeVal * 1000) / Math.max(0.1, milVal));
        resultDist.textContent = `${meters} m`;
        resultFormula.textContent = `Formula: (${sizeVal}m × 1000) / ${milVal} MIL = ${meters}m`;
      }
    };

    unitSel.addEventListener('change', () => {
      if (unitSel.value === 'imperial') {
        sizeInput.value = (parseFloat(sizeInput.value) * 39.3701).toFixed(1);
      } else {
        sizeInput.value = (parseFloat(sizeInput.value) / 39.3701).toFixed(2);
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

  bindQuizEvents() {
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
