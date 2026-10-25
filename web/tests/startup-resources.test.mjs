import test from 'node:test';
import assert from 'node:assert/strict';
import {createStartupResources} from '../startup-resources.js';
import {EngineClient} from '../engine.js';

const baseURL = 'https://example.test/maps/engine-worker.js';
const groups = ['FixedBlocks', 'CustomBlocks', 'QuarkModBlocks'];
const makeCatalog = () => ({groups: groups.map((name, i) => ({name, blocks: [
  {id: `block:${i}`, baseColor: i + 1, nameZH: `原名${i}`, iconUrl: `./icon${i}.png`},
]})), blocks: [], baseColors: [[0, 0, 0]]});
function gate() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
}
const flush = () => new Promise(resolve => setImmediate(resolve));
function core(name) {
  const result = {name, stopped: 0};
  result.PThread = {terminateAllThreads() { result.stopped++; }};
  return result;
}
function nativeLog(calls) {
  return (engine, op, payload, bytes) => {
    calls.push({engine, op, payload, bytes});
    if (op === 'init') return {threads: payload.threads};
    if (op === 'metadata') return {version: 'actual-test-core'};
    const i = groups.indexOf(payload.name);
    return {blocks: [{id: `block:${i}`, baseColor: i + 1, key: `key-${i}`, nameEN: `English${i}`}]};
  };
}

test('catalog reaches the UI while core is gated, and every ZIP starts before any ZIP finishes', async () => {
  const moduleGate = gate(), catalogGate = gate(), zipGates = groups.map(gate);
  const calls = [], fetched = [], engine = core('first');
  let coreStarts = 0;
  const startup = createStartupResources({baseURL, requestNative: nativeLog(calls),
    createCore: () => { coreStarts++; return moduleGate.promise; },
    fetchResource: (url, json) => {
      fetched.push(url.pathname);
      if (json) return catalogGate.promise;
      return zipGates[groups.findIndex(name => url.pathname.endsWith(`${name}.zip`))].promise;
    },
  });
  const preparation = startup.prepare();
  assert.equal(coreStarts, 1);
  assert.deepEqual(fetched, ['/maps/assets/blocklists.json']);
  const catalog = makeCatalog();
  catalogGate.resolve(catalog);
  assert.equal((await preparation).catalog, catalog);
  assert.deepEqual(fetched.slice(1), groups.map(name => `/maps/assets/blocklists/${name}.zip`));
  assert.equal(calls.length, 0, 'resource preparation must not apply default native settings');
  const options = {threads: 3, memoryBudgetMB: 512, cacheEnabled: false};
  const initialized = startup.initialize(options);
  zipGates[2].resolve(new Uint8Array([3]).buffer);
  zipGates[0].resolve(new Uint8Array([1]).buffer);
  moduleGate.resolve(engine);
  await flush();
  assert.equal(calls.length, 0, 'a missing middle ZIP must not partially register the catalog');
  zipGates[1].resolve(new Uint8Array([2]).buffer);
  const result = await initialized;
  assert.deepEqual(calls.map(call => call.op), ['init', 'loadBlocklist', 'loadBlocklist', 'loadBlocklist', 'metadata']);
  assert.deepEqual(calls.slice(1, 4).map(call => call.payload.name), groups);
  assert.deepEqual(calls.slice(1, 4).map(call => [...new Uint8Array(call.bytes)]), [[1], [2], [3]]);
  assert.equal(calls[0].payload, options);
  assert.deepEqual(Object.keys(options), ['threads', 'memoryBudgetMB', 'cacheEnabled']);
  assert.equal(result.init.threads, 3);
  assert.equal(result.catalog.blocks[0].nameZH, '原名0');
  assert.equal(result.catalog.blocks[0].iconUrl, './icon0.png');
  assert.equal(catalog.blocks.length, 0, 'the UI catalog must not be mutated by native registration');
  assert.equal(result.core, engine);
  assert.equal(engine.stopped, 0);
  assert.ok(result.startupTimings.workerTotalMs >= 0);
  startup.dispose();
});

