/** Browser requirements for SlopeCraft's pthread engine. GPL-3.0-or-later. */
export function isolationEnvironment(scope = globalThis) {
  const problem = (code, message) => ({ready: false, code, message});
  if (scope.location?.protocol === 'file:') {
    return problem('FILE_PROTOCOL', '请通过 HTTPS 网站或 localhost 打开完整网页目录，不能直接双击 HTML 文件运行多线程引擎。');
  }
  if (!scope.isSecureContext) {
    return problem('INSECURE_CONTEXT', '多线程引擎需要安全上下文。请使用 HTTPS；本机开发可使用 localhost 或回环地址。');
  }
  if (typeof scope.WebAssembly?.compile !== 'function') {
    return problem('WEBASSEMBLY_UNAVAILABLE', '当前浏览器未提供 WebAssembly，无法启动多线程转换引擎。');
  }
  if (typeof scope.Worker !== 'function') {
    return problem('WORKERS_UNAVAILABLE', '当前浏览器未提供 Web Worker，无法启动多线程转换引擎。');
  }
  if (!scope.crossOriginIsolated) {
    let denied = false;
    try {
      const policy = scope.document?.permissionsPolicy ?? scope.document?.featurePolicy;
      const known = typeof policy?.features !== 'function' || policy.features().includes('cross-origin-isolated');
      denied = known && policy?.allowsFeature?.('cross-origin-isolated') === false;
    } catch { /* Some browsers do not expose Permissions Policy inspection. */ }
    return denied
      ? problem('ISOLATION_POLICY_DENIED', '站点的 Permissions-Policy 禁止跨源隔离。自动引导无法覆盖此限制，请检查站点策略或在独立标签页打开。')
      : problem('NOT_CROSS_ORIGIN_ISOLATED', '当前页面尚未启用跨源隔离，需要先完成静态站点引导。');
  }
  if (typeof scope.SharedArrayBuffer !== 'function') {
    return problem('SHARED_MEMORY_UNAVAILABLE', '页面已隔离，但浏览器仍未提供 SharedArrayBuffer。请检查浏览器安全策略或使用支持共享内存的新版浏览器。');
  }
  return {ready: true, code: 'READY', message: '跨源隔离和共享内存已就绪。'};
}
