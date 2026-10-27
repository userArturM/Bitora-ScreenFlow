const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {validatePng,savePng}=require('../screenshot-store');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
test('PNG writes preserve bytes, dimensions and unique filenames',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'bitora-png-'));
 try {
  const a=await savePng(dir,png),b=await savePng(dir,png);
  assert.notEqual(a.name,b.name);assert.equal(a.width,1);assert.equal(a.height,1);
  assert.deepEqual(await fs.readFile(a.file),png);
  assert.equal((await fs.readdir(dir)).some(n=>n.endsWith('.tmp')),false);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('reject empty, non-PNG and unreasonable dimensions',()=>{
 for(const data of [new Uint8Array(),Buffer.from('not a PNG'),'text'])assert.throws(()=>validatePng(data));
 const bad=Buffer.from(png);bad.writeUInt32BE(0,16);assert.throws(()=>validatePng(bad));
 bad.writeUInt32BE(100000,16);bad.writeUInt32BE(100000,20);assert.throws(()=>validatePng(bad));
});
