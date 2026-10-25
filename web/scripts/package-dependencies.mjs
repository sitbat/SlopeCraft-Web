import {readFile,writeFile,readdir,mkdir,cp,access} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createHash} from 'node:crypto';

const root=fileURLToPath(new URL('../../',import.meta.url));
const build=path.resolve(root,process.env.SC_BUILD_DIR || 'build/web64');
const cache=await readFile(path.join(build,'CMakeCache.txt'),'utf8').catch(error=>{if(error.code==='ENOENT')return '';throw error;});
function sourceDirectory(name){
  const match=cache.match(new RegExp(`^FETCHCONTENT_SOURCE_DIR_${name.toUpperCase()}:[^=]*=(.+)$`,'m'));
  return match?path.resolve(match[1].trim()):path.join(build,'_deps',`${name}-src`);
}
const packages=['eigen','heu','xsimd','cereal','json','magic_enum','boost','zlib','png','zstd','libzip','nbt'];
const sourceOutput=path.join(root,'web/dependency-sources');
const licenseOutput=path.join(root,'web/assets/licenses');
await mkdir(sourceOutput,{recursive:true});await mkdir(licenseOutput,{recursive:true});
const lock={dependencies:{}};
for(const name of packages){
  const source=sourceDirectory(name);
  await access(source);
  const candidates=[path.join(build,'_deps',`${name}-subbuild`,`${name}-populate-prefix/src`),
    path.join(path.dirname(source),`${name}-subbuild`,`${name}-populate-prefix/src`)];
  let download,filename;
  for(const candidate of candidates){
    const entries=await readdir(candidate).catch(error=>{if(error.code==='ENOENT')return [];throw error;});
    filename=entries.find(file=>/\.tar\.(gz|xz)$/.test(file));
    if(filename){download=candidate;break;}
  }
  if(!filename)throw new Error(`Dependency source archive missing: ${name}`);
  const archive=await readFile(path.join(download,filename));
  lock.dependencies[name]={archive:filename,sha256:createHash('sha256').update(archive).digest('hex')};
  const licenses=(await readdir(source)).filter(file=>/^(LICENSE|COPYING|COPYRIGHT|NOTICE|LICENSE_1_0)/i.test(file));
  await mkdir(path.join(licenseOutput,name),{recursive:true});
  for(const file of licenses){
    try {await cp(path.join(source,file),path.join(licenseOutput,name,file),{recursive:true});} catch(error){throw new Error(`Cannot package ${name} license: ${error.message}`);}
  }
  if(name!=='boost')await cp(path.join(download,filename),path.join(sourceOutput,`${name}-${filename}`));
}
// Ship every Boost source/header actually read by the compiler rather than its
// unrelated documentation, examples and tests (the full archive is >100 MB).
const ninja=process.env.NINJA || 'ninja';
const dependencies=spawnSync(ninja,['-C',build,'-t','deps'],{encoding:'utf8',maxBuffer:128*1024*1024,windowsHide:true});
if(dependencies.status!==0)throw new Error(`Cannot enumerate compiled dependency headers: ${dependencies.stderr}`);
const boostRoot=sourceDirectory('boost');
const boostFiles=new Set();
for(const line of dependencies.stdout.split(/\r?\n/)){
  const filename=line.trim();
  if(filename.replaceAll('\\','/').toLowerCase().startsWith(boostRoot.replaceAll('\\','/').toLowerCase()+'/'))boostFiles.add(filename);
}
boostFiles.add(path.join(boostRoot,'libs/iostreams/src/zstd.cpp'));
boostFiles.add(path.join(boostRoot,'LICENSE_1_0.txt'));
for(const filename of boostFiles){
  const target=path.join(sourceOutput,'boost-used',path.relative(boostRoot,filename));
  await mkdir(path.dirname(target),{recursive:true});await cp(filename,target);
}
if(process.env.EMSDK){
  const sdk=path.join(process.env.EMSDK,'upstream/emscripten');
  for(const [component,file] of [['emscripten','LICENSE'],['libcxx','system/lib/libcxx/LICENSE.TXT'],['libcxxabi','system/lib/libcxxabi/LICENSE.TXT'],['compiler-rt','system/lib/compiler-rt/LICENSE.TXT'],['musl','system/lib/libc/musl/COPYRIGHT']]){
    await mkdir(path.join(licenseOutput,component),{recursive:true});
    await cp(path.join(sdk,file),path.join(licenseOutput,component,path.basename(file)));
  }
}
await writeFile(path.join(root,'web/dependency-lock.json'),JSON.stringify(lock,null,2));
await writeFile(path.join(sourceOutput,'README.txt'),
  'Exact archives used for this build are included here (see ../dependency-lock.json).\n'+
  'boost-used contains the complete Boost source/header subset read by the compiler.\n'+
  'The build recipe pins all original download URLs. Emscripten/compiler standard libraries are supplied by the documented SDK.\n');
console.log(`Packaged 11 original dependency archives, ${boostFiles.size} used Boost files and all dependency licenses.`);
