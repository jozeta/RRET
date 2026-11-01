/* ==========================================================================
   Target Library & Custom Target Management Controller
   ========================================================================== */

import { StorageManager } from './storage.js';
import { renderTargetSVGString, escapeHTML, isSafeImageDataURI } from './utils.js';
import { TargetDrawingCanvas } from './drawing.js';

/** Curated svgType shapes a user can pick for a custom (non-image) target. */
export const CUSTOM_TARGET_SHAPES = [
  { value: 'swe_b65', label: 'Head & Shoulder Silhouette' },
  { value: 'swe_c', label: 'Circle / Rings' },
  { value: 'swe_t', label: 'Round-Top Triangle' },
  { value: 'swe_s_v', label: 'Vertical Stadium / Pill' },
  { value: 'swe_l', label: 'Elongated Hexagon' },
  { value: 'swe_tunna', label: 'Barrel' },
  { value: 'circle_gong', label: 'Steel Gong (Circle)' },
  { value: 'ipsc_metric', label: 'IPSC Metric Silhouette' },
  { value: 'ipsc_mini', label: 'IPSC Mini Silhouette' },
  { value: 'prs_popper', label: 'PRS Steel Popper' },
  { value: 'mil_e_type', label: 'Military E-Type Silhouette' },
  { value: 'soldier_silhouette', label: 'Soldier Silhouette' },
  { value: 'deer', label: 'Deer' },
  { value: 'elk', label: 'Elk' },
  { value: 'moose', label: 'Moose' },
  { value: 'reindeer', label: 'Reindeer' },
  { value: 'bear', label: 'Bear' },
  { value: 'boar', label: 'Wild Boar' },
  { value: 'wolf', label: 'Wolf' },
  { value: 'fox', label: 'Fox' },
  { value: 'coyote', label: 'Coyote / Varmint' },
  { value: 'hare', label: 'Hare / Rabbit' },
  { value: 'pheasant', label: 'Pheasant' },
  { value: 'turkey', label: 'Wild Turkey' },
  { value: 'rect', label: 'Plain Rectangle' }
];

/** Shared category list — target library tabs and the simulator's category filter
 *  both need the same set (minus 'All', which each renders as its own reset option). */
export const TARGET_CATEGORIES = ['Swedish Korthåll', 'Swedish Field Shooting', 'Steel', 'IPSC', 'PRS', 'Military', 'Hunting', 'Custom'];

/**
 * Validates and coerces a single object from an imported target JSON file before it
 * ever reaches localStorage or the DOM. Untrusted input: type-check numerics, cap
 * string lengths, and reject any imageData that isn't a genuine image data URI.
 */
function sanitizeImportedTarget(t) {
  if (!t || typeof t !== 'object') return null;

  const name = typeof t.name === 'string' ? t.name.trim().slice(0, 120) : '';
  const height = Number(t.height);
  const width = Number(t.width);
  if (!name || !Number.isFinite(height) || height <= 0 || !Number.isFinite(width) || width <= 0) {
    return null;
  }

  const category = typeof t.category === 'string' && t.category.trim() ? t.category.trim().slice(0, 60) : 'Custom';
  const description = typeof t.description === 'string' ? t.description.slice(0, 500) : '';
  const imageData = isSafeImageDataURI(t.imageData) ? t.imageData : '';
  const svgType = !imageData && typeof t.svgType === 'string' ? t.svgType : (imageData ? undefined : 'swe_b65');
  const minDistance = Number.isFinite(Number(t.minDistance)) && Number(t.minDistance) > 0 ? Number(t.minDistance) : undefined;
  const maxDistance = Number.isFinite(Number(t.maxDistance)) && Number(t.maxDistance) > 0 ? Number(t.maxDistance) : undefined;

  return {
    // Restrict ids to a safe charset: they end up in HTML attributes and DOM lookups.
    id: typeof t.id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(t.id) ? t.id : 'custom_' + Date.now() + Math.random().toString(36).slice(2, 6),
    name,
    category,
    height,
    width,
    description,
    isBuiltIn: false,
    type: imageData ? 'image' : 'svg_shape',
    svgType,
    imageData,
    minDistance,
    maxDistance
  };
}

