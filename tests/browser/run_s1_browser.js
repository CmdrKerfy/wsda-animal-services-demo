#!/usr/bin/env node
'use strict';
// S1 browser test: opens site/cvi/index.html over file:// in the installed Google Chrome (headless,
// throw-away profile), loads the synthetic fixtures through the real file input, drives the controls and checks the
// page against CVI's R oracle (local-test-artifacts/s1/), plus rendering, toggles, hover, fit, messages and network.
// Usage (repository root): node tests/browser/run_s1_browser.js      (Node >= 22; Chrome installed; no packages)
// Optional: CHROME_BIN=<path to chrome>. Writes only local-test-artifacts/s1/browser_run.json (+ a temporary profile there,
// deleted on exit). No screenshots.
// S1.1 (deliberate differences from CVI): the legend's size circles against CVI's .compute_radius (the oracle's
// s1_1 part, oracle_s1_1.json), nested and uncapped; its swatches the circle color at the opacity over the land (by
// pixel); the Combined circle and its swatch in the palette's first color, for every palette.
const { spawn } = require('child_process');
const fs = require('fs'), path = require('path');
const { pathToFileURL, fileURLToPath } = require('url');
const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join(ROOT, 'local-test-artifacts', 's1');
// Optional S1_PAGE_URL: test another copy of the page (e.g. the published demo over https); fixtures still load from disk.
const PAGE = process.env.S1_PAGE_URL || pathToFileURL(path.join(ROOT, 'site', 'cvi', 'index.html')).href;
const PAGE_ORIGIN = /^https?:/.test(PAGE) ? new URL(PAGE).origin : null;
// The site's folder (one up from cvi/index.html): every request must stay inside it, not merely on its origin,
// which on GitHub Pages is shared with other sites.
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
    // One pixel of the page as drawn (a 1x1 PNG: its single row's filter has no neighbors, so the bytes are the color).
    async pixel(x, y) {
      const r = await send('Page.captureScreenshot', { format: 'png', clip: { x, y, width: 1, height: 1, scale: 1 } }, sid);
      const b = Buffer.from(r.data, 'base64'); let o = 8; const idat = [];
      while (o < b.length) { const len = b.readUInt32BE(o), t = b.toString('ascii', o + 4, o + 8); if (t === 'IDAT') idat.push(b.subarray(o + 8, o + 8 + len)); o += 12 + len; }
      const raw = require('zlib').inflateSync(Buffer.concat(idat));
      return '#' + [1, 2, 3].map(i => raw[i].toString(16).padStart(2, '0')).join('');
    }
  };
  return { version: ver.Browser, log, page, async close() { try { await send('Browser.close'); } catch (e) { /* closing */ } await exited(5000); killGroup(); await exited(2000); fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } };
}

// ---- checks ---------------------------------------------------------------------------------------------------
let pass = 0, fail = 0; const failures = [], notes = [];
const check = (ok, name, detail) => { if (ok) pass++; else { fail++; failures.push(name + (detail !== undefined ? ' :: ' + JSON.stringify(detail).slice(0, 600) : '')); } };
const arr = x => x === null || x === undefined ? [] : Array.isArray(x) ? x : [x];
const near = (a, b) => Math.abs(a - b) <= 1e-9;

