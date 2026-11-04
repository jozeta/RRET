/* ==========================================================================
   Virtual First Focal Plane (FFP) Scope Engine
   Handles Canvas background/target, SVG vector reticle scaling, pan & zoom.
   ========================================================================== */

import { renderTargetSVGString, isSafeImageDataURI, sfx } from './utils.js';
import { reticleSVG } from './reticle-designs.js';
import { grainTexture, cloudTexture } from './textures.js';

/** Real-world-ish scope profiles for realistic optics mode (FEAT-001). */
export const SCOPE_PROFILES = {
  arcade: { label: 'Enlarged (1–25x)', minZoom: 1, maxZoom: 25 },
  full: { label: 'Full range 1–25x', minZoom: 1, maxZoom: 25 },
  lpvo: { label: 'LPVO 1–10x', minZoom: 1, maxZoom: 10 },
  hunting: { label: 'Hunting 3–18x', minZoom: 3, maxZoom: 18 },
  precision: { label: 'Precision 5–25x', minZoom: 5, maxZoom: 25 }
};

function shadeHex(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const c = (v) => Math.max(0, Math.min(255, Math.round(v + amt))).toString(16).padStart(2, '0');
  return `#${c((n >> 16) & 255)}${c((n >> 8) & 255)}${c(n & 255)}`;
}

/** Shooter's eye height above the ground plane (prone/sitting field position). */
export const EYE_HEIGHT_M = 1.0;

/** Cloud cover per environment (cover: higher = fewer clouds; alpha: opacity). */
const CLOUDS = {
  forest: { cover: 0.55, alpha: 0.75 }, field: { cover: 0.58, alpha: 0.8 }, snow: { cover: 0.42, alpha: 0.7, tint: [236, 240, 245] },
  mountain: { cover: 0.5, alpha: 0.75 }, desert: { cover: 0.68, alpha: 0.6 }, urban: { cover: 0.4, alpha: 0.6, tint: [205, 210, 214] },
  range: { cover: 0.56, alpha: 0.75 }, rain: { cover: 0.25, alpha: 0.85, tint: [96, 104, 112] },
  dusk: { cover: 0.5, alpha: 0.7, tint: [246, 170, 140] }
};

/** Sky and ground colours plus ground texture per environment. */
const ENV_STYLES = {
  forest: { sky: ['#8fa9b8', '#cbd7d6'], ground: ['#55683f', '#2c3a22'], tex: 'grass', texColor: 'rgba(20, 32, 14, 0.5)' },
  field: { sky: ['#7fa9d1', '#d6e3ea'], ground: ['#86a250', '#4e6a2c'], tex: 'grass', texColor: 'rgba(40, 62, 20, 0.5)' },
  snow: { sky: ['#a9bfd1', '#e4ebf1'], ground: ['#f2f5f8', '#d0dbe4'], tex: 'snow', texColor: 'rgba(140, 160, 182, 0.5)' },
  mountain: { sky: ['#7d97ab', '#c7d2d9'], ground: ['#646f55', '#363f30'], tex: 'grass', texColor: 'rgba(25, 32, 20, 0.5)' },
  desert: { sky: ['#9fc3de', '#efe2c8'], ground: ['#d6b07a', '#a77f4b'], tex: 'pebble', texColor: 'rgba(110, 80, 45, 0.45)' },
  urban: { sky: ['#6d7c88', '#abb4ba'], ground: ['#5c6064', '#34383b'], tex: 'pavement', texColor: 'rgba(20, 22, 24, 0.45)' },
  range: { sky: ['#a3bfd3', '#e0e6e3'], ground: ['#a09676', '#6f6750'], tex: 'pebble', texColor: 'rgba(60, 55, 40, 0.4)' },
  fog: { sky: ['#c3cbce', '#d6dcde'], ground: ['#949d94', '#6f786f'], tex: 'grass', texColor: 'rgba(50, 60, 50, 0.35)' },
  rain: { sky: ['#4d5964', '#77828b'], ground: ['#45523b', '#262e21'], tex: 'grass', texColor: 'rgba(15, 22, 12, 0.5)' },
  dusk: { sky: ['#3b2047', '#d77a4e'], ground: ['#4a3236', '#22181b'], tex: 'grass', texColor: 'rgba(10, 6, 8, 0.45)' }
};

const ARCADE_PX_PER_MIL = 18; // pixels spanned by 1 MIL at "1x" in arcade mode
const NOMINAL_CSS_PX_PER_MM = 96 / 25.4; // CSS reference pixel, before calibration

export class ScopeEngine {
  constructor(canvasId, svgId, hudId) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas ? this.canvas.getContext('2d') : null;
    this.svgContainer = document.getElementById(svgId);
    this.hudElement = document.getElementById(hudId);

    // Magnification & optics. In arcade mode 1 MIL = 18 CSS px x zoom (the original
    // behaviour). In realistic mode the scale comes from a screen calibration and
    // viewing distance so the target appears the size it would through a real scope.
    this.zoom = 1;
    this.minZoom = 1;
    this.maxZoom = 25;
    this.opticsMode = 'realistic';
    this.scopeProfile = 'full';
    this.screenPxPerMm = null;
    this.viewingDistanceCm = 60;

    // Viewport panning offsets (in MIL units so position survives zoom changes)
    this.panX = 0;
    this.panY = 0;

    // Active scenario state
    this.target = null;
    this.distance = 300; // meters
    this.targetOffsetMILX = 0;
    this.targetOffsetMILY = 0;
    this.environment = 'field';
    this.truthOverlay = false; // FEAT-003: brackets showing the true extents after answering
    // Realism layers (each optional): 'mirage', 'sway', 'grass', 'acquire', 'lowlight'.
    this.realism = new Set();
    this.animating = false;
    this.visible = true;

    // Display / reticle settings
    this.reticleType = 'mil_dot';
    this.reticleColor = '#111111';
    this.reticleBrightness = 1.0;
    this.zoomSensitivity = 1.0;
    this.panSensitivity = 1.0;

    // Pointer & drag tracking
    this.isDragging = false;
    this.lastPointerX = 0;
    this.lastPointerY = 0;
    this.pinchDistance = 0;
    this.wheelAccum = 0;
    this.lastWheelSoundAt = 0;

    // Render scheduling: input events only mark things dirty; one rAF paints (PERF-003).
    this.canvasDirty = false;
    this.reticleDirty = false;
    this.frameRequested = false;

    // Target raster cache, re-rasterized at higher resolution when zooming in (BUG-013).
    this.targetOffscreenCanvas = document.createElement('canvas');
    this.rasterEdge = 0;
    this.rasterToken = 0;