export class TargetsController {
  constructor(app) {
    this.app = app;
    this.builtInTargets = [];
    this.customTargets = [];
    this.allTargets = [];
    this.activeCategory = 'All';
    this.drawCanvas = null;
  }

  async init() {
    this.loadError = false;
    try {
      const resp = await fetch('data/targets.json');
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      this.builtInTargets = await resp.json();
    } catch (e) {
      console.warn('Failed to load targets.json', e);
      this.builtInTargets = [];
      this.loadError = true;
    }

    this.refreshTargets();
    this.populateShapeOptions();
    this.bindEvents();
    this.bindDrawingCanvas();
    this.renderCategoryTabs();
    this.renderTargetGrid();
  }

  populateShapeOptions() {
    const select = document.getElementById('target-shape');
    if (!select) return;
    select.innerHTML = CUSTOM_TARGET_SHAPES.map(s =>
      `<option value="${s.value}">${escapeHTML(s.label)}</option>`
    ).join('');

    // Picking a shape copies it onto the drawing canvas as a starting point you
    // can then edit — it previously had no effect at all beyond a static preview,
    // which read as "the dropdown doesn't do anything."
    select.addEventListener('change', () => this.copyShapeToDrawingCanvas());
    ['target-height', 'target-width'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('input', () => this.updateShapePreview());
    });
  }

  /**
   * Live-previews the currently selected preset shape into #target-modal-preview.
   * A no-op whenever a drawing/upload is active (target-image-data is set) — those
   * already have their own preview and take priority over the preset shape.
   */
  updateShapePreview() {
    const imageData = document.getElementById('target-image-data');
    if (imageData && imageData.value) return;

    const preview = document.getElementById('target-modal-preview');
    const shapeSelect = document.getElementById('target-shape');
    if (!preview || !shapeSelect) return;

    const height = parseFloat(document.getElementById('target-height')?.value) || 1;
    const width = parseFloat(document.getElementById('target-width')?.value) || 1;
    preview.innerHTML = renderTargetSVGString(
      { svgType: shapeSelect.value, height, width, color: '#1e242b', borderColor: '#ffffff' },
      100, 100
    );
  }

  /**
   * Rasterizes the currently selected preset shape (using the current height/width
   * fields) and stamps it onto the drawing canvas, so the user can hand-edit it
   * from there instead of only ever seeing a disconnected static preview. Also
   * used by openTargetModal() to seed the canvas when editing/cloning a target
   * that has a procedural shape but no saved drawing/image.
   */
  copyShapeToDrawingCanvas() {
    if (!this.drawCanvas) return;
    const shapeSelect = document.getElementById('target-shape');
    if (!shapeSelect) return;

    const height = parseFloat(document.getElementById('target-height')?.value) || 1;
    const width = parseFloat(document.getElementById('target-width')?.value) || 1;
    const svgStr = renderTargetSVGString(
      { svgType: shapeSelect.value, height, width, color: '#1e242b', borderColor: '#ffffff' },
      this.drawCanvas.canvas.width, this.drawCanvas.canvas.height
    );
    const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      this.drawCanvas.stampImage(img);
      URL.revokeObjectURL(url);
    };
    img.onerror = () => URL.revokeObjectURL(url);
    img.src = url;
  }

  refreshTargets() {
    this.customTargets = StorageManager.getCustomTargets();
    this.allTargets = [...this.builtInTargets, ...this.customTargets];
  }

  getAllTargets() {
    return this.allTargets;
  }

  getTargetById(id) {
    return this.allTargets.find(t => t.id === id);
  }

  renderCategoryTabs() {
    const container = document.getElementById('target-category-tabs');
    if (!container) return;

    const categories = ['All', ...TARGET_CATEGORIES];
    container.innerHTML = categories.map(cat => `
      <button class="btn btn-sm ${this.activeCategory === cat ? 'btn-tactical-primary' : 'btn-tactical-secondary'} me-1 mb-2" data-category="${cat}">
        ${cat}
      </button>
    `).join('');

    container.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', (e) => {
        this.activeCategory = e.currentTarget.dataset.category;
        this.renderCategoryTabs();
        this.renderTargetGrid();
      });
    });
  }

  renderTargetGrid() {
    const grid = document.getElementById('target-grid-container');
    if (!grid) return;

    let filtered = this.allTargets;
    if (this.activeCategory !== 'All') {
      if (this.activeCategory === 'Custom') {
        filtered = this.customTargets;
      } else {
        filtered = this.allTargets.filter(t => t.category === this.activeCategory);
      }
    }

    if (this.loadError && this.allTargets.length === 0) {
      grid.innerHTML = `
        <div class="col-12 text-center py-5 text-warning">
          <i class="bi bi-exclamation-triangle fs-1 d-block mb-3"></i>
          <p>The built-in target library failed to load.</p>
          <p class="text-muted small">This app uses <code>fetch()</code> to load target data, which requires an HTTP(S) origin.
          If you opened this file directly (<code>file://</code>), please serve it via a local HTTP server instead (see README).</p>
        </div>
      `;
      return;
    }

    if (filtered.length === 0) {
      grid.innerHTML = `
        <div class="col-12 text-center py-5 text-muted">
          <i class="bi bi-bullseye fs-1 d-block mb-3"></i>
          <p>No targets found in category "${escapeHTML(this.activeCategory)}".</p>
        </div>
      `;
      return;
    }

    grid.innerHTML = filtered.map(t => {
      const heightMm = Math.round(t.height * 1000);
      const widthMm = Math.round(t.width * 1000);
      const isCustom = !t.isBuiltIn;
      const distRangeStr = (t.minDistance && t.maxDistance) ? `${t.minDistance} - ${t.maxDistance} m` : 'Variable';

      // Letterbox the preview to the target's true width:height ratio instead of
      // forcing it into a square — a square box would stretch/distort elongated
      // targets (e.g. the S-series) away from their real proportions.
      const previewAspect = (t.width && t.height) ? (t.width / t.height) : 1;
      const previewW = previewAspect >= 1 ? 130 : Math.round(130 * previewAspect);
      const previewH = previewAspect >= 1 ? Math.round(130 / previewAspect) : 130;

      return `
        <div class="col-12 col-sm-6 col-md-4 col-lg-3 mb-4">
          <div class="target-card">
            <div class="target-preview-box">
              ${renderTargetSVGString(t, previewW, previewH)}
              <span class="position-absolute top-0 start-0 m-2 badge ${isCustom ? 'badge-tan' : 'badge-olive'}">
                ${escapeHTML(t.category)}
              </span>
            </div>
            <div class="target-card-body">
              <h5 class="tactical-font text-tan-light mb-1" style="font-size:1.05rem;">${escapeHTML(t.name)}</h5>
              <p class="text-muted small mb-2" style="font-size:0.8rem; line-height:1.3;">${escapeHTML(t.description || '')}</p>
              
              <div class="target-specs mb-3">
                <div class="d-flex justify-content-between">
                  <span>DIMENSIONS:</span> <strong class="text-orange-highlight">${widthMm}x${heightMm} mm</strong>
                </div>
                <div class="d-flex justify-content-between">
                  <span>COMP. RANGE:</span> <strong class="text-tan-accent">${distRangeStr}</strong>
                </div>
              </div>

              <div class="d-flex gap-2">
                <button class="btn btn-sm btn-tactical-outline flex-grow-1 btn-practice-target" data-target-id="${escapeHTML(t.id)}">
                  Practice Scenario
                </button>
                ${isCustom ? `
                  <button class="btn btn-sm btn-tactical-secondary btn-edit-target" data-target-id="${escapeHTML(t.id)}">
                    ✏️
                  </button>
                  <button class="btn btn-sm btn-outline-danger btn-delete-target" data-target-id="${escapeHTML(t.id)}">
                    🗑️
                  </button>
                ` : `
                  <button class="btn btn-sm btn-tactical-secondary btn-duplicate-target" data-target-id="${escapeHTML(t.id)}" title="Duplicate as Custom">
                    📋
                  </button>
                `}
              </div>
            </div>
          </div>
        </div>
      `;
    }).join('');

    // Bind item buttons
    grid.querySelectorAll('.btn-practice-target').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.dataset.targetId;
        const target = this.getTargetById(id);
        if (!target) {
          alert('That target could not be found. It may have been deleted.');
          return;
        }
        if (this.app && this.app.startScenarioWithTarget) {
          this.app.startScenarioWithTarget(target);
          this.app.navigateTo('simulator');
        }
      });
    });

    grid.querySelectorAll('.btn-duplicate-target').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.dataset.targetId;
        this.duplicateTarget(id);
      });
    });

    grid.querySelectorAll('.btn-edit-target').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.dataset.targetId;
        this.openTargetModal(id);
      });
    });

    grid.querySelectorAll('.btn-delete-target').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.dataset.targetId;
        if (confirm('Delete this custom target?')) {
          StorageManager.deleteCustomTarget(id);
          this.refreshTargets();
          this.renderTargetGrid();
        }
      });
    });
  }

  duplicateTarget(targetId) {
    const source = this.getTargetById(targetId);
    if (!source) return;

    const copy = {
      ...source,
      id: 'custom_' + Date.now(),
      name: `${source.name} (Copy)`,
      isBuiltIn: false,
      category: 'Custom'
    };

    StorageManager.saveCustomTarget(copy);
    this.refreshTargets();
    this.renderTargetGrid();
    // Open the copy for editing immediately rather than leaving the user to find
    // and click its Edit button — cloning is usually the first step of "duplicate
    // this, then customize/draw over it," not an end in itself.
    this.openTargetModal(copy.id);
  }

  bindEvents() {
    const btnNewTarget = document.getElementById('btn-new-target');
    if (btnNewTarget) {
      btnNewTarget.addEventListener('click', () => {
        this.openTargetModal();
      });
    }

    const form = document.getElementById('target-form');
    if (form) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        this.saveTargetFromModal();
      });
    }

    // Image Upload Preview Handler
    const imageInput = document.getElementById('target-image-file');
    if (imageInput) {
      imageInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
          const reader = new FileReader();
          reader.onload = (evt) => {
            const dataUri = evt.target.result;
            if (!isSafeImageDataURI(dataUri)) {
              alert('That file could not be read as a valid image.');
              return;
            }
            document.getElementById('target-image-data').value = dataUri;
            const preview = document.getElementById('target-modal-preview');
            if (preview) {
              preview.innerHTML = `<img src="${dataUri}" style="max-height:100px; max-width:100%; border-radius:6px;"/>`;
            }
          };
          reader.readAsDataURL(file);
        }
      });
    }

    // Export JSON
    const btnExport = document.getElementById('btn-export-targets');
    if (btnExport) {
      btnExport.addEventListener('click', () => {
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(this.allTargets, null, 2));
        const downloadAnchor = document.createElement('a');
        downloadAnchor.setAttribute("href", dataStr);
        downloadAnchor.setAttribute("download", "rret_target_library.json");
        document.body.appendChild(downloadAnchor);
        downloadAnchor.click();
        downloadAnchor.remove();
      });
    }

    // Import JSON
    const btnImport = document.getElementById('btn-import-targets-file');
    if (btnImport) {
      btnImport.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
          const reader = new FileReader();
          reader.onload = (evt) => {
            try {
              const imported = JSON.parse(evt.target.result);
              if (Array.isArray(imported)) {
                let importedCount = 0;
                imported.forEach(t => {
                  const sanitized = sanitizeImportedTarget(t);
                  if (sanitized) {
                    StorageManager.saveCustomTarget(sanitized);
                    importedCount++;
                  }
                });
                this.refreshTargets();
                this.renderTargetGrid();
                alert(importedCount > 0
                  ? `Successfully imported ${importedCount} target(s).`
                  : 'No valid targets were found in that file.');
              } else {
                alert('Invalid JSON file format: expected an array of targets.');
              }
            } catch (err) {
              alert('Invalid JSON file format.');
            }
          };
          reader.readAsText(file);
        }
      });
    }
  }

  /** Wires up the freehand drawing canvas + toolbar in the Custom Target Editor modal. */
  bindDrawingCanvas() {
    const canvasEl = document.getElementById('target-draw-canvas');
    if (!canvasEl) return;

    this.drawCanvas = new TargetDrawingCanvas(canvasEl);

    // Every committed stroke/shape syncs the hidden imageData field directly —
    // no separate "apply drawing" step. A near-blank canvas (nothing drawn yet,
    // or just cleared) must NOT overwrite imageData, or opening the modal would
    // silently blank out an existing preset-shape target.
    this.drawCanvas.onChange = () => {
      const hiddenField = document.getElementById('target-image-data');
      if (!hiddenField) return;
      if (this.drawCanvas.hasContent()) {
        hiddenField.value = this.drawCanvas.toDataURL();
      } else {
        hiddenField.value = '';
        // Nothing drawn (anymore) — fall back to showing the selected preset shape.
        this.updateShapePreview();
      }
    };

    document.querySelectorAll('.btn-draw-tool').forEach(btn => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.btn-draw-tool').forEach(b => b.classList.remove('active'));
        e.currentTarget.classList.add('active');
        this.drawCanvas.setTool(e.currentTarget.dataset.tool);
      });
    });

    const colorInput = document.getElementById('draw-color');
    if (colorInput) {
      colorInput.addEventListener('input', (e) => this.drawCanvas.setColor(e.target.value));
    }

    const widthSelect = document.getElementById('draw-stroke-width');
    if (widthSelect) {
      widthSelect.addEventListener('change', (e) => this.drawCanvas.setStrokeWidth(parseFloat(e.target.value)));
    }

    const undoBtn = document.getElementById('btn-undo-drawing');
    if (undoBtn) undoBtn.addEventListener('click', () => this.drawCanvas.undo());

    const clearBtn = document.getElementById('btn-clear-drawing');
    if (clearBtn) {
      // clear()'s onChange callback already syncs target-image-data.
      clearBtn.addEventListener('click', () => this.drawCanvas.clear());
    }
  }

  /**
   * Resets the drawing toolbar to its default tool, and — critically — re-syncs
   * drawCanvas's color/stroke-width state from the (just form.reset()'d) color
   * and stroke-width inputs. Without this, form.reset() visually puts the color
   * swatch back to its default, but form.reset() never fires an input/change
   * event, so drawCanvas.color silently kept whatever was last picked in a
   * previous modal session — the swatch would show one color while strokes
   * actually drew in a different, stale one. Called each time the modal opens.
   */
  resetDrawingToolUI() {
    document.querySelectorAll('.btn-draw-tool').forEach(b => b.classList.remove('active'));
    const penBtn = document.querySelector('.btn-draw-tool[data-tool="pen"]');
    if (penBtn) penBtn.classList.add('active');
    if (!this.drawCanvas) return;

    this.drawCanvas.setTool('pen');
    const colorInput = document.getElementById('draw-color');
    if (colorInput) this.drawCanvas.setColor(colorInput.value);
    const widthSelect = document.getElementById('draw-stroke-width');
    if (widthSelect) this.drawCanvas.setStrokeWidth(parseFloat(widthSelect.value));
  }

  openTargetModal(targetId = null) {
    const modalEl = document.getElementById('target-modal');
    if (!modalEl) return;

    // getOrCreateInstance (not `new Modal()`) reuses the existing instance if one
    // is already attached to this element — repeatedly constructing new instances
    // across many opens can stack up backdrops/listeners and make the modal's own
    // content stop responding to clicks.
    const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
    const form = document.getElementById('target-form');
    form.reset();
    document.getElementById('target-image-data').value = '';
    const preview = document.getElementById('target-modal-preview');
    if (preview) preview.innerHTML = '<span class="text-muted small">No custom image loaded</span>';
    this.resetDrawingToolUI();

    const shapeSelect = document.getElementById('target-shape');

    if (targetId) {
      const t = this.getTargetById(targetId);
      if (!t) {
        alert('That target could not be found. It may have been deleted.');
        return;
      }
      document.getElementById('target-id').value = t.id;
      document.getElementById('target-name').value = t.name;
      document.getElementById('target-category').value = t.category || 'Custom';
      document.getElementById('target-height').value = t.height;
      document.getElementById('target-width').value = t.width;
      document.getElementById('target-min-distance').value = t.minDistance || '';
      document.getElementById('target-max-distance').value = t.maxDistance || '';
      document.getElementById('target-description').value = t.description || '';
      if (shapeSelect) shapeSelect.value = t.svgType || 'swe_b65';
      if (t.imageData && isSafeImageDataURI(t.imageData)) {
        document.getElementById('target-image-data').value = t.imageData;
        if (preview) preview.innerHTML = `<img src="${t.imageData}" style="max-height:100px; max-width:100%; border-radius:6px;"/>`;
        // Load the existing image/drawing into the canvas so it can be continued,
        // not just silently discarded and redrawn from a blank canvas.
        if (this.drawCanvas) this.drawCanvas.loadFromDataURL(t.imageData).catch(() => {});
      } else if (this.drawCanvas) {
        // No saved image/drawing (a procedural preset-shape target, e.g. a clone
        // of a built-in target) — seed the canvas with that shape instead of
        // leaving it blank, so cloning/editing has something to actually draw
        // on. shapeSelect.value and the height/width fields are already set
        // above, so this reads the same values just assigned to the form.
        this.drawCanvas.undoStack = [];
        this.copyShapeToDrawingCanvas();
      }
    } else {
      document.getElementById('target-id').value = 'custom_' + Date.now();
      if (shapeSelect) shapeSelect.value = 'swe_b65';
      if (this.drawCanvas) {
        this.drawCanvas.undoStack = [];
        this.copyShapeToDrawingCanvas();
      }
    }

    this.updateShapePreview();
    modal.show();
  }

  saveTargetFromModal() {
    const id = document.getElementById('target-id').value;
    const name = document.getElementById('target-name').value.trim().slice(0, 120);
    const category = document.getElementById('target-category').value.trim().slice(0, 60);
    const height = parseFloat(document.getElementById('target-height').value);
    const width = parseFloat(document.getElementById('target-width').value);
    const description = document.getElementById('target-description').value.trim().slice(0, 500);
    const imageDataRaw = document.getElementById('target-image-data').value;
    const imageData = isSafeImageDataURI(imageDataRaw) ? imageDataRaw : '';
    const shapeSelect = document.getElementById('target-shape');
    const svgType = shapeSelect ? shapeSelect.value : 'swe_b65';

    if (!name || isNaN(height) || height <= 0 || isNaN(width) || width <= 0) {
      alert('Please fill out valid target dimensions.');
      return;
    }

    // Both optional; only kept if they form a valid, positive, min <= max range.
    let minDistance = parseFloat(document.getElementById('target-min-distance').value);
    let maxDistance = parseFloat(document.getElementById('target-max-distance').value);
    const hasValidRange = Number.isFinite(minDistance) && Number.isFinite(maxDistance)
      && minDistance > 0 && maxDistance > 0 && minDistance <= maxDistance;
    if (!hasValidRange) {
      minDistance = undefined;
      maxDistance = undefined;
    }

    const targetObj = {
      id,
      name,
      category: category || 'Custom',
      height,
      width,
      description,
      isBuiltIn: false,
      type: imageData ? 'image' : 'svg_shape',
      // A custom image always takes rendering priority (see renderTargetSVGString),
      // so the shape is only relevant when no image was uploaded.
      svgType: imageData ? undefined : svgType,
      imageData,
      minDistance,
      maxDistance
    };

    StorageManager.saveCustomTarget(targetObj);
    this.refreshTargets();
    this.renderTargetGrid();

    const modalEl = document.getElementById('target-modal');
    const modal = bootstrap.Modal.getInstance(modalEl);
    if (modal) modal.hide();
  }
}
