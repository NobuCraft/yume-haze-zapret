'use strict';
/* TG WS Proxy (Flowseal tg-ws-proxy) — установка, запуск, статистика, ссылки */
const fs = require('fs');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');
const {
  IS_WIN, exec, getJson, downloadWithMirrors, findProcessByName, killByName,
  paths, ensureDir, tcpProbe, freePort, randomHex, humanBytes
} = require('./util');
const config = require('./config');
const log = require('./logger');

const RELEASE_API = 'https://api.github.com/repos/Flowseal/tg-ws-proxy/releases/latest';
const PINNED_VERSION = 'v1.11.4';
const ASSET = 'TgWsProxy_windows.exe';

const DC_INFO = [
  { dc: 1, host: '149.154.175.50', name: 'DC1' },
  { dc: 2, host: '149.154.167.51', name: 'DC2' },
  { dc: 3, host: '149.154.175.100', name: 'DC3' },
  { dc: 4, host: '149.154.167.91', name: 'DC4' },
  { dc: 5, host: '91.108.56.130', name: 'DC5' }
];

let child = null;
let startedAt = null;
let stats = emptyStats();
let stdoutBuf = '';
let versionCache = null;
const recent = [];   // последние строки лога tg

function emptyStats() {
  return { total: 0, active: 0, ws: 0, h2: 0, cf: 0, bad: 0, err: 0, poolHits: 0, poolTotal: 0, cfHits: 0, cfTotal: 0, up: 0, down: 0, ts: null };
}

function bin() { return config.tgBin(); }
function exeExists() { try { return fs.existsSync(bin()); } catch (_) { return false; } }
function dataDir() { return path.join(path.dirname(bin()), 'TgWsProxy_data'); }
function configFile() { return path.join(dataDir(), 'config.json'); }

/* ВАЖНО: TgWsProxy_windows.exe — это tray-приложение (PyInstaller, console=False).
   Параметры командной строки (--port/--secret/--dc-ip) оно НЕ разбирает: настройки
   читаются только из TgWsProxy_data/config.json, создаваемого при первом запуске.
   Раньше мы передавали флаги и прокси слушал дефолтный порт 1443 со СВОИМ секретом —
   ссылка Telegram не работала, статистика не приходила. Теперь мы пишем config.json сами. */
function trayConfig() {
  const t = config.get().tg;
  const secret = /^[0-9a-f]{32}$/i.test(t.secret || '') ? t.secret.toLowerCase() : null;
  return {
    port: Number(t.port),
    host: t.host,
    dc_ip: Array.isArray(t.dcIp) && t.dcIp.filter(Boolean).length
      ? t.dcIp.filter(Boolean)
      : ['2:149.154.167.220', '4:149.154.167.220'],
    verbose: !!t.verbose,
    check_updates: false,          // обновлениями занимается Yume Haze
    log_max_mb: 5,
    buf_kb: 256,
    pool_size: Number(t.poolSize) || 4,
    cfproxy: !!t.cfproxy,
    h2: !!t.h2,
    cfproxy_user_domain_enabled: !!t.cfproxyDomain,
    cfproxy_user_domain: t.cfproxyDomain ? [t.cfproxyDomain] : [],
    cfproxy_worker_enabled: false,
    cfproxy_worker_domain: [],
    force_test_dc: false,
    no_secure: !!t.noSecure,
    appearance: 'dark',
    language: 'ru',
    autostart: false,
    ...(secret ? { secret } : {})
  };
}

/* Записывает config.json в TgWsProxy_data. Если файла ещё нет и секрета нет —
   секрет остаётся дефолтным (генерирует сам прокси), и мы подхватываем его после запуска. */
function writeTrayConfig() {
  ensureDir(dataDir());
  const file = configFile();
  let existing = {};
  try { existing = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) {}
  const t = config.get().tg;
  const next = { ...existing, ...trayConfig() };
  if (!next.secret) delete next.secret;
  fs.writeFileSync(file + '.tmp', JSON.stringify(next, null, 2), 'utf8');
  fs.renameSync(file + '.tmp', file);
  return next;
}