const S11 = new Map();   // oracle_s1_1.json: "<file>#<view>" -> the legend radii by CVI's .compute_radius
const blend = (hex, t, under) => '#' + [1, 3, 5].map(i => Math.round(parseInt(hex.slice(i, i + 2), 16) * t + parseInt(under.slice(i, i + 2), 16) * (1 - t)).toString(16).padStart(2, '0')).join('');
const nearHex = (a, b) => [1, 3, 5].every(i => Math.abs(parseInt(a.slice(i, i + 2), 16) - parseInt(b.slice(i, i + 2), 16)) <= 1);
function oracleView(o, scenario, dir, mode, scaling, nBins) {
  return o.views.find(v => v.scenario === scenario && arr(v.filters.direction).join('+') === dir && v.mode === mode && v.scaling === scaling && v.n_bins === nBins);
}
function compareToOracle(name, st, ov) {
  const want = arr(ov.rows);
  check(st.data.length === want.length, name + ': circle count', [st.data.length, want.length]);
  for (const e of want) {
    const i = st.data.findIndex(x => x.county === e.county && x.direction === e.direction), g = st.data[i];
    check(g && g.total_animals === e.total_animals && g.lat === e.lat && g.lon === e.lon && near(g.radius_px, e.radius_px) && st.liveTooltips[i] === e.live_tooltip,
      name + ': ' + e.county + '/' + e.direction, { got: g && [g.total_animals, g.lat, g.lon, g.radius_px, st.liveTooltips[i]], want: [e.total_animals, e.lat, e.lon, e.radius_px, e.live_tooltip] });
  }
  const L = ov.legend, t = st.legend && st.legend.tiers;
  check((!L && !t) || (L && t && arr(L.values).length === t.values.length && arr(L.values).every((x, k) => near(x, t.values[k])) && arr(L.radii).every((x, k) => near(x, t.cviRadii[k]))), name + ': legend tiers (CVI\'s values and radii)', { page: t, r: L });
  // S1.1: the radii drawn are CVI's .compute_radius against the view's circles (oracle s1_1), no cap.
  if (L && t) {
    const want = S11.get(ov.__file + '#' + ov.__i), sz = st.legend.sizes;
    check(want && want.length === t.radii.length && want.every((x, k) => near(x, t.radii[k]) && near(x, sz[k].radius) && near(2 * x, sz[k].diameter_px)), name + ': legend radii as the map (S1.1)', { page: t.radii, want });
  }
}

