// These tests load the compiled pthread WASM and validate its real output.
// Run after preparing assets and building the core: node --test tests/engine.test.mjs
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadEngine, selectBlocks, fixtureImage } from './engine-client.mjs';
import { validateMapData, validateVanillaStructure, validateLitematic, validateSpongeSchematic, assertSameBlocks } from './nbt.mjs';
import { validatePng, decodePngRgba } from './png.mjs';
import { zip } from '../scripts/zip.mjs';

let client, blocks, metadata;
const baseOptions = { version: 21, mapType: 0, algorithm: 'R', dither: false };
before(async () => {
  client = await loadEngine();
  assert.ok(client.engine.HEAPU8.buffer instanceof SharedArrayBuffer, 'the artifact is not a pthread shared-memory build');
  metadata = client.request('init', { threads: 4 });
  blocks = await client.loadBlocks();
});
after(() => {
  client?.engine.PThread?.terminateAllThreads?.();
});

function convert(id, options = {}, image = fixtureImage(), selectedBlocks) {
  return client.request('convert', {
    id, width: image.width, height: image.height,
    options: { ...baseOptions, ...options },
    blocks: selectedBlocks ?? selectBlocks(blocks, options.version ?? 21),
  }, image.bytes);
}
function firstExport(id, format, options) {
  const files = client.exported(id, format, options);
  assert.equal(files.length, 1, `${format} should return one file`);
  return files[0];
}

test('compiled shared-memory core loads real built-in blocklists', () => {
  assert.equal(metadata.pthread, true);
  assert.equal(metadata.threads, 4);
  assert.equal(metadata.mapColors.length, 256);
  assert.ok(blocks.length > 100, 'built-in blocklists were not parsed completely');
  for (const block of blocks) {
    assert.equal(typeof block.id, 'string');
    assert.ok(block.baseColor >= 0 && block.baseColor < 64);
    assert.ok(block.version >= 0);
  }
  assert.ok(blocks.some(block => block.id.includes('minecraft:stone')));
  const quark = blocks.filter(block => block.list === 'QuarkModBlocks.zip');
  assert.ok(quark.length > 0);
  assert.ok(quark.every(block => block.nameZH.startsWith('[夸克]') && block.nameEN.startsWith('[Quark]')), 'native Quark metadata name prefixes were lost');
});

test('native block icons match independently decoded original PNG pixels', async () => {
  const glass = blocks.find(block => block.id === 'minecraft:glass' && block.list === 'FixedBlocks.zip');
  const stone = blocks.find(block => block.id === 'minecraft:stone' && block.list === 'FixedBlocks.zip');
  assert.ok(glass && stone, 'the original glass/stone icons must be available');
  const original = decodePngRgba(await readFile(new URL(`../../Blocks_SCL/FixedBlocks/${glass.imageFilename}`, import.meta.url)));
  const icon = client.request('blockIcon', { key: glass.key });
  assert.equal(icon.preview.width, 16);
  assert.equal(icon.preview.height, 16);
  assert.deepEqual(icon.previewBytes, original.rgba, 'native icon pixels differ from the original PNG');
  assert.notDeepEqual(client.request('blockIcon', { key: stone.key }).previewBytes, icon.previewBytes, 'different source textures must retain different pixels');
  const trapdoor = blocks.find(block => block.imageFilename === 'iron_trapdoor.png' && block.list === 'FixedBlocks.zip');
  assert.ok(trapdoor, 'indexed tRNS regression texture is missing');
  const indexed = decodePngRgba(await readFile(new URL('../../Blocks_SCL/FixedBlocks/iron_trapdoor.png', import.meta.url)));
  assert.deepEqual(client.request('blockIcon', { key: trapdoor.key }).previewBytes, indexed.rgba, 'indexed PNG transparency expansion or pixel alignment is incorrect');
});

