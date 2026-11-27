'use strict';
/*
 * Linux-движок (CachyOS/Arch, Debian, Ubuntu, Fedora).
 *
 * Заменяет winws.exe + WinDivert:
 *   NFQUEUE (nftables) → hz-nfq (наш C-движок) → те же приёмы, что в стратегиях Flowseal.
 *
 * Стратегии берутся из релиза Flowseal: .bat разбирается, аргументы переводятся
 * в текстовый профиль движка. Списки доменов и .bin-паттерны идут из того же архива.
 *
 * Привилегии: правила nft и движок требуют root. Запускаем через pkexec/sudo,
 * в остальном приложение работает без прав администратора.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, execFile } = require('child_process');

const config = require('./config');
const log = require('./logger');
const util = require('./util');
const { unzip } = require('./unzip');

const ENGINE_SRC = path.join(__dirname, '..', 'linux', 'engine', 'hz-nfq');
const DATA_DIR = path.join(__dirname, '..', 'linux', 'data');
const QUEUE_NUM = 200;
const TABLE = 'hzq';

function baseDir() {
  const c = config.get();
  if (c.zapret.binPath) return c.zapret.binPath;
  if (c.zapret.installDir) return c.zapret.installDir;
  return path.join(util.paths().userData, 'zapret-linux');
}
function engineDir() { return path.join(util.paths().userData, 'engine'); }
function engineBin() { return path.join(engineDir(), 'hz-nfq'); }
function profileFile() { return path.join(engineDir(), 'profile.txt'); }
function engineLog() { return path.join(util.paths().userData, 'engine.log'); }
function listsDir() { return path.join(baseDir(), 'lists'); }
function binDir() { return path.join(baseDir(), 'bin'); }

/* ------------------------------------------------------------------ установка engine */
function valid() {
  try {
    const p = engineBin();
    return fs.existsSync(p) && fs.statSync(p).size > 10000;
  } catch (_) { return false; }
}

function installEngine() {
  util.ensureDir(engineDir());
  const dst = engineBin();
  if (!fs.existsSync(ENGINE_SRC)) throw new Error('В сборке нет движка hz-nfq (linux/engine/hz-nfq)');
  fs.copyFileSync(ENGINE_SRC, dst);
  fs.chmodSync(dst, 0o755);
  // системные библиотеки: проверяем, что движок запускается
  const r = util.execSyncSafe(dst, ['--selftest']);
  if (!r.ok) throw new Error('Движок не запускается: ' + (r.stderr || '').trim().split('\n').slice(-2).join(' '));
  log.ok('LINUX', 'Движок готов: ' + dst);
  return { ok: true, path: dst, selfTest: r.stdout.trim().split('\n') };
}

/* ------------------------------------------------------------------ стратегии из Flowseal */
const FLOW_RELEASE = 'https://api.github.com/repos/Flowseal/zapret-discord-youtube/releases/latest';
let relCache = null;

async function flowsealRelease({ force = false } = {}) {
  if (!force && relCache && Date.now() - relCache.at < 10 * 60 * 1000) return relCache;
  let rel = null;
  try {
    rel = await util.getJson(FLOW_RELEASE, config.get().app.useMirror);
  } catch (e) {
    log.warn('LINUX', 'GitHub API недоступен, использую закреплённую версию 1.10.4: ' + e.message);
  }
  const tag = rel && rel.tag_name ? String(rel.tag_name).replace(/^v/, '') : '1.10.4';
  const assets = (rel && rel.assets) || [];
  const zip = assets.find(a => /\.zip$/i.test(a.name));
  const info = {
    at: Date.now(),
    version: tag,
    zip: zip ? zip.browser_download_url
      : `https://github.com/Flowseal/zapret-discord-youtube/releases/download/${tag}/zapret-discord-youtube-${tag}.zip`,
    page: (rel && rel.html_url) || 'https://github.com/Flowseal/zapret-discord-youtube/releases',
    notes: (rel && rel.body) || ''
  };
  relCache = info;
  return info;
}

