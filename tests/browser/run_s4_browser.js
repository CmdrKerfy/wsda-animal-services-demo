#!/usr/bin/env node
'use strict';
// S4 browser test (National Flow): opens site/cvi/index.html in the installed Google Chrome (headless, throw-away
// profile). Every request outside the site folder is answered "not found" here and recorded (none is expected: the
// Flow view is offline only).
// Checks: the page opens on WA State with nothing of the Flow view loaded (flow map, state outlines, centers); Map View
// (aria-pressed, the sidebar, map, legend, boxes and strip of the active view); the Flow files loaded once, on the first
// visit; the Flow map on a globe at CVI's opening view, its state lines and the 49 state labels at the centers (no AK or
// HI), both switched live; labels without room hidden (the larger state's kept; back when zoomed in; hidden behind the
// globe); the lines' paint taking each line's color and width; one legend open state for both views; for every view of CVI's own module recorded by the oracle (local-test-artifacts/s4/
// oracle_s4_*.json: all views of the S4 fixture, every S4_STRIDE-th view of the other fixtures and the three tiers), the
// page's controls set as CVI's inputs were, then the lines the map draws (states, groups, colors, widths, tooltips,
// drawing order, opacity and hover opacity, all rendered), the legend, value boxes and strip against CVI's; hover (the
// tooltip as CVI's text, only CVI's tags as markup, the line's opacity raised); camera kept on filter and style changes,
// Fit to Lower 48 and the house button back to the opening view; Browse (domains, the middle period on load, entering,
// every frame by quarter and by year, the switch to years, leaving keeps the last frame, pickers hidden while browsing,
// Play) against CVI's, Play stopped by a view switch, and the page's fallback for a file without cross-border rows; a
// species group written as markup shown as text in the hover tooltip; Reset All (both views; Browse off, slider, step
// and speed kept); the WA view unchanged after visiting Flow (circles, boxes, strip, camera, filters);
// grayed controls and boxes per tier; the screenshot (saved, labels and the Census credit drawn, lines, land and the
// credit band in the picture); a file loaded in the Flow view leaving the WA view as a load there would; a state file
// that cannot be read and a map that cannot be made (messages, grayed switches, the boxes, the WA map unaffected);
// CVI's warning for an empty result in the Flow view only. Deliberate differences checked as such.
// Usage (repository root): node tests/node/run_f1_unit_tests.js, Rscript tests/oracle/cvi_r_oracle.R s4 (the oracle
// files), then node tests/browser/run_s4_browser.js     (Node >= 22; Chrome installed; no packages)
// Optional: CHROME_BIN=<path to chrome>; S4_PAGE_URL=<another copy of the page, e.g. over local http>; S4_STRIDE=<n>.
// Writes only local-test-artifacts/s4/browser_run.json, s4/screens/, s4/downloads/, the variant CSVs
// s4/cvi_master_s4_noflow.csv and s4/cvi_master_s4_markup.csv and a temporary profile (deleted on exit).
const { spawn } = require('child_process');
const fs = require('fs'), path = require('path'), vm = require('vm');
const { pathToFileURL, fileURLToPath } = require('url');
const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join(ROOT, 'local-test-artifacts', 's4');
const PAGE = process.env.S4_PAGE_URL || pathToFileURL(path.join(ROOT, 'site', 'cvi', 'index.html')).href;
const SITE_BASE = new URL('..', PAGE).href;
const PAGE_LABEL = /^file:/.test(PAGE) ? path.relative(ROOT, fileURLToPath(PAGE)).split(path.sep).join('/') + ' (file://)' : PAGE.split(/[?#]/)[0];
const STRIDE = Math.max(1, Number(process.env.S4_STRIDE) || 5);
const CHROME = process.env.CHROME_BIN || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  : process.platform === 'win32' ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : 'google-chrome');
const sleep = ms => new Promise(r => setTimeout(r, ms));

// The page's own CSV reader and the bundled centers, read the way the page reads them.
const SB = { window: {} };
vm.createContext(SB);
for (const f of ['site/cvi/app/csv.js', 'site/geo/state-centers.js', 'site/cvi/app/palettes.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), SB, { filename: f });
const CENTERS = SB.window.WSDA_STATE_CENTERS.centers;
// S1.1: the page's color for CVI's color c of group g in palette pal: the WSDA guide's where palettes.js records CVI's
// value (with Combine species the palette's first color, Cattle's), otherwise CVI's own. The S1 unit suite checks that
// list against CVI's palettes.
let s11Colors = 0;
function s11Color(pal, g, c, combine) {
  const P = SB.window.CVIWA.palettes, rec = P.CVI_VALUES.find(r => r[0] === 'species' && r[1] === pal && r[3] === c && (r[2] === g || (combine && r[2] === 'Cattle')));
  if (!rec) return c;
  s11Colors++; return P.SPECIES_PALETTES[pal][rec[2]];
}

async function launch() {
  fs.mkdirSync(OUT, { recursive: true });
  for (const d of fs.readdirSync(OUT)) if (d.startsWith('chrome-profile-')) fs.rmSync(path.join(OUT, d), { recursive: true, force: true });
  const profile = fs.mkdtempSync(path.join(OUT, 'chrome-profile-'));
  const proc = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + profile, '--no-first-run',
    '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', '--disable-component-update',
    '--disable-sync', '--window-size=1400,1000', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'], detached: true });
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
  // requests: every request the page or its workers start; provider: the ones that reached the network layer outside
  // the site (all answered here); blocked: requests the browser refused (CSP and other reasons).
  const log = { requests: [], provider: [], blocked: [], exceptions: [], csp: [] };
  const FETCH = { patterns: [{ urlPattern: 'http://*' }, { urlPattern: 'https://*' }] };
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId: sid } = await send('Target.attachToTarget', { targetId, flatten: true });
  const sessions = new Set([sid]);
  listeners.push(m => {
    if (m.method === 'Target.attachedToTarget' && sessions.has(m.sessionId)) {   // workers: capture before they run
      const s = m.params.sessionId; sessions.add(s);
      (async () => { try { await send('Network.enable', {}, s); await send('Runtime.enable', {}, s); await send('Log.enable', {}, s);
        try { await send('Fetch.enable', FETCH, s); } catch (e) { /* not for this target */ }
        await send('Runtime.runIfWaitingForDebugger', {}, s); } catch (e) { /* gone */ } })();
      return;
    }
    if (!sessions.has(m.sessionId)) return;
    if (m.method === 'Network.requestWillBeSent') log.requests.push(m.params.request.url);
    else if (m.method === 'Network.loadingFailed' && m.params.blockedReason) log.blocked.push({ reason: m.params.blockedReason, requestId: m.params.requestId });
    else if (m.method === 'Runtime.exceptionThrown') log.exceptions.push((m.params.exceptionDetails.exception || {}).description || m.params.exceptionDetails.text);
    else if (m.method === 'Log.entryAdded' && /content security policy|refused to/i.test(m.params.entry.text)) log.csp.push(m.params.entry.text);
    else if (m.method === 'Fetch.requestPaused') {
      const url = m.params.request.url, s = m.sessionId, rid = m.params.requestId;
      if (url.startsWith(SITE_BASE)) { send('Fetch.continueRequest', { requestId: rid }, s).catch(() => {}); return; }
      // Nothing outside the site folder is expected in the Flow view (offline only): recorded and answered "not found".
      log.provider.push({ url, t: Date.now(), page: s === sid });
      send('Fetch.fulfillRequest', { requestId: rid, responseCode: 404, body: Buffer.from('not found').toString('base64'),
        responseHeaders: [{ name: 'Content-Type', value: 'text/plain' }] }, s).catch(() => {});
    }
  });
  for (const d of ['Network.enable', 'Runtime.enable', 'Log.enable', 'Page.enable', 'DOM.enable']) await send(d, {}, sid);
  await send('Fetch.enable', FETCH, sid);
  await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, sid);
  await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false }, sid);
  const page = {
    async goto(url) { const loaded = new Promise(res => { const h = m => { if (m.method === 'Page.loadEventFired' && m.sessionId === sid) { listeners.splice(listeners.indexOf(h), 1); res(); } }; listeners.push(h); }); await send('Page.navigate', { url }, sid); await Promise.race([loaded, sleep(15000)]); },
    async eval(expr) {   // at most 30 s, so a page call that never answers fails the run instead of hanging it
      const r = await Promise.race([send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }, sid),
        sleep(30000).then(() => { throw new Error('eval took over 30 s: ' + expr.slice(0, 160)); })]); if (r.exceptionDetails) throw new Error('eval: ' + ((r.exceptionDetails.exception || {}).description || r.exceptionDetails.text)); return r.result.value; },
    async waitFor(expr, ms, label) { const t0 = Date.now(); while (Date.now() - t0 < (ms || 15000)) { try { const v = await page.eval(expr); if (v) return v; } catch (e) { /* not ready */ } await sleep(60); } throw new Error('timeout: ' + (label || expr)); },
    async setFiles(sel, files) { const { root } = await send('DOM.getDocument', { depth: 1 }, sid); const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector: sel }, sid); await send('DOM.setFileInputFiles', { files, nodeId }, sid); },
    async capture(file) { const r = await send('Page.captureScreenshot', { format: 'png' }, sid); fs.writeFileSync(file, Buffer.from(r.data, 'base64')); },
    async downloadsTo(dir) { await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dir }); },
    async mouse(x, y) { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 }, sid); },
    async drag(x0, y0, dx, dy) {   // a real mouse drag (pointer events through the browser's input pipeline)
      const ev = (type, x, y, buttons) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons, clickCount: 1 }, sid);
      await ev('mouseMoved', x0, y0, 0); await ev('mousePressed', x0, y0, 1);
      for (let i = 1; i <= 8; i++) { await ev('mouseMoved', x0 + dx * i / 8, y0 + dy * i / 8, 1); await sleep(16); }
      await ev('mouseReleased', x0 + dx, y0 + dy, 0);
    }
  };
  return { version: ver.Browser, log, page, async close() { try { await send('Browser.close'); } catch (e) { /* closing */ } await exited(5000); killGroup(); await exited(2000); fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } };
}

