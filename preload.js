'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const call = (channel, ...args) => ipcRenderer.invoke(channel, ...args);

const listeners = new Map();
function on(channel, fn) {
  const handler = (_e, payload) => fn(payload);
  ipcRenderer.on(channel, handler);
  listeners.set(fn, handler);
  return () => {
    const h = listeners.get(fn);
    if (h) { ipcRenderer.removeListener(channel, h); listeners.delete(fn); }
  };
}

contextBridge.exposeInMainWorld('api', {
  /* общее */
  info: () => call('app:info'),
  elevate: action => call('app:elevate', action),
  state: () => call('app:state'),
  onState: fn => on('state', fn),
  onLog: fn => on('log', fn),
  onProgress: fn => on('progress', fn),
  onPick: fn => on('pick', fn),
  onMaximized: fn => on('ui:maximized', fn),
  onNav: fn => on('nav:go', fn),

  /* окно */
  minimize: () => call('ui:minimize'),
  maximize: () => call('ui:maximize'),
  close: () => call('ui:close'),
  openExternal: url => call('shell:open', url),
  copy: text => call('clipboard:write', text),
  showItem: p => call('shell:showItem', p),
  openPath: p => call('shell:openPath', p),
  pickDir: () => call('dialog:dir'),

  /* настройки */
  settings: () => call('settings:get'),
  patchSettings: patch => call('settings:patch', patch),
  resetSettings: section => call('settings:reset', section),

  /* zapret */
  zapret: {
    status: () => call('zapret:status'),
    start: () => call('zapret:start'),
    stop: () => call('zapret:stop'),
    restart: () => call('zapret:restart'),
    toggle: on => call('zapret:toggle', on),
    setStrategy: file => call('zapret:setStrategy', file),
    setGameFilter: gf => call('zapret:gameFilter', gf),
    setIpset: mode => call('zapret:ipset', mode),
    updateIpset: () => call('zapret:updateIpset'),
    updateHosts: () => call('zapret:updateHosts'),
    readList: kind => call('zapret:readList', kind),
    writeList: (kind, text) => call('zapret:writeList', kind, text),
    installService: () => call('zapret:installService'),
    removeService: () => call('zapret:removeService'),
    clearDiscord: () => call('zapret:clearDiscord'),
    preflight: () => call('zapret:preflight'),
    lastRun: () => call('zapret:lastRun'),
    revealBat: file => call('zapret:revealBat', file),
    driver: () => call('zapret:driver'),
    checkDriver: () => call('zapret:driverCheck'),
    driverFix: () => call('zapret:driverFix'),
    startAsService: () => call('zapret:startAsService'),
    diagnostics: () => call('zapret:diagnostics'),
    checkUpdates: on => call('zapret:checkUpdates', on),
    detect: () => call('zapret:detect'),
    setDir: dir => call('zapret:setDir', dir),
    install: () => call('zapret:install')
  },

  /* tg ws proxy */
  tg: {
    status: () => call('tg:status'),
    start: () => call('tg:start'),
    stop: () => call('tg:stop'),
    restart: () => call('tg:restart'),
    toggle: on => call('tg:toggle', on),
    save: patch => call('tg:save', patch),
    newSecret: () => call('tg:newSecret'),
    link: () => call('tg:link'),
    copyLink: () => call('tg:copyLink'),
    openTelegram: () => call('tg:openTelegram'),
    pingDc: () => call('tg:pingDc'),
    dcStatus: () => call('tg:dcStatus'),
    diagnostics: () => call('tg:diagnostics'),
    install: () => call('tg:install'),
    setPath: p => call('tg:setPath', p)
  },

  /* тесты */
  test: {
    quick: scope => call('test:quick', scope),
    pick: opts => call('test:pick', opts),
    pickStop: () => call('test:pickStop'),
    pickState: () => call('test:pickState'),
    history: () => call('test:history'),
    historyClear: what => call('test:historyClear', what),
    applyStrategy: file => call('test:applyStrategy', file)
  },

  /* обновления */
  updates: {
    check: force => call('updates:check', force),
    install: target => call('updates:install', target)
  },

  /* журнал */
  logs: {
    list: filter => call('logs:list', filter),
    clear: () => call('logs:clear'),
    text: () => call('logs:text'),
    file: () => call('logs:file')
  }
});
