'use strict';
/* Проверка обновлений компонентов и самой оболочки */
const fs = require('fs');
const path = require('path');
const { getJson, readJson, writeJson, paths } = require('./util');
const config = require('./config');
const log = require('./logger');
const zapret = require('./zapret');
const tgws = require('./tgws');

const ZAPRET_RELEASES = 'https://api.github.com/repos/Flowseal/zapret-discord-youtube/releases';

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

  // Zapret releases
  try {
    const rels = await getJson(ZAPRET_RELEASES + '?per_page=15', cfg.app.useMirror);
    const stable = rels.find(r => !r.prerelease && !r.draft);
    if (stable) {
      out.zapret.latest = stable.tag_name.replace(/^v/, '');
      out.zapret.notes = (stable.body || '').slice(0, 4000);
      out.zapret.url = stable.html_url;
      out.zapret.publishedAt = stable.published_at;
      out.zapret.assets = (stable.assets || []).map(a => ({ name: a.name, size: a.size, url: a.browser_download_url }));
    }
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
  return [info.zapret, info.tg].filter(c => c && c.status !== 'ok').length;
}

async function updateAll({ onProgress } = {}) {
  const info = await check({ force: true });
  const done = [];
  if (info.zapret.status !== 'ok' || !zapret.valid()) {
    try {
      await zapret.install({ onProgress });
      done.push('Zapret ' + info.zapret.latest);
    } catch (e) { log.error('UPD', 'Zapret: ' + e.message); }
  }
  if (info.tg.status !== 'ok' || !tgws.exeExists()) {
    try {
      await tgws.install({ onProgress });
      done.push('TG WS Proxy ' + info.tg.latest);
    } catch (e) { log.error('UPD', 'TG: ' + e.message); }
  }
  return { ok: true, done, info };
}

module.exports = { check, pendingCount, updateAll, cmp, cacheFile };
