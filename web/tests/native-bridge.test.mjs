import test from 'node:test';
import assert from 'node:assert/strict';

test('native JSON decoding copies shared heap bytes for strict browser TextDecoder APIs',async()=>{
  const OriginalTextDecoder=globalThis.TextDecoder;
  let calls=0;
  try{
    globalThis.TextDecoder=class extends OriginalTextDecoder{
      decode(input,options){
        assert.ok(!(input.buffer instanceof SharedArrayBuffer),'browser decoder received a shared view');
        calls++;
        return super.decode(input,options);
      }
    };
    const {readNativeJSON}=await import('../native-bridge.js?strict-browser-decoder');
    const heap=new Uint8Array(new SharedArrayBuffer(256));
    heap.set(new TextEncoder().encode('{"ok":true,"data":{"text":"地图画"}}'),1);
    const value=readNativeJSON({wasmMemory:{buffer:heap.buffer},HEAPU8:heap},1n);
    assert.equal(value.ok,true);
    assert.equal(value.data.text,'地图画');
    assert.equal(calls,1);
  }finally{globalThis.TextDecoder=OriginalTextDecoder;}
});
