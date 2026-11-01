/* ==========================================================================
   Reticle designs
   --------------------------------------------------------------------------
   Every reticle is defined in MIL (milliradian) units with x to the right and y
   DOWN from the centre of the crosshair, exactly like a real first-focal-plane
   reticle is specified. Line widths are real etched widths in MIL too, clamped
   to stay crisp on screen. Fine subdivisions are dropped when they would be
   closer than a few pixels (they would only blur into a grey bar), and numerals
   only appear when there is room to read them.

   Designs are generic patterns of well-known reticle families, not copies of
   trademarked commercial reticles. Each carries its own help text, which the
   simulator's help panel, the Learn page and the scope readout all use.
   No DOM access: unit-tested in Node (tests/reticles-and-data.test.mjs).
   ========================================================================== */

const LINE = 0.035;      // main crosshair line width (MIL)
const FINE = 0.025;      // hash / tick width (MIL)
const MIN_PX = 0.9;      // never thinner than this on screen
const MAX_PX = 3.0;      // never heavier than this (except posts)
const MIN_TICK_GAP_PX = 3.2;
const MIN_LABEL_GAP_PX = 18;

class Builder {
  constructor(ppm) {
    this.ppm = ppm;
    this.items = [];
  }
  /** True if marks `gapMIL` apart are far enough apart on screen to draw. */
  shows(gapMIL) { return gapMIL * this.ppm >= MIN_TICK_GAP_PX; }
  labels(gapMIL) { return gapMIL * this.ppm >= MIN_LABEL_GAP_PX; }
  line(x1, y1, x2, y2, w = LINE, kind = 'line') { this.items.push({ t: 'line', x1, y1, x2, y2, w, kind }); return this; }
  /** Heavy post: width in MIL, not clamped to MAX_PX. */
  post(x1, y1, x2, y2, w) { this.items.push({ t: 'line', x1, y1, x2, y2, w, kind: 'post' }); return this; }
  dot(x, y, r) { this.items.push({ t: 'dot', x, y, r }); return this; }
  ring(x, y, r, w = LINE) { this.items.push({ t: 'ring', x, y, r, w }); return this; }
  arc(x, y, r, a0, a1, w = LINE) { this.items.push({ t: 'arc', x, y, r, a0, a1, w }); return this; }
  path(points, w = FINE, dashed = false) { this.items.push({ t: 'path', points, w, dashed }); return this; }
  chevron(x, y, size, w = LINE) { return this.path([[x - size, y + size], [x, y], [x + size, y + size]], w); }
  text(x, y, s, anchor = 'middle', baseline = 'middle') { this.items.push({ t: 'text', x, y, s, anchor, baseline }); return this; }

  /** Horizontal + vertical crosshair from `-a` to `+a` MIL (optionally open centre). */
  cross(a, { gap = 0, w = LINE, up = a, down = a } = {}) {
    if (gap > 0) {
      this.line(-a, 0, -gap, 0, w).line(gap, 0, a, 0, w);
      this.line(0, -up, 0, -gap, w).line(0, gap, 0, down, w);
    } else {
      this.line(-a, 0, a, 0, w).line(0, -up, 0, down, w);
    }
    return this;
  }

  /** Ticks across the horizontal line at multiples of `step` up to `a` MIL. */
  hTicks(step, a, half, { from = step, w = FINE, below = null } = {}) {
    if (!this.shows(step)) return this;
    const n = Math.round(a / step);
    for (let k = Math.round(from / step); k <= n; k++) {
      const x = k * step;
      const h = typeof half === 'function' ? half(x) : half;
      const lo = below === null ? -h : 0;
      const hi = below === null ? h : below;
      this.line(-x, lo, -x, hi, w, 'tick').line(x, lo, x, hi, w, 'tick');
    }
    return this;
  }

  /** Ticks across the vertical line, `up` and `down` reach in MIL. */
  vTicks(step, up, down, half, { from = step, w = FINE } = {}) {
    if (!this.shows(step)) return this;
    for (let k = Math.round(from / step); k * step <= Math.max(up, down) + 1e-9; k++) {
      const y = k * step;
      const h = typeof half === 'function' ? half(y) : half;
      if (y <= up + 1e-9) this.line(-h, -y, h, -y, w, 'tick');
      if (y <= down + 1e-9) this.line(-h, y, h, y, w, 'tick');
    }
    return this;
  }
}

