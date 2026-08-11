/* ==========================================================================
   Virtual First Focal Plane (FFP) Scope Engine
   Handles Canvas background/target, SVG vector reticle scaling, pan & zoom.
   ========================================================================== */

import { renderTargetSVGString, isSafeImageDataURI, sfx } from './utils.js';

export class ScopeEngine {
  constructor(canvasId, svgId, hudId) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas ? this.canvas.getContext('2d') : null;
    this.svgContainer = document.getElementById(svgId);
    this.hudElement = document.getElementById(hudId);

    // Magnification & Optics parameters. Starts at the true 1x baseline (the
    // "pixels per MIL at 1x" unit basePixelsPerMIL is defined against) — this also
    // gives a freshly-opened reticle the most room to show its wide-angle features
    // (tree grid / BDC ladder / duplex posts) before zooming in for precision work.
    this.zoom = 1; // Current magnification
    this.minZoom = 1;
    this.maxZoom = 25;
    this.basePixelsPerMIL = 18; // Base pixels spanned by 1 MIL at 1x magnification

    // Viewport Panning offsets (in MIL units to maintain position across zoom)
    this.panX = 0; // MIL offset
    this.panY = 0; // MIL offset

    // Active Scenario State
    this.target = null;
    this.distance = 300; // meters
    this.targetOffsetMILX = 0; // Target horizontal placement in MILs relative to reticle center
    this.targetOffsetMILY = 0; // Target vertical placement in MILs relative to reticle center
    this.environment = 'field'; // forest, field, snow, mountain, desert, urban, range, fog, rain, dusk

    // Display / Reticle Settings
    this.reticleType = 'mil_dot';
    this.reticleColor = '#ff2a2a';
    this.reticleBrightness = 1.0;
    this.zoomSensitivity = 1.0;
    this.panSensitivity = 1.0;

    // Pointer & Drag interaction tracking
    this.isDragging = false;
    this.lastPointerX = 0;
    this.lastPointerY = 0;
    this.pinchDistance = 0;

    // Cache pre-rendered target image/canvas for high performance
    this.targetOffscreenCanvas = document.createElement('canvas');