test('palette and blocklist diagnostic tools work without an image even with GA selected', () => {
  client.request('clear');
  const selection = selectBlocks(blocks);
  const options = { version: 21, mapType: 0, algorithm: 'A' };
  const palette = client.request('palette', { options, blocks: selection });
  assert.ok(palette.colorCount > 3);
  assert.equal(palette.colors.length, palette.colorCount);
  const chosen = ['minecraft:glass', 'minecraft:grass_block[snowy=false]', 'minecraft:slime_block', 'minecraft:stone', 'minecraft:water[level=0]']
    .map(id => blocks.find(block => block.id === id && block.version <= 21));
  assert.ok(chosen.every(Boolean), 'all chosen diagnostic blocks must exist in this version');
  const keys = chosen.map(block => block.key);
  const runTool = format => {
    const result = client.request('testBlocklist', { options, blocks: selection, keys, format });
    assert.equal(result.blockCount, keys.length);
    assert.equal(result.files.length, 1);
    const bytes = new Uint8Array(client.engine.FS.readFile(result.files[0].path));
    client.engine.FS.unlink(result.files[0].path);
    return bytes;
  };
  const vanilla = validateVanillaStructure(runTool('nbt'));
  const lite = validateLitematic(runTool('litematic')).regions[0];
  assertSameBlocks(vanilla, lite);
  assert.equal(vanilla.size[1], 2);
  assert.equal(vanilla.size[2], 64);
  assert.equal(vanilla.blockCount, chosen.length + 64, 'diagnostic should contain each selected block and 64 original marker blocks');
  for (const block of chosen) assert.ok(Object.keys(vanilla.counts).some(id => id.split('[')[0] === block.id.split('[')[0]), `${block.id} missing from diagnostic structure`);
});

test('reported palette obeys game-version and map-type filtering and matches exported map pixels', async t => {
  for (const version of [12, 16, 17, 21, 4790, 4903]) for (const mapType of [0, 1, 2]) {
    await t.test(`version ${version}, type ${mapType}`, () => {
      const selection = selectBlocks(blocks, version);
      const result = client.request('palette', { options: { version, mapType, algorithm: 'A' }, blocks: selection });
      assert.equal(result.version, version);
      assert.equal(result.mapType, mapType);
      assert.equal(result.colorCount, result.colors.length);
      assert.equal(new Set(result.colors.map(color => color.mapId)).size, result.colors.length);
      const maximumBaseColor = version < 16 ? 51 : version < 17 ? 58 : 61;
      const byId = new Map(result.colors.map(color => [color.mapId, color]));
      const image = { width: result.colors.length, height: 1, bytes: new Uint8Array(result.colors.length * 4) };
      for (let index = 0; index < result.colors.length; index++) {
        const color = result.colors[index];
        assert.equal(color.baseColor, Math.floor(color.mapId / 4));
        assert.equal(color.shade, color.mapId % 4);
        assert.ok(color.baseColor >= 1 && color.baseColor <= maximumBaseColor);
        assert.equal(color.rgb, metadata.mapColors[color.mapId] & 0xffffff);
        if (mapType === 0) assert.ok(color.shade < 3);
        if (mapType === 1) assert.equal(color.shade, color.baseColor === 12 ? 2 : 1);
        image.bytes.set([color.rgb >>> 16, (color.rgb >>> 8) & 255, color.rgb & 255, 255], index * 4);
      }
      const id = `palette-filter-${version}-${mapType}`;
      convert(id, { version, mapType, algorithm: 'r' }, image, selection);
      const files = client.exported(id, 'dat');
      const maps = files.map(file => validateMapData(file.bytes).colors);
      for (let index = 0; index < result.colors.length; index++) {
        const mapIndex = Math.floor(index / 128);
        const actual = byId.get(maps[mapIndex][index % 128]);
        assert.ok(actual, 'converted map ID is not in the reported allowed palette');
        assert.equal(actual.rgb, result.colors[index].rgb, 'exact palette RGB changed during conversion');
      }
    });
  }
});

