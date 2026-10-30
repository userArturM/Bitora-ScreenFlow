const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {mediaResponse}=require('../media-response');
const {Updater,newer,checksum,assetURL}=require('../updater');
const {createHash}=require('node:crypto');
test('media supports partial, suffix, HEAD and unsatisfiable byte ranges',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'media-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const file=path.join(dir,'video.webm');await fs.writeFile(file,'0123456789');
 for(const [range,status,body]of [['bytes=3-5',206,'345'],['bytes=8-',206,'89'],['bytes=-3',206,'789'],['bytes=20-',416,''],['bytes=4-2',416,''],['bytes=0-1,4-5',416,'']]){const r=await mediaResponse(file,new Request('https://local/',{headers:{range}}));assert.equal(r.status,status);assert.equal(await r.text(),body);}
 const r=await mediaResponse(file,new Request('https://local/',{method:'HEAD'}));assert.equal(r.headers.get('content-length'),'10');assert.equal(await r.text(),'');
});
test('update metadata rejects wrong destinations, duplicates and downgrades',()=>{assert.ok(newer('v1.6.0','1.5.1'));assert.ok(!newer('v1.5.0','1.6.0'));assert.ok(!newer('v2.0.0-beta','1.0.0'));assert.throws(()=>assetURL('https://evil.example/setup.exe'));assert.throws(()=>checksum('','setup.exe'));});
for(const corrupt of [false,true])test('download verifies SHA-256 '+(corrupt?'and rejects corruption':'and detects later tampering'),async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'update-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const bytes=Buffer.from('installer'),hash=createHash('sha256').update(bytes).digest('hex');const root='https://github.com/userArturM/Bitora-ScreenFlow/releases/download/v1.6.0/';const name='Bitora-ScreenFlow-Setup-1.6.0-x64.exe';
 const fetch=async url=>url.includes('api.github.com')?Response.json({tag_name:'v1.6.0',assets:[{name,size:bytes.length,browser_download_url:root+name},{name:'SHA256SUMS.txt',browser_download_url:root+'SHA256SUMS.txt'}]}):url.endsWith('.txt')?new Response((corrupt?'0'.repeat(64):hash)+'  '+name):new Response(bytes);
 const u=new Updater({fetch,current:'1.5.1',directory:dir});assert.equal((await u.check()).phase,'available');
 if(corrupt){await assert.rejects(u.download(),/SHA-256/);assert.equal(u.ready,null);assert.deepEqual(await fs.readdir(dir),[]);}else{assert.equal((await u.download()).phase,'ready');const file=await u.verify();assert.equal((await u.check()).phase,'ready');await fs.writeFile(file,'changed');await assert.rejects(u.verify(),/изменён/);}
});
test('installation waits for operations, locks new requests, and quits only after verified launch',async()=>{
 const vm=require('node:vm');const handlers={};let tick,busy=true,locked=false,quit=false,launched=false;
 class FakeUpdater{constructor(){this.state={phase:'ready'};this.ready={expected:'hash'};}async verify(){assert.equal(locked,true);return 'verified.exe';}}
 const context={module:{exports:{}},process:{env:{}},setInterval:fn=>{tick=fn;return {unref(){}};},clearInterval(){},require:name=>name==='electron'?{app:{getVersion:()=> '1.0.0',getPath:()=>'/tmp'},net:{},shell:{}}:name==='./updater'?{Updater:FakeUpdater}:name==='./update-install'?{launchUpdate:async()=>{launched=true;}}:require(name)};
 vm.runInNewContext(await fs.readFile(path.join(__dirname,'../updater-main.js'),'utf8'),context);
 context.module.exports({win:{on(){}},handle:(name,fn)=>handlers[name]=fn,isBusy:()=>busy,lock:()=>locked=true,unlock:()=>locked=false,quit:()=>quit=true});
 assert.equal(handlers['updates-install']().phase,'queued');await tick();assert.equal(launched,false);assert.equal(locked,false);busy=false;await tick();assert.equal(launched,true);assert.equal(quit,true);
});
test('cancelled downloads resume across updater instances and validate the complete file',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'resume-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const bytes=Buffer.from('abcdefghij'),hash=createHash('sha256').update(bytes).digest('hex'),name='Bitora-ScreenFlow-Setup-1.6.0-x64.exe',base='https://github.com/userArturM/Bitora-ScreenFlow/releases/download/v1.6.0/';
 let updater,first=true,range;
 const fetch=async(url,options)=>url.includes('api.github.com')?Response.json({tag_name:'v1.6.0',assets:[{name,size:10,browser_download_url:base+name},{name:'SHA256SUMS.txt',browser_download_url:base+'SHA256SUMS.txt'}]}):url.endsWith('.txt')?new Response(hash+'  '+name):first?(first=false,{ok:true,status:200,body:(async function*(){yield bytes.subarray(0,4);updater.cancel();yield bytes.subarray(4);})()}):(range=options.headers.Range,new Response(bytes.subarray(4),{status:206,headers:{'content-range':'bytes 4-9/10'}}));
 updater=new Updater({fetch,current:'1.5.1',directory:dir});await updater.check();assert.equal((await updater.download()).phase,'available');assert.equal((await fs.stat(path.join(dir,name+'.part'))).size,4);
 updater=new Updater({fetch,current:'1.5.1',directory:dir});await updater.check();await updater.download();assert.equal(range,'bytes=4-');assert.equal(await require('../updater').hashFile(await updater.verify()),hash);
});
test('installer scripts stage portable updates atomically and retain rollback/error reporting',()=>{
 const {installScript}=require('../update-install');const script=installScript("C:\\Артур's\\new.exe",'a'.repeat(64),'C:\\portable.exe',{parentPid:123,restart:false});
 assert.match(script,/File\]::Replace\(\$stage, \$target, \$backup/);assert.match(script,/rolled-back/);assert.match(script,/--update-health/);assert.match(script,/Артур''s/);assert.match(script,/Wait-Process -Id 123/);
});
