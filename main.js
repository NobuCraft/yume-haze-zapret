'use strict';
/* Yume Haze Zapret — главный процесс */
const { app, BrowserWindow, Tray, Menu, ipcMain, shell, clipboard, Notification, nativeImage, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

const util = require('./src/util');
const config = require('./src/config');
const log = require('./src/logger');
const zapret = require('./src/zapret');
const tgws = require('./src/tgws');
const net = require('./src/net');
const updates = require('./src/updates');

const IS_WIN = process.platform === 'win32';
let win = null;
let tray = null;
let quitting = false;
let loginItemState = null;

app.setName('Yume Haze Zapret');
if (process.platform === 'win32') app.setAppUserModelId('app.yumehaze.zapret');

/* ---------- единичный экземпляр ---------- */
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    showWindow();
    const cmd = deepLinkFrom(argv);
    if (cmd) runDeepLink(cmd);
  });
}

/* ---------- пути ---------- */
function initPaths() {
  const userData = app.getPath('userData');
  const p = {
    userData,
    logs: path.join(userData, 'logs'),
    cache: path.join(userData, 'cache'),
    downloads: path.join(userData, 'downloads'),
    temp: path.join(userData, 'temp')
  };
  for (const v of Object.values(p)) util.ensureDir(v);
  util.setPaths(p);
  return p;
}

/* ---------- окно ---------- */
function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 1040,
    minHeight: 680,
    show: false,
    frame: false,
    backgroundColor: '#0a0912',
    title: 'Yume Haze Zapret',
    icon: path.join(__dirname, 'res', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false
    }
  });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  let shown = false;
  const reveal = () => {
    if (shown) return;
    shown = true;
    const cfg = config.get();
    const hiddenArg = process.argv.includes('--hidden') || process.argv.includes('--autostart');
    if (cfg.app.startMinimized || hiddenArg) { win.hide(); } else { showWindow(); }
    pushState();
  };
  win.once('ready-to-show', reveal);
  // страховка: на части драйверов/в удалённом сеансе ready-to-show может не прийти
  setTimeout(reveal, 2500);

  win.on('close', e => {
    const cfg = config.get();
    if (!quitting && cfg.app.closeToTray) {
      e.preventDefault();
      win.hide();
      notify('Yume Haze свернут в трей', 'Службы продолжают работать в фоне');
    }
  });
  win.on('closed', () => { win = null; });
  win.on('maximize', () => send('ui:maximized', { maximized: true }));
  win.on('unmaximize', () => send('ui:maximized', { maximized: false }));
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

function showWindow() {
  if (!win) return createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) {
    try { win.webContents.send(channel, payload); } catch (_) {}
  }
}

function notify(title, body) {
  if (!config.get().app.notifications || !Notification.isSupported()) return;
  try { new Notification({ title, body, icon: path.join(__dirname, 'res', 'icon.ico') }).show(); } catch (_) {}
}

/* ---------- трей ---------- */
function trayIcon() {
  const p = path.join(__dirname, 'renderer', 'assets', 'tray.png');
  const img = nativeImage.createFromPath(p);
  return img.isEmpty() ? nativeImage.createEmpty() : img.resize({ width: 16, height: 16 });
}

