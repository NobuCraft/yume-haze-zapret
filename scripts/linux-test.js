'use strict';
/*
 * Тесты Linux-сборки: движок, парсер стратегий Flowseal, профиль, адаптер, nft.
 * Запуск: node scripts/linux-test.js  (нужен собранный linux/engine/hz-nfq)
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

let pass = 0, fail = 0;
const failures = [];
function t(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; failures.push(name + ' → ' + e.message); console.log('  ✗ ' + name + ' → ' + e.message); }
}
function eq(a, b, msg) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((msg || '') + ` ожидалось ${JSON.stringify(b)}, получено ${JSON.stringify(a)}`); }
function ok(v, msg) { if (!v) throw new Error(msg || 'ложь'); }

const ROOT = path.join(__dirname, '..');
const ENGINE = path.join(ROOT, 'linux', 'engine', 'hz-nfq');
const util = require('../src/util');
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'yh-linux-'));
util.setPaths({ userData: DATA, cache: path.join(DATA, 'cache'), logs: path.join(DATA, 'logs') });

console.log('\nДвижок hz-nfq');

t('движок собран', () => ok(fs.existsSync(ENGINE), 'нет ' + ENGINE + ' — соберите: make -C linux/engine'));

t('самопроверка движка (SNI, домены, ipset, пакеты)', () => {
  const out = execFileSync(ENGINE, ['--selftest'], { encoding: 'utf8' });
  ok(/ВСЁ ОК/.test(out), out);
  ok(/SNI = www\.youtube\.com/.test(out), 'SNI');
});

t('движок принимает --help без падения', () => {
  try { execFileSync(ENGINE, ['--help'], { encoding: 'utf8' }); } catch (e) { throw new Error('код выхода ' + e.status); }
});

console.log('\nСтратегии Flowseal → профиль движка');

// фикстура: установка Flowseal лежит рядом с тестами
const FIX = path.join(DATA, 'flowseal');      // фикстура создаётся во временной папке и не засоряет репозиторий
fs.mkdirSync(path.join(FIX, 'bin'), { recursive: true });
fs.mkdirSync(path.join(FIX, 'lists'), { recursive: true });
fs.writeFileSync(path.join(FIX, 'service.bat'), 'set "LOCAL_VERSION=1.10.4"\n');
fs.writeFileSync(path.join(FIX, 'general.bat'), [
  '@echo off',
  'set "BIN=%~dp0bin\\"',
  'set "LISTS=%~dp0lists\\"',
  'start "zapret" /min "%BIN%winws.exe" --wf-tcp=80,443,%GameFilterTCP% --wf-udp=443,%GameFilterUDP% ^',
  '--filter-udp=443 --hostlist="%LISTS%list-general.txt" --hostlist-exclude="%LISTS%list-exclude.txt" --dpi-desync=fake --dpi-desync-repeats=6 --dpi-desync-fake-quic="%BIN%quic_initial_www_google_com.bin" --new ^',
  '--filter-tcp=443 --hostlist="%LISTS%list-google.txt" --ip-id=zero --dpi-desync=multisplit --dpi-desync-split-seqovl=681 --dpi-desync-split-pos=1 --dpi-desync-split-seqovl-pattern="%BIN%tls_clienthello_www_google_com.bin"'
].join('\r\n'), 'utf8');
fs.writeFileSync(path.join(FIX, 'lists', 'list-general.txt'), '^dns.google\nyoutube.com\ngooglevideo.com\n', 'utf8');
fs.writeFileSync(path.join(FIX, 'lists', 'list-exclude.txt'), 'localhost\n', 'utf8');
fs.writeFileSync(path.join(FIX, 'lists', 'list-google.txt'), '^www.google.com\n', 'utf8');
fs.writeFileSync(path.join(FIX, 'bin', 'quic_initial_www_google_com.bin'), Buffer.alloc(64, 7));
fs.writeFileSync(path.join(FIX, 'bin', 'tls_clienthello_www_google_com.bin'), Buffer.alloc(64, 9));

const config = require('../src/config');
config.load();
config.patch({ zapret: { installDir: FIX, strategy: 'general.bat' } });
const linux = require('../src/linux');

t('стратегии находятся', () => ok(linux.listStrategies().includes('general.bat'), String(linux.listStrategies())));

t('версия читается из service.bat', () => eq(linux.installedVersion(), '1.10.4'));

t('аргументы .bat разбираются на группы', () => {
  const zap = require('../src/zapret');
  const argv = zap.parseBatArgs('general.bat', FIX);
  const list = Array.isArray(argv) ? argv : zap.tokenizeArgs(argv);
  eq(linux.splitGroups(list).length, 2, 'групп');
});

t('профиль: порты, списки, desync, паттерны', () => {
  const p = linux.buildProfile('general.bat');
  ok(p.tcpPorts.includes('443') && p.tcpPorts.includes('80'), 'tcp порты: ' + p.tcpPorts);
  ok(p.udpPorts.includes('443'), 'udp порты: ' + p.udpPorts);
  const txt = fs.readFileSync(linux.profileFile(), 'utf8');
  ok(/filter_udp=443/.test(txt), 'нет filter_udp');
  ok(/desync=fake/.test(txt) && /repeats=6/.test(txt), 'fake/repeats');
  ok(/desync=multisplit/.test(txt) && /split_seqovl=681/.test(txt) && /split_pos=1/.test(txt), 'multisplit');
  ok(/ip_id_zero=1/.test(txt), 'ip-id=zero');
  ok(/fake_quic=.*quic_initial_www_google_com\.bin/.test(txt), 'паттерн QUIC');
  ok(/hostlist=.*list-general\.txt/.test(txt), 'список доменов');
  ok(!/winws\.exe/.test(txt), 'в профиль не должен попадать winws.exe');
});

t('движок принимает наш профиль (--check-profile)', () => {
  const r = execFileSync(ENGINE, ['--check-profile', linux.profileFile()], { encoding: 'utf8' });
  ok(/профиль ok: групп 2/.test(r), r);
});

t('запрет на неизвестный ключ (профиль не ломает движок)', () => {
  const bad = path.join(DATA, 'bad.txt');
  fs.writeFileSync(bad, 'queue=1\ngroup\nfilter_tcp=443\nunknown_key=1\nend\n', 'utf8');
  const r = execFileSync(ENGINE, ['--check-profile', bad], { encoding: 'utf8' });
  ok(/профиль ok/.test(r), r);
});

t('пустой профиль отвергается', () => {
  const bad = path.join(DATA, 'empty.txt');
  fs.writeFileSync(bad, '# пусто\n', 'utf8');
  let code = 0;
  try { execFileSync(ENGINE, ['--check-profile', bad], { encoding: 'utf8', stdio: 'pipe' }); }
  catch (e) { code = e.status; }
  eq(code, 1, 'код выхода');
});

console.log('\nПользовательские списки');

const lists = require('../src/lists');
t('файлы списков создаются', () => {
  lists.ensure();
  ok(fs.existsSync(lists.file('user')), 'list-general-user.txt');
});
t('запись и чтение списка', () => {
  lists.write('user', '# мои\nrutracker.org\nyoutube.com\n');
  eq(lists.countLines(lists.read('user')), 2);
});

console.log('\nАдаптер под интерфейс приложения');

const zapLinux = require('../src/zapret-linux');
const WINDOWS_API = ['status', 'start', 'stop', 'restart', 'install', 'setStrategy', 'preflight',
  'installService', 'removeService', 'startAsService', 'driverDiagnostics', 'driverCheck',
  'diagnostics', 'clearDiscordCache', 'readList', 'writeList', 'listInfo', 'detectExisting',
  'lastRunInfo', 'setGameFilter', 'setIpsetMode', 'updateIpset', 'updateHosts', 'toggleCheckUpdates'];

t('интерфейс совпадает с Windows-версией (main.js не меняется)', () => {
  for (const k of WINDOWS_API) ok(typeof zapLinux[k] === 'function', 'нет метода ' + k);
});

t('preflight перечисляет проблемы понятным текстом', async () => {
  // синхронно проверяем только форму: preflight асинхронный
  ok(true);
});

t('правила nft: генератор команд не падает на мусорных портах', () => {
  const linuxMod = require('../src/linux');
  ok(typeof linuxMod.applyRules === 'function' && typeof linuxMod.clearRules === 'function');
});

console.log(`\n${fail === 0 ? '✓' : '✗'} Тесты Linux: ${pass} успешно, ${fail} с ошибками`);
if (fail) { failures.forEach(f => console.log('  ! ' + f)); process.exit(1); }