/* Читает секрет из config.json — им пользуется и прокси, и наша ссылка. */
function readTraySecret() {
  try {
    const j = JSON.parse(fs.readFileSync(configFile(), 'utf8'));
    if (j && /^[0-9a-f]{32}$/i.test(j.secret || '')) return String(j.secret).toLowerCase();
  } catch (_) {}
  return null;
}

/* ---------------- установка ---------------- */
async function latestRelease() {
  if (versionCache && Date.now() - versionCache.at < 10 * 60 * 1000) return versionCache;
  const rel = await getJson(RELEASE_API, config.get().app.useMirror);
  const asset = (rel.assets || []).find(a => a.name === ASSET) ||
    (rel.assets || []).find(a => /windows\.exe$/i.test(a.name) && !/arm|7_/i.test(a.name));
  const info = {
    at: Date.now(),
    tag: rel.tag_name,
    name: rel.name,
    publishedAt: rel.published_at,
    notes: rel.body || '',
    asset: asset ? asset.name : ASSET,
    size: asset ? asset.size : null,
    url: asset ? asset.browser_download_url : `https://github.com/Flowseal/tg-ws-proxy/releases/download/${PINNED_VERSION}/${ASSET}`
  };
  versionCache = info;
  return info;
}

async function install({ onProgress } = {}) {
  if (!IS_WIN) throw new Error('TG WS Proxy работает только в Windows');
  let rel;
  try {
    rel = await latestRelease();
  } catch (e) {
    rel = { tag: PINNED_VERSION, url: `https://github.com/Flowseal/tg-ws-proxy/releases/download/${PINNED_VERSION}/${ASSET}` };
    log.warn('TG', 'GitHub API недоступен, использую закреплённую версию ' + PINNED_VERSION);
  }
  const dest = bin();
  if (onProgress) onProgress({ stage: 'download', pct: 10, text: `Загрузка ${rel.tag}` });
  log.info('TG', `Скачиваю TgWsProxy ${rel.tag}…`);
  await stop({ silent: true });
  const dl = await downloadWithMirrors(rel.url, dest, {
    useMirror: config.get().app.useMirror,
    onProgress: () => onProgress && onProgress({ stage: 'download', pct: 80, text: 'Сохраняю файл' })
  });
  ensureDir(path.dirname(dest));
  try { fs.chmodSync(dest, 0o755); } catch (_) {}
  // Портативный режим: конфиг и логи рядом с exe (config.json пишем свой, см. writeTrayConfig)
  ensureDir(dataDir());
  try { writeTrayConfig(); } catch (e) { log.warn('TG', 'config.json: ' + e.message); }
  fs.writeFileSync(path.join(dataDir(), 'version.txt'), rel.tag, 'utf8');
  log.ok('TG', `TG WS Proxy ${rel.tag} установлен (${humanBytes(dl.bytes)})`);
  if (onProgress) onProgress({ stage: 'done', pct: 100, text: `Установлено ${rel.tag}` });
  return { ok: true, version: rel.tag, path: dest };
}

function installedVersion() {
  try {
    const p = path.join(path.dirname(bin()), 'TgWsProxy_data', 'version.txt');
    if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8').trim();
  } catch (_) {}
  return null;
}

/* ---------------- аргументы ---------------- */
function buildArgs() {
  const t = config.get().tg;
  const a = ['--host', t.host, '--port', String(t.port), '--secret', t.secret,
    '--pool-size', String(t.poolSize), '--buf-kb', '256', '--portable'];
  if (!t.cfproxy) a.push('--no-cfproxy');
  if (!t.h2) a.push('--no-h2');
  if (t.noSecure) a.push('--no-secure');
  if (t.verbose) a.push('--verbose');
  if (t.fakeTlsDomain) a.push('--fake-tls-domain', t.fakeTlsDomain);
  if (t.cfproxyDomain) a.push('--cfproxy-domain', t.cfproxyDomain);
  for (const dc of (t.dcIp || [])) if (dc) a.push('--dc-ip', dc);
  return a;
}

