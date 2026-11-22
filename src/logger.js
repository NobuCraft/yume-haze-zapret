'use strict';
/* Журнал приложения: кольцевой буфер + запись в файл + подписка UI */
const path = require('path');
const { appendLine, paths } = require('./util');

const MAX = 600;
const entries = [];
const listeners = new Set();
let seq = 0;

const SOURCES = ['APP', 'ZAPRET', 'TG', 'TEST', 'NET', 'UPD', 'ERR'];

function log(source, message, level = 'info') {
  const e = {
    id: ++seq,
    ts: Date.now(),
    source: SOURCES.includes(source) ? source : 'APP',
    level,
    message: String(message == null ? '' : message)
  };
  entries.push(e);
  if (entries.length > MAX) entries.splice(0, entries.length - MAX);
  let file = 'app.log';
  try { file = path.join(paths().logs, 'app.log'); } catch (_) {}
  appendLine(file, `${new Date(e.ts).toISOString().replace('T', ' ').slice(0, 19)} [${e.source}/${e.level}] ${e.message}`);
  for (const fn of listeners) { try { fn(e); } catch (_) {} }
  return e;
}

const info = (src, msg) => log(src, msg, 'info');
const warn = (src, msg) => log(src, msg, 'warn');
const error = (src, msg) => log(src, msg, 'error');
const ok = (src, msg) => log(src, msg, 'ok');

function list(filter = {}) {
  let out = entries;
  if (filter.source && filter.source !== 'all') {
    out = filter.source === 'ERR' ? out.filter(e => e.level === 'error') : out.filter(e => e.source === filter.source);
  }
  if (filter.q) {
    const q = filter.q.toLowerCase();
    out = out.filter(e => e.message.toLowerCase().includes(q));
  }
  return out.slice(-400);
}

function clear() { entries.length = 0; return true; }
function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function text() {
  return entries.map(e => `${new Date(e.ts).toLocaleString('ru-RU')} [${e.source}/${e.level}] ${e.message}`).join('\n');
}

/* Технические подробности (командные строки, вывод winws.exe) — только в файл журнала */
function tech(source, message) {
  const e = {
    id: ++seq, ts: Date.now(), source: SOURCES.includes(source) ? source : 'APP',
    level: 'tech', message: String(message == null ? '' : message)
  };
  entries.push(e);
  if (entries.length > MAX) entries.shift();
  try { appendLine(paths().logs, `${new Date(e.ts).toISOString().replace('T', ' ').slice(0, 19)} [${e.source}/tech] ${e.message}`); } catch (_) {}
  return e;
}

module.exports = { log, info, warn, error, ok, tech, list, clear, onChange, text, SOURCES };
