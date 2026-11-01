/* ==========================================================================
   Virtual First Focal Plane (FFP) Scope Engine
   Handles Canvas background/target, SVG vector reticle scaling, pan & zoom.
   ========================================================================== */

import { renderTargetSVGString, isSafeImageDataURI, sfx } from './utils.js';

/** Real-world-ish scope profiles for realistic optics mode (FEAT-001). */
export const SCOPE_PROFILES = {
  arcade: { label: 'Arcade (1–25x, enlarged)', minZoom: 1, maxZoom: 25 },
  lpvo: { label: 'LPVO 1–10x', minZoom: 1, maxZoom: 10 },
  hunting: { label: 'Hunting 3–18x', minZoom: 3, maxZoom: 18 },
  precision: { label: 'Precision 5–25x', minZoom: 5, maxZoom: 25 }
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
    this.opticsMode = 'arcade';
    this.scopeProfile = 'arcade';
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
    this.targetOffsetMILY = scenario.offsetY || 0;
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
      this.hudElement.textContent = `${this.zoom.toFixed(1)}X MAG`;
    }
    this.updateZoomButtonsUI();
    this.requestRender({ reticle: true });
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

    // 1. Environmental background
    this.renderBackground(width, height);

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
      const shadowRy = Math.max(1, targetPxHeight * 0.05);
      this.ctx.fillStyle = 'rgba(0,0,0,0.28)';
      this.ctx.beginPath();
      this.ctx.ellipse(
        screenTargetX + targetPxWidth / 2,
        screenTargetY + targetPxHeight + shadowRy + 1,
        targetPxWidth / 2, shadowRy,
        0, 0, Math.PI * 2
      );
      this.ctx.fill();

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

    // 3. Environmental overlays (Fog / Rain)
    this.renderWeatherOverlay(width, height);
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
   * The landscape lives in the same angular (MIL) space as the target: panning the
   * scope shifts the whole view by the same angle and magnification scales it all
   * together, so the target stays planted on its ground instead of sliding over a
   * static backdrop (audit UI-008). Scenery is authored in "scene units" where
   * 18 units = 1 MIL, i.e. its original 1x arcade pixel size.
   */
  computeSceneTransform(w, h) {
    const ppm = this.pxPerMILAt();
    const k = ppm / 18; // screen px per scene unit
    const cx = w / 2;
    const cy = h / 2;
    let baseMIL = 0; // vertical MIL position of the ground line (the target's base)
    if (this.target) {
      const milH = (this.target.height * 1000) / this.distance;
      baseMIL = this.targetOffsetMILY - milH / 2;
    }
    const groundY = cy - (baseMIL - this.panY) * ppm;
    const panU = this.panX * 18;
    return {
      k,
      groundY,
      x: (u) => cx + (u - panU) * k,
      // visible scene-unit range, padded
      uMin: panU - (cx / k) - 60,
      uMax: panU + (cx / k) + 60
    };
  }

  renderBackground(w, h) {
    const ctx = this.ctx;
    let grad;
    const scene = this.scene = this.computeSceneTransform(w, h);
    // Sky/ground gradient follows the ground line vertically (the sky itself has no
    // features, so it doesn't need to scale with magnification).
    const g0 = scene.groundY - h * 0.55;
    const g1 = scene.groundY + h * 0.45;

    switch (this.environment) {
      case 'snow':
        grad = ctx.createLinearGradient(0, g0, 0, g1);
        grad.addColorStop(0, '#c4d7e6');
        grad.addColorStop(0.5, '#e8f1f5');
        grad.addColorStop(1, '#a8b9cc');
        break;

      case 'desert':
        grad = ctx.createLinearGradient(0, g0, 0, g1);
        grad.addColorStop(0, '#e5be90');
        grad.addColorStop(0.5, '#c99e69');
        grad.addColorStop(1, '#8f6838');
        break;

      case 'mountain':
        grad = ctx.createLinearGradient(0, g0, 0, g1);
        grad.addColorStop(0, '#4a6572');
        grad.addColorStop(0.6, '#344955');
        grad.addColorStop(1, '#1d2731');
        break;

      case 'urban':
        grad = ctx.createLinearGradient(0, g0, 0, g1);
        grad.addColorStop(0, '#4f5b66');
        grad.addColorStop(0.5, '#353d42');
        grad.addColorStop(1, '#1c2226');
        break;

      case 'dusk':
        grad = ctx.createLinearGradient(0, g0, 0, g1);
        grad.addColorStop(0, '#4a2545');
        grad.addColorStop(0.4, '#994636');
        grad.addColorStop(1, '#2d1829');
        break;

      case 'field':
        grad = ctx.createLinearGradient(0, g0, 0, g1);
        grad.addColorStop(0, '#a9c47a');
        grad.addColorStop(0.5, '#7fa350');
        grad.addColorStop(1, '#4c6b2e');
        break;

      case 'range':
        grad = ctx.createLinearGradient(0, g0, 0, g1);
        grad.addColorStop(0, '#b0ac9c');
        grad.addColorStop(0.5, '#8d8874');
        grad.addColorStop(1, '#5c5847');
        break;

      case 'fog':
        grad = ctx.createLinearGradient(0, g0, 0, g1);
        grad.addColorStop(0, '#c7cfd2');
        grad.addColorStop(0.5, '#aab4b8');
        grad.addColorStop(1, '#8b969a');
        break;

      case 'rain':
        grad = ctx.createLinearGradient(0, g0, 0, g1);
        grad.addColorStop(0, '#3d4a56');
        grad.addColorStop(0.5, '#2b3540');
        grad.addColorStop(1, '#171d24');
        break;

      case 'forest':
      default:
        grad = ctx.createLinearGradient(0, g0, 0, g1);
        grad.addColorStop(0, '#668265');
        grad.addColorStop(0.5, '#40523e');
        grad.addColorStop(1, '#233022');
        break;
    }

    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // Ground below the ground line, anchored to the target's base.
    const horizonY = scene.groundY;
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    if (horizonY < h) ctx.fillRect(0, Math.max(0, horizonY), w, h - Math.max(0, horizonY));

    ctx.strokeStyle = 'rgba(0,0,0,0.2)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, horizonY);
    ctx.lineTo(w, horizonY);
    ctx.stroke();

    this.renderEnvironmentDetail(w, h, horizonY);
  }

  /**
   * Simple procedural detail (tree lines, ridgelines, a skyline, etc.) so each
   * environment reads as more than a flat gradient. Kept at/below the horizon
   * line so it doesn't compete with the reticle or target for attention.
   */
  renderEnvironmentDetail(w, h, horizonY) {
    switch (this.environment) {
      case 'forest':
        this.drawTreeLine(w, horizonY, 9, '#151f13', 1.0, 40, 62);
        this.drawTreeLine(w, horizonY, 14, '#1c2818', 0.9, 26, 42);
        break;

      case 'field':
        this.drawTreeLine(w, horizonY, 7, '#3a4a2e', 0.45, 26, 40);
        this.drawFenceLine(w, horizonY);
        break;

      case 'snow':
        this.drawTreeLine(w, horizonY, 10, '#26352a', 0.6, 24, 42);
        this.drawSnowfall(w, h);
        break;

      case 'mountain':
        this.drawRidgeline(w, horizonY, '#26333c', 0.85, 0.32, 1);
        this.drawRidgeline(w, horizonY, '#18232b', 0.55, 0.55, 2);
        break;

      case 'desert':
        this.drawRidgeline(w, horizonY, '#a9814f', 0.4, 0.35, 3);
        this.drawScrub(w, horizonY);
        break;

      case 'urban':
        this.drawSkyline(w, horizonY);
        break;

      case 'range':
        this.drawRangeBerm(w, horizonY);
        break;

      case 'fog':
        this.drawTreeLine(w, horizonY, 10, 'rgba(60,70,68,0.5)', 1.0, 28, 44);
        break;

      case 'rain':
        this.drawTreeLine(w, horizonY, 11, '#10160f', 0.85, 26, 40);
        break;

      case 'dusk':
        this.drawSunGlow(w, horizonY);
        this.drawRidgeline(w, horizonY, '#1a1224', 0.5, 0.32, 4);
        break;
    }
  }

  /** Deterministic pseudo-random in [0,1) — stable across repeated render() calls
   *  (panning/zooming) so environment detail doesn't reshuffle/flicker every frame. */
  detailSeed(i, salt = 0) {
    const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
    return x - Math.floor(x);
  }

  /** Indices of repeating scenery items with spacing `spacingU` that are on screen. */
  visibleIndices(spacingU) {
    const { uMin, uMax } = this.scene;
    const first = Math.floor(uMin / spacingU) - 1;
    const last = Math.ceil(uMax / spacingU) + 1;
    const out = [];
    for (let i = first; i <= last && out.length < 4000; i++) out.push(i);
    return out;
  }

  drawTreeLine(w, horizonY, count, color, alpha, minH, maxH) {
    const ctx = this.ctx;
    const { k, x } = this.scene;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    const spacing = 700 / count; // scene units
    for (const i of this.visibleIndices(spacing)) {
      const seed = this.detailSeed(i, count);
      const treeH = (minH + seed * (maxH - minH)) * k;
      const treeW = treeH * 0.5;
      const cx = x(spacing * (i + 0.5) + (seed - 0.5) * spacing * 0.5);
      if (cx + treeW < 0 || cx - treeW > w) continue;
      const baseY = horizonY + 3 * k;
      // Layered pine silhouette: three stacked tiers + a flat base.
      ctx.beginPath();
      ctx.moveTo(cx, baseY - treeH);
      ctx.lineTo(cx - treeW * 0.35, baseY - treeH * 0.62);
      ctx.lineTo(cx - treeW * 0.18, baseY - treeH * 0.62);
      ctx.lineTo(cx - treeW * 0.48, baseY - treeH * 0.3);
      ctx.lineTo(cx - treeW * 0.22, baseY - treeH * 0.3);
      ctx.lineTo(cx - treeW * 0.5, baseY);
      ctx.lineTo(cx + treeW * 0.5, baseY);
      ctx.lineTo(cx + treeW * 0.22, baseY - treeH * 0.3);
      ctx.lineTo(cx + treeW * 0.48, baseY - treeH * 0.3);
      ctx.lineTo(cx + treeW * 0.18, baseY - treeH * 0.62);
      ctx.lineTo(cx + treeW * 0.35, baseY - treeH * 0.62);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  drawRidgeline(w, horizonY, color, alpha, heightFactor, salt) {
    const ctx = this.ctx;
    const { k, x } = this.scene;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    const spacing = 700 / 6;
    const maxPeakH = 385 * heightFactor * k;
    const idx = this.visibleIndices(spacing);
    ctx.beginPath();
    ctx.moveTo(x(idx[0] * spacing), horizonY);
    for (const i of idx) {
      const seed = this.detailSeed(i, salt);
      ctx.lineTo(x(i * spacing), horizonY - maxPeakH * (0.35 + seed * 0.65));
    }
    ctx.lineTo(x(idx[idx.length - 1] * spacing), horizonY);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  drawSkyline(w, horizonY) {
    const ctx = this.ctx;
    const { k, x } = this.scene;
    ctx.save();
    const spacing = 700 / 12;
    for (const i of this.visibleIndices(spacing)) {
      const seed = this.detailSeed(i, 9);
      const bH = (20 + seed * 55) * k;
      const bW = spacing * 0.7 * k;
      const bx = x(spacing * i + spacing * 0.15);
      if (bx + bW < 0 || bx > w) continue;
      const y = horizonY - bH;
      ctx.fillStyle = '#12161a';
      ctx.fillRect(bx, y, bW, bH + 4 * k);
      ctx.fillStyle = 'rgba(255, 200, 120, 0.5)';
      // Window grid in scene units so it scales with the building.
      for (let wy = 6; wy < bH / k - 4; wy += 8) {
        for (let wx = 4; wx < bW / k - 4; wx += 7) {
          if (Math.abs(Math.sin((i * 97 + wx) * 12.9 + wy * 78.2)) > 0.55) {
            ctx.fillRect(bx + wx * k, y + wy * k, 2 * k, 3 * k);
          }
        }
      }
    }
    ctx.restore();
  }

  drawFenceLine(w, horizonY) {
    const ctx = this.ctx;
    const { k, x } = this.scene;
    ctx.save();
    ctx.strokeStyle = 'rgba(40,35,25,0.5)';
    ctx.lineWidth = Math.max(1, 1.5 * k);
    const postSpacing = 22;
    const postH = 10 * k;
    ctx.beginPath();
    ctx.moveTo(0, horizonY - postH * 0.6);
    ctx.lineTo(w, horizonY - postH * 0.6);
    ctx.stroke();
    for (const i of this.visibleIndices(postSpacing)) {
      const px = x(i * postSpacing);
      if (px < -5 || px > w + 5) continue;
      ctx.beginPath();
      ctx.moveTo(px, horizonY - postH);
      ctx.lineTo(px, horizonY + 2 * k);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawScrub(w, horizonY) {
    const ctx = this.ctx;
    const { k, x } = this.scene;
    ctx.save();
    ctx.strokeStyle = 'rgba(70, 55, 30, 0.6)';
    ctx.lineWidth = Math.max(1, 2 * k);
    ctx.lineCap = 'round';
    const spacing = 700 / 8;
    for (const i of this.visibleIndices(spacing)) {
      const seed = this.detailSeed(i, 5);
      const sx = x(spacing * i + seed * spacing);
      const baseY = horizonY + (4 + seed * 6) * k;
      const armH = (6 + seed * 6) * k;
      if (sx + armH < 0 || sx - armH > w) continue;
      ctx.beginPath();
      ctx.moveTo(sx, baseY);
      ctx.lineTo(sx, baseY - armH * 1.6);
      ctx.moveTo(sx, baseY - armH * 0.9);
      ctx.lineTo(sx - armH * 0.5, baseY - armH * 0.9);
      ctx.lineTo(sx - armH * 0.5, baseY - armH * 1.4);
      ctx.moveTo(sx, baseY - armH * 1.1);
      ctx.lineTo(sx + armH * 0.5, baseY - armH * 1.1);
      ctx.lineTo(sx + armH * 0.5, baseY - armH * 1.6);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawRangeBerm(w, horizonY) {
    const ctx = this.ctx;
    const { k, x } = this.scene;
    ctx.save();
    const bermH = 34 * k;
    const grad = ctx.createLinearGradient(0, horizonY - bermH, 0, horizonY + 6 * k);
    grad.addColorStop(0, '#8a7f65');
    grad.addColorStop(1, '#5c5340');
    ctx.fillStyle = grad;
    const spacing = 700; // one berm arc per 700 scene units
    for (const i of this.visibleIndices(spacing)) {
      const x0 = x(i * spacing - spacing / 2);
      const x1 = x(i * spacing + spacing / 2);
      if (x1 < 0 || x0 > w) continue;
      ctx.beginPath();
      ctx.moveTo(x0, horizonY + 6 * k);
      ctx.quadraticCurveTo((x0 + x1) / 2, horizonY - bermH, x1, horizonY + 6 * k);
      ctx.lineTo(x1, horizonY + 20 * k);
      ctx.lineTo(x0, horizonY + 20 * k);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  drawSnowfall(w, h) {
    // Falling snow is near the shooter, so it stays in screen space.
    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    for (let i = 0; i < 40; i++) {
      const seedX = this.detailSeed(i, 1);
      const seedY = this.detailSeed(i, 2);
      const r = 1 + (seedX * seedY) * 1.5;
      ctx.beginPath();
      ctx.arc(seedX * w, seedY * h, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  drawSunGlow(w, horizonY) {
    const ctx = this.ctx;
    const { k, x } = this.scene;
    ctx.save();
    const sunX = x(152);
    const sunY = horizonY - 8 * k;
    const R = 70 * k;
    if (sunX + R < 0 || sunX - R > w) { ctx.restore(); return; }
    const grad = ctx.createRadialGradient(sunX, sunY, 2 * k, sunX, sunY, R);
    grad.addColorStop(0, 'rgba(255, 190, 120, 0.9)');
    grad.addColorStop(1, 'rgba(255, 140, 60, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(sunX, sunY, R, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 225, 180, 0.95)';
    ctx.beginPath();
    ctx.arc(sunX, sunY, 10 * k, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  renderWeatherOverlay(w, h) {
    const ctx = this.ctx;
    if (this.environment === 'fog') {
      ctx.fillStyle = 'rgba(210, 220, 225, 0.45)';
      ctx.fillRect(0, 0, w, h);
    } else if (this.environment === 'rain') {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i < 40; i++) {
        const rx = (i * 37) % w;
        const ry = (i * 59) % h;
        ctx.moveTo(rx, ry);
        ctx.lineTo(rx - 4, ry + 16);
      }
      ctx.stroke();
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