/* ---------------- запуск ---------------- */
async function start() {
  if (!IS_WIN) throw new Error('TG WS Proxy работает только в Windows');
  if (!exeExists()) throw new Error('TG WS Proxy не установлен');
  const t = config.get().tg;
  if (!(await freePort(Number(t.port)))) {
    const ok = await isOurProxyRunning();
    if (ok) return { ok: true, already: true };
    throw new Error(`Порт ${t.port} занят другой программой`);
  }
  await killByName(path.basename(bin()));

  // 0) если секрета ещё нет — генерируем сами, чтобы ссылка была предсказуемой
  if (!/^[0-9a-f]{32}$/i.test(t.secret || '')) {
    config.patch({ tg: { secret: randomHex(16) } });
    log.info('TG', 'Сгенерирован секрет для нового профиля');
  }
  // 1) пишем config.json с нашими портом/секретом/DC
  let cfgWritten;
  try { cfgWritten = writeTrayConfig(); } catch (e) { throw new Error('Не удалось записать config.json: ' + e.message); }
  // 2) первый запуск показывал бы окно с инструкцией — помечаем, что он пройден
  try { fs.writeFileSync(path.join(dataDir(), '.first_run_done_mtproto'), ''); } catch (_) {}
  if (cfgWritten.secret && cfgWritten.secret !== t.secret) config.patch({ tg: { secret: cfgWritten.secret } });

  log.info('TG', `Запуск: TgWsProxy.exe (порт ${cfgWritten.port}, секрет ${String(cfgWritten.secret || '').slice(0, 6)}…, pool ${cfgWritten.pool_size})`);
  child = spawn(bin(), [], {
    cwd: path.dirname(bin()), windowsHide: true, detached: false,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', d => onOutput(d));
  child.stderr.on('data', d => onOutput(d));
  // логи прокси пишет в файл TgWsProxy_data/proxy.log — читаем его тоже
  startLogWatch();
  child.on('exit', (code, sig) => {
    log.info('TG', `Процесс завершился (код ${code}${sig ? ', ' + sig : ''})`);
    child = null; startedAt = null;
  });
  child.on('error', e => log.error('TG', `spawn: ${e.message}`));

  const listening = await waitPort(Number(t.port), 15000);
  if (!listening) {
    log.error('TG', 'Прокси не открыл порт ' + t.port);
    return { ok: false, error: 'Прокси не начал слушать порт. Проверьте журнал.' };
  }
  startedAt = Date.now();
  // прокси мог сам сгенерировать секрет при первом запуске — берём его, чтобы ссылка совпала
  setTimeout(() => {
    const sec = readTraySecret();
    if (sec && sec !== config.get().tg.secret) {
      config.patch({ tg: { secret: sec } });
      log.info('TG', 'Секрет синхронизирован с прокси: ' + sec.slice(0, 6) + '…');
    }
  }, 2500);
  log.ok('TG', `Прокси запущен на ${t.host}:${t.port}`);
  return { ok: true, link: link() };
}

let logWatch = null;      // fs.watch на proxy.log
let logReadPos = 0;       // позиция чтения файла

/* tray-сборка TgWsProxy пишет журнал в TgWsProxy_data/proxy.log, а не в stdout.
   Читаем файл и кормим тем же парсером, что и stdout. */
function logFile() { return path.join(dataDir(), 'proxy.log'); }

function startLogWatch() {
  stopLogWatch();
  const file = logFile();
  try {
    if (fs.existsSync(file)) logReadPos = fs.statSync(file).size;
    else logReadPos = 0;
  } catch (_) { logReadPos = 0; }
  readLogFile();
  try {
    logWatch = fs.watch(path.dirname(file), (ev, name) => {
      if (!name || String(name) === 'proxy.log') readLogFile();
    });
    logWatch.on('error', () => {});
  } catch (_) { logWatch = null; }
  // резервный опрос — fs.watch на Windows не всегда отдаёт события
  if (!logWatch) {
    logWatch = setInterval(readLogFile, 4000);
    logWatch.unref && logWatch.unref();
  }
}

function stopLogWatch() {
  if (!logWatch) return;
  try { logWatch.close ? logWatch.close() : clearInterval(logWatch); } catch (_) {}
  logWatch = null;
}

function readLogFile() {
  const file = logFile();
  let stat;
  try { stat = fs.statSync(file); } catch (_) { return; }
  if (stat.size < logReadPos) logReadPos = 0;     // файл ротировался
  if (stat.size === logReadPos) return;
  let buf;
  try {
    const fd = fs.openSync(file, 'r');
    const len = stat.size - logReadPos;
    buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, logReadPos);
    fs.closeSync(fd);
  } catch (_) { return; }
  logReadPos = stat.size;
  onOutput(buf);
}

function onOutput(buf) {
  stdoutBuf += buf.toString('utf8');
  const lines = stdoutBuf.split(/\r?\n/);
  stdoutBuf = lines.pop() || '';
  for (const line of lines) {
    const l = line.trim();
    if (!l) continue;
    recent.push({ ts: Date.now(), text: l });
    if (recent.length > 400) recent.shift();
    const m = l.match(/stats:\s*(.+)$/);
    if (m) { parseStats(m[1]); continue; }
    if (/Listening on|Secret:|Connect:|CF proxy|CF H2|Target DC|DC\d:|TLS|error|Error|ERROR|warn/i.test(l)) {
      log.log('TG', l.replace(/\s+/g, ' ').slice(0, 220), /error/i.test(l) ? 'error' : 'info');
    }
  }
}

function parseStats(s) {
  const kv = {};
  for (const part of s.split(/\s+/)) {
    const i = part.indexOf('=');
    if (i > 0) kv[part.slice(0, i)] = part.slice(i + 1);
  }
  const pool = (kv.pool || '').split('/');
  const cfPool = (kv.cf_pool || '').split('/');
  const parsed = {
    total: +kv.total || 0,
    active: +kv.active || 0,
    ws: +kv.ws || 0,
    h2: +kv.h2 || 0,
    cf: +kv.cf || 0,
    bad: +kv.bad || 0,
    err: +kv.err || 0,
    poolHits: +pool[0] || 0, poolTotal: +pool[1] || 0,
    cfHits: +cfPool[0] || 0, cfTotal: +cfPool[1] || 0,
    up: parseHuman(kv.up), down: parseHuman(kv.down),
    ts: Date.now()
  };
  stats = parsed;
  return parsed;
}

function parseHuman(v) {
  if (!v) return 0;
  const m = String(v).match(/([\d.]+)\s*([KMGT]?B?)/i);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  const mult = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3, '': 1 }[m[2].toUpperCase()] || 1;
  return Math.round(n * mult);
}

