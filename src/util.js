'use strict';
/* Общие утилиты: пути, HTTP-загрузка (с зеркалами), процессы, ожидание порта */
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const https = require('https');
const net = require('net');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');

const IS_WIN = process.platform === 'win32';
let adminCache = null;

let PATHS = null;
function setPaths(p) { PATHS = p; return p; }
function paths() {
  if (!PATHS) throw new Error('paths() не инициализирован');
  return PATHS;
}

function ensureDir(dir) {
  try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
  return dir;
}

/* ---------- JSON-хранилище ---------- */
function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return fallback; }
}
function writeJson(file, data) {
  ensureDir(path.dirname(file));
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, file);
  return data;
}
function appendLine(file, line) {
  try {
    ensureDir(path.dirname(file));
    fs.appendFileSync(file, line + os.EOL, 'utf8');
    const st = fs.statSync(file);
    if (st.size > 1.5 * 1024 * 1024) rotateFile(file);
  } catch (_) {}
}
function rotateFile(file, keep = 1) {
  try {
    for (let i = keep - 1; i >= 1; i--) {
      if (fs.existsSync(`${file}.${i}`)) fs.renameSync(`${file}.${i}`, `${file}.${i + 1}`);
    }
    if (fs.existsSync(file)) fs.renameSync(file, `${file}.1`);
  } catch (_) {}
}

/* ---------- HTTP ---------- */
const MIRRORS = [
  u => u,
  u => u.replace('https://github.com/', 'https://gh-proxy.com/https://github.com/'),
  u => u.replace('https://raw.githubusercontent.com/', 'https://gh-proxy.com/https://raw.githubusercontent.com/'),
  u => u.replace('https://github.com/', 'https://ghfast.top/https://github.com/')
];

function httpGet(url, { timeout = 30000, redirects = 6, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (fn, arg) => { if (!settled) { settled = true; fn(arg); } };
    let req;
    try {
      req = (url.startsWith('http:') ? http : https).get(url, {
        headers: { 'User-Agent': 'YumeHazeZapret/2.1', 'Accept': '*/*', ...headers },
        timeout
      }, res => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects > 0) {
          res.resume();
          const next = new URL(res.headers.location, url).toString();
          return httpGet(next, { timeout, redirects: redirects - 1, headers }).then(a => done(resolve, a), e => done(reject, e));
        }
        if (res.statusCode !== 200) {
          res.resume();
          return done(reject, new Error(`HTTP ${res.statusCode} для ${url}`));
        }
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => done(resolve, Buffer.concat(chunks)));
        res.on('error', e => done(reject, e));
      });
    } catch (e) { return reject(e); }
    req.on('timeout', () => { req.destroy(new Error('Таймаут соединения')); });
    req.on('error', e => done(reject, e));
  });
}