test('non-square row-major RGBA retains every palette color at its original coordinate', () => {
  const seen = new Set();
  const allowed = new Set(selectBlocks(blocks).map(block => block.baseColor));
  const candidates = metadata.mapColors.flatMap((argb, mapId) => {
    const rgb = argb & 0xffffff;
    if (mapId < 4 || mapId >= 248 || !allowed.has(Math.floor(mapId / 4)) || seen.has(rgb)) return [];
    seen.add(rgb);
    return [{ argb, mapId }];
  });
  const width = 5, height = 3;
  const expected = Array.from({ length: width * height }, (_, index) => candidates[(index * 11 + 7) % candidates.length]);
  assert.equal(new Set(expected.map(color => color.mapId)).size, width * height, 'orientation fixture must have unique pixels');
  const bytes = new Uint8Array(width * height * 4);
  for (let index = 0; index < expected.length; index++) {
    const { argb } = expected[index];
    bytes.set([(argb >>> 16) & 255, (argb >>> 8) & 255, argb & 255, 255], index * 4);
  }
  const result = convert('orientation', { mapType: 2, algorithm: 'r' }, { width, height, bytes });
  assert.deepEqual(result.previewBytes, bytes, 'preview transposed or reordered row-major RGBA input');
  const { colors } = validateMapData(firstExport('orientation', 'dat').bytes);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    assert.equal(colors[y * 128 + x], expected[y * width + x].mapId, `map pixel (${x}, ${y}) differs from source`);
  }
});

test('all seven upstream conversion algorithms run, including small GA parameters', async t => {
  for (const algorithm of ['r', 'R', 'H', 'X', 'l', 'L', 'A']) {
    await t.test(algorithm, () => {
      const image = fixtureImage(8, 7);
      const result = convert(`algo-${algorithm}`, {
        algorithm, ga: { popSize: 8, maxGeneration: 3, maxFailTimes: 2, crossoverProb: 0.8, mutationProb: 0.01 },
      }, image);
      assert.equal(result.preview.width, image.width);
      assert.equal(result.preview.height, image.height);
      assert.equal(result.previewBytes.length, image.width * image.height * 4);
      assert.ok(result.previewBytes.some((value, index) => index % 4 !== 3 && value !== 0), 'conversion returned a blank preview');
    });
  }
});

test('multiple pthread workers complete real color matching work against shared memory', t => {
  const converted = convert('parallel-evidence', { algorithm: 'L' }, fixtureImage(256, 256));
  assert.ok(converted.stats.workersProcessed >= 2, 'fewer than two pthreads completed work');
  assert.ok(converted.stats.workerItems.filter(count => count > 0).length >= 2, 'per-worker processing counters show no parallel execution');
  assert.ok(converted.stats.workerItems.reduce((sum, count) => sum + count, 0) >= 1000, 'parallel evidence fixture processed too few colors');
  t.diagnostic(`Actual pthread completion evidence: ${converted.stats.workersProcessed} workers, item counts ${JSON.stringify(converted.stats.workerItems)}`);
});

test('conversion is repeatable for non-GA algorithms with and without dithering', () => {
  for (const dither of [false, true]) {
    const one = convert(`repeat-a-${dither}`, { algorithm: 'L', dither });
    const two = convert(`repeat-b-${dither}`, { algorithm: 'L', dither });
    assert.deepEqual(one.previewBytes, two.previewBytes);
  }
});

test('all twelve game versions export valid map data with version-specific filenames', async t => {
  for (const version of [12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 4790, 4903]) {
    await t.test(String(version), () => {
      const id = `version-${version}`;
      convert(id, { version }, fixtureImage(5, 4));
      const file = firstExport(id, 'dat', { beginIndex: 713 });
      assert.equal(file.name, version >= 4790 ? '713.dat' : 'map_713.dat');
      const { colors } = validateMapData(file.bytes, { version });
      assert.equal(colors[127 * 128 + 127], 0, 'map padding must be transparent');
    });
  }
});

test('non-square images split into column-major numbered maps and zero padding', () => {
  const id = 'multipart-map';
  const image = fixtureImage(129, 130);
  const preview = convert(id, { mapType: 2 }, image).previewBytes;
  const files = client.exported(id, 'dat', { beginIndex: 41 });
  assert.deepEqual(files.map(file => file.name), ['map_41.dat', 'map_42.dat', 'map_43.dat', 'map_44.dat']);
  const maps = files.map(file => validateMapData(file.bytes).colors);
  for (let mapColumn = 0; mapColumn < 2; mapColumn++) for (let mapRow = 0; mapRow < 2; mapRow++) {
    const map = maps[mapColumn * 2 + mapRow];
    for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
      if (x + mapColumn * 128 >= image.width || y + mapRow * 128 >= image.height) {
        assert.equal(map[y * 128 + x], 0, 'pixel outside original image must be transparent');
      } else {
        const argb = metadata.mapColors[map[y * 128 + x]];
        const sourceOffset = ((y + mapRow * 128) * image.width + x + mapColumn * 128) * 4;
        assert.deepEqual(Array.from(preview.subarray(sourceOffset, sourceOffset + 4)), [(argb >>> 16) & 255, (argb >>> 8) & 255, argb & 255, argb >>> 24], 'map split disagrees with preview coordinate');
      }
    }
  }
});

