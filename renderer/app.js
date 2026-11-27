'use strict';
/* Yume Haze Zapret — интерфейс */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
/* window.api приходит из preload.js (contextBridge) — глобальная привязка */

/* ---------------- иконки ---------------- */
const ICONS = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/>',
  bolt: '<path d="M13 2 4.5 13.5H11l-1 8.5 8.5-11.5H12l1-8.5Z"/>',
  send: '<path d="M21 3 3 10.5l7 3 3 7L21 3Z"/><path d="M10 13.5 21 3"/>',
  pulse: '<path d="M2 12h4l3-8 4 16 3-8h6"/>',
  download: '<path d="M12 3v12"/><path d="m7 11 5 5 5-5"/><path d="M4 20h16"/>',
  terminal: '<path d="m5 8 4 4-4 4"/><path d="M12 16h7"/>',
  chip: '<rect x="6" y="6" width="12" height="12" rx="2.5"/><rect x="10" y="10" width="4" height="4" rx="1"/><path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3"/>',
  trash: '<path d="M4 7h16"/><path d="M9 7V4.5h6V7"/><path d="M6 7l1 13h10l1-13"/><path d="M10 11v6M14 11v6"/>',
  gear: '<circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8h.01"/>',
  power: '<path d="M12 3v9"/><path d="M7.5 6.3a7.5 7.5 0 1 0 9 0"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-3.2-6.9"/><path d="M21 4v5h-5"/>',
  list: '<path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/>',
  game: '<rect x="2" y="7" width="20" height="11" rx="4"/><path d="M7 11v3"/><path d="M5.5 12.5h3"/><path d="M16 12h.01"/><path d="M18.5 14h.01"/>',
  shield: '<path d="M12 3 5 6v6c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6l-7-3Z"/><path d="m9 12 2 2 4-4"/>',
  link: '<path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
  spark: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3Z"/><path d="M18.5 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7.7-1.8Z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2.5"/><path d="M5 15V5a1 1 0 0 1 1-1h10"/>',
  eye: '<path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12Z"/><circle cx="12" cy="12" r="2.8"/>',
  x: '<path d="M6 6l12 12"/><path d="M18 6 6 18"/>',
  play: '<path d="M7 4.5 20 12 7 19.5V4.5Z"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  folder: '<path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2.5h7A1.5 1.5 0 0 1 19 10v8a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 3 18V7.5Z"/>',
  external: '<path d="M14 4h6v6"/><path d="M20 4 11 13"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  discord: 'M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.865-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.058a.082.082 0 0 0 .031.056 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.873-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.1 13.1 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .078-.011c3.928 1.793 8.18 1.793 12.061 0a.074.074 0 0 1 .079.009c.12.1.246.198.373.292a.077.077 0 0 1-.006.128 12.3 12.3 0 0 1-1.873.891.077.077 0 0 0-.041.107c.36.698.772 1.363 1.225 1.993a.076.076 0 0 0 .084.029 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.055c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.028ZM8.02 15.331c-1.183 0-2.157-1.086-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.419 0 1.333-.956 2.419-2.157 2.419Zm7.975 0c-1.183 0-2.157-1.086-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.419 0 1.333-.946 2.419-2.157 2.419Z',
  github: 'M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12',
  check: '<path d="m4 12 5 5L20 6"/>',
  warn: '<path d="M12 4l9 16H3l9-16Z"/><path d="M12 10v4"/><path d="M12 17h.01"/>'
};
/* брендовые логотипы рисуем заливкой, остальные — обводкой */
const FILLED_ICONS = new Set(['discord', 'github']);
function icon(name) {
  if (FILLED_ICONS.has(name)) {
    // брендовый логотип: заливка; inline style перебивает правила CSS с fill:none
    return `<svg viewBox="0 0 24 24" class="fill-icon" style="fill:currentColor;stroke:none">${ICONS[name] || ''}</svg>`;
  }
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ''}</svg>`;
}
function paintIcons(root = document) {
  $$('i[data-i]', root).forEach(el => {
    if (!el.firstChild) el.innerHTML = icon(el.dataset.i);
  });
  // брендовые значки (Discord, GitHub) в сайдбаре и карточках
  $$('[data-brand]', root).forEach(el => {
    if (!el.firstChild) el.innerHTML = icon(el.dataset.brand);
  });
}

/* ---------------- видимость окна ---------------- */
/* ВАЖНО: проверка должна быть синхронной. api.isMinimized() — это ipcRenderer.invoke,
   то есть Promise; Promise всегда «истина», поэтому окно считалось скрытым ВСЕГДА и
   состояние (S.zapret / S.tg) не применялось — разделы оставались пустыми.
   Теперь ориентируемся только на document.hidden (стабильно и без IPC). */
function uiVisible() {
  return !document.hidden;
}

/* «Окно активно» — используется только для паузы анимаций (не для данных!). */
let uiFocused = true;
function uiActive() {
  return !document.hidden && uiFocused;
}

/* Пауза всех CSS-анимаций и переходов, когда окно не на экране. */
function syncHiddenFlag() {
  const hidden = !uiActive();
  if (hidden) document.documentElement.dataset.hidden = '1';
  else delete document.documentElement.dataset.hidden;
}

/* ---------------- состояние ---------------- */
let S = { zapret: null, tg: null, settings: null, logs: [], update: 0 };
let lastTest = null;         // последний быстрый тест
let testRunning = false;
let pickState = { selected: new Set(), results: [], running: false };
let ui = { page: 'overview', sfilter: 'all', listKind: 'user', logFilter: { source: 'all', q: '' }, pmode: 'fast', channel: 'stable', editList: {}, showSecret: false, tgPings: [] };

/* ---------------- тосты ---------------- */
function toast(title, body = '', kind = 'ok', ms = 4200) {
  const box = $('#toasts');
  while (box.children.length >= 3) box.firstElementChild.remove();
  const el = document.createElement('div');
  el.className = `toast ${kind === 'ok' ? '' : kind}`;
  el.innerHTML = `<div class="tic">${icon(kind === 'ok' ? 'check' : 'warn')}</div><div><b>${esc(title)}</b>${body ? `<div>${esc(body)}</div>` : ''}</div>`;
  box.appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 220); }, ms);
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fmtTime(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
function dur(ms) {
  if (!ms || ms < 0) return '—';
  const s = Math.floor(ms / 1000);
  if (s < 60) return s + ' с';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} мин ${s % 60} с`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} ч ${m % 60} мин`;
  return `${Math.floor(h / 24)} д ${h % 24} ч`;
}
function bytes(n) {
  n = Number(n) || 0;
  if (n < 1024) return n + ' Б';
  if (n < 1024 ** 2) return (n / 1024).toFixed(0) + ' КБ';
  if (n < 1024 ** 3) return (n / 1024 ** 2).toFixed(1) + ' МБ';
  return (n / 1024 ** 3).toFixed(2) + ' ГБ';
}
function chipState(on, textOn, textOff) {
  return `<span class="chip ${on ? 'on' : ''}">${on ? textOn : textOff}</span>`;
}

/* ---------------- навигация ---------------- */
const PAGE_META = {
  overview: ['Обзор', 'Состояние обхода и прокси'],
  zapret: ['Zapret', 'Стратегии, игровой фильтр, списки'],
  tg: ['TG WS Proxy', 'Локальный MTProto-прокси через WebSocket'],
  tests: ['Тесты', 'Проверка доступности и автоподбор стратегии'],
  updates: ['Обновления', 'Компоненты и автообновление'],
  console: ['Журнал', 'События приложения и служб'],
  settings: ['Настройки', 'Поведение приложения и интерфейс'],
  about: ['О программе', 'Yume Haze Zapret 2.1.0']
};
function go(page, opts = {}) {
  ui.page = page;
  $$('#nav button, .nav button').forEach(b => b.classList.toggle('on', b.dataset.go === page));
  $$('.page').forEach(p => p.classList.toggle('on', p.id === 'p-' + page));
  const meta = PAGE_META[page] || ['', ''];
  $('#pTitle').textContent = meta[0];
  $('#pSub').textContent = meta[1];
  $('#main').scrollTop = 0;
  if (opts.tab) setTab(opts.tab);
  else if (page === 'zapret') setTab('z:strat');
  else if (page === 'tests') setTab('t:quick');
  refreshDynamic();
}
function setTab(spec) {
  const [group, name] = String(spec).split(':');
  const tabs = $(`.tabs[data-tabs="${group}"]`);
  if (!tabs) return;
  $$('button', tabs).forEach(b => b.classList.toggle('on', b.dataset.tab === name));
  $$(`.pane[data-group="${group}"]`).forEach(p => p.classList.toggle('on', p.dataset.pane === name));
  if (group === 'z' && name === 'lists') loadList(ui.listKind);
  if (group === 'z' && name === 'driver') renderDriver();
  if (group === 't' && name === 'hist') loadHistory();
  if (group === 't' && name === 'pick') renderPickList();
}

document.addEventListener('click', e => {
  const navBtn = e.target.closest('[data-go]');
  if (navBtn) {
    go(navBtn.dataset.go, { tab: navBtn.dataset.tabgo });
    if (navBtn.dataset.listgo) loadList(navBtn.dataset.listgo);
    return;
  }
  const tabBtn = e.target.closest('.tabs [data-tab]');
  if (tabBtn) {
    const group = tabBtn.closest('.tabs').dataset.tabs;
    setTab(`${group}:${tabBtn.dataset.tab}`);
    return;
  }
  const segBtn = e.target.closest('.seg [data-v]');
  if (segBtn) {
    const seg = segBtn.closest('.seg');
    $$('button', seg).forEach(b => b.classList.toggle('on', b === segBtn));
    onSeg(seg.dataset.seg, segBtn.dataset.v);
    return;
  }
  const opt = e.target.closest('.opt');
  if (opt) {
    const wrap = opt.closest('[data-opts]');
    $$('.opt', wrap).forEach(o => o.classList.toggle('on', o === opt));
    if (wrap.dataset.opts === 'game') updateGameNote();
    return;
  }
  const chk = e.target.closest('.check[data-file]');
  if (chk) {
    const f = chk.dataset.file;
    if (pickState.selected.has(f)) pickState.selected.delete(f);
    else pickState.selected.add(f);
    chk.classList.toggle('on', pickState.selected.has(f));
    updatePickSel();
    return;
  }
  const win = e.target.closest('[data-w]');
  if (win) {
    const w = win.dataset.w;
    if (w === 'min') api.minimize();
    if (w === 'max') api.maximize();
    if (w === 'close') api.close();
    return;
  }
  const sw = e.target.closest('.sw');
  if (sw) {
    $$('.sw').forEach(b => b.classList.toggle('on', b === sw));
    const [a1, a2] = sw.dataset.a.split(',');
    applyAccent(a1, a2);
    api.patchSettings({ app: { accent: [a1, a2] } });
    return;
  }
  const tgl = e.target.closest('[data-tgl]');
  if (tgl) { toggleSetting(tgl); return; }
  const svcTgl = e.target.closest('[data-toggle-svc]');
  if (svcTgl) { toggleService(svcTgl.dataset.toggleSvc, svcTgl); return; }
  const strat = e.target.closest('[data-strat]');
  if (strat) { pickStrategy(strat.dataset.strat); return; }
  const act = e.target.closest('[data-act]');
  if (act) { doAction(act.dataset.act, act); return; }
});

function onSeg(name, v) {
  if (name === 'sfilter') { ui.sfilter = v; renderStrategies(); }
  if (name === 'list') { ui.listKind = v; loadList(v); }
  if (name === 'logf') { ui.logFilter.source = v; renderLogs(); }
  if (name === 'pmode') { ui.pmode = v; }
  if (name === 'channel') { ui.channel = v; }
}

$('#stratSearch').addEventListener('input', renderStrategies);
$('#logSearch').addEventListener('input', e => { ui.logFilter.q = e.target.value; renderLogs(); });
$('#gTcp').addEventListener('input', updateGameNote);
$('#gUdp').addEventListener('input', updateGameNote);
$('#listArea').addEventListener('input', () => {
  ui.editList[ui.listKind] = $('#listArea').value;
  const n = $('#listArea').value.split(/\r?\n/).filter(l => l.trim() && !l.trim().startsWith('#')).length;
  $('#listInfo').textContent = `${n} записей · ${new Blob([$('#listArea').value]).size} байт`;
});

$('#orbBtn').addEventListener('click', async () => {
  const zOn = S.zapret && S.zapret.running;
  const tOn = S.tg && S.tg.running;
  const allOn = zOn && (tOn || !(S.tg && S.tg.installed));
  if (allOn) {
    await api.zapret.stop();
    if (S.tg && S.tg.installed) await api.tg.stop();
    toast('Обход выключен', 'Zapret и прокси остановлены');
  } else {
    const res = [];
    if (!zOn) res.push(await api.zapret.start());
    if (S.tg && S.tg.installed && !tOn) res.push(await api.tg.start());
    for (let i = 0; i < res.length; i++) res[i] = await handleAdminResult(res[i], { action: 'start' });
    const bad = res.find(r => r && r.ok === false && r.code !== 'ELEVATION_REQUIRED');
    const elev = res.find(r => r && r.code === 'ELEVATION_REQUIRED');
    if (elev) { /* диалог/баннер уже показаны */ }
    else if (bad) toast('Не удалось включить', bad.error, 'err', 7000);
    else toast('Обход включён', zOn ? 'Прокси запущен' : 'Zapret и прокси запущены');
    if (S.settings && S.settings.app.testOnStart) setTimeout(runQuick, 1500);
  }
});

/* ---------------- настройки: тумблеры ---------------- */
function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
async function toggleSetting(btn) {
  const path = btn.dataset.tgl;
  const cur = !!getPath(S.settings, path);
  const next = !cur;
  btn.classList.toggle('on', next);
  const payload = {};
  const [sec, key] = path.split('.');
  if (!payload[sec]) payload[sec] = {};
  payload[sec][key] = next;
  const r = await api.patchSettings(payload);
  if (r.ok) S.settings = r.settings;
  if (path === 'zapret.checkUpdates') {
    await api.zapret.checkUpdates(next);
    toast(next ? 'Автообновление списков включено' : 'Автообновление списков выключено', 'utils\\check_updates.enabled');
  }
  if (path === 'app.animations') document.documentElement.dataset.anim = next ? '' : 'off';
  syncSettingsUI();
}

function syncSettingsUI() {
  if (!S.settings) return;
  $$('[data-tgl]').forEach(b => b.classList.toggle('on', !!getPath(S.settings, b.dataset.tgl)));
  const accent = (S.settings.app.accent || []).join(',');
  $$('.sw').forEach(b => b.classList.toggle('on', b.dataset.a.replace(/\s/g, '') === accent));
  document.documentElement.dataset.anim = S.settings.app.animations ? '' : 'off';
}

function applyAccent(a1, a2) {
  document.documentElement.style.setProperty('--a1', a1);
  document.documentElement.style.setProperty('--a2', a2);
}

/* ---------------- действия ---------------- */
async function withBtn(btn, fn) {
  if (!btn) return fn();
  btn.classList.add('loading');
  const html = btn.innerHTML;
  btn.innerHTML = '<span class="spinner"></span>';
  try { return await fn(); }
  finally { btn.classList.remove('loading'); btn.innerHTML = html; paintIcons(btn); }
}


/* ---------------- права администратора ---------------- */
function showAdminBanner() {
  const el = $('#adminBanner');
  if (el) el.hidden = false;
}
async function askElevate(action = 'start') {
  const r = await api.elevate(action);
  if (r && r.ok && r.restarted) toast('Перезапуск с правами администратора', 'Zapret включится автоматически', 'ok', 5000);
  else toast('Права не получены', (r && r.error) || 'Можно запустить программу вручную от имени администратора', 'warn', 8000);
  return r;
}
/* Обработка ответа IPC, где может прийти требование UAC */
async function handleAdminResult(r, { action = 'start', silentOk = false } = {}) {
  if (r && r.ok === false && (r.code === 'ELEVATION_REQUIRED')) {
    showAdminBanner();
    if (r.elevation) {
      if (!r.elevation.ok) toast('Нужны права администратора', r.elevation.error || r.error, 'warn', 8000);
    } else {
      await askElevate(action);
    }
    return r;
  }
  return r;
}

async function toggleService(which, btn) {
  const on = btn ? !btn.classList.contains('on') : false;
  if (which === 'z') {
    if (btn) btn.classList.toggle('on', on);
    let r = on ? await api.zapret.start() : await api.zapret.stop();
    r = await handleAdminResult(r, { action: 'toggle' });
    if (!r.ok) { if (btn) btn.classList.toggle('on', false); }
    else toast(on ? 'Zapret включён' : 'Zapret выключен', on ? S.settings.zapret.strategy : '');
  } else {
    if (btn) btn.classList.toggle('on', on);
    const r = on ? await api.tg.start() : await api.tg.stop();
    if (!r.ok) { toast('Прокси: ошибка', r.error, 'err', 8000); if (btn) btn.classList.toggle('on', false); }
    else toast(on ? 'Прокси включён' : 'Прокси выключен', on ? 'Порт ' + S.settings.tg.port : '');
  }
  loadState();
}


/* ---------------- драйвер WinDivert ---------------- */
const DRV_LABEL = {
  'RUNNING': ['Запущена', 'ok'],
  'STOPPED': ['Установлена, не запущена', 'warn'],
  'not-installed': ['Не установлена', 'warn'],
  'unavailable': ['Недоступна', 'bad']
};

async function renderDriver() {
  const box = $('#drvInfo');
  if (!box) return;
  const r = await api.zapret.driver();
  const d = (r && (r.driver || r)) || null;
  /* В Linux «ok: false» — это нормальное состояние (движок ещё не включён),
     поэтому показываем список проверок, а не «не удалось получить». */
  if (!d || (!r.ok && d.platform !== 'linux')) {
    box.innerHTML = `<div class="empty">Не удалось получить состояние драйвера${r && r.error ? ': ' + esc(r.error) : ''}</div>`;
    return;
  }
  const [lbl, kind] = DRV_LABEL[d.service] || [d.service || '—', 'warn'];
  const sig = d.signature;
  const sigText = sig
    ? (sig.valid ? `<span class="chip ok">подпись действительна</span>` : `<span class="chip warn">подпись: ${esc(sig.status || 'неизвестно')}</span>`)
    : '';
  /* Linux: вместо WinDivert — nftables + hz-nfq, показываем реальные проверки движка */
  if (d.platform === 'linux') {
    const items = (d.items || []).map(i => ({ ok: i.ok, label: i.name, detail: i.text, warnOnly: false }));
    const tail = (d.engine && d.engine.tail || []).filter(Boolean).slice(-8);
    box.innerHTML = items.map(r => `
      <div class="diag"><i class="st ${r.ok ? 'ok' : 'bad'}"></i><div class="d"><b>${esc(r.label)}</b><span>${esc(r.detail)}</span></div></div>`).join('') +
      (d.hint ? `<div class="muted" style="font-size:12px;margin-top:8px">${esc(d.hint)}</div>` : '') +
      (tail.length ? `<div class="mt"><b style="font-size:12px">Журнал движка</b><pre class="log" style="max-height:180px;overflow:auto;font-size:11.5px;margin-top:6px">${esc(tail.join('\n'))}</pre></div>` : '') +
      `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
        <button class="btn primary" data-act="drvCheck">Проверить снова</button>
        <button class="btn" data-act="drvSvc" title="systemd: обход поднимается при загрузке">Установить как службу</button>
        <button class="btn ghost" data-act="removeSvc">Удалить службу</button>
      </div>`;
    return;
  }
  const rows = [
    {
      ok: kind === 'ok' || d.service === 'not-installed', label: `Служба драйвера: ${lbl}`,
      detail: d.service === 'not-installed'
        ? 'Службы нет — так и должно быть: драйвер загружает сам winws.exe из папки Zapret.'
        : d.service === 'RUNNING'
        ? 'WinDivert загружен в ядро, перехват трафика доступен.'
        : 'Служба есть, но не работает — обычно это остаток от другого обхода. Нажмите «Убрать службу и перезапустить».',
      extra: sigText
    },
    {
      ok: !!(d.sys && d.sys.exists), label: 'WinDivert64.sys',
      detail: d.sys && d.sys.exists
        ? `${d.sys.path}${d.sys.version ? ' · версия ' + d.sys.version : ''} · ${humanSize(d.sys.size)} · из архива Zapret`
        : 'Файл не найден — переустановите Zapret в разделе «Обновления»'
    },
    {
      ok: !!(d.dll && d.dll.exists), label: 'WinDivert.dll',
      detail: d.dll && d.dll.exists ? d.dll.path : 'Файл не найден — переустановите Zapret'
    },
    {
      ok: !!d.running, label: 'winws.exe',
      detail: d.running ? 'Работает — драйвер уже используется' : 'Не запущен',
      warnOnly: true
    }
  ];
  const pfr = await api.zapret.preflight();
  const pf = pfr && (pfr.problems ? pfr : pfr.preflight) || null;
  const lr = await api.zapret.lastRun();
  if (pf && pf.ok) {
    rows.push({
      ok: pf.ok ? true : false, label: 'Проверка перед запуском',
      detail: pf.problems.length ? pf.problems.join(' ') : 'Драйвер, права и отсутствие конфликтов — в порядке',
      warnOnly: !pf.ok
    });
  }
  const run = lr && lr.run;
  if (run) {
    rows.push({
      ok: run.pids && run.pids.length > 0,
      label: `Последний запуск: ${run.strategy}`,
      detail: run.pids && run.pids.length
        ? `winws.exe работает (PID ${run.pids.join(', ')})`
        : `Не удалось запустить${run.code !== null ? `, код выхода ${run.code}` : ''}`,
      warnOnly: true
    });
    if (run.output) {
      rows.push({
        ok: false, label: 'Ответ winws.exe', warnOnly: true,
        detail: run.output.slice(0, 600)
      });
    }
  }
  box.innerHTML = rows.map(r => `
    <div class="diag"><i class="st ${r.ok ? 'ok' : (r.warnOnly ? 'warn' : 'bad')}"></i><div class="d">
      <b>${esc(r.label)}</b><span>${esc(r.detail)}</span>${r.extra || ''}
    </div></div>`).join('') + `
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
      <button class="btn primary" data-act="drvFix" title="Удаляет старую службу WinDivert (ошибка 123) и сразу запускает стратегию">Убрать службу и перезапустить</button>
      <button class="btn" data-act="drvSvc" title="Запустить Zapret штатной службой Windows, без ручной установки драйвера">Через службу Windows</button>
    </div>`;
}

function humanSize(n) {
  if (!n) return '0 Б';
  const u = ['Б', 'КБ', 'МБ'];
  let i = 0, v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(i ? 1 : 0)} ${u[i]}`;
}

