'use strict';
/* Zapret (Flowseal zapret-discord-youtube 1.10.4) — установка, запуск, списки, служба */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const {
  IS_WIN, exec, downloadWithMirrors, getJson, findProcessByName, killByName, serviceState, sc, decodeConsole,
  paths, ensureDir, findFiles, rmrf, runElevated, psQuote, isAdmin, httpGet, tasklist
} = require('./util');
const config = require('./config');
const log = require('./logger');
const { STRATEGIES, ZAPRET_VERSION, gameFilterModeToFlag } = require('./assets/strategies');

const WINWS = 'winws.exe';
const RELEASES_API = 'https://api.github.com/repos/Flowseal/zapret-discord-youtube/releases?per_page=15';
let releaseCache = null;      // последний найденный релиз { version, url, notes, publishedAt, at }

/* Последний стабильный релиз Zapret с GitHub (кэш 10 минут).
   Раньше версия была жёстко зашита (1.10.4) и новые релизы Flowseal не подхватывались. */
async function latestRelease({ force = false } = {}) {
  if (!force && releaseCache && Date.now() - releaseCache.at < 10 * 60 * 1000) return releaseCache;
  try {
    const rels = await getJson(RELEASES_API, config.get().app.useMirror);
    const list = Array.isArray(rels) ? rels : [rels];
    const stable = list.find(r => r && !r.prerelease && !r.draft && r.tag_name);
    if (!stable) throw new Error('нет стабильных релизов');
    const version = String(stable.tag_name).replace(/^v/, '');
    const asset = (stable.assets || []).find(a => /zapret-discord-youtube.*\.zip$/i.test(a.name))
      || (stable.assets || []).find(a => /\.zip$/i.test(a.name));
    const info = {
      at: Date.now(),
      version,
      tag: stable.tag_name,
      url: asset ? asset.browser_download_url
        : `https://github.com/Flowseal/zapret-discord-youtube/releases/download/${stable.tag_name}/zapret-discord-youtube-${version}.zip`,
      page: stable.html_url,
      notes: stable.body || '',
      publishedAt: stable.published_at
    };
    releaseCache = info;
    log.tech('ZAPRET', `последний релиз Zapret: ${version}`);
    return info;
  } catch (e) {
    log.warn('ZAPRET', 'GitHub API недоступен, использую закреплённую версию ' + ZAPRET_VERSION + ': ' + e.message);
    return releaseCache || {
      at: Date.now(), version: ZAPRET_VERSION, tag: ZAPRET_VERSION,
      url: `https://github.com/Flowseal/zapret-discord-youtube/releases/download/${ZAPRET_VERSION}/zapret-discord-youtube-${ZAPRET_VERSION}.zip`,
      page: '', notes: '', publishedAt: null, fallback: true
    };
  }
}
const IPSET_URL = 'https://raw.githubusercontent.com/Flowseal/zapret-discord-youtube/refs/heads/main/.service/ipset-service.txt';
const HOSTS_URL = 'https://raw.githubusercontent.com/Flowseal/zapret-discord-youtube/refs/heads/main/.service/hosts';

const LIST_FILES = {
  user: 'list-general-user.txt',
  exclude: 'list-exclude-user.txt',
  ipExclude: 'ipset-exclude-user.txt',
  general: 'list-general.txt',
  google: 'list-google.txt',
  excludeMain: 'list-exclude.txt',
  ipset: 'ipset-all.txt',
  ipsetExclude: 'ipset-exclude.txt'
};

let startedAt = null;      // когда мы запустили winws
let busy = null;           // текущая долгая операция

/* ---------------- пути ---------------- */
function dir() { return config.zapretDir(); }
function valid(d = dir()) { return fs.existsSync(path.join(d, 'bin', WINWS)); }
function lists(d = dir()) { return path.join(d, 'lists'); }
function batPath(file) { return path.join(dir(), file); }

function installedVersion(d = dir()) {
  try {
    const txt = fs.readFileSync(path.join(d, 'service.bat'), 'utf8');
    const m = txt.match(/LOCAL_VERSION=([\d.]+)/);
    return m ? m[1] : ZAPRET_VERSION;
  } catch (_) { return valid(d) ? ZAPRET_VERSION : null; }
}

/* ---------------- установка ---------------- */
async function install({ onProgress } = {}) {
  if (!IS_WIN) throw new Error('Zapret работает только в Windows');
  const target = dir();
  const rel = await latestRelease();
  const version = rel.version || ZAPRET_VERSION;
  const zipPath = path.join(paths().downloads, `zapret-${version}.zip`);
  const tmpDir = path.join(paths().downloads, 'zapret-tmp');

  log.info('ZAPRET', `Скачиваю zapret ${version}…`);
  if (onProgress) onProgress({ stage: 'download', pct: 5, text: 'Загрузка архива с GitHub' });
  const dl = await downloadWithMirrors(rel.url, zipPath, {
    useMirror: config.get().app.useMirror,
    onProgress: (pct, bytes) => onProgress && onProgress({ stage: 'download', pct: 20, text: `Архив получен (${Math.round(bytes / 1024)} КБ)` })
  });
  log.ok('ZAPRET', `Архив загружен: ${Math.round(dl.bytes / 1024)} КБ`);

  if (onProgress) onProgress({ stage: 'extract', pct: 40, text: 'Распаковка архива' });
  rmrf(tmpDir);
  ensureDir(tmpDir);
  try {
    const { unzip } = require('./unzip');
    unzip(zipPath, tmpDir, { onProgress: p => onProgress && onProgress({ stage: 'extract', pct: 40 + Math.round(p * 25), text: 'Распаковка архива' }) });
  } catch (e) {
    log.warn('ZAPRET', 'Встроенный распаковщик: ' + e.message + ' — пробую PowerShell');
    rmrf(tmpDir);
    ensureDir(tmpDir);
    const ex = await exec('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-Command',
      `$ProgressPreference='SilentlyContinue'; Expand-Archive -LiteralPath ${psQuote(zipPath)} -DestinationPath ${psQuote(tmpDir)} -Force`], { timeout: 300000 });
    if (!ex.ok) throw new Error('Не удалось распаковать архив: ' + (e.stderr || ex.stdout).slice(0, 300));
  }

  // Архив содержит одну вложенную папку — поднимаем её содержимое
  let root = tmpDir;
  const inner = fs.readdirSync(tmpDir).map(n => path.join(tmpDir, n)).filter(p => {
    try { return fs.statSync(p).isDirectory(); } catch (_) { return false; }
  });
  if (inner.length === 1 && fs.existsSync(path.join(inner[0], 'bin'))) root = inner[0];

  if (onProgress) onProgress({ stage: 'extract', pct: 70, text: 'Копирование файлов' });
  stopQuiet();
  await new Promise(r => setTimeout(r, 600));
  if (fs.existsSync(target) && !valid(target)) rmrf(target);
  ensureDir(target);
  copyDir(root, target);

  if (!valid(target)) throw new Error('В скачанном архиве нет bin\\winws.exe — возможно, релиз Flowseal изменил структуру. Попробуйте «Обновить» ещё раз.');
  ensureUserLists(target);
  applyGameFilterFile(target);
  applyIpsetMode(target, config.get().zapret.ipsetMode, { silent: true });
  if (onProgress) onProgress({ stage: 'done', pct: 100, text: `Zapret ${version} установлен` });
  log.ok('ZAPRET', `Zapret ${version} установлен в ${target}`);
  try { syncUserLists(); } catch (e) { log.warn('ZAPRET', 'списки: ' + e.message); }
  invalidateHeavy();
  return { ok: true, dir: target, version };
}

function copyDir(src, dest) {
  ensureDir(dest);
  for (const it of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, it.name);
    const d = path.join(dest, it.name);
    if (it.isDirectory()) copyDir(s, d);
    else {
      try { fs.copyFileSync(s, d); } catch (e) { log.warn('ZAPRET', `Не удалось скопировать ${it.name}: ${e.message}`); }
    }
  }
}