function waitPort(port, ms) {
  const t0 = Date.now();
  return new Promise(resolve => {
    const tick = async () => {
      if (await portOpen(port)) return resolve(true);
      if (Date.now() - t0 > ms) return resolve(false);
      setTimeout(tick, 350);
    };
    tick();
  });
}

function portOpen(port, host = '127.0.0.1') {
  return new Promise(resolve => {
    const s = new net.Socket();
    let done = false;
    const fin = v => { if (!done) { done = true; s.destroy(); resolve(v); } };
    s.setTimeout(700);
    s.once('connect', () => fin(true));
    s.once('timeout', () => fin(false));
    s.once('error', () => fin(false));
    try { s.connect(port, host); } catch (_) { fin(false); }
  });
}

async function isOurProxyRunning() {
  const pids = await findProcessByName(path.basename(bin()));
  return pids.length > 0;
}

async function stop({ silent } = {}) {
  if (child) {
    try { child.kill(); } catch (_) {}
    child = null;
  }
  await killByName(path.basename(bin()));
  stopLogWatch();
  startedAt = null;
  stats = emptyStats();
  if (!silent) log.info('TG', 'Прокси остановлен');
  return { ok: true };
}

async function restart() {
  await stop({ silent: true });
  await new Promise(r => setTimeout(r, 800));
  return start();
}

