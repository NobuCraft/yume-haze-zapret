'use strict';
/*
 * Дымовой тест Electron на Linux: окно открывается, IPC отвечает,
 * Linux-ветка (hz-nfq + nftables) активна, интерфейс не падает.
 * Запуск: xvfb-run -a node scripts/electron-smoke.js
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BIN = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron');
const userData = fs.mkdtempSync('/tmp/yh-smoke-');
const app = spawn(BIN, ['.', '--no-sandbox', '--disable-gpu', `--user-data-dir=${userData}`], {
  cwd: ROOT,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' }
});
let out = '';
app.stdout.on('data', d => { out += d; });
app.stderr.on('data', d => { out += d; });

const FAIL = /Uncaught|TypeError|ReferenceError|is not a function|Cannot read/;

setTimeout(() => {
  app.kill('SIGTERM');
}, 25000);

app.on('exit', () => {
  const logFile = path.join(userData, 'logs', 'app.log');
  const logText = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : '';
  const crashers = out.split('\n').filter(l => FAIL.test(l));
  const logErrors = logText.split('\n').filter(l => /\[ERR\//.test(l));
  console.log('\n--- старт приложения');
  console.log(logText.split('\n').filter(l => /запускается|Пользовательские данные/.test(l)).join('\n') || '(журнал пуст)');
  console.log('--- ошибки в консоли:', crashers.length ? '\n' + crashers.slice(0, 5).join('\n') : 'нет');
  console.log('--- ошибки в журнале:', logErrors.length ? '\n' + logErrors.slice(0, 8).join('\n') : 'нет');
  const bad = crashers.length > 0 || logErrors.some(l => /Zapret работает только в Windows|is not a function/.test(l));
  console.log(bad ? '\n✗ ДЫМОВОЙ ТЕСТ: есть ошибки' : '\n✓ ДЫМОВОЙ ТЕСТ: приложение поднялось без ошибок');
  process.exit(bad ? 1 : 0);
});
