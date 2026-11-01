/* ==========================================================================
   Target artwork: animals, people, steel and IPSC targets
   --------------------------------------------------------------------------
   Every silhouette is assembled from simple parts (ellipses, jointed legs,
   stroked antlers) in real-world CENTIMETRES, standing on the ground at y = 0
   with y pointing up. The builder tracks the exact extent of every part, so the
   returned viewBox is the artwork's true bounding box: when the scope stretches
   it to the target's declared width x height, the visible outline is exactly the
   size the player is told to measure. data/targets.json stores the same
   dimensions (tests/target-art.test.mjs checks they agree).
   No imports: utils.js depends on this module.
   ========================================================================== */

let gradientCounter = 0;

/**
 * Surface texture clipped exactly to the silhouette (operator "in" SourceAlpha),
 * so it adds grain without changing the outline the player measures.
 * `freq` is in viewBox units (cm for artwork, 1/100 for 100-unit shapes).
 */
export function textureFilter(id, { freq = '0.5 0.85', dark = 0.2, light = 0.08, seed = 7 } = {}) {
  return `<filter id="${id}" x="-10%" y="-10%" width="120%" height="120%" color-interpolation-filters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency="${freq}" numOctaves="3" seed="${seed}" result="noise"/>
      <feColorMatrix in="noise" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  ${(-2 * dark).toFixed(3)} 0 0 0 ${dark.toFixed(3)}" result="shadeA"/>
      <feComposite in="shadeA" in2="SourceAlpha" operator="in" result="shade"/>
      <feColorMatrix in="noise" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  ${(2 * light).toFixed(3)} 0 0 0 ${(-light).toFixed(3)}" result="lightA"/>
      <feComposite in="lightA" in2="SourceAlpha" operator="in" result="glint"/>
      <feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="shade"/><feMergeNode in="glint"/></feMerge>
    </filter>`;
}

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const c = (v) => Math.max(0, Math.min(255, Math.round(v + amt))).toString(16).padStart(2, '0');
  return `#${c((n >> 16) & 255)}${c((n >> 8) & 255)}${c(n & 255)}`;
}

const r2 = (v) => Math.round(v * 100) / 100;

class Art {
  constructor() {
    this.layers = { back: [], body: [], detail: [], top: [] };
    this.x0 = Infinity; this.x1 = -Infinity; this.y0 = Infinity; this.y1 = -Infinity;
  }

  grow(x, y, pad = 0) {
    this.x0 = Math.min(this.x0, x - pad); this.x1 = Math.max(this.x1, x + pad);
    this.y0 = Math.min(this.y0, y - pad); this.y1 = Math.max(this.y1, y + pad);
  }

  /** Ellipse at (cx, cy) with radii, rotated `rot` degrees (counter-clockwise, y up). */
  ellipse(cx, cy, rx, ry, rot = 0, layer = 'body', fill = null) {
    const a = (rot * Math.PI) / 180;
    const hw = Math.sqrt((rx * Math.cos(a)) ** 2 + (ry * Math.sin(a)) ** 2);
    const hh = Math.sqrt((rx * Math.sin(a)) ** 2 + (ry * Math.cos(a)) ** 2);
    this.grow(cx - hw, cy - hh); this.grow(cx + hw, cy + hh);
    this.layers[layer].push({ kind: 'ellipse', cx, cy, rx, ry, rot, fill });
    return this;
  }

  poly(points, layer = 'body', fill = null) {
    points.forEach(([x, y]) => this.grow(x, y));
    this.layers[layer].push({ kind: 'poly', points, fill });
    return this;
  }

