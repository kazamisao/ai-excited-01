// ai-excited-01 — "The Sun-Eye Dragon"
// A from-scratch software renderer (Node built-ins only) that paints one image:
// a colossal breaking wave whose thrown lip and curl form a dragon's head in
// profile, the low sun blazing through the curl as the dragon's golden eye,
// and one tiny surfer riding the barrel wall beneath it. Deterministic: fixed
// seeds, no clock, no network, no assets. The same bytes come out every run.
//
// Run locally:  mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
// In the grader the program writes to /output/entry.png.

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

// ---------------------------------------------------------------------------
// Deterministic PRNG (mulberry-style): every spray dot and foam fleck in the
// picture comes from these streams, so renders are byte-identical.
// ---------------------------------------------------------------------------
function makeRng(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Colour helpers. Colours are [r, g, b] float triples in 0..1.
// ---------------------------------------------------------------------------
function hex(h) {
  return [
    parseInt(h.slice(1, 3), 16) / 255,
    parseInt(h.slice(3, 5), 16) / 255,
    parseInt(h.slice(5, 7), 16) / 255,
  ];
}
function mix(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
function smooth(a, b, v) {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
}

// ---------------------------------------------------------------------------
// Frame buffer at supersampled resolution. Design space is 1024x1024; all
// drawing calls take design coordinates and scale internally by SS.
// ---------------------------------------------------------------------------
const W = 1024;
const H = 1024;
const SS = 2;
const PW = W * SS;
const PH = H * SS;
const buf = new Float32Array(PW * PH * 3);

function putPx(x, y, c, alpha) {
  if (x < 0 || y < 0 || x >= PW || y >= PH) return;
  const i = (y * PW + x) * 3;
  if (alpha >= 1) {
    buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2];
  } else if (alpha > 0) {
    buf[i] += (c[0] - buf[i]) * alpha;
    buf[i + 1] += (c[1] - buf[i + 1]) * alpha;
    buf[i + 2] += (c[2] - buf[i + 2]) * alpha;
  }
}

function addPx(x, y, c, amount) {
  if (x < 0 || y < 0 || x >= PW || y >= PH || amount <= 0) return;
  const i = (y * PW + x) * 3;
  buf[i] += c[0] * amount;
  buf[i + 1] += c[1] * amount;
  buf[i + 2] += c[2] * amount;
}

// Filled polygon via even-odd scanline. colorAt(dx, dy) is called per pixel in
// design coordinates and returns [r,g,b] or [r,g,b,alpha].
function fillPoly(points, colorAt) {
  let minY = Infinity, maxY = -Infinity;
  for (const p of points) { if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1]; }
  const y0 = Math.max(0, Math.floor(minY * SS));
  const y1 = Math.min(PH - 1, Math.ceil(maxY * SS));
  const n = points.length;
  for (let py = y0; py <= y1; py++) {
    const dy = (py + 0.5) / SS;
    const xs = [];
    for (let i = 0; i < n; i++) {
      const a = points[i], b = points[(i + 1) % n];
      if ((a[1] <= dy && b[1] > dy) || (b[1] <= dy && a[1] > dy)) {
        xs.push(a[0] + ((dy - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
      }
    }
    if (xs.length < 2) continue;
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xa = Math.max(0, Math.floor(xs[k] * SS));
      const xb = Math.min(PW - 1, Math.ceil(xs[k + 1] * SS));
      for (let px = xa; px <= xb; px++) {
        const c = colorAt((px + 0.5) / SS, dy);
        putPx(px, py, c, c.length > 3 ? c[3] : 1);
      }
    }
  }
}

// Soft disc: solid inside r-feather, fading to nothing at r.
function disc(cx, cy, r, colorAt, feather = 1.5) {
  const x0 = Math.max(0, Math.floor((cx - r - feather) * SS));
  const x1 = Math.min(PW - 1, Math.ceil((cx + r + feather) * SS));
  const y0 = Math.max(0, Math.floor((cy - r - feather) * SS));
  const y1 = Math.min(PH - 1, Math.ceil((cy + r + feather) * SS));
  for (let py = y0; py <= y1; py++) {
    for (let px = x0; px <= x1; px++) {
      const dx = (px + 0.5) / SS - cx;
      const dyy = (py + 0.5) / SS - cy;
      const d = Math.sqrt(dx * dx + dyy * dyy);
      const cov = clamp01((r - d) / feather + 0.5);
      if (cov <= 0) continue;
      const c = colorAt((px + 0.5) / SS, (py + 0.5) / SS);
      putPx(px, py, c, (c.length > 3 ? c[3] : 1) * cov);
    }
  }
}

// Additive radial glow (sun halo, backlight). fall is the power curve.
function glow(cx, cy, r, color, strength, fall = 2) {
  const x0 = Math.max(0, Math.floor((cx - r) * SS));
  const x1 = Math.min(PW - 1, Math.ceil((cx + r) * SS));
  const y0 = Math.max(0, Math.floor((cy - r) * SS));
  const y1 = Math.min(PH - 1, Math.ceil((cy + r) * SS));
  for (let py = y0; py <= y1; py++) {
    for (let px = x0; px <= x1; px++) {
      const dx = (px + 0.5) / SS - cx;
      const dyy = (py + 0.5) / SS - cy;
      const d = Math.sqrt(dx * dx + dyy * dyy) / r;
      if (d >= 1) continue;
      addPx(px, py, color, strength * Math.pow(1 - d, fall));
    }
  }
}

// Sample a cubic bezier into a polyline (excluding the start point).
function bez(pts, x0, y0, x1, y1, x2, y2, x3, y3, steps = 26) {
  for (let i = 1; i <= steps; i++) {
    const t = i / steps, u = 1 - t;
    pts.push([
      u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
      u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3,
    ]);
  }
}

// ---------------------------------------------------------------------------
// PNG encoder: CRC32 + chunked zlib stream with a per-row filter choice
// (None/Sub/Up/Average/Paeth by minimum sum of absolute signed residuals).
// ---------------------------------------------------------------------------
const crcTable = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();
function crc32(bytes) {
  let c = -1;
  for (let i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]) & 255] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}
