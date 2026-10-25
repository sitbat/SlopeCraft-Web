import path from 'node:path';
import {readdir,readFile} from 'node:fs/promises';

const roots=new Set(['.github','Blocks_SCL','SlopeCraft','SlopeCraftL','docs','license-translations','utilities']);
const rootFiles=new Set(['.clang-format','.gitattributes','.gitignore','LICENSE','package.json','package-lock.json','README.md','README-en.md','CHANGELOG.md','CONTRIBUTING.md','SECURITY.md','UPSTREAM.md']);
const webFiles=new Set(['index.html','static-bootstrap.js','coi-serviceworker.js','browser-environment.js','wasm-loader.js','startup-resources.js','app.js','engine.js','engine-worker.js','runtime-cache.js','styles.css','ui-archive.js','CMakeLists.txt','dependency-lock.json','README.md','THIRD_PARTY_NOTICES.md']);
const excludedDirectories=new Set(['.git','node_modules','build','dist','wasm','.cache','work','__pycache__']);
const sensitive=/^(?:\.env(?:\..*)?|\.npmrc|\.pypirc|credentials(?:\..*)?|secrets?(?:\..*)?|id_(?:rsa|ed25519|ecdsa)(?:\..*)?)$|\.(?:pem|p12|pfx|key)$/i;

function approved(relative){
  const parts=relative.split('/');
  if(parts.some(part=>excludedDirectories.has(part)||sensitive.test(part)))return false;
  if(parts.length===1)return rootFiles.has(relative)||roots.has(relative)||relative==='web';
  if(roots.has(parts[0]))return true;
  if(parts[0]!=='web')return false;
  if(parts[1]==='assets')return parts.length===2||parts[2]==='licenses';
  if(parts[1]==='test-results')return parts.length===2||(parts.length===3&&['benchmark-node.json','verification.json'].includes(parts[2]));
  if(['native','scripts','tests','dependency-sources'].includes(parts[1]))return true;
  return parts.length===2&&webFiles.has(parts[1]);
}

/** Collect public project sources only; independent of Git being installed. */
export async function collectSourceFiles(root,{buildDirectory}={}){
  const checkout=path.resolve(root);
  const build=buildDirectory?path.resolve(checkout,buildDirectory):null;
  async function walk(dir){
    const files=[];
    for(const entry of (await readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
      const absolute=path.join(dir,entry.name);
      if(build&&(absolute===build||absolute.startsWith(build+path.sep)))continue;
      const name=path.relative(checkout,absolute).split(path.sep).join('/');
      if(!approved(name))continue;
      if(entry.isDirectory())files.push(...await walk(absolute));
      else if(entry.isFile())files.push({name,data:await readFile(absolute)});
    }
    return files;
  }
  return walk(checkout);
}
