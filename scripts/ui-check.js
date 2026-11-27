'use strict';
/*
 * Проверка разделов интерфейса на живой сборке (Linux): открывает приложение
 * с DevTools-портом, по очереди переключает каждую страницу и проверяет,
 * что она отрисована и заполнена данными (нет пустых мест и «не загрузилось»).
 * Запуск: xvfb-run -a node scripts/ui-check.js
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const ROOT = path.join(__dirname, '..');
const BIN = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron');
const PORT = 9333;
const userData = fs.mkdtempSync('/tmp/yh-ui-');
const app = spawn(BIN, ['.', '--no-sandbox', '--disable-gpu', `--user-data-dir=${userData}`,
  `--remote-debugging-port=${PORT}`], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });

let consoleErrors = [];
app.stderr.on('data', d => {
  const s = String(d);
  if (/Uncaught|TypeError|ReferenceError|is not a function/.test(s)) consoleErrors.push(s.trim());
});

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function cdp() {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find(t => t.type === 'page' && /index\.html/.test(t.url || ''));
      if (page) return page.webSocketDebuggerUrl;
    } catch (_) {}
    await sleep(500);
  }
  throw new Error('страница не появилась');
}

function rpc(url) {
  const ws = new WebSocket(url);
  let id = 0;
  const waiters = new Map();
  ws.on('message', m => {
    const msg = JSON.parse(m);
    if (msg.id && waiters.has(msg.id)) { waiters.get(msg.id)(msg); waiters.delete(msg.id); }
  });
  const open = new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  const send = (method, params) => new Promise(res => {
    const myId = ++id;
    waiters.set(myId, res);
    ws.send(JSON.stringify({ id: myId, method, params }));
  });
  return { open, send, close: () => ws.close() };
}

(async () => {
  const url = await cdp();
  const c = rpc(url);
  await c.open;
  await sleep(2500);

  const evaluate = async expr => {
    const r = await c.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    return r.result && r.result.result ? r.result.result.value : undefined;
  };

  const pages = await evaluate(`Array.from(document.querySelectorAll('[data-go]')).map(e => e.dataset.go)`);
  if (!pages || !pages.length) throw new Error('в интерфейсе нет пунктов меню');

  const report = [];
  for (const page of pages) {
    await evaluate(`document.querySelector('[data-go="${page}"]').click()`);
    await sleep(1400);
    const info = await evaluate(`(() => {
      const view = document.querySelector('.page.on') || document.querySelector('main') || document.body;
      const text = (view.innerText || '').replace(/\\s+/g, ' ').trim();
      const nodes = view.querySelectorAll('*').length;
      const title = (view.querySelector('h1') || {}).innerText || '';
      return { page: '${page}', chars: text.length, nodes, title: String(title).replace(/\\s+/g,' ').slice(0,28),
               emptyStates: /не загрузилось|загрузка\\.\\.\\./i.test(text),
               error: /undefined|NaN|\\[object Object\\]/i.test(text),
               head: text.slice(0, 80) };
    })()`);
    report.push(info);
  }

  // Linux-ветка: версия движка и стратегии из реального релиза
  const linux = await evaluate(`(async () => {
    const info = await window.api.info();
    const diag = await (window.api.linuxDiagnostics ? window.api.linuxDiagnostics() : null);
    const strat = await (window.api.linuxStrategies ? window.api.linuxStrategies() : null);
    return { info: info && { version: info.version, isLinux: info.isLinux, engine: info.engine, strategies: info.strategies },
             diag: diag && { engine: !!diag.engine, nft: !!diag.nft, installed: diag.installed },
             strategies: strat && (strat.list ? strat.list.length : 0) };
  })()`);

  console.log('--- разделы');
  let bad = 0;
  for (const r of report) {
    const okRow = r.chars > 60 && !r.emptyStates && !r.error;
    if (!okRow) bad++;
    console.log(`${okRow ? '✓' : '✗'} ${r.page.padEnd(12)} символов=${String(r.chars).padStart(5)} узлов=${String(r.nodes).padStart(4)}  ${r.head.slice(0, 50)}`);
  }
  console.log('--- linux API:', JSON.stringify(linux));
  if (consoleErrors.length) { console.log('--- ошибки:', consoleErrors.slice(0, 5).join('\n')); bad++; }
  console.log(bad ? `\n✗ ИНТЕРФЕЙС: проблем ${bad}` : `\n✓ ИНТЕРФЕЙС: все ${report.length} разделов отрисованы и заполнены`);
  c.close();
  app.kill('SIGTERM');
  process.exit(bad ? 1 : 0);
})().catch(e => {
  console.error('ОШИБКА:', e.message);
  console.log(consoleErrors.slice(0, 5).join('\n'));
  app.kill('SIGTERM');
  process.exit(2);
});
