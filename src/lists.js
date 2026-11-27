'use strict';
/*
 * Пользовательские списки доменов и IP. Формат совпадает с Windows-версией:
 *   list-general-user.txt   — свои сайты, которые нужно обходить
 *   list-exclude-user.txt   — исключения
 *   ipset-exclude-user.txt  — IP/подсети-исключения
 * Главные списки Flowseal (list-general.txt и т.д.) не перезаписываем — они
 * обновляются вместе с релизом.
 */
const fs = require('fs');
const path = require('path');
const config = require('./config');
const util = require('./util');

const FILES = {
  user: 'list-general-user.txt',
  exclude: 'list-exclude-user.txt',
  ipExclude: 'ipset-exclude-user.txt',
  general: 'list-general.txt',
  google: 'list-google.txt',
  excludeMain: 'list-exclude.txt',
  ipset: 'ipset-all.txt',
  ipsetExclude: 'ipset-exclude.txt'
};

const HEADERS = {
  user: '# Свои сайты: один домен на строку (обход применяется)\n',
  exclude: '# Исключения: обход не применяется\n',
  ipExclude: '# 203.0.113.113/32\n'
};

function dir() {
  const c = config.get();
  const base = c.zapret.binPath || c.zapret.installDir || path.join(util.paths().userData, 'zapret-linux');
  return path.join(base, 'lists');
}

function file(kind) { return path.join(dir(), FILES[kind] || FILES.user); }

function read(kind) {
  try { return fs.readFileSync(file(kind), 'utf8'); }
  catch (_) { return HEADERS[kind] || ''; }
}

function write(kind, text) {
  const p = file(kind);
  util.ensureDir(path.dirname(p));
  fs.writeFileSync(p, String(text || '').replace(/\r?\n/g, '\n'), 'utf8');
  const cfg = config.get();
  if (kind in cfg.zapret.lists) { cfg.zapret.lists[kind] = text; config.save(); }
  return { ok: true, path: p, entries: countLines(text) };
}

function countLines(text) {
  return String(text || '').split(/\r?\n/).filter(l => l.trim() && !l.trim().startsWith('#')).length;
}

/* Создать файлы пользовательских списков, если их нет (после установки релиза) */
function ensure() {
  util.ensureDir(dir());
  for (const kind of ['user', 'exclude', 'ipExclude']) {
    const p = file(kind);
    if (!fs.existsSync(p)) fs.writeFileSync(p, HEADERS[kind], 'utf8');
  }
}

function info() {
  const out = {};
  for (const kind of Object.keys(FILES)) {
    const p = file(kind);
    let raw = '';
    try { raw = fs.readFileSync(p, 'utf8'); } catch (_) {}
    out[kind] = { entries: countLines(raw), bytes: Buffer.byteLength(raw), exists: !!raw };
  }
  return out;
}

module.exports = { FILES, dir, file, read, write, ensure, info, countLines };
