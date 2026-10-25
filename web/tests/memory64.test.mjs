import test from 'node:test';
import assert from 'node:assert/strict';
import {loadEngine,selectBlocks,fixtureImage} from './engine-client.mjs';
import {copyNativePreview,heapIndex,readNativeJSON} from '../native-bridge.js';
import {validateMapData,validateVanillaStructure} from './nbt.mjs';

test('Memory64 uses real >4 GiB native addresses, shared pthread work and full bridge/export paths',async t=>{
  const client=await loadEngine(),{engine}=client;
  let reserved=0n,high=0n;
  const oldProgress=globalThis.scProgress,progress=[];
  globalThis.scProgress=event=>progress.push(event);
  const rssBefore=process.memoryUsage().rss;
  try{
    assert.equal(heapIndex('4294967297'),4294967297);
    assert.throws(()=>heapIndex(9007199254740992n),/范围/);
    assert.throws(()=>heapIndex(-1n));
    // Reserve address space without memset/calloc: only allocator metadata and
    // the small fixtures below are touched, not four gigabytes of physical RAM.
    reserved=engine._sc_allocate(4294967296n+1048576n);
    assert.equal(typeof reserved,'bigint','native size_t/pointers must use i64 BigInt');
    assert.ok(reserved>0n,'large address-space reservation failed');
    high=engine._sc_allocate(65536n);
    assert.ok(high>4294967295n,'the actual native pointer did not cross 4 GiB');
    assert.ok(engine.HEAPU8.length>4294967296,'heap view was truncated to 32 bits');
    assert.ok(engine.HEAPU8.buffer instanceof SharedArrayBuffer,'pthread heap must remain shared');

    // Pass a JSON request stored at the high address into the actual C ABI.
    const encoded=new TextEncoder().encode('{"op":"metadata"}');
    engine.HEAPU8.set(encoded,heapIndex(high));
    engine.HEAPU8[heapIndex(high)+encoded.length]=0;
    const response=engine._sc_request(high,0n,0n);
    assert.equal(typeof response,'bigint');
    const metadata=readNativeJSON(engine,response).data;
    assert.equal(metadata.memory64,true);
    assert.equal(metadata.pointerBits,64);
    assert.equal(metadata.addressBits,64);
    assert.equal(metadata.memoryMaxBytes,17179869184);
    assert.equal(metadata.memoryMaxMiB,16384);
    assert.ok(metadata.heapBytes>4294967296);
    const configured=client.request('init',{threads:4,memoryBudgetMB:8192});
    assert.equal(configured.memoryBudgetMB,8192,'budget still has the former 3 GiB cap');
    assert.equal(client.request('init',{threads:4,memoryBudgetMB:999999}).memoryBudgetMB,metadata.memoryMaxMiB);

    const blocks=await client.loadBlocks(),image=fixtureImage(64,64);
    const converted=client.request('convert',{id:'high-address',width:image.width,height:image.height,
      options:{version:21,mapType:0,algorithm:'R'},blocks:selectBlocks(blocks)},image.bytes);
    assert.equal(converted.previewBytes.length,image.bytes.length);
    assert.equal(typeof converted.preview.pointer,'string','preview address must not lose integer precision in JSON');
    assert.ok(heapIndex(converted.preview.pointer)>4294967295,'preview bridge did not exercise a high native address');
    assert.ok(converted.stats.workersProcessed>=2,'actual pthread workers did not process the high-address fixture');
    const built=client.request('build',{id:'high-address',options:{maxHeight:256,compression:1}});
    assert.ok(built.blockCount>0);
    assert.equal(built.previewBytes.length,image.bytes.length);
    const map=client.exported('high-address','dat')[0];
    assert.equal(validateMapData(map.bytes).colors.length,16384);
    const structure=validateVanillaStructure(client.exported('high-address','nbt')[0].bytes);
    assert.equal(structure.blockCount,built.blockCount);
    assert.ok(progress.some(event=>event.stage==='convert'),'EM_JS progress pointer conversion was not exercised');
    // Simulate growth in another pthread: the public HEAPU8 retains its old
    // length until Emscripten re-enters JS, but the bridge must work immediately.
    const oldHeapLength=engine.HEAPU8.length;
    engine.wasmMemory.grow(1n);
    const freshHeap=new Uint8Array(engine.wasmMemory.buffer);
    freshHeap.set([23,47,89,255],oldHeapLength);
    assert.equal(engine.HEAPU8.length,oldHeapLength,'regression requires an actually stale exported view');
    assert.deepEqual([...copyNativePreview(engine,{pointer:String(oldHeapLength),length:4,width:1,height:1})],[23,47,89,255]);
    t.diagnostic(JSON.stringify({node:process.version,memory64:true,pointerBits:64,
      maxBytes:metadata.memoryMaxBytes,heapBytes:engine.HEAPU8.length,highPointer:String(high),previewPointer:converted.preview.pointer,
      shared:true,workersProcessed:converted.stats.workersProcessed,
      workerItems:converted.stats.workerItems,rssBefore,rssAfter:process.memoryUsage().rss,
      previewBytes:converted.previewBytes.length,mapBytes:map.bytes.length}));
    client.request('clear');
  }finally{
    if(high!==0n)engine._sc_deallocate(high);
    if(reserved!==0n)engine._sc_deallocate(reserved);
    engine.PThread.terminateAllThreads();
    globalThis.scProgress=oldProgress;
  }
});
