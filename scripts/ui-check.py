import asyncio, json, os, sys, http.server, threading, functools

ROOT = '/home/user/yume-haze/renderer'
PORT = 8123

class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass

def serve():
    h = functools.partial(Handler, directory=ROOT)
    http.server.ThreadingHTTPServer(('127.0.0.1', PORT), h).serve_forever()

threading.Thread(target=serve, daemon=True).start()

STUB = r"""
window.__calls = [];
function rec(cat, name, arg){ window.__calls.push([cat, name, arg]); }
const strat = [
 ['general.bat','General','Basic','Базовая стратегия: multisplit + fake QUIC.',['multisplit','fake-quic','ip-id=zero']],
 ['general (ALT).bat','ALT','Basic','Fake TLS + HTTP, агрессивные повторы.',['fake+split','fooling=ts','fake-tls']],
 ['general (ALT2).bat','ALT2','Basic','Только multisplit со смещением 2.',['multisplit','split-pos=2']],
 ['general (ALT11).bat','ALT11','Advanced','В 1.10.4 обновлён стандартный TLS-фейк (sferum).',['fake+multisplit','fooling=ts','repeats=8']],
 ['general (EXP).bat','EXP','Advanced','Экспериментальная',['fake+multisplit','hostfakesplit','exp']],
 ['general (FAKE TLS AUTO).bat','FAKE TLS AUTO','Fake','Автоматический подбор позиции разреза.',['fake-tls-auto','midsld']]
].map(x=>({file:x[0],name:x[1],group:x[2],note:x[3],feats:x[4]}));

const state = {
  zapret: {installed:true, dir:'C:\\\\Users\\\\user\\\\AppData\\\\Roaming\\\\Yume Haze Zapret\\\\zapret', version:'1.10.4', expectedVersion:'1.10.4',
    running:true, pids:[4242], startedAt:Date.now()-134000, strategy:'general (ALT11).bat', strategies:strat,
    service:{installed:false,state:'not-installed'}, gameFilter:{mode:'off',tcp:'1024-65535',udp:'1024-65535'},
    ipset:{mode:'loaded',lines:7482,updated:new Date().toISOString(),hasBackup:true},
    lists:{user:{entries:2,bytes:40}}, checkUpdates:true},
  tg: {installed:true, path:'C:\\\\Users\\\\user\\\\AppData\\\\Roaming\\\\Yume Haze Zapret\\\\tgws\\\\TgWsProxy.exe', version:'v1.11.4',
    running:true, pids:[777], startedAt:Date.now()-92000, listening:true,
    link:'tg://proxy?server=127.0.0.1&port=1443&secret=dddd643832ec6062fe38847f871866a50f',
    settings:{host:'127.0.0.1',port:1443,poolSize:4,secret:'dd643832ec6062fe38847f871866a50f',cfproxy:true,h2:true,noSecure:false,fakeTlsDomain:'',cfproxyDomain:'',dcIp:['2:149.154.167.220'],verbose:false,autostartWithApp:true,portable:true},
    stats:{total:37,active:3,ws:2,h2:1,cf:1,bad:0,err:0,poolHits:12,poolTotal:15,cfHits:3,cfTotal:4,up:1536000,down:9437184,ts:Date.now()},
    pool:'4 / 16', recent:[]},
  settings:{zapret:{strategy:'general (ALT11).bat', gameFilter:{mode:'off',tcp:'1024-65535',udp:'1024-65535'}, ipsetMode:'loaded', checkUpdates:true, lists:{user:'',exclude:'',ipExclude:''}},
    tg:{host:'127.0.0.1',port:1443,poolSize:4,secret:'dd643832ec6062fe38847f871866a50f',cfproxy:true,h2:true,fakeTlsDomain:'',autostartWithApp:true,verbose:false},
    app:{runAtLogin:false,startMinimized:false,closeToTray:true,notifications:true,testOnStart:false,autostartServices:true,accent:['#b9a2ff','#ff9fcb'],animations:true,autoUpdateCheck:true,autoInstall:false,useMirror:true}},
  logs:[
    {id:1,ts:Date.now()-300000,source:'APP',level:'info',message:'Yume Haze Zapret запускается…'},
    {id:2,ts:Date.now()-290000,source:'ZAPRET',level:'ok',message:'Zapret 1.10.4 установлен'},
    {id:3,ts:Date.now()-280000,source:'ZAPRET',level:'ok',message:'winws.exe запущен (PID 4242), стратегия general (ALT11).bat'},
    {id:4,ts:Date.now()-270000,source:'TG',level:'ok',message:'Прокси запущен на 127.0.0.1:1443'},
    {id:5,ts:Date.now()-240000,source:'TEST',level:'ok',message:'Результат: 87/100 · Discord 4/4 · YouTube 4/4 · Google 2/2 · Cloudflare 2/2'},
    {id:6,ts:Date.now()-180000,source:'UPD',level:'info',message:'Проверка обновлений: Zapret 1.10.4 → 1.10.4, TG v1.11.4 → v1.11.4'},
    {id:7,ts:Date.now()-90000,source:'TG',level:'info',message:'stats: total=37 active=3 ws=2 h2=1 cf=1 up=1.50KB down=9.00MB'},
    {id:8,ts:Date.now()-30000,source:'ERR',level:'error',message:'Пример ошибки для проверки фильтра журнала'}
  ],
  update:0
};

const results = [
  {key:'discord.com',ok:true,ms:142,status:200,service:'Discord'},
  {key:'gateway.discord.gg',ok:true,ms:168,status:200,service:'Discord'},
  {key:'cdn.discordapp.com',ok:true,ms:190,status:200,service:'Discord'},
  {key:'updates.discord.com',ok:true,ms:210,status:200,service:'Discord'},
  {key:'www.youtube.com',ok:true,ms:231,status:200,service:'YouTube'},
  {key:'youtu.be',ok:true,ms:198,status:200,service:'YouTube'},
  {key:'i.ytimg.com',ok:false,ms:null,status:0,service:'YouTube'},
  {key:'redirector.googlevideo.com',ok:true,ms:265,status:302,service:'YouTube'},
  {key:'www.google.com',ok:true,ms:120,status:200,service:'Google'},
  {key:'www.gstatic.com',ok:true,ms:133,status:200,service:'Google'},
  {key:'www.cloudflare.com',ok:true,ms:167,status:200,service:'Cloudflare'},
  {key:'cdnjs.cloudflare.com',ok:true,ms:151,status:200,service:'Cloudflare'},
  {key:'1.1.1.1',ok:true,ms:12,service:'DNS',url:'tcp://1.1.1.1:443'},
  {key:'8.8.8.8',ok:true,ms:24,service:'DNS',url:'tcp://8.8.8.8:443'}
];
const services = ['Discord','YouTube','Google','Cloudflare','DNS'].map(n=>{
  const t = results.filter(r=>r.service===n); const ok = t.filter(r=>r.ok).length;
  const lat = t.filter(r=>r.ok&&r.ms).map(r=>r.ms);
  return {name:n,total:t.length,ok,score:Math.round(ok/t.length*100),latency:lat.length?Math.round(lat.reduce((a,b)=>a+b,0)/lat.length):null,targets:t};
});
const quick = {ok:true, services, score:88, grade:'good', results, ts:Date.now(), record:{}};

const history = {ok:true, tests:[{ts:Date.now()-600000,strategy:'general (ALT11).bat',score:88,grade:'good',services:[{name:'Discord',ok:4,total:4},{name:'YouTube',ok:3,total:4}],scope:'all'}],
  picks:[{ts:Date.now()-1200000,total:6,results:[],best:{file:'general (ALT11).bat',name:'ALT11',score:88},applied:{}}]};

const diag = {ok:true, items:[
  {title:'Права администратора',status:'ok',detail:'Yume Haze запущен с повышенными правами',hint:''},
  {title:'Zapret',status:'ok',detail:'Установлен 1.10.4 · C:\\\\zapret',hint:''},
  {title:'Процесс winws.exe',status:'ok',detail:'Работает (PID 4242)',hint:''},
  {title:'Конфликты',status:'warn',detail:'Найдено: GoodbyeDPI',hint:'Два обхода блокировок одновременно обычно ломают друг друга.'},
  {title:'Прокси · Порт 1443',status:'ok',detail:'Свободен',hint:''}
]};

const upd = {ok:true, info:{at:Date.now(), channel:'stable',
  zapret:{current:'1.10.4',latest:'1.10.4',status:'ok',notes:'- Изменён стандартный TLS-фейк в ALT11, ALT12, EXP\n- Обновлён IPSet'},
  tg:{current:'v1.11.4',latest:'v1.11.4',status:'ok',notes:'- стабильнее переподключение пула'},
  app:{current:'2.1.0',latest:'2.1.0',status:'ok'}}};

function pickFile(f){ return f; }
window.api = {
  info: async()=>({ok:true,version:'2.1.0',platform:'win32',admin:!(window.__NO_ADMIN__),paths:{},zapretVersion:'1.10.4',strategies:6,tgVersion:'v1.11.4'}),
  elevate: async(a)=>{ window.__calls.push(['app','elevate',a]); return {ok:true,restarted:true}; },
  state: async()=>Object.assign({ok:true}, JSON.parse(JSON.stringify(state))),
  onState: fn=>{ window.__pushState = fn; },
  onLog: fn=>{}, onProgress: fn=>{ window.__progress = fn; }, onPick: fn=>{ window.__pick = fn; },
  onMaximized: fn=>{}, onNav: fn=>{},
  minimize: async()=>rec('app','minimize'), maximize: async()=>rec('app','maximize'), close: async()=>rec('app','close'),
  copy: async(t)=>{ rec('app','copy',t); return {ok:true}; },
  openExternal: async(u)=>{ rec('app','openExternal',u); return {ok:true}; },
  showItem: async()=>({ok:true}), openPath: async()=>({ok:true}), pickDir: async()=>({ok:true,path:'C:/zapret'}),
  patchSettings: async(p)=>{ rec('app','patchSettings',p); return {ok:true,settings:state.settings}; },
  resetSettings: async()=>({ok:true,settings:state.settings}),
  zapret: {
    status: async()=>({ok:true,status:state.zapret}), start: async()=>{rec('zapret','start');return {ok:true};}, stop: async()=>{rec('zapret','stop');return {ok:true};},
    restart: async()=>{rec('zapret','restart');return {ok:true};}, toggle: async()=>({ok:true}),
    setStrategy: async(f)=>{rec('zapret','setStrategy',f);state.settings.zapret.strategy=f;state.zapret.strategy=f;return {ok:true,restarted:true};},
    setGameFilter: async(g)=>{rec('zapret','setGameFilter',g);return {ok:true,restarted:true};},
    setIpset: async(m)=>{rec('zapret','setIpset',m);return {ok:true};},
    updateIpset: async()=>({ok:true,lines:7600}), updateHosts: async()=>({ok:true}),
    readList: async(k)=>({ok:true,text:'# Свои сайты\nexample.com\ntest.org'}),
    writeList: async(k,t)=>{rec('zapret','writeList',k);return {ok:true,name:'list-general-user.txt'};},
    installService: async()=>({ok:true}), removeService: async()=>({ok:true}),
    clearDiscord: async()=>({ok:true,report:['Discord: Cache удалён']}),
    diagnostics: async()=>diag, checkUpdates: async()=>({ok:true}), detect: async()=>({ok:true}), setDir: async(d)=>({ok:true,dir:d}), install: async()=>({ok:true}),
    driver: async()=>({ok:true, driver:{ service:'not-installed', running:false, bundled:{bundled:true, size:94144},
      sys:{path:'C:\\Users\\user\\AppData\\Roaming\\Yume Haze Zapret\\zapret\\bin\\WinDivert64.sys', exists:true, size:102400, version:'2.2.2'},
      dll:{path:'C:\\Users\\user\\AppData\\Roaming\\Yume Haze Zapret\\zapret\\bin\\WinDivert.dll', exists:true},
      signature:{status:'Valid', valid:true, signer:'CN=Basil (Vasily) Pashkov'} }}),
    preflight: async()=>({ok:true, driver:'not-installed', admin:true, conflicts:[], problems:['Драйвер WinDivert не установлен — откройте «Zapret → Драйвер».'], ok:false}),
    lastRun: async()=>({ok:true, run:{ code: 1, output:'error opening filter: The system cannot find the file specified.', strategy:'general.bat', pids:[], at:Date.now() }}),
    revealBat: async()=>({ok:true, path:'C:\\zapret\\general.bat'}),
    installDriver: async()=>{ rec('zapret','installDriver'); return {ok:true, state:'RUNNING'}; },
    removeDriver: async()=>{ rec('zapret','removeDriver'); return {ok:true, state:'not-installed'}; },
    driverFix: async()=>{ rec('zapret','driverFix'); return {ok:true, pids:[4242]}; },
    startAsService: async()=>{ rec('zapret','startAsService'); return {ok:true, asService:true, state:'RUNNING'}; }
  },
  tg: {
    status: async()=>({ok:true,status:state.tg}), start: async()=>{rec('tg','start');return {ok:true};}, stop: async()=>{rec('tg','stop');return {ok:true};},
    restart: async()=>({ok:true}), toggle: async()=>({ok:true}),
    save: async(p)=>{rec('tg','save',p);return {ok:true,restarted:true};},
    newSecret: async()=>({ok:true,secret:'a'.repeat(32)}),
    link: async()=>({ok:true,link:state.tg.link}), copyLink: async()=>{rec('tg','copy');return {ok:true,link:state.tg.link};},
    openTelegram: async()=>{rec('tg','openTelegram');return {ok:true};},
    pingDc: async()=>({ok:true,results:[{dc:1,ok:true,ms:42},{dc:2,ok:true,ms:38},{dc:3,ok:false,ms:null},{dc:4,ok:true,ms:51},{dc:5,ok:true,ms:120}]}),
    dcStatus: async()=>({ok:true}), diagnostics: async()=>diag, install: async()=>({ok:true}), setPath: async()=>({ok:true})
  },
  test: {
    quick: async()=>quick,
    pick: async()=>{ rec('test','pick'); return {ok:true,pick:{ts:Date.now(),mode:'fast',total:6,results:[
        {file:'general (ALT11).bat',name:'ALT11',score:88,grade:'good',latency:180,services:[{name:'Discord',ok:4,total:4},{name:'YouTube',ok:4,total:4}]},
        {file:'general.bat',name:'General',score:71,grade:'good',latency:220,services:[{name:'Discord',ok:4,total:4},{name:'YouTube',ok:2,total:4}]},
        {file:'general (ALT).bat',name:'ALT',score:44,grade:'weak',latency:390,services:[{name:'Discord',ok:3,total:4},{name:'YouTube',ok:1,total:4}]},
        {file:'general (ALT2).bat',name:'ALT2',score:12,grade:'bad',services:[{name:'Discord',ok:1,total:4},{name:'YouTube',ok:0,total:4}]}
      ],best:{file:'general (ALT11).bat',name:'ALT11',score:88},applied:{file:'general (ALT11).bat',name:'ALT11',score:88,started:true}}}; },
    pickStop: async()=>({ok:true}), pickState: async()=>({ok:true}),
    history: async()=>history, historyClear: async()=>({ok:true}),
    applyStrategy: async(f)=>{rec('test','applyStrategy',f);return {ok:true};}
  },
  updates: { check: async()=>upd, install: async(t)=>{rec('updates','install',t);return {ok:true,done:['Zapret 1.10.4']};} },
  logs: { list: async()=>({ok:true,entries:state.logs}), clear: async()=>({ok:true}), text: async()=>({ok:true,text:'line1\nline2'}), file: async()=>({ok:true,path:'C:/log'}) }
};
"""

