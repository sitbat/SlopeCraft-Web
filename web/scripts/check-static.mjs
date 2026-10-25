import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {gunzipSync} from 'node:zlib';
const root=fileURLToPath(new URL('../dist/',import.meta.url));
const manifest=JSON.parse(await readFile(path.join(root,'release-manifest.json'),'utf8'));
const required=['index.html','favicon.svg','favicon.ico','assets/branding/apple-touch-icon.png','static-bootstrap.js','coi-serviceworker.js','browser-environment.js','wasm-loader.js','startup-resources.js','native-bridge.js','conversion-history.js','app.js','engine.js','engine-worker.js','runtime-cache.js','ui-archive.js','wasm/slopecraft.js','wasm/slopecraft.wasm','wasm/slopecraft.wasm.gz','wasm/wasm-integrity.js','assets/blocklists.json'];
const paths=new Set(manifest.files.map(file=>file.path));
for(const file of required)if(!paths.has(file))throw new Error(`Required runtime file missing from package: ${file}`);
if(!(await readFile(path.join(root,'index.html'),'utf8')).includes('src="./static-bootstrap.js"'))throw new Error('Static isolation bootstrap is not the page entry point');
for(const file of manifest.files){
  const bytes=await readFile(path.join(root,file.path));
  if(bytes.length!==file.bytes||createHash('sha256').update(bytes).digest('hex')!==file.sha256)throw new Error(`Static file integrity mismatch: ${file.path}`);
}
const raw=await readFile(path.join(root,'wasm/slopecraft.wasm'));
const gzip=await readFile(path.join(root,'wasm/slopecraft.wasm.gz'));
if(!WebAssembly.validate(raw))throw new Error('Invalid WASM module');
if(!gunzipSync(gzip).equals(raw))throw new Error('Compressed WASM does not match the raw module');
const integritySource=await readFile(path.join(root,'wasm/wasm-integrity.js'),'utf8');
const integrity=JSON.parse(integritySource.slice(integritySource.indexOf('export default ')+15).trim().replace(/;$/,''));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
if(integrity.schemaVersion!==1||integrity.wasmBytes!==raw.length||integrity.gzipBytes!==gzip.length||
  integrity.wasmSha256!==sha(raw)||integrity.gzipSha256!==sha(gzip)||
  integrity.moduleSha256!==sha(await readFile(path.join(root,'wasm/slopecraft.js'))))throw new Error('WASM integrity metadata does not match packaged artifacts');
console.log(JSON.stringify({files:manifest.files.length,allHashesValid:true,wasmValid:true,compressedWasmValid:true,wasmBytes:raw.length,gzipBytes:gzip.length}));