function ensureUserLists(d = dir()) {
  const L = lists(d);
  ensureDir(L);
  const seeds = {
    'list-general-user.txt': '# Свои сайты — по одному домену на строку\n',
    'list-exclude-user.txt': '# Исключения — обход к этим доменам не применяется\n',
    'ipset-exclude-user.txt': '203.0.113.113/32\n'
  };
  // файлы из архива обязательны: winws.exe падает, если какого-то списка нет
  const required = {
    'ipset-exclude.txt': '# IP, которые исключены из обхода\n203.0.113.113/32\n',
    'ipset-all.txt': '',
    'list-general.txt': '',
    'list-exclude.txt': '',
    'list-google.txt': ''
  };
  for (const [name, body] of Object.entries({ ...required, ...seeds })) {
    const f = path.join(L, name);
    if (!fs.existsSync(f)) {
      fs.writeFileSync(f, body, 'utf8');
      log.warn('ZAPRET', `Не хватало списка ${name} — создан пустой шаблон`);
    }
  }
  const missing = Object.keys(required).filter(n => fs.statSync(path.join(L, n)).size === 0);
  if (missing.length) log.warn('ZAPRET', 'Пустые списки доменов: ' + missing.join(', ') + ' — обход будет работать по IPset');
  return { dir: L, missing };
}


/* ---------------- игра ---------------- */
function applyGameFilterFile(d = dir(), gf = config.get().zapret.gameFilter) {
  const file = path.join(d, 'utils', 'game_filter.enabled');
  const mode = gf.mode || 'off';
  try {
    ensureDir(path.dirname(file));
    if (mode === 'off') { if (fs.existsSync(file)) fs.unlinkSync(file); return; }
    const body = `mode=${gameFilterModeToFlag(mode)}\r\ntcp=${gf.tcp || '1024-65535'}\r\nudp=${gf.udp || '1024-65535'}\r\n`;
    fs.writeFileSync(file, body, 'utf8');
  } catch (e) { log.warn('ZAPRET', `Не удалось записать game_filter.enabled: ${e.message}`); }
}

function readGameFilter(d = dir()) {
  const file = path.join(d, 'utils', 'game_filter.enabled');
  const out = { mode: 'off', tcp: '1024-65535', udp: '1024-65535' };
  try {
    if (!fs.existsSync(file)) return out;
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const [k, v] = line.split('=');
      if (!k) continue;
      const key = k.trim().toLowerCase();
      if (key === 'mode' || key === 'all') out.mode = (v || 'all').trim() || 'all';
      if (key === 'tcp' && v) out.tcp = v.trim();
      if (key === 'udp' && v) out.udp = v.trim();
    }
  } catch (_) {}
  return out;
}

function validateRanges(tcp, udp) {
  const okItem = item => {
    const m = /^([1-9]\d{0,4})(?:-([1-9]\d{0,4}))?$/.exec(item);
    if (!m) return false;
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    return a >= 1 && b <= 65535 && a <= b;
  };
  const check = v => {
    const s = String(v == null ? '' : v).replace(/\s/g, '');
    if (!s) return false;
    return s.split(',').every(okItem);
  };
  return { tcp: check(tcp), udp: check(udp) };
}

/* ---------------- ipset ---------------- */
function ipsetState(d = dir()) {
  const file = path.join(lists(d), 'ipset-all.txt');
  const backup = file + '.backup';
  let lines = 0, raw = '';
  try { raw = fs.readFileSync(file, 'utf8'); } catch (_) {}
  lines = raw.split(/\r?\n/).filter(l => l.trim() && !l.startsWith('#')).length;
  let mode = 'any';
  if (lines === 0) mode = 'any';
  else if (/203\.0\.113\.113\/32/.test(raw) || lines === 1) mode = 'none';
  else mode = 'loaded';
  let updated = null;
  try { updated = fs.statSync(file).mtime.toISOString(); } catch (_) {}
  return { mode, lines, updated, hasBackup: fs.existsSync(backup) };
}

function applyIpsetMode(d = dir(), mode = 'loaded', { silent = false } = {}) {
  const file = path.join(lists(d), 'ipset-all.txt');
  const backup = file + '.backup';
  try {
    ensureDir(path.dirname(file));
    if (mode === 'none') {
      if (fs.existsSync(file) && fs.statSync(file).size > 0 && ipsetState(d).lines > 1) {
        try { fs.copyFileSync(file, backup); } catch (_) {}
      }
      fs.writeFileSync(file, '203.0.113.113/32\n', 'utf8');
    } else if (mode === 'any') {
      if (fs.existsSync(file) && ipsetState(d).lines > 1) {
        try { fs.copyFileSync(file, backup); } catch (_) {}
      }
      fs.writeFileSync(file, '', 'utf8');
    } else { // loaded
      if (fs.existsSync(backup)) {
        try { fs.copyFileSync(backup, file); } catch (_) {}
      }
    }
    if (!silent) log.info('ZAPRET', `Режим IPset: ${mode}`);
    return true;
  } catch (e) {
    log.error('ZAPRET', `IPset: ${e.message}`);
    return false;
  }
}

async function updateIpset() {
  const file = path.join(lists(dir()), 'ipset-all.txt');
  log.info('ZAPRET', 'Обновляю список IPset…');
  const buf = await httpGet(IPSetUrl(), { timeout: 60000 });
  const text = buf.toString('utf8');
  if (text.length < 1000) throw new Error('Список выглядит неполным');
  ensureDir(path.dirname(file));
  if (fs.existsSync(file)) { try { fs.copyFileSync(file, file + '.backup'); } catch (_) {} }
  fs.writeFileSync(file, text, 'utf8');
  const st = ipsetState();
  log.ok('ZAPRET', `IPset обновлён: ${st.lines} записей`);
  return st;
}
function IPSetUrl() { return IPSET_URL; }

async function updateHosts({ apply = false } = {}) {
  log.info('ZAPRET', 'Проверяю hosts-файл zapret…');
  const buf = await httpGet(HOSTS_URL, { timeout: 30000 });
  const content = buf.toString('utf8');
  const tmp = path.join(paths().downloads, 'hosts-zapret.txt');
  ensureDir(path.dirname(tmp));
  fs.writeFileSync(tmp, content, 'utf8');
  const hostsFile = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'drivers', 'etc', 'hosts');
  let current = '';
  try { current = fs.readFileSync(hostsFile, 'utf8'); } catch (_) {}
  const lines = content.split(/\r?\n/).filter(Boolean);
  const first = lines[0] || '', last = lines[lines.length - 1] || '';
  const upToDate = current.includes(first) && current.includes(last);

  if (!upToDate && apply) {
    const nl = '`r`n';
    const ps = '$src=' + psQuote(tmp) + '; $dst=' + psQuote(hostsFile) +
      '; Copy-Item -LiteralPath $dst -Destination "$dst.bak" -Force -ErrorAction SilentlyContinue;' +
      ' $c=Get-Content -LiteralPath $src -Raw; Add-Content -LiteralPath $dst -Value ("' + nl + '" + $c) -Encoding UTF8';
    const r = await runElevated('powershell', `-NoProfile -ExecutionPolicy Bypass -Command "${ps.replace(/"/g, '\\"')}"`);
    log.info('ZAPRET', 'Запрошены права администратора для записи hosts');
    return { ok: r.ok, upToDate: false, applied: r.ok, file: tmp, hostsFile };
  }
  if (upToDate) log.ok('ZAPRET', 'hosts в порядке');
  else log.warn('ZAPRET', 'hosts требует обновления');
  return { ok: true, upToDate, applied: false, file: tmp, hostsFile, preview: content.slice(0, 4000) };
}

/* ---------------- списки ---------------- */
function readList(kind) {
  const name = LIST_FILES[kind] || LIST_FILES.user;
  const p = path.join(lists(dir()), name);
  try { return fs.readFileSync(p, 'utf8'); } catch (_) { return ''; }
}

