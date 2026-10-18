/**
 * QR Code Generator — Native implementation for HMJ SMS Desktop Sync pairing.
 * Fixed to ECC Level L (optimized for maximum payload capacity for pairing).
 * Byte-mode encoding, auto version selection (1–40).
 * Zero dependencies. Renders to HTML5 Canvas.
 *
 * API: renderQrCode(container, text, size) draws the code for text in
 * a canvas of about size pixels, with one canvas pixel per module times
 * a whole scale; the page's CSS sets the size it is shown at.
 *
 * Copyright (c) 2026 Himanshu Mahendra Jain.
 * SPDX-License-Identifier: MIT
 */

// ── Galois Field GF(256) ──────────────────────────────────────────────
// Primitive polynomial: x^8 + x^4 + x^3 + x^2 + 1 (0x11D)
const GF_EXP = new Uint8Array(512); // doubled to avoid modulo in multiply
const GF_LOG = new Uint8Array(256);

(function () {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x = (x << 1) ^ (x & 128 ? 0x11D : 0);
    x &= 0xFF;
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
})();

function gfMul(a, b) {
  return (a === 0 || b === 0) ? 0 : GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

// ── Reed-Solomon Error Correction ─────────────────────────────────────
function rsEncode(data, numEcc) {
  // Build monic generator polynomial: product of (x + α^i) for i = 0..numEcc-1
  let gen = new Uint8Array(numEcc + 1);
  gen[0] = 1;
  for (let i = 0; i < numEcc; i++) {
    for (let j = numEcc; j > 0; j--) {
      gen[j] = gen[j] ^ gfMul(gen[j - 1], GF_EXP[i]);
    }
  }
  // Polynomial long division — compute remainder
  let ecc = new Uint8Array(numEcc);
  for (let i = 0; i < data.length; i++) {
    let coef = data[i] ^ ecc[0];
    ecc.copyWithin(0, 1);
    ecc[numEcc - 1] = 0;
    for (let j = 0; j < numEcc; j++) {
      ecc[j] ^= gfMul(gen[j + 1], coef);
    }
  }
  return ecc;
}

// ── Version Data (ECC Level L) ────────────────────────────────────────
// [blocks_g1, dataCW_g1, blocks_g2, dataCW_g2, eccCW_per_block]
const RS = [
  [1, 19, 0, 0, 7], [1, 34, 0, 0, 10], [1, 55, 0, 0, 15], [1, 80, 0, 0, 20], [1, 108, 0, 0, 26],
  [2, 68, 0, 0, 18], [2, 78, 0, 0, 20], [2, 97, 0, 0, 24], [2, 116, 0, 0, 30], [2, 68, 2, 69, 18],
  [4, 81, 0, 0, 20], [2, 92, 2, 93, 24], [4, 107, 0, 0, 26], [3, 115, 1, 116, 30], [5, 87, 1, 88, 22],
  [5, 98, 1, 99, 24], [1, 107, 5, 108, 28], [5, 120, 1, 121, 30], [3, 113, 4, 114, 28], [3, 107, 5, 108, 28],
  [4, 116, 4, 117, 28], [2, 111, 7, 112, 28], [4, 121, 5, 122, 30], [6, 117, 4, 118, 30], [8, 106, 4, 107, 26],
  [10, 114, 2, 115, 28], [8, 122, 4, 123, 30], [3, 117, 10, 118, 30], [7, 116, 7, 117, 30], [5, 115, 10, 116, 30],
  [13, 115, 3, 116, 30], [17, 115, 0, 0, 30], [17, 115, 1, 116, 30], [13, 115, 6, 116, 30], [12, 121, 7, 122, 30],
  [6, 121, 14, 122, 30], [17, 122, 4, 123, 30], [4, 122, 18, 123, 30], [20, 117, 4, 118, 30], [19, 118, 6, 119, 30]
];

// Alignment pattern centre coordinates per version (index 0 = version 1)
const ALIGN = [
  [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34],
  [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50], [6, 30, 54], [6, 32, 58], [6, 34, 62],
  [6, 26, 46, 66], [6, 26, 48, 70], [6, 26, 50, 74], [6, 30, 54, 78], [6, 30, 56, 82], [6, 30, 58, 86], [6, 34, 62, 90],
  [6, 28, 50, 72, 94], [6, 26, 50, 74, 98], [6, 30, 54, 78, 102], [6, 28, 54, 80, 106], [6, 32, 58, 84, 110],
  [6, 30, 58, 86, 114], [6, 34, 62, 90, 118],
  [6, 26, 50, 74, 98, 122], [6, 30, 54, 78, 102, 126], [6, 26, 52, 78, 104, 130], [6, 30, 56, 82, 108, 134],
  [6, 34, 60, 86, 112, 138], [6, 30, 58, 86, 114, 142], [6, 34, 62, 90, 118, 146],
  [6, 30, 54, 78, 102, 126, 150], [6, 24, 50, 76, 102, 128, 154], [6, 28, 54, 80, 106, 132, 158],
  [6, 32, 58, 84, 110, 136, 162], [6, 26, 54, 82, 110, 138, 166], [6, 30, 58, 86, 114, 142, 170]
];

// ── Find smallest version for the data length ─────────────────────────
function findVersion(byteLen) {
  for (let v = 1; v <= 40; v++) {
    let b = RS[v - 1];
    let totalData = b[0] * b[1] + b[2] * b[3];
    let ccBits = v <= 9 ? 8 : 16;
    let maxBytes = Math.floor((totalData * 8 - 4 - ccBits) / 8);
    if (byteLen <= maxBytes) return v;
  }
  throw new Error("Data too long for QR code");
}

// ── Encode text into padded data codewords (byte mode) ────────────────
function encodeData(bytes, version) {
  let b = RS[version - 1];
  let totalData = b[0] * b[1] + b[2] * b[3];
  let ccBits = version <= 9 ? 8 : 16;
  let capacityBits = totalData * 8;

  // Build bit stream
  let bits = [];
  function push(val, len) {
    for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
  }
  push(0x4, 4);               // byte mode indicator
  push(bytes.length, ccBits); // character count
  for (let i = 0; i < bytes.length; i++) push(bytes[i], 8);

  // Terminator
  push(0, Math.min(4, capacityBits - bits.length));
  // Pad to byte boundary
  while (bits.length % 8) bits.push(0);
  // Pad bytes 0xEC / 0x11
  for (let pad = 0xEC; bits.length < capacityBits; pad ^= 0xEC ^ 0x11) push(pad, 8);

  // Pack into bytes
  let cw = new Uint8Array(totalData);
  for (let i = 0; i < totalData; i++) {
    let v = 0;
    for (let j = 0; j < 8; j++) v = (v << 1) | bits[i * 8 + j];
    cw[i] = v;
  }
  return cw;
}

// ── Interleave data blocks + ECC ──────────────────────────────────────
function interleave(cw, version) {
  let b = RS[version - 1];
  let n1 = b[0], d1 = b[1], n2 = b[2], d2 = b[3], ecc = b[4];
  let numBlocks = n1 + n2;

  let dataB = [], eccB = [], off = 0;
  for (let i = 0; i < n1; i++) { let s = cw.slice(off, off + d1); dataB.push(s); eccB.push(rsEncode(s, ecc)); off += d1; }
  for (let i = 0; i < n2; i++) { let s = cw.slice(off, off + d2); dataB.push(s); eccB.push(rsEncode(s, ecc)); off += d2; }

  let out = [];
  let maxD = Math.max(d1, d2 || 0);
  for (let i = 0; i < maxD; i++) for (let j = 0; j < numBlocks; j++) if (i < dataB[j].length) out.push(dataB[j][i]);
  for (let i = 0; i < ecc; i++) for (let j = 0; j < numBlocks; j++) out.push(eccB[j][i]);
  return new Uint8Array(out);
}

// ── Matrix construction ───────────────────────────────────────────────
function buildMatrix(version, allCW) {
  let size = version * 4 + 17;
  let mod = [], res = [];
  for (let r = 0; r < size; r++) { mod.push(new Array(size).fill(false)); res.push(new Array(size).fill(false)); }

  function set(r, c, dark, fn) {
    if (r >= 0 && r < size && c >= 0 && c < size) { mod[r][c] = dark; if (fn) res[r][c] = true; }
  }

  // Finder patterns (7×7) + 1-module separator
  function finder(tr, tc) {
    for (let dr = -1; dr <= 7; dr++) for (let dc = -1; dc <= 7; dc++) {
      let r2 = tr + dr, c2 = tc + dc;
      if (r2 < 0 || r2 >= size || c2 < 0 || c2 >= size) continue;
      if (dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6) {
        let mx = Math.max(Math.abs(dr - 3), Math.abs(dc - 3));
        set(r2, c2, mx !== 2, true);
      } else {
        set(r2, c2, false, true); // separator
      }
    }
  }
  finder(0, 0);
  finder(0, size - 7);
  finder(size - 7, 0);

  // Alignment patterns (5×5)
  let ap = ALIGN[version - 1];
  for (let i = 0; i < ap.length; i++) for (let j = 0; j < ap.length; j++) {
    let cr = ap[i], cc = ap[j];
    if ((cr <= 8 && cc <= 8) || (cr <= 8 && cc >= size - 8) || (cr >= size - 8 && cc <= 8)) continue;
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) {
      set(cr + dr, cc + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1, true);
    }
  }

  // Timing patterns
  for (let i = 8; i < size - 8; i++) {
    if (!res[6][i]) set(6, i, i % 2 === 0, true);
    if (!res[i][6]) set(i, 6, i % 2 === 0, true);
  }

  // Dark module
  set(4 * version + 9, 8, true, true);

  // Reserve format info areas
  for (let i = 0; i <= 8; i++) { if (!res[8][i]) set(8, i, false, true); if (!res[i][8]) set(i, 8, false, true); }
  for (let i = 0; i < 8; i++) { if (!res[8][size - 1 - i]) set(8, size - 1 - i, false, true); }
  for (let i = 0; i < 7; i++) { if (!res[size - 1 - i][8]) set(size - 1 - i, 8, false, true); }

  // Reserve version info areas (v ≥ 7)
  if (version >= 7) {
    for (let i = 0; i < 6; i++) for (let j = 0; j < 3; j++) {
      if (!res[size - 11 + j][i]) set(size - 11 + j, i, false, true);
      if (!res[i][size - 11 + j]) set(i, size - 11 + j, false, true);
    }
  }

  // Place data codewords (zigzag)
  let bi = 0, totalBits = allCW.length * 8;
  let upward = true;
  for (let col = size - 1; col >= 0; col -= 2) {
    if (col === 6) col = 5; // skip timing column
    for (let i = 0; i < size; i++) {
      let row = upward ? size - 1 - i : i;
      if (!res[row][col] && bi < totalBits) { mod[row][col] = ((allCW[bi >>> 3] >>> (7 - (bi & 7))) & 1) === 1; bi++; }
      if (col > 0 && !res[row][col - 1] && bi < totalBits) { mod[row][col - 1] = ((allCW[bi >>> 3] >>> (7 - (bi & 7))) & 1) === 1; bi++; }
    }
    upward = !upward;
  }

  return { size: size, mod: mod, res: res };
}