function installedVersion() {
  const marker = path.join(baseDir(), '.version');
  try {
    const v = fs.readFileSync(marker, 'utf8').trim();
    if (v) return v;
  } catch (_) {}
  // релиз Flowseal кладёт версию в service.bat (LOCAL_VERSION=1.10.4)
  try {
    const bat = fs.readFileSync(path.join(baseDir(), 'service.bat'), 'utf8');
    const m = bat.match(/LOCAL_VERSION=([\d.]+)/);
    if (m) return m[1];
  } catch (_) {}
  return null;
}

async function install({ onProgress } = {}) {
  const rel = await flowsealRelease({ force: true });
  const dst = baseDir();
  util.ensureDir(dst);
  const tmpZip = path.join(os.tmpdir(), `flowseal-${rel.version}.zip`);
  onProgress && onProgress({ stage: 'download', percent: 0, text: `Скачиваю Zapret ${rel.version}` });
  await util.downloadWithMirrors(rel.zip, tmpZip, p => onProgress && onProgress({ stage: 'download', ...p }));
  onProgress && onProgress({ stage: 'unpack', percent: 60, text: 'Распаковываю' });
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flowseal-'));
  await unzip(tmpZip, tmpDir);
  let root = tmpDir;
  const items = fs.readdirSync(tmpDir);
  if (items.length === 1 && fs.statSync(path.join(tmpDir, items[0])).isDirectory()) root = path.join(tmpDir, items[0]);
  // переносим содержимое
  util.rmrf(dst);
  util.ensureDir(dst);
  for (const it of fs.readdirSync(root, { withFileTypes: true })) {
    const s = path.join(root, it.name);
    const d = path.join(dst, it.name);
    if (it.isDirectory()) util.copyDirSync(s, d);
    else fs.copyFileSync(s, d);
  }
  util.rmrf(tmpDir);
  try { fs.unlinkSync(tmpZip); } catch (_) {}
  fs.writeFileSync(path.join(dst, '.version'), rel.version, 'utf8');
  log.ok('LINUX', `Zapret ${rel.version} установлен: ${dst}`);
  installEngine();
  return { ok: true, version: rel.version, dir: dst };
}

