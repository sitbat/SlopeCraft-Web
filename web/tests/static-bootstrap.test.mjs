import test from 'node:test';
import assert from 'node:assert/strict';
import {bootstrap, prepareStaticIsolation} from '../static-bootstrap.js';
import {isolationEnvironment} from '../browser-environment.js';

const entryURL = 'https://example.test/maps/static-bootstrap.js';
const workerURL = 'https://example.test/maps/coi-serviceworker.js';

function fixture({isolated = false, claim = true, storageMap = new Map()} = {}) {
  const counts = {register: [], lookup: [], reload: 0, loadApp: 0, unregister: 0};
  const serviceWorker = new EventTarget();
  serviceWorker.getRegistration = async url => { counts.lookup.push(url); return undefined; };
  serviceWorker.register = async (url, options) => {
    counts.register.push({url, options});
    if (claim) {
      serviceWorker.controller = {scriptURL: url};
      serviceWorker.dispatchEvent(new Event('controllerchange'));
    }
    return {scope: options.scope, active: {scriptURL: url}, unregister() { counts.unregister++; }};
  };
  const classes = new Set(), title = {textContent: ''}, description = {textContent: ''};
  const banner = {
    classList: {toggle(name, enabled) { enabled ? classes.add(name) : classes.delete(name); }},
    querySelector(selector) { return selector === 'strong' ? title : selector === 'p' ? description : null; },
  };
  const scope = {
    isSecureContext: true, crossOriginIsolated: isolated,
    SharedArrayBuffer: isolated ? SharedArrayBuffer : undefined,
    WebAssembly, Worker: class {}, navigator: {serviceWorker},
    document: {getElementById: id => id === 'runtime-alert' ? banner : null},
    sessionStorage: {
      getItem: key => storageMap.get(key) ?? null,
      setItem: (key, value) => storageMap.set(key, value),
      removeItem: key => storageMap.delete(key),
    },
    location: {
      protocol: 'https:', origin: 'https://example.test', pathname: '/maps/index.html',
      search: '?private=do-not-store', hash: '#do-not-store',
      reload(...args) { assert.equal(args.length, 0); counts.reload++; },
    },
  };
  scope.top = scope.self = scope;
  return {
    scope, counts, serviceWorker, storageMap, title, description, classes,
    options: {scope, moduleURL: entryURL, timeoutMs: 50, loadApp: async () => { counts.loadApp++; }},
  };
}

test('server-isolated pages start the app without registering a worker or reloading', async () => {
  const f = fixture({isolated: true});
  f.scope.navigator = {};
  f.storageMap.set('unrelated-project', 'keep');
  const status = await bootstrap(f.options);
  assert.equal(status.ready, true);
  assert.equal(f.counts.loadApp, 1);
  assert.equal(f.counts.reload, 0);
  assert.equal(f.counts.register.length, 0);
  assert.equal(f.storageMap.get('unrelated-project'), 'keep');
  assert.equal(f.scope.__SC_BOOTSTRAP__, status);
  assert.equal(f.classes.has('error'), false);
});

test('first headerless visit registers only its directory and reloads before importing the app', async () => {
  const f = fixture();
  const first = await bootstrap({...f.options, moduleURL: entryURL + '?private=value#secret'});
  assert.equal(first.code, 'RELOADING');
  assert.equal(first.reloading, true);
  assert.equal(f.counts.reload, 1);
  assert.equal(f.counts.loadApp, 0);
  assert.deepEqual(f.counts.register, [{url: workerURL, options: {scope: 'https://example.test/maps/', updateViaCache: 'none'}}]);
  assert.equal(f.storageMap.size, 1);
  assert.ok([...f.storageMap.keys()].every(key => !key.includes('?') && !key.includes('#') && !key.includes('private')));
  assert.equal(f.classes.has('error'), false);

  // This represents the controlled document after navigation, where the worker
  // response headers actually made shared memory available.
  f.scope.crossOriginIsolated = true;
  f.scope.SharedArrayBuffer = SharedArrayBuffer;
  const second = await bootstrap(f.options);
  assert.equal(second.ready, true);
  assert.equal(f.counts.loadApp, 1);
  assert.equal(f.counts.reload, 1);
  assert.equal(f.storageMap.size, 0);
});

