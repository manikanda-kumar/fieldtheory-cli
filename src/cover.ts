/**
 * Flat typographic cover image.
 *
 * A Kindle library tile with no cover falls back to a generic placeholder, so
 * every daily issue would look identical in the grid. This draws the one thing
 * that tells issues apart — the date — plus a title, with a 5x7 bitmap font so
 * the repo still needs no font or image library. Deliberately plain: black on
 * white, one rule, no ornament.
 */

import { encodeGreyscalePng } from './png.js';

const GLYPH_WIDTH = 5;
const GLYPH_HEIGHT = 7;
/** Glyph columns live in bits 7..3 of each row byte; bit 7 is leftmost. */
const FONT: Record<string, number[]> = {
  '0': [0x70, 0x88, 0x98, 0xa8, 0xc8, 0x88, 0x70],
  '1': [0x20, 0x60, 0x20, 0x20, 0x20, 0x20, 0x70],
  '2': [0x70, 0x88, 0x08, 0x10, 0x20, 0x40, 0xf8],
  '3': [0xf8, 0x10, 0x20, 0x10, 0x08, 0x88, 0x70],
  '4': [0x10, 0x30, 0x50, 0x90, 0xf8, 0x10, 0x10],
  '5': [0xf8, 0x80, 0xf0, 0x08, 0x08, 0x88, 0x70],
  '6': [0x30, 0x40, 0x80, 0xf0, 0x88, 0x88, 0x70],
  '7': [0xf8, 0x08, 0x10, 0x20, 0x40, 0x40, 0x40],
  '8': [0x70, 0x88, 0x88, 0x70, 0x88, 0x88, 0x70],
  '9': [0x70, 0x88, 0x88, 0x78, 0x08, 0x10, 0x60],
  A: [0x70, 0x88, 0x88, 0xf8, 0x88, 0x88, 0x88],
  B: [0xf0, 0x88, 0x88, 0xf0, 0x88, 0x88, 0xf0],
  C: [0x70, 0x88, 0x80, 0x80, 0x80, 0x88, 0x70],
  D: [0xf0, 0x88, 0x88, 0x88, 0x88, 0x88, 0xf0],
  E: [0xf8, 0x80, 0x80, 0xf0, 0x80, 0x80, 0xf8],
  F: [0xf8, 0x80, 0x80, 0xf0, 0x80, 0x80, 0x80],
  G: [0x70, 0x88, 0x80, 0x98, 0x88, 0x88, 0x70],
  H: [0x88, 0x88, 0x88, 0xf8, 0x88, 0x88, 0x88],
  I: [0x70, 0x20, 0x20, 0x20, 0x20, 0x20, 0x70],
  J: [0x38, 0x10, 0x10, 0x10, 0x10, 0x90, 0x60],
  K: [0x88, 0x90, 0xa0, 0xc0, 0xa0, 0x90, 0x88],
  L: [0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0xf8],
  M: [0x88, 0xd8, 0xa8, 0x88, 0x88, 0x88, 0x88],
  N: [0x88, 0xc8, 0xa8, 0x98, 0x88, 0x88, 0x88],
  O: [0x70, 0x88, 0x88, 0x88, 0x88, 0x88, 0x70],
  P: [0xf0, 0x88, 0x88, 0xf0, 0x80, 0x80, 0x80],
  Q: [0x70, 0x88, 0x88, 0x88, 0xa8, 0x90, 0x68],
  R: [0xf0, 0x88, 0x88, 0xf0, 0xa0, 0x90, 0x88],
  S: [0x78, 0x80, 0x80, 0x70, 0x08, 0x08, 0xf0],
  T: [0xf8, 0x20, 0x20, 0x20, 0x20, 0x20, 0x20],
  U: [0x88, 0x88, 0x88, 0x88, 0x88, 0x88, 0x70],
  V: [0x88, 0x88, 0x88, 0x88, 0x88, 0x50, 0x20],
  W: [0x88, 0x88, 0x88, 0xa8, 0xa8, 0xd8, 0x88],
  X: [0x88, 0x88, 0x50, 0x20, 0x50, 0x88, 0x88],
  Y: [0x88, 0x88, 0x50, 0x20, 0x20, 0x20, 0x20],
  Z: [0xf8, 0x08, 0x10, 0x20, 0x40, 0x80, 0xf8],
  ' ': [0, 0, 0, 0, 0, 0, 0],
  '-': [0, 0, 0, 0xf8, 0, 0, 0],
  '.': [0, 0, 0, 0, 0, 0, 0x20],
  ':': [0, 0x20, 0, 0, 0, 0x20, 0],
  '/': [0x08, 0x08, 0x10, 0x20, 0x40, 0x80, 0x80],
};

