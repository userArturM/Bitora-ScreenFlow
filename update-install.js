const fs=require('node:fs/promises'),path=require('node:path'),{spawn}=require('node:child_process');
const {randomUUID}=require('node:crypto');
function installManifest(file,expected,portableTarget,{parentPid=process.pid,installedTarget=process.execPath,restart=true,statusFile=path.join(path.dirname(file),'install-result.json')}={}){
 if(!/^[a-f0-9]{64}$/i.test(expected))throw new Error('Недопустимая SHA-256');
 const directory=path.dirname(file);
 return {source:file,target:portableTarget||installedTarget,expected:expected.toLowerCase(),portable:!!portableTarget,parentPid,restart,report:statusFile,marker:path.join(directory,'helper-'+randomUUID()+'.ready'),log:path.join(directory,'install-helper.log'),healthReport:process.env.BITORA_UPDATE_HEALTH_REPORT||path.join(directory,'update-health.json')};
}
async function launchUpdate(file,expected,portableTarget,options){
 if(process.platform!=='win32')throw new Error('Установка обновлений поддерживается в Windows');
 const manifest=installManifest(file,expected,portableTarget,options);
 // The independent helper must survive replacement of the installed/portable app.
 const bundled=path.join(__dirname,'assets','update-helper.exe').replace(/app\.asar([\\/])/,'app.asar.unpacked$1');
 const helper=path.join(path.dirname(file),'update-helper-'+randomUUID()+'.exe');
 await fs.copyFile(bundled,helper);
 const input=helper+'.json';await fs.writeFile(input,JSON.stringify(manifest),'utf8');
 const child=spawn(helper,[input],{detached:true,stdio:'ignore',windowsHide:true});
 let failed;child.once('error',e=>{failed=e;});child.once('exit',code=>{failed=new Error('Помощник обновления завершился до запуска: '+code);});
 try{
   const deadline=Date.now()+15000;
   while(!await fs.access(manifest.marker).then(()=>true,()=>false)){
     if(failed)throw failed;
     if(Date.now()>deadline)throw new Error('Помощник обновления не запустился. Программа остаётся открытой; проверьте install-helper.log.');
     await new Promise(r=>setTimeout(r,100));
   }
   child.unref();
 }catch(error){child.kill();throw error;}
}
module.exports={launchUpdate,installManifest};