test('an ineffective controlled reload produces a visible diagnostic and cannot loop', async () => {
  const f = fixture();
  await bootstrap(f.options);
  const retry = await bootstrap(f.options);
  assert.equal(retry.code, 'ISOLATION_RELOAD_FAILED');
  assert.equal(f.counts.reload, 1);
  assert.equal(f.counts.register.length, 1);
  assert.equal(f.counts.loadApp, 0);
  assert.equal(f.classes.has('error'), true);
  assert.match(f.description.textContent, /ISOLATION_RELOAD_FAILED/);
  assert.equal(f.scope.__SC_BOOTSTRAP__, retry);
});

test('parallel bootstrap callers cannot cause two automatic navigations', async () => {
  const f = fixture({claim: false});
  const one = prepareStaticIsolation(f.options);
  const two = prepareStaticIsolation(f.options);
  await new Promise(resolve => setTimeout(resolve, 1));
  f.serviceWorker.controller = {scriptURL: workerURL};
  f.serviceWorker.dispatchEvent(new Event('controllerchange'));
  const results = await Promise.all([one, two]);
  assert.ok(results.every(result => result.reloading));
  assert.equal(f.counts.reload, 1);
});

test('foreign controllers and active, installing or waiting registrations are never replaced', async () => {
  for (const state of ['controller', 'active', 'waiting', 'installing']) {
    const f = fixture();
    const foreign = {scriptURL: 'https://example.test/maps/existing-app-sw.js', unregister() { f.counts.unregister++; }};
    if (state === 'controller') f.serviceWorker.controller = foreign;
    else f.serviceWorker.getRegistration = async () => ({[state]: foreign});
    const result = await bootstrap(f.options);
    assert.equal(result.code, 'SERVICE_WORKER_CONFLICT');
    assert.equal(f.counts.register.length, 0);
    assert.equal(f.counts.unregister, 0);
    assert.equal(f.counts.reload, 0);
    assert.equal(f.counts.loadApp, 0);
  }
});

test('a foreign takeover during registration is rejected instead of reloading into it', async () => {
  const f = fixture({claim: false});
  const pending = prepareStaticIsolation(f.options);
  await new Promise(resolve => setTimeout(resolve, 1));
  f.serviceWorker.controller = {scriptURL: 'https://example.test/other-worker.js'};
  f.serviceWorker.dispatchEvent(new Event('controllerchange'));
  assert.equal((await pending).code, 'SERVICE_WORKER_CONFLICT');
  assert.equal(f.counts.reload, 0);
});

test('denied, silent and late-failing session storage never trigger an unbounded reload', async () => {
  for (const mode of ['denied', 'silent', 'late-denied', 'late-silent']) {
    const f = fixture();
    let writes = 0;
    f.scope.sessionStorage.setItem = (key, value) => {
      writes++;
      if (mode === 'denied' || mode === 'late-denied' && writes > 1) throw new Error('Storage blocked');
      if (mode === 'silent' || mode === 'late-silent' && writes > 1) return;
      f.storageMap.set(key, value);
    };
    const status = await bootstrap(f.options);
    assert.equal(status.code, 'SESSION_STORAGE_UNAVAILABLE', mode);
    assert.equal(f.counts.reload, 0, mode);
    assert.equal(f.counts.loadApp, 0, mode);
    if (!mode.startsWith('late-')) assert.equal(f.counts.register.length, 0, mode);
  }
});

test('lookup, registration and controller waits all time out without starting the app', async () => {
  for (const stage of ['lookup', 'register', 'controller']) {
    const f = fixture({claim: false});
    if (stage === 'lookup') f.serviceWorker.getRegistration = () => new Promise(() => {});
    if (stage === 'register') f.serviceWorker.register = () => new Promise(() => {});
    const status = await bootstrap({...f.options, timeoutMs: 5});
    assert.equal(status.code, 'SERVICE_WORKER_TIMEOUT', stage);
    assert.equal(f.counts.reload, 0);
    assert.equal(f.counts.loadApp, 0);
    assert.equal(f.storageMap.size, 0);
  }
});

