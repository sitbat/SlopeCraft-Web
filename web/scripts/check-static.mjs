import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import path from 'node:path';
const root=fileURLToPath(new URL('../dist/',import.meta.url));
const manifest=JSON.parse(await readFile(path.join(root,'release-manifest.json'),'utf8'));
const required=['index.html','static-bootstrap.js','coi-serviceworker.js','browser-environment.js','app.js','engine.js','engine-worker.js','runtime-cache.js','ui-archive.js','wasm/slopecraft.js','wasm/slopecraft.wasm','assets/blocklists.json'];
const paths=new Set(manifest.files.map(file=>file.path));
for(const file of required)if(!paths.has(file))throw new Error(`Required runtime file missing from package: ${file}`);
if(!(await readFile(path.join(root,'index.html'),'utf8')).includes('src="./static-bootstrap.js"'))throw new Error('Static isolation bootstrap is not the page entry point');
for(const file of manifest.files){
  const bytes=await readFile(path.join(root,file.path));
  if(bytes.length!==file.bytes||createHash('sha256').update(bytes).digest('hex')!==file.sha256)throw new Error(`Static file integrity mismatch: ${file.path}`);
}
if(!WebAssembly.validate(await readFile(path.join(root,'wasm/slopecraft.wasm'))))throw new Error('Invalid WASM module');
console.log(JSON.stringify({files:manifest.files.length,allHashesValid:true,wasmValid:true}));