async def main():
    from playwright.async_api import async_playwright
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/home/user/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome', args=['--no-sandbox'])
        pg = await b.new_page(viewport={'width': 1280, 'height': 860}, device_scale_factor=1)
        errors = []
        pg.on('pageerror', lambda e: errors.append('pageerror: ' + str(e)))
        pg.on('console', lambda m: errors.append('console.' + m.type + ': ' + m.text) if m.type == 'error' else None)
        await pg.add_init_script('window.__NO_ADMIN__ = true;')
        await pg.add_init_script(STUB)
        await pg.goto(f'http://127.0.0.1:{PORT}/index.html')
        await pg.wait_for_timeout(1200)
        os.makedirs('/home/user/shots', exist_ok=True)
        # баннер «нужны права администратора» для режима без UAC
        visible = await pg.is_visible('#adminBanner')
        print('admin-banner:', visible)
        await pg.screenshot(path='/home/user/shots/01-overview.png')
        await pg.click('#adminBanner [data-act="elevate"]')
        await pg.wait_for_timeout(400)
        await pg.screenshot(path='/home/user/shots/01b-admin-banner.png')

        # запускаем тест доступности и проверяем отрисовку
        await pg.click('[data-act="quick"]')
        await pg.wait_for_timeout(900)
        await pg.screenshot(path='/home/user/shots/02-overview-test.png')

        # zapret -> стратегии
        await pg.click('.side [data-go="zapret"]')
        await pg.wait_for_timeout(500)
        await pg.screenshot(path='/home/user/shots/03-zapret-strat.png')
        # выбор стратегии
        await pg.click('[data-strat="general (ALT).bat"]')
        await pg.wait_for_timeout(400)
        await pg.screenshot(path='/home/user/shots/03b-zapret-picked.png')

        # игровой фильтр
        await pg.click('.tabs[data-tabs="z"] [data-tab="game"]')
        await pg.wait_for_timeout(300)
        await pg.click('[data-opts="game"] .opt[data-v="all"]')
        await pg.wait_for_timeout(300)
        await pg.screenshot(path='/home/user/shots/04-zapret-game.png')

        # ipset
        await pg.click('.tabs[data-tabs="z"] [data-tab="ipset"]')
        await pg.wait_for_timeout(300)
        await pg.click('[data-opts="ipset"] .opt[data-v="none"]')
        await pg.wait_for_timeout(300)
        await pg.screenshot(path='/home/user/shots/05-zapret-ipset.png')

        # вкладка «Драйвер»
        await pg.click('.tabs[data-tabs="z"] [data-tab="driver"]')
        await pg.wait_for_timeout(600)
        await pg.screenshot(path='/home/user/shots/05b-driver.png')
        await pg.click('[data-act="drvInstall"]')
        await pg.wait_for_timeout(500)
        await pg.screenshot(path='/home/user/shots/05c-driver-installed.png')

        # списки
        await pg.click('.tabs[data-tabs="z"] [data-tab="lists"]')
        await pg.wait_for_timeout(500)
        await pg.screenshot(path='/home/user/shots/06-zapret-lists.png')

        # TG
        await pg.click('.side [data-go="tg"]')
        await pg.wait_for_timeout(700)
        await pg.screenshot(path='/home/user/shots/07-tg.png')
        await pg.click('[data-act="pingDc"]')
        await pg.wait_for_timeout(600)
        await pg.screenshot(path='/home/user/shots/07b-tg-ping.png')

        # тесты -> подбор
        await pg.click('.side [data-go="tests"]')
        await pg.wait_for_timeout(400)
        await pg.screenshot(path='/home/user/shots/08-tests-quick.png')
        await pg.click('.tabs[data-tabs="t"] [data-tab="pick"]')
        await pg.wait_for_timeout(400)
        await pg.screenshot(path='/home/user/shots/09-tests-pick.png')
        # прогресс подбора
        await pg.evaluate("ev => window.__pick(ev)", {'type':'start','total':6})
        await pg.evaluate("ev => window.__pick(ev)", {'type':'progress','index':2,'total':6,'name':'ALT11','pct':33})
        await pg.wait_for_timeout(300)
        await pg.screenshot(path='/home/user/shots/09b-pick-progress.png')
        await pg.evaluate("ev => window.__pick(ev)", {'type':'result','results':[
            {'file':'general (ALT11).bat','name':'ALT11','score':88,'services':[{'name':'Discord','ok':4,'total':4},{'name':'YouTube','ok':4,'total':4}]},
            {'file':'general.bat','name':'General','score':71,'services':[{'name':'Discord','ok':4,'total':4},{'name':'YouTube','ok':2,'total':4}]}],'index':2,'total':6})
        await pg.evaluate("ev => window.__pick(ev)", {'type':'done','pick':{'ts':0,'mode':'fast','total':6,'cancelled':False,'results':[
            {'file':'general (ALT11).bat','name':'ALT11','score':88,'services':[{'name':'Discord','ok':4,'total':4},{'name':'YouTube','ok':4,'total':4}]},
            {'file':'general.bat','name':'General','score':71,'services':[{'name':'Discord','ok':4,'total':4},{'name':'YouTube','ok':2,'total':4}]}],
            'best':{'file':'general (ALT11).bat','name':'ALT11','score':88},'applied':{'file':'general (ALT11).bat'}}})
        await pg.wait_for_timeout(600)
        await pg.screenshot(path='/home/user/shots/10-pick-done.png')

        # история
        await pg.click('.tabs[data-tabs="t"] [data-tab="hist"]')
        await pg.wait_for_timeout(600)
        await pg.screenshot(path='/home/user/shots/11-tests-history.png')
        # диагностика
        await pg.click('.tabs[data-tabs="t"] [data-tab="diag"]')
        await pg.click('[data-act="diagRun"]')
        await pg.wait_for_timeout(900)
        await pg.screenshot(path='/home/user/shots/12-tests-diag.png')

        # обновления
        await pg.click('.side [data-go="updates"]')
        await pg.wait_for_timeout(400)
        await pg.click('[data-act="updCheck"]')
        await pg.wait_for_timeout(900)
        await pg.screenshot(path='/home/user/shots/13-updates.png')

        # журнал
        await pg.click('.side [data-go="console"]')
        await pg.wait_for_timeout(600)
        await pg.screenshot(path='/home/user/shots/14-console.png')

        # настройки
        await pg.click('.side [data-go="settings"]')
        await pg.wait_for_timeout(500)
        await pg.click('.sw[data-a="#7ee8c4,#7cc4ff"]')
        await pg.wait_for_timeout(500)
        await pg.screenshot(path='/home/user/shots/15-settings.png')

        # о программе
        await pg.click('.side [data-go="about"]')
        await pg.wait_for_timeout(400)
        await pg.screenshot(path='/home/user/shots/16-about.png')

        calls = await pg.evaluate("window.__calls")
        print(json.dumps({'errors': errors, 'calls': calls}, ensure_ascii=False, indent=1))
        await b.close()

asyncio.run(main())