async function downloadWithMirrors(url, dest, { onProgress, useMirror = true } = {}) {
  const candidates = useMirror ? MIRRORS.map(f => f(url)) : [url];
  let lastErr;
  for (const cand of candidates) {
    try {
      const buf = await httpGet(cand, { timeout: 120000 });
      if (onProgress) onProgress(1, buf.length, cand);
      ensureDir(path.dirname(dest));
      fs.writeFileSync(dest, buf);
      return { bytes: buf.length, url: cand };
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('Не удалось скачать файл');
}

async function getJson(url, useMirror = true) {
  const candidates = useMirror ? MIRRORS.map(f => f(url)) : [url];
  let lastErr;
  for (const cand of candidates) {
    try {
      const buf = await httpGet(cand, { timeout: 20000, headers: { 'Accept': 'application/vnd.github+json' } });
      return JSON.parse(buf.toString('utf8'));
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

/* ---------- процессы ---------- */
function exec(cmd, args, opts = {}) {
  return new Promise(resolve => {
    // windowsHide обязателен и не должен перетираться через opts
    execFile(cmd, args, { ...opts, windowsHide: true, timeout: opts.timeout || 15000 }, (err, stdout, stderr) => {
      resolve({ ok: !err, code: err ? (err.code || 1) : 0, stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

/* Консольные утилиты Windows (sc.exe, reg.exe) пишут текст в OEM-кодировке (cp866),
   а Node читает его как UTF-8 — отсюда кракозябры. Если файл журнала содержит такие
   символы, значит поток уже испорчен: перекодировать его обратно нельзя, поэтому
   просим утилиты другой вывод — см. execConsole() ниже. */
const BROKEN_RE = /[\u00A4\u00A6\u00A8\u00AC\u00AE\u00AF\u00B0-\u00B4\u00B8\u00BB\uFFFD\u0414\u0404\u0406\u0407]/;
function looksBroken(str) {
  const t = String(str || '');
  if (!t) return false;
  // много «кириллических» заглавных вперемешку с символами валют/тильдами = испорченный cp866
  const suspicious = (t.match(/[\u00A4\u00A6\u00A8\u00AC\u00AE\u00AF\uFFFD]/g) || []).length;
  return suspicious >= 2 || BROKEN_RE.test(t) && (t.match(BROKEN_RE) || []).length >= 3;
}

function decodeConsole(str) {
  return String(str == null ? '' : str);
}

async function isAdmin({ force = false } = {}) {
  if (!IS_WIN) return process.getuid ? process.getuid() === 0 : false;
  if (!force && adminCache !== null) return adminCache;
  let res = false;
  try {
    const r = await exec('net', ['session'], { timeout: 8000 });
    res = r.ok;
  } catch (_) { res = false; }
  if (!res) {
    // net session молчит, если служба Server отключена — проверяем роль в токене без окна
    try {
      const ps = "([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent())" +
        ".IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)";
      const r2 = await exec('powershell', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', ps], { timeout: 8000 });
      res = /true/i.test(String(r2.stdout || ''));
    } catch (_) { res = false; }
  }
  adminCache = res;
  return res;
}

/* Запуск консольной утилиты с гарантированно читаемым русским выводом:
   PowerShell перекодирует OEM-поток в UTF-8 (в отличие от execFile, где байты
   cp866 попадают в строку как есть и превращаются в кракозябры). */
async function execConsole(exe, args = [], { timeout = 20000 } = {}) {
  if (!IS_WIN) return { ok: false, stdout: '', stderr: 'не Windows', code: 1 };
  const q = v => "'" + String(v).replace(/'/g, "''") + "'";
  const argList = args.map(q).join(',');
  const ps = `$OutputEncoding=[Console]::OutputEncoding=[Text.Encoding]::UTF8; ` +
    `$r = & ${q(exe)} ${args.length ? '@(' + argList + ')' : ''} 2>&1 | Out-String; ` +
    `$code = $LASTEXITCODE; [Console]::Out.Write($r); exit $code`;
  const r = await exec('powershell', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', ps], { timeout });
  return { ok: r.ok, code: r.code, stdout: r.stdout, stderr: r.stderr };
}

async function runElevated(exe, params) {
  // Запуск через PowerShell Start-Process -Verb RunAs (появится UAC)
  const ps = `Start-Process -FilePath ${psQuote(exe)} -ArgumentList ${psQuote(params)} -Verb RunAs`;
  return exec('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-Command', ps], { timeout: 30000 });
}

/* Повторный запуск приложения с правами администратора (окно UAC). */
async function relaunchElevated(args, cwd) {
  const list = args && args.length ? ` -ArgumentList ${psQuote(args.join(' '))}` : '';
  const ps = `Start-Process -FilePath ${psQuote(process.execPath)}${list} -Verb RunAs -WorkingDirectory ${psQuote(cwd || process.cwd())}`;
  const r = await exec('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-Command', ps], { timeout: 60000 });
  return { ok: r.ok && !/Canceled|cancelled|отменено/i.test(String(r.stderr || r.stdout || '')), stderr: r.stderr, stdout: r.stdout };
}

function psQuote(s) { return `'${String(s).replace(/'/g, "''")}'`; }

/* Снимок списка процессов с кэшем на 1.5 с и объединением одновременных запросов:
   раньше status() → winwsPids() и driverDiagnostics() → winwsPids() запускали
   ДВА отдельных tasklist на каждый тик (раз в 4 с), а tasklist.exe — полное
   перечисление процессов, это заметная нагрузка на CPU. */
let procCache = { at: 0, name: '', list: null };
let procPending = null;

async function tasklistCached(name) {
  if (!IS_WIN) return [];
  const now = Date.now();
  if (procCache.list && procCache.name === name && now - procCache.at < 1500) return procCache.list;
  if (procPending && procPending.name === name) return procPending.promise;
  const promise = (async () => {
    const r = await exec('tasklist', ['/FI', `IMAGENAME eq ${name}`, '/FO', 'CSV', '/NH']);
    const out = [];
    for (const line of r.stdout.split(/\r?\n/)) {
      const m = line.match(/^"([^"]+)","(\d+)"/);
      if (m && m[1].toLowerCase() === name.toLowerCase()) out.push({ name: m[1], pid: Number(m[2]) });
    }
    procCache = { at: Date.now(), name, list: out };
    procPending = null;
    return out;
  })();
  procPending = { name, promise };
  return promise;
}

/* Сбросить кэш процессов (после kill/spawn, чтобы статус был свежим). */
function invalidateProcessCache() { procCache = { at: 0, name: '', list: null }; }

async function tasklist() {
  if (!IS_WIN) return new Set();
  const r = await exec('tasklist', ['/FO', 'CSV', '/NH']);
  const set = new Set();
  for (const line of r.stdout.split(/\r?\n/)) {
    const m = line.match(/^"([^"]+)"/);
    if (m) set.add(m[1].toLowerCase());
  }
  return set;
}

async function findProcessByName(name) {
  return tasklistCached(name);
}

async function killByName(name) {
  if (!IS_WIN) return false;
  invalidateProcessCache();
  const list = await findProcessByName(name);
  if (!list.length) return false;
  const r = await exec('taskkill', ['/F', '/IM', name]);
  invalidateProcessCache();
  return r.ok;
}

async function sc(args, timeout = 20000) {
  if (!IS_WIN) return { ok: false, stdout: '', stderr: 'не Windows' };
  const r = await execConsole('sc.exe', args, { timeout });
  if (looksBroken(r.stdout) || looksBroken(r.stderr)) {
    const fb = await exec('sc.exe', args, { timeout });
    return { ...fb, stdout: String(fb.stdout || ''), stderr: String(fb.stderr || '') };
  }
  return r;
}

const svcCache = new Map();
async function serviceState(name = 'zapret', { force = false } = {}) {
  if (!IS_WIN) return 'unavailable';
  const hit = svcCache.get(name);
  if (!force && hit && Date.now() - hit.at < 5000) return hit.state;
  // Раньше здесь вызывался sc() → execConsole → PowerShell (запуск powershell.exe на
  // каждый опрос). Нам нужна только строка STATE — она в ASCII, кодировка не важна.
  const r = await exec('sc.exe', ['query', name], { timeout: 8000 });
  if (!r.ok) {
    // 1060 — служба не установлена; прочие коды (1075, 5) тоже считаем «не активна»
    return /1060/.test(r.stdout + r.stderr) ? 'not-installed' : 'not-installed';
  }
  const m = r.stdout.match(/STATE\s*:\s*\d+\s+(\w+)/i);
  const state = m ? m[1].toUpperCase() : 'UNKNOWN';
  svcCache.set(name, { at: Date.now(), state });
  return state;
}

/* ---------- сеть ---------- */
function tcpProbe(host, port, timeout = 1200) {
  return new Promise(resolve => {
    const t0 = Date.now();
    const sock = new net.Socket();
    let done = false;
    const finish = ok => {
      if (done) return; done = true;
      try { sock.destroy(); } catch (_) {}
      resolve({ ok, ms: ok ? Date.now() - t0 : null });
    };
    sock.setTimeout(timeout);
    sock.once('connect', () => finish(true));
    sock.once('timeout', () => finish(false));
    sock.once('error', () => finish(false));
    try { sock.connect(port, host); } catch (_) { finish(false); }
  });
}

function freePort(port) {
  return new Promise(resolve => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    srv.listen(port, '127.0.0.1');
  });
}

function randomHex(bytes = 16) { return crypto.randomBytes(bytes).toString('hex'); }

function humanBytes(n) {
  n = Number(n) || 0;
  const u = ['Б', 'КБ', 'МБ', 'ГБ'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${i === 0 ? n : n.toFixed(n < 10 ? 2 : 1)} ${u[i]}`;
}

function humanDuration(ms) {
  if (!ms || ms < 0) return '—';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s} с`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} мин ${s % 60} с`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} ч ${m % 60} мин`;
  return `${Math.floor(h / 24)} д ${h % 24} ч`;
}

function rmrf(p) {
  try { fs.rmSync(p, { recursive: true, force: true }); } catch (_) {}
}

function findFiles(dir, matcher, out = [], depth = 0) {
  if (depth > 3 || !fs.existsSync(dir)) return out;
  let items = [];
  try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return out; }
  for (const it of items) {
    const full = path.join(dir, it.name);
    if (it.isDirectory()) findFiles(full, matcher, out, depth + 1);
    else if (matcher(it.name, full)) out.push(full);
  }
  return out;
}

module.exports = {
  tasklistCached, invalidateProcessCache,
  IS_WIN, setPaths, paths, ensureDir, readJson, writeJson, appendLine, rotateFile,
  httpGet, getJson, downloadWithMirrors, exec, execConsole, isAdmin, runElevated, psQuote, relaunchElevated,
  decodeConsole, looksBroken,
  tasklist, findProcessByName, killByName, sc, serviceState, tcpProbe, freePort,
  randomHex, humanBytes, humanDuration, rmrf, findFiles
};
