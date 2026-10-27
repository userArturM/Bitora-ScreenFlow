const {test}=require('node:test');
const assert=require('node:assert/strict');
const S=require('../shared');
test('formatBytes и formatDuration',()=>{
  assert.equal(S.formatBytes(1536*1024*1024),'1,50 ГБ');
  assert.equal(S.formatBytes(5*1024*1024),'5,0 МБ');
  assert.equal(S.formatDuration(137),'00:02:17');
  assert.equal(S.formatDuration(3661.9),'01:01:01');
  assert.equal(S.formatDuration(-5),'00:00:00');
});
test('оценка времени записи на свободное место',()=>{
  const seconds=S.estimateSeconds(1024**3,8000000,true);
  assert.ok(seconds>1000&&seconds<1400);
  assert.equal(S.estimateSeconds(0,8000000,true),0);
  assert.equal(S.formatEstimate(0),'—');
  assert.equal(S.formatEstimate(90*60),'≈ 1 ч 30 мин');
  assert.equal(S.formatEstimate(20*60),'≈ 20 мин');
  assert.equal(S.formatEstimate(500*3600),'более 100 ч');
});
test('humanizeError переводит системные сообщения и сохраняет подробности',()=>{
  const r=S.humanizeError(new Error('Requested device not found'));
  assert.match(r.text,/Устройство не найдено/);
  assert.equal(r.details,'Requested device not found');
  const ipc=S.humanizeError(new Error("Error invoking remote method 'rename': Error: Файл с таким именем уже есть."));
  assert.equal(ipc.text,'Файл с таким именем уже есть.');
  assert.equal(S.humanizeError(new Error('ENOSPC: no space left on device')).text,'На диске закончилось место.');
  assert.equal(S.humanizeError(new Error('Something odd')).text,'Произошла ошибка.');
  const denied=S.humanizeError({name:'NotAllowedError',message:'Permission denied'});
  assert.match(denied.text,/Доступ запрещён/);
});
test('проверка имён записей',()=>{
  assert.equal(S.validateRecordingName('Видео.webm'),'Видео.webm');
  assert.equal(S.validateRecordingName('a.partial.webm'),'a.partial.webm');
  assert.equal(S.validateRecordingName('a.MP4'),'a.MP4');
  for(const bad of ['../x.webm','a/b.webm','a\\b.webm','','x.txt','.','..','a.fixing.webm','a.converting.mp4',null,5]) assert.throws(()=>S.validateRecordingName(bad),/Недопустимый/);
  assert.equal(S.isTempName('a.fixing.webm'),true);
  assert.equal(S.isTempName('a.webm'),false);
});
test('sanitizeBaseName убирает запрещённые символы и отвергает плохие имена',()=>{
  assert.equal(S.sanitizeBaseName('  Мой: урок?  '),'Мой урок');
  assert.equal(S.sanitizeBaseName('a<b>c|d*e'),'abcde');
  assert.equal(S.sanitizeBaseName('имя...'),'имя');
  assert.equal(S.sanitizeBaseName('x'.repeat(300)).length,120);
  assert.throws(()=>S.sanitizeBaseName('   '),/имя/i);
  assert.throws(()=>S.sanitizeBaseName('???'),/имя/i);
  assert.throws(()=>S.sanitizeBaseName('CON'),/зарезервировано/);
  assert.throws(()=>S.sanitizeBaseName('lpt1'),/зарезервировано/);
  assert.throws(()=>S.sanitizeBaseName('abc.partial'),/partial/);
});
test('splitName',()=>{
  assert.deepEqual(S.splitName('a.b.webm'),{base:'a.b',partial:false,ext:'.webm'});
  assert.deepEqual(S.splitName('x.partial.webm'),{base:'x',partial:true,ext:'.webm'});
  assert.deepEqual(S.splitName('V.MP4'),{base:'V',partial:false,ext:'.mp4'});
});
test('горячие клавиши: проверка, разбор события, отображение',()=>{
  assert.equal(S.validateAccelerator('CommandOrControl+Shift+R'),true);
  assert.equal(S.validateAccelerator('Alt+F9'),true);
  for(const bad of ['R','Shift+R','Ctrl+R','CommandOrControl+Shift','CommandOrControl+Shift+Ctrl+R','Shift+CommandOrControl+R','CommandOrControl+F13','CommandOrControl+r',5,null]) assert.equal(S.validateAccelerator(bad),false,String(bad));
  assert.equal(S.acceleratorFromEvent({code:'KeyK',ctrlKey:true,altKey:true}),'CommandOrControl+Alt+K');
  assert.equal(S.acceleratorFromEvent({code:'Digit7',ctrlKey:true,shiftKey:true}),'CommandOrControl+Shift+7');
  assert.equal(S.acceleratorFromEvent({code:'F5',altKey:true}),'Alt+F5');
  assert.equal(S.acceleratorFromEvent({code:'KeyK'}),null);
  assert.equal(S.acceleratorFromEvent({code:'KeyK',shiftKey:true}),null);
  assert.equal(S.acceleratorFromEvent({code:'ControlLeft',ctrlKey:true}),null);
  assert.equal(S.displayAccelerator('CommandOrControl+Shift+R'),'Ctrl + Shift + R');
});
test('normalizeHotkeys подставляет значения по умолчанию',()=>{
  assert.deepEqual(S.normalizeHotkeys(undefined),S.DEFAULT_HOTKEYS);
  assert.deepEqual(S.normalizeHotkeys({toggle:'Alt+F1',pause:'Alt+F2'}),{toggle:'Alt+F1',pause:'Alt+F2'});
  assert.deepEqual(S.normalizeHotkeys({toggle:'bad',pause:'Alt+F2'}),{toggle:S.DEFAULT_HOTKEYS.toggle,pause:'Alt+F2'});
  assert.deepEqual(S.normalizeHotkeys({toggle:'Alt+F1',pause:'Alt+F1'}),S.DEFAULT_HOTKEYS);
});
