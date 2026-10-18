#!/usr/bin/env node
'use strict';
// Ticks exactly the given values in a ticked list: one change event per toggled box, finding the list again each
// time because the shared facility controls are rebuilt after every change. `target` is a page expression.
const tickJs=(target,values)=>`(()=>{const want=${JSON.stringify(values.map(String))},find=()=>${target};for(const v of [...find().querySelectorAll('input')].map(i=>i.value)){const box=[...find().querySelectorAll('input')].find(i=>i.value===v);if(box.checked!==want.includes(v)){box.checked=!box.checked;box.dispatchEvent(new Event('change',{bubbles:true}));}}return true;})()`;
// A real Space press on each control must toggle it and leave keyboard focus on it although the list is rebuilt.
// A second press (after focusing the control again, so a lost focus cannot
// derail the suite) restores the state.
const keepsFocus = async (page, settle, ids, check) => {
  for (const id of ids) {
    const sel = JSON.stringify(id);
    const focused = await page.eval(`document.getElementById(${sel}).focus();document.activeElement&&document.activeElement.id===${sel}`);
    check(focused, 'control can take keyboard focus ' + id);
    if (!focused) continue;
    const before = await page.eval(`document.getElementById(${sel}).checked`);
    await page.key(' ', 32, ' ');
    await settle();
    check(await page.eval(`document.activeElement&&document.activeElement.id===${sel}`), 'keyboard focus kept after Space on ' + id);
    check(await page.eval(`document.getElementById(${sel}).checked`) === !before, 'Space toggles ' + id);
    await page.eval(`document.getElementById(${sel}).focus();true`);
    await page.key(' ', 32, ' ');
    await settle();
    check(await page.eval(`document.activeElement&&document.activeElement.id===${sel}`), 'keyboard focus kept after second Space on ' + id);
    check(await page.eval(`document.getElementById(${sel}).checked`) === before, 'second Space restores ' + id);
  }
};
// S6 entry flow (by default and with --entry-regression; --facilities, --focus and --activity run the other suites)
// through installed Chrome, foreground command, offline; no packages.
const { spawn } = require('child_process');
const fs = require('fs'), path = require('path'), { pathToFileURL } = require('url');
const ROOT = path.resolve(__dirname, '../..'), LATE_DAY = ['r16', 'r15', 'day6', 'day5'].find(d => process.argv.includes('--s6-' + d)),
  OUT = path.join(ROOT, 'local-test-artifacts/s6', LATE_DAY ? LATE_DAY + '/' + (process.argv.includes('--activity') ? 'activity' : process.argv.includes('--facilities') ? 'infrastructure' : process.argv.includes('--focus') ? 'focus' : 'entry') : process.argv.includes('--focus') ? 'day4' : process.argv.includes('--facilities') ? (process.argv.includes('--s6-day4') ? 'day4/infrastructure' : 'day3') : process.argv.includes('--entry-regression') ? (process.argv.includes('--s6-day4') ? 'day4/entry' : 'day3/entry') : 'day2');