function encodePng(rgb, w, h) {
  const stride = w * 3;
  const raw = Buffer.alloc((stride + 1) * h);
  const prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const row = rgb.subarray(y * stride, (y + 1) * stride);
    let bestType = 0, bestScore = Infinity, bestRow = null;
    for (let type = 0; type <= 4; type++) {
      const cand = Buffer.alloc(stride);
      let score = 0;
      for (let i = 0; i < stride; i++) {
        const left = i >= 3 ? row[i - 3] : 0;
        const up = prev[i];
        const upLeft = i >= 3 ? prev[i - 3] : 0;
        let pred = 0;
        if (type === 1) pred = left;
        else if (type === 2) pred = up;
        else if (type === 3) pred = (left + up) >> 1;
        else if (type === 4) pred = paeth(left, up, upLeft);
        const v = (row[i] - pred) & 255;
        cand[i] = v;
        score += v < 128 ? v : 256 - v;
      }
      if (score < bestScore) { bestScore = score; bestType = type; bestRow = cand; }
    }
    const off = y * (stride + 1);
    raw[off] = bestType;
    bestRow.copy(raw, off + 1);
    row.copy(prev);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour RGB
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Downsample the supersampled buffer by SS and quantise to bytes.
function finish() {
  const out = Buffer.alloc(W * H * 3);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const i = ((y * SS + sy) * PW + (x * SS + sx)) * 3;
          r += buf[i]; g += buf[i + 1]; b += buf[i + 2];
        }
      }
      const n = SS * SS;
      const o = (y * W + x) * 3;
      out[o] = Math.round(clamp01(r / n) * 255);
      out[o + 1] = Math.round(clamp01(g / n) * 255);
      out[o + 2] = Math.round(clamp01(b / n) * 255);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Scene geometry. The eye of the dragon: a low sun seen through the curl.
// ---------------------------------------------------------------------------
const EYE = { x: 640, y: 320, r: 84 };

