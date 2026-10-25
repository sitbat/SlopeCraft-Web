/** Static-site isolation bootstrap for SlopeCraft. GPL-3.0-or-later. */
import {isolationEnvironment} from './browser-environment.js';

const ATTEMPT_VERSION = '1';
const DEFAULT_TIMEOUT_MS = 15000;
const failed = (code, message) => ({ready: false, code, message});

class IsolationError extends Error {
  constructor(code) { super(code); this.code = code; }
}

function isOurWorker(worker, expectedURL) {
  if (!worker?.scriptURL) return false;
  try { return new URL(worker.scriptURL).href === expectedURL.href; }
  catch { return false; }
}

function timeLimit(promise, milliseconds) {
  if (milliseconds <= 0) return Promise.reject(new IsolationError('SERVICE_WORKER_TIMEOUT'));
  let timer;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new IsolationError('SERVICE_WORKER_TIMEOUT')), milliseconds);
    }),
  ]).finally(() => clearTimeout(timer));
}

function awaitController(serviceWorker, expectedURL, milliseconds) {
  if (milliseconds <= 0) return Promise.reject(new IsolationError('SERVICE_WORKER_TIMEOUT'));
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      serviceWorker.removeEventListener('controllerchange', check);
      error ? reject(error) : resolve();
    };
    const check = () => {
      if (!serviceWorker.controller) return;
      finish(isOurWorker(serviceWorker.controller, expectedURL)
        ? null : new IsolationError('SERVICE_WORKER_CONFLICT'));
    };
    const timer = setTimeout(() => finish(new IsolationError('SERVICE_WORKER_TIMEOUT')), milliseconds);
    serviceWorker.addEventListener('controllerchange', check);
    check();
  });
}

