'use strict';
/* Автотесты логики без Electron: node scripts/selftest.js
   Проверяет разбор .bat стратегий, флаги TgWsProxy, ссылки, статистику, IPset, историю. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'yume-test-'));
process.env.APPDATA = TMP;
process.env.LOCALAPPDATA = TMP;

const util = require('../src/util');
util.setPaths({
  userData: path.join(TMP, 'data'),
  logs: path.join(TMP, 'data', 'logs'),
  cache: path.join(TMP, 'data', 'cache'),
  downloads: path.join(TMP, 'data', 'downloads'),
  temp: path.join(TMP, 'data', 'temp')
});
for (const p of Object.values(util.paths())) util.ensureDir(p);

const config = require('../src/config');
const log = require('../src/logger');
const zapret = require('../src/zapret');
const tgws = require('../src/tgws');
const net = require('../src/net');
const updates = require('../src/updates');

let pass = 0, fail = 0;
function test(name, fn) {
  try {
    const r = fn();
    if (r && typeof r.then === 'function') throw new Error('async test must use atest');
    console.log('  ✓', name);
    pass++;
  } catch (e) {
    console.log('  ✗', name, '\n     ', e.message);
    fail++;
  }
}
async function atest(name, fn) {
  try { await fn(); console.log('  ✓', name); pass++; }
  catch (e) { console.log('  ✗', name, '\n     ', e.message); fail++; }
}

(async function main() {
  console.log('\n== конфигурация ==');
  const cfg = config.load();
  test('значения по умолчанию: стратегия general.bat', () => assert.equal(cfg.zapret.strategy, 'general.bat'));
  test('секрет 32 hex', () => assert.match(cfg.tg.secret, /^[0-9a-f]{32}$/));
  test('порт прокси 1443 (как в tg-ws-proxy)', () => assert.equal(cfg.tg.port, 1443));
  test('dc-ip по умолчанию как в проекте', () => assert.deepEqual(cfg.tg.dcIp, ['2:149.154.167.220', '4:149.154.167.220']));
  test('patch сохраняется на диск', () => {
    config.patch({ zapret: { strategy: 'general (ALT11).bat' } });
    const again = JSON.parse(fs.readFileSync(config.SETTINGS_FILE(), 'utf8'));
    assert.equal(again.zapret.strategy, 'general (ALT11).bat');
    config.patch({ zapret: { strategy: 'general.bat' } });
  });
  test('reset возвращает умолчания', () => {
    config.patch({ tg: { port: 9999 } });
    config.reset('tg');
    assert.equal(config.get().tg.port, 1443);
  });

  console.log('\n== стратегии zapret 1.10.4 ==');
  const { STRATEGIES } = require('../src/assets/strategies');
  test('22 стратегии из релиза', () => assert.equal(STRATEGIES.length, 22));
  test('все имена файлов уникальны', () => assert.equal(new Set(STRATEGIES.map(s => s.file)).size, 22));
  test('все файлы .bat', () => STRATEGIES.forEach(s => assert.match(s.file, /\.bat$/)));

  // разбор аргументов на реальном .bat из релиза
  const realDir = path.join(ROOT, 'tests', 'fixtures', 'zapret');
  test('есть фикстура релиза (bin/winws.exe + general.bat)', () => {
    assert.ok(fs.existsSync(path.join(realDir, 'bin', 'winws.exe')), 'нужна фикстура');
    assert.ok(fs.existsSync(path.join(realDir, 'general.bat')));
  });
  config.patch({ zapret: { installDir: realDir } });
  test('zapret.dir указывает на фикстуру', () => assert.equal(zapret.dir(), realDir));
  test('zapret.valid() находит bin\\winws.exe', () => assert.equal(zapret.valid(), true));
  test('версия из service.bat = 1.10.4', () => assert.equal(zapret.installedVersion(), '1.10.4'));

  test('args для службы: раскрыты %BIN%/%LISTS%/%GameFilter%', () => {
    const args = zapret.parseBatArgs('general.bat', realDir);
    assert.ok(Array.isArray(args), 'parseBatArgs должен возвращать массив');
    assert.ok(args[0].startsWith('--wf-tcp='), 'нет --wf-tcp');
    assert.ok(args.some(a => a.startsWith('--dpi-desync=fake')), 'нет dpi-desync');
    assert.ok(!args.some(a => /%BIN%|%LISTS%|%GameFilterTCP%|%GameFilterUDP%/.test(a)), 'не раскрыты переменные');
    assert.ok(!args.includes('^'), 'остались символы продолжения строки');
    assert.ok(args.some(a => a === '--dpi-desync-fake-quic=' + path.join(realDir, 'bin', 'quic_initial_www_google_com.bin')), 'нет пути к фейку');
    assert.ok(args.includes('--filter-l7=discord,stun'), 'нет discord-фильтра');
  });
  test('game filter: выключен → порт 12 (как в service.bat)', () => {
    config.patch({ zapret: { gameFilter: { mode: 'off', tcp: '1024-65535', udp: '1024-65535' } } });
    const args = zapret.parseBatArgs('general.bat', realDir);
    assert.ok(args.includes('--wf-udp=443,19294-19344,50000-50100,12'), 'udp не 12: ' + args.slice(0, 90));
  });
  test('game filter: TCP+UDP подставляют диапазоны', () => {
    config.patch({ zapret: { gameFilter: { mode: 'all', tcp: '1024-65535', udp: '1024-65535' } } });
    const args = zapret.parseBatArgs('general.bat', realDir);
    assert.ok(args.includes('--wf-tcp=80,443,2053,2083,2087,2096,8443,1024-65535'), 'tcp: ' + args.slice(0, 100));
    assert.ok(args.includes('--wf-udp=443,19294-19344,50000-50100,1024-65535'));
    config.patch({ zapret: { gameFilter: { mode: 'off', tcp: '1024-65535', udp: '1024-65535' } } });
  });
  test('game_filter.enabled пишется в формате service.bat', () => {
    zapret.applyGameFilterFile(realDir, { mode: 'udp', tcp: '1935', udp: '50000-50100' });
    const f = path.join(realDir, 'utils', 'game_filter.enabled');
    const txt = fs.readFileSync(f, 'utf8');
    assert.match(txt, /mode=udp/);
    assert.match(txt, /tcp=1935/);
    assert.match(txt, /udp=50000-50100/);
    assert.deepEqual(zapret.readGameFilter(realDir), { mode: 'udp', tcp: '1935', udp: '50000-50100' });
    zapret.applyGameFilterFile(realDir, { mode: 'off' });
    assert.ok(!fs.existsSync(f), 'файл должен удаляться при выключении');
  });
  test('валидация диапазонов портов', () => {
    assert.equal(zapret.validateRanges('1024-65535', '1024-65535').tcp, true);
    assert.equal(zapret.validateRanges('80,443,8000-8100', '443').udp, true);
    assert.equal(zapret.validateRanges('0-100', '443').tcp, false);
    assert.equal(zapret.validateRanges('1024-65535', 'abc').udp, false);
    assert.equal(zapret.validateRanges('70000', '443').tcp, false);
  });

  console.log('\n== IPset ==');
  const L = zapret.lists(realDir);
  test('режим loaded определяется по непустому списку', () => {
    fs.writeFileSync(path.join(L, 'ipset-all.txt'), '1.2.3.4/32\n5.6.7.8/32\n');
    assert.equal(zapret.ipsetState(realDir).mode, 'loaded');
  });
  test('режим none → строка-заглушка 203.0.113.113/32 + backup', () => {
    zapret.applyIpsetMode(realDir, 'none');
    assert.match(fs.readFileSync(path.join(L, 'ipset-all.txt'), 'utf8'), /203\.0\.113\.113/);
    assert.ok(fs.existsSync(path.join(L, 'ipset-all.txt.backup')));
    assert.equal(zapret.ipsetState(realDir).mode, 'none');
  });
  test('режим any → пустой файл', () => {
    zapret.applyIpsetMode(realDir, 'any');
    assert.equal(fs.readFileSync(path.join(L, 'ipset-all.txt'), 'utf8').trim(), '');
    assert.equal(zapret.ipsetState(realDir).mode, 'any');
  });
  test('возврат в loaded из backup', () => {
    zapret.applyIpsetMode(realDir, 'loaded');
    assert.match(fs.readFileSync(path.join(L, 'ipset-all.txt'), 'utf8'), /1\.2\.3\.4/);
  });

  console.log('\n== пользовательские списки ==');
  test('writeList → readList (roundtrip, CRLF)', () => {
    zapret.writeList('user', '# комментарий\nexample.com\ntest.org');
    assert.equal(zapret.readList('user'), '# комментарий\r\nexample.com\r\ntest.org');
    assert.equal(zapret.listInfo().user.entries, 2);
  });
  test('список исключений пишется в list-exclude-user.txt', () => {
    zapret.writeList('exclude', 'my.site');
    assert.ok(fs.readFileSync(path.join(L, 'list-exclude-user.txt'), 'utf8').includes('my.site'));
  });

  console.log('\n== TG WS Proxy ==');
  const T = config.get().tg;
  test('ссылка dd-формата (как в tray_common.py)', () => {
    const link = tgws.link();
    assert.equal(link, `tg://proxy?server=127.0.0.1&port=1443&secret=dd${T.secret}`);
  });
  test('ссылка ee-формата при fake TLS (hex домена)', () => {
    config.patch({ tg: { fakeTlsDomain: 'example.com' } });
    const link = tgws.link({ ee: true });
    assert.equal(link, `tg://proxy?server=127.0.0.1&port=1443&secret=ee${T.secret}${Buffer.from('example.com').toString('hex')}`);
    config.patch({ tg: { fakeTlsDomain: '' } });
  });
  test('аргументы запуска совпадают с CLI tg-ws-proxy', () => {
    const a = tgws.buildArgs();
    assert.ok(a.includes('--host') && a.includes('127.0.0.1'));
    assert.ok(a.includes('--port') && a.includes('1443'));
    assert.ok(a.includes('--secret') && a.includes(T.secret));
    assert.ok(a.includes('--pool-size') && a.includes('4'));
    assert.ok(a.includes('--portable'));
    assert.ok(!a.includes('--no-cfproxy'), 'cfproxy включён по умолчанию');
  });
  test('выключение cfproxy/h2 добавляет --no-cfproxy/--no-h2', () => {
    config.patch({ tg: { cfproxy: false, h2: false } });
    const a = tgws.buildArgs();
    assert.ok(a.includes('--no-cfproxy') && a.includes('--no-h2'));
    config.patch({ tg: { cfproxy: true, h2: true } });
  });
  test('dc-ip передаётся повторяющимся флагом', () => {
    const a = tgws.buildArgs();
    assert.equal(a.filter(x => x === '--dc-ip').length, 2);
    assert.ok(a.includes('2:149.154.167.220'));
  });
  test('новый секрет: 32 hex и меняется', () => {
    const before = config.get().tg.secret;
    const r = tgws.newSecret();
    assert.match(r.secret, /^[0-9a-f]{32}$/);
    assert.notEqual(r.secret, before);
  });
  test('валидация параметров', () => {
    assert.equal(tgws.validateTg({ port: 1443 }), null);
    assert.ok(tgws.validateTg({ port: 70000 }));
    assert.ok(tgws.validateTg({ secret: 'abc' }));
    assert.ok(tgws.validateTg({ host: 'localhost' }));
    assert.ok(tgws.validateTg({ poolSize: 99 }));
  });
  await atest('saveSettings применяет валидные значения', async () => {
    const r = await tgws.saveSettings({ port: 2443, poolSize: 6 });
    assert.equal(r.ok, true);
    assert.equal(config.get().tg.port, 2443);
    await tgws.saveSettings({ port: 1443, poolSize: 4 });
  });
  test('разбор строки statistics от прокси (stats: total=… down=…)', () => {
    const st = tgws.parseStats('total=12 active=3 ws=2 h2=1 h2_req=8 tcp_fb=0 cf=1 front=0 bad=0 masked=0 err=0 pool=7/9 cf_pool=2/4 up=1.50KB down=2.25MB');
    assert.equal(st.total, 12);
    assert.equal(st.active, 3);
    assert.equal(st.ws, 2);
    assert.equal(st.cf, 1);
    assert.equal(st.poolHits, 7);
    assert.equal(st.poolTotal, 9);
    assert.equal(st.up, Math.round(1.5 * 1024));
    assert.equal(st.down, Math.round(2.25 * 1024 * 1024));
  });

  console.log('\n== тесты доступности ==');
  test('цели покрывают Discord, YouTube, Google, Cloudflare', () => {
    const svc = new Set(net.TARGETS.map(t => t.service));
    ['Discord', 'YouTube', 'Google', 'Cloudflare'].forEach(s => assert.ok(svc.has(s), 'нет ' + s));
  });
  test('оценка: всё доступно → high', () => {
    const res = net.TARGETS.map(t => ({ ...t, ok: true, ms: 120, status: 200 }));
    const s = net.summarize(res, 'general.bat');
    assert.ok(s.score >= 70, 'score=' + s.score);
    assert.equal(s.grade, 'good');
  });
  test('оценка: ничего не доступно → 0/bad', () => {
    const res = net.TARGETS.map(t => ({ ...t, ok: false }));
    const s = net.summarize(res, 'general.bat');
    assert.equal(s.score, 0);
    assert.equal(s.grade, 'bad');
  });
  test('оценка: половина сервисов → weak', () => {
    const res = net.TARGETS.map((t, i) => ({ ...t, ok: i % 2 === 0, ms: 200 }));
    const s = net.summarize(res, 'general.bat');
    assert.ok(s.score > 0 && s.score < 70, 'score=' + s.score);
  });

  console.log('\n== обновления ==');
  test('сравнение версий', () => {
    assert.equal(updates.cmp('1.10.4', '1.10.4'), 0);
    assert.equal(updates.cmp('1.10.4', '1.10.3'), 1);
    assert.equal(updates.cmp('v1.11.4', '1.11.3'), 1);
    assert.equal(updates.cmp('1.9.9', '1.10.0'), -1);
  });

  console.log('\n== журнал ==');
  test('запись и фильтрация журнала', () => {
    log.clear();
    log.info('ZAPRET', 'старт winws');
    log.error('TEST', 'ошибка теста');
    assert.equal(log.list().length, 2);
    assert.equal(log.list({ source: 'ERR' }).length, 1);
    assert.equal(log.list({ q: 'winws' }).length, 1);
    assert.ok(log.text().includes('старт winws'));
    assert.ok(fs.existsSync(path.join(util.paths().logs, 'app.log')));
  });

  console.log('\n== утилиты ==');
  await atest('TCP-проба закрытого порта возвращает ok:false быстро', async () => {
    const r = await util.tcpProbe('127.0.0.1', 1, 400);
    assert.equal(r.ok, false);
  });
  await atest('freePort определяет свободный/занятый порт', async () => {
    const net2 = require('net');
    assert.equal(await util.freePort(34567), true);
    const srv = net2.createServer();
    await new Promise(r => srv.listen(34567, '127.0.0.1', r));
    assert.equal(await util.freePort(34567), false);
    srv.close();
  });
  test('человекочитаемые размеры', () => {
    assert.equal(util.humanBytes(512), '512 Б');
    assert.equal(util.humanBytes(2048), '2.00 КБ');
    assert.equal(util.humanBytes(5 * 1024 * 1024), '5.00 МБ');
  });

  console.log('\n== интерфейс ==');
  test('index.html содержит все элементы макета', () => {
    const html = fs.readFileSync(path.join(ROOT, 'renderer', 'index.html'), 'utf8');
    const ids = ['orbBtn', 'stratGrid', 'pickList', 'pickResults', 'logBox', 'dcList', 'compList', 'diagList', 'histList', 'listArea', 'tgLink', 'tgSecret', 'swatches', 'ovTargets', 'svcZ', 'svcT'];
    ids.forEach(id => assert.ok(html.includes(`id="${id}"`), 'нет #' + id));
    ['Обзор', 'Zapret', 'TG WS Proxy', 'Тесты', 'Обновления', 'Журнал', 'Настройки', 'О программе']
      .forEach(t => assert.ok(html.includes(t), 'нет раздела ' + t));
  });
  test('app.js вызывает только существующие IPC-методы', () => {
    const preload = fs.readFileSync(path.join(ROOT, 'preload.js'), 'utf8');
    const main = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
    const app = fs.readFileSync(path.join(ROOT, 'renderer', 'app.js'), 'utf8');
    const html = fs.readFileSync(path.join(ROOT, 'renderer', 'index.html'), 'utf8');
    const src = app + '\n' + html;
    const groups = [...preload.matchAll(/\n  ([a-zA-Z]+): \{\n([\s\S]*?)\n  \}/g)];
    let checked = 0;
    for (const g of groups) {
      const methods = new Set([...g[2].matchAll(/^\s{4}([a-zA-Z]+):/gm)].map(m => m[1]));
      const used = new Set([...src.matchAll(new RegExp('api\\.' + g[1] + '\\.([a-zA-Z]+)\\(', 'g'))].map(m => m[1]));
      for (const m of used) { assert.ok(methods.has(m), g[1] + '.' + m + ' отсутствует в preload'); checked++; }
    }
    // каждый ipcMain.handle имеет вызов из preload
    const handlers = [...main.matchAll(/ipcMain\.handle\('([^']+)'/g)].map(m => m[1]);
    assert.ok(handlers.length > 25, 'мало IPC-обработчиков: ' + handlers.length);
    for (const c of handlers) assert.ok(preload.includes(`'${c}'`), 'preload не вызывает канал ' + c);
    assert.ok(checked > 20, 'мало проверенных вызовов: ' + checked);
  });
  test('версия Zapret берётся из последнего релиза GitHub, а не зашита', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src', 'zapret.js'), 'utf8');
    const upd = fs.readFileSync(path.join(ROOT, 'src', 'updates.js'), 'utf8');
    assert.ok(/async function latestRelease/.test(src), 'нет latestRelease');
    assert.ok(/api\.github\.com\/repos\/Flowseal\/zapret-discord-youtube\/releases/.test(src), 'нет запроса релизов Flowseal');
    assert.ok(/const rel = await latestRelease\(\)/.test(src), 'install() не получает последний релиз');
    assert.ok(/const version = rel\.version/.test(src), 'install() не использует версию релиза');
    assert.ok(!/downloadWithMirrors\(ZIP_URL/.test(src), 'осталась зашитая ссылка ZIP_URL');
    assert.ok(/zapret\.latestRelease/.test(upd), 'updates.js не спрашивает последний релиз');
  });
  test('автообновление компонентов включено и работает по таймеру', () => {
    const main = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
    const conf = fs.readFileSync(path.join(ROOT, 'src', 'config.js'), 'utf8');
    assert.ok(/autoUpdateTick/.test(main), 'нет функции автообновления');
    assert.ok(/setInterval\(\(\) => autoUpdateTick\(false\), 60 \* 60 \* 1000\)/.test(main), 'нет ежечасной проверки');
    assert.ok(/autoInstall\)/.test(main) && /updateAll/.test(main), 'автоустановка не вызывает updateAll');
    assert.ok(/autoUpdateCheck: true/.test(conf), 'проверка обновлений выключена по умолчанию');
    assert.ok(/updates:installAll/.test(main), 'нет IPC обновить всё');
  });
  test('кнопки сообщества: Discord и GitHub в сайдбаре со значками', () => {
    const html = fs.readFileSync(path.join(ROOT, 'renderer', 'index.html'), 'utf8');
    const app = fs.readFileSync(path.join(ROOT, 'renderer', 'app.js'), 'utf8');
    assert.ok(/data-act="linkDiscord"[\s\S]{0,120}Наш Discord/.test(html), 'нет кнопки Discord в сайдбаре');
    assert.ok(/data-act="linkGithub"[\s\S]{0,120}Наш GitHub/.test(html), 'нет кнопки GitHub в сайдбаре');
    const sd = html.indexOf('data-go="about"'), ss = html.indexOf('<div class="side-social">');
    assert.ok(ss > sd, 'кнопки сообщества должны быть ниже пункта «О программе»');
    assert.ok(/discord\.gg\/qHabsmgKVP/.test(app), 'неверная ссылка Discord');
    assert.ok(/github\.com\/NobuCraft\/yume-haze-zapret/.test(app), 'неверная ссылка GitHub');
    assert.ok(/^\s{2}discord:/m.test(app), 'нет иконки discord');
    assert.ok(/^\s{2}github:/m.test(app), 'нет иконки github');
  });

  test('QR-код убран со страницы TG WS Proxy', () => {
    const html = fs.readFileSync(path.join(ROOT, 'renderer', 'index.html'), 'utf8');
    const app = fs.readFileSync(path.join(ROOT, 'renderer', 'app.js'), 'utf8');
    assert.ok(!/id="qr"/.test(html), 'в разметке остался контейнер QR');
    assert.ok(!/qrcode\.js/.test(html), 'подключена библиотека QR');
    assert.ok(!/renderQr|qrcode\(/.test(app), 'код QR остался в app.js');
    assert.ok(!/Отсканируйте QR|отсканируйте QR/i.test(html), 'остался текст про сканирование');
    assert.ok(/Секрет хранится только на этом устройстве/.test(html), 'нет короткой подписи про секрет');
  });

  console.log(`\n${fail ? '✗' : '✓'} Тесты: ${pass} успешно, ${fail} с ошибками\n`);
  util.rmrf(TMP);
  process.exit(fail ? 1 : 0);
})();