function buildTray() {
  if (tray) { tray.destroy(); tray = null; }
  const cfg = config.get();
  tray = new Tray(trayIcon());
  tray.setToolTip('Yume Haze Zapret');
  const rebuild = async () => { await refreshTray(); };
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Yume Haze Zapret', enabled: false },
    { type: 'separator' },
    { label: 'Открыть окно', click: () => showWindow() },
    { type: 'separator' },
    { label: 'Zapret: включить', click: async () => { try { await startZapret(); } catch (e) { log.error('ZAPRET', e.message); } await rebuild(); } },
    { label: 'Zapret: выключить', click: async () => { await zapret.stop(); await rebuild(); } },
    { label: 'Zapret: перезапустить', click: async () => { try { await (await util.isAdmin()) ? zapret.restart() : startZapret({ action: 'restart' }); } catch (e) { log.error('ZAPRET', e.message); } await rebuild(); } },
    { type: 'separator' },
    { label: 'TG WS Proxy: включить', click: async () => { try { await tgws.start(); } catch (e) { log.error('TG', e.message); } await rebuild(); } },
    { label: 'TG WS Proxy: выключить', click: async () => { await tgws.stop(); await rebuild(); } },
    { label: 'Копировать ссылку прокси', click: () => { clipboard.writeText(tgws.link()); notify('Ссылка скопирована', tgws.link()); } },
    { type: 'separator' },
    { label: 'Быстрая проверка доступности', click: async () => { try { const r = await net.quickTest({ scope: 'fast' }); notify('Проверка завершена', `${r.score}/100 · ${r.services.map(s => s.name + ' ' + s.ok + '/' + s.total).join(', ')}`); pushState(); } catch (e) { log.error('TEST', e.message); } } },
    { label: 'Открыть журнал', click: () => { showWindow(); setTimeout(() => send('nav:go', { page: 'console' }), 350); } },
    { type: 'separator' },
    { label: 'Выход', click: () => { quitting = true; app.quit(); } }
  ]));
  tray.on('double-click', () => showWindow());
  tray.on('click', () => showWindow());
}

async function refreshTray() {
  try {
    buildTray();
    if (!win || win.isDestroyed()) return;
    const cfg = config.get();
    const [z, t] = await Promise.all([zapret.status(), tgws.status()]);
    const tip = `Yume Haze Zapret\nZapret: ${z.running ? 'включён' : 'выключен'}${z.installed ? ' · ' + z.strategy : ' · не установлен'}\nПрокси: ${t.running ? 'включён' : 'выключен'} · порт ${cfg.tg.port}`;
    if (tray) {
      tray.setToolTip(tip);
      const menu = Menu.buildFromTemplate([
        { label: 'Yume Haze Zapret', enabled: false },
        { label: 'Открыть окно', click: () => showWindow() },
        { type: 'separator' },
        { label: (z.running ? '✓ ' : '') + 'Zapret включён', click: async () => { try { await startZapret({ action: 'toggle' }); } catch (e) { log.error('ZAPRET', e.message); } refreshTray(); pushState(); } },
        { label: (z.running ? 'Остановить Zapret' : '— Zapret выключен'), enabled: z.running, click: async () => { await zapret.stop(); refreshTray(); pushState(); } },
        { label: (t.running ? 'Остановить прокси' : 'Включить TG WS Proxy'), click: async () => {
            try { t.running ? await tgws.stop() : await tgws.start(); } catch (e) { log.error('TG', e.message); }
            refreshTray(); pushState();
          } },
        { label: 'Копировать ссылку прокси', click: () => { clipboard.writeText(tgws.link()); notify('Ссылка скопирована', tgws.link()); } },
        { type: 'separator' },
        { label: 'Быстрая проверка доступности', click: async () => {
            try { const r = await net.quickTest({ scope: 'fast' }); notify('Проверка: ' + r.score + '/100', r.services.map(s => s.name + ' ' + s.ok + '/' + s.total).join(' · ')); pushState(); }
            catch (e) { log.error('TEST', e.message); }
          } },
        { label: 'Открыть журнал', click: () => { showWindow(); setTimeout(() => send('nav:go', { page: 'console' }), 350); } },
        { type: 'separator' },
        { label: 'Выход', click: () => { quitting = true; app.quit(); } }
      ]);
      tray.setContextMenu(menu);
    }
  } catch (_) {}
}

/* ---------- состояние ---------- */
let pushTimer = null;
function pushState() {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(async () => {
    try {
      const [z, t] = await Promise.all([zapret.status(), tgws.status()]);
      let drv = null;
      try { drv = await zapret.driverDiagnostics(); } catch (_) { drv = null; }
      send('state', {
        zapret: z, tg: t, settings: config.get(), logs: log.list(),
        update: updateInfo ? updates.pendingCount(updateInfo) : 0,
        admin: await util.isAdmin(),
        driver: drv ? { service: drv.service, version: drv.sys && drv.sys.version, sys: drv.sys, dll: drv.dll, signature: drv.signature, running: drv.running, ok: drv.ok, hint: drv.hint } : null
      });
    } catch (e) { log.error('APP', 'состояние: ' + e.message); }
  }, 120);
}

let updateInfo = null;

