'use strict';
/* Тесты доступности, автоподбор стратегии, история */
const https = require('https');
const http = require('http');
const { tcpProbe, humanBytes } = require('./util');
const config = require('./config');
const log = require('./logger');
const zapret = require('./zapret');
const { STRATEGIES } = require('./assets/strategies');

const TARGETS = [
  { key: 'discord.com', url: 'https://discord.com', service: 'Discord', main: true },
  { key: 'gateway.discord.gg', url: 'https://gateway.discord.gg', service: 'Discord', main: true },
  { key: 'cdn.discordapp.com', url: 'https://cdn.discordapp.com', service: 'Discord' },
  { key: 'updates.discord.com', url: 'https://updates.discord.com', service: 'Discord' },
  { key: 'www.youtube.com', url: 'https://www.youtube.com', service: 'YouTube', main: true },
  { key: 'youtu.be', url: 'https://youtu.be', service: 'YouTube', main: true },
  { key: 'i.ytimg.com', url: 'https://i.ytimg.com', service: 'YouTube' },
  { key: 'redirector.googlevideo.com', url: 'https://redirector.googlevideo.com', service: 'YouTube' },
  { key: 'www.google.com', url: 'https://www.google.com', service: 'Google' },
  { key: 'www.gstatic.com', url: 'https://www.gstatic.com', service: 'Google' },
  { key: 'www.cloudflare.com', url: 'https://www.cloudflare.com', service: 'Cloudflare' },
  { key: 'cdnjs.cloudflare.com', url: 'https://cdnjs.cloudflare.com', service: 'Cloudflare' }
];
const PINGS = [
  { key: '1.1.1.1', ip: '1.1.1.1', service: 'DNS' },
  { key: '8.8.8.8', ip: '8.8.8.8', service: 'DNS' }
];

const SERVICES = ['Discord', 'YouTube', 'Google', 'Cloudflare', 'DNS'];

