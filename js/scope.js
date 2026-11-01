/* ==========================================================================
   Virtual First Focal Plane (FFP) Scope Engine
   Handles Canvas background/target, SVG vector reticle scaling, pan & zoom.
   ========================================================================== */

import { renderTargetSVGString, isSafeImageDataURI, sfx } from './utils.js';

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

    // Display / reticle settings
    this.reticleType = 'mil_dot';
    this.reticleColor = '#ff2a2a';
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

    // Center view on the target
    this.panX = this.targetOffsetMILX;
    this.panY = this.targetOffsetMILY;

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
        this.ctx.drawImage(
          this.targetOffscreenCanvas,
          0, 0, offSize.width, offSize.height,
          screenTargetX, screenTargetY, targetPxWidth, targetPxHeight
        );
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

    // 3. Environmental overlays (fog, rain, snow)
    if (!this.measurementMode) this.renderWeatherOverlay(width, height);
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
    }
    // Ground: lighter/hazier at the horizon, darker towards the shooter.
    if (horizonY < h) {
      const nearY = Math.max(horizonY + 2, this.groundYAt(Math.max(5, d * 0.4)));
      const ground = ctx.createLinearGradient(0, horizonY, 0, nearY);
      ground.addColorStop(0, style.ground[0]);
      ground.addColorStop(1, style.ground[1]);
      ctx.fillStyle = ground;
      ctx.fillRect(0, Math.max(0, horizonY), w, h - Math.max(0, horizonY));
    }

    // Everything else is drawn far-to-near so nearer things overlap farther ones.
    const items = [];
    this.buildEnvironmentLayers(items, d);
    this.buildGroundTexture(items, d, style);
    items.sort((a, b) => b.dist - a.dist);
    for (const item of items) item.draw();
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
      ctx.beginPath();
      ctx.moveTo(cx, baseY - treeH);
      right.forEach(([x, y]) => ctx.lineTo(x, y));
      ctx.lineTo(cx + treeH * 0.012, baseY - trunk);
      ctx.lineTo(cx + treeH * 0.012, baseY);
      ctx.lineTo(cx - treeH * 0.012, baseY);
      ctx.lineTo(cx - treeH * 0.012, baseY - trunk);
      for (let k = left.length - 1; k >= 0; k--) ctx.lineTo(left[k][0], left[k][1]);
      ctx.closePath();
      ctx.fill();
    });
    ctx.restore();
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
    ctx.save();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(Math.min(0, pts[0][0]), baseY + 2);
    pts.forEach(([x, y]) => ctx.lineTo(x, y));
    ctx.lineTo(Math.max(w, pts[pts.length - 1][0]), baseY + 2);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  drawBuildings(dist, salt, color, alpha) {
    const ctx = this.ctx;
    const { mx, ppm, w, h } = this.scene;
    const baseY = this.groundYAt(dist);
    const k = (1000 / dist) * ppm; // screen px per meter at this distance
    ctx.save();
    ctx.globalAlpha = alpha;
    this.forEachInLayer(dist, 24, salt, 30 * 1000 / dist, (xMIL, seed, i) => {
      const bW = (14 + seed * 10) * k;
      const bH = (12 + this.detailSeed(i, salt + 1) * 28) * k;
      const left = mx(xMIL) - bW / 2;
      if (left + bW < 0 || left > w || baseY - bH > h) return;
      ctx.fillStyle = color;
      ctx.fillRect(left, baseY - bH, bW, bH);
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
   * Generates razor-sharp SVG vector reticle matching selected style and FFP scale factor
   */
  renderReticleSVG() {
    if (!this.svgContainer || !this.canvasSize) return;

    const size = this.canvasSize;
    const center = size / 2;
    // Pixels per MIL at current zoom in FFP
    const pxPerMIL = this.pxPerMILAt();
    // Numerals sit 1-2 MIL apart; below this spacing they overlap into clutter
    // (on a real FFP scope they also become unreadably small at low power).
    this.reticleLabelsVisible = pxPerMIL >= 16;

    const strokeColor = this.reticleColor || '#ff2a2a';
    const brightness = this.reticleBrightness;

    let svgContent = '';

    switch (this.reticleType) {
      case 'christmas_tree':
        svgContent = this.generateChristmasTreeSVG(center, pxPerMIL, strokeColor);
        break;

      case 'tremor_style':
        svgContent = this.generateTremorStyleSVG(center, pxPerMIL, strokeColor);
        break;

      case 'mrad_grid':
        svgContent = this.generateMRADGridSVG(center, pxPerMIL, strokeColor);
        break;

      case 'duplex_bdc':
        svgContent = this.generateDuplexBDCSVG(center, pxPerMIL, strokeColor);
        break;

      case 'german_number4':
        svgContent = this.generateGerman4SVG(center, pxPerMIL, strokeColor);
        break;

      case 'circle_dot':
        svgContent = this.generateCircleDotSVG(center, pxPerMIL, strokeColor);
        break;

      case 'crosshair_only':
        svgContent = this.generateCrosshairSVG(center, pxPerMIL, strokeColor);
        break;

      case 'mil_dot':
      default:
        svgContent = this.generateMILDotSVG(center, pxPerMIL, strokeColor);
        break;
    }

    this.svgContainer.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" style="opacity: ${brightness};">
        <defs>
          <filter id="reticleContrastGlow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="0" stdDeviation="1.2" flood-color="#000000" flood-opacity="0.95"/>
            <feDropShadow dx="0" dy="0" stdDeviation="0.5" flood-color="#000000" flood-opacity="1.0"/>
          </filter>
        </defs>
        <g filter="url(#reticleContrastGlow)">
          ${svgContent}
        </g>
      </svg>
    `;
  }

  /** Helper to build dual-pass SVG elements with dark outline and bright inner stroke */
  createHighContrastLine(x1, y1, x2, y2, color, width) {
    const bgWidth = width + 2;
    return `
      <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#000000" stroke-width="${bgWidth}" stroke-linecap="round"/>
      <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${width}" stroke-linecap="round"/>
    `;
  }

  createHighContrastCircle(cx, cy, r, color) {
    return `
      <circle cx="${cx}" cy="${cy}" r="${r + 1.2}" fill="#000000"/>
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}"/>
    `;
  }

  createHighContrastText(x, y, text, color, fontSize = 11, anchor = "middle") {
    if (this.reticleLabelsVisible === false) return '';
    return `
      <text x="${x}" y="${y}" fill="#000000" font-size="${fontSize}" font-weight="900" font-family="'Roboto Mono', monospace" text-anchor="${anchor}" stroke="#000000" stroke-width="2.5" paint-order="stroke fill">${text}</text>
      <text x="${x}" y="${y}" fill="${color}" font-size="${fontSize}" font-weight="700" font-family="'Roboto Mono', monospace" text-anchor="${anchor}">${text}</text>
    `;
  }

  generateMILDotSVG(center, pxPerMIL, color) {
    let elements = [];
    const maxMIL = 12;

    // Heavy Outer Duplex Posts
    const duplexStart = 10 * pxPerMIL;
    const duplexLen = 300;
    elements.push(this.createHighContrastLine(center - duplexStart - duplexLen, center, center - duplexStart, center, color, 5));
    elements.push(this.createHighContrastLine(center + duplexStart, center, center + duplexStart + duplexLen, center, color, 5));
    elements.push(this.createHighContrastLine(center, center - duplexStart - duplexLen, center, center - duplexStart, color, 5));
    elements.push(this.createHighContrastLine(center, center + duplexStart, center, center + duplexStart + duplexLen, color, 5));

    // Fine Crosshair lines
    elements.push(this.createHighContrastLine(center - 10 * pxPerMIL, center, center + 10 * pxPerMIL, center, color, 1.8));
    elements.push(this.createHighContrastLine(center, center - 10 * pxPerMIL, center, center + 10 * pxPerMIL, color, 1.8));

    // Center Dot
    elements.push(this.createHighContrastCircle(center, center, 2.0, color));

    // 1 MIL Dots & 0.5 MIL Hashes along axes
    for (let i = 1; i <= maxMIL; i++) {
      const dist = i * pxPerMIL;
      const dotRadius = 3.0;
      const hashHalf = 4.5;

      // 0.5 MIL hashes
      const halfDist = (i - 0.5) * pxPerMIL;
      elements.push(this.createHighContrastLine(center - halfDist, center - hashHalf, center - halfDist, center + hashHalf, color, 1.4));
      elements.push(this.createHighContrastLine(center + halfDist, center - hashHalf, center + halfDist, center + hashHalf, color, 1.4));
      elements.push(this.createHighContrastLine(center - hashHalf, center - halfDist, center + hashHalf, center - halfDist, color, 1.4));
      elements.push(this.createHighContrastLine(center - hashHalf, center + halfDist, center + hashHalf, center + halfDist, color, 1.4));

      // 1 MIL Dots
      elements.push(this.createHighContrastCircle(center - dist, center, dotRadius, color));
      elements.push(this.createHighContrastCircle(center + dist, center, dotRadius, color));
      elements.push(this.createHighContrastCircle(center, center - dist, dotRadius, color));
      elements.push(this.createHighContrastCircle(center, center + dist, dotRadius, color));

      // Numeric labels every 2 MILs
      if (i % 2 === 0 && i <= 10) {
        elements.push(this.createHighContrastText(center - dist, center - 12, `${i}`, color, 11));
        elements.push(this.createHighContrastText(center + dist, center - 12, `${i}`, color, 11));
        elements.push(this.createHighContrastText(center + 14, center + dist + 4, `${i}`, color, 11, "start"));
        elements.push(this.createHighContrastText(center + 14, center - dist + 4, `${i}`, color, 11, "start"));
      }
    }

    return elements.join('');
  }

  generateChristmasTreeSVG(center, pxPerMIL, color) {
    let elements = [];
    const maxMIL = 10;

    // Main Axes
    elements.push(this.createHighContrastLine(center - 12 * pxPerMIL, center, center + 12 * pxPerMIL, center, color, 2.0));
    elements.push(this.createHighContrastLine(center, center - 10 * pxPerMIL, center, center + 12 * pxPerMIL, color, 2.0));

    // Center floating dot
    elements.push(this.createHighContrastCircle(center, center, 2.2, color));

    // Horizontal & Vertical Hash marks
    for (let i = 1; i <= maxMIL; i++) {
      const dist = i * pxPerMIL;
      const isFive = i % 5 === 0;
      const tickH = isFive ? 10 : 5;

      // 0.5 MIL Hashes
      const halfD = (i - 0.5) * pxPerMIL;
      elements.push(this.createHighContrastLine(center - halfD, center - 3, center - halfD, center + 3, color, 1.2));
      elements.push(this.createHighContrastLine(center + halfD, center - 3, center + halfD, center + 3, color, 1.2));

      // Full MIL Hashes
      elements.push(this.createHighContrastLine(center - dist, center - tickH, center - dist, center + tickH, color, 1.6));
      elements.push(this.createHighContrastLine(center + dist, center - tickH, center + dist, center + tickH, color, 1.6));
      elements.push(this.createHighContrastLine(center - tickH, center - dist, center + tickH, center - dist, color, 1.6));

      // Numeric MIL labels on horizontal axis
      elements.push(this.createHighContrastText(center - dist, center - 14, `${i}`, color, 11));
      elements.push(this.createHighContrastText(center + dist, center - 14, `${i}`, color, 11));

      // Christmas Tree Windage Hold dots & crosses below center
      const dropY = center + dist;
      const windageMILs = i * 1.0; // expanding tree width
      for (let w = 1; w <= windageMILs; w++) {
        const windX = w * pxPerMIL;
        if (w % 2 === 0) {
          elements.push(this.createHighContrastLine(center - windX - 3, dropY, center - windX + 3, dropY, color, 1.4));
          elements.push(this.createHighContrastLine(center - windX, dropY - 3, center - windX, dropY + 3, color, 1.4));
          elements.push(this.createHighContrastLine(center + windX - 3, dropY, center + windX + 3, dropY, color, 1.4));
          elements.push(this.createHighContrastLine(center + windX, dropY - 3, center + windX, dropY + 3, color, 1.4));
        } else {
          elements.push(this.createHighContrastCircle(center - windX, dropY, 2.2, color));
          elements.push(this.createHighContrastCircle(center + windX, dropY, 2.2, color));
        }
      }

      // Vertical Drop MIL numbers
      if (i % 2 === 0) {
        elements.push(this.createHighContrastText(center - 16, dropY + 4, `${i}`, color, 11, "end"));
      }
    }

    return elements.join('');
  }

  generateTremorStyleSVG(center, pxPerMIL, color) {
    let elements = [];
    // Main crosshair axes
    elements.push(this.createHighContrastLine(center - 12 * pxPerMIL, center, center + 12 * pxPerMIL, center, color, 1.8));
    elements.push(this.createHighContrastLine(center, center - 10 * pxPerMIL, center, center + 12 * pxPerMIL, color, 1.8));
    elements.push(this.createHighContrastCircle(center, center, 2.2, color));

    // Fine 0.2 MIL tick marks near center (within 3 MILs)
    // Integer loop: accumulating 0.2 in floating point stopped at 2.8 and dropped
    // the 3.0 MIL tick and label (audit BUG-008).
    for (let k = 1; k <= 15; k++) {
      const sub = k / 5;
      const d = sub * pxPerMIL;
      const isWhole = k % 5 === 0;
      const isHalf = k % 5 !== 0 && (k * 2) % 5 === 0;
      const h = isWhole ? 8 : (isHalf ? 5.5 : 3.0);
      const w = isWhole ? 1.6 : (isHalf ? 1.4 : 1.0);

      elements.push(this.createHighContrastLine(center - d, center - h, center - d, center + h, color, w));
      elements.push(this.createHighContrastLine(center + d, center - h, center + d, center + h, color, w));
      elements.push(this.createHighContrastLine(center - h, center - d, center + h, center - d, color, w));

      if (isWhole) {
        const val = Math.round(sub);
        elements.push(this.createHighContrastText(center - d, center - 12, `${val}`, color, 10));
        elements.push(this.createHighContrastText(center + d, center - 12, `${val}`, color, 10));
      }
    }

    // Moving Target Milling Brackets & Rapid Wind Hold Dots
    for (let drop = 1; drop <= 8; drop++) {
      const y = center + drop * pxPerMIL;

      // Drop Line Hashes
      elements.push(this.createHighContrastLine(center - 4, y, center + 4, y, color, 1.6));
      elements.push(this.createHighContrastText(center - 14, y + 4, `${drop}`, color, 10, "end"));

      // Chevron & Speed Dots for 4mph, 8mph, 12mph wind holds
      for (let wind = 1; wind <= drop * 1.2; wind++) {
        const x = wind * pxPerMIL;
        elements.push(this.createHighContrastCircle(center - x, y, 2.2, color));
        elements.push(this.createHighContrastCircle(center + x, y, 2.2, color));
      }
    }

    return elements.join('');
  }

  generateMRADGridSVG(center, pxPerMIL, color) {
    let elements = [];
    // Clean MRAD Grid
    elements.push(this.createHighContrastLine(center - 14 * pxPerMIL, center, center + 14 * pxPerMIL, center, color, 2.0));
    elements.push(this.createHighContrastLine(center, center - 14 * pxPerMIL, center, center + 14 * pxPerMIL, color, 2.0));
    elements.push(this.createHighContrastCircle(center, center, 2.5, color));

    for (let i = 1; i <= 12; i++) {
      const d = i * pxPerMIL;
      const isEven = i % 2 === 0;
      const tickH = isEven ? 8 : 4.5;

      // 0.5 MRAD intermediate tick marks
      const halfD = (i - 0.5) * pxPerMIL;
      elements.push(this.createHighContrastLine(center - halfD, center - 2.5, center - halfD, center + 2.5, color, 1.2));
      elements.push(this.createHighContrastLine(center + halfD, center - 2.5, center + halfD, center + 2.5, color, 1.2));
      elements.push(this.createHighContrastLine(center - 2.5, center - halfD, center + 2.5, center - halfD, color, 1.2));
      elements.push(this.createHighContrastLine(center - 2.5, center + halfD, center + 2.5, center + halfD, color, 1.2));

      // 1 MRAD ticks
      elements.push(this.createHighContrastLine(center - d, center - tickH, center - d, center + tickH, color, 1.6));
      elements.push(this.createHighContrastLine(center + d, center - tickH, center + d, center + tickH, color, 1.6));
      elements.push(this.createHighContrastLine(center - tickH, center - d, center + tickH, center - d, color, 1.6));
      elements.push(this.createHighContrastLine(center - tickH, center + d, center + tickH, center + d, color, 1.6));

      if (isEven) {
        elements.push(this.createHighContrastText(center - d, center + 18, `${i}`, color, 11));
        elements.push(this.createHighContrastText(center + d, center + 18, `${i}`, color, 11));
        elements.push(this.createHighContrastText(center + 16, center - d + 4, `${i}`, color, 11, "start"));
        elements.push(this.createHighContrastText(center + 16, center + d + 4, `${i}`, color, 11, "start"));
      }
    }
    return elements.join('');
  }

  generateDuplexBDCSVG(center, pxPerMIL, color) {
    let elements = [];

    // Heavy Duplex outer bars
    const innerGap = 4 * pxPerMIL;
    const outerLen = 350;
    elements.push(this.createHighContrastLine(center - innerGap - outerLen, center, center - innerGap, center, color, 7));
    elements.push(this.createHighContrastLine(center + innerGap, center, center + innerGap + outerLen, center, color, 7));
    elements.push(this.createHighContrastLine(center, center - innerGap - outerLen, center, center - innerGap, color, 7));
    elements.push(this.createHighContrastLine(center, center + 10 * pxPerMIL, center, center + 10 * pxPerMIL + outerLen, color, 7));

    // Fine center crosshair
    elements.push(this.createHighContrastLine(center - innerGap, center, center + innerGap, center, color, 1.6));
    elements.push(this.createHighContrastLine(center, center - innerGap, center, center + 10 * pxPerMIL, color, 1.6));
    elements.push(this.createHighContrastCircle(center, center, 2.0, color));

    // BDC Holdover Bars below center (100m - 600m markers)
    const bdcDrops = [
      { mil: 0.3, label: "100m", width: 3 },
      { mil: 1.5, label: "200m", width: 4 },
      { mil: 3.2, label: "300m", width: 6 },
      { mil: 5.2, label: "400m", width: 8 },
      { mil: 7.5, label: "500m", width: 10 },
      { mil: 10.0, label: "600m", width: 12 }
    ];

    bdcDrops.forEach(b => {
      const y = center + b.mil * pxPerMIL;
      const halfW = (b.width * pxPerMIL) / 2;
      elements.push(this.createHighContrastLine(center - halfW, y, center + halfW, y, color, 2.2));
      elements.push(this.createHighContrastText(center + halfW + 12, y + 4, b.label, color, 10, "start"));
    });

    return elements.join('');
  }

  generateGerman4SVG(center, pxPerMIL, color) {
    let elements = [];
    // 2.5 MIL (not the wider 3.5 originally used here): the heavy posts are this
    // reticle's whole visual identity, and since the viewport only shows ~19.2/zoom
    // MILs from center, a wider gap pushed them out of view for all but the lowest
    // zoom presets. 2.5 MIL keeps them visible across a wider practical zoom range.
    const innerGap = 2.5 * pxPerMIL;
    const outerLen = 400;

    // German #4 Extra Heavy Posts (Left, Right, Bottom)
    elements.push(this.createHighContrastLine(center - innerGap - outerLen, center, center - innerGap, center, color, 10));
    elements.push(this.createHighContrastLine(center + innerGap, center, center + innerGap + outerLen, center, color, 10));
    elements.push(this.createHighContrastLine(center, center + innerGap, center, center + innerGap + outerLen, color, 10));

    // Thin top vertical post & fine center crosshair
    elements.push(this.createHighContrastLine(center, center - outerLen, center, center - innerGap, color, 1.8));
    elements.push(this.createHighContrastLine(center - innerGap, center, center + innerGap, center, color, 1.8));
    elements.push(this.createHighContrastLine(center, center - innerGap, center, center + innerGap, color, 1.8));

    // Center precision dot
    elements.push(this.createHighContrastCircle(center, center, 2.2, color));

    // 1 MIL tick marks inside central aperture
    for (let i = 1; i <= 3; i++) {
      const d = i * pxPerMIL;
      elements.push(this.createHighContrastLine(center - d, center - 3, center - d, center + 3, color, 1.4));
      elements.push(this.createHighContrastLine(center + d, center - 3, center + d, center + 3, color, 1.4));
      elements.push(this.createHighContrastLine(center - 3, center - d, center + 3, center - d, color, 1.4));
    }

    return elements.join('');
  }

  generateCircleDotSVG(center, pxPerMIL, color) {
    let elements = [];

    // Outer 65 MOA / ~18 MIL speed horseshoe (Radius ~ 9 MILs), drawn as a true open
    // arc (not a full circle masked by an opaque line) so the gap actually reveals
    // the environment behind it instead of painting a black bar over it.
    const radius = 9 * pxPerMIL;
    const gapAngle = 40 * (Math.PI / 180);
    const arcStart = -Math.PI / 2 + gapAngle / 2; // just past the gap, sweeping clockwise
    const arcEnd = -Math.PI / 2 - gapAngle / 2 + 2 * Math.PI; // back around to just before the gap
    const sx = center + radius * Math.cos(arcStart);
    const sy = center + radius * Math.sin(arcStart);
    const ex = center + radius * Math.cos(arcEnd);
    const ey = center + radius * Math.sin(arcEnd);
    const horseshoePath = `M ${sx} ${sy} A ${radius} ${radius} 0 1 1 ${ex} ${ey}`;
    elements.push(`
      <path d="${horseshoePath}" fill="none" stroke="#000000" stroke-width="4.5" stroke-linecap="round"/>
      <path d="${horseshoePath}" fill="none" stroke="${color}" stroke-width="2.8" stroke-linecap="round"/>
    `);

    // Center illuminated 0.2 MIL dot
    elements.push(this.createHighContrastCircle(center, center, 2.5, color));

    // 1 MIL Stadia line ticks below horseshoe
    for (let i = 1; i <= 10; i++) {
      const d = i * pxPerMIL;
      const tickW = (i % 2 === 0) ? 6 : 3.5;
      elements.push(this.createHighContrastLine(center - d, center - 3, center - d, center + 3, color, 1.4));
      elements.push(this.createHighContrastLine(center + d, center - 3, center + d, center + 3, color, 1.4));
      elements.push(this.createHighContrastLine(center - tickW, center + d, center + tickW, center + d, color, 1.4));

      if (i % 2 === 0) {
        elements.push(this.createHighContrastText(center + tickW + 10, center + d + 4, `${i}`, color, 10, "start"));
      }
    }

    return elements.join('');
  }

  generateCrosshairSVG(center, pxPerMIL, color) {
    let elements = [];
    elements.push(this.createHighContrastLine(center - 16 * pxPerMIL, center, center + 16 * pxPerMIL, center, color, 1.4));
    elements.push(this.createHighContrastLine(center, center - 16 * pxPerMIL, center, center + 16 * pxPerMIL, color, 1.4));
    elements.push(this.createHighContrastCircle(center, center, 1.8, color));

    // 1 MIL fine tick marks
    for (let i = 1; i <= 15; i++) {
      const d = i * pxPerMIL;
      const h = (i % 5 === 0) ? 6 : 3;
      elements.push(this.createHighContrastLine(center - d, center - h, center - d, center + h, color, 1.2));
      elements.push(this.createHighContrastLine(center + d, center - h, center + d, center + h, color, 1.2));
      elements.push(this.createHighContrastLine(center - h, center - d, center + h, center - d, color, 1.2));
      elements.push(this.createHighContrastLine(center - h, center + d, center + h, center + d, color, 1.2));
    }

    return elements.join('');
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