test('registration/CSP failures and application import failures have explicit error states', async () => {
  const denied = fixture();
  denied.serviceWorker.register = async () => { throw new DOMException('Blocked by CSP', 'SecurityError'); };
  assert.equal((await bootstrap(denied.options)).code, 'SERVICE_WORKER_FAILED');
  assert.equal(denied.counts.reload, 0);
  assert.equal(denied.counts.loadApp, 0);

  const missingApp = fixture({isolated: true});
  const status = await bootstrap({...missingApp.options, loadApp: async () => { throw new Error('404 module'); }});
  assert.equal(status.code, 'APP_LOAD_FAILED');
  assert.equal(missingApp.scope.__SC_BOOTSTRAP__, status);
  assert.equal(missingApp.classes.has('error'), true);
});

test('unsupported schemes, embedding, unavailable APIs and wrong directories stop before registration', async () => {
  const cases = [
    ['FILE_PROTOCOL', f => { f.scope.location.protocol = 'file:'; }],
    ['INSECURE_CONTEXT', f => { f.scope.isSecureContext = false; }],
    ['WEBASSEMBLY_UNAVAILABLE', f => { f.scope.WebAssembly = {}; }],
    ['WORKERS_UNAVAILABLE', f => { f.scope.Worker = undefined; }],
    ['ISOLATION_POLICY_DENIED', f => { f.scope.document.permissionsPolicy = {allowsFeature: () => false}; }],
    ['EMBEDDED_PAGE', f => { f.scope.top = {}; }],
    ['SERVICE_WORKER_UNAVAILABLE', f => { f.scope.navigator = {}; }],
    ['BOOTSTRAP_SCOPE_INVALID', f => { f.scope.location.pathname = '/maps-sibling/index.html'; }],
  ];
  for (const [code, change] of cases) {
    const f = fixture(); change(f);
    assert.equal((await bootstrap(f.options)).code, code);
    assert.equal(f.counts.register.length, 0, code);
    assert.equal(f.counts.reload, 0, code);
    assert.equal(f.counts.loadApp, 0, code);
  }
  const remote = fixture();
  assert.equal((await prepareStaticIsolation({...remote.options, moduleURL: 'https://cdn.example/maps/static-bootstrap.js'})).code, 'BOOTSTRAP_SCOPE_INVALID');
});

test('HTTPS-free localhost can bootstrap when the browser identifies it as secure', async () => {
  const f = fixture();
  Object.assign(f.scope.location, {protocol: 'http:', origin: 'http://localhost:4177', pathname: '/maps/index.html'});
  const status = await prepareStaticIsolation({...f.options, moduleURL: 'http://localhost:4177/maps/static-bootstrap.js'});
  assert.equal(status.code, 'RELOADING');
  assert.equal(f.counts.register[0].options.scope, 'http://localhost:4177/maps/');
});

test('environment inspection distinguishes hidden shared memory from explicit policy denial', () => {
  const f = fixture();
  assert.equal(isolationEnvironment(f.scope).code, 'NOT_CROSS_ORIGIN_ISOLATED');
  f.scope.crossOriginIsolated = true;
  assert.equal(isolationEnvironment(f.scope).code, 'SHARED_MEMORY_UNAVAILABLE');
  f.scope.SharedArrayBuffer = SharedArrayBuffer;
  assert.equal(isolationEnvironment(f.scope).ready, true);
  f.scope.crossOriginIsolated = false;
  f.scope.document.permissionsPolicy = {features: () => ['some-other-feature'], allowsFeature: () => false};
  assert.equal(isolationEnvironment(f.scope).code, 'NOT_CROSS_ORIGIN_ISOLATED', 'an unrecognized Permissions-Policy feature must not be treated as an explicit denial');
});
