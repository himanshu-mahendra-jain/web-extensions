import path from "node:path";

import { test, expect } from "@playwright/test";

import { ORIGIN, routeExtensionFiles } from "../../test-support/harness.js";


const EXTENSION_PATH = path.resolve(__dirname, "..");

// ISO/IEC 18004 format information for ECC level L, masks 0-7.
const FORMAT_L = [0x77C4, 0x72F3, 0x7DAA, 0x789D, 0x662F, 0x6318, 0x6C41, 0x6976];

// ISO/IEC 18004 version information for versions 7-40.
const VERSION_INFO = [
  0x07C94, 0x085BC, 0x09A99, 0x0A4D3, 0x0BBF6, 0x0C762,
  0x0D847, 0x0E60D, 0x0F928, 0x10B78, 0x1145D, 0x12A17,
  0x13532, 0x149A6, 0x15683, 0x168C9, 0x177EC, 0x18EC4,
  0x191E1, 0x1AFAB, 0x1B08E, 0x1CC1A, 0x1D33F, 0x1ED75,
  0x1F250, 0x209D5, 0x216F0, 0x228BA, 0x2379F, 0x24B0B,
  0x2542E, 0x26A64, 0x27541, 0x28C69
];

// A pairing text as long as a real one gets: FCM endpoint, keys, name, ID.
const PAIRING_TEXT = [
  "sms_pair:v1",
  `https://fcm.googleapis.com/fcm/send/${"t".repeat(200)}`,
  "B".repeat(87),
  "a".repeat(22),
  "Chrome (Windows)",
  "abcdefghijklmnopabcdefghijklmnop"
].join("|");


test.beforeEach(async ({ page }) => {
  await routeExtensionFiles(page, EXTENSION_PATH);
  await page.goto(`${ORIGIN}/`);
  await page.evaluate(async () => {
    window.renderQrCode = (await import("/src/qrcode.js")).renderQrCode;
  });
});


/*
 * Renders text with a 1px target size, which makes the scale 1: the
 * canvas has one pixel per module plus a 4-module quiet zone.
 */
function renderModules(page, text) {
  return page.evaluate((value) => {
    const container = document.createElement("div");
    document.body.append(container);

    renderQrCode(container, value, 1);

    const canvas = container.querySelector("canvas");
    const pixels = canvas.getContext("2d")
      .getImageData(0, 0, canvas.width, canvas.height).data;
    const isDark = (x, y) => pixels[(y * canvas.width + x) * 4] === 0;

    const quietZone = 4;
    const size = canvas.width - quietZone * 2;
    const modules = [];

    for (let row = 0; row < size; row++) {
      modules.push([]);
      for (let col = 0; col < size; col++) {
        modules[row].push(isDark(col + quietZone, row + quietZone));
      }
    }

    let quietZoneIsLight = true;
    for (let y = 0; y < canvas.height; y++) {
      for (let x = 0; x < canvas.width; x++) {
        const inCode = x >= quietZone && x < quietZone + size &&
          y >= quietZone && y < quietZone + size;
        if (!inCode && isDark(x, y)) quietZoneIsLight = false;
      }
    }

    container.remove();

    return { size, modules, quietZoneIsLight };
  }, text);
}


function versionOf(size) {
  return (size - 17) / 4;
}


function readBits(modules, positions) {
  return positions.reduce((bits, [row, col], bit) => {
    return modules[row][col] ? bits | (1 << bit) : bits;
  }, 0);
}


// Both copies of the 15-bit format information, bit 0 first.
function formatInfo({ size, modules }) {
  const first = [
    [0, 8], [1, 8], [2, 8], [3, 8], [4, 8], [5, 8], [7, 8], [8, 8],
    [8, 7], [8, 5], [8, 4], [8, 3], [8, 2], [8, 1], [8, 0]
  ];
  const second = [
    ...[0, 1, 2, 3, 4, 5, 6, 7].map((bit) => [8, size - 1 - bit]),
    ...[8, 9, 10, 11, 12, 13, 14].map((bit) => [size - 15 + bit, 8])
  ];

  return [readBits(modules, first), readBits(modules, second)];
}


