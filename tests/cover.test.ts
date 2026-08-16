import assert from 'node:assert/strict';
import test from 'node:test';

import { renderTextCover } from '../src/cover.js';
import { encodeGreyscalePng } from '../src/png.js';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

test('encodeGreyscalePng writes a well-formed header and trailer', () => {
  const png = encodeGreyscalePng(2, 3, new Uint8Array(6).fill(0x40));
  assert.ok(png.subarray(0, 8).equals(PNG_SIGNATURE));
  assert.equal(png.toString('ascii', 12, 16), 'IHDR');
  assert.equal(png.readUInt32BE(16), 2);
  assert.equal(png.readUInt32BE(20), 3);
  assert.equal(png[24], 8, 'bit depth');
  assert.equal(png[25], 0, 'greyscale colour type');
  assert.equal(png.toString('ascii', png.length - 8, png.length - 4), 'IEND');
});

test('encodeGreyscalePng rejects a mismatched pixel buffer', () => {
  assert.throws(() => encodeGreyscalePng(4, 4, new Uint8Array(5)), /must be 16 bytes/);
});

test('renderTextCover draws the requested text onto a PNG', () => {
  const png = renderTextCover({ eyebrow: 'Field Theory', headline: '2026-08-16', lines: ['Daily', 'Review'] });
  assert.ok(png.subarray(0, 8).equals(PNG_SIGNATURE));
  assert.equal(png.readUInt32BE(16), 1000);
  assert.equal(png.readUInt32BE(20), 1600);
  // Flat white would compress far smaller; ink on the page is what adds bytes.
  assert.ok(png.length > 1000, `cover looks blank (${png.length} bytes)`);
});

test('renderTextCover is deterministic and shrinks type to fit', () => {
  const options = { headline: '2026-08-16', lines: ['Daily'] };
  assert.ok(renderTextCover(options).equals(renderTextCover(options)));
  // A headline far too wide for the page must still render rather than overflow.
  assert.ok(renderTextCover({ headline: 'A'.repeat(400) }).length > 0);
});
