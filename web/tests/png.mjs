import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';

export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function validatePng(input) {
  const bytes = Buffer.from(input);
  assert.deepEqual(bytes.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), 'invalid PNG signature');
  let offset = 8;
  let width, height, depth, channels, interlace, colorType;
  let ended = false;
  const compressed = [];
  while (offset < bytes.length) {
    assert.ok(offset + 12 <= bytes.length, 'truncated PNG chunk');
    const length = bytes.readUInt32BE(offset);
    assert.ok(length <= bytes.length - offset - 12, 'PNG chunk extends past end');
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    assert.equal(crc32(bytes.subarray(offset + 4, offset + 8 + length)), bytes.readUInt32BE(offset + 8 + length), `${type} CRC mismatch`);
    if (offset === 8) assert.equal(type, 'IHDR', 'PNG must start with IHDR');
    if (type === 'IHDR') {
      assert.equal(length, 13);
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      depth = data[8];
      colorType = data[9];
      channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 })[colorType];
      interlace = data[12];
      assert.ok(width > 0 && height > 0 && channels > 0, 'PNG shape or color type is invalid');
      assert.ok([1, 2, 4, 8, 16].includes(depth), 'unsupported PNG bit depth');
      assert.equal(data[10], 0, 'unsupported PNG compression');
      assert.equal(data[11], 0, 'unsupported PNG filter method');
    }
    if (type === 'IDAT') compressed.push(data);
    if (type === 'IEND') {
      assert.equal(length, 0);
      ended = true;
      offset += length + 12;
      break;
    }
    offset += length + 12;
  }
  assert.ok(ended && compressed.length > 0, 'PNG has no complete image');
  assert.equal(offset, bytes.length, 'trailing PNG data');
  const rowBytes = Math.ceil(width * channels * depth / 8);
  const raw = inflateSync(Buffer.concat(compressed), { maxOutputLength: Math.max((rowBytes + 1) * height * 2, 1024) });
  if (interlace === 0) {
    assert.equal(raw.length, (rowBytes + 1) * height, 'PNG decoded size differs from dimensions');
    for (let row = 0; row < height; row++) assert.ok(raw[row * (rowBytes + 1)] <= 4, 'invalid PNG scanline filter');
  }
  return { width, height, depth, channels, interlace, colorType };
}

// Minimal independent pixel decoder for upstream 8-bit textures, including
// indexed color and tRNS transparency.
// Keeping this separate from libpng catches channel-order and row-order errors
// in the native blockIcon API. Other PNG types are intentionally rejected.
export function decodePngRgba(input) {
  const info = validatePng(input);
  assert.equal(info.depth, 8, 'pixel comparison supports 8-bit textures');
  assert.equal(info.interlace, 0, 'pixel comparison supports noninterlaced textures');
  const bytes = Buffer.from(input);
  const compressed = [];
  let palette, transparency;
  for (let offset = 8; offset < bytes.length;) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === 'IDAT') compressed.push(data);
    if (type === 'PLTE') palette = data;
    if (type === 'tRNS') transparency = data;
    offset += length + 12;
  }
  const stride = info.width * info.channels;
  const raw = inflateSync(Buffer.concat(compressed), { maxOutputLength: (stride + 1) * info.height });
  const pixels = new Uint8Array(stride * info.height);
  const paeth = (a, b, c) => {
    const p = a + b - c, da = Math.abs(p - a), db = Math.abs(p - b), dc = Math.abs(p - c);
    return da <= db && da <= dc ? a : db <= dc ? b : c;
  };
  for (let y = 0; y < info.height; y++) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const index = y * stride + x;
      const left = x >= info.channels ? pixels[index - info.channels] : 0;
      const up = y > 0 ? pixels[index - stride] : 0;
      const upperLeft = y > 0 && x >= info.channels ? pixels[index - stride - info.channels] : 0;
      const predictor = [0, left, up, Math.floor((left + up) / 2), paeth(left, up, upperLeft)][filter];
      pixels[index] = (raw[y * (stride + 1) + x + 1] + predictor) & 255;
    }
  }
  const rgba = new Uint8Array(info.width * info.height * 4);
  for (let index = 0; index < info.width * info.height; index++) {
    const source = index * info.channels;
    const dest = index * 4;
    if (info.colorType === 3) {
      const paletteIndex = pixels[source];
      assert.ok(palette && paletteIndex * 3 + 3 <= palette.length, 'indexed PNG references an invalid palette entry');
      rgba.set(palette.subarray(paletteIndex * 3, paletteIndex * 3 + 3), dest);
      rgba[dest + 3] = transparency?.[paletteIndex] ?? 255;
    } else if (info.colorType === 0 || info.colorType === 4) {
      rgba[dest] = rgba[dest + 1] = rgba[dest + 2] = pixels[source];
      rgba[dest + 3] = info.colorType === 4 ? pixels[source + 1]
        : transparency?.length === 2 && transparency.readUInt16BE() === pixels[source] ? 0 : 255;
    } else {
      rgba.set(pixels.subarray(source, source + 3), dest);
      const transparent = transparency?.length === 6 && [0, 1, 2].every(channel => transparency.readUInt16BE(channel * 2) === pixels[source + channel]);
      rgba[dest + 3] = info.colorType === 6 ? pixels[source + 3] : transparent ? 0 : 255;
    }
  }
  return { width: info.width, height: info.height, rgba };
}
