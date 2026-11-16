// Sun-Eye Dragon — an entry for make.fun's ai-excited-01.
//
// A giant ocean wave that is also a dragon: its crest is the dragon's head,
// the setting sun (or moon) is its eye, foam forms its teeth and horn, and a
// lone surfer rides inside the barrel. The picture is drawn entirely by this
// program with Node's standard library only — a small scanline rasterizer, a
// seeded random generator for the spray, and a hand-rolled PNG writer — so
// every run produces exactly the same bytes.
//
// Run:  mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts [variant]
// Variants: 1 = sunset (default), 2 = storm night, 3 = flat woodblock.

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

// ---------------------------------------------------------------------------
// Deterministic random numbers (splitmix style). No Math.random anywhere:
// the grader runs the program twice and both runs must agree byte for byte.
// ---------------------------------------------------------------------------
function makeRng(seed) {
  let state = seed >>> 0;
  return function next() {
    state = (state + 0x9e3779b9) >>> 0;
    let z = state;
    z = Math.imul(z ^ (z >>> 16), 0x21f0aaad);
    z = Math.imul(z ^ (z >>> 15), 0x735a2d97);
    z = z ^ (z >>> 15);
    return (z >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Frame buffer. The scene is painted on a supersampled grid (SS times the
// output size) and box-averaged down at the end, which keeps edges clean.
// Colours are floats in 0..1 while painting.
// ---------------------------------------------------------------------------
const OUT_W = 1024;
const OUT_H = 1024;
const SS = 2;
const W = OUT_W * SS;
const H = OUT_H * SS;
const buf = new Float32Array(W * H * 3);

function blendPx(x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= W || y >= H || a <= 0) return;
  const i = (y * W + x) * 3;
  if (a >= 1) {
    buf[i] = r; buf[i + 1] = g; buf[i + 2] = b;
  } else {
    buf[i] += (r - buf[i]) * a;
    buf[i + 1] += (g - buf[i + 1]) * a;
    buf[i + 2] += (b - buf[i + 2]) * a;
  }
}

function addPx(x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= W || y >= H || a <= 0) return;
  const i = (y * W + x) * 3;
  buf[i] += r * a; buf[i + 1] += g * a; buf[i + 2] += b * a;
}

// ---------------------------------------------------------------------------
// Paths. Scene coordinates live in output pixels (1024 across); the helpers
// scale them onto the device grid. A path is a list of move/line/cubic ops
// that gets flattened to a polyline before filling or stroking.
// ---------------------------------------------------------------------------
function flattenCubic(p0, p1, p2, p3, steps, out) {
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
    out.push([
      a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0],
      a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1],
    ]);
  }
}

function flattenPath(ops) {
  const pts = [];
  let cur = null;
  for (const op of ops) {
    if (op[0] === 'M') {
      cur = [op[1], op[2]];
      pts.push(cur);
    } else if (op[0] === 'L') {
      cur = [op[1], op[2]];
      pts.push(cur);
    } else if (op[0] === 'C') {
      const seg = [];
      flattenCubic(cur, [op[1], op[2]], [op[3], op[4]], [op[5], op[6]], 28, seg);
      for (const p of seg) pts.push(p);
      cur = [op[5], op[6]];
    }
  }
  return pts;
}