(async () => {
  const oSmall = JSON.parse(fs.readFileSync(path.join(OUT, 'oracle_cvi_master_small.json'), 'utf8'));
  const oWa = JSON.parse(fs.readFileSync(path.join(OUT, 'oracle_cvi_master_wa39.json'), 'utf8'));
  [[oSmall, 'oracle_cvi_master_small.json'], [oWa, 'oracle_cvi_master_wa39.json']].forEach(([o, f]) => o.views.forEach((v, i) => { v.__file = f; v.__i = i + 1; }));
  JSON.parse(fs.readFileSync(path.join(OUT, 'oracle_s1_1.json'), 'utf8')).legend.forEach(e => S11.set(e.file + '#' + e.view, arr(e.radii)));
  const b = await launch(); const p = b.page;
  const run = { chrome: b.version, platform: process.platform, page: PAGE_LABEL, started: new Date().toISOString() };
  const getState = () => p.eval('JSON.parse(JSON.stringify({data: CVIWA.state.data, liveTooltips: CVIWA.state.liveTooltips, legend: CVIWA.state.legend, version: CVIWA.state.version, msg: CVIWA.state.lastMessage}))');
  const settle = async v0 => { await p.waitFor('!CVIWA.state.loading && CVIWA.state.version > ' + v0, 8000, 'recompute'); await sleep(320); await p.waitFor('CVIWA.state.mapHandle.map.loaded()', 8000, 'map idle'); return getState(); };
  const version = () => p.eval('CVIWA.state.version');
  const setSelect = async (id, value) => { const v0 = await version(); await p.eval(`(function(){var s=document.getElementById(${JSON.stringify(id)});s.value=${JSON.stringify(String(value))};s.dispatchEvent(new Event('change',{bubbles:true}))})()`); return settle(v0); };
  const click = async sel => { const v0 = await version(); await p.eval(`document.querySelector(${JSON.stringify(sel)}).click()`); return settle(v0); };
  try {
    // 1. Start-up
    const t0 = Date.now();
    await p.goto(PAGE);
    await p.waitFor('window.CVIWA && CVIWA.state && CVIWA.state.version >= 1 && CVIWA.state.mapHandle.ready', 20000, 'map ready');
    run.ms_to_map_ready = Date.now() - t0;
    check(await p.eval('!!document.querySelector("canvas.maplibregl-canvas")'), 'MapLibre WebGL canvas present');
    check(await p.eval('document.querySelectorAll(".county-label").length') === 39, '39 county labels (HTML markers)');
    check(await p.eval('document.querySelectorAll(".county-label:not(.hidden)").length') === 39, 'labels visible by default (zoom >= 5)');
    check(await p.eval('/No master dataset loaded/.test(document.getElementById("master-status").textContent)'), 'no-master status');

    // 2. Small fixture, defaults (all species/years, Q1-Q4, both directions, separate circles, log, 60%, WSDA Default)
    let v0 = await version();
    await p.setFiles('#file-input', [FIX('cvi_master_small.csv')]);
    let st = await settle(v0);
    check(await p.eval('/22 rows in the file; 25 map rows/.test(document.getElementById("master-status").textContent)'), 'status: physical vs map rows', await p.eval('document.getElementById("master-status").textContent'));
    compareToOracle('small default log', st, oracleView(oSmall, 'default', 'Inbound+Outbound', 'side_by_side', 'log', 5));
    const rendered = await p.eval(`(function(){var m=CVIWA.state.mapHandle.map;return m.queryRenderedFeatures({layers:['circles']}).map(function(f){return {c:f.properties.county,d:f.properties.direction,col:f.properties.color,r:f.properties.radius_px}})})()`);
    check(rendered.length === st.data.length, 'every circle rendered on screen', [rendered.length, st.data.length]);
    check(rendered.every(f => f.col === (f.d === 'Inbound' ? '#1C9CD9' : '#F0A06E')), 'WSDA Default colors on the map');
    check(rendered.every(f => { const g = st.data.find(x => x.county === f.c && x.direction === f.d); return g && Math.abs(g.radius_px - f.r) < 1e-9; }), 'rendered radii equal engine radii');
    check(JSON.stringify(st.legend.swatches.map(s => s.direction)) === '["Inbound","Outbound"]', 'legend direction order');
    check(await p.eval('/Inbound and outbound circles use separate scales/.test(document.getElementById("legend-panel").textContent)'), 'legend notes per-direction scaling');
    const opac = await p.eval('JSON.stringify(CVIWA.state.mapHandle.map.getPaintProperty("circles","circle-opacity"))');
    check(opac === JSON.stringify(['case', ['boolean', ['feature-state', 'hover'], false], 0.85, 0.6]), 'opacity 0.6, hover +0.25', opac);

    // 3. Every scaling method and bin count (small fixture), both modes
    for (const mode of ['side_by_side', 'total']) {
      if (mode === 'total') await click('input[name=mode][value=total]');
      for (const sc of ['log', 'sqrt', 'linear', 'quantile', 'natural']) {
        st = await setSelect('s-scaling', sc);
        const bins = (sc === 'quantile' || sc === 'natural') ? [3, 4, 5, 6, 7, 10] : [5];
        for (const nb of bins) {
          if (bins.length > 1) st = await setSelect('s-bins', nb);
          compareToOracle('small ' + mode + ' ' + sc + '/' + nb, st, oracleView(oSmall, 'default', 'Inbound+Outbound', mode, sc, nb));
        }
        if (bins.length > 1) st = await setSelect('s-bins', 5);
      }
    }
    check(await p.eval('!/Inbound and outbound circles use separate scales/.test(document.getElementById("legend-panel").textContent)'), 'no per-direction note in Total mode');
    // S1.1: the Combined circle in the palette's first color (CVI: #245566 whatever the palette), on the map and the legend.
    check(st.legend.swatches.length === 1 && st.legend.swatches[0].direction === 'Total' && st.legend.swatches[0].color === '#1C9CD9', 'Total swatch: WSDA Default\'s first color (S1.1)');
    check((await p.eval(`CVIWA.state.mapHandle.map.queryRenderedFeatures({layers:['circles']}).map(function(f){return f.properties.color})`)).every(c => c === '#1C9CD9'), 'Total circles: WSDA Default\'s first color (S1.1)');
    for (const name of await p.eval('[...document.querySelectorAll("#s-palette option")].map(function(o){return o.value})')) {
      st = await setSelect('s-palette', name);
      const P = JSON.parse(await p.eval(`JSON.stringify(CVIWA.palettes.DIRECTION_PALETTES[${JSON.stringify(name)}])`));
      const cols = await p.eval(`CVIWA.state.mapHandle.map.queryRenderedFeatures({layers:['circles']}).map(function(f){return f.properties.color})`);
      check(cols.length && cols.every(c => c === P.Inbound) && st.legend.swatches[0].color === P.Inbound
        && st.legend.swatches[0].shown === blend(P.Inbound, 0.6, '#ececec'), 'Total circles and swatch, the first color: ' + name, { cols: [...new Set(cols)], sw: st.legend.swatches, P });
    }
    st = await setSelect('s-palette', 'WSDA Default');
    st = await setSelect('s-scaling', 'log');
    st = await click('input[name=mode][value=side_by_side]');

    // 4. Direction = Inbound only (no offset), then back
    st = await click('input[name=direction][value=Outbound]');
    compareToOracle('small inbound-only', st, oracleView(oSmall, 'default', 'Inbound', 'side_by_side', 'log', 5));
    st = await click('input[name=direction][value=Outbound]');

    // 5. Species filters: Clear, Cattle only, refine Dairy cattle
    st = await click('[data-clear=species]');
    check(st.data.length === 0 && st.msg === null, 'cleared species: nothing drawn, no message (req)');
    v0 = await version();
    await p.eval('[...document.querySelectorAll("#f-species input")].find(function(x){return x.value==="Cattle"}).click()');
    st = await settle(v0);
    compareToOracle('small cattle', st, oracleView(oSmall, 'cattle', 'Inbound+Outbound', 'side_by_side', 'log', 5));
    v0 = await version();
    await p.eval('[...document.querySelectorAll("#f-species-sub input")].find(function(x){return x.value==="Dairy cattle"}).click()');
    st = await settle(v0);
    compareToOracle('small cattle refine Dairy', st, oracleView(oSmall, 'cattle_raw', 'Inbound+Outbound', 'side_by_side', 'log', 5));
    check(JSON.stringify(await p.eval('[...document.querySelectorAll("#f-species-sub input")].map(function(x){return x.value})')) === JSON.stringify(['Beef cattle', 'Beef cattle, cow-calf', 'Dairy cattle']), 'refine choices limited to selected group');
    st = await click('[data-all=species]');
    check(JSON.stringify(await p.eval('CVIWA.state.speciesSub')) === '["Dairy cattle"]', 'still-valid refine pick kept');
    v0 = await version();
    await p.eval('[...document.querySelectorAll("#f-species-sub input")].find(function(x){return x.value==="Dairy cattle"}).click()');
    st = await settle(v0);

    // 6. No-match message: quarter Q1 only + Equids only
    st = await click('[data-clear=quarters]');
    v0 = await version(); await p.eval('[...document.querySelectorAll("#f-quarters input")].find(function(x){return x.value==="Q1"}).click()'); st = await settle(v0);
    st = await click('[data-clear=species]');
    v0 = await version(); await p.eval('[...document.querySelectorAll("#f-species input")].find(function(x){return x.value==="Equids"}).click()'); st = await settle(v0);
    check(st.data.length === 0 && st.msg === 'No records match current county map filters.', 'no-match message', st.msg);
    check(await p.eval('/No data loaded/.test(document.getElementById("legend-panel").textContent)'), 'legend: No data loaded');
    st = await click('[data-all=quarters]'); st = await click('[data-all=species]');

    // 7. Palettes (8) and opacity
    for (const name of await p.eval('[...document.querySelectorAll("#s-palette option")].map(function(o){return o.value})')) {
      st = await setSelect('s-palette', name);
      const cols = await p.eval(`CVIWA.state.mapHandle.map.queryRenderedFeatures({layers:['circles']}).map(function(f){return f.properties.direction+'='+f.properties.color})`);
      const pal = await p.eval(`JSON.stringify(CVIWA.palettes.DIRECTION_PALETTES[${JSON.stringify(name)}])`);
      const P = JSON.parse(pal);
      check(cols.length && cols.every(c => { const [d, col] = c.split('='); return col === P[d]; }), 'palette applied: ' + name);
      check(st.legend.swatches.every(s => s.color === P[s.direction]), 'legend swatches: ' + name);
      // S1.1: each swatch drawn as the map draws the circles: the color at the opacity over the land.
      const bg = await p.eval('[...document.querySelectorAll("#legend-panel .lg-dot")].map(function(d){return getComputedStyle(d).backgroundColor})');
      const rgb = h => 'rgb(' + [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)).join(', ') + ')';
      check(st.legend.swatches.every((s, k) => s.land === '#ececec' && s.shown === blend(s.color, 0.6, '#ececec') && bg[k] === rgb(s.shown)), 'legend swatches drawn at 60% over the land: ' + name, { sw: st.legend.swatches, bg });
    }
    st = await setSelect('s-palette', 'WSDA Default');
    st = await setSelect('s-opacity', '1.0');
    check(await p.eval('JSON.stringify(CVIWA.state.mapHandle.map.getPaintProperty("circles","circle-opacity"))') === JSON.stringify(['case', ['boolean', ['feature-state', 'hover'], false], 1, 1]), 'opacity 100% (hover capped at 1)');
    st = await setSelect('s-opacity', '0.6');

    // 8. Toggles change visibility without recomputing data
    v0 = await version();
    await p.eval('document.getElementById("s-labels").click()'); await sleep(350);
    check(await p.eval('document.querySelectorAll(".county-label:not(.hidden)").length') === 0, 'labels hidden');
    await p.eval('document.getElementById("s-labels").click()'); await sleep(100);
    check(await p.eval('document.querySelectorAll(".county-label:not(.hidden)").length') === 39, 'labels shown again');
    // County lines start on (a deliberate difference: CVI starts with them off).
    check(await p.eval('CVIWA.state.mapHandle.map.getLayoutProperty("county-lines","visibility")') === 'visible', 'county lines on by default');
    await p.eval('document.getElementById("s-lines").click()'); await sleep(100);
    check(await p.eval('CVIWA.state.mapHandle.map.getLayoutProperty("county-lines","visibility")') === 'none', 'county lines off');
    await p.eval('document.getElementById("s-lines").click()'); await sleep(350);
    check(await version() === v0, 'toggles did not recompute the circles');

    // 9. Hover tooltip on the largest outbound circle (King, 2,500)
    const pt = await p.eval(`(function(){var m=CVIWA.state.mapHandle.map,d=CVIWA.state.data.find(function(x){return x.county==="King"&&x.direction==="Outbound"});var q=m.project([d.lon,d.lat]);var r=m.getContainer().getBoundingClientRect();return {x:q.x+r.left,y:q.y+r.top}})()`);
    await p.mouse(pt.x, pt.y); await sleep(400);
    const pop = await p.eval('(document.querySelector(".maplibregl-popup-content")||{}).textContent||null');
    check(pop && /^King\s*Outbound:\s*2,500 animals$/.test(pop.trim()), 'hover tooltip text', pop);
    check(await p.eval('JSON.stringify(CVIWA.state.mapHandle.map.getFeatureState({source:"circles_source",id:CVIWA.state.mapHandle.hoverId}))') === '{"hover":true}', 'hover state set');
    await p.mouse(5, 5); await sleep(200);

    // 10. Legend toggle and Fit to Washington
    check(await p.eval('document.getElementById("legend-panel").hidden'), 'legend collapsed by default');
    await p.eval('document.getElementById("legend-toggle").click()');
    check(await p.eval('!document.getElementById("legend-panel").hidden && document.getElementById("legend-toggle").getAttribute("aria-expanded")==="true"'), 'legend opens');
    // The open panel and toggle must remain inside the map, including after a laptop resize.
    for (const [width, height] of [[1400, 1000], [1366, 768], [1024, 600], [1400, 1000]]) {
      await p.resize(width, height); await sleep(200);
      const layout = await p.eval(`(() => {
        const rect = id => { const r=document.getElementById(id).getBoundingClientRect(); return {left:r.left,right:r.right,top:r.top,bottom:r.bottom}; };
        return {map:rect('map'),panel:rect('legend-panel'),toggle:rect('legend-toggle')};
      })()`);
      const inside = r => r.left >= layout.map.left && r.right <= layout.map.right && r.top >= layout.map.top && r.bottom <= layout.map.bottom;
      check(inside(layout.panel) && inside(layout.toggle), 'legend contained at ' + width + 'x' + height, layout);
      check(Math.abs(layout.map.bottom - layout.toggle.bottom - 10) < 1, 'legend bottom inset at ' + width + 'x' + height, layout);
    }
    // S1.1: the swatches by pixel (the legend's dots as drawn on screen) at 60% and 100%.
    const dotPixel = async k => { const c = await p.eval(`(function(){var r=document.querySelectorAll('#legend-panel .lg-dot')[${k}].getBoundingClientRect();return {x:Math.floor(r.left+r.width/2),y:Math.floor(r.top+r.height/2)}})()`); return p.pixel(c.x, c.y); };
    for (const op of ['0.6', '1.0']) {
      st = await setSelect('s-opacity', op);
      const px = [await dotPixel(0), await dotPixel(1)], want = ['#1C9CD9', '#F0A06E'].map(h => blend(h, Number(op), '#ececec'));
      check(px.every((x, k) => nearHex(x, want[k])), 'legend swatch pixels at ' + op + ' (S1.1)', { px, want });
    }
    st = await setSelect('s-opacity', '0.6');
    // S1.1: the size circles nested, at the radii of the legend, largest at the back, values beside them
    // at least 11 px apart; contained in the map with 10 bins on a short window; no cap.
    st = await setSelect('s-scaling', 'natural'); st = await setSelect('s-bins', 10);
    for (const [width, height] of [[1024, 600], [1400, 1000]]) {
      await p.resize(width, height); await sleep(250);
      const g = await p.eval(`(function(){var P=document.getElementById('legend-panel'),M=document.getElementById('map').getBoundingClientRect(),r=P.getBoundingClientRect(),svg=P.querySelector('svg.lg-sizes');
        return {inside:r.left>=M.left&&r.right<=M.right&&r.top>=M.top&&r.bottom<=M.bottom,scrolls:P.scrollHeight>P.clientHeight+1,
          r:[...svg.querySelectorAll('circle')].map(function(c){return +c.getAttribute('r')}),t:[...svg.querySelectorAll('text')].map(function(t){return [t.textContent,+t.getAttribute('y')]}),label:svg.getAttribute('aria-label')}})()`);
      const sz = st.legend.sizes, rs = sz.map(x => x.radius);
      check(g.inside && !g.scrolls, 'nested legend with natural breaks, 10 bins, contained, no scroll, at ' + width + 'x' + height + ' (S1.1)', g);
      check(g.r.length === sz.length && sz.length >= 5 && g.r.every((x, k) => !k || x <= g.r[k - 1]) && JSON.stringify([...g.r].sort((a, b) => a - b)) === JSON.stringify([...rs].sort((a, b) => a - b))
        && Math.max(...rs) > 20 && g.t.length === sz.length && g.t.every(([x], k) => x === sz[k].label)
        && g.t.every(([, y], k) => !k || y <= g.t[k - 1][1])
        && [...g.t].sort((a, b) => a[1] - b[1]).every((x, k, a) => !k || x[1] - a[k - 1][1] >= 11 - 1e-9) && /^Circle sizes: .* animals$/.test(g.label), 'nested size circles and values (S1.1)', { g, rs });
    }
    // Values moved apart: with linear scaling two circle tops are closer than 11 px, their values are not (small fixture).
    st = await setSelect('s-scaling', 'linear');
    {
      const t = await p.eval(`[...document.querySelectorAll('#legend-panel svg.lg-sizes text')].map(function(t){return +t.getAttribute('y')})`);
      const tops = st.legend.sizes.map(z => -2 * z.radius), close = tops.some((a, k) => tops.some((b, m) => m !== k && Math.abs(a - b) < 11));
      const ys = [...t].sort((x, y) => x - y);
      check(close && ys.every((y, k) => !k || y - ys[k - 1] >= 11 - 1e-9), 'nested legend: values at least 11 px apart where circle tops are closer (S1.1)', { t, r: st.legend.sizes.map(z => z.radius) });
    }
    st = await setSelect('s-scaling', 'log');
    await p.eval('void CVIWA.state.mapHandle.map.jumpTo({center:[-100,40],zoom:3})');
    await p.eval('document.getElementById("fit-wa").click()');
    await p.waitFor('!CVIWA.state.mapHandle.map.isMoving()', 8000, 'fly end'); await sleep(1500);
    // The opening view for the map's size (a deliberate difference: CVI uses a fixed center and zoom).
    const cam = await p.eval(`(function(){var m=CVIWA.state.mapHandle.map,c=m.getCenter(),v=CVIWA.map.WA_VIEW_BOUNDS,w=m.cameraForBounds(v,{padding:24}),b=m.getBounds(),wc=w.center.lng!==undefined?w.center:{lng:w.center[0],lat:w.center[1]};
      return {lng:c.lng,lat:c.lat,zoom:m.getZoom(),want:[wc.lng,wc.lat,w.zoom],inside:b.getWest()<=v[0]+1e-6&&b.getEast()>=v[2]-1e-6&&b.getSouth()<=v[1]+1e-6&&b.getNorth()>=v[3]-1e-6}})()`);
    check(cam.inside && Math.abs(cam.lng - cam.want[0]) < 1e-6 && Math.abs(cam.lat - cam.want[1]) < 1e-6 && Math.abs(cam.zoom - cam.want[2]) < 1e-6, 'Fit to Washington camera (the opening view)', cam);

    // 11. Generated 39-county fixture through the UI
    v0 = await version();
    await p.setFiles('#file-input', [FIX('cvi_master_wa39.csv')]);
    st = await settle(v0);
    compareToOracle('wa39 default log', st, oracleView(oWa, 'default', 'Inbound+Outbound', 'side_by_side', 'log', 5));
    for (const [sc, nb] of [['natural', 7], ['quantile', 3], ['sqrt', 5]]) {
      st = await setSelect('s-scaling', sc); if (nb !== 5) st = await setSelect('s-bins', nb);
      compareToOracle('wa39 ' + sc + '/' + nb, st, oracleView(oWa, 'default', 'Inbound+Outbound', 'side_by_side', sc, nb));
      if (nb !== 5) st = await setSelect('s-bins', 5);
    }
    st = await click('input[name=mode][value=total]');
    compareToOracle('wa39 total sqrt', st, oracleView(oWa, 'default', 'Inbound+Outbound', 'total', 'sqrt', 5));

    // 12. A file missing required columns is refused with the CVI message
    const bad = path.join(OUT, 'missing_columns.csv');
    fs.writeFileSync(bad, fs.readFileSync(FIX('cvi_master_small.csv'), 'utf8').replace('Dest.County.Long', 'Dest_Long'));
    await p.setFiles('#file-input', [bad]);
    await p.waitFor('/failed to load/.test(document.getElementById("master-status").textContent)', 8000, 'bad file');
    check(await p.eval('/Master CSV missing the column Dest.County.Long\\. Ask for a CVI master table with all 13 required columns/.test(document.getElementById("master-status").textContent)'), 'missing-column message');
    fs.rmSync(bad);

    // 13. File activation regressions. Controlled FileReaders force completion/error ordering
    // while the real page, file input, parser, renderer and event handlers remain in use.
    v0 = await version();
    await p.setFiles('#file-input', [FIX('cvi_master_small.csv')]); await settle(v0);
    const smallText = fs.readFileSync(FIX('cvi_master_small.csv'), 'utf8');
    const waText = fs.readFileSync(FIX('cvi_master_wa39.csv'), 'utf8');
    await p.eval(`window.savedFileReader=window.FileReader; window.testReaders=[];
      window.FileReader=class {
        constructor(){this.readyState=0;testReaders.push(this);}
        readAsText(file){this.file=file;this.readyState=1;}
        abort(){this.aborted=true;this.readyState=2;if(this.onabort)this.onabort();}
        finish(text){this.result=text;this.readyState=2;this.onload();}
      };`);
    await p.setFiles('#file-input', [FIX('cvi_master_wa39.csv')]);
    await p.waitFor('CVIWA.state.mapHandle.map.loaded()', 8000, 'cleared map');
    check(await p.eval('CVIWA.state.loading && CVIWA.state.master===null && CVIWA.state.data.length===0 && CVIWA.state.legend===null'), 'loading clears previous dataset and legend');
    check(await p.eval('CVIWA.state.mapHandle.map.queryRenderedFeatures({layers:["circles"]}).length===0'), 'loading clears rendered circles');
    check(await p.eval('/Loading cvi_master_wa39.csv/.test(document.getElementById("master-status").textContent)'), 'loading identifies selected file');
    await p.setFiles('#file-input', [FIX('cvi_master_small.csv')]);
    check(await p.eval('testReaders[0].aborted===true'), 'superseded read aborted');
    await p.eval('testReaders[0].onerror()');
    check(await p.eval('CVIWA.state.loading && /Loading cvi_master_small.csv/.test(document.getElementById("master-status").textContent)'), 'stale error cannot replace current loading status');
    v0 = await version();
    await p.eval('testReaders[1].finish(' + JSON.stringify(smallText) + ')'); await settle(v0);
    await p.eval('testReaders[0].finish(' + JSON.stringify(waText) + '); testReaders[0].onerror()');
    check(await p.eval('CVIWA.state.master.physicalRows===22 && !CVIWA.state.loading'), 'older completion cannot overwrite newest dataset');
    check(await p.eval('/Master loaded \\(cvi_master_small.csv\\)/.test(document.getElementById("master-status").textContent)'), 'stale callbacks cannot replace active filename');
    await p.setFiles('#file-input', [FIX('cvi_master_small.csv')]);
    await p.eval('testReaders[2].onerror()');
    check(await p.eval('CVIWA.state.master===null && CVIWA.state.data.length===0 && CVIWA.state.legend===null && !CVIWA.state.loading'), 'read failure leaves no active dataset');
    check(await p.eval('/No dataset is active/.test(document.getElementById("master-status").textContent)'), 'read failure explains empty map');
    await p.setFiles('#file-input', [FIX('cvi_master_small.csv')]);
    check(await p.eval('testReaders.length===4'), 'same-file retry starts another read');
    v0 = await version(); await p.eval('testReaders[3].finish(' + JSON.stringify(smallText) + ')'); await settle(v0);
    check(await p.eval('CVIWA.state.master.physicalRows===22 && CVIWA.state.data.length>0'), 'same-file retry restores map');
    await p.eval('window.FileReader=window.savedFileReader; delete window.savedFileReader; delete window.testReaders;');

    // 14. Renderer failure is visible, including constructor failure before file selection.
    await p.eval('void CVIWA.state.mapHandle.map.fire("error",{error:new Error("Synthetic renderer failure")})');
    check(await p.eval('!document.getElementById("map-status").hidden && /Map unavailable/.test(document.getElementById("map-status").textContent)'), 'renderer error shown');
    check(await p.eval('document.getElementById("map").style.visibility==="hidden" && document.getElementById("legend-panel").hidden && document.getElementById("fit-wa").disabled'), 'failed map and legend cannot appear usable');
    const injection = await p.beforeLoad(`Object.defineProperty(window,'maplibregl',{
      configurable:true,set(value){ value.Map=class { constructor(){throw new Error('Synthetic WebGL startup failure');} };
        Object.defineProperty(window,'maplibregl',{value,writable:true,configurable:true}); }
    });`);
    await p.goto(PAGE);
    await p.waitFor('window.CVIWA && CVIWA.state && /Map unavailable/.test(document.getElementById("map-status").textContent)', 8000, 'startup error');
    check(await p.eval('!document.getElementById("map-status").hidden && document.getElementById("map-status").getAttribute("role")==="status"'), 'constructor failure has visible accessible message');
    await p.setFiles('#file-input', [FIX('cvi_master_small.csv')]);
    await p.waitFor('CVIWA.state.master && CVIWA.state.master.physicalRows===22', 8000, 'file handlers survive startup failure');
    check(await p.eval('/Master loaded/.test(document.getElementById("master-status").textContent) && !document.getElementById("map-status").hidden'), 'file status remains separate from renderer failure');
    await p.removeBeforeLoad(injection.identifier);
    await p.goto(PAGE);
    await p.waitFor('window.CVIWA && CVIWA.state && CVIWA.state.mapHandle && CVIWA.state.mapHandle.ready', 8000, 'reload recovery');
    check(await p.eval('document.getElementById("map-status").hidden && !document.getElementById("fit-wa").disabled'), 'reload recovers normal map controls');
    v0 = await version(); await p.setFiles('#file-input', [FIX('cvi_master_small.csv')]); st = await settle(v0);
    compareToOracle('recovered small defaults', st, oracleView(oSmall, 'default', 'Inbound+Outbound', 'side_by_side', 'log', 5));

    // 15. Network, CSP and errors over the whole session, including failure/recovery checks
    const nonLocal = b.log.requests.filter(u => !/^(blob|data|about):/.test(u) && !u.startsWith(SITE_BASE));
    check(nonLocal.length === 0, 'no requests outside the site folder (' + (PAGE_ORIGIN ? 'same origin and path' : 'local files') + ')', nonLocal);
    check(b.log.csp.length === 0, 'no CSP violations', b.log.csp);
    check(b.log.exceptions.length === 0, 'no exceptions', b.log.exceptions);
    run.requestSchemes = [...new Set(b.log.requests.map(u => u.split(':')[0]))];
  } catch (e) {
    check(false, 'run aborted', String(e && e.stack || e));
  } finally {
    await b.close();
  }
  Object.assign(run, { passed: pass, failed: fail, failures, notes, finished: new Date().toISOString() });
  fs.writeFileSync(path.join(OUT, 'browser_run.json'), JSON.stringify(run, null, 1));
  failures.forEach(f => console.log('  FAIL ' + f));
  console.log(b.version + ' | ' + run.page + ' | map ready ' + run.ms_to_map_ready + ' ms | request schemes: ' + (run.requestSchemes || []).join(', '));
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
