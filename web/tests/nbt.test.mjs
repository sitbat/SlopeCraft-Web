import test from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync, deflateSync } from 'node:zlib';
import {
  readNbt, decodePackedStates, decodeVarints, validateMapData,
  validateVanillaStructure, validateLitematic, validateSpongeSchematic,
  assertSameBlocks,
} from './nbt.mjs';

// Deliberately separate fixture writer: the validator never uses this writer,
// and engine export checks do not substitute these fixtures for real files.
const tag = (type, value) => ({ type, value });
const int = value => tag(3, value);
const string = value => tag(8, value);
const compound = value => tag(10, value);
const list = (type, value) => tag(9, { type, value });
function number(method, size, value) {
  const bytes = Buffer.alloc(size);
  bytes[method](value);
  return bytes;
}
function name(value) {
  const bytes = Buffer.from(value);
  return Buffer.concat([number('writeUInt16BE', 2, bytes.length), bytes]);
}
function payload(type, value) {
  switch (type) {
    case 1: return number('writeInt8', 1, value);
    case 2: return number('writeInt16BE', 2, value);
    case 3: return number('writeInt32BE', 4, value);
    case 4: return number('writeBigInt64BE', 8, value);
    case 5: return number('writeFloatBE', 4, value);
    case 6: return number('writeDoubleBE', 8, value);
    case 7: return Buffer.concat([number('writeInt32BE', 4, value.length), Buffer.from(value)]);
    case 8: return name(value);
    case 9: return Buffer.concat([Buffer.from([value.type]), number('writeInt32BE', 4, value.value.length), ...value.value.map(item => payload(value.type, item))]);
    case 10: return Buffer.concat([...Object.entries(value).map(([key, child]) => Buffer.concat([Buffer.from([child.type]), name(key), payload(child.type, child.value)])), Buffer.from([0])]);
    case 11: return Buffer.concat([number('writeInt32BE', 4, value.length), ...value.map(item => number('writeInt32BE', 4, item))]);
    case 12: return Buffer.concat([number('writeInt32BE', 4, value.length), ...value.map(item => number('writeBigInt64BE', 8, item))]);
    default: throw new Error(`Unknown fixture type ${type}`);
  }
}
function nbt(value, rootName = '') {
  return Buffer.concat([Buffer.from([10]), name(rootName), payload(10, value)]);
}

test('NBT reader handles every Java NBT tag without losing int64 precision', () => {
  const bytes = nbt({
    byte: tag(1, -128), short: tag(2, -32768), int: int(2147483647),
    long: tag(4, -9223372036854775808n), float: tag(5, 1.25), double: tag(6, Math.PI),
    bytes: tag(7, [0, 128, 255]), text: string('地图 / 中文'),
    list: list(3, [-1, 0, 7]), empty: list(0, []),
    nested: compound({ answer: int(42) }),
    ints: tag(11, [-2147483648, 2147483647]), longs: tag(12, [9223372036854775807n]),
  }, 'SlopeCraft');
  const parsed = readNbt(bytes);
  assert.equal(parsed.name, 'SlopeCraft');
  assert.equal(parsed.value.long, -9223372036854775808n);
  assert.deepEqual(parsed.value.bytes, Buffer.from([0, 128, 255]));
  assert.equal(parsed.value.text, '地图 / 中文');
  assert.deepEqual(parsed.value.list, [-1, 0, 7]);
  assert.equal(parsed.value.nested.answer, 42);
  assert.deepEqual(parsed.value.longs, [9223372036854775807n]);
  assert.equal(parsed.types.get('/longs'), 12);
  assert.equal(parsed.bytesRead, bytes.length);
});

test('gzip and zlib exports parse to the same document as raw NBT', () => {
  const bytes = nbt({ Name: string('test') });
  assert.deepEqual(readNbt(gzipSync(bytes)).value, readNbt(bytes).value);
  assert.deepEqual(readNbt(deflateSync(bytes)).value, readNbt(bytes).value);
});

test('NBT reader rejects truncation, unknown tags, duplicate keys, trailing bytes and impossible lists', () => {
  const valid = nbt({ Name: string('test') });
  assert.throws(() => readNbt(valid.subarray(0, -1)), /Truncated/);
  assert.throws(() => readNbt(Buffer.concat([valid, Buffer.from([0])])), /Trailing/);
  assert.throws(() => readNbt(Buffer.from([10, 0, 0, 13, 0, 0, 0])), /Unsupported/);
  const child = Buffer.concat([Buffer.from([3]), name('same'), payload(3, 1)]);
  assert.throws(() => readNbt(Buffer.concat([Buffer.from([10, 0, 0]), child, child, Buffer.from([0])])), /Duplicate/);
  const nonemptyEndList = Buffer.from([10, 0, 0, 9, 0, 1, 97, 0, 0, 0, 0, 1, 0]);
  assert.throws(() => readNbt(nonemptyEndList), /TAG_End/);
  const negativeList = Buffer.from([10, 0, 0, 9, 0, 1, 97, 3, 255, 255, 255, 255, 0]);
  assert.throws(() => readNbt(negativeList), /length/);
});

test('NBT reader enforces nesting and expanded-data limits before large allocations', () => {
  const bytes = nbt({ a: compound({ b: compound({ value: int(1) }) }) });
  assert.throws(() => readNbt(bytes, { maxDepth: 1 }), /depth/);
  const compressed = gzipSync(nbt({ bytes: tag(7, Buffer.alloc(65536)) }));
  assert.throws(() => readNbt(compressed, { maxBytes: 1024 }));
});

