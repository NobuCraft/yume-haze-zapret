'use strict';
/* Тесты повышения прав (UAC), не требующие Windows/Electron */
const assert = require('assert');
const Module = require('module');

let passed = 0, failed = 0;
function t(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { passed++; console.log('  ✓ ' + name); })
    .catch(e => { failed++; console.log('  ✗ ' + name + ' — ' + e.message); });
}

/* ---------- хелперы, повторяющие логику main.js ---------- */
function deepLinkFrom(argv) {
  const raw = (argv || []).find(a => typeof a === 'string' && a.startsWith('yh-zapret://'));
  if (!raw) return null;
  const [name, value] = raw.replace('yh-zapret://', '').split('=');
  return { name: (name || '').replace(/\/+$/, ''), value: value === undefined ? null : decodeURIComponent(value) };
}

function makeElevation(util, { relaunchOk = true, accept = true } = {}) {
  const state = { dialog: 0, relaunch: null, quit: false };
  util.isAdmin = async () => false;
  util.relaunchElevated = async (args) => { state.relaunch = args; return { ok: relaunchOk }; };
  const dialog = {
    showMessageBox: async () => { state.dialog++; return { response: accept ? 0 : 1 }; }
  };
  let elevateAskAt = 0;
  async function requestElevation(action, { ask = true } = {}) {
    if (Date.now() - elevateAskAt < 12000) return { ok: false, error: 'Окно UAC уже открыто' };
    elevateAskAt = Date.now();
    if (ask) {
      const { response } = await dialog.showMessageBox();
      if (response !== 0) return { ok: false, error: 'Пользователь отменил повышение прав' };
    }
    const r = await util.relaunchElevated(['--elevated', `yh-zapret://${action}`], '.');
    if (r.ok) { state.quit = true; return { ok: true, restarted: true }; }
    return { ok: false, error: 'Запуск с правами администратора отменён' };
  }

  async function startZapret({ interactive = true, action = 'start' } = {}) {
    try {
      throw Object.assign(new Error('Нужны права администратора'), { code: 'ELEVATION_REQUIRED' });
    } catch (e) {
      if (!interactive) return { ok: false, code: 'ELEVATION_REQUIRED', error: e.message };
      const res = await requestElevation(action);
      return { ok: false, code: 'ELEVATION_REQUIRED', elevation: res, error: e.message };
    }
  }
  return { state, requestElevation, startZapret };
}

(async () => {
  console.log('Повышение прав (UAC):');
  const util = require('../src/util');

  await t('без прав возвращается код ELEVATION_REQUIRED и идёт перезапуск', async () => {
    const h = makeElevation(util);
    const r = await h.startZapret({ action: 'toggle' });
    assert.strictEqual(r.code, 'ELEVATION_REQUIRED');
    assert.strictEqual(r.elevation.restarted, true);
    assert.deepStrictEqual(h.state.relaunch, ['--elevated', 'yh-zapret://toggle']);
    assert.strictEqual(h.state.quit, true);
  });

  await t('отмена в диалоге — приложение продолжает работать', async () => {
    const h = makeElevation(util, { accept: false });
    const r = await h.startZapret();
    assert.strictEqual(r.elevation.ok, false);
    assert.match(r.elevation.error, /отменил/);
    assert.strictEqual(h.state.relaunch, null);
    assert.strictEqual(h.state.quit, false);
  });

  await t('отказ UAC (wine/групповые политики) не роняет приложение', async () => {
    const h = makeElevation(util, { relaunchOk: false });
    const r = await h.startZapret();
    assert.strictEqual(r.elevation.ok, false);
    assert.match(r.elevation.error, /отменён/);
  });

  await t('повторный вызов в течение 12 с не открывает второе окно UAC', async () => {
    const h = makeElevation(util);
    const r1 = await h.startZapret({ action: 'start' });
    const r2 = await h.startZapret({ action: 'start' });
    assert.strictEqual(r1.elevation.ok, true);
    assert.strictEqual(r2.elevation.ok, false);
    assert.match(r2.elevation.error, /уже открыто/);
    assert.strictEqual(h.state.dialog, 1);
  });

  await t('неинтерактивный автозапуск не показывает UAC', async () => {
    const h = makeElevation(util);
    const r = await h.startZapret({ interactive: false });
    assert.strictEqual(r.elevation, undefined);
    assert.strictEqual(h.state.dialog, 0);
  });

  await t('разбор отложенной команды из argv', async () => {
    assert.deepStrictEqual(deepLinkFrom(['app.exe', '--elevated', 'yh-zapret://restart']), { name: 'restart', value: null });
    assert.deepStrictEqual(deepLinkFrom(['app.exe', 'yh-zapret://start']), { name: 'start', value: null });
    assert.strictEqual(deepLinkFrom(['app.exe']), null);
  });

  await t('isAdmin не бросает исключение и возвращает булево', async () => {
    const v = await util.isAdmin({ force: true });
    assert.strictEqual(typeof v, 'boolean');
  });

  await t('start() в zapret помечает отсутствие прав как ELEVATION_REQUIRED', async () => {
    const zapret = require('../src/zapret');
    const src = require('fs').readFileSync(__dirname + '/../src/zapret.js', 'utf8');
    assert.ok(/ELEVATION_REQUIRED/.test(src), 'в zapret.js нет кода ELEVATION_REQUIRED');
    assert.ok(/isAdmin\(\)/.test(src), 'в zapret.start нет проверки прав');
    assert.strictEqual(typeof zapret.start, 'function');
  });

  console.log(`\n${failed ? '✗' : '✓'} Права администратора: ${passed} успешно, ${failed} с ошибками\n`);
  process.exit(failed ? 1 : 0);
})();