function httpProbe(url, timeout = 4500) {
  return new Promise(resolve => {
    const t0 = Date.now();
    let settled = false;
    const fin = r => { if (!settled) { settled = true; resolve(r); } };
    let req;
    try {
      req = (url.startsWith('https:') ? https : http).get(url, {
        timeout, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) YumeHaze/2.1', 'Accept': '*/*' }
      }, res => {
        const ms = Date.now() - t0;
        res.resume();
        fin({ ok: res.statusCode < 500, status: res.statusCode, ms });
        try { req.destroy(); } catch (_) {}
      });
    } catch (e) {
      return fin({ ok: false, status: 0, ms: null, error: e.message });
    }
    req.setTimeout(timeout, () => { req.destroy(new Error('timeout')); });
    req.on('error', e => fin({ ok: false, status: 0, ms: null, error: e.message }));
  });
}

async function speedProbe(url) {
  const t0 = Date.now();
  const r = await httpProbe(url);
  return { ...r, ms: r.ms || (Date.now() - t0) };
}

async function runTargets(scope = 'all') {
  const list = scope === 'fast'
    ? TARGETS.filter(t => t.main)
    : TARGETS;
  const results = await mapLimit(list, 6, async t => {
    const r = await httpProbe(t.url);
    return { ...t, ...r };
  });
  const pings = await mapLimit(PINGS, 2, async p => {
    const r = await tcpProbe(p.ip, 443, 1800);
    return { ...p, url: `tcp://${p.ip}:443`, ok: r.ok, ms: r.ms, status: r.ok ? 0 : 0 };
  });
  return [...results, ...pings];
}

function mapLimit(arr, limit, fn) {
  return new Promise(resolve => {
    const out = new Array(arr.length);
    let i = 0, active = 0, done = 0;
    if (!arr.length) return resolve(out);
    const next = () => {
      while (active < limit && i < arr.length) {
        const idx = i++;
        active++;
        Promise.resolve(fn(arr[idx], idx)).then(v => {
          out[idx] = v; active--; done++;
          if (done === arr.length) resolve(out); else next();
        }, e => {
          out[idx] = { ok: false, error: String(e && e.message || e) }; active--; done++;
          if (done === arr.length) resolve(out); else next();
        });
      }
    };
    next();
  });
}

function summarize(results, strategy) {
  const services = SERVICES.map(name => {
    const t = results.filter(r => r.service === name);
    const ok = t.filter(r => r.ok).length;
    const lat = t.filter(r => r.ok && r.ms).map(r => r.ms);
    return {
      name,
      total: t.length,
      ok,
      score: t.length ? Math.round((ok / t.length) * 100) : 0,
      latency: lat.length ? Math.round(lat.reduce((a, b) => a + b, 0) / lat.length) : null,
      targets: t
    };
  });
  const totalOk = results.filter(r => r.ok).length;
  const allLat = results.filter(r => r.ok && r.ms).map(r => r.ms);
  const reach = results.length ? totalOk / results.length : 0;
  const latPenalty = allLat.length ? Math.min(0.25, (avg(allLat) / 4000) * 0.25) : 0.1;
  const score = Math.max(0, Math.min(100, Math.round((reach - latPenalty) * 100)));
  const grade = score >= 85 ? 'good' : score >= 55 ? 'weak' : 'bad';
  return { services, score, grade, strategy, results, ts: Date.now() };
}
function avg(a) { return a.reduce((x, y) => x + y, 0) / a.length; }

async function quickTest({ scope = 'all', silent = false } = {}) {
  const cfg = config.get();
  const strategy = cfg.zapret.strategy;
  if (!silent) log.info('TEST', `Проверка доступности (${scope === 'fast' ? 'быстрая' : 'полная'}), стратегия ${strategy}`);
  const results = await runTargets(scope);
  const sum = summarize(results, strategy);
  const rec = {
    ts: sum.ts,
    strategy,
    score: sum.score,
    grade: sum.grade,
    services: sum.services.map(s => ({ name: s.name, ok: s.ok, total: s.total, score: s.score, latency: s.latency })),
    latency: sum.services.filter(s => s.latency).length ? Math.round(avg(sum.services.filter(s => s.latency).map(s => s.latency))) : null,
    scope,
    zapretRunning: (await zapret.status()).running
  };
  cfg.history.tests.unshift(rec);
  cfg.history.tests = cfg.history.tests.slice(0, 40);
  config.save();
  if (!silent) log.ok('TEST', `Результат: ${sum.score}/100 · ${sum.services.map(s => `${s.name} ${s.ok}/${s.total}`).join(' · ')}`);
  return { ...sum, record: rec };
}

/* ---------------- автоподбор ---------------- */
let pickState = { running: false, cancelled: false, results: [], current: null, progress: 0 };
let onPickEvent = null;

function setPickListener(fn) { onPickEvent = fn; }

function emit(obj) { if (onPickEvent) { try { onPickEvent(obj); } catch (_) {} } }

async function autoPick({ files, mode = 'fast', startAfter = true } = {}) {
  if (pickState.running) throw new Error('Подбор уже идёт');
  const list = Array.isArray(files) && files.length ? files : STRATEGIES.map(s => s.file);
  if (!zapret.valid()) throw new Error('Zapret не установлен');

  const before = await zapret.status();
  const wasRunning = before.running;
  const prevStrategy = config.get().zapret.strategy;

  pickState = { running: true, cancelled: false, results: [], current: null, progress: 0 };
  emit({ type: 'start', total: list.length });
  log.info('TEST', `Автоподбор: ${list.length} стратегий, режим ${mode === 'fast' ? 'быстрый' : 'полный'}`);

  try {
    for (let i = 0; i < list.length; i++) {
      if (pickState.cancelled) break;
      const file = list[i];
      const meta = STRATEGIES.find(s => s.file === file) || { name: file, file };
      pickState.current = meta.name;
      emit({ type: 'progress', index: i, total: list.length, file, name: meta.name, pct: Math.round((i / list.length) * 100) });

      try {
        await zapret.stop({ silent: true });
        config.patch({ zapret: { strategy: file } });
        const st = await zapret.start();
        if (!st.ok) {
          if (st.output) log.tech('TEST', `${file}: ${String(st.output).slice(0, 600)}`);
          throw new Error(st.error || 'не удалось запустить');
        }
        await new Promise(r => setTimeout(r, 1200));
        const t = await quickTest({ scope: mode === 'fast' ? 'fast' : 'all', silent: true });
        const row = {
          file, name: meta.name, score: t.score, grade: t.grade,
          latency: t.services.filter(s => s.latency).length ? t.services.filter(s => s.latency)[0].latency : null,
          services: t.services.map(s => ({ name: s.name, ok: s.ok, total: s.total })),
          ts: Date.now()
        };
        pickState.results.push(row);
        emit({ type: 'result', row, results: pickState.results.slice(), index: i, total: list.length });
        log.info('TEST', `${meta.name}: ${t.score}/100 (${t.services.map(s => `${s.name} ${s.ok}/${s.total}`).join(', ')})`);
      } catch (e) {
        const row = { file, name: meta.name, score: 0, grade: 'bad', error: e.message, services: [], ts: Date.now() };
        pickState.results.push(row);
        emit({ type: 'result', row, results: pickState.results.slice(), index: i, total: list.length });
        log.warn('TEST', `${meta.name}: ошибка — ${e.message}`);
      }
      await zapret.stop({ silent: true });
    }

    await zapret.stop({ silent: true });
    const ranked = pickState.results.slice().sort((a, b) => b.score - a.score);
    const best = ranked[0];
    let applied = null;
    if (best && best.score > 0 && startAfter) {
      config.patch({ zapret: { strategy: best.file } });
      const st = await zapret.start();
      applied = { file: best.file, name: best.name, score: best.score, started: !!st.ok };
      log.ok('TEST', `Лучшая стратегия: ${best.name} (${best.score}/100) — применена`);
    } else if (!pickState.cancelled) {
      config.patch({ zapret: { strategy: prevStrategy } });
      if (wasRunning) await zapret.start();
      log.warn('TEST', 'Ни одна стратегия не дала результата, возвращена прежняя');
    }

    const pick = {
      ts: Date.now(),
      mode,
      cancelled: pickState.cancelled,
      total: list.length,
      results: ranked,
      best: best ? { file: best.file, name: best.name, score: best.score } : null,
      applied
    };
    const cfg = config.get();
    cfg.history.picks.unshift(pick);
    cfg.history.picks = cfg.history.picks.slice(0, 20);
    config.save();
    emit({ type: 'done', pick });
    return pick;
  } finally {
    pickState.running = false;
    pickState.current = null;
  }
}

function pickStop() {
  if (!pickState.running) return { ok: false };
  pickState.cancelled = true;
  log.warn('TEST', 'Автоподбор остановлен пользователем');
  emit({ type: 'cancelling' });
  return { ok: true };
}

function getPickState() {
  return { ...pickState, results: pickState.results.slice() };
}

/* ---------------- история ---------------- */
function history() {
  const cfg = config.get();
  return { tests: cfg.history.tests || [], picks: cfg.history.picks || [] };
}

function historyClear(what = 'all') {
  const cfg = config.get();
  if (what === 'tests' || what === 'all') cfg.history.tests = [];
  if (what === 'picks' || what === 'all') cfg.history.picks = [];
  config.save();
  log.info('TEST', 'История тестов очищена');
  return { ok: true };
}

async function applyStrategy(file) {
  await zapret.setStrategy(file);
  const st = await zapret.status();
  return { ok: true, status: st };
}

module.exports = {
  TARGETS, PINGS, SERVICES, quickTest, autoPick, pickStop, getPickState, setPickListener,
  history, historyClear, applyStrategy, httpProbe, summarize, runTargets
};