// ---- checks ---------------------------------------------------------------------------------------------------
let pass = 0, fail = 0; const failures = [];
const check = (ok, name, detail) => { if (ok) pass++; else { fail++; failures.push(name + (detail !== undefined ? ' :: ' + JSON.stringify(detail).slice(0, 600) : '')); } };
const arr = x => x === null || x === undefined ? [] : Array.isArray(x) ? x : [x];
const near = (a, b, tol) => typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
const rgbOf = h => 'rgb(' + [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)).join(', ') + ')';
const A = 'CVIWA.state.mapHandle', FH = 'CVIWA.state.flowHandle';
const FIXFILE = rel => path.join(ROOT, rel);

// Sets the National Flow controls as CVI's inputs were (through the controls, with their change events), and returns
// the Flow state's version before the recompute they cause.
const SETFLOW = `window.__setFlow=function(i){
  var fire=function(el){el.dispatchEvent(new Event('change',{bubbles:true}))};
  var arr=function(x){return x===null||x===undefined?[]:Array.isArray(x)?x:[x]};
  var v0=CVIWA.flowState.version;
  var r=document.querySelector('input[name=fl-direction][value="'+i.flow_direction+'"]'); r.checked=true; fire(r);
  var list=function(id,key,vals){document.querySelector('[data-clear="'+key+'"]').click();
    arr(vals).forEach(function(v){var cb=[].find.call(document.querySelectorAll('#'+id+' input'),function(x){return x.value===String(v)});
      if(!cb) throw new Error(id+': no choice '+v); cb.checked=true; fire(cb);});};
  list('fl-species','flSpecies',i.flow_species);
  var want=arr(i.flow_species_sub).map(String);
  [].forEach.call(document.querySelectorAll('#fl-species-sub input'),function(cb){var w=want.indexOf(cb.value)>=0; if(cb.checked!==w){cb.checked=w;fire(cb);}});
  if(want.some(function(v){return CVIWA.flowState.speciesSub.indexOf(v)<0})) return 'not offered';
  list('fl-years','flYears',i.flow_year); list('fl-quarters','flQuarters',i.flow_quarter);
  var c=document.getElementById('fl-combine'); c.checked=!!i.flow_combine_species; fire(c);
  [['fl-scaling',i.flow_scaling],['fl-bins',String(i.flow_n_bins)],['fl-opacity',i.flow_opacity],['fl-mult',i.flow_width_mult],['fl-palette',i.flow_palette]].forEach(function(p){
    var s=document.getElementById(p[0]); if(![].some.call(s.options,function(o){return o.value===p[1]})) throw new Error(p[0]+': no option '+p[1]); s.value=p[1]; fire(s);});
  [['fl-labels',i.show_state_labels],['fl-lines',i.flow_show_state_lines]].forEach(function(p){var b=document.getElementById(p[0]); b.checked=!!p[1]; fire(b);});
  return v0;}`;
// What the Flow view shows: the lines drawn (in order), the layer's opacity, the lines rendered, the legend, boxes and
// strip as on screen, and the Flow state.
// The strip as read: its items separated by a space (they are side by side on screen).
const STRIPTEXT = "(function(){var sp=document.getElementById('summary-strip'),it=sp.querySelectorAll('.strip-items > div');return (it.length?[].map.call(it,function(d){return d.textContent}).join(' '):sp.textContent).replace(/\\s+/g,' ').trim()})()";
const FLOWREAD = `(function(){var h=${FH},m=h.map,fl=CVIWA.flowState,lp=document.getElementById('legend-panel-flow'),legend;
  if(lp.querySelector('em')) legend={none:lp.textContent};
  else {var hr=lp.querySelector('hr'),sp=[],wd=[];
    [].forEach.call(lp.querySelectorAll('.lg-row'),function(r){var bar=r.querySelector('.lg-bar'),t=r.lastElementChild.textContent;
      if(hr&&(hr.compareDocumentPosition(r)&Node.DOCUMENT_POSITION_FOLLOWING)) wd.push({px:parseInt(bar.style.height,10),label:t,w:bar.style.width});
      else sp.push({color:bar.style.backgroundColor,label:t,w:bar.style.width,h:bar.style.height});});
    legend={species:sp,widths:wd,heads:[].map.call(lp.querySelectorAll('strong'),function(s){return s.textContent})};}
  var boxes=[].map.call(document.querySelectorAll('#value-boxes .metric'),function(c){var l=c.querySelector('.metric-label');
    return {label:l.firstChild.textContent,value:c.querySelector('.metric-value').textContent,gated:c.classList.contains('gated'),tip:!!l.querySelector('.tip')}});
  var al=document.querySelector('#value-boxes .vb-alert');
  return {drawn:h.drawnAll,onMap:h.drawn.map(function(f){return f.properties.state}),
    inInsets:(h.insetsDrawn?h.insetsDrawn.lines:[]).map(function(l){return l.state}),ids:h.drawn.map(function(f){return f.id}),op:m.getPaintProperty('flow_lines','line-opacity'),
    rendered:m.queryRenderedFeatures({layers:['flow_lines']}).map(function(f){return f.id}).filter(function(x,i,a){return a.indexOf(x)===i}).sort(function(a,b){return a-b}),
    legend:legend,boxes:boxes,alert:al?al.textContent.trim():null,strip:${STRIPTEXT},
    lines:fl.data&&fl.data.map(function(a){return [a.state,a.species_group,a.total_animals,a.line_width_px]}),
    years:fl.years.map(String),quarters:fl.quarters.slice(),version:fl.version,timeIndex:fl.timeIndex,timeStep:fl.timeStep,
    label:document.getElementById('fl-time-label').textContent,slider:[document.getElementById('fl-time-slider').value,document.getElementById('fl-time-slider').max],
    pickersHidden:document.getElementById('fl-pickers').hidden,browseHidden:document.getElementById('fl-browse-block').hidden}})()`;
const CAMERA = H => `(function(){var m=${H}.map;return {c:m.getCenter().toArray(),z:m.getZoom(),b:m.getBearing(),p:m.getPitch()}})()`;
const sameCam = (a, b) => a && b && Math.abs(a.c[0] - b.c[0]) < 1e-9 && Math.abs(a.c[1] - b.c[1]) < 1e-9 && Math.abs(a.z - b.z) < 1e-9 && a.b === b.b && a.p === b.p;
// The WA view as the checks compare it before and after visiting Flow.
const WASTATE = `(function(){var s=CVIWA.state,m=s.mapHandle.map;return {circles:m.queryRenderedFeatures({layers:['circles','circles_dim','circles_spotlight']})
  .map(function(f){return f.properties.county+'|'+f.properties.direction+'|'+f.properties.amount+'|'+f.properties.radius_px}).sort().join(';'),
  data:JSON.stringify(s.data),boxes:document.getElementById('value-boxes').textContent.replace(/\\s+/g,' ').trim(),
  strip:${STRIPTEXT},legend:document.getElementById('legend-panel').textContent,
  filters:JSON.stringify([s.species,s.speciesSub,s.years,s.quarters,s.direction,s.mode,s.scaling,s.nBins,s.opacity,s.palette,s.periodMode,s.timeIndex]),
  cam:(function(){return {c:m.getCenter().toArray(),z:m.getZoom(),b:m.getBearing(),p:m.getPitch()}})(),version:s.version}})()`;
// A point on a drawn line where that line is the one on top (page coordinates), with the line's tooltip.
const HOVERPT = `(function(){var h=${FH},m=h.map,r=m.getCanvas().getBoundingClientRect();
      for(var i=h.drawn.length-1;i>=0;i--){var f=h.drawn[i],cs=f.geometry.coordinates;for(var k=20;k<cs.length-20;k+=7){var q=m.project(cs[k]);
        var x=Math.round(q.x+r.left),y=Math.round(q.y+r.top),pt=[x-r.left,y-r.top];   // the browser moves the pointer by whole pixels
        if(pt[0]<5||pt[1]<5||pt[0]>r.width-5||pt[1]>r.height-5)continue;var t=m.queryRenderedFeatures(pt,{layers:['flow_lines']});
        if(t.length&&t[0].id===f.id)return {x:x,y:y,id:f.id,tooltip:f.properties.tooltip,state:f.properties.state}}}return null})()`;
// The state labels as the map shows them: text, switched off, hidden for lack of room or behind the globe ("collided"),
// visibility, whether the point is behind the globe, and the box on screen.
const LABELREAD = `(function(){var h=${FH},m=h.map;return h.labels.map(function(k){var e=k.getElement(),r=e.getBoundingClientRect();
  return {t:e.textContent,off:e.classList.contains('hidden'),collided:e.classList.contains('collided'),vis:getComputedStyle(e).visibility,
    occluded:!!(m.transform.isLocationOccluded&&m.transform.isLocationOccluded(k.getLngLat())),box:[r.left,r.top,r.right,r.bottom]}})})()`;
const overlap = (a, b, pad) => a[0] - pad < b[2] + pad && b[0] - pad < a[2] + pad && a[1] - pad < b[3] + pad && b[1] - pad < a[3] + pad;
const stripText = st => st.state === 'summary' ? arr(st.items).map(i => i.label + i.text).join(' ').replace(/\s+/g, ' ').trim() : arr(st.lines)[0];