// ── Masking ───────────────────────────────────────────────────────────
function maskBit(m, r, c) {
  switch (m) {
    case 0: return (r + c) % 2 === 0;
    case 1: return r % 2 === 0;
    case 2: return c % 3 === 0;
    case 3: return (r + c) % 3 === 0;
    case 4: return (((r >>> 1) + Math.floor(c / 3)) % 2) === 0;
    case 5: return (r * c) % 2 + (r * c) % 3 === 0;
    case 6: return ((r * c) % 2 + (r * c) % 3) % 2 === 0;
    case 7: return ((r + c) % 2 + (r * c) % 3) % 2 === 0;
  }
}

function applyMask(mod, res, size, m) {
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) {
    if (!res[r][c] && maskBit(m, r, c)) mod[r][c] = !mod[r][c];
  }
}

// ── BCH encoding ──────────────────────────────────────────────────────
// Format info: BCH(15,5), generator 0x537, XOR mask 0x5412
function formatBits(eccLvl, mask) {
  let data = (eccLvl << 3) | mask;
  let bits = data << 10;
  for (let i = 14; i >= 10; i--) if (bits & (1 << i)) bits ^= 0x537 << (i - 10);
  return ((data << 10) | bits) ^ 0x5412;
}

// Version info: BCH(18,6), generator 0x1F25
function versionBits(ver) {
  let bits = ver << 12;
  for (let i = 17; i >= 12; i--) if (bits & (1 << i)) bits ^= 0x1F25 << (i - 12);
  return (ver << 12) | bits;
}

