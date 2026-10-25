import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../coi-serviceworker.js', import.meta.url), 'utf8');

function fixture(network = async () => new Response('body'), registrationScope = 'https://example.test/maps/') {
  const handlers = new Map(), calls = {skipWaiting: 0, claim: 0, network: []};
  const self = {
    registration: {scope: registrationScope}, location: {href: 'https://example.test/maps/coi-serviceworker.js'},
    addEventListener: (type, handler) => handlers.set(type, handler),
    skipWaiting: async () => { calls.skipWaiting++; },
    clients: {claim: async () => { calls.claim++; }},
  };
  const disallowedStorage = new Proxy({}, {get() { throw new Error('Isolation worker must not use persistent storage'); }});
  vm.runInNewContext(source, {
    self, URL, Headers, Response, caches: disallowedStorage, indexedDB: disallowedStorage,
    fetch: async (...args) => { calls.network.push(args); return network(...args); },
  });
  return {
    calls, handlers,
    dispatch(request) {
      let promise;
      handlers.get('fetch')({request, respondWith(result) { promise = result; }});
      return promise;
    },
  };
}
function request(url = 'https://example.test/maps/index.html', changes = {}) {
  return {url, method: 'GET', mode: 'navigate', cache: 'default', headers: new Headers(), ...changes};
}

test('worker activation can control the next navigation without touching persistent storage', async () => {
  const f = fixture();
  const pending = [];
  f.handlers.get('install')({waitUntil: promise => pending.push(promise)});
  f.handlers.get('activate')({waitUntil: promise => pending.push(promise)});
  await Promise.all(pending);
  assert.equal(f.calls.skipWaiting, 1);
  assert.equal(f.calls.claim, 1);
  assert.equal(f.calls.network.length, 0);
});

test('HTML, worker and Wasm responses retain their bytes, MIME and cache headers while gaining isolation', async () => {
  for (const [filename, mime, mode] of [
    ['index.html', 'text/html; charset=utf-8', 'navigate'],
    ['engine-worker.js', 'application/javascript', 'same-origin'],
    ['wasm/slopecraft.wasm', 'application/wasm', 'same-origin'],
  ]) {
    const bytes = new Uint8Array([0, 1, 128, 255]);
    const f = fixture(async () => new Response(bytes, {headers: {
      'Content-Type': mime, 'Cache-Control': 'public, max-age=60', 'X-Original': 'preserved',
      'Cross-Origin-Opener-Policy': 'unsafe-none', 'Cross-Origin-Embedder-Policy': 'unsafe-none',
    }}));
    const input = request(`https://example.test/maps/${filename}`, {mode});
    const output = await f.dispatch(input);
    assert.deepEqual(new Uint8Array(await output.arrayBuffer()), bytes);
    assert.equal(output.headers.get('Content-Type'), mime);
    assert.equal(output.headers.get('Cache-Control'), 'public, max-age=60');
    assert.equal(output.headers.get('X-Original'), 'preserved');
    assert.equal(output.headers.get('Cross-Origin-Opener-Policy'), 'same-origin');
    assert.equal(output.headers.get('Cross-Origin-Embedder-Policy'), 'require-corp');
    assert.equal(output.headers.get('Cross-Origin-Resource-Policy'), 'same-origin');
    assert.equal(f.calls.network[0][0], input, 'network requests must retain their original URL/credentials/options');
    assert.equal(f.calls.network[0][1]?.cache, mode === 'navigate' ? 'no-store' : undefined);
  }
});

test('POST, HEAD, API, cross-origin, sibling, range and incompatible cache requests bypass the worker', () => {
  const f = fixture(() => { throw new Error('Bypassed request must not be fetched by the worker'); });
  const skipped = [
    request(undefined, {method: 'POST'}), request(undefined, {method: 'HEAD'}),
    request('https://example.test/maps/api'), request('https://example.test/maps/api/data'),
    request('https://remote.test/maps/index.html'), request('http://example.test/maps/index.html'),
    request('https://example.test:8443/maps/index.html'), request('https://example.test/maps-sibling/index.html'),
    request(undefined, {headers: new Headers({Range: 'bytes=0-9'})}),
    request(undefined, {cache: 'only-if-cached', mode: 'cors'}),
  ];
  for (const input of skipped) assert.equal(f.dispatch(input), undefined, input.url);
  assert.equal(f.calls.network.length, 0);
});

test('redirects, opaque responses, partial content and not-modified responses keep their original identity', async () => {
  const responses = [
    {status: 0, type: 'opaque'}, {status: 0, type: 'opaqueredirect'},
    new Response('partial', {status: 206}), new Response(null, {status: 304}),
    ...[301, 302, 303, 307, 308].map(status => new Response(null, {status, headers: {Location: '/elsewhere/'}})),
  ];
  const followed = new Response('redirected body');
  Object.defineProperties(followed, {
    redirected: {value: true}, url: {value: 'https://example.test/maps/other-module.js'},
  });
  responses.push(followed);
  for (const original of responses) {
    const f = fixture(async () => original);
    assert.equal(await f.dispatch(request()), original);
  }
});

test('a response ultimately outside the application is not rewrapped with application policy', async () => {
  for (const finalURL of ['https://remote.test/maps/file.js', 'https://example.test/other-app/file.js']) {
    const original = new Response('outside');
    Object.defineProperty(original, 'url', {value: finalURL});
    const f = fixture(async () => original);
    assert.equal(await f.dispatch(request()), original);
  }
});

test('registration scope and script directory jointly bound interception', async () => {
  const broad = fixture(undefined, 'https://example.test/');
  assert.equal(broad.dispatch(request('https://example.test/other-app/index.html')), undefined);
  assert.equal(broad.dispatch(request('https://example.test/maps/api/data')), undefined);
  assert.equal((await broad.dispatch(request())).headers.get('Cross-Origin-Embedder-Policy'), 'require-corp');

  const narrow = fixture(undefined, 'https://example.test/maps/subdirectory/');
  assert.equal(narrow.dispatch(request()), undefined);
  assert.equal((await narrow.dispatch(request('https://example.test/maps/subdirectory/index.html'))).headers.get('Cross-Origin-Opener-Policy'), 'same-origin');
  assert.equal(narrow.dispatch(request('https://example.test/maps/subdirectory/api/data')), undefined);
});

test('existing restrictive Permissions Policy and resource policy are preserved', async () => {
  const f = fixture(async () => new Response('body', {headers: {
    'Permissions-Policy': 'cross-origin-isolated=()', 'Cross-Origin-Resource-Policy': 'same-site',
  }}));
  const result = await f.dispatch(request());
  assert.equal(result.headers.get('Permissions-Policy'), 'cross-origin-isolated=()');
  assert.equal(result.headers.get('Cross-Origin-Resource-Policy'), 'same-site');
});

test('network errors propagate without substituting cached pages or project contents', async () => {
  const f = fixture(async () => { throw new Error('Network unavailable'); });
  await assert.rejects(f.dispatch(request()), /Network unavailable/);
  assert.equal(f.calls.network.length, 1);
});