test('map validator checks locked modern 128 × 128 maps and preserves unsigned color bytes', () => {
  const colors = Buffer.alloc(16384, 255);
  const bytes = nbt({ DataVersion: int(3955), data: compound({
    colors: tag(7, colors), scale: tag(1, 0), trackingPosition: tag(1, 0),
    unlimitedTracking: tag(1, 0), locked: tag(1, 1), dimension: string('minecraft:overworld'),
  }) });
  assert.deepEqual(validateMapData(gzipSync(bytes), { version: 21, colors }).colors, colors);
  const malformed = readNbt(bytes);
  malformed.value.data.colors = Buffer.alloc(10);
  assert.throws(() => validateMapData(malformed), /16384/);
});

test('packed litematic states decode across a 64-bit word boundary', () => {
  // Twenty-one 3-bit states fill 63 bits. The last value spans words.
  const values = Array.from({ length: 44 }, (_, index) => index % 5);
  let packed = 0n;
  for (let index = 0; index < values.length; index++) packed |= BigInt(values[index]) << BigInt(index * 3);
  const words = Array.from({ length: 3 }, (_, index) => BigInt.asIntN(64, packed >> BigInt(index * 64)));
  assert.deepEqual(Array.from(decodePackedStates(words, values.length, 5)), values);
  assert.throws(() => decodePackedStates([3n], 1, 3), /out of bounds/);
  assert.throws(() => decodePackedStates([], 1, 2), /word count/);
});

test('Sponge VarInt reader handles palette indices above 127 and rejects malformed streams', () => {
  assert.deepEqual(Array.from(decodeVarints(Buffer.from([0, 127, 128, 1, 255, 127]), 4)), [0, 127, 128, 16383]);
  assert.throws(() => decodeVarints(Buffer.from([128]), 1), /Truncated/);
  assert.throws(() => decodeVarints(Buffer.from([128, 128, 128, 128, 128, 0]), 1), /too long/);
  assert.throws(() => decodeVarints(Buffer.from([0, 1]), 1), /count/);
});

function vanillaFixture() {
  return nbt({
    size: list(3, [2, 1, 2]),
    palette: list(10, [{ Name: string('minecraft:air') }, { Name: string('minecraft:stone') }]),
    blocks: list(10, [
      { pos: list(3, [1, 0, 0]), state: int(1) },
      { pos: list(3, [0, 0, 1]), state: int(1) },
    ]),
    entities: list(10, []), MinecraftDataVersion: int(3955),
  });
}
function litematicFixture() {
  return nbt({
    Version: int(5), MinecraftDataVersion: int(3955),
    Metadata: compound({ RegionCount: int(1), TotalBlocks: int(2), TotalVolume: int(4) }),
    Regions: compound({ main: compound({
      Position: compound({ x: int(0), y: int(0), z: int(0) }),
      Size: compound({ x: int(2), y: int(1), z: int(2) }),
      BlockStatePalette: list(10, [{ Name: string('minecraft:air') }, { Name: string('minecraft:stone') }]),
      BlockStates: tag(12, [0b00010100n]), Entities: list(10, []),
    }) }),
  });
}
function spongeFixture(version) {
  const root = {
    Version: int(version), DataVersion: int(3955), Width: tag(2, 2), Height: tag(2, 1), Length: tag(2, 2),
    Offset: tag(11, [0, 0, 0]),
  };
  const palette = compound({ 'minecraft:air': int(0), 'minecraft:stone': int(1) });
  if (version === 2) {
    Object.assign(root, { Palette: palette, PaletteMax: int(2), BlockData: tag(7, [0, 1, 1, 0]) });
    return nbt(root);
  }
  root.Blocks = compound({ Palette: palette, Data: tag(7, [0, 1, 1, 0]) });
  return nbt({ Schematic: compound(root) });
}

test('all four structure encodings compare equal by actual block identity and coordinate', () => {
  const vanilla = validateVanillaStructure(vanillaFixture());
  const litematic = validateLitematic(litematicFixture()).regions[0];
  const sponge2 = validateSpongeSchematic(spongeFixture(2));
  const sponge3 = validateSpongeSchematic(spongeFixture(3));
  for (const other of [litematic, sponge2, sponge3]) assertSameBlocks(vanilla, other);
  assert.equal(vanilla.blockCount, 2);
});

test('structure validators reject wrong state ids, duplicate coordinates and incorrect metadata', () => {
  const vanilla = readNbt(vanillaFixture());
  vanilla.value.blocks[0].state = 99;
  assert.throws(() => validateVanillaStructure(vanilla), /out of bounds/);
  vanilla.value.blocks[0].state = 1;
  vanilla.value.blocks.push(vanilla.value.blocks[0]);
  assert.throws(() => validateVanillaStructure(vanilla), /duplicate/);
  const lite = readNbt(litematicFixture());
  lite.value.Metadata.TotalBlocks = 3;
  assert.throws(() => validateLitematic(lite), /block count/);
  const sponge = readNbt(spongeFixture(3));
  sponge.value.Schematic.Blocks.Data[0] = 2;
  assert.throws(() => validateSpongeSchematic(sponge), /out of bounds/);
});

test('semantic comparison ignores palette ordering but detects changed occupied coordinates', () => {
  const original = validateVanillaStructure(vanillaFixture());
  const reordered = readNbt(vanillaFixture());
  reordered.value.palette.reverse();
  for (const block of reordered.value.blocks) block.state = 1 - block.state;
  assertSameBlocks(original, validateVanillaStructure(reordered));
  reordered.value.blocks[0].pos = [0, 0, 0];
  assert.throws(() => assertSameBlocks(original, validateVanillaStructure(reordered)), /identities or coordinates/);
});
