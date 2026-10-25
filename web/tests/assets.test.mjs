import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';
import { crc32 } from './png.mjs';

// Independent ZIP inspection, used to establish that runtime block packages
// contain the upstream files byte-for-byte rather than approximate web assets.
function extractZip(bytes) {
  const end = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(end >= 0 && end + 22 <= bytes.length, 'ZIP end record is missing');
  const count = bytes.readUInt16LE(end + 10);
  let cursor = bytes.readUInt32LE(end + 16);
  const files = new Map();
  for (let index = 0; index < count; index++) {
    assert.equal(bytes.readUInt32LE(cursor), 0x02014b50, 'ZIP central directory header is invalid');
    const method = bytes.readUInt16LE(cursor + 10);
    const compressedLength = bytes.readUInt32LE(cursor + 20);
    const length = bytes.readUInt32LE(cursor + 24);
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30);
    const commentLength = bytes.readUInt16LE(cursor + 32);
    const localOffset = bytes.readUInt32LE(cursor + 42);
    const name = bytes.toString('utf8', cursor + 46, cursor + 46 + nameLength);
    assert.ok(!files.has(name), 'ZIP contains duplicate paths');
    assert.equal(bytes.readUInt32LE(localOffset), 0x04034b50, 'ZIP local header is invalid');
    const dataOffset = localOffset + 30 + bytes.readUInt16LE(localOffset + 26) + bytes.readUInt16LE(localOffset + 28);
    const compressed = bytes.subarray(dataOffset, dataOffset + compressedLength);
    assert.equal(compressed.length, compressedLength);
    assert.ok(method === 0 || method === 8, 'unsupported ZIP method');
    const data = method === 8 ? inflateRawSync(compressed) : compressed;
    assert.equal(data.length, length, 'ZIP uncompressed size differs');
    assert.equal(crc32(data), bytes.readUInt32LE(cursor + 16), 'ZIP content CRC differs');
    files.set(name, data);
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

for (const name of ['FixedBlocks', 'CustomBlocks', 'QuarkModBlocks']) {
  test(`${name} web ZIP preserves every original PNG and block list byte-for-byte`, async () => {
    const originalDirectory = new URL(`../../Blocks_SCL/${name}/`, import.meta.url);
    const originalNames = (await readdir(originalDirectory)).filter(file => file.endsWith('.png') || file === 'block_list.json' || file === 'metainfo.json').sort();
    const archive = await readFile(new URL(`../assets/blocklists/${name}.zip`, import.meta.url));
    const files = extractZip(archive);
    assert.deepEqual([...files.keys()].sort(), originalNames);
    for (const filename of originalNames) {
      assert.deepEqual(files.get(filename), await readFile(new URL(filename, originalDirectory)), `${name}/${filename} differs from upstream`);
    }
  });
}

test('all four presets and the license retain their original bytes', async () => {
  for (const name of ['vanilla', 'cheap', 'elegant', 'shiny']) {
    const filename = `${name}.sc_preset_json`;
    const original = await readFile(new URL(`../../SlopeCraft/others/presets/${filename}`, import.meta.url));
    const packaged = await readFile(new URL(`../assets/presets/${filename}`, import.meta.url));
    assert.deepEqual(packaged, original, `${name} preset differs from upstream`);
    const values = JSON.parse(packaged);
    assert.equal(values.length, 62, 'preset must describe every supported base color (0 through 61)');
    for (let index = 0; index < 62; index++) assert.equal(values[index].baseColor, index);
  }
  assert.deepEqual(await readFile(new URL('../assets/LICENSE.txt', import.meta.url)), await readFile(new URL('../../LICENSE', import.meta.url)));
});

test('browser block catalog includes all source libraries and original palette anchors', async () => {
  const catalog = JSON.parse(await readFile(new URL('../assets/blocklists.json', import.meta.url)));
  assert.deepEqual(catalog.groups.map(group => group.name), ['FixedBlocks', 'CustomBlocks', 'QuarkModBlocks']);
  assert.equal(catalog.blocks.length, catalog.groups.reduce((sum, group) => sum + group.blocks.length, 0));
  assert.equal(catalog.baseColors.length, 64);
  assert.deepEqual(catalog.baseColors[1], [127, 178, 56]);
  assert.deepEqual(catalog.baseColors[2], [247, 233, 163]);
  assert.deepEqual(catalog.baseColors[11], [112, 112, 112]);
  const quark = catalog.groups.find(group => group.name === 'QuarkModBlocks');
  assert.deepEqual(quark.requiredMods, ['Quark']);
  assert.ok(quark.blocks.every(block => block.nameZH.startsWith('[夸克]') && block.nameEN.startsWith('[Quark]')), 'Quark metadata name prefixes were lost');
});