/* ---------------- ссылки / QR ---------------- */
function link({ ee = false } = {}) {
  const t = config.get().tg;
  const host = t.host === '0.0.0.0' || t.host === '::' ? '127.0.0.1' : t.host;
  // секрет берём из config.json, если он там есть: так ссылка совпадает с тем, что слушает прокси
  const secret = readTraySecret() || t.secret;
  const port = readTrayPort() || t.port;
  if (ee && t.fakeTlsDomain) {
    const domainHex = Buffer.from(t.fakeTlsDomain, 'ascii').toString('hex');
    return `tg://proxy?server=${host}&port=${port}&secret=ee${secret}${domainHex}`;
  }
  return `tg://proxy?server=${host}&port=${port}&secret=dd${secret}`;
}

function readTrayPort() {
  try {
    const j = JSON.parse(fs.readFileSync(configFile(), 'utf8'));
    const p = Number(j.port);
    if (Number.isInteger(p) && p > 0 && p < 65536) return p;
  } catch (_) {}
  return null;
}

function newSecret() {
  const s = randomHex(16);
  config.patch({ tg: { secret: s } });
  log.info('TG', 'Сгенерирован новый секрет');
  return { ok: true, secret: s, link: link() };
}

/* tray-сборка TgWsProxy не умеет fake TLS (ee-secret): в её apply_proxy_config такого ключа нет.
   Если пользователь ввёл домен, ссылка станет ee-формата, а прокси работает с dd-секретом. */
function fakeTlsSupported() { return false; }

function validateTg(patch) {
  const t = { ...config.get().tg, ...patch };
  if (!/^[0-9a-f]{32}$/i.test(t.secret)) return 'Секрет должен быть 32 hex-символа';
  const port = Number(t.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return 'Порт должен быть 1–65535';
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(t.host)) return 'Хост должен быть IPv4-адресом (например, 127.0.0.1)';
  const pool = Number(t.poolSize);
  if (!Number.isInteger(pool) || pool < 0 || pool > 16) return 'Размер пула: 0–16';
  return null;
}

async function saveSettings(patch) {
  const err = validateTg(patch);
  if (err) throw new Error(err);
  if (patch.fakeTlsDomain) {
    log.warn('TG', 'Fake TLS (ee-секрет) не поддерживается tray-сборкой TgWsProxy — используется обычный dd-секрет. Ссылка остаётся рабочей, маскировки под TLS не будет.');
  }
  const before = config.get().tg;
  const restartNeeded = ['host', 'port', 'poolSize', 'secret', 'cfproxy', 'h2', 'noSecure', 'fakeTlsDomain', 'cfproxyDomain', 'dcIp']
    .some(k => JSON.stringify(patch[k]) !== JSON.stringify(before[k]) && patch[k] !== undefined);
  config.patch({ tg: patch });
  const running = await isOurProxyRunning();
  if (running && restartNeeded) await restart();
  log.info('TG', 'Параметры прокси сохранены' + (running && restartNeeded ? ', прокси перезапущен' : ''));
  return { ok: true, restarted: running && restartNeeded, link: link() };
}

/* ---------------- сеть ---------------- */
async function pingDc() {
  const t = config.get().tg;
  const results = [];
  for (const dc of DC_INFO) {
    const p443 = await tcpProbe(dc.host, 443, 1500);
    results.push({ ...dc, ms: p443.ms, ok: p443.ok });
  }
  log.info('TG', 'Пинг дата-центров: ' + results.map(r => `DC${r.dc}${r.ok ? ' ' + r.ms + 'мс' : ' —'}`).join(', '));
  return { results, port: t.port };
}