test('slope and flat terrain exports agree per block across NBT, litematic and Sponge v3', async t => {
  for (const mapType of [0, 1]) {
    await t.test(String(mapType), () => {
      const id = `terrain-${mapType}`;
      const image = fixtureImage(16, 13);
      const converted = convert(id, { mapType }, image);
      const built = client.request('build', { id, options: { maxHeight: 256, compression: 1, glassBridge: 1, bridgeInterval: 3 } });
      assert.deepEqual(built.previewBytes, converted.previewBytes, 'lossless height compression must preserve map colors');
      const vanilla = validateVanillaStructure(firstExport(id, 'nbt', { isAirStructureVoid: true }).bytes);
      const lite = validateLitematic(firstExport(id, 'litematic', { name: '中文地图画', regionName: '测试区域' }).bytes);
      const sponge = validateSpongeSchematic(firstExport(id, 'schem', { offset: [3, -2, 1], weOffset: [-4, 5, 6] }).bytes);
      assert.deepEqual(vanilla.size, [image.width + 2, vanilla.size[1], image.height + 2]);
      assert.ok(vanilla.blockCount > 0);
      assert.equal(vanilla.blockCount, built.blockCount);
      assertSameBlocks(vanilla, lite.regions[0]);
      assertSameBlocks(vanilla, sponge);
      assert.equal(lite.root.Metadata.Name, '中文地图画');
      assert.equal(lite.regions[0].name, '测试区域');
      assert.deepEqual(sponge.root.Offset, [3, -2, 1]);
      assert.equal(sponge.root.Version, 3);
      if (mapType === 1) {
        const png = validatePng(firstExport(id, 'png', { splitLineRowMargin: 8, splitLineColMargin: 8 }).bytes);
        assert.ok(png.width >= image.width * 16 && png.height >= image.height * 16, 'diagram does not contain block textures');
      }
    });
  }
});

test('older WorldEdit output uses Sponge v2 and 1.12 reports the upstream unsupported format', () => {
  for (const version of [12, 19]) {
    const id = `we-${version}`;
    convert(id, { version, mapType: 1 }, fixtureImage(6, 5));
    client.request('build', { id, options: { maxHeight: 256 } });
    if (version === 12) {
      assert.equal(client.raw({ op: 'export', id, format: 'schem' }).ok, false);
    } else {
      const schematic = validateSpongeSchematic(firstExport(id, 'schem', { weOffset: [-3, 2, 7], requiredMods: ['quark'] }).bytes);
      assert.equal(schematic.root.Version, 2);
      assert.deepEqual([schematic.root.Metadata.WEOffsetX, schematic.root.Metadata.WEOffsetY, schematic.root.Metadata.WEOffsetZ], [-3, 2, 7]);
      assert.deepEqual(schematic.root.Metadata.RequiredMods, ['quark']);
    }
  }
});

test('air omission option changes serialized positions while preserving occupied blocks', () => {
  const id = 'air-mode';
  convert(id, { mapType: 1 }, fixtureImage(5, 4));
  client.request('build', { id, options: { maxHeight: 256 } });
  const omitted = validateVanillaStructure(firstExport(id, 'nbt', { isAirStructureVoid: true }).bytes);
  const explicit = validateVanillaStructure(firstExport(id, 'nbt', { isAirStructureVoid: false }).bytes);
  assertSameBlocks(omitted, explicit);
  assert.equal(explicit.root.blocks.length, explicit.states.length);
  assert.ok(omitted.root.blocks.length < explicit.root.blocks.length);
});

