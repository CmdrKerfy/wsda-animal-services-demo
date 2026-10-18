#!/usr/bin/env node
'use strict';
// S2a browser test: opens site/cvi/index.html over file:// in the installed Google Chrome (headless, throw-away
// profile), loads synthetic masters through the real file input and checks the S2a features on the page against
// CVI's own WA map module (local-test-artifacts/s2/oracle_s2_*.json, written by tests/oracle/cvi_r_oracle.R):
// value boxes and summary strip as drawn (with the help text on the two animals numbers), picks kept in pick order, the
// county spotlight as rendered (CVI's circles_dim / circles_spotlight layers), Reset All Filters (spotlight cleared,
// by design; county lines kept, as CVI), the screenshot (a PNG of the map's own pixels, saved through the
// browser's download), "Unique CVIs" grayed without a CVI column, and no request outside the site folder.
// S1.1: in Combined mode both Compare maps, their legends and their screenshots in the palette's first color.
// Usage (repository root): node tests/browser/run_s2_browser.js      (Node >= 22; Chrome installed; no packages)
// Optional: CHROME_BIN=<path to chrome>; S2_PAGE_URL=<another copy of the page, e.g. over local http>.
// Writes only local-test-artifacts/s2/browser_run.json, s2/download/ (the saved screenshot), s2/screens/ (pictures of
// the page in Browse and Compare, for review) and a temporary profile
// (deleted on exit).
const { spawn } = require('child_process');
const fs = require('fs'), path = require('path');
const { pathToFileURL, fileURLToPath } = require('url');
const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join(ROOT, 'local-test-artifacts', 's2');
const PAGE = process.env.S2_PAGE_URL || pathToFileURL(path.join(ROOT, 'site', 'cvi', 'index.html')).href;
const SITE_BASE = new URL('..', PAGE).href;
const PAGE_LABEL = /^file:/.test(PAGE) ? path.relative(ROOT, fileURLToPath(PAGE)).split(path.sep).join('/') + ' (file://)' : PAGE.split(/[?#]/)[0];
const FIX = f => path.join(ROOT, 'tests', 'synthetic', f);
const CHROME = process.env.CHROME_BIN || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  : process.platform === 'win32' ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : 'google-chrome');
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---- minimal DevTools Protocol driver -------------------------------------------------------------------------
async function launch() {
  fs.mkdirSync(OUT, { recursive: true });
  // profiles left by an earlier run that was stopped before its clean-up
  for (const d of fs.readdirSync(OUT)) if (d.startsWith('chrome-profile-')) fs.rmSync(path.join(OUT, d), { recursive: true, force: true });
  const profile = fs.mkdtempSync(path.join(OUT, 'chrome-profile-'));
  const proc = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + profile, '--no-first-run',
    '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', '--disable-component-update',
    '--disable-sync', '--window-size=1400,1000', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'], detached: true });
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
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId: sid } = await send('Target.attachToTarget', { targetId, flatten: true });
  const sessions = new Set([sid]);
  listeners.push(m => {
    if (m.method === 'Target.attachedToTarget' && sessions.has(m.sessionId)) {   // workers: capture before they run
      const s = m.params.sessionId; sessions.add(s);
      (async () => { try { await send('Network.enable', {}, s); await send('Runtime.enable', {}, s); await send('Log.enable', {}, s); await send('Runtime.runIfWaitingForDebugger', {}, s); } catch (e) { /* gone */ } })();
      return;
    }
    if (!sessions.has(m.sessionId)) return;
    if (m.method === 'Network.requestWillBeSent') log.requests.push(m.params.request.url);
    else if (m.method === 'Runtime.exceptionThrown') log.exceptions.push((m.params.exceptionDetails.exception || {}).description || m.params.exceptionDetails.text);
    else if (m.method === 'Log.entryAdded' && /content security policy|refused to/i.test(m.params.entry.text)) log.csp.push(m.params.entry.text);
  });
  for (const d of ['Network.enable', 'Runtime.enable', 'Log.enable', 'Page.enable', 'DOM.enable']) await send(d, {}, sid);
  await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, sid);
  await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false }, sid);
  const page = {
    async resize(width, height) { await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }, sid); },
    async beforeLoad(source) { return send('Page.addScriptToEvaluateOnNewDocument', { source }, sid); },
    async removeBeforeLoad(identifier) { await send('Page.removeScriptToEvaluateOnNewDocument', { identifier }, sid); },
    async goto(url) { const loaded = new Promise(res => { const h = m => { if (m.method === 'Page.loadEventFired' && m.sessionId === sid) { listeners.splice(listeners.indexOf(h), 1); res(); } }; listeners.push(h); }); await send('Page.navigate', { url }, sid); await Promise.race([loaded, sleep(15000)]); },
    async eval(expr) { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }, sid); if (r.exceptionDetails) throw new Error('eval: ' + ((r.exceptionDetails.exception || {}).description || r.exceptionDetails.text)); return r.result.value; },
    async waitFor(expr, ms, label) { const t0 = Date.now(); while (Date.now() - t0 < (ms || 15000)) { try { const v = await page.eval(expr); if (v) return v; } catch (e) { /* not ready */ } await sleep(60); } throw new Error('timeout: ' + (label || expr)); },
    async setFiles(sel, files) { const { root } = await send('DOM.getDocument', { depth: 1 }, sid); const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector: sel }, sid); await send('DOM.setFileInputFiles', { files, nodeId }, sid); },
    async mouse(x, y) { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }, sid); },
    async capture(file) { const r = await send('Page.captureScreenshot', { format: 'png' }, sid); fs.writeFileSync(file, Buffer.from(r.data, 'base64')); },
    async downloadsTo(dir) { await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dir }); }
  };
  return { version: ver.Browser, log, page, async close() { try { await send('Browser.close'); } catch (e) { /* closing */ } await exited(5000); killGroup(); await exited(2000); fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } };
}

// ---- checks ---------------------------------------------------------------------------------------------------
let pass = 0, fail = 0, nN17 = 0; const failures = [];
const check = (ok, name, detail) => { if (ok) pass++; else { fail++; failures.push(name + (detail !== undefined ? ' :: ' + JSON.stringify(detail).slice(0, 600) : '')); } };
const arr = x => x === null || x === undefined ? [] : Array.isArray(x) ? x : [x];
const oracle = n => JSON.parse(fs.readFileSync(path.join(OUT, 'oracle_s2_' + n + '.json'), 'utf8'));
const viewOf = (o, scenario, dir, mode) => o.views.find(v => v.scenario === scenario && arr(v.filters.direction).join('+') === dir && v.mode === mode);

// What the page shows in its value boxes and strip, read from the page itself (text as a browser shows it).
const SHOWN = `(function(){var t=function(e){return e?e.textContent.replace(/\\s+/g,' ').trim():null};
  var vb=document.getElementById('value-boxes'),sp=document.getElementById('summary-strip');
  var cards=[].map.call(vb.querySelectorAll('.metric'),function(c){return {label:t(c.querySelector('.metric-label')).replace(/\\s*\\?$/,''),
    value:t(c.querySelector('.metric-value')),zero:c.classList.contains('metric-zero'),gated:c.classList.contains('gated'),
    reason:t(c.querySelector('.metric-reason')),accent:c.querySelector('.metric-icon').style.backgroundColor,
    icon:(c.querySelector('.metric-icon svg')||{getAttribute:function(){return null}}).getAttribute('class')}});
  var alert=vb.querySelector('.vb-alert');
  var items=[].map.call(sp.querySelectorAll('.strip-items > div'),function(d){var s=d.querySelector('strong');return {label:s.textContent,text:t(d).slice(t(s).length).replace(/\\s*\\?$/,'').trim()}});
  var msg=sp.querySelector('.strip-msg');
  return {cards:cards,alert:alert?t(alert):null,alertIcon:alert&&alert.querySelector('svg')?alert.querySelector('svg').getAttribute('class'):null,
    items:items,message:msg?[].concat([t(msg.querySelector('p strong')||msg)],(msg.querySelector('.detail')?msg.querySelector('.detail').innerText.split('\\n').map(function(l){return l.replace(/\\s+/g,' ').trim()}):[])):null}})()`;
// The page's own summaries (summary.js, unit-checked against CVI with its deliberate difference in the total), for
// the "Total animals" box where that deliberate difference makes it differ from CVI.
const vm = require('vm'), SB = { window: {}, console };
vm.createContext(SB);
for (const f of ['csv.js', 'master.js', 'scaling.js', 'palettes.js', 'aggregate.js', 'summary.js', 'periods.js'])
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'site', 'cvi', 'app', f), 'utf8'), SB, { filename: f });
const PW = SB.window.CVIWA;
let pageModel = null;   // { loaded } of the file the page has
const modelTotal = v => pageModel ? PW.summary.valueBoxes(PW.summary.summary(pageModel, { species: arr(v.filters.species), years: arr(v.filters.years).map(Number),
  quarters: arr(v.filters.quarters), direction: arr(v.filters.direction), rawSpecies: arr(v.filters.raw_species), mode: v.mode })) : null;
