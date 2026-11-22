'use strict';
/* Проверка обновлений компонентов и самой оболочки */
const fs = require('fs');
const path = require('path');
const { getJson, readJson, writeJson, paths } = require('./util');
const config = require('./config');
const log = require('./logger');
const zapret = require('./zapret');
const tgws = require('./tgws');

function cacheFile() { return path.join(paths().cache, 'updates.json'); }

function cmp(a, b) {
  const pa = String(a).replace(/^v/i, '').split(/[.\-+]/).map(n => parseInt(n, 10) || 0);
  const pb = String(b).replace(/^v/i, '').split(/[.\-+]/).map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

async function check({ force = false } = {}) {
  const cfg = config.get();
  const cached = readJson(cacheFile(), null);
  if (!force && cached && Date.now() - cached.at < 6 * 3600 * 1000) {
    return { ...cached, cached: true };
  }
  const out = {
    at: Date.now(),
    channel: 'stable',
    zapret: { current: zapret.installedVersion(), latest: zapret.ZAPRET_VERSION, status: 'unknown', notes: '', url: '' },
    tg: { current: null, latest: tgws.PINNED_VERSION, status: 'unknown', notes: '', url: '' },
    app: { current: require('../package.json').version, latest: require('../package.json').version, status: 'ok' },
    errors: []
  };

  // Zapret: последний стабильный релиз Flowseal (тот же, что скачивает установка)
  try {
    const rel = await zapret.latestRelease({ force });
    out.zapret.latest = rel.version;
    out.zapret.notes = (rel.notes || '').slice(0, 4000);
    out.zapret.url = rel.page || '';
    out.zapret.publishedAt = rel.publishedAt;
    out.zapret.downloadUrl = rel.url;
  } catch (e) {
    out.errors.push('Zapret: ' + e.message);
  }

  // TG WS Proxy
  try {
    const rel = await tgws.latestRelease();
    out.tg.latest = rel.tag;
    out.tg.notes = (rel.notes || '').slice(0, 4000);
    out.tg.url = 'https://github.com/Flowseal/tg-ws-proxy/releases/tag/' + rel.tag;
    out.tg.publishedAt = rel.publishedAt;
    out.tg.size = rel.size;
  } catch (e) {
    out.errors.push('TG WS Proxy: ' + e.message);
  }

  out.zapret.current = zapret.installedVersion();
  out.tg.current = tgws.installedVersion() || (tgws.exeExists() ? out.tg.latest : null);
  out.zapret.status = !out.zapret.current ? 'install'
    : cmp(out.zapret.latest, out.zapret.current) > 0 ? 'update' : 'ok';
  out.tg.status = !out.tg.current ? 'install'
    : cmp(out.tg.latest, out.tg.current) > 0 ? 'update' : 'ok';

  // Оболочка (проверяем наш собственный релиз, если он задан)
  const appRepo = cfg.app.repo || null;
  if (appRepo) {
    try {
      const rel = await getJson(`https://api.github.com/repos/${appRepo}/releases/latest`);
      out.app.latest = (rel.tag_name || '').replace(/^v/, '');
      out.app.status = cmp(out.app.latest, out.app.current) > 0 ? 'update' : 'ok';
      out.app.url = rel.html_url;
    } catch (_) {}
  }

  writeJson(cacheFile(), out);
  const pending = [out.zapret, out.tg].filter(c => c.status !== 'ok').length;
  log.info('UPD', `Проверка обновлений: Zapret ${out.zapret.current || '—'} → ${out.zapret.latest}, TG ${out.tg.current || '—'} → ${out.tg.latest}${pending ? ` (${pending} требуют внимания)` : ''}`);
  return out;
}

function pendingCount(info) {
  if (!info) return 0;
  // только компоненты, которые приложение может поставить само (оболочку — вручную установщиком)
  return [info.zapret, info.tg].filter(c => c && c.status !== 'ok').length;
}

/* Есть ли новая версия самой оболочки (проверяется по репозиторию пользователя) */
function appUpdate(info) {
  const a = info && info.app;
  return !!(a && a.status === 'update' && a.latest);
}

async function updateAll({ onProgress } = {}) {
  const info = await check({ force: true });
  const done = [];
  if (info.zapret.status !== 'ok' || !zapret.valid()) {
    try {
      log.info('UPD', `Обновляю Zapret: ${info.zapret.current || '—'} → ${info.zapret.latest}`);
      await zapret.install({ onProgress });
      done.push('Zapret ' + info.zapret.latest);
      log.ok('UPD', 'Zapret обновлён до ' + info.zapret.latest);
    } catch (e) { log.error('UPD', 'Zapret: ' + e.message); }
  }
  if (info.tg.status !== 'ok' || !tgws.exeExists()) {
    try {
      log.info('UPD', `Обновляю TG WS Proxy: ${info.tg.current || '—'} → ${info.tg.latest}`);
      await tgws.install({ onProgress });
      done.push('TG WS Proxy ' + info.tg.latest);
      log.ok('UPD', 'TG WS Proxy обновлён до ' + info.tg.latest);
    } catch (e) { log.error('UPD', 'TG: ' + e.message); }
  }
  return { ok: true, done, info };
}

module.exports = {
  appUpdate, check, pendingCount, updateAll, cmp, cacheFile };
