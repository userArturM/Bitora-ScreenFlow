const fs = require('node:fs/promises');
const path = require('node:path');
const {normalizeHotkeys} = require('./shared');
// Настройки приложения в settings.json. Запись атомарная, повреждённый файл не ломает запуск.
class SettingsStore {
  constructor(directory) { this.file = path.join(directory, 'settings.json'); }
  async read() {
    let data = {};
    try { data = JSON.parse(await fs.readFile(this.file, 'utf8')); } catch {}
    if (!data || typeof data !== 'object' || Array.isArray(data)) data = {};
    return {
      folder: typeof data.folder === 'string' && data.folder ? data.folder : undefined,
      hotkeys: normalizeHotkeys(data.hotkeys),
      autoRepair: data.autoRepair !== false,
    };
  }
  async update(patch) {
    const next = {...(await this.read()), ...patch};
    if (patch.hotkeys) next.hotkeys = normalizeHotkeys(patch.hotkeys);
    await fs.mkdir(path.dirname(this.file), {recursive: true});
    const tmp = this.file + '.tmp';
    await fs.writeFile(tmp, JSON.stringify(next, null, 2));
    await fs.rename(tmp, this.file);
    return next;
  }
}
module.exports = {SettingsStore};
