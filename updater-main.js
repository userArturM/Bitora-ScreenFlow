const {app,net,shell}=require('electron');
const path=require('node:path'),fs=require('node:fs/promises');
const {Updater}=require('./updater');
const {launchUpdate}=require('./update-install');
module.exports=({win,handle,isBusy,lock,unlock,quit})=>{
  const updater=new Updater({fetch:(...a)=>net.fetch(...a),current:app.getVersion(),directory:path.join(app.getPath('userData'),'Updates'),portable:!!process.env.PORTABLE_EXECUTABLE_FILE});
  const automaticInstall=!app.getVersion().includes('-');
  const status=()=>({...updater.state,installSupported:automaticInstall});
  handle('updates-result',async()=>{try{return JSON.parse((await fs.readFile(path.join(app.getPath('userData'),'Updates','install-result.json'),'utf8')).replace(/^\uFEFF/,''));}catch{return null;}});
  handle('updates-cancel',()=>{if(updater.state.phase==='queued')updater.state.phase='ready';else updater.cancel();return updater.state;});
  handle('updates-check',async()=>{await updater.check();return status();});
  handle('updates-status',status);
  handle('updates-download',async()=>{await updater.download();return status();});
  handle('updates-open',()=>shell.openExternal('https://github.com/userArturM/Bitora-ScreenFlow/releases'));
  handle('updates-install',()=>{if(!automaticInstall)throw new Error('В предварительной версии автоматическая установка отключена. Скачайте установщик на странице релизов и запустите вручную.');if(updater.state.phase!=='ready')throw new Error('Сначала скачайте и проверьте обновление');updater.state.phase='queued';return updater.state;});
  const timer=setInterval(async()=>{
    if(updater.state.phase!=='queued'||isBusy())return;
    lock();updater.state.phase='installing';
    try{const file=await updater.verify();await launchUpdate(file,updater.ready.expected,process.env.PORTABLE_EXECUTABLE_FILE);quit();}
    catch(e){unlock();updater.state={...updater.state,phase:updater.ready?'ready':'available',error:e.message};}
  },500);
  timer.unref();win.on('closed',()=>clearInterval(timer));
};
