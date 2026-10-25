import {readFile, writeFile, readdir, mkdir, cp, stat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {zip} from './zip.mjs';
import './prepare-assets.mjs';
import {resetGeneratedDirectory} from './generated-files.mjs';
import {collectSourceFiles} from './source-files.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const web = path.join(root, 'web'), dist = path.join(web, 'dist');
await stat(path.join(web,'dependency-sources/README.txt')).catch(()=>{throw new Error('Complete dependency sources are missing. Run build:wasm then build:deps before creating a release package. For local preview, use npm run preview.');});
await resetGeneratedDirectory(root,'web/dist');
for (const entry of await readdir(web, {withFileTypes:true})) {
  if (entry.isFile() && /\.(html|css|js|svg|ico|webmanifest)$/.test(entry.name)) await cp(path.join(web,entry.name), path.join(dist,entry.name));
}
for (const dir of ['assets', 'wasm']) await cp(path.join(web,dir),path.join(dist,dir),{recursive:true});
if ((await stat(path.join(dist,'wasm/slopecraft.wasm'))).size < 1000) throw new Error('WASM core is missing or invalid; run build:wasm first.');
await cp(path.join(root,'LICENSE'),path.join(dist,'LICENSE.txt'));
await cp(path.join(web,'README.md'),path.join(dist,'README.md'));
await cp(path.join(web,'THIRD_PARTY_NOTICES.md'),path.join(dist,'THIRD_PARTY_NOTICES.md'));
await mkdir(path.join(dist,'verification'),{recursive:true});
const reports=await readdir(path.join(web,'test-results')).catch(error=>{if(error.code==='ENOENT')return [];throw error;});
for(const file of reports){
  if(file.endsWith('.json'))await cp(path.join(web,'test-results',file),path.join(dist,'verification',file));
}
async function walk(dir, base = dir, excluded = new Set()) {
  const files = [];
  for (const entry of (await readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))) {
    if (excluded.has(entry.name)) continue;
    const absolute = path.join(dir,entry.name), name=path.relative(base,absolute).split(path.sep).join('/');
    if(entry.isDirectory()) files.push(...await walk(absolute,base,excluded));
    else if(entry.isFile()) files.push({name,data:await readFile(absolute)});
  }
  return files;
}
// Provide the exact modified project source beside the distributed executable.
const sourceFiles = await collectSourceFiles(root,{buildDirectory:process.env.SC_BUILD_DIR || 'build/web'});
await writeFile(path.join(dist,'SlopeCraft-Web-source.zip'),zip(sourceFiles));
const files = (await walk(dist)).filter(file=>file.name!=='release-manifest.json');
const manifest = {version:'5.4.1-web.1',upstream:'d4cda09853fe83141e155cb3a5280ce22ad9cd3a',
  engine:'C++23 / WebAssembly SIMD / pthreads',files:files.map(({name,data})=>({path:name,bytes:data.length,sha256:createHash('sha256').update(data).digest('hex')}))};
await writeFile(path.join(dist,'release-manifest.json'),JSON.stringify(manifest,null,2));
const artifact = path.join(root,'..','SlopeCraft-Web-static.zip');
await writeFile(artifact,zip(await walk(dist)));
console.log(`Static website: ${dist}\nDeployment archive: ${artifact}\n${files.length} files, no server-side runtime.`);
