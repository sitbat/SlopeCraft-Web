import {EngineClient} from './engine.js';
import {zipStore} from './ui-archive.js';

const $ = id => document.getElementById(id);
const $$ = selector => [...document.querySelectorAll(selector)];
const version = () => Number($('game-version').value);
const radio = name => document.querySelector(`input[name="${name}"]:checked`)?.value;
const checked = id => $(id).checked;
const value = id => $(id).value;
const number = (id, min = -2147483648, max = 2147483647) => {
  const control = $(id), n = Number(control.value);
  if (!Number.isFinite(n) || n < min || n > max) throw new Error(`${control.closest('label')?.textContent?.trim() || id} 的数值无效。`);
  return n;
};
const formatNumber = n => Number(n || 0).toLocaleString('zh-CN');
const stem = name => name.replace(/\.[^.]+$/, '') || 'SlopeCraft';
const safeName = name => String(name || 'SlopeCraft').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 140);
const text = (tag, content, className) => {const el = document.createElement(tag); el.textContent = content; if (className) el.className = className; return el;};
const state = {
  tab: 'config', preview: 'original', tasks: [], selected: new Set(), active: null,
  blocks: [], groups: [], baseColors: [], selections: new Map(), enabledGroups: new Set(['FixedBlocks']),
  presets: {}, preset: 'vanilla', client: null, metadata: {}, ready: false, busy: false,
  cancelled: false, progressPhase: 'convert', settingsRestored: false, toastTimeout: null,
  operationIndex: 0, operationTotal: 1, pendingSaved: null,
  commandPreviewTimer: null, commandPreviewSequence: 0,
  palette: null,
};
const baseColorNames = ['透明 / 辅助','草绿','沙色','羊毛白','火红','冰蓝','金属灰','植物绿','雪白','黏土','泥土','石灰','水蓝','木色','石英白','橙色','品红','淡蓝','黄色','黄绿','粉红','灰色','淡灰','青色','紫色','蓝色','棕色','绿色','红色','黑色','金色','钻石','青金石','绿宝石','灰化土','地狱岩','白色陶瓦','橙色陶瓦','品红陶瓦','淡蓝陶瓦','黄色陶瓦','黄绿陶瓦','粉红陶瓦','灰色陶瓦','淡灰陶瓦','青色陶瓦','紫色陶瓦','蓝色陶瓦','棕色陶瓦','绿色陶瓦','红色陶瓦','黑色陶瓦','绯红菌岩','绯红菌柄','绯红菌核','诡异菌岩','诡异菌柄','诡异菌核','诡异疣块','深板岩','粗铁','发光地衣'];
const groupNames = {FixedBlocks: '原版方块', CustomBlocks: '更多原版方块', QuarkModBlocks: 'Quark Mod 方块'};
const presetNames = {vanilla: '原版', cheap: '廉价', elegant: '优雅', shiny: '发光', custom: '自定义'};
const configControlIds = ['game-version','dither','pure-transparent','half-transparent','background-color','ga-population','ga-generations','ga-failures','ga-crossover','ga-mutation'];
const buildControlIds = ['compress-lossless','compress-lossy','max-height','glass-bridge','bridge-interval','fireproof','enderproof','connect-mushroom','support-block'];
const settingsIds = [...configControlIds,...buildControlIds,'show-thumbnails','thread-count','memory-budget','cache-enabled','smooth-preview','litematic-name','region-name','air-void','schem-name','required-mods','offset-x','offset-y','offset-z','weoffset-x','weoffset-y','weoffset-z','diagram-hline','diagram-vline','diagram-hmargin','diagram-vmargin','map-start-id','modern-items','map-stack-count','map-name-index','glowing-frames','invisible-frames','fixed-frames','map-direction','assembled-format','resize-smooth'];

function status(message) {$('status-text').textContent = message;}
function notify(message, error = false) {
  const toast = $('toast'); toast.textContent = message; toast.classList.toggle('error', error); toast.hidden = false;
  clearTimeout(state.toastTimeout); state.toastTimeout = setTimeout(() => {toast.hidden = true;}, error ? 7000 : 4200);
  status(message);
}
function handleError(error) {console.error(error); notify(error?.message || String(error), true);}
function activeTask() {return state.tasks.find(task => task.id === state.active) || null;}
function selectedTasks(all = false) {return all ? [...state.tasks] : state.tasks.filter(task => state.selected.has(task.id));}
function setTab(tab) {
  state.tab = tab;
  for (const button of $$('[data-tab]')) button.setAttribute('aria-selected', String(button.dataset.tab === tab));
  for (const panel of $$('.tab-panel')) panel.hidden = panel.id !== `panel-${tab}`;
  if (tab === 'convert') renderPreview();
  if (tab === 'export') {renderBuild(); renderMapRanges();}
}
function setBusy(busy) {
  state.busy = busy; state.cancelled = false;
  $('cancel-operation').hidden = !busy; $('cancel-operation').disabled = false;
  updateButtons();
  // Configuration changes during a native call would make its result ambiguous.
  for (const control of $$('#panel-config input, #panel-config select, #panel-config button, .algorithm-bar input, #transparent-dialog input, #transparent-dialog select, #ga-dialog input, #structure-options input, #structure-options select')) control.disabled = busy || control.dataset.unavailable === 'true';
}
function updateButtons() {
  const task = activeTask(), any = state.tasks.length > 0, busy = state.busy;
  for (const button of $$('[data-engine]')) button.disabled = !state.ready || busy || !any;
  for (const button of $$('[data-engine-tool]')) button.disabled = !state.ready || busy;
  $('convert-current').disabled ||= !task;
  $('replace-image').disabled = busy || !state.selected.size;
  $('remove-image').disabled = busy || !state.selected.size;
  $('resize-image').disabled = busy || !task;
  $('save-converted').disabled = busy || !task?.converted || task.stale;
  $('preview-materials').disabled = busy || !task?.built || task.buildStale || task.stale;
  $('restore-image').disabled = busy || !task;
  $('apply-settings').disabled = busy;
  $('refresh-cache').disabled = busy || !state.ready;
  $('clear-cache').disabled = busy || !state.ready;
  const glowingAvailable = version() >= 17;
  if (!glowingAvailable) $('glowing-frames').checked = false;
  $('glowing-frames').disabled = busy || !glowingAvailable;
  $('glowing-frames').closest('label').title = glowingAvailable ? '' : '荧光物品展示框需要 Minecraft 1.17 或更新版本。';
  $('add-image').disabled = busy;
  $('export-current').disabled ||= !state.selected.size;
  $('export-commands').disabled ||= !state.selected.size;
  $('export-assembled').disabled ||= !state.selected.size;
  if (radio('map-type') === 'file') {
    $('build-structure').disabled = true; $('preview-compression').disabled = true;
  }
}
function captureSettings() {
  const controls = {};
  for (const id of settingsIds) {const el = $(id); controls[id] = el.type === 'checkbox' ? el.checked : el.value;}
  return {app:'SlopeCraft-Web', schemaVersion:1, controls, mapType:radio('map-type'), algorithm:radio('algorithm'), exportFormat:radio('export-format'),
    preset:state.preset, blocks:[...state.selections].map(([baseColor,item])=>({baseColor,blockId:item.id,enabled:item.enabled})),
    enabledGroups:[...state.enabledGroups]};
}
function persist() {
  if (!state.settingsRestored) return;
  try {localStorage.setItem('slopecraft-web:settings:v1',JSON.stringify(captureSettings()));} catch(error) {status('浏览器储存空间不足，设置无法自动保存。');}
}
function restoreSettings(saved) {
  if (!saved || saved.schemaVersion !== 1 || saved.app !== 'SlopeCraft-Web') throw new Error('这不是兼容的 SlopeCraft Web 设置文件。');
  for (const id of settingsIds) {
    if (!(id in (saved.controls || {}))) continue;
    const el = $(id), val = saved.controls[id];
    if (el.type === 'checkbox') el.checked = val === true;
    else if (typeof val === 'string' || typeof val === 'number') {
      const legacyTransparency = {'pure-transparent': {background:'B',air:'A'}, 'half-transparent': {compose:'C',background:'B',ignore:'R'}};
      el.value = legacyTransparency[id]?.[val] || String(val);
    }
  }
  for (const [name,val] of [['map-type',saved.mapType],['algorithm',saved.algorithm],['export-format',saved.exportFormat]]) {
    const el = $$(`input[name="${name}"]`).find(input=>input.value===val); if (el) el.checked = true;
  }
  if (Array.isArray(saved.enabledGroups)) state.enabledGroups = new Set(saved.enabledGroups.filter(name=>typeof name==='string'));
  state.enabledGroups.add('FixedBlocks');
  if (Array.isArray(saved.blocks)) applyBlockPreset(saved.blocks, false);
  state.preset = presetNames[saved.preset] ? saved.preset : 'custom';
  applyVisualSettings(); syncMapType(); renderBlocks(); renderBlocklistChoices(); syncFormat();
}
function applyVisualSettings() {
  $('preview-area').classList.toggle('smooth',checked('smooth-preview'));
  for (const queue of $$('.queue')) queue.classList.toggle('thumbnails-off',!checked('show-thumbnails'));
}
function download(blob, name) {
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = safeName(name); document.body.append(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),60000);
}
function downloadJson(data,name) {download(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),name);}
async function downloadFiles(files, name='SlopeCraft-export.zip') {
  if (!files.length) throw new Error('转换核心未生成任何文件。');
  if (files.length === 1) {const file=files[0]; download(new Blob([file.data],{type:file.mime||'application/octet-stream'}),file.name);}
  else download(await zipStore(files),name);
}