/* ---------- IPC ---------- */
function ok(data = {}) { return { ok: true, ...data }; }
function fail(e) {
  const msg = typeof e === 'string' ? e : (e && e.message ? e.message : String(e));
  log.error('ERR', msg);
  return { ok: false, error: msg };
}

function wrap(fn) {
  return async (_e, ...args) => {
    try { return await fn(...args); } catch (e) { return fail(e); }
  };
}

/* ---------- повышение прав (UAC) ---------- */
let pendingAction = null;   // команда, которую выполним после перезапуска от админа
let elevateAskAt = 0;       // чтобы не спамить UAC

function deepLinkFrom(argv) {
  const raw = (argv || []).find(a => typeof a === 'string' && a.startsWith('yh-zapret://'));
  if (!raw) return null;
  const [name, value] = raw.replace('yh-zapret://', '').split('=');
  return { name: (name || '').replace(/\/+$/, ''), value: value === undefined ? null : decodeURIComponent(value) };
}

async function runDeepLink(cmd) {
  if (!cmd) return;
  log.info('APP', `Команда от предыдущего экземпляра: ${cmd.name}${cmd.value ? ' ' + cmd.value : ''}`);
  try {
    if (cmd.name === 'start') await startZapret();
    else if (cmd.name === 'restart') { await startZapret({ interactive: false, action: 'restart' }) || await zapret.restart(); pushState(); refreshTray(); }
    else if (cmd.name === 'toggle') { await startZapret(); }
    else if (cmd.name === 'driver') {
      const r = await zapret.driverCheck();
      log.info('ZAPRET', r.ok ? 'Драйвер WinDivert проверен: работает' : 'Драйвер: ' + r.error);
      if (r.ok && config.get().zapret.autostartServices) await startZapret({ interactive: false });
      pushState();
    }
  } catch (e) { log.error('ERR', e.message); }
}

/* Запускает Zapret; при нехватке прав — предлагает UAC и перезапускает приложение
   уже с правами, передавая ему отложенную команду. */
async function startZapret({ interactive = true, action = 'start' } = {}) {
  try {
    const r = await zapret.start();
    pushState(); refreshTray();
    return r;
  } catch (e) {
    if (e.code !== 'ELEVATION_REQUIRED') throw e;
    log.warn('APP', 'Нет прав администратора — требуется повышение (UAC)');
    if (!interactive) return { ok: false, code: 'ELEVATION_REQUIRED', error: e.message };
    const res = await requestElevation(action);
    return { ok: false, code: 'ELEVATION_REQUIRED', elevation: res, error: e.message };
  }
}

