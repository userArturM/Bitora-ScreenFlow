const $ = id => document.getElementById(id);
const api = window.desktop;
const {formatBytes, formatDuration, estimateSeconds, formatEstimate, humanizeError, acceleratorFromEvent, displayAccelerator} = window.Shared;
const SVG_NS = 'http://www.w3.org/2000/svg';
const LOW_DISK_STOP = 300 * 1024 ** 2, LOW_DISK_WARN = 2 * 1024 ** 3;
let source, recorder, capture, microphone, audioContext, analyser, meterTimer, cfg = {hotkeys: {}, ffmpeg: false, autoRepair: true};
let state='idle', queue=Promise.resolve(), writeError=null, elapsed=0, lastTick=0, byteCount=0, pendingBytes=0, closeAfter=false;
let capturingHotkey=false, lowDiskWarned=false, reportedSecond=-1, libraryToken=0;
let takingShot=false,lastScreenshot=null;
let settings={};
try {settings=JSON.parse(localStorage.getItem('screenflow-settings')||'{}');} catch {}
const settingsIds=['fps','quality','systemAudio','mic','delay','minimize'];
for(const id of settingsIds) {
  if(settings[id]!==undefined) {if($(id).type==='checkbox') $(id).checked=!!settings[id];else $(id).value=settings[id];}
  $(id).addEventListener('change',()=>{
    for(const key of settingsIds) settings[key]=$(key).type==='checkbox'?$(key).checked:$(key).value;
    try {localStorage.setItem('screenflow-settings',JSON.stringify(settings));} catch {}
    refreshDisk();
  });
}

function icon(name) {
  const svg=document.createElementNS(SVG_NS,'svg'), use=document.createElementNS(SVG_NS,'use');
  svg.setAttribute('class','ic');svg.setAttribute('aria-hidden','true');use.setAttribute('href','#i-'+name);svg.append(use);return svg;
}
function message(text,error=false,details='') {
  const box=$('message'), body=document.createElement('div'), close=document.createElement('button');
  body.className='msg-body';body.append(Object.assign(document.createElement('span'),{textContent:text}));
  if(details && details!==text) {
    const d=document.createElement('details'), s=document.createElement('summary'), pre=document.createElement('pre');
    s.textContent='Подробности';pre.textContent=details;d.append(s,pre);body.append(d);
  }
  close.className='dismiss';close.setAttribute('aria-label','Закрыть сообщение');close.append(icon('close'));close.onclick=()=>{box.hidden=true;};
  box.replaceChildren(body,close);box.className=error?'error':'';box.hidden=false;
}
function fail(prefix,error) {api.diagnosticLog(prefix,String(error)).catch(()=>{});const h=humanizeError(error);message((prefix?prefix+' ':'')+h.text,true,h.details);}

function reportState() {window.studioReport?.();api.state({state,takingShot,elapsed:Math.floor(elapsed/1000)}).catch(()=>{});}
function updateUI() {
  const idle=state==='idle'&&!takingShot, active=['recording','paused'].includes(state);
  $('start').hidden=active;$('start').disabled=!idle||!source;
  $('start').lastElementChild.textContent={preparing:'Подготовка…',saving:'Сохранение…'}[state]||'Начать запись';
  $('pause').hidden=$('stop').hidden=!active;
  $('pause').lastElementChild.textContent=state==='paused'?'Продолжить':'Пауза';
  $('pause').firstElementChild.firstElementChild.setAttribute('href',state==='paused'?'#i-play':'#i-pause');
  $('choose').disabled=!idle;$('change').disabled=!idle||!source;
  for(const id of settingsIds) $(id).disabled=!idle;
  $('micDevice').disabled=!idle||!$('mic').checked;
  $('autoRepair').disabled=!idle||!cfg.ffmpeg;
  $('chooseFolder').disabled=!idle;
  $('screenshot').disabled=takingShot||!source||['preparing','saving'].includes(state);
  $('status').textContent={idle:'Готов к записи',preparing:'Подготовка…',recording:'● Идёт запись',paused:'Ⅱ На паузе',saving:'Сохранение…'}[state];
  $('status').classList.toggle('live',active);
  $('recordDot').classList.toggle('live',state==='recording');
  reportState();
}
function tick() {
  const now=performance.now();
  if(state==='recording') elapsed+=now-lastTick;
  lastTick=now;
  const seconds=Math.floor(elapsed/1000);
  $('timer').textContent=formatDuration(seconds);
  if(['recording','paused'].includes(state) && seconds!==reportedSecond) {reportedSecond=seconds;reportState();}
}
setInterval(tick,200);