function minimumVersion(block) {
  const v = block.version;
  if (typeof v === 'number') return v;
  if (!v || v === 'ANCIENT') return 0;
  const metadataVersion = (state.metadata.versions || []).find(item=>item.key===v || item.enum===v || item.name===v);
  if (metadataVersion) return Number(metadataVersion.value);
  if (v === 'MC26_1') return 4790;
  if (v === 'MC26_2') return 4903;
  return Number(String(v).replace(/^MC/, '').replace('_','.')) || 0;
}
function availableBlocks(baseColor) {
  return state.blocks.filter(block=>Number(block.baseColor)===baseColor && state.enabledGroups.has(block.group||'FixedBlocks') && minimumVersion(block)<=version());
}
function allowedBaseColor(baseColor) {
  if (baseColor>=62) return false;
  if (baseColor>=59 && version()<17) return false;
  if (baseColor>=52 && version()<16) return false;
  // In flat maps, water is the only way to obtain its own base color. The core
  // is authoritative about exact palette availability and returns its count.
  return true;
}
function normalizeSelections() {
  for (let bc=0;bc<62;bc++) {
    const blocks=availableBlocks(bc), current=state.selections.get(bc);
    if (!current) state.selections.set(bc,{id:blocks[0]?.id||'',enabled:true});
    else if (!blocks.some(block=>block.id===current.id)) current.id=blocks[0]?.id||'';
  }
}
function selectionPayload() {
  normalizeSelections();
  return [...state.selections].map(([baseColor,item])=>{
    const block=availableBlocks(baseColor).find(block=>block.id===item.id);
    return {baseColor,id:item.id,...(Number.isInteger(block?.key)?{key:block.key}:{}),enabled:Boolean(item.enabled && allowedBaseColor(baseColor) && item.id)};
  });
}
function markCustom() {state.preset='custom';persist();renderPresetState();}
function renderPresetState() {
  for (const button of $$('[data-preset]')) button.classList.toggle('active',state.preset===button.dataset.preset);
  $('preset-current').textContent=`当前：${presetNames[state.preset]||'自定义'}`;
  const count=selectionPayload().filter(item=>item.enabled&&item.baseColor>0).length;
  $('available-count').textContent=`已启用 ${count} 种基础颜色`;
  $('block-summary').textContent=`${count} 种基础颜色`;
  $('blocklists-summary').textContent=[...state.enabledGroups].map(name=>groupNames[name]||name).join('、');
}
function renderBlocks() {
  normalizeSelections();
  const query=value('block-search').trim().toLowerCase(), fragment=document.createDocumentFragment();
  for(let bc=0;bc<62;bc++) {
    const blocks=availableBlocks(bc), selected=state.selections.get(bc), block=blocks.find(item=>item.id===selected.id)||blocks[0];
    const matches=!query || `${String(bc).padStart(2,'0')} ${baseColorNames[bc]} ${blocks.map(b=>`${b.id} ${b.nameZH} ${b.nameEN}`).join(' ')}`.toLowerCase().includes(query);
    if(!matches)continue;
    const enabled=allowedBaseColor(bc)&&blocks.length>0;
    const row=document.createElement('div');row.className=`block-row${selected.enabled?'':' disabled'}${enabled?'':' unavailable'}`;
    const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.checked=selected.enabled;checkbox.disabled=!enabled||state.busy;
    checkbox.dataset.unavailable=String(!enabled);checkbox.setAttribute('aria-label',`启用基础颜色 ${bc} ${baseColorNames[bc]}`);
    checkbox.addEventListener('change',()=>{selected.enabled=checkbox.checked;markCustom();invalidateConversion();renderBlocks();});
    const swatch=document.createElement('div');swatch.className='color-swatch';swatch.style.backgroundColor=`rgb(${(state.baseColors[bc]||[210,215,200]).join(',')})`;
    if(block?.iconUrl){const image=document.createElement('img');image.src=block.iconUrl;image.alt='';image.loading='lazy';image.addEventListener('error',()=>image.remove(),{once:true});swatch.append(image);}
    const title=document.createElement('div');title.className='block-title';title.append(text('span',String(bc).padStart(2,'0'),'color-number'),text('span',baseColorNames[bc],'color-name'));
    const flags=[block?.burnable?'可燃':'',block?.endermanPickable?'末影人可搬取':'',block?.isGlowing?'发光':''].filter(Boolean);
    if(flags.length){const marker=text('span',flags.map(s=>s==='发光'?'✦':s==='可燃'?'♨':'◇').join(' '),'block-flags');marker.title=flags.join(' / ');title.append(marker);}
    const select=document.createElement('select');select.setAttribute('aria-label',`基础颜色 ${bc} 的方块`);select.disabled=!enabled||state.busy;select.dataset.unavailable=String(!enabled);
    for(const item of blocks){const option=document.createElement('option');option.value=item.id;option.textContent=item.nameZH||item.name||item.id;option.title=item.id;select.append(option);}
    if(!blocks.length){const option=text('option','当前版本无可用方块');select.append(option);}else select.value=selected.id;
    select.title=block?.id||'当前版本不可用';select.addEventListener('change',()=>{selected.id=select.value;markCustom();invalidateConversion();renderBlocks();});
    const note=text('div',block?.id||'此颜色不适用于当前游戏版本','block-version');note.title=note.textContent;
    row.append(checkbox,swatch,title,select,note);fragment.append(row);
  }
  if(!fragment.childNodes.length)fragment.append(text('div','没有匹配的方块。','empty-state'));
  $('block-grid').replaceChildren(fragment);renderPresetState();
}
function applyBlockPreset(preset, shouldInvalidate=true) {
  if(!Array.isArray(preset))throw new Error('预设必须是包含 baseColor、blockId、enabled 的数组。');
  for(const item of preset){const bc=Number(item.baseColor);if(Number.isInteger(bc)&&bc>=0&&bc<62&&typeof(item.blockId??item.id)==='string')state.selections.set(bc,{id:item.blockId??item.id,enabled:item.enabled!==false});}
  normalizeSelections();if(shouldInvalidate)invalidateConversion();
}
async function applyPreset(name) {
  if(!state.presets[name]){const response=await fetch(`./assets/presets/${name}.sc_preset_json`);if(!response.ok)throw new Error(`无法加载${presetNames[name]}预设。`);state.presets[name]=await response.json();}
  applyBlockPreset(state.presets[name]);state.preset=name;renderBlocks();persist();
}
function syncMapType() {
  const type=radio('map-type');
  $('map-type-hint').textContent={slope:'利用方块高度差呈现地图中的更多颜色。',flat:'在同一高度摆放方块，适合平面搭建。',file:'直接生成地图数据文件，无须在世界中搭建方块。'}[type];
  for(const input of $$('input[name="export-format"]')){
    const unavailable=type==='file' && input.value!=='map' || type!=='flat'&&input.value==='flatdiagram';
    input.disabled=unavailable;input.closest('label').style.opacity=unavailable?'.45':'';
    if(input.checked&&unavailable)document.querySelector(`input[name="export-format"][value="${type==='file'?'map':'litematic'}"]`).checked=true;
  }
  $('max-height').disabled=state.busy||type!=='slope';syncFormat();updateButtons();
}
function renderBlocklistChoices() {
  const container=$('blocklist-choices');container.replaceChildren();
  for(const group of state.groups){
    const label=document.createElement('label');label.className='blocklist-choice';
    const input=document.createElement('input');input.type='checkbox';input.checked=state.enabledGroups.has(group.name);input.disabled=group.name==='FixedBlocks';
    input.addEventListener('change',()=>{input.checked?state.enabledGroups.add(group.name):state.enabledGroups.delete(group.name);normalizeSelections();markCustom();invalidateConversion();renderBlocks();});
    label.append(input,text('span',groupNames[group.name]||group.name),text('small',`${group.blocks?.length||state.blocks.filter(b=>b.group===group.name).length} 个方块`));container.append(label);
  }
}