  /** Smooth closed outline guided by `points` (quadratic segments between midpoints). */
  blob(points, layer = 'body', fill = null) {
    // The curve stays inside the control points' hull and need not reach them, so
    // grow the bounding box by the curve itself, not by the control points.
    const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    points.forEach((c, i) => {
      const p0 = mid(points[(i - 1 + points.length) % points.length], c);
      const p2 = mid(c, points[(i + 1) % points.length]);
      for (let k = 0; k <= 24; k++) {
        const t = k / 24, u = 1 - t;
        this.grow(u * u * p0[0] + 2 * u * t * c[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * c[1] + t * t * p2[1]);
      }
    });
    this.layers[layer].push({ kind: 'blob', points, fill });
    return this;
  }

  /** Open stroked line (antlers, beards, tails). */
  line(points, width, layer = 'body', stroke = null) {
    points.forEach(([x, y]) => this.grow(x, y, width / 2));
    this.layers[layer].push({ kind: 'line', points, width, stroke });
    return this;
  }

  /**
   * Leg from a hip/shoulder joint down to the ground through a knee/hock, tapering.
   * The joints get round caps so the leg blends into the body.
   */
  leg(top, knee, footX, wTop, wKnee, wFoot, layer = 'body', fill = null) {
    const [tx, ty] = top; const [kx, ky] = knee;
    this.poly([
      [tx - wTop / 2, ty], [kx - wKnee / 2, ky], [footX - wFoot / 2, 0],
      [footX + wFoot / 2, 0], [kx + wKnee / 2, ky], [tx + wTop / 2, ty]
    ], layer, fill);
    this.ellipse(kx, ky, wKnee / 2, wKnee / 2, 0, layer, fill);
    return this;
  }

  /** SVG markup plus the true size in centimetres. */
  render(color, { outline = true, shadeAmt = 22, stroke = null, texture = null } = {}) {
    const w = this.x1 - this.x0;
    const h = this.y1 - this.y0;
    const id = `tg${++gradientCounter}`;
    const outlineW = Math.max(w, h) * 0.008;
    const light = shade(color, shadeAmt);
    const dark = shade(color, -shadeAmt);
    // y is up in the model; SVG y is down, so negate.
    const P = (x, y) => `${r2(x)},${r2(-y)}`;
    const el = (p, fill, extra = '') => {
      const f = fill || `url(#${id})`;
      switch (p.kind) {
        case 'ellipse':
          return `<ellipse cx="${r2(p.cx)}" cy="${r2(-p.cy)}" rx="${r2(p.rx)}" ry="${r2(p.ry)}" transform="rotate(${r2(-p.rot)} ${r2(p.cx)} ${r2(-p.cy)})" fill="${p.fill || f}"${extra}/>`;
        case 'poly':
          return `<polygon points="${p.points.map(([x, y]) => P(x, y)).join(' ')}" fill="${p.fill || f}"${extra}/>`;
        case 'blob': {
          const pts = p.points;
          const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
          let d = `M${P(...mid(pts[pts.length - 1], pts[0]))}`;
          pts.forEach((pt, i) => { d += ` Q${P(...pt)} ${P(...mid(pt, pts[(i + 1) % pts.length]))}`; });
          return `<path d="${d}Z" fill="${p.fill || f}"${extra}/>`;
        }
        case 'line':
          return `<polyline points="${p.points.map(([x, y]) => P(x, y)).join(' ')}" fill="none" stroke="${p.stroke || stroke || f}" stroke-width="${r2(p.width)}" stroke-linecap="round" stroke-linejoin="round"${extra}/>`;
        default: return '';
      }
    };
    const outlineOf = (p) => {
      if (p.kind === 'line') {
        return `<polyline points="${p.points.map(([x, y]) => P(x, y)).join(' ')}" fill="none" stroke="${shade(color, -60)}" stroke-width="${r2(p.width + outlineW * 2)}" stroke-linecap="round" stroke-linejoin="round"/>`;
      }
      return el(p, shade(color, -60), ` stroke="${shade(color, -60)}" stroke-width="${r2(outlineW * 2)}" stroke-linejoin="round"`).replace(/fill="[^"]*"/, `fill="${shade(color, -60)}"`);
    };
    const silhouette = [...this.layers.back, ...this.layers.body];
    // Outline pass sits under the fills, so only the outer edge shows. The outline
    // extends outlineW beyond the parts; the returned viewBox includes it.
    const inner = outline ? silhouette.map(outlineOf).join('') : '';
    const tex = texture ? textureFilter(`${id}t`, texture) : '';
    // Body light from above: a soft sheen across the back, then the base gradient.
    const svg = `
      <defs><linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="0" y1="${r2(-this.y1)}" x2="0" y2="${r2(-this.y0)}">
        <stop offset="0" stop-color="${light}"/><stop offset="0.55" stop-color="${color}"/><stop offset="1" stop-color="${dark}"/>
      </linearGradient>${tex}</defs>
      <g${texture ? ` filter="url(#${id}t)"` : ''}>
      ${inner}
      ${this.layers.back.map(p => el(p, p.fill || shade(color, -18))).join('')}
      ${this.layers.body.map(p => el(p)).join('')}
      ${this.layers.detail.map(p => el(p, p.fill)).join('')}
      ${this.layers.top.map(p => el(p, p.fill)).join('')}
      </g>`;
    // Outline strokes extend outlineW beyond the parts; include them in the box.
    const pad = outline ? outlineW : 0;
    return {
      svg,
      viewBox: `${r2(this.x0 - pad)} ${r2(-this.y1 - pad)} ${r2(w + pad * 2)} ${r2(h + pad * 2)}`,
      widthCm: w + pad * 2,
      heightCm: h + pad * 2
    };
  }
}

/* ---------------------------------------------------------------------------
   Species. All measurements in cm; the animal faces right, ground at y = 0.
   --------------------------------------------------------------------------- */

const SPECIES = {
  // White-tailed deer buck, ~95 cm at the shoulder.
  deer(a) {
    a.leg([118, 62], [116, 30], 117, 9, 5, 4, 'back');
    a.leg([52, 66], [60, 36], 53, 12, 6, 4, 'back');
    a.ellipse(84, 74, 44, 21, 2);            // barrel
    a.ellipse(50, 77, 22, 22);               // haunch
    a.ellipse(112, 75, 19, 22, 0);           // chest
    a.ellipse(133, 98, 23, 10, 58);          // neck
    a.ellipse(149, 115, 13, 8, -12);         // head
    a.ellipse(160, 109, 8, 5, -28);          // muzzle
    a.poly([[141, 119], [131, 133], [145, 123]]); // ear
    a.leg([112, 60], [110, 30], 112, 9, 5, 4);
    a.leg([46, 66], [54, 36], 47, 12, 6, 4);
    a.ellipse(28, 84, 8, 4, 40);             // tail
    a.ellipse(26, 82, 6, 3, 40, 'detail', '#f1ece2'); // white tail underside
    a.ellipse(152, 116, 1.6, 1.6, 0, 'detail', '#111');
    // Antlers: main beam curving back then forward, with upright tines.
    const bone = '#cdbb98';
    a.line([[146, 121], [140, 136], [145, 148], [158, 152]], 3, 'top', bone);
    a.line([[142, 140], [138, 154]], 2.4, 'top', bone);
    a.line([[147, 148], [147, 160]], 2.4, 'top', bone);
    a.line([[153, 151], [156, 160]], 2.2, 'top', bone);
  },

  // Bull elk (wapiti), ~150 cm at the shoulder, large swept-back antlers.
  elk(a) {
    a.leg([186, 92], [184, 44], 186, 14, 8, 6, 'back');
    a.leg([82, 98], [94, 52], 84, 18, 9, 6, 'back');
    a.ellipse(132, 112, 66, 31, 3);
    a.ellipse(80, 114, 32, 32);
    a.ellipse(178, 114, 30, 33);
    a.ellipse(208, 146, 34, 17, 55);   // neck with mane
    a.ellipse(232, 168, 20, 12, -15);  // head
    a.ellipse(250, 160, 12, 8, -30);   // muzzle
    a.poly([[221, 176], [208, 192], [228, 181]]);
    a.leg([178, 88], [176, 44], 178, 14, 8, 6);
    a.leg([74, 98], [86, 52], 76, 18, 9, 6);
    a.ellipse(48, 124, 9, 6, 30);
    a.ellipse(56, 118, 16, 16, 0, 'detail', shade('#7a6040', 50)); // pale rump patch
    a.ellipse(236, 170, 2.2, 2.2, 0, 'detail', '#111');
    const bone = '#d2c3a2';
    a.line([[226, 178], [214, 206], [200, 236], [192, 262], [196, 274]], 4.5, 'top', bone);
    a.line([[220, 192], [238, 204]], 3.2, 'top', bone);
    a.line([[211, 212], [228, 226]], 3.2, 'top', bone);
    a.line([[203, 232], [220, 246]], 3, 'top', bone);
    a.line([[197, 252], [212, 266]], 2.8, 'top', bone);
  },

  // Bull moose (älg), ~190 cm at the shoulder: long legs, shoulder hump, palmate antlers.
  moose(a) {
    a.leg([214, 118], [212, 56], 214, 17, 9, 7, 'back');
    a.leg([96, 122], [110, 62], 98, 21, 10, 7, 'back');
    a.ellipse(150, 140, 74, 36, 4);
    a.ellipse(96, 140, 34, 34);
    a.ellipse(204, 148, 34, 40);
    a.ellipse(196, 182, 30, 14, 10);        // shoulder hump
    a.ellipse(236, 172, 30, 17, 40);        // neck
    a.ellipse(262, 176, 22, 13, -25);       // head
    a.ellipse(284, 162, 15, 11, -40);       // long drooping muzzle
    a.ellipse(250, 146, 5, 12, -10);        // bell (dewlap)
    a.poly([[250, 186], [240, 200], [256, 190]]);
    a.leg([206, 112], [204, 56], 206, 17, 9, 7);
    a.leg([90, 122], [104, 62], 92, 21, 10, 7);
    a.ellipse(264, 178, 2.4, 2.4, 0, 'detail', '#111');
    // Palmate antler: a broad flattened palm with points along its edge.
    const bone = '#c9b48c';
    a.line([[254, 186], [244, 192]], 6, 'top', bone);                       // pedicle/beam
    a.blob([[246, 190], [226, 194], [204, 204], [192, 218], [196, 226], [204, 222],
            [210, 232], [218, 226], [226, 236], [234, 228], [242, 238], [250, 228],
            [258, 236], [262, 222], [258, 204], [252, 194]], 'top', bone);   // palm with tines
  },

  // Black bear on all fours, ~95 cm at the shoulder.
  bear(a) {
    a.leg([118, 50], [118, 22], 121, 22, 15, 15, 'back');
    a.leg([46, 52], [52, 24], 48, 26, 16, 15, 'back');
    a.blob([[18, 58], [26, 82], [60, 92], [100, 96], [128, 92], [146, 76], [146, 50], [120, 40], [70, 40], [30, 42]]);
    a.ellipse(152, 72, 18, 15, -10);       // head
    a.ellipse(167, 66, 10, 7.5, -15);      // snout
    a.ellipse(146, 86, 5, 5);              // ear
    a.leg([112, 48], [112, 22], 115, 22, 15, 15);
    a.leg([40, 52], [46, 24], 42, 26, 16, 15);
    a.ellipse(173, 67, 2.6, 2.4, 0, 'detail', '#111');
    a.ellipse(156, 75, 1.8, 1.8, 0, 'detail', '#000');
  },

  // Wild boar, ~85 cm at the shoulder: wedge head, high shoulders, bristle ridge.
  boar(a) {
    a.leg([118, 42], [118, 20], 120, 12, 7, 6, 'back');
    a.leg([50, 44], [54, 22], 50, 14, 8, 6, 'back');
    a.blob([[20, 52], [30, 72], [62, 82], [96, 90], [118, 92], [132, 82], [138, 58], [128, 36], [90, 32], [50, 34], [26, 38]]);
    a.poly([[126, 78], [134, 76], [168, 46], [170, 38], [160, 34], [130, 44]]); // wedge head
    a.ellipse(167, 41, 4, 5, 0);           // snout disc
    a.poly([[134, 74], [128, 90], [140, 78]]); // ear
    a.leg([112, 40], [112, 20], 114, 12, 7, 6);
    a.leg([44, 44], [48, 22], 44, 14, 8, 6);
    a.line([[20, 56], [12, 46]], 3);        // tail
    a.line([[158, 40], [162, 46]], 1.6, 'detail', '#e9e3d4'); // tusk
    a.ellipse(146, 58, 1.8, 1.8, 0, 'detail', '#111');
  },

  // Grey wolf, ~80 cm at the shoulder, bushy tail held low.
  wolf(a) {
    a.leg([132, 50], [130, 26], 133, 7, 4.5, 4.5, 'back');
    a.leg([66, 52], [72, 26], 64, 10, 5, 4.5, 'back');
    a.ellipse(98, 62, 42, 16, 2);
    a.ellipse(126, 62, 17, 18);
    a.ellipse(66, 63, 15, 15);
    a.ellipse(144, 74, 15, 9, 45);         // neck
    a.ellipse(156, 82, 12, 9, -10);        // head
    a.ellipse(168, 77, 9, 5, -15);         // muzzle
    a.poly([[150, 88], [146, 100], [156, 90]]); // ear
    a.leg([128, 48], [126, 26], 129, 7, 4.5, 4.5);
    a.leg([60, 52], [66, 26], 58, 10, 5, 4.5);
    a.blob([[54, 66], [40, 60], [24, 44], [16, 34], [24, 32], [38, 42], [52, 56]]); // tail
    a.ellipse(160, 84, 1.6, 1.6, 0, 'detail', '#111');
  },

  // Coyote, ~60 cm at the shoulder: slimmer than a wolf, large ears.
  coyote(a) {
    a.leg([98, 38], [96, 20], 98, 5.5, 3.5, 3.5, 'back');
    a.leg([48, 40], [53, 20], 46, 8, 4, 3.5, 'back');
    a.ellipse(72, 47, 32, 12, 2);
    a.ellipse(94, 48, 13, 14);
    a.ellipse(48, 48, 12, 12);
    a.ellipse(106, 57, 11, 7, 45);
    a.ellipse(116, 63, 9, 7, -10);
    a.ellipse(126, 59, 7, 4, -15);
    a.poly([[111, 68], [108, 80], [117, 70]]);
    a.leg([94, 36], [92, 20], 94, 5.5, 3.5, 3.5);
    a.leg([43, 40], [48, 20], 41, 8, 4, 3.5);
    a.blob([[38, 50], [26, 44], [12, 30], [8, 24], [16, 24], [28, 34], [38, 44]]);
    a.ellipse(120, 64, 1.3, 1.3, 0, 'detail', '#111');
  },

  // Red fox, ~40 cm at the shoulder: long bushy tail with a white tip.
  fox(a) {
    a.leg([79, 30], [77, 12], 78, 4, 2.4, 2.4, 'back', '#2a1a12');
    a.leg([47, 31], [49, 12], 45, 5.5, 2.6, 2.4, 'back', '#2a1a12');
    a.ellipse(62, 31, 22, 9, 2);
    a.ellipse(76, 31, 9, 10);
    a.ellipse(46, 32, 8, 8);
    a.ellipse(86, 38, 8, 5, 45);
    a.ellipse(93, 42, 7, 5.5, -8);
    a.ellipse(101, 39, 5.5, 3, -12);
    a.poly([[89, 46], [87, 54], [93, 48]]);
    a.leg([76, 30], [74, 12], 75, 4, 2.4, 2.4, 'back', '#3a2418');
    a.leg([44, 31], [46, 12], 42, 5.5, 2.6, 2.4, 'back', '#3a2418');
    a.blob([[40, 34], [26, 30], [8, 22], [1, 18], [6, 13], [22, 20], [38, 28]]); // brush
    a.ellipse(3.5, 16, 4, 3, 30, 'detail', '#f2eee6');                         // white tip
    a.ellipse(84, 33, 5, 4, 0, 'detail', '#efe7da');                            // white chest
    a.ellipse(96, 43, 1.1, 1.1, 0, 'detail', '#111');
  },

  // Reindeer, ~110 cm at the shoulder, tall branching antlers on both sexes.
  reindeer(a) {
    a.leg([140, 66], [138, 32], 140, 11, 6, 6, 'back');
    a.leg([62, 70], [70, 36], 62, 14, 7, 6, 'back');
    a.ellipse(100, 80, 50, 24, 3);
    a.ellipse(62, 82, 24, 24);
    a.ellipse(134, 80, 22, 26);
    a.ellipse(156, 104, 22, 12, 50);
    a.ellipse(172, 122, 14, 9, -15);
    a.ellipse(185, 115, 9, 6.5, -30);
    a.poly([[164, 128], [156, 140], [168, 131]]);
    a.leg([134, 64], [132, 32], 134, 11, 6, 6);
    a.leg([56, 70], [64, 36], 56, 14, 7, 6);
    a.ellipse(38, 92, 6, 4, 30);
    a.ellipse(175, 124, 1.8, 1.8, 0, 'detail', '#111');
    const bone = '#d8ccb0';
    a.line([[168, 130], [160, 150], [154, 172], [158, 192], [170, 200]], 3.4, 'top', bone);
    a.line([[162, 146], [176, 150], [184, 146]], 2.6, 'top', bone);
    a.line([[156, 166], [146, 176]], 2.4, 'top', bone);
    a.line([[156, 184], [168, 186]], 2.4, 'top', bone);
    a.line([[171, 131], [168, 150], [172, 170], [182, 182]], 2.6, 'back', shade(bone, -30));
  },

  // Mountain hare, crouched, ears up.
  hare(a) {
    a.blob([[4, 4], [2, 16], [10, 28], [26, 32], [40, 28], [46, 18], [44, 4], [30, 0], [12, 0]]);
    a.ellipse(46, 26, 8, 7, -10);          // head
    a.ellipse(52, 22, 4.5, 3.5, -20);      // muzzle
    a.ellipse(40, 38, 2.6, 10, 18);        // ear
    a.ellipse(44, 37, 2.6, 10, 8, 'back');
    a.ellipse(42.8, 46.4, 2.1, 2.1, 0, 'detail', '#1c1c1c'); // black ear tip
    a.ellipse(48, 27, 1.3, 1.3, 0, 'detail', '#111');
    a.ellipse(3, 14, 3.5, 3.5, 0, 'detail', '#f4f1ea'); // scut
  },

  // Cock pheasant: copper body, dark green head with red wattle, very long tail.
  pheasant(a) {
    a.line([[30, 14], [16, 20], [2, 26]], 4, 'back');              // tail feathers
    a.line([[28, 16], [10, 26], [0, 31]], 3, 'back');
    a.ellipse(42, 15, 16, 10, 8);                                   // body
    a.ellipse(56, 22, 5, 9, -25);                                   // neck
    a.ellipse(61, 30, 5, 4, 0, 'body', '#1f3b2c');                  // dark green head
    a.ellipse(62, 29, 2.8, 2.4, 0, 'detail', '#b8241d');            // red wattle
    a.poly([[65, 31], [69, 29.5], [65, 28]], 'detail', '#d9c08a');  // beak
    a.ellipse(55, 22, 5, 1.6, -25, 'detail', '#f1f1ea');            // white neck ring
    a.line([[40, 6], [40, 0]], 1.2, 'body', '#6b5a40');
    a.line([[46, 6], [47, 0]], 1.2, 'body', '#6b5a40');
  },

  // Wild turkey tom, upright with tail partly fanned.
  turkey(a) {
    a.blob([[10, 46], [6, 70], [14, 90], [28, 96], [38, 86], [40, 62], [32, 46]], 'back'); // tail fan
    a.ellipse(48, 52, 26, 22, 10);                                  // body
    a.ellipse(70, 68, 6, 16, -10);                                  // neck
    a.ellipse(74, 84, 6, 5);                                        // head
    a.ellipse(76, 78, 3, 5, 0, 'detail', '#b8241d');                // wattle
    a.poly([[79, 85], [84, 83], [79, 82]], 'detail', '#d9c08a');
    a.line([[64, 54], [66, 40]], 1.6, 'detail', '#1a1410');         // beard
    a.leg([46, 34], [48, 16], 46, 4, 3, 3, 'body', '#9b5b4a');
    a.leg([56, 34], [57, 16], 58, 4, 3, 3, 'body', '#9b5b4a');
  }
};

/* ---------------------------------------------------------------------------
   People, steel and paper targets (also in cm).
   --------------------------------------------------------------------------- */

function soldierFull(a) {
  // Standing figure, ~180 cm, arms at the sides.
  a.ellipse(25, 168, 9.5, 12);                      // head
  a.poly([[21, 155], [29, 155], [30, 148], [20, 148]]); // neck
  a.blob([[4, 140], [10, 150], [25, 152], [40, 150], [46, 140], [44, 100], [40, 86], [10, 86], [6, 100]]); // torso
  a.poly([[2, 140], [8, 144], [12, 104], [9, 86], [3, 88], [0, 104]]);   // left arm
  a.poly([[48, 140], [42, 144], [38, 104], [41, 86], [47, 88], [50, 104]]); // right arm
  a.poly([[10, 90], [24, 90], [23, 46], [21, 0], [12, 0], [12, 46]]);    // left leg
  a.poly([[26, 90], [40, 90], [38, 46], [38, 0], [29, 0], [27, 46]]);    // right leg
}

function soldierHalf(a) {
  // Upper body from the waist, ~90 cm.
  a.ellipse(25, 78, 9.5, 12);
  a.poly([[21, 65], [29, 65], [30, 58], [20, 58]]);
  a.blob([[4, 50], [10, 60], [25, 62], [40, 60], [46, 50], [46, 10], [44, 0], [6, 0], [4, 10]]);
  a.poly([[2, 50], [8, 54], [12, 14], [9, 0], [3, 2], [0, 14]]);
  a.poly([[48, 50], [42, 54], [38, 14], [41, 0], [47, 2], [50, 14]]);
}

function eType(a) {
  // Head-and-shoulders figure: rounded head on wide shoulders.
  a.ellipse(22.5, 41, 8, 9);
  a.poly([[19, 34], [26, 34], [27, 28], [18, 28]]);
  a.blob([[0, 0], [0, 16], [6, 26], [22.5, 30], [39, 26], [45, 16], [45, 0]]);
}

function ipscMetric(a, { classic = false } = {}) {
  if (classic) {
    // Octagonal classic target, 46 x 58 cm, no head.
    a.poly([[10, 0], [36, 0], [46, 10], [46, 48], [36, 58], [10, 58], [0, 48], [0, 10]]);
    return;
  }
  // Metric target: 45 x 75 cm body with a 15 cm head, cut shoulders.
  a.poly([[0, 0], [45, 0], [45, 45], [37.5, 60], [30, 60], [30, 75], [15, 75], [15, 60], [7.5, 60], [0, 45]]);
}

function prsPopper(a, w, h) {
  // Round head on a tapering neck and base plate (pepper-popper style), sized to w x h cm.
  const headR = w / 2;
  a.ellipse(w / 2, h - headR, headR, headR);
  a.poly([[w * 0.3, h - headR * 1.6], [w * 0.7, h - headR * 1.6], [w * 0.62, h * 0.12], [w * 0.38, h * 0.12]]);
  a.poly([[w * 0.18, h * 0.12], [w * 0.82, h * 0.12], [w * 0.82, 0], [w * 0.18, 0]]);
}

const PAPER_ZONES = {
  ipsc_metric(w) { // A/C/D zone perforations (thin dashed lines)
    return `<rect x="15" y="-58" width="15" height="29" fill="none" stroke="rgba(60,40,20,0.45)" stroke-width="0.4" stroke-dasharray="1.2 1"/>
      <rect x="18.75" y="-73" width="7.5" height="5" fill="none" stroke="rgba(60,40,20,0.45)" stroke-width="0.4" stroke-dasharray="1.2 1"/>
      <polygon points="7.5,-6 37.5,-6 37.5,-44 31,-56 14,-56 7.5,-44" fill="none" stroke="rgba(60,40,20,0.35)" stroke-width="0.4" stroke-dasharray="1.2 1"/>`;
  },
  ipsc_classic() {
    return `<rect x="15.5" y="-44" width="15" height="29" fill="none" stroke="rgba(60,40,20,0.45)" stroke-width="0.4" stroke-dasharray="1.2 1"/>
      <polygon points="12,-6 34,-6 40,-12 40,-46 34,-52 12,-52 6,-46 6,-12" fill="none" stroke="rgba(60,40,20,0.35)" stroke-width="0.4" stroke-dasharray="1.2 1"/>`;
  }
};

/** Natural default colours when a target doesn't specify one. */
export const ART_COLORS = {
  deer: '#8a6646', elk: '#7a6040', moose: '#3e3127', bear: '#2a2119', boar: '#3d342a',
  wolf: '#77746e', coyote: '#8e7558', fox: '#b4561f', reindeer: '#7b6b54', hare: '#8c7b60',
  pheasant: '#9a5a2a', turkey: '#4a3a2c', soldier_silhouette: '#4a5240', soldier_half: '#4a5240',
  mil_e_type: '#4a5240', ipsc_metric: '#c9a56b', ipsc_mini: '#c9a56b', ipsc_classic: '#c2a06a',
  prs_popper: '#e0622f', circle_gong: '#ecebe6'
};

export const ART_TYPES = new Set([...Object.keys(SPECIES), 'soldier_silhouette', 'soldier_half', 'mil_e_type', 'ipsc_metric', 'ipsc_mini', 'ipsc_classic', 'prs_popper']);

/** Builds artwork for `type`; returns { svg, viewBox, widthCm, heightCm } or null. */
export function buildArt(type, target = {}) {
  const color = /^#[0-9a-fA-F]{6}$/.test(target.color || '') ? target.color : (ART_COLORS[type] || '#555555');
  const a = new Art();
  if (SPECIES[type]) {
    SPECIES[type](a);
    // Fur: fine, slightly streaky grain (frequency in cycles per cm).
    const birds = type === 'pheasant' || type === 'turkey';
    return a.render(color, { texture: birds ? { freq: '1.4 0.8', dark: 0.5, light: 0.22, seed: 11 } : { freq: '0.9 2.4', dark: 0.55, light: 0.2, seed: 5 } });
  }
  switch (type) {
    // Painted plywood/board figures: subtle paint grain.
    case 'soldier_silhouette': soldierFull(a); return a.render(color, { shadeAmt: 10, texture: { freq: '0.8 1.6', dark: 0.25, light: 0.1 } });
    case 'soldier_half': soldierHalf(a); return a.render(color, { shadeAmt: 10, texture: { freq: '0.8 1.6', dark: 0.25, light: 0.1 } });
    case 'mil_e_type': eType(a); return a.render(color, { shadeAmt: 10, texture: { freq: '0.8 1.6', dark: 0.25, light: 0.1 } });
    case 'ipsc_metric':
    case 'ipsc_mini': {
      ipscMetric(a);
      // Corrugated cardboard: fine fibrous grain plus faint vertical flutes.
      const out = a.render(color, { outline: false, shadeAmt: 8, texture: { freq: '0.25 2.4', dark: 0.35, light: 0.15, seed: 3 } });
      out.svg += PAPER_ZONES.ipsc_metric();
      return out;
    }
    case 'ipsc_classic': {
      ipscMetric(a, { classic: true });
      const out = a.render(color, { outline: false, shadeAmt: 8, texture: { freq: '0.25 2.4', dark: 0.35, light: 0.15, seed: 3 } });
      out.svg += PAPER_ZONES.ipsc_classic();
      return out;
    }
    case 'prs_popper': {
      const w = (Number(target.width) || 0.2) * 100;
      const h = (Number(target.height) || 0.25) * 100;
      prsPopper(a, w, h);
      // Painted steel: smooth paint with faint orange-peel texture.
      return a.render(color, { outline: false, shadeAmt: 26, texture: { freq: '2.5 2.5', dark: 0.18, light: 0.12, seed: 9 } });
    }
    default: return null;
  }
}