// --- свободное место на диске ---
async function refreshDisk() {
  try {
    const d=await api.disk(), withAudio=$('systemAudio').checked||$('mic').checked;
    const text='Свободно: '+formatBytes(d.free)+' · хватит на '+formatEstimate(estimateSeconds(d.free,Number($('quality').value),withAudio));
    $('diskInfo').textContent=text;$('libraryDisk').textContent=text;
    if(['recording','paused'].includes(state)) {
      if(d.free<LOW_DISK_STOP) {message('На диске почти не осталось места. Запись остановлена и сохранена.',true);stop();}
      else if(d.free<LOW_DISK_WARN && !lowDiskWarned) {lowDiskWarned=true;message('Мало места на диске: осталось '+formatBytes(d.free)+'. Освободите место или завершите запись.');}
    }
  } catch {$('diskInfo').textContent='';}
}
setInterval(refreshDisk,5000);

// --- индикатор уровня звука ---
function startMeter() {
  const buffer=new Uint8Array(analyser.fftSize);let lastLabel='';
  meterTimer=setInterval(()=>{
    analyser.getByteTimeDomainData(buffer);
    let sum=0;for(const v of buffer) {const x=(v-128)/128;sum+=x*x;}
    const db=20*Math.log10(Math.sqrt(sum/buffer.length)||1e-5), level=Math.min(1,Math.max(0,(db+60)/60));
    $('meterFill').style.transform='scaleX('+level.toFixed(2)+')';
    const label=level<0.05?'Тишина':level>0.92?'Слишком громко':'Звук идёт';
    if(label!==lastLabel) {lastLabel=label;$('meterText').textContent=label;}
  },100);
}
function stopMeter() {clearInterval(meterTimer);meterTimer=null;analyser=null;$('meterFill').style.transform='scaleX(0)';$('meterText').textContent='—';}

