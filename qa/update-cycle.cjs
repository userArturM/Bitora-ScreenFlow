// Real EXE update cycle. A loopback HTTP fixture stands in for an unpublished GitHub release.
const fs=require('node:fs/promises'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {spawn,execFileSync}=require('node:child_process');
const {Updater,hashFile}=require('../updater');
const {launchUpdate}=require('../update-install');
if(process.argv[2]==='--worker'){
 (async()=>{const data=JSON.parse(await fs.readFile(process.argv[3],'utf8'));await launchUpdate(data.file,data.hash,data.portable,{installedTarget:data.target,restart:false,statusFile:data.report});})().catch(e=>{console.error(e);process.exitCode=1;});
}else{
(async()=>{
 const root=path.join(process.env.RUNNER_TEMP||process.cwd(),"Bitora Update 'Артур' #100%");await fs.mkdir(root,{recursive:true});
 const release=path.resolve('release'),old=path.resolve('qa-old');
 const names=await fs.readdir(release),oldNames=await fs.readdir(old);
 const version=require('../package.json').version;
 const find=(list,kind)=>list.find(n=>n.includes(kind)&&n.endsWith('.exe'));
 const results=[];
 const wait=async predicate=>{const end=Date.now()+240000;while(Date.now()<end){const value=await predicate();if(value)return value;await new Promise(r=>setTimeout(r,500));}throw new Error('Update helper timed out');};
 async function install(file,target,portable,report){
  const input=path.join(root,'worker.json');await fs.rm(report,{force:true});
  await fs.writeFile(input,JSON.stringify({file,target,portable,report,hash:await hashFile(file)}));
  await new Promise((resolve,reject)=>{const p=spawn(process.execPath,[__filename,'--worker',input],{stdio:'inherit'});p.on('error',reject);p.on('exit',code=>code===0?resolve():reject(new Error('Worker failed '+code)));});
  return wait(()=>fs.readFile(report,'utf8').then(s=>JSON.parse(s.replace(/^\uFEFF/,''))).catch(()=>null));
 }
 for(const kind of ['Setup','Portable']){
  const name=find(names,kind),oldName=find(oldNames,kind);assert.ok(name&&oldName);
  const folder=path.join(root,kind);await fs.mkdir(folder,{recursive:true});
  const target=path.join(folder,kind==='Setup'?'Bitora ScreenFlow.exe':'Bitora.exe');
  if(kind==='Setup')execFileSync(path.join(old,oldName),['/S',`/D=${folder}`],{timeout:120000});
  else await fs.copyFile(path.join(old,oldName),target);
  assert.ok((await fs.stat(target)).size>10000);
  const asset=path.join(release,name),hash=await hashFile(asset),size=(await fs.stat(asset)).size;
  let resumed=false;
  const server=http.createServer(async(req,res)=>{
   const start=Number(/^bytes=(\d+)-$/.exec(req.headers.range||'')?.[1]||0);if(start)resumed=true;
   res.writeHead(start?206:200,{'Content-Length':size-start,...(start?{'Content-Range':`bytes ${start}-${size-1}/${size}`}:{})});
   const stream=require('node:fs').createReadStream(asset,{start,highWaterMark:256*1024});res.on('close',()=>stream.destroy());stream.pipe(res);
  });await new Promise(r=>server.listen(0,'127.0.0.1',r));
  try{
   const base='https://github.com/userArturM/Bitora-ScreenFlow/releases/download/v'+version+'/';
   const fetchFixture=async(url,options)=>url.includes('api.github.com')?Response.json({tag_name:'v'+version,assets:[{name,size,browser_download_url:base+name},{name:'SHA256SUMS.txt',browser_download_url:base+'SHA256SUMS.txt'}]}):url.endsWith('.txt')?new Response(hash+'  '+name):fetch(`http://127.0.0.1:${server.address().port}/asset`,options);
   const directory=path.join(folder,'Updates');let updater=new Updater({fetch:fetchFixture,current:'1.5.1',directory,portable:kind==='Portable'});assert.equal((await updater.check()).phase,'available');
   // Seed a real prefix to verify continuation across application restarts.
   await fs.mkdir(directory,{recursive:true});const prefix=Buffer.alloc(1024*1024);const h=await fs.open(asset,'r');await h.read(prefix,0,prefix.length,0);await h.close();
   await fs.writeFile(path.join(directory,name+'.part'),prefix);
   await fs.writeFile(path.join(directory,name+'.part.json'),JSON.stringify({url:base+name,size,expected:hash}));
   await updater.download();assert.ok(resumed,'HTTP Range must be used');const downloaded=await updater.verify();
   const healthReport=path.join(root,'health-'+kind+'.json');process.env.BITORA_UPDATE_HEALTH_REPORT=healthReport;
   const result=await install(downloaded,target,kind==='Portable'?target:null,path.join(directory,'install-result.json'));
   assert.equal(result.status,'success',JSON.stringify(result));
   assert.equal(JSON.parse(await fs.readFile(healthReport,'utf8')).version,version);
   results.push(kind+': 1.5.1 → '+version+'; resumed HTTP download, SHA-256, actual EXE install and health check');
   if(kind==='Portable'){
    const before=await hashFile(target),bad=path.join(directory,'broken-update.exe');
    await fs.copyFile(path.join(process.env.SystemRoot,'System32','cmd.exe'),bad);
    const failed=await install(bad,target,target,path.join(directory,'rollback-result.json'));
    assert.equal(failed.status,'rolled-back',JSON.stringify(failed));assert.equal(await hashFile(target),before);
    results.push('Portable automatic rollback after failed executable health check');
   }
  }finally{await new Promise(r=>server.close(r));}
 }
 await fs.writeFile(path.join(release,'update-cycle-results.json'),JSON.stringify({passed:true,results},null,2));console.log(results.join('\n'));
})().catch(e=>{console.error(e);process.exitCode=1;});
}
