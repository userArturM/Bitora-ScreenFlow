const fs = require('node:fs/promises');
const path = require('node:path');
const {randomUUID} = require('node:crypto');
class RecordingStore {
  constructor(directory) { this.directory = directory; this.current = null; }
  async begin() {
    if (this.current) throw new Error('Запись уже открыта');
    await fs.mkdir(this.directory, {recursive:true});
    const name = 'Запись_' + new Date().toISOString().replace(/[:.]/g,'-') + '_' + randomUUID().slice(0,6);
    const file = path.join(this.directory, name + '.partial.webm');
    const handle = await fs.open(file, 'wx');
    this.current = {file,handle,bytes:0};
    return file;
  }
  async append(data) {
    if (!this.current) throw new Error('Нет активной записи');
    if (!(data instanceof Uint8Array) || data.byteLength > 64*1024*1024) throw new Error('Недопустимый блок');
    const buffer = Buffer.from(data);
    let offset = 0;
    while (offset < buffer.length) {
      const {bytesWritten} = await this.current.handle.write(buffer,offset,buffer.length-offset);
      if (!bytesWritten) throw new Error('Не удалось записать данные');
      offset += bytesWritten;
    }
    this.current.bytes += buffer.length;
    return this.current.bytes;
  }
  async finish() {
    if (!this.current) return null;
    const item = this.current;
    this.current = null;
    try { await item.handle.sync(); } finally { await item.handle.close(); }
    if (!item.bytes) { await fs.unlink(item.file); return null; }
    const final = item.file.replace('.partial.webm','.webm');
    await fs.rename(item.file, final);
    return final;
  }
}
module.exports = {RecordingStore};
