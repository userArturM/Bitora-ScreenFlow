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