// Fill a flattened polygon. `paint` is either a solid [r,g,b,a] or a shader
// function (x, y) -> [r,g,b,a] in output coordinates.
function fillPoly(pts, paint) {
  const dev = pts.map(([x, y]) => [x * SS, y * SS]);
  let minY = Infinity, maxY = -Infinity;
  for (const [, y] of dev) { if (y < minY) minY = y; if (y > maxY) maxY = y; }
  const y0 = Math.max(0, Math.floor(minY));
  const y1 = Math.min(H - 1, Math.ceil(maxY));
  const solid = typeof paint !== 'function';
  for (let y = y0; y <= y1; y++) {
    const yc = y + 0.5;
    const xs = [];
    for (let i = 0; i < dev.length; i++) {
      const [x1, yy1] = dev[i];
      const [x2, yy2] = dev[(i + 1) % dev.length];
      if ((yy1 <= yc && yy2 > yc) || (yy2 <= yc && yy1 > yc)) {
        xs.push(x1 + ((yc - yy1) / (yy2 - yy1)) * (x2 - x1));
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xa = Math.max(0, Math.floor(xs[k]));
      const xb = Math.min(W - 1, Math.ceil(xs[k + 1]));
      for (let x = xa; x <= xb; x++) {
        if (solid) blendPx(x, y, paint[0], paint[1], paint[2], paint[3]);
        else {
          const c = paint(x / SS, y / SS);
          blendPx(x, y, c[0], c[1], c[2], c[3]);
        }
      }
    }
  }
}

// Stamp a filled disc (device space via output coords).
function disc(cx, cy, rad, color) {
  const r = rad * SS, x0 = cx * SS, y0 = cy * SS;
  const xa = Math.max(0, Math.floor(x0 - r)), xb = Math.min(W - 1, Math.ceil(x0 + r));
  const ya = Math.max(0, Math.floor(y0 - r)), yb = Math.min(H - 1, Math.ceil(y0 + r));
  for (let y = ya; y <= yb; y++) {
    for (let x = xa; x <= xb; x++) {
      const dx = x - x0, dy = y - y0;
      if (dx * dx + dy * dy <= r * r) blendPx(x, y, color[0], color[1], color[2], color[3]);
    }
  }
}

// Additive radial glow sprite.
function glow(cx, cy, rad, color, strength) {
  const r = rad * SS, x0 = cx * SS, y0 = cy * SS;
  const xa = Math.max(0, Math.floor(x0 - r)), xb = Math.min(W - 1, Math.ceil(x0 + r));
  const ya = Math.max(0, Math.floor(y0 - r)), yb = Math.min(H - 1, Math.ceil(y0 + r));
  for (let y = ya; y <= yb; y++) {
    for (let x = xa; x <= xb; x++) {
      const dx = (x - x0) / r, dy = (y - y0) / r;
      const d2 = dx * dx + dy * dy;
      if (d2 < 1) {
        const fall = (1 - d2) * (1 - d2);
        addPx(x, y, color[0], color[1], color[2], fall * strength);
      }
    }
  }
}

// Stroke a polyline with round stamps; radius may taper via radiusFn(t).
function stroke(pts, width, color, radiusFn) {
  let total = 0;
  const lens = [0];
  for (let i = 1; i < pts.length; i++) {
    total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    lens.push(total);
  }
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1];
    const [bx, by] = pts[i];
    const segLen = lens[i] - lens[i - 1];
    const steps = Math.max(1, Math.ceil(segLen / (width * 0.22)));
    for (let s = 0; s <= steps; s++) {
      const t = (lens[i - 1] + (segLen * s) / steps) / (total || 1);
      const rad = radiusFn ? radiusFn(t) : width / 2;
      disc(ax + ((bx - ax) * s) / steps, ay + ((by - ay) * s) / steps, rad, color);
    }
  }
}