async function showSources() {
  $('picker').showModal();await refreshSources();
}
async function refreshSources() {
  $('sources').textContent='Загрузка источников…';$('refresh').disabled=true;
  try {
    const sources=await api.sources();$('sources').replaceChildren();
    if(!sources.length) $('sources').textContent='Источники не найдены. Проверьте разрешение на запись экрана.';
    for(const item of sources) {
      const button=document.createElement('button');button.className='source';
      const image=document.createElement('img');image.src=item.image;image.alt='';
      const label=document.createElement('span');label.textContent=item.name;
      button.append(image,label);button.title=item.name;
      button.onclick=()=>{source=item;$('thumbnail').src=item.image;$('thumbnail').hidden=false;$('empty').hidden=true;
        $('sourceLabel').textContent=item.name;$('picker').close();updateUI();};
      $('sources').append(button);
    }
  } catch(e) {$('sources').textContent='Не удалось получить источники: '+humanizeError(e).text;}
  finally {$('refresh').disabled=false;}
}
async function microphoneDevices() {
  $('micDevice').disabled=!$('mic').checked;
  if(!$('mic').checked) return;
  let stream;
  try {
    stream=await navigator.mediaDevices.getUserMedia({audio:true});
    const devices=await navigator.mediaDevices.enumerateDevices();
    $('micDevice').replaceChildren(new Option('По умолчанию',''));
    for(const d of devices.filter(d=>d.kind==='audioinput'&&d.deviceId!=='default')) $('micDevice').add(new Option(d.label||'Микрофон',d.deviceId));
  } catch(e) {fail('Микрофон недоступен.',e);}
  finally {stream?.getTracks().forEach(t=>t.stop());}
}
async function cleanup() {
  await window.studioCleanup?.();stopMeter();
  capture?.getTracks().forEach(t=>t.stop());microphone?.getTracks().forEach(t=>t.stop());
  capture=null;microphone=null;
  if(audioContext) {await audioContext.close().catch(()=>{});audioContext=null;}
  $('preview').srcObject=null;$('preview').hidden=true;$('thumbnail').hidden=!source;$('countdown').hidden=true;
}
async function start() {
  if(state!=='idle'||takingShot) return;
  if(!source) {await showSources();return;}
  state='preparing';updateUI();$('message').hidden=true;lowDiskWarned=false;
  let opened=false;
  try {
    const mime=['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm'].find(t=>MediaRecorder.isTypeSupported(t));
    if(!mime) throw new Error('Видеокодек WebM недоступен.');
    await api.select(source.id,$('systemAudio').checked);
    capture=await navigator.mediaDevices.getDisplayMedia({video:{frameRate:{ideal:Number($('fps').value),max:Number($('fps').value)}},audio:$('systemAudio').checked});
    if($('systemAudio').checked && !capture.getAudioTracks().some(t=>t.readyState==='live')) throw new Error('Системный звук недоступен. Отключите его в настройках записи и повторите.');
    if($('mic').checked) microphone=await navigator.mediaDevices.getUserMedia({audio:{
      deviceId:$('micDevice').value?{exact:$('micDevice').value}:undefined,echoCancellation:true,noiseSuppression:true
    }});
    const audioTracks=[...capture.getAudioTracks(),...(microphone?.getAudioTracks()||[])];
    const output=new MediaStream(await window.studioVideoTracks(capture));
    if(audioTracks.length) {
      audioContext=new AudioContext();await audioContext.resume();
      const destination=audioContext.createMediaStreamDestination();
      analyser=audioContext.createAnalyser();analyser.fftSize=1024;
      for(const track of audioTracks) {
        const input=audioContext.createMediaStreamSource(new MediaStream([track]));
        const gain=audioContext.createGain();const isMic=microphone?.getAudioTracks().includes(track);gain.gain.value=Number($(isMic?'micVolume':'systemVolume').value)/100;window.studioGain?.(isMic?'mic':'system',gain);
        input.connect(gain).connect(destination);gain.connect(analyser);
      }
      output.addTrack(destination.stream.getAudioTracks()[0]);
      startMeter();
    } else $('meterText').textContent='Нет звука';
    $('thumbnail').hidden=true;$('preview').hidden=false;$('preview').srcObject=capture;
    await $('preview').play();
    if($('delay').checked) {
      $('countdown').hidden=false;
      for(let n=3;n>0;n--) {$('countdown').textContent=n;await new Promise(resolve=>setTimeout(resolve,1000));}
      $('countdown').hidden=true;
    }
    if(capture.getVideoTracks()[0].readyState!=='live') throw new Error('Источник записи был закрыт.');
    recorder=new MediaRecorder(output,{mimeType:mime,videoBitsPerSecond:Number($('quality').value),audioBitsPerSecond:192000});
    await api.begin();opened=true;
    elapsed=0;lastTick=performance.now();byteCount=0;pendingBytes=0;writeError=null;queue=Promise.resolve();
    recorder.ondataavailable=e=>{
      if(!e.data.size) return;
      pendingBytes+=e.data.size;
      queue=queue.then(async()=>{
        if(writeError) return;
        byteCount=await api.append(new Uint8Array(await e.data.arrayBuffer()));
        $('size').textContent=formatBytes(byteCount)+' · сохранено на диск';
      }).catch(error=>{writeError=error;fail('Ошибка сохранения.',error);stop();})
        .finally(()=>{pendingBytes-=e.data.size;});
      if(pendingBytes>128*1024*1024) {message('Диск не успевает сохранять видео. Запись остановлена.',true);stop();}
    };
    recorder.onerror=e=>{writeError=e.error||new Error('Ошибка кодирования');fail('',writeError);stop();};
    recorder.onstop=finish;
    capture.getVideoTracks()[0].onended=()=>stop();
    recorder.start(1000);state='recording';updateUI();tick();
    $('codecLabel').textContent='WEBM · '+$('fps').value+' КАДРОВ/С · '+(Number($('quality').value)/1e6)+' МБИТ/С';
    if($('minimize').checked) await api.minimize();
  } catch(e) {
    if(opened) await api.finish().catch(()=>{});
    await cleanup();state='idle';updateUI();
    fail('Не удалось начать запись.',e);
  }
}
function pause() {
  if(state==='recording') {tick();recorder.pause();state='paused';}
  else if(state==='paused') {lastTick=performance.now();recorder.resume();state='recording';}
  updateUI();
}
function stop() {
  if(!['recording','paused'].includes(state)) return;
  tick();state='saving';updateUI();
  if(recorder.state!=='inactive') recorder.stop();
}
async function finish() {
  state='saving';updateUI();
  try {
    await queue;
    const file=await api.finish();
    if(writeError) fail('Запись завершена с ошибкой. Проверьте сохранённый файл в «Мои записи».',writeError);
    else message(file?'Видео сохранено. Откройте «Мои записи», чтобы посмотреть его или сохранить копию.':'Запись не содержала видеоданных.');
  } catch(e) {fail('',e);}
  finally {
    await cleanup();recorder=null;state='idle';updateUI();await loadLibrary();refreshDisk();
    if(closeAfter) {closeAfter=false;await api.closeReady();}
  }
}