// ── Place format / version info ───────────────────────────────────────
const FMT1 = [
  [0, 8], [1, 8], [2, 8], [3, 8], [4, 8], [5, 8], [7, 8], [8, 8],
  [8, 7], [8, 5], [8, 4], [8, 3], [8, 2], [8, 1], [8, 0]
];

function placeFormat(mod, size, fb) {
  for (let i = 0; i < 15; i++) {
    let bit = ((fb >>> i) & 1) === 1;
    mod[FMT1[i][0]][FMT1[i][1]] = bit;
    // second copy: top-right (row 8) and bottom-left (col 8)
    if (i < 8) mod[8][size - 1 - i] = bit;
    else mod[size - 15 + i][8] = bit;
  }
  mod[size - 8][8] = true; // Always dark module
}

function placeVersion(mod, size, ver) {
  if (ver < 7) return;
  let vb = versionBits(ver);
  for (let i = 0; i < 18; i++) {
    let bit = ((vb >>> i) & 1) === 1;
    mod[size - 11 + (i % 3)][Math.floor(i / 3)] = bit;
    mod[Math.floor(i / 3)][size - 11 + (i % 3)] = bit;
  }
}

// ── Penalty scoring ───────────────────────────────────────────────────
function penalty(mod, size) {
  let p = 0, r, c;

  // Rule 1 — runs of 5+ same-colour modules
  for (r = 0; r < size; r++) {
    let color = mod[r][0], run = 1;
    for (c = 1; c < size; c++) { if (mod[r][c] === color) { run++; } else { if (run >= 5) p += run - 2; color = mod[r][c]; run = 1; } }
    if (run >= 5) p += run - 2;
  }
  for (c = 0; c < size; c++) {
    let color = mod[0][c], run = 1;
    for (r = 1; r < size; r++) { if (mod[r][c] === color) { run++; } else { if (run >= 5) p += run - 2; color = mod[r][c]; run = 1; } }
    if (run >= 5) p += run - 2;
  }

  // Rule 2 — 2×2 same-colour blocks
  for (r = 0; r < size - 1; r++) for (c = 0; c < size - 1; c++) {
    let v = mod[r][c];
    if (v === mod[r][c + 1] && v === mod[r + 1][c] && v === mod[r + 1][c + 1]) p += 3;
  }

  // Rule 3 — finder-like patterns (10111010000 or reverse)
  for (r = 0; r < size; r++) for (c = 0; c <= size - 11; c++) {
    if (mod[r][c] && !mod[r][c + 1] && mod[r][c + 2] && mod[r][c + 3] && mod[r][c + 4] && !mod[r][c + 5] && mod[r][c + 6] && !mod[r][c + 7] && !mod[r][c + 8] && !mod[r][c + 9] && !mod[r][c + 10]) p += 40;
    if (!mod[r][c] && !mod[r][c + 1] && !mod[r][c + 2] && !mod[r][c + 3] && mod[r][c + 4] && !mod[r][c + 5] && mod[r][c + 6] && mod[r][c + 7] && mod[r][c + 8] && !mod[r][c + 9] && mod[r][c + 10]) p += 40;
  }
  for (c = 0; c < size; c++) for (r = 0; r <= size - 11; r++) {
    if (mod[r][c] && !mod[r + 1][c] && mod[r + 2][c] && mod[r + 3][c] && mod[r + 4][c] && !mod[r + 5][c] && mod[r + 6][c] && !mod[r + 7][c] && !mod[r + 8][c] && !mod[r + 9][c] && !mod[r + 10][c]) p += 40;
    if (!mod[r][c] && !mod[r + 1][c] && !mod[r + 2][c] && !mod[r + 3][c] && mod[r + 4][c] && !mod[r + 5][c] && mod[r + 6][c] && mod[r + 7][c] && mod[r + 8][c] && !mod[r + 9][c] && mod[r + 10][c]) p += 40;
  }

  // Rule 4 — dark module proportion
  let dark = 0;
  for (r = 0; r < size; r++) for (c = 0; c < size; c++) if (mod[r][c]) dark++;
  let pct = dark * 100 / (size * size);
  let prev5 = Math.floor(pct / 5) * 5, next5 = prev5 + 5;
  p += Math.min(Math.abs(prev5 - 50), Math.abs(next5 - 50)) / 5 * 10;

  return p;
}