    this.bindEvents();
  }

  init() {
    this.resizeCanvas();
    // Sync the HUD magnification badge and zoom-button highlighting to the actual
    // JS-side zoom state (index.html's "10.0X MAG" / active-button markup are just
    // static placeholders and were never otherwise reconciled with this.zoom).
    this.setZoom(this.zoom);
    window.addEventListener('resize', () => {
      this.resizeCanvas();
      this.render();
    });
  }

  resizeCanvas() {
    if (!this.canvas) return;
    const rect = this.canvas.parentElement.getBoundingClientRect();
    const size = Math.floor(Math.min(rect.width, rect.height));
    if (size <= 0) return;

    this.canvas.width = size;
    this.canvas.height = size;
    this.canvasSize = size;
    // canvasSize just became valid (or changed) — the reticle SVG's viewBox/center
    // and all coordinates depend on it, so it must be redrawn whenever this changes.
    // Without this, the reticle can silently never render at all: every early call
    // to renderReticleSVG() during app init happens while the simulator tab is still
    // hidden (parent has zero size, so resizeCanvas no-ops above and canvasSize stays
    // undefined), and nothing else re-triggers it once the tab becomes visible.
    this.renderReticleSVG();
  }

  updateSettings(settings) {
    if (settings.reticle) {
      this.reticleType = settings.reticle;
      // Every reticle change (settings save, simulator quick-switch, "Select in
      // Simulator" from Learn) flows through here, but neither <select> ever had
      // its .value synced to match — they default to showing whichever option is
      // first in the list (MIL Dot) regardless of what's actually rendering or
      // saved, which reads as "the wrong reticle got chosen."
      const simSelect = document.getElementById('sim-reticle-select');
      if (simSelect) simSelect.value = settings.reticle;
      const settingsSelect = document.querySelector('select[name="reticle-select"]');
      if (settingsSelect) settingsSelect.value = settings.reticle;
    }
    if (settings.reticleColor) this.reticleColor = settings.reticleColor;
    if (settings.reticleBrightness !== undefined) this.reticleBrightness = settings.reticleBrightness;
    if (settings.zoomSensitivity !== undefined) this.zoomSensitivity = settings.zoomSensitivity;
    if (settings.panSensitivity !== undefined) this.panSensitivity = settings.panSensitivity;

    this.renderReticleSVG();
    this.render();
  }

  setScenario(scenario) {
    this.target = scenario.target;
    this.distance = scenario.distance;
    this.targetOffsetMILX = scenario.offsetX || 0;
    this.targetOffsetMILY = scenario.offsetY || 0;
    this.environment = scenario.environment || 'field';

    // Center view near target
    this.panX = this.targetOffsetMILX;
    this.panY = this.targetOffsetMILY;

    this.prepareTargetOffscreen();
    this.renderReticleSVG();
    this.render();
  }

  setZoom(zoomLevel) {
    this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, zoomLevel));
    if (this.hudElement) {
      this.hudElement.textContent = `${this.zoom.toFixed(1)}X MAG`;
    }
    this.updateZoomButtonsUI();
    this.renderReticleSVG();
    this.render();
  }

  updateZoomButtonsUI() {
    document.querySelectorAll('.btn-zoom-step').forEach(btn => {
      const val = parseFloat(btn.dataset.zoom);
      if (Math.abs(val - this.zoom) < 0.2) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
  }

  resetView() {
    this.panX = this.targetOffsetMILX;
    this.panY = this.targetOffsetMILY;
    this.render();
    sfx.playClick();
  }

  centerTarget() {
    this.panX = this.targetOffsetMILX;
    this.panY = this.targetOffsetMILY;
    this.render();
    sfx.playClick();
  }

  panByPixels(dxPx, dyPx) {
    // Convert screen pixel delta to MIL delta at current zoom & sensitivity
    const pixelsPerMIL = this.basePixelsPerMIL * this.zoom;
    this.panX -= (dxPx / pixelsPerMIL) * this.panSensitivity;
    this.panY += (dyPx / pixelsPerMIL) * this.panSensitivity; // Invert canvas Y axis
    this.render();
  }

  /**
   * Pre-render high resolution target graphic to offscreen canvas.
   *
   * The offscreen canvas is rasterized at the target's true width:height ratio
   * (not a fixed square) so that render()'s final drawImage — which stretches this
   * to the real MIL-subtended pixel box — only ever applies ONE aspect-correct
   * scale. Rasterizing a square image and then non-uniformly stretching it to a
   * non-square box compounds whatever aspect ratio the shape itself was already
   * drawn at, which is what made elongated targets (e.g. the S-series) render
   * visibly squashed/over-elongated.
   */
  prepareTargetOffscreen() {
    if (!this.target) return;
    const ctx = this.targetOffscreenCanvas.getContext('2d');

    const aspect = (this.target.width && this.target.height) ? (this.target.width / this.target.height) : 1;
    const RES = 400;
    const offW = aspect >= 1 ? RES : Math.round(RES * aspect);
    const offH = aspect >= 1 ? Math.round(RES / aspect) : RES;
    this.targetOffscreenCanvas.width = offW;
    this.targetOffscreenCanvas.height = offH;
    this.targetOffscreenSize = { width: offW, height: offH };
    ctx.clearRect(0, 0, offW, offH);

    // Guard against a stale async load completing after a newer scenario has
    // already replaced this.target (e.g. rapid "Next Scenario" clicks).
    const requestedTarget = this.target;
    const drawAndRender = (img) => {
      if (this.target !== requestedTarget) return;
      ctx.clearRect(0, 0, offW, offH);
      ctx.drawImage(img, 0, 0, offW, offH);
      this.render();
    };

    const img = new Image();
    if (this.target.imageData && isSafeImageDataURI(this.target.imageData)) {
      // A real uploaded/drawn image data URI — load it directly. (The SVG-blob
      // path below only works for actual SVG markup; renderTargetSVGString
      // returns a bare <img> tag string for this case, which isn't valid SVG.)
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
   * Renders the Scope view canvas layer
   */
  render() {
    if (!this.ctx || !this.canvasSize) return;

    const width = this.canvasSize;
    const height = this.canvasSize;
    const centerX = width / 2;
    const centerY = height / 2;

    // 1. Draw Environmental Background
    this.renderBackground(width, height);

    // 2. Draw Target in FFP perspective
    if (this.target) {
      // 1 MIL screen pixel size at current magnification
      const pixelsPerMIL = this.basePixelsPerMIL * this.zoom;

      // Target real angular dimensions in MILs
      // MIL = Target Size (m) * 1000 / Distance (m)
      const targetMILHeight = (this.target.height * 1000) / this.distance;
      const targetMILWidth = (this.target.width * 1000) / this.distance;

      // Target size in screen pixels
      const targetPxHeight = targetMILHeight * pixelsPerMIL;
      const targetPxWidth = targetMILWidth * pixelsPerMIL;

      // Target position in screen coordinates relative to center
      // Reticle center is (centerX, centerY)
      // Pan offset moves view, so target position shifts inversely
      const relMILX = this.targetOffsetMILX - this.panX;
      const relMILY = this.targetOffsetMILY - this.panY;

      const screenTargetX = centerX + relMILX * pixelsPerMIL - targetPxWidth / 2;
      const screenTargetY = centerY - relMILY * pixelsPerMIL - targetPxHeight / 2;

      // Draw target offscreen canvas with smooth image scaling. Source rect uses
      // the offscreen canvas's own (aspect-correct) size, not a hardcoded square,
      // so this is a uniform scale to targetPxWidth/targetPxHeight — see
      // prepareTargetOffscreen() for why that matters.
      const offSize = this.targetOffscreenSize || { width: this.targetOffscreenCanvas.width, height: this.targetOffscreenCanvas.height };
      this.ctx.imageSmoothingEnabled = true;
      this.ctx.imageSmoothingQuality = 'high';
      this.ctx.drawImage(
        this.targetOffscreenCanvas,
        0, 0, offSize.width, offSize.height,
        screenTargetX, screenTargetY, targetPxWidth, targetPxHeight
      );

      // Simple target ground shadow
      this.ctx.fillStyle = 'rgba(0,0,0,0.3)';
      this.ctx.beginPath();
      this.ctx.ellipse(
        screenTargetX + targetPxWidth / 2,
        screenTargetY + targetPxHeight + 2,
        targetPxWidth / 2,
        targetPxHeight * 0.08,
        0, 0, Math.PI * 2
      );
      this.ctx.fill();
    }

    // 3. Environmental overlays (Fog / Rain / Mirage)
    this.renderWeatherOverlay(width, height);
  }

  renderBackground(w, h) {
    const ctx = this.ctx;
    let grad;

    switch (this.environment) {
      case 'snow':
        grad = ctx.createLinearGradient(0, 0, 0, h);
        grad.addColorStop(0, '#c4d7e6');
        grad.addColorStop(0.5, '#e8f1f5');
        grad.addColorStop(1, '#a8b9cc');
        break;

      case 'desert':
        grad = ctx.createLinearGradient(0, 0, 0, h);
        grad.addColorStop(0, '#e5be90');
        grad.addColorStop(0.5, '#c99e69');
        grad.addColorStop(1, '#8f6838');
        break;

      case 'mountain':
        grad = ctx.createLinearGradient(0, 0, 0, h);
        grad.addColorStop(0, '#4a6572');
        grad.addColorStop(0.6, '#344955');
        grad.addColorStop(1, '#1d2731');
        break;

      case 'urban':
        grad = ctx.createLinearGradient(0, 0, 0, h);
        grad.addColorStop(0, '#4f5b66');
        grad.addColorStop(0.5, '#353d42');
        grad.addColorStop(1, '#1c2226');
        break;

      case 'dusk':
        grad = ctx.createLinearGradient(0, 0, 0, h);
        grad.addColorStop(0, '#4a2545');
        grad.addColorStop(0.4, '#994636');
        grad.addColorStop(1, '#2d1829');
        break;

      case 'field':
        grad = ctx.createLinearGradient(0, 0, 0, h);
        grad.addColorStop(0, '#a9c47a');
        grad.addColorStop(0.5, '#7fa350');
        grad.addColorStop(1, '#4c6b2e');
        break;

      case 'range':
        grad = ctx.createLinearGradient(0, 0, 0, h);
        grad.addColorStop(0, '#b0ac9c');
        grad.addColorStop(0.5, '#8d8874');
        grad.addColorStop(1, '#5c5847');
        break;

      case 'fog':
        grad = ctx.createLinearGradient(0, 0, 0, h);
        grad.addColorStop(0, '#c7cfd2');
        grad.addColorStop(0.5, '#aab4b8');
        grad.addColorStop(1, '#8b969a');
        break;

      case 'rain':
        grad = ctx.createLinearGradient(0, 0, 0, h);
        grad.addColorStop(0, '#3d4a56');
        grad.addColorStop(0.5, '#2b3540');
        grad.addColorStop(1, '#171d24');
        break;

      case 'forest':
      default:
        grad = ctx.createLinearGradient(0, 0, 0, h);
        grad.addColorStop(0, '#668265');
        grad.addColorStop(0.5, '#40523e');
        grad.addColorStop(1, '#233022');
        break;
    }

    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // Draw Horizon line and subtle terrain texture
    const horizonY = h * 0.55 + (this.panY * this.basePixelsPerMIL * this.zoom * 0.1);
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    ctx.fillRect(0, horizonY, w, h - horizonY);

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

  drawTreeLine(w, horizonY, count, color, alpha, minH, maxH) {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    const spacing = w / count;
    for (let i = 0; i < count; i++) {
      const seed = this.detailSeed(i, count);
      const treeH = minH + seed * (maxH - minH);
      const treeW = treeH * 0.5;
      const cx = spacing * (i + 0.5) + (seed - 0.5) * spacing * 0.5;
      const baseY = horizonY + 3;
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
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    const peakCount = 6;
    const maxPeakH = horizonY * heightFactor;
    ctx.beginPath();
    ctx.moveTo(0, horizonY);
    for (let i = 0; i <= peakCount; i++) {
      const x = (w / peakCount) * i;
      const seed = this.detailSeed(i, salt);
      const y = horizonY - maxPeakH * (0.35 + seed * 0.65);
      ctx.lineTo(x, y);
    }
    ctx.lineTo(w, horizonY);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  drawSkyline(w, horizonY) {
    const ctx = this.ctx;
    ctx.save();
    const count = 12;
    const spacing = w / count;
    for (let i = 0; i < count; i++) {
      const seed = this.detailSeed(i, 9);
      const bH = 20 + seed * 55;
      const bW = spacing * 0.7;
      const x = spacing * i + spacing * 0.15;
      const y = horizonY - bH;
      ctx.fillStyle = '#12161a';
      ctx.fillRect(x, y, bW, bH + 4);
      ctx.fillStyle = 'rgba(255, 200, 120, 0.5)';
      for (let wy = y + 6; wy < horizonY - 4; wy += 8) {
        for (let wx = x + 4; wx < x + bW - 4; wx += 7) {
          if (Math.abs(Math.sin(wx * 12.9 + wy * 78.2)) > 0.55) ctx.fillRect(wx, wy, 2, 3);
        }
      }
    }
    ctx.restore();
  }

  drawFenceLine(w, horizonY) {
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = 'rgba(40,35,25,0.5)';
    ctx.lineWidth = 1.5;
    const postSpacing = 22;
    const postH = 10;
    ctx.beginPath();
    ctx.moveTo(0, horizonY - postH * 0.6);
    ctx.lineTo(w, horizonY - postH * 0.6);
    ctx.stroke();
    for (let x = 0; x < w; x += postSpacing) {
      ctx.beginPath();
      ctx.moveTo(x, horizonY - postH);
      ctx.lineTo(x, horizonY + 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawScrub(w, horizonY) {
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = 'rgba(70, 55, 30, 0.6)';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    const count = 8;
    for (let i = 0; i < count; i++) {
      const seed = this.detailSeed(i, 5);
      const x = (w / count) * i + seed * (w / count);
      const baseY = horizonY + 4 + seed * 6;
      const armH = 6 + seed * 6;
      ctx.beginPath();
      ctx.moveTo(x, baseY);
      ctx.lineTo(x, baseY - armH * 1.6);
      ctx.moveTo(x, baseY - armH * 0.9);
      ctx.lineTo(x - armH * 0.5, baseY - armH * 0.9);
      ctx.lineTo(x - armH * 0.5, baseY - armH * 1.4);
      ctx.moveTo(x, baseY - armH * 1.1);
      ctx.lineTo(x + armH * 0.5, baseY - armH * 1.1);
      ctx.lineTo(x + armH * 0.5, baseY - armH * 1.6);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawRangeBerm(w, horizonY) {
    const ctx = this.ctx;
    ctx.save();
    const bermH = 34;
    const grad = ctx.createLinearGradient(0, horizonY - bermH, 0, horizonY + 6);
    grad.addColorStop(0, '#8a7f65');
    grad.addColorStop(1, '#5c5340');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(0, horizonY + 6);
    ctx.quadraticCurveTo(w * 0.5, horizonY - bermH, w, horizonY + 6);
    ctx.lineTo(w, horizonY + 20);
    ctx.lineTo(0, horizonY + 20);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  drawSnowfall(w, h) {
    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    for (let i = 0; i < 40; i++) {
      const seedX = this.detailSeed(i, 1);
      const seedY = this.detailSeed(i, 2);
      const x = seedX * w;
      const y = seedY * h;
      const r = 1 + (seedX * seedY) * 1.5;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  drawSunGlow(w, horizonY) {
    const ctx = this.ctx;
    ctx.save();
    const sunX = w * 0.72;
    const sunY = horizonY - 8;
    const grad = ctx.createRadialGradient(sunX, sunY, 2, sunX, sunY, 70);
    grad.addColorStop(0, 'rgba(255, 190, 120, 0.9)');
    grad.addColorStop(1, 'rgba(255, 140, 60, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(sunX, sunY, 70, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 225, 180, 0.95)';
    ctx.beginPath();
    ctx.arc(sunX, sunY, 10, 0, Math.PI * 2);
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
    const pxPerMIL = this.basePixelsPerMIL * this.zoom;

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
    for (let sub = 0.2; sub <= 3.0; sub += 0.2) {
      const d = sub * pxPerMIL;
      const isWhole = Math.abs(sub - Math.round(sub)) < 0.05;
      const isHalf = Math.abs(sub * 10 % 5) < 0.05 && !isWhole;
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

    // Wheel Zoom
    viewport.addEventListener('wheel', (e) => {
      e.preventDefault();
      const delta = e.deltaY < 0 ? 1 : -1;
      this.setZoom(this.zoom + delta * 0.5 * this.zoomSensitivity);
      sfx.playClick();
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
        const diff = newDist - this.pinchDistance;
        if (Math.abs(diff) > 5) {
          const step = diff > 0 ? 0.5 : -0.5;
          this.setZoom(this.zoom + step * this.zoomSensitivity);
          this.pinchDistance = newDist;
        }
      }
    }, { passive: true });

    viewport.addEventListener('touchend', () => {
      this.isDragging = false;
    });

    // Keyboard navigation
    window.addEventListener('keydown', (e) => {
      // Only react if simulator tab is active
      const simTab = document.getElementById('page-simulator');
      if (!simTab || !simTab.classList.contains('active')) return;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return;

      const panAmountPx = 15;
      switch (e.key) {
        case 'ArrowUp':
          this.panByPixels(0, panAmountPx);
          e.preventDefault();
          break;
        case 'ArrowDown':
          this.panByPixels(0, -panAmountPx);
          e.preventDefault();
          break;
        case 'ArrowLeft':
          this.panByPixels(panAmountPx, 0);
          e.preventDefault();
          break;
        case 'ArrowRight':
          this.panByPixels(-panAmountPx, 0);
          e.preventDefault();
          break;
        case '+':
        case '=':
          this.setZoom(this.zoom + 1);
          e.preventDefault();
          break;
        case '-':
        case '_':
          this.setZoom(this.zoom - 1);
          e.preventDefault();
          break;
        case 'r':
        case 'R':
          this.resetView();
          break;
        case 'c':
        case 'C':
          this.centerTarget();
          break;
      }
    });
  }
}