/* Имена .bat → старая страта «general.bat» (чтобы настройки переносились с Windows) */
function listStrategies() {
  const d = baseDir();
  if (!fs.existsSync(d)) return [];
  return fs.readdirSync(d)
    .filter(n => /\.bat$/i.test(n))
    .sort((a, b) => {
      const ai = /\(/.test(a) ? 1 : 0, bi = /\(/.test(b) ? 1 : 0;
      return ai - bi || a.localeCompare(b);
    });
}

function strategyExists(file) {
  return !!file && fs.existsSync(path.join(baseDir(), file));
}

/* ------------------------------------------------------------------ профиль для движка */
/*
 * Берём массив аргументов winws.exe (уже с подставленными путями) и режем его на группы
 * по «--new». Каждый ключ winws переводим в строку профиля.
 */
const PATTERN_KEYS = {
  '--dpi-desync-fake-quic': 'fake_quic',
  '--dpi-desync-fake-discord': 'fake_discord',
  '--dpi-desync-fake-stun': 'fake_stun',
  '--dpi-desync-fake-tls': 'fake_tls',
  '--dpi-desync-fake-http': 'fake_http',
  '--dpi-desync-fake-unknown-udp': 'fake_unknown_udp',
  '--dpi-desync-split-seqovl-pattern': 'split_pattern'
};

/* Повторяющиеся ключи (--hostlist встречается дважды) собираем в массив. */
function addKey(obj, key, value) {
  if (obj[key] === undefined) obj[key] = value;
  else if (Array.isArray(obj[key])) obj[key].push(value);
  else obj[key] = [obj[key], value];
}

function toProfile(groups) {
  const out = [`queue=${QUEUE_NUM}`, `log=${engineLog()}`, 'verbose=0'];
  const tcpAll = new Set(), udpAll = new Set();
  for (const g of groups) {
    const lines = ['group'];
    const one = v => Array.isArray(v) ? v[0] : v;
    // порты, которые нужно завести в nft, берём и из --wf-*, и из --filter-*
    if (g['--wf-tcp']) String(one(g['--wf-tcp'])).split(',').forEach(p => tcpAll.add(p));
    if (g['--wf-udp']) String(one(g['--wf-udp'])).split(',').forEach(p => udpAll.add(p));
    if (g['--filter-tcp']) { const v = one(g['--filter-tcp']); lines.push(`filter_tcp=${v}`); v.split(',').forEach(p => tcpAll.add(p)); }
    if (g['--filter-udp']) { const v = one(g['--filter-udp']); lines.push(`filter_udp=${v}`); v.split(',').forEach(p => udpAll.add(p)); }
    if (g['--filter-l7']) lines.push(`filter_l7=${one(g['--filter-l7'])}`);

    // списки: относительные имена → абсолютные пути в нашей установке
    const abs = v => String(v).split(',').map(s => {
      const t = s.trim();
      if (!t) return null;
      if (path.isAbsolute(t)) return t;
      if (/^lists[\\/]/i.test(t) || fs.existsSync(path.join(listsDir(), path.basename(t)))) return path.join(listsDir(), path.basename(t));
      if (/^bin[\\/]/i.test(t)) return path.join(binDir(), path.basename(t));
      return t;
    }).filter(Boolean).join(',');

    const asList = v => Array.isArray(v) ? v : [v];
    const list = (key, prop) => {
      if (!g[key]) return;
      const vals = asList(g[key]).map(v => abs(v)).filter(Boolean);
      if (vals.length) lines.push(`${prop}=${vals.join(',')}`);
    };
    list('--hostlist', 'hostlist');
    list('--hostlist-exclude', 'hostlist_exclude');
    list('--hostlist-domains', 'hostlist_domains');
    list('--ipset', 'ipset');
    list('--ipset-exclude', 'ipset_exclude');

    if (g['--dpi-desync']) {
      const d = String(one(g['--dpi-desync'])).replace(/,/g, ' ');
      lines.push(`desync=${d}`);
    }
    if (g['--dpi-desync-split-pos']) lines.push(`split_pos=${String(one(g['--dpi-desync-split-pos'])).replace(/[^0-9+-]/g, '') || 1}`);
    if (g['--dpi-desync-split-seqovl']) lines.push(`split_seqovl=${parseInt(one(g['--dpi-desync-split-seqovl']), 10) || 0}`);
    if (g['--dpi-desync-repeats']) lines.push(`repeats=${parseInt(one(g['--dpi-desync-repeats']), 10) || 1}`);
    if (g['--dpi-desync-any-protocol']) lines.push('any_protocol=1');
    if (g['--dpi-desync-cutoff']) lines.push(`cutoff=${parseInt(String(g['--dpi-desync-cutoff']).replace(/\D/g, ''), 10) || 0}`);
    if (g['--ip-id'] && /zero/i.test(String(one(g['--ip-id'])))) lines.push('ip_id_zero=1');
    for (const [key, prop] of Object.entries(PATTERN_KEYS)) {
      if (!g[key]) continue;
      const v = asList(g[key]).map(x => abs(x)).filter(Boolean)[0];
      if (v) lines.push(`${prop}=${v}`);
    }
    lines.push('end');
    out.push(lines.join('\n'));
  }
  return { text: out.join('\n') + '\n', tcpPorts: [...tcpAll], udpPorts: [...udpAll] };
}

function splitGroups(argv) {
  const groups = [];
  let cur = null;
  for (let i = 0; i < argv.length; i++) {
    const a = String(argv[i]);
    if (a === '--new') { cur = null; continue; }
    if (!a.startsWith('--')) continue;
    if (!cur) { cur = {}; groups.push(cur); }
    const eq = a.indexOf('=');
    if (eq > 0) {
      addKey(cur, a.slice(0, eq), a.slice(eq + 1));
    } else {
      const next = argv[i + 1];
      if (next && !String(next).startsWith('--')) { addKey(cur, a, String(next)); i++; }
      else addKey(cur, a, '1');
    }
  }
  return groups;
}

/* Профиль по выбранной стратегии. Возвращает { text, tcpPorts, udpPorts } */
function buildProfile(strategy) {
  const zapret = require('./zapret');
  const file = strategy || config.get().zapret.strategy || 'general.bat';
  if (!strategyExists(file)) throw new Error(`Стратегия «${file}» не найдена. Переустановите Zapret в «Обновлениях».`);
  const args = zapret.parseBatArgs(file, baseDir());
  const argv = Array.isArray(args) ? args : zapret.tokenizeArgs(args);
  const groups = splitGroups(argv);
  if (!groups.length) throw new Error('В стратегии нет фильтров winws');
  const prof = toProfile(groups);
  util.ensureDir(engineDir());
  fs.writeFileSync(profileFile(), prof.text, 'utf8');
  log.tech('LINUX', `профиль стратегии ${file}: групп ${groups.length}, порты tcp=${prof.tcpPorts.join(',')} udp=${prof.udpPorts.join(',')}`);
  return prof;
}

/* ------------------------------------------------------------------ привилегии */
function which(bin) {
  for (const d of (process.env.PATH || '').split(':')) {
    const p = path.join(d, bin);
    try { if (fs.existsSync(p)) return p; } catch (_) {}
  }
  return null;
}

let rootCmdCache = null;
function rootHelper() {
  if (process.getuid && process.getuid() === 0) return { cmd: 'direct' };
  if (rootCmdCache) return rootCmdCache;
  if (which('pkexec')) rootCmdCache = { cmd: 'pkexec' };
  else if (which('sudo')) rootCmdCache = { cmd: 'sudo' };
  return rootCmdCache;
}

/* Запуск команды с правами root без окна терминала */
function runRoot(argv, { timeout = 20000, input = null } = {}) {
  const h = rootHelper();
  if (!h) return Promise.resolve({ ok: false, stdout: '', stderr: 'нужен pkexec (polkit) или sudo' });
  if (h.cmd === 'direct') return util.exec(argv[0], argv.slice(1), { timeout });
  const pre = h.cmd === 'pkexec' ? [argv[0], ...argv.slice(1)] : ['-n', argv[0], ...argv.slice(1)];
  return util.exec(h.cmd, pre, { timeout, input });
}

/* ------------------------------------------------------------------ nft */
async function nftPresent() { return !!which('nft'); }

async function applyRules(tcpPorts, udpPorts) {
  await clearRules();
  const cmds = [
    ['add', 'table', 'inet', TABLE],
    ['add', 'chain', 'inet', TABLE, 'out', '{', 'type', 'filter', 'hook', 'output', 'priority', '-150;', 'policy', 'accept;', '}'],
    ['add', 'chain', 'inet', TABLE, 'pre', '{', 'type', 'filter', 'hook', 'prerouting', 'priority', '-150;', 'policy', 'accept;', '}']
  ];
  const ports = (arr) => {
    const set = new Set();
    for (const p of arr) {
      const m = String(p).trim().match(/^(\d+)(?:-(\d+))?$/);
      if (!m) continue;
      const lo = Number(m[1]), hi = Number(m[2] || m[1]);
      if (hi - lo > 500) { set.add(`${lo}-${Math.min(hi, lo + 500)}`); continue; }  // не раздуваем набор
      set.add(lo === hi ? String(lo) : `${lo}-${hi}`);
    }
    return [...set];
  };
  // исходящий трафик ловим в output, входящий (ответы) — в prerouting на всякий случай не трогаем
  for (const p of ports(tcpPorts)) {
    cmds.push(['add', 'rule', 'inet', TABLE, 'out', 'tcp', 'dport', p, 'queue', 'num', String(QUEUE_NUM), 'bypass']);
  }
  for (const p of ports(udpPorts)) {
    cmds.push(['add', 'rule', 'inet', TABLE, 'out', 'udp', 'dport', p, 'queue', 'num', String(QUEUE_NUM), 'bypass']);
  }
  for (const c of cmds) {
    const r = await runRoot(['nft', ...c]);
    if (!r.ok) {
      await clearRules();
      throw new Error(`nft ${c.slice(0, 3).join(' ')}: ${(r.stderr || r.stdout || '').trim().split('\n')[0]}`);
    }
  }
  log.info('LINUX', `правила nft готовы: tcp ${ports(tcpPorts).join(',')} · udp ${ports(udpPorts).join(',')}`);
}

async function clearRules() {
  // таблицы может не быть — это нормально
  await runRoot(['nft', 'delete', 'table', 'inet', TABLE], { timeout: 8000 });
}

/* ------------------------------------------------------------------ состояние движка */
let engineProc = null;
let engineStartedAt = null;

function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (_) { return false; }
}

function readPid() {
  try { return Number(fs.readFileSync(path.join(engineDir(), 'engine.pid'), 'utf8').trim()) || null; } catch (_) { return null; }
}

async function enginePids() {
  const r = await util.exec('pgrep', ['-f', 'hz-nfq --profile'], { timeout: 4000 }).catch(() => null);
  if (r && r.ok) return String(r.stdout || '').split('\n').map(Number).filter(Boolean);
  const pid = readPid();
  return pid && pidAlive(pid) ? [pid] : [];
}

async function rulesPresent() {
  if (!(await nftPresent())) return false;
  const r = await runRoot(['nft', 'list', 'table', 'inet', TABLE], { timeout: 6000 }).catch(() => null);
  return !!(r && r.ok);
}

async function start({ force = false } = {}) {
  if (process.platform !== 'linux') throw new Error('Linux-движок доступен только на Linux');
  if (!valid()) installEngine();
  if (!strategyExists(config.get().zapret.strategy)) throw new Error('Zapret не установлен — раздел «Обновления»');
  if (!(await nftPresent())) throw new Error('Не найден nft. Установите пакет nftables: sudo pacman -S nftables');

  const running = await enginePids();
  if (running.length && !force) return { ok: true, already: true, pids: running };

  const prof = buildProfile();
  if (!prof.tcpPorts.length && !prof.udpPorts.length) throw new Error('Стратегия не содержит портов (--wf-tcp/--wf-udp)');

  // движок перезапускаем всегда «с нуля»
  await stop({ silent: true });

  log.info('LINUX', 'запуск движка hz-nfq');
  const child = spawn('bash', ['-lc',
    `exec ${rootHelper() && rootHelper().cmd === 'pkexec' ? 'pkexec' : 'sudo -n'} ${JSON.stringify(engineBin())} ` +
    `--profile ${JSON.stringify(profileFile())} --queue ${QUEUE_NUM} --log ${JSON.stringify(engineLog())}`
  ], { detached: true, stdio: 'ignore' });
  child.unref();
  engineProc = child.pid;
  util.ensureDir(engineDir());
  fs.writeFileSync(path.join(engineDir(), 'engine.pid'), String(child.pid), 'utf8');
  engineStartedAt = Date.now();

  // ждём, пока движок реально откроет очередь
  let pids = [];
  for (let i = 0; i < 20 && !pids.length; i++) {
    await new Promise(r => setTimeout(r, 250));
    pids = await enginePids();
  }
  if (!pids.length) {
    const tail = tailLog(engineLog(), 6);
    throw new Error('Движок не запустился (нужен пароль polkit/sudo). ' + tail);
  }
  await applyRules(prof.tcpPorts, prof.udpPorts);
  log.ok('LINUX', `Zapret запущен: движок PID ${pids.join(',')}, стратегия ${config.get().zapret.strategy}`);
  return { ok: true, pids, strategy: config.get().zapret.strategy };
}

async function stop({ silent } = {}) {
  if (process.platform !== 'linux') return { ok: true };
  const pids = await enginePids();
  await clearRules();
  for (const pid of pids) {
    await runRoot(['kill', String(pid)], { timeout: 5000 });
  }
  // если polkit не сработал — хотя бы SIGTERM от пользователя (движок запущен через sudo, может не дать)
  for (const pid of pids) { try { process.kill(pid, 'SIGTERM'); } catch (_) {} }
  try { fs.unlinkSync(path.join(engineDir(), 'engine.pid')); } catch (_) {}
  engineStartedAt = null;
  if (!silent) log.info('LINUX', pids.length ? `Движок остановлен (${pids.join(',')})` : 'Движок не был запущен');
  return { ok: true, stopped: pids.length > 0 };
}

async function restart() {
  await stop({ silent: true });
  await new Promise(r => setTimeout(r, 500));
  return start({ force: true });
}

const svcCache = { at: 0, value: null };
async function status() {
  if (process.platform !== 'linux') return { supported: false, running: false, state: 'unavailable' };
  const now = Date.now();
  if (svcCache.value && now - svcCache.at < 2500) return svcCache.value;
  const pids = await enginePids();
  const rules = pids.length ? await rulesPresent() : false;
  const value = {
    supported: true,
    running: pids.length > 0 && rules,
    pids,
    rules,
    engine: valid(),
    strategy: config.get().zapret.strategy,
    version: installedVersion(),
    startedAt: engineStartedAt,
    asService: false,
    driver: { service: 'n/a', ok: true, hint: null }
  };
  svcCache.value = value;
  svcCache.at = now;
  return value;
}

function tailLog(file, lines = 40) {
  try {
    const txt = fs.readFileSync(file, 'utf8');
    return txt.split('\n').filter(Boolean).slice(-lines);
  } catch (_) { return []; }
}

/* Диагностика для интерфейса (аналог вкладки «Драйвер» в Windows) */
async function diagnostics() {
  const items = [];
  const nft = await nftPresent();
  items.push({ name: 'nftables', ok: nft, text: nft ? which('nft') : 'не найден — установите nftables' });
  const polkit = rootHelper();
  items.push({
    name: 'Права', ok: !!polkit,
    text: !polkit ? 'нужен pkexec (polkit) или sudo'
      : polkit.cmd === 'direct' ? 'запущено от root'
      : polkit.cmd === 'pkexec' ? 'pkexec (спросит пароль один раз)' : 'sudo -n'
  });
  // движок кладём при первом обращении: это копирование файла, прав root не требует
  if (!valid()) { try { installEngine(); } catch (e) { log.warn('LINUX', 'движок не установлен: ' + e.message); } }
  items.push({ name: 'Движок hz-nfq', ok: valid(), text: valid() ? engineBin() : 'не установлен — проверьте, что файл hz-nfq есть в сборке' });
  let selftest = null;
  if (valid()) {
    const r = util.execSyncSafe(engineBin(), ['--selftest']);
    selftest = r.ok;
    items.push({ name: 'Самопроверка движка', ok: r.ok, text: r.ok ? 'все тесты пройдены' : (r.stderr || '').slice(0, 200) });
  }
  const st = await status();
  items.push({ name: 'Правила в ядре', ok: st.rules, text: st.rules ? `таблица inet ${TABLE}` : 'не загружены' });
  items.push({ name: 'Zapret', ok: installedVersion() != null, text: installedVersion() ? `Flowseal ${installedVersion()}` : 'не установлен' });
  return { items, selftest, engine: { path: engineBin(), log: engineLog(), tail: tailLog(engineLog(), 12) } };
}

/* Списки доменов (общий формат с Windows) */
function listsInfo() {
  const out = {};
  for (const n of ['list-general.txt', 'list-exclude.txt', 'list-google.txt']) {
    const p = path.join(listsDir(), n);
    try {
      const raw = fs.readFileSync(p, 'utf8');
      out[n] = raw.split(/\r?\n/).filter(l => l.trim() && !l.trim().startsWith('#')).length;
    } catch (_) { out[n] = 0; }
  }
  return out;
}

module.exports = {
  flowsealRelease,
  baseDir, engineDir, engineBin, profileFile, engineLog, listsDir, binDir,
  valid, installEngine, install, installedVersion,
  listStrategies, strategyExists, buildProfile, splitGroups, toProfile,
  start, stop, restart, status, diagnostics, tailLog, listsInfo,
  applyRules, clearRules, enginePids, QUEUE_NUM, TABLE
};