function writeList(kind, text) {
  const name = LIST_FILES[kind] || LIST_FILES.user;
  const p = path.join(lists(dir()), name);
  ensureDir(path.dirname(p));
  fs.writeFileSync(p, String(text || '').replace(/\r?\n/g, '\r\n'), 'utf8');
  const cfg = config.get();
  if (kind in cfg.zapret.lists) { cfg.zapret.lists[kind] = text; config.save(); }
  log.info('ZAPRET', `Список ${name} сохранён (${String(text || '').split(/\r?\n/).filter(l => l.trim() && !l.trim().startsWith('#')).length} записей)`);
  return { ok: true, name };
}

/* переносит сохранённые в настройках списки в файлы (после установки) */
function syncUserLists() {
  const L = config.get().zapret.lists || {};
  for (const kind of ['user', 'exclude', 'ipExclude']) {
    const text = L[kind];
    if (!text || text.trim().startsWith('#') && text.trim().split(/\r?\n/).length <= 1) continue;
    try { writeList(kind, text); } catch (_) {}
  }
}

function listInfo() {
  const out = {};
  for (const kind of Object.keys(LIST_FILES)) {
    const raw = readList(kind);
    out[kind] = {
      entries: raw.split(/\r?\n/).filter(l => l.trim() && !l.trim().startsWith('#')).length,
      bytes: Buffer.byteLength(raw || '')
    };
  }
  return out;
}

/* ---------------- процессы ---------------- */
async function winwsPids() {
  const list = await findProcessByName(WINWS);
  return list.map(x => x.pid);
}

function stopQuiet() {
  if (!IS_WIN) return;
  try { spawn('taskkill', ['/F', '/IM', WINWS], { windowsHide: true, detached: true }).on('error', () => {}).unref(); } catch (_) {}
}


/* ---------- запуск winws.exe напрямую (видим причину падения) ---------- */
let lastRun = null;   // { code, output, at, strategy }

const ERR_MAP = [
  [/windivert.*(не найден|not found|failed to open|error opening)/i, 'WinDivert не загрузился: драйвер недоступен или занят другой программой.'],
  [/access is denied|отказано в доступе|requires? administrat/i, 'Отказано в доступе — нужны права администратора.'],
  [/the system cannot find the file/i, 'Не найден файл из командной строки стратегии (bin\*.bin) — переустановите Zapret.'],
  [/number of filters/i, 'Слишком много фильтров: другая копия Zapret уже работает.'],
  [/already running|уже запущен/i, 'winws.exe уже запущен.'],
  [/wrong parameter|unknown option|invalid argument|неверный параметр/i, 'Стратегия содержит недопустимый параметр для этой версии winws.exe.'],
  [/error opening filter|filter.*error/i, 'Не удалось установить фильтр WinDivert (конфликт с другим обходом).'],
  [/0x[0-9a-f]{8}/i, 'winws.exe вернул системную ошибку.']
];

/* Расшифровка кодов выхода winws.exe (их же использует драйвер-подсказка) */
const EXIT_CODES = {
  123: 'Ошибка 123 — в системе осталась служба WinDivert с неверным путём. Нажмите «Убрать службу и перезапустить»: служба будет удалена, драйвер загрузит сам winws.exe.',
  1275: 'Драйвер заблокирован политикой Windows (1275): блокировка уязвимых драйверов. Удалите службу WinDivert и запустите стратегию заново.',
  577: 'Цифровая подпись драйвера не принята системой (577). Обновите Windows или переустановите Zapret.',
  2: 'Файл драйвера или .bin не найден (ошибка 2) — переустановите Zapret.',
  5: 'Отказано в доступе (5) — запустите программу от имени администратора.',
  3221225477: 'winws.exe аварийно завершился (нарушение доступа) — чаще всего кривой драйвер или несовместимая стратегия.'
};

function explainExit(code) {
  return EXIT_CODES[Number(code)] || null;
}

function explainOutput(text) {
  const t = String(text || '');
  for (const [re, msg] of ERR_MAP) if (re.test(t)) return msg;
  return null;
}

function driverMissingHint(state) {
  if (state === 'not-installed') return 'Службы драйвера нет — это нормально: драйвер загружает сам winws.exe из папки Zapret. Если запуск всё равно не удался, проверьте файлы Zapret в «Обновлениях».';
  if (state === 'STOPPED') return 'В системе осталась служба WinDivert, которая не запускается — нажмите «Убрать службу и перезапустить» на вкладке «Драйвер».';
  return null;
}

/* Запускает winws.exe с аргументами из стратегии и ждёт появления процесса.
   Возвращает { ok, pids, code, output, hint } */
async function spawnWinws(file, { wait = 9000 } = {}) {
  const args = parseBatArgs(file, dir());
  const exe = path.join(dir(), 'bin', 'winws.exe');
  const argv = Array.isArray(args) ? args : tokenizeArgs(args);
  log.tech('ZAPRET', `команда: "${exe}" ${argv.join(' ')}`);
  if (!fs.existsSync(exe)) {
    const msg = `Файл ${exe} не найден — компоненты Zapret распакованы не полностью. Переустановите Zapret в разделе «Обновления».`;
    log.error('ZAPRET', msg);
    lastRun = { code: null, output: msg, strategy: file, pids: [], at: Date.now() };
    return { ok: false, pids: [], code: null, output: msg };
  }
  log.tech('ZAPRET', `аргументов: ${argv.length}, первый: ${argv[0]}`);
  if (!argv.length || !argv[0].startsWith('--') || argv.some(a => a.includes('"'))) {
    const msg = 'Аргументы стратегии разобраны неправильно (первый: ' + JSON.stringify(argv[0]) + ')';
    log.error('ZAPRET', msg);
    lastRun = { code: null, output: msg, strategy: file, pids: [], at: Date.now() };
    return { ok: false, pids: [], code: null, output: msg };
  }
  const child = spawn(exe, argv, {
    cwd: dir(), windowsHide: true, detached: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let out = '';
  const onData = d => { out += String(d); if (out.length > 8000) out = out.slice(-8000); };
  child.stdout && child.stdout.on('data', onData);
  child.stderr && child.stderr.on('data', onData);
  let exitCode = null;
  child.on('exit', c => { exitCode = c; });
  child.on('error', e => { out += '\nspawn error: ' + e.message; });
  child.unref();

  const deadline = Date.now() + wait;
  let pids = [];
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 350));
    pids = await winwsPids();
    if (pids.length) break;
    if (exitCode !== null) break;   // процесс уже упал — ждать нечего
  }
  if (out.trim()) log.tech('ZAPRET', 'вывод winws.exe: ' + out.trim().slice(0, 1500));
  if (!pids.length && exitCode !== null) log.tech('ZAPRET', `winws.exe завершился с кодом ${exitCode}`);

  lastRun = { code: exitCode, output: out.trim(), strategy: file, pids, at: Date.now() };
  return { ok: pids.length > 0, pids, code: exitCode, output: out.trim() };
}

/* ---------- режим без драйвера: служба через service.bat (как оригинальный Zapret) ---------- */
/* winws.exe требует драйвер WinDivert, и если Windows его блокирует (ошибка 123/1275/577),
   остаётся единственный поддерживаемый обходной путь — установить сам Zapret как службу
   через его же service.bat, который сам управляет драйвером. */

function driverBlockedReason(info) {
  if (!info) return null;
  const s = String(info.service || '');
  if (s === 'not-installed') return 'Служба драйвера WinDivert не создана.';
  if (s === 'STOPPED') return 'Служба WinDivert установлена, но не запускается — Windows может блокировать драйвер.';
  return null;
}

/* Режим «без ручного драйвера»: Zapret ставится штатной службой Windows.
   Служба запускает winws.exe от SYSTEM, и тот сам создаёт/загружает драйвер WinDivert —
   ровно так же, как это делает оригинальный Zapret через service.bat install.
   Мы не вызываем service.bat (он открывает консольные окна и требует ввода),
   а повторяем его действия: sc create с путём к winws.exe и полной строкой аргументов. */