    this.bindEvents();
  }

  /** CSS pixels spanned by 1 MIL at magnification `zoom`. */
  pxPerMILAt(zoom = this.zoom) {
    if (this.opticsMode === 'realistic') {
      // Apparent angle through the scope is zoom x true angle. At viewing distance D
      // that is D x zoom / 1000 mm on screen per MIL, converted to CSS px.
      const pxPerMm = this.screenPxPerMm || NOMINAL_CSS_PX_PER_MM;
      return zoom * (this.viewingDistanceCm * 10) / 1000 * pxPerMm;
    }
    return ARCADE_PX_PER_MIL * zoom;
  }

  get basePixelsPerMIL() {
    return this.pxPerMILAt(1);
  }

  init() {
    this.resizeCanvas();
    // Sync the HUD badge and preset highlighting to the actual zoom state.
    this.setZoom(this.zoom);
    let resizeTimer = null;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => this.resizeCanvas(), 100);
    });
  }

  /** Schedules at most one paint per animation frame. */
  requestRender({ reticle = false } = {}) {
    this.canvasDirty = true;
    if (reticle) this.reticleDirty = true;
    if (this.frameRequested) return;
    this.frameRequested = true;
    requestAnimationFrame(() => {
      this.frameRequested = false;
      if (this.reticleDirty) { this.reticleDirty = false; this.renderReticleSVG(); }
      if (this.canvasDirty) { this.canvasDirty = false; this.render(); }
    });
  }

  resizeCanvas() {
    if (!this.canvas) return;
    const rect = this.canvas.parentElement.getBoundingClientRect();
    const size = Math.floor(Math.min(rect.width, rect.height));
    if (size <= 0) return;

    // Back the canvas with device pixels so edges stay sharp on HiDPI screens (BUG-013);
    // all drawing code keeps working in CSS pixels via the context transform.
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.dpr = dpr;
    this.canvas.width = Math.round(size * dpr);
    this.canvas.height = Math.round(size * dpr);
    this.canvasSize = size;
    // The reticle SVG's viewBox/center depend on canvasSize, so it must be redrawn
    // whenever this changes (the simulator tab can be hidden at init).
    this.renderReticleSVG();
    this.render();
  }

  updateSettings(settings) {
    if (settings.reticle) {
      this.reticleType = settings.reticle;
      const simSelect = document.getElementById('sim-reticle-select');
      if (simSelect) simSelect.value = settings.reticle;
      const settingsSelect = document.querySelector('select[name="reticle-select"]');
      if (settingsSelect) settingsSelect.value = settings.reticle;
      this.updateHud();
    }
    if (settings.reticleColor) this.reticleColor = settings.reticleColor;
    if (settings.reticleBrightness !== undefined) this.reticleBrightness = settings.reticleBrightness;
    if (settings.zoomSensitivity !== undefined) this.zoomSensitivity = settings.zoomSensitivity;
    if (settings.panSensitivity !== undefined) this.panSensitivity = settings.panSensitivity;
    if (settings.opticsMode) this.opticsMode = settings.opticsMode === 'realistic' ? 'realistic' : 'arcade';
    if (settings.screenPxPerMm !== undefined) this.screenPxPerMm = settings.screenPxPerMm > 0 ? settings.screenPxPerMm : null;
    if (settings.viewingDistanceCm !== undefined && settings.viewingDistanceCm > 0) this.viewingDistanceCm = settings.viewingDistanceCm;
    if (settings.scopeProfile !== undefined || settings.opticsMode !== undefined) {
      const key = this.opticsMode === 'realistic' && SCOPE_PROFILES[settings.scopeProfile ?? this.scopeProfile] ? (settings.scopeProfile ?? this.scopeProfile) : 'arcade';
      this.scopeProfile = settings.scopeProfile ?? this.scopeProfile;
      const profile = SCOPE_PROFILES[key];
      this.minZoom = profile.minZoom;
      this.maxZoom = profile.maxZoom;
      this.setZoom(this.zoom);
    }

    this.renderReticleSVG();
    this.render();
  }

  setScenario(scenario) {
    this.target = scenario.target;
    this.distance = scenario.distance;
    this.targetOffsetMILX = scenario.offsetX || 0;
    // The target stands on the ground plane: its base is EYE_HEIGHT_M below eye
    // level at its distance, so it sits in front of the scenery behind it.
    const milH = scenario.target ? (scenario.target.height * 1000) / scenario.distance : 0;
    this.targetOffsetMILY = -(EYE_HEIGHT_M * 1000) / scenario.distance + milH / 2;
    this.environment = scenario.environment || 'field';
    this.truthOverlay = false;

    // Centre the view on the target, or (Find the target) start aimed off to one side.
    this.panX = this.targetOffsetMILX;
    this.panY = this.targetOffsetMILY;
    if (this.realism.has('acquire') && this.canvasSize) {
      const half = this.canvasSize / 2 / this.pxPerMILAt();
      const r = (k) => { const v = Math.sin((scenario.distance * 12.9898 + k * 78.233) % 1000) * 43758.5453; return v - Math.floor(v); };
      this.panX += (r(1) < 0.5 ? -1 : 1) * half * (0.55 + 0.35 * r(2));
      this.panY += (r(3) - 0.5) * half * 0.6;
    }

    this.rasterEdge = 0;
    this.prepareTargetOffscreen();
    this.renderReticleSVG();
    this.render();
  }

  /** FEAT-003: after answering, bracket the target's true height and width. */
  showTruthOverlay(on) {
    this.truthOverlay = !!on;
    this.requestRender();
  }

  setZoom(zoomLevel) {
    // Ignore non-numeric input: a NaN zoom blanked the whole scope (audit BUG-004).
    if (!Number.isFinite(zoomLevel)) return;
    this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, zoomLevel));
    if (this.hudElement) {
      this.updateHud();
    }
    this.updateZoomButtonsUI();
    this.requestRender({ reticle: true });
  }

  /** Magnification plus what the reticle's marks are worth: at high power the
   *  numbered marks are usually outside the view, so the spacing must be stated. */
  updateHud() {
    if (!this.hudElement) return;
    const entry = (this.reticleCatalog || []).find(r => r.id === this.reticleType);
    const scale = entry && entry.scale ? ` · ${entry.scale}` : '';
    this.hudElement.textContent = `${this.zoom.toFixed(1)}×${scale}`;
  }

  updateZoomButtonsUI() {
    document.querySelectorAll('#zoom-presets [data-zoom]').forEach(btn => {
      const val = parseFloat(btn.dataset.zoom);
      const active = Math.abs(val - this.zoom) < 0.2;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', String(active));
      btn.disabled = val < this.minZoom || val > this.maxZoom;
    });
  }

  resetView() {
    this.centerTarget();
  }

  centerTarget() {
    this.panX = this.targetOffsetMILX;
    this.panY = this.targetOffsetMILY;
    this.requestRender();
    sfx.playClick();
  }

  panByPixels(dxPx, dyPx) {
    // Convert screen pixel delta to MIL delta at current zoom & sensitivity
    const pixelsPerMIL = this.pxPerMILAt();
    this.panX -= (dxPx / pixelsPerMIL) * this.panSensitivity;
    this.panY += (dyPx / pixelsPerMIL) * this.panSensitivity; // Invert canvas Y axis
    this.hideHint();
    this.requestRender();
  }

  hideHint() {
    const hint = document.getElementById('scope-hud-hint');
    if (hint && !hint.classList.contains('is-dismissed')) hint.classList.add('is-dismissed');
  }

  /**
   * Rasterizes the target graphic to an offscreen canvas at the target's true
   * width:height ratio, so render()'s drawImage applies one aspect-correct scale.
   * `edge` is the long-edge resolution; render() asks for more when zooming in.
   */
  prepareTargetOffscreen(edge = 512) {
    if (!this.target) return;
    const aspect = (this.target.width && this.target.height) ? (this.target.width / this.target.height) : 1;
    const offW = aspect >= 1 ? edge : Math.max(1, Math.round(edge * aspect));
    const offH = aspect >= 1 ? Math.max(1, Math.round(edge / aspect)) : edge;
    this.rasterEdge = edge;
    const token = ++this.rasterToken;

    // Guard against a stale async load completing after a newer scenario/raster.
    const requestedTarget = this.target;
    const drawAndRender = (img) => {
      if (this.target !== requestedTarget || token !== this.rasterToken) return;
      const off = this.targetOffscreenCanvas;
      off.width = offW;
      off.height = offH;
      const ctx = off.getContext('2d');
      ctx.clearRect(0, 0, offW, offH);
      ctx.drawImage(img, 0, 0, offW, offH);
      this.targetOffscreenSize = { width: offW, height: offH };
      this.requestRender();
    };

    const img = new Image();
    if (this.target.imageData && isSafeImageDataURI(this.target.imageData)) {
      img.onload = () => drawAndRender(img);
      img.src = this.target.imageData;
    } else {
      const svgStr = renderTargetSVGString(this.target, offW, offH);
      const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      img.onload = () => { drawAndRender(img); URL.revokeObjectURL(url); };
      img.onerror = () => URL.revokeObjectURL(url);
      img.src = url;
    }
  }

  /**
   * Renders the scope canvas layer (background, target, overlays).
   */
  render() {
    if (!this.ctx || !this.canvasSize) return;

    const width = this.canvasSize;
    const height = this.canvasSize;
    const centerX = width / 2;
    const centerY = height / 2;
    const dpr = this.dpr || 1;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Hold sway moves the whole view (not the reticle) for this frame only.
    const sway = this.measurementMode ? null : this.swayOffset();
    if (sway) { this.panX += sway.x; this.panY += sway.y; }

    // 1. Environmental background (a flat colour in measurement mode, used by the
    //    browser tests to measure the rendered target in pixels).
    if (this.measurementMode) {
      this.scene = this.computeSceneTransform(width, height);
      this.ctx.fillStyle = '#ff00ff';
      this.ctx.fillRect(0, 0, width, height);
    } else {
      this.renderBackground(width, height);
    }

    // 2. Target in FFP perspective: size in MIL = size(m) x 1000 / distance(m)
    if (this.target) {
      const pixelsPerMIL = this.pxPerMILAt();
      const targetMILHeight = (this.target.height * 1000) / this.distance;
      const targetMILWidth = (this.target.width * 1000) / this.distance;
      const targetPxHeight = targetMILHeight * pixelsPerMIL;
      const targetPxWidth = targetMILWidth * pixelsPerMIL;

      const relMILX = this.targetOffsetMILX - this.panX;
      const relMILY = this.targetOffsetMILY - this.panY;
      const screenTargetX = centerX + relMILX * pixelsPerMIL - targetPxWidth / 2;
      const screenTargetY = centerY - relMILY * pixelsPerMIL - targetPxHeight / 2;

      // Ground shadow first and entirely below the base, so it never darkens the
      // bottom edge the shooter mills against (audit UI-005).
      const shadowRy = this.measurementMode ? 0 : Math.max(1, targetPxHeight * 0.05);
      this.ctx.fillStyle = 'rgba(0,0,0,0.28)';
      this.ctx.beginPath();
      this.ctx.ellipse(
        screenTargetX + targetPxWidth / 2,
        screenTargetY + targetPxHeight + shadowRy + 1,
        targetPxWidth / 2, shadowRy,
        0, 0, Math.PI * 2
      );
      if (shadowRy > 0) this.ctx.fill();

      const offSize = this.targetOffscreenSize;
      if (offSize) {
        this.ctx.imageSmoothingEnabled = true;
        this.ctx.imageSmoothingQuality = 'high';
        const shimmer = this.measurementMode ? 0 : this.mirageAmplitudePx(pixelsPerMIL);
        if (shimmer > 0.15) {
          this.drawTargetWithMirage(offSize, screenTargetX, screenTargetY, targetPxWidth, targetPxHeight, shimmer);
        } else {
          this.ctx.drawImage(
            this.targetOffscreenCanvas,
            0, 0, offSize.width, offSize.height,
            screenTargetX, screenTargetY, targetPxWidth, targetPxHeight
          );
        }
      }
      if (!this.measurementMode && this.realism.has('grass')) {
        this.drawForegroundGrass(screenTargetX, screenTargetY, targetPxWidth, targetPxHeight);
      }

      // Re-rasterize at a higher resolution once the on-screen size outgrows the
      // cached raster (procedural targets only; images are used at native size).
      const neededEdge = Math.max(targetPxWidth, targetPxHeight) * dpr;
      if (!this.target.imageData && neededEdge > this.rasterEdge * 1.1 && this.rasterEdge < 4096) {
        const next = Math.min(4096, 2 ** Math.ceil(Math.log2(neededEdge)));
        if (next > this.rasterEdge) this.prepareTargetOffscreen(next);
      }

      if (this.truthOverlay) {
        this.drawTruthBrackets(screenTargetX, screenTargetY, targetPxWidth, targetPxHeight, targetMILWidth, targetMILHeight);
      }
    }

    // 3. Environmental overlays (fog, rain, snow) and low light
    if (!this.measurementMode) {
      this.renderWeatherOverlay(width, height);
      if (this.realism.has('lowlight')) this.drawLowLight(width, height);
    }
    if (sway) { this.panX -= sway.x; this.panY -= sway.y; }
  }

  /* ---- Realism layers ---------------------------------------------------- */

  /** Turns realism layers on/off; animated ones (mirage, sway) run a frame loop. */
  setRealism(layers) {
    this.realism = new Set(layers);
    this.updateAnimation();
    this.requestRender();
  }

  setVisible(visible) {
    this.visible = visible;
    this.updateAnimation();
  }

  updateAnimation() {
    const want = this.visible && (this.realism.has('sway') || this.realism.has('mirage'));
    if (want && !this.animating) {
      this.animating = true;
      const loop = () => {
        if (!this.animating) return;
        this.render();
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    } else if (!want) {
      this.animating = false;
    }
  }

  /**
   * Hold sway in MIL: a slow breathing cycle (mostly vertical), a wandering drift
   * and a faint tremor. Roughly what a steady prone or rested hold looks like.
   */
  swayOffset() {
    if (!this.realism.has('sway')) return null;
    const t = performance.now() / 1000;
    const breath = Math.sin((2 * Math.PI * t) / 4.2);
    const driftX = Math.sin(t * 0.37) * 0.6 + Math.sin(t * 0.83 + 1.3) * 0.4;
    const driftY = Math.sin(t * 0.29 + 2.1) * 0.5 + Math.sin(t * 0.71) * 0.5;
    const tremor = Math.sin(t * 43) * 0.012 + Math.sin(t * 61 + 0.7) * 0.01;
    return { x: driftX * 0.1 + tremor, y: breath * 0.16 + driftY * 0.06 + tremor };
  }

  /** Mirage strength in px: none under 250 m, growing to full by 800 m. */
  mirageAmplitudePx(ppm) {
    if (!this.realism.has('mirage') || !this.target) return 0;
    const f = Math.max(0, Math.min(1, (this.distance - 250) / 550));
    return f * Math.min(4, 0.05 * ppm + 0.6);
  }

  /** Draws the target in thin horizontal bands that waver sideways (heat shimmer). */
  drawTargetWithMirage(offSize, x, y, w, h, amp) {
    const ctx = this.ctx;
    const t = performance.now() / 1000;
    const bands = Math.max(12, Math.min(80, Math.round(h / 2)));
    const bandSrc = offSize.height / bands;
    const bandDst = h / bands;
    for (let i = 0; i < bands; i++) {
      const phase = i * 0.55 + t * 5.5;
      const dx = amp * (Math.sin(phase) * 0.7 + Math.sin(phase * 2.3 + 1.7) * 0.3);
      ctx.drawImage(this.targetOffscreenCanvas, 0, i * bandSrc, offSize.width, bandSrc + 0.5, x + dx, y + i * bandDst, w, bandDst + 0.5);
    }
  }

  /** Grass in front of the target's base, covering up to ~20% of its height. */
  drawForegroundGrass(x, y, w, h) {
    const ctx = this.ctx;
    const style = ENV_STYLES[this.environment] || ENV_STYLES.forest;
    const baseY = y + h + 1;
    const maxH = Math.min(h * 0.2, (0.35 * 1000 / this.distance) * this.pxPerMILAt());
    if (maxH < 1.5) return;
    const span = w * 1.6;
    const count = Math.max(10, Math.min(160, Math.round(span / 2.5)));
    ctx.save();
    ctx.strokeStyle = this.environment === 'snow' ? 'rgba(120, 132, 140, 0.9)' : style.ground[1];
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(1, maxH * 0.07);
    ctx.beginPath();
    for (let i = 0; i < count; i++) {
      const s1 = this.detailSeed(i, 701);
      const s2 = this.detailSeed(i, 702);
      const gx = x + w / 2 - span / 2 + (i / count) * span + (s1 - 0.5) * 4;
      const gh = maxH * (0.45 + 0.55 * s2);
      ctx.moveTo(gx, baseY);
      ctx.quadraticCurveTo(gx + (s1 - 0.5) * gh * 0.4, baseY - gh * 0.6, gx + (s2 - 0.5) * gh * 0.6, baseY - gh);
    }
    ctx.stroke();
    ctx.restore();
  }

  /** Dusk / poor light: darker, cooler and less saturated. */
  drawLowLight(w, h) {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = '#5f677a';
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'saturation';
    ctx.globalAlpha = 0.45;
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  /** Orange dimension brackets with the true MIL values (FEAT-003). */
  drawTruthBrackets(x, y, w, h, milW, milH) {
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = '#ff8c00';
    ctx.fillStyle = '#ff8c00';
    ctx.lineWidth = 2;
    ctx.font = '600 12px "Roboto Mono", monospace';
    const gap = 8;
    // Height bracket on the left
    ctx.beginPath();
    ctx.moveTo(x - gap - 6, y); ctx.lineTo(x - gap, y); ctx.lineTo(x - gap, y + h); ctx.lineTo(x - gap - 6, y + h);
    ctx.stroke();
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    this.outlinedText(`${milH.toFixed(2)} MIL`, x - gap - 10, y + h / 2);
    // Width bracket above
    ctx.beginPath();
    ctx.moveTo(x, y - gap - 6); ctx.lineTo(x, y - gap); ctx.lineTo(x + w, y - gap); ctx.lineTo(x + w, y - gap - 6);
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    this.outlinedText(`${milW.toFixed(2)} MIL`, x + w / 2, y - gap - 8);
    ctx.restore();
  }

  outlinedText(text, x, y) {
    const ctx = this.ctx;
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.strokeText(text, x, y);
    ctx.fillText(text, x, y);
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#ff8c00';
  }

  /**
   * Physically-scaled landscape. Every scenery item has a real size in meters and a
   * real distance, and is projected with the same rule as the target
   * (MIL = meters x 1000 / distance), so a 20 m tree 150 m behind a deer is always
   * far taller than the deer. The horizon is at eye level (0 MIL), objects stand on
   * a flat ground plane below it (their base is EYE_HEIGHT_M x 1000 / distance MIL
   * below the horizon), and panning/zooming moves everything together.
   */
  computeSceneTransform(w, h) {
    const ppm = this.pxPerMILAt();
    const cx = w / 2;
    const cy = h / 2;
    const panX = this.panX;
    const panY = this.panY;
    const mx = (milX) => cx + (milX - panX) * ppm;
    const my = (milY) => cy - (milY - panY) * ppm;
    return {
      ppm, w, h, cx, cy,
      mx, my,
      horizonY: my(0),
      halfViewMIL: Math.max(w, h) / 2 / ppm,
      // Compatibility for weather particles: "scene units" (18 per MIL).
      k: ppm / 18,
      groundY: my(0),
      x: (u) => mx(u / 18)
    };
  }

  /** Screen y of the ground at `distM` meters (flat ground, eye at EYE_HEIGHT_M). */
  groundYAt(distM) {
    return this.scene.my(-EYE_HEIGHT_M * 1000 / distM);
  }

  renderBackground(w, h) {
    const ctx = this.ctx;
    const scene = this.scene = this.computeSceneTransform(w, h);
    const style = ENV_STYLES[this.environment] || ENV_STYLES.forest;
    const d = this.distance || 300;
    const horizonY = scene.horizonY;

    // Sky: gradient ending at the horizon.
    if (horizonY > 0) {
      const sky = ctx.createLinearGradient(0, horizonY - Math.max(h, 30 * scene.ppm), 0, horizonY);
      sky.addColorStop(0, style.sky[0]);
      sky.addColorStop(1, style.sky[1]);
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, w, Math.min(h, horizonY));
      this.drawClouds(w, horizonY);
    }
    // Ground: lighter/hazier at the horizon, darker towards the shooter.
    if (horizonY < h) {
      const nearY = Math.max(horizonY + 2, this.groundYAt(Math.max(5, d * 0.4)));
      const ground = ctx.createLinearGradient(0, horizonY, 0, nearY);
      ground.addColorStop(0, style.ground[0]);
      ground.addColorStop(1, style.ground[1]);
      ctx.fillStyle = ground;
      ctx.fillRect(0, Math.max(0, horizonY), w, h - Math.max(0, horizonY));
      this.drawGroundTexture(w, h, horizonY);
    }

    // Everything else is drawn far-to-near so nearer things overlap farther ones.
    const items = [];
    this.buildEnvironmentLayers(items, d);
    this.buildGroundTexture(items, d, style);
    // Atmospheric haze softens the horizon and everything far away.
    items.push({ dist: 2500, draw: () => this.drawHaze(w, h, horizonY, style) });
    items.sort((a, b) => b.dist - a.dist);
    for (const item of items) item.draw();
  }

  /** A repeating texture anchored to the world: it pans and zooms with the scene. */
  worldPattern(tex, tileMIL, squash = 1, anchorY = null) {
    const { mx, ppm, horizonY } = this.scene;
    const pat = this.ctx.createPattern(tex, 'repeat');
    const s = (tileMIL * ppm) / tex.width;
    if (pat.setTransform) pat.setTransform(new DOMMatrix([s, 0, 0, s * squash, mx(0), anchorY ?? horizonY]));
    return pat;
  }

  drawClouds(w, horizonY) {
    const cfg = CLOUDS[this.environment];
    if (!cfg || horizonY <= 0) return;
    const ctx = this.ctx;
    const { ppm } = this.scene;
    const tex = cloudTexture(this.environment, { cover: cfg.cover, tint: cfg.tint || [255, 255, 255] });
    // Cloud deck from 3 MIL to 60 MIL above the horizon, one tile 180 MIL wide.
    const top = Math.max(0, horizonY - 60 * ppm);
    const bottom = horizonY - 3 * ppm;
    if (bottom <= 0) return;
    ctx.save();
    ctx.globalAlpha = cfg.alpha;
    ctx.fillStyle = this.worldPattern(tex, 360, 0.2, horizonY);
    ctx.fillRect(0, top, w, bottom - top);
    // fade the deck out towards the horizon
    const fade = ctx.createLinearGradient(0, horizonY - 14 * ppm, 0, bottom);
    fade.addColorStop(0, 'rgba(0,0,0,0)');
    fade.addColorStop(1, 'rgba(0,0,0,1)');
    ctx.globalCompositeOperation = 'destination-out';
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = fade;
    ctx.fillRect(0, Math.max(top, horizonY - 14 * ppm), w, bottom - Math.max(top, horizonY - 14 * ppm));
    ctx.restore();
    // destination-out cut the sky too; repaint sky behind the faded band
    ctx.save();
    ctx.globalCompositeOperation = 'destination-over';
    const style = ENV_STYLES[this.environment] || ENV_STYLES.forest;
    ctx.fillStyle = style.sky[1];
    ctx.fillRect(0, Math.max(0, horizonY - 14 * ppm), w, horizonY - Math.max(0, horizonY - 14 * ppm));
    ctx.restore();
  }

  /** Two scales of colour variation in the ground (patches and fine grain). */
  drawGroundTexture(w, h, horizonY) {
    if (horizonY >= h) return;
    const ctx = this.ctx;
    const top = Math.max(0, horizonY);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, top, w, h - top);
    ctx.clip();
    ctx.globalCompositeOperation = 'soft-light';
    ctx.globalAlpha = 0.38;
    ctx.fillStyle = this.worldPattern(grainTexture('ground-coarse', { base: 3, octaves: 4, seed: 21, contrast: 1.2 }), 70, 0.5);
    ctx.fillRect(0, top, w, h - top);
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = this.worldPattern(grainTexture('ground-fine', { base: 8, octaves: 3, seed: 22, contrast: 1.1 }), 3, 0.5);
    ctx.fillRect(0, top, w, h - top);
    ctx.restore();
  }

  drawHaze(w, h, horizonY, style) {
    const ctx = this.ctx;
    const band = Math.max(18, h * 0.09);
    const g = ctx.createLinearGradient(0, horizonY - band * 1.6, 0, horizonY + band * 0.6);
    const sky = style.sky[1];
    g.addColorStop(0, `${sky}00`);
    g.addColorStop(0.72, `${sky}8c`);
    g.addColorStop(1, `${sky}00`);
    ctx.save();
    ctx.fillStyle = g;
    ctx.fillRect(0, horizonY - band * 1.6, w, band * 2.2);
    ctx.restore();
  }

  /** Overlay a world-anchored grain texture inside `path` (foliage, rock). */
  textureInside(path, tex, tileMIL, alpha) {
    const ctx = this.ctx;
    ctx.save();
    ctx.clip(path);
    ctx.globalCompositeOperation = 'soft-light';
    ctx.globalAlpha = alpha;
    ctx.fillStyle = this.worldPattern(tex, tileMIL, 1);
    ctx.fillRect(0, 0, this.scene.w, this.scene.h);
    ctx.restore();
  }

  /** Iterates items spaced `spacingM` apart along a line `distM` meters away. */
  forEachInLayer(distM, spacingM, salt, marginMIL, fn) {
    const mPerMIL = distM / 1000;
    const half = this.scene.halfViewMIL + marginMIL;
    const first = Math.floor(((this.panX - half) * mPerMIL) / spacingM) - 1;
    const last = Math.ceil(((this.panX + half) * mPerMIL) / spacingM) + 1;
    if (last - first > 2500) return; // far too dense to see at this scale
    for (let i = first; i <= last; i++) {
      const seed = this.detailSeed(i, salt);
      const xM = (i + seed * 0.8) * spacingM;
      fn(xM / mPerMIL, seed, i);
    }
  }

  buildEnvironmentLayers(items, d) {
    const add = (dist, draw) => items.push({ dist, draw });
    const trees = (dist, spacing, minH, maxH, color, salt, alpha = 1) =>
      add(dist, () => this.drawTreeLayer(dist, spacing, minH, maxH, color, salt, alpha));

    switch (this.environment) {
      case 'forest':
        trees(d + 170, 4, 18, 28, '#2b3b27', 31, 0.9);
        trees(d + 70, 4.5, 16, 26, '#18241a', 32);
        break;
      case 'field':
        trees(d + 600, 9, 12, 20, '#4b5f40', 41, 0.75);
        trees(d + 1400, 7, 14, 22, '#6d8061', 42, 0.6);
        break;
      case 'snow':
        trees(d + 250, 5, 14, 24, '#2f3e34', 51, 0.85);
        break;
      case 'mountain':
        add(9000, () => this.drawRidge(9000, 450, 300, 900, '#6a8193', 61));
        add(4500, () => this.drawRidge(4500, 220, 120, 420, '#46564f', 62));
        trees(d + 300, 6, 10, 18, '#25321f', 63);
        break;
      case 'desert':
        add(3000, () => this.drawRidge(3000, 160, 20, 70, '#bb9160', 71));
        add(1200, () => this.drawRidge(1200, 90, 6, 18, '#a97f4f', 72));
        break;
      case 'urban':
        add(d + 260, () => this.drawBuildings(d + 260, 81, '#2a3036', 0.85));
        add(d + 90, () => this.drawBuildings(d + 90, 82, '#14181c', 1));
        break;
      case 'range':
        trees(d + 450, 7, 12, 20, '#556347', 91, 0.7);
        add(d + 20, () => this.drawBerm(d + 20));
        break;
      case 'fog':
        trees(d + 120, 5, 14, 24, 'rgba(70,80,76,0.75)', 101);
        break;
      case 'rain':
        trees(d + 130, 4.5, 15, 25, '#18221a', 111);
        break;
      case 'dusk':
        add(1e9, () => this.drawSun());
        add(6000, () => this.drawRidge(6000, 300, 150, 450, '#3a2340', 121));
        trees(d + 220, 5, 14, 24, '#140c12', 122);
        break;
    }
  }

  /** Grass tufts / pebbles / snow / pavement joints spread over distance for depth. */
  buildGroundTexture(items, d, style) {
    const near = Math.max(4, d * 0.35);
    const far = Math.min(d * 4, d + 800);
    for (let r = near, row = 0; r < far; r *= 1.07, row++) {
      const dist = r;
      const rowIndex = row;
      items.push({ dist, draw: () => this.drawGroundRow(dist, rowIndex, style) });
    }
  }

  drawGroundRow(dist, row, style) {
    const y = this.groundYAt(dist);
    if (y < -5 || y > this.scene.h + 40) return;
    const ctx = this.ctx;
    const { mx, ppm } = this.scene;
    const milPerM = 1000 / dist;
    // Rows well in front of the target are out of focus at this magnification, so
    // they fade; rows around and behind the target are crisp but understated.
    const d = this.distance || dist;
    const focus = dist >= d ? 1 : Math.max(0, (dist / d - 0.35) / 0.65);
    ctx.save();
    ctx.globalAlpha = 0.25 + 0.55 * focus;
    ctx.strokeStyle = style.texColor;
    ctx.fillStyle = style.texColor;
    ctx.lineWidth = Math.max(0.8, Math.min(2.2, 0.03 * milPerM * ppm));
    ctx.beginPath();
    this.forEachInLayer(dist, 1.3, 200 + row, 1, (xMIL, seed) => {
      const x = mx(xMIL);
      const yy = y + (seed - 0.5) * 0.25 * milPerM * ppm * 0.2;
      const size = (0.1 + seed * 0.22) * milPerM * ppm;
      if (size < 0.8) return;
      switch (style.tex) {
        case 'pebble': {
          // Small stones: a fraction of the tuft size, flattened by perspective.
          const ps = size * 0.35;
          ctx.moveTo(x + ps, yy);
          ctx.ellipse(x, yy, ps, ps * 0.35, 0, 0, Math.PI * 2);
          break;
        }
        case 'snow':
          ctx.moveTo(x - size * 0.6, yy);
          ctx.quadraticCurveTo(x, yy - size * 0.35, x + size * 0.6, yy);
          break;
        case 'pavement':
          ctx.moveTo(x - size, yy);
          ctx.lineTo(x + size, yy);
          break;
        default: // grass tuft
          ctx.moveTo(x - size * 0.25, yy);
          ctx.lineTo(x - size * 0.35, yy - size);
          ctx.moveTo(x, yy);
          ctx.lineTo(x + size * 0.05, yy - size * 1.2);
          ctx.moveTo(x + size * 0.25, yy);
          ctx.lineTo(x + size * 0.4, yy - size * 0.9);
      }
    });
    if (style.tex === 'pebble') ctx.fill(); else ctx.stroke();
    ctx.restore();
  }

  /** Deterministic pseudo-random in [0,1): stable across renders so detail doesn't flicker. */
  detailSeed(i, salt = 0) {
    const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
    return x - Math.floor(x);
  }

  /**
   * Spruce silhouettes: a jagged outline of drooping branch tiers that keeps its
   * texture at any magnification, with a slight tone variation per tree.
   */
  drawTreeLayer(dist, spacingM, minH, maxH, color, salt, alpha = 1) {
    const ctx = this.ctx;
    const { mx, ppm, w, h } = this.scene;
    const baseY = this.groundYAt(dist);
    const milPerM = 1000 / dist;
    const isHex = /^#[0-9a-f]{6}$/i.test(color);
    const all = new Path2D();
    const shadow = new Path2D();
    ctx.save();
    ctx.globalAlpha = alpha;
    this.forEachInLayer(dist, spacingM, salt, maxH * 0.25 * milPerM, (xMIL, seed, i) => {
      const treeH = (minH + seed * (maxH - minH)) * milPerM * ppm;
      const halfW = treeH * 0.2;
      const cx = mx(xMIL);
      if (cx + halfW < 0 || cx - halfW > w || baseY - treeH > h || treeH < 1.5) return;
      ctx.fillStyle = isHex ? shadeHex(color, (this.detailSeed(i, salt + 5) - 0.5) * 22) : color;
      const tiers = 11;
      const trunk = treeH * 0.05;
      const left = [];
      const right = [];
      for (let k = 0; k <= tiers; k++) {
        const f = k / tiers;                       // 0 at the tip, 1 at the bottom
        const y = baseY - trunk - (treeH - trunk) * (1 - f);
        const jag = 0.82 + this.detailSeed(i * 31 + k, salt + 9) * 0.36;
        const wTier = halfW * Math.pow(f, 0.9) * jag;
        // branch tip droops below the tier line; the notch sits above it
        left.push([cx - wTier, y + treeH * 0.018], [cx - wTier * 0.45, y - treeH * 0.012]);
        right.push([cx + wTier, y + treeH * 0.018], [cx + wTier * 0.45, y - treeH * 0.012]);
      }
      const tree = new Path2D();
      tree.moveTo(cx, baseY - treeH);
      right.forEach(([x, y]) => tree.lineTo(x, y));
      tree.lineTo(cx + treeH * 0.012, baseY - trunk);
      tree.lineTo(cx + treeH * 0.012, baseY);
      tree.lineTo(cx - treeH * 0.012, baseY);
      tree.lineTo(cx - treeH * 0.012, baseY - trunk);
      for (let k = left.length - 1; k >= 0; k--) tree.lineTo(left[k][0], left[k][1]);
      tree.closePath();
      ctx.fill(tree);
      all.addPath(tree);
      // shaded side: the right half of each tree a little darker
      shadow.moveTo(cx, baseY - treeH);
      right.forEach(([x, y]) => shadow.lineTo(x, y));
      shadow.lineTo(cx, baseY);
      shadow.closePath();
    });
    ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
    ctx.fill(shadow);
    ctx.restore();
    // needle texture: a 2 m tile at this distance
    this.textureInside(all, grainTexture('foliage', { base: 8, octaves: 4, seed: 31, contrast: 2 }), 2000 / dist, 0.55 * alpha);
  }

  /** Mountain / dune silhouette at `dist` meters, peak heights in meters. */
  drawRidge(dist, spacingM, minH, maxH, color, salt) {
    const ctx = this.ctx;
    const { mx, ppm, w } = this.scene;
    const baseY = this.groundYAt(dist);
    const milPerM = 1000 / dist;
    const pts = [];
    this.forEachInLayer(dist, spacingM, salt, spacingM * milPerM * 2, (xMIL, seed) => {
      pts.push([mx(xMIL), baseY - (minH + seed * (maxH - minH)) * milPerM * ppm]);
    });
    if (pts.length < 2) return;
    const ridge = new Path2D();
    ridge.moveTo(Math.min(0, pts[0][0]), baseY + 2);
    pts.forEach(([x, y]) => ridge.lineTo(x, y));
    ridge.lineTo(Math.max(w, pts[pts.length - 1][0]), baseY + 2);
    ridge.closePath();
    ctx.save();
    ctx.fillStyle = color;
    ctx.fill(ridge);
    ctx.restore();
    // rock / slope texture at a ~60 m tile for this distance
    this.textureInside(ridge, grainTexture('rock', { base: 4, octaves: 5, seed: 41, contrast: 1.4 }), 90000 / dist, 0.32);
  }

  drawBuildings(dist, salt, color, alpha) {
    const ctx = this.ctx;
    const { mx, ppm, w, h } = this.scene;
    const baseY = this.groundYAt(dist);
    const k = (1000 / dist) * ppm; // screen px per meter at this distance
    const facades = new Path2D();
    ctx.save();
    ctx.globalAlpha = alpha;
    this.forEachInLayer(dist, 24, salt, 30 * 1000 / dist, (xMIL, seed, i) => {
      const bW = (14 + seed * 10) * k;
      const bH = (12 + this.detailSeed(i, salt + 1) * 28) * k;
      const left = mx(xMIL) - bW / 2;
      if (left + bW < 0 || left > w || baseY - bH > h) return;
      ctx.fillStyle = color;
      ctx.fillRect(left, baseY - bH, bW, bH);
      facades.rect(left, baseY - bH, bW, bH);
      // light falls from the left: shade the right third of each block
      ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
      ctx.fillRect(left + bW * 0.66, baseY - bH, bW * 0.34, bH);
      ctx.fillStyle = color;
      // Windows: 1.2 x 1.5 m, one floor every 3.2 m, every 3 m across.
      if (k * 1.2 < 1.5) return;
      ctx.fillStyle = 'rgba(255, 200, 120, 0.5)';
      for (let fy = 1.2; fy + 1.5 < bH / k - 0.5; fy += 3.2) {
        for (let fx = 1.2; fx + 1.2 < bW / k - 0.8; fx += 3) {
          if (this.detailSeed(i * 131 + Math.round(fx * 7) + Math.round(fy * 13), salt + 2) > 0.45) {
            const wx = left + fx * k;
            const wy = baseY - (fy + 1.5) * k;
            if (wx > w || wx + 1.2 * k < 0 || wy > h || wy + 1.5 * k < 0) continue;
            ctx.fillRect(wx, wy, 1.2 * k, 1.5 * k);
          }
        }
      }
    });
    ctx.restore();
    this.textureInside(facades, grainTexture('concrete', { base: 6, octaves: 4, seed: 61, contrast: 1.3 }), 6000 / dist, 0.4);
  }

  /** Earth backstop berm, 4.5 m high, behind the target. */
  drawBerm(dist) {
    const ctx = this.ctx;
    const { mx, ppm, w } = this.scene;
    const baseY = this.groundYAt(dist);
    const k = (1000 / dist) * ppm;
    const top = baseY - 4.5 * k;
    const grad = ctx.createLinearGradient(0, top, 0, baseY);
    grad.addColorStop(0, '#8a7f65');
    grad.addColorStop(1, '#5c5340');
    ctx.save();
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(0, baseY);
    let first = true;
    this.forEachInLayer(dist, 6, 7, 2, (xMIL, seed) => {
      const x = mx(xMIL);
      const y = top + seed * 0.4 * k;
      if (first) { ctx.lineTo(Math.min(0, x), y); first = false; }
      ctx.lineTo(x, y);
    });
    ctx.lineTo(w, top);
    ctx.lineTo(w, baseY);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    // packed-earth texture, 3 m tile at the berm's distance
    const berm = new Path2D();
    berm.rect(0, top - 0.4 * k, w, baseY - top + 0.4 * k);
    this.textureInside(berm, grainTexture('earth', { base: 5, octaves: 5, seed: 51, contrast: 1.5 }), 3000 / dist, 0.5);
  }

  /** Setting sun on the horizon (true angular size ~9.3 MIL) with a glow. */
  drawSun() {
    const ctx = this.ctx;
    const { mx, ppm, horizonY } = this.scene;
    const sunX = mx(60);
    const sunY = horizonY - 3 * ppm;
    const R = 4.65 * ppm;
    ctx.save();
    const glow = ctx.createRadialGradient(sunX, sunY, R * 0.5, sunX, sunY, R * 7);
    glow.addColorStop(0, 'rgba(255, 190, 120, 0.85)');
    glow.addColorStop(1, 'rgba(255, 140, 60, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(sunX, sunY, R * 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 225, 180, 0.95)';
    ctx.beginPath();
    ctx.arc(sunX, sunY, R, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /**
   * Weather particles (snow flakes, rain streaks) placed in the world on a repeating
   * tile, so turning the scope moves them with everything else. Their on-screen size
   * is capped: they are close to the shooter and would be out of focus, not magnified.
   */
  forEachWeatherParticle(w, h, count, salt, fn) {
    const { k, x, groundY } = this.scene;
    const tile = 700;
    const pxPerTile = tile * k;
    const ux0 = Math.floor((-x(0)) / pxPerTile) - 1;
    const ux1 = Math.ceil((w - x(0)) / pxPerTile) + 1;
    const vy0 = Math.floor((0 - groundY) / pxPerTile) - 1;
    const vy1 = Math.ceil((h - groundY) / pxPerTile) + 1;
    if ((ux1 - ux0) * (vy1 - vy0) > 400) return;
    for (let tx = ux0; tx <= ux1; tx++) {
      for (let ty = vy0; ty <= vy1; ty++) {
        for (let i = 0; i < count; i++) {
          const px = x(tx * tile + this.detailSeed(i, salt) * tile);
          const py = groundY + (ty * tile + this.detailSeed(i, salt + 1) * tile) * k;
          if (px < -20 || px > w + 20 || py < -20 || py > h + 20) continue;
          fn(px, py, this.detailSeed(i, salt + 2));
        }
      }
    }
  }

  renderWeatherOverlay(w, h) {
    const ctx = this.ctx;
    if (!this.scene) return;
    if (this.environment === 'fog') {
      ctx.fillStyle = 'rgba(210, 220, 225, 0.45)';
      ctx.fillRect(0, 0, w, h);
    } else if (this.environment === 'rain') {
      const len = 16 * Math.max(0.6, Math.min(1, this.scene.k));
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      this.forEachWeatherParticle(w, h, 60, 21, (px, py) => {
        ctx.moveTo(px, py);
        ctx.lineTo(px - len / 4, py + len);
      });
      ctx.stroke();
    } else if (this.environment === 'snow') {
      const size = Math.max(0.6, Math.min(1, this.scene.k));
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.beginPath();
      this.forEachWeatherParticle(w, h, 60, 11, (px, py, r) => {
        const rad = (1 + r * 1.5) * size * 1.4;
        ctx.moveTo(px + rad, py);
        ctx.arc(px, py, rad, 0, Math.PI * 2);
      });
      ctx.fill();
    }
  }

  /**
   * Draws the reticle as crisp SVG from js/reticle-designs.js (geometry in MIL,
   * scaled by the current pixels-per-MIL: first focal plane behaviour).
   */
  renderReticleSVG() {
    if (!this.svgContainer || !this.canvasSize) return;
    const size = Number(this.canvasSize) || 0;
    // Settings come from storage: keep only a hex colour and a numeric opacity in the markup.
    const color = /^#[0-9a-f]{6}$/i.test(this.reticleColor) ? this.reticleColor : '#111111';
    const b = Number(this.reticleBrightness);
    const opacity = Number.isFinite(b) ? Math.min(1, Math.max(0, b)) : 1;
    // Illuminated colours get a faint glow; a black etched reticle stays plain.
    const illuminated = !/^#(0|1)[0-9a-f]{5}$/i.test(color);
    // eslint-disable-next-line no-unsanitized/property -- reviewed: strings escaped with escapeHTML, other values numeric or fixed; imported targets re-validated
    this.svgContainer.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" style="opacity: ${opacity};">
        <defs>
          <filter id="reticleHalo" x="-5%" y="-5%" width="110%" height="110%">
            <feGaussianBlur stdDeviation="1.1" result="b"/>
            <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
        </defs>
        ${reticleSVG(this.reticleType, { ppm: this.pxPerMILAt(), cx: size / 2, cy: size / 2, color, halo: illuminated })}
      </svg>
    `;
  }

  /**
   * Bind Mouse, Touch, and Keyboard Event Handlers
   */
  bindEvents() {
    const viewport = document.getElementById('scope-viewport');
    if (!viewport) return;

    // Mouse Drag Panning
    viewport.addEventListener('mousedown', (e) => {
      this.isDragging = true;
      this.lastPointerX = e.clientX;
      this.lastPointerY = e.clientY;
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.isDragging) return;
      const dx = e.clientX - this.lastPointerX;
      const dy = e.clientY - this.lastPointerY;
      this.lastPointerX = e.clientX;
      this.lastPointerY = e.clientY;
      this.panByPixels(dx, dy);
    });

    window.addEventListener('mouseup', () => {
      this.isDragging = false;
    });

    // Wheel / trackpad zoom: proportional to scroll distance, so a gentle two-finger
    // scroll is a small change instead of one 0.5x step per event (audit BUG-012).
    viewport.addEventListener('wheel', (e) => {
      e.preventDefault();
      const unit = e.deltaMode === 1 ? 16 : (e.deltaMode === 2 ? 400 : 1); // lines/pages -> px
      const delta = e.deltaY * unit;
      const factor = Math.exp(-delta * 0.0025 * this.zoomSensitivity);
      this.setZoom(this.zoom * factor);
      this.hideHint();
      const now = performance.now();
      if (now - this.lastWheelSoundAt > 150) { this.lastWheelSoundAt = now; sfx.playClick(); }
    }, { passive: false });

    // Touch Drag & Pinch Zoom
    viewport.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        this.isDragging = true;
        this.lastPointerX = e.touches[0].clientX;
        this.lastPointerY = e.touches[0].clientY;
      } else if (e.touches.length === 2) {
        this.isDragging = false;
        this.pinchDistance = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
      }
    }, { passive: true });

    viewport.addEventListener('touchmove', (e) => {
      if (e.touches.length === 1 && this.isDragging) {
        const dx = e.touches[0].clientX - this.lastPointerX;
        const dy = e.touches[0].clientY - this.lastPointerY;
        this.lastPointerX = e.touches[0].clientX;
        this.lastPointerY = e.touches[0].clientY;
        this.panByPixels(dx, dy);
      } else if (e.touches.length === 2) {
        const newDist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        // Proportional pinch: zoom follows the finger spread.
        if (this.pinchDistance > 0) {
          const ratio = newDist / this.pinchDistance;
          this.setZoom(this.zoom * Math.pow(ratio, this.zoomSensitivity));
          this.hideHint();
        }
        this.pinchDistance = newDist;
      }
    }, { passive: true });

    viewport.addEventListener('touchend', () => {
      this.isDragging = false;
    });

    // Keyboard navigation. Works while the answer box is focused but still empty, so
    // auto-focusing it doesn't disable panning (audit BUG-011).
    window.addEventListener('keydown', (e) => {
      const simTab = document.getElementById('page-simulator');
      if (!simTab || !simTab.classList.contains('active')) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const el = document.activeElement;
      const tag = el ? el.tagName : '';
      const isAnswerBox = el && (el.id === 'sim-estimated-distance' || el.id === 'sim-mil-reading');
      const typing = (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (el && el.isContentEditable))
        && !(isAnswerBox && el.value === '');
      if (typing) return;
      if (document.querySelector('.modal.show')) return;

      const panAmountPx = 15;
      switch (e.key) {
        case 'ArrowUp': this.panByPixels(0, panAmountPx); e.preventDefault(); break;
        case 'ArrowDown': this.panByPixels(0, -panAmountPx); e.preventDefault(); break;
        case 'ArrowLeft': this.panByPixels(panAmountPx, 0); e.preventDefault(); break;
        case 'ArrowRight': this.panByPixels(-panAmountPx, 0); e.preventDefault(); break;
        case '+':
        case '=':
          this.setZoom(this.zoom + 1); e.preventDefault(); break;
        case '-':
        case '_':
          this.setZoom(this.zoom - 1); e.preventDefault(); break;
        case 'r':
        case 'R':
          if (!isAnswerBox) this.resetView();
          break;
        case 'c':
        case 'C':
          if (!isAnswerBox) this.centerTarget();
          break;
      }
    });
  }
}