async function doAction(name, btn) {
  switch (name) {
    /* --- общее --- */
    case 'startTest': {
      toast('Проверяю запуск…', 'winws.exe будет запущен с выводом ошибок в журнал', 'info', 3000);
      const r = await withBtn(btn, () => api.zapret.start());
      const res = await handleAdminResult(r, { action: 'start' });
      if (res && res.ok) toast('Запуск успешен', `winws.exe работает (PID ${(res.pids || []).join(', ')})`, 'ok', 6000);
      else if (res && res.code !== 'ELEVATION_REQUIRED') {
        toast('winws.exe не запустился', res.error || '', 'err', 12000);
        await renderDriver();
      }
      loadState();
      break;
    }
    case 'drvCheck': {
      await withBtn(btn, renderDriver);
      toast('Драйвер проверен', 'Состояние обновлено');
      break;
    }
    case 'drvTest': {
      const r = await withBtn(btn, () => api.zapret.checkDriver());
      const res = await handleAdminResult(r, { action: 'driver' });
      if (res && res.ok && res.elevation === undefined) {
        toast('Драйвер работает', 'winws.exe загрузил WinDivert сам — служба не нужна', 'ok', 7000);
      } else if (res && res.ok === false && res.code !== 'ELEVATION_REQUIRED') {
        toast('Драйвер не загрузился', (res.error || '') + ' Можно попробовать «Через службу Windows».', 'err', 14000);
      }
      await loadState();
      if (ui.page === 'updates') renderUpdates(null);
      await renderDriver();
      break;
    }
    case 'drvFix': {
      toast('Убираю службу WinDivert…', 'Драйвер загрузит сам winws.exe', 'info', 4000);
      const r = await withBtn(btn, () => api.zapret.driverFix());
      const res = await handleAdminResult(r, { action: 'driver' });
      if (res && res.ok) {
        toast('Готово', res.pids && res.pids.length ? `winws.exe запущен (PID ${res.pids.join(', ')})` : 'Стратегия запущена', 'ok', 8000);
      } else if (res && res.code !== 'ELEVATION_REQUIRED') {
        toast('Запуск не удался', (res.error || '') + ' Попробуйте «Через службу Windows».', 'err', 14000);
      }
      await loadState();
      await renderDriver();
      break;
    }
    case 'drvSvc': {
      const r = await withBtn(btn, () => api.zapret.startAsService());
      const res = await handleAdminResult(r, { action: 'zapret' });
      if (res && res.ok) toast('Zapret работает службой Windows', `Состояние: ${res.state || 'RUNNING'}`, 'ok', 8000);
      else if (res && res.code !== 'ELEVATION_REQUIRED') toast('Служба не запустилась', res.error || '', 'err', 14000);
      await loadState();
      break;
    }
    case 'restartZ': {
      let r = await withBtn(btn, () => api.zapret.restart());
      if (r && r.code === 'ELEVATION_REQUIRED') { await handleAdminResult(r, { action: 'restart' }); break; }
      if (r && !r.ok && r.error) { toast('Ошибка перезапуска', r.error, 'err', 12000); break; }
      r && r.ok ? toast('Zapret перезапущен', S.settings.zapret.strategy) : toast('Ошибка перезапуска', r && r.error, 'err');
      break;
    }
    case 'quick': {
      await runQuick();
      break;
    }
    case 'autoPick': {
      go('tests', { tab: 't:pick' });
      setTimeout(() => { $('#pickRun') && $('#pickRun').click(); }, 250);
      break;
    }
    case 'tgConnect': {
      const r = await api.tg.openTelegram();
      if (!r.ok) toast('Не удалось открыть Telegram', r.error, 'err');
      else toast('Проверьте Telegram', 'Подтвердите подключение прокси');
      break;
    }
    case 'copyLink': {
      const r = await api.tg.copyLink();
      toast('Ссылка скопирована', r.ok ? r.link : '');
      break;
    }
    case 'newSecret': {
      const r = await api.tg.newSecret();
      if (r.ok) { toast('Новый секрет создан', 'Прокси перезапущен с новым секретом'); loadState(); }
      else toast('Ошибка', r.error, 'err');
      break;
    }
    case 'showSecret': {
      ui.showSecret = !ui.showSecret;
      $('#tgSecret').type = ui.showSecret ? 'text' : 'password';
      break;
    }
    case 'tgSave': {
      const patch = {
        host: $('#tgHost').value.trim(),
        port: Number($('#tgPort').value),
        poolSize: Number($('#tgPoolIn').value),
        secret: $('#tgSecret').value.trim(),
        fakeTlsDomain: $('#tgTls').value.trim()
      };
      const r = await withBtn(btn, () => api.tg.save(patch));
      if (r.ok) toast('Параметры сохранены', r.restarted ? 'Прокси перезапущен' : 'Изменения вступят в силу при запуске');
      else toast('Проверьте параметры', r.error, 'err', 7000);
      loadState();
      break;
    }
    case 'pingDc': {
      const r = await withBtn(btn, () => api.tg.pingDc());
      if (r.ok) { ui.tgPings = r.results; renderDc(); toast('Пинг завершён', r.results.map(x => `DC${x.dc} ${x.ok ? x.ms + ' мс' : '—'}`).join(' · ')); }
      break;
    }

    /* --- zapret --- */
    case 'installSvc': {
      const r = await withBtn(btn, () => api.zapret.installService());
      if (r && r.error && !r.ok) { toast('Не удалось установить службу', r.error, 'err', 12000); loadState(); break; }
      if (r.ok) toast('Служба установлена', r.unit ? `systemd: ${r.unit}` : 'Автозапуск при загрузке системы');
      else toast('Не удалось установить службу', r.error, 'err', 9000);
      loadState();
      break;
    }
    case 'removeSvc': {
      const r = await withBtn(btn, () => api.zapret.removeService());
      if (r.ok) toast('Служба удалена', 'Теперь стратегии управляются вручную');
      else toast('Ошибка', r.error, 'err');
      loadState();
      break;
    }
    case 'fixDiscord': {
      const r = await withBtn(btn, () => api.zapret.clearDiscord());
      if (r.ok) toast('Кэш Discord очищен', r.report.join(' · ').slice(0, 160));
      else toast('Ошибка', r.error, 'err');
      break;
    }
    case 'applyGame': {
      const mode = $('[data-opts="game"] .opt.on');
      const gf = { mode: mode ? mode.dataset.v : 'off', tcp: $('#gTcp').value.trim(), udp: $('#gUdp').value.trim() };
      const r = await withBtn(btn, () => api.zapret.setGameFilter(gf));
      if (r.ok) toast('Игровой фильтр применён', r.restarted ? 'Zapret перезапущен' : 'Применится при запуске Zapret');
      else toast('Проверьте диапазоны', r.error, 'err', 7000);
      loadState();
      break;
    }
    case 'updIpset': {
      const r = await withBtn(btn, () => api.zapret.updateIpset());
      if (r.ok) toast('IPset обновлён', `${r.lines} записей`);
      else toast('Не удалось обновить IPset', r.error, 'err');
      loadState();
      break;
    }
    case 'listSave': {
      const r = await api.zapret.writeList(ui.listKind, $('#listArea').value);
      if (r.ok) { toast('Список сохранён', r.name); delete ui.editList[ui.listKind]; loadState(); }
      else toast('Ошибка', r.error, 'err');
      break;
    }
    case 'listReset': {
      delete ui.editList[ui.listKind];
      loadList(ui.listKind);
      toast('Изменения отменены', 'Загружено содержимое файла');
      break;
    }

    /* --- тесты --- */
    case 'pickRun': {
      if (pickState.running) break;
      const files = [...pickState.selected];
      if (!files.length) { toast('Выберите стратегии', 'Отметьте хотя бы одну в списке слева', 'warn'); break; }
      pickState.running = true;
      pickState.results = [];
      $('#pickStop').disabled = false;
      $('#pickRun').disabled = true;
      $('#pickBanner').hidden = true;
      renderPickResults();
      const r = await api.test.pick({ files, mode: ui.pmode });
      if (!r.ok) toast('Ошибка подбора', r.error, 'err', 8000);
      finishPick();
      break;
    }
    case 'pickStop': {
      await api.test.pickStop();
      $('#pickLabel').textContent = 'Остановка…';
      break;
    }
    case 'pickAll': {
      (S.zapret.strategies || []).forEach(s => pickState.selected.add(s.file));
      renderPickList();
      break;
    }
    case 'pickNone': {
      pickState.selected.clear();
      renderPickList();
      break;
    }
    case 'histClear': {
      await api.test.historyClear('all');
      loadHistory();
      toast('История очищена');
      break;
    }
    case 'diagRun': {
      await runDiagnostics(btn);
      break;
    }

    /* --- обновления --- */
    case 'updCheck': {
      const r = await withBtn(btn, () => api.updates.checkComponents(true));
      if (r && r.ok) { renderUpdates(r.info); toast('Проверка завершена', summaryUpdates(r.info)); }
      else toast('Не удалось проверить', (r && r.error) || 'нет сети', 'err');
      break;
    }
    case 'updAll': {
      const r = await withBtn(btn, () => api.updates.installAll());
      if (r && r.ok) toast('Обновление завершено', r.done && r.done.length ? r.done.join(' · ') : 'Всё уже актуально');
      else toast('Ошибка обновления', (r && r.error) || '', 'err', 9000);
      loadState();
      if (ui.page === 'updates') renderUpdates(null);
      break;
    }
    case 'updApp': {
      const r = await withBtn(btn, () => api.updates.checkComponents(true));
      const A = (r && r.ok && r.info && r.info.app) || null;
      if (A && A.url) { api.openExternal(A.url); toast('Открываю страницу релиза', A.status === 'update' ? 'Доступна версия ' + A.latest : 'Установлена последняя версия'); }
      else { api.openExternal('https://github.com/NobuCraft/yume-haze-zapret/releases/latest'); toast('Открываю релизы', 'Страница загрузки установщика'); }
      loadState();
      break;
    }
    case 'installZapret': {
      const r = await withBtn(btn, () => api.updates.install('zapret'));
      if (r && r.ok) toast('Zapret установлен', 'Версия ' + (r.version || 'последняя'));
      else toast('Ошибка установки', r.error, 'err', 9000);
      loadState();
      break;
    }
    case 'installTg': {
      const r = await withBtn(btn, () => api.updates.install('tg'));
      if (r && r.ok) toast('TG WS Proxy установлен', r.version || '');
      else toast('Ошибка установки', r.error, 'err', 9000);
      loadState();
      break;
    }

    /* --- журнал --- */
    case 'logCopy': {
      const t = await api.logs.text();
      await api.copy(t.text || '');
      toast('Журнал скопирован', `${t.text.split('\n').length} строк`);
      break;
    }
    case 'logClear': {
      await api.logs.clear();
      S.logs = [];
      renderLogs();
      break;
    }

    /* --- настройки / пути --- */
    case 'reset': {
      const r = await api.resetSettings();
      if (r.ok) { S.settings = r.settings; syncSettingsUI(); toast('Настройки сброшены', 'Значения по умолчанию восстановлены'); loadState(); }
      break;
    }
    case 'pickZapretDir': {
      const r = await api.pickDir();
      if (r.ok && r.path) {
        const s = await api.zapret.setDir(r.path);
        if (s.ok) toast('Папка Zapret изменена', s.dir);
        else toast('Неверная папка', s.error, 'err');
        loadState();
      }
      break;
    }
    case 'openZapretDir': {
      if (S.zapret) await api.openPath(S.zapret.dir);
      break;
    }
    case 'openTgDir': {
      if (S.tg && S.tg.path) await api.showItem(S.tg.path);
      break;
    }

    /* --- о программе --- */
    case 'linkZapret': api.openExternal('https://github.com/Flowseal/zapret-discord-youtube/releases'); break;
    case 'linkTg': api.openExternal('https://github.com/Flowseal/tg-ws-proxy/releases'); break;
    case 'linkDiscord': api.openExternal('https://discord.gg/qHabsmgKVP'); break;
    case 'linkGithub': api.openExternal('https://github.com/NobuCraft/yume-haze-zapret'); break;
    case 'linkRelease': api.openExternal('https://github.com/NobuCraft/yume-haze-zapret/releases/latest'); break;
    case 'showNotes': {
      const info = showNotes.info;
      if (!info) break;
      showModal(info.title, `<div class="notes">${esc(info.notes || 'Описание не опубликовано')}</div>`, [{ label: 'Закрыть', pri: true, fn: closeModal }, { label: 'Открыть на GitHub', fn: () => api.openExternal(info.url) }]);
      break;
    }
  }
}

