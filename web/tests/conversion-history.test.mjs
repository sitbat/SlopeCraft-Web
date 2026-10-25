import test from 'node:test';
import assert from 'node:assert/strict';
import {ConversionHistory,conversionKey,memoryBudgetRange} from '../conversion-history.js';
import {loadEngine,selectBlocks,fixtureImage} from './engine-client.mjs';
import {validateMapData,validateVanillaStructure,validateLitematic,assertSameBlocks} from './nbt.mjs';

const descriptor = (algorithm='R',taskId='image-one') => ({taskId,imageRevision:1,width:4,height:3,paletteRevision:0,
  options:{version:21,mapType:0,algorithm,dither:false,pureTransparent:'B',halfTransparent:'C',backgroundColor:'#ffffff',
    ga:{popSize:50,maxGeneration:200,maxFailTimes:50,crossoverProb:0.8,mutationProb:0.01}},
  enabledGroups:['FixedBlocks','CustomBlocks'],blocks:[{baseColor:1,id:'minecraft:stone',key:5,enabled:true},{baseColor:2,id:'minecraft:dirt',key:8,enabled:false}]});
const result = (value=1,width=4,height=3) => ({rgba:new Uint8Array(width*height*4).fill(value).buffer,width,height});
function history(options={}) {
  let serial=0;
  const removed=[];
  const cache=new ConversionHistory({idFactory:()=>`native-${++serial}`,onRemove:(entry,reason)=>removed.push({entry,reason}),...options});
  return {cache,removed};
}
function gate(){let resolve;const promise=new Promise(yes=>{resolve=yes;});return{promise,resolve};}

test('cache identity includes image, palette, version and every conversion option independent of object order',()=>{
  const initial=descriptor(),key=conversionKey(initial),reordered=structuredClone(initial);
  reordered.blocks.reverse();reordered.enabledGroups.reverse();
  reordered.options={...reordered.options,ga:{mutationProb:.01,crossoverProb:.8,maxFailTimes:50,maxGeneration:200,popSize:50}};
  assert.equal(conversionKey(reordered),key);
  const changes=[
    value=>value.taskId='another-image',value=>value.imageRevision++,value=>value.width++,value=>value.height++,value=>value.paletteRevision++,
    value=>value.options.version=20,value=>value.options.mapType=1,value=>value.options.algorithm='L',value=>value.options.dither=true,
    value=>value.options.pureTransparent='A',value=>value.options.halfTransparent='R',value=>value.options.backgroundColor='#000000',
    ...Object.keys(initial.options.ga).map(name=>value=>value.options.ga[name]+=1),
    value=>value.blocks[0].id='minecraft:glass',value=>value.blocks[0].key++,value=>value.blocks[0].baseColor++,value=>value.blocks[0].enabled=false,
    value=>value.enabledGroups.pop(),
  ];
  for(const change of changes){const changed=structuredClone(initial);change(changed);assert.notEqual(conversionKey(changed),key);}
});

test('switching algorithms preserves independent native identities and exact previews without recomputing a hit',async()=>{
  const {cache}=history(),calls=[];
  const produce=(id)=>{calls.push(id);return result(calls.length);};
  const first=await cache.ensure(descriptor('R'),produce),second=await cache.ensure(descriptor('L'),produce);
  const restored=await cache.ensure(descriptor('R'),()=>{throw new Error('a cache hit must not convert');});
  assert.equal(restored.hit,true);assert.equal(restored.entry,first.entry);
  assert.notEqual(first.entry.nativeId,second.entry.nativeId);
  assert.deepEqual([...new Uint8Array(restored.entry.result.rgba)],Array(48).fill(1));
  assert.equal(cache.use(restored.entry,id=>id),'native-1');
  assert.equal(calls.length,2);
});

test('descriptors are snapshotted and simultaneous identical conversions share one native result',async()=>{
  const {cache}=history(),pending=gate(),input=descriptor();let calls=0;
  const first=cache.ensure(input,async()=>{calls++;return pending.promise;});
  const second=cache.ensure(descriptor(),()=>{throw new Error('duplicate conversion');});
  input.options.version=12;input.blocks[0].enabled=false;
  pending.resolve(result());
  const [a,b]=await Promise.all([first,second]);
  assert.equal(calls,1);assert.equal(a.entry,b.entry);assert.equal(a.entry.descriptor.options.version,21);assert.equal(a.entry.descriptor.blocks[0].enabled,true);
});

test('force recompute replaces its native result and structure while a failed recompute preserves the old valid entry',async()=>{
  const {cache,removed}=history();
  const old=(await cache.ensure(descriptor(),()=>result(1))).entry;
  await cache.build(old,{connectMushroom:false},async()=>({blockCount:9}));
  await assert.rejects(cache.ensure(descriptor(),()=>{throw new Error('native failure');},{force:true}),/native failure/);
  assert.equal(cache.peek(old.key),old);assert.equal(old.built.blockCount,9);
  const replacement=(await cache.ensure(descriptor(),()=>result(2),{force:true})).entry;
  assert.notEqual(replacement.nativeId,old.nativeId);assert.equal(replacement.built,null);
  assert.ok(removed.some(item=>item.entry===old&&item.reason==='replaced'));
  assert.throws(()=>cache.use(old,()=>{}),/已清理/);
});

