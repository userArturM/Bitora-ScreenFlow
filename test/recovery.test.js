const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{spawn}=require('node:child_process');
const media=require('../media-tools');
test('recording survives killed writer and FFmpeg restores the persisted WebM',async t=>{
 const ff=await media.findFfmpeg();if(!ff)return t.skip('FFmpeg unavailable');
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'crash-recovery-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const sample=path.join(dir,'fixture.webm');
 const r=await media.run(ff,['-f','lavfi','-i','testsrc=size=160x120:rate=10','-t','3','-c:v','libvpx','-f','webm',sample],{timeoutMs:20000});assert.equal(r.code,0,r.stderr);
 const code=`const fs=require('node:fs/promises');const {RecordingStore}=require(${JSON.stringify(path.resolve(__dirname,'../recording-store'))});(async()=>{const s=new RecordingStore(process.argv[1],{syncIntervalMs:0});const p=await s.begin();await s.append(await fs.readFile(process.argv[2]));console.log(p);setInterval(()=>{},1000);})();`;
 const child=spawn(process.execPath,['-e',code,dir,sample],{stdio:['ignore','pipe','inherit']});t.after(()=>{if(child.exitCode===null)child.kill();});
 const partial=await new Promise((resolve,reject)=>{let text='';child.stdout.on('data',d=>{text+=d;if(text.includes('\n'))resolve(text.trim());});child.on('error',reject);child.on('exit',()=>reject(new Error('Writer exited before ready')));});
 const exited=new Promise(r=>child.once('exit',r));child.kill('SIGKILL');await exited;
 assert.ok((await fs.stat(partial)).size>100);const restored=await media.repair(ff,partial);assert.ok(await media.probeDuration(ff,restored)>2);
 const invalid=path.join(dir,'broken.partial.webm');await fs.writeFile(invalid,'invalid');await assert.rejects(media.repair(ff,invalid));assert.equal(await fs.readFile(invalid,'utf8'),'invalid');
});
