const {app,BrowserWindow,ipcMain,desktopCapturer,session,dialog,shell,globalShortcut,powerSaveBlocker} = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {RecordingStore} = require('./recording-store');
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
if(smokeTest) setTimeout(()=>app.exit(2),20000).unref();
let win, store, selected, blocker, closing = false, writeChain = Promise.resolve();
const page = pathToFileURL(path.join(__dirname,'index.html')).href;
function trusted(event) { if(event.sender !== win.webContents || event.senderFrame?.url !== page) throw new Error('Доступ запрещён'); }
function handle(name,fn) { ipcMain.handle(name,async(event,...args)=>{trusted(event);return fn(...args);}); }
function validFile(name) {
  if(typeof name !== 'string' || path.basename(name)!==name || !name.endsWith('.webm')) throw new Error('Недопустимый файл');
  return path.join(store.directory,name);
}
async function settings() {
  try { return JSON.parse(await fs.readFile(path.join(app.getPath('userData'),'settings.json'),'utf8')); } catch {return {};}
}
app.whenReady().then(async()=>{
  const saved = await settings();
  store = new RecordingStore(saved.folder || (portableData ? path.join(portableData,'Recordings') : path.join(app.getPath('videos'),'Bitora ScreenFlow')));
  win = new BrowserWindow({width:1180,height:880,minWidth:900,minHeight:680,backgroundColor:'#10131b',title:'Bitora ScreenFlow',icon:path.join(__dirname,'assets/icon.ico'),show:!smokeTest,
    webPreferences:{preload:path.join(__dirname,'preload.js'),contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false}});
  win.setMenu(null);
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('will-navigate',(e)=>e.preventDefault());
  session.defaultSession.setPermissionRequestHandler((contents,permission,callback)=>{
    callback(contents===win.webContents && contents.getURL()===page && ['media','display-capture'].includes(permission));
  });
  session.defaultSession.setDisplayMediaRequestHandler(async(request,callback)=>{
    try {
      if(request.frame?.url!==page || !selected) return callback(null);
      const sources = await desktopCapturer.getSources({types:['screen','window']});
      const source = sources.find(s=>s.id===selected.id);
      const audio = selected.audio;
      selected = null;
      if(!source) return callback(null);
      callback(audio ? {video:source,audio:'loopback'} : {video:source});
    } catch {callback(null);}
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
    return result;
  });
  handle('library',async()=>{
    await fs.mkdir(store.directory,{recursive:true});
    const names = (await fs.readdir(store.directory)).filter(n=>n.endsWith('.webm'));
    const items = await Promise.all(names.map(async name=>{
      const stat=await fs.stat(path.join(store.directory,name));
      return {name,size:stat.size,date:stat.mtimeMs,partial:name.endsWith('.partial.webm')};
    }));
    return {folder:store.directory,items:items.sort((a,b)=>b.date-a.date)};
  });
  handle('open',async name=>{const error=await shell.openPath(validFile(name));if(error) throw new Error(error);});
  handle('reveal',name=>shell.showItemInFolder(validFile(name)));
  handle('folder',async()=>{await fs.mkdir(store.directory,{recursive:true});const error=await shell.openPath(store.directory);if(error)throw new Error(error);});
  handle('choose-folder',async()=>{
    if(store.current) throw new Error('Сначала завершите запись');
    const result=await dialog.showOpenDialog(win,{properties:['openDirectory','createDirectory']});
    if(!result.canceled) {
      await fs.mkdir(result.filePaths[0],{recursive:true});
      await fs.access(result.filePaths[0],require('node:fs').constants.W_OK);
      await fs.writeFile(path.join(app.getPath('userData'),'settings.json'),JSON.stringify({folder:result.filePaths[0]}));
      store.directory=result.filePaths[0];
    }
    return store.directory;
  });
  handle('save-as',async name=>{
    const source=validFile(name);
    const result=await dialog.showSaveDialog(win,{defaultPath:name,filters:[{name:'WebM видео',extensions:['webm']}]});
    if(!result.canceled && path.resolve(result.filePath)!==path.resolve(source)) await fs.copyFile(source,result.filePath);
  });
  handle('minimize',()=>win.minimize());
  win.on('close',e=>{
    if(store.current && !closing) {
      e.preventDefault();
      win.show();
      win.webContents.send('command','close');
    }
  });
  // Renderer completes queued writes before allowing a normal close.
  handle('close-ready',()=>{closing=true;win.close();});
  for(const [key,command] of [['CommandOrControl+Shift+R','toggle'],['CommandOrControl+Shift+P','pause']]) {
    const ok=globalShortcut.register(key,()=>{
      if(command==='toggle') {
        win.webContents.executeJavaScript('window.dispatchEvent(new Event("screenflow-toggle"))',true).catch(()=>{});
      } else win.webContents.send('command',command);
    });
    if(!ok) win.webContents.once('did-finish-load',()=>win.webContents.send('command','shortcut-unavailable'));
  }
  await win.loadFile('index.html');
  if(smokeTest) {
    const ok=await win.webContents.executeJavaScript('document.title === "Bitora ScreenFlow" && typeof window.desktop.begin === "function" && document.getElementById("start") !== null');
    app.exit(ok?0:3);
  }
}).catch(error=>{dialog.showErrorBox('Bitora ScreenFlow',error.message);app.quit();});
app.on('window-all-closed',()=>app.quit());
app.on('will-quit',()=>globalShortcut.unregisterAll());
