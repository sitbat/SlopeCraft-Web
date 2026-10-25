/** All native calls are serialized here; pthreads run inside the WASM module. */
import {RuntimeCache} from './runtime-cache.js';
import {createStartupResources} from './startup-resources.js';
import {loadWasmBinary, versionedWasmModuleURL} from './wasm-loader.js';
import {invokeNativeJSON,copyNativePreview} from './native-bridge.js';
let core;
let catalog;
let currentSequence;
let queue = Promise.resolve();
let quietProgress = false;
let cacheEnabled = true;
let cacheAvailable = true;
let restoreSerial = 0;
const cache = new RuntimeCache();
const cachedTasks = new Map();

globalThis.scProgress = progress => {
  if (quietProgress) return;
  postMessage({type: 'progress', progress: {sequence: currentSequence, ...progress}});
};

function nativeRequest(op, payload = {}, bytes, activeCore = core) {
    const result = invokeNativeJSON(activeCore,{op,...payload},bytes);
    if (!result.ok) throw new Error(result.error || 'SlopeCraft 核心返回错误');
    const data = result.data ?? {};
    if (data.preview?.pointer != null) {
      const {width, height} = data.preview;
      const rgba = copyNativePreview(activeCore,data.preview).buffer;
      data.preview = {width, height, rgba};
      data.width = width;
      data.height = height;
      data.rgba = rgba;
    }
    if (Array.isArray(data.files)) {
      data.files = data.files.map(file => {
        const bytes = activeCore.FS.readFile(file.path);
        const content = bytes.slice().buffer;
        activeCore.FS.unlink(file.path);
        try {activeCore.FS.rmdir(file.path.slice(0,file.path.lastIndexOf('/')));} catch {}
        return {kind: file.kind, name: file.name, mime: file.mime || 'application/octet-stream', data: content};
      });
    }
    return data;
}

async function fetchChecked(url, asJson = false) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`无法加载 ${url}（HTTP ${response.status}）。请检查静态文件是否完整。`);
  return asJson ? response.json() : response.arrayBuffer();
}

let wasmMetrics;
const startup = createStartupResources({
  baseURL: import.meta.url,
  fetchResource: fetchChecked,
  async createCore() {
    wasmMetrics = undefined;
    scProgress({stage: 'loading', message: '加载多线程 WebAssembly 核心', current: 0, total: 4});
    const moduleUrl = versionedWasmModuleURL(new URL('./wasm/slopecraft.js', import.meta.url));
    const [{default: createModule}, wasmBinary] = await Promise.all([
      import(moduleUrl.href), loadWasmBinary(moduleUrl, {onMetrics: metrics => {wasmMetrics = metrics;}}),
    ]);
    const moduleOptions = {
      wasmBinary,
      mainScriptUrlOrBlob: moduleUrl.href,
      locateFile: path => new URL(path, moduleUrl).href,
      printErr: message => scProgress({stage: 'log', message: String(message)}),
      onAbort: message => { throw new Error(`计算核心异常终止：${message}`); },
    };
    try { return await createModule(moduleOptions); }
    catch (error) { moduleOptions.PThread?.terminateAllThreads(); throw error; }
  },
  requestNative: (activeCore, op, payload, bytes) => nativeRequest(op, payload, bytes, activeCore),
  onProgress: progress => scProgress(progress),
});

async function initialize(payload) {
  cacheEnabled = payload.cacheEnabled !== false;
  if (core) return {blocks: catalog.blocks, groups: catalog.groups, metadata: nativeRequest('init', payload)};
  const result = await startup.initialize(payload);
  // Publish only a fully initialized core. Failed attempts terminate their pool
  // inside startup, so another init never sees a half-loaded block library.
  core = result.core;
  catalog = result.catalog;
  scProgress({stage: 'ready', message: '多线程计算核心已就绪', current: 4, total: 4});
  return {...result.init, blocks: catalog.blocks, groups: catalog.groups, baseColors: catalog.baseColors,
    metadata: result.metadata, startupTimings: {...result.startupTimings, wasm: wasmMetrics}};
}

async function restoreTask(id) {
  const key = JSON.stringify(id);
  if (!cachedTasks.has(key)) return;
  const saved = await cache.get(id);
  if (!saved) throw new Error('此任务的浏览器缓存已失效，请重新转换图片。');
  const dir = `/restore/${++restoreSerial}`;
  core.FS.mkdirTree(dir);
  quietProgress = true;
  try {
    const request = {id};
    for (const file of saved.files) {
      const filename = `${dir}/${file.kind === 'image' ? 'image.bin' : 'structure.zst'}`;
      core.FS.writeFile(filename,new Uint8Array(file.data));
      request[file.kind === 'image' ? 'imagePath' : 'structurePath'] = filename;
    }
    nativeRequest('cacheLoad',request);
    cachedTasks.delete(key);
    await cache.delete(id);
  } finally {
    for (const name of core.FS.readdir(dir)) if(name!=='.'&&name!=='..')core.FS.unlink(`${dir}/${name}`);
    core.FS.rmdir(dir);
    quietProgress = false;
  }
}

async function storeTask(id) {
  if (!cacheEnabled || !cacheAvailable) return;
  quietProgress = true;
  try {
    const snapshot = nativeRequest('cacheSave',{id});
    await cache.put(id,snapshot.files,snapshot.hasStructure);
    nativeRequest('cacheRelease',{id});
    cachedTasks.set(JSON.stringify(id),id);
  } catch (error) {
    // The successful computation remains live if storage is unavailable/full.
    cacheAvailable = false;
    quietProgress = false;
    scProgress({stage:'cacheWarning',message:`自动缓存不可用，结果暂保留在内存：${error.message}`});
  } finally {quietProgress=false;}
}

