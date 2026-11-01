/* ==========================================================================
   Target validation & import planning (pure, DOM-free, unit-tested)
   Every target that comes from outside the built-in library — imported JSON,
   the custom-target editor, or localStorage (whose origin is shared with other
   sites) — passes through sanitizeTarget() before it is stored or rendered.
   ========================================================================== */

import { isSafeImageDataURI } from './utils.js';

export const LIMITS = {
  importFileBytes: 5 * 1024 * 1024,
  importItems: 500,
  imageDataChars: 700 * 1024, // ~500 KB of image bytes once base64-decoded
  name: 120,
  category: 60,
  description: 500
};

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const SVG_TYPE_RE = /^[a-z0-9_]{1,40}$/;

export function newTargetId() {
  return 'custom_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function positiveNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * Returns a clean custom-target object, or null if `t` is unusable.
 * Ids are restricted to a safe charset because they end up in HTML attributes and
 * DOM lookups (SEC-001); colours are restricted to #rrggbb because they are
 * interpolated into SVG markup (SEC-005).
 */
export function sanitizeTarget(t) {
  if (!t || typeof t !== 'object') return null;

  const name = typeof t.name === 'string' ? t.name.trim().slice(0, LIMITS.name) : '';
  const height = positiveNumber(t.height);
  const width = positiveNumber(t.width);
  if (!name || !height || !width) return null;

  const imageData = isSafeImageDataURI(t.imageData) && t.imageData.length <= LIMITS.imageDataChars ? t.imageData : '';
  let minDistance = positiveNumber(t.minDistance);
  let maxDistance = positiveNumber(t.maxDistance);
  if (!minDistance || !maxDistance || minDistance > maxDistance) {
    minDistance = undefined;
    maxDistance = undefined;
  }

  const target = {
    id: typeof t.id === 'string' && ID_RE.test(t.id) ? t.id : newTargetId(),
    name,
    category: typeof t.category === 'string' && t.category.trim() ? t.category.trim().slice(0, LIMITS.category) : 'Custom',
    height,
    width,
    description: typeof t.description === 'string' ? t.description.slice(0, LIMITS.description) : '',
    isBuiltIn: false,
    type: imageData ? 'image' : 'svg_shape',
    svgType: imageData ? undefined : (typeof t.svgType === 'string' && SVG_TYPE_RE.test(t.svgType) ? t.svgType : 'swe_b65'),
    imageData,
    minDistance,
    maxDistance
  };
  if (typeof t.color === 'string' && COLOR_RE.test(t.color)) target.color = t.color;
  if (typeof t.borderColor === 'string' && COLOR_RE.test(t.borderColor)) target.borderColor = t.borderColor;
  return target;
}

/** True if a raw imported record carried an image that was dropped for size. */
function imageTooLarge(t) {
  return t && typeof t.imageData === 'string' && t.imageData.length > LIMITS.imageDataChars;
}

/**
 * Plans an import without touching storage (audit BUG-006 / SEC-006).
 * - Entries whose id matches a built-in target are skipped: re-importing a full
 *   library export must not duplicate the built-ins.
 * - Entries whose id matches an existing custom target update it, so importing
 *   the same file twice is idempotent.
 * Returns { list, counts } where `list` is the complete new custom-target list.
 */
export function planImport(imported, { builtInIds, existingCustom }) {
  const counts = { added: 0, updated: 0, skippedBuiltIn: 0, invalid: 0, imageTooLarge: 0, overLimit: 0 };
  const list = existingCustom.slice();
  const indexById = new Map(list.map((t, i) => [t.id, i]));
  const builtIns = new Set(builtInIds);

  imported.forEach((raw, i) => {
    if (i >= LIMITS.importItems) { counts.overLimit++; return; }
    if (raw && typeof raw.id === 'string' && builtIns.has(raw.id)) { counts.skippedBuiltIn++; return; }
    if (imageTooLarge(raw)) { counts.imageTooLarge++; return; }
    const t = sanitizeTarget(raw);
    if (!t) { counts.invalid++; return; }
    if (builtIns.has(t.id)) t.id = newTargetId();
    if (indexById.has(t.id)) {
      list[indexById.get(t.id)] = t;
      counts.updated++;
    } else {
      indexById.set(t.id, list.length);
      list.push(t);
      counts.added++;
    }
  });
  return { list, counts };
}

/** Accepts both the current export envelope and legacy plain arrays. */
export function extractImportedTargets(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === 'object' && Array.isArray(parsed.targets)) return parsed.targets;
  return null;
}
