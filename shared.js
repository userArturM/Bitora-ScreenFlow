// Общие чистые функции: работают и в Electron (require), и в окне (window.Shared).
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Shared = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const MODS = ['CommandOrControl', 'Alt', 'Shift'];
  const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
  const TEMP_MARKERS = ['.fixing.', '.converting.'];
  const DEFAULT_HOTKEYS = {toggle: 'CommandOrControl+Shift+R', pause: 'CommandOrControl+Shift+P'};

  function formatBytes(n) {
    n = Number(n) || 0;
    if (n >= 1024 ** 3) return (n / 1024 ** 3).toFixed(2).replace('.', ',') + ' ГБ';
    return (n / 1024 ** 2).toFixed(1).replace('.', ',') + ' МБ';
  }

  function formatDuration(totalSeconds) {
    const s = Math.max(0, Math.floor(Number(totalSeconds) || 0));
    const pad = n => String(n).padStart(2, '0');
    return pad(Math.floor(s / 3600)) + ':' + pad(Math.floor(s / 60) % 60) + ':' + pad(s % 60);
  }

  // Сколько секунд записи поместится на свободное место.
  function estimateSeconds(freeBytes, videoBitsPerSecond, withAudio) {
    const bytesPerSecond = ((Number(videoBitsPerSecond) || 0) + (withAudio ? 192000 : 0)) / 8;
    if (!bytesPerSecond || !(freeBytes > 0)) return 0;
    return freeBytes / bytesPerSecond;
  }

  function formatEstimate(seconds) {
    if (!(seconds > 0)) return '—';
    const hours = seconds / 3600;
    if (hours >= 100) return 'более 100 ч';
    if (hours >= 1) return '≈ ' + Math.floor(hours) + ' ч ' + Math.floor((seconds / 60) % 60) + ' мин';
    return '≈ ' + Math.max(1, Math.floor(seconds / 60)) + ' мин';
  }

  // Понятное русское сообщение вместо системных английских.
  function humanizeError(error) {
    const raw = String((error && (error.message || error.name)) || error || '').replace(/^Error invoking remote method '[^']*':\s*(Error:\s*)?/, '');
    const name = error && error.name;
    const rules = [
      [/Requested device not found|NotFoundError/i, 'Устройство не найдено. Проверьте, что микрофон подключён и включён в Windows.'],
      [/Permission denied|NotAllowedError|Permission dismissed/i, 'Доступ запрещён. Разрешите приложению доступ в настройках конфиденциальности Windows.'],
      [/NotReadableError|Could not start (audio|video) source|device in use/i, 'Устройство занято другой программой. Закройте её и повторите.'],
      [/OverconstrainedError|Constraint/i, 'Выбранное устройство недоступно. Выберите «По умолчанию».'],
      [/AbortError/i, 'Операция прервана.'],
      [/ENOSPC|no space left/i, 'На диске закончилось место.'],
      [/EACCES|EPERM/i, 'Нет прав на запись в эту папку.'],
      [/EBUSY/i, 'Файл занят другой программой.'],
      [/ENOENT/i, 'Файл или папка не найдены.'],
    ];
    for (const [re, text] of rules) if (re.test(raw) || re.test(name || '')) return {text, details: raw};
    const hasCyrillic = /[А-Яа-яЁё]/.test(raw);
    return hasCyrillic ? {text: raw, details: ''} : {text: 'Произошла ошибка.', details: raw};
  }

  function isRecordingName(name) {
    return typeof name === 'string' && /\.(webm|mp4)$/i.test(name) && !TEMP_MARKERS.some(m => name.includes(m));
  }

  function isTempName(name) { return typeof name === 'string' && TEMP_MARKERS.some(m => name.includes(m)); }

  function validateRecordingName(name) {
    if (typeof name !== 'string' || !name || name.includes('/') || name.includes('\\') || name === '.' || name === '..' || !isRecordingName(name)) {
      throw new Error('Недопустимый файл');
    }
    return name;
  }

  // Новое имя без расширения: убираем запрещённые для Windows символы.
  function sanitizeBaseName(input) {
    let s = String(input ?? '').replace(/[\u0000-\u001f<>:"/\\|?*]/g, '').replace(/\s+/g, ' ').trim();
    s = s.replace(/[. ]+$/g, '').replace(/^\.+/, '').slice(0, 120).trim();
    if (!s) throw new Error('Введите имя файла.');
    if (RESERVED.test(s)) throw new Error('Это имя зарезервировано Windows. Выберите другое.');
    if (/\.partial$/i.test(s)) throw new Error('Имя не должно заканчиваться на .partial');
    return s;
  }

  function splitName(name) {
    const m = /^(.*?)(\.partial)?(\.(?:webm|mp4))$/i.exec(name);
    return m ? {base: m[1], partial: !!m[2], ext: m[3].toLowerCase()} : {base: name, partial: false, ext: ''};
  }

  // --- горячие клавиши ---
  function validateAccelerator(acc) {
    if (typeof acc !== 'string') return false;
    const parts = acc.split('+');
    const key = parts.pop();
    if (!/^([A-Z0-9]|F([1-9]|1[0-2]))$/.test(key)) return false;
    if (!parts.length || new Set(parts).size !== parts.length || !parts.every(p => MODS.includes(p))) return false;
    const ordered = MODS.filter(m => parts.includes(m));
    if (ordered.join('+') !== parts.join('+')) return false;
    // Только Shift без Ctrl/Alt мешал бы обычному вводу текста.
    return parts.includes('CommandOrControl') || parts.includes('Alt');
  }

  function acceleratorFromEvent(e) {
    const code = e.code || '';
    let key = null;
    if (/^Key[A-Z]$/.test(code)) key = code.slice(3);
    else if (/^Digit[0-9]$/.test(code)) key = code.slice(5);
    else if (/^F([1-9]|1[0-2])$/.test(code)) key = code;
    if (!key) return null;
    const parts = [];
    if (e.ctrlKey || e.metaKey) parts.push('CommandOrControl');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');
    const acc = parts.concat(key).join('+');
    return validateAccelerator(acc) ? acc : null;
  }

  function displayAccelerator(acc) {
    return String(acc).split('+').map(p => (p === 'CommandOrControl' ? 'Ctrl' : p)).join(' + ');
  }

  function normalizeHotkeys(input) {
    const out = {...DEFAULT_HOTKEYS};
    for (const k of Object.keys(DEFAULT_HOTKEYS)) if (input && validateAccelerator(input[k])) out[k] = input[k];
    if (out.toggle === out.pause) return {...DEFAULT_HOTKEYS};
    return out;
  }

  return {isTempName, formatBytes, formatDuration, estimateSeconds, formatEstimate, humanizeError, isRecordingName, validateRecordingName,
    sanitizeBaseName, splitName, validateAccelerator, acceleratorFromEvent, displayAccelerator, normalizeHotkeys, DEFAULT_HOTKEYS};
});
