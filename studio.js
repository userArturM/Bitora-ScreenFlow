/* Studio extensions share the renderer's state, with all filesystem access through the preload. */
const {cropRect}=window.StudioShared;
let regionSelection=null,regionImage=null,regionDraft=null,cropTimer=null,cropStream=null,cropVideo=null;
const gains={};let testStream,testContext,testInterval;let testStarted=0,testPeak=0;
function saveStudio(){try{localStorage.setItem('bitora-studio',JSON.stringify({systemVolume:$('systemVolume').value,micVolume:$('micVolume').value,floating:$('floating').checked}));}catch{}}
try{const prefs=JSON.parse(localStorage.getItem('bitora-studio')||'{}');for(const id of ['systemVolume','micVolume'])if(prefs[id]!==undefined)$(id).value=prefs[id];if(prefs.floating!==undefined)$('floating').checked=prefs.floating;}catch{}
for(const id of ['systemVolume','micVolume']){const update=()=>{$(id+'Label').textContent=$(id).value+'%';const g=gains[id==='micVolume'?'mic':'system'];if(g)g.gain.value=Number($(id).value)/100;saveStudio();};$(id).oninput=update;update();}
$('floating').onchange=saveStudio;
window.studioGain=(kind,g)=>gains[kind]=g;
window.studioReport=()=>{let level=0;const t=$('meterFill').style.transform;const m=/scaleX\(([\d.]+)\)/.exec(t);if(m)level=Number(m[1]);api.panelState({state,elapsed:Math.floor(elapsed/1000),level,enabled:$('floating').checked}).catch(()=>{});};
function regionKey(){return source?'region:'+source.id:'';}
function readRegion(){try{regionSelection=JSON.parse(localStorage.getItem(regionKey())||'null');}catch{regionSelection=null;}renderRegion();}
function renderRegion(){$('regionLabel').textContent=regionSelection?`${regionSelection.width} × ${regionSelection.height} px`:'';$('regionClear').hidden=!regionSelection;}
let lastSourceId='';setInterval(()=>{if(source?.id!==lastSourceId){lastSourceId=source?.id;readRegion();}$('region').disabled=!source||state!=='idle'||takingShot;$('regionClear').disabled=state!=='idle';$('testMic').disabled=state!=='idle';},250);
function effectiveRegion(w,h){if(regionSelection&&(regionSelection.sourceWidth!==w||regionSelection.sourceHeight!==h))throw new Error('Размер источника изменился. Выберите область заново или нажмите «Весь источник».');return cropRect(regionSelection,w,h);}
window.studioDrawFrame=(canvas,video)=>{const r=effectiveRegion(video.videoWidth,video.videoHeight);canvas.width=r.width;canvas.height=r.height;canvas.getContext('2d').drawImage(video,r.x,r.y,r.width,r.height,0,0,r.width,r.height);};
window.studioVideoTracks=async stream=>{
  await stopMicTest();if(!regionSelection)return stream.getVideoTracks();
  cropVideo=document.createElement('video');cropVideo.muted=true;cropVideo.srcObject=stream;await cropVideo.play();const canvas=document.createElement('canvas');window.studioDrawFrame(canvas,cropVideo);cropStream=canvas.captureStream(Number($('fps').value));cropTimer=setInterval(()=>{if(cropVideo?.videoWidth)try{window.studioDrawFrame(canvas,cropVideo);}catch(e){clearInterval(cropTimer);fail('Запись области остановлена.',e);stop();}},1000/Number($('fps').value));return cropStream.getVideoTracks();
};
window.studioCleanup=async()=>{clearInterval(cropTimer);cropTimer=null;cropStream?.getTracks().forEach(t=>t.stop());cropStream=null;if(cropVideo)cropVideo.srcObject=null;cropVideo=null;delete gains.mic;delete gains.system;};
$('regionClear').onclick=()=>{regionSelection=null;localStorage.removeItem(regionKey());renderRegion();};
function point(canvas,e){const b=canvas.getBoundingClientRect();return {x:Math.max(0,Math.min(canvas.width,(e.clientX-b.left)*canvas.width/b.width)),y:Math.max(0,Math.min(canvas.height,(e.clientY-b.top)*canvas.height/b.height))};}
function rectangle(a,b){return {x:Math.round(Math.min(a.x,b.x)),y:Math.round(Math.min(a.y,b.y)),width:Math.round(Math.abs(a.x-b.x)),height:Math.round(Math.abs(a.y-b.y))};}
function drawRegion(){const c=$('regionCanvas'),ctx=c.getContext('2d');ctx.drawImage(regionImage,0,0);if(regionDraft){ctx.fillStyle='#0008';ctx.fillRect(0,0,c.width,c.height);ctx.drawImage(regionImage,regionDraft.x,regionDraft.y,regionDraft.width,regionDraft.height,regionDraft.x,regionDraft.y,regionDraft.width,regionDraft.height);ctx.strokeStyle='#b7f06c';ctx.lineWidth=Math.max(2,c.width/400);ctx.strokeRect(regionDraft.x,regionDraft.y,regionDraft.width,regionDraft.height);for(const [id,key]of [['rx','x'],['ry','y'],['rw','width'],['rh','height']])$(id).value=regionDraft[key];}}
$('region').onclick=async()=>{if(state!=='idle'||!source)return;let s,v;try{await api.select(source.id,false);s=await navigator.mediaDevices.getDisplayMedia({video:true,audio:false});v=document.createElement('video');v.muted=true;v.srcObject=s;await v.play();regionImage=document.createElement('canvas');regionImage.width=v.videoWidth;regionImage.height=v.videoHeight;regionImage.getContext('2d').drawImage(v,0,0);const c=$('regionCanvas');c.width=v.videoWidth;c.height=v.videoHeight;regionDraft=cropRect(regionSelection,c.width,c.height);$('regionDialog').showModal();drawRegion();}catch(e){fail('Не удалось выбрать область.',e);}finally{s?.getTracks().forEach(t=>t.stop());if(v)v.srcObject=null;}};
let regionAnchor;
$('regionCanvas').onpointerdown=e=>{regionAnchor=point($('regionCanvas'),e);$('regionCanvas').setPointerCapture(e.pointerId);};
$('regionCanvas').onpointermove=e=>{if(regionAnchor){regionDraft=cropRect(rectangle(regionAnchor,point($('regionCanvas'),e)),$('regionCanvas').width,$('regionCanvas').height);drawRegion();}};
$('regionCanvas').onpointerup=()=>regionAnchor=null;
for(const id of ['rx','ry','rw','rh'])$(id).onchange=()=>{regionDraft=cropRect({x:Number($('rx').value),y:Number($('ry').value),width:Number($('rw').value),height:Number($('rh').value)},regionImage.width,regionImage.height);drawRegion();};
$('regionApply').onclick=()=>{regionSelection={...regionDraft,sourceWidth:regionImage.width,sourceHeight:regionImage.height};localStorage.setItem(regionKey(),JSON.stringify(regionSelection));renderRegion();$('regionDialog').close();};
$('regionCancel').onclick=()=>$('regionDialog').close();
// Microphone test has its own lifecycle and never feeds the speakers.
async function stopMicTest(){clearInterval(testInterval);testInterval=null;testStream?.getTracks().forEach(t=>t.stop());testStream=null;await testContext?.close().catch(()=>{});testContext=null;$('testMic').textContent='Проверить микрофон';}
$('testMic').onclick=async()=>{if(testStream){await stopMicTest();return;}try{testStream=await navigator.mediaDevices.getUserMedia({audio:{deviceId:$('micDevice').value?{exact:$('micDevice').value}:undefined,echoCancellation:true,noiseSuppression:true}});testContext=new AudioContext();await testContext.resume();const a=testContext.createAnalyser();testContext.createMediaStreamSource(testStream).connect(a);const data=new Uint8Array(a.fftSize);testStarted=Date.now();testPeak=0;$('testMic').textContent='Остановить проверку';testInterval=setInterval(()=>{a.getByteTimeDomainData(data);let sum=0;for(const v of data)sum+=((v-128)/128)**2;const rms=Math.sqrt(sum/data.length)*Number($('micVolume').value)/100;testPeak=Math.max(testPeak,rms);$('micTestStatus').textContent=rms>0.015?'Микрофон работает · '+Math.round(Math.min(1,rms*5)*100)+'%':Date.now()-testStarted>4000&&testPeak<0.015?'Нет сигнала. Проверьте устройство и его громкость.':'Говорите в микрофон…';if(Date.now()-testStarted>15000)stopMicTest();},100);}catch(e){await stopMicTest();fail('Микрофон недоступен.',e);}};
let silenceSince=0,silenceWarned=false;
setInterval(()=>{if(state!=='recording'){silenceSince=0;silenceWarned=false;return;}if($('meterText').textContent==='Тишина'){silenceSince ||= Date.now();if(Date.now()-silenceSince>10000&&!silenceWarned){silenceWarned=true;message('Более 10 секунд нет звукового сигнала. Проверьте микрофон и громкость источников.');}}else silenceSince=0;},1000);
// Non-destructive screenshot editor; bounded undo history avoids unbounded RAM growth.
let editHistory=[],editAnchor=null,editSnapshot=null;
async function openEditor(url){const im=new Image();im.crossOrigin='anonymous';im.src=url;await im.decode();const c=$('editCanvas');c.width=im.naturalWidth;c.height=im.naturalHeight;c.getContext('2d').drawImage(im,0,0);editHistory=[];$('editStatus').textContent='';$('editorDialog').showModal();}
function pushUndo(){const c=$('editCanvas');editHistory.push(c.toDataURL('image/png'));if(editHistory.length>8)editHistory.shift();}
async function canvasBytes(c){const b=await new Promise((resolve,reject)=>c.toBlob(v=>v?resolve(v):reject(new Error('Не удалось создать PNG')),'image/png'));return new Uint8Array(await b.arrayBuffer());}
$('editShot').onclick=()=>openEditor($('shotImage').src).catch(e=>fail('',e));
$('copyShot').onclick=()=>api.shotAction('copy',lastScreenshot.name).then(()=>message('Скриншот скопирован.')).catch(e=>fail('',e));
$('editClose').onclick=()=>$('editorDialog').close();
$('editUndo').onclick=async()=>{if(!editHistory.length)return;const im=new Image();im.src=editHistory.pop();await im.decode();const c=$('editCanvas');c.width=im.naturalWidth;c.height=im.naturalHeight;c.getContext('2d').drawImage(im,0,0);};
function drawAnnotation(a,b,preview=false){const c=$('editCanvas'),ctx=c.getContext('2d'),r=rectangle(a,b),tool=$('editTool').value;ctx.strokeStyle=$('editColor').value;ctx.fillStyle=$('editColor').value;ctx.lineWidth=Math.max(3,c.width/300);ctx.lineCap='round';if(tool==='arrow'){ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);const angle=Math.atan2(b.y-a.y,b.x-a.x),head=Math.max(16,c.width/50);ctx.moveTo(b.x-head*Math.cos(angle-0.5),b.y-head*Math.sin(angle-0.5));ctx.lineTo(b.x,b.y);ctx.lineTo(b.x-head*Math.cos(angle+0.5),b.y-head*Math.sin(angle+0.5));ctx.stroke();}else if(tool==='rect'||preview){ctx.strokeRect(r.x,r.y,r.width,r.height);}else if(tool==='blur'&&r.width>1&&r.height>1){const temp=document.createElement('canvas');temp.width=r.width;temp.height=r.height;temp.getContext('2d').drawImage(c,r.x,r.y,r.width,r.height,0,0,r.width,r.height);ctx.save();ctx.beginPath();ctx.rect(r.x,r.y,r.width,r.height);ctx.clip();ctx.filter='blur('+Math.max(12,c.width/80)+'px)';ctx.drawImage(temp,r.x,r.y);ctx.restore();}else if(tool==='crop'&&r.width>1&&r.height>1){const data=ctx.getImageData(r.x,r.y,r.width,r.height);c.width=r.width;c.height=r.height;ctx.putImageData(data,0,0);}}
$('editCanvas').onpointerdown=e=>{const c=$('editCanvas'),ctx=c.getContext('2d');pushUndo();editAnchor=point(c,e);if($('editTool').value==='text'){ctx.font=Math.max(22,c.width/35)+'px Segoe UI';ctx.fillStyle=$('editColor').value;ctx.fillText($('editText').value,editAnchor.x,editAnchor.y);editAnchor=null;return;}editSnapshot=ctx.getImageData(0,0,c.width,c.height);c.setPointerCapture(e.pointerId);};
$('editCanvas').onpointermove=e=>{if(!editAnchor)return;const c=$('editCanvas');c.getContext('2d').putImageData(editSnapshot,0,0);drawAnnotation(editAnchor,point(c,e),true);};
$('editCanvas').onpointerup=e=>{if(!editAnchor)return;const c=$('editCanvas');c.getContext('2d').putImageData(editSnapshot,0,0);drawAnnotation(editAnchor,point(c,e));editAnchor=null;editSnapshot=null;};
$('editCanvas').onpointercancel=()=>{if(editSnapshot)$('editCanvas').getContext('2d').putImageData(editSnapshot,0,0);editAnchor=null;editSnapshot=null;};
$('editSave').onclick=async()=>{try{const r=await api.screenshotSave(await canvasBytes($('editCanvas')));$('editStatus').textContent='Сохранено: '+r.name;await loadLibrary();}catch(e){fail('Не удалось сохранить.',e);}};
$('editCopy').onclick=async()=>{try{await api.clipboardPng(await canvasBytes($('editCanvas')));$('editStatus').textContent='Скопировано в буфер обмена.';}catch(e){fail('',e);}};
// Unified library, playback and precise MP4 export of a selected range.
let playerItem=null,trimBusy=false;
async function openPlayer(item){playerItem=item;$('playerTitle').textContent=item.name;$('trimStatus').textContent='Исходное видео останется без изменений.';$('trimSave').disabled=trimBusy||!cfg.ffmpeg;$('playerVideo').src=await api.mediaUrl('video',item.name);$('trimStart').value=0;$('trimEnd').value='';$('playerDialog').showModal();}
$('playerVideo').onloadedmetadata=()=>{const d=$('playerVideo').duration;if(Number.isFinite(d)){$('trimEnd').value=d.toFixed(2);syncTrimTimeline();}$('playerVideo').playbackRate=Number($('playerSpeed').value);};
$('trimMarkStart').onclick=()=>{$('trimStart').value=$('playerVideo').currentTime.toFixed(2);syncTrimTimeline();};
$('trimMarkEnd').onclick=()=>{$('trimEnd').value=$('playerVideo').currentTime.toFixed(2);syncTrimTimeline();};
$('playerClose').onclick=()=>$('playerDialog').close();$('playerDialog').addEventListener('close',()=>{$('playerVideo').pause();$('playerVideo').removeAttribute('src');$('playerVideo').load();});
$('trimSave').onclick=async()=>{if(trimBusy)return;trimBusy=true;$('trimSave').disabled=true;$('trimStatus').textContent='Сохранение фрагмента… Не закрывайте программу.';try{const name=await api.trimVideo(playerItem.name,Number($('trimStart').value),Number($('trimEnd').value));$('trimStatus').textContent='Сохранено: '+name;await loadLibrary();}catch(e){$('trimStatus').textContent=humanizeError(e).text;fail('Обрезка не выполнена.',e);}finally{trimBusy=false;$('trimSave').disabled=false;}};
const originalBuildRow=buildRow;
buildRow=function(item){if(item.kind!=='image'){const row=originalBuildRow(item);row.querySelector('.actions button').onclick=()=>openPlayer(item).catch(e=>fail('',e));row.querySelector('.thumb').onclick=()=>openPlayer(item).catch(e=>fail('',e));return row;}const row=document.createElement('div');row.className='recording';const thumb=document.createElement('div');thumb.className='thumb';const img=new Image();img.alt='';thumb.append(img);const info=document.createElement('div');info.className='info';const title=document.createElement('h3');title.textContent=item.name;const meta=document.createElement('p');meta.textContent='PNG · '+new Date(item.date).toLocaleString('ru-RU')+' · '+formatBytes(item.size);info.append(title,meta);const actions=document.createElement('div');actions.className='actions';const edit=async()=>openEditor(await api.mediaUrl('image',item.name));thumb.onclick=()=>edit().catch(e=>fail('',e));actions.append(actionButton('edit','Просмотреть и редактировать',()=>edit().catch(e=>fail('',e))),actionButton('save','Копировать изображение',()=>api.shotAction('copy',item.name).then(()=>message('Изображение скопировано.')).catch(e=>fail('',e))),actionButton('folder','Показать в папке',()=>api.shotAction('reveal',item.name).catch(e=>fail('',e))),actionButton('trash','Удалить в корзину',async()=>{if(confirm('Переместить скриншот в корзину?'))try{await api.shotAction('remove',item.name);await loadLibrary();}catch(e){fail('',e);}}));row.append(thumb,info,actions);row.loadInfo=async()=>{img.src=await api.mediaUrl('image',item.name);};return row;};
loadLibrary=async function(){const token=++libraryToken;try{cfg.ffmpeg=(await api.config()).ffmpeg;const [{folder,items},shots]=await Promise.all([api.library(),api.shotsList()]);if(token!==libraryToken)return;let all=[...items.map(i=>({...i,kind:'video'})),...shots];$('count').textContent=all.length;$('folderPath').textContent=folder;const q=$('librarySearch').value.toLocaleLowerCase(),kind=$('libraryKind').value;all=all.filter(i=>(kind==='all'||kind===i.kind)&&i.name.toLocaleLowerCase().includes(q));const sort=$('librarySort').value;all.sort((a,b)=>sort==='name'?a.name.localeCompare(b.name):sort==='size'?b.size-a.size:sort==='old'?a.date-b.date:b.date-a.date);const rows=all.map(buildRow);$('recordings').replaceChildren(...rows);if(!rows.length){const p=document.createElement('p');p.className='empty-library';p.textContent='Файлы не найдены. Измените фильтр или создайте запись / скриншот.';$('recordings').append(p);}if(!$('libraryView').hidden)for(const row of rows){if(token!==libraryToken)break;await row.loadInfo();}}catch(e){fail('Не удалось открыть библиотеку.',e);}};
let searchTimer;$('librarySearch').oninput=()=>{clearTimeout(searchTimer);searchTimer=setTimeout(loadLibrary,250);};$('libraryKind').onchange=$('librarySort').onchange=loadLibrary;
$('diagnostic').onclick=()=>api.diagnosticSave().then(saved=>{if(saved)message('Отчёт сохранён. Вы можете отправить его для разбора ошибки.');}).catch(e=>fail('',e));
let updatePoll;
function showUpdate(r){
  const labels={checking:'Проверяем обновления…',idle:'Проверьте обновления',available:'Обновление доступно',current:'Новых совместимых обновлений нет',downloading:'Скачивание: '+((r.received||0)/1048576).toFixed(1)+' МБ',ready:'SHA-256 проверен. Можно установить.',queued:'Установка начнётся после завершения операций.',installing:'Запуск установки…',error:r.error};
  $('updateNotes').textContent=[labels[r.phase],r.version?'Версия: '+r.version:'',r.notes||'',r.error||''].filter(Boolean).join('\n\n');
  $('updateDownload').textContent=r.received?'Продолжить скачивание':'Скачать обновление';$('updateCancel').disabled=!['downloading','queued'].includes(r.phase);$('updateDownload').disabled=r.phase!=='available';$('updateInstall').disabled=r.phase!=='ready';
}
$('updates').onclick=async()=>{$('updatesDialog').showModal();$('updateDownload').disabled=true;$('updateInstall').disabled=true;try{showUpdate(await api.updatesCheck());}catch(e){$('updateNotes').textContent=e.message;}clearInterval(updatePoll);updatePoll=setInterval(()=>api.updatesStatus().then(showUpdate).catch(()=>{}),1000);};
$('updateDownload').onclick=async()=>{try{$('updateDownload').disabled=true;showUpdate(await api.updatesDownload());}catch(e){$('updateNotes').textContent=e.message;}};
$('updateInstall').onclick=()=>api.updatesInstall().then(showUpdate).catch(e=>fail('',e));
$('updateGithub').onclick=()=>api.updatesOpen().catch(e=>fail('',e));
$('updateClose').onclick=()=>$('updatesDialog').close();
$('updatesDialog').addEventListener('close',()=>clearInterval(updatePoll));
window.addEventListener('error',e=>api.diagnosticLog('renderer',e.message).catch(()=>{}));window.addEventListener('unhandledrejection',e=>api.diagnosticLog('promise',String(e.reason)).catch(()=>{}));