test('native registration stays serial, repeated prepare/init share one resource session', async () => {
  let catalogFetches = 0, coreStarts = 0, active = 0, maximum = 0;
  const order = [], nativeGates = groups.map(gate), engine = core('serial');
  const startup = createStartupResources({baseURL,
    createCore: async () => { coreStarts++; return engine; },
    fetchResource: async (url, json) => { if (json) {catalogFetches++; return makeCatalog();} return new ArrayBuffer(1); },
    requestNative: async (_core, op, payload) => {
      order.push(op === 'loadBlocklist' ? payload.name : op);
      if (op === 'loadBlocklist') {
        maximum = Math.max(maximum, ++active);
        await nativeGates[groups.indexOf(payload.name)].promise;
        active--;
      }
      return {};
    },
  });
  await Promise.all([startup.prepare(), startup.prepare()]);
  const first = startup.initialize({threads: 4}), second = startup.initialize({threads: 4});
  assert.equal(first, second, 'parallel init callers must not duplicate native side effects');
  await flush();
  assert.deepEqual(order, ['init', groups[0]]);
  for (let i = 0; i < groups.length; i++) {
    nativeGates[i].resolve();
    await flush();
    assert.deepEqual(order.slice(1, i + 2), groups.slice(0, i + 1));
  }
  await Promise.all([first, second]);
  assert.deepEqual(order, ['init', ...groups, 'metadata']);
  assert.equal(maximum, 1);
  assert.equal(coreStarts, 1);
  assert.equal(catalogFetches, 1);
  startup.dispose();
});

test('failed background ZIP download cleans a late core and permits a completely fresh retry', async () => {
  const late = gate(), badZip = gate(), old = core('old'), fresh = core('fresh'), calls = [];
  let attempt = 0;
  const startup = createStartupResources({baseURL, requestNative: nativeLog(calls),
    createCore: () => ++attempt === 1 ? late.promise : fresh,
    fetchResource: async (url, json) => json ? makeCatalog() :
      (attempt === 1 && url.pathname.endsWith('CustomBlocks.zip') ? badZip.promise : new ArrayBuffer(1)),
  });
  await startup.prepare();
  badZip.reject(new Error('ZIP download failed'));
  // A UI may still be processing its preset when background work fails.
  await flush();
  await assert.rejects(startup.initialize({threads: 2}), /ZIP download failed/);
  late.resolve(old);
  await flush();
  assert.equal(old.stopped, 1);
  assert.equal(calls.length, 0);
  const result = await startup.initialize({threads: 5});
  assert.equal(result.core, fresh);
  assert.ok(calls.every(call => call.engine === fresh));
  assert.equal(result.init.threads, 5);
  startup.dispose();
  assert.equal(old.stopped, 1, 'cleanup is idempotent');
  assert.equal(fresh.stopped, 1);
});

test('a native block-library failure never publishes the partial core and retry registers everything again', async () => {
  let attempt = 0;
  const engines = [], calls = [];
  const startup = createStartupResources({baseURL,
    createCore: async () => { const engine = core(`core-${++attempt}`); engines.push(engine); return engine; },
    fetchResource: async (_url, json) => json ? makeCatalog() : new ArrayBuffer(1),
    requestNative: (engine, op, payload) => {
      calls.push(`${engine.name}:${op === 'loadBlocklist' ? payload.name : op}`);
      if (attempt === 1 && payload?.name === 'CustomBlocks') throw new Error('Invalid block PNG');
      return {};
    },
  });
  await assert.rejects(startup.initialize({threads: 2}), /Invalid block PNG/);
  assert.equal(engines[0].stopped, 1);
  const result = await startup.initialize({threads: 6});
  assert.equal(result.core, engines[1]);
  assert.deepEqual(calls.filter(call => call.startsWith('core-2:')), ['init', ...groups, 'metadata'].map(op => `core-2:${op}`));
  assert.ok(!calls.includes('core-1:metadata'));
  startup.dispose();
});

