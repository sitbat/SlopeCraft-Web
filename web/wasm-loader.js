/** Precompressed pthread WASM transport; the compiled engine is unchanged. GPL-3.0-or-later. */
import defaultArtifact from './wasm/wasm-integrity.js';

const MAX_WASM_BYTES=64*1024*1024;
const MAX_COMPRESSED_BYTES=16*1024*1024;
const now=()=>globalThis.performance?.now?.()??Date.now();
const isWasm=bytes=>bytes.length>=8&&bytes[0]===0&&bytes[1]===97&&bytes[2]===115&&bytes[3]===109&&bytes[4]===1&&bytes[5]===0&&bytes[6]===0&&bytes[7]===0;

export function versionedWasmModuleURL(moduleURL,artifact=defaultArtifact){
  const url=new URL(moduleURL,import.meta.url);
  url.searchParams.set('v',artifact.moduleSha256);
  return url;
}

async function readLimited(stream,limit,label){
  if(!stream?.getReader)throw new Error(`${label}没有可读取的响应内容。`);
  const reader=stream.getReader(),chunks=[];
  let size=0;
  try{
    for(;;){
      const {value,done}=await reader.read();
      if(done)break;
      size+=value.byteLength;
      if(size>limit)throw new Error(`${label}超过预期大小。`);
      chunks.push(value);
    }
  }catch(error){
    try{await reader.cancel(error);}catch{}
    throw error;
  }finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);
  let offset=0;
  for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  return bytes;
}

async function verify(bytes,artifact,cryptoAPI){
  if(!isWasm(bytes)||bytes.length!==artifact.wasmBytes)throw new Error('WASM 内容或大小与当前版本不匹配。');
  if(!cryptoAPI?.subtle?.digest)throw new Error('浏览器未提供安全的资源完整性校验。');
  const hash=new Uint8Array(await cryptoAPI.subtle.digest('SHA-256',bytes));
  const hex=Array.from(hash,x=>x.toString(16).padStart(2,'0')).join('');
  if(hex!==artifact.wasmSha256)throw new Error('WASM 校验失败，资源可能属于旧版本或已损坏。');
}

async function download(url,limit,fetchFn){
  const response=await fetchFn(url);
  if(response.status!==200||response.type==='opaque'||response.type==='opaqueredirect'||response.headers.has('content-range')){
    try{await response.body?.cancel();}catch{}
    throw new Error(`无法完整加载 WASM 资源（HTTP ${response.status}）。`);
  }
  if(response.redirected) {
    try{await response.body?.cancel();}catch{}
    throw new Error('WASM 资源发生重定向。');
  }
  const declared=Number(response.headers.get('content-length'));
  const bytes=await readLimited(response.body,limit,'WASM 下载');
  return {bytes,encodedContentLength:Number.isFinite(declared)&&declared>0?declared:null};
}

/** Gzip is an ordinary static file; no server Content-Encoding rule is required. */
export async function loadWasmBinary(moduleURL,{
  fetchFn=globalThis.fetch,
  DecompressionStreamCtor=globalThis.DecompressionStream,
  cryptoAPI=globalThis.crypto,
  artifact=defaultArtifact,
  onMetrics=()=>{},
}={}){
  if(artifact?.schemaVersion!==1||!Number.isSafeInteger(artifact.wasmBytes)||artifact.wasmBytes<8||artifact.wasmBytes>MAX_WASM_BYTES||
    !Number.isSafeInteger(artifact.gzipBytes)||artifact.gzipBytes<1||artifact.gzipBytes>MAX_COMPRESSED_BYTES||
    !/^[a-f0-9]{64}$/.test(artifact.wasmSha256)||!/^[a-f0-9]{64}$/.test(artifact.moduleSha256)){
    throw new Error('WASM 版本元数据无效，请重新生成完整部署包。');
  }
  const start=now();
  const rawURL=new URL('slopecraft.wasm',moduleURL);
  const gzipURL=new URL('slopecraft.wasm.gz',moduleURL);
  rawURL.searchParams.set('v',artifact.wasmSha256);
  gzipURL.searchParams.set('v',artifact.wasmSha256);
  let fallbackReason=null;
  const report=metrics=>{
    try{onMetrics({...metrics,totalMs:now()-start,fallbackReason});}catch{}
  };
  if(typeof DecompressionStreamCtor==='function'){
    try{
      const fetchStart=now();
      const inputLimit=Math.min(MAX_COMPRESSED_BYTES,Math.max(artifact.wasmBytes,artifact.gzipBytes||0));
      const {bytes:input,encodedContentLength}=await download(gzipURL,inputLimit,fetchFn);
      const downloadMs=now()-fetchStart;
      let bytes=input,decompressMs=0,source='decoded-gzip-response';
      // Some hosts already decode .gz through Content-Encoding. Inspect the
      // actual bytes instead of interpreting that header a second time.
      if(!isWasm(input)){
        if(input.length<2||input[0]!==31||input[1]!==139)throw new Error('压缩核心不是有效的 gzip 文件。');
        const decompressStart=now();
        const stream=new Blob([input]).stream().pipeThrough(new DecompressionStreamCtor('gzip'));
        bytes=await readLimited(stream,artifact.wasmBytes,'WASM 解压结果');
        decompressMs=now()-decompressStart;
        source='gzip';
      }
      const verifyStart=now();
      await verify(bytes,artifact,cryptoAPI);
      report({source,bodyBytes:input.length,encodedContentLength,decodedBytes:bytes.length,downloadMs,decompressMs,verifyMs:now()-verifyStart});
      return bytes;
    }catch(error){fallbackReason=String(error?.message||error);}
  }else{fallbackReason='DecompressionStream unavailable';}
  try{
    const fetchStart=now();
    const {bytes,encodedContentLength}=await download(rawURL,artifact.wasmBytes,fetchFn);
    const downloadMs=now()-fetchStart,verifyStart=now();
    await verify(bytes,artifact,cryptoAPI);
    report({source:'raw',bodyBytes:bytes.length,encodedContentLength,decodedBytes:bytes.length,downloadMs,decompressMs:0,verifyMs:now()-verifyStart});
    return bytes;
  }catch(error){
    throw new Error(`无法加载完整的多线程 WASM 核心：${error?.message||error}`,{cause:error});
  }
}
