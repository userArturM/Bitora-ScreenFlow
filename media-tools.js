const {spawn} = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const {splitName} = require('./shared');

const running = new Set();
let cached; // путь к ffmpeg, null если не найден, undefined пока не искали

function unpacked(p) { return p.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`); }

async function works(command) {
  try { const r = await run(command, ['-version'], {timeoutMs: 8000}); return r.code === 0; } catch { return false; }
}

// Ищем ffmpeg: переменная окружения → рядом с приложением → ffmpeg-static → PATH.
async function findFfmpeg({force = false} = {}) {
  if (cached !== undefined && !force) return cached;
  const candidates = [];
  if (process.env.BITORA_FFMPEG) candidates.push(process.env.BITORA_FFMPEG);
  if (process.resourcesPath) candidates.push(path.join(process.resourcesPath, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'));
  try { const p = require('ffmpeg-static'); if (typeof p === 'string') candidates.push(unpacked(p)); } catch {}
  candidates.push('ffmpeg');
  for (const c of candidates) {
    if (c !== 'ffmpeg') { try { await fs.access(c); } catch { continue; } }
    if (await works(c)) { cached = c; return c; }
  }
  cached = null;
  return null;
}

function run(command, args, {timeoutMs = 0, binary = false} = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']});
    running.add(child);
    const out = [];
    let err = '';
    let timedOut = false;
    const timer = timeoutMs ? setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs) : null;
    child.stdout.on('data', d => { if (binary) out.push(d); });
    child.stderr.on('data', d => { err = (err + d).slice(-20000); });
    child.on('error', e => { clearTimeout(timer); running.delete(child); reject(e); });
    child.on('close', code => {
      clearTimeout(timer); running.delete(child);
      resolve({code: timedOut ? -1 : code, stderr: err, stdout: binary ? Buffer.concat(out) : null, timedOut});
    });
  });
}

function killAll() { for (const c of running) { try { c.kill(); } catch {} } running.clear(); }

// --- аргументы (отдельно, чтобы тестировать без запуска ffmpeg) ---
function buildRepairArgs(input, output) {
  return ['-hide_banner', '-nostdin', '-y', '-i', input, '-map', '0', '-c', 'copy', output];
}
function buildMp4Args(input, output) {
  return ['-hide_banner', '-nostdin', '-y', '-i', input, '-map', '0:v:0', '-map', '0:a?',
    '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', output];
}
function buildThumbArgs(input, atSeconds) {
  return ['-hide_banner', '-nostdin', '-loglevel', 'error', '-ss', String(atSeconds), '-i', input, '-frames:v', '1',
    '-vf', 'scale=320:-2', '-f', 'image2pipe', '-vcodec', 'mjpeg', '-q:v', '5', '-'];
}
function parseDuration(stderr) {
  const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr || '');
  if (!m) return null;
  const s = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  return s > 0 ? s : null;
}

async function exists(p) { try { await fs.access(p); return true; } catch { return false; } }
async function uniquePath(dir, base, ext) {
  let candidate = path.join(dir, base + ext);
  for (let i = 2; await exists(candidate); i++) candidate = path.join(dir, `${base} (${i})${ext}`);
  return candidate;
}

async function runChecked(ffmpeg, args, tmp, timeoutMs) {
  let result;
  try { result = await run(ffmpeg, args, {timeoutMs}); } catch (e) { await fs.rm(tmp, {force: true}); throw e; }
  const size = await fs.stat(tmp).then(s => s.size).catch(() => 0);
  if (result.code !== 0 || !size) {
    await fs.rm(tmp, {force: true});
    throw new Error(result.timedOut ? 'Обработка заняла слишком много времени.' : 'ffmpeg не смог обработать файл. ' + result.stderr.trim().split('\n').slice(-2).join(' '));
  }
}

// Перепаковка без перекодирования: добавляет длительность и индекс перемотки, восстанавливает .partial.webm.
async function repair(ffmpeg, file) {
  const dir = path.dirname(file);
  const {base, partial, ext} = splitName(path.basename(file));
  if (ext !== '.webm') throw new Error('Исправление доступно только для WebM.');
  const tmp = path.join(dir, `${base}.fixing.webm`);
  await runChecked(ffmpeg, buildRepairArgs(file, tmp), tmp, 30 * 60 * 1000);
  if (partial) {
    const target = await uniquePath(dir, base, '.webm');
    await fs.rename(tmp, target);
    await fs.rm(file, {force: true});
    return target;
  }
  await fs.rename(tmp, file);
  return file;
}

async function convertToMp4(ffmpeg, file) {
  const dir = path.dirname(file);
  const {base, ext} = splitName(path.basename(file));
  if (ext !== '.webm') throw new Error('Конвертация доступна только для WebM.');
  const tmp = path.join(dir, `${base}.converting.mp4`);
  await runChecked(ffmpeg, buildMp4Args(file, tmp), tmp, 3 * 60 * 60 * 1000);
  const target = await uniquePath(dir, base, '.mp4');
  await fs.rename(tmp, target);
  return target;
}

async function probeDuration(ffmpeg, file) {
  const r = await run(ffmpeg, ['-hide_banner', '-nostdin', '-i', file], {timeoutMs: 15000});
  return parseDuration(r.stderr);
}

async function thumbnail(ffmpeg, file, duration) {
  const at = duration && duration > 4 ? 1 : 0;
  let r = await run(ffmpeg, buildThumbArgs(file, at), {timeoutMs: 20000, binary: true});
  if ((!r.stdout || !r.stdout.length) && at) r = await run(ffmpeg, buildThumbArgs(file, 0), {timeoutMs: 20000, binary: true});
  return r.stdout && r.stdout.length ? r.stdout : null;
}

module.exports = {findFfmpeg, run, killAll, buildRepairArgs, buildMp4Args, buildThumbArgs, parseDuration, uniquePath, repair, convertToMp4, probeDuration, thumbnail};
