// Independent Java-edition NBT reader for checking real SlopeCraft exports.
// No engine or browser code is imported here.
import { gunzipSync, inflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const utf8 = new TextDecoder('utf-8', { fatal: true });
const minimumBytes = [0, 1, 2, 4, 8, 4, 8, 4, 2, 5, 1, 4, 4];

export function readNbt(input, options = {}) {
  const maxBytes = options.maxBytes ?? 256 * 1024 * 1024;
  const maxDepth = options.maxDepth ?? 128;
  const maxElements = options.maxElements ?? 32 * 1024 * 1024;
  let bytes = Buffer.from(input);
  if (bytes.length > maxBytes) throw new Error('NBT input exceeds byte limit');
  const compression = options.compression ?? 'auto';
  if (compression === 'gzip' || (compression === 'auto' && bytes[0] === 0x1f && bytes[1] === 0x8b)) {
    bytes = gunzipSync(bytes, { maxOutputLength: maxBytes });
  } else if (compression === 'zlib' || (compression === 'auto' && bytes[0] === 0x78 && ((bytes[0] * 256 + bytes[1]) % 31 === 0))) {
    bytes = inflateSync(bytes, { maxOutputLength: maxBytes });
  } else if (!['auto', 'none'].includes(compression)) {
    throw new Error(`Unknown NBT compression: ${compression}`);
  }
  if (bytes.length > maxBytes) throw new Error('NBT expanded data exceeds byte limit');
  let offset = 0;
  let elements = 0;
  const types = new Map();
  function ensure(count) {
    if (!Number.isSafeInteger(count) || count < 0 || count > bytes.length - offset) {
      throw new Error(`Truncated NBT at byte ${offset}, need ${count} bytes`);
    }
  }
  function scalar(size, method) {
    ensure(size);
    const result = bytes[method](offset);
    offset += size;
    return result;
  }
  const byte = () => scalar(1, 'readUInt8');
  const int = () => scalar(4, 'readInt32BE');
  function string() {
    const count = scalar(2, 'readUInt16BE');
    ensure(count);
    const result = utf8.decode(bytes.subarray(offset, offset + count));
    offset += count;
    return result;
  }
  function count(elementBytes = 1) {
    const result = int();
    if (result < 0 || result > maxElements - elements) throw new Error('Invalid or excessive NBT array length');
    elements += result;
    ensure(result * elementBytes);
    return result;
  }
  function payload(type, path, depth) {
    if (depth > maxDepth) throw new Error('NBT nesting exceeds depth limit');
    if (type < 1 || type > 12) throw new Error(`Unsupported NBT tag ${type}`);
    if (++elements > maxElements) throw new Error('NBT exceeds element limit');
    types.set(path, type);
    switch (type) {
      case 1: return scalar(1, 'readInt8');
      case 2: return scalar(2, 'readInt16BE');
      case 3: return int();
      case 4: return scalar(8, 'readBigInt64BE');
      case 5: return scalar(4, 'readFloatBE');
      case 6: return scalar(8, 'readDoubleBE');
      case 7: {
        const size = count();
        const result = Buffer.from(bytes.subarray(offset, offset + size));
        offset += size;
        return result;
      }
      case 8: return string();
      case 9: {
        const elementType = byte();
        if (elementType > 12) throw new Error(`Invalid NBT list tag ${elementType}`);
        const size = count(minimumBytes[elementType]);
        if (elementType === 0 && size !== 0) throw new Error('TAG_End list must be empty');
        return Array.from({ length: size }, (_, index) => payload(elementType, `${path}/${index}`, depth + 1));
      }
      case 10: {
        const result = Object.create(null);
        for (;;) {
          const childType = byte();
          if (childType === 0) return result;
          const name = string();
          if (Object.hasOwn(result, name)) throw new Error(`Duplicate NBT compound key ${name}`);
          const segment = name.replaceAll('~', '~0').replaceAll('/', '~1');
          result[name] = payload(childType, `${path}/${segment}`, depth + 1);
        }
      }
      case 11: return Array.from({ length: count(4) }, int);
      case 12: return Array.from({ length: count(8) }, () => scalar(8, 'readBigInt64BE'));
    }
  }
  const type = byte();
  if (type !== 10) throw new Error('NBT root must be a named compound');
  const name = string();
  const value = payload(type, '', 0);
  if (offset !== bytes.length && !options.allowTrailingBytes) throw new Error(`Trailing NBT bytes: ${bytes.length - offset}`);
  return { name, type, value, types, bytesRead: offset, bytesLength: bytes.length };
}

function rootValue(input) {
  return input?.type === 10 && input?.types instanceof Map ? input.value : readNbt(input).value;
}

function dimensions(size) {
  assert.equal(size.length, 3, 'structure must have three dimensions');
  for (const dim of size) assert.ok(Number.isSafeInteger(dim) && dim > 0, `invalid dimension ${dim}`);
  const volume = size[0] * size[1] * size[2];
  assert.ok(Number.isSafeInteger(volume) && volume <= 32 * 1024 * 1024, 'structure volume exceeds validator limit');
  return volume;
}

export function canonicalBlockState(state) {
  assert.equal(typeof state?.Name, 'string', 'block state has no Name');
  assert.match(state.Name, /^[a-z0-9_.-]+:[a-z0-9_./-]+$/, 'block id must be namespaced');
  const properties = Object.entries(state.Properties ?? {}).sort(([a], [b]) => a.localeCompare(b));
  for (const [key, value] of properties) {
    assert.equal(typeof value, 'string', `block property ${key} is not a string`);
  }
  return state.Name + (properties.length ? `[${properties.map(([key, value]) => `${key}=${value}`).join(',')}]` : '');
}

export function decodePackedStates(words, count, paletteSize) {
  assert.ok(paletteSize > 0, 'empty block palette');
  const bits = Math.max(2, Math.ceil(Math.log2(paletteSize)));
  assert.equal(words.length, Math.ceil(count * bits / 64), 'packed state word count does not match volume');
  const mask = (1n << BigInt(bits)) - 1n;
  const result = new Uint32Array(count);
  for (let index = 0; index < count; index++) {
    const bit = index * bits;
    const wordIndex = Math.floor(bit / 64);
    const shift = bit % 64;
    let value = BigInt.asUintN(64, words[wordIndex]) >> BigInt(shift);
    if (shift + bits > 64) value |= BigInt.asUintN(64, words[wordIndex + 1]) << BigInt(64 - shift);
    result[index] = Number(value & mask);
    assert.ok(result[index] < paletteSize, `palette index ${result[index]} is out of bounds`);
  }
  return result;
}

export function decodeVarints(bytes, expectedCount) {
  const result = [];
  let value = 0;
  let shift = 0;
  for (const byte of bytes) {
    if (shift >= 35) throw new Error('Schematic VarInt is too long');
    value += (byte & 0x7f) * 2 ** shift;
    if ((byte & 0x80) === 0) {
      if (!Number.isSafeInteger(value) || value > 0xffffffff) throw new Error('Schematic VarInt overflow');
      result.push(value);
      value = 0;
      shift = 0;
    } else shift += 7;
  }
  if (shift !== 0) throw new Error('Truncated schematic VarInt');
  assert.equal(result.length, expectedCount, 'schematic block count does not match volume');
  return Uint32Array.from(result);
}

function summarize(size, palette, states, entities = []) {
  dimensions(size);
  const hash = createHash('sha256');
  const counts = Object.create(null);
  let blockCount = 0;
  for (let index = 0; index < states.length; index++) {
    const state = palette[states[index]];
    assert.equal(typeof state, 'string', `palette state ${states[index]} is missing`);
    if (['minecraft:air', 'minecraft:cave_air', 'minecraft:void_air'].includes(state)) continue;
    blockCount++;
    counts[state] = (counts[state] ?? 0) + 1;
    hash.update(`${index}:${state}\n`);
  }
  return { size, palette, states, entities, blockCount, counts, blockHash: hash.digest('hex') };
}

export function validateMapData(input, expected = {}) {
  const root = rootValue(input);
  const data = root.data;
  assert.ok(data && typeof data === 'object', 'map has no data compound');
  assert.ok(Buffer.isBuffer(data.colors), 'map colors must be a byte array');
  assert.equal(data.colors.length, 128 * 128, 'map must contain exactly 16384 pixels');
  assert.equal(data.scale, 0);
  assert.equal(data.trackingPosition, 0);
  assert.equal(data.unlimitedTracking, 0);
  if (expected.version >= 14) {
    assert.equal(data.locked, 1, 'modern map must be locked');
    assert.ok(root.DataVersion > 0, 'modern map has no DataVersion');
  }
  if (expected.version >= 16) assert.equal(data.dimension, 'minecraft:overworld');
  if (expected.colors) assert.deepEqual(data.colors, Buffer.from(expected.colors));
  return { root, colors: data.colors };
}

export function validateVanillaStructure(input) {
  const root = rootValue(input);
  const volume = dimensions(root.size);
  assert.ok(Array.isArray(root.palette) && root.palette.length > 0, 'structure palette is missing');
  const palette = root.palette.map(canonicalBlockState);
  // An absent coordinate is structure_void. This placeholder is omitted from
  // semantic comparison just like the air entries present in other formats.
  const airIndex = palette.length;
  palette.push('minecraft:air');
  const states = new Uint32Array(volume).fill(airIndex);
  const positions = new Set();
  assert.ok(Array.isArray(root.blocks), 'structure blocks list is missing');
  for (const block of root.blocks) {
    assert.equal(block.pos?.length, 3, 'block position must have three coordinates');
    for (let axis = 0; axis < 3; axis++) assert.ok(Number.isInteger(block.pos[axis]) && block.pos[axis] >= 0 && block.pos[axis] < root.size[axis], 'block position is out of bounds');
    assert.ok(Number.isInteger(block.state) && block.state >= 0 && block.state < airIndex, 'block state is out of bounds');
    const [x, y, z] = block.pos;
    const index = x + root.size[0] * (z + root.size[2] * y);
    assert.ok(!positions.has(index), 'duplicate block coordinate');
    positions.add(index);
    states[index] = block.state;
  }
  assert.ok(Array.isArray(root.entities), 'structure entities list is missing');
  const result = summarize(root.size, palette, states, root.entities);
  return { ...result, root };
}

export function validateLitematic(input) {
  const root = rootValue(input);
  assert.ok(root.Version === 4 || root.Version === 5, 'unsupported litematic version');
  assert.ok(root.MinecraftDataVersion > 0, 'litematic data version is missing');
  assert.ok(root.Regions && typeof root.Regions === 'object', 'litematic regions are missing');
  const regions = Object.entries(root.Regions).map(([name, region]) => {
    const size = ['x', 'y', 'z'].map(axis => Math.abs(region.Size?.[axis]));
    const volume = dimensions(size);
    assert.ok(Array.isArray(region.BlockStatePalette) && region.BlockStatePalette.length > 0, 'litematic palette is missing');
    const palette = region.BlockStatePalette.map(canonicalBlockState);
    const states = decodePackedStates(region.BlockStates, volume, palette.length);
    assert.ok(Array.isArray(region.Entities), 'litematic entities list is missing');
    return { name, position: region.Position, ...summarize(size, palette, states, region.Entities) };
  });
  assert.equal(root.Metadata?.RegionCount, regions.length, 'litematic metadata region count differs');
  assert.equal(root.Metadata?.TotalVolume, regions.reduce((sum, region) => sum + region.states.length, 0), 'litematic metadata volume differs');
  assert.equal(root.Metadata?.TotalBlocks, regions.reduce((sum, region) => sum + region.blockCount, 0), 'litematic metadata block count differs');
  return { root, regions };
}

export function validateSpongeSchematic(input) {
  const outer = rootValue(input);
  const root = outer.Schematic ?? outer;
  assert.ok(root.Version === 2 || root.Version === 3, 'unsupported Sponge schematic version');
  assert.ok(root.DataVersion > 0, 'schematic DataVersion is missing');
  const size = [root.Width, root.Height, root.Length].map(value => value < 0 ? value + 65536 : value);
  const volume = dimensions(size);
  const container = root.Version === 3 ? root.Blocks : root;
  assert.ok(container?.Palette && typeof container.Palette === 'object', 'schematic palette is missing');
  const palette = [];
  for (const [state, index] of Object.entries(container.Palette)) {
    assert.ok(Number.isInteger(index) && index >= 0 && index < 65536, 'invalid schematic palette index');
    assert.equal(palette[index], undefined, 'duplicate schematic palette index');
    assert.match(state, /^[a-z0-9_.-]+:[a-z0-9_./-]+(?:\[.*\])?$/, 'invalid schematic block state');
    // Normalize property order to compare against the compound palettes.
    const match = /^(.*?)(?:\[(.*)\])?$/.exec(state);
    palette[index] = match[1] + (match[2] ? `[${match[2].split(',').sort().join(',')}]` : '');
  }
  for (let index = 0; index < palette.length; index++) assert.equal(typeof palette[index], 'string', 'sparse schematic palette');
  if (root.Version === 2) assert.equal(root.PaletteMax, palette.length, 'PaletteMax differs from palette size');
  const data = root.Version === 3 ? container.Data : container.BlockData;
  assert.ok(Buffer.isBuffer(data), 'schematic block data must be a byte array');
  const states = decodeVarints(data, volume);
  for (const state of states) assert.ok(state < palette.length, 'schematic palette index is out of bounds');
  assert.equal(root.Offset?.length, 3, 'schematic Offset must have three coordinates');
  return { root, ...summarize(size, palette, states) };
}

export function assertSameBlocks(left, right) {
  assert.deepEqual(left.size, right.size, 'export dimensions differ');
  assert.equal(left.blockCount, right.blockCount, 'export occupied block count differs');
  assert.equal(left.blockHash, right.blockHash, 'export block identities or coordinates differ');
}
