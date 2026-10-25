import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {loadWasmBinary,versionedWasmModuleURL} from '../wasm-loader.js';

const raw=Uint8Array.from([0,97,115,109,1,0,0,0,0,1,0]);
const gzip=gzipSync(raw);
const sha=b=>createHash('sha256').update(b).digest('hex');
const artifact={schemaVersion:1,wasmBytes:raw.length,wasmSha256:sha(raw),gzipBytes:gzip.length,moduleSha256:'a'.repeat(64)};
const moduleURL=new URL('https://example.test/map/wasm/slopecraft.js');
const response=(body,init)=>new Response(body,init);

test('gzip transport produces the exact versioned WASM bytes without fetching raw',async()=>{
  const requests=[],metrics=[];
  const bytes=await loadWasmBinary(moduleURL,{artifact,fetchFn:async url=>{requests.push(new URL(url));return response(gzip);},onMetrics:m=>metrics.push(m)});
  assert.deepEqual(bytes,raw);
  assert.equal(requests.length,1);
  assert.equal(requests[0].pathname,'/map/wasm/slopecraft.wasm.gz');
  assert.equal(requests[0].searchParams.get('v'),artifact.wasmSha256);
  assert.equal(metrics[0].source,'gzip');
  assert.equal(metrics[0].bodyBytes,gzip.length);
  assert.equal(metrics[0].decodedBytes,raw.length);
  assert.equal(versionedWasmModuleURL(moduleURL,artifact).searchParams.get('v'),artifact.moduleSha256);
});

test('a host-decoded .gz response is not decompressed twice',async()=>{
  class UnexpectedDecompressor{constructor(){throw new Error('must not run');}}
  let metrics;
  const bytes=await loadWasmBinary(moduleURL,{artifact,DecompressionStreamCtor:UnexpectedDecompressor,
    fetchFn:async()=>response(raw,{headers:{'Content-Encoding':'gzip','Content-Length':String(gzip.length)}}),onMetrics:m=>{metrics=m;}});
  assert.deepEqual(bytes,raw);
  assert.equal(metrics.source,'decoded-gzip-response');
  assert.equal(metrics.bodyBytes,raw.length);
  assert.equal(metrics.encodedContentLength,gzip.length);
});

test('browsers without a gzip decompressor request only the same original pthread module',async()=>{
  const requests=[];
  const bytes=await loadWasmBinary(moduleURL,{artifact,DecompressionStreamCtor:null,
    fetchFn:async url=>{requests.push(String(url));return response(raw);}});
  assert.deepEqual(bytes,raw);
  assert.equal(requests.length,1);
  assert.equal(new URL(requests[0]).pathname,'/map/wasm/slopecraft.wasm');
});

test('missing, damaged, wrong-version and over-expanded gzip each fall back to raw once',async t=>{
  const modified=raw.slice();modified[modified.length-1]=1;
  const cases=[
    ['missing',()=>response('missing',{status:404})],
    ['HTML fallback',()=>response('<html>not wasm</html>')],
    ['bad checksum',()=>response(Uint8Array.from(gzip,(x,i)=>i===gzip.length-5?x^1:x))],
    ['wrong version',()=>response(gzipSync(modified))],
    ['expansion bound',()=>response(gzipSync(new Uint8Array(100)))],
  ];
  for(const [name,compressedResponse] of cases)await t.test(name,async()=>{
    const requests=[];let metrics;
    const result=await loadWasmBinary(moduleURL,{artifact,fetchFn:async url=>{requests.push(String(url));return requests.length===1?compressedResponse():response(raw);},onMetrics:m=>{metrics=m;}});
    assert.deepEqual(result,raw);
    assert.equal(requests.length,2);
    assert.match(new URL(requests[1]).pathname,/\.wasm$/);
    assert.equal(metrics.source,'raw');
    assert.ok(metrics.fallbackReason);
  });
});

test('partial or different raw binaries fail before module creation, without repeated retries',async t=>{
  const changed=raw.slice();changed[changed.length-1]=1;
  for(const [name,makeResponse] of [
    ['206',()=>response(raw,{status:206,headers:{'Content-Range':'bytes 0-10/11'}})],
    ['different digest',()=>response(changed)],
    ['truncated',()=>response(raw.slice(0,8))],
  ])await t.test(name,async()=>{
    let requests=0;
    await assert.rejects(loadWasmBinary(moduleURL,{artifact,DecompressionStreamCtor:null,fetchFn:async()=>{requests++;return makeResponse();}}),/无法加载完整/);
    assert.equal(requests,1);
  });
});

test('an oversized streaming body is cancelled even if its advertised length is small',async()=>{
  let cancelled=false;
  const stream=new ReadableStream({pull(controller){controller.enqueue(new Uint8Array(32));},cancel(){cancelled=true;}});
  await assert.rejects(loadWasmBinary(moduleURL,{artifact,DecompressionStreamCtor:null,
    fetchFn:async()=>response(stream,{headers:{'Content-Length':'8'}})}),/超过预期大小/);
  assert.equal(cancelled,true);
});

test('invalid version metadata is rejected before any network request',async()=>{
  for(const corrupt of [{gzipBytes:NaN},{gzipBytes:'31'},{wasmBytes:Infinity},{moduleSha256:'bad'},{schemaVersion:9}]){
    let called=false;
    await assert.rejects(loadWasmBinary(moduleURL,{artifact:{...artifact,...corrupt},fetchFn:async()=>{called=true;return response(raw);}}),/元数据无效/);
    assert.equal(called,false);
  }
});