// --- PNG полного разрешения выбранного экрана/окна ---
async function takeScreenshot() {
  if(takingShot || !source || ['preparing','saving'].includes(state)) return;
  takingShot=true;updateUI();
  let stream,video,hidden=false;
  try {
    if(capture?.getVideoTracks().some(t=>t.readyState==='live')) video=$('preview');
    else {
      await api.select(source.id,false);
      stream=await navigator.mediaDevices.getDisplayMedia({video:true,audio:false});
      video=document.createElement('video');video.muted=true;video.srcObject=stream;
      await video.play();
    }
    if($('minimize').checked) {await api.screenshotHide();hidden=true;await new Promise(r=>setTimeout(r,350));}
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{video.cancelVideoFrameCallback(callback);reject(new Error('Нет изображения от выбранного источника.'));},8000);
      const callback=video.requestVideoFrameCallback(()=>{clearTimeout(timer);resolve();});
    });
    if(!video.videoWidth||!video.videoHeight) throw new Error('Источник не передаёт изображение.');
    const canvas=document.createElement('canvas');canvas.width=video.videoWidth;canvas.height=video.videoHeight;
    window.studioDrawFrame(canvas,video);
    const blob=await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('Не удалось создать PNG.')),'image/png'));
    lastScreenshot=await api.screenshotSave(new Uint8Array(await blob.arrayBuffer()));
    $('shotImage').src=canvas.toDataURL('image/png');
    $('shotPath').textContent=lastScreenshot.file+' · '+lastScreenshot.width+' × '+lastScreenshot.height;
    $('shotPreview').showModal();
    message('Скриншот сохранён в PNG, в папку Screenshots.');
  } catch(e) {fail('Не удалось сделать скриншот.',e);}
  finally {
    stream?.getTracks().forEach(t=>t.stop());
    if(video && video!==$('preview')) video.srcObject=null;
    if(hidden) await api.screenshotRestore().catch(()=>{});
    takingShot=false;updateUI();
  }
}