// The great wave's outer silhouette, in design coordinates. The face sweeps
// up from the lower left, the lip throws far over to the left and hangs above
// the barrel, and the mass of the head fills the right side around the eye.
function waveOutline() {
  const pts = [[0, 1024], [0, 880]];
  bez(pts, 0, 880, 40, 760, 120, 640, 215, 520);        // the rising face
  bez(pts, 215, 520, 262, 452, 292, 392, 318, 330);    // lip underside
  bez(pts, 318, 330, 338, 262, 392, 205, 478, 168);    // over the lip
  bez(pts, 478, 168, 580, 128, 716, 124, 828, 168);    // crown of the head
  bez(pts, 828, 168, 928, 214, 996, 300, 1024, 392);   // back of the neck
  pts.push([1024, 1024]);
  return pts;
}

// ---------------------------------------------------------------------------
// Detail helpers.
// ---------------------------------------------------------------------------
// A tapered, slightly curved spike (claw, horn, mane crest): base at (x, y),
// pointing along angle, with a bend. Drawn as a filled polygon.
function spike(x, y, angle, len, wBase, bend, colorAt) {
  const dx = Math.cos(angle), dy = Math.sin(angle);
  const px = -dy, py = dx;
  const mx = x + dx * len * 0.55 + px * bend, my = y + dy * len * 0.55 + py * bend;
  const tipX = x + dx * len + px * bend * 1.7, tipY = y + dy * len + py * bend * 1.7;
  const pts = [[x + px * wBase, y + py * wBase]];
  bez(pts, x + px * wBase, y + py * wBase, mx + px * wBase * 0.45, my + py * wBase * 0.45, tipX, tipY, tipX, tipY, 12);
  bez(pts, tipX, tipY, mx - px * wBase * 0.45, my - py * wBase * 0.45, x - px * wBase, y - py * wBase, x - px * wBase, y - py * wBase, 12);
  fillPoly(pts, colorAt);
}

// A thick smooth stroke through a polyline, drawn as overlapping discs.
function stroke(pts, width, color) {
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
    const len = Math.hypot(bx - ax, by - ay);
    const steps = Math.max(1, Math.ceil(len / 2.5));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      disc(ax + (bx - ax) * t, ay + (by - ay) * t, width / 2, () => color, 1.2);
    }
  }
}

// Polygon points of a rotated ellipse.
function ellipsePts(cx, cy, rx, ry, rot, n = 44) {
  const pts = [];
  const cr = Math.cos(rot), sr = Math.sin(rot);
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    const ex = Math.cos(t) * rx, ey = Math.sin(t) * ry;
    pts.push([cx + ex * cr - ey * sr, cy + ex * sr + ey * cr]);
  }
  return pts;
}

// Scatter foam dots placed by a callback using a seeded stream.
function sprayDots(rng, n, place, color, rMin, rMax, aMin, aMax) {
  for (let i = 0; i < n; i++) {
    const p = place(rng);
    if (!p) continue;
    const r = rMin + rng() * (rMax - rMin);
    const a = aMin + rng() * (aMax - aMin);
    disc(p[0], p[1], r, () => [color[0], color[1], color[2], a], Math.max(0.8, r * 0.45));
  }
}