/* ---------------- тест доступности ---------------- */
async function runQuick() {
  if (testRunning) return;
  testRunning = true;
  renderTargetsLoading('ovTargets');
  renderTargetsLoading('qtTargets');
  const r = await api.test.quick('all');
  testRunning = false;
  if (!r.ok) { toast('Тест не выполнен', r.error, 'err'); return; }
  lastTest = r;
  renderTargets();
  renderOverview();
  go(ui.page);
  toast(`Тест завершён: ${r.score}/100`, r.services.map(s => `${s.name} ${s.ok}/${s.total}`).join(' · '), r.score >= 55 ? 'ok' : 'warn', 6000);
}

function renderTargetsLoading(id) {
  const el = $('#' + id);
  if (!el) return;
  el.innerHTML = ['discord.com', 'gateway.discord.gg', 'youtube.com', 'google.com', 'cloudflare.com', '1.1.1.1'].map(n =>
    `<div class="tg-item pending"><div class="t"><i class="dot"></i><span>${n}</span></div><div class="s">проверка…</div></div>`).join('');
}

function renderTargets() {
  const list = lastTest ? lastTest.results : [];
  const html = list.map(r => `
    <div class="tg-item ${r.ok ? 'ok' : 'bad'}">
      <div class="t"><i class="dot ${r.ok ? 'on' : 'off'}"></i><span>${esc(r.key)}</span></div>
      <div class="s">${r.ok ? (r.ms ? r.ms + ' мс' : 'доступен') : 'недоступен'}</div>
    </div>`).join('');
  const empty = '<div class="empty">Нажмите «Проверить», чтобы узнать доступность сервисов</div>';
  $('#ovTargets').innerHTML = html || empty;
  $('#qtTargets').innerHTML = html || empty;
  $('#qtHosts').innerHTML = list.filter(r => r.service === 'DNS').map(r =>
    `<span class="h ${r.ok ? 'ok' : 'bad'}">${icon('pulse')}${esc(r.key)} ${r.ok ? r.ms + ' мс' : '—'}</span>`).join('');
  $('#qtStrat').textContent = S.settings ? S.settings.zapret.strategy : '—';
}

