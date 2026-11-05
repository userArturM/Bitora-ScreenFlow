const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const {launchUpdate}=require('../update-install'),{hashFile}=require('../updater');
(async()=>{
 const root=path.join(os.tmpdir(),"Helper 'Артур' #100%");await fs.mkdir(root,{recursive:true});
 const source=path.join(process.env.SystemRoot,'System32','where.exe'),file=path.join(root,'test.exe'),report=path.join(root,'install-result.json');
 if(process.argv.includes('--worker')){
  await launchUpdate(file,process.argv.includes('--corrupt')?'0'.repeat(64):await hashFile(file),null,{installedTarget:source,restart:false,statusFile:report});
  await new Promise(r=>setTimeout(r,250));
  assert.equal(await fs.access(report).then(()=>true,()=>false),false,'Helper must wait for application exit');return;
 }
 await fs.copyFile(source,file);
 for(const corrupt of [true,false]){
  await fs.rm(report,{force:true});
  await new Promise((resolve,reject)=>{const p=spawn(process.execPath,[__filename,'--worker',...(corrupt?['--corrupt']:[])],{stdio:'inherit'});p.on('exit',c=>c===0?resolve():reject(new Error('Worker exit '+c)));p.on('error',reject);});
  const until=Date.now()+90000;let result;
  while(Date.now()<until){result=await fs.readFile(report,'utf8').then(x=>JSON.parse(x.replace(/^\uFEFF/,''))).catch(()=>null);if(result)break;await new Promise(r=>setTimeout(r,500));}
  if(!result){console.log(await fs.readFile(path.join(root,'install-helper.log'),'utf8').catch(()=>'<missing log>'));throw new Error('Detached helper did not report');}
  console.log(result);assert.equal(result.status,'error');assert.ok(result.message.includes(corrupt?'SHA-256 mismatch':'Installer exit code'),JSON.stringify(result));
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