function paintDetails(cfg) {
  const foam = hex(cfg.foam);
  const deepHex = hex(cfg.waveDeep);

  // -- two far birds, upper left --
  const bird = hex(cfg.cloud);
  for (const [bx, by, s] of [[196, 196, 12], [262, 158, 8]]) {
    stroke([[bx - s, by], [bx - s * 0.35, by - s * 0.55], [bx, by]], 2.6, [bird[0], bird[1], bird[2], 0.7]);
    stroke([[bx, by], [bx + s * 0.35, by - s * 0.55], [bx + s, by]], 2.6, [bird[0], bird[1], bird[2], 0.7]);
  }

  // -- the barrel: a dark throat under the lip with a lit crescent floor --
  fillPoly(ellipsePts(345, 478, 152, 108, -0.35), () => {
    const c = hex(cfg.barrel);
    return [c[0], c[1], c[2], 0.95];
  });
  fillPoly(ellipsePts(372, 508, 116, 74, -0.35), () => {
    const c = hex(cfg.barrelLit);
    return [c[0], c[1], c[2], 0.85];
  });
  glow(362, 502, 128, hex(cfg.sunGlow), 0.38 * cfg.glowStrength, 2);

  // -- the surfer: one small solid rider crouched on the barrel's lit floor,
  // drawn in absolute coordinates as a bold filled silhouette --
  const sil = hex(cfg.silhouette);
  const sc = [sil[0], sil[1], sil[2], 1];
  stroke([[262, 584], [340, 574], [428, 560]], 9, sc);       // board
  stroke([[336, 530], [310, 548], [308, 572]], 11, sc);      // back leg
  stroke([[340, 528], [372, 540], [386, 560]], 11, sc);      // front leg
  stroke([[338, 530], [354, 492]], 16, sc);                  // torso
  stroke([[352, 500], [316, 484]], 9, sc);                   // back arm
  stroke([[356, 498], [398, 506]], 9, sc);                   // front arm
  disc(360, 476, 11, () => sc, 1.2);                         // head
  // spray bursting off the board's tail
  const rngBoard = makeRng(9182);
  sprayDots(rngBoard, 120, (r) => {
    const t = r();
    return [262 - t * 62 + (r() - 0.5) * 14, 584 - t * 20 + (r() - 0.5) * 18];
  }, foam, 1.1, 3.4, 0.35, 0.9);

  // -- the eye socket: a ring of dark water around the sun, a brow above --
  disc(EYE.x, EYE.y, EYE.r + 32, (x, y) => {
    const d = Math.sqrt((x - EYE.x) ** 2 + (y - EYE.y) ** 2);
    const a = smooth(EYE.r + 2, EYE.r + 18, d) * (1 - smooth(EYE.r + 28, EYE.r + 38, d));
    const c = mix(deepHex, hex(cfg.waveMid), 0.35);
    return [c[0], c[1], c[2], a * 0.92];
  }, 2);
  disc(EYE.x, EYE.y, EYE.r, (x, y) => {
    const d = Math.sqrt((x - EYE.x) ** 2 + (y - EYE.y) ** 2) / EYE.r;
    return mix(hex(cfg.sunCore), hex(cfg.sunEdge), smooth(0.15, 1, d));
  });
  if (cfg.pupil) {
    fillPoly(ellipsePts(EYE.x, EYE.y, 12.5, 52, 0.12), () => {
      const c = hex(cfg.pupilColor);
      return [c[0], c[1], c[2], 0.9];
    });
    disc(EYE.x - 21, EYE.y - 29, 6.5, () => [1, 1, 1, 0.85], 2);
  }
  // brow ridge: a heavy arc over the eye, foam-lit on its top edge
  const browPts = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24, a = Math.PI * (1.08 + 0.84 * t);
    browPts.push([EYE.x + Math.cos(a) * 112, EYE.y + Math.sin(a) * 100 - 8]);
  }
  stroke(browPts.map(([x, y]) => [x, y - 7]), 12, [...foam, 0.5]);
  stroke(browPts, 14, [...hex(cfg.brow), 1]);

  // -- mane: short foam crests standing along the crown of the head --
  const crown = [[478, 168]];
  bez(crown, 478, 168, 580, 128, 716, 124, 828, 168, 30);
  const rngMane = makeRng(5150);
  for (let i = 2; i < crown.length - 1; i += 5) {
    const [cx, cy] = crown[i];
    const len = 15 + rngMane() * 15;
    spike(cx, cy + 3, -Math.PI / 2 + (rngMane() - 0.5) * 0.45 - 0.12,
      len, 8.5, 4, (x, y) => mix(hex(cfg.waveLip), foam, clamp01((cy + 8 - y) / len + 0.3)));
  }
  // -- claws gripping over the lip tip --
  spike(326, 318, 2.25, 40, 10.5, 9, () => [...foam, 0.95]);
  spike(342, 298, 2.5, 36, 9.5, 7, () => [...foam, 0.95]);
  spike(358, 282, 2.75, 30, 8.5, 5, () => [...foam, 0.9]);
  // -- teeth hanging from the upper jaw, just under the lip --
  for (const [tx, ty, tl] of [[312, 344, 23], [303, 362, 20], [293, 390, 18], [280, 424, 15]]) {
    fillPoly([[tx - 5.5, ty], [tx + 5.5, ty], [tx - 2, ty + tl]], () => [...foam, 0.94]);
  }
  // -- nostril jets: twin spray arcs bursting from the snout --
  const rngNos = makeRng(777);
  for (const [ox, oy, vx, vy] of [[308, 352, -2.7, 0.8], [314, 366, -2.3, 1.6]]) {
    sprayDots(rngNos, 75, (r) => {
      const t = r();
      return [ox + vx * t * 58 + (r() - 0.5) * 11, oy + vy * t * 58 + t * t * 24 + (r() - 0.5) * 11];
    }, foam, 1.0, 3.2, 0.3, 0.85);
  }
  // -- spray thrown off the lip, up and to the left --
  const rngLip = makeRng(2024);
  sprayDots(rngLip, 160, (r) => {
    const t = r();
    return [322 - t * 200 + (r() - 0.5) * 28, 322 - t * 130 + t * t * 95 + (r() - 0.5) * 24];
  }, foam, 1.1, 4.0, 0.25, 0.9);
  // -- foam flecks riding the crest of the lip and crown --
  const rngFoam = makeRng(4242);
  sprayDots(rngFoam, 380, (r) => {
    const edge = [];
    bez(edge, 318, 330, 338, 262, 392, 205, 478, 168, 8);
    bez(edge, 478, 168, 580, 128, 716, 124, 828, 168, 8);
    const p = edge[Math.floor(r() * edge.length)];
    return [p[0] + (r() - 0.5) * 20, p[1] + (r() - 0.5) * 14 + r() * 7];
  }, foam, 0.9, 3.2, 0.2, 0.7);
  // -- foreground: deep water at the base, sparkles, fine spray toward us --
  fillPoly([[0, 884], [1024, 884], [1024, 1024], [0, 1024]], (x, y) => {
    const a = smooth(884, 1024, y) * 0.38;
    return [0.01, 0.03, 0.07, a];
  });
  const rngSpark = makeRng(808);
  sprayDots(rngSpark, 240, (r) => [r() * 1024, 700 + r() * 310], hex(cfg.sunEdge), 0.8, 1.9, 0.15, 0.55);
  const rngSplash = makeRng(999);
  sprayDots(rngSplash, 190, (r) => {
    const t = r();
    return [712 + t * 312 + (r() - 0.5) * 54, 1024 - t * 238 + (r() - 0.5) * 44];
  }, foam, 1.2, 4.6, 0.3, 0.92);

  // -- vignette: pull the corners down so the eye stays the brightest thing --
  if (cfg.vignette > 0) {
    for (let py = 0; py < PH; py++) {
      for (let px = 0; px < PW; px++) {
        const dx = (px + 0.5) / SS - 512, dy = (py + 0.5) / SS - 512;
        const d = Math.sqrt(dx * dx + dy * dy) / 724;
        const f = 1 - cfg.vignette * smooth(0.52, 1.02, d);
        if (f < 1) {
          const i = (py * PW + px) * 3;
          buf[i] *= f; buf[i + 1] *= f; buf[i + 2] *= f;
        }
      }
    }
  }
}