/* ---------------- карточки статусов ---------------- */
function renderOverview(opts = {}) {
  const z = S.zapret, t = S.tg;
  if (!z && !t) return;                   // состояние ещё не пришло — рисовать нечего
  try { renderOverviewInner(z, t); } catch (e) { console.error('renderOverview', e); }
}

/* Обёртка: сбой одного блока не должен оставлять интерфейс пустым. */
function guard(fn, label = '') {
  try { fn(); } catch (e) { console.error('UI' + (label ? ' · ' + label : ''), e); }
}

function renderOverviewInner(z, t) {
  const _abS = $('#abS');
  const _abT = $('#abT');
  const _abZ = $('#abZ');
  const _gTcp = $('#gTcp');
  const _gUdp = $('#gUdp');
  const _gameNote = $('#gameNote');
  const _hero = $('#hero');
  const _hpTt = $('#hpTt');
  const _hpZt = $('#hpZt');
  const _ipCount = $('#ipCount');
  const _ipDate = $('#ipDate');
  const _ovBestTag = $('#ovBestTag');
  const _ovEvents = $('#ovEvents');
  const _ovRing = $('#ovRing');
  const _ovRingTxt = $('#ovRingTxt');
  const _ovStrat = $('#ovStrat');
  const _ovStratSub = $('#ovStratSub');
  const _pathT = $('#pathT');
  const _pathTState = $('#pathTState');
  const _pathZ = $('#pathZ');
  const _pathZState = $('#pathZState');
  const _sdTt = $('#sdTt');
  const _sdZt = $('#sdZt');
  const _stateLabel = $('#stateLabel');
  const _stateSub = $('#stateSub');
  const _svcTchip = $('#svcTchip');
  const _svcTmeta = $('#svcTmeta');
  const _svcZchip = $('#svcZchip');
  const _svcZmeta = $('#svcZmeta');
  const _tChip = $('#tChip');
  const _tgConn = $('#tgConn');
  const _tgHost = $('#tgHost');
  const _tgLink = $('#tgLink');
  const _tgPool = $('#tgPool');
  const _tgPoolIn = $('#tgPoolIn');
  const _tgPort = $('#tgPort');
  const _tgRx = $('#tgRx');
  const _tgSecret = $('#tgSecret');
  const _tgTls = $('#tgTls');
  const _tgTx = $('#tgTx');
  const _tgUp = $('#tgUp');
  const _zChip = $('#zChip');
  const _zMeta = $('#zMeta');
  const _zStratKv = $('#zStratKv');
  const _zUp = $('#zUp');
  const zOn = z && z.running, tOn = t && t.running;
  const anyOn = zOn || tOn;
  if (!_hero || !_stateLabel || !_stateSub) return;   // разметка не та — молча выходим
  _hero.classList.toggle('on', !!anyOn);
  _stateLabel.textContent = anyOn ? 'Защита активна' : 'Защита выключена';
  const parts = [];
  if (zOn) parts.push('Zapret · ' + (S.settings ? strategyName(S.settings.zapret.strategy) : ''));
  if (tOn) parts.push('прокси на порту ' + (S.settings ? S.settings.tg.port : ''));
  _stateSub.textContent = anyOn ? parts.join(' · ') : 'Включите обход кнопкой питания';

  _svcZchip.outerHTML = `<span class="chip ${zOn ? 'on' : ''}" id="svcZchip">${z ? (zOn ? 'работает' : 'остановлен') : '—'}</span>`;
  _svcZmeta.textContent = z ? (z.installed ? `${strategyName(z.strategy)} · ${z.running ? dur(Date.now() - (z.startedAt || Date.now())) : 'не запущен'}` : 'не установлен — раздел «Обновления»') : '—';
  _svcTchip.outerHTML = `<span class="chip ${tOn ? 'on' : ''}" id="svcTchip">${t ? (tOn ? 'работает' : 'остановлен') : '—'}</span>`;
  _svcTmeta.textContent = t ? (t.installed ? `127.0.0.1:${t.settings.port} · секрет dd…${t.settings.secret.slice(-4)}` : 'не установлен — раздел «Обновления»') : '—';

  $$('[data-toggle-svc="z"]').forEach(b => b.classList.toggle('on', !!zOn));
  $$('[data-toggle-svc="t"]').forEach(b => b.classList.toggle('on', !!tOn));

  /* статусы в шапке и сайдбаре */
  setDot('sdZ', zOn); setDot('sdT', tOn);
  setDot('hpZ', zOn); setDot('hpT', tOn);
  _sdZt.textContent = z ? (zOn ? 'вкл' : z.installed ? 'выкл' : 'нет') : '—';
  _sdTt.textContent = t ? (tOn ? 'вкл' : t.installed ? 'выкл' : 'нет') : '—';
  _hpZt.textContent = zOn ? 'Zapret активен' : 'Zapret выключен';
  _hpTt.textContent = tOn ? 'Прокси активен' : 'Прокси выключен';

  /* стратегия + оценка */
  const strat = S.settings ? S.settings.zapret.strategy : '—';
  _ovStrat.textContent = strategyName(strat);
  const sc = lastTest ? lastTest.score : (lastPickBest() ? lastPickBest().score : null);
  _ovRing.style.setProperty('--v', sc == null ? 0 : sc);
  _ovRingTxt.textContent = sc == null ? '—' : sc;
  const svcOk = lastTest ? lastTest.services.filter(s => (s.score != null ? s.score >= 50 : s.ok > 0 && s.ok === s.total)).length : 0;
  const meta = lastTest
    ? `Проверено ${fmtTime(lastTest.ts)} · ${svcOk} из ${lastTest.services.length} сервисов`
    : lastPickBest() ? `Лучший результат автоподбора` : 'Запустите тест доступности';
  _ovStratSub.textContent = meta;
  const tag = $('#ovBestTag');
  if (lastTest) {
    tag.textContent = lastTest.grade === 'good' ? 'рабочая' : lastTest.grade === 'weak' ? 'слабая' : 'не работает';
  } else tag.textContent = '—';

  /* события */
  const evs = (S.logs || []).slice(-9).reverse();
  _ovEvents.innerHTML = evs.length ? evs.map(e => `
    <div class="ev ${e.level === 'error' ? 'err' : ''}"><time>${fmtTime(e.ts)}</time><span>${esc(e.message)}</span></div>`).join('')
    : '<div class="empty">Событий пока нет</div>';

  /* zapret page */
  guard(() => {
  if (z) {
    _zChip.outerHTML = `<span class="chip ${zOn ? 'on' : ''}" id="zChip">${zOn ? 'работает' : z.installed ? 'остановлен' : 'не установлен'}</span>`;
    _zMeta.textContent = z.installed ? `${z.version} · ${z.dir}` : 'Установите компонент в разделе «Обновления»';
    _zUp.textContent = zOn ? dur(Date.now() - (z.startedAt || Date.now())) : '—';
    _zStratKv.textContent = strategyName(z.strategy);
    _ipCount.textContent = z.ipset ? z.ipset.lines.toLocaleString('ru-RU') : '—';
    _ipDate.textContent = z.ipset && z.ipset.updated ? new Date(z.ipset.updated).toLocaleDateString('ru-RU') : '—';
    $$('[data-opts="game"] .opt').forEach(o => o.classList.toggle('on', o.dataset.v === (z.gameFilter.mode === 'off' ? 'off' : z.gameFilter.mode)));
    $$('[data-opts="ipset"] .opt').forEach(o => o.classList.toggle('on', o.dataset.v === z.ipset.mode));
    if (document.activeElement !== $('#gTcp') && !_gTcp.dataset.dirty) _gTcp.value = z.gameFilter.tcp;
    if (document.activeElement !== $('#gUdp') && !_gUdp.dataset.dirty) _gUdp.value = z.gameFilter.udp;
    _gameNote.textContent = z.gameFilter.mode === 'off'
      ? 'Игровой фильтр выключен — обход только для веб-трафика'
      : `TCP: ${z.gameFilter.mode === 'off' ? '—' : z.gameFilter.tcp} · UDP: ${z.gameFilter.udp}`;
    _pathZ.value = z.dir || '';
    _pathZState.textContent = z.installed ? `Zapret ${z.version} · найден` : 'не найден';
    _abZ.textContent = z.version || '—';
    _abS.textContent = (z.strategies || []).length;
  } }, 'страница Zapret');

  /* tg page */
  guard(() => {
  if (t) {
    _tChip.outerHTML = `<span class="chip ${tOn ? 'on' : ''}" id="tChip">${tOn ? 'работает' : t.installed ? 'остановлен' : 'не установлен'}</span>`;
    if (document.activeElement !== $('#tgLink')) _tgLink.value = t.link;
    if (document.activeElement !== $('#tgSecret')) _tgSecret.value = t.settings.secret;
    if (document.activeElement !== $('#tgHost')) _tgHost.value = t.settings.host;
    if (document.activeElement !== $('#tgPort')) _tgPort.value = t.settings.port;
    if (document.activeElement !== $('#tgPoolIn')) _tgPoolIn.value = t.settings.poolSize;
    if (document.activeElement !== $('#tgTls')) _tgTls.value = t.settings.fakeTlsDomain || '';
    _tgUp.textContent = tOn ? dur(Date.now() - (t.startedAt || Date.now())) : 'остановлен';
    _tgConn.textContent = t.stats.total || 0;
    _tgPool.textContent = `${t.settings.poolSize} / 16`;
    _tgRx.textContent = bytes(t.stats.down);
    _tgTx.textContent = bytes(t.stats.up);
    _pathT.value = t.path || '';
    _pathTState.textContent = t.installed ? `Найден${t.version ? ' · ' + t.version : ''}` : 'не найден';
    _abT.textContent = t.version || '—';
    renderDc();
  } }, 'страница TG');
  // Раньше здесь на КАЖДОМ тике (раз в 4 с) перерисовывался список из 22 стратегий
  // и таблица дата-центров — даже когда эти страницы не открыты.
  if (ui.page === 'zapret') { renderStrategies(); }
  if (ui.page === 'tg') { renderDc(); }
  if (ui.page === 'updates') renderUpdates(null);
  if (ui.page === 'console') renderLogs();
}