async function startAsService(file) {
  if (!IS_WIN) return { ok: false, error: 'Только для Windows' };
  if (!(await isAdmin())) {
    const e = new Error('Для установки службы нужны права администратора');
    e.code = 'ELEVATION_REQUIRED';
    throw e;
  }
  const d = dir();
  const bat = file || config.get().zapret.strategy || 'general.bat';
  if (!fs.existsSync(batPath(bat))) return { ok: false, error: `Стратегия ${bat} не найдена` };
  const bin = path.join(d, 'bin', WINWS);
  if (!fs.existsSync(bin)) return { ok: false, error: 'winws.exe не найден — переустановите Zapret' };

  const args = [].concat(parseBatArgs(bat, d)).join(' ');
  log.info('ZAPRET', `Режим службы Windows: создаю службу zapret (стратегия ${bat})`);

  await killByName(WINWS).catch(() => {});
  await sc(['stop', 'zapret'], 25000);
  await sc(['delete', 'zapret'], 20000);
  await new Promise(r => setTimeout(r, 700));

  const create = await exec('sc.exe', ['create', 'zapret', 'binPath=', `"${bin}" ${args}`, 'DisplayName=', 'zapret', 'start=', 'auto'], { timeout: 30000 });
  const createOut = String(create.stdout || '') + String(create.stderr || '');
  if (!create.ok && !/уже существует|already exists/i.test(createOut)) {
    log.error('ZAPRET', 'sc create zapret: ' + createOut.slice(0, 300));
    return { ok: false, code: 'SERVICE_FAILED', error: 'Не удалось создать службу: ' + createOut.trim().slice(0, 300) };
  }
  await exec('sc.exe', ['description', 'zapret', 'Zapret DPI bypass software'], { timeout: 15000 });

  const st = await sc(['start', 'zapret'], 45000);
  const stOut = String(st.stdout || '') + String(st.stderr || '');
  const state = await serviceState('zapret');
  if (state !== 'RUNNING') {
    const code = (stOut.match(/(\d{2,4})/) || [])[1];
    const hint = code ? driverErrorHint(code) : explainOutput(stOut);
    log.error('ZAPRET', `Служба zapret не запустилась (${state}): ${stOut.trim().slice(0, 200)}`);
    return {
      ok: false,
      code: 'SERVICE_FAILED',
      state,
      error: hint || `Служба zapret не запустилась (${state}). ${stOut.trim().slice(0, 200)}`
    };
  }

  startedAt = Date.now();
  config.patch({ zapret: { serviceStrategy: bat } });
  log.ok('ZAPRET', `Zapret работает как служба Windows (стратегия ${bat}) — драйвер загружен самой службой`);
  return { ok: true, asService: true, state };
}

function escapeRe(str) { return String(str || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/* Кэш «тяжёлых» полей статуса: ipset, размеры списков, версия exe.
   Считается не чаще раза в 60 с (или принудительно). */
let heavyCache = null;
function heavyStats(d = dir(), { force = false } = {}) {
  if (!force && heavyCache && Date.now() - heavyCache.at < 60 * 1000) return heavyCache;
  let ipset = null, lists = null, exeVer = null;
  try { ipset = ipsetState(d); } catch (_) {}
  try { lists = listInfo(); } catch (_) {}
  if (force || !heavyCache) { try { exeVer = exeVersion(); } catch (_) {} }
  else exeVer = heavyCache.exeVersion;
  heavyCache = { at: Date.now(), ipset, lists, exeVersion: exeVer };
  return heavyCache;
}
function invalidateHeavy() { heavyCache = null; }

/* Версия установленного Zapret по версии самого winws.exe (в журнале он печатает
   «github version v72.9»). Нужна, когда релиз не содержит version.txt. */
function exeVersion() {
  try {
    const exe = path.join(dir(), 'bin', WINWS);
    if (!fs.existsSync(exe)) return null;
    const { execFileSync } = require('child_process');
    const out = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command',
      `(Get-Item -LiteralPath ${psQuote(exe)}).VersionInfo.FileVersion`],
      { encoding: 'utf8', timeout: 8000, windowsHide: true });
    const v = String(out || '').trim();
    return v || null;
  } catch (_) { return null; }
}

/* Информация о службе драйвера: состояние и путь, откуда Windows её грузит. */
async function driverServiceInfo() {
  const state = await serviceState('WinDivert');
  let imagePath = '';
  if (state !== 'not-installed') {
    try {
      const r = await exec('reg', ['query', 'HKLM\\SYSTEM\\CurrentControlSet\\Services\\WinDivert', '/v', 'ImagePath'], { timeout: 8000 });
      const m = (r.stdout || '').match(/ImagePath\s+REG_\w+\s+(.+)/i);
      if (m) imagePath = m[1].trim();
    } catch (_) {}
  }
  return { state, imagePath };
}

/* Кривая (чужая) служба WinDivert — главная причина ошибки 123 и «неправильного
   синтаксиса имени файла»: Windows пытается грузить .sys по неверному пути.
   Правильное поведение: убрать службу и дать winws.exe поднять драйвер самому. */
async function removeConflictingDriver({ quiet = false } = {}) {
  if (!IS_WIN) return { ok: false, error: 'только Windows' };
  const info = await driverServiceInfo();
  const removed = [];
  if (info.state !== 'not-installed') {
    await sc(['stop', 'WinDivert'], 20000);
    await new Promise(r => setTimeout(r, 600));
    await sc(['delete', 'WinDivert'], 20000);
    removed.push('WinDivert');
  }
  await sc(['stop', 'WinDivert14'], 15000);
  await sc(['delete', 'WinDivert14'], 15000);
  await new Promise(r => setTimeout(r, 600));
  const after = await serviceState('WinDivert');
  if (!quiet) {
    if (after === 'not-installed') log.ok('ZAPRET', 'Служба WinDivert удалена — драйвер загрузит сам winws.exe');
    else log.warn('ZAPRET', `Служба WinDivert всё ещё в системе (${after}) — возможно, драйвер занят другой программой`);
  }
  return { ok: after === 'not-installed', state: after, removed, before: info };
}