test('transparent-air strategy preserves fully transparent pixels in map files', () => {
  const image = fixtureImage(3, 2);
  image.bytes[3] = 0;
  for (const pureTransparent of ['A', 'B']) {
    const id = `alpha-${pureTransparent}`;
    convert(id, { pureTransparent, backgroundColor: '#ffffff' }, image);
    const { colors } = validateMapData(firstExport(id, 'dat').bytes);
    if (pureTransparent === 'A') assert.equal(colors[0], 0);
    else assert.ok(colors[0] >= 4, 'background replacement must produce a colored pixel');
  }
});

test('all half-transparent strategies match independently preprocessed opaque pixels', () => {
  const original = fixtureImage(3, 2);
  original.bytes.set([210, 30, 90, 128], 0);
  const background = [20, 100, 230];
  for (const halfTransparent of ['B', 'C', 'R']) {
    const expected = { ...original, bytes: new Uint8Array(original.bytes) };
    for (let channel = 0; channel < 3; channel++) {
      expected.bytes[channel] = halfTransparent === 'B' ? background[channel]
        : halfTransparent === 'C' ? Math.floor((original.bytes[channel] * 128 + background[channel] * 127) / 255)
          : original.bytes[channel];
    }
    expected.bytes[3] = 255;
    const options = { halfTransparent, backgroundColor: '#1464e6' };
    const processed = convert(`half-${halfTransparent}`, options, original);
    const control = convert(`half-control-${halfTransparent}`, {}, expected);
    assert.deepEqual(processed.previewBytes, control.previewBytes, `${halfTransparent} differs from upstream preprocessing semantics`);
  }
});

test('height compression, bridge and support options produce valid terrain and material counts', async t => {
  for (const compression of [0, 1, 2, 3]) {
    for (const supportBlock of [0, 1, 2]) {
      await t.test(`compression ${compression}, support ${supportBlock}`, () => {
        const id = `build-options-${compression}-${supportBlock}`;
        convert(id, {}, fixtureImage(8, 7));
        const built = client.request('build', { id, options: {
          maxHeight: 256, compression, glassBridge: 1, bridgeInterval: 2,
          supportBlock, fireproof: true, enderproof: true, connectMushroom: true,
        } });
        const structure = validateVanillaStructure(firstExport(id, 'nbt').bytes);
        assert.equal(structure.blockCount, built.blockCount);
        assert.deepEqual(structure.size, built.size);
        assert.ok(built.materials.length > 0);
        assert.equal(built.materials.reduce((sum, material) => sum + material.count, 0), built.blockCount, 'material quantities must add up to occupied blocks');
      });
    }
  }
});

test('forced height compression changes a genuinely over-height column and satisfies its limit', t => {
  const image = { width: 1, height: 20, bytes: new Uint8Array(20 * 4) };
  const argb = metadata.mapColors[11 * 4 + 2];
  for (let y = 0; y < image.height; y++) image.bytes.set([(argb >>> 16) & 255, (argb >>> 8) & 255, argb & 255, 255], y * 4);
  // Upstream requires more than three allowed shades. Keep grass alongside
  // stone; this exact gray fixture still matches only stone's bright shade.
  const selection = selectBlocks(blocks).map(block => ({ ...block, enabled: [0, 1, 11].includes(block.baseColor) }));
  const converted = convert('forced-height', { algorithm: 'r' }, image, selection);
  const original = client.request('build', { id: 'forced-height', options: { maxHeight: 256, compression: 0 } });
  assert.ok(original.size[1] > 14, 'fixture must require more than fourteen layers');
  const compressed = client.request('build', { id: 'forced-height', options: { maxHeight: 14, compression: 2 } });
  assert.ok(compressed.size[1] <= 14, 'forced compression exceeded the requested height');
  assert.notDeepEqual(compressed.previewBytes, converted.previewBytes, 'forced compression did not alter map shades');
  const vanilla = validateVanillaStructure(firstExport('forced-height', 'nbt').bytes);
  assertSameBlocks(vanilla, validateLitematic(firstExport('forced-height', 'litematic').bytes).regions[0]);
  assertSameBlocks(vanilla, validateSpongeSchematic(firstExport('forced-height', 'schem').bytes));
  t.diagnostic(`Forced-height fixture: ${original.size[1]} layers → ${compressed.size[1]} layers`);
});

