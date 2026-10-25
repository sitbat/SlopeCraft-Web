// Reproducible local Node benchmark of the actual compiled pthread C++ core.
// Run from web/: node tests/benchmark.mjs [--dither] [--threads=4] [--runs=1]
// Node measurements are never presented as browser measurements.
import { performance } from 'node:perf_hooks';
import { cpus, platform, arch, release } from 'node:os';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { loadEngine, selectBlocks } from './engine-client.mjs';

const flags = new Set(process.argv.slice(2));
const argument = (name, fallback) => {
  const value = [...flags].find(flag => flag.startsWith(`--${name}=`));
  return value ? Number(value.split('=')[1]) : fallback;
};
const threads = argument('threads', 4);
const runs = argument('runs', 1);
assert.ok(Number.isInteger(threads) && threads >= 2 && threads <= 8, 'threads must be 2 through 8');
assert.ok(Number.isInteger(runs) && runs >= 1 && runs <= 10, 'runs must be 1 through 10');
const dither = flags.has('--dither');
const seed = 0x51c0ffee;
const output = fileURLToPath(new URL('../test-results/benchmark-node.json', import.meta.url));
const rounded = number => Number(number.toFixed(3));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const report = {
  schemaVersion: 1, status: 'running', startedAtUTC: new Date().toISOString(),
  environment: { runtime: 'Node.js', version: process.version, platform: platform(), arch: arch(), release: release(), cpu: cpus()[0]?.model, logicalCpuCount: cpus().length },
  configuration: { threads, runs, algorithms: { R: 'RGB_Better', L: 'CIEDE2000' }, sizes: [256, 512, 1024], dither, mapType: 'slope', seed },
  measurementNotes: [
    'These are Node.js measurements on this host, not browser measurements.',
    'Conversion timing includes the synchronous C ABI call, response parsing and copied RGBA preview; image generation and block-library loading are excluded.',
    'The deterministic xorshift32 input contains opaque near-24-bit random RGB colors; unique-color counts are recorded to reveal color-cache reuse.',
    'wasmMemoryMB is allocated WebAssembly linear-memory capacity, not live allocation size or process RSS. Capacity can remain high after tasks are freed.',
    'Each case releases all native tasks. Export timing includes actual C++ encoding, MEMFS reading and output-byte copying, but excludes SHA-256 calculation.',
    'Default runs=1 gives individual observations, not statistically stable performance estimates.',
  ],
  conversions: [], terrain: [],
};
await mkdir(dirname(output), { recursive: true });
async function flush() { await writeFile(output, JSON.stringify(report, null, 2) + '\n'); }
function imageFixture(side) {
  const bytes = new Uint8Array(side * side * 4);
  const unique = new Set();
  let state = seed;
  for (let index = 0; index < side * side; index++) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    const rgb = state & 0xffffff;
    unique.add(rgb);
    bytes.set([rgb >>> 16, (rgb >>> 8) & 255, rgb & 255, 255], index * 4);
  }
  return { width: side, height: side, bytes, uniqueColors: unique.size, sha256: hash(bytes) };
}
let client;
try {
  client = await loadEngine();
  assert.ok(client.engine.HEAPU8.buffer instanceof SharedArrayBuffer, 'benchmark requires a real pthread artifact');
  const metadata = client.request('init', { threads, memoryBudgetMB: 1536 });
  const blocks = selectBlocks(await client.loadBlocks());
  const wasmPath = resolve(dirname(client.modulePath), 'slopecraft.wasm');
  report.artifact = { version: metadata.version, moduleFile: client.modulePath, moduleSha256: hash(await readFile(client.modulePath)), wasmSha256: hash(await readFile(wasmPath)), wasmBytes: (await readFile(wasmPath)).length };
  const memoryMB = () => rounded(client.engine.HEAPU8.buffer.byteLength / 1048576);
  const convert = (id, image, algorithm) => client.request('convert', {
    id, width: image.width, height: image.height,
    options: { version: 21, mapType: 0, algorithm, dither }, blocks,
  }, image.bytes);
  await flush();
  for (const side of [256, 512, 1024]) {
    const image = imageFixture(side);
    for (const algorithm of ['R', 'L']) for (let run = 1; run <= runs; run++) {
      client.request('clear');
      const beforeMB = memoryMB();
      const start = performance.now();
      const result = convert(`benchmark-${side}-${algorithm}-${run}`, image, algorithm);
      const elapsedMs = rounded(performance.now() - start);
      assert.equal(result.previewBytes.length, side * side * 4);
      const observation = {
        width: side, height: side, algorithm, dither, run,
        pixels: side * side, uniqueInputColors: image.uniqueColors, inputSha256: image.sha256,
        elapsedMs, megapixelsPerSecond: rounded((side * side / 1e6) / (elapsedMs / 1000)),
        workersProcessed: result.stats.workersProcessed,
        workerItems: result.stats.workerItems,
        wasmMemoryBeforeMB: beforeMB, wasmMemoryMB: memoryMB(),
        nodeRssMB: rounded(process.memoryUsage().rss / 1048576),
        previewSha256: hash(result.previewBytes),
      };
      client.request('clear');
      observation.wasmMemoryAfterClearMB = memoryMB();
      report.conversions.push(observation);
      await flush();
      console.error(JSON.stringify({ phase: 'convert', side, algorithm, run, elapsedMs, workersProcessed: observation.workersProcessed, wasmMemoryMB: observation.wasmMemoryMB }));
    }
  }
  for (let run = 1; run <= runs; run++) {
    client.request('clear');
    const image = imageFixture(512);
    const id = `benchmark-terrain-${run}`;
    const prepareStart = performance.now();
    convert(id, image, 'R');
    const prepareConversionMs = rounded(performance.now() - prepareStart);
    const options = { maxHeight: 256, compression: 1, glassBridge: 1, bridgeInterval: 3, supportBlock: 0, fireproof: false, enderproof: false, connectMushroom: false };
    const buildStart = performance.now();
    const built = client.request('build', { id, options });
    const buildMs = rounded(performance.now() - buildStart);
    const observation = { width: 512, height: 512, run, options, prepareConversionMs, buildMs, size: built.size, occupiedBlockCount: built.blockCount, wasmMemoryMB: memoryMB(), exports: [] };
    for (const format of ['dat', 'litematic', 'nbt', 'schem']) {
      const exportStart = performance.now();
      const files = client.exported(id, format, { beginIndex: 0, name: 'benchmark-512', regionName: 'benchmark' });
      const elapsedMs = rounded(performance.now() - exportStart);
      observation.exports.push({ format, elapsedMs, fileCount: files.length, bytes: files.reduce((sum, file) => sum + file.bytes.byteLength, 0), files: files.map(file => ({ name: file.name, bytes: file.bytes.byteLength, sha256: hash(file.bytes) })) });
      for (const file of files) client.engine.FS.unlink(file.path);
    }
    client.request('clear');
    observation.wasmMemoryAfterClearMB = memoryMB();
    report.terrain.push(observation);
    await flush();
    console.error(JSON.stringify({ phase: 'terrain', run, size: built.size, buildMs, exports: observation.exports.map(({ format, elapsedMs, bytes }) => ({ format, elapsedMs, bytes })) }));
  }
  report.status = 'complete';
  report.completedAtUTC = new Date().toISOString();
  await flush();
  console.log(JSON.stringify({ report: output, status: report.status, conversionCases: report.conversions.length, terrainCases: report.terrain.length }));
} catch (error) {
  report.status = 'failed';
  report.error = { name: error.name, message: error.message };
  await flush();
  throw error;
} finally {
  client?.engine.PThread?.terminateAllThreads?.();
}