/* Проверка перед запуском: драйвер, конфликтующие обходы, службы */
async function preflight() {
  const problems = [];
  const info = {};
  info.driver = await serviceState('WinDivert');
  info.admin = await isAdmin();

  if (info.driver === 'not-installed') {
    problems.push('Служба драйвера WinDivert не создана (обычно это нормально — драйвер грузит сам winws.exe).');
  } else if (info.driver === 'STOPPED') {
    problems.push('Служба WinDivert установлена, но не запущена.');
  }

  const tasks = await tasklist();
  const conflicts = [
    ['goodbyedpi.exe', 'GoodbyeDPI'], ['happ.exe', 'Happ'], ['nekoray.exe', 'NekoRay'],
    ['v2ray.exe', 'v2ray'], ['xray.exe', 'Xray'], ['clash.exe', 'Clash'],
    ['clash-verge.exe', 'Clash Verge'], ['wireguard.exe', 'WireGuard'], ['zapret.exe', 'другой Zapret']
  ].filter(([exe]) => tasks.has(exe.toLowerCase())).map(([, n]) => n);
  info.conflicts = conflicts;
  if (conflicts.length) problems.push(`Одновременно работают: ${[...new Set(conflicts)].join(', ')} — они конфликтуют с WinDivert.`);

  // политика блокировки уязвимых драйверов (после обновлений Windows)
  try {
    const r = await exec('reg', ['query', 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\CI\\Config', '/v', 'VulnerableDriverBlocklistEnable'], { timeout: 8000 });
    if (/0x1/i.test(r.stdout)) info.blocklist = true;
  } catch (_) {}

  return { ...info, problems, ok: problems.length === 0 };
}

async function start({ force = false } = {}) {
  if (!IS_WIN) throw new Error('Zapret работает только в Windows');
  if (!valid()) throw new Error('Zapret не установлен');
  if (!(await isAdmin())) {
    const e = new Error('Нужны права администратора: winws.exe загружает драйвер WinDivert, без этого Windows выдаёт звук ошибки и обход не стартует.');
    e.code = 'ELEVATION_REQUIRED';
    throw e;
  }
  const cfg = config.get();
  const file = cfg.zapret.strategy || 'general.bat';
  if (!fs.existsSync(batPath(file))) throw new Error(`Стратегия ${file} не найдена`);

  const svcZapret = await serviceState('zapret');
  if (svcZapret === 'RUNNING') {
    log.info('ZAPRET', 'Zapret уже работает как служба Windows');
    startedAt = startedAt || Date.now();
    return { ok: true, asService: true, state: svcZapret, already: true };
  }

  // остатки прошлых запусков: второй winws.exe не сможет открыть драйвер
  const leftover = await winwsPids();
  if (leftover.length) log.info('ZAPRET', `Останавливаю прошлый winws.exe (PID ${leftover.join(', ')})`);
  await killByName(WINWS);
  await new Promise(r => setTimeout(r, 600));

  applyGameFilterFile(dir(), cfg.zapret.gameFilter);
  applyIpsetMode(dir(), cfg.zapret.ipsetMode, { silent: true });

  // Драйверу НЕ нужна служба, созданная заранее: winws.exe сам загружает
  // WinDivert64.sys из своей папки bin. Наоборот — мешает кривая старая служба
  // WinDivert с неверным путём (ошибка 123), поэтому её убираем.
  try {
    const drvPre = await driverServiceInfo();
    if (drvPre.state !== 'not-installed') {
      const ours = drvPre.imagePath && (
        /winws\.exe/i.test(drvPre.imagePath) ||
        // путь к WinDivert64.sys внутри папки Zapret — службу мог создать сам winws.exe
        /WinDivert(64|14)?\.sys/i.test(drvPre.imagePath) && new RegExp(escapeRe(dir()), 'i').test(drvPre.imagePath)
      );
      if (!ours) {
        log.info('ZAPRET', `Найдена служба WinDivert не от нашей программы (${drvPre.imagePath || 'путь неизвестен'}) — удаляю перед запуском`);
        await removeConflictingDriver({ quiet: true });
      } else {
        log.tech('ZAPRET', 'Служба WinDivert управляется winws.exe — оставляю как есть');
      }
    }
  } catch (e) { log.tech('ZAPRET', 'проверка службы драйвера: ' + e.message); }

  log.info('ZAPRET', `Запуск стратегии ${file}`);

  let run = await spawnWinws(file, { wait: 9000 });

  // Ошибка 123 / «не удалось открыть WinDivert» — почти всегда кривая служба драйвера
  // или занятый драйвер. Убираем службу и один раз пробуем снова.
  const driverTrouble = !run.ok && (Number(run.code) === 123 || /windivert/i.test(run.output || ''));
  if (driverTrouble) {
    log.info('ZAPRET', 'Драйвер не открылся — убираю службу WinDivert и повторяю запуск (драйвер загрузит сам winws.exe)');
    try {
      await removeConflictingDriver({ quiet: true });
      await killByName(WINWS);
      await new Promise(r => setTimeout(r, 900));
      run = await spawnWinws(file, { wait: 9000 });
      if (run.ok) log.ok('ZAPRET', 'Помогло: драйвер загружен самим winws.exe, служба не нужна');
    } catch (e) { log.warn('ZAPRET', 'Драйвер: ' + e.message); }
  }

  // Второй путь — только через сам winws.exe: запуск .bat стратегии не используем,
  // потому что внутри него `start "zapret" /min winws.exe` мелькает консольным окном.
  if (!run.ok) {
    log.tech('ZAPRET', 'повторная попытка прямого запуска после паузы');
    await new Promise(r => setTimeout(r, 1200));
    const again = await spawnWinws(file, { wait: 9000 });
    if (again.ok) {
      startedAt = Date.now();
      log.ok('ZAPRET', `winws.exe запущен со второй попытки (PID ${again.pids.join(', ')}), стратегия ${file}`);
      return { ok: true, pids: again.pids };
    }
    run = again;
  }

  if (!run.ok) {
    const drv = await serviceState('WinDivert');
    const hint = explainOutput(run.output) || driverMissingHint(drv) || explainExit(run.code);
    const human = hint ||
      (run.code !== null ? `winws.exe завершился с кодом ${run.code}` : 'winws.exe не появился за 9 секунд');
    log.error('ZAPRET', human);
    if (run.output) log.tech('ZAPRET', 'ответ winws.exe: ' + run.output.slice(0, 300));
    const drvInfo = { service: drv };
    const blocked = driverBlockedReason(drvInfo);
    if (blocked) log.warn('ZAPRET', 'Драйвер недоступен: ' + blocked + ' Можно попробовать режим службы (кнопка «Через службу Windows»).');
    return {
      ok: false,
      code: /администрат|access is denied/i.test(human) ? 'ELEVATION_REQUIRED' : 'START_FAILED',
      exitCode: run.code,
      output: run.output.slice(0, 1200),
      driver: drv,
      offerService: !!blocked,
      error: human
    };
  }
  const pids = run.pids;
  startedAt = Date.now();
  log.ok('ZAPRET', `winws.exe запущен (PID ${pids.join(', ')}), стратегия ${file}`);
  return { ok: true, pids };
}

/* последний запуск: код выхода и вывод winws.exe (для журнала/диагностики) */
function lastRunInfo() { return lastRun; }

async function waitForPids(ms = 12000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const pids = await winwsPids();
    if (pids.length) return pids;
    await new Promise(r => setTimeout(r, 400));
  }
  return [];
}

async function stop({ silent } = {}) {
  if (!IS_WIN) return { ok: true };
  const had = (await winwsPids()).length > 0;
  await killByName(WINWS);
  startedAt = null;
  if (!silent) log.info('ZAPRET', had ? 'winws.exe остановлен' : 'winws.exe не был запущен');
  return { ok: true, stopped: had };
}

async function restart() {
  await stop({ silent: true });
  await new Promise(r => setTimeout(r, 700));
  return start();
}


/* Разбивает строку аргументов на массив так, как это делает cmd.exe:
   кавычки группируют, но сами в аргумент не попадают. */
function tokenizeArgs(str) {
  const out = [];
  let cur = '';
  let q = false;
  let has = false;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (ch === '"') { q = !q; has = true; continue; }
    if (!q && /\s/.test(ch)) {
      if (has || cur) { out.push(cur); cur = ''; has = false; }
      continue;
    }
    cur += ch;
    has = true;
  }
  if (has || cur) out.push(cur);
  return out.filter(a => a.length);
}

/* Убирает из аргументов мусор, который попал туда из текста .bat (строки вызовов
   service.bat, set/setlocal, cd, echo и т.п.). Возвращает массив аргументов winws.exe. */