test('LRU eviction releases native variants and clears retained preview references without touching source image bytes',async()=>{
  const {cache,removed}=history({maxEntries:2}),source=new Uint8Array([11,22,33,44]);
  const a=(await cache.ensure(descriptor('R'),()=>result())).entry;
  const b=(await cache.ensure(descriptor('L'),()=>result())).entry;
  cache.get(a.key);
  const c=(await cache.ensure(descriptor('H'),()=>result())).entry;
  assert.equal(cache.peek(a.key),a);assert.equal(cache.peek(b.key),undefined);assert.equal(cache.peek(c.key),c);
  assert.deepEqual(removed.map(item=>item.entry.nativeId),[b.nativeId]);
  assert.deepEqual(cache.stats(),{entries:2,previewBytes:96,estimatedBytes:96,nativeResidentBytes:0,maxEntries:2,maxBytes:256*1024*1024,maxNativeBytes:512*1024*1024});
  assert.deepEqual([...source],[11,22,33,44]);
});

test('separate preview and native-resident quotas retain only the newest oversized item',async()=>{
  const {cache,removed}=history({maxBytes:1600,maxNativeBytes:1600});
  await cache.ensure(descriptor('R'),()=>result(),{nativeResident:true});
  await cache.ensure(descriptor('L'),()=>result(),{nativeResident:true});
  assert.equal(cache.stats().entries,1);
  const large={...descriptor('H'),width:100,height:100};
  const huge=(await cache.ensure(large,()=>result(3,100,100))).entry;
  assert.equal(cache.stats().entries,1);assert.equal(cache.peek(huge.key),huge);
  assert.equal(cache.stats().estimatedBytes,40000);assert.equal(cache.stats().nativeResidentBytes,0);assert.equal(removed.length,2);
  cache.clear();assert.equal(cache.stats().previewBytes,0);assert.equal(cache.stats().entries,0);
});

test('all seven algorithms and both dithering variants remain cached for a normal 980 by 858 image',async()=>{
  const {cache,removed}=history(),algorithms=['r','R','H','X','l','L','A'];
  for(const algorithm of algorithms)for(const dither of [false,true]){
    const input=descriptor(algorithm);input.width=980;input.height=858;input.options.dither=dither;
    await cache.ensure(input,()=>result(1,980,858),{nativeResident:false});
  }
  assert.equal(cache.stats().entries,14);assert.equal(removed.length,0);
  assert.equal(cache.stats().previewBytes,980*858*4*14);
  assert.equal(cache.stats().nativeResidentBytes,0,'released snapshots are not resident native images');
  for(const algorithm of algorithms)for(const dither of [false,true]){
    const input=descriptor(algorithm);input.width=980;input.height=858;input.options.dither=dither;
    assert.equal((await cache.ensure(input,()=>{throw new Error('all 14 variants should remain reusable');})).hit,true);
  }
  cache.clear();
});

test('cache failure charges only the affected resident result and recovery removes its native charge',async()=>{
  const {cache,removed}=history({maxNativeBytes:1600}),pending=gate();let cacheAvailable=true;
  const a=(await cache.ensure(descriptor('R'),()=>result())).entry;
  const converting=cache.ensure(descriptor('L'),()=>pending.promise,{nativeResident:()=>!cacheAvailable});
  cacheAvailable=false;pending.resolve(result());
  const b=(await converting).entry;
  assert.equal(a.nativeResidentBytes,0);assert.equal(b.nativeResidentBytes,1536);
  cache.setResident(a,true);
  assert.equal(cache.peek(b.key),undefined,'two uncompressed resident results must respect the separate quota');
  assert.equal(removed.length,1);cache.setResident(a,false);
  assert.equal(cache.stats().nativeResidentBytes,0);
  cache.setNativeLimit(8192*1048576/2);
  assert.equal(cache.stats().maxNativeBytes,4096*1048576);
});

test('backend cache invalidation uses native variant IDs and per-image removal leaves other source tasks intact',async()=>{
  const {cache}=history();
  const a=(await cache.ensure(descriptor('R'),()=>result())).entry;
  const b=(await cache.ensure(descriptor('L'),()=>result())).entry;
  const other=(await cache.ensure(descriptor('R','image-two'),()=>result())).entry;
  cache.removeNativeIds([a.nativeId]);
  assert.equal(cache.peek(a.key),undefined);assert.equal(cache.peek(b.key),b);
  cache.removeTask('image-one');
  assert.equal(cache.forTask('image-one').length,0);assert.equal(cache.peek(other.key),other);
  cache.clear('engine-reset');
  assert.throws(()=>cache.use(other,()=>{}),/已清理/);
});