function invalidateConversion() {
  for(const task of state.tasks){if(task.converted)task.stale=true;task.buildStale=true;}
  renderQueue();renderPreview();renderBuild();updateButtons();persist();
}
function invalidateBuild() {
  for(const task of state.tasks)task.buildStale=true;
  renderBuild();updateButtons();persist();
}
function invalidateNativeResults(ids = null) {
  const affected = ids === null ? null : new Set(ids.map(String));
  for (const task of state.tasks) {
    if (affected && !affected.has(String(task.id))) continue;
    task.stale = Boolean(task.converted || task.built);
    task.buildStale = true;
    task.commandPreview = null;
  }
  clearTimeout(state.commandPreviewTimer);
  state.commandPreviewSequence++;
  renderQueue(); renderPreview(); renderBuild(); renderMapRanges(); updateButtons();
}
function chooseTask(id,event={}) {
  if(event.ctrlKey||event.metaKey){state.selected.has(id)?state.selected.delete(id):state.selected.add(id);if(state.selected.has(id))state.active=id;else if(state.active===id)state.active=[...state.selected].at(-1)||null;}
  else if(event.shiftKey&&state.active){const a=state.tasks.findIndex(t=>t.id===state.active),b=state.tasks.findIndex(t=>t.id===id);for(const task of state.tasks.slice(Math.min(a,b),Math.max(a,b)+1))state.selected.add(task.id);state.active=id;}
  else {state.selected=new Set([id]);state.active=id;}
  renderQueue();renderPreview();renderBuild();renderMapRanges();updateButtons();
}
function renderQueue() {
  for(const id of ['queue-convert','queue-export']){
    const queue=$(id),fragment=document.createDocumentFragment();
    for(const task of state.tasks){
      const item=document.createElement('button');item.type='button';item.className=`queue-item${state.selected.has(task.id)?' selected':''}`;item.dataset.taskId=task.id;item.setAttribute('aria-pressed',String(state.selected.has(task.id)));item.title=task.name;
      const img=document.createElement('img');img.src=task.thumbnail;img.alt='';
      const detail=document.createElement('span');detail.className='item-detail';detail.append(text('span',task.name,'item-name'),text('span',`${task.width} × ${task.height} · ${Math.ceil(task.width/128)} × ${Math.ceil(task.height/128)} 地图`,'item-meta'));
      const statusText=task.error?'失败':task.processing?'正在计算…':task.stale?'设置已变更，需重新转化':task.built&&!task.buildStale?'已构建':task.converted?'已转化':'待转化';
      detail.append(text('span',statusText,`item-status${task.error?' error':task.converted&&!task.stale?' done':''}`));
      item.append(img,detail);item.addEventListener('click',event=>chooseTask(task.id,event));fragment.append(item);
    }
    if(!state.tasks.length)fragment.append(text('div','尚无项目\n添加图像开始制作','queue-empty'));
    queue.replaceChildren(fragment);
  }
  $('pool-count').textContent=state.tasks.length;$('queue-summary').textContent=`${state.tasks.length} 张图像`;applyVisualSettings();
}
async function decodeFile(file) {
  if(file.type&&!file.type.startsWith('image/'))throw new Error(`${file.name} 不是可识别的图像文件。`);
  let bitmap;
  try {bitmap=await createImageBitmap(file);} catch(error) {
    const url=URL.createObjectURL(file);
    try {bitmap=await new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(new Error(`无法读取图像 ${file.name}`));img.src=url;});} finally{URL.revokeObjectURL(url);}
  }
  const width=bitmap.width||bitmap.naturalWidth,height=bitmap.height||bitmap.naturalHeight;
  if(!width||!height||width*height>67108864){bitmap.close?.();throw new Error(`${file.name} 的图像过大。请先缩小到 6700 万像素以内。`);}
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const ctx=canvas.getContext('2d',{willReadFrequently:true});
  if(!ctx){bitmap.close?.();throw new Error('浏览器无法建立图像画布。');}ctx.drawImage(bitmap,0,0);bitmap.close?.();
  const image=ctx.getImageData(0,0,width,height);
  const thumb=document.createElement('canvas'),scale=Math.min(1,96/width,96/height);thumb.width=Math.max(1,Math.round(width*scale));thumb.height=Math.max(1,Math.round(height*scale));thumb.getContext('2d').drawImage(canvas,0,0,thumb.width,thumb.height);
  return {width,height,rgba:image.data,thumbnail:thumb.toDataURL('image/png')};
}
async function addFiles(files,replace=false) {
  if(state.busy)return;
  let successes=0;
  for(const file of files){
    try{
      status(`正在读取 ${file.name}…`);const image=await decodeFile(file);
      const ids=replace?[...state.selected]:[crypto.randomUUID()];
      for(const id of ids){
        const task={id,name:file.name||`图像-${state.tasks.length+1}.png`,...image,rgba:new Uint8ClampedArray(image.rgba),imported:{...image,rgba:new Uint8ClampedArray(image.rgba)},converted:null,built:null,stale:false,buildStale:true};
        const index=state.tasks.findIndex(t=>t.id===id);if(index<0)state.tasks.push(task);else{state.tasks[index]=task;releaseNative(id);}
        state.selected=new Set([id]);state.active=id;successes++;
      }
      if(replace)break;
    }catch(error){handleError(error);}
  }
  renderQueue();renderPreview();renderBuild();renderMapRanges();updateButtons();if(successes){setTab('convert');status(`已${replace?'替换':'添加'} ${successes} 张图像`);}
}
function releaseNative(id) {if(state.ready&&!state.busy)state.client.request('dispose',{id}).catch(error=>console.warn(error));}
function drawRgba(canvas,rgba,width,height) {
  canvas.width=width;canvas.height=height;
  const pixels=rgba instanceof Uint8ClampedArray?rgba:new Uint8ClampedArray(rgba.buffer||rgba,rgba.byteOffset||0,width*height*4);
  canvas.getContext('2d').putImageData(new ImageData(pixels,width,height),0,0);
}
function renderPreview() {
  const task=activeTask();$('preview-empty').hidden=Boolean(task);$('canvas-pair').hidden=!task;
  $('preview-area').dataset.mode=state.preview;
  for(const button of $$('[data-preview]'))button.classList.toggle('active',button.dataset.preview===state.preview);
  if(!task){$('image-dimensions').textContent='尚未选择图像';updateButtons();return;}
  $('image-dimensions').textContent=`${task.width} × ${task.height} 像素 · ${Math.ceil(task.width/128)} × ${Math.ceil(task.height/128)} 张地图`;
  drawRgba($('original-canvas'),task.rgba,task.width,task.height);
  $('converted-empty').hidden=Boolean(task.converted);
  if(task.converted){drawRgba($('converted-canvas'),task.converted.rgba,task.converted.width||task.width,task.converted.height||task.height);$('converted-canvas').style.opacity=task.stale?'.55':'1';}
  else{$('converted-canvas').width=task.width;$('converted-canvas').height=task.height;$('converted-canvas').getContext('2d').clearRect(0,0,task.width,task.height);}
  applyZoom();updateButtons();
}
function applyZoom() {
  const zoom=value('zoom'),task=activeTask(),area=$('preview-area');area.classList.toggle('actual-zoom',zoom!=='fit');area.classList.toggle('show-grid',checked('preview-grid'));
  if(!task)return;
  for(const canvas of [$('original-canvas'),$('converted-canvas')]){
    canvas.style.width=zoom==='fit'?'':`${canvas.width*Number(zoom)}px`;canvas.style.height=zoom==='fit'?'':`${canvas.height*Number(zoom)}px`;
  }
  requestAnimationFrame(()=>{for(const wrap of $$('.canvas-wrap')){const canvas=wrap.querySelector('canvas');wrap.style.setProperty('--grid-width',`${canvas.getBoundingClientRect().width/task.width*128}px`);wrap.style.setProperty('--grid-height',`${canvas.getBoundingClientRect().height/task.height*128}px`);}});
}
function convertOptions() {
  return {version:version(),mapType:radio('map-type'),algorithm:radio('algorithm'),dither:checked('dither'),pureTransparent:value('pure-transparent'),halfTransparent:value('half-transparent'),backgroundColor:value('background-color'),
    ga:{popSize:number('ga-population',30,500),maxGeneration:number('ga-generations',50,3000),maxFailTimes:number('ga-failures',10,3000),crossoverProb:number('ga-crossover',0,1),mutationProb:number('ga-mutation',0,1)}};
}
function buildOptions() {
  return {maxHeight:Math.trunc(number('max-height',14,4096)),compression:(checked('compress-lossless')?1:0)|(checked('compress-lossy')?2:0),glassBridge:checked('glass-bridge'),bridgeInterval:Math.trunc(number('bridge-interval',0,4096)),fireproof:checked('fireproof'),enderproof:checked('enderproof'),connectMushroom:checked('connect-mushroom'),supportBlock:value('support-block')};
}
async function ensureConverted(task) {
  if(task.converted&&!task.stale)return task.converted;
  task.processing=true;task.error=null;renderQueue();status(`转化 ${task.name}`);
  const bytes=task.rgba.slice().buffer;
  try{
    const result=await state.client.request('convert',{id:task.id,name:stem(task.name),width:task.width,height:task.height,rgba:bytes,options:convertOptions(),blocks:selectionPayload()},[bytes]);
    if(!result.rgba)throw new Error('转换核心未返回图像预览。');
    task.converted={...result,width:result.width||task.width,height:result.height||task.height};task.stale=false;task.built=null;task.buildStale=true;task.conversionSerial=(task.conversionSerial||0)+1;
    if(result.stats?.colors!=null)$('palette-note').textContent=`当前引擎颜色表：${result.stats.colors} 种可用地图颜色。`;
    if(state.active===task.id)renderPreview();return task.converted;
  }catch(error){task.error=error.message;throw error;}finally{task.processing=false;renderQueue();}
}
async function ensureBuilt(task,force=false) {
  await ensureConverted(task);
  if(!force&&task.built&&!task.buildStale)return task.built;
  if(radio('map-type')==='file')throw new Error('纯文件地图画无需构建三维结构，请导出地图数据。');
  task.processing=true;task.error=null;renderQueue();status(`构建 ${task.name}`);
  try{task.built=await state.client.request('build',{id:task.id,options:buildOptions()});task.buildStale=false;if(state.active===task.id)renderBuild();return task.built;}
  catch(error){task.error=error.message;throw error;}finally{task.processing=false;renderQueue();}
}
async function runOperation(tasks,phase,action,finishMessage) {
  if(state.busy)return;
  if(!state.ready){notify('计算引擎尚未就绪。请查看页面上方的运行环境提示。',true);return;}
  if(!tasks.length){notify('请先选择至少一个图像项目。');return;}
  state.progressPhase=phase;state.operationTotal=tasks.length;state.operationIndex=0;setBusy(true);let completed=0,failed=0;
  try{
    for(let index=0;index<tasks.length;index++){
      if(state.cancelled)break;
      state.operationIndex=index;
      try{await action(tasks[index],index);completed++;}catch(error){failed++;handleError(error);}
      setProgress((index+1)/tasks.length*100,`${index+1} / ${tasks.length}`);
    }
    status(`${state.cancelled?'已停止；':''}${finishMessage}：${completed} 个成功${failed?`，${failed} 个失败`:''}`);
  }finally{setBusy(false);renderQueue();renderPreview();renderBuild();renderMapRanges();}
  return {completed,failed};
}
function setProgress(percent,message) {
  const prefix=state.progressPhase==='export'?'export':'convert';
  $(prefix+'-progress').value=Math.max(0,Math.min(100,percent));$(prefix+'-progress-text').textContent=message||`${Math.round(percent)}%`;
}
function progressUpdate(progress={}) {
  const stageLabels={convert:'正在转化图像',build:'正在构建三维结构',export:'正在生成导出文件',palette:'正在读取当前颜色表',testBlocklist:'正在生成方块列表测试文件',loadBlocklist:'正在读取方块列表',ready:'多线程引擎已就绪',loading:'正在加载计算核心'};
  const message=progress.message||progress.status||stageLabels[progress.stage]||progress.stage||'计算中';
  if(!state.ready){status(message);const el=$('runtime-alert').querySelector('p');if(el)el.textContent=message;return;}
  const current=Number(progress.current??progress.value??0),total=Number(progress.total??progress.max??100),min=Number(progress.min??0);
  const ratio=total>min?Math.max(0,Math.min(1,(current-min)/(total-min))):0;
  setProgress((state.operationIndex+ratio)/state.operationTotal*100,message);status(message);
}
function syncFormat() {
  const format=radio('export-format'),map=format==='map';
  $('structure-options').hidden=map;$('map-options').hidden=!map;
  for(const panel of $$('[data-format-options]'))panel.hidden=panel.dataset.formatOptions!==format;
  $('export-hint').textContent=format==='schem'&&version()===12?'MC 1.12 不支持此 WE 原理图格式，请使用 Litematica 或结构文件。':'生成后由浏览器下载到本地；多个文件自动打包为 ZIP。';
  renderMapRanges();persist();
}
function normalizedMaterials(task=activeTask()) {
  const raw=task?.built?.materials||[];
  const materials=Array.isArray(raw)?raw:Object.entries(raw).map(([id,count])=>({id,count}));
  return materials.map(item=>{const b=state.blocks.find(block=>block.id===(item.id||item.blockId));return {...item,id:item.id||item.blockId||'',name:item.nameZH||item.name||b?.nameZH||item.id||'未知方块',count:Number(item.count??item.quantity??0),stackSize:item.stackSize||b?.stackSize||64};}).filter(item=>item.count>0).sort((a,b)=>b.count-a.count);
}
function renderBuild() {
  const task=activeTask(),built=task?.built,valid=built&&!task.stale&&!task.buildStale;
  const size=valid?(built.size||built.dimensions||[]):[];
  $('structure-size').textContent=valid?(Array.isArray(size)?size.join(' × '):`${size.x} × ${size.y} × ${size.z}`):built?'设置已变更，需重新构建':'尚未构建';
  $('structure-count').textContent=valid?formatNumber(built.blockCount??built.totalBlocks??normalizedMaterials(task).reduce((n,item)=>n+item.count,0)):'—';
  $('structure-maps').textContent=task?`${Math.ceil(task.width/128)} × ${Math.ceil(task.height/128)}`:'—';
  const container=$('material-preview');container.replaceChildren();
  if(!valid){container.append(text('div',built?'重新构建后刷新材料用量。':'构建后在这里查看材料用量。','hint'));return;}
  const materials=normalizedMaterials(task);
  for(const item of materials.slice(0,12)){const row=document.createElement('div');row.className='material-mini-row';row.append(text('span',item.name),text('span',formatNumber(item.count)));container.append(row);}
  if(materials.length>12)container.append(text('div',`另有 ${materials.length-12} 种方块，可打开完整材料表。`,'hint'));
  if(!materials.length)container.append(text('div','核心未返回材料条目。','hint'));
}
function mapRanges() {
  let start=Math.trunc(Number(value('map-start-id'))||0);
  return state.tasks.map(task=>{const count=Math.ceil(task.width/128)*Math.ceil(task.height/128),entry={task,start,end:start+count-1,count};start+=count;return entry;});
}
function renderMapRanges() {
  const container=$('map-ranges');container.replaceChildren();
  for(const range of mapRanges()){const row=document.createElement('div');row.className='map-range';row.append(text('span',range.task.name),text('span',`map_${range.start}.dat${range.count>1?` … map_${range.end}.dat`:''} (${range.count})`));container.append(row);}
  const task=activeTask(),range=mapRanges().find(range=>range.task===task);
  const sequence=++state.commandPreviewSequence;clearTimeout(state.commandPreviewTimer);
  if(!range||!task.converted||task.stale){$('map-commands').value='';return;}
  const key=JSON.stringify([task.conversionSerial,range.start,checked('modern-items'),value('map-stack-count'),checked('map-name-index')]);
  if(task.commandPreview?.key===key){$('map-commands').value=task.commandPreview.text;return;}
  $('map-commands').value='';$('map-commands').placeholder=state.busy?'当前任务完成后生成命令预览':'正在由原生核心生成命令预览…';
  if(state.busy||!state.ready||radio('export-format')!=='map')return;
  state.commandPreviewTimer=setTimeout(async()=>{
    if(state.busy||sequence!==state.commandPreviewSequence)return;
    try{
      const result=await state.client.request('export',{id:task.id,format:'commands',options:exportOptions(task,'commands')});
      const file=result.files?.[0];if(!file)throw new Error('核心未生成命令。');
      const commandText=new TextDecoder().decode(file.data);task.commandPreview={key,text:commandText};
      if(sequence===state.commandPreviewSequence)$('map-commands').value=commandText;
    }catch(error){if(sequence===state.commandPreviewSequence)$('map-commands').placeholder=`命令预览不可用：${error.message}`;}
  },180);
}
function exportOptions(task,format) {
  number('map-start-id',0,2147483647);
  const startId=mapRanges().find(range=>range.task.id===task.id)?.start||0;
  const mapCount=Math.ceil(task.width/128)*Math.ceil(task.height/128);
  if(startId+mapCount-1>2147483647)throw new Error('地图序号超出 32 位整数范围，请减小起始序号。');
  return {name:format==='schem'?(value('schem-name')||stem(task.name)):(value('litematic-name')||stem(task.name)),filename:safeName(stem(task.name)),regionName:value('region-name')||'SlopeCraft',isAirStructureVoid:checked('air-void'),
    offset:['x','y','z'].map(axis=>Math.trunc(number(`offset-${axis}`))),weOffset:['x','y','z'].map(axis=>Math.trunc(number(`weoffset-${axis}`))),requiredMods:value('required-mods').split(/\r?\n/).map(s=>s.trim()).filter(Boolean),
    splitLineRowMargin:checked('diagram-hline')?Math.trunc(number('diagram-hmargin',1,1024)):0,splitLineColMargin:checked('diagram-vline')?Math.trunc(number('diagram-vmargin',1,1024)):0,pngCompression:9,
    beginIndex:startId,after1205:checked('modern-items'),frameVariant:checked('glowing-frames')?1:0,invisibleFrame:checked('invisible-frames'),fixedFrame:checked('fixed-frames'),mapFacing:Math.trunc(number('map-direction',0,11)),format:value('assembled-format'),stackCount:Math.trunc(number('map-stack-count',1,64)),setNameAsIndex:checked('map-name-index')};
}
async function exportTasks(tasks,format=radio('export-format')) {
  if(format==='schem'&&version()===12)throw new Error('MC 1.12 的 WE 原理图格式不受支持，请选择其他格式。');
  const files=[];
  await runOperation(tasks,'export',async(task)=>{
    if(['map','commands','assembled'].includes(format))await ensureConverted(task);else await ensureBuilt(task);
    const result=await state.client.request('export',{id:task.id,format,options:exportOptions(task,format)});
    for(const file of result.files||[]){
      const name=format==='commands'?file.name.replace(/\.mcfunction$/i,'.txt'):file.name;
      files.push({...file,name:tasks.length>1?`${safeName(stem(task.name))}/${name}`:name});
    }
  },'导出完成');
  if(files.length){await downloadFiles(files,`SlopeCraft-${format}-${tasks.length}项目.zip`);notify(`已生成 ${files.length} 个文件${files.length>1?'并打包为 ZIP':''}。`);}
}