async function requestElevation(action, { ask = true } = {}) {
  if (!IS_WIN) return { ok: false, error: 'Повышение прав доступно только в Windows' };
  if (Date.now() - elevateAskAt < 12000) return { ok: false, error: 'Окно UAC уже открыто' };
  elevateAskAt = Date.now();

  if (ask) {
    const { response } = await dialog.showMessageBox(win || undefined, {
      type: 'question',
      title: 'Нужны права администратора',
      message: 'Zapret (winws.exe) загружает драйвер WinDivert — без прав администратора Windows пищит и обход не запускается.',
      detail: 'Перезапустить Yume Haze с правами администратора? Приложение сохранит состояние и сразу включит Zapret.',
      buttons: ['Перезапустить с правами', 'Отмена'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
      icon: nativeImage.createFromPath(path.join(__dirname, 'res', 'icon.png'))
    });
    if (response !== 0) return { ok: false, error: 'Пользователь отменил повышение прав' };
  }

  log.info('APP', 'Перезапуск с правами администратора (UAC)…');
  const r = await util.relaunchElevated(['--elevated', `yh-zapret://${action}`], __dirname);
  if (r.ok) {
    quitting = true;
    setTimeout(() => app.quit(), 400);
    return { ok: true, restarted: true };
  }
  log.warn('APP', 'UAC отменён или недоступен: ' + String(r.stderr || r.stdout || '').slice(0, 200));
  return { ok: false, error: 'Запуск с правами администратора отменён' };
}

function registerIpc() {
  /* общее */
  ipcMain.handle('app:elevate', wrap(async (action) => ok(await requestElevation(action || 'start'))));
  ipcMain.handle('app:info', wrap(async () => ok({
    version: require('./package.json').version,
    platform: process.platform,
    admin: await util.isAdmin(),
    paths: util.paths(),
    zapretVersion: zapret.ZAPRET_VERSION,
    strategies: require('./src/assets/strategies').STRATEGIES.length,
    tgVersion: tgws.installedVersion() || tgws.PINNED_VERSION
  })));

  ipcMain.handle('app:state', wrap(async () => {
    const [z, t] = await Promise.all([zapret.status(), tgws.status()]);
    let drv = null;
    try { drv = await zapret.driverDiagnostics(); } catch (_) {}
    return ok({
      zapret: z, tg: t, settings: config.get(), logs: log.list(),
      update: updateInfo ? updates.pendingCount(updateInfo) : 0,
      admin: await util.isAdmin(),
      driver: drv ? { service: drv.service, version: drv.sys && drv.sys.version, sys: drv.sys, dll: drv.dll, signature: drv.signature, running: drv.running, ok: drv.ok, hint: drv.hint } : null
    });
  }));

  ipcMain.handle('ui:minimize', () => { win && win.minimize(); return ok(); });
  ipcMain.handle('ui:maximize', () => {
    if (!win) return ok();
    win.isMaximized() ? win.unmaximize() : win.maximize();
    return ok({ maximized: win.isMaximized() });
  });
  ipcMain.handle('ui:close', () => {
    const cfg = config.get();
    if (cfg.app.closeToTray) { win && win.hide(); return ok({ hidden: true }); }
    quitting = true; app.quit(); return ok({ hidden: false });
  });

  ipcMain.handle('shell:open', wrap(async (url) => {
    if (!/^(https?:|tg:|mailto:)/i.test(String(url))) throw new Error('Ссылка не разрешена');
    await shell.openExternal(url);
    log.info('APP', 'Открыта ссылка: ' + url);
    return ok();
  }));
  ipcMain.handle('clipboard:write', wrap(async (text) => { clipboard.writeText(String(text || '')); return ok(); }));
  ipcMain.handle('shell:showItem', wrap(async (p) => { shell.showItemInFolder(p); return ok(); }));
  ipcMain.handle('shell:openPath', wrap(async (p) => { if (fs.existsSync(p)) shell.openPath(p); return ok(); }));
  ipcMain.handle('dialog:dir', wrap(async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
    return ok({ path: r.canceled ? null : r.filePaths[0] });
  }));

  /* настройки */
  ipcMain.handle('settings:get', wrap(async () => ok({ settings: config.get() })));
  ipcMain.handle('settings:patch', wrap(async (patch) => {
    const cfg = config.patch(patch);
    // настройки TG влияют на запущенный прокси — перезапускаем, чтобы config.json обновился
    if (patch && patch.tg) {
      try {
        const t = await tgws.status();
        if (t.running) {
          log.info('TG', 'Настройки прокси изменены — перезапускаю');
          await tgws.restart();
          pushState();
        }
      } catch (e) { log.warn('TG', 'Перезапуск после смены настроек: ' + e.message); }
    }
    if (patch && patch.app && 'runAtLogin' in patch.app) applyLoginItem(cfg.app.runAtLogin);
    if (patch && patch.app && 'closeToTray' in patch.app) { /* применяется при закрытии */ }
    log.info('APP', 'Настройки сохранены');
    pushState();
    return ok({ settings: cfg });
  }));
  ipcMain.handle('settings:reset', wrap(async (section) => {
    const cfg = config.reset(section);
    applyLoginItem(cfg.app.runAtLogin);
    log.warn('APP', section ? `Сброшены настройки раздела ${section}` : 'Сброшены все настройки');
    pushState();
    return ok({ settings: cfg });
  }));

  /* zapret */
  ipcMain.handle('zapret:status', wrap(async () => ok({ status: await zapret.status() })));
  ipcMain.handle('zapret:start', wrap(async () => {
    const r = await startZapret();
    if (r && r.ok === false && r.output) log.tech('ZAPRET', 'вывод winws.exe: ' + String(r.output).slice(0, 1500));
    return ok(r);
  }));
  ipcMain.handle('zapret:stop', wrap(async () => {
    const r = await zapret.stop();
    pushState(); refreshTray();
    return ok(r);
  }));
  ipcMain.handle('zapret:restart', wrap(async () => {
    log.info('ZAPRET', 'Перезапуск…');
    if (!(await util.isAdmin())) return ok(await startZapret({ action: 'restart' }));
    const r = await zapret.restart();
    pushState(); refreshTray();
    return ok(r);
  }));
  ipcMain.handle('zapret:toggle', wrap(async (on) => {
    const r = on ? await startZapret({ action: 'toggle' }) : await zapret.stop();
    pushState(); refreshTray();
    return ok(r);
  }));
  ipcMain.handle('zapret:setStrategy', wrap(async (file) => {
    const r = await zapret.setStrategy(file);
    pushState();
    return ok(r);
  }));
  ipcMain.handle('zapret:gameFilter', wrap(async (gf) => {
    const r = await zapret.setGameFilter(gf);
    pushState();
    return ok(r);
  }));
  ipcMain.handle('zapret:ipset', wrap(async (mode) => {
    const r = await zapret.setIpsetMode(mode);
    pushState();
    return ok(r);
  }));
  ipcMain.handle('zapret:updateIpset', wrap(async () => { const r = await zapret.updateIpset(); pushState(); return ok(r); }));
  ipcMain.handle('zapret:updateHosts', wrap(async () => ok(await zapret.updateHosts({ apply: false }))));
  ipcMain.handle('zapret:readList', wrap(async (kind) => ok({ text: zapret.readList(kind) })));
  ipcMain.handle('zapret:writeList', wrap(async (kind, text) => { const r = await zapret.writeList(kind, text); pushState(); return ok(r); }));
  ipcMain.handle('zapret:installService', wrap(async () => { const r = await zapret.installService(); pushState(); return ok(r); }));
  ipcMain.handle('zapret:removeService', wrap(async () => { const r = await zapret.removeService(); pushState(); return ok(r); }));
  ipcMain.handle('zapret:clearDiscord', wrap(async () => { const r = await zapret.clearDiscordCache(); return ok(r); }));
  ipcMain.handle('zapret:preflight', wrap(async () => ok(await zapret.preflight())));
  ipcMain.handle('zapret:lastRun', wrap(async () => ok({ run: zapret.lastRunInfo() })));
  ipcMain.handle('zapret:revealBat', wrap(async (file) => {
    const p = zapret.batPath(file || config.get().zapret.strategy);
    shell.showItemInFolder(p);
    return ok({ path: p });
  }));
  ipcMain.handle('zapret:driver', wrap(async () => ok(await zapret.driverDiagnostics())));
  ipcMain.handle('zapret:driverCheck', wrap(async () => {
    try {
      const r = await zapret.driverCheck();
      pushState();
      return ok(r);
    } catch (e) {
      if (e.code === 'ELEVATION_REQUIRED') {
        const el = await requestElevation('driver');
        return ok({ ok: false, code: 'ELEVATION_REQUIRED', elevation: el, error: e.message });
      }
      throw e;
    }
  }));
  // «Убрать службу и перезапустить»: удаляем мешающую службу WinDivert и сразу
  // стартуем стратегию — драйвер загрузит сам winws.exe.
  ipcMain.handle('zapret:driverFix', wrap(async () => {
    try {
      const fix = await zapret.removeConflictingDriver();
      log.info('APP', 'Служба WinDivert: ' + (fix.ok ? 'удалена' : `осталась (${fix.state})`));
      const r = await startZapret();
      pushState(); refreshTray();
      return ok({ ...r, fix });
    } catch (e) {
      if (e.code === 'ELEVATION_REQUIRED') {
        const el = await requestElevation('driver');
        return ok({ ok: false, code: 'ELEVATION_REQUIRED', elevation: el, error: e.message });
      }
      throw e;
    }
  }));
  // «Запустить через службу Windows» — запуск без опоры на драйвер, установленный вручную
  ipcMain.handle('zapret:startAsService', wrap(async () => {
    try {
      const r = await zapret.startAsService(config.get().zapret.strategy);
      pushState(); refreshTray();
      return ok(r);
    } catch (e) {
      if (e.code === 'ELEVATION_REQUIRED') {
        const el = await requestElevation('zapret');
        return ok({ ok: false, code: 'ELEVATION_REQUIRED', elevation: el, error: e.message });
      }
      throw e;
    }
  }));
  ipcMain.handle('zapret:diagnostics', wrap(async () => ok(await zapret.diagnostics())));
  ipcMain.handle('zapret:checkUpdates', wrap(async (on) => ok(zapret.toggleCheckUpdates(!!on))));
  ipcMain.handle('zapret:detect', wrap(async () => ok(zapret.detectExisting())));
  ipcMain.handle('zapret:setDir', wrap(async (dir) => {
    if (dir && !fs.existsSync(path.join(dir, 'bin', 'winws.exe')) && !fs.existsSync(dir)) throw new Error('Папка не существует');
    config.patch({ zapret: { installDir: dir || null, binPath: null } });
    log.info('ZAPRET', 'Папка zapret: ' + (dir || 'по умолчанию'));
    pushState();
    return ok({ dir: zapret.dir() });
  }));
  ipcMain.handle('zapret:install', wrap(async () => {
    const r = await zapret.install({ onProgress: p => send('progress', { target: 'zapret', ...p }) });
    pushState();
    return ok(r);
  }));

  /* tg ws proxy */
  ipcMain.handle('tg:status', wrap(async () => ok({ status: await tgws.status() })));
  ipcMain.handle('tg:start', wrap(async () => {
    const r = await tgws.start();
    pushState(); refreshTray();
    return ok(r);
  }));
  ipcMain.handle('tg:stop', wrap(async () => { const r = await tgws.stop(); pushState(); refreshTray(); return ok(r); }));
  ipcMain.handle('tg:restart', wrap(async () => { const r = await tgws.restart(); pushState(); return ok(r); }));
  ipcMain.handle('tg:toggle', wrap(async (on) => {
    const r = on ? await tgws.start() : await tgws.stop();
    pushState(); refreshTray();
    return ok(r);
  }));
  ipcMain.handle('tg:save', wrap(async (patch) => { const r = await tgws.saveSettings(patch); pushState(); return ok(r); }));
  ipcMain.handle('tg:newSecret', wrap(async () => { const r = await tgws.newSecret(); pushState(); return ok(r); }));
  ipcMain.handle('tg:link', wrap(async () => ok({ link: tgws.link(), linkEe: tgws.link({ ee: true }) })));
  ipcMain.handle('tg:copyLink', wrap(async () => { clipboard.writeText(tgws.link()); log.info('TG', 'Ссылка скопирована'); return ok({ link: tgws.link() }); }));
  ipcMain.handle('tg:openTelegram', wrap(async () => {
    await shell.openExternal(tgws.link());
    log.info('TG', 'Открываю ссылку в Telegram');
    return ok();
  }));
  ipcMain.handle('tg:pingDc', wrap(async () => ok(await tgws.pingDc())));
  ipcMain.handle('tg:dcStatus', wrap(async () => ok(await tgws.dcStatus())));
  ipcMain.handle('tg:diagnostics', wrap(async () => ok(await tgws.diagnostics())));
  ipcMain.handle('tg:install', wrap(async () => {
    const r = await tgws.install({ onProgress: p => send('progress', { target: 'tg', ...p }) });
    pushState();
    return ok(r);
  }));
  ipcMain.handle('tg:setPath', wrap(async (p) => {
    config.patch({ tg: { binPath: p || null } });
    pushState();
    return ok({ path: tgws.bin() });
  }));

  /* тесты */
  ipcMain.handle('test:quick', wrap(async (scope) => {
    const r = await net.quickTest({ scope: scope || 'all' });
    pushState();
    return ok(r);
  }));
  ipcMain.handle('test:pick', wrap(async (opts) => {
    const p = await net.autoPick(opts || {});
    pushState();
    return ok({ pick: p });
  }));
  ipcMain.handle('test:pickStop', wrap(async () => ok(net.pickStop())));
  ipcMain.handle('test:pickState', wrap(async () => ok(net.getPickState())));
  ipcMain.handle('test:history', wrap(async () => ok(net.history())));
  ipcMain.handle('test:historyClear', wrap(async (what) => ok(net.historyClear(what))));
  ipcMain.handle('test:applyStrategy', wrap(async (file) => { const r = await net.applyStrategy(file); pushState(); return ok(r); }));

  /* обновления */
  ipcMain.handle('updates:check', wrap(async (force) => {
    updateInfo = await updates.check({ force: !!force });
    pushState();
    return ok({ info: updateInfo });
  }));
  ipcMain.handle('updates:checkComponents', wrap(async (force) => {
    // принудительно обновляем кэш релизов Zapret и TG, затем проверяем заново
    try { await zapret.latestRelease({ force: true }); } catch (_) {}
    try { await require('./src/tgws').latestRelease(); } catch (_) {}
    updateInfo = await updates.check({ force: true });
    pushState();
    return ok({ info: updateInfo });
  }));
  ipcMain.handle('updates:installAll', wrap(async () => {
    const r = await updates.updateAll({ onProgress: p => send('progress', { target: 'updates', ...p }) });
    updateInfo = await updates.check({ force: true });
    pushState(); refreshTray();
    return ok(r);
  }));
  ipcMain.handle('updates:install', wrap(async (target) => {
    if (target === 'zapret') {
      const r = await zapret.install({ onProgress: p => send('progress', { target: 'zapret', ...p }) });
      updateInfo = await updates.check({ force: true });
      pushState();
      return ok(r);
    }
    if (target === 'tg') {
      const r = await tgws.install({ onProgress: p => send('progress', { target: 'tg', ...p }) });
      updateInfo = await updates.check({ force: true });
      pushState();
      return ok(r);
    }
    const r = await updates.updateAll({ onProgress: p => send('progress', { target: 'all', ...p }) });
    updateInfo = await updates.check({ force: true });
    pushState();
    return ok(r);
  }));

  /* журнал */
  ipcMain.handle('logs:list', wrap(async (filter) => ok({ entries: log.list(filter || {}) })));
  ipcMain.handle('logs:clear', wrap(async () => { log.clear(); pushState(); return ok(); }));
  ipcMain.handle('logs:text', wrap(async () => ok({ text: log.text() })));
  ipcMain.handle('logs:file', wrap(async () => ok({ path: path.join(util.paths().logs, 'app.log') })));
}