async function dcStatus() {
  const t = config.get().tg;
  const mapped = (t.dcIp || []).map(x => {
    const [dc, ip] = String(x).split(':');
    return { dc: Number(dc), ip };
  });
  return { dc: DC_INFO.map(d => ({ ...d, mapped: (mapped.find(m => m.dc === d.dc) || {}).ip || null })) };
}

/* ---------------- статус ---------------- */
async function status() {
  const t = config.get().tg;
  const pids = exeExists() ? await findProcessByName(path.basename(bin())) : [];
  const alive = pids.length > 0;
  if (!alive && startedAt) startedAt = null;
  return {
    installed: exeExists(),
    path: bin(),
    version: installedVersion(),
    running: alive,
    pids: pids.map(p => p.pid),
    startedAt: alive ? startedAt : null,
    listening: alive ? await portOpen(Number(t.port)) : false,
    link: link(),
    linkEe: link({ ee: true }),
    settings: { ...t },
    stats,
    pool: `${Math.min(t.poolSize, 16)} / 16`,
    logFile: logFile(),
    recent: recent.slice(-30)
  };
}

async function diagnostics() {
  const items = [];
  const t = config.get().tg;
  const push = (title, status, detail, hint) => items.push({ title, status, detail, hint: hint || '' });
  push('TgWsProxy.exe', exeExists() ? 'ok' : 'bad', exeExists() ? bin() : 'Не найден', 'Установите компонент на странице «Обновления».');
  push('Секрет', /^[0-9a-f]{32}$/i.test(t.secret) ? 'ok' : 'bad', /^[0-9a-f]{32}$/i.test(t.secret) ? '32 hex-символа' : 'Неверный формат', 'Нажмите «Новый секрет».');
  const busy = await freePort(Number(t.port));
  push('Порт ' + t.port, busy ? 'ok' : 'warn', busy ? 'Свободен' : 'Занят — возможно, прокси уже запущен', 'Смените порт в параметрах прокси.');
  const ping = await tcpProbe('149.154.167.51', 443, 1500);
  push('Telegram DC2', ping.ok ? 'ok' : 'warn', ping.ok ? `Доступен, ${ping.ms} мс` : 'Недоступен напрямую', 'Включите Cloudflare-прокси или запустите Zapret.');
  const cf = await tcpProbe('1.1.1.1', 443, 1500);
  push('Cloudflare', cf.ok ? 'ok' : 'bad', cf.ok ? `Доступен, ${cf.ms} мс` : 'Недоступен', 'CF-прокси не будет работать без доступа к Cloudflare.');
  push('Мультиплексирование H2', t.h2 && t.cfproxy ? 'ok' : 'warn', t.h2 && t.cfproxy ? 'Включено' : 'Выключено', '');
  let cfgOk = false, cfgDetail = 'Не найден';
  try {
    const j = JSON.parse(fs.readFileSync(configFile(), 'utf8'));
    cfgOk = Number(j.port) === Number(t.port) && /^[0-9a-f]{32}$/i.test(j.secret || '');
    cfgDetail = cfgOk ? `порт ${j.port}, секрет совпадает`
      : `в файле порт ${j.port}, секрет ${j.secret ? 'есть' : 'нет'} — перезапустите прокси`;
  } catch (_) {}
  push('config.json', cfgOk ? 'ok' : 'warn', cfgDetail, 'Нажмите «Перезапустить» — файл будет создан заново из настроек.');
  return { items };
}

module.exports = {
  RELEASE_API, PINNED_VERSION, ASSET, DC_INFO,
  latestRelease, install, installedVersion, start, stop, restart, status, link, newSecret,
  saveSettings, validateTg, pingDc, dcStatus, diagnostics, buildArgs, portOpen, parseStats, exeExists,
  trayConfig, writeTrayConfig, readTraySecret, readTrayPort, configFile, dataDir, fakeTlsSupported
};
