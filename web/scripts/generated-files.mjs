import path from 'node:path';
import {mkdir,realpath,lstat,rm} from 'node:fs/promises';

const approved=new Set(['web/dist','web/assets/blocks','web/assets/blocklists','web/assets/presets']);

/** Reset only an explicitly approved generated directory inside this checkout. */
export async function resetGeneratedDirectory(root,relative){
  if(!approved.has(relative))throw new Error(`Not a generated output directory: ${relative}`);
  const workspace=await realpath(root);
  const target=path.resolve(root,relative);
  await mkdir(path.dirname(target),{recursive:true});
  const parent=await realpath(path.dirname(target));
  if(!parent.startsWith(workspace+path.sep)||!target.startsWith(path.resolve(root)+path.sep))throw new Error(`Output is outside checkout: ${target}`);
  try{
    const info=await lstat(target);
    if(info.isSymbolicLink())throw new Error(`Refusing to replace a linked output: ${target}`);
    if(!info.isDirectory())throw new Error(`Output path is not a directory: ${target}`);
    const resolved=await realpath(target);
    if(!resolved.startsWith(workspace+path.sep))throw new Error(`Resolved output is outside checkout: ${resolved}`);
  }catch(error){if(error.code!=='ENOENT')throw error;}
  await rm(target,{recursive:true,force:true});
  await mkdir(target,{recursive:true});
  return target;
}
