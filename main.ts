// ai-excited-01 — "Wave-Dragon": a giant wave shaped like a dragon, its eye the
// setting sun, a surfer riding inside the curl. Drawn procedurally, pixel by
// pixel, with no external assets and no network. Deterministic: the same run
// always writes the same bytes.
//
// Usage:   MAKEFUN_OUTPUT_DIR=out node main.ts [variant]
//   variant 1 = Sun-Eye (default)   2 = Starlit Barrel
//            3 = Moon-tide Panorama  4 = One-Line Dragon
// Writes <output dir>/entry.png (1024x683 PNG, under 1 MiB).

import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { join } from "node:path";

export const W = 1024;
export const H = 683;
const SS = 2; // supersampling factor for clean edges
const SW = W * SS;
const SH = H * SS;

// ---------------------------------------------------------------------------
// Small deterministic toolkit
// ---------------------------------------------------------------------------

type RGB = [number, number, number];

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hex(h: string): RGB {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mix(a: RGB, b: RGB, t: number): RGB {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

// ---------------------------------------------------------------------------
// Canvas: an RGB buffer at supersampled resolution
// ---------------------------------------------------------------------------

const buf = new Uint8ClampedArray(SW * SH * 3);

function blend(px: number, py: number, c: RGB, alpha: number): void {
  if (px < 0 || py < 0 || px >= SW || py >= SH || alpha <= 0) return;
  const i = (py * SW + px) * 3;
  const a = alpha > 1 ? 1 : alpha;
  buf[i] = buf[i] + (c[0] - buf[i]) * a;
  buf[i + 1] = buf[i + 1] + (c[1] - buf[i + 1]) * a;
  buf[i + 2] = buf[i + 2] + (c[2] - buf[i + 2]) * a;
}

// Fill a rectangle (in final-image coordinates) with a vertical gradient.
function vgrad(x0: number, y0: number, x1: number, y1: number, stops: Array<[number, RGB]>): void {
  const sx0 = Math.max(0, Math.floor(x0 * SS));
  const sx1 = Math.min(SW, Math.ceil(x1 * SS));
  const sy0 = Math.max(0, Math.floor(y0 * SS));
  const sy1 = Math.min(SH, Math.ceil(y1 * SS));
  for (let y = sy0; y < sy1; y++) {
    const t = (y / SS - y0) / (y1 - y0);
    let c: RGB = stops[stops.length - 1][1];
    for (let s = 0; s < stops.length - 1; s++) {
      const [t0, c0] = stops[s];
      const [t1, c1] = stops[s + 1];
      if (t >= t0 && t <= t1) {
        c = mix(c0, c1, t1 === t0 ? 0 : (t - t0) / (t1 - t0));
        break;
      }
      if (t < t0) {
        c = c0;
        break;
      }
    }
    const row = y * SW * 3;
    for (let x = sx0; x < sx1; x++) {
      const i = row + x * 3;
      buf[i] = c[0];
      buf[i + 1] = c[1];
      buf[i + 2] = c[2];
    }
  }
}

// Soft radial glow: adds colour with quadratic falloff inside a disc.
function glow(cx: number, cy: number, r: number, c: RGB, strength: number): void {
  const x0 = Math.max(0, Math.floor((cx - r) * SS));
  const x1 = Math.min(SW, Math.ceil((cx + r) * SS));
  const y0 = Math.max(0, Math.floor((cy - r) * SS));
  const y1 = Math.min(SH, Math.ceil((cy + r) * SS));
  for (let y = y0; y < y1; y++) {
    const dy = y / SS - cy;
    for (let x = x0; x < x1; x++) {
      const dx = x / SS - cx;
      const d = Math.sqrt(dx * dx + dy * dy) / r;
      if (d >= 1) continue;
      const f = (1 - d) * (1 - d) * strength;
      blend(x, y, c, f);
    }
  }
}

// ---------------------------------------------------------------------------
// Raster shapes (all coordinates in final-image space; scaled by SS inside)
// ---------------------------------------------------------------------------

function disc(cx: number, cy: number, r: number, c: RGB, alpha: number): void {
  const x0 = Math.max(0, Math.floor((cx - r) * SS));
  const x1 = Math.min(SW - 1, Math.ceil((cx + r) * SS));
  const y0 = Math.max(0, Math.floor((cy - r) * SS));
  const y1 = Math.min(SH - 1, Math.ceil((cy + r) * SS));
  const rr = r * SS;
  const ccx = cx * SS;
  const ccy = cy * SS;
  for (let y = y0; y <= y1; y++) {
    const dy = y + 0.5 - ccy;
    const half = Math.sqrt(Math.max(0, rr * rr - dy * dy));
    const xa = Math.max(x0, Math.ceil(ccx - half));
    const xb = Math.min(x1, Math.floor(ccx + half));
    for (let x = xa; x <= xb; x++) blend(x, y, c, alpha);
  }
}

function ellipse(cx: number, cy: number, rx: number, ry: number, c: RGB, alpha: number): void {
  const x0 = Math.max(0, Math.floor((cx - rx) * SS));
  const x1 = Math.min(SW - 1, Math.ceil((cx + rx) * SS));
  const y0 = Math.max(0, Math.floor((cy - ry) * SS));
  const y1 = Math.min(SH - 1, Math.ceil((cy + ry) * SS));
  for (let y = y0; y <= y1; y++) {
    const ny = (y + 0.5 - cy * SS) / (ry * SS);
    const half = Math.sqrt(Math.max(0, 1 - ny * ny)) * rx * SS;
    const xa = Math.max(x0, Math.ceil(cx * SS - half));
    const xb = Math.min(x1, Math.floor(cx * SS + half));
    for (let x = xa; x <= xb; x++) blend(x, y, c, alpha);
  }
}

type Pt = [number, number];

// Even-odd scanline fill of a polygon.
function poly(points: Pt[], c: RGB, alpha: number): void {
  const pts = points.map(([x, y]): Pt => [x * SS, y * SS]);
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [, y] of pts) {
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const y0 = Math.max(0, Math.floor(minY));
  const y1 = Math.min(SH - 1, Math.ceil(maxY));
  const n = pts.length;
  for (let y = y0; y <= y1; y++) {
    const yc = y + 0.5;
    const xs: number[] = [];
    for (let i = 0; i < n; i++) {
      const [x0, y0p] = pts[i];
      const [x1, y1p] = pts[(i + 1) % n];
      if ((y0p <= yc && y1p > yc) || (y1p <= yc && y0p > yc)) {
        xs.push(x0 + ((yc - y0p) / (y1p - y0p)) * (x1 - x0));
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xa = Math.max(0, Math.ceil(xs[k]));
      const xb = Math.min(SW - 1, Math.floor(xs[k + 1]));
      for (let x = xa; x <= xb; x++) blend(x, y, c, alpha);
    }
  }
}

// Flatten a cubic bezier into a point list (endpoints included).
function bezier(p0: Pt, p1: Pt, p2: Pt, p3: Pt, steps = 26): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    out.push([
      u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
      u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
    ]);
  }
  return out;
}

// Thick polyline: quads between points plus a disc at every joint.
function strokePath(points: Pt[], widths: number[], c: RGB, alpha: number): void {
  for (let i = 0; i + 1 < points.length; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[i + 1];
    const w0 = widths[Math.min(i, widths.length - 1)] / 2;
    const w1 = widths[Math.min(i + 1, widths.length - 1)] / 2;
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy) || 1;
    const nx = (-dy / len) * 1;
    const ny = (dx / len) * 1;
    poly(
      [
        [x0 + nx * w0, y0 + ny * w0],
        [x1 + nx * w1, y1 + ny * w1],
        [x1 - nx * w1, y1 - ny * w1],
        [x0 - nx * w0, y0 - ny * w0],
      ],
      c,
      alpha,
    );
    disc(x0, y0, w0, c, alpha);
    disc(x1, y1, w1, c, alpha);
  }
}

