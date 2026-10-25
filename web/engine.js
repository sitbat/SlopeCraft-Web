/** Browser-side owner of the SlopeCraft WASM worker. GPL-3.0-or-later. */
import {isolationEnvironment} from './browser-environment.js';
export class EngineClient {
  constructor() {
    this.worker = null;
    this.pending = new Map();
    this.listeners = new Set();
    this.sequence = 0;
    this.ready = null;
    this.prepared = null;
  }

  onProgress(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  ensureWorker() {
    if (this.worker) return;
    const environment=isolationEnvironment();
    if(!environment.ready)throw new Error(environment.message);
    if (typeof WebAssembly === 'undefined' || typeof Worker === 'undefined') {
      throw new Error('此浏览器不支持 WebAssembly 或 Web Worker，请使用较新的浏览器。');
    }
    this.worker = new Worker(new URL('./engine-worker.js', import.meta.url), {type: 'module', name: 'SlopeCraft engine'});
    const worker = this.worker;
    this.worker.addEventListener('message', ({data}) => {
      if (this.worker !== worker) return;
      if (data.type === 'progress') {
        for (const listener of this.listeners) listener(data.progress);
        return;
      }
      const request = this.pending.get(data.sequence);
      if (!request) return;
      this.pending.delete(data.sequence);
      if (data.ok) request.resolve(data.data);
      else request.reject(new Error(data.error || '核心运行失败'));
    });
    this.worker.addEventListener('error', event => {
      if (this.worker !== worker) return;
      this.fail(new Error(event.message || '计算线程意外停止，请重新载入引擎。'));
    });
    this.worker.addEventListener('messageerror', () => {
      if (this.worker === worker) this.fail(new Error('计算线程数据传输失败。'));
    });
  }

  async prepare() {
    if (this.prepared) return this.prepared;
    const pending = (async () => {
      this.ensureWorker();
      return this.send('prepare', {});
    })();
    this.prepared = pending;
    try { return await pending; }
    catch (error) { if (this.prepared === pending) this.fail(error); throw error; }
  }

  async init(options = {}) {
    if (this.ready) return this.ready;
    const pending = (async () => {
      this.ensureWorker();
      return this.send('init', {threads: Math.min(8, Math.max(2, (navigator.hardwareConcurrency || 4) - 1)), ...options});
    })();
    this.ready = pending;
    try { return await pending; }
    catch (error) { if (this.ready === pending) this.fail(error); throw error; }
  }

  async request(type, payload = {}, transfer = []) {
    await this.init();
    return this.send(type, payload, transfer);
  }

  send(type, payload, transfer = []) {
    const sequence = ++this.sequence;
    return new Promise((resolve, reject) => {
      this.pending.set(sequence, {resolve, reject});
      try { this.worker.postMessage({sequence, type, payload}, transfer); }
      catch (error) { this.pending.delete(sequence); reject(error); }
    });
  }

  fail(error) {
    for (const {reject} of this.pending.values()) reject(error);
    this.pending.clear();
    this.worker?.terminate();
    this.worker = null;
    this.ready = null;
    this.prepared = null;
  }

  dispose() { this.fail(new Error('计算引擎已关闭')); }
}