function render(cfg) {
  // -- sky --
  const skyTop = hex(cfg.skyTop), skyMid = hex(cfg.skyMid), skyLow = hex(cfg.skyLow);
  for (let py = 0; py < PH; py++) {
    const dy = (py + 0.5) / SS;
    const t = dy / H;
    let c;
    if (cfg.flatSky) {
      c = t < 0.34 ? skyTop : t < 0.67 ? skyMid : skyLow;
    } else {
      c = t < 0.55 ? mix(skyTop, skyMid, t / 0.55) : mix(skyMid, skyLow, (t - 0.55) / 0.45);
    }
    for (let px = 0; px < PW; px++) putPx(px, py, c, 1);
  }
  glow(EYE.x, EYE.y, 430, hex(cfg.sunGlow), 0.55 * cfg.glowStrength, 2);

  // -- the sun itself, drawn before the wave so the wave can wrap it --
  disc(EYE.x, EYE.y, EYE.r, (x, y) => {
    const d = Math.sqrt((x - EYE.x) ** 2 + (y - EYE.y) ** 2) / EYE.r;
    return mix(hex(cfg.sunCore), hex(cfg.sunEdge), smooth(0.15, 1, d));
  });

  // -- the wave mass --
  const deep = hex(cfg.waveDeep), mid = hex(cfg.waveMid), lip = hex(cfg.waveLip);
  fillPoly(waveOutline(), (x, y) => {
    let t = clamp01(1 - y / 900);
    if (cfg.waveSteps > 0) t = Math.floor(t * cfg.waveSteps) / (cfg.waveSteps - 1);
    let c = t < 0.5 ? mix(deep, mid, t / 0.5) : mix(mid, lip, (t - 0.5) / 0.5);
    // sunset light shining through the water near the eye
    const dEye = Math.sqrt((x - EYE.x) ** 2 + (y - EYE.y) ** 2);
    const through = clamp01(1 - dEye / 300);
    c = mix(c, hex(cfg.sunEdge), through * through * cfg.throughLight);
    // slow flow shading: soft diagonal bands running down the face
    const band = Math.sin((x * 0.55 + y * 1.0) * 0.021) * 0.5 + Math.sin((x * -0.3 + y) * 0.008) * 0.5;
    const shade = 1 + band * cfg.bandStrength;
    return [clamp01(c[0] * shade), clamp01(c[1] * shade), clamp01(c[2] * shade)];
  });

  paintDetails(cfg);

  return finish();
}