// --- библиотека записей ---
function actionButton(name,label,handler,extra='') {
  const b=document.createElement('button');b.className='act '+extra;b.title=label;b.setAttribute('aria-label',label);b.append(icon(name));
  b.onclick=handler;return b;
}
function startRename(item,title) {
  const input=document.createElement('input');input.className='rename-input';input.value=item.name.replace(/\.(webm|mp4)$/i,'');
  input.setAttribute('aria-label','Новое имя файла');let done=false;
  const restore=()=>{if(!done) {done=true;input.replaceWith(title);}};
  input.onkeydown=async e=>{
    if(e.key==='Escape') restore();
    if(e.key==='Enter') {
      e.preventDefault();done=true;
      try {await api.rename(item.name,input.value);await loadLibrary();} catch(err) {done=false;fail('Не удалось переименовать.',err);input.focus();}
    }
  };
  input.onblur=restore;title.replaceWith(input);input.focus();input.select();
}
async function runJob(row,item,startText,doneText,job) {
  row.classList.add('busy');row.querySelectorAll('button').forEach(b=>b.disabled=true);
  message(startText);
  try {await job();message(doneText);} catch(e) {fail('Не удалось выполнить операцию.',e);}
  await loadLibrary();
}
function buildRow(item) {
  const row=document.createElement('div');row.className='recording'+(item.busy?' busy':'');
  const thumb=document.createElement('div');thumb.className='thumb';thumb.append(icon('library'));
  const info=document.createElement('div');info.className='info';
  const title=document.createElement('h3');title.textContent=item.name;
  const meta=document.createElement('p'), when=document.createElement('span'), size=document.createElement('span'), chip=document.createElement('span'), dur=document.createElement('span');
  when.textContent=new Date(item.date).toLocaleString('ru-RU');size.textContent=formatBytes(item.size);
  chip.className='chip'+(item.partial?' warn':'');chip.textContent=item.partial?'НЕЗАВЕРШЁННАЯ':item.ext.slice(1).toUpperCase();
  meta.append(chip,when,size,dur);info.append(title,meta);
  const actions=document.createElement('div');actions.className='actions';
  const guard=fn=>()=>fn(item.name).catch(e=>fail('',e));
  actions.append(
    actionButton('play','Открыть',guard(api.open)),
    actionButton('folder','Показать в папке',guard(api.reveal)),
    actionButton('save','Сохранить копию…',guard(api.saveAs))
  );
  if(!item.partial) actions.append(actionButton('edit','Переименовать',()=>startRename(item,title)));
  let repairButton;
  if(cfg.ffmpeg && item.ext==='.webm') {
    actions.append(actionButton('convert','Сохранить как MP4',()=>runJob(row,item,'Конвертация в MP4… Это может занять несколько минут, не закрывайте приложение.','Готово: MP4 добавлен в список.',()=>api.convert(item.name))));
    repairButton=actionButton('repair',item.partial?'Восстановить запись':'Исправить длительность и перемотку',()=>runJob(row,item,'Исправление видео…','Видео исправлено.',()=>api.repair(item.name)));
    repairButton.hidden=!item.partial;actions.append(repairButton);
  }
  actions.append(actionButton('trash','Удалить в корзину',async()=>{
    if(!confirm('Переместить «'+item.name+'» в корзину?')) return;
    try {await api.remove(item.name);await loadLibrary();} catch(e) {fail('Не удалось удалить.',e);}
  },'danger-act'));
  row.append(thumb,info,actions);
  if(item.busy) {row.querySelectorAll('button').forEach(b=>b.disabled=true);}
  row.loadInfo=async()=>{
    try {
      const data=await api.info(item.name);
      if(data.thumb) {const img=document.createElement('img');img.alt='';img.src=data.thumb;thumb.replaceChildren(img);}
      if(data.duration) dur.textContent=formatDuration(data.duration);
      else if(cfg.ffmpeg && repairButton && !item.partial) repairButton.hidden=false;
    } catch {}
  };
  return row;
}
async function loadLibrary() {
  const token=++libraryToken;
  try {
    cfg.ffmpeg=(await api.config()).ffmpeg;
    const {folder,items}=await api.library();
    if(token!==libraryToken) return;
    $('folderPath').textContent=folder;$('count').textContent=items.length;$('recordings').replaceChildren();
    if(!items.length) {const p=document.createElement('div');p.className='empty-library';p.textContent='Здесь появятся ваши записи. Начните с выбора экрана.';$('recordings').append(p);}
    const rows=items.map(buildRow);$('recordings').append(...rows);
    // Превью и длительность подгружаем по очереди, чтобы список открывался мгновенно.
    if($('libraryView').hidden) return;
    for(const row of rows) {if(token!==libraryToken) return;await row.loadInfo();}
  } catch(e) {fail('Не удалось открыть папку записей.',e);}
}
function tab(library) {
  $('libraryView').hidden=!library;$('recordView').hidden=library;
  $('libraryTab').classList.toggle('active',library);$('recordTab').classList.toggle('active',!library);
  $(library?'libraryTab':'recordTab').setAttribute('aria-current','page');$(library?'recordTab':'libraryTab').removeAttribute('aria-current');
  $('pageTitle').textContent=library?'Всё, что вы записали.':'Запишите важное.';
  $('pageSubtitle').textContent=library?'Видео и скриншоты хранятся только на этом компьютере.':'Рабочие процессы, идеи и моменты — в одном видео.';
  if(library) {loadLibrary();refreshDisk();}
}