// ── Choose best mask ──────────────────────────────────────────────────
function bestMask(mat, version) {
  let best = 0, bestP = Infinity;
  for (let m = 0; m < 8; m++) {
    // Deep copy modules
    let copy = mat.mod.map(function (row) { return row.slice(); });
    // Apply mask
    for (let r = 0; r < mat.size; r++) for (let c = 0; c < mat.size; c++) {
      if (!mat.res[r][c] && maskBit(m, r, c)) copy[r][c] = !copy[r][c];
    }
    placeFormat(copy, mat.size, formatBits(1, m)); // L = 1
    placeVersion(copy, mat.size, version);
    let p = penalty(copy, mat.size);
    if (p < bestP) { bestP = p; best = m; }
  }
  return best;
}

// ── Generate complete QR matrix ───────────────────────────────────────
function generate(text) {
  // Convert text to byte array (ASCII / UTF-8)
  let bytes = new TextEncoder().encode(text);

  let version = findVersion(bytes.length);
  let dataCW = encodeData(bytes, version);
  let allCW = interleave(dataCW, version);
  let mat = buildMatrix(version, allCW);
  let mask = bestMask(mat, version);

  // Apply final mask
  applyMask(mat.mod, mat.res, mat.size, mask);
  placeFormat(mat.mod, mat.size, formatBits(1, mask));
  placeVersion(mat.mod, mat.size, version);

  return mat;
}

// ── Canvas renderer ───────────────────────────────────────────────────
function render(container, modules, size, targetPx) {
  const quietZone = 4; // modules
  const totalMod = size + quietZone * 2;
  const scale = Math.max(1, Math.floor(targetPx / totalMod));
  const renderSize = totalMod * scale;

  const canvas = document.createElement("canvas");
  canvas.width = renderSize;
  canvas.height = renderSize;
  container.replaceChildren(canvas);

  const ctx = canvas.getContext("2d");

  // White background
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, renderSize, renderSize);

  // Dark modules
  ctx.fillStyle = "#000000";
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (modules[r][c]) {
        ctx.fillRect((c + quietZone) * scale, (r + quietZone) * scale, scale, scale);
      }
    }
  }
}

// ── Public API ────────────────────────────────────────────────────────
// Draws the QR code for text, at ECC level L, in container.
export function renderQrCode(container, text, size) {
  const mat = generate(text);
  render(container, mat.mod, mat.size, size);
}
