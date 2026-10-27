const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const mt=require('../media-tools');
test('аргументы ffmpeg',()=>{
  const repair=mt.buildRepairArgs('in.webm','out.webm');
  assert.deepEqual(repair.slice(-5),['-map','0','-c','copy','out.webm']);
  assert.ok(repair.includes('-nostdin'));
  const mp4=mt.buildMp4Args('in.webm','out.mp4');
  assert.ok(mp4.includes('libx264')&&mp4.includes('+faststart')&&mp4.includes('0:a?'));
  assert.equal(mp4.at(-1),'out.mp4');
  assert.ok(mp4.some(a=>a.startsWith('scale=trunc')));
  const thumb=mt.buildThumbArgs('in.webm',1);
  assert.equal(thumb.at(-1),'-');
  assert.equal(thumb[thumb.indexOf('-ss')+1],'1');
});
test('parseDuration',()=>{
  assert.equal(mt.parseDuration('  Duration: 00:01:35.50, start: 0.000000, bitrate: N/A'),95.5);
  assert.equal(mt.parseDuration('  Duration: N/A, start: 0.000000'),null);
  assert.equal(mt.parseDuration(''),null);
  assert.equal(mt.parseDuration(undefined),null);
});
test('uniquePath не затирает существующие файлы',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'screenflow-mt-'));
  try {
    assert.equal(await mt.uniquePath(dir,'a','.mp4'),path.join(dir,'a.mp4'));
    await fs.writeFile(path.join(dir,'a.mp4'),'x');
    assert.equal(await mt.uniquePath(dir,'a','.mp4'),path.join(dir,'a (2).mp4'));
    await fs.writeFile(path.join(dir,'a (2).mp4'),'x');
    assert.equal(await mt.uniquePath(dir,'a','.mp4'),path.join(dir,'a (3).mp4'));
  } finally {await fs.rm(dir,{recursive:true,force:true});}
});
// Интеграционный тест выполняется, только если ffmpeg доступен.
test('восстановление, конвертация и превью с настоящим ffmpeg',async t=>{
  const ffmpeg=await mt.findFfmpeg({force:true});
  if(!ffmpeg) return t.skip('ffmpeg не найден');
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'screenflow-ff-'));
  try {
    const partial=path.join(dir,'Запись.partial.webm');
    const made=await mt.run(ffmpeg,['-y','-f','lavfi','-i','testsrc=size=321x241:rate=30','-f','lavfi','-i','sine=frequency=440','-t','2','-c:v','libvpx','-c:a','libopus','-f','webm','-live','1',partial],{timeoutMs:60000});
    if(made.code!==0) return t.skip('ffmpeg без libvpx/libopus');
    assert.equal(await mt.probeDuration(ffmpeg,partial),null);
    const fixed=await mt.repair(ffmpeg,partial);
    assert.equal(path.basename(fixed),'Запись.webm');
    await assert.rejects(()=>fs.access(partial));
    assert.ok(Math.abs(await mt.probeDuration(ffmpeg,fixed)-2)<0.3);
    const again=await mt.repair(ffmpeg,fixed);
    assert.equal(again,fixed);
    const mp4=await mt.convertToMp4(ffmpeg,fixed);
    assert.equal(path.extname(mp4),'.mp4');
    assert.ok((await fs.stat(mp4)).size>0);
    assert.equal(path.basename(await mt.convertToMp4(ffmpeg,fixed)),'Запись (2).mp4');
    const jpg=await mt.thumbnail(ffmpeg,fixed,2);
    assert.ok(jpg&&jpg[0]===0xff&&jpg[1]===0xd8);
    await assert.rejects(()=>mt.repair(ffmpeg,mp4),/только для WebM/);
    const junk=path.join(dir,'мусор.webm');
    await fs.writeFile(junk,'not a video');
    await assert.rejects(()=>mt.repair(ffmpeg,junk),/ffmpeg/);
    assert.ok(!(await fs.readdir(dir)).some(n=>n.includes('.fixing.')||n.includes('.converting.')));
  } finally {await fs.rm(dir,{recursive:true,force:true});}
});