test('clearing or replacing a source while conversion is pending prevents a late native result from being reinserted',async()=>{
  for(const clear of [cache=>cache.clear(),cache=>cache.removeTask('image-one')]){
    const {cache,removed}=history(),pending=gate();
    const old=cache.ensure(descriptor(),()=>pending.promise);
    const rejection=assert.rejects(old,/已清理/);
    clear(cache);
    const replacement=(await cache.ensure(descriptor(),()=>result(2))).entry;
    pending.resolve(result(1));await rejection;
    assert.equal(cache.peek(replacement.key),replacement);
    assert.ok(removed.some(item=>item.entry.nativeId==='native-1'));
  }
});

test('build caching compares all build options and a failed build cannot advertise a previous structure',async()=>{
  const {cache}=history(),entry=(await cache.ensure(descriptor(),()=>result())).entry,calls=[];
  const build=async(id,options)=>{calls.push({id,options});return{blockCount:calls.length};};
  const initial=await cache.build(entry,{compression:1,connectMushroom:false},build);
  assert.equal((await cache.build(entry,{connectMushroom:false,compression:1},build)),initial);
  await cache.build(entry,{compression:1,connectMushroom:true},build);
  assert.equal(calls.length,2);assert.ok(calls.every(call=>call.id===entry.nativeId));
  await assert.rejects(cache.build(entry,{compression:2},async()=>{throw new Error('structure failure');}),/structure failure/);
  assert.equal(entry.built,null);assert.equal(entry.buildKey,null);
});

test('memory budget validation follows the actual engine metadata and permits more than 3 GiB',()=>{
  assert.deepEqual(memoryBudgetRange({memoryMinMiB:128,memoryMaxMiB:16384,memory64:true}),{min:128,max:16384});
  assert.deepEqual(memoryBudgetRange({memoryMinMiB:256,memoryMaxMiB:8192}),{min:256,max:8192});
  assert.deepEqual(memoryBudgetRange({memoryMinMiB:128,memoryMaxMiB:3072}),{min:128,max:3072});
  assert.equal(memoryBudgetRange().max,Number.MAX_SAFE_INTEGER,'before metadata, do not invent the old 3072 cap');
});

test('real native algorithm variants restore distinct snapshots and export the selected image and structure after a cache hit',async()=>{
  const client=await loadEngine();
  try{
    client.request('init',{threads:4,memoryBudgetMB:8192});
    const blocks=selectBlocks(await client.loadBlocks()),image=fixtureImage(17,13),snapshots=new Map();
    const {cache}=history();let conversions=0;
    const describe=algorithm=>({...descriptor(algorithm),width:image.width,height:image.height,blocks});
    function save(id){
      const snapshot=client.request('cacheSave',{id});
      const files=snapshot.files.map(file=>({...file,bytes:client.engine.FS.readFile(file.path).slice()}));
      snapshots.set(id,files);client.request('cacheRelease',{id});
      for(const file of files)client.engine.FS.unlink(file.path);
    }
    function restore(id){
      const files=snapshots.get(id);
      for(const file of files)client.engine.FS.writeFile(file.path,file.bytes);
      client.request('cacheLoad',{id,imagePath:files.find(file=>file.kind==='image').path,
        ...(files.some(file=>file.kind==='structure')?{structurePath:files.find(file=>file.kind==='structure').path}:{})});
      for(const file of files)client.engine.FS.unlink(file.path);
    }
    async function convert(algorithm){
      return cache.ensure(describe(algorithm),id=>{
        conversions++;
        const output=client.request('convert',{id,width:image.width,height:image.height,blocks,options:describe(algorithm).options},image.bytes);
        const preview={width:image.width,height:image.height,rgba:output.previewBytes.slice().buffer};
        save(id);return preview;
      });
    }
    const a=(await convert('R')).entry;
    restore(a.nativeId);
    const mapA=validateMapData(client.exported(a.nativeId,'dat')[0].bytes).colors.slice();
    save(a.nativeId);
    const buildOptions={maxHeight:256,compression:1,glassBridge:0};
    const structureA=await cache.build(a,buildOptions,id=>{
      restore(id);const built=client.request('build',{id,options:buildOptions});
      const semantic=validateVanillaStructure(client.exported(id,'nbt')[0].bytes);save(id);return{...built,semantic};
    });
    const b=(await convert('L')).entry;
    assert.notDeepEqual(new Uint8Array(a.result.rgba),new Uint8Array(b.result.rgba),'fixture must distinguish the real algorithms');
    const hit=await convert('R');assert.equal(hit.hit,true);assert.equal(conversions,2);
    assert.equal(await cache.build(hit.entry,buildOptions,()=>{throw new Error('matching native structure must be reused');}),structureA);
    const exported=cache.use(hit.entry,id=>{
      restore(id);
      const map=validateMapData(client.exported(id,'dat')[0].bytes).colors;
      const litematic=validateLitematic(client.exported(id,'litematic')[0].bytes).regions[0];
      return{map,litematic};
    });
    assert.deepEqual(exported.map,mapA,'the selected variant must export its own map colors');
    assertSameBlocks(structureA.semantic,exported.litematic);
    assert.equal(client.request('metadata').memory64,true);
  }finally{client.engine.PThread.terminateAllThreads();}
});