// --- горячие клавиши и дополнительные настройки ---
function kbdList(acc) {
  const frag=document.createDocumentFragment();
  displayAccelerator(acc).split(' + ').forEach((part,i)=>{if(i) frag.append(' + ');const k=document.createElement('kbd');k.textContent=part;frag.append(k);});
  return frag;
}
function renderConfig() {
  const h=cfg.hotkeys;
  if(!h.toggle) return;
  $('hkToggle').value=displayAccelerator(h.toggle);$('hkPause').value=displayAccelerator(h.pause);
  $('tipToggle').replaceChildren(kbdList(h.toggle),' старт / стоп');$('tipPause').replaceChildren(kbdList(h.pause),' пауза');
  $('autoRepair').checked=cfg.autoRepair&&cfg.ffmpeg;
  $('repairHint').textContent=cfg.ffmpeg?'Добавляет длительность и перемотку':'ffmpeg не найден — недоступно';
  $('autoRepair').disabled=!cfg.ffmpeg||state!=='idle';
}
async function loadConfig() {try {cfg=await api.config();} catch(e) {fail('',e);} renderConfig();}
for(const [id,key] of [['hkToggle','toggle'],['hkPause','pause']]) {
  const input=$(id);
  input.addEventListener('focus',()=>{capturingHotkey=true;});
  input.addEventListener('blur',()=>{capturingHotkey=false;renderConfig();});
  input.addEventListener('keydown',async e=>{
    if(e.key==='Tab'||e.key==='Escape') return;
    e.preventDefault();
    const acc=acceleratorFromEvent(e);
    if(!acc) {if(!['Control','Shift','Alt','Meta'].includes(e.key)) message('Нужно сочетание с Ctrl или Alt и буквой, цифрой или F1–F12.',true);return;}
    try {cfg=await api.setConfig({hotkeys:{...cfg.hotkeys,[key]:acc}});$('message').hidden=true;} catch(err) {fail('',err);}
    renderConfig();
  });
}
$('autoRepair').addEventListener('change',async()=>{
  try {cfg=await api.setConfig({autoRepair:$('autoRepair').checked});} catch(e) {fail('',e);}
  renderConfig();
});

$('screenshot').onclick=takeScreenshot;
$('closeShot').onclick=()=>$('shotPreview').close();
$('shotPreview').addEventListener('close',()=>{$('shotImage').removeAttribute('src');});
$('revealShot').onclick=()=>{if(lastScreenshot)api.screenshotReveal(lastScreenshot.name).catch(e=>fail('',e));};
$('shotsFolder').onclick=()=>api.screenshotsFolder().catch(e=>fail('',e));
$('choose').onclick=showSources;$('change').onclick=showSources;$('refresh').onclick=refreshSources;
$('closePicker').onclick=()=>$('picker').close();
$('start').onclick=start;$('stop').onclick=stop;$('pause').onclick=pause;
$('mic').addEventListener('change',microphoneDevices);
$('recordTab').onclick=()=>tab(false);$('libraryTab').onclick=()=>tab(true);
$('openFolder').onclick=()=>api.folder().catch(e=>fail('',e));
$('chooseFolder').onclick=async()=>{try{await api.chooseFolder();await loadLibrary();refreshDisk();}catch(e){fail('',e);}};
window.addEventListener('screenflow-toggle',()=>{if(capturingHotkey) return;if(state==='idle') start();else stop();});
api.onCommand(command=>{
  if(command==='toggle' && !capturingHotkey) {if(state==='idle') start();else stop();}
  if(command==='pause') pause();
  if(command==='screenshot') takeScreenshot();
  if(command==='stop') stop();
  if(command==='close') {
    if(state==='saving') {closeAfter=true;return;}
    if(confirm('Завершить запись, сохранить видео и закрыть ScreenFlow?')) {closeAfter=true;stop();}
  }
  if(command==='shortcut-unavailable') message('Горячие клавиши заняты другой программой. Измените их в «Дополнительно» или используйте кнопки записи.');
});
updateUI();loadConfig().then(loadLibrary);refreshDisk();
