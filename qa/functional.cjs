const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
module.exports=async({win,store,media,nativeImage})=>{
  const js=code=>win.webContents.executeJavaScript(code,true);
  const wait=async(code,timeout=20000)=>{
    const end=Date.now()+timeout;
    while(Date.now()<end) {if(await js(code))return;await new Promise(r=>setTimeout(r,100));}
    throw new Error('Timed out: '+code+'; UI: '+await js('document.getElementById("message").textContent'));
  };
  await js('(async()=>{await loadConfig();const all=await api.sources();source=all.find(s=>s.id.startsWith("screen:"));if(!source)throw new Error("No CI display capture source");$("sourceLabel").textContent=source.name;for(const id of ["systemAudio","mic","delay","minimize"])$(id).checked=false;updateUI();})()');
  // Idle screenshot uses a fresh, full-resolution desktop stream.
  await js('takeScreenshot()');
  const first=await js('lastScreenshot');
  assert.ok(first,'Screenshot action did not save a PNG');
  const png=nativeImage.createFromPath(first.file);
  assert.ok(!png.isEmpty());
  assert.ok(first.width>100&&first.height>100);
  assert.equal(png.getSize().width,first.width);
  await js('$("shotPreview").close()');
  // Real display video + synthetic microphone. No physical microphone required in CI.
  await js('navigator.mediaDevices.getUserMedia=async()=>{const ctx=new AudioContext();await ctx.resume();const osc=ctx.createOscillator(),dest=ctx.createMediaStreamDestination();osc.connect(dest);osc.start();window.__testAudio=ctx;return dest.stream;};$("mic").checked=true;start()');
  await wait('state==="recording"');
  await new Promise(r=>setTimeout(r,1500));
  await js('pause()');
  assert.equal(await js('state'),'paused');
  const elapsed=await js('elapsed');
  await new Promise(r=>setTimeout(r,700));
  assert.equal(await js('elapsed'),elapsed);
  await js('takeScreenshot()');
  const second=await js('lastScreenshot');
  assert.notEqual(second.name,first.name);
  assert.equal(await js('recorder.state'),'paused');
  await js('$("shotPreview").close();pause()');
  await new Promise(r=>setTimeout(r,1300));
  await js('stop()');
  await wait('state==="idle"',30000);
  const files=(await fs.readdir(store.directory)).filter(n=>n.endsWith('.webm'));
  assert.equal(files.length,1);
  const video=path.join(store.directory,files[0]);
  assert.ok((await fs.stat(video)).size>1000);
  const ffmpeg=await media.findFfmpeg();
  assert.ok(ffmpeg,'Bundled FFmpeg must be available');
  await media.repair(ffmpeg,video);
  const duration=await media.probeDuration(ffmpeg,video);
  assert.ok(duration>1&&duration<15);
  assert.ok((await media.thumbnail(ffmpeg,video,duration))?.length>100);
  const decoded=await media.run(ffmpeg,['-v','error','-i',video,'-map','0:v:0','-map','0:a:0','-f','null','-'],{timeoutMs:20000});
  assert.equal(decoded.code,0,decoded.stderr);
  await js('window.__testAudio.close();navigator.mediaDevices.getDisplayMedia=async()=>{throw new DOMException("Permission denied","NotAllowedError")};start()');
  assert.equal(await js('state'),'idle');
  assert.equal(await js('capture'),null);
  return {passed:true,checks:['actual CI desktop capture','full-resolution idle PNG','PNG while recorder paused','pause/resume timer','WebM video and synthetic audio decode','FFmpeg repair and thumbnail','permission denial cleanup'],screenshot:{width:first.width,height:first.height},duration};
};