async function forgetTask(id) {
  const key=JSON.stringify(id);
  if(cachedTasks.has(key)) {await cache.delete(id);cachedTasks.delete(key);}
}

async function clearCache() {
  const ids=[...cachedTasks.values()];
  for(const id of ids) {nativeRequest('clear',{id});await forgetTask(id);}
  cacheAvailable=true;
  return {clearedIds:ids,entries:0,bytes:0};
}

function normalizeExport(payload) {
  const aliases = {map: 'dat', flatdiagram: 'png', commands: 'command', assembled: 'assembled-litematic'};
  let format = aliases[payload.format] || payload.format;
  if (payload.format === 'assembled' && /^(nbt|vanilla)/.test(payload.options?.format || '')) format = 'assembled-nbt';
  return {...payload, format};
}

async function attachBlockIcons(blocks) {
  if(typeof OffscreenCanvas==='undefined')return;
  const canvas=new OffscreenCanvas(16,16),context=canvas.getContext('2d');
  if(!context)return;
  quietProgress=true;
  try{
    for(const block of blocks){
      const icon=nativeRequest('blockIcon',{key:block.key});
      context.putImageData(new ImageData(new Uint8ClampedArray(icon.rgba),16,16),0,0);
      const blob=await canvas.convertToBlob({type:'image/png'});
      const bytes=new Uint8Array(await blob.arrayBuffer());
      block.iconUrl=`data:image/png;base64,${btoa(String.fromCharCode(...bytes))}`;
    }
  }finally{quietProgress=false;}
}

function normalizeOptions(payload) {
  const options = {...payload.options};
  const mapTypes = {slope: 0, flat: 1, file: 2, FileOnly: 2};
  const algorithms = {RGB: 'r', RGB_Better: 'R', HSV: 'H', Lab94: 'l', Lab00: 'L', XYZ: 'X', AI: 'A', GA: 'A'};
  const compression = {none: 0, lossless: 1, lossy: 2, both: 3};
  const support = {none: 0, transparent: 1, glass: 1, stone: 2};
  if (options.mapType in mapTypes) options.mapType = mapTypes[options.mapType];
  if (options.algorithm in algorithms) options.algorithm = algorithms[options.algorithm];
  if (options.compression in compression) options.compression = compression[options.compression];
  if (options.supportBlock in support) options.supportBlock = support[options.supportBlock];
  if (options.pureTransparent === 'air') options.pureTransparent = 'A';
  if (options.pureTransparent === 'background') options.pureTransparent = 'B';
  const halves = {background: 'B', compose: 'C', blend: 'C', retain: 'R', keep: 'R'};
  if (options.halfTransparent in halves) options.halfTransparent = halves[options.halfTransparent];
  return {...payload, options};
}

function transfers(data) {
  const buffers = new Set();
  if (data.rgba instanceof ArrayBuffer) buffers.add(data.rgba);
  if (data.preview?.rgba instanceof ArrayBuffer) buffers.add(data.preview.rgba);
  for (const file of data.files || []) if (file.data instanceof ArrayBuffer) buffers.add(file.data);
  return [...buffers];
}

self.addEventListener('message', ({data: message}) => {
  queue = queue.then(async () => {
    const {sequence, type, payload = {}} = message;
    currentSequence = sequence;
    try {
      let data;
      if (type === 'prepare') data = await startup.prepare();
      else if (type === 'init') data = await initialize(payload);
      else if (!core) throw new Error('计算引擎尚未初始化。');
      else if (type === 'cacheStats') data = cacheAvailable ? await cache.stats() : {entries:cachedTasks.size,bytes:0,available:false};
      else if (type === 'cacheClear') data = await clearCache();
      else if (type === 'convert') {
        const {rgba, ...options} = payload;
        if (!(rgba instanceof ArrayBuffer) || rgba.byteLength !== payload.width * payload.height * 4) throw new Error('图片像素数据无效。');
        data = nativeRequest('convert', normalizeOptions(options), rgba);
        await forgetTask(payload.id);
        await storeTask(payload.id);
      } else if (type === 'importBlocklist' || type === 'loadBlocklist') {
        const {data: bytes, buffer, ...options} = payload;
        data = nativeRequest('loadBlocklist', options, bytes || buffer);
        await attachBlockIcons(data.blocks || []);
      } else if (type === 'export') {
        await restoreTask(payload.id);
        try {data = nativeRequest('export', normalizeExport(payload));}
        finally {await storeTask(payload.id);}
      } else if (type === 'build') {
        await restoreTask(payload.id);
        try {data = nativeRequest(type,normalizeOptions(payload));}
        finally {await storeTask(payload.id);}
      } else if (type === 'dispose' || type === 'clear') {
        if(payload.id!=null) await forgetTask(payload.id);
        else for(const id of [...cachedTasks.values()])await forgetTask(id);
        data = nativeRequest('clear', payload);
      }
      else data = nativeRequest(type, normalizeOptions(payload));
      postMessage({sequence, ok: true, data}, transfers(data));
    } catch (error) {
      postMessage({sequence, ok: false, error: error?.message || String(error)});
    }
  }).catch(error => postMessage({sequence: message.sequence, ok: false, error: String(error)}));
});
