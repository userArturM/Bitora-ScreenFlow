const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{spawn}=require('node:child_process');
const {launchUpdate}=require('../update-install'),{hashFile}=require('../updater');
(async()=>{
 const root=path.join(os.tmpdir(),"Helper 'Артур' #100%");await fs.mkdir(root,{recursive:true});const source=path.join(process.env.SystemRoot,'System32','where.exe'),file=path.join(root,'test.exe'),report=path.join(root,'install-result.json');
 if(process.argv.includes('--worker')){await launchUpdate(file,await hashFile(file),null,{installedTarget:source,restart:false,statusFile:report});return;}
 await fs.copyFile(source,file);await fs.rm(report,{force:true});
 await new Promise((resolve,reject)=>{const p=spawn(process.execPath,[__filename,'--worker'],{stdio:'inherit'});p.on('exit',c=>c===0?resolve():reject(new Error('Worker exit '+c)));p.on('error',reject);});
 const until=Date.now()+90000;
 while(Date.now()<until){const result=await fs.readFile(report,'utf8').then(x=>JSON.parse(x.replace(/^\uFEFF/,''))).catch(()=>null);if(result){console.log(result);if(result.status!=='error'||!result.message.includes('Installer exit code'))throw new Error('Unexpected report');return;}await new Promise(r=>setTimeout(r,500));}
 console.log(await fs.readFile(path.join(root,'install-helper.log'),'utf8').catch(()=>'<missing log>'));throw new Error('Detached helper did not report');
})().catch(e=>{console.error(e);process.exitCode=1;});
