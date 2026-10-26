const $ = id => document.getElementById(id);
const api = window.desktop;
let source, recorder, capture, microphone, audioContext;
let state='idle', queue=Promise.resolve(), writeError=null, elapsed=0, lastTick=0, byteCount=0, pendingBytes=0, closeAfter=false;
let settings={};
try {settings=JSON.parse(localStorage.getItem('screenflow-settings')||'{}');} catch {}
const settingsIds=['fps','quality','systemAudio','mic','delay','minimize'];
for(const id of settingsIds) {
  if(settings[id]!==undefined) {if($(id).type==='checkbox') $(id).checked=!!settings[id];else $(id).value=settings[id];}
  $(id).addEventListener('change',()=>{
    for(const key of settingsIds) settings[key]=$(key).type==='checkbox'?$(key).checked:$(key).value;
    localStorage.setItem('screenflow-settings',JSON.stringify(settings));
  });
}
function message(text,error=false) {$('message').textContent=text;$('message').className=error?'error':'';$('message').hidden=false;}
function formatBytes(n) {return n>1024**3?(n/1024**3).toFixed(2)+' ГБ':(n/1024**2).toFixed(1)+' МБ';}
function updateUI() {
  const idle=state==='idle', active=['recording','paused'].includes(state);
  $('start').disabled=!idle||!source;
  $('stop').disabled=!active;
  $('pause').disabled=!active;
  $('pause').textContent=state==='paused'?'▶ Продолжить':'Ⅱ Пауза';
  $('choose').disabled=!idle;$('change').disabled=!idle||!source;
  for(const id of settingsIds) $(id).disabled=!idle;
  $('micDevice').disabled=!idle||!$('mic').checked;
  $('chooseFolder').disabled=!idle;
  $('status').textContent={idle:'Готов к записи',preparing:'Подготовка…',recording:'● Идёт запись',paused:'Ⅱ На паузе',saving:'Сохранение…'}[state];
  $('status').classList.toggle('live',active);
  $('recordDot').classList.toggle('live',state==='recording');
}
function tick() {
  const now=performance.now();
  if(state==='recording') elapsed+=now-lastTick;
  lastTick=now;
  const seconds=Math.floor(elapsed/1000);
  $('timer').textContent=[Math.floor(seconds/3600),Math.floor(seconds/60)%60,seconds%60].map(n=>String(n).padStart(2,'0')).join(':');
}
setInterval(tick,200);
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
  } catch(e) {$('sources').textContent='Не удалось получить источники: '+e.message;}
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
  } catch(e) {message('Микрофон недоступен. Разрешите доступ в настройках Windows или отключите микрофон. '+e.message,true);}
  finally {stream?.getTracks().forEach(t=>t.stop());}
}
async function cleanup() {
  capture?.getTracks().forEach(t=>t.stop());microphone?.getTracks().forEach(t=>t.stop());
  capture=null;microphone=null;
  if(audioContext) {await audioContext.close().catch(()=>{});audioContext=null;}
  $('preview').srcObject=null;$('preview').hidden=true;$('thumbnail').hidden=!source;$('countdown').hidden=true;
}
async function start() {
  if(state!=='idle') return;
  if(!source) {await showSources();return;}
  state='preparing';updateUI();$('message').hidden=true;
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
    const output=new MediaStream(capture.getVideoTracks());
    if(audioTracks.length) {
      audioContext=new AudioContext();await audioContext.resume();
      const destination=audioContext.createMediaStreamDestination();
      for(const track of audioTracks) {
        const input=audioContext.createMediaStreamSource(new MediaStream([track]));
        const gain=audioContext.createGain();gain.gain.value=audioTracks.length>1?0.7:1;
        input.connect(gain).connect(destination);
      }
      output.addTrack(destination.stream.getAudioTracks()[0]);
    }
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
      }).catch(error=>{writeError=error;message('Ошибка сохранения: '+error.message,true);stop();})
        .finally(()=>{pendingBytes-=e.data.size;});
      if(pendingBytes>128*1024*1024) {message('Диск не успевает сохранять видео. Запись остановлена.',true);stop();}
    };
    recorder.onerror=e=>{writeError=e.error||new Error('Ошибка кодирования');message(writeError.message,true);stop();};
    recorder.onstop=finish;
    capture.getVideoTracks()[0].onended=()=>stop();
    recorder.start(1000);state='recording';updateUI();tick();
    $('codecLabel').textContent='WEBM · '+$('fps').value+' КАДРОВ/С · '+(Number($('quality').value)/1e6)+' МБИТ/С';
    if($('minimize').checked) await api.minimize();
  } catch(e) {
    if(opened) await api.finish().catch(()=>{});
    await cleanup();state='idle';updateUI();
    message('Не удалось начать запись: '+e.message,true);
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
    if(writeError) message('Запись завершена с ошибкой: '+writeError.message+'. Проверьте сохранённый файл в «Мои записи».',true);
    else message(file?'Видео сохранено. Откройте «Мои записи», чтобы посмотреть его или сохранить копию.':'Запись не содержала видеоданных.');
  } catch(e) {message(e.message,true);}
  finally {
    await cleanup();recorder=null;state='idle';updateUI();await loadLibrary();
    if(closeAfter) {closeAfter=false;await api.closeReady();}
  }
}
async function loadLibrary() {
  try {
    const {folder,items}=await api.library();$('folderPath').textContent=folder;$('count').textContent=items.length;$('recordings').replaceChildren();
    if(!items.length) {const p=document.createElement('div');p.className='empty-library';p.textContent='Здесь появятся ваши записи. Начните с выбора экрана.';$('recordings').append(p);}
    for(const item of items) {
      const row=document.createElement('div');row.className='recording';
      const info=document.createElement('div');info.className='info';
      const title=document.createElement('h3');title.textContent=item.name;
      const meta=document.createElement('p');meta.textContent=new Date(item.date).toLocaleString('ru-RU')+' · '+formatBytes(item.size)+(item.partial?' · Незавершённая запись':' · WebM');
      info.append(title,meta);row.append(info);
      for(const [label,method] of [['▶ Открыть','open'],['Копия','saveAs'],['↗','reveal']]) {
        const button=document.createElement('button');button.className='secondary';button.textContent=label;button.title=method==='reveal'?'Показать в папке':label;
        button.onclick=()=>api[method](item.name).catch(e=>message(e.message,true));row.append(button);
      }
      $('recordings').append(row);
    }
  } catch(e) {message('Не удалось открыть папку записей: '+e.message,true);}
}
function tab(library) {
  $('libraryView').hidden=!library;$('recordView').hidden=library;
  $('libraryTab').classList.toggle('active',library);$('recordTab').classList.toggle('active',!library);
  $('pageTitle').textContent=library?'Всё, что вы записали.':'Запишите важное.';
  $('pageSubtitle').textContent=library?'Ваши видео хранятся только на этом компьютере.':'Рабочие процессы, идеи и моменты — в одном видео.';
  if(library) loadLibrary();
}
$('choose').onclick=showSources;$('change').onclick=showSources;$('refresh').onclick=refreshSources;
$('closePicker').onclick=()=>$('picker').close();
$('start').onclick=start;$('stop').onclick=stop;$('pause').onclick=pause;
$('mic').addEventListener('change',microphoneDevices);
$('recordTab').onclick=()=>tab(false);$('libraryTab').onclick=()=>tab(true);
$('openFolder').onclick=()=>api.folder().catch(e=>message(e.message,true));
$('chooseFolder').onclick=async()=>{try{await api.chooseFolder();await loadLibrary();}catch(e){message(e.message,true);}};
window.addEventListener('screenflow-toggle',()=>{if(state==='idle') start();else stop();});
api.onCommand(command=>{
  if(command==='toggle') {if(state==='idle') start();else stop();}
  if(command==='pause') pause();
  if(command==='close') {
    if(state==='saving') {closeAfter=true;return;}
    if(confirm('Завершить запись, сохранить видео и закрыть ScreenFlow?')) {closeAfter=true;stop();}
  }
  if(command==='shortcut-unavailable') message('Горячие клавиши заняты другой программой. Используйте кнопки записи.');
});
updateUI();loadLibrary();