function hexColor(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
function rgba(hex, a) {
  const c = hexColor(hex);
  return [c[0], c[1], c[2], a];
}
function mix(c1, c2, t) {
  return [
    c1[0] + (c2[0] - c1[0]) * t,
    c1[1] + (c2[1] - c1[1]) * t,
    c1[2] + (c2[2] - c1[2]) * t,
  ];
}

// ---------------------------------------------------------------------------
// Palettes per variant. The geometry is shared; each variant re-lights it.
// ---------------------------------------------------------------------------
const PALETTES = {
  1: { // sunset
    skyStops: [[0, '#141c52'], [0.34, '#5c2760'], [0.58, '#c94f38'], [0.78, '#ff9a3c'], [1, '#ffc46b']],
    sea: '#0a2e4d', seaDeep: '#051a30',
    waveDeep: '#07355e', waveMid: '#0d6e8c', waveLight: '#2fb3a6', waveHi: '#8fe8d8',
    barrel: '#0a4a63', barrelGlow: '#ffb35c',
    foam: '#f6fdff', foamShade: '#bfe6ef',
    eyeCore: '#fff6c8', eyeDisc: '#ffd23e', eyeGlow: '#ff9a3c', eyeRing: '#2a1608',
    silhouette: '#131022', rim: '#ffd9a0',
    bird: '#1c1430', flat: false, starAlpha: 0.0, sprayTint: '#ffffff',
  },
  2: { // storm night
    skyStops: [[0, '#02040c'], [0.4, '#071a3d'], [0.7, '#0b3d55'], [1, '#14606e']],
    sea: '#04182e', seaDeep: '#020a18',
    waveDeep: '#052544', waveMid: '#075a75', waveLight: '#0f93a8', waveHi: '#a5f3ff',
    barrel: '#06334d', barrelGlow: '#5ee7ff',
    foam: '#eafcff', foamShade: '#a8dcea',
    eyeCore: '#ffffff', eyeDisc: '#dff4ff', eyeGlow: '#67e8f9', eyeRing: '#04101f',
    silhouette: '#05070f', rim: '#a5f3ff',
    bird: '#020610', flat: false, starAlpha: 0.85, sprayTint: '#dff8ff',
  },
  3: { // flat woodblock
    skyStops: [[0, '#f2e3c6'], [1, '#f2e3c6']],
    sea: '#1d3557', seaDeep: '#14213d',
    waveDeep: '#1d3557', waveMid: '#2a5d8a', waveLight: '#3f7fbf', waveHi: '#a8c6e0',
    barrel: '#14213d', barrelGlow: '#e4572e',
    foam: '#fdf6e3', foamShade: '#e8dcc0',
    eyeCore: '#f6d8a0', eyeDisc: '#d93a2b', eyeGlow: '#e4572e', eyeRing: '#14213d',
    silhouette: '#14213d', rim: '#f2e3c6',
    bird: '#14213d', flat: true, starAlpha: 0.0, sprayTint: '#fdf6e3',
  },
};

// ---------------------------------------------------------------------------
// Background: sky gradient (per-pixel), stars for the night variant, the sea
// band at the bottom.
// ---------------------------------------------------------------------------
function paintBackground(pal, rng) {
  const stops = pal.skyStops;
  for (let y = 0; y < H; y++) {
    const t = y / H;
    let c = hexColor(stops[stops.length - 1][1]);
    for (let i = 1; i < stops.length; i++) {
      if (t <= stops[i][0]) {
        const [t0, c0] = stops[i - 1];
        const [t1, c1] = stops[i];
        c = mix(hexColor(c0), hexColor(c1), (t - t0) / Math.max(1e-6, t1 - t0));
        break;
      }
    }
    for (let x = 0; x < W; x++) {
      const idx = (y * W + x) * 3;
      buf[idx] = c[0]; buf[idx + 1] = c[1]; buf[idx + 2] = c[2];
    }
  }
  if (pal.starAlpha > 0) {
    for (let i = 0; i < 420; i++) {
      const x = rng() * OUT_W, y = rng() * OUT_H * 0.55;
      const r = 0.7 + rng() * 1.5;
      disc(x, y, r, [1, 1, 1, pal.starAlpha * (0.3 + rng() * 0.7)]);
    }
  }
  // Sea: the lower band, darker than the sky's foot.
  const seaTop = 838;
  for (let y = Math.floor(seaTop * SS); y < H; y++) {
    const t = (y / SS - seaTop) / (OUT_H - seaTop);
    const c = mix(hexColor(pal.sea), hexColor(pal.seaDeep), t);
    for (let x = 0; x < W; x++) {
      const idx = (y * W + x) * 3;
      buf[idx] = c[0]; buf[idx + 1] = c[1]; buf[idx + 2] = c[2];
    }
  }
}

// ---------------------------------------------------------------------------
// The wave-dragon. One big silhouette path: the back rises from the lower
// left, the crest rolls over into a dragon head at the upper right, the lip
// is the snout, and the outline returns through the barrel and down the face.
// ---------------------------------------------------------------------------
function waveOutline() {
  return [
    ['M', -20, 1050],
    ['C', 60, 760, 96, 560, 210, 392],
    ['C', 300, 262, 420, 168, 560, 138],
    ['C', 668, 116, 762, 128, 838, 196],
    ['C', 902, 252, 936, 322, 928, 388],
    ['C', 922, 442, 876, 478, 812, 486],
    ['C', 748, 494, 700, 486, 664, 448],       // throat tuck
    ['C', 622, 520, 606, 624, 622, 738],       // face front, slight S
    ['C', 640, 862, 726, 962, 856, 1008],      // lower flare
    ['C', 950, 1038, 1010, 1044, 1050, 1046],  // shoulder into the sea
    ['L', 1050, 1050],
    ['L', -20, 1050],
  ];
}

// Face shading: diagonal bands that follow the wave's motion, lighter
// toward the crest and the barrel light, deeper toward the base.
function faceShader(pal) {
  const deep = hexColor(pal.waveDeep), mid = hexColor(pal.waveMid);
  const light = hexColor(pal.waveLight), hi = hexColor(pal.waveHi);
  return (x, y) => {
    const d = (x * 0.62 + (1024 - y) * 0.55) / 900;
    let c;
    if (d < 0.45) c = mix(deep, mid, d / 0.45);
    else if (d < 0.8) c = mix(mid, light, (d - 0.45) / 0.35);
    else c = mix(light, hi, Math.min(1, (d - 0.8) / 0.35));
    return [c[0], c[1], c[2], 1];
  };
}

function paintWave(pal) {
  fillPoly(flattenPath(waveOutline()), faceShader(pal));

  // Barrel interior: a dark pocket painted on the face under the lip, lit
  // from inside as if the light were shining through the tube.
  const barrel = flattenPath([
    ['M', 664, 448],
    ['C', 590, 414, 486, 432, 440, 486],
    ['C', 404, 566, 430, 672, 492, 742],
    ['C', 556, 690, 596, 622, 600, 548],
    ['C', 602, 500, 626, 466, 664, 448],
  ]);
  fillPoly(barrel, rgba(pal.barrel, 0.94));
  glow(520, 590, 165, hexColor(pal.barrelGlow), pal.flat ? 0.10 : 0.34);
  glow(600, 505, 80, hexColor(pal.barrelGlow), pal.flat ? 0.06 : 0.20);

  // Flow bands on the face: wide, soft lighter sweeps running with the
  // curl — water in motion, not scratches.
  const streaks = [
    [['M', 118, 852], ['C', 246, 762, 332, 668, 376, 560]],
    [['M', 96, 946], ['C', 256, 890, 386, 796, 456, 684]],
    [['M', 190, 706], ['C', 276, 622, 336, 544, 370, 462]],
  ];
  for (const s of streaks) {
    stroke(flattenPath(s), pal.flat ? 6 : 26, rgba(pal.waveHi, pal.flat ? 0.35 : 0.05));
  }
}

// Crest foam: a scalloped white cap along the top of the wave, plus foam
// fingers (the dragon's claws) reaching over the lip.
function paintFoam(pal, rng) {
  const crest = flattenPath([
    ['M', 196, 402], ['C', 292, 268, 420, 172, 560, 140],
    ['C', 668, 118, 764, 130, 840, 198],
  ]);
  const n = 46;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const idx = Math.min(crest.length - 1, Math.floor(t * (crest.length - 1)));
    const [x, y] = crest[idx];
    const r = 15 + 13 * Math.sin(t * Math.PI) + rng() * 7;
    disc(x, y - 4, r, rgba(pal.foam, 0.95));
  }
  stroke(flattenPath([
    ['M', 300, 290], ['C', 380, 200, 470, 158, 560, 140],
    ['C', 668, 118, 764, 130, 840, 198],
  ]), 13, rgba(pal.foamShade, 0.9));

  // Claw fingers: foam breaking over the lip's front edge, curling down
  // and back toward the barrel. Short, thick and hooked, not icicles.
  const claws = [
    { from: [906, 306], c1: [916, 344], c2: [906, 380], to: [878, 402] },
    { from: [888, 252], c1: [902, 292], c2: [896, 330], to: [868, 352] },
    { from: [860, 212], c1: [878, 250], c2: [876, 286], to: [850, 306] },
  ];
  for (const cl of claws) {
    const pts = [];
    flattenCubic(cl.from, cl.c1, cl.c2, cl.to, 24, pts);
    pts.unshift(cl.from);
    const shadow = pts.map(([x, y]) => [x + 5, y + 6]);
    stroke(shadow, 19, rgba(pal.foamShade, 0.55), (t) => 11 * (1 - t) + 2);
    stroke(pts, 19, rgba(pal.foam, 0.98), (t) => 11 * (1 - t) + 2);
  }
}