function openResize() {
  const task=activeTask();if(!task)return;
  $('crop-x').value=0;$('crop-y').value=0;$('crop-width').value=task.width;$('crop-height').value=task.height;
  $('resize-width').value=task.width;$('resize-height').value=task.height;
  drawCropPreview();$('resize-dialog').showModal();
}
function cropRect() {
  const task=activeTask(),x=Math.trunc(number('crop-x',0,task.width-1)),y=Math.trunc(number('crop-y',0,task.height-1)),w=Math.trunc(number('crop-width',1,task.width-x)),h=Math.trunc(number('crop-height',1,task.height-y));return {x,y,w,h};
}
function drawCropPreview() {
  const task=activeTask();if(!task)return;
  const scale=Math.min(1,500/task.width,420/task.height),canvas=$('crop-canvas');canvas.width=Math.max(1,Math.round(task.width*scale));canvas.height=Math.max(1,Math.round(task.height*scale));
  const source=document.createElement('canvas');drawRgba(source,task.rgba,task.width,task.height);const ctx=canvas.getContext('2d');ctx.drawImage(source,0,0,canvas.width,canvas.height);
  try{const {x,y,w,h}=cropRect();ctx.fillStyle='#14231588';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(source,x,y,w,h,x*scale,y*scale,w*scale,h*scale);ctx.strokeStyle='#d7f3a5';ctx.lineWidth=2;ctx.strokeRect(x*scale,y*scale,w*scale,h*scale);}catch(error){/* Invalid pending form values are reported on Apply. */}
}
function resizeRatio(sourceId) {
  if(!checked('lock-ratio'))return;
  let rect;try{rect=cropRect();}catch(error){return;}
  if(sourceId==='resize-width')$('resize-height').value=Math.max(1,Math.round(Number(value('resize-width'))*rect.h/rect.w));
  else $('resize-width').value=Math.max(1,Math.round(Number(value('resize-height'))*rect.w/rect.h));
}
function invalidateTask(task) {task.converted=null;task.built=null;task.stale=false;task.buildStale=true;task.error=null;releaseNative(task.id);renderQueue();renderPreview();renderBuild();renderMapRanges();}
async function applyResize() {
  const task=activeTask(),{x,y,w,h}=cropRect(),width=Math.trunc(number('resize-width',1,16384)),height=Math.trunc(number('resize-height',1,16384));
  if(width*height>67108864)throw new Error('输出图像不得超过 6700 万像素。');
  const original=document.createElement('canvas');drawRgba(original,task.rgba,task.width,task.height);
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.imageSmoothingEnabled=checked('resize-smooth');ctx.imageSmoothingQuality='high';ctx.drawImage(original,x,y,w,h,0,0,width,height);
  task.width=width;task.height=height;task.rgba=ctx.getImageData(0,0,width,height).data;task.thumbnail=makeThumbnail(canvas);invalidateTask(task);$('resize-dialog').close();notify(`已调整为 ${width} × ${height} 像素。`);
}
function makeThumbnail(canvas) {const thumb=document.createElement('canvas'),scale=Math.min(1,96/canvas.width,96/canvas.height);thumb.width=Math.max(1,Math.round(canvas.width*scale));thumb.height=Math.max(1,Math.round(canvas.height*scale));thumb.getContext('2d').drawImage(canvas,0,0,thumb.width,thumb.height);return thumb.toDataURL('image/png');}
async function saveConverted() {
  const task=activeTask();if(!task?.converted||task.stale)return;
  const canvas=document.createElement('canvas');drawRgba(canvas,task.converted.rgba,task.converted.width||task.width,task.converted.height||task.height);
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob)throw new Error('无法生成 PNG 图像。');download(blob,`${safeName(stem(task.name))}-转化.png`);
}
function showMaterials() {
  const task=activeTask();if(!task?.built||task.buildStale||task.stale)return;
  const materials=normalizedMaterials(task),table=$('materials-table');table.replaceChildren();
  for(const item of materials){const row=document.createElement('tr'),name=text('td',item.name);name.append(text('small',item.id));row.append(name,text('td',formatNumber(item.count)),text('td',`${Math.floor(item.count/item.stackSize)} 组 + ${item.count%item.stackSize} 个${item.stackSize!==64?`（每组 ${item.stackSize}）`:''}`));table.append(row);}
  $('material-total').textContent=`${task.name} · ${materials.length} 种方块 · 共 ${formatNumber(materials.reduce((sum,item)=>sum+item.count,0))} 个`;$('materials-dialog').showModal();
}
function exportMaterials() {
  const task=activeTask(),materials=normalizedMaterials(task),escape=s=>`"${String(s).replaceAll('"','""')}"`;
  // Prefix untrusted text so spreadsheet applications do not evaluate formulas.
  const csvCell=s=>escape(/^[=+@-]/.test(String(s))?`'${s}`:s);
  const csv='\ufeff名称,方块ID,数量,每组数量\r\n'+materials.map(item=>[csvCell(item.name),csvCell(item.id),item.count,item.stackSize].join(',')).join('\r\n');
  download(new Blob([csv],{type:'text/csv;charset=utf-8'}),`${safeName(stem(task.name))}-材料.csv`);
}
async function previewCompression() {
  const task=activeTask();if(!task)return;
  await runOperation([task],'export',async()=>{
    const built=await ensureBuilt(task),preview=built.preview;
    const size=built.size||[];$('compression-summary').textContent=`${task.name} · 构建尺寸 ${Array.isArray(size)?size.join(' × '):''} · ${checked('compress-lossy')?'允许有损压缩':'无有损压缩'}。`;
    if(preview?.rgba)drawRgba($('compression-canvas'),preview.rgba,preview.width,preview.height);
    else if(built.rgba)drawRgba($('compression-canvas'),built.rgba,built.width||task.width,built.height||task.height);
    else if(!checked('compress-lossy'))drawRgba($('compression-canvas'),task.converted.rgba,task.converted.width||task.width,task.converted.height||task.height);
    else throw new Error('核心未返回有损压缩后的图像，无法显示压缩效果。结构已构建，可正常导出。');
    $('compression-dialog').showModal();
  },'压缩预览完成');
}
function normalizePalette(colors) {
  if (!Array.isArray(colors) || !colors.length) throw new Error('核心未返回可用的地图颜色。');
  const palette = new Map();
  for (const color of colors) {
    const mapId = Number(color.mapId ?? color.mapColor ?? color.id);
    let rgb = color.rgb;
    if (Array.isArray(rgb)) rgb = rgb.map(Number);
    else if (typeof rgb === 'number' && Number.isFinite(rgb)) rgb = [(rgb >>> 16) & 255, (rgb >>> 8) & 255, rgb & 255];
    else if (typeof rgb === 'string' && /^#?[\da-f]{6}$/i.test(rgb)) {const n = parseInt(rgb.replace('#',''),16); rgb = [(n >>> 16)&255,(n >>> 8)&255,n&255];}
    if (!Number.isInteger(mapId) || mapId < 0 || mapId > 255 || !Array.isArray(rgb) || rgb.length !== 3 || rgb.some(n=>!Number.isInteger(n)||n<0||n>255)) throw new Error('核心返回的地图颜色格式无效。');
    palette.set(mapId, {mapId, rgb});
  }
  return [...palette.values()].sort((a,b)=>a.mapId-b.mapId);
}
async function getPalette() {
  $('palette-tools').open = false;
  let result;
  await runOperation([{id:'palette-tool'}], 'convert', async()=>{
    result = await state.client.request('palette', {options:convertOptions(), blocks:selectionPayload()});
  }, '颜色表获取完成');
  if (!result) return;
  const colors = normalizePalette(result.colors), byId = new Map(colors.map(color=>[color.mapId,color]));
  const canvas = $('palette-canvas'), cell = 36;
  canvas.width = 16 * cell; canvas.height = 16 * cell;
  const ctx = canvas.getContext('2d');
  const png = document.createElement('canvas'); png.width = 16; png.height = 16;
  const pixels = png.getContext('2d').createImageData(16,16);
  for (let mapId=0; mapId<256; mapId++) {
    const x = (mapId % 16) * cell, y = Math.floor(mapId/16) * cell, color = byId.get(mapId);
    ctx.fillStyle = color ? `rgb(${color.rgb.join(',')})` : '#f1f3ed'; ctx.fillRect(x,y,cell,cell);
    if (!color) {ctx.strokeStyle='#d5ddce';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(x+2,y+cell-2);ctx.lineTo(x+cell-2,y+2);ctx.stroke();}
    ctx.strokeStyle='#253b2026';ctx.lineWidth=1;ctx.strokeRect(x+.5,y+.5,cell-1,cell-1);
    const dark = color ? color.rgb[0]*.2126+color.rgb[1]*.7152+color.rgb[2]*.0722<132 : false;
    ctx.fillStyle=color?(dark?'#fff':'#172711'):'#8b9881';ctx.font='10px Consolas, monospace';ctx.textAlign='left';ctx.textBaseline='alphabetic';ctx.fillText(String(mapId),x+4,y+cell-5);
    if (color) {const offset=mapId*4;pixels.data.set([...color.rgb,255],offset);}
  }
  png.getContext('2d').putImageData(pixels,0,0);
  state.palette = {colors,png};
  $('palette-summary').textContent = `${$('game-version').selectedOptions[0]?.textContent || ''} · ${{slope:'立体地图画',flat:'平面地图画',file:'纯文件地图画'}[radio('map-type')]} · ${colors.length} 种可用地图颜色`;
  $('palette-dialog').showModal();
}
async function savePalettePng() {
  if (!state.palette) return;
  const blob = await new Promise(resolve=>state.palette.png.toBlob(resolve,'image/png'));
  if (!blob) throw new Error('无法生成颜色表 PNG。');
  download(blob,'SlopeCraft-palette.png');
}
function savePaletteCsv() {
  if (!state.palette) return;
  const rows = state.palette.colors.map(({mapId,rgb})=>[mapId,mapId>>2,mapId&3,'#'+rgb.map(n=>n.toString(16).padStart(2,'0')).join(''),...rgb].join(','));
  download(new Blob(['\ufeffmapId,baseColor,shade,hex,R,G,B\r\n'+rows.join('\r\n')],{type:'text/csv;charset=utf-8'}),'SlopeCraft-palette.csv');
}
async function testBlocklist() {
  $('palette-tools').open = false;
  const keys = state.blocks.filter(block=>state.enabledGroups.has(block.group||'FixedBlocks') && minimumVersion(block)<=version()).map(block=>block.key).filter(Number.isInteger);
  if (!keys.length) throw new Error('当前启用的方块列表中没有可测试的方块。');
  let result;
  await runOperation([{id:'blocklist-test-tool'}], 'export', async()=>{
    result = await state.client.request('testBlocklist', {options:convertOptions(),blocks:selectionPayload(),keys});
  }, '方块列表测试文件生成完成');
  if (!result) return;
  await downloadFiles(result.files||[],'SlopeCraft-blocklist-test.zip');
  notify(`已生成当前启用方块列表的测试文件（${keys.length} 个版本可用方块）。`);
}

async function importBlocklist(file) {
  if(!file)return;if(state.busy)throw new Error('请等待当前计算完成。');if(!state.ready)throw new Error('请先使计算引擎就绪，再导入方块列表。');
  if(!/\.zip$/i.test(file.name))throw new Error('请选择包含 block_list.json 与方块图标的完整 ZIP 方块列表。');
  const group=`用户-${safeName(stem(file.name))}-${Date.now().toString(36)}`,bytes=await file.arrayBuffer();
  let imported;
  await runOperation([{id:group}],'convert',async()=>{imported=await state.client.request('importBlocklist',{name:group,data:bytes},[bytes]);},'方块列表导入完成');
  if(!imported)return;
  const blocks=(imported.blocks||[]).map(b=>({...b,group}));
  if(!blocks.length)throw new Error('核心未返回自定义方块，请检查 ZIP 是否包含 block_list.json 和图标。');
  state.blocks.push(...blocks);state.groups.push({name:group,blocks});state.enabledGroups.add(group);
  state.preset='custom';renderBlocklistChoices();invalidateConversion();renderBlocks();persist();notify(`已导入 ${blocks.length} 个方块。刷新后需重新导入该 ZIP。`);
  if(imported.warnings)notify(imported.warnings,true);
}

function applyMetadata(metadata={}) {
  state.metadata=metadata;
  const versions=metadata.versions||metadata.gameVersions||[];
  for(const item of versions){
    const val=String(typeof item==='number'?item:item.value??item.version??'');if(!val||$$('#game-version option').some(option=>option.value===val))continue;
    const option=document.createElement('option');option.value=val;option.textContent=(typeof item==='object'?(item.label||item.name):null)||({4790:'Java 26.1.2',4903:'Java 26.2'}[val])||`Java ${val}`;$('game-version').append(option);
  }
}
async function refreshCacheStats() {
  if (!state.ready || state.busy) {
    $('cache-stats').textContent = state.busy ? '当前任务完成后可读取缓存统计。' : '引擎就绪后可读取缓存统计。';
    return;
  }
  $('cache-stats').textContent = '正在读取缓存统计…';
  $('refresh-cache').disabled = true;
  try {
    const stats = await state.client.request('cacheStats');
    const entries = Number(stats.entries ?? stats.count), bytes = Number(stats.bytes ?? stats.totalBytes);
    if (!Number.isFinite(entries) || !Number.isFinite(bytes)) throw new Error('引擎未返回缓存大小。');
    const size = bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MiB` : bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} KiB` : `${formatNumber(bytes)} B`;
    $('cache-stats').textContent = `${formatNumber(entries)} 个缓存结果 · ${size}`;
  } catch (error) {
    $('cache-stats').textContent = `缓存统计不可用：${error.message}`;
  } finally { updateButtons(); }
}
async function clearCache() {
  if (!state.ready || state.busy) return;
  $('clear-cache').disabled = true;
  $('cache-stats').textContent = '正在清除缓存…';
  try {
    const result = await state.client.request('cacheClear');
    invalidateNativeResults(Array.isArray(result.clearedIds) ? result.clearedIds : []);
    await refreshCacheStats();
    notify('缓存已清理，后续导出会自动重新计算。');
  } catch (error) { $('cache-stats').textContent = `缓存清除失败：${error.message}`; handleError(error); }
  finally { updateButtons(); }
}
async function initializeEngine() {
  state.ready=false;updateButtons();$('runtime-alert').className='runtime-alert';$('runtime-alert').querySelector('strong').textContent='正在初始化多线程转换引擎';$('engine-status').className='engine-status';$('engine-status').lastChild.textContent='引擎加载中';
  invalidateNativeResults();
  state.client?.dispose();state.client=new EngineClient();state.client.onProgress(progressUpdate);
  try{
    const threads=Math.trunc(number('thread-count',2,8)),memoryBudgetMB=Math.trunc(number('memory-budget',128,3072));
    const result=await state.client.init({threads,memoryBudgetMB,cacheEnabled:checked('cache-enabled')});
    if(result.blocks?.length)state.blocks=result.blocks;
    if(result.groups?.length)state.groups=result.groups;
    applyMetadata(result.metadata);
    state.ready=true;$('runtime-alert').classList.add('ready');$('engine-status').classList.add('ready');$('engine-status').lastChild.textContent='多线程引擎就绪';$('thread-status').textContent=`${result.threads||threads} 个计算线程`;
    if(state.pendingSaved){restoreSettings(state.pendingSaved);state.pendingSaved=null;}
    renderBlocks();renderBlocklistChoices();updateButtons();status('多线程引擎已就绪。添加图像开始转化。');
    if ($('settings-dialog').open) refreshCacheStats();
  }catch(error){
    $('runtime-alert').classList.add('error');$('runtime-alert').querySelector('strong').textContent='多线程引擎暂不可用';$('runtime-alert').querySelector('p').textContent=error.message;
    $('engine-status').classList.add('error');$('engine-status').lastChild.textContent='引擎未就绪';status(error.message);console.error(error);updateButtons();
  }
  $('runtime-details').textContent=`安全上下文：${globalThis.isSecureContext?'是':'否'}\n跨源隔离：${globalThis.crossOriginIsolated?'是':'否'}\nSharedArrayBuffer：${typeof SharedArrayBuffer!=='undefined'?'可用':'不可用'}\n逻辑处理器：${navigator.hardwareConcurrency||'未知'}`;
}
function wireEvents() {
  for(const button of $$('[data-tab],[data-goto]'))button.addEventListener('click',()=>setTab(button.dataset.tab||button.dataset.goto));
  for(const button of $$('[data-tab]'))button.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const tabs=$$('[data-tab]'),index=tabs.indexOf(button),next=event.key==='Home'?0:event.key==='End'?tabs.length-1:(index+(event.key==='ArrowLeft'?-1:1)+tabs.length)%tabs.length;tabs[next].focus();setTab(tabs[next].dataset.tab);});
  for(const [button,dialog] of [['settings-button','settings-dialog'],['about-button','about-dialog'],['transparent-options','transparent-dialog'],['ga-options','ga-dialog'],['manage-blocklists','blocklists-dialog']])$(button).addEventListener('click',()=>$(dialog).showModal());
  $('settings-button').addEventListener('click',refreshCacheStats);
  $('refresh-cache').addEventListener('click',refreshCacheStats);
  $('clear-cache').addEventListener('click',()=>clearCache().catch(handleError));
  $('get-palette').addEventListener('click',()=>getPalette().catch(handleError));
  $('test-blocklist').addEventListener('click',()=>testBlocklist().catch(handleError));
  $('save-palette-png').addEventListener('click',()=>savePalettePng().catch(handleError));
  $('save-palette-csv').addEventListener('click',savePaletteCsv);
  document.addEventListener('click',event=>{if (!event.target.closest('#palette-tools')) $('palette-tools').open=false;});
  for(const button of $$('[data-preset]'))button.addEventListener('click',()=>applyPreset(button.dataset.preset).catch(handleError));
  $('block-search').addEventListener('input',renderBlocks);
  for(const button of $$('[data-select]'))button.addEventListener('click',()=>{for(const [bc,item]of state.selections)if(availableBlocks(bc).length&&allowedBaseColor(bc))item.enabled=button.dataset.select==='all'?true:button.dataset.select==='none'?false:!item.enabled;markCustom();invalidateConversion();renderBlocks();});
  for(const button of $$('[data-prefer]'))button.addEventListener('click',()=>{for(let bc=0;bc<62;bc++){const block=availableBlocks(bc).find(block=>block.id.includes(button.dataset.prefer));if(block)state.selections.get(bc).id=block.id;}markCustom();invalidateConversion();renderBlocks();});
  for(const id of configControlIds)$(id).addEventListener('change',()=>{if(id==='game-version'){renderBlocks();syncMapType();$('modern-items').checked=version()>=20;}invalidateConversion();renderMapRanges();});
  for(const input of $$('input[name="map-type"],input[name="algorithm"]'))input.addEventListener('change',()=>{syncMapType();invalidateConversion();});
  for(const id of buildControlIds)$(id).addEventListener('change',invalidateBuild);
  for(const input of $$('input[name="export-format"]'))input.addEventListener('change',syncFormat);
  for(const id of settingsIds)$(id).addEventListener('change',persist);
  $('show-thumbnails').addEventListener('change',applyVisualSettings);$('smooth-preview').addEventListener('change',applyVisualSettings);
  for(const id of ['add-image','empty-add'])$(id).addEventListener('click',()=>$('file-input').click());
  $('file-input').addEventListener('change',async event=>{await addFiles(event.target.files);event.target.value='';});
  $('replace-image').addEventListener('click',()=>$('replace-input').click());$('replace-input').addEventListener('change',async event=>{await addFiles(event.target.files,true);event.target.value='';});
  $('remove-image').addEventListener('click',()=>{if(state.busy)return;for(const task of selectedTasks())releaseNative(task.id);state.tasks=state.tasks.filter(task=>!state.selected.has(task.id));state.selected.clear();state.active=state.tasks[0]?.id||null;if(state.active)state.selected.add(state.active);renderQueue();renderPreview();renderBuild();renderMapRanges();updateButtons();});
  $('export-select-all').addEventListener('click',()=>{state.selected=new Set(state.tasks.map(task=>task.id));state.active||=state.tasks[0]?.id;renderQueue();updateButtons();});
  $('resize-image').addEventListener('click',openResize);$('apply-resize').addEventListener('click',()=>applyResize().catch(handleError));
  for(const id of ['crop-x','crop-y','crop-width','crop-height'])$(id).addEventListener('input',()=>{drawCropPreview();if(id.includes('width')||id.includes('height'))resizeRatio('resize-width');});
  for(const id of ['resize-width','resize-height'])$(id).addEventListener('input',()=>resizeRatio(id));
  $('crop-reset').addEventListener('click',()=>{const task=activeTask();$('crop-x').value=0;$('crop-y').value=0;$('crop-width').value=task.width;$('crop-height').value=task.height;drawCropPreview();});
  for(const button of $$('[data-map-size]'))button.addEventListener('click',()=>{const size=Number(button.dataset.mapSize);$('resize-width').value=size;$('resize-height').value=size;$('lock-ratio').checked=false;});
  $('restore-image').addEventListener('click',()=>{const task=activeTask();if(!task)return;Object.assign(task,{width:task.imported.width,height:task.imported.height,rgba:task.imported.rgba.slice(),thumbnail:task.imported.thumbnail});invalidateTask(task);$('resize-dialog').close();notify('已还原为导入时的图像。');});
  $('reset-transparent').addEventListener('click',()=>{$('pure-transparent').value='B';$('half-transparent').value='C';$('background-color').value='#dcdcdc';invalidateConversion();});
  $('reset-ga').addEventListener('click',()=>{for(const [id,v]of Object.entries({'ga-population':50,'ga-generations':200,'ga-failures':50,'ga-crossover':.8,'ga-mutation':.01}))$(id).value=v;invalidateConversion();});
  for(const button of $$('[data-preview]'))button.addEventListener('click',()=>{state.preview=button.dataset.preview;renderPreview();});
  $('zoom').addEventListener('change',applyZoom);$('preview-grid').addEventListener('change',applyZoom);window.addEventListener('resize',applyZoom);
  $('convert-current').addEventListener('click',()=>runOperation(activeTask()?[activeTask()]:[],'convert',ensureConverted,'转化完成').then(()=>{state.preview='converted';renderPreview();}).catch(handleError));
  $('convert-all').addEventListener('click',()=>runOperation(selectedTasks(true),'convert',ensureConverted,'转化完成').catch(handleError));
  $('cancel-operation').addEventListener('click',()=>{state.cancelled=true;$('cancel-operation').disabled=true;status('当前计算完成后停止后续任务。');});
  $('save-converted').addEventListener('click',()=>saveConverted().catch(handleError));
  $('build-structure').addEventListener('click',()=>runOperation(selectedTasks(),'export',task=>ensureBuilt(task),'构建完成').catch(handleError));
  $('preview-compression').addEventListener('click',()=>previewCompression().catch(handleError));$('preview-materials').addEventListener('click',showMaterials);$('export-materials').addEventListener('click',exportMaterials);
  $('export-current').addEventListener('click',()=>exportTasks(selectedTasks()).catch(handleError));$('export-all').addEventListener('click',()=>exportTasks(selectedTasks(true)).catch(handleError));
  $('export-commands').addEventListener('click',()=>exportTasks(selectedTasks(),'commands').catch(handleError));$('export-assembled').addEventListener('click',()=>exportTasks(selectedTasks(),'assembled').catch(handleError));
  for(const id of ['map-start-id','modern-items','map-stack-count','map-name-index'])$(id).addEventListener('change',renderMapRanges);
  $('save-preset').addEventListener('click',()=>downloadJson([...state.selections].map(([baseColor,item])=>({baseColor,blockId:item.id,enabled:item.enabled})),'SlopeCraft.sc_preset_json'));
  $('load-preset').addEventListener('click',()=>$('preset-input').click());$('preset-input').addEventListener('change',async event=>{try{const file=event.target.files[0];if(file){applyBlockPreset(JSON.parse(await file.text()));state.preset='custom';renderBlocks();persist();notify('已加载方块预设。');}}catch(error){handleError(error);}event.target.value='';});
  $('save-settings-file').addEventListener('click',()=>downloadJson(captureSettings(),'SlopeCraft-Web-settings.json'));
  $('load-settings-file').addEventListener('click',()=>$('settings-input').click());$('settings-input').addEventListener('change',async event=>{try{const file=event.target.files[0];if(file){restoreSettings(JSON.parse(await file.text()));invalidateConversion();persist();notify('已导入设置。线程数修改后请应用并重载引擎。');}}catch(error){handleError(error);}event.target.value='';});
  $('reset-settings').addEventListener('click',()=>{localStorage.removeItem('slopecraft-web:settings:v1');location.reload();});
  $('apply-settings').addEventListener('click',()=>{persist();$('settings-dialog').close();initializeEngine();});
  $('import-blocklist').addEventListener('click',()=>$('blocklist-input').click());$('blocklist-input').accept='.zip,application/zip';$('blocklist-input').addEventListener('change',async event=>{try{await importBlocklist(event.target.files[0]);}catch(error){handleError(error);}event.target.value='';});
  $('clear-custom-blocklists').addEventListener('click',()=>{const names=new Set(state.groups.filter(g=>g.name.startsWith('用户-')).map(g=>g.name));state.blocks=state.blocks.filter(b=>!names.has(b.group));state.groups=state.groups.filter(g=>!names.has(g.name));for(const name of names)state.enabledGroups.delete(name);normalizeSelections();markCustom();invalidateConversion();renderBlocks();renderBlocklistChoices();persist();notify('已清除导入的方块列表。');});
  let dragDepth=0;
  window.addEventListener('dragenter',event=>{if(event.dataTransfer?.types.includes('Files')){event.preventDefault();dragDepth++;$('drop-overlay').hidden=false;}});
  window.addEventListener('dragover',event=>{if(event.dataTransfer?.types.includes('Files'))event.preventDefault();});
  window.addEventListener('dragleave',()=>{dragDepth=Math.max(0,dragDepth-1);if(!dragDepth)$('drop-overlay').hidden=true;});
  window.addEventListener('drop',event=>{event.preventDefault();dragDepth=0;$('drop-overlay').hidden=true;const files=[...(event.dataTransfer?.files||[])].filter(file=>file.type.startsWith('image/'));if(files.length)addFiles(files);});
  window.addEventListener('paste',event=>{if(event.target instanceof HTMLInputElement||event.target instanceof HTMLTextAreaElement)return;const files=[...(event.clipboardData?.files||[])].filter(file=>file.type.startsWith('image/'));if(files.length){event.preventDefault();addFiles(files);}});
  window.addEventListener('beforeunload',event=>{if(state.busy){event.preventDefault();event.returnValue='';}});
}
async function boot() {
  $('thread-count').value=Math.min(8,Math.max(2,(navigator.hardwareConcurrency||4)-1));
  wireEvents();renderQueue();renderPreview();updateButtons();
  try{
    const response=await fetch('./assets/blocklists.json');if(!response.ok)throw new Error(`无法加载方块数据（HTTP ${response.status}）。`);
    const catalog=await response.json();state.blocks=catalog.blocks||catalog.groups.flatMap(group=>group.blocks);state.groups=catalog.groups||[];state.baseColors=catalog.baseColors||[];
    await applyPreset('vanilla');
    try{const saved=JSON.parse(localStorage.getItem('slopecraft-web:settings:v1')||'null');if(saved){state.pendingSaved=saved;restoreSettings(saved);}}catch(error){console.warn('未恢复本地设置：',error);}
    state.settingsRestored=true;renderBlocks();renderBlocklistChoices();syncMapType();renderMapRanges();
  }catch(error){handleError(error);$('block-grid').replaceChildren(text('div',error.message,'empty-state'));}
  await initializeEngine();
}
boot().catch(handleError);