const FIX = path.join(ROOT, 'local-test-artifacts/s6/day2/fixtures');
const PAGE = process.env.S6_PAGE_URL || pathToFileURL(path.join(ROOT, 'site/index.html')).href;
const SITE_BASE = new URL('.', PAGE).href;
const CHROME = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function launch() {
  fs.mkdirSync(OUT, { recursive: true });
  // profiles left by an earlier run that was stopped before its clean-up
  for (const d of fs.readdirSync(OUT)) if (d.startsWith('chrome-profile-')) fs.rmSync(path.join(OUT, d), { recursive: true, force: true });
  const profile = fs.mkdtempSync(path.join(OUT, 'chrome-profile-'));
  const proc = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + profile, '--no-first-run',
    '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', '--disable-component-update',
    '--disable-sync', '--window-size=1200,900', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'], detached: true });
  // Chrome leads its own process group: closing ends the whole group (helpers included), also when this script stops early
  const killGroup = () => { try { process.kill(-proc.pid, 'SIGKILL'); } catch (e) { /* gone */ } };
  const exited = ms => proc.exitCode !== null || proc.signalCode !== null ? Promise.resolve()
    : new Promise(res => { const t = setTimeout(res, ms); proc.once('exit', () => { clearTimeout(t); res(); }); });
  process.once('exit', killGroup); process.once('SIGINT', () => process.exit(130));
  let port = null;
  for (let i = 0; i < 100 && !port; i++) { await sleep(100); const f = path.join(profile, 'DevToolsActivePort'); if (fs.existsSync(f)) port = fs.readFileSync(f, 'utf8').split('\n')[0].trim(); }
  if (!port) { killGroup(); fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); throw new Error('Chrome did not start (set CHROME_BIN)'); }
  const ver = await (await fetch('http://127.0.0.1:' + port + '/json/version')).json();
  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pending = new Map(), listeners = [];
  ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); } else if (m.method) listeners.forEach(f => f(m)); };
  const send = (method, params, sessionId) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params: params || {}, sessionId })); });
  const log = { requests: [], exceptions: [], csp: [] };
  // Every tab's requests, exceptions and CSP reports go into the same log (the CVI map opens in its own tab).
  const watch = sid => listeners.push(m => {
    if (m.sessionId !== sid) return;
    if (m.method === 'Network.requestWillBeSent') log.requests.push(m.params.request.url);
    else if (m.method === 'Runtime.exceptionThrown') log.exceptions.push((m.params.exceptionDetails.exception || {}).description || m.params.exceptionDetails.text);
    else if (m.method === 'Log.entryAdded' && /content security policy|refused to/i.test(m.params.entry.text)) log.csp.push(m.params.entry.text);
  });
  const DOMAINS = ['Network.enable', 'Runtime.enable', 'Log.enable', 'Page.enable', 'DOM.enable'];
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId: sid } = await send('Target.attachToTarget', { targetId, flatten: true });
  watch(sid);
  for (const d of DOMAINS) await send(d, {}, sid);
  // Tabs opened later (by the page or by the test) are attached paused, so nothing they request is missed.
  const opened = [];
  listeners.push(async m => {
    if (m.method !== 'Target.attachedToTarget' || m.sessionId || m.params.targetInfo.type !== 'page') return;
    const s2 = m.params.sessionId; watch(s2);
    for (const d of DOMAINS) await send(d, {}, s2);
    await send('Runtime.runIfWaitingForDebugger', {}, s2);
    opened.push({ targetId: m.params.targetInfo.targetId, page: makePage(s2) });
  });
  await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
  const page = makePage(sid);
  function makePage(sid) { const page = {
    sid,
    async goto(url) { const loaded = new Promise(res => { const h = m => { if (m.method === 'Page.loadEventFired' && m.sessionId === sid) { listeners.splice(listeners.indexOf(h), 1); res(); } }; listeners.push(h); }); await send('Page.navigate', { url }, sid); await Promise.race([loaded, sleep(15000)]); },
    async eval(expr) { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }, sid); if (r.exceptionDetails) throw new Error('eval: ' + ((r.exceptionDetails.exception || {}).description || r.exceptionDetails.text)); return r.result.value; },
    async waitFor(expr, ms, label) { const t0 = Date.now(); while (Date.now() - t0 < (ms || 15000)) { try { const v = await page.eval('!!(' + expr + ')'); if (v) return v; } catch (e) { /* not ready */ } await sleep(50); } throw new Error('timeout: ' + (label || expr)); },
    async setFiles(sel, files) { const { root } = await send('DOM.getDocument', { depth: 1 }, sid); const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector: sel }, sid); await send('DOM.setFileInputFiles', { files, nodeId }, sid); },
    async drop(sel, files) {
      const box = await page.eval(`(function(){var el=document.querySelector(${JSON.stringify(sel)});el.scrollIntoView({block:'center'});var r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
      const data = { items: [], files, dragOperationsMask: 1 };
      for (const type of ['dragEnter', 'dragOver', 'drop']) await send('Input.dispatchDragEvent', { type, x: box.x, y: box.y, data }, sid);
    },
    // A real drag entering and moving over the element, then canceled. data: CDP drag data (files or text items).
    async dragEnter(sel, data) {
      const box = await page.eval(`(function(){var el=document.querySelector(${JSON.stringify(sel)});el.scrollIntoView({block:'center'});var r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
      for (const type of ['dragEnter', 'dragOver', 'dragCancel']) await send('Input.dispatchDragEvent', { type, x: box.x, y: box.y, data }, sid);
    },
    async front() { await send('Page.bringToFront', {}, sid); },   // the user switches to this tab
    async click(expr) { await send('Runtime.evaluate', { expression: expr, userGesture: true }, sid); },   // as a user's click (pop-ups allowed)
    async key(k, code, text) { for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', Object.assign({ type, key: k, code: k, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code }, type === 'keyDown' && text ? { text } : {}), sid); },   // a real key press
    async reload() { const loaded = new Promise(res => { const h = m => { if (m.method === 'Page.loadEventFired' && m.sessionId === sid) { listeners.splice(listeners.indexOf(h), 1); res(); } }; listeners.push(h); }); await send('Page.reload', {}, sid); await Promise.race([loaded, sleep(15000)]); }
  }; return page; }
  const pages = async re => (await send('Target.getTargets')).targetInfos.filter(t => t.type === 'page' && re.test(t.url));
  async function newTab(url) { const n = opened.length; await send('Target.createTarget', { url }); return waitTab(n); }
  async function waitTab(n) { for (let i = 0; i < 300 && opened.length <= n; i++) await sleep(50); if (opened.length <= n) throw new Error('no new tab'); return opened[n]; }
  const closeTab = targetId => send('Target.closeTarget', { targetId });
  return { version: ver.Browser, log, page, opened, pages, newTab, waitTab, closeTab, send, listeners, async close() { try { await Promise.race([send('Browser.close'),sleep(5000)]); } catch (e) { /* closing */ } await exited(5000); killGroup(); await exited(2000); fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } };
}


let passed = 0, failed = 0; const failures = [];
const check = (ok, name, detail) => { if (ok) passed++; else { failed++; failures.push({ name, detail }); } };
const SNAP = `(async()=>{const a=WSDA.infrastructure,c=a.checklist.state;
  const files={};for(const [id,d] of Object.entries(a.state.datasets))files[id]={name:d.name,path:d.path,text:await d.file.text()};
  return {files,version:a.state.version,loading:a.state.loading,busy:c.busy,source:a.state.source,
  banner:document.getElementById('bundle-banner').textContent,entry:document.getElementById('entry-status').textContent,
  status:document.getElementById('load-status').textContent,features:c.features,search:location.search};})()`;
if (!process.argv.includes('--activity') && !process.argv.includes('--facilities') && !process.argv.includes('--focus')) (async () => {
 const b=await launch(), p=b.page, run={chrome:b.version,page:PAGE,started:new Date().toISOString()};
 const paths=names=>names.map(n=>path.join(FIX,n));
 let timeout;
 const loadHub=async names=>{ const v=await p.eval('WSDA.landing.state.version'); await p.setFiles('#files-input',paths(names));
  await p.waitFor(`!WSDA.landing.state.loading&&!WSDA.landing.checklist.state.busy&&WSDA.landing.state.version>${v}`); };
 const selected=()=>p.eval('WSDA.landing.state.selected');
 const switchHub=id=>p.eval(`WSDA.landing.selectProfile(${JSON.stringify(id)},true)`);
 const found=()=>p.eval(`WSDA.landing.checklist.state.result.datasets.filter(d=>d.status==='found').map(d=>d.id).sort()`);
 const openHub=async()=>{await p.click("document.getElementById('next-open').click()");};
 const ready=page=>page.waitFor('window.WSDA&&WSDA.infrastructure&&WSDA.infrastructure.state.version>0&&!WSDA.infrastructure.state.loading&&!WSDA.infrastructure.checklist.state.busy');
 const directLoad=async(page,sel,names,drop)=>{ const v=await page.eval('WSDA.infrastructure.state.version');
  // A real drag over the page opens the folded loader first (dragenter), then the files are dropped on the zone.
  if(drop){
   // Only a drag that carries files opens the folded loader; a text drag leaves it folded.
   await page.eval("document.getElementById('load-fold').open=false;true");
   // After a canceled drag Chrome sends the next dragenter only for another element, so the two drags use two.
   await page.dragEnter('h1',{items:[{mimeType:'text/plain',data:'not a file'}],dragOperationsMask:1});
   check(!await page.eval("document.getElementById('load-fold').open"),'a text drag leaves the loader folded');
   await page.dragEnter('#facility-map',{items:[],files:paths(names),dragOperationsMask:1});
   check(await page.eval("document.getElementById('load-fold').open"),'dragging files over the page opens the loader');
   await page.drop('#drop',paths(names));
  }else await page.setFiles(sel,paths(names));
  await page.waitFor(`!WSDA.infrastructure.state.loading&&!WSDA.infrastructure.checklist.state.busy&&WSDA.infrastructure.state.version>${v}`); return page.eval(SNAP); };
 async function suite() {
  await p.goto(PAGE);await p.waitFor('window.WSDA&&WSDA.landing');
  check(await p.eval("document.querySelectorAll('#profiles .card').length===3&&document.querySelector('#profiles [data-open=infrastructure]')!==null"),'three dashboard cards');
  check(await selected()==='cvi','initial checklist CVI');
  await loadHub(['infrastructure_synthetic.zip']);
  check(await selected()==='infrastructure','labeled Infrastructure route');
  check((await found()).join() === 'fairgrounds,feedlots,manifest,markets,restricted,slaughterhouses,synthetic_support','facility-only sample recognized including extra');
  check(await p.eval("!document.getElementById('next-open').hidden&&document.getElementById('next-open').textContent==='Open Infrastructure'"),'facility-only Open enabled');
  const n=b.opened.length;await openHub();const infra=await b.waitTab(n);await ready(infra.page);
  let got=await infra.page.eval(SNAP);check(Object.keys(got.files).length===7&&!got.files.master,'handoff facilities/manifest only',got);
  for(const [id,d]of Object.entries(got.files))check(fs.readFileSync(path.join(FIX,'sample',d.name),'utf8')===d.text,'handoff exact bytes '+id);
  check(got.banner==='Infrastructure – synthetic facilities only · prepared 2026-09-15','handoff banner');
  check(await infra.page.eval("document.getElementById('items-table').textContent.includes('usda_wa_slaughter_facilities.csv')&&!document.getElementById('items-table').textContent.includes('handoff_')"),'handoff checklist shows original file names');
  check(await p.waitFor("/is open in its own tab with your files/.test(document.getElementById('next-opened').textContent)",5000),'hub acknowledgement after Infrastructure load');
  const key=got.search;
  await p.front();await loadHub(['unknown.csv','cvi/bundle.json','unrelated.json']);
  check(await selected()==='cvi','CVI hint selected even without master');await switchHub('infrastructure');
  check((await found()).includes('feedlots'),'CVI mapping reused after explicit switch');
  const fid=await p.eval("WSDA.landing.checklist.state.load.items.find(i=>i.name==='unknown.csv').id");
  await p.eval(`WSDA.landing.checklist.assign(${JSON.stringify(fid)},'markets')`);
  await switchHub('cvi');check((await found()).includes('markets'),'user mapping survives switch back');
  await switchHub('infrastructure');await infra.page.eval('window.__old=1');await openHub();
  await infra.page.waitFor('!window.__old');await ready(infra.page);got=await infra.page.eval(SNAP);
  check((await b.pages(/infrastructure\/index.html/)).length===1&&got.search!==key,'Infrastructure tab reused with fresh key');
  check(Object.keys(got.files).join()==='markets'&&got.files.markets.text.includes('Synthetic unclear')&&!got.files.unrelated,'user assignment delivered; unrelated withheld');
  await infra.page.reload();await ready(infra.page);check(Object.keys((await infra.page.eval(SNAP)).files).join()==='markets','reload requests files while hub alive');
  // Real CVI Full handoff remains independent from Infrastructure.
  await p.front();const full=path.join(ROOT,'local-test-artifacts/f1/tiers/full.zip');
  const v=await p.eval('WSDA.landing.state.version');await p.setFiles('#files-input',[full]);await p.waitFor(`!WSDA.landing.state.loading&&WSDA.landing.state.version>${v}`);
  check(await selected()==='cvi','unlabeled/master CVI default retained');
  const nc=b.opened.length;await openHub();const cvi=await b.waitTab(nc);
  await cvi.page.waitFor('window.CVIWA&&CVIWA.state.master&&!CVIWA.state.loading');
  check(await cvi.page.eval('CVIWA.state.master.physicalRows')===1500,'actual CVI Full master handed over');
  const cviKey=await cvi.page.eval('location.search');
  check(Object.keys((await infra.page.eval(SNAP)).files).join()==='markets','loading/opening CVI leaves Infrastructure files');
  await p.front();await switchHub('infrastructure');await infra.page.eval('window.__old=1');await openHub();
  await infra.page.waitFor('!window.__old');await ready(infra.page);got=await infra.page.eval(SNAP);
  check(!!got.files.master&&Object.keys(got.files).length===9,'Full bundle opens Infrastructure with optional master and eight related files');
  check(got.search!==cviKey&&(await cvi.page.eval('location.search'))===cviKey&&(await cvi.page.eval('CVIWA.state.master.physicalRows'))===1500,'separate keys and independent CVI tab');
  // Unlabeled files, empty/invalid headers, ambiguous files, manifest-only and unknown hints.
  for(const name of ['sample/wa_state_feedlots.csv','unknown.csv','invalid.csv','empty_points.csv']){
   await p.front();await loadHub([name]);check(await selected()==='infrastructure','unlabeled facility routes Infrastructure '+name);
   if(name==='unknown.csv'||name==='invalid.csv'||name==='empty_points.csv'){
    const id=await p.eval('WSDA.landing.checklist.state.load.items[0].id');await p.eval(`WSDA.landing.checklist.assign(${JSON.stringify(id)},'feedlots')`);
   }
   check(await p.eval("!document.getElementById('next-open').hidden"),'recognized header opens to explain points '+name);
  }
  await loadHub(['sample/facility_overlays_manifest.csv']);await switchHub('infrastructure');
  check(await p.eval("document.getElementById('next-open').hidden"),'manifest-only Open gated');
  // The Infrastructure card says why it cannot open and its button is disabled; the other card's button says it
  // rechecks the files.
  check(await p.eval(`(()=>{
    const card=document.querySelector('#profiles [data-profile=infrastructure]');
    return card.querySelector('button[data-open]').disabled
      &&/Not available with these files/.test(card.querySelector('.card-open-help').textContent);})()`),
    'Infrastructure card disabled with its reason');
  check(await p.eval(`(()=>{
    const card=document.querySelector('#profiles [data-profile=cvi]');
    return /^Check files for /.test(card.querySelector('button[data-open]').textContent)
      &&/Checks the loaded files/.test(card.querySelector('.card-open-help').textContent);})()`),
    'Check files mode says what the click does');
  // Each card's help line sits on its own line under its button.
  check(await p.eval(`[...document.querySelectorAll('#profiles .card-open-help')].every(m=>{
    const button=m.parentElement.querySelector('button[data-open]').getBoundingClientRect(),line=m.getBoundingClientRect();
    return getComputedStyle(m).display==='block'&&line.top>=button.bottom-1;})`),'card help lines under their buttons');
  // Two files that both fit one layer: the next step names the place to choose once.
  const twins=['a','b'].map(d=>{
    const f=path.join(OUT,'conflict',d,'wa_state_feedlots.csv');
    fs.mkdirSync(path.dirname(f),{recursive:true});
    fs.writeFileSync(f,'name,lat,long\nSynthetic '+d+',47.25,-122.35\n');
    return f;
  });
  const hubVersion=await p.eval('WSDA.landing.state.version');
  await p.setFiles('#files-input',twins);
  await p.waitFor(`!WSDA.landing.state.loading&&!WSDA.landing.checklist.state.busy&&WSDA.landing.state.version>${hubVersion}`);
  if(await selected()!=='infrastructure')await switchHub('infrastructure');
  const conflictText=await p.eval("document.getElementById('next-text').textContent");
  check(conflictText==='Next: choose a facility file in Datasets below. Then you can open Infrastructure.',
    'conflict next step names the place once',conflictText);
  for(const hint of ['emergency','unknown']){await loadHub(['unknown.csv',hint+'/bundle.json']);check(await p.eval("document.getElementById('next-notes').textContent").then(t=>hint==='emergency'?/in preparation/.test(t):/does not have/.test(t)),hint+' routing message');}
  // Direct page's ZIP/files/folder/drop all exercise the existing intake controls.
  const direct=await b.newTab(new URL('infrastructure/index.html',PAGE).href);await direct.page.waitFor('window.WSDA&&WSDA.infrastructure');
  for(const mode of ['zip','files','folder','drop']){
   const files=mode==='folder'?['sample']:mode==='zip'||mode==='drop'?['infrastructure_synthetic.zip']:fs.readdirSync(path.join(FIX,'sample')).map(n=>'sample/'+n);
   got=await directLoad(direct.page,mode==='folder'?'#folder-input':'#files-input',files,mode==='drop');
   check(Object.keys(got.files).length===7&&!got.files.master&&got.source==='direct', 'direct '+mode+' facility-only load');
  }
  got=await directLoad(direct.page,'#files-input',['unknown.csv','cvi/bundle.json','broken_master.csv']);
  check(!!got.files.feedlots&&!got.files.master&&/unavailable without/.test(got.status),'direct CVI-labeled mappings and malformed optional master');
  await direct.page.eval(`(async()=>{const W=WSDA,cols=W.profiles.cvi.datasets.find(d=>d.id==='master').columns;
    const files=[new File(['name,lat,long\\nSynthetic Feedlot,47.25,-122.35\\n'],'wa_state_feedlots.csv'),new File([cols.join(',')+'\\n'],'CVI_Consolidated_Master.csv')];
    const load=await W.load.fromFileList(files,'files');load.items.find(i=>i.name==='CVI_Consolidated_Master.csv').read=async()=>{throw new Error('Simulated optional master read failure.');};
    return W.infrastructure.run(()=>load);})()`);
  got=await direct.page.eval(SNAP);check(!!got.files.feedlots&&!got.files.master&&/Simulated optional master read failure/.test(got.status),'unreadable optional master keeps facilities');
  // A manifest color the map cannot read: the checklist names the row, the layer is drawn in an
  // automatic color, and the map is not lost; a layer style the map refuses no longer counts as a lost map.
  await direct.page.eval(`(async()=>{const W=WSDA;
    const files=[new File(['key,file,label,color\\nextra,extra_points.csv,Extra points,1c5a83\\n'],'facility_overlays_manifest.csv'),
      new File(['name,lat,long\\nSynthetic Extra,47.25,-122.35\\n'],'extra_points.csv')];
    const load=await W.load.fromFileList(files,'files');return W.infrastructure.run(()=>load);})()`);
  await direct.page.waitFor('!WSDA.infrastructure.state.loading&&!WSDA.infrastructure.checklist.state.busy');
  const badColor=await direct.page.eval(`(()=>{const s=WSDA.infrastructure.state,m=s.map,layers=m.map.getStyle().layers;
    const colors=layers.filter(l=>l.type==='circle'&&l.paint&&typeof l.paint['circle-color']==='string').map(l=>l.paint['circle-color']);
    return {failed:!!m.failed,files:Object.keys(s.datasets),colors,
      notes:Array.from(document.querySelectorAll('#checklist-notes li')).map(l=>l.textContent)};})()`);
  check(!badColor.failed&&badColor.files.includes('extra')&&!badColor.colors.includes('1c5a83')&&
    badColor.notes.some(n=>/row 2: the color "1c5a83" is not a color the browser can read/.test(n)),
    'an unreadable manifest color: named in the notes, drawn in an automatic color, the map kept',badColor);
  const styleError=await direct.page.eval(`(()=>{const m=WSDA.infrastructure.state.map;
    m.map.addLayer({id:'rel-1-01-check',type:'background',paint:{'background-color':'1c5a83'}});
    return {failed:!!m.failed,errors:m.styleErrors||[],added:!!m.map.getLayer('rel-1-01-check')};})()`);
  check(!styleError.failed&&!styleError.added&&styleError.errors.some(e=>/^layers\.rel-1-01-check/.test(e)),
    'a layer style the map refuses is left out, and the map is not lost',styleError);
  for(const name of ['invalid.csv','empty_points.csv']){
   await directLoad(direct.page,'#files-input',[name]);await direct.page.eval("WSDA.infrastructure.checklist.assign('f1','feedlots')");
   await direct.page.waitFor('!WSDA.infrastructure.state.loading&&!WSDA.infrastructure.checklist.state.busy');got=await direct.page.eval(SNAP);
   check(!!got.files.feedlots&&/Headers recognized/.test(got.entry), 'direct '+name+' header disclosure');
  }
  got=await directLoad(direct.page,'#files-input',['sample/facility_overlays_manifest.csv']);check(!got.files.feedlots&&/no points/.test(got.entry),'direct manifest-only explanation');
  // A checklist change made while files are being applied is applied right after them: hold one
  // file's read, assign the other file to a layer meanwhile, then release the read.
  await direct.page.eval(`(async()=>{
    const W=WSDA;
    const files=[new File(['name,lat,long\\nSynthetic Feedlot,47.25,-122.35\\n'],'wa_state_feedlots.csv'),
      new File(['name,lat,long\\nSynthetic Market,47.3,-122.4\\n'],'unclear.csv')];
    const load=await W.load.fromFileList(files,'files');
    const item=load.items.find(i=>i.name==='wa_state_feedlots.csv'),read=item.read;
    window.__releaseRead=null;
    // Only the first read is held; the second load step reads the file normally.
    let held=false;
    item.read=()=>{
      if(held)return read();
      held=true;
      return new Promise(r=>{window.__releaseRead=()=>read().then(r);});
    };
    window.__unclearId=load.items.find(i=>i.name==='unclear.csv').id;
    void W.infrastructure.run(()=>load);
    return true;})()`);
  await direct.page.waitFor('!!window.__releaseRead');
  await direct.page.eval('WSDA.infrastructure.checklist.assign(window.__unclearId,"markets").then(()=>true)');
  check(await direct.page.eval('WSDA.infrastructure.state.loading&&WSDA.infrastructure.state.republish'),
    'a change during a load waits for it');
  await direct.page.eval('window.__releaseRead();true');
  await direct.page.waitFor('!WSDA.infrastructure.state.loading&&!WSDA.infrastructure.checklist.state.busy');
  await sleep(300);
  got=await direct.page.eval(SNAP);
  check(!got.loading&&Object.keys(got.files).sort().join()==='feedlots,markets','a change during a load is applied after it',
    Object.keys(got.files));
  // A load whose files cannot be checked ends with the reason and no files, not a page stuck loading.
  await direct.page.eval(`(async()=>{
    const W=WSDA,original=W.recognize.recognize;
    W.recognize.recognize=async()=>{throw new Error('Simulated check failure.');};
    const file=new File(['name,lat,long\\nA,47,-122\\n'],'wa_state_feedlots.csv');
    try{await W.infrastructure.run(()=>W.load.fromFileList([file],'files'));}
    finally{W.recognize.recognize=original;}
    return true;})()`);
  got=await direct.page.eval(SNAP);
  check(!got.loading&&!Object.keys(got.files).length&&/Simulated check failure/.test(got.status),
    'a failed check ends loading with the reason',got.status);
  // A layer that two files claim says so in Facility Locations instead of "file not supplied".
  const directVersion=await direct.page.eval('WSDA.infrastructure.state.version');
  await direct.page.setFiles('#files-input',twins);
  await direct.page.waitFor(`!WSDA.infrastructure.state.loading&&!WSDA.infrastructure.checklist.state.busy&&WSDA.infrastructure.state.version>${directVersion}`);
  check(await direct.page.eval("document.getElementById('facility-controls').textContent.includes('More than one file fits this layer')"),
    'a layer two files claim explains the choice');
  // The page has no hub link and no guide; the sample download sits inside "Load your data".
  check(await direct.page.eval(`!document.querySelector('a[href="../index.html"]')&&!document.getElementById('guide-section')
    &&!!document.querySelector('#load-fold [data-sample=infrastructure]')`),'no hub link or guide; sample download inside Load your data');
  // Download through a user gesture, then compare exact archive bytes.
  const dlDir=path.join(OUT,'downloads');fs.mkdirSync(dlDir,{recursive:true});
  await b.send('Browser.setDownloadBehavior',{behavior:'allowAndName',downloadPath:dlDir,eventsEnabled:true});
  let fileName;const downloaded=new Promise(res=>{const listener=m=>{
   if(m.method==='Browser.downloadWillBegin')fileName=m.params.suggestedFilename;
   if(m.method==='Browser.downloadProgress'&&m.params.state==='completed'){b.listeners.splice(b.listeners.indexOf(listener),1);res(m.params.guid);}
  };b.listeners.push(listener);});
  await direct.page.click("document.querySelector('[data-sample=infrastructure]').click()");
  const guid=await Promise.race([downloaded,sleep(15000).then(()=>null)]);
  check(guid&&fileName==='infrastructure_synthetic.zip'&&fs.readFileSync(path.join(dlDir,guid)).equals(fs.readFileSync(path.join(FIX,'infrastructure_synthetic.zip'))),'direct synthetic download byte-identical');
  check(await direct.page.eval("/infrastructure_synthetic\\.zip/.test(document.getElementById('sample-status').textContent)"),'sample download says what is saved');
  // The hub offers only the all-in-one sample; the Infrastructure generator it still loads must
  // give the same bytes as the dashboard's own download.
  check(await p.eval("Array.from(document.querySelectorAll('[data-sample]')).map(b=>b.getAttribute('data-sample')).join()==='all'"),
    'hub offers only the all-in-one sample');
  const hubSample=await p.eval("Array.from(WSDA.sample.zip(WSDA.samples.infrastructure.entries()))");
  check(Buffer.from(hubSample).equals(fs.readFileSync(path.join(FIX,'infrastructure_synthetic.zip'))),'hub sample byte-identical');
  // A pending checklist prevents opening stale files.
  await p.front();await loadHub(['infrastructure_synthetic.zip']);
  await p.eval("window.__recognize=WSDA.recognize.recognize;WSDA.recognize.recognize=(...a)=>new Promise(r=>{window.__release=()=>__recognize(...a).then(r)});void WSDA.landing.checklist.assign('f1','feedlots');true");
  check(await p.eval("WSDA.landing.checklist.state.busy&&WSDA.landing.openProfile('infrastructure')===null&&Array.from(document.querySelectorAll('button[data-open]')).every(b=>b.disabled)"),'busy recognition blocks stale Open');
  await p.eval('window.__release();WSDA.recognize.recognize=__recognize;true');await p.waitFor('!WSDA.landing.checklist.state.busy');
  await p.eval("WSDA.landing.checklist.assign('f1','')");
  // A local choice made before delayed hub delivery wins; fresh key can resend afterward.
  await p.eval("const it=WSDA.landing.state.result.items.find(i=>i.name==='wa_state_feedlots.csv'),read=it.read;it.read=()=>new Promise(r=>{window.__releaseFiles=()=>read().then(r)});true");
  await infra.page.eval('window.__old=1');await openHub();await infra.page.waitFor('!window.__old&&window.WSDA&&WSDA.infrastructure');
  await directLoad(infra.page,'#files-input',['sample/wa_state_fairs.csv']);
  await p.eval('window.__releaseFiles();true');await sleep(500);got=await infra.page.eval(SNAP);
  check(Object.keys(got.files).join()==='fairgrounds'&&got.source==='direct','local selection wins over delayed hub files');
  check(await p.eval("/local files are kept/.test(document.getElementById('next-opened').textContent)"),'superseded delivery reported');
  // Hub closed: reload receives no persistent files and explains direct reload.
  await b.closeTab((await b.pages(new RegExp('index.html$'))).find(t=>t.url===PAGE).targetId);
  await infra.page.reload();await infra.page.waitFor('window.WSDA&&WSDA.infrastructure');
  await infra.page.waitFor("/landing page is closed or unavailable/.test(document.getElementById('load-status').textContent)",12000);
  check(await infra.page.eval('Object.keys(WSDA.infrastructure.state.datasets).length===0'),'hub closed/reload has no persistent files');
  for(const [page,name]of [[infra.page,'infrastructure_entry.png'],[direct.page,'infrastructure_guide.png']]){
   await page.front();await b.send('Emulation.setDeviceMetricsOverride',{width:1024,height:600,deviceScaleFactor:1,mobile:false},page.sid);
   fs.writeFileSync(path.join(OUT,name),Buffer.from((await b.send('Page.captureScreenshot',{format:'png'},page.sid)).data,'base64'));
  }
  check(!b.log.requests.some(u=>! /^(blob|data|about):/.test(u)&&!u.startsWith(SITE_BASE)),'no requests outside site',b.log.requests.filter(u=>! /^(blob|data|about):/.test(u)&&!u.startsWith(SITE_BASE)));
  check(!b.log.exceptions.length,'no uncaught exceptions',b.log.exceptions);
  check(!b.log.csp.length,'no CSP violations',b.log.csp);
 }
 try {await Promise.race([suite(),new Promise((_,rej)=>{timeout=setTimeout(()=>rej(new Error('seven-minute suite limit')),420000);})]);}
 catch(e){check(false,'suite error',e.stack);run.network=b.log;run.tabs=[];for(const tab of b.opened){try{run.tabs.push(await tab.page.eval(`({url:location.href,state:WSDA.infrastructure&&{op:WSDA.infrastructure.state.op,loading:WSDA.infrastructure.state.loading,version:WSDA.infrastructure.state.version},status:document.getElementById('load-status')?.textContent})`));}catch(x){run.tabs.push(x.message);}}}
 finally{clearTimeout(timeout);await b.close();}
 Object.assign(run,{passed,failed,failures,finished:new Date().toISOString()});
 fs.writeFileSync(path.join(OUT,'browser_'+(PAGE.startsWith('file:')?'file':'http')+'.json'),JSON.stringify(run,null,2)+'\n');
 for(const f of failures)console.error(f);
 console.log('S6 entry-flow Chrome: '+passed+' passed, '+failed+' failed');process.exit(failed?1:0);
})();

async function facilityPage() {
 const b=await launch(),p=b.page,mode=PAGE.startsWith('file:')?'file':'http',result={chrome:b.version,page:PAGE,started:new Date().toISOString()};
 const fixtures=path.join(OUT,'fixtures');fs.mkdirSync(fixtures,{recursive:true});
 const direct=new URL('infrastructure/index.html',SITE_BASE).href;
 const shot=async name=>{const r=await b.send('Page.captureScreenshot',{format:'png'},p.sid);fs.writeFileSync(path.join(OUT,mode+'_'+name+'.png'),Buffer.from(r.data,'base64'));};
 const load=async files=>{const old=await p.eval('WSDA.infrastructure.state.version');await p.setFiles('#files-input',files);await p.waitFor(`WSDA.infrastructure.state.version>${old}&&!WSDA.infrastructure.state.loading`,30000);await settle();};
 const settle=()=>p.waitFor('WSDA.infrastructure.state.map.ready&&!WSDA.infrastructure.state.map.failed&&WSDA.infrastructure.state.map.map.loaded()&&!WSDA.infrastructure.state.map.map.isMoving()',30000);
 const snap=()=>p.eval(`(()=>{const s=WSDA.infrastructure.state,m=s.map;return {layers:s.selectedLayers,counts:s.result.counts,ids:s.result.rowIds,choices:s.prepared.layers.map(l=>[l.key,l.choices,l.usable]),cards:[...document.querySelectorAll('.count-card strong')].map(e=>Number(e.textContent.replace(/,/g,''))),strip:document.getElementById('facility-strip').textContent,zero:document.getElementById('facility-zero').textContent,zeroHidden:document.getElementById('facility-zero').hidden,camera:CVIWA.map.camera(m),placed:m.placedCounts||[],pop:!!m.clickPopup,sourceCount:m.facilityLayers.map((l,i)=>[l.key,m.map.getStyle().sources[WSDA.facilitymap.SRC(i)].data.features.length]),paint:m.facilityLayers.map((l,i)=>m.map.getPaintProperty(WSDA.facilitymap.CLUSTER(i),'circle-radius'))};})()`);
 const mouse=async(lon,lat,type)=>{const xy=await p.eval(`(()=>{const m=WSDA.infrastructure.state.map.map,q=m.project([${lon},${lat}]),r=m.getCanvas().getBoundingClientRect();return {x:r.x+q.x,y:r.y+q.y};})()`);await b.send('Input.dispatchMouseEvent',{type:type||'mouseMoved',...xy,buttons:type==='mousePressed'?1:0,button:type==='mousePressed'||type==='mouseReleased'?'left':'none',clickCount:type==='mousePressed'||type==='mouseReleased'?1:0},p.sid);};
 const pointClick=async(lon,lat)=>{await mouse(lon,lat);await mouse(lon,lat,'mousePressed');await sleep(50);await mouse(lon,lat,'mouseReleased');};
 const setCounty=async name=>{await p.eval(tickJs('document.getElementById("facility-counties")',name?[name]:[]));await settle();};
 let timer;
 try {
  timer=setTimeout(()=>{console.error('S6 facility page exceeded seven-minute bound');process.exit(124);},420000);
  await p.goto(direct);await p.waitFor('window.WSDA&&WSDA.infrastructure&&WSDA.infrastructure.state.map.ready');
  await b.send('Emulation.setDeviceMetricsOverride',{width:1366,height:768,deviceScaleFactor:1,mobile:false},p.sid);
  await load([path.join(ROOT,'local-test-artifacts/s6/day2/fixtures/infrastructure_synthetic.zip')]);
  let s=await snap();check(s.layers.length===6&&Object.values(s.counts).reduce((a,n)=>a+n,0)===8,'sample initial all six layers/eight rows',s);
  check(s.cards.join()==='2,1,1,1,1,2','sample equal count cards',s.cards);
  check(s.sourceCount.every(([k,n])=>n===s.counts[k]),'one row set for map/cards',s.sourceCount);
  check(s.paint.every(r=>JSON.stringify(r)===JSON.stringify(['step',['get','point_count'],14,10,18,50,24,200,32])),'source cluster paint');
  check(await p.eval('document.querySelectorAll("#facility-counties input").length')===39,'all WA county choices');
  check(await p.eval("document.getElementById('infra-basemap').selectedOptions[0].text==='Offline county map'"),'basemap picker opens on the offline map');
  // Layout rechecks. Every line of a text starts right of its dot: the text's line boxes from a Range.
  await p.eval(`window.besideDot=(dot,text)=>{const r=document.createRange();r.selectNodeContents(text);const lines=[...r.getClientRects()];
    return {lines:new Set(lines.map(x=>Math.round(x.top))).size,beside:lines.every(x=>x.left>=dot.getBoundingClientRect().right-0.5)};};true`);
  // A wrapped legend name continues under its text, not under the dot (legend narrowed so long names wrap).
  await p.eval("document.getElementById('facility-legend').style.maxWidth='130px'");
  const legendLines=await p.eval(`[...document.querySelectorAll('#facility-legend-content p.lg-line')].map(l=>besideDot(l.querySelector('.facility-swatch'),l.lastChild))`);
  await p.eval("document.getElementById('facility-legend').style.maxWidth=''");
  check(legendLines.length===6&&legendLines.some(l=>l.lines>1)&&legendLines.every(l=>l.beside),'wrapped legend names continue beside the dot',legendLines);
  // Checkbox, dot and name on one line; in a narrow sidebar a long name wraps beside the dot.
  const layerRows=()=>p.eval(`[...document.querySelectorAll('#facility-controls label.fac-row')].map(l=>{const box=l.querySelector('input').getBoundingClientRect(),
    dot=l.querySelector('.facility-swatch').getBoundingClientRect(),name=l.querySelector('.facility-title');
    return {firstLine:Math.abs(box.top-dot.top)<6&&Math.abs(box.top-name.getBoundingClientRect().top)<6,...besideDot(l.querySelector('.facility-swatch'),name)};})`);
  await p.eval("document.getElementById('facility-fold').open=true");
  let rows=await layerRows();
  check(rows.length===6&&rows.every(r=>r.firstLine&&r.lines===1),'layer rows: checkbox, dot and name on one line',rows);
  await p.eval("document.getElementById('facility-controls').style.width='140px'");rows=await layerRows();
  await p.eval("document.getElementById('facility-controls').style.width=''");
  check(rows.some(r=>r.lines>1)&&rows.every(r=>r.firstLine&&r.beside),'layer rows: a long name wraps beside the dot',rows);
  // A region's shown counties switch is indented under the region.
  await p.eval("document.getElementById('style-fold').open=true;document.querySelector('#neighbor-controls .nr-on').click()");await settle();
  const indent=await p.eval(`(()=>{const row=document.querySelector('#neighbor-controls .nr-row'),sub=row.querySelector('label.nr-sub');
    return {shown:!sub.hidden,step:sub.getBoundingClientRect().left-row.querySelector('label').getBoundingClientRect().left};})()`);
  check(indent.shown&&Math.abs(indent.step-22.4)<1,'neighbor counties switch indented 1.4rem under its region',indent);
  await p.eval("document.querySelector('#neighbor-controls .nr-on').click()");await settle();
  const camera=s.camera;
  await setCounty('Pierce');s=await snap();check(s.counts.slaughterhouses===2&&Object.values(s.counts).reduce((a,n)=>a+n,0)===2,'Pierce first-county restriction',s.counts);
  check(JSON.stringify(s.camera)===JSON.stringify(camera),'county filter preserves camera');
  check(await p.eval('document.querySelectorAll("#infrastructure-refine-5-0 input").length')===2,'unfiltered choices retained under county filter');
  // Attribute filters fold away, closed at first; opened here for the keyboard check.
  check(await p.eval(`(()=>{const folds=[...document.querySelectorAll('#facility-controls .facility-filters')];return folds.length===3&&folds.every(d=>!d.open);})()`),'attribute filters start folded');
  await p.eval("document.getElementById('infrastructure-filters-5').open=true");await sleep(50);
  await keepsFocus(p,settle,['infrastructure-layer-5','infrastructure-refine-5-0-0'],check);
  await setCounty('King');s=await snap();check(s.counts.synthetic_support===2&&s.counts.slaughterhouses===0&&s.layers.length===6,'zero selected layer stays usable',s.counts);
  await shot('county');
  await setCounty('');
  await p.eval(`(()=>{const m=WSDA.infrastructure.state.map.map;m.jumpTo({center:[-122.33,47.6],zoom:17});document.getElementById('facility-map').scrollIntoView({block:'center'});})()`);await settle();
  await pointClick(-122.33,47.6);await p.waitFor('!!WSDA.infrastructure.state.map.clickPopup');
  const details=await p.eval('document.querySelector(".facility-details").textContent');
  check(/Synthetic Support A/.test(details)&&/Service: Transport/.test(details)&&/WA county: King/.test(details),'shared screened click details',details);
  check(!/Town-level/.test(details),'existing precision does not claim town/address accuracy');
  check(await p.eval('document.activeElement.classList.contains("maplibregl-popup-close-button")'),'Close receives keyboard focus');
  for(const [w,h]of [[1366,768],[1024,600]]) {
   await b.send('Emulation.setDeviceMetricsOverride',{width:w,height:h,deviceScaleFactor:1,mobile:false},p.sid);await sleep(200);
   const bounds=await p.eval(`(()=>{const m=document.getElementById('facility-map').getBoundingClientRect(),d=document.querySelector('.facility-details').getBoundingClientRect(),l=document.getElementById('facility-legend').getBoundingClientRect();return {map:{x:m.x,y:m.y,right:m.right,bottom:m.bottom},details:{x:d.x,y:d.y,right:d.right,bottom:d.bottom},legend:{x:l.x,y:l.y,right:l.right,bottom:l.bottom}};})()`);
   check(bounds.details.x>=bounds.map.x-1&&bounds.details.right<=bounds.map.right+1&&bounds.details.y>=bounds.map.y-1&&bounds.details.bottom<=bounds.map.bottom+1,'details containment '+w+'x'+h,bounds);
   check(bounds.legend.x>=bounds.map.x&&bounds.legend.right<=bounds.map.right&&bounds.legend.y>=bounds.map.y&&bounds.legend.bottom<=bounds.map.bottom,'legend containment '+w+'x'+h,bounds);
   await shot('details_'+w);
  }
  await p.key('Enter',13,'\r');check(!await p.eval('document.querySelector(".facility-details")!==null'),'keyboard Close');
  await b.send('Emulation.setDeviceMetricsOverride',{width:1366,height:768,deviceScaleFactor:1,mobile:false},p.sid);
  await p.eval(tickJs('document.getElementById("infrastructure-refine-5-0")',['Storage']));await settle();
  s=await snap();check(s.counts.synthetic_support===1,'attribute UI filters rows');
  check(await p.eval(`document.getElementById('infrastructure-filters-5').open&&document.querySelector('#infrastructure-filters-5 .fold-sum').textContent==='1 filter on'`),'filter fold stays open and counts the filters on');
  await p.eval('WSDA.infrastructure.state.map.map.jumpTo({center:[-122.34,47.61],zoom:17});true');await settle();
  // The facility marks are MapLibre symbols, placed after a 0.3 s fade-in: wait until the mark is under the point.
  await p.waitFor(`(()=>{const m=WSDA.infrastructure.state.map.map;return m.queryRenderedFeatures(m.project([-122.34,47.61])).some(f=>/^infra_point_/.test(f.layer.id))})()`,5000,'mark placed');
  await pointClick(-122.34,47.61);await p.waitFor('!!WSDA.infrastructure.state.map.clickPopup');
  const missing=await p.eval('document.querySelector(".facility-details").textContent');check(/Synthetic Support B/.test(missing)&&!/Town-level/.test(missing),'NA precision keeps supplied name',missing);
  await setCounty('Pierce');check(!await p.eval('!!WSDA.infrastructure.state.map.clickPopup'),'filtered-out details close');
  // Dense input: exactly 10,000 valid points across five layers; 250 coincident towns in each.
  const specs=[['usda_wa_slaughter_facilities.csv','USDA.Slaughter.Facility'],['wa_state_fairs.csv','Fair.Name'],['wa_state_public_livestock_markets.csv','name'],['wa_state_feedlots.csv','name'],['wa_state_restricted_holding_facilities.csv','NAME']];
  const dense=specs.map(([file,heading],layer)=>{
   let csv=heading+',lat,long,Kind,geo_source\n';
   for(let i=0;i<2000;i++) {const town=i<250,king=i>=1000,lat=town?47.25:king?47.60+(i%20)*.00015:47.24+(i%20)*.00015,lon=town?-122.35:king?-122.33+(Math.floor(i/20)%30)*.00015:-122.36+(Math.floor(i/20)%30)*.00015;
    csv+=`Synthetic ${layer}-${i},${lat},${lon},${i%2?'Beta':'Alpha'},${town?'google_city':'existing'}\n`;}
   const dest=path.join(fixtures,file);fs.writeFileSync(dest,csv);return dest;
  });
  // Replacement keeps previously selected built-ins, and does not select a new layer.
  await load(dense);await p.eval(`(()=>{const s=WSDA.infrastructure.state;s.counties=[];document.getElementById('clear-counties').click();s.map.map.jumpTo({center:[-120.8,47.5],zoom:6});})()`);await settle();
  s=await snap();check(s.layers.length===5&&Object.values(s.counts).reduce((a,n)=>a+n,0)===10000,'dense 10000 valid rows across layers',s.counts);
  check(s.cards.every(n=>n===2000)&&s.sourceCount.every(([k,n])=>n===2000),'dense map/card counts');
  check(await p.eval(`(()=>{const m=WSDA.infrastructure.state.map,shown=[...document.querySelectorAll('.facility-count:not(.collided)')].map(e=>e.getBoundingClientRect()),names=m.labels.filter(l=>!l.getElement().classList.contains('hidden')).map(l=>l.getElement().getBoundingClientRect()),overlap=(a,b)=>a.x<b.right&&b.x<a.right&&a.y<b.bottom&&b.y<a.bottom;return m.placedCounts.some(c=>!c.shown)&&shown.length>0&&!shown.some((a,i)=>shown.slice(i+1).concat(names).some(b=>overlap(a,b)));})()`),'offline count labels hide collisions with names and each other');
  await shot('dense');
  // Real leaves, exact count and 15-name hover/remainder; towns stay clustered at max zoom.
  await p.eval(`WSDA.infrastructure.state.map.map.jumpTo({center:[-122.35,47.25],zoom:23});true`);await settle();
  const cluster=await p.eval(`(()=>{const m=WSDA.infrastructure.state.map.map;return m.queryRenderedFeatures(m.project([-122.35,47.25]),{layers:['infra_cluster_4']})[0]?.properties;})()`);
  check(cluster&&cluster.point_count===250,'coincident towns remain honest cluster near maximum zoom',cluster);
  await mouse(-122.35,47.25);await p.waitFor('document.querySelector(".facility-tip")&&document.querySelector(".facility-tip").textContent.includes("Synthetic")');
  const hover=await p.eval('document.querySelector(".facility-tip").textContent');
  check(hover.includes('...first 15 of 250 shown')&&(hover.match(/Synthetic \d-\d+/g)||[]).length===15,'cluster hover lists 15 names and the remainder',hover);check(/250 facilities/.test(hover)&&/town-level location/.test(hover),'real leaves, true count, town qualifier and remainder',hover);
  const oldCamera=(await snap()).camera;await pointClick(-122.35,47.25);check(!await p.eval('!!WSDA.infrastructure.state.map.clickPopup'),'numbered cluster has no click details');check(JSON.stringify((await snap()).camera)===JSON.stringify(oldCamera),'cluster click leaves camera');
  // Hold a real leaf promise, change data/filter, then release it; stale hover must stay closed.
  await p.eval(`(()=>{const s=WSDA.infrastructure.state,source=s.map.map.getSource('infra_src_4'),original=source.getClusterLeaves.bind(source);window.restoreLeaves=()=>{source.getClusterLeaves=original;};source.getClusterLeaves=(...args)=>{const actual=original(...args);window.heldLeaves=actual.then(leaves=>{window.leavesReady=true;return leaves;});return new Promise(resolve=>{window.releaseLeaves=()=>window.heldLeaves.then(resolve).catch(()=>resolve([]));});};s.map.clearHover();})()`);
  await mouse(-122.35,47.25);await p.waitFor('!!window.releaseLeaves&&!!window.leavesReady');await setCounty('King');await p.eval('window.releaseLeaves();window.restoreLeaves()');await sleep(200);
  check(!await p.eval('!!document.querySelector(".facility-tip")'),'stale leaves rejected after filter redraw');
  // A late reply for one cluster must not overwrite the hover of the next one: hold the first cluster's leaves,
  // move straight onto a second cluster, then release the first reply.
  await setCounty('');await p.eval(`(()=>{const m=WSDA.infrastructure.state.map.map;document.getElementById('facility-map').scrollIntoView({block:'center'});m.resize();m.jumpTo({center:[-122.34,47.42],zoom:8.5});return true;})()`);await settle();
  const pair=await p.eval(`(()=>{const m=WSDA.infrastructure.state.map.map,f=m.queryRenderedFeatures().filter(x=>x.properties.point_count&&/^infra_/.test(x.layer.id)),a=f.find(x=>x.geometry.coordinates[1]<47.4),b=f.find(x=>x.geometry.coordinates[1]>47.5);return a&&b?[a.geometry.coordinates,b.geometry.coordinates]:null;})()`);
  check(!!pair,'two separate dense clusters for the late-reply check',pair);
  if(pair){
   await p.eval(`(()=>{const s=WSDA.infrastructure.state;window.leafHeld=null;window.releaseFirst=null;for(let i=0;i<5;i++){const source=s.map.map.getSource('infra_src_'+i);if(!source)continue;const original=source.getClusterLeaves.bind(source);window['restoreLeaves'+i]=()=>{source.getClusterLeaves=original;};source.getClusterLeaves=(...args)=>{const actual=Promise.resolve(original(...args));if(window.leafHeld)return actual;window.leafHeld=new Promise(resolve=>{window.releaseFirst=()=>actual.then(resolve,()=>resolve([]));});return window.leafHeld;};}s.map.clearHover();return true;})()`);
   await mouse(pair[0][0],pair[0][1]);await p.waitFor('!!window.releaseFirst');
   await mouse(pair[1][0],pair[1][1]);await p.waitFor('document.querySelector(".facility-tip")&&/Synthetic \\d-1\\d{3}/.test(document.querySelector(".facility-tip").textContent)');
   await p.eval('window.releaseFirst();true');await sleep(300);
   const late=await p.eval('document.querySelector(".facility-tip")?document.querySelector(".facility-tip").textContent:""');
   check(/Synthetic \d-1\d{3}/.test(late)&&!/Synthetic \d-\d{1,3}(?!\d)/.test(late),'late leaves for one cluster do not overwrite the next cluster hover',late);
   await p.eval('for(let i=0;i<5;i++)if(window["restoreLeaves"+i])window["restoreLeaves"+i]();WSDA.infrastructure.state.map.clearHover();true');
  }
  // Settled means all source workers are loaded and map idle, rather than synchronous JS duration.
  await p.eval(`WSDA.infrastructure.state.map.map.jumpTo({center:[-120.8,47.5],zoom:6});true`);await settle();
  await setCounty('');
  const refineTimings=[];
  for(const value of ['Alpha','Beta','','Alpha','Beta','','Alpha','Beta','']) {const t=Date.now();
   await p.eval(tickJs('document.getElementById("infrastructure-refine-3-0")',value?[value]:[]));await settle();
   refineTimings.push({value,ms:Date.now()-t});const counts=(await snap()).counts;check(counts.feedlots===(value?1000:2000)&&counts.slaughterhouses===2000,'dense refine row/card count '+value,counts);
  }
  result.refineTimings=refineTimings;result.refineMedians=Object.fromEntries(['Alpha','Beta',''].map(n=>{const v=refineTimings.filter(t=>t.value===n).map(t=>t.ms).sort((a,b)=>a-b);return [n||'Clear',v[1]];}));
  check(Object.values(result.refineMedians).every(n=>n<=5000),'settled attribute redraw median <=5 seconds',result.refineMedians);
  const timings=[];
  for(const name of ['Pierce','King','','Pierce','King','','Pierce','King','']) {const t=Date.now();await setCounty(name);timings.push({county:name,ms:Date.now()-t});}
  const medians=Object.fromEntries(['Pierce','King',''].map(n=>{const v=timings.filter(t=>t.county===n).map(t=>t.ms).sort((a,b)=>a-b);return [n||'All',v[1]];}));
  result.timings=timings;result.medians=medians;check(Object.values(medians).every(n=>n<=5000),'settled filter redraw median <=5 seconds',medians);
  for(const name of ['King','Pierce']) {await setCounty(name);s=await snap();check(s.cards.every(n=>n===1000),'dense hand-derived county counts '+name,s.counts);}
  await setCounty('Adams');s=await snap();check(s.cards.every(n=>n===0)&&s.layers.length===5&&!s.zeroHidden&&/No facilities match/.test(s.zero),'dense zero-result case',s.counts);await shot('zero');
  // Equal-size replacement invalidates obsolete selections and closes details; safe text/minimal payload.
  const replacement=path.join(fixtures,'replacement'),file=path.join(replacement,'wa_state_feedlots.csv');fs.mkdirSync(replacement,{recursive:true});
  fs.writeFileSync(file,'name,lat,long,Kind,owner,geo_source\n"<img src=x onerror=alert(1)>",47.25,-122.35,Alpha,Secret,google_city\nB,47.26,-122.36,Beta,Other,existing\n');
  await load([file]);await setCounty('');
  await p.eval(`(()=>{${tickJs('document.getElementById("infrastructure-refine-3-0")',['Alpha'])};WSDA.infrastructure.state.map.map.jumpTo({center:[-122.35,47.25],zoom:18});})()`);await settle();
  await pointClick(-122.35,47.25);await p.waitFor('document.querySelector(".facility-details")');
  check(await p.eval('document.querySelector(".facility-details").textContent.includes("<img src=x")&&!document.querySelector(".facility-details img")&&!document.querySelector(".facility-details").textContent.includes("Secret")'),'safe supplied text/screened fields');
  check(await p.eval(`(()=>{const f=WSDA.infrastructure.state.map.map.getStyle().sources.infra_src_0.data.features[0];return Object.keys(f.properties).sort().join()==='ref_display,ref_name,row_id';})()`),'minimal actual GeoJSON payload');
  fs.writeFileSync(file,'name,lat,long,Kind,owner,geo_source\nA,47.25,-122.35,Gamma,Secret,existing\nB,47.26,-122.36,Delta,Other,existing\n');await load([file]);
  check(!await p.eval('!!WSDA.infrastructure.state.map.clickPopup'),'replacement closes details');
  check(await p.eval(`(()=>{const s=WSDA.infrastructure.state;return s.attributes.feedlots.Kind.length===0&&s.prepared.layers.find(l=>l.key==='feedlots').choices.Kind.join()==='Delta,Gamma'&&!document.getElementById('selection-notice').hidden;})()`),'same-size content revision choices and clear notice');
  await p.eval(`document.getElementById('infrastructure-layers-clear').click()`);await settle();s=await snap();check(!s.layers.length&&await p.eval('document.getElementById("facility-cards").textContent')==='Select facility layers to see counts.','Clear/no selected cards');
  await load([file]);check((await snap()).layers.length===0,'replacement after Clear does not auto-select');
  // A point on the border of two counties: Infrastructure counts it in the first county the geometry lists only;
  // County Focus would count it in both. The point is a shared border vertex of Pierce.
  const geoBox={window:{}};
  require('vm').runInNewContext(fs.readFileSync(path.join(ROOT,'site/geo/wa-counties.js'),'utf8'),geoBox);
  require(path.join(ROOT,'site/shared/facilities.js'));
  const waCounties=geoBox.window.CVIWA_GEO.counties;
  const member=globalThis.WSDA.facilities.countyMembership(waCounties,waCounties.features.map(f=>f.properties.name));
  const pierce=waCounties.features.find(f=>f.properties.name==='Pierce').geometry;
  const rings=(pierce.type==='Polygon'?[pierce.coordinates]:pierce.coordinates).flat();
  const vertex=rings.flat().find(([x,y])=>member.countiesAt(x,y).length===2);
  const border=member.countiesAt(vertex[0],vertex[1]);
  // 26 rows at that point with 26 Kind values, so the Kind list is long enough to scroll.
  const kinds=Array.from({length:26},(_,i)=>'K'+String(i).padStart(2,'0'));
  const borderFile=path.join(fixtures,'border','wa_state_feedlots.csv');
  fs.mkdirSync(path.dirname(borderFile),{recursive:true});
  fs.writeFileSync(borderFile,'name,lat,long,Kind\n'+kinds.map(k=>'Border '+k+','+vertex[1]+','+vertex[0]+','+k).join('\n')+'\n');
  await load([borderFile]);
  await p.eval(`document.getElementById('infrastructure-layer-3').click();true`);await settle();
  await setCounty(border[0]);
  check((await snap()).counts.feedlots===26,'border point counted in its first county '+border[0],(await snap()).counts);
  await setCounty(border[1]);
  check((await snap()).counts.feedlots===0,'border point not counted in its second county '+border[1],(await snap()).counts);
  await setCounty('');
  // Rebuilding a list after a change keeps where it was scrolled to.
  const scrollKept=async(listId,tick)=>{
    const sel=JSON.stringify(listId);
    const before=await p.eval(`(()=>{const e=document.getElementById(${sel});e.scrollTop=e.scrollHeight;return e.scrollTop;})()`);
    await p.eval(tickJs(`document.getElementById(${sel})`,tick));await settle();
    const after=await p.eval(`document.getElementById(${sel}).scrollTop`);
    check(before>0&&after===before,'scroll position kept in '+listId,{before,after});
  };
  await p.eval("document.getElementById('infrastructure-filters-3').open=true");await sleep(50);
  await scrollKept('infrastructure-refine-3-0',['K25']);
  check((await snap()).counts.feedlots===1,'refine pick near the end of a long list applied');
  await scrollKept('facility-counties',['Whitman']);
  check(b.log.exceptions.length===0,'no uncaught browser exceptions',b.log.exceptions);
  check(b.log.csp.length===0,'no CSP violations',b.log.csp);
  const external=b.log.requests.filter(u=>!u.startsWith(SITE_BASE)&&!u.startsWith('blob:')&&!u.startsWith('data:')&&!u.startsWith('about:'));
  check(!external.length,'offline requests only',external);
 } catch(e) {check(false,'complete facility page suite',e.stack);} finally {
  clearTimeout(timer);result.passed=passed;result.failed=failed;result.failures=failures;result.network=b.log;
  fs.writeFileSync(path.join(OUT,'browser_'+mode+'.json'),JSON.stringify(result,null,2)+'\n');await b.close();
 }
 failures.forEach(f=>console.error('FAIL '+f.name+' '+JSON.stringify(f.detail)));console.log(`S6 facilities Chrome: ${passed} passed, ${failed} failed`);process.exitCode=failed?1:0;
}
if(process.argv.includes('--facilities'))facilityPage().catch(e=>{console.error(e.stack);process.exitCode=2;});

async function focusPage() {
 const b=await launch(),p=b.page,mode=PAGE.startsWith('file:')?'file':'http',result={chrome:b.version,page:PAGE,started:new Date().toISOString()};
 const H='CVIWA.state.focusHandle',F='CVIWA.focusState',timings=[];let timer;
 const settle=()=>p.waitFor(`${H}&&${H}.ready&&${H}.map.loaded()&&!${H}.map.isMoving()`,30000);
 const shot=async name=>fs.writeFileSync(path.join(OUT,mode+'_'+name+'.png'),Buffer.from((await b.send('Page.captureScreenshot',{format:'png'},p.sid)).data,'base64'));
 const counties=async names=>{await p.eval(`document.querySelector('[data-clear="foCounties"]').click(); for(const c of document.querySelectorAll('#fo-counties input'))if(${JSON.stringify(names)}.includes(c.value))c.click();`);await sleep(650);await settle();};
 const send=async text=>{await p.eval(`CVIWA.setFacilityFiles({feedlots:{file:new Blob([${JSON.stringify(text)}])}}).then(()=>true)`);await settle();};
 const all=async()=>{await p.eval(`document.getElementById('fo-fac-all').click()`);await settle();};
 const pick=async value=>{await p.eval(tickJs('document.querySelector("#fo-fac-list .facility-refine")',Array.isArray(value)?value:value?[value]:[]));await settle();};
 const counts=()=>p.eval(`${F}.fac.result.counts`);
 const mouse=async(lon,lat)=>{const xy=await p.eval(`(()=>{const m=${H}.map,q=m.project([${lon},${lat}]),r=m.getCanvas().getBoundingClientRect();return {x:r.x+q.x,y:r.y+q.y};})()`);for(const type of ['mouseMoved','mousePressed','mouseReleased']){await b.send('Input.dispatchMouseEvent',{type,...xy,buttons:type==='mousePressed'?1:0,button:type==='mouseMoved'?'none':'left',clickCount:type==='mouseMoved'?0:1},p.sid);await sleep(80);}};
 try {
  timer=setTimeout(()=>process.exit(124),420000);
  await p.goto(new URL('cvi/index.html',SITE_BASE).href);await p.waitFor('window.CVIWA&&CVIWA.state');
  await p.setFiles('#file-input',[path.join(ROOT,'local-test-artifacts/f1/tiers/full/CVI_Consolidated_Master.csv')]);await p.waitFor('CVIWA.state.master&&!CVIWA.state.loading');
  await p.eval(`document.getElementById('show-focus').click()`);await settle();
  await b.send('Emulation.setDeviceMetricsOverride',{width:1366,height:768,deviceScaleFactor:1,mobile:false},p.sid);
  const csv='name,lat,long,Kind,Service,owner,geo_source\n"<img src=x onerror=alert(1)>",47.25,-122.35,Alpha,Transport,Secret,google_city\nB,47.26,-122.36,Beta,Storage,Other,NA\nC,47.6,-122.33,Alpha,Storage,Private,existing\n';
  await send(csv);check(await p.eval(`${F}.fac.on.length===0`),'Focus starts layers off');
  await all();check((await counts()).feedlots===0,'no counties means no facilities');
  await counties(['Pierce']);check((await counts()).feedlots===2,'Pierce local row count');
  check(await p.eval(`document.querySelector('.facility-local-count').textContent.includes('2')`),'compact rendered count');
  check(await p.eval(`(()=>{const folds=[...document.querySelectorAll('#fo-fac-list .facility-filters')];return folds.length===1&&!folds[0].open;})()`),'Focus attribute filters start folded');
  // Layer rows as in Infrastructure: checkbox, dot and name on one line; in a narrow list a long name
  // wraps beside the dot. Every line of the name must start right of the dot (line boxes from a Range).
  const focusRows=()=>p.eval(`(()=>{const list=document.getElementById('fo-fac-list');if(list.closest('details'))list.closest('details').open=true;
    return [...list.querySelectorAll('label.fac-row')].map(l=>{const box=l.querySelector('input').getBoundingClientRect(),dot=l.querySelector('.facility-swatch'),
      name=l.querySelector('.facility-title'),r=document.createRange();r.selectNodeContents(name);const lines=[...r.getClientRects()];
      return {firstLine:Math.abs(box.top-dot.getBoundingClientRect().top)<6&&Math.abs(box.top-name.getBoundingClientRect().top)<6,
        lines:new Set(lines.map(x=>Math.round(x.top))).size,beside:lines.every(x=>x.left>=dot.getBoundingClientRect().right-0.5)};});})()`);
  let rows=await focusRows();
  check(rows.length>=5&&rows.every(r=>r.firstLine&&r.lines===1),'Focus layer rows: checkbox, dot and name on one line',rows);
  await p.eval("document.getElementById('fo-fac-list').style.width='140px'");rows=await focusRows();
  await p.eval("document.getElementById('fo-fac-list').style.width=''");
  check(rows.some(r=>r.lines>1)&&rows.every(r=>r.firstLine&&r.beside),'Focus layer rows: a long name wraps beside the dot',rows);
  check(await p.eval(`Object.keys(${F}.fac.prepared.layers.find(l=>l.key==='feedlots').choices).join()==='Kind,Service'`),'screened attribute choices');
  check(await p.eval(`${H}.map.getStyle().sources.focus_fac_src_0.cluster!==true`),'Focus facilities stay unclustered');
  await counties(['Pierce','King']);check((await counts()).feedlots===3,'Focus selected polygon union');
  const movement=await p.eval(`JSON.stringify([${F}.valueBoxes,${F}.strip])`),cam=await p.eval(`CVIWA.map.camera(${H})`);
  await pick(['Alpha']);check((await counts()).feedlots===2,'shared attribute OR restriction');
  check(await p.eval(`JSON.stringify([${F}.valueBoxes,${F}.strip])`)===movement,'four movement cards/activity strip unchanged by facility attributes');
  check(JSON.stringify(await p.eval(`CVIWA.map.camera(${H})`))===JSON.stringify(cam),'attribute filtering keeps camera');
  await p.eval(tickJs('document.querySelectorAll("#fo-fac-list .facility-refine")[1]',['Transport']));await settle();
  check((await counts()).feedlots===1,'AND across shared attribute pickers');
  const facFold=await p.eval(`document.getElementById('fo-fac-block').open`);await p.eval(`document.getElementById('fo-fac-block').open=true`);
  await p.eval("document.querySelectorAll('#fo-fac-list .facility-filters').forEach(d=>{d.open=true;})");await sleep(50);
  await keepsFocus(p,settle,[await p.eval(`document.querySelector('#fo-fac-list input[id^="focus-layer-"]:checked').id`),await p.eval(`document.querySelector('#fo-fac-list .facility-refine input').id`)],check);
  check((await counts()).feedlots===1,'focus checks restore the Focus selection');
  await p.eval(`document.getElementById('fo-fac-block').open=${facFold}`);
  await p.eval(`document.querySelector('[data-clear="foSpecies"]').click();document.querySelector('[data-clear="foYears"]').click();document.querySelector('[data-clear="foQuarters"]').click()`);await sleep(350);await settle();
  check((await counts()).feedlots===1,'facilities independent of CVI species/year/quarter filters');
  await p.eval(`const e=document.getElementById('fo-hide');e.checked=true;e.dispatchEvent(new Event('change',{bubbles:true}));void ${H}.map.jumpTo({center:[-122.35,47.25],zoom:15});`);await settle();
  check(await p.eval(`document.getElementById('legend-panel-focus').textContent.includes('Facility locations')&&${H}.map.getLayoutProperty('focus_points_in','visibility')==='none'`),'Hide CVI leaves facility legend/markers');
  await mouse(-122.35,47.25);await p.waitFor('document.querySelector(".facility-details")');
  const detail=await p.eval('document.querySelector(".facility-details").textContent');check(/Town-level location/.test(detail)&&/Kind: Alpha/.test(detail)&&/Service: Transport/.test(detail)&&/WA county: Pierce/.test(detail)&&detail.includes('<img src=x')&&!detail.includes('Secret'),'shared safe supplied details while CVI hidden',detail);
  check(await p.eval(`!document.querySelector('.facility-details img')&&Object.keys(${H}.map.getStyle().sources.focus_fac_src_0.data.features[0].properties).sort().join()==='name,ref_display,row_id'`),'safe text/minimal payload excludes attribute cells');
  for(const [w,h]of [[1366,768],[1024,600]]){
   await b.send('Emulation.setDeviceMetricsOverride',{width:w,height:h,deviceScaleFactor:1,mobile:false},p.sid);await sleep(300);
   const boxes=await p.eval(`(()=>{const m=document.getElementById('focus-map').getBoundingClientRect(),p=document.querySelector('.facility-details').getBoundingClientRect();document.getElementById('legend-panel-focus').hidden=false;const l=document.getElementById('legend-panel-focus').getBoundingClientRect();return {detail:p.x>=m.x-1&&p.right<=m.right+1&&p.y>=m.y-1&&p.bottom<=m.bottom+1,legend:l.x>=m.x-1&&l.right<=m.right+1&&l.y>=m.y-1&&l.bottom<=m.bottom+1};})()`);check(boxes.detail&&boxes.legend,'details/legend containment '+w+'x'+h,boxes);await shot('details_'+w);
  }
  check(await p.eval('document.activeElement.classList.contains("maplibregl-popup-close-button")'),'Close receives keyboard focus');
  await p.key('Enter',13,'\r');
  check(await p.eval(`!document.querySelector('.facility-details')`),'keyboard Close');
  // A map click away from the facility closes its details, as in S5.
  await mouse(-122.35,47.25);await p.waitFor('document.querySelector(".facility-details")');
  const away=await p.eval(`(()=>{const m=${H}.map,q=m.project([-122.35,47.25]),l=m.unproject([q.x+60,q.y]);return [l.lng,l.lat];})()`);
  await mouse(away[0],away[1]);await sleep(200);
  check(await p.eval(`!${H}.clickPopup&&!document.querySelector('.facility-details')`),'a map click closes facility details',
    await p.eval(`({popup:!!${H}.clickPopup,details:!!document.querySelector('.facility-details'),stack:${H}.clickStack||null})`));
  await mouse(-122.35,47.25);await p.waitFor('document.querySelector(".facility-details")');await pick(['Beta']);
  check(await p.eval(`!${H}.clickPopup`),'filtered-out row closes details');check((await counts()).feedlots===0,'selected usable zero layer stays enabled');
  check(await p.eval(`!document.querySelector('#fo-fac-list input[value="feedlots"]').disabled&&document.getElementById('fo-fac-list').textContent.includes('No facilities match')`),'zero vs unavailable explanation');
  await send(csv.replaceAll('Alpha','Gamma').replaceAll('Beta','Delta'));check(await p.eval(`${F}.fac.attributes.feedlots.Kind.length===0&&!document.getElementById('fo-fac-notice').hidden&&${F}.fac.prepared.layers[3].choices.Kind.join()==='Delta,Gamma'`),'same-size replacement rebuilds choices/clears invalid picks');
  await pick(['Gamma']);await send(csv.replaceAll('Alpha','Gamma').replaceAll('Beta','Delta'));check(await p.eval(`${F}.fac.attributes.feedlots.Kind.join()==='Gamma'`),'replacement preserves valid picks');
  await p.eval(`document.getElementById('fo-fac-clear').click()`);await settle();check(await p.eval(`${F}.fac.on.length===0&&${F}.fac.attributes.feedlots.Kind.join()==='Gamma'`),'Clear hides only facilities and preserves inactive picks');await all();check(await p.eval(`${F}.fac.attributes.feedlots.Kind.join()==='Gamma'`),'All restores valid inactive picks');
  await send('lat,long\n47.25,-122.35\n');check((await counts()).feedlots===1&&await p.eval(`${F}.fac.prepared.layers[3].points[0].geoSource==='existing'&&Object.keys(${F}.fac.prepared.layers[3].choices).length===0`),'reduced name/precision/attribute fallback');
  await send('name,lat,long,Kind\n'+('Long supplied name '.repeat(100))+',47.25,-122.35,Alpha\nB,47.26,-122.36,Beta\n');await mouse(-122.35,47.25);await p.waitFor('document.querySelector(".facility-details")');
  check(await p.eval(`(()=>{const e=document.querySelector('.facility-details'),s=getComputedStyle(e),m=document.getElementById('focus-map').getBoundingClientRect(),r=e.getBoundingClientRect();e.scrollTop=e.scrollHeight;return s.fontSize==='14px'&&e.scrollHeight>e.clientHeight&&e.scrollTop>0&&r.left>=m.left&&r.right<=m.right&&r.top>=m.top&&r.bottom<=m.bottom;})()`),'long supplied text scrolls at14px inside small map');await shot('long_details_1024');
  await send('name,lat,long\n');check(await p.eval(`${F}.fac.on.length===0&&document.querySelector('#fo-fac-list input[value="feedlots"]').disabled`),'zero input unavailable explanation');
  await p.eval('CVIWA.setFacilityFiles({}).then(()=>true)');check(await p.eval(`${F}.fac.prepared.layers.every(l=>!l.usable)`),'missing facilities isolated from master');
  const denseFiles=['usda_wa_slaughter_facilities.csv','wa_state_fairs.csv','wa_state_public_livestock_markets.csv','wa_state_feedlots.csv','wa_state_restricted_holding_facilities.csv'];
  const texts=Object.fromEntries(denseFiles.map((n,i)=>[['slaughterhouses','fairgrounds','markets','feedlots','restricted'][i],fs.readFileSync(path.join(ROOT,'local-test-artifacts/s6/day3/fixtures',n),'utf8')]));
  await p.eval(`CVIWA.setFacilityFiles(Object.fromEntries(Object.entries(${JSON.stringify(texts)}).map(([k,t])=>[k,{file:new Blob([t])}]))).then(()=>true)`);await all();await counties(['Pierce','King']);
  check(Object.values(await counts()).reduce((a,n)=>a+n,0)===10000,'dense 10000 points in Focus union');
  for(const names of [['Pierce'],['King'],['Pierce','King']]){const samples=[];for(let i=0;i<3;i++){const start=Date.now();await counties(names);samples.push(Date.now()-start);check(Object.values(await counts()).every(n=>n===(names.length===2?2000:1000)),'dense hand-derived county count '+names.join('/')+'/'+i);}const median=samples.sort((a,b)=>a-b)[1];timings.push({counties:names,median,samples});check(median<=5000,'settled county redraw median <=5000ms '+names.join('/'),median);}
  for(const value of ['Alpha','Beta','']){const samples=[];for(let i=0;i<3;i++){const start=Date.now();await p.eval(tickJs('document.getElementById("focus-refine-0-0")',value?[value]:[]));await settle();samples.push(Date.now()-start);check(await p.eval(`${H}.fac.layers.every((l,i)=>${H}.map.getStyle().sources['focus_fac_src_'+i].data.features.length===${F}.fac.result.counts[l.key])`),'dense settled count/source agreement '+value+'/'+i);}const median=samples.sort((a,b)=>a-b)[1];timings.push({value,median,samples});check(median<=5000,'settled redraw median <=5000ms '+value,median);}
  const tabCount=b.opened.length;await b.send('Target.createTarget',{url:new URL('infrastructure/index.html',SITE_BASE).href});const infra=(await b.waitTab(tabCount)).page;await infra.waitFor('window.WSDA&&WSDA.infrastructure&&WSDA.infrastructure.state.map.ready');await infra.setFiles('#files-input',[path.join(ROOT,'local-test-artifacts/s6/day2/fixtures/infrastructure_synthetic.zip')]);await infra.waitFor('WSDA.infrastructure.state.version>0&&!WSDA.infrastructure.state.loading');await infra.eval(tickJs('document.getElementById("facility-counties")',['King']));const infraState=await infra.eval('JSON.stringify([WSDA.infrastructure.state.counties,WSDA.infrastructure.state.selectedLayers,WSDA.infrastructure.state.attributes,WSDA.infrastructure.state.result.counts])');await p.front();
  await pick(['Alpha']);await p.eval(`document.getElementById('fo-fac-block').open=true`);const resetCam=await p.eval(`CVIWA.map.camera(${H})`);await p.eval(`document.getElementById('reset-all').click()`);await sleep(350);await settle();
  check(await p.eval(`${F}.fac.on.length===0&&Object.keys(${F}.fac.attributes).length===0&&${F}.counties.length===0&&document.getElementById('fo-fac-block').open`),'Reset All clears facility picks and preserves fold');
  check(JSON.stringify(await p.eval(`CVIWA.map.camera(${H})`))===JSON.stringify(resetCam),'Reset All keeps camera');
  check(await infra.eval('JSON.stringify([WSDA.infrastructure.state.counties,WSDA.infrastructure.state.selectedLayers,WSDA.infrastructure.state.attributes,WSDA.infrastructure.state.result.counts])')===infraState,'Focus reset leaves Infrastructure local state unchanged');
  check(!b.log.exceptions.length&&!b.log.csp.length,'no exceptions/CSP violations',b.log);
  check(!b.log.requests.filter(u=>!u.startsWith(SITE_BASE)&&!u.startsWith('blob:')&&!u.startsWith('data:')&&!u.startsWith('about:')).length,'offline requests only');
 }catch(e){check(false,'complete Focus contextual facility suite',e.stack);}finally{clearTimeout(timer);Object.assign(result,{passed,failed,failures,timings,network:b.log});fs.writeFileSync(path.join(OUT,'browser_'+mode+'.json'),JSON.stringify(result,null,2)+'\n');await b.close();}
 failures.forEach(f=>console.error('FAIL '+f.name+' '+JSON.stringify(f.detail)));console.log(`S6 Focus Chrome: ${passed} passed, ${failed} failed`);process.exitCode=failed?1:0;
}
if(process.argv.includes('--focus'))focusPage().catch(e=>{console.error(e.stack);process.exitCode=2;});

async function activityPage() {
 const b=await launch(),p=b.page,mode=PAGE.startsWith('file:')?'file':'http',out={chrome:b.version,page:PAGE,started:new Date().toISOString()},fixtures=path.join(OUT,'fixtures');fs.mkdirSync(fixtures,{recursive:true});
 const S='WSDA.infrastructure.state',H=S+'.map',A=S+'.activity';let timer,providerMode='ok',currentProvider=null;const provider=[];
 const settle=()=>p.waitFor(`${H}.ready&&!${H}.failed&&!${H}.switching&&${H}.map.loaded()&&!${H}.map.isMoving()`,30000);
 const load=async files=>{const old=await p.eval(S+'.version');await p.setFiles('#files-input',files);await p.waitFor(`${S}.version>${old}&&!${S}.loading`,30000);await settle();};
 const change=async(id,value)=>{await p.eval(`(()=>{const e=document.getElementById(${JSON.stringify(id)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}));})()`);await settle();};
 const pick=async(id,values)=>{await p.eval(tickJs(`document.getElementById(${JSON.stringify(id)})`,values));await settle();};
 const click=async selector=>{await p.eval(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`);const q=await p.eval(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);await b.send('Input.dispatchMouseEvent',{type:'mousePressed',...q,button:'left',buttons:1,clickCount:1},p.sid);await b.send('Input.dispatchMouseEvent',{type:'mouseReleased',...q,button:'left',buttons:0,clickCount:1},p.sid);};
 const shot=async name=>{await p.eval("document.getElementById('facility-map').scrollIntoView({block:'center'})");const r=await b.send('Page.captureScreenshot',{format:'png'},p.sid);fs.writeFileSync(path.join(OUT,mode+'_'+name+'.png'),Buffer.from(r.data,'base64'));};
 const sample=path.join(ROOT,'local-test-artifacts/s6/day2/fixtures/infrastructure_synthetic.zip');
 const tier=t=>path.join(ROOT,'local-test-artifacts/f1/tiers',t,t==='partner'?'partner_county_totals.csv':'CVI_Consolidated_Master.csv');
 const values=()=>p.eval(`${S}.activityData.map(r=>[r.county,r.direction,r.lat,r.lon,r.total_animals,r.radius_px])`);
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jK1kAAAAASUVORK5CYII=','base64');
 b.listeners.push(m=>{if(m.method!=='Fetch.requestPaused'||m.sessionId!==p.sid)return;const rid=m.params.requestId,url=m.params.request.url;provider.push({url,mode:providerMode});
  let body=png,type='image/png';const isStyle=currentProvider&&currentProvider.type==='vector'&&url===currentProvider.style;
  if(isStyle){type='application/json';body=Buffer.from(JSON.stringify({version:8,sources:{synthetic:{type:'raster',tiles:['https://'+currentProvider.hosts[0]+'/s6/{z}/{x}/{y}.png'],tileSize:256,attribution:currentProvider.attribution}},layers:[{id:'synthetic',type:'raster',source:'synthetic'}]}));}
  b.send('Fetch.fulfillRequest',{requestId:rid,responseCode:providerMode==='ok'?200:404,body:(providerMode==='ok'?body:Buffer.from('unavailable')).toString('base64'),responseHeaders:[{name:'Content-Type',value:type},{name:'Access-Control-Allow-Origin',value:'*'}]},p.sid).catch(()=>{});
 });
 try {
  timer=setTimeout(()=>{console.error('S6 activity suite exceeded seven-minute bound');process.exit(124)},420000);
  await p.goto(new URL('infrastructure/index.html',SITE_BASE).href);await p.waitFor('window.WSDA&&WSDA.infrastructure&&WSDA.infrastructure.state.map.ready');
  await b.send('Emulation.setDeviceMetricsOverride',{width:1366,height:768,deviceScaleFactor:1,mobile:false},p.sid);
  await load([sample]);check(await p.eval(`!${A}.on&&document.getElementById('activity-on').disabled&&${S}.result.layers.length===6`),'facility-only overlay gated, facilities working');
  await load([sample,tier('full')]);check(await p.eval(`!${A}.on&&!document.getElementById('activity-on').disabled&&${A}.scaling==='log'&&${A}.nBins===5&&${A}.opacity===.6&&${A}.palette==='WSDA Default'&&${S}.activityData.length===0`),'optional activity defaults/off');
  await click('#activity-fold summary');await click('#activity-on');await settle();check(await p.eval(`${A}.on&&${S}.activityData.length>0`),'real toggle shows county activity');
  const initial=await values(),camera=await p.eval(`CVIWA.map.camera(${H})`),ref=JSON.parse(fs.readFileSync(path.join(ROOT,'local-test-artifacts/s6/day5/activity_reference.json')));
  const hoverPoint=initial[0];await p.eval(`${H}.map.jumpTo({center:[${hoverPoint[3]},${hoverPoint[2]}],zoom:8});document.getElementById('facility-map').scrollIntoView({block:'center'});true`);await settle();
  const xy=await p.eval(`(()=>{const m=${H}.map,q=m.project([${hoverPoint[3]},${hoverPoint[2]}]),r=m.getCanvas().getBoundingClientRect();return{x:r.x+q.x,y:r.y+q.y}})()`);await b.send('Input.dispatchMouseEvent',{type:'mouseMoved',...xy},p.sid);await p.waitFor(`${H}.hover&&document.querySelector('.facility-tip')`);check(await p.eval(`${H}.map.getFeatureState(${H}.hover).hover&&document.querySelector('.facility-tip').textContent.includes('animals')`),'activity compact safe hover/brightening');
  check(await p.eval(`${H}.drawn.every(f=>JSON.stringify(Object.keys(f.properties))===JSON.stringify(['county','direction','amount','color','radius_px']))`),'activity minimal scalar map properties');
  await p.eval(`${H}.map.jumpTo(${JSON.stringify(camera)});true`);await settle();
  for(const scaling of ['log','linear','sqrt','quantile','natural'])for(let bins=3;bins<=10;bins++){
   await change('activity-scaling',scaling);await p.eval(`document.getElementById('activity-bins').value='${bins}';document.getElementById('activity-bins').dispatchEvent(new Event('change',{bubbles:true}))`);await settle();
   const actual=await values(),r=ref.cases['full/'+scaling+'/'+bins],expected=(Array.isArray(r.data)?r.data:[r.data]).map(x=>[x.county,x.direction,x.lat,x.lon,x.total_animals,x.radius_px]);
   check(actual.length===expected.length&&actual.every((v,i)=>v.every((x,k)=>typeof x==='number'?Math.abs(x-expected[i][k])<1e-7:x===expected[i][k])),'module activity values/radii/anchors '+scaling+'/'+bins);
   check(await p.eval(`${H}.drawn.length===${S}.activityData.length&&${H}.drawn.every(f=>f.properties.color===CVIWA.palettes.circleColor(${A}.palette,f.properties.direction))`),'actual map circles/palette '+scaling+'/'+bins);
  }
  await change('activity-scaling','log');await change('activity-bins','5');
  const palettes=await p.eval('Object.keys(CVIWA.palettes.DIRECTION_PALETTES)');for(const palette of palettes){await change('activity-palette',palette);check(await p.eval(`${H}.drawn.every(f=>f.properties.color===CVIWA.palettes.circleColor(${JSON.stringify(palette)},f.properties.direction))`),'local palette '+palette);}
  await change('activity-palette','WSDA Default');
  const baseline=await values();await pick('facility-counties',['King']);await pick('infrastructure-refine-5-0',['Storage']);check(JSON.stringify(await values())===JSON.stringify(baseline),'facility county/refine do not filter activity');
  check(JSON.stringify(await p.eval(`CVIWA.map.camera(${H})`))===JSON.stringify(camera),'light/facility/style filters preserve camera');
  // "Refine by species" lists the species of every ticked group, as CVI's mod_maps.R (it once needed exactly one group).
  const rawShown=()=>p.eval("[...document.getElementById('activity-raw').querySelectorAll('input')].map(o=>o.value)");
  let shown=await rawShown();
  check(await p.eval(`${A}.species.length`)===6&&shown.includes('Dairy cattle')&&shown.includes('Chickens')&&shown.includes('Goats')
    &&await p.eval(`!document.getElementById('activity-raw').disabled`),'every ticked group lists its species',shown);
  await pick('activity-species',['Cattle','Poultry']);shown=await rawShown();
  check(shown.includes('Dairy cattle')&&shown.includes('Chickens')&&!shown.includes('Goats'),'two ticked groups list both groups species',shown);
  const facilityCounts=await p.eval(S+'.result.counts');await pick('activity-species',['Cattle']);check(await p.eval(`!document.getElementById('activity-raw').disabled`),'one group enables raw refine');const raw=await p.eval("[...document.getElementById('activity-raw').querySelectorAll('input')].map(o=>o.value)");await pick('activity-raw',[raw[0]]);check(JSON.stringify(await p.eval(S+'.result.counts'))===JSON.stringify(facilityCounts),'CVI raw refine does not filter facilities');
  await pick('activity-years',[]);check(await p.eval(`${S}.activityData.length===0&&!document.getElementById('activity-status').hidden`),'zero CVI activity has reason');await load([sample,tier('partner')]);check(await p.eval(`${S}.master&&!${S}.master.hasSpecies&&document.getElementById('activity-raw').disabled&&${S}.result.layers.length===6`),'reduced master gates raw only');
  // Reset restores light defaults while preserving camera/folds and never reruns initial layer selection.
  await p.eval("document.getElementById('activity-fold').open=true;document.getElementById('style-fold').open=true");
  // Sidebar laid out as the CVI page: controls clear of their section titles, Reset All
  // full width between CVI Activity and Map Style, Fit to Washington full width.
  check(await p.eval(`(()=>{const gap=(fold,el)=>el.getBoundingClientRect().top-document.querySelector('#'+fold+' > summary').getBoundingClientRect().bottom;
    const reset=document.getElementById('reset-all'),activity=document.getElementById('activity-fold'),style=document.getElementById('style-fold');
    return gap('activity-fold',document.getElementById('activity-on').closest('label'))>=8&&gap('facility-fold',document.querySelector('#facility-fold .ctl-row'))>=8
      &&!!(activity.compareDocumentPosition(reset)&Node.DOCUMENT_POSITION_FOLLOWING)&&!!(reset.compareDocumentPosition(style)&Node.DOCUMENT_POSITION_FOLLOWING)
      &&Math.abs(reset.getBoundingClientRect().width-activity.getBoundingClientRect().width)<2
      &&Math.abs(document.getElementById('fit-wa').getBoundingClientRect().width-document.getElementById('infra-basemap').getBoundingClientRect().width)<2;})()`),'sidebar spacing and full-width buttons as the CVI page');
  await click('#reset-all');await settle();
  check(await p.eval(`${S}.selectedLayers.length===0&&${S}.counties.length===0&&!${A}.on&&Object.keys(${S}.attributes).length===0&&document.getElementById('activity-fold').open&&document.getElementById('style-fold').open`),'local reset clears picks/toggle and preserves folds');
  check(JSON.stringify(await p.eval(`CVIWA.map.camera(${H})`))===JSON.stringify(camera),'local Reset All preserves camera');
  await load([sample,tier('public')]);check(await p.eval(`${S}.selectedLayers.length===0&&${S}.master.hasSpecies`),'replacement does not repeat initial selection; Public master works');
  await p.eval(`WSDA.infrastructure.reset();${S}.selectedLayers=${S}.prepared.layers.filter(l=>l.usable).map(l=>l.key);${A}.on=true;WSDA.infrastructure.redraw()`);await settle();
  check(await p.eval(`${S}.activityData.length>0&&${S}.result.layers.length===6`),'Public movement and facility subset operate');
  // Same physical size, changed category values: rebuild raw choices and explain invalid picks.
  const original=fs.readFileSync(tier('full'),'utf8'),replacement=original.replaceAll('Dairy cattle','Other cattle'),replace=path.join(fixtures,'CVI_Consolidated_Master.csv');fs.writeFileSync(replace,replacement);
  await load([sample,tier('full')]);await pick('activity-species',['Cattle']);await pick('activity-raw',['Dairy cattle']);await load([sample,replace]);
  check(await p.eval(`${A}.rawSpecies.length===0&&document.getElementById('activity-reason').textContent.includes('Cleared')`),'same-size master replacement clears obsolete raw refine');
  const bad=path.join(fixtures,'bad_master.csv');fs.writeFileSync(bad,'Species.Group,Reporting.Year\nCattle,2026\n');await load([sample,bad]);check(await p.eval(`!${S}.master&&document.getElementById('activity-on').disabled&&${S}.result.layers.length===6`),'failed/missing master leaves facilities intact');
  await load([sample,tier('full')]);await p.eval(`${A}.on=true;document.getElementById('activity-on').checked=true;WSDA.infrastructure.redraw()`);await settle();
  check(await p.eval(`(()=>{const s=${S},a=WSDA.facilities.select(s.prepared,{layers:['synthetic_support'],geometry:p=>p.lat<47.605}),b=WSDA.facilities.select(s.prepared,{layers:['synthetic_support'],geometry:p=>p.lat>47.605});return a.counts.synthetic_support===1&&b.counts.synthetic_support===1&&a.rowIds[0]!==b.rowIds[0]&&WSDA.facilityDetails.element(a.layers[0],a.layers[0].points[0]).textContent.includes('Service: Transport')})()`),'synthetic future consumer geometry/count/details contract');
  await click('#style-fold summary'); // open if replacement/reset kept it closed, explicit below
  await p.eval("document.getElementById('style-fold').open=true");
  for(const region of ['bc','id','or']){await click('.nr-on[data-region="'+region+'"]');await p.waitFor(`${H}.nr.on.${region}`);check(await p.eval(`CVIWA.map.landColor(${H})==='#ffffff'`),'neighbor WA-white rule '+region);await click('.nr-counties[data-region="'+region+'"]');check(await p.eval(`${H}.nr.counties.${region}`),'neighbor counties '+region);}
  check((await p.eval(`CVIWA.map.attributionText(${H})`)).includes('Statistics Canada'),'BC credit');
  const download=path.join(OUT,'download_'+mode);fs.mkdirSync(download,{recursive:true});await b.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:download});await click('.map-screenshot');await p.waitFor(`${H}.lastScreenshot&&${H}.lastScreenshot.bytes>0`);check(await p.eval(`${H}.lastAttribution.includes('Statistics Canada')&&document.getElementById('screenshot-status').textContent.includes('Downloads')`),'screenshot saves with neighbor credit/message');
  await p.eval(`${H}.failed=true;true`);await click('.map-screenshot');check(await p.eval("document.getElementById('screenshot-status').textContent.includes('Screenshot not saved')"),'screenshot failure explanation');await p.eval(`${H}.failed=false;true`);
  const neighborCamera=await p.eval(`CVIWA.map.camera(${H})`);await click('.nr-on[data-region="or"]');check(await p.eval(`!${H}.nr.on.or&&!${H}.nr.counties.or&&document.querySelector('.nr-on[data-region="or"]').closest('div').querySelector('.nr-sub').hidden`),'region off clears/hides county switch');check(JSON.stringify(await p.eval(`CVIWA.map.camera(${H})`))===JSON.stringify(neighborCamera),'neighbor switch preserves camera');
  const camera2=await p.eval(`CVIWA.map.camera(${H})`),circles2=await values();
  await b.send('Fetch.enable',{patterns:[{urlPattern:'https://*',requestStage:'Request'}]},p.sid);
  const providers=await p.eval('CVIWA.basemaps.LIST');for(const entry of providers){currentProvider=entry;const start=provider.length;await change('infra-basemap',entry.id);if(entry.id==='wsdot')await p.eval(`${H}.map.jumpTo({zoom:8});true`);await settle();
   const seen=provider.slice(start);check(seen.every(r=>entry.hosts.includes(new URL(r.url).hostname)),'opt-in own provider hosts '+entry.id);
   check(await p.eval(`${S}.result.layers.length===6&&${H}.drawn.length===${S}.activityData.length&&!${H}.failed`),'restored facilities/activity '+entry.id);
   check(await p.eval(`document.querySelector('.maplibregl-ctrl-attrib').classList.contains('maplibregl-compact-show')`),'provider credit open '+entry.id);
  }
  currentProvider=providers.find(e=>e.id==='usgs-imagery');await change('infra-basemap',currentProvider.id);check(await p.eval(`${S}.activityLegend.swatches.every(s=>s.land===null&&s.shown===s.color.toLowerCase())`),'dark legend swatches full strength');
  await click('.map-screenshot');check(await p.eval(`${H}.lastAttribution.includes('USGS')`),'tile screenshot includes provider credit');
  await change('label-style','light');await change('boundary-style','dark');check(await p.eval(`${H}.contrast.label==='#f0f0f0'`),'explicit contrast label');
  providerMode='down';currentProvider=providers.find(e=>e.id==='ofm-dark');await change('infra-basemap',currentProvider.id);await p.waitFor(`${H}.basemapFailed`);await settle();check(await p.eval(`!document.getElementById('basemap-status').hidden&&${S}.activityLegend.swatches.every(s=>s.land==='#ffffff')`),'failure isolated with offline neighbor land legend');await click('#offline-back');await settle();
  await p.eval(`${H}.map.jumpTo({center:[-120.7,47.3],zoom:8,pitch:20,bearing:5});true`);await settle();await click('.map-fit');await settle();const opening=await p.eval(`CVIWA.map.camera(${H})`);await p.eval(`${H}.map.jumpTo({center:[-122,47],zoom:9});true`);await click('#fit-wa');await settle();check(JSON.stringify(await p.eval(`CVIWA.map.camera(${H})`))===JSON.stringify(opening),'both fits use opening WA extent');
  for(const [width,height]of [[1366,768],[1024,600]]){await b.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false},p.sid);await sleep(150);await settle();check(await p.eval(`(()=>{const m=document.getElementById('facility-map').getBoundingClientRect(),l=document.getElementById('facility-legend').getBoundingClientRect();return l.x>=m.x&&l.right<=m.right&&l.y>=m.y&&l.bottom<=m.bottom})()`),'activity legend containment '+width);await shot('activity_'+width);}
  const cviTab=await b.newTab(new URL('cvi/index.html',SITE_BASE).href),cp=cviTab.page;
  // Wait until the new tab's page has finished loading (and its map is ready) before setting its file: setting it while
  // the document is still being replaced failed now and then with "Could not find node with given id".
  await cp.waitFor("document.readyState==='complete'&&window.CVIWA&&CVIWA.state&&CVIWA.state.mapHandle&&CVIWA.state.mapHandle.ready");await cp.setFiles('#file-input',[tier('full')]);await cp.waitFor('CVIWA.state.master&&!CVIWA.state.loading');
  const cviBefore=await cp.eval('JSON.stringify([CVIWA.state.species,CVIWA.state.years,CVIWA.state.quarters,CVIWA.state.palette,CVIWA.state.version])');await p.front();
  const beforeReset=await p.eval(`CVIWA.map.camera(${H})`);await click('#reset-all');await settle();check(await p.eval(`!${A}.on&&${S}.basemap===''&&Object.values(${S}.neighbors).every(s=>!s.on&&!s.counties)&&${S}.selectedLayers.length===0`),'complete local reset clears styles/neighbors/activity/layers');check(JSON.stringify(await p.eval(`CVIWA.map.camera(${H})`))===JSON.stringify(beforeReset),'reset keeps tilted/current camera');
  check(await cp.eval('JSON.stringify([CVIWA.state.species,CVIWA.state.years,CVIWA.state.quarters,CVIWA.state.palette,CVIWA.state.version])')===cviBefore,'Infrastructure reset leaves separate CVI files/light filters/palette unchanged');await b.closeTab(cviTab.targetId);await p.front();
  await p.eval(`window.__regionLoad=WSDA.regions.load;window.__regionRejects=[];WSDA.regions.load=()=>new Promise((resolve,reject)=>__regionRejects.push(reject));true`);
  await click('.nr-on[data-region="bc"]');await click('#reset-all');await settle();await click('.nr-on[data-region="bc"]');await click('.nr-counties[data-region="bc"]');await p.eval(`__regionRejects[0](new Error('Synthetic boundary file failure'));true`);await p.waitFor(`!${S}.neighbors.bc.on`);
  check(await p.eval(`!${S}.neighbors.bc.counties&&!document.querySelector('.nr-counties[data-region="bc"]').checked&&!document.getElementById('neighbor-status').hidden`),'delayed neighbor failure updates current state after reset');
  check(await p.eval(`!${H}.failed&&document.getElementById('neighbor-status').textContent.includes('rest of the map is unaffected')`),'neighbor failure isolated/explained');await p.eval(`__regionRejects[1](new Error('Synthetic boundary file failure'));WSDA.regions.load=__regionLoad;true`);
  await load([sample]);check(await p.eval(`${S}.selectedLayers.length===0`),'reload after reset does not reselect initial layers');
  const zero=path.join(fixtures,'empty_master.csv');fs.writeFileSync(zero,original.split('\n')[0]+'\n');await load([sample,zero]);await click('#activity-on');await settle();check(await p.eval(`${S}.master&&${S}.activityData.length===0&&!document.getElementById('activity-status').hidden`),'header-only zero master has local activity explanation');
  for(const [tierName,count]of [['full',7],['partner',2],['public',0]]){await load([path.join(ROOT,'local-test-artifacts/f1/tiers',tierName+'.zip')]);check(await p.eval(`${S}.master&&${S}.prepared.layers.filter(l=>l.usable).length===${count}`),'actual '+tierName+' tier subset in Infrastructure');await p.eval(`${A}.on=true;${A}.species=${S}.master.speciesChoices.slice();${A}.years=${S}.master.yearChoices.slice();WSDA.infrastructure.redraw();true`);await settle();check(await p.eval(`${S}.activityData.length>0&&${H}.drawn.length===${S}.activityData.length`),'actual '+tierName+' tier activity works');}
  await load([tier('full'),...['usda_wa_slaughter_facilities.csv','wa_state_fairs.csv','wa_state_public_livestock_markets.csv','wa_state_feedlots.csv','wa_state_restricted_holding_facilities.csv'].map(n=>path.join(ROOT,'local-test-artifacts/s6/day5/infrastructure/fixtures',n))]);
  await p.eval(`${S}.selectedLayers=${S}.prepared.layers.filter(l=>l.usable).map(l=>l.key);${A}.on=true;WSDA.infrastructure.redraw()`);await settle();
  const timings=[];out.timings=timings;
  for(const county of ['Pierce','King','']){const samples=[];for(let i=0;i<3;i++){const start=Date.now();await pick('facility-counties',county?[county]:[]);samples.push(Date.now()-start);check(await p.eval(`Object.values(${S}.result.counts).every(n=>n===${county?1000:2000})&&${H}.facilityLayers.every((l,i)=>${H}.map.getStyle().sources[WSDA.facilitymap.SRC(i)].data.features.length===l.count)`),'activity+dense county map/count '+county+'/'+i);}const median=samples.sort((a,b)=>a-b)[1];timings.push({county,samples,median});check(median<=5000,'activity+dense settled redraw <=5s '+county,median);if(median>5000)throw new Error('STOP: settled redraw target missed');}
  const denseCircle=await values();for(const value of ['Alpha','Beta','']){const samples=[];for(let i=0;i<3;i++){const start=Date.now();await pick('infrastructure-refine-3-0',value?[value]:[]);samples.push(Date.now()-start);check(await p.eval(`${S}.result.counts.feedlots===${value?1000:2000}`),'activity+dense attribute count '+value+'/'+i);check(JSON.stringify(await values())===JSON.stringify(denseCircle),'dense facility refine leaves activity unchanged '+value+'/'+i);}const median=samples.sort((a,b)=>a-b)[1];timings.push({attribute:value,samples,median});check(median<=5000,'activity+dense attribute redraw <=5s '+value,median);if(median>5000)throw new Error('STOP: settled redraw target missed');}
  check(!b.log.exceptions.length&&!b.log.csp.length,'no exceptions/CSP',b.log);check(provider.every(r=>providers.some(e=>e.hosts.includes(new URL(r.url).hostname))),'only listed providers intercepted');
 }catch(e){check(false,'complete activity suite',e.stack);}finally{clearTimeout(timer);Object.assign(out,{passed,failed,failures,provider,network:b.log,finished:new Date().toISOString()});fs.writeFileSync(path.join(OUT,'browser_'+mode+'.json'),JSON.stringify(out,null,2)+'\n');await b.close();}
 failures.forEach(f=>console.error('FAIL '+f.name+' '+JSON.stringify(f.detail)));console.log(`S6 activity Chrome: ${passed} passed, ${failed} failed`);process.exitCode=failed?1:0;
}
if(process.argv.includes('--activity'))activityPage().catch(e=>{console.error(e.stack);process.exitCode=2;});