// The horn: tapered curves sweeping back from the top of the head. Painted
// before the crest foam so its base tucks into the head and the foam
// overlaps its root — it grows out of the wave instead of floating.
function paintHorn(pal) {
  const pts = [];
  flattenCubic([648, 152], [578, 104], [478, 80], [372, 102], 26, pts);
  pts.unshift([648, 152]);
  stroke(pts, 22, rgba(pal.foam, 0.96), (t) => 13 * (1 - t) + 2.5);
  const pts2 = [];
  flattenCubic([692, 160], [636, 118], [556, 92], [472, 96], 22, pts2);
  pts2.unshift([692, 160]);
  stroke(pts2, 13, rgba(pal.foamShade, 0.85), (t) => 7 * (1 - t) + 2);
}

// Teeth: foam-white triangles hanging from the jaw line.
function paintTeeth(pal) {
  const jaw = flattenPath([
    ['M', 812, 486], ['C', 876, 478, 922, 442, 928, 388],
  ]);
  const count = 6;
  for (let i = 0; i < count; i++) {
    const t = 0.08 + (i / (count - 1)) * 0.8;
    const idx = Math.min(jaw.length - 1, Math.floor(t * (jaw.length - 1)));
    const [x, y] = jaw[idx];
    const len = 20 + 14 * Math.sin(t * Math.PI);
    const wdt = 9;
    fillPoly(
      [[x - wdt, y - 2], [x + wdt, y - 4], [x + 1, y + len]],
      rgba(pal.foam, 0.97),
    );
  }
}

