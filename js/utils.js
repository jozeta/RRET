/* ==========================================================================
   Utility & Mathematical Helper Functions
   ========================================================================== */

export const UNITS = {
  METRIC: 'metric',
  IMPERIAL: 'imperial'
};

/**
 * Escapes a value for safe interpolation into innerHTML (text or attribute context).
 * Untrusted target data (name, description, category, imageData) flows into innerHTML
 * templates, so every such value must pass through this before concatenation.
 */
export function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[ch]));
}

/**
 * Only accept genuine base64 image data URIs. Blocks non-image data: URIs (e.g. data:text/html)
 * that could otherwise be smuggled through an imported/custom target's imageData field.
 */
export function isSafeImageDataURI(value) {
  return typeof value === 'string' && /^data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,[a-zA-Z0-9+/=]+$/.test(value);
}

/**
 * Calculates distance given target dimension in meters and measured MIL height/width.
 * Formula: Distance (m) = Target Size (m) * 1000 / MIL
 */
export function calculateDistance(targetSizeMeters, milReading) {
  if (!milReading || milReading <= 0) return 0;
  return (targetSizeMeters * 1000) / milReading;
}

/**
 * Calculates MIL reading given target size in meters and distance in meters.
 * Formula: MIL = Target Size (m) * 1000 / Distance (m)
 */
export function calculateMIL(targetSizeMeters, distanceMeters) {
  if (!distanceMeters || distanceMeters <= 0) return 0;
  return (targetSizeMeters * 1000) / distanceMeters;
}

/**
 * Unit conversions
 */
export function metersToYards(m) {
  return m * 1.09361;
}

export function yardsToMeters(yd) {
  return yd / 1.09361;
}

export function cmToMeters(cm) {
  return cm / 100;
}

export function mmToMeters(mm) {
  return mm / 1000;
}

export function inchesToMeters(inches) {
  return inches * 0.0254;
}

/**
 * Calculate Score based on percentage error
 * Perfect: 100
 * Within 1%: 95
 * Within 2%: 90
 * Within 5%: 80
 * Within 10%: 60
 * Otherwise: 0
 */
export function calculateScoreAndRating(estimatedDist, actualDist) {
  if (!estimatedDist || estimatedDist <= 0) {
    return { score: 0, errorAbs: actualDist, errorPct: 100, rating: 'Miss', badgeClass: 'bg-danger' };
  }
  const errorAbs = Math.abs(estimatedDist - actualDist);
  const errorPct = (errorAbs / actualDist) * 100;

  let score = 0;
  let rating = 'Poor';
  let badgeClass = 'bg-danger';

  if (errorPct <= 0.5) {
    score = 100;
    rating = 'Bullseye Perfect!';
    badgeClass = 'bg-success';
  } else if (errorPct <= 1.0) {
    score = 95;
    rating = 'Exceptional';
    badgeClass = 'bg-success';
  } else if (errorPct <= 2.0) {
    score = 90;
    rating = 'Excellent';
    badgeClass = 'bg-success';
  } else if (errorPct <= 5.0) {
    score = 80;
    rating = 'Good Match';
    badgeClass = 'bg-warning text-dark';
  } else if (errorPct <= 10.0) {
    score = 60;
    rating = 'Acceptable';
    badgeClass = 'bg-warning text-dark';
  } else {
    score = 0;
    rating = 'Off Target (>10% Error)';
    badgeClass = 'bg-danger';
  }

  return {
    score,
    errorAbs: Number(errorAbs.toFixed(1)),
    errorPct: Number(errorPct.toFixed(2)),
    rating,
    badgeClass
  };
}

/**
 * Web Audio API Sound Synthesizer for rich offline feedback
 */
class SoundEffects {
  constructor() {
    this.audioCtx = null;
    this.enabled = true;
  }