test('disabled glass and stone map colors retain their physical blocks for water and support', () => {
  const image = { width: 4, height: 6, bytes: new Uint8Array(4 * 6 * 4) };
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
    const argb = metadata.mapColors[(x < 2 ? 12 : 1) * 4 + 2];
    image.bytes.set([(argb >>> 16) & 255, (argb >>> 8) & 255, argb & 255, 255], (y * image.width + x) * 4);
  }
  const selection = selectBlocks(blocks).map(block => ({ ...block, enabled: ![0, 11].includes(block.baseColor) }));
  convert('disabled-support-colors', { algorithm: 'r' }, image, selection);
  client.request('build', { id: 'disabled-support-colors', options: { maxHeight: 256, compression: 0, glassBridge: 1, bridgeInterval: 1, supportBlock: 2 } });
  const vanilla = validateVanillaStructure(firstExport('disabled-support-colors', 'nbt').bytes);
  const selectedGlass = selection.find(block => block.baseColor === 0).id.split('[')[0];
  const selectedStone = selection.find(block => block.baseColor === 11).id.split('[')[0];
  assert.ok(Object.entries(vanilla.counts).some(([id, count]) => id.split('[')[0] === selectedGlass && count > 0), `water enclosure must retain the chosen physical glass (${selectedGlass}); counts=${JSON.stringify(vanilla.counts)}`);
  assert.ok(Object.entries(vanilla.counts).some(([id, count]) => id.split('[')[0] === selectedStone && count > 0), `support placement must retain the chosen physical stone (${selectedStone}); counts=${JSON.stringify(vanilla.counts)}`);
  assertSameBlocks(vanilla, validateLitematic(firstExport('disabled-support-colors', 'litematic').bytes).regions[0]);
  assertSameBlocks(vanilla, validateSpongeSchematic(firstExport('disabled-support-colors', 'schem').bytes));
});

test('all three water shades create their actual water depth including the first image row', async t => {
  for (const [shade, depth] of [[0, 11], [1, 6], [2, 1]]) {
    await t.test(`shade ${shade}, depth ${depth}`, () => {
      const id = `water-shade-${shade}`;
      const mapId = 12 * 4 + shade;
      const argb = metadata.mapColors[mapId];
      const image = { width: 1, height: 1, bytes: new Uint8Array([(argb >>> 16) & 255, (argb >>> 8) & 255, argb & 255, 255]) };
      convert(id, { algorithm: 'r' }, image);
      assert.equal(validateMapData(firstExport(id, 'dat').bytes).colors[0], mapId, 'water fixture must match its exact intended shade');
      client.request('build', { id, options: { maxHeight: 256, compression: 0, glassBridge: 0 } });
      const structure = validateVanillaStructure(firstExport(id, 'nbt').bytes);
      const waterCount = Object.entries(structure.counts).filter(([id]) => id.split('[')[0] === 'minecraft:water').reduce((sum, [, count]) => sum + count, 0);
      assert.equal(waterCount, depth, 'water depth differs from the upstream shade definition');
      assert.equal(structure.size[1], depth + 1, 'water enclosure must include the glass top');
      assert.ok(structure.counts['minecraft:glass'] > 0, 'water must have a glass enclosure');
    });
  }
});