// One oracle view against what the page shows.
function compareView(g, v, id, noCvi, numcvi) {
  const L = arr(v.layers), fl = L.find(l => l.id === 'flow_lines'), wf = fl ? arr(fl.features) : [];
  check(g.drawn.length === wf.length, id + ': lines drawn', [g.drawn.length, wf.length]);
  // A line to Alaska or Hawaii goes to its inset box, the others on the map.
  const inset = s => s === 'AK' || s === 'HI';
  check(g.onMap.every(s => !inset(s)) && g.onMap.length + g.inInsets.length === g.drawn.length &&
    g.inInsets.length === g.drawn.filter(a => inset(a.state)).length, id + ': lines to Alaska and Hawaii in their ' +
    'boxes, the others on the map', [g.onMap.length, g.inInsets]);
  const bad = g.drawn.map((a, i) => [a, wf[i] || {}]).filter(([a, e]) => !(a.state === e.state && a.species_group === e.species_group
    && a.color === s11Color(v.inputs.flow_palette, e.species_group, e.color, !!v.inputs.flow_combine_species) && near(a.width, e.line_width_px, 1e-12) && a.tooltip === e.tooltip_text));
  check(!bad.length, id + ': each line (state, group, color, width, tooltip) in CVI\'s drawing order', bad.slice(0, 2));
  if (fl) {
    check(Array.isArray(g.op) && g.op[0] === 'case' && near(g.op[2], fl.hover_options.line_opacity, 1e-15) && near(g.op[3], fl.paint['line-opacity'], 1e-15),
      id + ': line opacity and hover opacity', [g.op, fl.paint['line-opacity'], fl.hover_options]);
    check(JSON.stringify(g.rendered) === JSON.stringify(g.ids.slice().sort((a, b) => a - b)), id + ': every line rendered on the map', [g.rendered.length, g.ids.length]);
  }
  // Legend (deliberate difference: with Combine species the swatch takes the lines' color; CVI's is gray).
  const wl = v.legend;
  if (wl.state === 'message') check(g.legend.none === 'No data loaded', id + ': legend "No data loaded"', g.legend);
  else {
    const ws = arr(wl.species), ww = arr(wl.widths), combine = !!v.inputs.flow_combine_species;
    const swatch = (s, e, i) => s.label === e.label && s.w === '20px' && s.h === '3px'
      && s.color === (combine ? rgbOf(wf[0] ? s11Color(v.inputs.flow_palette, wf[0].species_group, wf[0].color, true) : '#000000') : rgbOf(s11Color(v.inputs.flow_palette, e.label, e.color, false))) && (!combine || e.color === '#999999');
    check(!!g.legend.species && g.legend.species.length === ws.length && g.legend.species.every((s, i) => swatch(s, ws[i] || {}, i)),
      id + ': legend species swatches' + (combine ? ' (Combine species: the lines\' color)' : ''), [g.legend.species, ws]);
    check(g.legend.widths.length === ww.length && g.legend.widths.every((x, i) => x.px === ww[i].px && x.label === ww[i].label && x.w === '28px')
      && JSON.stringify(g.legend.heads) === JSON.stringify(['Species'].concat(wl.line_width_header ? ['Line width'] : [])), id + ': legend line widths and headings', [g.legend, ww]);
  }
  // Value boxes (deliberate difference: "Unique CVIs" grayed without a CVI column, CVI shows 0).
  const vb = v.value_boxes;
  if (vb.state === 'alert') check(g.alert !== null && g.alert === arr(vb.lines).join(' '), id + ': value boxes alert', [g.alert, vb.lines]);
  else {
    const wm = arr(vb.metrics);
    check(g.boxes.length === 4 && g.boxes.every((b, i) => b.label === wm[i].label && !b.tip && (i === 1 && (noCvi || numcvi)
      ? (noCvi ? b.gated && b.value === 'Needs the CVI column' && wm[i].text === '0' : !b.gated) : !b.gated && b.value === wm[i].text)),
      id + ': value boxes', [g.boxes, wm.map(m => [m.label, m.text])]);
  }
  check(g.strip === stripText(v.strip), id + ': strip', [g.strip, stripText(v.strip)]);
}

