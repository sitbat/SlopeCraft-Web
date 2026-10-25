import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validatePng } from './png.mjs';

test('PNG validator accepts an actual upstream 16 × 16 block texture', async () => {
  const bytes = await readFile(new URL('../../Blocks_SCL/FixedBlocks/glass.png', import.meta.url));
  const png = validatePng(bytes);
  assert.equal(png.width, 16);
  assert.equal(png.height, 16);
});

test('PNG validator detects corrupted compressed image bytes and truncated chunks', async () => {
  const bytes = await readFile(new URL('../../Blocks_SCL/FixedBlocks/glass.png', import.meta.url));
  const corrupted = Buffer.from(bytes);
  const dataOffset = corrupted.indexOf(Buffer.from('IDAT')) + 4;
  assert.ok(dataOffset >= 12, 'texture must contain IDAT');
  corrupted[dataOffset] ^= 1;
  assert.throws(() => validatePng(corrupted), /CRC/);
  assert.throws(() => validatePng(bytes.subarray(0, bytes.length - 3)), /truncated|past end/);
});
