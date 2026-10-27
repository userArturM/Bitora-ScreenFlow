const fs = require('node:fs/promises');
const path = require('node:path');
const {randomUUID} = require('node:crypto');
const SIGNATURE = Buffer.from([137,80,78,71,13,10,26,10]);
function validatePng(data) {
  if (!(data instanceof Uint8Array) || data.byteLength < 33 || data.byteLength > 100*1024*1024) throw new Error('Недопустимый размер PNG.');
  const buffer=Buffer.from(data);
  if (!buffer.subarray(0,8).equals(SIGNATURE) || buffer.toString('ascii',12,16)!=='IHDR') throw new Error('Ожидался файл PNG.');
  const width=buffer.readUInt32BE(16),height=buffer.readUInt32BE(20);
  if (!width || !height || width*height>100000000) throw new Error('Недопустимое разрешение изображения.');
  return {buffer,width,height};
}
async function savePng(directory,data) {
  const {buffer,width,height}=validatePng(data);
  await fs.mkdir(directory,{recursive:true});
  const name='Скриншот_'+new Date().toISOString().replace(/[:.]/g,'-')+'_'+randomUUID().slice(0,8)+'.png';
  const file=path.join(directory,name),tmp=file+'.tmp';
  try {await fs.writeFile(tmp,buffer,{flag:'wx'});await fs.rename(tmp,file);}
  finally {await fs.rm(tmp,{force:true}).catch(()=>{});}
  return {name,file,width,height};
}
module.exports={validatePng,savePng};
