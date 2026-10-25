import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,access} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {collectSourceFiles} from '../scripts/source-files.mjs';
import {resetGeneratedDirectory} from '../scripts/generated-files.mjs';

const scratch=path.resolve(fileURLToPath(new URL('../../work/',import.meta.url)));
async function fixture(t){
  await mkdir(scratch,{recursive:true});
  const root=await mkdtemp(path.join(scratch,'package-'));
  t.after(async()=>{if(!path.resolve(root).startsWith(scratch+path.sep))throw new Error('Unsafe fixture cleanup');await rm(root,{recursive:true,force:true});});
  async function put(name,data='fixture'){const file=path.join(root,name);await mkdir(path.dirname(file),{recursive:true});await writeFile(file,data);}
  return {root,put};
}

test('source archive includes public source and licenses, excluding credentials and generated/private directories',async t=>{
  const {root,put}=await fixture(t);
  const included=['package.json','LICENSE','.github/workflows/web.yml','SlopeCraftL/core.cpp','web/app.js','web/assets/licenses/zlib/LICENSE','web/dependency-sources/zlib.tar.gz','web/test-results/verification.json'];
  const excluded=['.git/config','.env','.npmrc','work/private-notes.md','private-folder/notes.md','web/.env.production','web/native/private.pem','web/native/credentials.json','web/local-debug.log','web/dist/old.js','web/wasm/core.wasm','web/test-results/browser-export.litematic','web/assets/blocks/copied.png'];
  for(const name of [...included,...excluded])await put(name);
  const files=await collectSourceFiles(root);
  assert.deepEqual(files.map(file=>file.name).sort(),included.sort());
});

test('source archive excludes a configured build directory inside an otherwise approved source folder',async t=>{
  const {root,put}=await fixture(t);
  await put('web/native/sc_core.cpp');
  await put('web/native/local-build/generated.cpp');
  const files=await collectSourceFiles(root,{buildDirectory:'web/native/local-build'});
  assert.deepEqual(files.map(file=>file.name),['web/native/sc_core.cpp']);
});

test('output reset removes stale generated files and refuses unapproved or non-directory paths',async t=>{
  const {root,put}=await fixture(t);
  await put('web/dist/stale.js');
  await put('web/app.js','source must survive');
  await resetGeneratedDirectory(root,'web/dist');
  await assert.rejects(access(path.join(root,'web/dist/stale.js')),{code:'ENOENT'});
  assert.equal(await readFile(path.join(root,'web/app.js'),'utf8'),'source must survive');
  await assert.rejects(resetGeneratedDirectory(root,'web'),/Not a generated/);
  await put('web/assets/presets','do not delete this file');
  await assert.rejects(resetGeneratedDirectory(root,'web/assets/presets'),/not a directory/);
  assert.equal(await readFile(path.join(root,'web/assets/presets'),'utf8'),'do not delete this file');
});