test('catalog and module failures are observed before delayed init and can be retried', async () => {
  for (const failure of ['catalog', 'module']) {
    let attempt = 0;
    const engines = [], calls = [];
    const startup = createStartupResources({baseURL, requestNative: nativeLog(calls),
      createCore: () => {
        attempt++;
        if (failure === 'module' && attempt === 1) return Promise.reject(new Error('module unavailable'));
        const engine = core(`attempt${attempt}`); engines.push(engine); return engine;
      },
      fetchResource: async (_url, json) => {
        if (json && failure === 'catalog' && attempt === 1) throw new Error('catalog unavailable');
        return json ? makeCatalog() : new ArrayBuffer(1);
      },
    });
    if (failure === 'catalog') await assert.rejects(startup.prepare(), /catalog unavailable/);
    else {
      await startup.prepare(); await flush();
      await assert.rejects(startup.initialize({threads: 2}), /module unavailable/);
    }
    assert.equal(calls.length, 0);
    const result = await startup.initialize({threads: 2});
    assert.equal(result.core.name, 'attempt2');
    startup.dispose();
    assert.ok(engines.every(engine => engine.stopped === 1));
  }
});

test('disposing a pending preparation cannot poison a newly started session', async () => {
  const late = gate(), old = core('disposed'), fresh = core('new');
  let count = 0;
  const startup = createStartupResources({baseURL, requestNative: nativeLog([]),
    createCore: () => ++count === 1 ? late.promise : fresh,
    fetchResource: async (_url, json) => json ? makeCatalog() : new ArrayBuffer(1),
  });
  await startup.prepare();
  startup.dispose();
  const result = await startup.initialize({threads: 2});
  late.resolve(old); await flush();
  assert.equal(result.core, fresh);
  assert.equal(fresh.stopped, 0);
  assert.equal(old.stopped, 1);
  startup.dispose();
});

test('a disposed asynchronous native registration cannot continue into another library', async () => {
  const pendingInit = gate(), engine = core('cancel-native'), calls = [];
  const startup = createStartupResources({baseURL,
    createCore: async () => engine,
    fetchResource: async (_url, json) => json ? makeCatalog() : new ArrayBuffer(1),
    requestNative: (_core, op) => { calls.push(op); return pendingInit.promise; },
  });
  const initializing = startup.initialize({threads: 2});
  await flush();
  assert.deepEqual(calls, ['init']);
  startup.dispose();
  pendingInit.resolve({});
  await assert.rejects(initializing, /启动已取消/);
  assert.deepEqual(calls, ['init']);
  assert.equal(engine.stopped, 1);
});

test('EngineClient reuses its prepared worker and keeps a replacement alive after stale failures', async () => {
  const original = Object.getOwnPropertyDescriptors(globalThis);
  const workers = [];
  class FakeWorker extends EventTarget {
    constructor() { super(); this.sent = []; this.terminated = false; workers.push(this); }
    postMessage(message) { this.sent.push(message); }
    terminate() { this.terminated = true; }
    respond(message, data) { this.dispatchEvent(new MessageEvent('message', {data: {sequence: message.sequence, ok: true, data}})); }
  }
  const set = (name, value) => Object.defineProperty(globalThis, name, {configurable: true, writable: true, value});
  set('isSecureContext', true); set('crossOriginIsolated', true); set('Worker', FakeWorker);
  set('location', {protocol: 'https:'}); set('navigator', {hardwareConcurrency: 12});
  try {
    const client = new EngineClient();
    const prepared = client.prepare();
    const first = workers[0];
    first.respond(first.sent[0], {catalog: makeCatalog()});
    await prepared;
    const init = client.init({threads: 3, cacheEnabled: false});
    assert.equal(workers.length, 1);
    assert.deepEqual(first.sent.map(message => message.type), ['prepare', 'init']);
    assert.equal(first.sent[1].payload.threads, 3);
    assert.equal('catalog' in first.sent[1].payload, false);
    first.respond(first.sent[1], {threads: 3});
    assert.equal((await init).threads, 3);
    client.dispose();

    const cancelled = client.prepare();
    const cancelledResult = assert.rejects(cancelled, /计算引擎已关闭/);
    const stale = workers[1];
    client.dispose();
    const retry = client.init({threads: 7});
    const replacement = workers[2];
    stale.dispatchEvent(new Event('error'));
    await cancelledResult;
    assert.equal(replacement.terminated, false, 'stale promise/error callbacks must not terminate a replacement worker');
    replacement.respond(replacement.sent[0], {threads: 7});
    assert.equal((await retry).threads, 7);
    client.dispose();
  } finally {
    for (const name of ['isSecureContext', 'crossOriginIsolated', 'Worker', 'location', 'navigator']) {
      if (original[name]) Object.defineProperty(globalThis, name, original[name]);
      else delete globalThis[name];
    }
  }
});