// Both copies of the 18-bit version information, bit 0 first.
function versionInfo({ size, modules }) {
  const bits = [...Array(18).keys()];

  return [
    readBits(modules, bits.map((bit) => [Math.floor(bit / 3), size - 11 + bit % 3])),
    readBits(modules, bits.map((bit) => [size - 11 + bit % 3, Math.floor(bit / 3)]))
  ];
}


test("picks the smallest version that holds the text at ECC level L", async ({ page }) => {
  // [bytes, version]: the byte-mode capacities of ECC level L.
  for (const [bytes, version] of [
    [17, 1], [18, 2],
    [32, 2], [33, 3],
    [134, 6], [135, 7],
    [271, 10], [272, 11],
    [2953, 40]
  ]) {
    const { size } = await renderModules(page, "x".repeat(bytes));

    expect(versionOf(size), `${bytes} bytes`).toBe(version);
  }
});


test("sizes the code by UTF-8 bytes, not characters", async ({ page }) => {
  // Nine two-byte characters are 18 bytes: one more than version 1 holds.
  expect(versionOf((await renderModules(page, "é".repeat(9))).size)).toBe(2);
});


test("refuses text longer than version 40 holds", async ({ page }) => {
  await expect(renderModules(page, "x".repeat(2954)))
    .rejects.toThrow("Data too long for QR code");
});


test("draws the finder, timing and dark-module patterns", async ({ page }) => {
  for (const text of ["sms_pair:v1|x", "x".repeat(300)]) {
    const { size, modules } = await renderModules(page, text);

    for (const [top, left] of [[0, 0], [0, size - 7], [size - 7, 0]]) {
      for (let row = -1; row <= 7; row++) {
        for (let col = -1; col <= 7; col++) {
          const r = top + row;
          const c = left + col;

          if (r < 0 || c < 0 || r >= size || c >= size) continue;

          const ring = Math.max(Math.abs(row - 3), Math.abs(col - 3));
          // Rings 0-1 and 3 are dark, ring 2 and the separator (4) light.
          expect(modules[r][c], `finder at ${top},${left}: ${r},${c}`)
            .toBe(ring !== 2 && ring !== 4);
        }
      }
    }

    for (let i = 8; i < size - 8; i++) {
      expect(modules[6][i], `timing row at ${i}`).toBe(i % 2 === 0);
      expect(modules[i][6], `timing column at ${i}`).toBe(i % 2 === 0);
    }

    expect(modules[size - 8][8], "dark module").toBe(true);
  }
});


test("encodes ECC level L format information in both copies", async ({ page }) => {
  for (const text of ["a", "sms_pair:v1|x", PAIRING_TEXT]) {
    const [first, second] = formatInfo(await renderModules(page, text));

    expect(first).toBe(second);
    expect(FORMAT_L).toContain(first);
  }
});


test("encodes version information from version 7 on", async ({ page }) => {
  for (const bytes of [135, 272, 2953]) {
    const code = await renderModules(page, "x".repeat(bytes));
    const [first, second] = versionInfo(code);

    expect(first).toBe(second);
    expect(first).toBe(VERSION_INFO[versionOf(code.size) - 7]);
  }
});


test("draws the same code for the same text inside a light quiet zone", async ({ page }) => {
  const first = await renderModules(page, PAIRING_TEXT);
  const again = await renderModules(page, PAIRING_TEXT);
  const other = await renderModules(page, `${PAIRING_TEXT}x`);

  expect(first.quietZoneIsLight).toBe(true);
  expect(again.modules).toEqual(first.modules);
  expect(other.modules).not.toEqual(first.modules);
});


test("a full-length pairing code keeps modules at least 2px wide in the 260px popup", async ({ page }) => {
  const { size } = await renderModules(page, PAIRING_TEXT);

  const canvasWidth = await page.evaluate((text) => {
    const container = document.createElement("div");
    document.body.append(container);
    renderQrCode(container, text, 260);
    return container.querySelector("canvas").width;
  }, PAIRING_TEXT);

  expect(canvasWidth / (size + 8)).toBeGreaterThanOrEqual(2);
});