$('updateCancel').onclick=()=>api.updatesCancel().then(showUpdate).catch(e=>fail('',e));
api.updatesResult().then(r=>{if(r&&r.status!=='success')message('Последнее обновление: '+(r.status==='rolled-back'?'восстановлена предыдущая версия. ':'установка не завершена. ')+r.message,true);}).catch(()=>{});

async function offerRecovery(){
  const {items}=await api.library();const unfinished=items.filter(i=>i.partial);
  if(!unfinished.length)return;
  $('recoveryList').replaceChildren();
  for(const item of unfinished){
    const row=document.createElement('p'),name=document.createElement('span'),button=document.createElement('button');
    name.textContent=item.name+' · '+formatBytes(item.size)+' ';button.textContent='Восстановить';button.className='secondary';
    button.onclick=async()=>{button.disabled=true;$('recoveryStatus').textContent='Восстанавливаем запись…';try{const restored=await api.repair(item.name);button.textContent='Восстановлено';$('recoveryStatus').textContent='Сохранено: '+restored;await loadLibrary();}catch(e){button.disabled=false;$('recoveryStatus').textContent='Не удалось восстановить. Исходный файл сохранён. '+e.message;}};
    row.append(name,button);$('recoveryList').append(row);
  }
  $('recoveryDialog').showModal();
}
$('recoveryClose').onclick=()=>$('recoveryDialog').close();
offerRecovery().catch(e=>api.diagnosticLog('recovery',String(e)).catch(()=>{}));

