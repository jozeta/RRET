/* ==========================================================================
   Scenario generation rules (pure, DOM-free, unit-tested)
   ========================================================================== */

import { calculateMIL, metersToYards, yardsToMeters } from './utils.js';

export const ENVIRONMENTS = ['forest', 'field', 'snow', 'mountain', 'desert', 'urban', 'range', 'fog', 'rain', 'dusk'];

// Hunting-category targets only ever appear against a forest or mountain backdrop.
export const HUNTING_ENVIRONMENTS = ['forest', 'mountain'];

export const DISTANCE_BANDS = {
  close: { min: 0, max: 200, label: 'Close (< 200 m)' },
  medium: { min: 200, max: 500, label: 'Medium (200–500 m)' },
  long: { min: 500, max: 850, label: 'Long (500–850 m)' },
  extreme: { min: 850, max: Infinity, label: 'Extreme (850 m+)' }
};

/** Closest a target without its own range is ever placed (audit BUG-020). */
export const MIN_SCENARIO_DISTANCE_M = 25;
/** Farthest a target without its own range is placed in the open-ended band. */
export const MAX_SCENARIO_DISTANCE_M = 1200;

/** Small, fast, seedable PRNG (mulberry32). Same seed -> same sequence. */
export function createRng(seed) {
  let a = typeof seed === 'number' ? seed >>> 0 : hashString(String(seed));
  return function rng() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function pick(arr, rng = Math.random) {
  return arr[Math.floor(rng() * arr.length)];
}

/**
 * Targets a random scenario may draw from. An empty `categories` list means no
 * restriction. 'Custom' matches any user-created target regardless of its
 * category text. Targets without a declared range are eligible in every band.
 */
export function filterTargetPool(targets, { categories = [], distance = 'any' } = {}) {
  let pool = targets;
  const cats = new Set(categories);
  if (cats.size > 0) {
    pool = pool.filter(t => (cats.has('Custom') && !t.isBuiltIn) || cats.has(t.category));
  }
  if (distance !== 'any' && DISTANCE_BANDS[distance]) {
    const band = DISTANCE_BANDS[distance];
    pool = pool.filter(t => {
      if (!t.minDistance || !t.maxDistance) return true;
      return t.minDistance <= band.max && t.maxDistance >= band.min;
    });
  }
  return pool;
}

/** The [min, max] meters to roll a distance within for `target` under `distance` filter. */
export function effectiveDistanceRange(target, distance = 'any') {
  const band = distance !== 'any' ? DISTANCE_BANDS[distance] : null;

  if (target.minDistance && target.maxDistance) {
    if (!band) return { min: target.minDistance, max: target.maxDistance };
    const min = Math.max(target.minDistance, band.min);
    const max = Math.min(target.maxDistance, band.max);
    // No overlap only happens for a hand-picked target ("Practice Scenario"):
    // its own competition window wins over the band.
    return min <= max ? { min, max } : { min: target.minDistance, max: target.maxDistance };
  }

  if (band) {
    return {
      min: Math.max(MIN_SCENARIO_DISTANCE_M, band.min),
      max: Number.isFinite(band.max) ? band.max : MAX_SCENARIO_DISTANCE_M
    };
  }
  return null;
}

const FALLBACK_RANGES = [
  { min: 50, max: 200, weight: 0.25 },
  { min: 200, max: 500, weight: 0.45 },
  { min: 500, max: 850, weight: 0.20 },
  { min: 850, max: 1200, weight: 0.10 }
];

/**
 * Rolls a scenario distance in meters. In imperial mode the distance is a whole
 * number of yards (stored as meters), so a perfect answer typed in whole yards
 * scores 100 (audit BUG-022).
 */
export function rollDistanceMeters(target, distance = 'any', unit = 'metric', rng = Math.random) {
  let range = effectiveDistanceRange(target, distance);
  if (!range) {
    const r = rng();
    let cumulative = 0;
    range = FALLBACK_RANGES[1];
    for (const candidate of FALLBACK_RANGES) {
      cumulative += candidate.weight;
      if (r <= cumulative) { range = candidate; break; }
    }
  }
  if (unit === 'imperial') {
    const minYd = Math.ceil(metersToYards(range.min));
    const maxYd = Math.max(minYd, Math.floor(metersToYards(range.max)));
    const yards = minYd + Math.round(rng() * (maxYd - minYd));
    return yardsToMeters(yards);
  }
  return Math.round(range.min + rng() * (range.max - range.min));
}

/** Hunting targets are restricted to forest/mountain regardless of preference. */
export function resolveEnvironment(target, pref = 'random', rng = Math.random) {
  const isHunting = target && target.category === 'Hunting';
  if (isHunting) {
    if (pref !== 'random' && HUNTING_ENVIRONMENTS.includes(pref)) return pref;
    return pick(HUNTING_ENVIRONMENTS, rng);
  }
  return pref === 'random' || !ENVIRONMENTS.includes(pref) ? pick(ENVIRONMENTS, rng) : pref;
}

/** Builds a scenario object (no DOM). */
export function buildScenario(target, { distance = 'any', unit = 'metric', environment = 'random', rng = Math.random, distanceMeters } = {}) {
  const d = distanceMeters ?? rollDistanceMeters(target, distance, unit, rng);
  return {
    id: 'scen_' + Date.now().toString(36) + Math.floor(rng() * 1e9).toString(36),
    target,
    distance: d,
    // Kept for the scene renderer; the view starts centred on the target.
    offsetX: Number((rng() * 6 - 3).toFixed(1)),
    offsetY: Number((rng() * 4 - 2).toFixed(1)),
    environment: resolveEnvironment(target, environment, rng),
    milHeight: calculateMIL(target.height, d),
    milWidth: calculateMIL(target.width, d),
    answered: false
  };
}

/** Distance in the user's unit for display, e.g. "412 m" / "450 yd". */
export function formatDistance(meters, unit, { long = false } = {}) {
  if (unit === 'imperial') {
    const yd = Math.round(metersToYards(meters));
    return `${yd} ${long ? 'yards' : 'yd'}`;
  }
  const m = Math.round(meters);
  return `${m} ${long ? 'meters' : 'm'}`;
}

/**
 * Target size in the user's unit with enough precision for the MIL formula:
 * "36 mm", "22.5 cm", "1.64 m" / "1.42 in", "17.7 in". Rounding a 36 mm figure
 * to "4 cm" made a perfect reading come out 11% wrong.
 */
export function formatSize(meters, unit) {
  if (unit === 'imperial') {
    const inches = meters * 39.3701;
    return `${inches < 10 ? inches.toFixed(2) : inches.toFixed(1)} in`;
  }
  const mm = meters * 1000;
  if (mm < 100) return `${Math.round(mm * 10) / 10} mm`;
  if (meters < 1) return `${Math.round(mm) / 10} cm`;
  return `${Math.round(meters * 1000) / 1000} m`;
}

/**
 * Result-card arithmetic for one dimension in the user's unit, with the MIL
 * value shown to enough precision that the arithmetic reproduces the distance.
 */
export function formulaLine(sizeMeters, distanceMeters, unit, dimensionLabel) {
  const mil = calculateMIL(sizeMeters, distanceMeters);
  const milStr = mil >= 10 ? mil.toFixed(2) : mil.toFixed(3);
  if (unit === 'imperial') {
    const inches = sizeMeters * 39.3701;
    const yards = (inches * 27.778) / mil;
    return `${dimensionLabel}: (${inches.toFixed(1)} in × 27.78) / ${milStr} MIL = ${Math.round(yards)} yd`;
  }
  const meters = (sizeMeters * 1000) / mil;
  return `${dimensionLabel}: (${sizeMeters} m × 1000) / ${milStr} MIL = ${Math.round(meters)} m`;
}
