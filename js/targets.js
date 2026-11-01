/* ==========================================================================
   Target Library & Custom Target Management Controller
   ========================================================================== */

import { StorageManager } from './storage.js';
import { renderTargetSVGString, escapeHTML, isSafeImageDataURI } from './utils.js';
import { TargetDrawingCanvas } from './drawing.js';
import { LIMITS, newTargetId, planImport, extractImportedTargets, sanitizeTarget } from './target-schema.js';
import { toast, setFieldError } from './ui.js';

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
  { value: 'ipsc_classic', label: 'IPSC Classic (Octagon)' },
  { value: 'mil_e_type', label: 'Head-and-Shoulders Silhouette' },
  { value: 'soldier_silhouette', label: 'Soldier (Standing)' },
  { value: 'soldier_half', label: 'Soldier (Waist-up)' },
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

/** Uploaded photos can be many MB; the scope never needs more than this. */
const MAX_UPLOAD_EDGE_PX = 512;

function storageErrorMessage(result) {
  return result && result.quotaExceeded
    ? 'Browser storage is full. Delete some custom targets or use smaller images, then try again.'
    : 'Could not save to browser storage.';
}

export class TargetsController {
  constructor(app) {
    this.app = app;
    this.builtInTargets = [];
    this.customTargets = [];
    this.allTargets = [];
    this.activeCategory = 'All';
    this.drawCanvas = null;
    // True once the user has drawn, uploaded, cleared or undone in the editor.
    // Until then the canvas only shows the preset shape, which is saved as a
    // vector svgType rather than a raster PNG (audit BUG-015).
    this.drawingEdited = false;
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

    // Picking a shape resets the canvas to that preset (undoable).
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
   * Rasterizes the selected preset shape onto the drawing canvas as an editable
   * starting point. This alone does not count as an edit: until the user draws on
   * it, the target is saved as the vector preset.
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
      this.drawingEdited = false;
      document.getElementById('target-image-data').value = '';
      this.drawCanvas.stampImage(img);
      this.updateShapePreview();
      URL.revokeObjectURL(url);
    };
    img.onerror = () => URL.revokeObjectURL(url);
    img.src = url;
  }

  refreshTargets() {
    const builtInIds = new Set(this.builtInTargets.map(t => t.id));
    let customs = StorageManager.getCustomTargets();
    // Older versions could import custom copies that reuse a built-in id (BUG-006);
    // give those a fresh id so lookups, edits and deletes hit the right record.
    if (customs.some(t => builtInIds.has(t.id))) {
      customs = customs.map(t => builtInIds.has(t.id) ? { ...t, id: newTargetId() } : t);
      StorageManager.saveCustomTargets(customs);
    }
    this.customTargets = customs;
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
      <button type="button" class="btn btn-sm ${this.activeCategory === cat ? 'btn-tactical-primary' : 'btn-tactical-secondary'} me-1 mb-2" data-category="${escapeHTML(cat)}" aria-pressed="${this.activeCategory === cat}">
        ${escapeHTML(cat)}
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
          <i class="bi bi-exclamation-triangle fs-1 d-block mb-3" aria-hidden="true"></i>
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
          <i class="bi bi-bullseye fs-1 d-block mb-3" aria-hidden="true"></i>
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
      const safeId = escapeHTML(t.id);
      const safeName = escapeHTML(t.name);

      // Letterbox the preview to the target's true width:height ratio.
      const previewAspect = (t.width && t.height) ? (t.width / t.height) : 1;
      const previewW = previewAspect >= 1 ? 130 : Math.round(130 * previewAspect);
      const previewH = previewAspect >= 1 ? Math.round(130 / previewAspect) : 130;

      return `
        <div class="col-12 col-sm-6 col-md-4 col-lg-3 mb-4">
          <div class="target-card">
            <div class="target-preview-box" role="img" aria-label="${safeName} outline">
              ${renderTargetSVGString(t, previewW, previewH)}
              <span class="position-absolute top-0 start-0 m-2 badge ${isCustom ? 'badge-tan' : 'badge-olive'}">
                ${escapeHTML(t.category)}
              </span>
            </div>
            <div class="target-card-body">
              <h5 class="tactical-font text-tan-light mb-1" style="font-size:1.05rem;">${safeName}</h5>
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
                <button type="button" class="btn btn-sm btn-tactical-outline flex-grow-1 btn-practice-target" data-target-id="${safeId}">
                  Practise
                </button>
                ${isCustom ? `
                  <button type="button" class="btn btn-sm btn-tactical-secondary btn-edit-target" data-target-id="${safeId}" aria-label="Edit ${safeName}" title="Edit">
                    <span aria-hidden="true">✏️</span>
                  </button>
                  <button type="button" class="btn btn-sm btn-outline-danger btn-delete-target" data-target-id="${safeId}" aria-label="Delete ${safeName}" title="Delete">
                    <span aria-hidden="true">🗑️</span>
                  </button>
                ` : `
                  <button type="button" class="btn btn-sm btn-tactical-secondary btn-duplicate-target" data-target-id="${safeId}" aria-label="Duplicate ${safeName} as a custom target" title="Duplicate as Custom">
                    <span aria-hidden="true">📋</span>
                  </button>
                `}
              </div>
            </div>
          </div>
        </div>
      `;
    }).join('');

    grid.querySelectorAll('.btn-practice-target').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const target = this.getTargetById(e.currentTarget.dataset.targetId);
        if (!target) {
          toast('That target could not be found. It may have been deleted.', 'warning');
          return;
        }
        if (this.app && this.app.startScenarioWithTarget) {
          this.app.startScenarioWithTarget(target);
          this.app.navigateTo('simulator');
        }
      });
    });

    grid.querySelectorAll('.btn-duplicate-target').forEach(btn => {
      btn.addEventListener('click', (e) => this.duplicateTarget(e.currentTarget.dataset.targetId));
    });

    grid.querySelectorAll('.btn-edit-target').forEach(btn => {
      btn.addEventListener('click', (e) => this.openTargetModal(e.currentTarget.dataset.targetId));
    });

    grid.querySelectorAll('.btn-delete-target').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.dataset.targetId;
        const t = this.getTargetById(id);
        if (confirm(`Delete the custom target "${t ? t.name : id}"?`)) {
          const result = StorageManager.deleteCustomTarget(id);
          if (!result.ok) toast(storageErrorMessage(result), 'error');
          this.refreshTargets();
          this.renderTargetGrid();
        }
      });
    });
  }

  duplicateTarget(targetId) {
    const source = this.getTargetById(targetId);
    if (!source) return;

    const copy = sanitizeTarget({
      ...source,
      id: newTargetId(),
      name: `${source.name} (Copy)`,
      category: 'Custom'
    });
    if (!copy) return;

    const result = StorageManager.saveCustomTarget(copy);
    if (!result.ok) {
      toast(storageErrorMessage(result), 'error');
      return;
    }
    this.refreshTargets();
    this.renderTargetGrid();
    // Open the copy for editing immediately — cloning is usually the first step of
    // "duplicate this, then customize it".
    this.openTargetModal(copy.id);
  }

  /** Exports only the user's custom targets — built-ins ship with the app. */
  exportCustomTargets() {
    if (this.customTargets.length === 0) {
      toast('You have no custom targets to export yet.', 'info');
      return;
    }
    const blob = new Blob([JSON.stringify(this.customTargets, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'rret_custom_targets.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  importTargetsFromText(text) {
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      toast('That file is not valid JSON.', 'error');
      return;
    }
    const imported = extractImportedTargets(parsed);
    if (!imported) {
      toast('Unrecognised file: expected a list of targets.', 'error');
      return;
    }

    const { list, counts } = planImport(imported, {
      builtInIds: this.builtInTargets.map(t => t.id),
      existingCustom: this.customTargets
    });

    if (counts.added + counts.updated === 0) {
      toast(`No new custom targets found${counts.skippedBuiltIn ? ` (${counts.skippedBuiltIn} built-in targets skipped)` : ''}.`, 'warning');
      return;
    }

    // One write for the whole import: either everything lands or nothing does.
    const result = StorageManager.saveCustomTargets(list);
    if (!result.ok) {
      toast(`Import failed, nothing was changed. ${storageErrorMessage(result)}`, 'error', 8000);
      return;
    }
    this.refreshTargets();
    this.renderTargetGrid();

    const parts = [`${counts.added} added`];
    if (counts.updated) parts.push(`${counts.updated} updated`);
    if (counts.skippedBuiltIn) parts.push(`${counts.skippedBuiltIn} built-in skipped`);
    if (counts.invalid) parts.push(`${counts.invalid} invalid`);
    if (counts.imageTooLarge) parts.push(`${counts.imageTooLarge} with oversized images skipped`);
    if (counts.overLimit) parts.push(`${counts.overLimit} over the ${LIMITS.importItems}-target limit`);
    toast(`Import complete: ${parts.join(', ')}.`, 'success', 7000);
  }

  bindEvents() {
    const btnNewTarget = document.getElementById('btn-new-target');
    if (btnNewTarget) btnNewTarget.addEventListener('click', () => this.openTargetModal());

    const form = document.getElementById('target-form');
    if (form) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        this.saveTargetFromModal();
      });
    }

    // Image upload: downscale, then place it on the drawing canvas so drawing and
    // uploading compose instead of silently replacing each other (BUG-023).
    const imageInput = document.getElementById('target-image-file');
    if (imageInput) {
      imageInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        if (!file.type.startsWith('image/')) {
          setFieldError(imageInput, 'Please choose an image file.');
          return;
        }
        setFieldError(imageInput, '');
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
          URL.revokeObjectURL(url);
          // Downscale very large photos before they reach the canvas/storage.
          const scale = Math.min(1, MAX_UPLOAD_EDGE_PX / Math.max(img.naturalWidth, img.naturalHeight));
          const c = document.createElement('canvas');
          c.width = Math.max(1, Math.round(img.naturalWidth * scale));
          c.height = Math.max(1, Math.round(img.naturalHeight * scale));
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          this.drawingEdited = true;
          this.drawCanvas.stampImage(c); // fires onChange -> syncs target-image-data
        };
        img.onerror = () => {
          URL.revokeObjectURL(url);
          setFieldError(imageInput, 'That file could not be read as an image.');
        };
        img.src = url;
      });
    }

    const btnExport = document.getElementById('btn-export-targets');
    if (btnExport) btnExport.addEventListener('click', () => this.exportCustomTargets());

    const btnImport = document.getElementById('btn-import-targets-file');
    if (btnImport) {
      btnImport.addEventListener('change', (e) => {
        const file = e.target.files[0];
        e.target.value = ''; // allow re-importing the same file
        if (!file) return;
        if (file.size > LIMITS.importFileBytes) {
          toast(`That file is too large (max ${Math.round(LIMITS.importFileBytes / 1024 / 1024)} MB).`, 'error');
          return;
        }
        const reader = new FileReader();
        reader.onload = (evt) => this.importTargetsFromText(evt.target.result);
        reader.onerror = () => toast('Could not read that file.', 'error');
        reader.readAsText(file);
      });
    }
  }

  /** Wires up the freehand drawing canvas + toolbar in the Custom Target Editor modal. */
  bindDrawingCanvas() {
    const canvasEl = document.getElementById('target-draw-canvas');
    if (!canvasEl) return;

    this.drawCanvas = new TargetDrawingCanvas(canvasEl);
    this.drawCanvas.onUserEdit = () => { this.drawingEdited = true; };

    // Every committed user stroke syncs the hidden imageData field directly. Programmatic
    // stamps of the preset shape don't, so an untouched preset stays a vector shape.
    this.drawCanvas.onChange = () => {
      const hiddenField = document.getElementById('target-image-data');
      if (!hiddenField || !this.drawingEdited) return;
      if (this.drawCanvas.hasContent()) {
        hiddenField.value = this.drawCanvas.toDataURL();
        const preview = document.getElementById('target-modal-preview');
        if (preview) preview.innerHTML = '<span class="text-muted small">Using your drawing / image from the canvas above.</span>';
      } else {
        hiddenField.value = '';
        this.updateShapePreview();
      }
    };

    document.querySelectorAll('.btn-draw-tool').forEach(btn => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.btn-draw-tool').forEach(b => { b.classList.remove('active'); b.setAttribute('aria-pressed', 'false'); });
        e.currentTarget.classList.add('active');
        e.currentTarget.setAttribute('aria-pressed', 'true');
        this.drawCanvas.setTool(e.currentTarget.dataset.tool);
      });
    });

    const colorInput = document.getElementById('draw-color');
    if (colorInput) colorInput.addEventListener('input', (e) => this.drawCanvas.setColor(e.target.value));

    const widthSelect = document.getElementById('draw-stroke-width');
    if (widthSelect) widthSelect.addEventListener('change', (e) => this.drawCanvas.setStrokeWidth(parseFloat(e.target.value)));

    const undoBtn = document.getElementById('btn-undo-drawing');
    if (undoBtn) undoBtn.addEventListener('click', () => { this.drawingEdited = true; this.drawCanvas.undo(); });

    const clearBtn = document.getElementById('btn-clear-drawing');
    if (clearBtn) clearBtn.addEventListener('click', () => { this.drawingEdited = true; this.drawCanvas.clear(); });
  }

  /**
   * Resets the drawing toolbar to its default tool and re-syncs drawCanvas's
   * colour/stroke state from the (just form.reset()'d) inputs — form.reset() fires
   * no input/change events, so without this the swatch and the pen could disagree.
   */
  resetDrawingToolUI() {
    document.querySelectorAll('.btn-draw-tool').forEach(b => { b.classList.remove('active'); b.setAttribute('aria-pressed', 'false'); });
    const penBtn = document.querySelector('.btn-draw-tool[data-tool="pen"]');
    if (penBtn) { penBtn.classList.add('active'); penBtn.setAttribute('aria-pressed', 'true'); }
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

    // getOrCreateInstance reuses the existing instance instead of stacking new ones.
    const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
    const form = document.getElementById('target-form');
    form.reset();
    form.querySelectorAll('[aria-invalid]').forEach(el => setFieldError(el, ''));
    document.getElementById('target-image-data').value = '';
    this.drawingEdited = false;
    const preview = document.getElementById('target-modal-preview');
    if (preview) preview.innerHTML = '<span class="text-muted small">No custom image loaded</span>';
    this.resetDrawingToolUI();

    const shapeSelect = document.getElementById('target-shape');

    if (targetId) {
      const t = this.getTargetById(targetId);
      if (!t) {
        toast('That target could not be found. It may have been deleted.', 'warning');
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
      this.editingColors = { color: t.color, borderColor: t.borderColor };
      if (t.imageData && isSafeImageDataURI(t.imageData)) {
        document.getElementById('target-image-data').value = t.imageData;
        if (preview) preview.innerHTML = `<img src="${t.imageData}" alt="" style="max-height:100px; max-width:100%; border-radius:6px;"/>`;
        // Load the existing image so editing continues from it.
        if (this.drawCanvas) this.drawCanvas.loadFromDataURL(t.imageData).catch(() => {});
      } else if (this.drawCanvas) {
        // Procedural preset target: seed the canvas with its shape as a starting point.
        this.drawCanvas.undoStack = [];
        this.copyShapeToDrawingCanvas();
      }
    } else {
      this.editingColors = {};
      document.getElementById('target-id').value = newTargetId();
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
    const nameEl = document.getElementById('target-name');
    const heightEl = document.getElementById('target-height');
    const widthEl = document.getElementById('target-width');
    const height = parseFloat(heightEl.value);
    const width = parseFloat(widthEl.value);

    let valid = true;
    setFieldError(nameEl, nameEl.value.trim() ? '' : 'Give the target a name.');
    if (!nameEl.value.trim()) valid = false;
    setFieldError(heightEl, height > 0 ? '' : 'Enter a height in meters greater than 0.');
    if (!(height > 0)) valid = false;
    setFieldError(widthEl, width > 0 ? '' : 'Enter a width in meters greater than 0.');
    if (!(width > 0)) valid = false;
    if (!valid) return;

    const imageDataRaw = document.getElementById('target-image-data').value;
    const shapeSelect = document.getElementById('target-shape');

    const targetObj = sanitizeTarget({
      id: document.getElementById('target-id').value,
      name: nameEl.value,
      category: document.getElementById('target-category').value,
      height,
      width,
      description: document.getElementById('target-description').value.trim(),
      svgType: shapeSelect ? shapeSelect.value : 'swe_b65',
      imageData: imageDataRaw,
      // A custom image always takes rendering priority; colours only matter for presets.
      ...(this.editingColors || {}),
      minDistance: document.getElementById('target-min-distance').value,
      maxDistance: document.getElementById('target-max-distance').value
    });
    if (!targetObj) return;
    if (imageDataRaw && !targetObj.imageData) {
      toast('That image is too large to store. Try a smaller or simpler image.', 'error', 7000);
      return;
    }

    const result = StorageManager.saveCustomTarget(targetObj);
    if (!result.ok) {
      toast(storageErrorMessage(result), 'error', 8000);
      return; // keep the modal open so nothing the user entered is lost
    }
    this.refreshTargets();
    this.renderTargetGrid();
    toast(`Saved "${targetObj.name}".`, 'success');

    const modal = bootstrap.Modal.getInstance(document.getElementById('target-modal'));
    if (modal) modal.hide();
  }
}