function setDot(id, on) {
  const el = $('#' + id);
  if (el) el.className = 'dot ' + (on ? 'on' : 'off');
}
function strategyName(file) {
  const s = (S.zapret && S.zapret.strategies || []).find(x => x.file === file);
  return s ? s.name : (file || '—');
}
function lastPickBest() {
  if (pickState.results && pickState.results.length) {
    const sorted = [...pickState.results].sort((a, b) => b.score - a.score);
    return sorted[0];
  }
  return null;
}

/* ---------------- стратегии ---------------- */
function renderStrategies() {
  const grid = $('#stratGrid');
  if (!grid || !S.zapret) return;
  const q = ($('#stratSearch').value || '').toLowerCase().trim();
  const best = {};
  (pickState.results || []).forEach(r => { best[r.file] = r; });
  const rows = (S.zapret.strategies || []).filter(s => {
    if (q && !(s.name + ' ' + s.note + ' ' + s.feats.join(' ')).toLowerCase().includes(q)) return false;
    const b = best[s.file];
    if (ui.sfilter === 'good') return b && b.score >= 55;
    if (ui.sfilter === 'weak') return b && b.score < 55;
    return true;
  });
  grid.innerHTML = rows.map(s => {
    const b = best[s.file];
    const on = S.settings && S.settings.zapret.strategy === s.file;
    return `<button class="stg ${on ? 'on' : ''}" data-strat="${esc(s.file)}">
      ${b ? `<span class="badge-score ${b.score >= 70 ? '' : b.score >= 40 ? 'weak' : 'bad'}">${b.score}</span>` : ''}
      <div class="top"><span class="nm">${esc(s.name)}</span>${on ? '<span class="tag" style="background:rgba(185,162,255,.2);color:#d8c9ff">выбрана</span>' : `<span class="tag">${esc(s.group)}</span>`}</div>
      <div class="note">${esc(s.note)}</div>
      <div class="feats">${s.feats.map(f => `<span class="f">${esc(f)}</span>`).join('')}</div>
      <div class="row" style="font-size:11px" class="muted"><span class="mono muted">${esc(s.file)}</span><span class="go">Применить →</span></div>
    </button>`;
  }).join('') || '<div class="empty">Ничего не найдено</div>';
}