export interface TextCoverOptions {
  /** Largest line; the one that has to read at thumbnail size. */
  headline: string;
  /** Lines under the headline, drawn smaller. */
  lines?: string[];
  /** Small line at the top. */
  eyebrow?: string;
  width?: number;
  height?: number;
}

/** Renders a cover and returns PNG bytes. */
export function renderTextCover(options: TextCoverOptions): Buffer {
  const width = options.width ?? 1000;
  const height = options.height ?? 1600;
  const margin = Math.round(width * 0.1);
  const contentWidth = width - margin * 2;

  const pixels = new Uint8Array(width * height).fill(0xff);
  const headlineScale = fitScale(options.headline, contentWidth, 16);
  const ruleHeight = Math.max(2, Math.round(height / 400));

  // Laid out as a single block so it can be centred vertically; a top-anchored
  // stack leaves the bottom half of the tile empty.
  type Row = { draw: (y: number) => void; height: number; gap: number };
  const rows: Row[] = [];
  if (options.eyebrow) {
    const scale = fitScale(options.eyebrow, contentWidth, 5);
    rows.push({
      draw: (y) => drawText(pixels, width, height, options.eyebrow!, margin, y, scale),
      height: GLYPH_HEIGHT * scale,
      gap: Math.round(height * 0.03),
    });
  }
  rows.push({
    draw: (y) => fillRect(pixels, width, height, margin, y, contentWidth, ruleHeight),
    height: ruleHeight,
    gap: Math.round(height * 0.06),
  });
  rows.push({
    draw: (y) => drawText(pixels, width, height, options.headline, margin, y, headlineScale),
    height: GLYPH_HEIGHT * headlineScale,
    gap: Math.round(height * 0.05),
  });
  for (const line of options.lines ?? []) {
    const scale = Math.min(fitScale(line, contentWidth, 12), headlineScale);
    rows.push({
      draw: (y) => drawText(pixels, width, height, line, margin, y, scale),
      height: GLYPH_HEIGHT * scale,
      gap: Math.round(height * 0.02),
    });
  }

  const blockHeight = rows.reduce((total, row, index) => total + row.height + (index < rows.length - 1 ? row.gap : 0), 0);
  let y = Math.max(margin, Math.round((height - blockHeight) / 2));
  for (const row of rows) {
    row.draw(y);
    y += row.height + row.gap;
  }

  return encodeGreyscalePng(width, height, pixels);
}

/** Largest integer scale at which `text` still fits `available` pixels. */
function fitScale(text: string, available: number, preferred: number): number {
  const cells = Math.max(1, text.length);
  // Each cell advances GLYPH_WIDTH + 1 columns; the trailing space is unused.
  const perScale = cells * (GLYPH_WIDTH + 1) - 1;
  return Math.max(1, Math.min(preferred, Math.floor(available / perScale)));
}

function drawText(
  pixels: Uint8Array,
  width: number,
  height: number,
  text: string,
  x: number,
  y: number,
  scale: number,
): void {
  let cursor = x;
  for (const char of text.toUpperCase()) {
    const glyph = FONT[char] ?? FONT[' ']!;
    for (let row = 0; row < GLYPH_HEIGHT; row += 1) {
      for (let column = 0; column < GLYPH_WIDTH; column += 1) {
        if (!(glyph[row]! & (0x80 >> column))) continue;
        fillRect(pixels, width, height, cursor + column * scale, y + row * scale, scale, scale);
      }
    }
    cursor += (GLYPH_WIDTH + 1) * scale;
  }
}

function fillRect(
  pixels: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  for (let row = Math.max(0, y); row < Math.min(height, y + h); row += 1) {
    pixels.fill(0x00, row * width + Math.max(0, x), row * width + Math.min(width, x + w));
  }
}