// The eye: the sun (or moon) itself, set into the head with a dark ring and
// an upper lid so it reads as an eye, glowing onto the surrounding water.
function paintEye(pal) {
  const ex = 742, ey = 252;
  glow(ex, ey, 210, hexColor(pal.eyeGlow), pal.flat ? 0.12 : 0.42);
  disc(ex, ey, 47, rgba(pal.eyeRing, 1));
  disc(ex, ey, 41, rgba(pal.eyeDisc, 1));
  disc(ex, ey, 33, rgba(pal.eyeGlow, 0.55));
  disc(ex, ey, 25, rgba(pal.eyeCore, 0.92));
  const lid = flattenPath([
    ['M', ex - 50, ey - 16], ['C', ex - 26, ey - 52, ex + 26, ey - 52, ex + 50, ey - 16],
    ['C', ex + 24, ey - 30, ex - 24, ey - 30, ex - 50, ey - 16],
  ]);
  fillPoly(lid, rgba(pal.waveDeep, 1));
  disc(ex + 13, ey - 12, 6, [1, 1, 1, 0.95]);
}

// The surfer: a small dark silhouette inside the barrel, rim-lit on the side
// facing the light. Kept tiny and simple so the anatomy stays clean.
function paintSurfer(pal) {
  const rim = rgba(pal.rim, 0.9);
  const body = rgba(pal.silhouette, 1);
  const bx = 505, by = 655;
  const board = flattenPath([
    ['M', bx - 88, by + 18], ['C', bx - 34, by - 5, bx + 50, by - 9, bx + 95, by + 2],
    ['C', bx + 45, by + 16, bx - 34, by + 25, bx - 88, by + 18],
  ]);
  fillPoly(board, rim);
  const boardTop = flattenPath([
    ['M', bx - 83, by + 13], ['C', bx - 32, by - 7, bx + 47, by - 11, bx + 90, by],
    ['C', bx + 45, by + 9, bx - 32, by + 18, bx - 83, by + 13],
  ]);
  fillPoly(boardTop, body);
  // A crouched pictogram figure: two-segment limbs with real knees and
  // elbows, drawn as polylines so the joints bend instead of bowing.
  const hip = [bx - 7, by - 43], shoulder = [bx - 15, by - 71];
  const limbs = [
    [hip, [bx - 27, by - 25], [bx - 43, by - 9]],        // back leg
    [hip, [bx + 15, by - 29], [bx + 29, by - 11]],      // front leg
    [hip, shoulder],                                     // torso
    [shoulder, [bx - 39, by - 59], [bx - 53, by - 43]], // back arm
    [shoulder, [bx + 11, by - 65], [bx + 31, by - 57]], // front arm
  ];
  for (const pass of [rim, body]) {
    for (const limb of limbs) stroke(limb, pass === rim ? 10.5 : 8, pass);
    disc(bx - 17, by - 83, pass === rim ? 12 : 10, pass); // head
  }
}

