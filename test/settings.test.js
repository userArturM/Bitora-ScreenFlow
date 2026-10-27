const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {SettingsStore}=require('../settings-store');
const {DEFAULT_HOTKEYS}=require('../shared');
async function tmp() {return fs.mkdtemp(path.join(os.tmpdir(),'screenflow-set-'));}
test('значения по умолчанию, когда файла нет',async()=>{
  const dir=await tmp();
  try {assert.deepEqual(await new SettingsStore(dir).read(),{folder:undefined,hotkeys:DEFAULT_HOTKEYS,autoRepair:true});}
  finally {await fs.rm(dir,{recursive:true,force:true});}
});
test('update сохраняет остальные поля и переживает перезапуск',async()=>{
  const dir=await tmp();
  try {
    const a=new SettingsStore(dir);
    await a.update({folder:'D:\\Видео'});
    await a.update({hotkeys:{toggle:'Alt+F1',pause:'Alt+F2'}});
    await a.update({autoRepair:false});
    const b=await new SettingsStore(dir).read();
    assert.equal(b.folder,'D:\\Видео');
    assert.deepEqual(b.hotkeys,{toggle:'Alt+F1',pause:'Alt+F2'});
    assert.equal(b.autoRepair,false);
    assert.deepEqual((await fs.readdir(dir)).sort(),['settings.json']);
  } finally {await fs.rm(dir,{recursive:true,force:true});}
});
test('повреждённый файл и неверные значения игнорируются',async()=>{
  const dir=await tmp();
  try {
    const store=new SettingsStore(dir);
    await fs.writeFile(store.file,'{не json');
    assert.equal((await store.read()).autoRepair,true);
    await fs.writeFile(store.file,JSON.stringify({folder:5,hotkeys:{toggle:'x',pause:'y'},autoRepair:'да'}));
    const r=await store.read();
    assert.equal(r.folder,undefined);
    assert.deepEqual(r.hotkeys,DEFAULT_HOTKEYS);
    await fs.writeFile(store.file,'[1,2]');
    assert.deepEqual((await store.read()).hotkeys,DEFAULT_HOTKEYS);
  } finally {await fs.rm(dir,{recursive:true,force:true});}
});