// Four-point sparkle star.
function sparkle(cx: number, cy: number, r: number, c: RGB, alpha: number): void {
  const inner = r * 0.22;
  const pts: Pt[] = [];
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2 - Math.PI / 2;
    const a2 = a + Math.PI / 4;
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    pts.push([cx + Math.cos(a2) * inner, cy + Math.sin(a2) * inner]);
  }
  poly(pts, c, alpha);
}

// A distant bird: two short strokes forming a shallow "v".
function bird(cx: number, cy: number, s: number, c: RGB, alpha: number): void {
  strokePath(
    [
      [cx - s, cy - s * 0.35],
      [cx, cy],
      [cx + s, cy - s * 0.35],
    ],
    [2.2, 2.2, 2.2],
    c,
    alpha,
  );
}

// Burst of spray droplets along a path, seeded for determinism.
function spray(rng: () => number, path: Pt[], count: number, c: RGB): void {
  for (let i = 0; i < count; i++) {
    const seg = path[Math.floor(rng() * (path.length - 1))];
    const seg2 = path[Math.min(path.indexOf(seg) + 1, path.length - 1)];
    const t = rng();
    const x = seg[0] + (seg2[0] - seg[0]) * t + (rng() - 0.5) * 26;
    const y = seg[1] + (seg2[1] - seg[1]) * t + (rng() - 0.5) * 26 - rng() * 18;
    const r = 1 + rng() * 3.2;
    disc(x, y, r, c, 0.35 + rng() * 0.55);
  }
}