async function pickStrategy(file) {
  const r = await api.zapret.setStrategy(file);
  if (!r.ok) return toast('Ошибка', r.error, 'err');
  toast('Стратегия выбрана', strategyName(file) + (r.restarted ? ' · Zapret перезапущен' : ''));
  loadState();
}

/* ---------------- списки ---------------- */
async function loadList(kind) {
  ui.listKind = kind || ui.listKind;
  $$('[data-seg="list"] button').forEach(b => b.classList.toggle('on', b.dataset.v === ui.listKind));
  const r = await api.zapret.readList(ui.listKind);
  const text = r.ok ? r.text : '';
  $('#listArea').value = text;
  const n = text.split(/\r?\n/).filter(l => l.trim() && !l.trim().startsWith('#')).length;
  $('#listInfo').textContent = `${n} записей · ${new Blob([text]).size} байт`;
}

function updateGameNote() {
  const mode = $('[data-opts="game"] .opt.on');
  const m = mode ? mode.dataset.v : 'off';
  $('#gTcp').dataset.dirty = '1';
  $('#gUdp').dataset.dirty = '1';
  $('#gameNote').textContent = m === 'off'
    ? 'Игровой фильтр выключен — обход только для веб-трафика (80/443)'
    : `Будут добавлены порты TCP ${$('#gTcp').value} и UDP ${$('#gUdp').value} поверх стандартных`;
}

/* ---------------- дата-центры ---------------- */
function renderDc() {
  const t = S.tg;
  if (!t) return;
  const pings = ui.tgPings || [];
  const dcs = [
    { dc: 1, host: '149.154.175.50' }, { dc: 2, host: '149.154.167.51' },
    { dc: 3, host: '149.154.175.100' }, { dc: 4, host: '149.154.167.91' },
    { dc: 5, host: '91.108.56.130' }
  ];
  $('#dcList').innerHTML = dcs.map(d => {
    const p = pings.find(x => x.dc === d.dc);
    const ms = p && p.ok ? p.ms + ' мс' : (p ? '—' : '');
    return `<div class="dc"><i class="dot ${p ? (p.ok ? 'on' : 'off') : ''}"></i>
      <span class="nm">DC${d.dc}<span class="ip"> · ${d.host}</span></span>
      <span class="ms ${p && p.ok ? 'good' : p ? 'bad' : ''}">${ms}</span></div>`;
  }).join('');
}

/* ---------------- подбор ---------------- */
function renderPickList() {
  const wrap = $('#pickList');
  if (!wrap || !S.zapret) return;
  const best = {};
  (pickState.results || []).forEach(r => best[r.file] = r);
  wrap.innerHTML = (S.zapret.strategies || []).map(s => {
    const b = best[s.file];
    const on = pickState.selected.has(s.file);
    return `<div class="check ${on ? 'on' : ''} ${pickState.current === s.name ? 'cur' : ''}" data-file="${esc(s.file)}">
      <span class="box">${icon('check')}</span>
      <span class="nm">${esc(s.name)}</span>
      <span class="sc">${b ? b.score : ''}</span>
    </div>`;
  }).join('');
  updatePickSel();
}

function updatePickSel() {
  const n = pickState.selected.size;
  const total = (S.zapret && S.zapret.strategies || []).length;
  $('#pickSel').textContent = `Выбрано ${n} из ${total}`;
}

function renderPickResults() {
  const box = $('#pickResults');
  const rows = [...(pickState.results || [])].sort((a, b) => b.score - a.score);
  if (!rows.length) { box.innerHTML = '<div class="empty">Запустите подбор — результаты появятся здесь</div>'; return; }
  box.innerHTML = `<table class="tbl"><thead><tr><th>#</th><th>Стратегия</th><th>Discord</th><th>YouTube</th><th style="width:90px">Оценка</th><th></th></tr></thead><tbody>
  ${rows.map((r, i) => `
    <tr><td class="num">${i + 1}</td>
      <td><b style="font-weight:500">${esc(r.name)}</b></td>
      <td class="num">${svcCell(r, 'Discord')}</td>
      <td class="num">${svcCell(r, 'YouTube')}</td>
      <td><div class="mini-bar"><i style="width:${r.score}%"></i></div><span class="num muted" style="font-size:11px">${r.score}</span></td>
      <td class="num"><button class="btn sm ghost" data-apply="${esc(r.file)}">Применить</button></td></tr>`).join('')}
  </tbody></table>`;
  $$('[data-apply]', box).forEach(b => b.addEventListener('click', async () => {
    const res = await api.test.applyStrategy(b.dataset.apply);
    if (res.ok) { toast('Стратегия применена', strategyName(b.dataset.apply)); loadState(); }
    else toast('Ошибка', res.error, 'err');
  }));
}
function svcCell(r, name) {
  const s = (r.services || []).find(x => x.name === name);
  if (!s) return '—';
  return `<span style="color:${s.ok === s.total ? 'var(--ok)' : s.ok ? 'var(--warn)' : 'var(--bad)'}">${s.ok}/${s.total}</span>`;
}

function finishPick() {
  pickState.running = false;
  $('#pickStop').disabled = true;
  $('#pickRun').disabled = false;
  $('#pickBar').style.width = '100%';
  renderPickResults();
  loadState();
}

