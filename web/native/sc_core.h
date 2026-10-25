#pragma once
#include <stddef.h>
#include <stdint.h>
#ifdef __cplusplus
extern "C" {
#endif
// Synchronous API, invoked only by the application's engine Worker. `json` is
// UTF-8, `bytes` is optional input RGBA/ZIP. Return JSON is owned by the engine
// and valid until the next request. Always copy preview heap ranges immediately.
// No single-thread variant exists: the module is built with pthread + SIMD.
//
// {op:"init",threads:2..8,memoryBudgetMB:128..metadata.memoryMaxMiB}
// {op:"metadata"}
// {op:"loadBlocklist",name:string} + ZIP bytes
// {op:"blockIcon",key} -> 16x16 preview RGBA
// {op:"palette",options,blocks} -> {colors:[{mapId,rgb,baseColor,shade}]}
// {op:"testBlocklist",options,blocks,keys?,format?:"litematic"|"nbt"} -> files
// {op:"convert",id,width,height,options:{version,mapType,algorithm,dither,
//   pureTransparent,halfTransparent,backgroundColor,ga:{}},blocks:[{key,id,
//   baseColor,enabled}]} + row-major RGBA bytes
// {op:"build",id,options:{maxHeight,compression,glassBridge,bridgeInterval,
//   fireproof,enderproof,connectMushroom,supportBlock}}
// {op:"export",id,format,options:{beginIndex,name,regionName,
//   isAirStructureVoid,splitLineRowMargin,splitLineColMargin,pngCompression,
//   offset:[x,y,z],weOffset:[x,y,z],requiredMods:[],after1205,frameVariant,
//   mapFacing,fixedFrame,invisibleFrame,setNameAsIndex,stackCount}}
// {op:"clear",id?} / {op:"dispose"}
// {op:"cacheSave",id} -> {files:[{kind:"image"|"structure",path}],hasStructure}
// {op:"cacheRelease",id} -> release image/tensor, retain palette and task
// {op:"cacheLoad",id,imagePath,structurePath?} -> restore from MEMFS files
// {op:"releaseStructure",id} -> keep converted image, release dense tensor
//
// Result is {ok:true,data:{...}} or {ok:false,error:string}.
// Pointers/size_t in the direct JS ABI are BigInt; preview.pointer is a decimal
// string. Convert it to a Number only after checking the safe-integer range.
// metadata exposes memory64, pointerBits, memoryMaxBytes/MiB and heapBytes.
// preview={pointer,length,width,height} points to row-major RGBA bytes.
// exports={files:[{name,path,mime}]} are MEMFS files; caller reads and unlinks.
const char* sc_request(const char* json, const uint8_t* bytes, size_t length);
void* sc_allocate(size_t bytes);
void sc_deallocate(void* pointer);
#ifdef __cplusplus
}
#endif