// Spray: seeded particles bursting off the crest, the lip and the base.
function paintSpray(pal, rng) {
  const sources = [
    { x: 850, y: 210, n: 260, spread: 1.15, power: 190 },
    { x: 700, y: 150, n: 200, spread: 1.3, power: 150 },
    { x: 920, y: 400, n: 140, spread: 0.9, power: 120 },
    { x: 420, y: 880, n: 220, spread: 1.5, power: 130 },
  ];
  for (const s of sources) {
    for (let i = 0; i < s.n; i++) {
      const ang = -Math.PI / 2 + (rng() - 0.5) * 2 * s.spread;
      const dist = Math.pow(rng(), 1.6) * s.power;
      const x = s.x + Math.cos(ang) * dist * 1.25;
      const y = s.y + Math.sin(ang) * dist * 0.8 + dist * dist * 0.0009;
      const r = 0.8 + rng() * 2.6;
      disc(x, y, r, rgba(pal.sprayTint, 0.16 + rng() * 0.5));
    }
  }
  for (let i = 0; i < 26; i++) {
    const x = rng() * OUT_W, y = 856 + rng() * 150;
    const len = 30 + rng() * 110;
    const pts = flattenPath([['M', x, y], ['L', x + len, y + (rng() - 0.5) * 6]]);
    stroke(pts, 2.6, rgba(pal.foam, 0.05 + rng() * 0.10));
  }
}

function paintBirds(pal) {
  const birds = [[236, 196, 15], [300, 158, 11], [168, 250, 9]];
  for (const [x, y, s] of birds) {
    const left = flattenPath([['M', x - s, y], ['C', x - s * 0.5, y - s * 0.7, x - s * 0.2, y - s * 0.7, x, y]]);
    const right = flattenPath([['M', x, y], ['C', x + s * 0.2, y - s * 0.7, x + s * 0.5, y - s * 0.7, x + s, y]]);
    stroke(left, 3.4, rgba(pal.bird, 0.9));
    stroke(right, 3.4, rgba(pal.bird, 0.9));
  }
}