/* ---------------- история ---------------- */
async function loadHistory() {
  const r = await api.test.history();
  if (!r.ok) return;
  const { tests, picks } = r;
  const rows = [
    ...picks.map(p => ({ kind: 'pick', ts: p.ts, title: `Подбор · ${p.best ? p.best.name : 'без результата'}`, score: p.best ? p.best.score : 0, file: p.best ? p.best.file : null, extra: `${p.total} стратегий` })),
    ...tests.map(t => ({ kind: 'test', ts: t.ts, title: `Тест · ${strategyName(t.strategy)}`, score: t.score, file: t.strategy, extra: t.services.map(s => `${s.name} ${s.ok}/${s.total}`).join(' · ') }))
  ].sort((a, b) => b.ts - a.ts).slice(0, 40);
  $('#histList').innerHTML = rows.length ? `<div class="tbl-wrap"><table class="tbl">
    <thead><tr><th>Когда</th><th>Тип</th><th>Стратегия</th><th>Оценка</th><th></th></tr></thead><tbody>
    ${rows.map(r => `<tr>
      <td class="num">${new Date(r.ts).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
      <td>${r.kind === 'pick' ? '<span class="chip acc">подбор</span>' : '<span class="chip">тест</span>'}</td>
      <td>${esc(r.title)}<div class="muted" style="font-size:11px">${esc(r.extra || '')}</div></td>
      <td class="num">${r.score}</td>
      <td class="num">${r.file ? `<button class="btn sm ghost" data-apply="${esc(r.file)}">Вернуть</button>` : ''}</td>
    </tr>`).join('')}</tbody></table></div>`
    : '<div class="empty">История пуста — запустите тест или автоподбор</div>';
  $$('[data-apply]', $('#histList')).forEach(b => b.addEventListener('click', async () => {
    const res = await api.test.applyStrategy(b.dataset.apply);
    if (res.ok) { toast('Стратегия возвращена', strategyName(b.dataset.apply)); loadState(); }
  }));
}

/* ---------------- диагностика ---------------- */
async function runDiagnostics(btn) {
  const box = $('#diagList');
  box.innerHTML = '<div class="pulse-track"><i></i></div>';
  const [z, t] = await Promise.all([
    withBtn(btn, async () => { const r = await api.zapret.diagnostics(); return r; }),
    api.tg.diagnostics()
  ]);
  const items = [];
  if (z && z.ok) items.push(...z.items);
  if (t && t.ok) items.push(...t.items.map(i => ({ ...i, title: 'Прокси · ' + i.title })));
  const count = { ok: 0, warn: 0, bad: 0 };
  items.forEach(i => count[i.status] = (count[i.status] || 0) + 1);
  box.innerHTML = items.length ? items.map(i => `
    <div class="diag"><i class="st ${i.status}"></i><div class="d">
      <b>${esc(i.title)}</b><span>${esc(i.detail)}</span>
      ${i.hint && i.status !== 'ok' ? `<div class="hint">${esc(i.hint)}</div>` : ''}
    </div></div>`).join('')
    : '<div class="empty">Проверка не дала результатов</div>';
  toast('Диагностика завершена', `ок: ${count.ok} · внимание: ${count.warn} · проблем: ${count.bad}`, count.bad ? 'warn' : 'ok', 6000);
}

/* ---------------- обновления ---------------- */
let updateCache = null;
function summaryUpdates(info) {
  if (!info) return '';
  const part = [];
  if (info.zapret) part.push(`Zapret ${info.zapret.current || '—'} → ${info.zapret.latest}`);
  if (info.tg) part.push(`TG ${info.tg.current || '—'} → ${info.tg.latest}`);
  return part.join(' · ');
}

function renderUpdates(info) {
  if (info) updateCache = info;
  const i = updateCache;
  const z = S.zapret, t = S.tg;
  if (!i) {
    $('#updTitle').textContent = 'Проверка обновлений';
    $('#updSub').textContent = 'Нажмите «Проверить», чтобы запросить GitHub';
  } else {
    const pending = [i.zapret, i.tg].filter(c => c && c.status !== 'ok');
    $('#updTitle').textContent = pending.length ? `Доступно обновлений: ${pending.length}` : 'Всё актуально';
    $('#updSub').textContent = 'Последняя проверка: ' + new Date(i.at).toLocaleTimeString('ru-RU') + ' · ' + summaryUpdates(i);
    const badge = $('#updBadge');
    badge.textContent = pending.length;
    badge.hidden = !pending.length;
  }

  const comp = (title, sub, cur, latest, status, notes, url, act) => `
    <div class="comp">
      <div class="ico">${icon(act === 'installTg' ? 'send' : 'bolt')}</div>
      <div class="info"><b>${title} ${status === 'ok' ? '<span class="chip on">актуально</span>' : status === 'update' ? '<span class="chip" style="background:rgba(255,207,122,.18);color:#ffe0a5">обновление</span>' : '<span class="chip" style="background:rgba(255,122,138,.18);color:#ffb3bd">не установлено</span>'}</b>
        <span>${esc(sub)}</span></div>
      <div class="ver"><b>${esc(cur || '—')}</b>→ ${esc(latest || '—')}</div>
      <div class="btns">
        ${notes ? `<button class="btn sm ghost" data-notes="${esc(act)}">Что нового</button>` : ''}
        <button class="btn sm ${status === 'ok' ? '' : 'pri'}" data-act="${act}">${status === 'ok' ? 'Переустановить' : status === 'update' ? 'Обновить' : 'Установить'}</button>
      </div>
    </div>`;

  const drvState = (S.driver && S.driver.service) || null;
  const drvChip = drvState === 'RUNNING' ? '<span class="chip on">работает</span>'
    : drvState === 'STOPPED' ? '<span class="chip" style="background:rgba(255,207,122,.18);color:#ffe0a5">служба не запускается</span>'
    : '<span class="chip on">грузит winws.exe</span>';
  const drvSys = S.driver && S.driver.sys;
  // сама оболочка: проверяем релизы в репозитории пользователя
  const A = (i && i.app) || null;
  const appStatus = A ? A.status : 'ok';
  const appUrl = (A && A.url) || 'https://github.com/NobuCraft/yume-haze-zapret/releases/latest';
  $('#compList').innerHTML =
    `<div class="comp">
      <div class="ico">${icon('home')}</div>
      <div class="info"><b>Yume Haze Zapret (оболочка) ${appStatus === 'update'
          ? '<span class="chip" style="background:rgba(255,207,122,.18);color:#ffe0a5">доступна новая версия</span>'
          : '<span class="chip on">актуально</span>'}</b>
        <span>Обновления проверяются по репозиторию NobuCraft/yume-haze-zapret · установщик скачивается с GitHub</span></div>
      <div class="ver"><b>${esc((A && A.current) || '—')}</b>→ ${esc((A && A.latest) || '—')}</div>
      <div class="btns">
        <button class="btn sm ghost" data-act="linkRelease">Скачать установщик</button>
        <button class="btn sm ${appStatus === 'update' ? 'pri' : ''}" data-act="updApp">${appStatus === 'update' ? 'Открыть установщик' : 'Проверить'}</button>
      </div>
    </div>` +
    comp('Zapret', z && z.installed ? z.dir : 'Flowseal/zapret-discord-youtube · обход DPI', i ? i.zapret.current : (z && z.version), i ? i.zapret.latest : (z && z.expectedVersion), i ? i.zapret.status : (z && z.installed ? 'ok' : 'install'), i && i.zapret.notes, i && i.zapret.url, 'installZapret') +
    comp('TG WS Proxy', t && t.installed ? t.path : 'Flowseal/tg-ws-proxy · MTProto через WebSocket', i ? i.tg.current : (t && t.version), i ? i.tg.latest : '—', i ? i.tg.status : (t && t.installed ? 'ok' : 'install'), i && i.tg.notes, i && i.tg.url, 'installTg') +
    `<div class="comp">
      <div class="ico">${icon('chip')}</div>
      <div class="info"><b>Драйвер WinDivert ${drvChip}</b>
        <span>${esc(drvSys && drvSys.exists
          ? 'Из архива Zapret (Flowseal) · ' + drvSys.path + (drvSys.version ? ' · ' + drvSys.version : '')
          : 'Файлы драйвера приходят в архиве Zapret — переустановите Zapret слева')}</span></div>
      <div class="ver"><b>${esc((drvSys && drvSys.version) || '—')}</b>в архиве Zapret</div>
      <div class="btns">
        <button class="btn sm ghost" data-act="drvCheck">Проверить</button>
        <button class="btn sm" data-act="drvFix" title="Удалить мешающую службу WinDivert и перезапустить Zapret">Починить</button>
      </div>
    </div>`;

  $$('[data-notes]').forEach(b => b.addEventListener('click', () => {
    const which = b.dataset.notes;
    const info = which === 'installTg' ? i.tg : i.zapret;
    showModal(which === 'installTg' ? 'TG WS Proxy · что нового' : 'Zapret · что нового',
      `<div class="notes">${esc(info.notes || 'Описание не опубликовано')}</div>
       <div class="foot"><button class="btn sm" id="mOpen">Открыть на GitHub</button><button class="btn sm pri" id="mClose">Закрыть</button></div>`);
    $('#mOpen').onclick = () => api.openExternal(info.url);
    $('#mClose').onclick = closeModal;
  }));
}

/* ---------------- журнал ---------------- */
function renderLogs() {
  const box = $('#logBox');
  if (!box) return;
  const f = ui.logFilter;
  let list = S.logs || [];
  if (f.source !== 'all') list = f.source === 'ERR' ? list.filter(e => e.level === 'error') : list.filter(e => e.source === f.source);
  if (f.q) { const q = f.q.toLowerCase(); list = list.filter(e => e.message.toLowerCase().includes(q)); }
  list = list.slice(-400);
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
  box.innerHTML = list.map(e => `<div class="logline ${e.level === 'error' ? 'err' : ''}">
    <time>${fmtTime(e.ts)}</time><span class="src ${e.source}">${e.source}</span><span class="msg">${esc(e.message)}</span></div>`).join('')
    || '<div class="empty">Журнал пуст</div>';
  if (atBottom) box.scrollTop = box.scrollHeight;
}

/* ---------------- модалка ---------------- */
function showModal(title, html, buttons) {
  const bg = $('#modalBg');
  $('#modal').innerHTML = `<h3>${esc(title)}</h3>${html}`;
  bg.classList.add('on');
  if (buttons) {
    const foot = document.createElement('div');
    foot.className = 'foot';
    buttons.forEach(b => {
      const el = document.createElement('button');
      el.className = 'btn sm' + (b.pri ? ' pri' : '');
      el.textContent = b.label;
      el.onclick = b.fn;
      foot.appendChild(el);
    });
    $('#modal').appendChild(foot);
  }
}
function closeModal() { $('#modalBg').classList.remove('on'); }
$('#modalBg').addEventListener('click', e => { if (e.target.id === 'modalBg') closeModal(); });

/* ---------------- состояние ---------------- */
async function loadState() {
  const r = await api.state();
  if (!r.ok) return;
  const first = !S.zapret;
  S.zapret = r.zapret; S.tg = r.tg; S.settings = r.settings; S.logs = r.logs; S.update = r.update;
  if (first) {
    applyAccent(...(S.settings.app.accent || ['#b9a2ff', '#ff9fcb']));
    document.documentElement.dataset.anim = S.settings.app.animations ? '' : 'off';
    (S.zapret.strategies || []).forEach(s => pickState.selected.add(s.file));
    renderPickList();
    syncSettingsUI();
    renderPickList();
  }
  $('#updBadge').hidden = !S.update;
  if (S.update) $('#updBadge').textContent = S.update;
  renderOverview();
  renderPickList();
  if (ui.page === 'console') renderLogs();
  if (ui.page === 'tests') { if (!$('#histList').childElementCount) loadHistory(); }
}

function refreshDynamic() {
  if (!uiVisible()) return;
  renderOverview();                       // обзор + общие элементы (шапка, чипы, сайдбар)
  if (ui.page === 'console') renderLogs();
  if (ui.page === 'zapret') {
    renderStrategies();
    renderDriver();                       // содержимое вкладки «Драйвер»
    loadList(ui.listKind);                // списки доменов
  }
  if (ui.page === 'tests') {
    if (!$('#histList').childElementCount) loadHistory();
    renderPickList();
  }
  if (ui.page === 'updates') renderUpdates(null);
}

/* ---------------- события из main ---------------- */
api.onState(st => {
  S.zapret = st.zapret; S.tg = st.tg; S.settings = st.settings;
  S.logs = st.logs || S.logs;
  S.update = st.update || 0;
  if (!uiVisible()) { S.dirty = true; return; }   // свёрнуто — отрисовываем при возврате
  const badge = $('#updBadge');
  if (badge && badge.hidden === !!S.update) {
    badge.hidden = !S.update;
    if (S.update) badge.textContent = S.update;
  }
  renderOverview();
  if (ui.page === 'console') renderLogs();
});

api.onLog(entry => {
  S.logs.push(entry);
  if (ui.page === 'console' && ui.logFilter.source === 'all' && !ui.logFilter.q) {
    const box = $('#logBox');
    const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
    box.insertAdjacentHTML('beforeend', `<div class="logline ${entry.level === 'error' ? 'err' : ''}"><time>${fmtTime(entry.ts)}</time><span class="src ${entry.source}">${entry.source}</span><span class="msg">${esc(entry.message)}</span></div>`);
    if (atBottom) box.scrollTop = box.scrollHeight;
  }
});

/* Пачка строк журнала: одна перерисовка вместо N вставок в DOM. */
api.onLogBatch(batch => {
  if (!Array.isArray(batch) || !batch.length) return;
  S.logs.push(...batch);
  if (S.logs.length > 600) S.logs = S.logs.slice(-600);
  if (ui.page !== 'console' || ui.logFilter.source !== 'all' || ui.logFilter.q) return;
  const box = $('#logBox');
  if (!box) return;
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
  const html = batch.map(entry => `<div class="logline ${entry.level === 'error' ? 'err' : ''}"><time>${fmtTime(entry.ts)}</time><span class="src ${entry.source}">${entry.source}</span><span class="msg">${esc(entry.message)}</span></div>`).join('');
  box.insertAdjacentHTML('beforeend', html);
  // держим в DOM не больше 400 строк
  while (box.childElementCount > 400) box.firstElementChild.remove();
  if (atBottom) box.scrollTop = box.scrollHeight;
});

api.onProgress(p => {
  const label = p.target === 'zapret' ? 'Zapret' : p.target === 'tg' ? 'TG WS Proxy' : 'Компоненты';
  if (ui.page === 'updates') {
    const t = $('#updSub');
    if (t) t.textContent = `${label}: ${p.text || ''} ${p.pct ? p.pct + '%' : ''}`;
  }
});

api.onPick(ev => {
  if (ev.type === 'start') {
    $('#pickLabel').textContent = `Подбор: 0 из ${ev.total}`;
    $('#pickBar').style.width = '2%';
  }
  if (ev.type === 'progress') {
    $('#pickLabel').textContent = `${ev.index + 1} из ${ev.total} · ${ev.name}`;
    $('#pickBar').style.width = Math.max(2, ev.pct) + '%';
    $('#pickPct').textContent = ev.pct + '%';
    pickState.current = ev.name;
    renderPickList();
  }
  if (ev.type === 'result') {
    pickState.results = ev.results;
    renderPickResults();
    renderPickList();
    renderStrategies();
  }
  if (ev.type === 'cancelling') $('#pickLabel').textContent = 'Остановка…';
  if (ev.type === 'done') {
    const p = ev.pick;
    const best = (p.results || [])[0];
    $('#pickLabel').textContent = p.cancelled ? 'Остановлено' : 'Готово';
    $('#pickPct').textContent = '100%';
    $('#pickBar').style.width = '100%';
    pickState.current = null;
    const banner = $('#pickBanner');
    if (best) {
      banner.hidden = false;
      banner.innerHTML = `<div class="banner"><div class="ico">${icon('spark')}</div>
        <div><b>Лучшая стратегия: ${esc(best.name)} — ${best.score}/100</b>
        <div>${p.applied ? 'Применена и запущена' : 'Результат сохранён'} · проверено ${p.total} стратегий${p.cancelled ? ' (остановлено)' : ''}</div></div></div>`;
      toast('Подбор завершён', `${best.name}: ${best.score}/100`, 'ok', 6000);
    } else {
      banner.hidden = false;
      banner.innerHTML = `<div class="banner" style="border-color:rgba(255,207,122,.4);background:rgba(255,207,122,.08)"><div class="ico" style="background:rgba(255,207,122,.16)">${icon('warn')}</div><div><b>Ни одна стратегия не дала результата</b><div>Проверьте, что Zapret запускается от имени администратора и списки доменов заполнены</div></div></div>`;
    }
    finishPick();
    renderStrategies();
  }
});

api.onMaximized(() => {});

/* Вернулись в окно — досрочно догоняем состояние, пропущенное пока были свёрнуты. */
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && !uiFocused) uiFocused = document.hasFocus();
  syncHiddenFlag();
  if (uiVisible() && S.dirty) {
    S.dirty = false;
    renderOverview();
    if (ui.page === 'console') renderLogs();
  }
});
window.addEventListener('blur', () => { uiFocused = false; syncHiddenFlag(); });
window.addEventListener('focus', () => {
  uiFocused = true;
  syncHiddenFlag();
  if (uiVisible() && S.dirty) {
    S.dirty = false;
    renderOverview();
    if (ui.page === 'console') renderLogs();
  }
});
api.onNav(ev => { if (ev && ev.page) go(ev.page); });

