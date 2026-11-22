'use strict';
/* Тесты запуска winws.exe и установки драйвера — ловят ошибки вида
   "sc is not defined" и "spawn ENOENT из-за кавычек в пути" */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

let passed = 0, failed = 0;
function t(name, fn) {
  return Promise.resolve().then(fn)
    .then(() => { passed++; console.log('  ✓ ' + name); })
    .catch(e => { failed++; console.log('  ✗ ' + name + ' — ' + e.message); });
}

const ROOT = path.join(__dirname, '..');
const util = require(path.join(ROOT, 'src/util'));
const config = require(path.join(ROOT, 'src/config'));

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'yh-spawn-'));
util.setPaths({
  userData: TMP, logs: path.join(TMP, 'logs'), cache: path.join(TMP, 'cache'),
  downloads: path.join(TMP, 'dl'), temp: path.join(TMP, 'tmp')
});
Object.values(util.paths()).forEach(util.ensureDir);
config.load();

const zapret = require(path.join(ROOT, 'src/zapret'));

(async () => {
  console.log('Запуск winws.exe и драйвер:');

  await t('в zapret.js импортирован sc (иначе «sc is not defined»)', async () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/zapret.js'), 'utf8');
    const imports = src.slice(0, src.indexOf("require('./config')"));
    assert.ok(/\bsc\b/.test(imports), 'sc не импортирован из ./util: ' + imports.slice(0, 200));
    assert.ok(/serviceState/.test(imports));
  });

  await t('функции драйвера вызываются без ReferenceError', async () => {
    // driverCheck вне Windows возвращает понятную ошибку, а не ReferenceError
    const r = await zapret.driverCheck();
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /Windows/i);
    const rm = await zapret.removeDriver();
    assert.strictEqual(rm.ok, false);
  });

  await t('spawn получает путь без кавычек (иначе ENOENT)', async () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/zapret.js'), 'utf8');
    assert.ok(/spawn\(exe,\s*argv/.test(src), 'ожидался spawn(exe, argv) с массивом токенов');
    assert.ok(!/spawn\(`"\$\{exe\}"`/.test(src), 'путь в кавычках ломает spawn на Windows');
    assert.ok(!/windowsVerbatimArguments/.test(src), 'аргументы должны идти массивом, без verbatim-строки');
  });

  await t('отсутствие winws.exe даёт понятную ошибку, а не ENOENT', async () => {
    const dir = path.join(TMP, 'zapret-broken');
    fs.mkdirSync(path.join(dir, 'bin'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'lists'), { recursive: true });
    fs.copyFileSync(path.join(ROOT, 'tests/fixtures/zapret/general.bat'), path.join(dir, 'general.bat'));
    config.patch({ zapret: { installDir: dir } });
    const r = await zapret.spawnWinws('general.bat', { wait: 300 });
    assert.strictEqual(r.ok, false);
    assert.match(r.output, /не найден/i);
    assert.ok(!/ENOENT/.test(r.output), 'не должно быть ENOENT');
  });

  await t('в аргументах нет обрамляющих кавычек и висящих пробелов', async () => {
    for (const f of fs.readdirSync(path.join(ROOT, 'tests/fixtures/zapret')).filter(n => n.endsWith('.bat'))) {
      if (/^service/.test(f)) continue;
      const raw = zapret.parseBatArgs(f, path.join(ROOT, 'tests/fixtures/zapret'));
      const argv = Array.isArray(raw) ? raw : zapret.tokenizeArgs(raw);
      assert.ok(argv[0].startsWith('--'), f + ': аргументы начинаются с ' + JSON.stringify(argv.slice(0, 3)));
      assert.ok(argv.length > 20, f + ': слишком мало аргументов (' + argv.length + ')');
      assert.ok(!argv.some(x => x.includes('"')), f + ': в токенах остались кавычки');
      assert.ok(argv[0].startsWith('--wf-'), f + ': первый токен ' + JSON.stringify(argv[0]));
    }
  });

  await t('токенизация: кавычки группируют пути, кавычек в токенах нет', async () => {
    const argv = zapret.tokenizeArgs('--hostlist="C:\\path with space\\a.txt" --new --x=1');
    assert.deepStrictEqual(argv.slice(0, 2), ['--hostlist=C:\\path with space\\a.txt', '--new']);
    assert.ok(!argv.some(x => x.includes('"')), 'в токенах остались кавычки');
    assert.strictEqual(argv.length, 3);
  });

  await t('недостающие списки создаются (иначе winws падает на ipset-exclude)', async () => {
    const dir = path.join(TMP, 'zapret-lists');
    fs.mkdirSync(dir + '/lists', { recursive: true });
    const r = zapret.ensureUserLists(dir);
    for (const f of ['ipset-exclude.txt', 'ipset-all.txt', 'list-general.txt', 'list-general-user.txt']) {
      assert.ok(fs.existsSync(path.join(dir, 'lists', f)), 'не создан ' + f);
    }
    assert.ok(Array.isArray(r.missing), 'нет отчёта о пустых списках');
  });

  await t('аргументы — массив, первый --wf-tcp, мусора из .bat нет', async () => {
    const raw = zapret.parseBatArgs('general.bat', path.join(ROOT, 'tests/fixtures/zapret'));
    assert.ok(Array.isArray(raw), 'parseBatArgs должен возвращать массив');
    assert.ok(raw[0].startsWith('--wf-tcp='), 'первый аргумент: ' + raw[0]);
    const junk = raw.filter(a => /^(call|set|cd|echo|start|chcp|::)/i.test(a));
    assert.deepStrictEqual(junk, [], 'в аргументы попали строки .bat: ' + junk.join(' | '));
    assert.ok(!raw.some(a => /service\.bat/i.test(a)), 'в аргументах вызов service.bat');
  });

  await t('строки service.bat из шапки стратегии не попадают в аргументы', async () => {
    // .bat с вызовами service.bat ДО запуска winws.exe — типичный случай
    const dir = path.join(TMP, 'zapret-junk');
    fs.mkdirSync(path.join(dir, 'bin'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'lists'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'junk.bat'),
      '@echo off\r\ncall service.bat status_zapret\r\nset "BIN=%~dp0bin\\"\r\n' +
      'start "x" /min "%BIN%winws.exe" --wf-tcp=80,443 --wf-udp=443 ^\r\n' +
      '--filter-tcp=443 --dpi-desync=fake --new ^\r\n--filter-udp=443 --dpi-desync=fake\r\n' +
      'call service.bat load_game_filter\r\n');
    const argv = zapret.parseBatArgs('junk.bat', dir);
    assert.deepStrictEqual(argv.slice(0, 2), ['--wf-tcp=80,443', '--wf-udp=443']);
    assert.ok(argv.includes('--filter-udp=443'), 'потеряна последняя строка: ' + argv.join(' '));
    assert.ok(!argv.some(a => /service\.bat|load_game_filter|BIN=/i.test(a)), 'мусор: ' + argv.join(' '));
  });

  await t('режим без драйвера: служба не создаётся руками, а убирается', async () => {
    assert.strictEqual(typeof zapret.removeConflictingDriver, 'function');
    assert.strictEqual(typeof zapret.driverServiceInfo, 'function');
    assert.strictEqual(typeof zapret.startAsService, 'function');
    assert.strictEqual(typeof zapret.verifyDriverLoads, 'function');
    const src = fs.readFileSync(path.join(ROOT, 'src/zapret.js'), 'utf8');
    const body = src.slice(src.indexOf('async function driverCheck'), src.indexOf('async function verifyDriverLoads'));
    assert.ok(!/sc\(\['create'/.test(body), 'driverCheck не должен создавать службу через sc create');
    assert.ok(/removeConflictingDriver/.test(body), 'driverCheck должен убирать чужую службу');
    assert.match(src, /драйвер загрузит сам winws\.exe/i);
  });

  await t('причина падения распознаётся по выводу winws.exe', async () => {
    const cases = [
      ['error opening filter: The system cannot find the file specified.', /\.bin/i],
      ['Windivert: failed to open device: Access is denied', /WinDivert/i],
      ['wrong parameter: --dpi-desync=x', /параметр/i]
    ];
    for (const [out, re] of cases) {
      const hint = zapret.explainOutput(out);
      assert.ok(hint && re.test(hint), 'нет расшифровки для: ' + out);
    }
  });

  await t('подсказка о драйвере для not-installed и STOPPED', async () => {
    assert.match(zapret.driverMissingHint('not-installed'), /winws\.exe|Разложить драйвер/);
    assert.strictEqual(zapret.driverMissingHint('RUNNING'), null);
    assert.match(zapret.driverMissingHint('STOPPED'), /Убрать службу/i);
  });

  await t('preflight сообщает про несозданную службу WinDivert', async () => {
    const pf = await zapret.preflight();
    assert.ok('problems' in pf && 'driver' in pf);
    // на Linux driver = unavailable, проблем нет — главное, что не падает
    assert.strictEqual(typeof pf.ok, 'boolean');
  });

  await t('driverDiagnostics возвращает файлы и службу', async () => {
    const dir = path.join(TMP, 'zapret-ok');
    fs.mkdirSync(path.join(dir, 'bin'), { recursive: true });
    fs.copyFileSync(path.join(ROOT, 'tests/fixtures/zapret/bin/winws.exe'), path.join(dir, 'bin/winws.exe'));
    fs.writeFileSync(path.join(dir, 'bin/WinDivert64.sys'), 'stub');
    fs.writeFileSync(path.join(dir, 'bin/WinDivert.dll'), 'stub');
    config.patch({ zapret: { installDir: dir } });
    const d = await zapret.driverDiagnostics();
    assert.ok(d.sys.exists && d.dll.exists);
    assert.strictEqual(d.sys.size, 4);
    assert.ok('service' in d);
  });

  await t('ни одна команда не показывает консольных окон (windowsHide)', async () => {
    for (const rel of ['src/util.js', 'src/zapret.js', 'src/tgws.js', 'src/updates.js', 'src/net.js', 'main.js'].filter(f => fs.existsSync(path.join(ROOT, f)))) {
      const src = fs.readFileSync(path.join(ROOT, rel), 'utf8')
        .replace(/function\s+(exec|spawn|spawnWinws|spawnViaBat|execConsole)\s*\([^)]*\)/g, 'fn');
      // exec() сам подставляет windowsHide, а вот прямые execFile/spawn — нет
      // смотрим на 400 символов после вызова — там лежат опции процесса
      const re = /\b(execFile|execFileSync|spawn)\(/g;
      let m;
      while ((m = re.exec(src))) {
        const chunk = src.slice(m.index, m.index + 400);
        assert.ok(/windowsHide\s*:\s*true/.test(chunk) || /execConsole/.test(chunk),
          `${rel}: команда без windowsHide → ${chunk.slice(0, 90).replace(/\s+/g, ' ')}`);
      }
    }
    // общий exec в util.js не должен позволять перетереть windowsHide
    const util = fs.readFileSync(path.join(ROOT, 'src/util.js'), 'utf8');
    assert.match(util, /windowsHide:\s*true,\s*timeout/);
  });

  await t('режим службы повторяет service.bat, но не запускает .bat (без окон)', async () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/zapret.js'), 'utf8');
    const body = src.slice(src.indexOf('async function startAsService'), src.indexOf('/* Информация о службе драйвера'));
    assert.ok(!/service\.bat/.test(body), 'startAsService не должен вызывать service.bat');
    assert.match(body, /'sc\.exe', \['create', 'zapret'/);
    assert.match(body, /winws\.exe/i, 'в службу должен передаваться путь к winws.exe');
  });

  await t('ошибка 123 объясняется и попадает в расшифровку кодов', async () => {
    assert.match(zapret.explainExit(123), /WinDivert|драйвер/i);
    assert.ok(zapret.driverErrorHint('123'));
    assert.strictEqual(zapret.explainExit(0), null);
  });

  await t('вывод sc.exe перекодируется из cp866 без кракозябр', async () => {
    const raw = 'StartService: \u043e\u0448\u0438\u0431\u043a\u0430 123';
    const out = zapret.decodeConsole(raw);
    assert.ok(/[а-яё]/i.test(out), 'нет читаемого текста: ' + out);
    assert.ok(!/\uFFFD/.test(out));
  });

  await t('драйвер не принадлежит приложению: нет vendor, нет установки', async () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/zapret.js'), 'utf8');
    assert.ok(!/vendorDir|ensureVendorDriver|vendorDriverInfo/.test(src), 'остались функции встроенного драйвера');
    assert.ok(!/async function installDriver/.test(src), 'installDriver должен быть заменён на driverCheck');
    assert.ok(/async function driverCheck/.test(src), 'нет driverCheck');
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    assert.ok(!(pkg.build.files || []).some(f => /vendor/.test(f)), 'vendor всё ещё в сборке');
    assert.ok(!fs.existsSync(path.join(ROOT, 'vendor')), 'папка vendor не удалена');
    // драйвер берётся только из папки Zapret
    const body = src.slice(src.indexOf('function driverFile'), src.indexOf('async function driverState'));
    assert.match(body, /path\.join\(d, 'bin', 'WinDivert64\.sys'\)/);
    assert.ok(!/vendor/.test(body), 'driverFile всё ещё смотрит во встроенные файлы');
  });

  await t('Zapret по-прежнему скачивается с GitHub и обновляется', async () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/zapret.js'), 'utf8');
    assert.match(src, /releases\/download\/\$\{ZAPRET_VERSION\}/, 'потерян адрес релиза Flowseal');
    assert.match(src, /github\.com\/Flowseal\/zapret-discord-youtube/, 'нет ссылки на Flowseal');
    assert.ok(!/bundlezap/.test(src), 'не должно быть вшитого Zapret');
    assert.ok(!fs.existsSync(path.join(ROOT, 'bundlezap')), 'папка bundlezap не удалена');
  });

  await t('нет запуска .bat стратегии (он мелькает окном)', async () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/zapret.js'), 'utf8');
    assert.ok(!/spawnViaBat/.test(src), 'запуск через .bat должен быть удалён');
    assert.ok(!/cmd\.exe', \['\/c', 'call'/.test(src), 'нельзя вызывать cmd /c call <bat>');
    assert.ok(/повторная попытка прямого запуска/.test(src), 'нужен повторный прямой запуск');
  });

  await t('IPC-каналы драйвера объявлены в main.js и preload.js', async () => {
    const main = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
    const pre = fs.readFileSync(path.join(ROOT, 'preload.js'), 'utf8');
    for (const ch of ['zapret:driver', 'zapret:driverCheck', 'zapret:driverFix', 'zapret:startAsService', 'zapret:preflight']) {
      assert.ok(main.includes(ch), 'нет канала ' + ch);
    }
    for (const fn of ['driver:', 'checkDriver:', 'driverFix:', 'preflight:']) {
      assert.ok(pre.includes(fn), 'нет метода preload ' + fn);
    }
  });

  await t('драйвер есть в разделе «Обновления»', async () => {
    const app = fs.readFileSync(path.join(ROOT, 'renderer/app.js'), 'utf8');
    assert.ok(/Драйвер WinDivert/.test(app), 'нет карточки драйвера в компонентах');
    assert.ok(/data-act="drvFix"/.test(app), 'нет кнопки «Починить» в карточке');
    assert.ok(!/data-act="drvInstall"/.test(app), 'осталась установка драйвера из приложения');
    assert.ok(/в архиве Zapret/.test(app), 'не сказано, откуда берётся драйвер');
  });

  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(`\n${failed ? '✗' : '✓'} Запуск и драйвер: ${passed} успешно, ${failed} с ошибками\n`);
  process.exit(failed ? 1 : 0);
})();