function cleanArgs(argv) {
  const junk = /^(call|set|setlocal|endlocal|cd|start|echo|rem|::|chcp|title|pause|goto|if|for|exit|@echo|del|copy|type|net\b)/i;
  const out = [];
  for (const raw of argv) {
    const a = String(raw).trim().replace(/^["']|["']$/g, '');
    if (!a) continue;
    if (junk.test(a)) break;                       // дальше пошёл код .bat — обрезаем
    if (a.startsWith('--')) { out.push(a); continue; }
    // одиночный ^ или слово без дефисов после первого аргумента — тоже мусор
    if (!out.length) continue;                     // до первого -- ничего не нужно
    if (a === '^' || /[\\/](winws|service)\.bat/i.test(a)) break;
    if (!/[=,\d]/.test(a) && !/^[A-Za-z0-9_.:\-]+$/.test(a)) break;
    const prev = out[out.length - 1];
    const expectsValue = !prev.includes('=') || /--(sni|host|altorder|dpi-desync-.*|filter-.*|wf-.*|ipset|hostlist)$/i.test(prev);
    if (expectsValue) out.push(a);
    else if (!a.startsWith('-')) break;
  }
  return out;
}

/* ---------------- служба Windows ---------------- */
function parseBatArgs(file, d = dir()) {
  const p = path.join(d, file);
  let txt = fs.readFileSync(p, 'utf8');
  // склеиваем строки продолжения (^ в конце)
  txt = txt.replace(/\^\r?\n/g, ' ');
  const idx = txt.indexOf('winws.exe');
  if (idx < 0) throw new Error('В файле нет вызова winws.exe');
  // отрезаем от «winws.exe» до конца команды; в .bat аргументы стоят в кавычках
  //   "%BIN%winws.exe" " --wf-tcp=... "
  // поэтому обрамляющие кавычки снимаем, иначе первый аргумент склеивается с ними
  // и winws.exe не видит портов → «must specify port or/and partial raw filter»
  const tail = txt.slice(idx + 'winws.exe'.length);
  const firstNl = tail.search(/\r?\n/);
  const firstLine = (firstNl < 0 ? tail : tail.slice(0, firstNl)).trim();
  // в большинстве стратегий аргументы начинаются на ТОЙ ЖЕ строке, что и winws.exe,
  // поэтому склеивать с остальными строками нельзя: в файле дальше идут вызовы
  // service.bat load_game_filter, set "BIN=..." и другие строки — они попадали в аргументы
  // и winws.exe падал с «invalid arguments» / ошибкой 123.
  const rest = firstLine;
  const gf = config.get().zapret.gameFilter;
  const gOn = gf.mode !== 'off';
  const gTcp = gOn && (gf.mode === 'tcp' || gf.mode === 'all') ? (gf.tcp || '1024-65535') : '12';
  const gUdp = gOn && (gf.mode === 'udp' || gf.mode === 'all') ? (gf.udp || '1024-65535') : '12';
  let args = rest
    .replace(/%BIN%/g, path.join(d, 'bin') + path.sep)
    .replace(/%LISTS%/g, path.join(d, 'lists') + path.sep)
    .replace(/%GameFilterTCP%/g, gTcp)
    .replace(/%GameFilterUDP%/g, gUdp)
    .replace(/%~dp0/g, d + path.sep)
    .trim();
  // снимаем обрамляющие кавычки: " --wf-tcp=... " -> --wf-tcp=...
  if (args.startsWith('"')) args = args.slice(1);
  if (args.endsWith('"')) args = args.slice(0, -1);
  args = args.trim();
  // снимаем экранирование cmd (в .bat встречается ^! для отключения delayed expansion)
  args = args.replace(/\^(.)/g, '$1').replace(/\^/g, '');
  return cleanArgs(tokenizeArgs(args));
}

async function installService() {
  if (!IS_WIN) throw new Error('Только Windows');
  if (!valid()) throw new Error('Zapret не установлен');
  const d = dir();
  const file = config.get().zapret.strategy;
  const args = [].concat(parseBatArgs(file, d)).join(' ');
  const bin = path.join(d, 'bin', WINWS);
  await stop({ silent: true });
  await exec('sc.exe', ['stop', 'zapret']);
  await exec('sc.exe', ['delete', 'zapret']);
  const create = await exec('sc.exe', ['create', 'zapret', 'binPath=', `"${bin}" ${args}`, 'DisplayName=', 'zapret', 'start=', 'auto'], { timeout: 30000 });
  if (!create.ok) {
    log.error('ZAPRET', 'Не удалось создать службу: ' + (create.stdout + create.stderr).trim());
    return { ok: false, error: 'Нужны права администратора (sc create). Запустите Yume Haze от имени администратора.' };
  }
  await exec('sc.exe', ['description', 'zapret', 'Zapret DPI bypass software']);
  const st = await exec('sc.exe', ['start', 'zapret'], { timeout: 30000 });
  log.ok('ZAPRET', `Служба zapret установлена (стратегия ${file})`);
  config.patch({ zapret: { serviceStrategy: file } });
  return { ok: st.ok, state: await serviceState('zapret') };
}

async function removeService() {
  if (!IS_WIN) throw new Error('Только Windows');
  await exec('sc.exe', ['stop', 'zapret'], { timeout: 30000 });
  await exec('sc.exe', ['delete', 'zapret']);
  await killByName(WINWS);
  await exec('sc.exe', ['stop', 'WinDivert']);
  await exec('sc.exe', ['delete', 'WinDivert']);
  await exec('sc.exe', ['delete', 'WinDivert14']);
  startedAt = null;
  log.info('ZAPRET', 'Служба zapret и WinDivert удалены');
  return { ok: true, state: await serviceState('zapret') };
}

/* ---------------- Discord ---------------- */
const DISCORD_DIRS = [
  ['Discord.exe', 'Discord', path.join(process.env.APPDATA || '', 'discord')],
  ['DiscordCanary.exe', 'Discord Canary', path.join(process.env.APPDATA || '', 'discordcanary')],
  ['DiscordPTB.exe', 'Discord PTB', path.join(process.env.APPDATA || '', 'discordptb')]
];

async function clearDiscordCache() {
  const report = [];
  for (const [exe, name, base] of DISCORD_DIRS) {
    if (!fs.existsSync(base)) continue;
    await exec('taskkill', ['/F', '/IM', exe]);
    for (const sub of ['Cache', 'Code Cache', 'GPUCache']) {
      const p = path.join(base, sub);
      if (fs.existsSync(p)) {
        try { fs.rmSync(p, { recursive: true, force: true }); report.push(`${name}: ${sub} удалён`); }
        catch (e) { report.push(`${name}: ${sub} — ошибка (${e.code || 'занято'})`); }
      }
    }
  }
  if (!report.length) report.push('Кэш Discord не найден или не требует очистки');
  for (const r of report) log.info('ZAPRET', r);
  return { ok: true, report };
}

/* ---------------- диагностика ---------------- */


/* ---------- драйвер WinDivert ----------
   Драйвер НЕ принадлежит приложению: WinDivert64.sys и WinDivert.dll приходят
   в архиве Zapret от Flowseal (bin\), а загружает его сам winws.exe.
   Приложение только проверяет состояние и, если мешает чужая/битая служба,
   может её удалить. Скачивание и обновления Zapret идут с GitHub. */
function driverFile(d = dir()) {
  return path.join(d, 'bin', 'WinDivert64.sys');
}

async function driverState(d = dir()) {
  const st = await serviceState('WinDivert');
  return st; // RUNNING | STOPPED | not-installed | unavailable
}

/* Проверка драйвера. Приложение НЕ устанавливает драйвер и не создаёт службу:
   файлы WinDivert лежат в архиве Zapret, а загрузку делает сам winws.exe.
   Здесь мы только: убираем мешающую чужую службу и проверяем, что winws.exe
   действительно поднимает драйвер. */
async function driverCheck() {
  if (!IS_WIN) return { ok: false, error: 'Только для Windows' };
  if (!(await isAdmin())) {
    const e = new Error('Для работы с драйвером нужны права администратора');
    e.code = 'ELEVATION_REQUIRED';
    throw e;
  }
  if (!valid()) {
    return { ok: false, error: 'Zapret не установлен — сначала скачайте его в разделе «Обновления»' };
  }
  const sys = driverFile();
  if (!fs.existsSync(sys)) {
    return { ok: false, error: 'В папке Zapret нет bin\\WinDivert64.sys — переустановите Zapret в «Обновлениях»' };
  }

  // убираем мешающие службы: кривой WinDivert и старый WinDivert14
  const before = await driverServiceInfo();
  const cleaned = await removeConflictingDriver({ quiet: true });
  if (before.state !== 'not-installed') {
    log.info('ZAPRET', `Прежняя служба WinDivert (${before.imagePath || 'путь неизвестен'}) удалена`);
  }

  const test = await verifyDriverLoads();
  if (test.ok) {
    log.ok('ZAPRET', 'Драйвер WinDivert работает: winws.exe загрузил его сам, служба не требуется');
    log.info('ZAPRET', 'Теперь стратегию можно запускать кнопкой «Включить Zapret»');
    return { ok: true, state: await serviceState('WinDivert'), verified: true, cleaned: cleaned.removed };
  }

  const code = test.code;
  const hint = code ? driverErrorHint(code) : explainOutput(test.output || '');
  const msg = hint || test.output || 'winws.exe не смог загрузить драйвер WinDivert';
  log.warn('ZAPRET', 'Драйвер не загрузился: ' + String(msg).slice(0, 300));
  return {
    ok: false,
    state: await serviceState('WinDivert'),
    code: test.code,
    verified: false,
    warning: msg,
    error: msg
  };
}

/* Проверка загрузки драйвера: запускаем winws.exe с аргументами текущей стратегии
   и смотрим, живёт ли процесс. Если живёт — драйвер открылся (его создал сам winws.exe). */
async function verifyDriverLoads(file) {
  const exe = path.join(dir(), 'bin', 'winws.exe');
  if (!fs.existsSync(exe)) return { ok: false, output: 'winws.exe не найден — переустановите Zapret', code: null };
  const strat = file || config.get().zapret.strategy || 'general.bat';
  let argv;
  try {
    argv = [].concat(parseBatArgs(strat, dir()));
  } catch (e) {
    return { ok: false, code: null, output: e.message };
  }
  let out = '';
  let code = null;
  try {
    const child = spawn(exe, argv, { cwd: dir(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout && child.stdout.on('data', d => { out += String(d); });
    child.stderr && child.stderr.on('data', d => { out += String(d); });
    const done = new Promise(res => child.on('exit', c => res(c)));
    child.on('error', e => { out += '\n' + e.message; });
    code = await Promise.race([done, new Promise(r => setTimeout(() => r('timeout'), 4000))]);
    if (code === 'timeout') {
      // процесс живёт дольше 4 секунд → драйвер открылся, гасим пробник
      try { child.kill(); } catch (_) {}
      await new Promise(r => setTimeout(r, 400));
      await killByName(WINWS);
      return { ok: true, code: null, output: out.trim() };
    }
  } catch (e) {
    return { ok: false, code: null, output: e.message };
  }
  await killByName(WINWS);
  return { ok: code === 0, code, output: out.trim().slice(-800) };
}

async function removeDriver() {
  if (!IS_WIN) return { ok: false, error: 'Только для Windows' };
  if (!(await isAdmin())) {
    const e = new Error('Нужны права администратора');
    e.code = 'ELEVATION_REQUIRED';
    throw e;
  }
  await killByName(WINWS);
  const r = await removeConflictingDriver({ quiet: true });
  log.info('ZAPRET', r.ok ? 'Служба WinDivert удалена — драйвер загрузит сам winws.exe' : 'Службу WinDivert удалить не удалось (возможно, драйвер занят)');
  return { ok: r.ok, state: await serviceState('WinDivert') };
}

/* Расшифровка типовых ошибок загрузки драйвера */
function driverErrorHint(code) {
  const map = {
    '577': 'Цифровая подпись драйвера не принята системой (577). Отключите проверку подписи или обновите Zapret.',
    '1275': 'Драйвер заблокирован политикой (1275): после обновления Windows включён блок уязвимых драйверов — удалите службу WinDivert и запустите Zapret заново.',
    '1793': 'Ошибка подписи (1793): файл WinDivert64.sys повреждён — переустановите Zapret.',
    '1058': 'Служба отключена (1058): проверьте тип запуска драйвера WinDivert.',
    '1077': 'Служба не запускалась (1077) — попробуйте перезагрузить систему.',
    '183': 'Служба с таким именем уже существует (183) — она будет переиспользована.',
    '1060': 'Служба не установлена (1060) — установите драйвер кнопкой.',
    '123': 'Ошибка 123 — в системе осталась служба WinDivert с неверным путём. Нажмите «Убрать службу и перезапустить»: служба будет удалена, драйвер загрузит сам winws.exe.',
    '2': 'Файл драйвера не найден (ошибка 2) — переустановите Zapret.'
  };
  return map[String(code).replace(/^0+/, '')] || null;
}

/* Диагностика драйвера: файлы, подпись, служба, проблемы */
async function driverDiagnostics() {
  const d = dir();
  const sys = driverFile(d);
  const dll = path.join(d, 'bin', 'WinDivert.dll');
  const existsSys = fs.existsSync(sys);
  const existsDll = fs.existsSync(dll);
  const state = await serviceState('WinDivert');
  const pids = await winwsPids();
  const sig = existsSys && IS_WIN ? await checkSignature(sys) : null;
  return {
    dir: d,
    source: 'zapret',          // файлы драйвера приходят в архиве Zapret от Flowseal
    sys: { path: sys, exists: existsSys, size: existsSys ? fs.statSync(sys).size : 0, version: existsSys ? fileVersion(sys) : null },
    dll: { path: dll, exists: existsDll },
    service: state,
    running: pids.length > 0,
    signature: sig,
    ok: existsSys && existsDll,
    hint: existsSys && existsDll ? null : 'Файлы драйвера приходят в архиве Zapret — переустановите его в «Обновлениях».'
  };
}

/* Версия файла.
   Раньше здесь был execFileSync с PowerShell: на каждом обновлении состояния
   главный процесс вставал на 1–3 секунды — отсюда «Не отвечает».
   Теперь: мгновенный разбор PE-ресурса версии + кэш. */
const _verCache = new Map();
function fileVersion(file) {
  const key = String(file);
  const hit = _verCache.get(key);
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.value;
  let value = null;
  try {
    const buf = fs.readFileSync(file);
    // ищем VS_FIXEDFILEINFO в ресурсе версии: сигнатура 0xFEEF04BD
    const sig = Buffer.from([0xbd, 0x04, 0xef, 0xfe]);
    const at = buf.indexOf(sig);
    if (at > 0 && at + 16 < buf.length) {
      const ms = buf.readUInt32LE(at + 8);
      const ls = buf.readUInt32LE(at + 12);
      value = `${(ms >>> 16) & 0xffff}.${ms & 0xffff}.${(ls >>> 16) & 0xffff}.${ls & 0xffff}`;
    }
  } catch (_) {}
  _verCache.set(key, { at: Date.now(), value });
  return value;
}

async function checkSignature(file) {
  const ps = `$s = Get-AuthenticodeSignature -LiteralPath '${file}'; "$($s.Status)|$($s.SignerCertificate.Subject)"`;
  const r = await exec('powershell', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', ps], { timeout: 20000 });
  const out = String(r.stdout || '').trim();
  const [status, subject] = out.split('|');
  return { status: status || 'Unknown', signer: (subject || '').trim() || null, valid: /^Valid$/i.test(status || '') };
}

async function diagnostics() {
  const items = [];
  const push = (title, status, detail, hint) => items.push({ title, status, detail, hint });

  const admin = await isAdmin();
  push('Права администратора', admin ? 'ok' : 'bad',
    admin ? 'Yume Haze запущен с повышенными правами' : 'Обычный режим',
    'Zapret (WinDivert) требует администратора. Перезапустите программу от имени администратора.');

  const d = dir();
  const ver = installedVersion(d);
  push('Zapret', valid(d) ? 'ok' : 'bad',
    valid(d) ? `Установлен ${ver} · ${d}` : 'Не найден bin\\winws.exe',
    'Откройте «Обновления» и установите Zapret 1.10.4.');

  const pids = await winwsPids();
  push('Процесс winws.exe', pids.length ? 'ok' : 'warn',
    pids.length ? `Работает (PID ${pids.join(', ')})` : 'Не запущен',
    'Нажмите «Включить» на странице Zapret.');

  const svc = await serviceState('zapret');
  push('Служба zapret', svc === 'RUNNING' ? 'warn' : 'ok',
    svc === 'RUNNING' ? 'Запущена как служба — ручные стратегии недоступны' : 'Не активна',
    'Если хотите менять стратегии вручную — удалите службу.');

  const wd = await serviceState('WinDivert');
  const sysOk = fs.existsSync(path.join(d, 'bin', 'WinDivert64.sys'));
  const dllOk = fs.existsSync(path.join(d, 'bin', 'WinDivert.dll'));
  const wdText = wd === 'RUNNING' ? 'Служба запущена'
    : wd === 'STOPPED' ? 'Служба установлена, но не запущена'
    : wd === 'not-installed' ? 'Служба не установлена — это нормально, драйвер загружает сам winws.exe'
    : `Состояние: ${wd}`;
  push('Драйвер WinDivert', wd === 'RUNNING' || pids.length ? 'ok' : (sysOk && dllOk ? 'warn' : 'bad'),
    `${wdText}${sysOk ? ' · WinDivert64.sys на месте' : ' · WinDivert64.sys отсутствует'}${dllOk ? '' : ' · WinDivert.dll отсутствует'}`,
    sysOk && wd === 'STOPPED'
      ? 'Осталась чужая/битая служба WinDivert — нажмите «Убрать службу и перезапустить» на вкладке «Драйвер».'
      : (sysOk ? 'Файлы драйвера на месте: включайте Zapret, winws.exe загрузит его сам.' : 'Переустановите Zapret — файлы драйвера входят в архив.'));

  // Конфликтующие программы
  const tasks = await tasklist();
  const conflicts = [
    ['goodbyedpi.exe', 'GoodbyeDPI'], ['GoodbyeDPI.exe', 'GoodbyeDPI'],
    ['happ.exe', 'Happ (VPN)'], ['nekoray.exe', 'NekoRay'], ['v2ray.exe', 'v2ray'],
    ['xray.exe', 'Xray'], ['clash.exe', 'Clash'], ['wireguard.exe', 'WireGuard'],
    ['proxy.exe', 'Другой прокси']
  ].filter(([exe]) => tasks.has(exe.toLowerCase())).map(([, n]) => n);
  push('Конфликты', conflicts.length ? 'warn' : 'ok',
    conflicts.length ? `Найдено: ${[...new Set(conflicts)].join(', ')}` : 'Конфликтующих программ не найдено',
    'Два обхода блокировок одновременно обычно ломают друг друга.');

  // Happ детект (новинка 1.10.4)
  if (tasks.has('happ.exe')) {
    push('Обнаружен Happ', 'warn', 'Happ может перехватывать трафик', 'Закройте Happ перед запуском Zapret.');
  }

  const ips = ipsetState(d);
  push('IPset', ips.mode === 'loaded' ? 'ok' : 'warn',
    `Режим ${ips.mode} · ${ips.lines} записей · обновлён ${ips.updated ? new Date(ips.updated).toLocaleDateString('ru-RU') : '—'}`,
    'Обновите список на странице Zapret → IPset.');

  const gf = readGameFilter(d);
  push('Игровой фильтр', gf.mode === 'off' ? 'ok' : 'ok', `Режим: ${gf.mode}`, '');

  // TCP timestamps
  const ts = await exec('netsh', ['interface', 'tcp', 'show', 'global']);
  push('TCP timestamps', /enabled/i.test(ts.stdout) ? 'ok' : 'warn',
    /enabled/i.test(ts.stdout) ? 'Включены' : 'Выключены',
    'Zapret включает их сам при запуске стратегии (netsh interface tcp set global timestamps=enabled).');

  // Занятость портов zapret
  if (pids.length) push('Стратегия', 'ok', config.get().zapret.strategy, '');

  return { items };
}

/* ---------------- статус ---------------- */
async function status() {
  const d = dir();
  const has = valid(d);
  const pids = has ? await winwsPids() : [];
  const svc = has ? await serviceState('zapret') : 'not-installed';
  // Тяжёлые метрики (ipset-all.txt ~33k строк, версия из PE-заголовка через PowerShell)
  // считаем не чаще раза в минуту: раньше они выполнялись на каждый тик состояния (раз в 4 с).
  const heavy = heavyStats(d);
  return {
    installed: has,
    dir: d,
    version: installedVersion(d),
    expectedVersion: releaseCache ? releaseCache.version : ZAPRET_VERSION,
    exeVersion: heavy.exeVersion,
    running: pids.length > 0,
    pids,
    startedAt: startedAt && pids.length ? startedAt : null,
    strategy: config.get().zapret.strategy,
    strategies: STRATEGIES,
    service: { installed: svc !== 'not-installed', state: svc },
    gameFilter: readGameFilter(d),
    ipset: heavy.ipset,
    lists: heavy.lists,
    checkUpdates: fs.existsSync(path.join(d, 'utils', 'check_updates.enabled'))
  };
}

async function setStrategy(file) {
  if (!STRATEGIES.some(s => s.file === file)) throw new Error('Неизвестная стратегия');
  config.patch({ zapret: { strategy: file } });
  log.info('ZAPRET', `Выбрана стратегия ${file}`);
  const wasRunning = (await winwsPids()).length > 0;
  if (wasRunning) { await restart(); return { ok: true, restarted: true }; }
  return { ok: true, restarted: false };
}

async function setGameFilter({ mode, tcp, udp }) {
  const v = validateRanges(tcp, udp);
  if (!v.tcp) throw new Error('Неверный диапазон TCP (пример: 1024-65535,1935)');
  if (!v.udp) throw new Error('Неверный диапазон UDP');
  config.patch({ zapret: { gameFilter: { mode, tcp, udp } } });
  applyGameFilterFile(dir(), { mode, tcp, udp });
  log.info('ZAPRET', `Игровой фильтр: ${mode} · TCP ${tcp} · UDP ${udp}`);
  const running = (await winwsPids()).length > 0;
  if (running) await restart();
  return { ok: true, restarted: running };
}

async function setIpsetMode(mode) {
  if (!['loaded', 'any', 'none'].includes(mode)) throw new Error('Неверный режим IPset');
  config.patch({ zapret: { ipsetMode: mode } });
  applyIpsetMode(dir(), mode);
  const running = (await winwsPids()).length > 0;
  if (running) await restart();
  return { ok: true, mode, restarted: running };
}

function toggleCheckUpdates(on) {
  const p = path.join(dir(), 'utils', 'check_updates.enabled');
  try {
    ensureDir(path.dirname(p));
    if (on) fs.writeFileSync(p, '', 'utf8');
    else if (fs.existsSync(p)) fs.unlinkSync(p);
  } catch (_) {}
  return { ok: true, on };
}

/* Поиск уже распакованного zapret (портативный режим / ручной путь) */
function detectExisting() {
  const cands = [];
  const cfg = config.get();
  const roots = [path.join(paths().userData, 'zapret'), path.dirname(process.execPath), process.cwd()];
  if (cfg.zapret.installDir) roots.unshift(cfg.zapret.installDir);
  for (const r of roots) {
    if (!fs.existsSync(r)) continue;
    for (const f of findFiles(r, n => n.toLowerCase() === 'winws.exe')) cands.push(path.dirname(path.dirname(f)));
  }
  return { found: [...new Set(cands)], current: dir(), valid: valid() };
}

module.exports = {
  WINWS, ZAPRET_VERSION, latestRelease, dir, valid, lists, batPath, installedVersion,
  releaseKnown: () => (releaseCache ? releaseCache.version : null), exeVersion,
  heavyStats, invalidateHeavy,
  install, start, stop, restart, status, setStrategy, setGameFilter, setIpsetMode,
  applyGameFilterFile, readGameFilter, ipsetState, applyIpsetMode, updateIpset, updateHosts,
  readList, writeList, listInfo, LIST_FILES, installService, removeService,
  clearDiscordCache, diagnostics, toggleCheckUpdates, detectExisting, validateRanges,
  parseBatArgs, syncUserLists, waitForPids, ensureUserLists, copyDir,
  driverState, driverCheck, removeDriver, driverDiagnostics, driverErrorHint, driverFile, checkSignature,
  spawnWinws, startAsService, removeConflictingDriver, driverServiceInfo, verifyDriverLoads, driverBlockedReason, preflight, explainOutput, explainExit, decodeConsole, driverMissingHint, lastRunInfo, tokenizeArgs
};
