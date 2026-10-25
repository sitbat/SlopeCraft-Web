import { readFile, access } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, dirname } from 'node:path';
import assert from 'node:assert/strict';
import {invokeNativeJSON,copyNativePreview} from '../native-bridge.js';

const webRoot = fileURLToPath(new URL('../', import.meta.url));

export async function loadEngine() {
  const modulePath = process.env.SC_WASM_MODULE
    ? resolve(process.env.SC_WASM_MODULE)
    : resolve(webRoot, 'wasm/slopecraft.js');
  await access(modulePath).catch(() => {
    throw new Error(`Compiled pthread WASM is missing: ${modulePath}. Build it before running engine.test.mjs; these tests do not substitute a mock engine.`);
  });
  const factory = (await import(pathToFileURL(modulePath).href)).default;
  const errors = [];
  const engine = await factory({
    locateFile: filename => resolve(dirname(modulePath), filename),
    print: () => {},
    printErr: line => errors.push(line),
  });
  function raw(payload, input = new Uint8Array()) {
      const result = invokeNativeJSON(engine,payload,input);
      if (result.ok && result.data?.preview) {
        result.data.previewBytes = copyNativePreview(engine,result.data.preview);
      }
      return result;
  }
  function request(op, payload = {}, input) {
    const result = raw({ op, ...payload }, input);
    assert.equal(result.ok, true, `${op} failed: ${result.error ?? JSON.stringify(result)}`);
    return result.data;
  }
  async function asset(relative) {
    for (const location of [resolve(webRoot, 'assets', relative), resolve(webRoot, 'dist/assets', relative)]) {
      try { return new Uint8Array(await readFile(location)); } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    throw new Error(`Required test resource is missing: assets/${relative}`);
  }
  async function loadBlocks() {
    const blocks = [];
    for (const filename of ['FixedBlocks.zip', 'CustomBlocks.zip', 'QuarkModBlocks.zip']) {
      const loaded = request('loadBlocklist', { name: filename }, await asset(`blocklists/${filename}`));
      assert.ok(Array.isArray(loaded.blocks), `${filename} did not expose its parsed blocks`);
      blocks.push(...loaded.blocks);
    }
    return blocks;
  }
  function exported(id, format, options = {}) {
    const result = request('export', { id, format, options });
    assert.ok(Array.isArray(result.files) && result.files.length > 0, `${format} returned no files`);
    return result.files.map(file => {
      const bytes = new Uint8Array(engine.FS.readFile(file.path));
      assert.ok(bytes.length > 0, `${file.name} is empty`);
      return { ...file, bytes };
    });
  }
  return { engine, modulePath, errors, raw, request, asset, loadBlocks, exported };
}

export function selectBlocks(allBlocks, version = 21) {
  const selected = new Map();
  for (const block of allBlocks) {
    if (block.version > version || selected.has(block.baseColor)) continue;
    selected.set(block.baseColor, { key: block.key, id: block.id, baseColor: block.baseColor, enabled: true });
  }
  assert.ok(selected.size >= 20, 'test palette contains too few base colors');
  return [...selected.values()];
}

export function fixtureImage(width = 24, height = 20) {
  const bytes = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const offset = (y * width + x) * 4;
    bytes[offset] = (x * 41 + y * 7) & 255;
    bytes[offset + 1] = (x * 11 + y * 37) & 255;
    bytes[offset + 2] = (x * 23 + y * 17) & 255;
    bytes[offset + 3] = 255;
  }
  return { width, height, bytes };
}