/* ---------- автозапуск ---------- */
function applyLoginItem(on) {
  if (!IS_WIN && process.platform !== 'darwin') return;
  const TASK = 'YumeHazeZapretAutostart';
  const taskRun = `"${process.execPath}" --hidden --autostart`;
  try {
    const args = [];
    if (!app.isPackaged) args.push(path.join(__dirname));
    args.push('--hidden');

    // Обычная запись автозапуска (для непривилегированного режима)
    app.setLoginItemSettings({ openAtLogin: false, path: process.execPath, args });

    const ps = on
      ? `schtasks /Create /F /RL HIGHEST /SC ONLOGON /TN '${TASK}' /TR '${taskRun}'`
      : `schtasks /Delete /F /TN '${TASK}'`;
    util.exec('powershell', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', ps], { timeout: 20000 })
      .then(r => {
        if (on && r.ok) {
          loginItemState = true;
          log.info('APP', 'Автозапуск с правами администратора настроен (Планировщик заданий)');
        } else if (!on) {
          loginItemState = false;
          log.info('APP', 'Автозапуск отключён');
          // на случай, если задача не была создана — обычная запись
          try { app.setLoginItemSettings({ openAtLogin: false, path: process.execPath, args }); } catch (_) {}
        } else {
          log.warn('APP', 'Планировщик недоступен, использую обычный автозапуск');
          try { app.setLoginItemSettings({ openAtLogin: true, path: process.execPath, args }); } catch (_) {}
          loginItemState = true;
        }
      })
      .catch(() => {
        try { app.setLoginItemSettings({ openAtLogin: !!on, path: process.execPath, args }); } catch (_) {}
        loginItemState = !!on;
      });
  } catch (e) { log.warn('APP', 'Автозапуск: ' + e.message); }
}


/* ---------- авто-запуск служб ---------- */
async function startServicesIfNeeded() {
  const cfg = config.get();
  if (!cfg.app.autostartServices) return;
  try {
    if (zapret.valid()) {
      if (!(await util.isAdmin())) {
        log.warn('APP', 'Автозапуск Zapret пропущен: приложение запущено без прав администратора');
        notify('Нужны права администратора', 'Zapret не запустится без WinDivert — нажмите «Перезапустить с правами» в окне программы.');
      } else {
        await zapret.start();
        log.info('APP', 'Zapret запущен вместе с приложением');
      }
    }
  } catch (e) { log.warn('ZAPRET', 'Автозапуск: ' + e.message); }
  try {
    if (tgws.exeExists() && cfg.tg.autostartWithApp) {
      await tgws.start();
      log.info('APP', 'TG WS Proxy запущен вместе с приложением');
    }
  } catch (e) { log.warn('TG', 'Автозапуск: ' + e.message); }
  if (cfg.app.testOnStart) {
    setTimeout(() => net.quickTest({ scope: 'fast' }).then(r => {
      notify('Проверка при запуске', `${r.score}/100`);
      pushState();
    }).catch(() => {}), 4000);
  }
  pushState();
}

/* ---------- жизненный цикл ---------- */
app.whenReady().then(async () => {
  initPaths();
  config.load();
  log.info('APP', 'Yume Haze Zapret запускается…');
  log.info('APP', 'Пользовательские данные: ' + util.paths().userData);

  registerIpc();
  net.setPickListener(ev => send('pick', ev));
  log.onChange(entry => send('log', entry));

  createWindow();
  buildTray();
  applyLoginItem(config.get().app.runAtLogin);

  app.on('activate', () => showWindow());

  const bootCmd = deepLinkFrom(process.argv);
  if (bootCmd) setTimeout(() => runDeepLink(bootCmd), 2500);
  else setTimeout(() => startServicesIfNeeded(), 1500);

  // Обновления компонентов: проверяем при старте и раз в час.
  // Если включена автоустановка — Zapret и TG WS Proxy обновляются сами.
  async function autoUpdateTick(first = false) {
    if (!config.get().app.autoUpdateCheck) return;
    try {
      updateInfo = await updates.check({ force: !first });
      const n = updates.pendingCount(updateInfo);
      if (n > 0) {
        log.info('UPD', `Доступны обновления компонентов: ${n} — ${updateInfo.zapret.status} Zapret ${updateInfo.zapret.current || '—'}→${updateInfo.zapret.latest}, ${updateInfo.tg.status} TG ${updateInfo.tg.current || '—'}→${updateInfo.tg.latest}`);
        if (config.get().app.autoInstall) {
          log.info('UPD', 'Автоустановка включена — обновляю компоненты');
          notify('Обновления', 'Скачиваю новые версии Zapret и TG WS Proxy…');
          const r = await updates.updateAll({ onProgress: p => send('progress', { target: 'updates', ...p }) });
          if (r.done && r.done.length) {
            log.ok('UPD', 'Обновлено: ' + r.done.join(', '));
            notify('Обновления установлены', r.done.join(', '));
            updateInfo = r.info;
          }
        } else {
          notify('Доступны обновления', 'Откройте раздел «Обновления», чтобы установить их.');
        }
      }
      if (updates.appUpdate(updateInfo)) {
        log.info('UPD', `Новая версия оболочки: ${updateInfo.app.current} → ${updateInfo.app.latest}`);
        notify('Новая версия Yume Haze', `Доступна ${updateInfo.app.latest}. Откройте «Обновления» → скачать установщик.`);
      }
      pushState();
    } catch (e) { log.warn('UPD', 'Проверка обновлений: ' + e.message); }
  }
  setTimeout(() => autoUpdateTick(true), 6000);
  setInterval(() => autoUpdateTick(false), 60 * 60 * 1000);

  // Периодический опрос состояния (раз в 4 с)
  setInterval(() => pushState(), 4000);

  process.on('uncaughtException', e => log.error('ERR', 'uncaught: ' + (e && e.message)));
  process.on('unhandledRejection', e => log.error('ERR', 'unhandled: ' + (e && e.message)));
});

app.on('before-quit', () => { quitting = true; });

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && quitting) app.quit();
});

app.on('will-quit', async () => {
  try { await tgws.stop({ silent: true }); } catch (_) {}
});
