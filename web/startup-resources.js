/** Parallel downloads with ordered native registration. GPL-3.0-or-later. */
export function createStartupResources({baseURL, fetchResource, createCore, requestNative,
  onProgress = () => {}, now = () => performance.now()}) {
  let current;
  const stopCore = session => {
    if (!session.core || session.stopped) return;
    session.stopped = true;
    session.core.PThread?.terminateAllThreads();
  };
  const discard = session => {
    session.discarded = true;
    stopCore(session);
  };
  function start() {
    if (current) return current;
    const session = {started: now(), timings: {}, discarded: false, stopped: false};
    current = session;
    const timed = async (key, action) => {
      const begin = now();
      try { return await action(); }
      finally { session.timings[key] = now() - begin; }
    };
    // Start both branches before awaiting either; catalog is returned to the UI
    // while the module, shared memory and pthread pool can still be warming up.
    session.corePromise = timed('coreReadyMs', createCore).then(core => {
      session.core = core;
      if (session.discarded) {
        stopCore(session);
        throw new Error('启动已取消，请重试。');
      }
      return core;
    });
    session.catalogPromise = timed('catalogMs', () => fetchResource(new URL('./assets/blocklists.json', baseURL), true))
      .then(catalog => {
        if (!Array.isArray(catalog?.groups)) throw new Error('方块库目录无效，请检查静态文件是否完整。');
        // Begin every ZIP request together, but keep the result in catalog order.
        session.zipPromise = timed('blocklistDownloadMs', () => Promise.all(catalog.groups.map(group =>
          fetchResource(new URL(`./assets/blocklists/${encodeURIComponent(group.name)}.zip`, baseURL)))));
        session.zipPromise.catch(() => {});
        return catalog;
      });
    session.resourcesPromise = session.catalogPromise.then(async catalog => ({catalog, zips: await session.zipPromise}));
    session.readyPromise = Promise.all([session.corePromise, session.resourcesPromise]).catch(error => {
      discard(session);
      throw error;
    });
    // prepare() deliberately does not await the module or ZIPs. Observe all
    // background rejections immediately, then report them through initialize().
    session.readyPromise.catch(() => {});
    return session;
  }
  return {
    async prepare() {
      const session = start();
      try { return {catalog: await session.catalogPromise, startupTimings: {...session.timings}}; }
      catch (error) {
        discard(session);
        if (current === session) current = undefined;
        throw error;
      }
    },
    initialize(payload) {
      const session = start();
      if (session.initialization) return session.initialization;
      session.initialization = (async () => {
        const requireActive = () => {
          if (session.discarded) throw new Error('启动已取消，请重试。');
        };
        try {
          const [core, {catalog, zips}] = await session.readyPromise;
          requireActive();
          const nativeStarted = now();
          const init = await requestNative(core, 'init', payload);
          const loaded = [];
          for (let i = 0; i < catalog.groups.length; i++) {
            requireActive();
            const group = catalog.groups[i];
            onProgress({stage: 'loading', message: `加载方块库 ${group.name}`, current: i + 1, total: catalog.groups.length + 1});
            const result = await requestNative(core, 'loadBlocklist', {name: group.name}, zips[i]);
            for (const block of result.blocks || []) {
              const source = group.blocks?.find(b => b.id === block.id && b.baseColor === block.baseColor);
              loaded.push({...source, ...block, nameZH: block.nameZH || block.name || source?.nameZH,
                group: group.name, iconUrl: source?.iconUrl});
            }
          }
          requireActive();
          const metadata = await requestNative(core, 'metadata');
          requireActive();
          session.timings.nativeRegistrationMs = now() - nativeStarted;
          session.timings.workerTotalMs = now() - session.started;
          return {core, catalog: {...catalog, blocks: loaded.length ? loaded : catalog.blocks}, init, metadata,
            startupTimings: {...session.timings}};
        } catch (error) {
          discard(session);
          if (current === session) current = undefined;
          throw error;
        }
      })();
      return session.initialization;
    },
    dispose() {
      if (current) discard(current);
      current = undefined;
    },
  };
}