test('water in the first and last rows retains sealed sides and a glass top beside solid terrain', () => {
  const image = { width: 3, height: 3, bytes: new Uint8Array(3 * 3 * 4) };
  for (let index = 0; index < 9; index++) {
    const mapId = index === 0 ? 48 : index === 8 ? 50 : 5;
    const argb = metadata.mapColors[mapId];
    image.bytes.set([(argb >>> 16) & 255, (argb >>> 8) & 255, argb & 255, 255], index * 4);
  }
  convert('boundary-water', { algorithm: 'r' }, image);
  client.request('build', { id: 'boundary-water', options: { maxHeight: 256, compression: 0, glassBridge: 0 } });
  const structure = validateVanillaStructure(firstExport('boundary-water', 'nbt').bytes);
  const [sx, sy, sz] = structure.size;
  const stateAt = (x, y, z) => {
    assert.ok(x >= 0 && x < sx && y >= 0 && y < sy && z >= 0 && z < sz);
    return structure.palette[structure.states[x + sx * (z + sz * y)]].split('[')[0];
  };
  for (const [x, z, expectedDepth] of [[1, 1, 11], [3, 3, 1]]) {
    const waterYs = [];
    for (let y = 0; y < sy; y++) if (stateAt(x, y, z) === 'minecraft:water') waterYs.push(y);
    assert.equal(waterYs.length, expectedDepth);
    assert.equal(stateAt(x, waterYs.at(-1) + 1, z), 'minecraft:glass');
    for (const y of waterYs) for (const [nx, nz] of [[x - 1, z], [x + 1, z], [x, z - 1], [x, z + 1]]) {
      assert.notEqual(stateAt(nx, y, nz), 'minecraft:air', 'a side of the water column is uncontained');
    }
  }
});

test('assembled maps preserve ids, glow, fixed/invisible flags and all twelve orientations', async t => {
  const id = 'assembled';
  convert(id, { mapType: 2 }, fixtureImage(129, 2));
  for (let facing = 0; facing < 12; facing++) {
    await t.test(String(facing), () => {
      const options = { beginIndex: 90, mapFacing: facing, frameVariant: 1, fixedFrame: true, invisibleFrame: true, after1205: true };
      const vanilla = validateVanillaStructure(firstExport(id, 'assembled-nbt', options).bytes);
      const lite = validateLitematic(firstExport(id, 'assembled-litematic', options).bytes);
      assert.equal(vanilla.entities.length, 2);
      assert.equal(lite.regions[0].entities.length, 2);
      const entities = vanilla.entities.map(entity => entity.nbt);
      for (const entity of entities) {
        assert.match(entity.id, /^(?:minecraft:)?glow_item_frame$/);
        assert.equal(entity.Fixed, 1);
        assert.equal(entity.Invisible, 1);
        assert.equal(entity.Facing, [2, 3, 5, 4, 1, 1, 1, 1, 0, 0, 0, 0][facing]);
        assert.equal(entity.ItemRotation, [0, 0, 0, 0, 0, 2, 1, 3, 2, 0, 1, 3][facing]);
      }
      assert.deepEqual(entities.map(entity => entity.Item.components['minecraft:map_id']).sort((a, b) => a - b), [90, 91]);
    });
  }
});

test('give commands follow pre-1.13, pre-1.20.5 and modern item syntaxes', () => {
  for (const [version, after1205, expected] of [[12, false, /minecraft:chest/], [19, false, /BlockEntityTag/], [21, true, /minecraft:container/]]) {
    const id = `command-${version}`;
    convert(id, { version, mapType: 2 }, fixtureImage(3, 3));
    const command = new TextDecoder().decode(firstExport(id, 'command', { beginIndex: 45, after1205 }).bytes);
    assert.match(command, /give\s+@p\s+/);
    assert.match(command, expected);
    assert.match(command, /45/);
  }
});

test('a custom block package with a corrupt PNG reports a warning without aborting the module', async () => {
  const png = await readFile(new URL('../../Blocks_SCL/FixedBlocks/glass.png', import.meta.url));
  // Keep a valid PNG signature/header but damage its IHDR CRC so that libpng's
  // actual error handler runs instead of only a filename/signature check.
  png[29] ^= 1;
  const archive = zip([
    { name: 'block_list.json', data: Buffer.from(JSON.stringify([{
      baseColor: 11, id: 'minecraft:stone', nameZH: '损坏图标测试', nameEN: 'Corrupt icon test',
      icon: 'corrupt.png', version: 'ANCIENT',
    }])) },
    { name: 'corrupt.png', data: png },
  ]);
  const loaded = client.request('loadBlocklist', { name: 'corrupt-icon-test.zip' }, archive);
  assert.equal(loaded.blocks.length, 1);
  assert.ok(loaded.warnings.length > 0, 'corrupt block icon must be reported');
  convert('after-bad-icon', {}, fixtureImage(3, 3));
  assert.equal(validateMapData(firstExport('after-bad-icon', 'dat').bytes).colors.length, 16384);
});