(async () => {
  fs.mkdirSync(path.join(OUT, 'screens'), { recursive: true });
  const DL = path.join(OUT, 'downloads');
  fs.rmSync(DL, { recursive: true, force: true }); fs.mkdirSync(DL, { recursive: true });
  const run = { started: new Date().toISOString(), page: PAGE_LABEL, stride: STRIDE, views: 0, frames: 0 };
  const oracles = fs.readdirSync(OUT).filter(f => /^oracle_s4_.*\.json$/.test(f) && f !== 'oracle_s4_arcs.json').sort()
    .map(f => JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8')));
  if (oracles.length < 9) { console.error('The S4 oracle files are missing: run Rscript tests/oracle/cvi_r_oracle.R s4 first.'); process.exit(2); }
  const O = name => oracles.find(o => o.meta.name === name);
  // The variant without rows that have exactly one end "WA" (both states present), as the oracle makes it.
  // Written from the fixture's own lines (the page's CSV reader decides which rows stay), so every kept row is unchanged.
  const s4csv = fs.readFileSync(FIXFILE(O('cvi_master_s4').meta.fixture), 'utf8'), parsed = SB.window.CVIWA.csv.parse(s4csv);
  const raw = s4csv.replace(/\r?\n$/, '').split(/\r?\n/), oi = parsed.header.indexOf('Origin.State'), di = parsed.header.indexOf('Dest.State');
  if (raw.length !== parsed.rows.length + 1) throw new Error('cvi_master_s4.csv: a row spans lines; the variant cannot be written line by line');
  const crossBorder = r => r[oi] !== null && r[di] !== null && ((r[oi] === 'WA') !== (r[di] === 'WA'));
  const NOFLOW = path.join(OUT, 'cvi_master_s4_noflow.csv');
  fs.writeFileSync(NOFLOW, [raw[0]].concat(raw.slice(1).filter((l, i) => !crossBorder(parsed.rows[i]))).join('\n') + '\n');
  // A variant whose one "constructor" row (F050, from WY) has a species group written as markup: the hover tooltip must
  // show it as text.
  const MARKUP = path.join(OUT, 'cvi_master_s4_markup.csv'), MARKUP_GROUP = '<b>Odd</b> group', gi = parsed.header.indexOf('Species.Group');
  const mrows = parsed.rows.map((r, i) => (r[gi] === 'constructor' ? i : -1)).filter(i => i >= 0);
  if (mrows.length !== 1 || raw[mrows[0] + 1].split(',')[gi] !== 'constructor') throw new Error('cvi_master_s4.csv: expected one plain "constructor" row');
  fs.writeFileSync(MARKUP, raw.map((l, i) => (i === mrows[0] + 1 ? l.split(',').map((x, j) => (j === gi ? MARKUP_GROUP : x)).join(',') : l)).join('\n') + '\n');

  const b = await launch(), p = b.page, log = b.log;
  run.chrome = b.version;
  const flowFileRequests = () => log.requests.filter(u => /\/geo\/us-states\.js$|\/geo\/state-centers\.js$|\/app\/flowmap\.js$/.test(u.split('?')[0]));
  const idleWA = () => p.waitFor(`${A}.map.loaded() && !${A}.map.isMoving()`, 15000, 'WA map idle').then(() => sleep(120));
  const idleF = () => p.waitFor(`${FH} && ${FH}.ready && ${FH}.map.loaded() && !${FH}.map.isMoving()`, 15000, 'Flow map idle').then(() => sleep(120));
  const load = async (file, view) => {
    const v0 = await p.eval('CVIWA.flowState.version');
    await p.setFiles('#file-input', [file]);
    await p.waitFor(`!CVIWA.state.loading && CVIWA.state.master`, 15000, 'data loaded');
    if (view === 'flow') await p.waitFor(`CVIWA.flowState.version > ${v0}`, 10000, 'flow recomputed');
    await sleep(350);
  };
  // CVI's oracle also sets "Refine by species" picks its list does not offer (a raw species of another group, or none of
  // the file's); the page's ticked list cannot take those, so such views are left to the unit suite ('not offered').
  const setFlow = async inputs => {
    const v0 = await p.eval(`window.__setFlow(${JSON.stringify(inputs)})`);
    if (v0 === 'not offered') return v0;
    await p.waitFor(`CVIWA.flowState.version > ${v0}`, 10000, 'flow recomputed');
    await sleep(30);
    await idleF();
    return p.eval(FLOWREAD);
  };
  const shot = async name => { await p.capture(path.join(OUT, 'screens', name + '.png')); };
  try {
    await p.goto(PAGE);
    await p.waitFor(`window.CVIWA && CVIWA.state && ${A} && ${A}.ready`, 20000, 'map ready');
    await p.eval(SETFLOW);

    // 1. The page opens on WA State; nothing of the Flow view is loaded.
    let ui = await p.eval(`(function(){var q=function(id){return document.getElementById(id)};return {pressed:[].map.call(document.querySelectorAll('.map-toggle-group [data-view]'),function(b){return [b.textContent.trim(),b.getAttribute('aria-pressed'),b.title]}),
      group:document.querySelector('.map-toggle-group').getAttribute('aria-label'),first:document.querySelector('#maps-view-block').firstElementChild.textContent,switchFirst:document.querySelector('aside.sidebar').firstElementChild.classList.contains('tool-switch'),
      waF:q('wa-filters').hidden,flF:q('flow-filters').hidden,waS:q('wa-style').hidden,flS:q('flow-style').hidden,frame:q('flow-frame').hidden,maps:q('maps').hidden,
      flowMap:!!CVIWA.state.flowHandle,flowmapJs:!!CVIWA.flowmap,states:!!window.WSDA_US_STATES,centers:!!window.WSDA_STATE_CENTERS,
      browseDisabled:q('fl-browse').disabled,browseReason:q('fl-browse').closest('[data-feature]').classList.contains('gated')}})()`);
    // Only the views that exist: since S5 County Focus as well, in CVI's order. Since S11 the sidebar starts with the
    // Maps / Premise Lookup switch, and Map View heads the Maps side under it.
    check(JSON.stringify(ui.pressed.map(x => x.slice(0, 2))) === JSON.stringify([['WA State', 'true'], ['County Focus', 'false'], ['National Flow', 'false']]) && ui.group === 'Map view' && ui.first === 'Map View' && ui.switchFirst,
      'Map View: the built views only (County Focus since S5), WA pressed, at the top of the sidebar', ui);
    check(ui.pressed[0][2] === 'Graduated circles per WA county sized by total animals (Inbound and/or Outbound).'
      && ui.pressed[2][2] === 'Curved flow lines between WA and other US states — line width scales with animal volume.', 'Map View: CVI\'s hover texts', ui.pressed);
    // S1.1: the palette help names WSDA Brand and the guide (CVI: "WSDA Default uses brand colors.").
    const palHelp = await p.eval(`[document.querySelector('button.tip[data-help="fl-palette"]').title, document.getElementById('help-fl-palette').textContent]`);
    // The help notes reworded in the brand guide's voice; S1.1's sentence kept.
    check(palHelp.every(t => t === 'Colors for the circles and lines. WSDA Brand uses colors from the WSDA brand guide. A "Single — …" palette uses one color for every species, useful with Combine species on the National Flow map.'),
      'Flow palette help: "WSDA Brand uses colors from the WSDA brand guide." (S1.1; reworded in the brand guide\'s voice)', palHelp);
    check(!ui.waF && ui.flF && !ui.waS && ui.flS && ui.frame && !ui.maps, 'page opens: WA filters, style and map shown; Flow\'s hidden', ui);
    check(!ui.flowMap && !ui.flowmapJs && !ui.states && !ui.centers && !flowFileRequests().length, 'page opens: no Flow map, no flowmap.js, no state outlines or centers loaded', flowFileRequests());
    check(ui.browseDisabled && ui.browseReason, 'no master: Flow\'s Browse grayed (needs the master table)', ui);

    // 2. The WA view with the S4 fixture, as it is before Flow is visited (the camera moved a little first).
    await load(FIXFILE('tests/synthetic/cvi_master_s4.csv'), 'wa');
    await idleWA();
    await p.drag(700, 500, -60, 40); await idleWA();
    const wa0 = await p.eval(WASTATE);
    check(wa0.circles.length > 0, 'WA view: circles drawn with the S4 fixture');

    // 3. National Flow chosen: its files load once; the map on a globe at CVI's opening view; labels and lines.
    await p.eval(`document.getElementById('show-flow').click()`);
    await p.waitFor(`${FH} && ${FH}.ready`, 20000, 'flow map ready'); await idleF();
    ui = await p.eval(`(function(){var q=function(id){return document.getElementById(id)},h=${FH},m=h.map;return {pressed:[].map.call(document.querySelectorAll('.map-toggle-group [data-view]'),function(b){return b.getAttribute('aria-pressed')}),
      waF:q('wa-filters').hidden,flF:q('flow-filters').hidden,waS:q('wa-style').hidden,flS:q('flow-style').hidden,frame:q('flow-frame').hidden,maps:q('maps').hidden,
      proj:m.getProjection&&m.getProjection(),style:m.getStyle().projection,center:m.getCenter().toArray(),zoom:m.getZoom(),status:q('flow-status').hidden,
      layers:m.getStyle().layers.map(function(l){return l.id}),sl:[m.getPaintProperty('state-lines','line-color'),m.getPaintProperty('state-lines','line-width'),m.getPaintProperty('state-lines','line-opacity'),m.getLayoutProperty('state-lines','visibility')],
      land:m.getPaintProperty('us-land','fill-color'),bg:m.getPaintProperty('background','background-color'),
      cap:[m.getLayoutProperty('flow_lines','line-cap'),m.getLayoutProperty('flow_lines','line-join')],
      paint:[m.getPaintProperty('flow_lines','line-color'),m.getPaintProperty('flow_lines','line-width')],
      nav:!!m.getContainer().querySelector('.maplibregl-ctrl-top-left .maplibregl-ctrl-zoom-in'),fit:(function(b){return b?[b.title,!!b.previousElementSibling&&b.previousElementSibling.classList.contains('maplibregl-ctrl-zoom-out')]:null})(m.getContainer().querySelector('.maplibregl-ctrl-top-left .map-fit')),
      cam:!!m.getContainer().querySelector('.maplibregl-ctrl-top-right .map-screenshot'),
      labels:h.labels.map(function(k){var e=k.getElement(),p=m.project(k.getLngLat()),r=e.getBoundingClientRect(),c=m.getContainer().getBoundingClientRect();
        return [e.textContent,k.getLngLat().lng,k.getLngLat().lat,e.classList.contains('hidden'),Math.abs(r.left+r.width/2-c.left-p.x)<2&&Math.abs(r.top+r.height/2-c.top-p.y)<2,getComputedStyle(e).fontSize,getComputedStyle(e).color]}),
      attrib:(function(a){return a?a.textContent.replace(/\\s+/g,' ').trim():null})(m.getContainer().querySelector('.maplibregl-ctrl-attrib-inner')),
      blocked:h.blocked.length,sources:Object.keys(m.getStyle().sources),glyphs:m.getStyle().glyphs||null,sprite:m.getStyle().sprite||null}})()`);
    check(JSON.stringify(ui.pressed) === '["false","false","true"]' && ui.waF && !ui.flF && ui.waS && !ui.flS && !ui.frame && ui.maps,
      'Map View: National Flow pressed; Flow filters, style and map shown, WA\'s hidden', ui);
    check(ui.proj && ui.proj.type === 'globe' && ui.style && ui.style.type === 'globe', 'Flow map on a globe (CVI\'s projection)', [ui.proj, ui.style]);
    check(ui.center[0] === -96 && ui.center[1] === 39.5 && ui.zoom === 3.6 && ui.status, 'Flow map: CVI\'s opening view (-96, 39.5), zoom 3.6', [ui.center, ui.zoom]);
    check(JSON.stringify(ui.layers) === '["background","us-land","state-lines","flow_lines"]' && ui.land === '#ececec' && ui.bg === '#f8f9fa',
      'Flow map: offline land (Census outlines, #ececec) on the page background, then state lines, then the flow lines', ui.layers);
    check(JSON.stringify(ui.sl) === '["#888888",0.6,0.6,"visible"]' && JSON.stringify(ui.cap) === '["round","round"]', 'state lines #888888 0.6 px 0.6, on; lines with round caps and joins', [ui.sl, ui.cap]);
    // Each line drawn in its own color and width (the features' properties checked per view below).
    check(JSON.stringify(ui.paint) === '[["get","color"],["get","width"]]', 'flow lines drawn with each line\'s own color and width', ui.paint);
    check(ui.nav && ui.fit && ui.fit[0] === 'Fit to Lower 48' && ui.fit[1] && ui.cam, 'navigation top left with the house button under "−" ("Fit to Lower 48"), screenshot top right', ui.fit);
    const wantLabels = CENTERS.filter(c => c.state !== 'AK' && c.state !== 'HI');
    check(ui.labels.length === 49 && ui.labels.every((l, i) => l[0] === wantLabels[i].state && Math.abs(l[1] - wantLabels[i].lon) < 1e-9 && Math.abs(l[2] - wantLabels[i].lat) < 1e-9 && !l[3] && l[4]
      && l[5] === '11px' && l[6] === 'rgb(85, 85, 85)'), 'state labels: 49 at CVI\'s centers (none for AK or HI), shown, 11 px #555555, placed on their point', ui.labels.filter((l, i) => !(l[0] === wantLabels[i].state && Math.abs(l[1] - wantLabels[i].lon) < 1e-9 && Math.abs(l[2] - wantLabels[i].lat) < 1e-9 && !l[3] && l[4])).concat([ui.labels[0]]).slice(0, 4));
    // Labels that would overlap are hidden, the larger state's kept.
    const AREA = new Map(JSON.parse(await p.eval(`JSON.stringify([...CVIWA.flow.stateAreas(window.WSDA_US_STATES)])`)));
    const labelCheck = (L, id) => {
      const shown = L.filter(l => !l.off && !l.collided), hid = L.filter(l => !l.off && l.collided), clash = [];
      shown.forEach((a, i) => shown.slice(i + 1).forEach(c => { if (overlap(a.box, c.box, 1)) clash.push(a.t + '/' + c.t); }));
      const why = hid.filter(l => !l.occluded && !shown.some(o => overlap(o.box, l.box, 3) && AREA.get(o.t) >= AREA.get(l.t)));
      check(!clash.length && !why.length && shown.every(l => l.vis === 'visible') && hid.every(l => l.vis === 'hidden'),
        id + ': no two shown labels overlap; each hidden one would overlap a shown label of a larger state, or is behind the globe', { clash, why: why.map(l => l.t) });
      return { shown: shown.map(l => l.t), hidden: hid.map(l => l.t) };
    };
    const lab0 = labelCheck(await p.eval(LABELREAD), 'labels at the opening view');
    check(lab0.hidden.length > 0 && lab0.shown.length >= 40 && lab0.shown.includes('MD') && lab0.hidden.includes('DC'), 'labels at the opening view: MD shown, DC hidden (no room), at least 40 shown', lab0);
    check(ui.attrib === 'Boundaries: U.S. Census Bureau' || /Boundaries: U\.S\. Census Bureau/.test(ui.attrib), 'Flow map credit: the Census boundaries', ui.attrib);
    check(ui.blocked === 0 && !ui.glyphs && !ui.sprite && JSON.stringify(ui.sources.sort()) === '["lines_source","state_lines_source"]', 'Flow map: inline sources only, no glyphs or sprite, nothing refused', ui);
    const ff1 = flowFileRequests();
    check(ff1.length === 3, 'first visit: flowmap.js, us-states.js and state-centers.js loaded once', ff1);
    await shot('flow_opening');

    // 4. Back to WA after changing Flow's filters, style and camera: the WA view as it was; then Flow again: its camera
    // and filters kept, no file loaded again; then back to the opening view.
    await p.eval(`(function(){var r=document.querySelector('input[name=fl-direction][value=outbound]');r.checked=true;r.dispatchEvent(new Event('change',{bubbles:true}));
      var s=document.getElementById('fl-palette');s.value='Muted';s.dispatchEvent(new Event('change',{bubbles:true}))})()`);
    await sleep(450);
    await p.drag(800, 450, 90, 30); await idleF();
    const cFlow = await p.eval(CAMERA(FH)), flBefore = await p.eval(`JSON.stringify([CVIWA.flowState.direction,CVIWA.flowState.palette,CVIWA.flowState.species,CVIWA.flowState.combine])`);
    await p.eval(`document.getElementById('show-wa').click()`); await idleWA();
    const wa1 = await p.eval(WASTATE);
    check(wa1.circles === wa0.circles && wa1.data === wa0.data && wa1.boxes === wa0.boxes && wa1.strip === wa0.strip && wa1.legend === wa0.legend && wa1.filters === wa0.filters,
      'WA view after visiting Flow: circles, data, boxes, strip, legend and filters unchanged', [wa0.boxes, wa1.boxes, wa0.filters, wa1.filters]);
    check(sameCam(wa0.cam, wa1.cam), 'WA view after visiting Flow: camera unchanged', [wa0.cam, wa1.cam]);
    ui = await p.eval(`(function(){var q=function(id){return document.getElementById(id)};return {waF:q('wa-filters').hidden,flF:q('flow-filters').hidden,frame:q('flow-frame').hidden,maps:q('maps').hidden,
      pressed:[].map.call(document.querySelectorAll('.map-toggle-group [data-view]'),function(b){return b.getAttribute('aria-pressed')})}})()`);
    check(!ui.waF && ui.flF && ui.frame && !ui.maps && JSON.stringify(ui.pressed) === '["true","false","false"]', 'Map View back to WA State', ui);
    await p.eval(`document.getElementById('show-flow').click()`); await idleF();
    check(sameCam(cFlow, await p.eval(CAMERA(FH))) && flBefore === await p.eval(`JSON.stringify([CVIWA.flowState.direction,CVIWA.flowState.palette,CVIWA.flowState.species,CVIWA.flowState.combine])`),
      'Flow again: its camera and filters kept');
    check(flowFileRequests().length === 3, 'Flow again: no Flow file loaded a second time', flowFileRequests().length);
    // One legend open state for both views, as CVI's single legend panel.
    const LEG = `({wa:[!document.getElementById('legend-panel').hidden,document.getElementById('legend-toggle').getAttribute('aria-expanded')],
      flow:[!document.getElementById('legend-panel-flow').hidden,document.getElementById('legend-toggle-flow').getAttribute('aria-expanded')]})`;
    const lg0 = await p.eval(LEG);
    await p.eval(`document.getElementById('legend-toggle-flow').click()`);
    const lg1 = await p.eval(LEG);
    await p.eval(`document.getElementById('show-wa').click()`); await idleWA();
    const lg2 = await p.eval(LEG);
    await p.eval(`document.getElementById('legend-toggle').click(); document.getElementById('show-flow').click()`); await idleF();
    const lg3 = await p.eval(LEG), lgC = { wa: [false, 'false'], flow: [false, 'false'] }, lgO = { wa: [true, 'true'], flow: [true, 'true'] };
    check(JSON.stringify([lg0, lg1, lg2, lg3]) === JSON.stringify([lgC, lgO, lgO, lgC]), 'legend: one open state for both views (opened on Flow, open on WA; closed on WA, closed on Flow)', [lg0, lg1, lg2, lg3]);
    await p.eval(`document.getElementById('fit-conus').click()`); await idleF();


    // 5. Every oracle view: the page's controls set as CVI's inputs, then lines, legend, boxes and strip as CVI's.
    const order = ['cvi_master_s4'].concat(oracles.map(o => o.meta.name).filter(n => n !== 'cvi_master_s4' && n !== 'cvi_master_s4_noflow'));
    for (const name of order) {
      const o = O(name);
      if (name !== 'cvi_master_s4') await load(FIXFILE(o.meta.fixture), 'flow');
      const hdr = (await p.eval('CVIWA.state.master.header')) || [];
      const noCvi = hdr.indexOf('CVI') < 0, numcvi = name === 'cvi_master_s2_numcvi';
      for (let k = 0; k < o.views.length; k++) {
        if (name !== 'cvi_master_s4' && k % STRIDE) continue;
        const v = o.views[k], id = name + ' #' + k + ' ' + v.scenario + ' ' + v.inputs.flow_direction + (v.inputs.flow_combine_species ? ' combine' : '');
        let g;
        try { g = await setFlow(v.inputs); } catch (e) { check(false, id + ': controls set', e.message); continue; }
        if (g === 'not offered') { run.skipped = (run.skipped || 0) + 1; continue; }   // a refine pick the page's list does not offer
        run.views++;
        compareView(g, v, id, noCvi, numcvi);
      }
    }
    check(run.views > 300, 'views compared in the browser', run.views);

    // 6. Hover, camera, toggles and fit (S4 fixture, Combined, species lines).
    await load(FIXFILE('tests/synthetic/cvi_master_s4.csv'), 'flow');
    const base = O('cvi_master_s4').views.find(v => v.inputs.flow_direction === 'combined' && !v.inputs.flow_combine_species && arr(v.inputs.flow_species_sub).length === 0
      && arr(v.inputs.flow_year).length === 3) || O('cvi_master_s4').views[0];
    let g = await setFlow(base.inputs);
    check(g.drawn.length > 3, 'hover setup: lines drawn', g.drawn.length);
    // A point on a line where that line is the one on top.
    const hv = await p.eval(HOVERPT);
    check(!!hv, 'hover: a point on a line found');
    if (hv) {
      await p.mouse(hv.x, hv.y); await sleep(250);
      const h1 = await p.eval(`(function(){var h=${FH},pc=document.querySelector('#flow-map .maplibregl-popup-content');
        return {hover:h.hover,state:h.map.getFeatureState({source:'lines_source',id:${hv.id}}),text:pc?pc.textContent:null,strong:pc&&pc.querySelector('strong')?pc.querySelector('strong').textContent:null,
          tags:pc?[].map.call(pc.querySelectorAll('*'),function(e){return e.tagName}).filter(function(t,i,a){return a.indexOf(t)===i}).sort():null,brs:pc?pc.querySelectorAll('br').length:0,cursor:h.map.getCanvas().style.cursor}})()`);
      const plain = hv.tooltip.replace(/<strong>|<\/strong>|<br\/>/g, '');
      check(h1.hover === hv.id && h1.state.hover === true && h1.cursor === 'pointer', 'hover: the line under the pointer is hovered (its opacity raised)', h1);
      check(h1.text === plain && h1.strong === hv.state && h1.brs === (hv.tooltip.match(/<br\/>/g) || []).length
        && JSON.stringify(h1.tags.filter(t => t !== 'DIV')) === JSON.stringify(['BR', 'STRONG'].filter(t => hv.tooltip.indexOf(t === 'BR' ? '<br/>' : '<strong>') >= 0)),
        'hover: CVI\'s tooltip text, its state in bold, its line breaks', [h1, hv.tooltip]);
      await p.mouse(5, 990); await sleep(150);
      await p.mouse(1380, 980); await sleep(200);
      const h2 = await p.eval(`({hover:${FH}.hover,popup:!!document.querySelector('#flow-map .maplibregl-popup')})`);
      check(h2.hover === null && !h2.popup, 'hover: off the lines, no tooltip and no hovered line', h2);
    }
    const tn = await p.eval(`(function(){var n=CVIWA.flowmap.tooltipNode('<strong>X&amp;</strong><br/><img src=x onerror=1>Cattle: 5<br/><b>y</b>');
      return {img:!!n.querySelector('img'),b:!!n.querySelector('b'),tags:[].map.call(n.querySelectorAll('*'),function(e){return e.tagName}),text:n.textContent}})()`);
    check(!tn.img && !tn.b && JSON.stringify(tn.tags) === '["STRONG","BR","BR"]' && tn.text === 'X&amp;<img src=x onerror=1>Cattle: 5<b>y</b>',
      'tooltip: names from the file are text (only CVI\'s <strong> and <br/> become markup)', tn);

    // Camera kept on filter and style changes; labels and lines switched live; fit and the house button.
    await p.drag(800, 450, 120, -70); await idleF();
    const c0 = await p.eval(CAMERA(FH));
    check(!(c0.c[0] === -96 && c0.c[1] === 39.5), 'Flow map moved by a drag', c0);
    await p.eval(`(function(){var r=document.querySelector('input[name=fl-direction][value=outbound]');r.checked=true;r.dispatchEvent(new Event('change',{bubbles:true}));
      var s=document.getElementById('fl-palette');s.value='Muted';s.dispatchEvent(new Event('change',{bubbles:true}))})()`);
    await sleep(500); await idleF();
    const c1 = await p.eval(CAMERA(FH));
    check(sameCam(c0, c1), 'camera kept on a filter and a style change (CVI snaps back; deliberate difference)', [c0, c1]);
    const lv0 = await p.eval(`CVIWA.flowState.version`);
    await p.eval(`document.getElementById('fl-labels').click(); document.getElementById('fl-lines').click()`);
    await sleep(350); await idleF();
    let tg = await p.eval(`(function(){var h=${FH};return {hidden:h.labels.filter(function(k){return k.getElement().classList.contains('hidden')}).length,
      vis:h.map.getLayoutProperty('state-lines','visibility'),version:CVIWA.flowState.version,rendered:h.map.queryRenderedFeatures({layers:['state-lines']}).length}})()`);
    check(tg.hidden === 49 && tg.vis === 'none' && tg.version === lv0 && tg.rendered === 0, 'state labels and lines off: live, nothing recomputed', tg);
    await p.eval(`document.getElementById('fl-labels').click(); document.getElementById('fl-lines').click()`);
    await sleep(200); await idleF();
    tg = await p.eval(`(function(){var h=${FH};return {hidden:h.labels.filter(function(k){return k.getElement().classList.contains('hidden')}).length,vis:h.map.getLayoutProperty('state-lines','visibility'),rendered:h.map.queryRenderedFeatures({layers:['state-lines']}).length}})()`);
    check(tg.hidden === 0 && tg.vis === 'visible' && tg.rendered > 0, 'state labels and lines back on', tg);
    check(sameCam(c0, await p.eval(CAMERA(FH))), 'camera kept by the label and line switches');
    await p.eval(`void ${FH}.map.jumpTo({center:[-76.9,38.95],zoom:8})`); await idleF();
    const z8 = labelCheck(await p.eval(LABELREAD), 'labels at zoom 8 over Washington, DC');
    check(z8.shown.includes('MD') && z8.shown.includes('DC'), 'labels zoomed in: DC and MD both shown (room for both)', z8);
    await p.eval(`void ${FH}.map.jumpTo({center:[80,30],zoom:2})`); await idleF();
    const farL = await p.eval(LABELREAD), farShot = await p.eval(`CVIWA.flowmap.screenshot(${FH}).then(function(){return ${FH}.lastLabels.length})`);
    check(farL.every(l => l.occluded && l.collided && l.vis === 'hidden') && farShot === 0, 'labels with the US on the far side of the globe: all hidden, none drawn in the screenshot',
      [farL.filter(l => !(l.occluded && l.collided)).map(l => l.t), farShot]);
    await p.eval(`document.getElementById('fit-conus').click()`); await idleF();
    let cf = await p.eval(CAMERA(FH));
    check(cf.c[0] === -96 && cf.c[1] === 39.5 && cf.z === 3.6 && cf.b === 0 && cf.p === 0, 'Fit to Lower 48: the opening view (CVI flies to zoom 4.01)', cf);
    await p.drag(800, 450, -150, 60); await idleF();
    await p.eval(`${FH}.map.getContainer().querySelector('.map-fit').click()`); await idleF();
    cf = await p.eval(CAMERA(FH));
    check(cf.c[0] === -96 && cf.c[1] === 39.5 && cf.z === 3.6, 'house button: the opening view', cf);
    // Each view's Fit button closes the Map Style section, below the population group.
    const fitBtn = await p.eval(`(function(){var b=document.getElementById('fit-conus'),pc=document.getElementById('pc-block');return [b.textContent,b.className,!!(pc.compareDocumentPosition(b)&Node.DOCUMENT_POSITION_FOLLOWING)&&b.getClientRects().length>0]})()`);
    check(fitBtn[0] === 'Fit to Lower 48' && fitBtn[2], '"Fit to Lower 48" at the end of the Map Style section', fitBtn);

    // 7. Browse (S4 fixture, default inputs) against CVI's: enter, every frame, the switch to years, leave; Play.
    await p.eval(`document.getElementById('reset-all').click()`);
    await sleep(500); await idleF();
    const ob = O('cvi_master_s4'), dom = ob.domains;
    let st = await p.eval(`({dom:CVIWA.flowState.dom,timeIndex:CVIWA.flowState.timeIndex,browse:CVIWA.flowState.browse})`);
    check(JSON.stringify(st.dom.quarter) === JSON.stringify(arr(dom.quarter)) && JSON.stringify(st.dom.year) === JSON.stringify(arr(dom.year)),
      'Browse: the Flow slider\'s periods as CVI\'s (rows with exactly one end WA)', st.dom);
    check(st.timeIndex === Number(ob.slider_load.value) && !st.browse, 'Browse: slider in the middle after loading, as CVI\'s', [st.timeIndex, ob.slider_load]);
    await p.eval(`document.getElementById('fl-browse').click()`); await sleep(450); await idleF();
    g = await p.eval(FLOWREAD);
    const en = ob.browse.enter;
    const sameLines = (a, w) => (a === null ? [] : a).length === arr(w).length && (a || []).every((x, i) => x[0] === w[i].state && x[1] === w[i].species_group
      && x[2] === w[i].total_animals && near(x[3], w[i].line_width_px, 1e-12));
    check(JSON.stringify(g.years) === JSON.stringify(arr(en.years)) && JSON.stringify(g.quarters) === JSON.stringify(arr(en.quarters)) && g.label === en.label
      && g.slider[0] === String(en.slider) && g.pickersHidden && !g.browseHidden, 'Browse on: the slider\'s period in the pickers (hidden), its label', [g.years, g.quarters, g.label, en]);
    check(sameLines(g.lines, en.lines) && g.strip === stripText(en.strip), 'Browse on: lines and strip as CVI\'s', [g.lines, en.lines, g.strip]);
    await p.drag(800, 450, 110, -50); await idleF();   // moved, so a snap back to the opening view would show
    const cB = await p.eval(CAMERA(FH));
    const frames = arr(ob.browse.frames), ys = ob.browse.year_switch;
    for (const fr of frames) {
      if (fr.step === 'year' && g.timeStep !== 'year') {
        await p.eval(`(function(){var r=document.querySelector('input[name=fl-time-step][value=year]');r.checked=true;r.dispatchEvent(new Event('change',{bubbles:true}))})()`);
        await sleep(450); await idleF();
        g = await p.eval(FLOWREAD);
        check(g.timeStep === 'year' && g.slider[0] === String(ys.slider) && g.slider[1] === String(arr(dom.year).length) && g.label === ys.label
          && JSON.stringify(g.years) === JSON.stringify(arr(ys.years)) && JSON.stringify(g.quarters) === JSON.stringify(arr(ys.quarters)) && sameLines(g.lines, ys.lines),
          'Browse, switch to years: slider rescaled, the middle year with all quarters, its lines', [g.slider, g.label, g.years, ys]);
      }
      await p.eval(`(function(){var s=document.getElementById('fl-time-slider');s.value='${fr.index}';s.dispatchEvent(new Event('input',{bubbles:true}))})()`);
      await sleep(330); await idleF();
      g = await p.eval(FLOWREAD);
      run.frames++;
      const id = 'Browse ' + fr.step + ' ' + fr.index;
      check(JSON.stringify(g.years) === JSON.stringify(arr(fr.years)) && JSON.stringify(g.quarters) === JSON.stringify(arr(fr.quarters)) && g.label === fr.label,
        id + ': pickers and label', [g.years, g.quarters, g.label, fr.years, fr.quarters, fr.label]);
      check(sameLines(g.lines, fr.lines) && g.strip === stripText(fr.strip), id + ': lines and strip', [g.lines, fr.lines, g.strip]);
      const wm = arr(fr.value_boxes.metrics);
      check(fr.value_boxes.state !== 'metrics' || g.boxes.every((x, i) => x.value === wm[i].text), id + ': value boxes', [g.boxes, wm]);
    }
    const c2 = await p.eval(CAMERA(FH));
    check(!(cB.c[0] === -96 && cB.c[1] === 39.5) && sameCam(cB, c2), 'Browse: the camera stays between frames (moved by a drag after entering Browse)', [cB, c2]);
    await p.eval(`document.getElementById('fit-conus').click()`); await idleF();
    await p.eval(`document.getElementById('fl-browse').click()`); await sleep(450); await idleF();
    g = await p.eval(FLOWREAD);
    check(JSON.stringify(g.years) === JSON.stringify(arr(ob.browse.leave.years)) && JSON.stringify(g.quarters) === JSON.stringify(arr(ob.browse.leave.quarters))
      && !g.pickersHidden && g.browseHidden, 'Browse off: the pickers shown, keeping the last frame (as CVI)', [g.years, g.quarters, ob.browse.leave]);
    // Play (fast): from the second-to-last year, one step, then stopped at the last.
    await p.eval(`(function(){document.getElementById('fl-browse').click();var s=document.getElementById('fl-time-speed');s.value='2500';s.dispatchEvent(new Event('change',{bubbles:true}));
      var sl=document.getElementById('fl-time-slider');sl.value=String(Number(sl.max)-1);sl.dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('fl-time-play').click()})()`);
    const pl0 = await p.eval(`({playing:CVIWA.flowState.playing,label:document.getElementById('fl-time-play').getAttribute('aria-label'),i:CVIWA.flowState.timeIndex})`);
    await sleep(2900);
    const pl1 = await p.eval(`({playing:CVIWA.flowState.playing,label:document.getElementById('fl-time-play').getAttribute('aria-label'),i:CVIWA.flowState.timeIndex,max:Number(document.getElementById('fl-time-slider').max),t:document.getElementById('fl-time-label').textContent})`);
    check(pl0.playing && pl0.label === 'Pause' && !pl1.playing && pl1.label === 'Play' && pl1.i === pl1.max && pl1.t === arr(dom.year).slice(-1)[0],
      'Play: one step per interval, stops on the last period (button reads Play)', [pl0, pl1]);
    // Play stops when the view is switched: Flow's on the way to WA, WA's on the way back.
    const PLAYING = `({flow:CVIWA.flowState.playing,wa:CVIWA.state.playing,flowBtn:document.getElementById('fl-time-play').getAttribute('aria-label'),waBtn:document.getElementById('time-play').getAttribute('aria-label')})`;
    await p.eval(`(function(){var sl=document.getElementById('fl-time-slider');sl.value='1';sl.dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('fl-time-play').click()})()`);
    const sw0 = await p.eval(PLAYING);
    await p.eval(`document.getElementById('show-wa').click()`); await idleWA();
    const sw1 = await p.eval(PLAYING);
    await p.eval(`(function(){var r=document.querySelector('input[name=period-mode][value=browse]');r.checked=true;r.dispatchEvent(new Event('change',{bubbles:true}));document.getElementById('time-play').click()})()`);
    const sw2 = await p.eval(PLAYING);
    await p.eval(`document.getElementById('show-flow').click()`); await idleF();
    const sw3 = await p.eval(PLAYING);
    check(sw0.flow && !sw1.flow && sw1.flowBtn === 'Play' && sw2.wa && !sw3.wa && sw3.waBtn === 'Play' && !sw3.flow,
      'Play stops when the view is switched (Flow\'s on the way to WA, WA\'s on the way back)', [sw0, sw1, sw2, sw3]);

    // 8. Reset All (in the Flow view): both views' defaults; Browse off, slider, step and speed kept.
    await p.eval(`(function(){var c=document.getElementById('fl-combine');c.click();var s=document.getElementById('fl-scaling');s.value='log';s.dispatchEvent(new Event('change',{bubbles:true}));
      var m=document.getElementById('fl-mult');m.value='3.0';m.dispatchEvent(new Event('change',{bubbles:true}));document.getElementById('fl-labels').click();
      var r=document.querySelector('input[name=fl-direction][value=combined]');r.checked=true;r.dispatchEvent(new Event('change',{bubbles:true}))})()`);
    await sleep(400);
    const keep = await p.eval(`({i:CVIWA.flowState.timeIndex,step:CVIWA.flowState.timeStep,speed:CVIWA.flowState.speed})`);
    await p.eval(`document.getElementById('reset-all').click()`); await sleep(450); await idleF();
    const rs = await p.eval(`(function(){var f=CVIWA.flowState,q=function(id){return document.getElementById(id)};return {f:{direction:f.direction,species:f.species,speciesSub:f.speciesSub,years:f.years.map(String),quarters:f.quarters,
      combine:f.combine,scaling:f.scaling,nBins:f.nBins,opacity:f.opacity,multiplier:f.multiplier,palette:f.palette,labels:f.labels,lines:f.lines,browse:f.browse,i:f.timeIndex,step:f.timeStep,speed:f.speed},
      dom:{dir:document.querySelector('input[name=fl-direction]:checked').value,combine:q('fl-combine').checked,browse:q('fl-browse').checked,scaling:q('fl-scaling').value,bins:q('fl-bins').value,binsShown:!q('fl-bins-field').hidden,
        opacity:q('fl-opacity').value,mult:q('fl-mult').value,palette:q('fl-palette').value,labels:q('fl-labels').checked,lines:q('fl-lines').checked,pickers:!q('fl-pickers').hidden,speed:q('fl-time-speed').value},
      hiddenLabels:${FH}.labels.filter(function(k){return k.getElement().classList.contains('hidden')}).length,toast:q('flow-toast').textContent,waToast:q('toast').textContent,
      wa:[CVIWA.state.periodMode,CVIWA.state.scaling,CVIWA.state.palette]}})()`);
    const msg = {}; arr(ob.reset).forEach(m => { msg[m.id] = m.msg.value !== undefined ? m.msg.value : m.msg.selected; });
    const wantR = { direction: msg.flow_direction, species: arr(msg.flow_species), speciesSub: arr(msg.flow_species_sub), years: arr(msg.flow_year), quarters: arr(msg.flow_quarter),
      combine: msg.flow_combine_species, scaling: msg.flow_scaling, nBins: Number(msg.flow_n_bins), opacity: msg.flow_opacity, multiplier: msg.flow_width_mult,
      palette: msg.flow_palette, labels: msg.show_state_labels, lines: msg.flow_show_state_lines };
    check(Object.keys(wantR).every(k => JSON.stringify(rs.f[k]) === JSON.stringify(wantR[k])), 'Reset All: the Flow values CVI\'s Reset All sends', [rs.f, wantR]);
    check(rs.f.browse === false && !rs.dom.browse && rs.dom.pickers && rs.f.i === keep.i && rs.f.step === keep.step && rs.f.speed === keep.speed && rs.dom.speed === String(keep.speed),
      'Reset All: Browse turned off, slider position, step and speed kept', [rs.f, keep]);
    check(rs.dom.dir === 'inbound' && rs.dom.combine && rs.dom.scaling === 'natural' && rs.dom.bins === '5' && rs.dom.binsShown && rs.dom.opacity === '0.8' && rs.dom.mult === '0.40'
      && rs.dom.palette === 'Single — WSDA Blue' && rs.dom.labels && rs.dom.lines && rs.hiddenLabels === 0, 'Reset All: the Flow controls show the defaults, state labels back on', rs.dom);
    check(rs.toast.indexOf('All filters reset.') >= 0 && rs.waToast.indexOf('All filters reset.') < 0 && rs.wa[0] === 'single' && rs.wa[1] === 'log' && rs.wa[2] === 'WSDA Default',
      'Reset All: "All filters reset." in the Flow view; the WA view reset too', rs);
    // Reset All from the WA view resets Flow too.
    await p.eval(`(function(){var s=document.getElementById('fl-palette');s.value='Muted';s.dispatchEvent(new Event('change',{bubbles:true}));document.getElementById('show-wa').click()})()`);
    await sleep(350);
    await p.eval(`document.getElementById('reset-all').click()`); await sleep(400);
    check(await p.eval(`CVIWA.flowState.palette === 'Single — WSDA Blue' && document.getElementById('fl-palette').value === 'Single — WSDA Blue'`), 'Reset All in the WA view resets the Flow view too');
    await p.eval(`document.getElementById('show-flow').click()`); await sleep(350); await idleF();

    // 9. CVI's warning for an empty result, in the Flow view only (not the WA map's).
    await p.eval(`document.getElementById('flow-toast').textContent=''; document.getElementById('toast').textContent=''`);
    await p.eval(`(function(){document.querySelector('[data-clear="flQuarters"]').click();var b=[].find.call(document.querySelectorAll('#fl-quarters input'),function(x){return x.value==='Q2'});
      b.checked=true;b.dispatchEvent(new Event('change',{bubbles:true}));var y=document.querySelector('[data-clear="flYears"]');y.click();
      var c=[].find.call(document.querySelectorAll('#fl-years input'),function(x){return x.value==='2025'});c.checked=true;c.dispatchEvent(new Event('change',{bubbles:true}))})()`);
    await sleep(450); await idleF();
    g = await p.eval(FLOWREAD);
    const tm = await p.eval(`({flow:document.getElementById('flow-toast').textContent,wa:document.getElementById('toast').textContent})`);
    check(g.drawn.length === 0 && tm.flow === 'No records match current flow map filters.' && tm.wa === '' && g.legend.none === 'No data loaded'
      && g.strip === 'No records match current filters.', 'empty result: CVI\'s warning in the Flow view, legend "No data loaded", the strip\'s line', [g.drawn.length, tm, g.strip]);
    await p.eval(`document.querySelector('[data-clear="flSpecies"]').click()`); await sleep(400);
    const tm2 = await p.eval(`({flow:document.getElementById('flow-toast').textContent})`);
    check(tm2.flow === 'No records match current flow map filters.', 'no species: nothing drawn and no second warning (CVI\'s req())', tm2);
    await p.eval(`document.getElementById('reset-all').click()`); await sleep(400); await idleF();

    // 10. Screenshot: saved from the click with the message; the picture has the lines, the labels and the credit.
    await p.downloadsTo(DL);
    await p.eval(`document.getElementById('flow-toast').textContent=''; ${FH}.map.getContainer().querySelector('.map-screenshot').click()`);
    let saved = null;
    for (let i = 0; i < 50 && !saved; i++) { await sleep(100); if (fs.existsSync(path.join(DL, 'map-screenshot.png'))) saved = fs.statSync(path.join(DL, 'map-screenshot.png')).size; }
    const sm = await p.eval(`({toast:document.getElementById('flow-toast').textContent,last:${FH}.lastScreenshot,labels:${FH}.lastLabels.slice(),attr:${FH}.lastAttribution})`);
    const shownNow = (await p.eval(LABELREAD)).filter(l => !l.off && !l.collided).map(l => l.t);
    check(saved > 1000 && sm.last && sm.last.bytes === saved && sm.toast === 'map-screenshot.png was handed to your browser to save (usually your Downloads folder). If no file appears, your browser or IT policy blocked the download.',
      'screenshot: map-screenshot.png saved from the click, with the message', [saved, sm]);
    check(sm.labels.length >= 40 && JSON.stringify(sm.labels.slice().sort()) === JSON.stringify(shownNow.slice().sort()) && /Boundaries: U\.S\. Census Bureau/.test(sm.attr),
      'screenshot: the state labels shown on the map (none hidden for lack of room) and the Census credit drawn', [sm.labels.length, shownNow.length, sm.attr]);
    const px = await p.eval(`CVIWA.flowmap.screenshot(${FH}).then(function(b){return createImageBitmap(b)}).then(function(i){var c=document.createElement('canvas');c.width=i.width;c.height=i.height;
      var g=c.getContext('2d');g.drawImage(i,0,0);var h=${FH},m=h.map,k=i.width/m.getCanvas().clientWidth,at=function(ll){var q=m.project(ll),d=g.getImageData(Math.round(q.x*k),Math.round(q.y*k),1,1).data;return [d[0],d[1],d[2]]};
      var wide=h.drawn[0];return {line:at(wide.geometry.coordinates[100]),color:wide.properties.color,land:at([-100.8,37.5]),corner:(function(){var d=g.getImageData(c.width-3,c.height-3,1,1).data;return [d[0],d[1],d[2]]})(),
      dark:(function(){var w=Math.round(200*k),hh=Math.round(14*k),d=g.getImageData(c.width-w,c.height-hh,w,hh).data,n=0;for(var j=0;j<d.length;j+=4)if(d[j]<110&&d[j+1]<110&&d[j+2]<110)n++;return n})()}})`);
    const lc = px.color ? [1, 3, 5].map(i => parseInt(px.color.slice(i, i + 2), 16)) : null;
    const blend = lc && lc.map((x, i) => Math.round(x * 0.8 + 236 * 0.2));
    check(blend && px.line.every((x, i) => Math.abs(x - blend[i]) <= 12), 'screenshot: the widest line in the picture (its color at 80% over the land)', [px.line, blend]);
    check(px.land.every(x => Math.abs(x - 236) <= 3), 'screenshot: offline land #ececec in the picture', px.land);
    // The credit band (white at 85% over the page background #f8f9fa) and its dark text, at the bottom right.
    check(px.corner.every(x => x >= 252) && px.dark > 20, 'screenshot: the credit drawn at the bottom right of the picture (white band, dark text)', [px.corner, px.dark]);
    await shot('flow_after_screenshot');

    // 11. A file without cross-border rows: the page's fallback to the file's own periods.
    await load(NOFLOW, 'flow');
    const nf = await p.eval(`({dom:CVIWA.flowState.dom,lines:CVIWA.flowState.data,drawn:${FH}.drawn.length})`), onf = O('cvi_master_s4_noflow');
    check(JSON.stringify(nf.dom.quarter) === JSON.stringify(arr(onf.domains.all_quarter)) && JSON.stringify(nf.dom.year) === JSON.stringify(arr(onf.domains.all_year))
      && JSON.stringify(arr(onf.domains.quarter)) === '["-"]', 'no cross-border rows: the slider falls back to the file\'s periods for both steps (CVI: "-" for quarters; recorded difference)', [nf.dom, onf.domains]);
    check(nf.lines === null && nf.drawn === 0, 'no cross-border rows: no line drawn', nf);

    // 11b. A species group written as markup in the file: the hover tooltip shows it as text (only CVI's <strong> and
    // <br/> are markup; CVI's map renders the text as HTML, a recorded difference).
    await load(MARKUP, 'flow');
    const myears = await p.eval('CVIWA.state.master.yearChoices.map(String)');
    g = await setFlow(Object.assign({}, base.inputs, { flow_direction: 'combined', flow_species: [MARKUP_GROUP], flow_species_sub: [], flow_year: myears,
      flow_quarter: ['Q1', 'Q2', 'Q3', 'Q4'], flow_combine_species: false }));
    const mk = g === 'not offered' ? null : await p.eval(HOVERPT);
    check(!!mk && g.drawn.length === 1 && g.drawn[0].species_group === MARKUP_GROUP, 'markup name: one line drawn for the group, a point on it found', g === 'not offered' ? g : g.drawn);
    if (mk) {
      await p.mouse(mk.x, mk.y); await sleep(250);
      const mp = await p.eval(`(function(){var pc=document.querySelector('#flow-map .maplibregl-popup-content');return pc?{text:pc.textContent,
        tags:[].map.call(pc.querySelectorAll('*'),function(e){return e.tagName}).filter(function(t,i,a){return a.indexOf(t)===i}).sort()}:null})()`);
      check(!!mp && mp.text === mk.tooltip.replace(/<strong>|<\/strong>|<br\/>/g, '') && mp.text.indexOf(MARKUP_GROUP) >= 0 && JSON.stringify(mp.tags.filter(t => t !== 'DIV')) === '["BR","STRONG"]',
        'hover: a species group written as markup in the file is shown as text in the tooltip', [mp, mk.tooltip]);
      await p.mouse(5, 990); await sleep(150);
    }

    // 12. Tiers: grayed controls and boxes per tier; the Flow view works in each.
    for (const [tier, file, wantRefine, wantCvi] of [['partner', 'local-test-artifacts/f1/tiers/partner/partner_county_totals.csv', false, false],
      ['public', 'local-test-artifacts/f1/tiers/public/CVI_Consolidated_Master.csv', true, false], ['full', 'local-test-artifacts/f1/tiers/full/CVI_Consolidated_Master.csv', true, true]]) {
      await load(FIXFILE(file), 'flow'); await idleF();
      const t = await p.eval(`(function(){var r=document.querySelector('#flow-filters [data-feature=species-refine]'),why=r.querySelector('[data-gate-reason]');
        return {refineGated:r.classList.contains('gated'),why:why.hidden?null:why.textContent,browse:!document.getElementById('fl-browse').disabled,
          cvi:(document.querySelectorAll('#value-boxes .metric')[1]||{}).className,drawn:${FH}.drawn.length}})()`);
      check(t.refineGated === !wantRefine && (wantRefine ? t.why === null : /Species/.test(t.why)) && t.browse && t.drawn > 0
        && /gated/.test(t.cvi) === !wantCvi, tier + ' tier: Flow lines drawn, Browse on, "Refine by species" ' + (wantRefine ? 'on' : 'grayed') + ', Unique CVIs ' + (wantCvi ? 'shown' : 'grayed'), t);
    }

    // 12b. A file loaded while the Flow view is on screen: the WA view then shows what a load in the WA view shows.
    await p.eval(`document.getElementById('show-wa').click()`); await idleWA();
    const waA = await p.eval(WASTATE);
    await load(FIXFILE('local-test-artifacts/f1/tiers/full/CVI_Consolidated_Master.csv'), 'wa'); await idleWA();
    const waB = await p.eval(WASTATE);
    check(waA.circles.length > 0 && waA.circles === waB.circles && waA.data === waB.data && waA.boxes === waB.boxes && waA.strip === waB.strip && waA.legend === waB.legend && waA.filters === waB.filters,
      'a file loaded in the Flow view: the WA view as after loading it in the WA view (circles, data, boxes, strip, legend, filters)', [waA.boxes, waB.boxes, waA.filters, waB.filters]);
    await p.eval(`document.getElementById('show-flow').click()`); await idleF();

    // 13. Nothing outside the site folder at any point; no exceptions, no CSP reports.
    run.outside = log.provider.length;
    check(log.provider.length === 0, 'no request outside the site folder', log.provider.slice(0, 5));
    check(!log.exceptions.length, 'no page exceptions', log.exceptions.slice(0, 3));
    check(!log.csp.length, 'no CSP reports', log.csp.slice(0, 3));
    check(await p.eval(`${FH}.blocked.length === 0`), 'the Flow map asked for nothing (no request refused)');

    // 14. Failure paths, each on a fresh page with the S4 fixture loaded in the WA view: a state
    // file that cannot be read, then a map that cannot be made (no WebGL).
    const failFlow = async prep => {
      await p.goto(PAGE);
      await p.waitFor(`window.CVIWA && CVIWA.state && ${A} && ${A}.ready`, 20000, 'map ready');
      await load(FIXFILE('tests/synthetic/cvi_master_s4.csv'), 'wa'); await idleWA();
      await p.eval(`void (${prep})`);
      await p.eval(`document.getElementById('show-flow').click()`);
      await p.waitFor(`document.getElementById('flow-status').className === 'status err'`, 15000, 'the Flow failure shown');
      await sleep(400);
      return p.eval(`(function(){var q=function(id){return document.getElementById(id)},a=q('value-boxes').querySelector('.vb-alert');
        return {status:q('flow-status').textContent,disabled:['fl-labels','fl-lines','legend-toggle-flow','fit-conus'].map(function(id){return q(id).disabled}),
          alert:a?a.textContent.trim():null,metrics:q('value-boxes').querySelectorAll('.metric').length,strip:${STRIPTEXT}}})()`);
    };
    const NOFILE = 'The National Flow map could not be loaded.';
    let fz = await failFlow(`Object.defineProperty(window,'WSDA_STATE_CENTERS',{configurable:true,get:function(){return undefined},set:function(){}})`);
    check(fz.status === 'The National Flow map could not be loaded (a state file is not readable). Reload this page to retry. The WA State map is unaffected.'
      && fz.disabled.every(Boolean) && fz.alert === 'The National Flow map could not be loaded, so there are no Flow numbers. Reload this page to retry.' && fz.strip === NOFILE,
      'a state file that cannot be read: the message, the Flow switches, legend and fit grayed, the boxes and strip say why', fz);
    await p.eval(`document.getElementById('show-wa').click()`); await idleWA();
    let wz = await p.eval(WASTATE);
    check(wz.circles.length > 0 && /Total animals/.test(wz.boxes), 'a state file that cannot be read: the WA map unaffected (circles and boxes)', wz.boxes);
    fz = await failFlow(`maplibregl.Map = function () { throw new Error('Failed to initialize WebGL (test)'); }`);
    check(fz.status === 'Map unavailable. The browser could not start or continue drawing the National Flow map. Reload this page to retry.'
      && fz.disabled.every(Boolean) && fz.metrics === 4 && fz.strip !== NOFILE && /Period/.test(fz.strip),
      'a Flow map that cannot be made (no WebGL): the "Map unavailable" message, the switches grayed, the boxes and strip still computed', fz);
    check(!log.exceptions.length && !log.provider.length && !log.csp.length, 'failure paths: no page exceptions, no request outside the site, no CSP reports',
      [log.exceptions.slice(0, 3), log.provider.slice(0, 3)]);
  } catch (e) {
    check(false, 'run completed', e.stack || e.message);
  } finally {
    await b.close();
  }
  run.pass = pass; run.fail = fail; run.failures = failures; run.finished = new Date().toISOString();
  fs.writeFileSync(path.join(OUT, 'browser_run.json'), JSON.stringify(run, null, 2));
  console.log('S4 browser (' + PAGE_LABEL + ', Chrome ' + (run.chrome || '?') + '): ' + pass + ' passed, ' + fail + ' failed; ' + run.views + ' oracle views ('
    + (run.skipped || 0) + ' left to the unit suite: refine picks the page does not offer), ' + run.frames + ' Browse frames; S1.1 guide colors expected ' + s11Colors);
  if (fail) { failures.slice(0, 30).forEach(f => console.log('FAIL ' + f)); if (failures.length > 30) console.log('... and ' + (failures.length - 30) + ' more'); }
  process.exit(fail ? 1 : 0);
})();
