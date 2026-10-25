/** True Memory64 ABI: BigInt pointers at the native boundary, checked indices at JS heap views. */
const encoder=new TextEncoder(),decoder=new TextDecoder();
const MAX_JSON_BYTES=16*1024*1024;

export function heapIndex(value,label='内存地址'){
  let pointer;
  if(typeof value==='bigint')pointer=value;
  else if(typeof value==='string'&&/^[0-9]+$/.test(value))pointer=BigInt(value);
  else if(Number.isSafeInteger(value)&&value>=0)pointer=BigInt(value);
  else throw new Error(`${label}不是有效的整数。`);
  if(pointer<0n||pointer>BigInt(Number.MAX_SAFE_INTEGER))throw new Error(`${label}超出 JavaScript 可精确索引的范围。`);
  return Number(pointer);
}

function allocate(core,length){
  if(!Number.isSafeInteger(length)||length<0)throw new Error('分配字节数无效。');
  const pointer=core._sc_allocate(BigInt(length));
  if(typeof pointer!=='bigint')throw new Error('核心未提供 Memory64 BigInt 指针 ABI。');
  if(pointer===0n)throw new Error('浏览器内存不足，无法传入请求或图像。');
  return pointer;
}

function checkedRange(heap,pointer,length){
  const start=heapIndex(pointer);
  if(!Number.isSafeInteger(length)||length<0||start>heap.length||length>heap.length-start)
    throw new Error('核心内存范围无效。');
  return start;
}

// A pthread can grow shared memory without refreshing another realm's exported
// HEAPU8 property. Read the current buffer instead of keeping that stale length.
export function heapView(core){
  const buffer=core.wasmMemory?.buffer,heap=core.HEAPU8;
  if(buffer&&(heap?.buffer!==buffer||heap.byteLength!==buffer.byteLength))return new Uint8Array(buffer);
  if(!(heap instanceof Uint8Array))throw new Error('核心尚未提供有效的内存视图。');
  return heap;
}

export function readNativeJSON(core,pointer){
  const heap=heapView(core),start=checkedRange(heap,pointer,1);
  const window=heap.subarray(start,Math.min(heap.length,start+MAX_JSON_BYTES));
  const end=window.indexOf(0);
  if(end<0)throw new Error('核心响应缺少有效的字符串终止符。');
  // Browser TextDecoder rejects SharedArrayBuffer-backed input views. Copy the
  // bounded response into an ordinary buffer before decoding (Node is looser).
  return JSON.parse(decoder.decode(window.slice(0,end)));
}

/** Calls direct i64 exports; never uses Number-based ccall/malloc compatibility wrappers. */
export function invokeNativeJSON(core,payload,inputBytes){
  if(typeof core?._sc_allocate!=='function'||typeof core?._sc_deallocate!=='function')
    throw new Error('Memory64 核心尚未就绪或静态资源版本不一致。');
  const request=encoder.encode(JSON.stringify(payload));
  const input=inputBytes==null?new Uint8Array():inputBytes instanceof Uint8Array?inputBytes:new Uint8Array(inputBytes);
  let requestPointer=0n,inputPointer=0n;
  try{
    requestPointer=allocate(core,request.length+1);
    if(input.byteLength)inputPointer=allocate(core,input.byteLength);
    // Both allocations may grow shared memory. Re-read the current view after
    // them and after the native call; old shared views keep their old length.
    const heap=heapView(core);
    const requestStart=checkedRange(heap,requestPointer,request.length+1);
    heap.set(request,requestStart);heap[requestStart+request.length]=0;
    if(input.byteLength)heap.set(input,checkedRange(heap,inputPointer,input.byteLength));
    const responsePointer=core._sc_request(requestPointer,inputPointer,BigInt(input.byteLength));
    if(typeof responsePointer!=='bigint'||responsePointer===0n)throw new Error('Memory64 核心未返回有效的响应地址。');
    return readNativeJSON(core,responsePointer);
  }finally{
    if(inputPointer!==0n)core._sc_deallocate(inputPointer);
    if(requestPointer!==0n)core._sc_deallocate(requestPointer);
  }
}

export function copyNativePreview(core,preview){
  const {pointer,length,width,height}=preview;
  if(!Number.isSafeInteger(width)||width<0||!Number.isSafeInteger(height)||height<0||
    !Number.isSafeInteger(width*height*4)||length!==width*height*4)
    throw new Error('核心返回了无效的预览图像。');
  const heap=heapView(core),start=checkedRange(heap,pointer,length);
  return heap.slice(start,start+length);
}