const flat = x => String(x).replace(/\s+/g, ' ').trim();   // as a browser shows text
const hex2rgb = h => { const n = parseInt(h.slice(1), 16); return 'rgb(' + (n >> 16) + ', ' + ((n >> 8) & 255) + ', ' + (n & 255) + ')'; };

function compareShown(tag, shown, v) {
  const wvb = v.value_boxes, wst = v.strip;
  if (wvb.state === 'alert') check(shown.alert === arr(wvb.lines).join(' ') && shown.alertIcon === 'bi bi-' + wvb.icon + ' ' && !shown.cards.length, tag + ': alert as CVI', [shown.alert, wvb.lines]);
  else {
    const wm = arr(wvb.metrics), mine = modelTotal(v), t0 = mine && mine.metrics ? mine.metrics[0].text : null;
    check(shown.cards.length === 4 && shown.cards.every((c, i) => c.label === wm[i].label && c.icon === 'bi bi-' + wm[i].icon + ' '
      && c.accent === hex2rgb(wm[i].accent) && (c.gated || ((c.value === flat(wm[i].text) || (i === 0 && c.value === flat(t0))) && c.zero === wm[i].zero))),
      tag + ': four boxes as CVI (Total animals: as CVI, or the page total)', { page: shown.cards, cvi: wm, n17: t0 });
    if (shown.cards[0] && shown.cards[0].value !== flat(wm[0].text)) nN17++;
  }
  if (wst.state === 'summary') {
    const wi = arr(wst.items);
    check(shown.items.length === wi.length && shown.items.every((it, i) => it.label === wi[i].label && it.text === flat(wi[i].text)), tag + ': strip as CVI', { page: shown.items, cvi: wi });
  } else check(JSON.stringify(shown.message) === JSON.stringify(arr(wst.lines)), tag + ': strip message as CVI', { page: shown.message, cvi: wst.lines });
}

