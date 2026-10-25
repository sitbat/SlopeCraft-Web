/** IndexedDB stores original core snapshots, never reconstructed approximations. */
export class RuntimeCache {
  constructor() {
    this.session = crypto.randomUUID();
    this.database = null;
    this.entries = new Map();
  }
  async open() {
    if (this.database) return this.database;
    if (!globalThis.indexedDB) throw new Error('此浏览器未提供 IndexedDB');
    this.database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('slopecraft-compute-cache-v1', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('snapshots', {keyPath:'key'});
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('浏览器缓存正在被其他标签页占用'));
    });
    // Interrupted sessions have no surviving native palettes. Remove their old
    // snapshots after a day without disturbing a second currently active tab.
    const tx = this.database.transaction('snapshots','readwrite');
    const cursor = tx.objectStore('snapshots').openCursor();
    cursor.onsuccess = () => {
      const item = cursor.result;
      if (!item) return;
      if (item.value.savedAt < Date.now() - 86400000) item.delete();
      item.continue();
    };
    return this.database;
  }
  key(id) { return `${this.session}/${JSON.stringify(id)}`; }
  async transact(mode, operation) {
    const db = await this.open();
    return new Promise((resolve,reject) => {
      const tx = db.transaction('snapshots',mode);
      let result;
      const request = operation(tx.objectStore('snapshots'));
      request.onsuccess = () => {result = request.result;};
      request.onerror = () => reject(request.error);
      tx.oncomplete = () => resolve(result);
      tx.onerror = tx.onabort = () => reject(tx.error || new Error('浏览器缓存事务失败'));
    });
  }
  async put(id, files, hasStructure) {
    const bytes=files.reduce((n,file)=>n+file.data.byteLength,0);
    await this.transact('readwrite',store=>store.put({key:this.key(id),session:this.session,id,files,hasStructure,bytes,savedAt:Date.now()}));
    this.entries.set(JSON.stringify(id),bytes);
  }
  get(id) { return this.transact('readonly',store=>store.get(this.key(id))); }
  async delete(id) {
    await this.transact('readwrite',store=>store.delete(this.key(id)));
    this.entries.delete(JSON.stringify(id));
  }
  async stats() {
    // Stats must not clone all potentially huge snapshot buffers back into RAM.
    return {entries:this.entries.size,bytes:[...this.entries.values()].reduce((n,bytes)=>n+bytes,0)};
  }
}
