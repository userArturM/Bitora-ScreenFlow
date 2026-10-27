const {app,BrowserWindow,ipcMain,desktopCapturer,session,dialog,shell,globalShortcut,powerSaveBlocker,Tray,Menu,nativeImage} = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {isAppPageURL,isTrustedFrame,isTrustedSender} = require('./app-trust');
const {RecordingStore} = require('./recording-store');
const {SettingsStore} = require('./settings-store');
const media = require('./media-tools');
const S = require('./shared');
const {validatePng,savePng} = require('./screenshot-store');
require('electron').protocol.registerSchemesAsPrivileged([{scheme:'bitora-media',privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true,stream:true}}]);
const functionalTest=process.argv.includes('--functional-test');
const portableRoot = process.env.PORTABLE_EXECUTABLE_DIR;
const portableData = portableRoot ? path.join(portableRoot,'BitoraScreenFlow-Data') : null;
if (portableData) {
  try {
    require('node:fs').mkdirSync(portableData,{recursive:true});
    app.setPath('userData',path.join(portableData,'Settings'));
    require('node:fs').mkdirSync(app.getPath('userData'),{recursive:true});
  } catch(error) {
    dialog.showErrorBox('Bitora ScreenFlow','Нет доступа к папке портативной версии. Перенесите EXE в папку с правом записи. '+error.message);
    app.exit(1);
  }
}
app.setAppUserModelId('com.bitora.screenflow');
const smokeTest=process.argv.includes('--smoke-test');
if(smokeTest || functionalTest) setTimeout(()=>app.exit(2),functionalTest?90000:20000).unref();
let win, store, settingsStore, config, selected, blocker, tray, closing = false, writeChain = Promise.resolve();
let trayState = {state:'idle',elapsed:0}, trayKey = '';
const busyFiles = new Set();
const infoCache = new Map();
let screenshotWasVisible=false;
const screenshotFiles=new Map();
const appPage=path.join(__dirname,'index.html');
const page=pathToFileURL(appPage).href;
function trusted(event) { if(!isTrustedSender(event,win?.webContents,appPage)) throw new Error('Доступ запрещён'); }
function handle(name,fn) { ipcMain.handle(name,async(event,...args)=>{trusted(event);return fn(...args);}); }
function validFile(name) { return path.join(store.directory,S.validateRecordingName(name)); }
function sendCommand(command) { if(win && !win.isDestroyed()) win.webContents.send('command',command); }
function showWindow() { if(!win || win.isDestroyed()) return; if(win.isMinimized()) win.restore(); win.show(); win.focus(); }

// --- значок в трее: состояние записи и быстрые команды ---
function refreshTray() {
  if(!tray) return;
  const {state,elapsed} = trayState, active = state==='recording' || state==='paused';
  tray.setToolTip('Bitora ScreenFlow'+(active?` — ${state==='paused'?'пауза':'запись'} ${S.formatDuration(elapsed)}`:''));
  if(state===trayKey) return;
  trayKey = state;
  tray.setContextMenu(Menu.buildFromTemplate([
    {label:'Показать окно',click:showWindow},
    {type:'separator'},
    {label:state==='paused'?'Продолжить запись':'Пауза',enabled:active,click:()=>sendCommand('pause')},
    {label:'Завершить запись',enabled:active,click:()=>sendCommand('stop')},
    {type:'separator'},
    {label:'Выход',click:()=>win.close()}
  ]));
}

// --- глобальные горячие клавиши ---
function trigger(command) {
  if(command==='toggle') win.webContents.executeJavaScript('window.dispatchEvent(new Event("screenflow-toggle"))',true).catch(()=>{});
  else sendCommand('pause');
}
function registerHotkeys(keys) {
  const failed = [];
  for(const [command,accelerator] of Object.entries(keys)) {
    let ok = false;
    try { ok = globalShortcut.register(accelerator,()=>trigger(command)); } catch {}
    if(!ok) failed.push(command);
  }
  return failed;
}
async function configView() {
  return {hotkeys:config.hotkeys,autoRepair:config.autoRepair,folder:store.directory,ffmpeg:!!(await media.findFfmpeg())};
}
async function ffmpegOrThrow() {
  const ffmpeg = await media.findFfmpeg();
  if(!ffmpeg) throw new Error('ffmpeg не найден. В установленной версии он входит в комплект; при запуске из исходников установите ffmpeg или задайте BITORA_FFMPEG.');
  return ffmpeg;
}
async function exclusive(name,job) {
  if(busyFiles.has(name)) throw new Error('Этот файл уже обрабатывается.');
  busyFiles.add(name);
  try { return await job(); } finally { busyFiles.delete(name); }
}