(async () => {
  const o = oracle('cvi_master_s2'), oPartner = oracle('tier_partner'), oFull = oracle('tier_full'), oPublic = oracle('tier_public');
  fs.mkdirSync(OUT, { recursive: true });
  const DL = path.join(OUT, 'download'); fs.rmSync(DL, { recursive: true, force: true }); fs.mkdirSync(DL, { recursive: true });
  const b = await launch(); const p = b.page;
  const run = { chrome: b.version, platform: process.platform, page: PAGE_LABEL, started: new Date().toISOString() };
  const version = () => p.eval('CVIWA.state.version');
  const settle = async v0 => { await p.waitFor('!CVIWA.state.loading && CVIWA.state.version > ' + v0, 8000, 'recompute'); await sleep(320); await p.waitFor('CVIWA.state.mapHandle.map.loaded()', 8000, 'map idle'); };
  // maybe: the action may change nothing (no redraw follows).
  const act = async (js, maybe) => { const v0 = await version(); await p.eval(js); if (maybe) { await sleep(450); if (await version() === v0) return; } await settle(v0); };
  const shown = () => p.eval(SHOWN);
  // Tick a list's values in the given order, starting from none (Clear), as a user would.
  const pick = async (key, id, values) => act(`(function(){document.querySelector('[data-clear="${key}"]').click();
    ${JSON.stringify(values.map(String))}.forEach(function(v){[].find.call(document.querySelectorAll('#${id} input'),function(c){return c.value===v}).click()})})()`);
  const setFilters = async f => {
    await pick('species', 'f-species', f.species); await pick('years', 'f-years', f.years); await pick('quarters', 'f-quarters', f.quarters);
    await act(`(function(){var want=${JSON.stringify(f.direction)};document.querySelectorAll('input[name=direction]').forEach(function(c){if(c.checked!==(want.indexOf(c.value)>=0))c.click()});
      var m=document.querySelector('input[name=mode][value=${f.mode}]');if(!m.checked)m.click();})()`, true);
  };
  try {
    // 1. Before any data: CVI's alert, the strip's prompt, the spotlight grayed, the controls present.
    await p.goto(PAGE);
    await p.waitFor('window.CVIWA && CVIWA.state && CVIWA.state.version >= 1 && CVIWA.state.mapHandle.ready', 20000, 'map ready');
    let s = await shown();
    check(s.alert === 'Load a master and apply filters to see summary metrics.' && s.alertIcon === 'bi bi-info-circle ' && !s.cards.length, 'no data: CVI\'s value-box alert with its icon', s);
    check(JSON.stringify(s.message) === JSON.stringify(['Load a master dataset.']), 'no data: strip asks for a master', s.message);
    check(await p.eval(`(function(){var g=document.querySelector('[data-feature="spotlight"]');return g.classList.contains('gated')&&document.querySelectorAll('#f-spotlight input').length===0&&/Needs the CVI master table/.test(g.querySelector('[data-gate-reason]').textContent)})()`),
      'no data: spotlight grayed with the reason');
    check(await p.eval(`(function(){var b=document.querySelector('.maplibregl-ctrl-top-right button.map-screenshot');return !!b&&b.title==='Capture screenshot'&&b.getAttribute('aria-label')==='Capture screenshot'&&!!b.querySelector('svg')})()`),
      'screenshot button at the top right, titled as CVI\'s');
    // One Reset All name on every dashboard: "Reset All" in place of CVI's "Reset All Filters".
    check(await p.eval(`(function(){var b=document.getElementById('reset-all');return b.textContent.trim()==='Reset All'&&!!b.querySelector('svg.bi-arrow-counterclockwise')})()`), 'Reset All button with CVI\'s icon');
    {
      const f0 = await p.eval(`(function(){var r={};['species','spotlight','speciesB'].forEach(function(k){var b=document.querySelector('[data-fold-sum="'+k+'"]').parentNode,l=document.getElementById(b.getAttribute('aria-controls'));
      r[k]={label:b.firstChild.textContent,exp:b.getAttribute('aria-expanded'),hidden:l.hidden,sum:b.lastChild.textContent,disabled:b.disabled,group:l.getAttribute('aria-label')}});return r})()`);
      check(f0.species.hidden && f0.species.sum === '' && f0.spotlight.hidden && f0.spotlight.sum === '' && f0.spotlight.disabled, 'no data: Species Group and Spotlight Counties closed, empty headers, spotlight not openable', f0);
    }
    // Fit button on the map: just under the zoom buttons, the same camera as the Map Style "Fit to Washington" button:
    // the opening view for the map's size.
    const fb0 = await p.eval(`(function(){var b=document.querySelector('#map .maplibregl-ctrl-top-left button.map-fit'),z=document.querySelector('#map .maplibregl-ctrl-top-left .maplibregl-ctrl-zoom-out');
      if(!b||!z)return {found:false};var rb=b.getBoundingClientRect(),rz=z.getBoundingClientRect();
      return {found:true,title:b.title,aria:b.getAttribute('aria-label'),icon:!!b.querySelector('svg.bi-house'),gap:rb.top-rz.bottom,dx:rb.left-rz.left}})()`);
    check(fb0.found && fb0.title === 'Fit to Washington' && fb0.aria === 'Fit to Washington' && fb0.icon && Math.abs(fb0.gap) < 1 && Math.abs(fb0.dx) < 1,
      'fit button just under the zoom buttons, titled "Fit to Washington"', fb0);
    {
      const cam0 = await p.eval('(function(){var m=CVIWA.state.mapHandle.map;return {center:m.getCenter().toArray(),zoom:m.getZoom()}})()');
      const flyFit = async sel => {
        await p.eval('void CVIWA.state.mapHandle.map.jumpTo({center:[-100,40],zoom:3})');
        await p.eval(`document.querySelector(${JSON.stringify(sel)}).click()`);
        await sleep(100); await p.waitFor('!CVIWA.state.mapHandle.map.isMoving()', 8000, 'fly end');
        return p.eval(`(function(){var m=CVIWA.state.mapHandle.map,c=m.getCenter(),v=CVIWA.map.WA_VIEW_BOUNDS,w=m.cameraForBounds(v,{padding:24}),b=m.getBounds(),wc=w.center.lng!==undefined?w.center:{lng:w.center[0],lat:w.center[1]};
      return {lng:c.lng,lat:c.lat,zoom:m.getZoom(),want:[wc.lng,wc.lat,w.zoom],inside:b.getWest()<=v[0]+1e-6&&b.getEast()>=v[2]-1e-6&&b.getSouth()<=v[1]+1e-6&&b.getNorth()>=v[3]-1e-6}})()`);
      };
      const byMap = await flyFit('#map button.map-fit'), byStyle = await flyFit('#fit-wa');
      const near = (c, w) => Math.abs(c.lng - w[0]) < 1e-6 && Math.abs(c.lat - w[1]) < 1e-6 && Math.abs(c.zoom - w[2]) < 1e-6;
      check(byMap.inside && near(byMap, byMap.want) && near(byStyle, [byMap.lng, byMap.lat, byMap.zoom]),
        'fit button: the opening view, the same camera as Fit to Washington in Map Style', { byMap, byStyle });
      await p.eval(`void CVIWA.state.mapHandle.map.jumpTo(${JSON.stringify(cam0)})`);   // the later checks expect the opening view
    }
    // The spotlight "?" works before any data; clicking the words "Spotlight counties" does not toggle it.
    check(await p.eval(`(function(){var b=document.querySelector('button.tip[data-help="spotlight"]'),n=document.getElementById('help-spotlight'),t=b.parentNode;
      var r={disabled:b.disabled,controls:b.getAttribute('aria-controls'),tag:t.tagName};t.firstChild.parentNode.dispatchEvent(new MouseEvent('click',{bubbles:true}));r.afterText=n.hidden;
      b.click();r.afterButton=n.hidden;b.click();r.closed=n.hidden;return !r.disabled&&r.controls==='help-spotlight'&&r.tag!=='LABEL'&&r.afterText&&!r.afterButton&&r.closed})()`),
      'spotlight help "?": usable before data, opens only from the button');
    check(await p.eval(`document.getElementById('s-lines').checked&&CVIWA.state.lines&&CVIWA.state.mapHandle.map.getLayoutProperty('county-lines','visibility')==='visible'`),
      'county lines on by default (a deliberate difference; CVI starts with them off)');

    // 2. The S2 fixture: defaults, then CVI's scenarios, through the page's own controls.
    let v0 = await version();
    await p.setFiles('#file-input', [FIX('cvi_master_s2.csv')]);
    await settle(v0);
    pageModel = PW.master.load(fs.readFileSync(FIX('cvi_master_s2.csv'), 'utf8'));
    compareShown('S2 default', await shown(), viewOf(o, 'default', 'Inbound+Outbound', 'side_by_side'));
    const choices = await p.eval(`[].map.call(document.querySelectorAll('#f-spotlight input'),function(c){return c.value})`);
    check(JSON.stringify(choices) === JSON.stringify(arr(o.load.spotlight_choices)) && choices.indexOf('N/A') >= 0, 'spotlight choices as CVI (out-of-state "N/A" included), none ticked',
      [choices, o.load.spotlight_choices]);
    check(await p.eval('CVIWA.state.spotlight.length === 0 && !document.querySelector("[data-feature=spotlight]").classList.contains("gated")'), 'spotlight available, nothing picked on load');
    // Species Group and Spotlight Counties fold, closed on load, the header saying what is ticked.
    {
      const fold = () => p.eval(`(function(){var r={};['species','spotlight','speciesB'].forEach(function(k){var b=document.querySelector('[data-fold-sum="'+k+'"]').parentNode,l=document.getElementById(b.getAttribute('aria-controls'));
      r[k]={label:b.firstChild.textContent,exp:b.getAttribute('aria-expanded'),hidden:l.hidden,sum:b.lastChild.textContent,disabled:b.disabled,group:l.getAttribute('aria-label')}});return r})()`);
      const nSp = await p.eval('CVIWA.state.master.speciesChoices.length'), allSp = await p.eval('CVIWA.state.species.length === CVIWA.state.master.speciesChoices.length');
      let f = await fold();
      check(allSp && f.species.exp === 'false' && f.species.hidden && f.species.sum === 'all ' + nSp && f.spotlight.exp === 'false' && f.spotlight.hidden && f.spotlight.sum === 'none'
        && !f.spotlight.disabled && f.speciesB.hidden && f.spotlight.label === 'Spotlight Counties' && f.spotlight.group === 'Spotlight Counties' && f.species.label === 'Species Group',
        'after loading: Species Group and Spotlight Counties closed, headers "all ' + nSp + '" and "none"', f);
      await p.eval(`document.querySelector('[aria-controls="f-species"]').click()`); const o1 = await fold();
      await p.eval(`document.querySelector('[aria-controls="f-species"]').click()`); const o2 = await fold();
      check(o1.species.exp === 'true' && !o1.species.hidden && o2.species.exp === 'false' && o2.species.hidden, 'Species Group opens and closes from its header', [o1.species, o2.species]);
      await act(`document.querySelector('[data-clear="species"]').click()`, true); const c1 = await fold();
      await act(`document.querySelector('[data-all="species"]').click()`, true); const c2 = await fold();
      await act(`(function(){var c=document.querySelector('#f-spotlight input[value="King"]');c.click()})()`, true); const c3 = await fold();
      await act(`document.querySelector('[data-clear="spotlight"]').click()`, true); const c4 = await fold();
      check(c1.species.sum === 'none (map empty)' && c2.species.sum === 'all ' + nSp && c3.spotlight.sum === 'King' && c4.spotlight.sum === 'none' && c4.species.hidden && c4.spotlight.hidden,
        'closed lists: All and Clear work from the header, which follows the ticks', [c1.species.sum, c2.species.sum, c3.spotlight.sum, c4.spotlight.sum]);
      await act(`(function(){var c=document.querySelector('#f-species input');c.click()})()`, true);
      const c5 = await fold(), t5 = await p.eval(`[].filter.call(document.querySelectorAll('#f-species input'),function(c){return c.checked}).map(function(c){return c.value})`);
      const want5 = t5.length <= 3 ? t5.join(', ') : t5.length + ' of ' + nSp + ' groups';
      check(t5.length === nSp - 1 && c5.species.sum === want5, 'Species Group header with some groups ticked', [c5.species.sum, want5]);
      await p.eval(`document.querySelector('[aria-controls="f-spotlight"]').click()`);
      await act(`document.getElementById('reset-all').click()`, true); const r1 = await fold();
      check(r1.spotlight.exp === 'true' && !r1.spotlight.hidden && r1.species.hidden && r1.species.sum === 'all ' + nSp, 'Reset All leaves the lists open or closed as they were', r1);
      await p.eval(`document.querySelector('[aria-controls="f-spotlight"]').click()`);
    }
    const scen = ['cattle', 'cattle_raw', 'y_first', 'q2_q3', 'two_groups', 'zero_2023_q2', 'swine_2026_q1', 'no_quarters', 'group_Poultry', 'year_2026', 'quarter_Q4'];
    let nScen = 0;
    for (const sn of scen) for (const [dir, mode] of [['Inbound+Outbound', 'side_by_side'], ['Inbound', 'total'], ['Outbound', 'side_by_side']]) {
      const v = viewOf(o, sn, dir, mode);
      if (!v) { check(false, 'oracle view ' + sn + ' ' + dir + ' ' + mode); continue; }
      await setFilters({ species: arr(v.filters.species), years: arr(v.filters.years), quarters: arr(v.filters.quarters), direction: dir.split('+'), mode });
      const raw = arr(v.filters.raw_species);
      await act(`(function(){var d=document.querySelector('[data-feature="species-refine"] details');d.open=true;var want=${JSON.stringify(raw)};
        document.querySelectorAll('#f-species-sub input').forEach(function(c){if(c.checked!==(want.indexOf(c.value)>=0))c.click()});})()`, true);
      compareShown('S2 ' + sn + ' ' + dir + ' ' + mode, await shown(), v); nScen++;
    }
    run.scenarios_compared = nScen;

    // 3. Picks are kept in pick order (CVI's pickers): the no-match message lists them that way.
    await setFilters({ species: ['Swine', 'Cattle'], years: [2026, 2023], quarters: [], direction: ['Inbound', 'Outbound'], mode: 'side_by_side' });
    s = await shown();
    check(s.message && s.message[2] === 'Years: 2026, 2023' && s.message[5] === 'Species: Swine, Cattle' && s.message[3] === 'Quarters:', 'no match: years and species listed in pick order, as CVI', s.message);
    check(await p.eval('JSON.stringify(CVIWA.state.years)') === '[2026,2023]', 'page keeps years in pick order');

    // 4. Help text for the two animals numbers: title on hover, a line of text on click.
    await setFilters({ species: await p.eval('CVIWA.state.master.speciesChoices'), years: await p.eval('CVIWA.state.master.yearChoices'), quarters: ['Q1', 'Q2', 'Q3', 'Q4'], direction: ['Inbound', 'Outbound'], mode: 'side_by_side' });
    const help = await p.eval(`(function(){var a=document.querySelector('#value-boxes button.tip[data-help="total"]'),b=document.querySelector('#summary-strip button.tip[data-help="strip-animals"]');
      var r={a:a&&a.title,b:b&&b.title,beforeA:document.getElementById('help-total').hidden,beforeB:document.getElementById('help-strip-animals').hidden};
      a.click();b.click();r.afterA=document.getElementById('help-total').hidden;r.afterB=document.getElementById('help-strip-animals').hidden;
      r.textA=document.getElementById('help-total').textContent;r.textB=document.getElementById('help-strip-animals').textContent;r.exp=a.getAttribute('aria-expanded');
      a.click();b.click();r.closed=document.getElementById('help-total').hidden&&document.getElementById('help-strip-animals').hidden;return r})()`);
    const HT = await p.eval('CVIWA.summary.HELP_TOTAL'), HS = await p.eval('CVIWA.summary.HELP_STRIP');
    check(help.a === HT && help.b === HS && help.beforeA && help.beforeB && !help.afterA && !help.afterB && help.textA === HT && help.textB === HS && help.exp === 'true' && help.closed,
      'help text on "Total animals" and the strip\'s "Animals": hover title, shown and hidden on click', help);
    check(/counts once/.test(HT) && /cannot place/.test(HT) && /both of its counties/.test(HS) && /can also be less/.test(HS) && /one higher/.test(HS),
      'help text says why the two numbers differ, both ways, and why the counties can differ', [HT, HS]);
    check(await p.eval(`document.querySelector('#value-boxes button.tip[data-help="total"]').getAttribute('aria-controls')==='help-total'&&document.querySelector('#summary-strip button.tip[data-help="strip-animals"]').getAttribute('aria-controls')==='help-strip-animals'`),
      'help "?" buttons name the line they open');

    // 5. Spotlight, as CVI's map builder splits it (oracle s2_spotlight), rendered.
    const spot = o.spotlight.find(x => x.pick === 'king' && arr(x.direction).join('+') === 'Inbound+Outbound' && x.mode === 'side_by_side' && x.opacity === 0.6);
    await pick('spotlight', 'f-spotlight', ['King']);
    const L = await p.eval(`(function(){var m=CVIWA.state.mapHandle.map,q=function(l){return m.queryRenderedFeatures({layers:[l]}).map(function(f){return f.properties.county+'/'+f.properties.direction}).sort()};
      var s=CVIWA.state.mapHandle.layers,n=function(a){return a.map(function(f){return f.properties.county+'/'+f.properties.direction+'/'+f.properties.radius_px})};
      return {all:q('circles'),dim:q('circles_dim'),spot:q('circles_spotlight'),src:{dim:n(s.circles_dim),spot:n(s.circles_spotlight),all:s.circles.length},
        opDim:m.getPaintProperty('circles_dim','circle-opacity'),opSpot:JSON.stringify(m.getPaintProperty('circles_spotlight','circle-opacity')),
        order:m.getStyle().layers.map(function(l){return l.id}).filter(function(i){return /^circles/.test(i)})}})()`);
    const wantL = id => arr((arr(spot.layers).find(l => l.id === id) || {}).circles).map(c => c.county + '/' + c.direction + '/' + c.radius_px);
    check(spot && L.src.all === 0 && JSON.stringify(L.src.dim) === JSON.stringify(wantL('circles_dim')) && JSON.stringify(L.src.spot) === JSON.stringify(wantL('circles_spotlight')),
      'spotlight King: dimmed and spotlit circles, in drawing order, as CVI\'s builder', { page: L.src, cvi: [wantL('circles_dim'), wantL('circles_spotlight')] });
    check(L.all.length === 0 && L.spot.length === wantL('circles_spotlight').length && L.spot.length > 0 && L.spot.every(x => /^King\//.test(x)) && L.dim.length > 0 && L.dim.every(x => !/^King\//.test(x)), 'spotlight King: rendered as two layers', L);
    check(L.opDim === 0.1 && L.opSpot === JSON.stringify(['case', ['boolean', ['feature-state', 'hover'], false], 0.85, 0.6]) && L.order.join() === 'circles,circles_dim,circles_spotlight',
      'spotlight opacities (others 10%, picked 60% with hover 85%) and layer order', L);
    // Hover: a dimmed circle shows its pop-up and stays at 10%; a spotlit one is marked hovered.
    const hov = async (county, dir) => {
      const pt = await p.eval(`(function(){var m=CVIWA.state.mapHandle.map,d=CVIWA.state.data.find(function(x){return x.county===${JSON.stringify(county)}&&x.direction===${JSON.stringify(dir)}});var q=m.project([d.lon,d.lat]);var r=m.getContainer().getBoundingClientRect();return {x:q.x+r.left,y:q.y+r.top}})()`);
      await p.mouse(pt.x, pt.y); await sleep(250);
      return p.eval(`(function(){var h=CVIWA.state.mapHandle.hover,m=CVIWA.state.mapHandle.map,pp=document.querySelector('.maplibregl-popup-content');
        var f=h&&m.queryRenderedFeatures({layers:[h.source==='circles_source_dim'?'circles_dim':'circles_spotlight']}).find(function(x){return x.id===h.id});
        return {src:h&&h.source,pop:pp?pp.textContent:null,opacity:f?m.getPaintProperty(f.layer.id,'circle-opacity'):null,state:f?m.getFeatureState({source:h.source,id:h.id}).hover:null}})()`);
    };
    const hk = await hov('King', 'Inbound'), hs = await hov('Spokane', 'Outbound');
    check(hk.src === 'circles_source_spot' && /^King/.test(hk.pop), 'hover over a spotlit circle: its pop-up, hover state on the spotlight layer', hk);
    check(hs.src === 'circles_source_dim' && /^Spokane/.test(hs.pop) && hs.opacity === 0.1 && hs.state === true, 'hover over a dimmed circle: its pop-up, opacity stays 10% (a fixed value, no hover rule)', hs);
    await p.mouse(5, 990); await sleep(150);
    // An out-of-state name and a pick with no circle: everything dimmed, as CVI.
    await pick('spotlight', 'f-spotlight', ['N/A']);
    const na = await p.eval('(function(){var s=CVIWA.state.mapHandle.layers;return [s.circles.length,s.circles_dim.length,s.circles_spotlight.length,CVIWA.state.data.length]})()');
    const wNa = o.spotlight.find(x => x.pick === 'out_of_state' && arr(x.direction).join('+') === 'Inbound+Outbound' && x.mode === 'side_by_side' && x.opacity === 0.6);
    check(na[0] === 0 && na[1] === arr((arr(wNa.layers).find(l => l.id === 'circles_dim') || {}).circles).length && na[2] === arr((arr(wNa.layers).find(l => l.id === 'circles_spotlight') || {}).circles).length,
      'spotlight "N/A": as CVI\'s builder', [na, arr(wNa.layers).map(l => [l.id, arr(l.circles).length])]);
    // Clear restores the single layer.
    await act(`document.querySelector('[data-clear="spotlight"]').click()`);
    check(await p.eval('(function(){var s=CVIWA.state.mapHandle.layers;return s.circles.length===CVIWA.state.data.length&&!s.circles_dim.length&&!s.circles_spotlight.length})()'), 'spotlight cleared: all circles in the usual layer');

    // 6. Reset All: change everything it covers (and county lines, which it keeps), then reset.
    await pick('spotlight', 'f-spotlight', ['King', 'Yakima']);
    await setFilters({ species: ['Cattle'], years: [2024], quarters: ['Q2'], direction: ['Inbound'], mode: 'total' });
    for (const [id, val] of [['s-scaling', 'quantile'], ['s-bins', '7'], ['s-opacity', '0.8'], ['s-palette', await p.eval(`document.querySelectorAll('#s-palette option')[2].value`)]])
      await act(`(function(){var s=document.getElementById('${id}');s.value='${val}';s.dispatchEvent(new Event('change',{bubbles:true}))})()`);
    await p.eval(`(function(){var a=document.getElementById('s-labels');a.click();var b=document.getElementById('s-lines');b.click();})()`);
    await act(`document.getElementById('reset-all').click()`);
    const R = await p.eval(`(function(){var s=CVIWA.state,v=function(i){return document.getElementById(i).value};return {st:{species:s.species,speciesSub:s.speciesSub,spotlight:s.spotlight,years:s.years,quarters:s.quarters,direction:s.direction,mode:s.mode,scaling:s.scaling,nBins:s.nBins,opacity:s.opacity,palette:s.palette,labels:s.labels},
      lines:s.lines,linesBox:document.getElementById('s-lines').checked,linesVis:s.mapHandle.map.getLayoutProperty('county-lines','visibility'),
      dom:{scaling:v('s-scaling'),bins:v('s-bins'),binsHidden:document.getElementById('bins-field').hidden,opacity:v('s-opacity'),palette:v('s-palette'),labels:document.getElementById('s-labels').checked,
        dir:[].filter.call(document.querySelectorAll('input[name=direction]'),function(c){return c.checked}).map(function(c){return c.value}),mode:document.querySelector('input[name=mode]:checked').value,
        spotTicked:document.querySelectorAll('#f-spotlight input:checked').length,quartersTicked:document.querySelectorAll('#f-quarters input:checked').length,yearsTicked:document.querySelectorAll('#f-years input:checked').length},
      labelsShown:document.querySelectorAll('.county-label:not(.hidden)').length,layers:[s.mapHandle.layers.circles.length,s.mapHandle.layers.circles_dim.length]}})()`);
    const want = await p.eval('CVIWA.summary.resetDefaults(CVIWA.state.master)');
    check(JSON.stringify(R.st) === JSON.stringify(want), 'Reset All: state equals CVI\'s defaults (unit-checked against CVI\'s reset messages), spotlight cleared', { page: R.st, want });
    check(R.dom.scaling === 'log' && R.dom.bins === '5' && R.dom.binsHidden && R.dom.opacity === '0.6' && R.dom.palette === 'WSDA Default' && R.dom.labels && R.dom.dir.join() === 'Inbound,Outbound'
      && R.dom.mode === 'side_by_side' && R.dom.spotTicked === 0 && R.dom.quartersTicked === 4 && R.dom.yearsTicked === 3 && R.labelsShown === 39, 'Reset All: the controls show the defaults; labels back on', R.dom);
    check(!R.lines && !R.linesBox && R.linesVis === 'none', 'Reset All keeps county lines as the user set them (turned off here; as CVI)', R);
    check(await p.eval('CVIWA.state.lastMessage') === 'All filters reset.', 'Reset All: CVI\'s message "All filters reset."');
    check(R.layers[0] > 0 && R.layers[1] === 0, 'Reset All: no spotlight on the map', R.layers);
    compareShown('after Reset All', await shown(), viewOf(o, 'default', 'Inbound+Outbound', 'side_by_side'));
    await p.eval(`document.getElementById('s-lines').click()`);

    // 7. Screenshot: a PNG of the map's size with the map's pixels; the button saves map-screenshot.png.
    const shot = async () => p.eval(`(async function(){var st=CVIWA.state.mapHandle,b=await CVIWA.map.screenshot(st),u8=new Uint8Array(await b.arrayBuffer());
      var dv=new DataView(u8.buffer),img=await createImageBitmap(b),c=document.createElement('canvas');c.width=img.width;c.height=img.height;var g=c.getContext('2d');g.drawImage(img,0,0);
      var px=g.getImageData(0,0,c.width,c.height).data,cols=new Set();for(var i=0;i<px.length;i+=4*97)cols.add(px[i]+','+px[i+1]+','+px[i+2]);
      var m=st.map,d=CVIWA.state.data.find(function(x){return x.county==='Grant'&&x.direction==='Outbound'}),q=m.project([d.lon,d.lat]),k=c.width/m.getCanvas().clientWidth;
      var at=g.getImageData(Math.round(q.x*k),Math.round(q.y*k),1,1).data;
      return {sig:[].slice.call(u8,0,8).join(),w:dv.getUint32(16),h:dv.getUint32(20),cw:m.getCanvas().width,ch:m.getCanvas().height,colors:cols.size,bytes:u8.length,
        circle:[at[0],at[1],at[2]],bg:[].slice.call(g.getImageData(2,2,1,1).data,0,3),sum:Array.from(px).reduce(function(a,b,i){return (a*31+b)>>>0},7)}})()`);
    const a = await shot();
    check(a.sig === '137,80,78,71,13,10,26,10' && a.w === a.cw && a.h === a.ch && a.w > 0, 'screenshot: a PNG the size of the map', a);
    check(a.colors > 20 && JSON.stringify(a.circle) !== JSON.stringify(a.bg), 'screenshot: has the map\'s pixels (circles drawn, not blank)', a);
    await p.eval(`document.getElementById('s-labels').click()`); await sleep(300);
    const nolab = await shot();
    await p.eval(`document.getElementById('s-labels').click()`); await sleep(300);
    check(nolab.sum !== a.sum && nolab.w === a.w, 'screenshot: county labels drawn on it when shown, left out when hidden', [a.sum, nolab.sum]);
    await p.downloadsTo(DL);
    await p.eval(`document.querySelector('button.map-screenshot').click()`);
    const f = path.join(DL, 'map-screenshot.png');
    for (let i = 0; i < 50 && !fs.existsSync(f); i++) await sleep(100);
    const saved = fs.existsSync(f) ? fs.readFileSync(f) : null;
    check(saved && saved.slice(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && saved.readUInt32BE(16) === a.w, 'screenshot button: the browser saves map-screenshot.png', saved && saved.length);
    check(/^map-screenshot\.png was handed to your browser to save/.test(await p.eval('CVIWA.state.lastMessage')), 'screenshot button: the page says where the picture went');
    // A failure is reported, not swallowed.
    const failMsg = await p.eval(`(function(){var st=CVIWA.state.mapHandle;st.ready=false;document.querySelector('button.map-screenshot').click();st.ready=true;return CVIWA.state.lastMessage})()`);
    check(failMsg === 'Screenshot not saved: The map is not ready.', 'screenshot button: a failure is reported with the reason', failMsg);
    run.screenshot = { width: a.w, height: a.h, bytes: saved && saved.length };

    // 8. A reduced table without the CVI column (Partner tier): "Unique CVIs" grayed with the reason; the rest as CVI.
    v0 = await version();
    const partnerCsv = path.join(ROOT, 'local-test-artifacts', 'f1', 'tiers', 'partner', 'partner_county_totals.csv');
    await p.setFiles('#file-input', [partnerCsv]);
    await settle(v0);
    pageModel = PW.master.load(fs.readFileSync(partnerCsv, 'utf8'));
    s = await shown();
    const gated = s.cards[1] || {};
    check(gated.gated && gated.value === 'Needs the CVI column' && gated.reason === 'Needs the CVI column' && await p.eval('document.querySelectorAll("#value-boxes .metric")[1].getAttribute("aria-disabled")') === 'true'
      && await p.eval('document.querySelector("#value-boxes .metric.gated .metric-value").title') === 'Needs the column CVI in the CVI master table.',
      'Partner tier: "Unique CVIs" grayed with a short reason, the checklist\'s full reason on hover', gated);
    // The grayed box keeps the other boxes' height, and the four stay on one row (1400 px window).
    const sizes = await p.eval(`[].map.call(document.querySelectorAll('#value-boxes .metric'),function(c){var r=c.getBoundingClientRect();return [Math.round(r.top),Math.round(r.height)]})`);
    check(sizes.length === 4 && sizes.every(x => x[0] === sizes[0][0] && x[1] === sizes[0][1]), 'Partner tier: the grayed box is the same height as the others, all on one row', sizes);
    compareShown('Partner default', s, viewOf(oPartner, 'default', 'Inbound+Outbound', 'side_by_side'));
    check(JSON.stringify(await p.eval(`[].map.call(document.querySelectorAll('#f-spotlight input'),function(c){return c.value})`)) === JSON.stringify(arr(oPartner.load.spotlight_choices)), 'Partner tier: spotlight choices as CVI');

    // 8b. The Full tier (with CVI) and the Public tier (without): defaults as CVI, Unique CVIs on / grayed.
    for (const [tag, rel, oT, hasCvi] of [['Full', ['full', 'CVI_Consolidated_Master.csv'], oFull, true], ['Public', ['public', 'CVI_Consolidated_Master.csv'], oPublic, false]]) {
      v0 = await version();
      const csv = path.join(ROOT, 'local-test-artifacts', 'f1', 'tiers', ...rel);
      await p.setFiles('#file-input', [csv]);
      await settle(v0);
      pageModel = PW.master.load(fs.readFileSync(csv, 'utf8'));
      s = await shown();
      check(!!(s.cards[1] || {}).gated === !hasCvi, tag + ' tier: "Unique CVIs" ' + (hasCvi ? 'on' : 'grayed'), s.cards[1]);
      compareShown(tag + ' default', s, viewOf(oT, 'default', 'Inbound+Outbound', 'side_by_side'));
      check(JSON.stringify(await p.eval(`[].map.call(document.querySelectorAll('#f-spotlight input'),function(c){return c.value})`)) === JSON.stringify(arr(oT.load.spotlight_choices)), tag + ' tier: spotlight choices as CVI');
    }

    // 8c. S2b period modes on the S2 fixture, through the page's own controls, against CVI's module (oracle "periods").
    {
      const P2 = o.periods;
      v0 = await version();
      await p.setFiles('#file-input', [FIX('cvi_master_s2.csv')]);
      await settle(v0);
      pageModel = PW.master.load(fs.readFileSync(FIX('cvi_master_s2.csv'), 'utf8'));
      const allSpp = arr(o.load.messages.find(m => m.id === 'county_species').msg.value);
      const asView = (st, extra) => Object.assign({ filters: { species: allSpp, years: arr(st.years), quarters: arr(st.quarters), direction: ['Inbound', 'Outbound'], raw_species: [] },
        mode: 'side_by_side', value_boxes: st.value_boxes, strip: st.strip }, extra || {});
      const PS = `(function(){var s=CVIWA.state;return {mode:s.periodMode,step:s.timeStep,idx:s.timeIndex,years:s.years.map(String),quarters:s.quarters,playing:s.playing,
        label:document.getElementById('time-label').textContent,header:document.getElementById('period-summary').textContent,
        sMax:Number(document.getElementById('time-slider').max),sVal:Number(document.getElementById('time-slider').value),
        browseShown:!document.getElementById('browse-block').hidden,pickersShown:!document.getElementById('pickers-a').hidden,
        rightShown:!document.getElementById('right-block').hidden,colB:!document.getElementById('col-b').hidden,note:!document.getElementById('compare-note').hidden,
        play:document.getElementById('time-play').getAttribute('aria-label')}})()`;
      const ps = () => p.eval(PS);
      let q = await ps();
      check(q.mode === 'single' && q.header === P2.single.header && await p.eval('!document.getElementById("period-block").open'), 'Period block closed on load, header "' + P2.single.header + '" as CVI', q);
      const radio = (name, v) => act(`document.querySelector('input[name=${name}][value=${v}]').click()`, true);
      const slide = i => act(`(function(){var s=document.getElementById('time-slider');s.value='${i}';s.dispatchEvent(new Event('input',{bubbles:true}))})()`, true);
      // Browse: entering moves to the middle period and shows it.
      const SHOTS = path.join(OUT, 'screens'); fs.rmSync(SHOTS, { recursive: true, force: true }); fs.mkdirSync(SHOTS, { recursive: true });
      await p.eval(`document.getElementById('period-block').open=true`);
      await radio('period-mode', 'browse');
      await p.capture(path.join(SHOTS, 'browse.png'));
      q = await ps(); const e = P2.browse_enter;
      check(q.mode === 'browse' && q.browseShown && !q.pickersShown && q.sMax === arr(P2.domains.quarter).length && q.sVal === Number(e.slider) && q.label === e.time_label && q.header === e.header
        && JSON.stringify(q.years) === JSON.stringify(arr(e.years)) && JSON.stringify(q.quarters) === JSON.stringify(arr(e.quarters)),
        'Browse: slider over the quarters present, in the middle, its period on the map, pickers hidden, header as CVI', { page: q, cvi: [e.slider, e.time_label, e.header, e.years, e.quarters] });
      let nFr = 0;
      for (const fr of arr(P2.browse_frames)) {
        if (fr.step === 'year' && q.step !== 'year') {
          await radio('time-step', 'year');
          q = await ps(); const sw = P2.browse_year_switch;
          check(q.step === 'year' && q.sMax === arr(P2.domains.year).length && q.sVal === Number(sw.slider) && q.label === sw.time_label && JSON.stringify(q.years) === JSON.stringify(arr(sw.years)),
            'Step by Year: slider over the years present, in the middle, as CVI', { page: q, cvi: [sw.slider, sw.time_label, sw.years] });
        }
        await slide(fr.index);
        q = await ps(); nFr++;
        const tag = 'Browse ' + fr.step + ' ' + fr.index;
        const wantHeader = fr.step === 'quarter' ? fr.header : 'Browse: ' + fr.time_label;   // by year: the year shown
        check(q.label === fr.time_label && q.header === wantHeader && JSON.stringify(q.years) === JSON.stringify(arr(fr.years)) && JSON.stringify(q.quarters) === JSON.stringify(arr(fr.quarters)),
          tag + ': label, header and period as CVI' + (fr.step === 'year' ? ' (header names the year)' : ''), { page: q, cvi: [fr.time_label, fr.header, fr.years, fr.quarters] });
        compareShown(tag, await shown(), asView(fr));
      }
      run.browse_frames = nFr;
      // Play (Fast) from the first year: one step per 2.5 s, the camera kept, then it stops at the last year.
      await p.eval(`(function(){var s=document.getElementById('time-speed');s.value='2500';s.dispatchEvent(new Event('change',{bubbles:true}))})()`);
      await slide(1);
      await p.eval('CVIWA.state.mapHandle.map.jumpTo({center:[-120.6,47.3],zoom:7.2}), true');
      const cam0 = await p.eval('(function(){var m=CVIWA.state.mapHandle.map;return [m.getCenter().lng,m.getCenter().lat,m.getZoom()]})()');
      const t0 = Date.now();
      await p.eval(`document.getElementById('time-play').click()`);
      q = await ps();
      check(q.playing && q.play === 'Pause' && q.idx === 1, 'Play: playing, the button now pauses', q);
      await p.waitFor('CVIWA.state.timeIndex === 2', 6000, 'second frame'); const t1 = Date.now() - t0;
      // A new speed while playing keeps playing.
      await p.eval(`(function(){var s=document.getElementById('time-speed');s.value='3500';s.dispatchEvent(new Event('change',{bubbles:true}))})()`);
      check(await p.eval('CVIWA.state.playing && CVIWA.state.speed === 3500'), 'Play: a new speed keeps playing');
      await p.waitFor('CVIWA.state.timeIndex === 3', 6000, 'third frame'); const t2 = Date.now() - t0;
      const atLast = await p.eval(`[CVIWA.state.playing, document.getElementById('time-play').getAttribute('aria-label')]`);
      check(!atLast[0] && atLast[1] === 'Play', 'Play: stops as the last period is shown (Shiny stops in the same step)', atLast);
      await p.waitFor('!CVIWA.state.playing', 6000, 'stops after the last period');
      await sleep(400);
      const cam1 = await p.eval('(function(){var m=CVIWA.state.mapHandle.map;return [m.getCenter().lng,m.getCenter().lat,m.getZoom()]})()');
      q = await ps();
      check(t1 > 2200 && t1 < 3400 && t2 - t1 > 3100 && t2 - t1 < 4400, 'Play: 2.5 s per frame, then 3.5 s after the speed change', [t1, t2 - t1]);
      check(q.idx === 3 && !q.playing && q.play === 'Play' && q.label === arr(P2.domains.year)[2], 'Play: stops at the last period', q);
      check(cam1.every((x, i) => Math.abs(x - cam0[i]) < 1e-6), 'Play: the camera stays where the user put it', [cam0, cam1]);
      // From the last period Play starts again at the first.
      await p.eval(`document.getElementById('time-play').click()`);
      q = await ps(); await p.eval(`document.getElementById('time-play').click()`);
      check(q.idx === 1 && q.playing && q.label === arr(P2.domains.year)[0], 'Play from the last period starts at the first', q);
      // Back to Single: the last period stays in the pickers (as CVI).
      await slide(arr(P2.domains.year).length);
      await radio('period-mode', 'single');
      q = await ps(); const lv = P2.browse_leave;
      check(q.mode === 'single' && q.pickersShown && !q.browseShown && q.header === lv.header && JSON.stringify(q.years) === JSON.stringify(arr(lv.years)) && JSON.stringify(q.quarters) === JSON.stringify(arr(lv.quarters)),
        'Single after Browse keeps the last period, header as CVI', { page: q, cvi: [lv.header, lv.years, lv.quarters] });

      // Compare: the right map beside the left one, each case as CVI's module drew it.
      await pick('years', 'f-years', arr(o.load.messages.find(m => m.id === 'county_year').msg.value));
      await pick('quarters', 'f-quarters', ['Q1', 'Q2', 'Q3', 'Q4']);
      const camSingle = await p.eval('(function(){var m=CVIWA.state.mapHandle.map;return [m.getCenter().lng,m.getCenter().lat,m.getZoom()]})()');
      await radio('period-mode', 'compare');
      await p.waitFor('CVIWA.state.mapHandleB && CVIWA.state.mapHandleB.ready && CVIWA.state.mapHandleB.map.loaded()', 15000, 'right map ready');
      await sleep(350);
      const fit = await p.eval(`(function(){var m=CVIWA.state.mapHandle.map,b=m.getBounds(),v=CVIWA.map.WA_VIEW_BOUNDS,mb=CVIWA.state.mapHandleB.map,c=mb.getCenter();
        return {inside:b.getWest()<=v[0]+1e-6&&b.getEast()>=v[2]-1e-6&&b.getSouth()<=v[1]+1e-6&&b.getNorth()>=v[3]-1e-6,same:Math.abs(c.lng-m.getCenter().lng)<1e-6&&Math.abs(mb.getZoom()-m.getZoom())<1e-6}})()`);
      check(fit.inside && fit.same, 'Compare: both maps open fitted to Washington (as CVI draws them fresh), on the same camera', fit);
      q = await ps();
      check(q.mode === 'compare' && q.colB && q.note && q.rightShown && q.pickersShown && q.header === P2.compare_enter.header, 'Compare: two maps, the note on scaling, the right map\'s pickers, header as CVI', q);
      const RS = `(function(){var s=CVIWA.state,mb=s.mapHandleB;return {a:document.getElementById('label-a').textContent,b:document.getElementById('label-b').textContent,
        header:document.getElementById('period-summary').textContent,dataB:s.dataB.map(function(c){return [c.county,c.direction,c.total_animals]}),
        drawnB:mb.drawn?mb.drawn.length:-1,legendB:s.legendB?s.legendB.sizes.length:0,legendA:s.legend?s.legend.sizes.length:0}})()`;
      let nCmp = 0;
      for (const c of arr(P2.compare).filter(x => arr(x.direction).length === 2 && x.mode === 'side_by_side')) {
        const r = c.right, L = c.left || { species: allSpp, species_sub: [] };
        await pick('species', 'f-species', arr(L.species));
        await act(`(function(){var d=document.getElementById('f-species-sub').closest('details');if(d)d.open=true;var want=${JSON.stringify(arr(L.species_sub))};
          document.querySelectorAll('#f-species-sub input').forEach(function(c){if(c.checked!==(want.indexOf(c.value)>=0))c.click()});})()`, true);
        await pick('years', 'f-years', arr(c.years));
        await act(`(function(){var b=document.getElementById('species-b-on');if(b.checked!==${!!r.species_b_enabled})b.click()})()`, true);
        await pick('speciesB', 'f-species-b', arr(r.species_b));
        await act(`(function(){var d=document.querySelector('#species-b-block [data-feature="species-refine"] details');d.open=true;var want=${JSON.stringify(arr(r.species_b_sub))};
          document.querySelectorAll('#f-species-b-sub input').forEach(function(c){if(c.checked!==(want.indexOf(c.value)>=0))c.click()});})()`, true);
        await pick('yearsB', 'f-years-b', arr(r.years_b)); await pick('quartersB', 'f-quarters-b', arr(r.quarters_b));
        await p.waitFor('CVIWA.state.mapHandleB.map.loaded()', 8000, 'right map idle');
        const g = await p.eval(RS), wantB = arr(c.circles_b).map(x => [x.county, x.direction, x.total_animals]);
        const tag = 'Compare ' + c.case;
        check(g.a === c.label_a && g.b === c.label_b && g.header === c.header, tag + ': map labels and header as CVI', { page: g, cvi: [c.label_a, c.label_b, c.header] });
        if (c.case === 'b_raw_hidden') {
          const left = await p.eval('CVIWA.state.data.map(function(c){return [c.county,c.direction,c.total_animals]})');
          check(JSON.stringify(g.dataB) === JSON.stringify(left) && JSON.stringify(g.dataB) !== JSON.stringify(wantB), tag + ': the right map ignores the hidden refine (CVI applies it)', { page: g.dataB.length, cvi: wantB.length });
        } else check(JSON.stringify(g.dataB) === JSON.stringify(wantB) && g.drawnB === wantB.length, tag + ': right map circles as CVI\'s', { page: g.dataB, cvi: wantB });
        check(wantB.length ? g.legendB > 0 : g.legendB === 0, tag + ': right map has its own legend', g);
        const noteShown = await p.eval(`!document.getElementById('compare-refine-note').hidden`);
        check(noteShown === (arr(L.species_sub).length > 0 && !r.species_b_enabled), tag + ': "Refine by species applies to the left map only" shown exactly while the left map is refined', noteShown);
        compareShown(tag + ' (boxes follow the left map)', await shown(), asView(c, { filters: { species: arr(L.species), years: arr(c.years), quarters: ['Q1', 'Q2', 'Q3', 'Q4'], direction: ['Inbound', 'Outbound'], raw_species: arr(L.species_sub) } }));
        nCmp++;
      }
      run.compare_cases = nCmp;
      check(arr(P2.compare).some(x => x.case === 'a_raw' && x.left && arr(x.left.species_sub).length), 'Compare with a refined left map exercised (oracle case a_raw)');
      await pick('species', 'f-species', allSpp);
      await act(`document.querySelectorAll('#f-species-sub input:checked').forEach(function(c){c.click()})`, true);
      await act(`(function(){var b=document.getElementById('species-b-on');if(b.checked)b.click()})()`, true);
      await pick('yearsB', 'f-years-b', [arr(P2.domains.year).slice(-1)[0]]);
      await p.eval(`document.getElementById('legend-toggle-b').click()`); await sleep(600);
      await p.capture(path.join(SHOTS, 'compare.png'));
      await p.eval(`document.getElementById('legend-toggle-b').click()`);
      // S1.1: in Combined mode both maps draw the circles and the "Total" swatch in the palette's first
      // color (CVI: #245566), and the screenshot of each map has that color at 60% over the land, by pixel (a point inside
      // one circle only, clear of every county name).
      await radio('mode', 'total');
      await act(`(function(e){e.value='Single — WSDA Orange';e.dispatchEvent(new Event('change',{bubbles:true}))})(document.getElementById('s-palette'))`, true);
      await p.waitFor('CVIWA.state.mapHandleB.map.loaded() && CVIWA.state.mapHandle.map.loaded()', 8000, 'maps idle'); await sleep(400);
      const tot = await p.eval(`(async function(){var s=CVIWA.state,out=[];
        for (var pair of [[s.mapHandle,s.data,s.legend],[s.mapHandleB,s.dataB,s.legendB]]) {
          var h=pair[0],d=pair[1],m=h.map,box=m.getContainer().getBoundingClientRect();
          var labels=[].slice.call(m.getContainer().querySelectorAll('.county-label')).filter(function(e){return !e.classList.contains('hidden')}).map(function(e){var r=e.getBoundingClientRect();return [r.left-box.left-2,r.top-box.top-2,r.right-box.left+2,r.bottom-box.top+2]});
          var c=d.map(function(x){var q=m.project([x.lon,x.lat]);return {x:q.x,y:q.y,r:x.radius_px}}),probe=null;
          c.slice().sort(function(a,b){return b.r-a.r}).some(function(o){for(var a=0;a<12&&!probe;a++){var t=a*Math.PI/6,px=o.x+0.6*o.r*Math.cos(t),py=o.y+0.6*o.r*Math.sin(t);
            if(px<3||py<3||px>box.width-3||py>box.height-3)continue;
            if(c.some(function(z){return z!==o&&Math.hypot(z.x-px,z.y-py)<z.r+3}))continue;
            if(labels.some(function(L){return px>=L[0]&&px<=L[2]&&py>=L[1]&&py<=L[3]}))continue;probe=[px,py];}return !!probe});
          var b=await CVIWA.map.screenshot(h),img=await createImageBitmap(b),cv=document.createElement('canvas');cv.width=img.width;cv.height=img.height;var g=cv.getContext('2d');g.drawImage(img,0,0);
          var k=cv.width/m.getCanvas().clientWidth,px=probe?[].slice.call(g.getImageData(Math.round(probe[0]*k),Math.round(probe[1]*k),1,1).data,0,3):null;
          out.push({colors:Array.from(new Set(m.queryRenderedFeatures({layers:['circles']}).map(function(f){return f.properties.color}))),swatch:pair[2]&&pair[2].swatches,probe:probe,px:px});
        } return out})()`);
      const want = [240, 115, 37].map((c, i) => Math.round(c * 0.6 + 236 * 0.4));
      tot.forEach((t, i) => {
        const side = i ? 'right map' : 'left map';
        check(JSON.stringify(t.colors) === '["#f07325"]' && t.swatch && t.swatch.length === 1 && t.swatch[0].direction === 'Total' && t.swatch[0].color === '#f07325',
          'Compare, Combined: ' + side + ' circles and "Total" swatch in the palette\'s first color (S1.1)', t);
        check(t.px && t.px.every((v, k) => Math.abs(v - want[k]) <= 2), 'Compare, Combined: ' + side + ' screenshot pixel of a circle = the first color at 60% (S1.1)', { t, want });
      });
      await act(`(function(e){e.value='WSDA Default';e.dispatchEvent(new Event('change',{bubbles:true}))})(document.getElementById('s-palette'))`, true);
      await radio('mode', 'side_by_side');
      // Linked cameras: moving either map moves the other.
      const cams = await p.eval(`(function(){var a=CVIWA.state.mapHandle.map,b=CVIWA.state.mapHandleB.map,c=function(m){return [m.getCenter().lng,m.getCenter().lat,m.getZoom()]};
        a.jumpTo({center:[-122.3,47.6],zoom:8});var r1=[c(a),c(b)];b.jumpTo({center:[-117.4,47.7],zoom:7.5});var r2=[c(a),c(b)];return [r1,r2]})()`);
      check(cams.every(([x, y]) => x.every((v, i) => Math.abs(v - y[i]) < 1e-6)), 'Compare: the two cameras move together', cams);
      // Fit to Washington in Compare fits each map's own size, so the whole state shows on both.
      await p.eval(`document.getElementById('fit-wa').click()`); await sleep(300);
      const fitB = await p.eval(`(function(){var v=CVIWA.map.WA_VIEW_BOUNDS;return [CVIWA.state.mapHandle.map,CVIWA.state.mapHandleB.map].map(function(m){var b=m.getBounds();
        return b.getWest()<=v[0]+1e-6&&b.getEast()>=v[2]-1e-6&&b.getSouth()<=v[1]+1e-6&&b.getNorth()>=v[3]-1e-6})})()`);
      check(fitB[0] && fitB[1], 'Compare: Fit to Washington shows the whole state on both maps', fitB);
      // The fit button on either map does the same.
      for (const id of ['map', 'map-b']) {
        await p.eval(`void CVIWA.state.mapHandle.map.jumpTo({center:[-122.3,47.6],zoom:9})`);
        await p.eval(`document.querySelector('#${id} .maplibregl-ctrl-top-left button.map-fit').click()`); await sleep(300);
        const fb = await p.eval(`(function(){var v=CVIWA.map.WA_VIEW_BOUNDS;return [CVIWA.state.mapHandle.map,CVIWA.state.mapHandleB.map].map(function(m){var b=m.getBounds();
          return b.getWest()<=v[0]+1e-6&&b.getEast()>=v[2]-1e-6&&b.getSouth()<=v[1]+1e-6&&b.getNorth()>=v[3]-1e-6})})()`);
        check(fb[0] && fb[1], 'Compare: the ' + (id === 'map' ? 'left' : 'right') + ' map\'s fit button shows the whole state on both maps', fb);
      }
      // Screenshot and legend on the right map.
      check(await p.eval(`(function(){var b=document.querySelector('#map-b .maplibregl-ctrl-top-right button.map-screenshot');if(!b)return false;b.click();return /^map-screenshot\\.png was handed/.test(CVIWA.state.lastMessage)})()`),
        'Compare: the right map has its own screenshot button');
      check(await p.eval(`(function(){var t=document.getElementById('legend-toggle-b'),p=document.getElementById('legend-panel-b');t.click();var o=!p.hidden&&t.getAttribute('aria-expanded')==='true';t.click();return o&&p.hidden})()`),
        'Compare: the right map\'s legend opens and closes');
      // Narrow window: the maps stack (below 768 px; CVI's columns most likely below 576 px).
      await p.resize(700, 1000); await sleep(300);
      const tops = await p.eval(`[].map.call(document.querySelectorAll('.map-col'),function(c){return Math.round(c.getBoundingClientRect().top)})`);
      await p.resize(1400, 1000); await sleep(300);
      check(tops[1] > tops[0], 'Compare: the two maps stack in a narrow window', tops);
      // Reset All from Compare: Single, the right map's pickers back; the slider's step and speed kept (as CVI).
      await act(`(function(){var b=document.getElementById('species-b-on');if(!b.checked)b.click()})()`, true);
      await pick('speciesB', 'f-species-b', [allSpp[0]]);
      await p.eval(`(function(){document.querySelector('input[name=time-step][value=year]').click();var s=document.getElementById('time-speed');s.value='5000';s.dispatchEvent(new Event('change',{bubbles:true}))})()`);
      await slide(1);
      await act(`document.getElementById('reset-all').click()`);
      q = await ps();
      const RB = await p.eval(`(function(){var s=CVIWA.state;return {on:s.speciesBEnabled,box:document.getElementById('species-b-on').checked,speciesB:s.speciesB,sub:s.speciesBSub,yearsB:s.yearsB,quartersB:s.quartersB,speed:s.speed,speedBox:document.getElementById('time-speed').value}})()`);
      const wantRB = await p.eval('CVIWA.periods.resetDefaults(CVIWA.state.master)');
      const back = await p.eval('(function(){var m=CVIWA.state.mapHandle.map;return [m.getCenter().lng,m.getCenter().lat,m.getZoom()]})()');
      check(back.every((x, i) => Math.abs(x - camSingle[i]) < 1e-6), 'Leaving Compare puts the single map back where it was', [camSingle, back]);
      check(q.mode === 'single' && !q.colB && !q.note && !q.rightShown && q.step === 'year' && RB.speed === 5000 && RB.speedBox === '5000' && q.idx === 1 && q.sVal === 1,
        'Reset All from Compare: Single period, one map; slider position, step and speed kept (as CVI)', { q, RB });
      check(await p.eval('CVIWA.state.mapHandleB.drawn.length === 0 && CVIWA.state.dataB.length === 0 && !CVIWA.state.legendB'),
        'Leaving Compare empties the right map and its legend, so coming back never shows an old drawing');
      check(!RB.on && !RB.box && JSON.stringify([RB.speciesB, RB.sub, RB.yearsB, RB.quartersB]) === JSON.stringify([wantRB.speciesB, wantRB.speciesBSub, wantRB.yearsB, wantRB.quartersB]),
        'Reset All: the right map\'s pickers set to periods.resetDefaults (wiring check; CVI\'s reset messages are compared in the unit test)', { RB, wantRB });
      await p.eval(`document.querySelector('input[name=time-step][value=quarter]').click()`);

      // 8d. Play stopped by a mode change and by Reset All; a new file mid-Play while stepping by year (slider sized for
      // years, by design); a new file mid-Compare; a failed load leaves Compare; the Partner tier in Compare.
      await radio('period-mode', 'browse');
      await p.eval(`document.getElementById('time-play').click()`);
      const qp = await ps();
      await radio('period-mode', 'single');
      q = await ps();
      check(qp.playing && !q.playing && q.play === 'Play', 'Play stops when the period mode changes', [qp.playing, q.playing]);
      await radio('period-mode', 'browse');
      await p.eval(`document.getElementById('time-play').click()`);
      await act(`document.getElementById('reset-all').click()`);
      q = await ps();
      check(!q.playing && q.mode === 'single', 'Reset All stops Play', q);
      await radio('period-mode', 'browse');
      await p.eval(`document.querySelector('input[name=time-step][value=year]').click()`);
      await slide(1);
      await p.eval(`document.getElementById('time-play').click()`);
      v0 = await version();
      await p.setFiles('#file-input', [FIX('cvi_master_wa39.csv')]);
      await settle(v0);
      const domW = PW.periods.domains(PW.master.load(fs.readFileSync(FIX('cvi_master_wa39.csv'), 'utf8'))), midW = PW.periods.middle(domW.year.length);
      q = await ps();
      check(q.mode === 'browse' && !q.playing && q.step === 'year' && q.sMax === domW.year.length && q.sVal === midW && q.label === domW.year[midW - 1]
        && JSON.stringify(q.years) === JSON.stringify([domW.year[midW - 1]]) && q.quarters.length === 4,
        'New file while playing by year: Play stops, still Browse, slider over the new years (by design), middle year on the map', { q, years: domW.year });
      await radio('period-mode', 'compare');
      v0 = await version();
      await p.setFiles('#file-input', [FIX('cvi_master_s2.csv')]);
      await settle(v0); await p.waitFor('CVIWA.state.mapHandleB.map.loaded()', 8000, 'right map idle');
      const nb = await p.eval(`(function(){var s=CVIWA.state;return {mode:s.periodMode,yearsB:s.yearsB.map(String),years:s.master.yearChoices.map(String),n:s.dataB.length,drawn:CVIWA.state.mapHandleB.drawn.length}})()`);
      check(nb.mode === 'compare' && JSON.stringify(nb.yearsB) === JSON.stringify(nb.years) && nb.n > 0 && nb.drawn === nb.n,
        'New file during Compare: still Compare, right map on all the new years, redrawn', nb);
      const bad = path.join(OUT, 'not_a_master.csv'); fs.writeFileSync(bad, 'foo,bar\n1,2\n');
      v0 = await version();
      await p.setFiles('#file-input', [bad]);
      await settle(v0); fs.rmSync(bad, { force: true });
      q = await ps();
      const failState = await p.eval(`[document.getElementById('master-status').className, document.querySelector('input[name=period-mode][value=compare]').disabled]`);
      check(q.mode === 'single' && !q.colB && !q.rightShown && /err/.test(failState[0]) && failState[1], 'A failed load leaves Compare: Single period, one map, the grayed radios', { q, failState });
      v0 = await version();
      await p.setFiles('#file-input', [partnerCsv]);
      await settle(v0);
      await radio('period-mode', 'compare');
      await p.waitFor('CVIWA.state.mapHandleB.map.loaded()', 8000, 'right map idle');
      await act(`document.getElementById('species-b-on').click()`, true);
      const pc = await p.eval(`(function(){var r=document.querySelector('#species-b-block [data-feature="species-refine"]');return {radios:!document.querySelector('input[name=period-mode][value=compare]').disabled,
        refineGated:r.classList.contains('gated'),why:!r.querySelector('[data-gate-reason]').hidden,n:CVIWA.state.dataB.length,drawn:CVIWA.state.mapHandleB.drawn.length}})()`);
      check(pc.radios && pc.refineGated && pc.why && pc.n > 0 && pc.drawn === pc.n, 'Partner tier in Compare: modes on, the right map\'s refine grayed with the reason, right map drawn', pc);
      await act(`document.getElementById('species-b-on').click()`, true);
      await radio('period-mode', 'single');
    }

    // 9. Nothing outside the site folder; no CSP report; no exception.
    const outside = b.log.requests.filter(u => !(u.startsWith(SITE_BASE) || /^(blob|data):/.test(u)));
    check(outside.length === 0, 'every request inside the site folder (or blob:/data:)', outside.slice(0, 5));
    check(b.log.csp.length === 0, 'no Content Security Policy reports', b.log.csp.slice(0, 3));
    check(b.log.exceptions.length === 0, 'no page exceptions', b.log.exceptions.slice(0, 3));
    run.request_schemes = [...new Set(b.log.requests.map(u => u.split(':')[0]))].sort();
  } catch (e) {
    check(false, 'run completed', String(e && e.stack || e));
  } finally {
    await b.close();
  }
  run.passed = pass; run.failed = fail; run.failures = failures;
  fs.writeFileSync(path.join(OUT, 'browser_run.json'), JSON.stringify(run, null, 2));
  run.n17_total_views = nN17;
  console.log(run.chrome + ' | ' + PAGE_LABEL + ' | scenarios ' + run.scenarios_compared + ' (page total differs from CVI in ' + nN17 + ')' + ' | browse frames ' + run.browse_frames + ', compare cases ' + run.compare_cases + ' | screenshot ' + JSON.stringify(run.screenshot) + ' | request schemes: ' + (run.request_schemes || []).join(', '));
  if (failures.length) console.log(failures.slice(0, 30).join('\n'));
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