$('#adminBanner') && $('#adminBanner').addEventListener('click', e => {
  const b = e.target.closest('[data-act="elevate"]');
  if (b) askElevate('start');
  const d = e.target.closest('[data-act="dismissAdmin"]');
  if (d) $('#adminBanner').hidden = true;
});

/* ---------------- старт ---------------- */
(async function init() {
  paintIcons();
  syncHiddenFlag();
  setInterval(syncHiddenFlag, 2000);   // трей → окно: держим флаг в актуальном виде
  const info = await api.info();
  if (info.ok) {
    if ($('#tbVer')) $('#tbVer').textContent = info.version;
    if ($('#abVer')) $('#abVer').textContent = info.version;
    S.admin = !!info.admin;
    if (!info.admin) showAdminBanner();
    else { const el = $('#adminBanner'); if (el) el.hidden = true; }
  }
  // восстановить последний тест из истории
  const h = await api.test.history();
  if (h && h.ok && h.picks && h.picks.length) {
    const last = h.picks[0];
    if (last && Array.isArray(last.results)) {
      pickState.results = last.results;
      renderPickResults();
    }
  }
  if (h.ok && h.tests && h.tests.length) {
    const l = h.tests[0];
    if (Date.now() - l.ts < 24 * 3600 * 1000) {
      lastTest = { ...l, results: [], services: l.services.map(s => ({ ...s, targets: [] })) };
      $('#ovRing').style.setProperty('--v', l.score);
      $('#ovRingTxt').textContent = l.score;
    }
  }
  await loadState();
  renderTargets();
  go('overview');
  setInterval(() => {
    if (!uiVisible()) return;               // свёрнуто — не тратим кадры
    if (S.zapret && S.zapret.running) {
      const el = $('#zUp');
      if (el) el.textContent = dur(Date.now() - (S.zapret.startedAt || Date.now()));
    }
  }, 1000);
})();