// ---------------------------------------------------------------------------
// PNG writer: CRC32, per-row filter choice by minimum absolute filtered sum,
// zlib deflate at level 9.
// ---------------------------------------------------------------------------
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  const crc = crc32(out.subarray(4, 8 + data.length));
  out.writeUInt32BE(crc, 8 + data.length);
  return out;
}

function encodePng(rgb) {
  const raw = Buffer.alloc((OUT_W * 3 + 1) * OUT_H);
  for (let y = 0; y < OUT_H; y++) {
    const rowOff = y * OUT_W * 3;
    let bestFilter = 0, bestScore = Infinity, bestRow = null;
    for (const f of [0, 1, 2, 3, 4]) {
      const row = Buffer.alloc(OUT_W * 3);
      let score = 0;
      for (let x = 0; x < OUT_W * 3; x++) {
        const cur = rgb[rowOff + x];
        const left = x >= 3 ? rgb[rowOff + x - 3] : 0;
        const up = y > 0 ? rgb[rowOff - OUT_W * 3 + x] : 0;
        const upLeft = y > 0 && x >= 3 ? rgb[rowOff - OUT_W * 3 + x - 3] : 0;
        let pred = 0;
        if (f === 1) pred = left;
        else if (f === 2) pred = up;
        else if (f === 3) pred = (left + up) >> 1;
        else if (f === 4) {
          const p = left + up - upLeft;
          const pa = Math.abs(p - left), pb = Math.abs(p - up), pc = Math.abs(p - upLeft);
          pred = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
        }
        const v = (cur - pred) & 255;
        row[x] = v;
        score += v < 128 ? v : 256 - v;
      }
      if (score < bestScore) { bestScore = score; bestFilter = f; bestRow = row; }
    }
    const off = y * (OUT_W * 3 + 1);
    raw[off] = bestFilter;
    bestRow.copy(raw, off + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(OUT_W, 0);
  ihdr.writeUInt32BE(OUT_H, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Downsample the supersampled buffer to the output size and clamp to bytes.
function finish() {
  const rgb = new Uint8Array(OUT_W * OUT_H * 3);
  for (let y = 0; y < OUT_H; y++) {
    for (let x = 0; x < OUT_W; x++) {
      let r = 0, g = 0, b = 0;
      for (let dy = 0; dy < SS; dy++) {
        for (let dx = 0; dx < SS; dx++) {
          const i = ((y * SS + dy) * W + (x * SS + dx)) * 3;
          r += buf[i]; g += buf[i + 1]; b += buf[i + 2];
        }
      }
      const n = SS * SS;
      const o = (y * OUT_W + x) * 3;
      rgb[o] = Math.max(0, Math.min(255, Math.round((r / n) * 255)));
      rgb[o + 1] = Math.max(0, Math.min(255, Math.round((g / n) * 255)));
      rgb[o + 2] = Math.max(0, Math.min(255, Math.round((b / n) * 255)));
    }
  }
  return rgb;
}

// ---------------------------------------------------------------------------
// Compose the scene and write the file.
// ---------------------------------------------------------------------------
const variant = Math.min(3, Math.max(1, parseInt(process.argv[2] ?? '1', 10) || 1));
const pal = PALETTES[variant];
const rng = makeRng(20261116 + variant * 7919);

paintBackground(pal, rng);
paintWave(pal);
paintHorn(pal);
paintFoam(pal, rng);
paintTeeth(pal);
paintEye(pal);
paintSurfer(pal);
paintBirds(pal);
paintSpray(pal, rng);

const png = encodePng(finish());
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'entry.png'), png);
console.log(`variant ${variant}: wrote ${png.length} bytes`);
