const {app,BrowserWindow,ipcMain,clipboard,ClipboardItem,nativeImage,dialog,shell,protocol,net}=require('electron');
const fs=require('node:fs/promises'),path=require('node:path'),{pathToFileURL}=require('node:url');
const {isTrustedSender}=require('./app-trust');
const {validatePng}=require('./screenshot-store');
const {validateRecordingName}=require('./shared');
const media=require('./media-tools');
const {safeShotName,trimRange}=require('./studio-shared');
module.exports=({win,handle,store,sendCommand,busyFiles})=>{
  let panel,panelHidden=false;const errors=[];const mediaFiles=new Map();
  function log(scope,error){errors.push({time:new Date().toISOString(),scope,message:String(error).replace(/[A-Z]:\\[^\r\n]*/gi,'[local path]').slice(0,1500)});if(errors.length>100)errors.shift();}
  const copyImage=async img=>{if(img.isEmpty())throw new Error('Некорректный PNG');await clipboard.write([new ClipboardItem({'image/png':new Blob([img.toPNG()],{type:'image/png'})})]);};
  const bind=(name,fn)=>handle(name,async(...a)=>{try{return await fn(...a);}catch(e){log(name,e.message);throw e;}});
  protocol.handle('bitora-media',async request=>{try{const file=mediaFiles.get(new URL(request.url).hostname);if(!file)return new Response(null,{status:404});return await require('./media-response').mediaResponse(file,request);}catch{return new Response(null,{status:500});}});
  bind('media-url',async(kind,name)=>{const file=kind==='image'?path.join(store.directory,'Screenshots',safeShotName(name)):path.join(store.directory,validateRecordingName(name));await fs.access(file);const id=require('node:crypto').randomUUID();mediaFiles.set(id,file);if(mediaFiles.size>500)mediaFiles.delete(mediaFiles.keys().next().value);return 'bitora-media://'+id;});
  bind('shots-list',async()=>{const folder=path.join(store.directory,'Screenshots');await fs.mkdir(folder,{recursive:true});return (await Promise.all((await fs.readdir(folder)).filter(n=>/\.png$/i.test(n)).map(async name=>{try{safeShotName(name);const s=await fs.stat(path.join(folder,name));return {name,size:s.size,date:s.mtimeMs,ext:'.png',kind:'image'};}catch{return null;}}))).filter(Boolean);});
  bind('shot-action',async(action,name)=>{const file=path.join(store.directory,'Screenshots',safeShotName(name));if(action==='reveal')shell.showItemInFolder(file);else if(action==='remove')await shell.trashItem(file);else if(action==='copy')await copyImage(nativeImage.createFromPath(file));else throw new Error('Неизвестная операция');});
  bind('clipboard-png',data=>{const {buffer}=validatePng(data);const img=nativeImage.createFromBuffer(buffer);if(img.isEmpty())throw new Error('Некорректный PNG');return copyImage(img);});
  bind('trim-video',async(name,start,end)=>{
    const file=path.join(store.directory,validateRecordingName(name));if(store.current||busyFiles.has(name))throw new Error('Завершите запись или обработку файла.');
    busyFiles.add(name);let tmp;
    try{const ff=await media.findFfmpeg();if(!ff)throw new Error('FFmpeg недоступен');const duration=await media.probeDuration(ff,file);const range=trimRange(start,end,duration);const dest=await media.uniquePath(store.directory,path.parse(name).name+' — фрагмент','.mp4');tmp=dest+'.tmp.mp4';const args=media.buildMp4Args(file,tmp);args.splice(args.indexOf('-i'),0,'-ss',String(range.start));args.splice(args.indexOf('-map'),0,'-t',String(range.end-range.start));const r=await media.run(ff,args,{timeoutMs:3*60*60*1000});if(r.code!==0)throw new Error('Не удалось обрезать видео');await fs.rename(tmp,dest);return path.basename(dest);}finally{busyFiles.delete(name);if(tmp)await fs.rm(tmp,{force:true});}
  });
  bind('diagnostic-log',(scope,error)=>log(String(scope).slice(0,80),error));
  bind('diagnostic-save',async()=>{const r=await dialog.showSaveDialog(win,{defaultPath:'Bitora-diagnostics.json',filters:[{name:'JSON',extensions:['json']}]});if(r.canceled)return false;await fs.writeFile(r.filePath,JSON.stringify({version:app.getVersion(),platform:process.platform,os:require('node:os').release(),electron:process.versions.electron,ffmpeg:!!await media.findFfmpeg(),errors},null,2));return true;});
  const panelPage=path.join(__dirname,'panel.html');
  ipcMain.handle('panel-command',(event,command)=>{if(!panel||!isTrustedSender(event,panel.webContents,panelPage))throw new Error('Доступ запрещён');if(['pause','stop','screenshot'].includes(command))sendCommand(command);if(command==='show'){win.show();win.focus();}if(command==='hide'){panelHidden=true;panel.hide();}});
  bind('panel-state',async data=>{
    if(!data||!['idle','preparing','recording','paused','saving'].includes(data.state))return;
    if(['recording','paused'].includes(data.state)&&data.enabled){
      if(!panel){panel=new BrowserWindow({width:440,height:92,resizable:false,frame:false,alwaysOnTop:true,skipTaskbar:true,show:false,webPreferences:{preload:path.join(__dirname,'panel-preload.js'),contextIsolation:true,sandbox:true,nodeIntegration:false}});panel.setContentProtection(true);panel.setMenu(null);panel.webContents.setWindowOpenHandler(()=>({action:'deny'}));panel.webContents.on('will-navigate',e=>e.preventDefault());await panel.loadURL(pathToFileURL(panelPage).href);panel.on('closed',()=>panel=null);panel.showInactive();}
      if(!panelHidden&&!panel.isVisible())panel.showInactive();
      panel.webContents.send('panel-state',{state:data.state,elapsed:Number(data.elapsed)||0,level:Math.max(0,Math.min(1,Number(data.level)||0))});
    }else {panel?.hide();if(data.state==='idle')panelHidden=false;}
  });
  win.on('closed',()=>panel?.destroy());
};