function syncTrimTimeline(){
  const duration=$('playerVideo').duration;if(!Number.isFinite(duration)||duration<=0)return;
  for(const [range,field] of [['trimRangeStart','trimStart'],['trimRangeEnd','trimEnd']]){$(range).max=duration;$(range).value=Math.max(0,Math.min(duration,Number($(field).value)||0));}
  const start=Number($('trimStart').value),end=Number($('trimEnd').value);
  $('trimSelection').textContent=end>start?`Выбрано: ${start.toFixed(2)}–${end.toFixed(2)} с · ${(end-start).toFixed(2)} с`:'Конец должен быть позже начала';
}
for(const [range,field,other,isStart] of [['trimRangeStart','trimStart','trimEnd',true],['trimRangeEnd','trimEnd','trimStart',false]]){
  $(range).oninput=()=>{const value=Number($(range).value),edge=Number($(other).value);$(field).value=(isStart?Math.max(0,Math.min(value,edge-0.01)):Math.min($('playerVideo').duration,Math.max(value,edge+0.01))).toFixed(2);$('playerVideo').currentTime=Number($(field).value);syncTrimTimeline();};
  $(field).addEventListener('input',syncTrimTimeline);
}
function togglePlayback(){const video=$('playerVideo');if(video.paused)video.play().catch(e=>fail('Не удалось воспроизвести.',e));else video.pause();}
async function toggleFullscreen(){if(document.fullscreenElement)await document.exitFullscreen();else await $('playerVideo').requestFullscreen();}
$('playerToggle').onclick=togglePlayback;
$('playerFullscreen').onclick=()=>toggleFullscreen().catch(e=>fail('Полный экран недоступен.',e));
$('playerSpeed').onchange=()=>{$('playerVideo').playbackRate=Number($('playerSpeed').value);};
document.addEventListener('keydown',e=>{
  if(!$('playerDialog').open||e.ctrlKey||e.altKey||e.metaKey||e.target.closest?.('input,select,textarea,button,[contenteditable]'))return;
  const video=$('playerVideo');
  if(e.code==='Space'){e.preventDefault();togglePlayback();}
  if(['ArrowLeft','ArrowRight'].includes(e.code)){e.preventDefault();if(Number.isFinite(video.duration))video.currentTime=Math.max(0,Math.min(video.duration,video.currentTime+(e.code==='ArrowLeft'?-1:1)*(e.shiftKey?30:5)));}
  if(e.code==='KeyF'){e.preventDefault();toggleFullscreen().catch(e=>fail('',e));}
});
