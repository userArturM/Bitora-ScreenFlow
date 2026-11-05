const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {RecordingStore}=require('../recording-store');
test('chunks persist in order and final name replaces partial file',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'screenflow-'));
  try {
    const store=new RecordingStore(dir);
    const partial=await store.begin();
    await assert.rejects(()=>store.begin(),/уже/);
    await store.append(new Uint8Array([1,2,3]));
    await store.append(new Uint8Array([4,5]));
    assert.deepEqual([...await fs.readFile(partial)],[1,2,3,4,5]);
    const final=await store.finish();
    assert.equal(final.endsWith('.partial.webm'),false);
    assert.deepEqual([...await fs.readFile(final)],[1,2,3,4,5]);
    await assert.rejects(()=>fs.access(partial));
    assert.equal(await store.finish(),null);
  } finally {await fs.rm(dir,{recursive:true,force:true});}
});
test('empty files removed, invalid data rejected, recording can restart',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'screenflow-'));
  try {
    const store=new RecordingStore(dir);
    await assert.rejects(()=>store.append(new Uint8Array()),/Нет активной/);
    await store.begin();await assert.rejects(()=>store.append('bad'),/Недопустимый/);
    assert.equal(await store.finish(),null);
    assert.deepEqual(await fs.readdir(dir),[]);
    await store.begin();await store.append(new Uint8Array([7]));await store.finish();
    assert.equal((await fs.readdir(dir)).length,1);
  } finally {await fs.rm(dir,{recursive:true,force:true});}
});
test('disk write failure preserves partial bytes for recovery',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'disk-full-'));
 try{const store=new RecordingStore(dir,{syncIntervalMs:0});const partial=await store.begin();await store.append(new Uint8Array([1,2,3]));store.current.handle.write=async()=>{throw Object.assign(new Error('Disk full'),{code:'ENOSPC'});};await assert.rejects(store.append(new Uint8Array([4])),/Disk full/);assert.equal(await store.finish(),partial);assert.deepEqual([...await fs.readFile(partial)],[1,2,3]);}finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('abnormal encoder termination keeps a recoverable partial instead of a normal filename',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'encoder-'));
 try{const store=new RecordingStore(dir);const partial=await store.begin();await store.append(new Uint8Array([1]));assert.equal(await store.finish({preservePartial:true}),partial);}finally{await fs.rm(dir,{recursive:true,force:true});}
});