// ---------------------------------------------------------------------------
// Downsample + deterministic PNG encoding
// ---------------------------------------------------------------------------

function downsample(): Uint8Array {
  const out = new Uint8Array(W * H * 3);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const i = ((y * SS + sy) * SW + (x * SS + sx)) * 3;
          r += buf[i];
          g += buf[i + 1];
          b += buf[i + 2];
        }
      }
      const n = SS * SS;
      const o = (y * W + x) * 3;
      out[o] = Math.round(r / n);
      out[o + 1] = Math.round(g / n);
      out[o + 2] = Math.round(b / n);
    }
  }
  return out;
}

const CRC_TABLE: number[] = (() => {
  const table: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(data: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}

function encodePNG(rgb: Uint8Array, w: number, h: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const raw = Buffer.alloc(h * (1 + w * 3));
  const prev = Buffer.alloc(w * 3);
  for (let y = 0; y < h; y++) {
    const row = rgb.subarray(y * w * 3, (y + 1) * w * 3);
    // Try filter None and filter Up; keep the one with smaller abs-sum.
    let sumNone = 0;
    for (let i = 0; i < row.length; i++) {
      const v = row[i];
      sumNone += v < 128 ? v : 256 - v;
    }
    const up = Buffer.alloc(row.length);
    let sumUp = 0;
    for (let i = 0; i < row.length; i++) {
      const v = (row[i] - prev[i] + 256) & 255;
      up[i] = v;
      sumUp += v < 128 ? v : 256 - v;
    }
    const off = y * (1 + w * 3);
    if (sumUp < sumNone) {
      raw[off] = 2;
      up.copy(raw, off + 1);
    } else {
      raw[off] = 0;
      Buffer.from(row).copy(raw, off + 1);
    }
    prev.set(row);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// Shared scene pieces
// ---------------------------------------------------------------------------

const INK: RGB = hex("#101828"); // near-black silhouette colour

function drawSky(stops: Array<[number, RGB]>): void {
  vgrad(0, 0, W, 470, stops);
}

function drawSun(cx: number, cy: number, r: number, core: RGB, rim: RGB): void {
  glow(cx, cy, r * 3.1, rim, 0.5);
  glow(cx, cy, r * 1.7, core, 0.55);
  disc(cx, cy, r, core, 1);
  disc(cx, cy, r * 0.72, mix(core, [255, 255, 255], 0.35), 0.9);
}

function drawSea(top: number, stops: Array<[number, RGB]>, sunX: number, sunC: RGB): void {
  vgrad(0, top, W, H, stops);
  // Sun reflection: shimmering dashes under the sun.
  const rng = mulberry32(4242);
  for (let i = 0; i < 46; i++) {
    const y = top + 8 + rng() * (H - top - 16);
    const wdt = 26 + rng() * 90 * (1 - (y - top) / (H - top) * 0.4);
    const x = sunX + (rng() - 0.5) * 260 * ((y - top) / (H - top) + 0.25);
    const a = 0.1 + rng() * 0.22;
    poly(
      [
        [x - wdt / 2, y],
        [x + wdt / 2, y],
        [x + wdt / 2 - 4, y + 3],
        [x - wdt / 2 + 4, y + 3],
      ],
      sunC,
      a,
    );
  }
  // Faint horizon line.
  poly(
    [
      [0, top],
      [W, top],
      [W, top + 2],
      [0, top + 2],
    ],
    hex("#F9F6EE"),
    0.25,
  );
}

// Small surfer silhouette inside the barrel, leaning into the wave.
function drawSurfer(x: number, y: number, s: number, board: RGB): void {
  // Board: a thin curved slash under the rider.
  strokePath(
    [
      [x - 26 * s, y + 12 * s],
      [x, y + 15 * s],
      [x + 30 * s, y + 6 * s],
    ],
    [3.5 * s, 3.5 * s, 3.5 * s],
    board,
    1,
  );
  // Legs, torso, arms as one leaning figure.
  strokePath(
    [
      [x - 8 * s, y + 10 * s],
      [x - 2 * s, y - 6 * s],
      [x + 4 * s, y - 20 * s],
    ],
    [5 * s, 4.5 * s, 4.5 * s],
    INK,
    1,
  );
  strokePath(
    [
      [x - 2 * s, y - 6 * s],
      [x + 12 * s, y + 8 * s],
    ],
    [4 * s, 4 * s],
    INK,
    1,
  );
  strokePath(
    [
      [x + 3 * s, y - 18 * s],
      [x + 16 * s, y - 30 * s],
    ],
    [3.5 * s, 3.5 * s],
    INK,
    1,
  );
  disc(x + 6 * s, y - 27 * s, 5.5 * s, INK, 1);
  // Rim light: a thin pale-gold edge on the rider's back and board so the
  // silhouette stays readable against a warm glowing background.
  strokePath(
    [
      [x + 8.5 * s, y - 28 * s],
      [x + 6.5 * s, y - 18 * s],
      [x - 0.5 * s, y - 6 * s],
    ],
    [2.2 * s, 2.2 * s, 2.2 * s],
    hex("#FFE59A"),
    0.85,
  );
  strokePath(
    [
      [x - 24 * s, y + 10 * s],
      [x + 28 * s, y + 4 * s],
    ],
    [1.8 * s, 1.8 * s],
    hex("#FFE59A"),
    0.7,
  );
  // Wake: a short white streak behind the board.
  strokePath(
    [
      [x - 30 * s, y + 13 * s],
      [x - 52 * s, y + 10 * s],
    ],
    [3 * s, 2 * s],
    hex("#F9F6EE"),
    0.55,
  );
}

// ---------------------------------------------------------------------------
// The wave-dragon: one curling mass, shared by variants 1 and 2
// ---------------------------------------------------------------------------

// Outer outline of the wave body: back edge up over the crest, the lip folding
// into a dragon snout, jaw and inner edge back down to the sea.
function waveBodyPoints(): Pt[] {
  const seg = (a: Pt, b: Pt, c: Pt, d: Pt): Pt[] => bezier(a, b, c, d, 22);
  const pts: Pt[] = [];
  const add = (list: Pt[]): void => {
    for (let i = 0; i < list.length; i++) {
      if (pts.length === 0 || i > 0) pts.push(list[i]);
    }
  };
  add(seg([-40, 700], [30, 600], [90, 500], [180, 410]));
  add(seg([180, 410], [280, 330], [390, 260], [500, 200]));
  add(seg([500, 200], [610, 160], [660, 150], [700, 150]));
  add(seg([700, 150], [760, 150], [800, 170], [835, 210]));
  add(seg([835, 210], [855, 235], [850, 255], [825, 270]));
  add(seg([825, 270], [790, 295], [740, 305], [690, 305]));
  add(seg([690, 305], [620, 310], [560, 340], [510, 390]));
  add(seg([510, 390], [470, 430], [440, 480], [425, 540]));
  add(seg([425, 540], [410, 600], [395, 660], [390, 700]));
  pts.push([-40, 700]);
  return pts;
}

// The tunnel mouth painted on the wave, where the surfer rides: a rounded
// arch built from bezier curves so it reads as a tube, not a polygon hole.
function barrelArch(): Pt[] {
  const seg = (a: Pt, b: Pt, c: Pt, d: Pt): Pt[] => bezier(a, b, c, d, 16);
  return [
    ...seg([150, 480], [190, 420], [260, 395], [320, 405]),
    ...seg([320, 405], [380, 415], [405, 460], [395, 510]).slice(1),
    ...seg([395, 510], [385, 550], [330, 565], [270, 558]).slice(1),
    ...seg([270, 558], [200, 550], [155, 525], [150, 480]).slice(1),
  ];
}

// Crest foam line: outer edge from mid-body over the lip to the snout.
function crestLine(): Pt[] {
  const seg = (a: Pt, b: Pt, c: Pt, d: Pt): Pt[] => bezier(a, b, c, d, 20);
  return [
    ...seg([500, 200], [610, 160], [660, 150], [700, 150]),
    ...seg([700, 150], [760, 150], [800, 170], [835, 210]).slice(1),
    ...seg([835, 210], [855, 235], [850, 255], [825, 270]).slice(1),
  ];
}

// Short foam streaks streaming down the wave body, each sagging gently.
function foamStreaks(c: RGB): void {
  const streaks: Array<[Pt, Pt, Pt, Pt]> = [
    [
      [250, 330],
      [310, 315],
      [370, 305],
      [430, 300],
    ],
    [
      [200, 450],
      [260, 438],
      [320, 430],
      [380, 425],
    ],
    [
      [190, 555],
      [250, 548],
      [310, 542],
      [365, 540],
    ],
  ];
  for (const [a, b, cc, d] of streaks) {
    strokePath(bezier(a, b, cc, d, 14), [4, 3, 2], c, 0.35);
  }
}

// Dragon head details on the lip: horn, teeth, eye punched through to the sun.
function dragonHead(sunX: number, sunY: number, eyeR: number, sunCore: RGB): void {
  // Swept-back horn.
  poly(
    [
      [688, 158],
      [606, 78],
      [648, 168],
      [712, 172],
    ],
    INK,
    1,
  );
  // Brow ridge above the eye.
  strokePath(
    [
      [716, 168],
      [760, 152],
      [812, 168],
    ],
    [9, 9, 9],
    INK,
    1,
  );
  // Teeth along the jaw.
  for (let i = 0; i < 4; i++) {
    const x = 742 + i * 16;
    const y = 298 - i * 2;
    poly(
      [
        [x, y],
        [x + 10, y - 2],
        [x + 5, y + 12],
      ],
      hex("#F9F6EE"),
      0.95,
    );
  }
  // Nostril dot on the snout.
  disc(826, 232, 4, INK, 0.9);
  // The eye: a blazing hole through the dark head, the sun shining through,
  // edged with a thin crisp dark ring so it stays defined at small sizes.
  disc(sunX - 14, sunY + 8, eyeR + 2.5, INK, 1);
  glow(sunX - 14, sunY + 8, eyeR * 2.6, sunCore, 0.5);
  disc(sunX - 14, sunY + 8, eyeR, sunCore, 1);
  disc(sunX - 18, sunY + 2, eyeR * 0.45, [255, 255, 255], 0.9);
}

// ---------------------------------------------------------------------------
// Variant 1 — "Sun-Eye": the setting sun is the dragon's eye
// ---------------------------------------------------------------------------

function sceneSunEye(): void {
  const rng = mulberry32(20261116);
  drawSky([
    [0, hex("#0E1B33")],
    [0.45, hex("#7E2F4E")],
    [0.75, hex("#E76F51")],
    [1, hex("#F4A261")],
  ]);
  drawSun(790, 175, 80, hex("#FFD97A"), hex("#FB8500"));
  drawSea(470, [[0, hex("#123B4F")], [1, hex("#0A2233")]], 790, hex("#FFD97A"));
  // Wave body: deep teal with a lighter crest wash and dark base.
  poly(waveBodyPoints(), hex("#0F5E6E"), 1);
  poly(
    [
      [180, 410],
      [280, 330],
      [390, 260],
      [500, 200],
      [610, 160],
      [700, 150],
      [700, 210],
      [560, 260],
      [430, 330],
      [300, 420],
      [200, 470],
    ],
    hex("#2A9D8F"),
    0.35,
  );
  poly(
    [
      [425, 540],
      [410, 600],
      [395, 660],
      [390, 700],
      [-40, 700],
      [-40, 640],
      [180, 620],
      [330, 600],
    ],
    hex("#0A3A4A"),
    0.5,
  );
  // A low foreground wave at bottom-left, for depth.
  poly(
    [
      [-40, 683],
      [60, 622],
      [180, 602],
      [280, 632],
      [300, 683],
    ],
    hex("#0A3A4A"),
    0.85,
  );
  strokePath(
    [
      [60, 622],
      [180, 602],
      [280, 632],
    ],
    [4, 3, 2],
    hex("#F9F6EE"),
    0.4,
  );
  foamStreaks(hex("#EAF6F3"));
  // Barrel tunnel: dark mouth with warm light glowing through it, so the
  // surfer reads as a silhouette against the light.
  poly(barrelArch(), hex("#0B2B3A"), 1);
  glow(275, 480, 95, hex("#F4A261"), 0.6);
  disc(275, 480, 42, hex("#E76F51"), 0.5);
  drawSurfer(275, 498, 1.25, hex("#FB8500"));
  // Foam along the crest and the inner lip edge.
  strokePath(crestLine(), [11, 9, 8, 7, 6, 5], hex("#F9F6EE"), 0.92);
  strokePath(
    [
      [690, 305],
      [620, 310],
      [560, 340],
      [510, 390],
      [470, 430],
    ],
    [10, 8, 6, 5, 4],
    hex("#F9F6EE"),
    0.8,
  );
  spray(rng, crestLine(), 130, hex("#F9F6EE"));
  // Head details; the eye sits on the sun disc.
  dragonHead(790, 175, 24, hex("#FFD97A"));
  // Birds escaping the spray.
  bird(180, 150, 9, INK, 0.85);
  bird(240, 120, 7, INK, 0.8);
  bird(130, 105, 6, INK, 0.75);
}

// ---------------------------------------------------------------------------
// Variant 2 — "Starlit Barrel": night sky lives inside the curl
// ---------------------------------------------------------------------------

function sceneStarlit(): void {
  const rng = mulberry32(777);
  drawSky([
    [0, hex("#1A0B2E")],
    [0.5, hex("#7E2F4E")],
    [0.85, hex("#FF6F61")],
    [1, hex("#FFB703")],
  ]);
  drawSun(790, 175, 70, hex("#FFE9A8"), hex("#FB8500"));
  drawSea(470, [[0, hex("#142E4A")], [1, hex("#0A1826")]], 790, hex("#FFE9A8"));
  poly(waveBodyPoints(), hex("#0B3D4D"), 1);
  poly(
    [
      [180, 410],
      [280, 330],
      [390, 260],
      [500, 200],
      [610, 160],
      [700, 150],
      [700, 210],
      [560, 260],
      [430, 330],
      [300, 420],
      [200, 470],
    ],
    hex("#1D7A6E"),
    0.3,
  );
  foamStreaks(hex("#CDEEE8"));
  // The barrel interior is deep space.
  poly(barrelArch(), hex("#1A0B2E"), 1);
  glow(275, 480, 90, hex("#4B0082"), 0.55);
  // Oversized geometric stars inside the tunnel, few and deliberate.
  const stars: Array<[number, number, number, string]> = [
    [230, 455, 16, "#FFC300"],
    [300, 435, 20, "#FF4D6D"],
    [350, 490, 13, "#FFC300"],
    [255, 515, 11, "#E0FBFB"],
    [320, 520, 9, "#FF4D6D"],
    [205, 505, 8, "#E0FBFB"],
  ];
  for (const [x, y, r, col] of stars) sparkle(x, y, r, hex(col), 0.95);
  for (let i = 0; i < 26; i++) {
    disc(170 + rng() * 210, 415 + rng() * 130, 1 + rng() * 1.6, hex("#E0FBFB"), 0.5 + rng() * 0.4);
  }
  drawSurfer(275, 498, 1.25, hex("#FFC300"));
  // Stardust trail behind the board.
  for (let i = 0; i < 14; i++) {
    const t = i / 13;
    disc(240 - t * 55, 512 - t * 22, 2.4 - t * 1.2, hex("#FFC300"), 0.85 - t * 0.5);
  }
  strokePath(crestLine(), [11, 9, 8, 7, 6, 5], hex("#F9F6EE"), 0.92);
  strokePath(
    [
      [690, 305],
      [620, 310],
      [560, 340],
      [510, 390],
      [470, 430],
    ],
    [10, 8, 6, 5, 4],
    hex("#F9F6EE"),
    0.8,
  );
  spray(rng, crestLine(), 70, hex("#F9F6EE"));
  dragonHead(790, 175, 22, hex("#FFE9A8"));
  bird(180, 150, 9, INK, 0.85);
  bird(240, 120, 7, INK, 0.8);
}

// ---------------------------------------------------------------------------
// Variant 3 — "Moon-tide Panorama": a wide wave, spray turning into birds
// ---------------------------------------------------------------------------

function scenePanorama(): void {
  const rng = mulberry32(31337);
  drawSky([
    [0, hex("#1A1A2E")],
    [0.45, hex("#4B0082")],
    [0.75, hex("#FF6F61")],
    [1, hex("#FFD700")],
  ]);
  drawSun(830, 140, 62, hex("#FFE9A8"), hex("#FB8500"));
  drawSea(470, [[0, hex("#123B4F")], [1, hex("#0A2233")]], 830, hex("#FFE9A8"));
  // Wide wave rising from the sea, peak at centre-top.
  const seg = (a: Pt, b: Pt, c: Pt, d: Pt): Pt[] => bezier(a, b, c, d, 22);
  const body: Pt[] = [];
  const add = (list: Pt[]): void => {
    for (let i = 0; i < list.length; i++) if (body.length === 0 || i > 0) body.push(list[i]);
  };
  add(seg([-40, 700], [60, 560], [140, 430], [230, 320]));
  add(seg([230, 320], [330, 240], [430, 195], [512, 180]));
  add(seg([512, 180], [600, 200], [700, 250], [790, 330]));
  add(seg([790, 330], [860, 430], [920, 560], [990, 700]));
  add(seg([990, 700], [760, 668], [500, 652], [300, 662]));
  add(seg([300, 662], [120, 648], [20, 680], [-40, 700]));
  poly(body, hex("#0B4B5E"), 1);
  poly(
    [
      [230, 320],
      [330, 240],
      [430, 195],
      [512, 180],
      [600, 200],
      [700, 250],
      [640, 300],
      [512, 260],
      [380, 300],
      [280, 380],
    ],
    hex("#00CED1"),
    0.32,
  );
  // Dragon head at the peak: snout to the right, horn swept back left.
  poly(
    [
      [512, 180],
      [640, 200],
      [682, 232],
      [640, 256],
      [560, 250],
      [512, 225],
    ],
    hex("#0B4B5E"),
    1,
  );
  poly(
    [
      [500, 192],
      [398, 108],
      [452, 178],
      [512, 198],
    ],
    INK,
    1,
  );
  // Lantern eye.
  disc(585, 215, 20, INK, 1);
  glow(585, 215, 52, hex("#FFD700"), 0.6);
  disc(585, 215, 15, hex("#FFD700"), 1);
  disc(580, 210, 6, [255, 255, 255], 0.9);
  // Teeth under the snout.
  for (let i = 0; i < 3; i++) {
    const x = 600 + i * 15;
    poly(
      [
        [x, 248],
        [x + 9, 248],
        [x + 4, 260],
      ],
      hex("#F9F6EE"),
      0.95,
    );
  }
  // Small barrel + surfer, low centre.
  poly(
    [
      [410, 520],
      [450, 470],
      [520, 465],
      [560, 500],
      [550, 560],
      [480, 575],
      [420, 560],
    ],
    hex("#071E29"),
    1,
  );
  drawSurfer(482, 528, 0.72, hex("#FFD700"));
  // Crest foam across the peak.
  strokePath(
    [...seg([230, 320], [330, 240], [430, 195], [512, 180]), ...seg([512, 180], [600, 200], [700, 250], [790, 330]).slice(1)],
    [9, 8, 7, 6, 5, 5],
    hex("#F9F6EE"),
    0.9,
  );
  spray(rng, seg([512, 180], [600, 200], [700, 250], [790, 330]), 60, hex("#F9F6EE"));
  // The twist: spray bursting from the lip becomes a flock of birds.
  const flock: Array<[number, number, number]> = [
    [700, 210, 6],
    [760, 180, 8],
    [820, 150, 10],
    [880, 128, 12],
    [940, 112, 13],
  ];
  for (const [x, y, s] of flock) bird(x, y, s, INK, 0.9);
  bird(150, 140, 8, INK, 0.8);
}

// ---------------------------------------------------------------------------
// Variant 4 — "One-Line Dragon": a single continuous stroke draws everything
// ---------------------------------------------------------------------------

function sceneOneLine(): void {
  drawSky([
    [0, hex("#023047")],
    [0.55, hex("#0B2545")],
    [0.8, hex("#7E2F4E")],
    [1, hex("#E76F51")],
  ]);
  drawSun(800, 180, 75, hex("#FFB703"), hex("#FB8500"));
  drawSea(470, [[0, hex("#0A2E3F")], [1, hex("#06222E")]], 800, hex("#FFB703"));
  const seg = (a: Pt, b: Pt, c: Pt, d: Pt): Pt[] => bezier(a, b, c, d, 20);
  // One unbroken path: sea, up the back, over the crest, curling into the head,
  // back down the inner edge, one loop for the barrel, ending at the surfer.
  const path: Pt[] = [];
  const add = (list: Pt[]): void => {
    for (let i = 0; i < list.length; i++) if (path.length === 0 || i > 0) path.push(list[i]);
  };
  add(seg([-20, 680], [80, 560], [170, 450], [280, 340]));
  add(seg([280, 340], [400, 250], [520, 190], [640, 160]));
  add(seg([640, 160], [740, 170], [800, 190], [820, 210]));
  add(seg([820, 210], [830, 250], [800, 275], [730, 300]));
  add(seg([730, 300], [650, 320], [570, 370], [500, 440]));
  add(seg([500, 440], [460, 500], [440, 560], [450, 620]));
  // Barrel loop: one full turn around the tunnel.
  const loop: Pt[] = [];
  for (let k = 0; k <= 24; k++) {
    const a = (k / 24) * Math.PI * 2 - Math.PI / 2;
    loop.push([400 + Math.cos(a) * 58, 505 + Math.sin(a) * 48]);
  }
  add(loop);
  // Finish with the surfer: a tiny rising squiggle.
  add(seg([458, 505], [400, 520], [350, 530], [320, 545]));
  // Widths swell toward the crest and thin toward the tail.
  const widths = path.map((_, i) => {
    const t = i / (path.length - 1);
    return 6 + 20 * Math.sin(Math.PI * clamp(t, 0, 1));
  });
  strokePath(path, widths, hex("#F5F0E1"), 0.96);
  // The eye: one gold dot where the head curls.
  disc(742, 218, 10, hex("#FFB703"), 1);
  glow(742, 218, 30, hex("#FFB703"), 0.5);
  bird(200, 130, 9, hex("#F5F0E1"), 0.85);
  bird(260, 100, 7, hex("#F5F0E1"), 0.8);
}

// ---------------------------------------------------------------------------
// Render + entry point
// ---------------------------------------------------------------------------

function render(variant: number): Uint8Array {
  if (variant === 2) sceneStarlit();
  else if (variant === 3) scenePanorama();
  else if (variant === 4) sceneOneLine();
  else sceneSunEye();
  return downsample();
}

function parseVariant(arg: string | undefined): number {
  if (arg === undefined) return 1;
  const n = parseInt(arg, 10);
  if (Number.isNaN(n)) return 1;
  return clamp(n, 1, 4);
}

function main(): void {
  const variant = parseVariant(process.argv[2]);
  const rgb = render(variant);
  const png = encodePNG(rgb, W, H);
  const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? "/output";
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, "entry.png");
  writeFileSync(outPath, png);
  console.log(`variant=${variant} ${W}x${H} ${png.length} bytes -> ${outPath}`);
}

main();