const whole = (v) => Math.abs(v - Math.round(v)) < 1e-6;
const isHalf = (v) => Math.abs(v * 2 - Math.round(v * 2)) < 1e-6;

/* ---------------------------------------------------------------------------
   The designs
   --------------------------------------------------------------------------- */

export const RETICLE_DESIGNS = [
  {
    id: 'mil_dot',
    name: 'Mil-dot',
    family: 'Classic military',
    scale: 'dots 1 MIL apart',
    summary: 'The classic military ranging reticle: a thin crosshair with round dots exactly 1 MIL apart, centre to centre, and heavy posts starting 5 MIL from the centre.',
    marks: [
      'Four dots on each arm of the crosshair, their centres 1, 2, 3 and 4 MIL from the centre.',
      'Each dot is about 0.22 MIL across, so the gap between two dots is about 0.8 MIL.',
      'The thin crosshair ends 5 MIL from the centre, where the heavy posts begin; the post tip is a 5 MIL reference.',
      'There are no numbers: you count dots.'
    ],
    measure: [
      'Put one edge of the target on the centre of a dot (or on the crosshair).',
      'Count dot centres to the other edge. Estimate fractions: half a dot spacing is 0.5 MIL, the edge of a dot is about 0.1 MIL from its centre.',
      'Distance (m) = target size (mm) ÷ MIL reading.'
    ],
    example: { sizeM: 0.5, mil: 2, x: 2.6, note: 'A 0.5 m target spanning two dot spacings: 500 ÷ 2 = 250 m.' },
    draw(r) {
      r.cross(5);
      r.post(-15, 0, -5, 0, 0.28).post(5, 0, 15, 0, 0.28).post(0, -15, 0, -5, 0.28).post(0, 5, 0, 15, 0.28);
      for (let i = 1; i <= 4; i++) {
        r.dot(-i, 0, 0.11).dot(i, 0, 0.11).dot(0, -i, 0.11).dot(0, i, 0.11);
      }
    }
  },
  {
    id: 'mil_hash',
    name: 'MIL hash (½ MIL)',
    family: 'Modern hash-mark',
    scale: 'hashes ½ MIL',
    summary: 'A modern precision reticle with hash marks instead of dots: a long hash every whole MIL, a short hash at every half MIL, and numbers every 2 MIL. Hashes are easier to split than dots.',
    marks: [
      'Long hashes at 1, 2, 3 … 10 MIL on all four arms.',
      'Short hashes halfway between them, at 0.5, 1.5, 2.5 … MIL.',
      'Numbers 2, 4, 6, 8 at every second MIL.',
      'An open centre with a small floating dot; heavy posts start 10 MIL out.'
    ],
    measure: [
      'Put the target\'s bottom (or one side) on a long hash.',
      'Count whole MILs to the opposite edge, then read the last part against the half-MIL hash: half-way between a long and a short hash is about 0.25 MIL.',
      'Distance (m) = target size (mm) ÷ MIL reading.'
    ],
    example: { sizeM: 0.65, mil: 2.5, x: 2.2, note: 'A 65 cm figure spanning 2½ MIL: 650 ÷ 2.5 = 260 m.' },
    draw(r) {
      r.cross(10, { gap: 0.25 });
      r.dot(0, 0, 0.05);
      r.post(-16, 0, -10, 0, 0.3).post(10, 0, 16, 0, 0.3).post(0, 10, 0, 16, 0.3).post(0, -16, 0, -10, 0.3);
      r.hTicks(0.5, 10, (x) => whole(x) ? 0.3 : 0.15);
      r.vTicks(0.5, 10, 10, (y) => whole(y) ? 0.3 : 0.15);
      if (r.labels(2)) {
        for (const v of [2, 4, 6, 8]) {
          r.text(-v, -0.65, String(v)).text(v, -0.65, String(v));
          r.text(0.55, v, String(v), 'start').text(0.55, -v, String(v), 'start');
        }
      }
    }
  },
  {
    id: 'fine_milling',
    name: 'Fine milling (0.2 MIL)',
    family: 'Precision milling',
    scale: 'hashes 0.2 MIL',
    summary: 'A milling reticle with a hash every 0.2 MIL along both axes, a longer hash at each whole MIL and a medium one at each half MIL, for precise readings without estimating between marks.',
    marks: [
      'Short hashes every 0.2 MIL out to 10 MIL on each arm.',
      'Medium hashes at each half MIL, long hashes at each whole MIL.',
      'Numbers every 2 MIL.',
      'At low magnification the 0.2 MIL hashes merge; zoom in until you can count them.'
    ],
    measure: [
      'Zoom in until the 0.2 MIL hashes are clearly separated.',
      'Put one edge of the target on a long (whole-MIL) hash.',
      'Count whole MILs, then 0.2 MIL hashes, to the other edge. Each short hash is 0.2 MIL.',
      'Distance (m) = target size (mm) ÷ MIL reading.'
    ],
    example: { sizeM: 0.254, mil: 1.4, x: 1.6, note: 'A 10-inch (254 mm) plate spanning 1 MIL and two 0.2 MIL hashes: 254 ÷ 1.4 ≈ 181 m.' },
    draw(r) {
      r.cross(10, { gap: 0.2 });
      r.dot(0, 0, 0.04);
      r.post(-16, 0, -10, 0, 0.3).post(10, 0, 16, 0, 0.3).post(0, 10, 0, 16, 0.3).post(0, -16, 0, -10, 0.3);
      const len = (v) => whole(v) ? 0.3 : (isHalf(v) ? 0.2 : 0.12);
      r.hTicks(0.2, 10, len);
      r.vTicks(0.2, 10, 10, len);
      if (!r.shows(0.2)) { r.hTicks(1, 10, 0.3); r.vTicks(1, 10, 10, 0.3); }
      if (r.labels(2)) {
        for (const v of [2, 4, 6, 8]) {
          r.text(-v, -0.65, String(v)).text(v, -0.65, String(v));
          r.text(0.5, v, String(v), 'start').text(0.5, -v, String(v), 'start');
        }
      }
    }
  },
  {
    id: 'ranging_ladder',
    name: 'Ranging scale (0.1 MIL)',
    family: 'Dedicated rangefinding',
    scale: 'scale 0.1 MIL',
    summary: 'A clean crosshair with ½ MIL hashes plus a dedicated ranging scale in the lower left: an L-shaped bracket graduated in 0.1 MIL, used to measure a target to a tenth of a MIL.',
    marks: [
      'Crosshair hashes every ½ MIL, long at every whole MIL, out to 8 MIL.',
      'The ranging scale is an L: a flat horizontal bar 6 MIL below the centre and a vertical scale rising from its left end, 7 MIL left of centre.',
      'The vertical scale has a tick every 0.1 MIL, a longer tick every 0.5 MIL and numbers 1–5 at each whole MIL.',
      'The flat bar is the zero line; heights are read upwards from it.'
    ],
    measure: [
      'Move the scope so the target\'s base sits exactly on the flat bar of the L.',
      'Slide sideways until the target is next to the vertical scale.',
      'Read the scale level with the top of the target, to the nearest 0.1 MIL.',
      'Distance (m) = target height (mm) ÷ reading.'
    ],
    example: { sizeM: 0.45, mil: 1.8, ladder: true, note: 'A 45 cm figure reading 1.8 on the scale: 450 ÷ 1.8 = 250 m.' },
    draw(r) {
      r.cross(8, { gap: 0.3 });
      r.dot(0, 0, 0.04);
      r.post(-16, 0, -8, 0, 0.3).post(8, 0, 16, 0, 0.3).post(0, 8, 0, 16, 0.3).post(0, -16, 0, -8, 0.3);
      r.hTicks(0.5, 8, (x) => whole(x) ? 0.25 : 0.12);
      r.vTicks(0.5, 8, 8, (y) => whole(y) ? 0.25 : 0.12);
      // L-shaped ranging scale: zero bar at y = +6 from x = -7 to -2.5, scale up from x = -7.
      const x0 = -7, y0 = 6;
      r.line(x0, y0, -2.5, y0, LINE);
      r.line(x0, y0, x0, y0 - 5, LINE);
      for (let k = 1; k <= 50; k++) {
        const v = k / 10;
        const y = y0 - v;
        if (whole(v)) r.line(x0, y, x0 + 0.45, y, FINE, 'tick');
        else if (isHalf(v)) { if (r.shows(0.5)) r.line(x0, y, x0 + 0.3, y, FINE, 'tick'); }
        else if (r.shows(0.1)) r.line(x0, y, x0 + 0.18, y, FINE, 'tick');
        if (whole(v) && r.labels(1)) r.text(x0 - 0.3, y, String(v), 'end');
      }
      // horizontal zero bar also graduated in 0.1 MIL for width readings
      for (let k = 1; k <= 45; k++) {
        const v = k / 10;
        const x = x0 + v;
        if (whole(v)) r.line(x, y0, x, y0 - 0.45, FINE, 'tick');
        else if (isHalf(v)) { if (r.shows(0.5)) r.line(x, y0, x, y0 - 0.3, FINE, 'tick'); }
        else if (r.shows(0.1)) r.line(x, y0, x, y0 - 0.18, FINE, 'tick');
      }
    }
  },
  {
    id: 'christmas_tree',
    name: 'Christmas-tree grid',
    family: 'Holdover grid',
    scale: 'ticks 1 MIL, ½ MIL',
    summary: 'A grid reticle whose rows of holdover dots widen downwards like a Christmas tree. The horizontal stadia and centre column carry 1 MIL and ½ MIL marks for ranging; the tree is for wind and elevation holds.',
    marks: [
      'Horizontal line with long ticks every 1 MIL (numbered) and short ticks at each ½ MIL, out to 10 MIL.',
      'Vertical line with a numbered long tick every 1 MIL below the centre.',
      'Below the centre, one row per MIL with dots every 1 MIL, the row getting wider with each MIL of drop.'
    ],
    measure: [
      'Range on the horizontal line (widths) or the vertical line (heights), using the 1 MIL and ½ MIL ticks.',
      'Or use the grid: the dots form 1 MIL squares, handy for measuring both height and width at once.',
      'Distance (m) = target size (mm) ÷ MIL reading.'
    ],
    example: { sizeM: 0.45, mil: 1.5, x: 2, note: 'A 45 cm gong spanning 1½ MIL: 450 ÷ 1.5 = 300 m.' },
    draw(r) {
      r.line(-12, 0, 12, 0, LINE).line(0, -10, 0, 11, LINE);
      r.dot(0, 0, 0.06);
      r.hTicks(0.5, 10, (x) => whole(x) ? 0.25 : 0.12);
      r.vTicks(1, 10, 10, (y) => (y % 5 === 0 ? 0.35 : 0.25));
      if (r.labels(1)) for (let i = 1; i <= 10; i++) r.text(-i, -0.6, String(i)).text(i, -0.6, String(i));
      if (r.labels(1)) for (let i = 2; i <= 10; i += 2) r.text(-0.45, i, String(i), 'end');
      for (let row = 1; row <= 10; row++) {
        for (let k = 1; k <= Math.min(row, 9); k++) r.dot(-k, row, 0.05).dot(k, row, 0.05);
      }
    }
  },
  {
    id: 'tremor_style',
    name: 'Grid tree with 0.2 MIL ruler',
    family: 'Holdover grid',
    scale: 'fine ticks 0.2 MIL',
    summary: 'A holdover-grid reticle with a fine 0.2 MIL ruler around the centre for precise ranging, and dropping rows of wind dots below for holds.',
    marks: [
      'Horizontal and upper vertical line: a tick every 0.2 MIL out to 3 MIL, longer ticks at each whole MIL, numbered 1–3.',
      'Below the centre, a numbered short bar every 1 MIL of drop with wind dots 1 MIL apart.',
      'The ruler stops at 3 MIL; beyond that only the plain line continues.'
    ],
    measure: [
      'Zoom in until the 0.2 MIL ticks are clearly separated.',
      'Put one edge of the target on the centre or a whole-MIL tick of the ruler.',
      'Count whole MILs and 0.2 MIL ticks to the other edge.',
      'Distance (m) = target size (mm) ÷ MIL reading.'
    ],
    example: { sizeM: 0.254, mil: 0.6, x: 1.2, note: 'A 254 mm popper spanning three 0.2 MIL ticks: 254 ÷ 0.6 ≈ 423 m.' },
    draw(r) {
      r.line(-12, 0, 12, 0, LINE).line(0, -10, 0, 12, LINE);
      r.dot(0, 0, 0.05);
      const len = (v) => (whole(v) ? 0.3 : 0.12);
      r.hTicks(0.2, 3, len);
      if (!r.shows(0.2)) r.hTicks(1, 3, 0.3);
      if (r.shows(0.2)) for (let k = 1; k <= 15; k++) { const y = k / 5; r.line(-len(y), -y, len(y), -y, FINE, 'tick'); }
      if (r.labels(1)) for (let i = 1; i <= 3; i++) r.text(-i, -0.6, String(i)).text(i, -0.6, String(i));
      for (let drop = 1; drop <= 8; drop++) {
        r.line(-0.15, drop, 0.15, drop, FINE, 'tick');
        if (r.labels(1)) r.text(-0.35, drop, String(drop), 'end');
        for (let wind = 1; wind <= Math.floor(drop * 1.2); wind++) r.dot(-wind, drop, 0.05).dot(wind, drop, 0.05);
      }
    }
  },
  {
    id: 'mrad_grid',
    name: 'Square MIL grid',
    family: 'Grid',
    scale: 'grid squares 1 MIL',
    summary: 'A crosshair overlaid by a faint grid of 1 MIL squares in the centre area, with ½ MIL hashes on the main lines. Good for measuring height and width at the same time.',
    marks: [
      'Faint grid lines every 1 MIL out to 5 MIL in each direction, forming 1 × 1 MIL squares.',
      'Main crosshair with ½ MIL hashes out to 12 MIL, numbered every 2 MIL.'
    ],
    measure: [
      'Place the target inside the grid with one corner on a grid intersection.',
      'Count squares up for height and across for width; split a square by eye to the nearest 0.1 MIL, or use the ½ MIL hashes.',
      'Distance (m) = target size (mm) ÷ MIL reading.'
    ],
    example: { sizeM: 0.5, mil: 2, x: 2, note: 'A 50 cm target two squares tall: 500 ÷ 2 = 250 m.' },
    draw(r) {
      r.cross(12, { gap: 0 });
      r.dot(0, 0, 0.05);
      if (r.shows(1)) {
        for (let k = -5; k <= 5; k++) {
          if (k === 0) continue;
          r.line(k, -5, k, 5, FINE * 0.8, 'grid').line(-5, k, 5, k, FINE * 0.8, 'grid');
        }
      }
      r.hTicks(0.5, 12, (x) => whole(x) ? 0.25 : 0.12, { from: 0.5 });
      r.vTicks(0.5, 12, 12, (y) => whole(y) ? 0.25 : 0.12);
      if (r.labels(2)) for (const v of [2, 4, 6, 8, 10]) {
        r.text(-v, 0.65, String(v)).text(v, 0.65, String(v));
        r.text(0.45, -v, String(v), 'start').text(0.45, v, String(v), 'start');
      }
    }
  },
  {
    id: 'pso1_rangefinder',
    name: 'Rangefinder curve (1.7 m)',
    family: 'Classic military stadiametric',
    scale: 'curve = 1.7 m, ticks 1 MIL',
    summary: 'A stadiametric rangefinder in the style of the classic PSO-1 military scope: a curved line above a flat baseline whose gap equals a 1.7 m tall person at the distance written beside it. No arithmetic needed for 1.7 m targets.',
    marks: [
      'A flat baseline in the lower left, 5 MIL below the centre.',
      'A curve above it: at each point, the gap between curve and baseline is the height of a 1.7 m target at that distance.',
      'Numbers 2, 3, 4, 6, 8, 10 under the baseline mark the distance in hundreds of metres (200 m … 1000 m).',
      'An aiming chevron at the centre and a windage scale with a tick every 1 MIL.'
    ],
    measure: [
      'Put the feet of a standing person (≈1.7 m) on the baseline.',
      'Slide sideways until the top of the head just touches the curve.',
      'Read the distance from the number below that point (interpolate between numbers).',
      'For other target heights, scale it: distance = reading × (target height ÷ 1.7 m).'
    ],
    example: { sizeM: 1.7, rangefinder: 400, note: 'A 1.7 m figure filling the gap at the "4" mark is 400 m away.' },
    draw(r) {
      r.chevron(0, 0, 0.45, LINE * 1.4);
      r.line(0, 0.45, 0, 4, LINE);
      r.line(-10, 0, -1.2, 0, LINE).line(1.2, 0, 10, 0, LINE);
      r.hTicks(1, 10, (x) => (x % 5 === 0 ? 0.45 : 0.25), { from: 2, below: 0.35 });
      if (r.labels(1)) for (const v of [5, 10]) r.text(-v, 0.9, String(v)).text(v, 0.9, String(v));
      // range chevrons for long shots below the centre
      r.chevron(0, 1.5, 0.3, LINE).chevron(0, 2.5, 0.3, LINE).chevron(0, 3.5, 0.3, LINE);
      // Rangefinder: baseline y = +5 (MIL below centre), distances 200..1000 m left to right.
      const base = 5;
      const xOf = (d) => -10 + ((d - 200) / 800) * 8;
      r.line(xOf(200), base, xOf(1000), base, LINE);
      const pts = [];
      for (let d = 200; d <= 1000; d += 10) pts.push([xOf(d), base - 1700 / d]);
      r.path(pts, LINE, true);
      for (const d of [200, 300, 400, 600, 800, 1000]) {
        r.line(xOf(d), base, xOf(d), base + 0.25, FINE, 'tick');
        if (r.labels(0.9)) r.text(xOf(d), base + 0.75, String(d / 100));
      }
    }
  },
  {
    id: 'duplex_bdc',
    name: 'Duplex with BDC',
    family: 'Hunting',
    scale: 'posts end 4 MIL from centre',
    summary: 'A hunting duplex: heavy outer posts that thin to a fine centre crosshair, with bullet-drop (BDC) bars below. It has no ranging scale, but the post tips are a known size you can range with.',
    marks: [
      'Heavy posts end exactly 4 MIL from the centre on the left, right and top, so the gap between the left and right post tips is 8 MIL.',
      'The thin bottom line runs to 10 MIL, with five BDC bars below the centre for a typical rifle load; the labelled distances only apply to that load.',
      'The BDC bars are 3–12 MIL wide.'
    ],
    measure: [
      'Use the 4 MIL distance from the centre to a post tip: if a target fills the space from the centre to the post tip, it is 4 MIL tall.',
      'For smaller targets, estimate the fraction of the 4 MIL gap the target fills (half the gap = 2 MIL).',
      'Distance (m) = target size (mm) ÷ MIL estimate. Expect lower precision than with a hashed reticle.'
    ],
    example: { sizeM: 1.6, mil: 4, x: 1.2, toPost: true, note: 'A 1.6 m deer filling centre-to-post (4 MIL): 1600 ÷ 4 = 400 m.' },
    draw(r) {
      const g = 4;
      r.post(-16, 0, -g, 0, 0.32).post(g, 0, 16, 0, 0.32).post(0, -16, 0, -g, 0.32).post(0, 10, 0, 16, 0.32);
      r.line(-g, 0, g, 0, LINE).line(0, -g, 0, 10, LINE);
      r.dot(0, 0, 0.05);
      const bdc = [[1.5, 3, '200'], [3.2, 6, '300'], [5.2, 8, '400'], [7.5, 10, '500'], [10, 12, '600']];
      for (const [y, wid, lab] of bdc) {
        r.line(-wid / 2, y, wid / 2, y, LINE);
        if (r.labels(1.5)) r.text(wid / 2 + 0.35, y, lab, 'start');
      }
    }
  },
  {
    id: 'german_number4',
    name: 'German #4',
    family: 'Hunting',
    scale: 'ticks 1 MIL, posts start 2.5 MIL',
    summary: 'The traditional European hunting reticle: three heavy posts (left, right, bottom) with a thin upper post. Built for fast aiming in poor light; this version adds 1 MIL ticks in the open centre.',
    marks: [
      'Heavy posts start 2.5 MIL from the centre on the left, right and bottom.',
      'A thin crosshair fills the centre, with ticks at 1 and 2 MIL.',
      'The thin top post runs to the edge.'
    ],
    measure: [
      'Inside the centre: count the 1 MIL ticks across the target.',
      'The gap between the left and right post tips is 5 MIL; centre to post tip is 2.5 MIL.',
      'Distance (m) = target size (mm) ÷ MIL reading. Best for larger game at moderate range.'
    ],
    example: { sizeM: 0.95, mil: 2.5, x: 0.6, toPost: true, note: 'A 95 cm boar filling centre-to-post (2.5 MIL): 950 ÷ 2.5 = 380 m.' },
    draw(r) {
      const g = 2.5;
      r.post(-16, 0, -g, 0, 0.45).post(g, 0, 16, 0, 0.45).post(0, g, 0, 16, 0.45);
      r.line(-g, 0, g, 0, LINE).line(0, -16, 0, g, LINE);
      r.dot(0, 0, 0.05);
      for (let i = 1; i <= 2; i++) {
        r.line(-i, -0.15, -i, 0.15, FINE, 'tick').line(i, -0.15, i, 0.15, FINE, 'tick');
        r.line(-0.15, -i, 0.15, -i, FINE, 'tick').line(-0.15, i, 0.15, i, FINE, 'tick');
      }
    }
  },
  {
    id: 'circle_dot',
    name: 'Circle-dot',
    family: 'Fast acquisition',
    scale: 'ring 9 MIL radius, ticks 1 MIL',
    summary: 'A fast-acquisition reticle: a broken ring 18 MIL across around a centre dot, with 1 MIL ticks on the lower stadia. The ring is a known size you can range large targets with.',
    marks: [
      'An open ring with a radius of exactly 9 MIL (18 MIL across), with a gap at the top.',
      'A centre dot 0.25 MIL across.',
      'Horizontal ticks every 1 MIL to 10 MIL; vertical ticks below the centre every 1 MIL, numbered every 2.'
    ],
    measure: [
      'Small targets: count the 1 MIL ticks across the target.',
      'Large targets: compare with the ring; a target filling the ring\'s radius (centre to ring) is 9 MIL.',
      'Distance (m) = target size (mm) ÷ MIL reading.'
    ],
    example: { sizeM: 0.75, mil: 3, x: 1.5, note: 'A 75 cm IPSC target spanning 3 MIL: 750 ÷ 3 = 250 m.' },
    draw(r) {
      const gap = (20 * Math.PI) / 180;
      r.arc(0, 0, 9, -Math.PI / 2 + gap, (3 * Math.PI) / 2 - gap, LINE * 1.6);
      r.dot(0, 0, 0.125);
      r.line(-11, 0, -0.6, 0, LINE).line(0.6, 0, 11, 0, LINE).line(0, 0.6, 0, 11, LINE);
      r.hTicks(1, 10, 0.18);
      for (let i = 1; i <= 10; i++) {
        r.line(-0.18, i, 0.18, i, FINE, 'tick');
        if (i % 2 === 0 && r.labels(1)) r.text(0.45, i, String(i), 'start');
      }
    }
  },
  {
    id: 'crosshair_only',
    name: 'Fine crosshair',
    family: 'Minimal',
    scale: 'ticks 1 MIL',
    summary: 'A minimal thin crosshair with a tick every 1 MIL and a longer tick every 5 MIL. Uncluttered, but you must estimate fractions of a MIL by eye.',
    marks: [
      'Short ticks every 1 MIL out to 15 MIL on all four arms.',
      'Longer ticks at 5, 10 and 15 MIL.',
      'No numbers and no centre dot.'
    ],
    measure: [
      'Put one edge of the target on the crosshair or a tick.',
      'Count whole MILs to the other edge and estimate the remainder in tenths.',
      'Distance (m) = target size (mm) ÷ MIL reading.'
    ],
    example: { sizeM: 0.3, mil: 1, x: 1, note: 'A 30 cm gong spanning 1 MIL: 300 ÷ 1 = 300 m.' },
    draw(r) {
      r.cross(16);
      r.hTicks(1, 15, (x) => (x % 5 === 0 ? 0.35 : 0.18));
      r.vTicks(1, 15, 15, (y) => (y % 5 === 0 ? 0.35 : 0.18));
    }
  }
];