/** Obtain one controlled navigation; never downgrade or replace another worker. */
export async function prepareStaticIsolation({
  scope = globalThis,
  moduleURL = import.meta.url,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  onStatus = () => {},
} = {}) {
  const initial = isolationEnvironment(scope);
  let directory, workerURL;
  try {
    directory = new URL('./', moduleURL);
    workerURL = new URL('coi-serviceworker.js', directory);
  } catch {
    return failed('BOOTSTRAP_SCOPE_INVALID', '静态引导脚本的地址无效，请保留完整网页目录。');
  }
  // sessionStorage is per origin; store only the application directory, never
  // the user's query string, fragment, image data or settings.
  const attemptKey = `slopecraft-isolation:${ATTEMPT_VERSION}:${directory.pathname}`;
  if (initial.ready) {
    try { scope.sessionStorage?.removeItem(attemptKey); } catch {}
    return initial;
  }
  if (initial.code !== 'NOT_CROSS_ORIGIN_ISOLATED') return initial;
  try {
    if (scope.top && scope.self && scope.top !== scope.self) {
      return failed('EMBEDDED_PAGE', '请在独立标签页打开这个 HTTPS 网页；嵌入框架中的页面不能独立启用多线程隔离。');
    }
  } catch {
    return failed('EMBEDDED_PAGE', '请在独立标签页打开网页，以准备多线程运行环境。');
  }
  if (directory.origin !== scope.location?.origin ||
      !scope.location?.pathname?.startsWith(directory.pathname)) {
    return failed('BOOTSTRAP_SCOPE_INVALID', '引导脚本、Service Worker 和页面必须位于同源的应用目录内，请保留部署目录结构。');
  }
  const workers = scope.navigator?.serviceWorker;
  if (typeof workers?.register !== 'function' || typeof workers.getRegistration !== 'function') {
    return failed('SERVICE_WORKER_UNAVAILABLE', '浏览器未提供 Service Worker，无法自动补充静态站点的隔离响应头。请检查浏览器和站点权限。');
  }
  let storage;
  try {
    storage = scope.sessionStorage;
    if (!storage) throw new Error('Storage unavailable');
    if (storage.getItem(attemptKey) === ATTEMPT_VERSION) {
      return failed('ISOLATION_RELOAD_FAILED', '本标签页已自动重载一次，但隔离仍未生效。已停止自动刷新，请检查站点权限、响应头和 Permissions-Policy 后手动重试。');
    }
    storage.setItem(attemptKey, 'checking');
    if (storage.getItem(attemptKey) !== 'checking') throw new Error('Storage write denied');
    storage.removeItem(attemptKey);
  } catch {
    return failed('SESSION_STORAGE_UNAVAILABLE', '浏览器禁止此站点使用会话存储，无法安全限制自动重载次数。请允许站点存储后重试。');
  }
  const conflict = () => failed('SERVICE_WORKER_CONFLICT', '此应用目录已有其他 Service Worker。为保留现有站点的数据与行为，本引导不会替换或注销它，请使用独立目录部署。');
  if (workers.controller && !isOurWorker(workers.controller, workerURL)) return conflict();
  const deadline = Date.now() + Math.max(1, Number(timeoutMs) || DEFAULT_TIMEOUT_MS);
  const remaining = () => deadline - Date.now();
  onStatus('正在为静态站点准备跨源隔离…');
  try {
    const registration = await timeLimit(workers.getRegistration(directory.href), remaining());
    const registeredWorkers = [registration?.active, registration?.waiting, registration?.installing].filter(Boolean);
    if (registeredWorkers.some(worker => !isOurWorker(worker, workerURL))) return conflict();
    if (workers.controller && !isOurWorker(workers.controller, workerURL)) return conflict();
    await timeLimit(workers.register(workerURL.href, {
      scope: directory.href,
      updateViaCache: 'none',
    }), remaining());
    await awaitController(workers, workerURL, remaining());
    // Store and verify before navigating. If the next document still cannot
    // use shared memory, it reports an error instead of refreshing indefinitely.
    try {
      // A second caller may have completed while we awaited the controller.
      // The first caller owns the navigation; do not issue another reload.
      if (storage.getItem(attemptKey) === ATTEMPT_VERSION) {
        return {ready: false, reloading: true, code: 'RELOADING', message: '本页面正在重载以启用多线程引擎。'};
      }
      storage.setItem(attemptKey, ATTEMPT_VERSION);
      if (storage.getItem(attemptKey) !== ATTEMPT_VERSION) throw new Error('Storage write denied');
    } catch {
      throw new IsolationError('SESSION_STORAGE_UNAVAILABLE');
    }
    onStatus('隔离引导已接管页面，正在自动重载一次…');
    scope.location.reload();
    return {ready: false, reloading: true, code: 'RELOADING', message: '正在重载页面以启用多线程引擎。'};
  } catch (error) {
    if (error.code === 'SERVICE_WORKER_CONFLICT') return conflict();
    if (error.code === 'SERVICE_WORKER_TIMEOUT') {
      return failed(error.code, '隔离引导在限定时间内未能接管页面，未自动刷新。请检查静态脚本、站点权限和网络后手动重试。');
    }
    if (error.code === 'SESSION_STORAGE_UNAVAILABLE') {
      return failed(error.code, '无法记录重载状态，已停止自动刷新。请允许此站点使用会话存储。');
    }
    return failed('SERVICE_WORKER_FAILED', 'Service Worker 启动失败。请确认 coi-serviceworker.js 位于应用目录、以 JavaScript 类型提供，并且站点允许使用 Service Worker。');
  }
}

function showStatus(scope, status) {
  scope.__SC_BOOTSTRAP__ = status;
  const banner = scope.document?.getElementById?.('runtime-alert');
  if (!banner) return;
  const error = !status.ready && !status.pending && !status.reloading;
  banner.classList.toggle('error', error);
  const title = banner.querySelector('strong');
  const description = banner.querySelector('p');
  if (title) title.textContent = error ? '多线程引擎暂不可用' : '正在初始化多线程转换引擎';
  if (description) description.textContent = status.message + (error ? `（诊断：${status.code}）` : '');
}

export async function bootstrap({
  scope = globalThis,
  moduleURL = import.meta.url,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  loadApp = () => import('./app.js'),
} = {}) {
  const result = await prepareStaticIsolation({
    scope, moduleURL, timeoutMs,
    onStatus: message => showStatus(scope, {ready: false, pending: true, code: 'PREPARING', message}),
  });
  showStatus(scope, result);
  if (!result.ready) return result;
  try {
    await loadApp();
    return result;
  } catch {
    const error = failed('APP_LOAD_FAILED', '应用脚本加载失败，请检查静态文件完整性、JavaScript MIME 类型与内容安全策略。');
    showStatus(scope, error);
    return error;
  }
}

if (typeof window !== 'undefined' && globalThis.document) void bootstrap();
