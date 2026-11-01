/* ==========================================================================
   Procedural textures for the scope scene (computed once, then cached):
   tileable fractal value noise for ground and foliage, and a cloud layer.
   ========================================================================== */

const cache = new Map();

function hash2(x, y, seed) {
  const s = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
  return s - Math.floor(s);
}

const smooth = (t) => t * t * (3 - 2 * t);

/** Tileable fractal value noise in [0, 1], `size` x `size`. */
function fbm(size, { base = 4, octaves = 5, seed = 1, persistence = 0.5 }) {
  const out = new Float32Array(size * size);
  let amp = 1;
  let total = 0;
  for (let o = 0; o < octaves; o++) {
    const cells = base << o;
    const cell = size / cells;
    for (let y = 0; y < size; y++) {
      const gy = y / cell;
      const y0 = Math.floor(gy);
      const fy = smooth(gy - y0);
      for (let x = 0; x < size; x++) {
        const gx = x / cell;
        const x0 = Math.floor(gx);
        const fx = smooth(gx - x0);
        // wrap lattice so the texture tiles seamlessly
        const a = hash2(x0 % cells, y0 % cells, seed + o);
        const b = hash2((x0 + 1) % cells, y0 % cells, seed + o);
        const c = hash2(x0 % cells, (y0 + 1) % cells, seed + o);
        const d = hash2((x0 + 1) % cells, (y0 + 1) % cells, seed + o);
        out[y * size + x] += amp * (a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy);
      }
    }
    total += amp;
    amp *= persistence;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

function toCanvas(size, values, map) {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < values.length; i++) {
    const [r, g, b, a] = map(values[i]);
    img.data[i * 4] = r; img.data[i * 4 + 1] = g; img.data[i * 4 + 2] = b; img.data[i * 4 + 3] = a;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** Grey fractal noise around mid-grey, for 'soft-light' overlays (lightens and darkens). */
export function grainTexture(key, { base = 4, octaves = 5, seed = 1, contrast = 1.6 } = {}) {
  const id = `grain:${key}`;
  if (!cache.has(id)) {
    const size = 256;
    const v = fbm(size, { base, octaves, seed });
    cache.set(id, toCanvas(size, v, (n) => {
      const g = Math.max(0, Math.min(255, 128 + (n - 0.5) * 255 * contrast));
      return [g, g, g, 255];
    }));
  }
  return cache.get(id);
}

/** Soft cumulus-like cloud sheet: white with alpha, tileable horizontally. */
export function cloudTexture(key, { seed = 3, cover = 0.52, softness = 0.3, tint = [255, 255, 255] } = {}) {
  const id = `cloud:${key}`;
  if (!cache.has(id)) {
    const size = 256;
    const v = fbm(size, { base: 2, octaves: 6, seed, persistence: 0.5 });
    cache.set(id, toCanvas(size, v, (n) => {
      const t = Math.max(0, Math.min(1, (n - cover) / softness));
      return [tint[0], tint[1], tint[2], Math.round(smooth(t) * 225)];
    }));
  }
  return cache.get(id);
}
