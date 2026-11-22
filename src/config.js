'use strict';
/* Конфигурация приложения: значения по умолчанию, валидация, миграция, сброс */
const fs = require('fs');
const path = require('path');
const { readJson, writeJson, ensureDir, randomHex, paths } = require('./util');

const SETTINGS_FILE = () => path.join(paths().userData, 'settings.json');

function defaults() {
  return {
    version: 3,
    zapret: {
      installDir: null,                       // null → <userData>/zapret
      binPath: null,                          // необязательный путь к zapret вручную
      strategy: 'general.bat',
      gameFilter: { mode: 'off', tcp: '1024-65535', udp: '1024-65535' },
      ipsetMode: 'loaded',                    // loaded | any | none
      lists: {
        user: '# Свои сайты: один домен на строку\n',
        exclude: '# Исключения: обход не применяется\n',
        ipExclude: '# 203.0.113.113/32\n'
      },
      checkUpdates: true,
      clearDiscordCache: true
    },
    tg: {
      binPath: null,                          // null → <userData>/tgws
      host: '127.0.0.1',
      port: 1443,
      poolSize: 4,
      secret: '',
      cfproxy: true,
      h2: true,
      noSecure: false,
      fakeTlsDomain: '',
      cfproxyDomain: '',
      dcIp: ['2:149.154.167.220', '4:149.154.167.220'],
      verbose: false,
      autostartWithApp: true,
      portable: true
    },
    app: {
      repo: 'NobuCraft/yume-haze-zapret',     // репозиторий оболочки: по нему проверяем обновления
      runAtLogin: false,
      startMinimized: false,
      closeToTray: true,
      notifications: true,
      testOnStart: true,
      autostartServices: false,               // поднимать Zapret+TG при старте Yume Haze
      accent: ['#b9a2ff', '#ff9fcb'],
      animations: true,
      language: 'ru',
      autoUpdateCheck: true,
      autoInstall: false,
      useMirror: true,
      logMaxMb: 5
    },
    history: { tests: [], picks: [], events: [] }
  };
}

let cfg = null;

function load() {
  const d = defaults();
  const saved = readJson(SETTINGS_FILE(), {}) || {};
  cfg = merge(d, saved);
  if (!cfg.tg.secret || !/^[0-9a-f]{32}$/i.test(cfg.tg.secret)) cfg.tg.secret = randomHex(16);
  save();
  return cfg;
}

function merge(base, extra) {
  if (Array.isArray(base)) return Array.isArray(extra) ? extra : base;
  if (base && typeof base === 'object') {
    const out = { ...base };
    if (extra && typeof extra === 'object') {
      for (const k of Object.keys(extra)) {
        out[k] = k in base ? merge(base[k], extra[k]) : extra[k];
      }
    }
    return out;
  }
  return extra === undefined ? base : extra;
}

function get() {
  if (!cfg) load();
  return cfg;
}

function save() {
  if (!cfg) return cfg;
  ensureDir(paths().userData);
  writeJson(SETTINGS_FILE(), cfg);
  return cfg;
}

/* Точечное обновление: patch({ zapret: { strategy: 'x' } }) */
function patch(p) {
  cfg = merge(get(), p || {});
  if (cfg.tg.secret && !/^[0-9a-f]{32}$/i.test(cfg.tg.secret)) cfg.tg.secret = randomHex(16);
  return save();
}

function reset(section) {
  const d = defaults();
  if (!section) cfg = d;
  else cfg[section] = d[section];
  if (!cfg.tg.secret || !/^[0-9a-f]{32}$/i.test(cfg.tg.secret)) cfg.tg.secret = randomHex(16);
  save();
  return cfg;
}

/* Каталоги, производные от настроек */
function zapretDir() {
  const c = get();
  if (c.zapret.binPath) return c.zapret.binPath;
  if (c.zapret.installDir) return c.zapret.installDir;
  return path.join(paths().userData, 'zapret');
}

function zapretValid(dir = zapretDir()) {
  return fs.existsSync(path.join(dir, 'bin', 'winws.exe'));
}

function zapretListsDir(dir = zapretDir()) { return path.join(dir, 'lists'); }

function tgBin() {
  const c = get();
  if (c.tg.binPath) return c.tg.binPath;
  return path.join(paths().userData, 'tgws', 'TgWsProxy.exe');
}

module.exports = {
  defaults, load, get, save, patch, reset,
  zapretDir, zapretValid, zapretListsDir, tgBin, SETTINGS_FILE
};
