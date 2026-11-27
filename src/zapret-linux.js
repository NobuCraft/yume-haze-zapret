'use strict';
/*
 * Адаптер Linux-движка под тот же интерфейс, что у src/zapret.js.
 * main.js подключает этот модуль на Linux, поэтому весь остальной код
 * (IPC, трей, разделы интерфейса) работает без изменений.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const config = require('./config');
const log = require('./logger');
const util = require('./util');
const win = require('./zapret');          // берём только чистые парсеры стратегий
const linux = require('./linux');

const WINWS = 'hz-nfq';

function dir() { return linux.baseDir(); }
function batPath(file) { return path.join(dir(), file || config.get().zapret.strategy); }
function valid() { return linux.strategyExists(config.get().zapret.strategy) && linux.valid(); }

/* ------------------------------------------------------------------ список стратегий для UI */
/*
 * На Windows интерфейс берёт STRATEGIES из src/assets (22 записи макета).
 * Под Linux набор зависит от установленного релиза Flowseal, поэтому строим его
 * по реальным .bat-файлам: описание берём из STRATEGIES, если имя совпало,
 * иначе собираем по аргументам winws (--dpi-desync, --dpi-desync-split-pos и т.д.).
 */
const META = require('./assets/strategies').STRATEGIES;

function featsOf(args) {
  const out = new Set();
  const val = k => {
    const i = args.findIndex(a => a === k || a.startsWith(k + '='));
    if (i < 0) return null;
    return args[i].includes('=') ? args[i].split('=').slice(1).join('=') : (args[i + 1] || null);
  };
  const splitPos = val('--dpi-desync-split-pos');
  if (splitPos) out.add(splitPos.length > 12 ? 'split-pos' : `split-pos=${splitPos}`);
  const seqovl = val('--dpi-desync-split-seqovl');
  if (seqovl && seqovl !== '0') out.add(`seqovl=${seqovl}`);
  if (args.includes('--dpi-desync-ip-id-zero') || args.includes('--ip-id=zero')) out.add('ip-id=zero');
  const rp = val('--dpi-desync-repeats');
  if (rp && rp !== '0') out.add(`repeats=${rp}`);
  if (val('--dpi-desync-fake-tls') || val('--dpi-desync-fake-tls-mod')) out.add('fake-tls');
  const fakeArgs = args.filter(a => a.startsWith('--dpi-desync-fake'));
  if (fakeArgs.length && args.some(a => /--dpi-desync=\S*multisplit/.test(a))) out.add('fake+multisplit');
  if (val('--dpi-desync-fake-quic')) out.add('fake-quic');
  if (val('--dpi-desync-fake-http')) out.add('fake-http');
  if (val('--dpi-desync-split-pos') && /hostfakesplit|hostfake/i.test(args.join(' '))) out.add('hostfakesplit');
  if (args.some(a => /^\(game_filter_tcp|GameFilterTCP/.test(a))) out.add('game-filter');
  return [...out];
}

function metaFor(file, args) {
  const byFile = META.find(m => m.file === file);
  if (byFile) return { name: byFile.name, group: byFile.group, note: byFile.note, feats: byFile.feats };
  const base = file.replace(/\.bat$/i, '');
  const group = /service/i.test(base) ? 'Service' : /game/i.test(base) ? 'Game' : 'Flowseal';
  const desync = [];
  const m = args.join(' ');
  if (/--dpi-desync=([^\s]+)/.test(m)) desync.push(RegExp.$1);
  return {
    name: base,
    group,
    note: desync.length ? `Из релиза Flowseal: ${desync.join(', ')}.` : 'Стратегия из релиза Flowseal.',
    feats: featsOf(args)
  };
}

function ipsetLines() {
  try {
    const f = path.join(dir(), 'lists', 'ipset-all.txt');
    return fs.readFileSync(f, 'utf8').split('\n').filter(l => l.trim() && !l.trim().startsWith('#')).length;
  } catch (_) { return 0; }
}

function strategiesList() {
  const files = linux.listStrategies();
  return files.map(file => {
    let args = [];
    try { args = [].concat(win.parseBatArgs(file, dir()) || []); } catch (_) { args = []; }
    const meta = metaFor(file, args);
    return { file, ...meta };
  });
}

async function status() {
  const st = await linux.status();
  const cfg = config.get();
  return {
    running: !!st.running,
    pids: st.pids || [],
    state: st.running ? 'RUNNING' : 'STOPPED',
    service: 'n/a',
    strategy: cfg.zapret.strategy,
    version: st.version || linux.installedVersion(),
    engine: st.engine,
    rules: st.rules,
    startedAt: st.startedAt,
    platform: 'linux',
    driver: st.driver,
    /* то, что рендер ждёт от Windows-адаптера */
    installed: !!(linux.installedVersion() || linux.listStrategies().length),
    dir: dir(),
    strategies: strategiesList(),
    service: { installed: false, state: 'n/a' },
    /* ipset на Linux приходит из релиза Flowseal; интерфейс показывает количество строк */
    ipset: { mode: cfg.zapret.ipsetMode, lines: ipsetLines(), exists: ipsetLines() > 0 },
    expectedVersion: '1.10.4'
  };
}

async function start(opts) { return linux.start(opts); }
async function stop(opts) { return linux.stop(opts); }
async function restart() { return linux.restart(); }

async function install({ onProgress } = {}) { return linux.install({ onProgress }); }
function installedVersion() { return linux.installedVersion(); }
let _relKnown = null;
async function latestRelease({ force = false } = {}) {
  const rel = await linux.flowsealRelease({ force });
  _relKnown = rel.version;
  return { version: rel.version, tag: rel.version, notes: rel.notes, page: rel.page, publishedAt: null, url: rel.zip };
}
function releaseKnown() { return _relKnown; }
function ZAPRET_VERSION() { return '1.10.4'; }

async function setStrategy(file) {
  if (!linux.strategyExists(file)) {
    const n = linux.listStrategies().length;
    throw new Error(n
      ? `Стратегия «${file}» не найдена в установленном релизе (доступно ${n})`
      : 'Стратегии не установлены — откройте «Обновления» → «Установить»');
  }
  config.patch({ zapret: { strategy: file } });
  const st = await linux.status();
  if (st.running) await linux.restart();
  log.info('ZAPRET', `Стратегия: ${file}`);
  return { ok: true, strategy: file };
}

async function preflight() {
  const items = [];
  const st = await linux.status();
  items.push({ name: 'Стратегия установлена', ok: linux.strategyExists(config.get().zapret.strategy), hint: 'раздел «Обновления»' });
  items.push({ name: 'Движок hz-nfq', ok: linux.valid(), hint: 'переустановите Zapret' });
  items.push({ name: 'Правила в ядре', ok: st.rules, hint: 'включите защиту — приложение попросит пароль один раз' });
  const prof = (() => {
    try {
      const r = util.execSyncSafe(linux.engineBin(), ['--check-profile', linux.profileFile()]);
      return r.ok;
    } catch (_) { return false; }
  })();
  items.push({ name: 'Профиль стратегии', ok: prof, hint: 'проверьте стратегию в разделе «Zapret»' });
  const ok = items.every(i => i.ok);
  return { ok, items, platform: 'linux', admin: process.getuid ? process.getuid() === 0 : false };
}

/* «Служба» в Linux — systemd-юнит, который поднимает обход при загрузке */
const UNIT = 'yume-haze-zapret.service';
function unitPath() { return `/etc/systemd/system/${UNIT}`; }

async function installService() {
  const body = [
    '[Unit]',
    'Description=Yume Haze Zapret (Linux engine)',
    'After=network-online.target',
    'Wants=network-online.target',
    '',
    '[Service]',
    'Type=simple',
    `ExecStart=${linux.engineBin()} --profile ${linux.profileFile()} --queue ${linux.QUEUE_NUM} --log ${linux.engineLog()}`,
    `ExecStartPre=/bin/sh -c "nft add table inet ${linux.TABLE}; nft 'add chain inet ${linux.TABLE} out { type filter hook output priority -150; policy accept; }'"`,
    `ExecStop=-/bin/sh -c "nft delete table inet ${linux.TABLE}"`,
    'Restart=on-failure',
    'RestartSec=2',
    '',
    '[Install]',
    'WantedBy=multi-user.target',
    ''
  ].join('\n');
  const tmp = path.join(os.tmpdir(), UNIT);
  fs.writeFileSync(tmp, body, 'utf8');
  const cp = await linux.runRoot(['cp', tmp, unitPath()]);
  if (!cp.ok) throw new Error('Не удалось записать юнит: ' + (cp.stderr || '').trim());
  await linux.runRoot(['systemctl', 'daemon-reload']);
  const en = await linux.runRoot(['systemctl', 'enable', UNIT]);
  log.ok('LINUX', 'Служба systemd установлена: ' + UNIT);
  return { ok: en.ok, unit: UNIT, enabled: en.ok };
}

async function removeService() {
  await linux.runRoot(['systemctl', 'disable', '--now', UNIT]);
  const r = await linux.runRoot(['rm', '-f', unitPath()]);
  await linux.runRoot(['systemctl', 'daemon-reload']);
  return { ok: r.ok, removed: true };
}

async function driverDiagnostics() {
  const d = await linux.diagnostics();
  const nft = d.items.find(i => i.name === 'nftables');
  return {
    platform: 'linux',
    service: 'n/a',
    running: d.items.find(i => i.name === 'Правила в ядре')?.ok || false,
    ok: !!(nft && nft.ok) && d.items.every(i => i.ok || i.name === 'Правила в ядре' || i.name === 'Zapret'),
    items: d.items,
    engine: d.engine,
    hint: nft && nft.ok ? null : 'Установите nftables: sudo pacman -S nftables',
    sys: { exists: linux.valid(), version: linux.installedVersion() },
    dll: { exists: true },
    signature: { status: 'n/a', valid: true }
  };
}

async function driverCheck() {
  const d = await driverDiagnostics();
  return { ok: d.ok, items: d.items, platform: 'linux' };
}

async function diagnostics() {
  const d = await linux.diagnostics();
  return d;
}

async function clearDiscordCache() {
  const candidates = [
    path.join(os.homedir(), '.config', 'discord', 'Cache'),
    path.join(os.homedir(), '.config', 'discordcanary', 'Cache'),
    path.join(os.homedir(), '.config', 'VencordDesktop', 'Cache')
  ];
  let freed = 0;
  for (const c of candidates) {
    try {
      if (!fs.existsSync(c)) continue;
      const before = dirSize(c);
      util.rmrf(c);
      freed += before;
      fs.mkdirSync(c, { recursive: true });
    } catch (e) { log.warn('LINUX', 'кэш Discord: ' + e.message); }
  }
  return { ok: true, freed, text: freed ? `Освобождено ${util.humanBytes(freed)}` : 'Кэш Discord не найден' };
}

function dirSize(p) {
  let total = 0;
  try {
    for (const it of fs.readdirSync(p, { withFileTypes: true })) {
      const f = path.join(p, it.name);
      try {
        if (it.isDirectory()) total += dirSize(f);
        else total += fs.statSync(f).size;
      } catch (_) {}
    }
  } catch (_) {}
  return total;
}

/* Пользовательские списки: тот же формат, что в Windows-версии */
const lists = require('./lists');
async function readList(kind) { return lists.read(kind); }
async function writeList(kind, text) { const r = lists.write(kind, text); if (r.path) fs.writeFileSync(linux.profileFile() + '.touch', String(Date.now())); return r; }
function listInfo() { return lists.info(); }

function detectExisting() {
  const found = [];
  const home = os.homedir();
  const roots = [path.join(home, 'Downloads'), path.join(home, 'Загрузки'), path.join(home, 'Desktop'), home];
  for (const r of roots) {
    try {
      for (const n of fs.readdirSync(r)) {
        if (/^zapret/i.test(n)) {
          const p = path.join(r, n);
          if (fs.existsSync(path.join(p, 'general.bat'))) found.push(p);
        }
      }
    } catch (_) {}
  }
  return { found: [...new Set(found)] };
}

function lastRunInfo() {
  const tail = linux.tailLog(linux.engineLog(), 20);
  return { code: null, output: tail.join('\n'), at: Date.now(), platform: 'linux' };
}

async function setGameFilter(gf) {
  // в Linux-движке игровые порты попадают в профиль как обычные диапазоны
  config.patch({ zapret: { gameFilter: gf } });
  return { ok: true, gameFilter: config.get().zapret.gameFilter };
}

async function setIpsetMode(mode) { config.patch({ zapret: { ipsetMode: mode } }); return { ok: true, mode }; }
async function updateIpset() { return { ok: false, error: 'ipset приходит вместе с релизом Flowseal' }; }
async function updateHosts() { return { ok: false, error: 'В Linux hosts не используется: движок работает по спискам доменов' }; }
function toggleCheckUpdates(on) { config.patch({ zapret: { checkUpdates: !!on } }); return { ok: true, on: !!on }; }
async function startAsService() { return installService().then(r => ({ ok: r.ok, asService: true, unit: r.unit })); }
async function removeConflictingDriver() { return { ok: true, state: 'not-installed' }; }
async function launch() { return start(); }

module.exports = {
  platform: 'linux',
  dir, batPath, valid, status, start, stop, restart, install, setStrategy,
  installedVersion, latestRelease, releaseKnown, ZAPRET_VERSION: '1.10.4',
  preflight, installService, removeService, startAsService, removeConflictingDriver,
  driverDiagnostics, driverCheck, diagnostics, clearDiscordCache,
  readList, writeList, listInfo, detectExisting, lastRunInfo,
  setGameFilter, setIpsetMode, updateIpset, updateHosts, toggleCheckUpdates, launch,
  strategiesList,
  parseBatArgs: win.parseBatArgs, tokenizeArgs: win.tokenizeArgs,
  engine: linux
};