const CONFIGS = {
  // 1 — Sunset: violet-to-orange sky, teal wave, the sun itself is the eye.
  1: {
    skyTop: '#241243', skyMid: '#6d2160', skyLow: '#e85d2a',
    sunCore: '#fff3b0', sunEdge: '#ff9e2c', sunGlow: '#ff8c3a',
    waveDeep: '#052238', waveMid: '#0a5f74', waveLip: '#14b8a6',
    foam: '#ffffff', barrel: '#03182b', barrelLit: '#1b7f79', cloud: '#1a0b33',
    silhouette: '#070a18', brow: '#07404a', horn: '#ffe9c9',
    throughLight: 0.35, bandStrength: 0.10, pupil: false, pupilColor: '#2a1503',
    flatSky: false, waveSteps: 0, glowStrength: 1, vignette: 0.26,
  },
  // 2 — Storm night: deep blue dark, a pale moon-gold eye with a dragon's
  // slit pupil, electric foam.
  2: {
    skyTop: '#040918', skyMid: '#0a2340', skyLow: '#14506e',
    sunCore: '#fffbe8', sunEdge: '#ffd98a', sunGlow: '#7fd4d8',
    waveDeep: '#03182e', waveMid: '#0a4d5e', waveLip: '#17b8a6',
    foam: '#eafcff', barrel: '#020c18', barrelLit: '#14665e', cloud: '#020610',
    silhouette: '#04060e', brow: '#062a33', horn: '#dff6ff',
    throughLight: 0.22, bandStrength: 0.13, pupil: true, pupilColor: '#101820',
    flatSky: false, waveSteps: 0, glowStrength: 1, vignette: 0.3,
  },
  // 3 — Woodblock poster: flat banded sky, deep indigo wave, a vermilion
  // sun-eye with a slit pupil, hard light, almost no glow.
  3: {
    skyTop: '#33506e', skyMid: '#e6d7ae', skyLow: '#f7ecd2',
    sunCore: '#ff7847', sunEdge: '#e33f1f', sunGlow: '#ff9a5c',
    waveDeep: '#101f36', waveMid: '#1d3557', waveLip: '#2c5d8a',
    foam: '#ffffff', barrel: '#0d1b2e', barrelLit: '#3f6d96', cloud: '#22303e',
    silhouette: '#0b0b10', brow: '#0d1b2e', horn: '#f7ecd2',
    throughLight: 0.0, bandStrength: 0.0, pupil: true, pupilColor: '#1a0505',
    flatSky: true, waveSteps: 0, glowStrength: 0.3, vignette: 0.08,
  },
};

function main() {
  // The submitted default is variant 2, "Storm night": the slit-pupil moon
  // eye makes the dragon read instantly, even at thumbnail size. Variants 1
  // (sunset) and 3 (poster) remain selectable for local exploration.
  const variant = Number(process.argv[2] ?? 2);
  const cfg = CONFIGS[variant] ?? CONFIGS[2];
  const rgb = render(cfg);
  const png = encodePng(rgb, W, H);
  const dir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'entry.png'), png);
}

main();