test('native image/structure caches restore dithered alpha previews and all terrain formats', async t => {
  for (const withStructure of [false, true]) {
    await t.test(withStructure ? 'converted image and 3D structure' : 'converted image only', () => {
      const id = `cache-${withStructure}`;
      const image = fixtureImage(11, 9);
      image.bytes[3] = 0;
      image.bytes[7] = 128;
      const converted = convert(id, { algorithm: 'L', dither: true, pureTransparent: 'A', halfTransparent: 'C', backgroundColor: '#ffff00' }, image);
      let expectedPreview = converted.previewBytes;
      let reference;
      if (withStructure) {
        const built = client.request('build', { id, options: { maxHeight: 256, compression: 1, supportBlock: 1 } });
        expectedPreview = built.previewBytes;
        reference = validateVanillaStructure(firstExport(id, 'nbt').bytes);
      }
      const expectedMaps = client.exported(id, 'dat', { beginIndex: 6 }).map(file => validateMapData(file.bytes).colors);
      const cache = client.request('cacheSave', { id });
      assert.equal(cache.hasStructure, withStructure);
      assert.equal(cache.files.length, withStructure ? 2 : 1);
      const savedFiles = cache.files.map(file => ({ ...file, bytes: new Uint8Array(client.engine.FS.readFile(file.path)) }));
      for (const file of savedFiles) assert.ok(file.bytes.length > 0, 'native cache file must not be empty');
      client.request('cacheRelease', { id });
      assert.equal(client.raw({ op: 'export', id, format: 'dat' }).ok, false, 'released image must require cache restoration');
      for (const file of savedFiles) {
        client.engine.FS.unlink(file.path);
        client.engine.FS.writeFile(file.path, file.bytes);
      }
      const restored = client.request('cacheLoad', {
        id,
        imagePath: savedFiles.find(file => file.kind === 'image').path,
        ...(withStructure ? { structurePath: savedFiles.find(file => file.kind === 'structure').path } : {}),
      });
      assert.equal(restored.width, image.width);
      assert.equal(restored.height, image.height);
      assert.equal(restored.hasStructure, withStructure);
      assert.deepEqual(restored.previewBytes, expectedPreview, 'native cache did not preserve preview pixels');
      const actualMaps = client.exported(id, 'dat', { beginIndex: 6 }).map(file => validateMapData(file.bytes).colors);
      assert.deepEqual(actualMaps, expectedMaps, 'native cache did not preserve map pixels');
      if (withStructure) {
        assertSameBlocks(reference, validateVanillaStructure(firstExport(id, 'nbt').bytes));
        assertSameBlocks(reference, validateLitematic(firstExport(id, 'litematic').bytes).regions[0]);
        assertSameBlocks(reference, validateSpongeSchematic(firstExport(id, 'schem').bytes));
        client.request('releaseStructure', { id });
        assert.equal(client.raw({ op: 'export', id, format: 'nbt' }).ok, false, 'released structure must require rebuilding');
        assert.equal(validateMapData(firstExport(id, 'dat').bytes).colors.length, 16384, 'releasing structure must retain converted image');
      }
    });
  }
});

test('bad requests are reported without corrupting later successful requests', () => {
  assert.equal(client.raw({ op: 'unsupported-operation' }).ok, false);
  assert.equal(client.raw({ op: 'build', id: 'does-not-exist' }).ok, false);
  assert.equal(client.raw({ op: 'convert', id: 'bad-bytes', width: 2, height: 2, options: baseOptions, blocks: selectBlocks(blocks) }, new Uint8Array(3)).ok, false);
  assert.equal(client.raw({ op: 'loadBlocklist', name: 'bad.zip' }, new Uint8Array([1, 2, 3, 4])).ok, false);
  assert.equal(client.raw({ op: 'convert', id: 'no-colors', width: 2, height: 2, options: baseOptions, blocks: selectBlocks(blocks).map(block => ({ ...block, enabled: false })) }, fixtureImage(2, 2).bytes).ok, false);
  convert('still-working', {}, fixtureImage(3, 3));
  assert.equal(validateMapData(firstExport('still-working', 'dat').bytes).colors.length, 16384);
});
