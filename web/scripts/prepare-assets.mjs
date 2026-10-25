import {readFile, writeFile, readdir, mkdir, cp} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {zip} from './zip.mjs';
import {resetGeneratedDirectory} from './generated-files.mjs';
import './prepare-wasm.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const assets = path.join(root, 'web/assets');
function parseJsonWithComments(text) {
  let clean = '', quote = false, escape = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], next = text[i + 1];
    if (quote) {
      clean += c;
      if (escape) escape = false;
      else if (c === '\\') escape = true;
      else if (c === '"') quote = false;
    } else if (c === '"') { quote = true; clean += c; }
    else if (c === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      clean += '\n';
    } else if (c === '/' && next === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i++;
    } else clean += c;
  }
  return JSON.parse(clean.replace(/^\uFEFF/, ''));
}
for(const folder of ['blocks','blocklists','presets'])await resetGeneratedDirectory(root,`web/assets/${folder}`);
const groups = [];
for (const name of ['FixedBlocks', 'CustomBlocks', 'QuarkModBlocks']) {
  const source = path.join(root, 'Blocks_SCL', name);
  const list = parseJsonWithComments(await readFile(path.join(source, 'block_list.json'), 'utf8'));
  let metadata = {};
  try { metadata = parseJsonWithComments(await readFile(path.join(source, 'metainfo.json'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const entries = [];
  for (const file of (await readdir(source)).sort()) {
    if (!file.endsWith('.png') && !file.endsWith('.json')) continue;
    entries.push({name: file, data: await readFile(path.join(source, file))});
  }
  await writeFile(path.join(assets, 'blocklists', `${name}.zip`), zip(entries));
  const target=path.join(assets,'blocks',name);
  await mkdir(target,{recursive:true});
  for(const entry of entries)await writeFile(path.join(target,entry.name),entry.data);
  groups.push({name, requiredMods: metadata['required mods'] || [], blocks: list.map(block => ({...block,
    nameZH: (metadata['name prefix']?.ZH || '') + block.nameZH,
    nameEN: (metadata['name prefix']?.EN || '') + block.nameEN, group: name,
    iconUrl: `./assets/blocks/${name}/${block.icon}`}))});
}
const colorSource = await readFile(path.join(root, 'SlopeCraftL/color_source.cpp'), 'utf8');
const values = [...colorSource.slice(colorSource.indexOf('const float RGBBasicSource[256 * 3] =')).matchAll(/(\d+)\s*\/\s*255\.0f/g)].map(x => Number(x[1]));
if (values.length !== 768) throw new Error(`Expected 768 upstream color entries, got ${values.length}`);
const baseColors = Array.from({length:64}, (_, i) => [values[128 + i], values[256 + 128 + i], values[512 + 128 + i]]);
await writeFile(path.join(assets, 'blocklists.json'), JSON.stringify({groups, blocks: groups.flatMap(g => g.blocks), baseColors}));
for(const name of ['vanilla','cheap','elegant','shiny'])await cp(path.join(root,'SlopeCraft/others/presets',`${name}.sc_preset_json`),path.join(assets,'presets',`${name}.sc_preset_json`));
await cp(path.join(root, 'LICENSE'), path.join(assets, 'LICENSE.txt'));
console.log(`Prepared ${groups.length} block libraries, ${groups.reduce((n,g)=>n+g.blocks.length,0)} blocks, 4 presets and original palette.`);