app.whenReady().then(async()=>{
  settingsStore = new SettingsStore(app.getPath('userData'));
  config = await settingsStore.read();
  if(functionalTest) {config.folder=process.env.BITORA_TEST_OUTPUT;config.autoRepair=false;if(!config.folder) throw new Error('BITORA_TEST_OUTPUT required');}
  store = new RecordingStore(config.folder || (portableData ? path.join(portableData,'Recordings') : path.join(app.getPath('videos'),'Bitora ScreenFlow')));
  win = new BrowserWindow({width:1180,height:880,minWidth:900,minHeight:680,backgroundColor:'#10131b',title:'Bitora ScreenFlow',icon:path.join(__dirname,'assets/icon.ico'),show:!smokeTest,
    webPreferences:{preload:path.join(__dirname,'preload.js'),contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false}});
  win.setMenu(null);
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('will-navigate',(e)=>e.preventDefault());
  session.defaultSession.setPermissionRequestHandler((contents,permission,callback)=>{
    callback(contents===win.webContents && isTrustedFrame(contents,contents.mainFrame,appPage) && ['media','display-capture'].includes(permission));
  });
  session.defaultSession.setDisplayMediaRequestHandler(async(request,callback)=>{
    try {
      if(!isTrustedFrame(win.webContents,request.frame,appPage) || !selected) return callback(null);
      const sources = await desktopCapturer.getSources({types:['screen','window']});
      const source = sources.find(s=>s.id===selected.id);
      const audio = selected.audio;
      selected = null;
      if(!source) return callback(null);
      callback(audio ? {video:source,audio:'loopback'} : {video:source});
    } catch {callback(null);}
  });
  if(!smokeTest) {
    try { tray = new Tray(nativeImage.createFromPath(path.join(__dirname,'assets/icon.ico'))); tray.on('click',showWindow); refreshTray(); } catch { tray = null; }
  }
  require('./studio-main')({win,handle,store,sendCommand,busyFiles});
  handle('screenshot-hide',()=>{
    screenshotWasVisible=win.isVisible()&&!win.isMinimized();
    if(screenshotWasVisible) win.hide();
  });
  handle('screenshot-restore',()=>{if(screenshotWasVisible) showWindow();screenshotWasVisible=false;});
  handle('screenshot-save',async data=>{
    const {buffer}=validatePng(data);
    const image=nativeImage.createFromBuffer(buffer);
    if(image.isEmpty()) throw new Error('Не удалось прочитать изображение.');
    const result=await savePng(path.join(store.directory,'Screenshots'),image.toPNG());
    screenshotFiles.set(result.name,result.file);
    if(screenshotFiles.size>100) screenshotFiles.delete(screenshotFiles.keys().next().value);
    return result;
  });
  handle('screenshot-reveal',name=>{
    const file=screenshotFiles.get(name);
    if(!file) throw new Error('Скриншот не найден в текущем сеансе.');
    shell.showItemInFolder(file);
  });
  handle('screenshots-folder',async()=>{
    const folder=path.join(store.directory,'Screenshots');
    await fs.mkdir(folder,{recursive:true});
    const error=await shell.openPath(folder);if(error) throw new Error(error);
  });
  handle('sources',async()=> (await desktopCapturer.getSources({types:['screen','window'],thumbnailSize:{width:400,height:225}}))
    .filter(s=>!s.name.startsWith('Bitora ScreenFlow')).map(s=>({id:s.id,name:s.name,image:s.thumbnail.toDataURL()})));
  handle('select',async(id,audio)=>{if(typeof id!=='string') throw new Error('Выберите источник');selected={id,audio:!!audio};});
  handle('begin',async()=>{
    const file=await store.begin();
    writeChain=Promise.resolve();
    blocker=powerSaveBlocker.start('prevent-display-sleep');
    return file;
  });
  handle('append',data=>{
    writeChain=writeChain.then(()=>store.append(data));
    return writeChain;
  });
  handle('finish',async()=>{
    let error;
    try {await writeChain;} catch(e) {error=e;}
    let result;
    try {result=await store.finish();} finally {
      if(blocker!==undefined && powerSaveBlocker.isStarted(blocker)) powerSaveBlocker.stop(blocker);
      blocker=undefined;
    }
    if(error) throw new Error('Запись прервана ошибкой диска. Сохранённая часть доступна в папке.');
    // Исправляем длительность и индекс перемотки без перекодирования; при неудаче остаётся исходный файл.
    const ffmpeg = result && config.autoRepair ? await media.findFfmpeg() : null;
    if(ffmpeg) {
      const original = result;
      try { result = await exclusive(path.basename(original),()=>media.repair(ffmpeg,original)); } catch { result = original; }
    }
    return result;
  });
  handle('library',async()=>{
    await fs.mkdir(store.directory,{recursive:true});
    const all = await fs.readdir(store.directory);
    if(!busyFiles.size) for(const n of all.filter(S.isTempName)) await fs.rm(path.join(store.directory,n),{force:true}).catch(()=>{});
    const items = (await Promise.all(all.filter(S.isRecordingName).map(async name=>{
      try {
        const stat=await fs.stat(path.join(store.directory,name));
        const {partial,ext}=S.splitName(name);
        return {name,size:stat.size,date:stat.mtimeMs,partial,ext,busy:busyFiles.has(name)};
      } catch {return null;}
    }))).filter(Boolean);
    return {folder:store.directory,items:items.sort((a,b)=>b.date-a.date)};
  });
  handle('info',async name=>{
    const file=validFile(name), ffmpeg=await media.findFfmpeg();
    if(!ffmpeg) return {};
    const stat=await fs.stat(file), key=`${name}|${stat.size}|${stat.mtimeMs}`;
    if(infoCache.has(key)) return infoCache.get(key);
    const duration=await media.probeDuration(ffmpeg,file).catch(()=>null);
    const jpg=await media.thumbnail(ffmpeg,file,duration).catch(()=>null);
    const info={duration,thumb:jpg?'data:image/jpeg;base64,'+jpg.toString('base64'):null};
    if(infoCache.size>300) infoCache.clear();
    infoCache.set(key,info);
    return info;
  });
  handle('open',async name=>{const error=await shell.openPath(validFile(name));if(error) throw new Error(error);});
  handle('reveal',name=>shell.showItemInFolder(validFile(name)));
  handle('folder',async()=>{await fs.mkdir(store.directory,{recursive:true});const error=await shell.openPath(store.directory);if(error)throw new Error(error);});
  handle('choose-folder',async()=>{
    if(store.current || busyFiles.size || trayState.state!=='idle') throw new Error('Сначала завершите запись или обработку видео');
    const result=await dialog.showOpenDialog(win,{properties:['openDirectory','createDirectory']});
    if(!result.canceled) {
      await fs.mkdir(result.filePaths[0],{recursive:true});
      await fs.access(result.filePaths[0],require('node:fs').constants.W_OK);
      config = await settingsStore.update({folder:result.filePaths[0]});
      store.directory=result.filePaths[0];
    }
    return store.directory;
  });
  handle('save-as',async name=>{
    const source=validFile(name), ext=S.splitName(name).ext.slice(1);
    const result=await dialog.showSaveDialog(win,{defaultPath:name,filters:[{name:ext==='mp4'?'MP4 видео':'WebM видео',extensions:[ext]}]});
    if(!result.canceled && path.resolve(result.filePath)!==path.resolve(source)) await fs.copyFile(source,result.filePath);
  });
  handle('rename',async(name,newBase)=>{
    const source=validFile(name), parts=S.splitName(name);
    if(parts.partial) throw new Error('Незавершённую запись сначала нужно исправить.');
    if(busyFiles.has(name)) throw new Error('Файл сейчас обрабатывается.');
    const target=path.join(store.directory,S.sanitizeBaseName(newBase)+parts.ext);
    if(path.resolve(target)===path.resolve(source)) return name;
    if(await fs.access(target).then(()=>true,()=>false)) throw new Error('Файл с таким именем уже есть.');
    await fs.rename(source,target);
    return path.basename(target);
  });
  handle('remove',async name=>{
    const file=validFile(name);
    if(store.current?.file===file || busyFiles.has(name)) throw new Error('Файл сейчас используется.');
    await shell.trashItem(file);
  });
  handle('repair',async name=>{
    const file=validFile(name);
    if(store.current?.file===file) throw new Error('Файл сейчас записывается.');
    const ffmpeg=await ffmpegOrThrow();
    return path.basename(await exclusive(name,()=>media.repair(ffmpeg,file)));
  });
  handle('convert',async name=>{
    const file=validFile(name);
    if(store.current?.file===file) throw new Error('Файл сейчас записывается.');
    const ffmpeg=await ffmpegOrThrow();
    return path.basename(await exclusive(name,()=>media.convertToMp4(ffmpeg,file)));
  });
  handle('disk',async()=>{
    await fs.mkdir(store.directory,{recursive:true});
    const s=await fs.statfs(store.directory);
    return {free:Number(s.bavail)*Number(s.bsize),total:Number(s.blocks)*Number(s.bsize)};
  });
  handle('config',()=>configView());
  handle('set-config',async patch=>{
    if(!patch || typeof patch!=='object') throw new Error('Неверные настройки');
    if(patch.hotkeys) {
      const next=patch.hotkeys;
      if(!S.validateAccelerator(next.toggle) || !S.validateAccelerator(next.pause) || next.toggle===next.pause) throw new Error('Выберите два разных сочетания с Ctrl или Alt, например Ctrl + Shift + R.');
      globalShortcut.unregisterAll();
      const failed=registerHotkeys(next);
      if(failed.length) {
        globalShortcut.unregisterAll();registerHotkeys(config.hotkeys);
        throw new Error('Сочетание занято другой программой. Выберите другое.');
      }
      config=await settingsStore.update({hotkeys:next});
    }
    if(typeof patch.autoRepair==='boolean') config=await settingsStore.update({autoRepair:patch.autoRepair});
    return configView();
  });
  handle('state',payload=>{
    if(!payload || !['idle','preparing','recording','paused','saving'].includes(payload.state)) return;
    trayState={state:payload.state,elapsed:Number(payload.elapsed)||0};
    refreshTray();
  });
  handle('minimize',()=>win.minimize());
  win.on('close',e=>{
    if((store.current || trayState.state==='saving') && !closing) {
      e.preventDefault();
      showWindow();
      sendCommand('close');
      return;
    }
    if(busyFiles.size && !closing) {
      const choice=dialog.showMessageBoxSync(win,{type:'question',buttons:['Подождать','Закрыть и прервать'],defaultId:0,cancelId:0,
        title:'Bitora ScreenFlow',message:'Идёт обработка видео. Если закрыть приложение, она прервётся.'});
      if(choice===0) e.preventDefault();
    }
  });
  // Renderer completes queued writes before allowing a normal close.
  handle('close-ready',()=>{closing=true;win.close();});
  const failed=registerHotkeys(config.hotkeys);
  if(failed.length) win.webContents.once('did-finish-load',()=>sendCommand('shortcut-unavailable'));
  await win.loadURL(page);
  if(functionalTest) {
    try {
      const result=await require('./qa/functional.cjs')({win,store,media,nativeImage});
      result.legacyUrlEqual=win.webContents.mainFrame.url===page;
      result.normalizedPageAccepted=isAppPageURL(win.webContents.mainFrame.url,appPage);
      await fs.writeFile(path.join(process.env.BITORA_TEST_OUTPUT,'result.json'),JSON.stringify(result,null,2));
      app.exit(0);
    } catch(error) {
      await fs.mkdir(process.env.BITORA_TEST_OUTPUT,{recursive:true});
      await fs.writeFile(path.join(process.env.BITORA_TEST_OUTPUT,'error.txt'),error.stack||String(error));
      app.exit(4);
    }
    return;
  }
  if(smokeTest) {
    const report=await win.webContents.executeJavaScript(`(async()=>{
      const result={title:document.title,api:typeof window.desktop,shared:typeof window.Shared};
      try {
        const cfg=await window.desktop.config();result.config=!!cfg.hotkeys;
        const library=await window.desktop.library();result.library=typeof library.folder==="string";
        const sources=await window.desktop.sources();result.sources=Array.isArray(sources)&&sources.length>0;
        result.ok=result.title==="Bitora ScreenFlow"&&result.config&&result.library&&result.sources&&!!document.getElementById("start");
      }catch(error){result.ok=false;result.error=String(error);}
      return result;
    })()`);
    report.pageURL=win.webContents.mainFrame.url;report.expectedURL=page;
    report.normalizedPageAccepted=isAppPageURL(report.pageURL,appPage);
    if(process.env.BITORA_DIAGNOSTIC_REPORT)await fs.writeFile(process.env.BITORA_DIAGNOSTIC_REPORT,JSON.stringify(report,null,2));
    app.exit(report.ok?0:3);
  }
}).catch(error=>{dialog.showErrorBox('Bitora ScreenFlow',error.message);app.quit();});
app.on('window-all-closed',()=>app.quit());
app.on('will-quit',()=>{globalShortcut.unregisterAll();media.killAll();tray?.destroy();});
