/** Bounded conversion variants retain native task identities. GPL-3.0-or-later. */
export function stableKey(value) {
  if (Array.isArray(value)) return `[${value.map(stableKey).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort()
    .filter(key => value[key] !== undefined).map(key => `${JSON.stringify(key)}:${stableKey(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

export function conversionKey(descriptor) {
  return stableKey({...descriptor, blocks: [...descriptor.blocks].sort((a, b) =>
    Number(a.baseColor) - Number(b.baseColor) || String(a.id).localeCompare(String(b.id)) || Number(a.key || 0) - Number(b.key || 0)),
    enabledGroups: [...(descriptor.enabledGroups || [])].sort()});
}

export function memoryBudgetRange(metadata = {}) {
  const min = Number(metadata.memoryMinMiB), max = Number(metadata.memoryMaxMiB);
  return {min: Number.isSafeInteger(min) && min >= 1 ? min : 128,
    max: Number.isSafeInteger(max) && max >= (min || 128) ? max : Number.MAX_SAFE_INTEGER};
}

export class ConversionHistory {
  constructor({maxEntries = 24, maxBytes = 256 * 1024 * 1024, maxNativeBytes = 512 * 1024 * 1024,
    idFactory = () => `conversion-${crypto.randomUUID()}`, onRemove = () => {}} = {}) {
    this.maxEntries = maxEntries;
    this.maxBytes = maxBytes;
    this.maxNativeBytes = maxNativeBytes;
    this.idFactory = idFactory;
    this.onRemove = onRemove;
    this.entries = new Map();
    this.pending = new Map();
    this.pendingTasks = new Map();
    this.taskGenerations = new Map();
    this.generation = 0;
    this.serial = 0;
  }
  peek(key) { return this.entries.get(key); }
  get(key) {
    const entry = this.entries.get(key);
    if (entry) { this.entries.delete(key); this.entries.set(key, entry); }
    return entry;
  }
  forTask(taskId, imageRevision) {
    return [...this.entries.values()].filter(entry => entry.descriptor.taskId === taskId &&
      (imageRevision === undefined || entry.descriptor.imageRevision === imageRevision));
  }
  stats() {
    const values = [...this.entries.values()];
    return {entries: values.length, previewBytes: values.reduce((sum, item) => sum + item.previewBytes, 0),
      estimatedBytes: values.reduce((sum, item) => sum + item.estimatedBytes, 0),
      nativeResidentBytes:values.reduce((sum,item)=>sum+item.nativeResidentBytes,0),
      maxEntries: this.maxEntries, maxBytes: this.maxBytes, maxNativeBytes:this.maxNativeBytes};
  }
  remove(key, reason = 'evicted') {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    this.onRemove(entry, reason);
  }
  removeTask(taskId, reason = 'image-changed') {
    this.taskGenerations.set(taskId, (this.taskGenerations.get(taskId) || 0) + 1);
    for(const [key,id]of this.pendingTasks)if(id===taskId){this.pending.delete(key);this.pendingTasks.delete(key);}
    for (const entry of this.forTask(taskId)) this.remove(entry.key, reason);
  }
  removeNativeIds(ids, reason = 'backend-clear') {
    const nativeIds = new Set(ids.map(String));
    for (const entry of this.entries.values()) if (nativeIds.has(String(entry.nativeId))) this.remove(entry.key, reason);
  }
  clear(reason = 'cleared') {
    this.generation++;
    this.pending.clear();this.pendingTasks.clear();
    for (const key of [...this.entries.keys()]) this.remove(key, reason);
  }
  trim(keepKey) {
    while (this.entries.size > 1 && (this.entries.size > this.maxEntries || this.stats().previewBytes > this.maxBytes || this.stats().nativeResidentBytes>this.maxNativeBytes)) {
      const key = [...this.entries.keys()].find(key => key !== keepKey);
      this.remove(key);
    }
  }
  setNativeLimit(bytes) {
    this.maxNativeBytes=bytes;
    this.trim([...this.entries.keys()].at(-1));
  }
  setResident(entry,resident) {
    if(this.entries.get(entry?.key)!==entry)return;
    entry.nativeResident=resident;
    entry.previewBytes=entry.result.rgba.byteLength+(entry.built?.preview?.rgba?.byteLength||entry.built?.rgba?.byteLength||0);
    const size=entry.built?.size||entry.built?.dimensions;
    const volume=Array.isArray(size)?size.reduce((product,n)=>product*Number(n),1):0;
    entry.nativeResidentBytes=resident?Math.max(entry.descriptor.width*entry.descriptor.height*128,volume*8):0;
    entry.estimatedBytes=entry.previewBytes+entry.nativeResidentBytes;
    this.trim(entry.key);
  }
  async ensure(descriptor, convert, {force = false,nativeResident=false} = {}) {
    descriptor = structuredClone(descriptor);
    const key = conversionKey(descriptor), existing = this.get(key);
    if (existing && !force) return {entry: existing, hit: true};
    if (this.pending.has(key)) return this.pending.get(key);
    const nativeId = this.idFactory(), generation = this.generation;
    const taskGeneration = this.taskGenerations.get(descriptor.taskId) || 0;
    const pending = (async () => {
      try {
        const result = await Promise.resolve().then(() => convert(nativeId));
        if (!result?.rgba) throw new Error('转换核心未返回图像预览。');
        const entry = {key, nativeId, descriptor, result, ordinal:++this.serial, previewBytes: result.rgba.byteLength,
          estimatedBytes:result.rgba.byteLength,nativeResidentBytes:0,nativeResident:false,
          built: null, buildKey: null};
        if (generation !== this.generation || taskGeneration !== (this.taskGenerations.get(descriptor.taskId) || 0)) {
          throw new Error('对比缓存已清理，请重新转化。');
        }
        this.remove(key, 'replaced');
        this.entries.set(key, entry);
        this.setResident(entry,typeof nativeResident==='function'?nativeResident():nativeResident);
        this.trim(key);
        return {entry, hit: false};
      } catch (error) { this.onRemove({nativeId, descriptor}, 'failed'); throw error; }
      finally { if (this.pending.get(key) === pending) {this.pending.delete(key);this.pendingTasks.delete(key);} }
    })();
    this.pending.set(key, pending);
    this.pendingTasks.set(key, descriptor.taskId);
    return pending;
  }
  async build(entry, options, createBuild, {force = false} = {}) {
    this.requireEntry(entry);
    const key = stableKey(options);
    if (entry.built && entry.buildKey === key && !force) return entry.built;
    entry.built = null;
    entry.buildKey = null;
    const built = await createBuild(entry.nativeId, options);
    this.requireEntry(entry);
    entry.built = built;
    entry.buildKey = key;
    this.setResident(entry,entry.nativeResident);
    return built;
  }
  use(entry, action) {
    this.requireEntry(entry);
    this.get(entry.key);
    return action(entry.nativeId);
  }
  requireEntry(entry) {
    if (!entry || this.entries.get(entry.key) !== entry) throw new Error('此转化结果已清理，请重新转化。');
  }
}