  init() {
    if (!this.audioCtx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) {
        this.audioCtx = new AudioContext();
      }
    }
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
  }

  playClick() {
    if (!this.enabled) return;
    try {
      this.init();
      if (!this.audioCtx) return;
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(800, this.audioCtx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(300, this.audioCtx.currentTime + 0.03);
      gain.gain.setValueAtTime(0.12, this.audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.audioCtx.currentTime + 0.03);
      osc.connect(gain);
      gain.connect(this.audioCtx.destination);
      osc.start();
      osc.stop(this.audioCtx.currentTime + 0.03);
    } catch (e) {
      // Audio fallback silent
    }
  }

  playSuccess() {
    if (!this.enabled) return;
    try {
      this.init();
      if (!this.audioCtx) return;
      // High metallic chime / hit gong sound
      const now = this.audioCtx.currentTime;
      const osc1 = this.audioCtx.createOscillator();
      const osc2 = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();

      osc1.type = 'triangle';
      osc2.type = 'sine';

      osc1.frequency.setValueAtTime(523.25, now); // C5
      osc1.frequency.setValueAtTime(659.25, now + 0.08); // E5
      osc1.frequency.setValueAtTime(783.99, now + 0.16); // G5

      osc2.frequency.setValueAtTime(1046.50, now + 0.16); // C6

      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);

      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(this.audioCtx.destination);

      osc1.start(now);
      osc2.start(now + 0.16);
      osc1.stop(now + 0.5);
      osc2.stop(now + 0.5);
    } catch (e) {}
  }

  playError() {
    if (!this.enabled) return;
    try {
      this.init();
      if (!this.audioCtx) return;
      const now = this.audioCtx.currentTime;
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(180, now);
      osc.frequency.exponentialRampToValueAtTime(90, now + 0.2);

      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);

      osc.connect(gain);
      gain.connect(this.audioCtx.destination);

      osc.start(now);
      osc.stop(now + 0.2);
    } catch (e) {}
  }
}

export const sfx = new SoundEffects();

/**
 * Lightens (positive amt) or darkens (negative amt) a hex color by a flat RGB
 * offset. Used to derive a small "low poly" shading palette (light/mid/dark
 * facets) from a single base color per target, since targets.json only stores
 * one color per entry.
 */
function shadeHexColor(hex, amt) {
  const r = parseInt(hex.substring(1, 3), 16);
  const g = parseInt(hex.substring(3, 5), 16);
  const b = parseInt(hex.substring(5, 7), 16);
  const clamp = (v) => Math.max(0, Math.min(255, Math.round(v + amt))).toString(16).padStart(2, '0');
  return `#${clamp(r)}${clamp(g)}${clamp(b)}`;
}

/**
 * Four separate low-poly leg facets (not one solid base) for a broadside
 * quadruped silhouette: a near/far pair under the rear haunch and another under
 * the front shoulder, each pair shaded near=lighter/far=darker. Distinct gaps
 * between the two pairs are what make the silhouette read as legs rather than
 * a single solid-based "bench" shape.
 */
function quadrupedLegs(base, rearX, frontX, bodyBottomY, groundY, w = 6) {
  const near = shadeHexColor(base, 14);
  const far = shadeHexColor(base, -22);
  return `
    <polygon points="${rearX - w},${bodyBottomY} ${rearX - 1},${bodyBottomY} ${rearX - 2},${groundY - 4} ${rearX - w},${groundY - 4}" fill="${far}"/>
    <polygon points="${rearX},${bodyBottomY} ${rearX + w},${bodyBottomY} ${rearX + w - 1},${groundY} ${rearX - 1},${groundY}" fill="${near}"/>
    <polygon points="${frontX - w},${bodyBottomY} ${frontX - 1},${bodyBottomY} ${frontX - 2},${groundY - 4} ${frontX - w},${groundY - 4}" fill="${far}"/>
    <polygon points="${frontX},${bodyBottomY} ${frontX + w},${bodyBottomY} ${frontX + w - 1},${groundY} ${frontX - 1},${groundY}" fill="${near}"/>
  `;
}

/** width / height of a target, or `fallback` when dimensions are missing/invalid. */
function aspectOf(target, fallback) {
  const w = Number(target && target.width);
  const h = Number(target && target.height);
  return w > 0 && h > 0 ? w / h : fallback;
}

/**
 * Measured visible bounding boxes [x0, y0, x1, y1] (in 100x100 design units,
 * stroke included) of procedural shapes whose artwork does not touch all four
 * edges of the design box. The scope stretches the design box to the target's
 * declared real-world width x height, so any margin here would make the visible
 * target smaller than the size the player is told to measure (audit BUG-001).
 * renderTargetSVGString() maps each box onto the full 0..100 square.
 *
 * Measured by rasterizing each shape at 1000x1000; re-measure if artwork changes
 * (the browser smoke test asserts every shape fills its box).
 */
