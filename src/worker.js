'use strict';
/*
 * Отдельный процесс для всего, что раньше подвешивало окно:
 *  - установка Zapret (скачивание + распаковка),
 *  - обновления компонентов,
 *  - проверки обновлений и сетевые пробы,
 *  - чистка кэша Discord и разбор больших списков.
 *
 * Запускается через utilityProcess.fork() из main.js. Окно в это время
 * продолжает перерисовываться, поэтому «Не отвечает» больше не появляется.
 */
const path = require('path');
const util = require('./util');
const config = require('./config');

let pathsReady = false;
function prepare(msg) {
  if (pathsReady) return;
  if (msg.paths) util.setPaths(msg.paths);
  if (msg.settings) config.adopt && config.adopt(msg.settings);
  pathsReady = true;
}

const handlers = {
  async ping() { return { ok: true, at: Date.now() }; },

  async zapretInstall(payload) {
    const zapret = require('./zapret');
    return zapret.install({ onProgress: payload.onProgress });
  },

  async zapretInstallLinux() {
    const linux = require('./linux');
    return linux.install({});
  },

  async updateCheck() {
    const updates = require('./updates');
    return updates.check({ force: true });
  },

  async netQuick(payload) {
    const net = require('./net');
    return net.quickTest({ scope: payload.scope || 'fast' });
  },

  async discordCache() {
    const zap = process.platform === 'linux' ? require('./zapret-linux') : require('./zapret');
    return zap.clearDiscordCache();
  },

  async listInfo() {
    const lists = require('./lists');
    return lists.info();
  }
};

process.parentPort.on('message', async (e) => {
  const msg = e && e.data ? e.data : e;
  const { id, op, payload } = msg || {};
  let result = null;
  try {
    prepare(msg);
    const fn = handlers[op];
    if (!fn) throw new Error('неизвестная операция: ' + op);
    result = await fn(payload || {});
  } catch (err) {
    result = { ok: false, error: err && err.message ? err.message : String(err) };
  }
  try { process.parentPort.postMessage({ id, result }); } catch (_) {}
});

process.on('uncaughtException', (e) => {
  try { process.parentPort.postMessage({ id: null, result: { ok: false, error: 'worker: ' + e.message } }); } catch (_) {}
});