export const RETICLE_BY_ID = Object.fromEntries(RETICLE_DESIGNS.map(d => [d.id, d]));

/** Catalogue entries for selects and the readout. */
export const RETICLE_CATALOG = RETICLE_DESIGNS.map(({ id, name, family, scale, summary }) => ({ id, name, family, scale, description: summary }));

/** Geometry for `id` at `ppm` pixels per MIL (MIL coordinates). */
export function reticleItems(id, ppm) {
  const design = RETICLE_BY_ID[id] || RETICLE_BY_ID.mil_dot;
  const r = new Builder(ppm);
  design.draw(r);
  return r.items;
}

const n2 = (v) => Math.round(v * 100) / 100;

/**
 * SVG markup for a reticle centred at (cx, cy) px.
 * Thin etched lines in `color`; posts are drawn at their true MIL width.
 */
export function reticleSVG(id, { ppm, cx, cy, color = '#111111', fontPx = null, halo = false }) {
  const items = reticleItems(id, ppm);
  const X = (x) => n2(cx + x * ppm);
  const Y = (y) => n2(cy + y * ppm);
  const W = (w, kind) => n2(kind === 'post' ? Math.max(MIN_PX, w * ppm) : Math.min(MAX_PX, Math.max(MIN_PX, w * ppm)));
  const fpx = fontPx || Math.max(9, Math.min(13, 0.34 * ppm));
  const out = [];
  for (const it of items) {
    switch (it.t) {
      case 'line':
        out.push(`<line x1="${X(it.x1)}" y1="${Y(it.y1)}" x2="${X(it.x2)}" y2="${Y(it.y2)}" stroke-width="${W(it.w, it.kind)}"${it.kind === 'post' ? ' stroke-linecap="butt"' : ''}${it.kind === 'grid' ? ' stroke-opacity="0.45"' : ''}/>`);
        break;
      case 'dot':
        out.push(`<circle cx="${X(it.x)}" cy="${Y(it.y)}" r="${n2(Math.max(MIN_PX * 0.75, it.r * ppm))}" stroke="none"/>`);
        break;
      case 'ring':
        out.push(`<circle cx="${X(it.x)}" cy="${Y(it.y)}" r="${n2(it.r * ppm)}" fill="none" stroke-width="${W(it.w)}"/>`);
        break;
      case 'arc': {
        const R = it.r * ppm;
        const sx = cx + it.x * ppm + R * Math.cos(it.a0), sy = cy + it.y * ppm + R * Math.sin(it.a0);
        const ex = cx + it.x * ppm + R * Math.cos(it.a1), ey = cy + it.y * ppm + R * Math.sin(it.a1);
        const large = (it.a1 - it.a0) % (2 * Math.PI) > Math.PI ? 1 : 0;
        out.push(`<path d="M ${n2(sx)} ${n2(sy)} A ${n2(R)} ${n2(R)} 0 ${large} 1 ${n2(ex)} ${n2(ey)}" fill="none" stroke-width="${W(it.w)}"/>`);
        break;
      }
      case 'path':
        out.push(`<polyline points="${it.points.map(([x, y]) => `${X(x)},${Y(y)}`).join(' ')}" fill="none" stroke-width="${W(it.w)}"${it.dashed ? ` stroke-dasharray="${n2(Math.max(2, 0.12 * ppm))} ${n2(Math.max(2, 0.08 * ppm))}"` : ''}/>`);
        break;
      case 'text':
        out.push(`<text x="${X(it.x)}" y="${Y(it.y)}" font-size="${n2(fpx)}" text-anchor="${it.anchor}" dominant-baseline="${it.baseline === 'middle' ? 'central' : it.baseline}" stroke="none">${it.s}</text>`);
        break;
    }
  }
  const haloAttr = halo ? ' filter="url(#reticleHalo)"' : '';
  return `<g stroke="${color}" fill="${color}" stroke-linecap="round" font-family="Archivo, system-ui, sans-serif" font-weight="600"${haloAttr}>${out.join('')}</g>`;
}