export const SHAPE_FIT = {
  swe_t: [0, 4.2, 100, 100],
  swe_tunna: [1, 0, 99, 100],
  swe_tunna_h: [0, 1, 100, 99],
  swe_b: [3, 1, 97, 99],
  swe_b45: [3, 1, 97, 99],
  swe_b65: [3, 1, 97, 99],
  prs_popper: [20.4, 0, 79.6, 100],
  coyote: [7.2, 16.7, 81.1, 88],
  deer: [10.5, 0.2, 78.8, 88],
  elk: [4.5, 0, 94.9, 90],
  moose: [3.5, 0.9, 99.1, 92],
  reindeer: [7.5, 1, 89.8, 86],
  bear: [2.7, 20.7, 96.8, 76],
  boar: [6.7, 17.1, 91.9, 84],
  wolf: [4.5, 13.8, 87.1, 88],
  fox: [7, 23.6, 76.1, 86],
  hare: [16.5, 8.8, 76.7, 84],
  pheasant: [0, 26.3, 81, 79],
  turkey: [7.4, 9.7, 77.8, 85.2]
};

/**
 * Generate Procedural SVG graphic string for targets
 */
export function renderTargetSVGString(target, widthPx = 120, heightPx = 120) {
  // Custom uploaded images always take priority over any placeholder svgType.
  if (target.imageData && isSafeImageDataURI(target.imageData)) {
    const safeName = escapeHTML(target.name || 'Custom target');
    return `<img src="${target.imageData}" alt="${safeName}" style="max-width:${widthPx}px; max-height:${heightPx}px; object-fit:contain;" />`;
  }

  const type = target.svgType || target.type || 'swe_b65';
  const color = target.color || '#1e242b';
  const border = target.borderColor || '#ffffff';

  let innerContent = '';

  switch (type) {
    case 'swe_c':
    case 'swe_c30':
    case 'swe_c35':
    case 'swe_c50':
      // Swedish C-figur (circle with concentric scoring rings)
      innerContent = `
        <circle cx="50" cy="50" r="49" fill="${color}" stroke="${border}" stroke-width="2"/>
        <circle cx="50" cy="50" r="37" fill="none" stroke="${border}" stroke-width="1.2" stroke-dasharray="3 2"/>
        <circle cx="50" cy="50" r="25" fill="none" stroke="${border}" stroke-width="1.2"/>
        <circle cx="50" cy="50" r="12" fill="none" stroke="${border}" stroke-width="1.2"/>
        <circle cx="50" cy="50" r="3" fill="${border}"/>
      `;
      break;

    case 'swe_t':
      // Swedish T-figur (round-topped triangle) — matches the T4/T5/T7/T10 &
      // 1/8-1/3 reference chart: rounded apex, straight sides down to a flat base,
      // with a smaller inner triangle outline (not a circle) tracing the scoring zone.
      innerContent = `
        <path d="M 25,18 C 25,1 75,1 75,18 L 99,99 L 1,99 Z" fill="${color}" stroke="${border}" stroke-width="2"/>
        <path d="M 37,32 C 37,20 63,20 63,32 L 82,88 L 18,88 Z" fill="none" stroke="${border}" stroke-width="1" stroke-dasharray="2 2"/>
      `;
      break;

    case 'swe_t_slanted_v':
      // Swedish T 5 V / T 7 V (right-triangle-like slanted quad), inner outline
      // scaled to match the outer quad instead of an unrelated circle.
      innerContent = `
        <path d="M 25,1 L 99,18 L 75,99 L 1,82 Z" fill="${color}" stroke="${border}" stroke-width="2"/>
        <path d="M 36,20 L 82,30 L 66,80 L 20,70 Z" fill="none" stroke="${border}" stroke-width="1" stroke-dasharray="2 2"/>
      `;
      break;

    case 'swe_t_slanted_h':
      // Swedish T 5 H / T 7 H (Slanted horizontal trapezoid)
      innerContent = `
        <path d="M 1,25 L 82,1 L 99,75 L 18,99 Z" fill="${color}" stroke="${border}" stroke-width="2"/>
        <path d="M 20,36 L 70,20 L 80,66 L 30,82 Z" fill="none" stroke="${border}" stroke-width="1" stroke-dasharray="2 2"/>
      `;
      break;

    case 'swe_s_v':
    case 'swe_s20v': {
      // Swedish S-figur Vertical (Stolpe): a true stadium spanning the FULL declared
      // width and height (the scope stretches this 100x100 box to the target's real
      // W x H, so the outline must touch all four edges or the player is shown a
      // smaller target than the stated size). Cap radii are given separately in x/y
      // (ry = rx * W/H) so the caps stay semicircular after that stretch.
      const a = aspectOf(target, 0.4); // width / height
      innerContent = `
        <rect x="1" y="1" width="98" height="98" rx="49" ry="${49 * a}" fill="${color}" stroke="${border}" stroke-width="2"/>
        <rect x="18" y="14" width="64" height="72" rx="32" ry="${32 * a}" fill="none" stroke="${border}" stroke-width="1" stroke-dasharray="2 2"/>
        <rect x="32" y="28" width="36" height="44" rx="18" ry="${18 * a}" fill="none" stroke="${border}" stroke-width="1" stroke-dasharray="2 2"/>
        <ellipse cx="50" cy="20" rx="3" ry="${3 * a}" fill="${border}"/>
        <ellipse cx="50" cy="50" rx="3" ry="${3 * a}" fill="${border}"/>
        <ellipse cx="50" cy="80" rx="3" ry="${3 * a}" fill="${border}"/>
      `;
      break;
    }

    case 'swe_s_h': {
      // Swedish S-figur Horizontal: the rotated counterpart of swe_s_v, again filling
      // the full declared box (rx = ry * H/W keeps the end caps semicircular).
      const a = 1 / aspectOf(target, 2.5); // height / width
      innerContent = `
        <rect x="1" y="1" width="98" height="98" rx="${49 * a}" ry="49" fill="${color}" stroke="${border}" stroke-width="2"/>
        <rect x="14" y="18" width="72" height="64" rx="${32 * a}" ry="32" fill="none" stroke="${border}" stroke-width="1" stroke-dasharray="2 2"/>
        <rect x="28" y="32" width="44" height="36" rx="${18 * a}" ry="18" fill="none" stroke="${border}" stroke-width="1" stroke-dasharray="2 2"/>
        <ellipse cx="20" cy="50" rx="${3 * a}" ry="3" fill="${border}"/>
        <ellipse cx="50" cy="50" rx="${3 * a}" ry="3" fill="${border}"/>
        <ellipse cx="80" cy="50" rx="${3 * a}" ry="3" fill="${border}"/>
      `;
      break;
    }

    case 'swe_l':
    case 'swe_l1':
    case 'swe_l2':
      // Swedish L-figur: an elongated hexagonal "coffin/kite" shape (pointed top
      // and bottom, straight parallel sides through the middle) — not a simple
      // 4-point diamond, per the reference chart.
      innerContent = `
        <polygon points="50,1 99,19 99,81 50,99 1,81 1,19" fill="${color}" stroke="${border}" stroke-width="2"/>
        <polygon points="50,14 78,28 78,72 50,86 22,72 22,28" fill="none" stroke="${border}" stroke-width="1" stroke-dasharray="2 2"/>
      `;
      break;

    case 'swe_c_dome':
      // Swedish C 15 D: a simple solid rounded blob (no inner scoring rings visible
      // on the reference chart at this target's small size).
      innerContent = `
        <circle cx="50" cy="50" r="49" fill="${color}" stroke="${border}" stroke-width="2"/>
      `;
      break;

    case 'swe_tunna':
      // Swedish Tunna K / Tunna D / Tunna V: an angular hexagonal barrel (flat top,
      // flat bottom, angled corner facets) — the reference chart shows straight
      // facets, not a smoothly-curved oval barrel.
      innerContent = `
        <polygon points="20,1 80,1 98,25 98,75 80,99 20,99 2,75 2,25" fill="${color}" stroke="${border}" stroke-width="2"/>
        <polygon points="30,15 70,15 85,32 85,68 70,85 30,85 15,68 15,32" fill="none" stroke="${border}" stroke-width="1" stroke-dasharray="2 2"/>
      `;
      break;

    case 'swe_tunna_h':
      // Swedish Tunna H (Horizontal barrel shape) — 90-degree-rotated counterpart.
      innerContent = `
        <polygon points="1,20 1,80 25,98 75,98 99,80 99,20 75,2 25,2" fill="${color}" stroke="${border}" stroke-width="2"/>
        <polygon points="15,30 15,70 32,85 68,85 85,70 85,30 68,15 32,15" fill="none" stroke="${border}" stroke-width="1" stroke-dasharray="2 2"/>
      `;
      break;

    case 'swe_b':
    case 'swe_b65':
    case 'swe_b45':
      // Swedish B-figur (head & shoulder "bust" silhouette): a rounded dome head
      // flowing smoothly into rounded shoulders, per the reference chart — the
      // previous version used flat/angular segments that read as a hard hat shape
      // rather than a portrait bust. Inner outline traces the same curve, scaled down.
      innerContent = `
        <path d="M 50,2 C 65,2 72,16 68,28 C 82,34 96,48 96,70 L 96,98 L 4,98 L 4,70 C 4,48 18,34 32,28 C 28,16 35,2 50,2 Z" fill="${color}" stroke="${border}" stroke-width="2"/>
        <path d="M 50,16 C 60,16 65,25 63,33 C 73,37 82,47 82,62 L 82,88 L 18,88 L 18,62 C 18,47 27,37 37,33 C 35,25 40,16 50,16 Z" fill="none" stroke="${border}" stroke-width="1" stroke-dasharray="2 2"/>
      `;
      break;

    case 'circle_gong':
      innerContent = `
        <circle cx="50" cy="50" r="49" fill="${color}" stroke="${border}" stroke-width="2"/>
        <circle cx="50" cy="50" r="12" fill="none" stroke="${border}" stroke-dasharray="2 2"/>
      `;
      break;

    case 'prs_popper':
      innerContent = `
        <path d="M 35,99 L 35,50 C 15,45 15,1 50,1 C 85,1 85,45 65,50 L 65,99 Z" fill="${color}" stroke="${border}" stroke-width="2"/>
        <circle cx="50" cy="30" r="12" fill="none" stroke="${border}" stroke-dasharray="2 2"/>
      `;
      break;

    case 'ipsc_metric':
    case 'ipsc_mini':
      innerContent = `
        <polygon points="25,1 75,1 99,25 99,99 1,99 1,25" fill="${color}" stroke="${border}" stroke-width="2"/>
        <rect x="30" y="30" width="40" height="50" fill="none" stroke="${border}" stroke-width="1.5"/>
      `;
      break;

    case 'mil_e_type':
      innerContent = `
        <path d="M 30,1 L 70,1 L 70,25 L 99,25 L 99,99 L 1,99 L 1,25 L 30,25 Z" fill="${color}" stroke="${border}" stroke-width="2"/>
        <circle cx="50" cy="45" r="16" fill="none" stroke="rgba(255,255,255,0.4)" stroke-dasharray="2 2"/>
      `;
      break;

    case 'soldier_silhouette':
      innerContent = `
        <path d="M 50,1 C 58,1 64,8 64,18 C 64,26 58,30 72,35 L 99,45 L 88,75 L 85,99 L 15,99 L 12,75 L 1,45 L 28,35 C 42,30 36,26 36,18 C 36,8 42,1 50,1 Z" fill="${color}" stroke="${border}" stroke-width="2"/>
      `;
      break;

    // --- Hunting silhouettes: low-poly faceted style. Each species is built from
    // a light "top/lit" facet, a dark "bottom/shadow" facet, and separate near/far
    // leg facets (quadrupedLegs) so the silhouette reads as a standing animal with
    // visible daylight between its legs, not a solid base. ---

    case 'coyote': {
      const light = shadeHexColor(color, 26);
      const dark = shadeHexColor(color, -24);
      innerContent = `
        <polygon points="18,48 22,39 44,35 60,38 63,48" fill="${light}" stroke="${border}" stroke-width="1.2"/>
        <polygon points="18,48 63,48 61,57 20,57" fill="${dark}" stroke="${border}" stroke-width="1.2"/>
        <polygon points="55,38 58,29 64,27 66,33 60,40" fill="${light}" stroke="${border}" stroke-width="1.2"/>
        <polygon points="62,28 73,26 80,31 73,35 62,33" fill="${dark}" stroke="${border}" stroke-width="1.2"/>
        <polygon points="59,27 57,18 64,24" fill="${light}" stroke="${border}" stroke-width="1"/>
        <path d="M 18,50 C 9,49 5,42 10,37 C 13,34 16,36 14,40" fill="${dark}" stroke="${border}" stroke-width="1.2"/>
        ${quadrupedLegs(color, 27, 50, 52, 88, 5)}
      `;
      break;
    }

    case 'deer': {
      // Broadside standing whitetail/roe deer with branching antlers
      const light = shadeHexColor(color, 34);
      const dark = shadeHexColor(color, -22);
      innerContent = `
        <polygon points="18,36 22,26 44,20 60,24 62,36" fill="${light}" stroke="${border}" stroke-width="1.2"/>
        <polygon points="18,36 62,36 60,48 18,48" fill="${dark}" stroke="${border}" stroke-width="1.2"/>
        <polygon points="54,26 57,13 63,10 66,15 60,28" fill="${light}" stroke="${border}" stroke-width="1.2"/>
        <polygon points="61,12 67,6 75,9 71,18 63,15" fill="${dark}" stroke="${border}" stroke-width="1.2"/>
        <polygon points="62,9 59,3 66,6" fill="${light}" stroke="${border}" stroke-width="1"/>
        <path d="M 65,7 L 60,1 M 65,7 L 62,2 L 58,4 M 69,8 L 75,2 M 69,8 L 74,2 L 78,4" fill="none" stroke="${border}" stroke-width="1.6" stroke-linecap="round"/>
        <polygon points="18,38 11,31 15,44" fill="${dark}" stroke="${border}" stroke-width="1"/>
        ${quadrupedLegs(color, 27, 51, 46, 88)}
      `;
      break;
    }

    case 'elk': {
      // Bull elk: bulkier body and heavier sweeping antlers than the deer shape
      const light = shadeHexColor(color, 30);
      const dark = shadeHexColor(color, -24);
      innerContent = `
        <polygon points="12,42 17,28 46,20 66,26 70,42" fill="${light}" stroke="${border}" stroke-width="1.2"/>
        <polygon points="12,42 70,42 67,55 14,55" fill="${dark}" stroke="${border}" stroke-width="1.2"/>
        <polygon points="60,28 64,14 71,10 75,16 68,30" fill="${light}" stroke="${border}" stroke-width="1.2"/>
        <polygon points="67,14 74,7 84,10 79,20 69,17" fill="${dark}" stroke="${border}" stroke-width="1.2"/>
        <polygon points="68,11 65,4 73,7" fill="${light}" stroke="${border}" stroke-width="1"/>
        <path d="M 71,9 L 62,0 L 55,3 M 62,0 L 58,6 M 76,9 L 87,1 L 94,5 M 87,1 L 90,8" fill="none" stroke="${border}" stroke-width="1.8" stroke-linecap="round"/>
        <polygon points="12,44 5,37 9,50" fill="${dark}" stroke="${border}" stroke-width="1"/>
        ${quadrupedLegs(color, 24, 58, 53, 90, 7)}
      `;
      break;
    }

    case 'moose': {
      // Very large body, long legs, blocky palmate antlers, dewlap
      const light = shadeHexColor(color, 26);
      const dark = shadeHexColor(color, -26);
      innerContent = `
        <polygon points="10,48 15,32 44,22 64,30 68,48" fill="${light}" stroke="${border}" stroke-width="1.2"/>
        <polygon points="10,48 68,48 65,60 12,60" fill="${dark}" stroke="${border}" stroke-width="1.2"/>
        <polygon points="58,32 60,16 68,10 74,18 66,34" fill="${light}" stroke="${border}" stroke-width="1.2"/>
        <polygon points="62,16 66,6 78,6 82,16 72,22 64,20" fill="${dark}" stroke="${border}" stroke-width="1.2"/>
        <polygon points="72,22 75,29 68,26" fill="${dark}" stroke="${border}" stroke-width="1"/>
        <path d="M 67,7 L 54,2 L 48,7 L 52,10 M 79,7 L 92,2 L 98,7 L 94,10" fill="none" stroke="${border}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
        <polygon points="10,50 4,43 7,56" fill="${dark}" stroke="${border}" stroke-width="1"/>
        ${quadrupedLegs(color, 22, 56, 58, 92, 7.5)}
      `;
      break;
    }

    case 'reindeer': {
      // Stockier than deer, both sexes antlered; typical Scandinavian hunting quarry
      const light = shadeHexColor(color, 28);
      const dark = shadeHexColor(color, -22);
      innerContent = `
        <polygon points="14,40 19,28 46,22 63,27 66,40" fill="${light}" stroke="${border}" stroke-width="1.2"/>
        <polygon points="14,40 66,40 64,52 16,52" fill="${dark}" stroke="${border}" stroke-width="1.2"/>
        <polygon points="57,28 60,16 67,13 70,19 63,30" fill="${light}" stroke="${border}" stroke-width="1.2"/>
        <polygon points="63,17 70,10 79,13 75,22 65,20" fill="${dark}" stroke="${border}" stroke-width="1.2"/>
        <polygon points="64,14 62,8 69,10" fill="${light}" stroke="${border}" stroke-width="1"/>
        <path d="M 68,11 L 62,2 L 55,4 M 62,2 L 60,8 M 73,12 L 82,3 L 89,6 M 82,3 L 84,9" fill="none" stroke="${border}" stroke-width="1.6" stroke-linecap="round"/>
        <polygon points="14,42 8,35 11,48" fill="${dark}" stroke="${border}" stroke-width="1"/>
        ${quadrupedLegs(color, 28, 52, 50, 86, 6)}
      `;
      break;
    }

    case 'bear': {
      // Humped back via overlaid highlight/shadow, rounded head, no antlers/horns
      const light = shadeHexColor(color, 30);
      const dark = shadeHexColor(color, -28);
      innerContent = `
        <path d="M 4,75 C 2,55 10,42 25,40 C 35,38 40,25 55,22 C 68,20 78,28 82,38 C 92,40 98,50 95,62 L 90,75 L 80,75 L 78,58 L 30,58 L 26,75 Z" fill="${color}" stroke="${border}" stroke-width="2"/>
        <path d="M 8,58 C 8,44 16,36 27,42 C 34,32 42,26 55,22 C 66,20 76,26 80,36 L 82,44 L 76,50 L 40,50 L 20,52 Z" fill="${light}" opacity="0.9"/>
        <path d="M 78,58 L 90,75 L 80,75 L 78,58 M 30,58 L 26,75 L 4,75 C 3,68 4,62 8,58 Z" fill="${dark}" opacity="0.85"/>
      `;
      break;
    }

    case 'boar': {
      // Low-slung body, downward wedge snout, tusk, back bristles, curled tail
      const light = shadeHexColor(color, 26);
      const dark = shadeHexColor(color, -22);
      innerContent = `
        <polygon points="14,42 20,32 46,28 62,32 64,42" fill="${light}" stroke="${border}" stroke-width="1.2"/>
        <polygon points="14,42 64,42 62,54 16,54" fill="${dark}" stroke="${border}" stroke-width="1.2"/>
        <polygon points="58,30 72,24 82,28 78,38 64,38" fill="${light}" stroke="${border}" stroke-width="1.2"/>
        <polygon points="78,28 88,30 86,36 78,38" fill="${dark}" stroke="${border}" stroke-width="1.2"/>
        <polygon points="60,26 58,18 66,22" fill="${dark}" stroke="${border}" stroke-width="1"/>
        <path d="M 86,34 L 91,32" stroke="${border}" stroke-width="1.8" stroke-linecap="round"/>
        <path d="M 30,26 L 32,20 M 38,25 L 40,19 M 46,25 L 48,19" stroke="${dark}" stroke-width="1.4" stroke-linecap="round"/>
        <path d="M 14,44 C 8,44 6,40 9,37" fill="none" stroke="${dark}" stroke-width="1.8" stroke-linecap="round"/>
        ${quadrupedLegs(color, 24, 54, 52, 84)}
      `;
      break;
    }

    case 'wolf': {
      // Lean body, pointed ears, bushy trailing tail
      const light = shadeHexColor(color, 26);
      const dark = shadeHexColor(color, -24);
      innerContent = `
        <polygon points="16,46 21,36 46,32 64,36 67,46" fill="${light}" stroke="${border}" stroke-width="1.2"/>
        <polygon points="16,46 67,46 65,56 18,56" fill="${dark}" stroke="${border}" stroke-width="1.2"/>
        <polygon points="58,36 62,26 68,24 70,30 64,38" fill="${light}" stroke="${border}" stroke-width="1.2"/>
        <polygon points="66,25 78,23 86,28 78,33 66,31" fill="${dark}" stroke="${border}" stroke-width="1.2"/>
        <polygon points="62,25 60,15 68,21" fill="${light}" stroke="${border}" stroke-width="1"/>
        <path d="M 16,48 C 6,46 2,38 8,32 C 11,29 15,31 13,35" fill="${dark}" stroke="${border}" stroke-width="1.2"/>
        ${quadrupedLegs(color, 26, 54, 50, 88, 5.5)}
      `;
      break;
    }

    case 'fox': {
      // Small and slender, pointed ears, oversized bushy tail
      const light = shadeHexColor(color, 26);
      const dark = shadeHexColor(color, -22);
      innerContent = `
        <polygon points="22,52 26,44 44,41 58,44 61,52" fill="${light}" stroke="${border}" stroke-width="1.2"/>
        <polygon points="22,52 61,52 59,60 24,60" fill="${dark}" stroke="${border}" stroke-width="1.2"/>
        <polygon points="53,44 55,36 61,34 63,39 58,46" fill="${light}" stroke="${border}" stroke-width="1.2"/>
        <polygon points="59,34 68,31 75,36 68,40 59,39" fill="${dark}" stroke="${border}" stroke-width="1.2"/>
        <polygon points="56,33 54,25 61,31" fill="${light}" stroke="${border}" stroke-width="1"/>
        <path d="M 22,54 C 10,53 4,45 10,39 C 14,35 19,38 16,43 C 15,45 13,45 13,43" fill="${dark}" stroke="${border}" stroke-width="1.2"/>
        ${quadrupedLegs(color, 30, 50, 56, 86, 4.5)}
      `;
      break;
    }

    case 'hare': {
      // Crouched posture: tall ears, small front legs, tall haunch/rear legs
      const light = shadeHexColor(color, 26);
      const dark = shadeHexColor(color, -22);
      innerContent = `
        <polygon points="20,56 26,44 50,38 66,44 70,58 60,64 30,64" fill="${light}" stroke="${border}" stroke-width="1.2"/>
        <polygon points="30,64 60,64 70,58 66,66 34,68" fill="${dark}" stroke="${border}" stroke-width="1.2"/>
        <polygon points="26,58 40,58 40,80 32,84 24,78" fill="${dark}"/>
        <polygon points="26,58 40,58 39,68 26,68" fill="${light}"/>
        <polygon points="55,58 60,58 59,72 54,72" fill="${dark}"/>
        <polygon points="56,40 64,30 74,33 70,44 60,45" fill="${light}" stroke="${border}" stroke-width="1.2"/>
        <polygon points="60,32 58,10 64,14 66,33" fill="${dark}" stroke="${border}" stroke-width="1.2"/>
        <polygon points="68,32 70,11 76,16 73,34" fill="${light}" stroke="${border}" stroke-width="1.2"/>
        <circle cx="21" cy="58" r="4" fill="${light}" stroke="${border}" stroke-width="1"/>
      `;
      break;
    }

    case 'pheasant': {
      // Upland game bird: sweeping trailing tail feather, angular head + beak
      const light = shadeHexColor(color, 24);
      const dark = shadeHexColor(color, -20);
      innerContent = `
        <path d="M 28,58 C 12,56 0,60 -6,70 C 4,68 14,66 24,62" fill="${dark}" stroke="${border}" stroke-width="1.2"/>
        <polygon points="26,56 32,44 54,42 64,48 62,60 38,64" fill="${light}" stroke="${border}" stroke-width="1.2"/>
        <polygon points="38,64 62,60 58,68 36,70" fill="${dark}" stroke="${border}" stroke-width="1.2"/>
        <polygon points="36,48 50,47 52,56 38,58" fill="${dark}" opacity="0.8"/>
        <path d="M 44,64 L 42,78 M 52,64 L 54,78" stroke="${dark}" stroke-width="2" stroke-linecap="round"/>
        <polygon points="56,44 60,34 66,32 68,38 62,48" fill="${light}" stroke="${border}" stroke-width="1.2"/>
        <polygon points="61,34 67,27 76,30 72,39 63,37" fill="${dark}" stroke="${border}" stroke-width="1.2"/>
        <polygon points="75,30 81,31 75,34" fill="${border}"/>
      `;
      break;
    }

    case 'turkey': {
      // Distinctive fan tail, plump body, small wattle
      const light = shadeHexColor(color, 22);
      const dark = shadeHexColor(color, -22);
      innerContent = `
        <path d="M 20,60 L 8,20 L 24,38 L 20,10 L 32,36 L 34,12 L 40,38 L 46,20 L 42,42 Z" fill="${dark}" stroke="${border}" stroke-width="1.2"/>
        <polygon points="34,58 40,44 60,42 70,52 66,66 42,70" fill="${light}" stroke="${border}" stroke-width="1.2"/>
        <polygon points="42,70 66,66 62,74 40,76" fill="${dark}" stroke="${border}" stroke-width="1.2"/>
        <path d="M 48,68 L 46,84 M 58,68 L 60,84" stroke="${dark}" stroke-width="2.4" stroke-linecap="round"/>
        <polygon points="58,44 62,34 67,32 70,38 64,48" fill="${light}" stroke="${border}" stroke-width="1.2"/>
        <polygon points="63,34 69,28 77,31 73,40 65,38" fill="${dark}" stroke="${border}" stroke-width="1.2"/>
        <path d="M 74,35 L 72,41" stroke="${border}" stroke-width="1.6" stroke-linecap="round"/>
      `;
      break;
    }

    default:
      innerContent = `<rect x="1" y="1" width="98" height="98" fill="${color}" stroke="${border}" stroke-width="2"/>`;
      break;
  }

  // Shapes drawn with margins inside the 100x100 design box are mapped so their
  // visible outline (stroke included) spans the box exactly — see SHAPE_FIT.
  const fit = SHAPE_FIT[type];
  if (fit) {
    const [x0, y0, x1, y1] = fit;
    const sx = 100 / (x1 - x0);
    const sy = 100 / (y1 - y0);
    innerContent = `<g transform="matrix(${sx} 0 0 ${sy} ${-x0 * sx} ${-y0 * sy})">${innerContent}</g>`;
  }

  // preserveAspectRatio="none": callers may request a non-square widthPx/heightPx
  // (to match a target's real width:height ratio) and need the square 100x100
  // design stretched to fill it exactly, not letterboxed inside it.
  return `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="${widthPx}" height="${heightPx}" preserveAspectRatio="none">
      ${innerContent}
    </svg>
  `;
}
