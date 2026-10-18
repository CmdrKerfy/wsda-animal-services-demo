#!/usr/bin/env node
'use strict';
// S5 browser test (County Focus): opens site/cvi/index.html in the installed Google Chrome (headless, throw-away
// profile). Every request outside the site folder is answered "not found" here and recorded (none is expected: the
// offline county map is the default, and County Focus adds no provider).
// Checks: Map View's three buttons (CVI's order, labels and hover texts); nothing of the Focus map
// loaded before its first visit, its renderer loaded once then; the Focus sidebar, map and summaries shown only in that
// view; the Focus map's layers and paint (CVI's county grid, the selected counties' wash and border, the importer and
// exporter premises, the county names on top at 12 px); for every Logarithmic/5-bin view of CVI's own Focus builder
// recorded beforehand (local-test-artifacts/s5/premises/reference.json: the full fixture and every S5_STRIDE-th view of
// its ten column variants), the page's own controls set as CVI's inputs were, then the premises the map draws (members,
// place with the side-by-side offset, animals, shipments, color, radius within 1e-9 px, drawing order) against CVI's,
// and the missing-column case drawing nothing; the auto-zoom 300 ms after the last pick (one fit for quick picks, to the
// box of all of them with CVI's 0.3 degree pad, fitted to the map's size), Clear leaving the camera, "Fit to selected
// counties" and the house button, each view keeping its camera; a tier without premises coordinates (nothing drawn, the
// counties still outlined, the strip naming the columns, the Premises box grayed); the WA view unchanged; no request
// outside the site, no page exception, no CSP report.
// Also: on the cluster fixture (make_cvi_focus_fixtures.js --clusters; groups of known premises at CVI's
// cluster steps), at a fixed camera one cluster per group with its size and abbreviated count, the cluster layers and
// sources as CVI's, each cluster's leaves exactly its group with the group's animals and species; the count labels (one
// per cluster, centered, hidden exactly where they would overlap a name or an earlier count) and the screenshot's counts;
// real-pointer cluster hover (role and count at once, sums after the leaves), stale answers dropped on a newer hover,
// on leaving and on new data; real-pointer premises hover and click (CVI's tooltip lines and CVI table); a cluster click
// opening nothing; every premises on its own above zoom 12; and, for CVI's payload views
// (local-test-artifacts/s5/payloads/reference.json), the hover lines and CVI table of every premises as page elements
// against CVI's (file text as text), with no markup taken from the file.
// Usage (repository root), after the County Focus references (tests/synthetic/make_cvi_focus_fixtures.js and
// tests/oracle/cvi_r_oracle.R; the messages below name the steps) and
// `node tests/synthetic/make_cvi_focus_fixtures.js --clusters`:
//   node tests/browser/run_s5_browser.js     (Node >= 22; Chrome installed; no packages)
//   node tests/browser/run_s5_browser.js --timing   (settled redraw at 3,001 and 10,000 premises; needs --scaling-gate)
// Optional: CHROME_BIN=<path to chrome>; S5_PAGE_URL=<another copy of the page, e.g. over local http>; S5_STRIDE=<n>.
// Writes only local-test-artifacts/s5/browser/ (browser_run.json, screens/) and a temporary profile (deleted on exit).
const { spawn } = require('child_process');
const zlib = require('zlib');
const fs = require('fs'), path = require('path'), vm = require('vm'), crypto = require('crypto');
const { pathToFileURL, fileURLToPath } = require('url');
const ROOT = path.resolve(__dirname, '..', '..');
const OUT = process.argv.includes('--s6-r16') ? path.join(ROOT,'local-test-artifacts/s6/r16/s5',process.env.S5_PAGE_URL ? 'http' : 'file') : process.argv.includes('--s6-r15') ? path.join(ROOT,'local-test-artifacts/s6/r15/s5',process.env.S5_PAGE_URL ? 'http' : 'file') : process.argv.includes('--s6-day6') ? path.join(ROOT,'local-test-artifacts/s6/day6/s5',process.env.S5_PAGE_URL ? 'http' : 'file') : process.argv.includes('--s6-day5') ? path.join(ROOT,'local-test-artifacts/s6/day5/s5',process.env.S5_PAGE_URL ? 'http' : 'file') : process.argv.includes('--s6-day4') ? path.join(ROOT,'local-test-artifacts/s6/day4/s5',process.env.S5_PAGE_URL ? 'http' : 'file') : path.join(ROOT, 'local-test-artifacts', 's5', 'browser');
const PAGE = process.env.S5_PAGE_URL || pathToFileURL(path.join(ROOT, 'site', 'cvi', 'index.html')).href;
const SITE_BASE = new URL('..', PAGE).href;
const PAGE_LABEL = /^file:/.test(PAGE) ? path.relative(ROOT, fileURLToPath(PAGE)).split(path.sep).join('/') + ' (file://)' : PAGE.split(/[?#]/)[0];
const STRIDE = Math.max(1, Number(process.env.S5_STRIDE) || 4);
const CHROME = process.env.CHROME_BIN || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  : process.platform === 'win32' ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : 'google-chrome');
const sleep = ms => new Promise(r => setTimeout(r, ms));

// The bundled county outlines, read the way the page reads them (for the test's own fit boxes).
const SB = { window: {} };
vm.createContext(SB);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'site/geo/wa-counties.js'), 'utf8'), SB, { filename: 'wa-counties.js' });
const GEO = SB.window.CVIWA_GEO;
// The test's own box of picked counties: every coordinate of their polygons, widened by 0.3 degrees (CVI's pad).
function boxOf(names) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const f of GEO.counties.features) {
    if (names.indexOf(f.properties.name) < 0) continue;
    const walk = c => { if (typeof c[0] === 'number') { x0 = Math.min(x0, c[0]); x1 = Math.max(x1, c[0]); y0 = Math.min(y0, c[1]); y1 = Math.max(y1, c[1]); } else c.forEach(walk); };
    walk(f.geometry.coordinates);
  }
  return [x0 - 0.3, y0 - 0.3, x1 + 0.3, y1 + 0.3];
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
      if (basemapStep.mode && /^https:\/\/basemap\.nationalmap\.gov\//.test(url)) {
        basemapStep.requests.push(url);
        const ok = basemapStep.mode === 'serve' && /\/tile\/\d+\/\d+\/\d+$/.test(url);
        send('Fetch.fulfillRequest', { requestId: rid, responseCode: ok ? 200 : 404, body: (ok ? TILE : Buffer.from('not found')).toString('base64'),
          responseHeaders: [{ name: 'Content-Type', value: ok ? 'image/png' : 'text/plain' }, { name: 'Access-Control-Allow-Origin', value: '*' }] }, s).catch(() => {});
        return;
      }
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
    async waitFor(expr, ms, label) { const t0 = Date.now(); while (Date.now() - t0 < (ms || 15000)) { try { const v = await page.eval(expr); if (v) return v; } catch (e) { /* not ready */ } await sleep(40); } throw new Error('timeout: ' + (label || expr)); },
    async setFiles(sel, files) { const { root } = await send('DOM.getDocument', { depth: 1 }, sid); const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector: sel }, sid); await send('DOM.setFileInputFiles', { files, nodeId }, sid); },
    async capture(file) { const r = await send('Page.captureScreenshot', { format: 'png' }, sid); fs.writeFileSync(file, Buffer.from(r.data, 'base64')); },
    async mouse(type, x, y) {   // one real mouse event (moved, pressed or released) through the browser's input pipeline
      const btn = type === 'mouseMoved' ? { button: 'none', buttons: 0 } : { button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 };
      await send('Input.dispatchMouseEvent', Object.assign({ type, x, y }, btn), sid);
    },
    async size(w, h) { await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false }, sid); },
    async drag(x0, y0, dx, dy) {   // a real mouse drag (pointer events through the browser's input pipeline)
      const ev = (type, x, y, buttons) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons, clickCount: 1 }, sid);
      await ev('mouseMoved', x0, y0, 0); await ev('mousePressed', x0, y0, 1);
      for (let i = 1; i <= 8; i++) { await ev('mouseMoved', x0 + dx * i / 8, y0 + dy * i / 8, 1); await sleep(16); }
      await ev('mouseReleased', x0 + dx, y0 + dy, 0);
    }
  };
  return { version: ver.Browser, log, page, async close() { try { await send('Browser.close'); } catch (e) { /* closing */ } await exited(5000); killGroup(); await exited(2000); fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } };
}

// A plain RGBA PNG of one color (the stand-in basemap tiles of the Focus basemap step).
function crc32(buf) { let c, crc = 0xffffffff; for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xffffffff) >>> 0; }
function png(w, h, rgba) {
  const chunk = (type, data) => { const len = Buffer.alloc(4), t = Buffer.from(type, 'ascii'), crc = Buffer.alloc(4);
    len.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const row = Buffer.alloc(1 + 4 * w); for (let x = 0; x < w; x++) Buffer.from(rgba).copy(row, 1 + 4 * x);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.concat(Array.from({ length: h }, () => row)))), chunk('IEND', Buffer.alloc(0))]);
}
const TILE = png(256, 256, [60, 70, 80, 255]);
// The Focus basemap step only: USGS The National Map answered here ('serve': a tile; 'fail': not found), recorded apart.
const basemapStep = { mode: null, requests: [] };

// ---- checks ---------------------------------------------------------------------------------------------------
let pass = 0, fail = 0; const failures = [];
const check = (ok, name, detail) => { if (ok) pass++; else { fail++; failures.push(name + (detail !== undefined ? ' :: ' + JSON.stringify(detail).slice(0, 600) : '')); } };
const arr = x => x === null || x === undefined ? [] : Array.isArray(x) ? x : [x];
const close = (a, b, tol) => typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= tol;
const A = 'CVIWA.state.mapHandle', FO = 'CVIWA.state.focusHandle';

// Sets the County Focus controls as CVI's inputs were (through the controls, with their change events): counties in
// pick order, direction, display mode, species groups, "Refine by species", years and quarters. Returns the Focus
// state's version before the recompute they cause, or 'not offered' when a county or species is not in the page's list.
const SETFOCUS = `window.__setFocus=function(i){
  var fire=function(el){el.dispatchEvent(new Event('change',{bubbles:true}))};
  var arr=function(x){return x===null||x===undefined?[]:Array.isArray(x)?x:[x]};
  var v0=CVIWA.focusState.version, missing=false;
  var list=function(id,key,vals){document.querySelector('[data-clear="'+key+'"]').click();
    arr(vals).forEach(function(v){var cb=[].find.call(document.querySelectorAll('#'+id+' input'),function(x){return x.value===String(v)});
      if(!cb){missing=true;return;} cb.checked=true; fire(cb);});};
  list('fo-counties','foCounties',i.counties);
  ['direction','mode'].forEach(function(k){var r=document.querySelector('input[name=fo-'+k+'][value="'+i[k]+'"]'); r.checked=true; fire(r);});
  list('fo-species','foSpecies',i.species);
  // Without a Species column CVI ignores "Refine by species" (the page grays it, as on the WA map): nothing to set.
  var want=CVIWA.state.master.hasSpecies?arr(i.rawSpecies).map(String):[];
  [].forEach.call(document.querySelectorAll('#fo-species-sub input'),function(cb){var w=want.indexOf(cb.value)>=0; if(cb.checked!==w){cb.checked=w;fire(cb);}});
  if(want.some(function(v){return CVIWA.focusState.speciesSub.indexOf(v)<0})) missing=true;
  list('fo-years','foYears',i.years); list('fo-quarters','foQuarters',i.quarters);
  var sc=document.getElementById('fo-scaling'),bn=document.getElementById('fo-bins');
  if(i.scaling&&sc.value!==i.scaling){sc.value=i.scaling;fire(sc);}
  if(i.nBins&&bn.value!==String(i.nBins)){bn.value=String(i.nBins);fire(bn);}
  return missing?'not offered':v0;}`;
// What the Focus map draws: each direction's premises in drawing order, the selected outlines, the camera.
const FOCUSREAD = `(async function(){var h=${FO},m=h.map,c=m.getCenter(),dIn=await m.getSource('focus_src_in').getData(),dOut=await m.getSource('focus_src_out').getData();return {
  in:h.focus.Inbound.map(function(f){return Object.assign({lon:f.geometry.coordinates[0],lat:f.geometry.coordinates[1]},f.properties)}),
  out:h.focus.Outbound.map(function(f){return Object.assign({lon:f.geometry.coordinates[0],lat:f.geometry.coordinates[1]},f.properties)}),
  sel:h.focus.sel.features.map(function(f){return f.properties.name}).sort(),
  srcIn:dIn.features.length,srcOut:dOut.features.length,
  op:[m.getPaintProperty('focus_points_in','circle-opacity'),m.getPaintProperty('focus_points_out','circle-opacity')],
  built:{omitted:CVIWA.focusState.built.omittedRows,missing:CVIWA.focusState.built.missingCoordinates},
  cam:[c.lng,c.lat,m.getZoom()]}})()`;
const CAM = m => `(function(){var m=${m}.map,c=m.getCenter();return [c.lng,c.lat,m.getZoom(),m.getBearing(),m.getPitch()]})()`;
const sameCam = (a, b) => a && b && close(a[0], b[0], 1e-9) && close(a[1], b[1], 1e-9) && close(a[2], b[2], 1e-9);
// The camera MapLibre gives for a box at the map's current size (padding 0, at most zoom 12), as [lng, lat, zoom].
const FITFOR = (b, pad, max) => `(function(){var m=${FO}.map,c=m.cameraForBounds([[${b[0]},${b[1]}],[${b[2]},${b[3]}]],{padding:${pad},maxZoom:${max}});var ll=maplibregl.LngLat.convert(c.center);return [ll.lng,ll.lat,c.zoom]})()`;

// CVI's drawing order (order(-radius_px), ties in the builder's order) within one direction.
function cviOrder(rows, dir) {
  return rows.map((r, i) => [r, i]).filter(x => x[0].direction === dir)
    .sort((a, b) => (b[0].radius_px - a[0].radius_px) || (a[1] - b[1])).map(x => x[0]);
}
function compareView(label, ref, got) {
  if (ref.missingCoordinates.length) {
    check(!got.in.length && !got.out.length && got.srcIn === 0 && got.srcOut === 0, label + ': missing coordinate columns: nothing drawn', got);
    check(JSON.stringify(got.built.missing) === JSON.stringify(arr(ref.missingCoordinates)), label + ': the missing columns as CVI names them', [got.built.missing, ref.missingCoordinates]);
    return;
  }
  check(got.built.omitted === ref.omittedRows, label + ': rows without a usable premises location', [got.built.omitted, ref.omittedRows]);
  ['Inbound', 'Outbound'].forEach(dir => {
    const want = cviOrder(arr(ref.rows), dir), have = dir === 'Inbound' ? got.in : got.out;
    check(have.length === want.length, label + ': ' + dir + ' premises drawn as CVI', [have.length, want.length]);
    check(have.map(x => x.premises_id).join('|') === want.map(x => x.premises_id).join('|'), label + ': ' + dir + ' drawing order (widest first) as CVI', [have.map(x => x.premises_id), want.map(x => x.premises_id)]);
    want.forEach((w, k) => {
      const h = have[k] || {};
      check(close(h.lon, w.lon, 1e-9) && close(h.lat, w.lat, 1e-9), label + ': ' + dir + ' ' + w.premises_id + ' place (with the side-by-side offset)', [h.lon, h.lat, w.lon, w.lat]);
      check(h.total_animals === w.total_animals && h.n_shipments === w.n_shipments, label + ': ' + dir + ' ' + w.premises_id + ' animals and shipments', [h.total_animals, h.n_shipments, w.total_animals, w.n_shipments]);
      check(close(h.radius_px, w.radius_px, 1e-9), label + ': ' + dir + ' ' + w.premises_id + ' radius', [h.radius_px, w.radius_px]);
      check(String(h.color).toUpperCase() === String(w.color).toUpperCase(), label + ': ' + dir + ' ' + w.premises_id + ' color', [h.color, w.color]);
    });
  });
}

// Additional unmodified-module matrix, split into two complete ledger shards per tier.
// Usage: node tests/browser/run_s5_browser.js --module-matrix fixture|full|partner|public 0|1
async function moduleMatrix() {
  const at = process.argv.indexOf('--module-matrix'), tier = process.argv[at+1], shard = Number(process.argv[at+2]);
  if (!['fixture','full','partner','public'].includes(tier) || ![0,1].includes(shard)) throw new Error('Use --module-matrix tier 0|1');
  const folder = path.join(ROOT,'local-test-artifacts/s5/module-matrix');
  const ref = JSON.parse(fs.readFileSync(path.join(folder,'page_reference.json')));
  const hash = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
  if (ref.oracleSha256 !== hash(path.join(ROOT,'tests/oracle/cvi_r_oracle.R'))) throw new Error('Stale module matrix oracle');
  const t = ref.tiers.find(t => t.tier === tier);
  if (t.referenceSha256 !== hash(path.join(folder,'reference_'+tier+'.json'))) throw new Error('Stale matrix page expectations');
  if (t.inputSha256 !== hash(path.join(ROOT,t.input))) throw new Error('Stale matrix input');
  const cases = t.cases.filter((v,i) => i % 2 === shard), run = {tier,shard,page:PAGE_LABEL,started:new Date().toISOString(),cases:[]};
  const b = await launch(), p = b.page;
  const READ = `(async function(){var h=${FO},f=CVIWA.focusState,
    sourceIn=await h.map.getSource('focus_src_in').getData(),sourceOut=await h.map.getSource('focus_src_out').getData(),
    selectedSource=await h.map.getSource('focus_sel_source').getData();return {in:h.premises.Inbound,out:h.premises.Outbound,
    actualIn:sourceIn.features,actualOut:sourceOut.features,actualSelected:selectedSource.features,
    srcIn:h.focus.Inbound.length,srcOut:h.focus.Outbound.length,selected:h.focus.sel.features.map(function(x){return x.properties.name}).sort(),
    boxes:[].map.call(document.querySelectorAll('#value-boxes .metric'),function(e){return {value:e.querySelector('.metric-value').textContent,
      label:e.querySelector('.metric-label').childNodes[0].textContent,gated:e.classList.contains('gated'),reason:e.querySelector('.metric-value').title}}),
    alert:(document.querySelector('#value-boxes .vb-alert')||{}).textContent,
    strip:[].map.call(document.querySelectorAll('#summary-strip .strip-items>div'),function(e){return {label:e.querySelector('strong').textContent,
      text:[].filter.call(e.childNodes,function(n){return n.nodeType===3}).map(function(n){return n.textContent}).join('').trim()}}),
    message:(document.querySelector('#summary-strip .strip-msg')||{}).textContent,
    browse:f.browse,step:f.timeStep,index:f.timeIndex,years:f.years,quarters:f.quarters,label:document.getElementById('fo-time-label').textContent,
    cam:[h.map.getCenter().lng,h.map.getCenter().lat,h.map.getZoom()]}})()`;
  try {
    await p.goto(PAGE); await p.waitFor(`window.CVIWA && CVIWA.state && ${A} && ${A}.ready`,20000,'WA ready');
    await p.setFiles('#file-input',[path.join(ROOT,t.input)]);
    await p.waitFor('!CVIWA.state.loading && CVIWA.state.master',20000,'matrix data loaded');
    await p.eval(SETFOCUS); await p.eval(`document.getElementById('show-focus').click()`);
    await p.waitFor(`${FO} && ${FO}.ready`,20000,'Focus ready');
    for (const v of cases) {
      await p.eval(`(function(){var e=document.getElementById('fo-browse');if(e.checked){e.checked=false;e.dispatchEvent(new Event('change',{bubbles:true}));}return true})()`);
      const before = await p.eval(`window.__setFocus(${JSON.stringify(v.opts)})`);
      check(before !== 'not offered',v.id+': all required picks offered');
      if (before === 'not offered') throw new Error('Required matrix case not offered: '+v.id);
      await p.waitFor(`CVIWA.focusState.version > ${before}`,10000,'matrix recompute');
      if (v.step) {
        await p.eval(`(function(){var e=document.getElementById('fo-browse');e.checked=true;e.dispatchEvent(new Event('change',{bubbles:true}));
          var r=document.querySelector('input[name=fo-time-step][value="${v.step}"]');r.checked=true;r.dispatchEvent(new Event('change',{bubbles:true}));
          var s=document.getElementById('fo-time-slider');s.value=${JSON.stringify(String(v.index))};s.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
        await sleep(400);
      }
      await sleep(40); const got = await p.eval(READ);
      for (const dir of ['Inbound','Outbound']) {
        const want = cviOrder(v.rows,dir), have = dir === 'Inbound' ? got.in : got.out;
        const actual = dir === 'Inbound' ? got.actualIn : got.actualOut;
        check(have.length === want.length && (dir === 'Inbound' ? got.srcIn : got.srcOut) === want.length,v.id+': '+dir+' actual drawing count');
        check(actual.length===want.length,v.id+': '+dir+' actual MapLibre source count');
        want.forEach((r,i) => {
          const h = have[i]; let bad = [];
          for (const key of ['direction','lon','lat','total_animals','n_shipments','n_cvis','city','state','county','premises_id','radius_px','color','popup_html','tooltip_text','species_json'])
            if (!h || !(typeof r[key] === 'number' ? close(h[key],r[key],1e-9) : h[key] === r[key])) bad.push(key);
          check(!bad.length,v.id+'/'+dir+'/'+i+': module location/sums/CVIs/labels/JSON/popup/radius',bad);
          const feature=actual[i],props=feature&&feature.properties;
          check(feature&&feature.id===i+1&&feature.geometry.type==='Point'&&close(feature.geometry.coordinates[0],r.lon,1e-9)&&close(feature.geometry.coordinates[1],r.lat,1e-9)
            && JSON.stringify(Object.keys(props).sort())===JSON.stringify(['direction','premises_id','color','radius_px','total_animals','n_shipments','species_json'].sort())
            && ['direction','premises_id','color','radius_px','total_animals','n_shipments','species_json'].every(k=>typeof r[k]==='number'?close(props[k],r[k],1e-9):props[k]===r[k]),
            v.id+'/'+dir+'/'+i+': actual MapLibre IDs/geometries/minimal properties in CVI drawing order');
        });
      }
      check(JSON.stringify(got.selected) === JSON.stringify(v.opts.counties.slice().sort()),v.id+': selected county outlines');
      const selectedExpected=GEO.counties.features.filter(f=>v.opts.counties.includes(f.properties.name)).map(f=>({name:f.properties.name,geometry:f.geometry}));
      check(JSON.stringify(got.actualSelected.map(f=>({name:f.properties.name,geometry:f.geometry})))===JSON.stringify(selectedExpected),v.id+': actual selected-county source names and bundled geometries');
      if (v.boxes.state === 'metrics') {
        check(got.boxes.length === 4,v.id+': four boxes');
        v.boxes.metrics.forEach((m,i) => {
          const h = got.boxes[i], gated = (i===1&&!v.hasCvi)||(i===2&&v.missingCoordinates.length);
          check(h && h.label===m.label && (gated ? h.gated && (i===1 ? /CVI/.test(h.reason) : v.missingCoordinates.every(k=>h.reason.includes(k))) : !h.gated && h.value===m.text),v.id+': module box '+i,h);
        });
      } else check(got.alert && got.alert.trim()===v.boxes.lines.join(' '),v.id+': module alert',got.alert);
      if (v.missingCoordinates.length && v.opts.counties.length)
        check(got.message && v.missingCoordinates.every(k=>got.message.includes(k)),v.id+': missing-column strip (by design)');
      else if (v.strip.state==='summary') {
        check(got.strip.length===v.strip.items.length+(v.selection.omitted_rows?1:0),v.id+': strip and undrawn notice (by design)');
        v.strip.items.forEach((m,i)=>check(got.strip[i] && got.strip[i].label===m.label && got.strip[i].text===String(m.text).replace(/\s+/g,' ').trim(),v.id+': module strip '+i,got.strip[i]));
        if(v.selection.omitted_rows)check(got.strip.at(-1).text.startsWith(String(v.selection.omitted_rows)+' row'),v.id+': independent omitted-row count');
      } else check(got.message && got.message.trim()===v.strip.lines.join(' '),v.id+': module strip message',got.message);
      if(v.step)check(got.browse&&got.step===v.step&&got.index===v.index&&got.label===v.label&&JSON.stringify(got.years)===JSON.stringify(v.opts.years)&&JSON.stringify(got.quarters)===JSON.stringify(v.opts.quarters),v.id+': every module Browse frame',got.label);
      run.cases.push(v.id);
    }
    for (const r of t.resets.filter((r,i)=>i%2===shard)) {
      const o = {...t.cases[0].opts,direction:r.direction,mode:r.mode};
      await p.eval(`window.__setFocus(${JSON.stringify(o)})`); await sleep(350);
      await p.eval(`(function(){var e=document.getElementById('fo-browse');e.checked=true;e.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);await sleep(350);
      await p.waitFor(`${FO}.map.loaded() && !${FO}.map.isMoving()`,15000,'matrix reset settled camera');
      const before = await p.eval(READ); await p.eval(`document.getElementById('reset-all').click()`); await sleep(400);
      const got = await p.eval(`(function(){var f=CVIWA.focusState;return {counties:f.counties,direction:f.direction,mode:f.mode,species:f.species,raw:f.speciesSub,years:f.years,quarters:f.quarters,scaling:f.scaling,nBins:f.nBins,opacity:f.opacity,labels:f.labels,outlines:f.outlines,labelStyle:f.labelStyle,boundaryStyle:f.boundaryStyle,hide:f.hide,browse:f.browse,step:f.timeStep,index:f.timeIndex,basemap:f.basemap,cam:[${FO}.map.getCenter().lng,${FO}.map.getCenter().lat,${FO}.map.getZoom()]}})()`);
      const value=id=>r.messages.find(m=>m.id===id)?.msg.value, array=x=>x==null?[]:[].concat(x);
      const expected={counties:array(value('intra_counties')),direction:value('intra_filter_dir'),mode:value('intra_mode'),species:array(value('intra_species')),raw:array(value('intra_species_sub')),years:array(value('intra_year')).map(Number),quarters:array(value('intra_quarter')),scaling:value('intra_scaling'),nBins:Number(value('intra_n_bins')),opacity:value('intra_opacity'),labels:value('intra_show_labels'),outlines:value('intra_show_outlines'),labelStyle:value('intra_label_style'),boundaryStyle:value('intra_boundary_style'),hide:value('hide_cvi_circles')};
      for(const [k,v]of Object.entries(expected))check(JSON.stringify(got[k])===JSON.stringify(v),tier+'/reset/'+r.direction+'/'+r.mode+': module '+k);
      check(!got.browse&&got.step===before.step&&got.index===before.index&&sameCam(got.cam,before.cam),tier+'/reset/'+r.direction+'/'+r.mode+': Browse stop (by design), period/camera kept');
    }
    check(!b.log.provider.length,'matrix no outside-site requests',b.log.provider);
    check(!b.log.exceptions.length,'matrix no page exceptions',b.log.exceptions);
    check(!b.log.csp.length,'matrix no CSP failures',b.log.csp);
  } catch(e) {fail++;failures.push('run stopped: '+(e.stack||e));} finally {await b.close();}
  Object.assign(run,{finished:new Date().toISOString(),passed:pass,failed:fail,failures,provider:b.log.provider.length});
  fs.writeFileSync(path.join(folder,'browser_'+(/^file:/.test(PAGE)?'file':'http')+'_'+tier+'_'+shard+'.json'),JSON.stringify(run,null,2)+'\n');
  failures.slice(0,30).forEach(x=>console.log('FAIL '+x));
  console.log(`S5 module matrix browser (${PAGE_LABEL}, ${tier}/${shard}): ${pass} passed, ${fail} failed; ${run.cases.length} required views/frames; requests outside site ${b.log.provider.length}`);
  process.exit(fail?1:0);
}


// --timing: the settled redraw at 3,001 and 10,000 premises (the scaling-gate files, local-test-artifacts/s5/gate/), in
// the County Focus view. Each change is timed in the page from the control change until the map has settled: the
// recompute done (CVI's 250 ms debounce included), the auto-zoom done after a pick, the premises sources loaded and the
// map idle. Clear, pick King, Natural breaks with 10 bins, back to Logarithmic; three times each, the median against
// the 5 s target. Exit 0 within it, 2 over it (stop and report).
async function timing() {
  const GATE = path.join(ROOT, 'local-test-artifacts', 's5', 'gate');
  const files = ['3001_inbound', '3001_combined', '10000_inbound', '10000_combined'];
  if (!files.every(f => fs.existsSync(path.join(GATE, 'master_' + f + '.csv')))) { console.error('Run node tests/synthetic/make_cvi_focus_fixtures.js --scaling-gate first.'); process.exit(2); }
  const b = await launch(), p = b.page, out = { started: new Date().toISOString(), page: PAGE_LABEL, targetMs: 5000, cases: [] };
  out.chrome = b.version;
  let worst = 0, ok = true;
  try {
    await p.goto(PAGE);
    await p.waitFor(`window.CVIWA && CVIWA.state && CVIWA.state.mapHandle && CVIWA.state.mapHandle.ready`, 20000, 'map ready');
    await p.eval(`document.getElementById('show-focus').click()`);
    await p.waitFor(`CVIWA.state.focusHandle && CVIWA.state.focusHandle.ready`, 20000, 'focus ready');
    await p.eval(`window.__settle=function(act,needFit){var fo=CVIWA.focusState,m=CVIWA.state.focusHandle.map,v0=fo.version,f0=fo.fits||0,t0=performance.now();act();
      return new Promise(function(res){(function tick(){var t=performance.now()-t0;
        if(fo.version>v0&&(!needFit||(fo.fits||0)>f0)&&m.loaded()&&!m.isMoving()&&m.areTilesLoaded())requestAnimationFrame(function(){res(m.loaded()&&!m.isMoving()?performance.now()-t0:(tick(),null))});
        else if(t>60000)res(-1);else requestAnimationFrame(tick);})()}).then(function(v){return v})};
      window.__pick=function(name){var cb=[].find.call(document.querySelectorAll('#fo-counties input'),function(x){return x.value===name});cb.checked=true;cb.dispatchEvent(new Event('change',{bubbles:true}))};
      window.__sel=function(id,v){var e=document.getElementById(id);e.value=v;e.dispatchEvent(new Event('change',{bubbles:true}))};1`);
    for (const f of files) {
      const n = Number(f.split('_')[0]), file = path.join(GATE, 'master_' + f + '.csv');
      const v0 = await p.eval('CVIWA.focusState.version'), t0 = Date.now();
      await p.setFiles('#file-input', [file]);
      await p.waitFor(`!CVIWA.state.loading && CVIWA.state.master && CVIWA.focusState.version > ${v0}`, 60000, 'data loaded');
      const c = { file: 'master_' + f + '.csv', premises: n, loadMs: Date.now() - t0, runs: { clear: [], pick: [], natural10: [], log5: [] } };
      for (let rep = 0; rep < 3; rep++) {
        c.runs.clear.push(await p.eval(`window.__settle(function(){document.querySelector('[data-clear="foCounties"]').click()},false)`));
        c.runs.pick.push(await p.eval(`window.__settle(function(){window.__pick('King')},true)`));
        c.drawn = await p.eval(`CVIWA.focusState.built.premises.length`);
        c.runs.natural10.push(await p.eval(`window.__settle(function(){window.__sel('fo-scaling','natural');window.__sel('fo-bins','10')},false)`));
        c.runs.log5.push(await p.eval(`window.__settle(function(){window.__sel('fo-scaling','log');window.__sel('fo-bins','5')},false)`));
      }
      const med = a => a.slice().sort((x, y) => x - y)[1];
      c.medianMs = Object.fromEntries(Object.entries(c.runs).map(([k, a]) => [k, Math.round(med(a))]));
      c.ok = c.drawn === n && Object.values(c.runs).every(a => a.every(x => x >= 0)) && Object.values(c.medianMs).every(x => x <= out.targetMs);
      worst = Math.max(worst, ...Object.values(c.medianMs)); ok = ok && c.ok;
      out.cases.push(c);
      console.log(c.file + ': ' + c.drawn + ' premises drawn; load ' + c.loadMs + ' ms; median settled ms ' + JSON.stringify(c.medianMs) + (c.ok ? '' : '  OVER TARGET OR WRONG'));
    }
  } catch (e) { ok = false; out.error = String(e && e.stack || e); console.log('timing stopped: ' + out.error); }
  finally { await b.close(); }
  out.finished = new Date().toISOString(); out.worstMedianMs = worst; out.ok = ok;
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'timing.json'), JSON.stringify(out, null, 2) + '\n');
  console.log('S5 settled redraw (' + PAGE_LABEL + ', Chrome ' + (out.chrome || '?') + '): worst median ' + worst + ' ms, target ' + out.targetMs + ' ms: ' + (ok ? 'WITHIN' : 'NOT MET'));
  process.exit(ok ? 0 : 2);
}

(async () => {
  if (process.argv.includes('--timing')) return timing();
  if (process.argv.includes('--module-matrix')) return moduleMatrix();
  fs.mkdirSync(path.join(OUT, 'screens'), { recursive: true });
  const run = { started: new Date().toISOString(), page: PAGE_LABEL, stride: STRIDE, views: 0, notOffered: 0 };
  const REF = path.join(ROOT, 'local-test-artifacts', 's5', 'premises');
  if (!fs.existsSync(path.join(REF, 'reference.json'))) {
    console.error('The premises reference is missing: run node tests/synthetic/make_cvi_focus_fixtures.js --premises and Rscript tests/oracle/cvi_r_oracle.R s5-premises first.');
    process.exit(2);
  }
  const premRef = JSON.parse(fs.readFileSync(path.join(REF, 'reference.json'), 'utf8'));
  if (!fs.existsSync(path.join(ROOT, 'local-test-artifacts', 's5', 'clusters', 'groups.json')) || !fs.existsSync(path.join(ROOT, 'local-test-artifacts', 's5', 'payloads', 'reference.json'))) {
    console.error('The cluster fixture or the payload reference is missing: run node tests/synthetic/make_cvi_focus_fixtures.js --clusters (and the --payloads steps) first.');
    process.exit(2);
  }
  const PARTNER = path.join(ROOT, 'local-test-artifacts', 'f1', 'tiers', 'partner', 'partner_county_totals.csv');
  if (!fs.existsSync(PARTNER)) { console.error('The Partner tier is missing: run node tests/node/run_f1_unit_tests.js first.'); process.exit(2); }

  const b = await launch(), p = b.page, log = b.log;
  run.chrome = b.version;
  const focusFileRequests = () => log.requests.filter(u => /\/app\/focusmap\.js$/.test(u.split('?')[0]));
  const idleWA = () => p.waitFor(`${A}.map.loaded() && !${A}.map.isMoving()`, 15000, 'WA map idle').then(() => sleep(100));
  const idleFo = () => p.waitFor(`${FO} && ${FO}.ready && ${FO}.map.loaded() && !${FO}.map.isMoving()`, 15000, 'Focus map idle').then(() => sleep(80));
  const load = async file => {
    const v0 = await p.eval('CVIWA.focusState.version');
    await p.setFiles('#file-input', [file]);
    await p.waitFor(`!CVIWA.state.loading && CVIWA.state.master && CVIWA.focusState.version > ${v0}`, 15000, 'data loaded');
    await sleep(100);
  };
  const setFocus = async opts => {
    const v0 = await p.eval(`window.__setFocus(${JSON.stringify(opts)})`);
    if (v0 === 'not offered') return v0;
    await p.waitFor(`CVIWA.focusState.version > ${v0}`, 10000, 'focus recomputed');
    await sleep(20);
    return p.eval(FOCUSREAD);
  };
  const mouse = (type, x, y) => p.mouse(type, x, y);
  const shot = async name => { await p.capture(path.join(OUT, 'screens', name + '.png')); };
  try {
    await p.goto(PAGE);
    await p.waitFor(`window.CVIWA && CVIWA.state && ${A} && ${A}.ready`, 20000, 'map ready');
    await p.eval(SETFOCUS);

    // 1. Map View: three views in CVI's order with CVI's labels and hover texts; the page opens on WA State with nothing
    // of the Focus map loaded.
    let ui = await p.eval(`(function(){var q=function(id){return document.getElementById(id)};return {buttons:[].map.call(document.querySelectorAll('.map-toggle-group [data-view]'),function(b){return [b.textContent.trim(),b.getAttribute('data-view'),b.getAttribute('aria-pressed'),b.title,!!b.querySelector('svg.bi-'+(b.getAttribute('data-view')==='focus'?'bullseye':b.getAttribute('data-view')==='wa'?'map':'globe-americas'))]}),
      foF:q('focus-filters').hidden,foS:q('focus-style').hidden,frame:q('focus-frame').hidden,waF:q('wa-filters').hidden,
      handle:!!CVIWA.state.focusHandle,js:!!CVIWA.focusmap,canvas:!!q('focus-map').querySelector('canvas'),focusJs:!!CVIWA.focus}})()`);
    check(JSON.stringify(ui.buttons.map(x => x.slice(0, 3))) === JSON.stringify([['WA State', 'wa', 'true'], ['County Focus', 'focus', 'false'], ['National Flow', 'flow', 'false']]),
      'Map View: WA State, County Focus, National Flow (CVI\'s order), WA pressed', ui.buttons);
    check(ui.buttons[1][3] === 'Zoom into one or more WA counties and see individual premises (importers vs exporters).' && ui.buttons.every(x => x[4]),
      'Map View: County Focus with CVI\'s hover text and bullseye icon', ui.buttons);
    check(ui.foF && ui.foS && ui.frame && !ui.waF, 'page opens: Focus filters, style and map hidden', ui);
    check(!ui.handle && !ui.js && !ui.canvas && !focusFileRequests().length && ui.focusJs, 'page opens: no Focus map and no focusmap.js (focus.js rules only)', focusFileRequests());

    // 2. The WA view with the premises fixture (camera moved a little), as it is before Focus is visited.
    await load(path.join(REF, 'full.csv'));
    await idleWA();
    await p.drag(700, 500, -50, 30); await idleWA();
    const waCam0 = await p.eval(CAM(A)), waCircles0 = await p.eval(`${A}.drawn.length`);
    check(waCircles0 > 0, 'WA view: circles drawn with the premises fixture', waCircles0);

    // 3. County Focus chosen: its renderer loads once, the map at the opening view, CVI's layers and paint.
    await p.eval(`document.getElementById('show-focus').click()`);
    await p.waitFor(`${FO} && ${FO}.ready`, 20000, 'focus map ready'); await idleFo();
    ui = await p.eval(`(function(){var q=function(id){return document.getElementById(id)},h=${FO},m=h.map;return {
      pressed:[].map.call(document.querySelectorAll('.map-toggle-group [data-view]'),function(b){return b.getAttribute('aria-pressed')}),
      foF:q('focus-filters').hidden,foS:q('focus-style').hidden,frame:q('focus-frame').hidden,waF:q('wa-filters').hidden,waS:q('wa-style').hidden,maps:q('maps').hidden,flF:q('flow-filters').hidden,flowFrame:q('flow-frame').hidden,
      status:q('focus-status').hidden,head:q('focus-filters').querySelector('h6').textContent.trim(),
      layers:m.getStyle().layers.map(function(l){return l.id}),
      grid:[m.getPaintProperty('county-lines','line-color'),m.getPaintProperty('county-lines','line-width'),m.getPaintProperty('county-lines','line-opacity'),m.getLayoutProperty('county-lines','visibility')],
      fill:[m.getPaintProperty('wa_focus_outline_fill','fill-color'),m.getPaintProperty('wa_focus_outline_fill','fill-opacity')],
      line:[m.getPaintProperty('wa_focus_outline_line','line-color'),m.getPaintProperty('wa_focus_outline_line','line-width'),m.getPaintProperty('wa_focus_outline_line','line-opacity')],
      pts:['focus_points_in','focus_points_out'].map(function(id){return [m.getLayer(id).source,m.getPaintProperty(id,'circle-color'),m.getPaintProperty(id,'circle-radius'),m.getPaintProperty(id,'circle-stroke-width'),m.getPaintProperty(id,'circle-stroke-color'),m.getPaintProperty(id,'circle-opacity')]}),
      labels:h.labels.length,lab:(function(e){var s=getComputedStyle(e);return [e.className,s.fontSize,s.color,e.classList.contains('hidden')]})(h.labels[0].getElement()),
      fit:(function(b){return b?b.title:null})(m.getContainer().querySelector('.maplibregl-ctrl-top-left .map-fit')),cam:!!m.getContainer().querySelector('.maplibregl-ctrl-top-right .map-screenshot'),
      counties:[].map.call(document.querySelectorAll('#fo-counties input'),function(x){return x.value}),
      dir:document.querySelector('input[name=fo-direction]:checked').value,mode:document.querySelector('input[name=fo-mode]:checked').value,
      clear:!!document.querySelector('[data-clear="foCounties"]'),all:!!document.querySelector('[data-all="foCounties"]'),
      strip:document.getElementById('summary-strip').textContent.trim(),alert:(document.querySelector('#value-boxes .vb-alert')||{}).textContent}})()`);
    check(JSON.stringify(ui.pressed) === '["false","true","false"]' && !ui.foF && !ui.foS && !ui.frame && ui.waF && ui.waS && ui.maps && ui.flF && ui.flowFrame && ui.status,
      'County Focus view: its sidebar and map only, the button pressed', ui);
    check(focusFileRequests().length === 1, 'County Focus: focusmap.js loaded once, on the first visit', focusFileRequests());
    check(ui.head === 'County Focus Filters', 'County Focus: CVI\'s section heading', ui.head);
    check(JSON.stringify(ui.layers) === JSON.stringify(['background', 'wa-land', 'county-lines', 'wa_focus_outline_fill', 'wa_focus_outline_line', 'focus_points_in', 'focus_clusters_in', 'focus_points_out', 'focus_clusters_out']),
      'County Focus: layers in CVI\'s order (grid, focus wash, focus border, importers and their clusters, exporters and theirs)', ui.layers);
    check(JSON.stringify(ui.grid) === JSON.stringify(['#888888', 0.8, 0.6, 'visible']), 'County Focus: CVI\'s county grid (#888888, 0.8 px, 0.6), shown', ui.grid);
    check(JSON.stringify(ui.fill) === JSON.stringify(['#245566', 0.08]) && JSON.stringify(ui.line) === JSON.stringify(['#245566', 2.2, 0.95]),
      'County Focus: CVI\'s selected-county wash and border', [ui.fill, ui.line]);
    const opCase = JSON.stringify(['case', ['boolean', ['feature-state', 'hover'], false], 1, 0.8]);
    check(ui.pts.every((x, i) => x[0] === ['focus_src_in', 'focus_src_out'][i] && JSON.stringify(x[1]) === '["get","color"]' && JSON.stringify(x[2]) === '["get","radius_px"]'
      && x[3] === 1.5 && x[4] === '#ffffff' && JSON.stringify(x[5]) === opCase), 'County Focus: premises paint as CVI\'s (radius, white 1.5 px ring, 80%, hover +25% capped at 1)', ui.pts);
    check(ui.labels === GEO.labels.length && /focus-label/.test(ui.lab[0]) && ui.lab[1] === '12px' && ui.lab[2] === 'rgb(44, 62, 80)',
      'County Focus: county names on top, 12 px, #2c3e50', ui.lab);
    check(ui.fit === 'Fit to Washington' && ui.cam, 'County Focus: house button and screenshot button on the map', ui);
    check(JSON.stringify(ui.counties) === JSON.stringify(arr(premRef.cases[0].countyChoices)) && ui.clear && !ui.all,
      'County Focus picker: the WA counties in the data (CVI\'s choices), Clear only', ui.counties);
    check(ui.dir === 'combined' && ui.mode === 'overlap', 'County Focus defaults: Combined, Overlapping (CVI)', [ui.dir, ui.mode]);
    check(ui.strip === 'Select one or more focus counties in the sidebar to populate the map.', 'County Focus: CVI\'s prompt in the strip before a county is picked', ui.strip);
    const foOpen = await p.eval(CAM(FO)), opening = await p.eval(`(function(){var m=${FO}.map,c=m.cameraForBounds(CVIWA.map.WA_VIEW_BOUNDS,{padding:24}),ll=maplibregl.LngLat.convert(c.center);return [ll.lng,ll.lat,c.zoom]})()`);
    check(close(foOpen[0], opening[0], 1e-6) && close(foOpen[1], opening[1], 1e-6) && close(foOpen[2], opening[2], 1e-6), 'County Focus: opens at the WA map\'s opening view', [foOpen, opening]);
    const sty = await p.eval(`(function(){var q=function(id){return document.getElementById(id)};return {hide:q('fo-hide').checked,scaling:q('fo-scaling').value,bins:q('fo-bins').value,binsHidden:q('fo-bins-field').hidden,
      op:q('fo-opacity').value,bm:q('fo-basemap').value,bmOptions:[].map.call(q('fo-basemap').options,function(o){return o.value}).join(),waOptions:[].map.call(q('s-basemap').options,function(o){return o.value}).join(),
      ls:q('fo-label-style').value,bs:q('fo-boundary-style').value,labels:q('fo-labels').checked,outlines:q('fo-outlines').checked,
      // The Fit button closes the Map Style section, after the population group.
      order:[].map.call(q('focus-style').querySelectorAll('input,select,button.btn'),function(e){return e.closest('#fo-nr-block')?null:e.id}).filter(function(x){return x!==null})
        .concat(q('fit-focus').getClientRects().length&&(q('pc-block').compareDocumentPosition(q('fit-focus'))&Node.DOCUMENT_POSITION_FOLLOWING)?['fit-focus']:[]),
      nrAt:(function(){var b=q('fo-nr-block');return [b.previousElementSibling&&b.previousElementSibling.querySelector('select')?b.previousElementSibling.querySelector('select').id:null,!!(b.compareDocumentPosition(q('fo-labels'))&Node.DOCUMENT_POSITION_FOLLOWING)]})(),
      tips:['fo-hide','fo-scaling','fo-bins','fo-labels','fo-outlines'].map(function(k){return document.querySelector('[data-help="'+k+'"]').title})}})()`);
    // "Group nearby premises" after "Hide CVI circles" (the page's addition).
    check(JSON.stringify(sty.order) === JSON.stringify(['fo-hide', 'fo-group', 'fo-scaling', 'fo-bins', 'fo-opacity', 'fo-basemap', 'fo-label-style', 'fo-boundary-style', 'fo-labels', 'fo-outlines', 'fit-focus']),
      'County Focus Style: CVI\'s controls in CVI\'s order, with "Group nearby premises" after "Hide CVI circles"', sty.order);
    check(!sty.hide && sty.scaling === 'log' && sty.bins === '5' && sty.binsHidden && sty.op === '0.8' && sty.bm === 'offline' && sty.ls === 'auto' && sty.bs === 'auto' && sty.labels && sty.outlines,
      'County Focus Style: CVI\'s defaults (circles shown, Logarithmic, 5 bins, 80%, Auto, labels and outlines on), the offline map', sty);
    check(sty.bmOptions === sty.waOptions && sty.bmOptions.split(',')[0] === 'offline', 'County Focus basemap: the WA map\'s list, the offline county map first', sty.bmOptions.split(',').length);
    // CVI's help texts reworded in the brand guide's voice, the facts kept.
    check(sty.tips[1].indexOf("How a premises' animal count sets its circle's area.") === 0 && sty.tips[2].indexOf('The number of circle sizes for Quantile or Natural breaks.') === 0
      && sty.tips[3] === 'Shows Washington county names on the live map and its screenshot.' && sty.tips[4] === "Shows every county's outline on the live map. The focus counties stay highlighted either way."
      && /on this map and its screenshot/.test(sty.tips[0]), 'County Focus Style: the help texts (CVI\'s, reworded in the brand guide\'s voice)', sty.tips);
    await shot('focus-open');

    // 4. Auto-zoom (CVI's 300 ms debounce): one pick fits after 300 ms, not before; quick picks fit once, to all of them.
    const tick = name => p.eval(`(function(){var cb=[].find.call(document.querySelectorAll('#fo-counties input'),function(x){return x.value===${JSON.stringify(name)}});cb.checked=!cb.checked;cb.dispatchEvent(new Event('change',{bubbles:true}));return performance.now()})()`);
    let fits0 = await p.eval('CVIWA.focusState.fits||0');
    const t0 = await tick('King');
    await sleep(150);
    const early = await p.eval(`[CVIWA.focusState.fits||0, performance.now()]`);
    await p.waitFor(`(CVIWA.focusState.fits||0) > ${fits0}`, 3000, 'auto-zoom');
    const tFit = await p.eval('performance.now()');
    await idleFo();
    let cam = await p.eval(CAM(FO)), want = await p.eval(FITFOR(boxOf(['King']), 0, 12));
    check(early[0] === fits0 && tFit - t0 >= 300, 'auto-zoom: not before 300 ms after the pick', [early, tFit - t0]);
    check(close(cam[0], want[0], 1e-6) && close(cam[1], want[1], 1e-6) && close(cam[2], want[2], 1e-6) && cam[2] <= 12,
      'auto-zoom: King\'s box with the 0.3 degree pad, fitted to the map', [cam, want]);
    fits0 = await p.eval('CVIWA.focusState.fits||0');
    await tick('Pierce'); await sleep(120); await tick('King'); await sleep(120); await tick('King');
    await sleep(700); await idleFo();
    const fits1 = await p.eval('CVIWA.focusState.fits||0');
    cam = await p.eval(CAM(FO)); want = await p.eval(FITFOR(boxOf(['King', 'Pierce']), 0, 12));
    check(fits1 === fits0 + 1, 'auto-zoom: quick picks give one fit', [fits0, fits1]);
    check(close(cam[0], want[0], 1e-6) && close(cam[1], want[1], 1e-6) && close(cam[2], want[2], 1e-6), 'auto-zoom: to the box of all the counties picked', [cam, want]);
    let got = await p.eval(FOCUSREAD);
    check(JSON.stringify(got.sel) === '["King","Pierce"]', 'selected counties outlined', got.sel);
    const pickOrder = await p.eval('CVIWA.focusState.counties.slice()');
    check(JSON.stringify(pickOrder) === '["Pierce","King"]', 'the counties kept in pick order (CVI\'s picker)', pickOrder);
    await shot('focus-king-pierce');

    // 5. Clear leaves the camera; the house button and "Fit to selected counties"; the camera kept across views.
    await p.drag(700, 500, 80, -40); await idleFo();
    const moved = await p.eval(CAM(FO));
    await p.eval(`document.querySelector('[data-clear="foCounties"]').click()`);
    await sleep(700); await idleFo();
    cam = await p.eval(CAM(FO)); got = await p.eval(FOCUSREAD);
    check(sameCam(cam, moved) && !got.in.length && !got.out.length && !got.sel.length, 'Clear: nothing drawn, the camera left where it was (CVI)', [cam, moved, got.sel]);
    await p.eval(`${FO}.map.getContainer().querySelector('.map-fit').click()`); await idleFo();
    cam = await p.eval(CAM(FO));
    check(close(cam[0], opening[0], 1e-6) && close(cam[1], opening[1], 1e-6) && close(cam[2], opening[2], 1e-6), 'house button without counties: the opening view', [cam, opening]);
    await tick('Pierce'); await sleep(700); await idleFo();
    await p.drag(700, 500, -120, 60); await idleFo();
    await p.eval(`document.getElementById('fit-focus').click()`); await idleFo();
    cam = await p.eval(CAM(FO)); want = await p.eval(FITFOR(boxOf(['Pierce']), 0, 12));
    check(close(cam[0], want[0], 1e-6) && close(cam[1], want[1], 1e-6) && close(cam[2], want[2], 1e-6), '"Fit to selected counties": Pierce\'s box with the pad', [cam, want]);
    const fitTitle = await p.eval(`document.getElementById('fit-focus').title`);
    check(fitTitle === 'Re-center and zoom the live map to the bounding box of the currently-selected focus counties.', '"Fit to selected counties": CVI\'s hover text', fitTitle);
    await p.drag(700, 500, 60, 60); await idleFo();
    await p.eval(`${FO}.map.getContainer().querySelector('.map-fit').click()`); await idleFo();
    cam = await p.eval(CAM(FO));
    check(close(cam[0], want[0], 1e-6) && close(cam[1], want[1], 1e-6) && close(cam[2], want[2], 1e-6), 'house button with counties: the same fit', [cam, want]);
    await p.drag(700, 500, 40, 20); await idleFo();
    const foCam = await p.eval(CAM(FO));
    await p.eval(`document.getElementById('show-wa').click()`); await idleWA();
    const waCam1 = await p.eval(CAM(A)), waCircles1 = await p.eval(`${A}.drawn.length`);
    check(sameCam(waCam1, waCam0) && waCircles1 === waCircles0, 'WA view: camera and circles unchanged by the Focus view', [waCam0, waCam1, waCircles0, waCircles1]);
    await p.eval(`document.getElementById('show-focus').click()`); await idleFo();
    cam = await p.eval(CAM(FO));
    check(sameCam(cam, foCam) && focusFileRequests().length === 1, 'County Focus: camera kept across view switches, renderer not loaded again', [cam, foCam, focusFileRequests().length]);
    await p.eval(`document.getElementById('show-flow').click()`);
    await p.waitFor(`CVIWA.state.flowHandle && CVIWA.state.flowHandle.ready`, 20000, 'flow ready');
    await p.eval(`document.getElementById('show-focus').click()`); await idleFo();
    cam = await p.eval(CAM(FO));
    check(sameCam(cam, foCam), 'County Focus: camera kept after visiting National Flow', [cam, foCam]);

    // 6. CVI's own builder (the premises reference), through the page's controls: the full fixture, every view (all five
    // scalings and bins 3/4/5/6/7/10); the column variants (Logarithmic, 5 bins) every S5_STRIDE-th view.
    for (const c of premRef.cases) {
      const views = c.views.filter(v => c.name === 'full' || (v.opts.scaling === 'log' && v.opts.nBins === 5)).filter((v, i) => c.name === 'full' || i % STRIDE === 0);
      await load(path.join(REF, c.file));
      const choices = await p.eval(`[].map.call(document.querySelectorAll('#fo-counties input'),function(x){return x.value})`);
      check(JSON.stringify(choices) === JSON.stringify(arr(c.countyChoices)), c.name + ': picker choices as CVI', [choices, c.countyChoices]);
      const refine = await p.eval(`[CVIWA.state.master.hasSpecies, document.getElementById('fo-species-sub').closest('[data-feature]').classList.contains('gated')]`);
      check(refine[0] !== refine[1], c.name + ': County Focus "Refine by species" grayed exactly when the file has no Species column', refine);
      for (const v of views) {
        const label = c.name + '/' + v.scene + '/' + v.opts.direction + '/' + v.opts.mode + '/' + v.opts.scaling + v.opts.nBins;
        const g = await setFocus(v.opts);
        if (g === 'not offered') { run.notOffered++; (run.notOfferedScenes = run.notOfferedScenes || {})[v.scene] = (run.notOfferedScenes[v.scene] || 0) + 1; check(arr(v.rows).length === 0, label + ': a county or species the page does not offer draws nothing in CVI', v.rows); continue; }
        run.views++;
        compareView(label, v, g);
        const pc = arr(v.opts.counties);
        check(JSON.stringify(g.sel) === JSON.stringify(pc.slice().sort()), label + ': selected counties outlined', [g.sel, pc]);
      }
    }
    await idleFo(); await shot('focus-reference-last');

    // 7. A tier without premises coordinates: nothing drawn, the county still outlined, the strip names the columns,
    // the Premises box grayed with the reason.
    await load(PARTNER);
    const partnerChoice = await p.eval(`(document.querySelector('#fo-counties input')||{}).value`);
    got = await setFocus({ counties: [partnerChoice], direction: 'combined', mode: 'overlap', species: await p.eval('CVIWA.state.master.speciesChoices'),
      years: await p.eval('CVIWA.state.master.yearChoices'), quarters: ['Q1', 'Q2', 'Q3', 'Q4'], rawSpecies: [] });
    await idleFo();
    const pui = await p.eval(`(function(){var bx=[].map.call(document.querySelectorAll('#value-boxes .metric'),function(c){return [c.querySelector('.metric-label').firstChild.textContent,c.classList.contains('gated'),c.querySelector('.metric-value').title]});
      return {boxes:bx,strip:document.getElementById('summary-strip').textContent.trim()}})()`);
    const cols = 'Needs the columns Origin.Lat, Origin.Long, Dest.Lat and Dest.Long in the CVI master table.';
    check(!got.in.length && !got.out.length && JSON.stringify(got.sel) === JSON.stringify([partnerChoice]), 'Partner tier: no premises drawn, the county outlined', got);
    check(pui.strip === 'Premises cannot be placed. ' + cols, 'Partner tier: the strip names the missing columns', pui.strip);
    const prem = pui.boxes.find(x => x[0] === 'Premises');
    check(prem && prem[1] && prem[2] === cols, 'Partner tier: the Premises box grayed with the reason', pui.boxes);
    await shot('focus-partner');

    // 8. Clusters, on the cluster fixture of known groups (make_cvi_focus_fixtures.js --clusters): at a fixed
    // camera one cluster per group with its size (CVI's steps 9/10, 49/50, 199/200, and 1,234 = "1.2k"), its leaves
    // exactly the group's premises with the group's animals and species; the count labels; real hover and click.
    const CL = path.join(ROOT, 'local-test-artifacts', 's5', 'clusters');
    const G = JSON.parse(fs.readFileSync(path.join(CL, 'groups.json'), 'utf8'));
    const clLines = fs.readFileSync(path.join(CL, 'clusters.csv'), 'utf8').trim().split('\n').map(l => l.split(','));
    const clHead = clLines.shift(), cc = name => clHead.indexOf(name);
    await load(path.join(CL, 'clusters.csv'));
    got = await setFocus({ counties: [G.county], direction: 'combined', mode: 'overlap', species: ['Cattle', 'Poultry'], years: [2025],
      quarters: ['Q1', 'Q2', 'Q3', 'Q4'], rawSpecies: [] });
    const size = dir => G.groups.filter(g => g.dir === dir).reduce((t, g) => t + g.size, 0);
    check(got !== 'not offered' && got.in.length === size('Inbound') && got.out.length === size('Outbound'), 'clusters fixture: every premises built', got === 'not offered' ? got : [got.in.length, got.out.length]);
    await sleep(700); await idleFo();   // after the auto-zoom
    await p.eval(`void ${FO}.map.jumpTo({center:${JSON.stringify(G.camera.center)},zoom:${G.camera.zoom}})`); await idleFo(); await sleep(150);
    const CLREAD = `(function(){var h=${FO},m=h.map,r=m.getCanvas().getBoundingClientRect(),seen={},cl=[];
      m.queryRenderedFeatures({layers:['focus_clusters_in','focus_clusters_out']}).forEach(function(f){var k=f.layer.id+':'+f.properties.cluster_id;if(seen[k])return;seen[k]=1;var q=m.project(f.geometry.coordinates);
        cl.push({dir:f.layer.id==='focus_clusters_in'?'Inbound':'Outbound',id:f.properties.cluster_id,count:f.properties.point_count,abbr:String(f.properties.point_count_abbreviated),lon:f.geometry.coordinates[0],lat:f.geometry.coordinates[1],x:q.x,y:q.y,px:r.left+q.x,py:r.top+q.y})});
      var box=function(e){var b=e.getBoundingClientRect();return [b.left-r.left,b.top-r.top,b.right-r.left,b.bottom-r.top]};
      return {clusters:cl,points:m.queryRenderedFeatures({layers:['focus_points_in','focus_points_out']}).length,
        els:[].map.call(m.getContainer().querySelectorAll('.focus-count'),function(e){var s=getComputedStyle(e);return {text:e.textContent,dir:e.classList.contains('focus-count-in')?'Inbound':'Outbound',shown:!e.classList.contains('collided'),box:box(e),font:[s.fontSize,s.fontWeight,s.color]}}),
        names:h.labels.filter(function(mk){return !mk.getElement().classList.contains('hidden')}).map(function(mk){return {text:mk.getElement().textContent,box:box(mk.getElement())}}),
        paint:['focus_clusters_in','focus_clusters_out'].map(function(id){return [m.getLayer(id).source,JSON.stringify(m.getFilter(id)),m.getPaintProperty(id,'circle-color'),m.getPaintProperty(id,'circle-radius'),m.getPaintProperty(id,'circle-opacity'),m.getPaintProperty(id,'circle-stroke-width'),m.getPaintProperty(id,'circle-stroke-color')]}),
        pfilter:['focus_points_in','focus_points_out'].map(function(id){return [JSON.stringify(m.getFilter(id)),JSON.stringify(m.getLayoutProperty(id,'circle-sort-key'))]}),
        rank:['Inbound','Outbound'].map(function(d){var fs=h.focus[d],ok=true;fs.forEach(function(f,k){if(f.id!==k+1||(k&&+f.properties.radius_px>+fs[k-1].properties.radius_px))ok=false});return [fs.length,ok]}),
        sources:['focus_src_in','focus_src_out'].map(function(id){var s=m.getStyle().sources[id];return [s.cluster,s.clusterMaxZoom,s.clusterRadius]})}})()`;
    let cr = await p.eval(CLREAD);
    run.clusters = cr.clusters.length;
    // The page's own layer definitions against CVI's add_dir_cluster.
    const STEP = ['step', ['get', 'point_count'], 14, 10, 18, 50, 24, 200, 32];
    check(JSON.stringify(cr.sources) === '[[true,12,40],[true,12,40]]', 'clusters: two sources, each clustered (radius 40, up to zoom 12) as CVI', cr.sources);
    check(cr.paint.every((x, i) => x[0] === ['focus_src_in', 'focus_src_out'][i] && x[1] === '["has","point_count"]' && x[2] === ['#1C9CD9', '#F0A06E'][i]
      && JSON.stringify(x[3]) === JSON.stringify(STEP) && x[4] === 0.8 && x[5] === 2 && x[6] === '#ffffff'), 'cluster circles as CVI\'s (color, steps 14/18/24/32, opacity at least 0.55, white 2 px ring)', cr.paint);
    check(cr.pfilter.every(x => x[0] === '["!",["has","point_count"]]' && x[1] === '["id"]') && cr.rank.every(x => x[0] > 0 && x[1]),
      'single premises: unclustered only, drawn in id order, ids 1, 2, … widest first', [cr.pfilter, cr.rank]);
    // The step radius each group's cluster gets, from the page's expression evaluated here; CVI's thresholds.
    const stepOf = (expr, n) => { let v = expr[2]; for (let i = 3; i < expr.length; i += 2) if (n >= expr[i]) v = expr[i + 1]; return v; };
    const wantRadius = { 9: 14, 10: 18, 49: 18, 50: 24, 199: 24, 200: 32, 1234: 32, 3: 14, 12: 18 };
    check(G.groups.every(g => stepOf(cr.paint[0][3], g.size) === wantRadius[g.size]), 'cluster radius at CVI\'s thresholds 9/10, 49/50, 199/200', G.groups.map(g => [g.size, stepOf(cr.paint[0][3], g.size)]));
    check(cr.clusters.length === G.groups.length && cr.points === 0, 'fixed camera: one cluster per group, no premises outside them', [cr.clusters.length, cr.points]);
    const clusterOf = g => cr.clusters.filter(c => c.dir === g.dir && Math.abs(c.lon - g.center[0]) < 0.01 && Math.abs(c.lat - g.center[1]) < 0.01);
    const fmtUS = n => Math.round(n).toLocaleString('en-US');
    for (const g of G.groups) {
      const cs = clusterOf(g), c = cs[0] || {};
      check(cs.length === 1 && c.count === g.size && c.abbr === g.abbreviated, 'cluster ' + g.id + ': one cluster of ' + g.size + ' premises, count shown as "' + g.abbreviated + '"', cs);
      if (!cs.length) continue;
      const lv = await p.eval(`${FO}.map.getSource(${JSON.stringify(g.dir === 'Inbound' ? 'focus_src_in' : 'focus_src_out')}).getClusterLeaves(${c.id},${c.count},0).then(function(ls){return {ids:ls.map(function(l){return l.properties.premises_id}).sort(),sum:CVIWA.focusmap.sumLeaves(ls)}})`);
      check(JSON.stringify(lv.ids) === JSON.stringify(g.members.slice().sort()), 'cluster ' + g.id + ': its leaves are exactly the group\'s premises', [lv.ids.length, g.members.length]);
      check(close(lv.sum.animals, g.animals, 1e-9) && JSON.stringify(Object.keys(lv.sum.spec).sort().map(k => [k, lv.sum.spec[k]])) === JSON.stringify(Object.keys(g.species).sort().map(k => [k, g.species[k]])),
        'cluster ' + g.id + ': animals and species (per premises rounded half to even) summed as the fixture', [lv.sum, g.animals, g.species]);
    }
    // Independent two-leaf sums for supported raw labels that are JavaScript prototype names.
    const safeCluster = await p.eval(`(function(){var s=CVIWA.focusmap.sumLeaves([
      {properties:{total_animals:17,species_json:'{"__proto__":4,"constructor":5,"toString":6,"Cattle":2}'}},
      {properties:{total_animals:7,species_json:'{"__proto__":3,"constructor":2,"toString":1,"Cattle":1}'}}]);
      return {animals:s.animals,entries:Object.keys(s.spec).sort().map(function(k){return [k,s.spec[k]]}),
        text:CVIWA.focusmap.clusterElement('Importer',2,s.animals,s.spec).textContent}})()`);
    check(safeCluster.animals === 24 && JSON.stringify(safeCluster.entries) === JSON.stringify([['Cattle',3],['__proto__',7],['constructor',7],['toString',7]]),
      'cluster raw labels: two independent leaves retain own numeric __proto__/constructor/toString sums', safeCluster);
    check(['2 premises','24 animals','__proto__: 7','constructor: 7','toString: 7','Cattle: 3'].every(s => safeCluster.text.includes(s)) && !safeCluster.text.includes('NaN'),
      'cluster hover: supported raw labels rendered as text with correct totals', safeCluster.text);
    // Count labels: one per cluster, its text and place; collision as map text (names first, then exporters' counts,
    // then importers', larger counts first): shown labels never overlap each other or a name, a hidden one always does.
    const ov = (a, b, pad) => a[0] - pad < b[2] + pad && b[0] - pad < a[2] + pad && a[1] - pad < b[3] + pad && b[1] - pad < a[3] + pad;
    const mid = b => [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
    check(cr.els.length === cr.clusters.length && cr.clusters.every(c => cr.els.filter(e => e.dir === c.dir && e.text === c.abbr
      && Math.abs(mid(e.box)[0] - c.x) < 0.75 && Math.abs(mid(e.box)[1] - c.y) < 0.75).length === 1), 'count labels: one per cluster, MapLibre\'s abbreviated count, centered on it', [cr.els.map(e => [e.text, mid(e.box)]), cr.clusters.map(c => [c.abbr, c.x, c.y])]);
    check(cr.els.every(e => e.font[0] === '14px' && e.font[1] === '700' && e.font[2] === 'rgb(255, 255, 255)'), 'count labels: 14 px bold white (CVI)', cr.els.map(e => e.font));
    const order = cr.els.slice().sort((a, b) => (a.dir === b.dir ? 0 : a.dir === 'Outbound' ? -1 : 1) || Number(b.text.replace('k', '')) * (b.text.endsWith('k') ? 1000 : 1) - Number(a.text.replace('k', '')) * (a.text.endsWith('k') ? 1000 : 1));
    const placed = cr.names.map(n => n.box);
    let collisionOk = true;
    order.forEach(e => { const hit = placed.some(b => ov(b, e.box, 2)); if (hit === e.shown) collisionOk = false; if (e.shown) placed.push(e.box); });
    check(collisionOk, 'count labels: hidden exactly where they would overlap a name or a count placed before (exporters first, larger first)', order.map(e => [e.dir, e.text, e.shown]));
    const shownCount = (dir, text) => (cr.els.find(e => e.dir === dir && e.text === text) || {}).shown;
    check(shownCount('Outbound', '3') === true && shownCount('Inbound', '9') === false && shownCount('Outbound', '12') === true && shownCount('Inbound', '199') === false,
      'count labels: at a shared center the exporters\' count shows, the importers\' is hidden', order.map(e => [e.dir, e.text, e.shown]));
    check(shownCount('Inbound', '10') === false && cr.names.some(n => n.text === 'Yakima'), 'count labels: a count on the county name "Yakima" is hidden (names first, as CVI\'s map text)', cr.names.map(n => n.text));
    check(['49', '50', '200', '1.2k'].every(t => shownCount('Inbound', t) === true), 'count labels: the other counts shown', order.map(e => [e.dir, e.text, e.shown]));
    await p.eval(`CVIWA.map.screenshot(${FO}).then(function(){return 1})`);
    const shotCounts = await p.eval(`${FO}.lastCounts.slice().sort()`);
    check(JSON.stringify(shotCounts) === JSON.stringify(cr.els.filter(e => e.shown).map(e => e.dir + ':' + e.text).sort()), 'screenshot: the counts shown on the map, no others', [shotCounts]);
    await shot('focus-clusters');

    // Cluster hover, real pointer: the role and count at once, the sums when the leaves arrive.
    const tipText = `(function(){var t=document.querySelector('#focus-map .maplibregl-popup.focus-tip .maplibregl-popup-content');if(!t)return null;var c=t.cloneNode(true);c.querySelectorAll('br').forEach(function(x){x.replaceWith('|')});c.querySelectorAll('button').forEach(function(x){x.remove()});return c.textContent.replace(/\\s+/g,' ').trim()})()`;
    const clusterText = g => (g.dir === 'Inbound' ? 'Importers (received)' : 'Exporters (sent)') + '|' + g.size + ' premises • ' + fmtUS(g.animals) + ' animals'
      + Object.keys(g.species).sort((a, c) => g.species[c] - g.species[a]).map(k => '|' + k + ': ' + fmtUS(g.species[k])).join('');
    const at = id => { const g = G.groups.find(x => x.id === id), c = clusterOf(g)[0]; return { g, c }; };
    for (const id of ['I50', 'E12', 'I1234']) {
      const { g, c } = at(id);
      await mouse('mouseMoved', c.px, c.py);
      await p.waitFor(`${FO}.clusterHover && ${FO}.clusterHover.id===${c.id} && ${FO}.clusterHover.state==='shown'`, 5000, 'cluster hover ' + id);
      const t = await p.eval(tipText);
      check(t === clusterText(g), 'cluster hover ' + id + ': CVI\'s text with the leaves\' sums (role, premises, animals, species largest first)', [t, clusterText(g)]);
    }
    await mouse('mouseMoved', 5, 5);
    // Stale answers (MapLibre's answer held back 500 ms here): a newer hover, leaving, or new data drops the old answer.
    await p.eval(`(function(){window.__leafDelay=500;['focus_src_in','focus_src_out'].forEach(function(id){var s=${FO}.map.getSource(id);if(s.__orig)return;s.__orig=s.getClusterLeaves.bind(s);
      s.getClusterLeaves=function(a,n,o){var f=s.__orig;return new Promise(function(res,rej){setTimeout(function(){f(a,n,o).then(res,rej)},window.__leafDelay)})}})})()`);
    let A1 = at('I200'), A2 = at('I1234');
    await mouse('mouseMoved', A1.c.px, A1.c.py); await sleep(100);
    const early2 = await p.eval(`[${tipText}, ${FO}.clusterHover.state]`);
    check(early2[0] === 'Importers (received)|200 premises' && early2[1] === 'waiting', 'cluster hover: role and premises count at once, before the leaves', early2);
    await p.eval(`window.__h1=${FO}.clusterHover`);
    await mouse('mouseMoved', A2.c.px, A2.c.py); await sleep(1300);
    let st2 = await p.eval(`[window.__h1.state, ${FO}.clusterHover.id, ${FO}.clusterHover.state, ${tipText}]`);
    check(st2[0] === 'discarded' && st2[1] === A2.c.id && st2[2] === 'shown' && st2[3] === clusterText(A2.g), 'stale hover: moving to another cluster drops the first answer; the second is shown', st2);
    A1 = at('I49');
    await mouse('mouseMoved', A1.c.px, A1.c.py); await sleep(80);
    await p.eval(`window.__h2=${FO}.clusterHover`);
    await mouse('mouseMoved', A1.c.px, A1.c.py + 200); await sleep(1000);
    st2 = await p.eval(`[window.__h2.state, ${tipText}]`);
    check(st2[0] === 'discarded' && st2[1] === null, 'stale hover: leaving before the answer drops it, no pop-up', st2);
    A1 = at('I50');
    await mouse('mouseMoved', A1.c.px, A1.c.py); await sleep(80);
    await p.eval(`window.__h3=${FO}.clusterHover`);
    const v3 = await p.eval(`(function(){var v=CVIWA.focusState.version,cb=document.querySelector('#fo-quarters input[value="Q4"]');cb.checked=false;cb.dispatchEvent(new Event('change',{bubbles:true}));return v})()`);
    await p.waitFor(`CVIWA.focusState.version > ${v3}`, 5000, 'focus redrawn'); await sleep(900);
    st2 = await p.eval(`[window.__h3.state, ${tipText}]`);
    check(st2[0] === 'discarded' && st2[1] === null, 'stale hover: new data before the answer drops it, no pop-up', st2);
    await p.eval(`(function(){window.__leafDelay=0;var cb=document.querySelector('#fo-quarters input[value="Q4"]');cb.checked=true;cb.dispatchEvent(new Event('change',{bubbles:true}))})()`);
    await sleep(600); await idleFo();
    await mouse('mouseMoved', 5, 5);

    // A single premises, real pointer at zoom 16: CVI's tooltip lines, brightened; click: CVI's CVI table.
    const pid = 'X' + G.groups.findIndex(g => g.id === 'E3') + 'P0001';
    const prow = clLines.filter(r => r[cc('Origin.City')] === pid);
    const plon = Number(prow[0][cc('Origin.Long')]), plat = Number(prow[0][cc('Origin.Lat')]);
    const cvis = prow.map(r => r[cc('CVI')]).sort();
    const pAnimals = prow.reduce((t, r) => t + Number(r[cc('Total.Animals')]), 0);
    const wantTip = 'Exporter|' + pid + ', WA — ' + G.county + ' County|' + (cvis.length === 1 ? 'CVI: ' : 'CVIs: ') + cvis.join(', ') + '|Total: ' + pAnimals + ' animals|Click for CVI list';
    await p.eval(`void ${FO}.map.jumpTo({center:[${plon},${plat}],zoom:16})`); await idleFo(); await sleep(150);
    const pc = await p.eval(`(function(){var m=${FO}.map,r=m.getCanvas().getBoundingClientRect(),q=m.project([${plon},${plat}]);return [r.left+q.x,r.top+q.y]})()`);
    await mouse('mouseMoved', pc[0], pc[1]); await sleep(150);
    const ph = await p.eval(`(function(){var h=${FO},i=h.premises.Outbound.findIndex(function(x){return x.premises_id===${JSON.stringify(pid)}});return [${tipText}, h.hoverKey, i+1, h.map.getFeatureState({source:'focus_src_out',id:i+1}).hover===true, h.map.getCanvas().style.cursor]})()`);
    check(ph[0] === wantTip && ph[1] === 'Outbound:p' + ph[2] && ph[3] && ph[4] === 'pointer', 'premises hover (real pointer): CVI\'s tooltip lines, the premises brightened', [ph, wantTip]);
    // A person approaches from the lower part of the circle and moves toward its upper part before clicking.
    // The hover card at the earlier pointer location can cover that next location; center-only clicks miss this.
    await mouse('mouseMoved', pc[0], pc[1] + 6); await sleep(150);
    const hitPremises = await p.eval(`(function(){var e=document.elementFromPoint(${pc[0]},${pc[1] - 6});return e && !!e.closest('.focus-tip')})()`);
    check(!hitPremises, 'premises hover card does not intercept the next pointer location inside the circle', hitPremises);
    await mouse('mousePressed', pc[0], pc[1] - 6); await mouse('mouseReleased', pc[0], pc[1] - 6); await sleep(200);
    const pp = await p.eval(`(function(){var t=[].find.call(document.querySelectorAll('#focus-map .maplibregl-popup'),function(x){return x.querySelector('table')});if(!t)return null;var box=t.querySelector('table').parentElement,s=getComputedStyle(box);
      return {rows:[].map.call(t.querySelectorAll('tr'),function(tr){return [].map.call(tr.children,function(c){return c.textContent}).join('|')}),scroll:[box.clientHeight,s.overflowY],close:!!t.querySelector('.maplibregl-popup-close-button'),n:document.querySelectorAll('#focus-map .maplibregl-popup table').length,
        bar:!!t.querySelector('.focus-stack'),keys:${FO}.clickStack.keys}})()`);
    const wantRows = ['CVI|Origin|Dest|Species'].concat(prow.map(r => [r[cc('CVI')], pid + ', WA', 'Synthetic destination, ID', r[cc('Species.Group')]].join('|')).sort());
    check(pp && JSON.stringify(pp.rows) === JSON.stringify(wantRows) && pp.scroll[0] <= 240 && pp.scroll[1] === 'auto' && pp.close && pp.n === 1,
      'premises click (real pointer): CVI\'s CVI table, scrolling, one pop-up', [pp, wantRows]);
    check(pp && pp.keys.length === 1 && pp.keys[0] === 'Outbound:' + ph[2] && !pp.bar, 'premises click on one premises: no "1 of N" bar (as CVI)', pp && [pp.keys, pp.bar]);

    // Several premises under a click (the page's addition): "1 of N" with the role and previous/next
    // through every premises under the pointer, topmost first. The expected list comes from the premises' places and
    // radii (a circle is hit within its radius plus its 1.5 px ring), ordered as drawn: exporters' layer over
    // importers', then the later-drawn (higher id) first; a point within 1 px of any circle's edge is not used.
    const e3 = G.groups.find(g => g.id === 'E3');
    await p.eval(`(function(){var h=${FO};if(h.clickPopup){h.clickPopup.remove();h.clickPopup=null}return 1})()`);
    await p.eval(`void ${FO}.map.jumpTo({center:${JSON.stringify(e3.center)},zoom:15})`); await idleFo(); await sleep(150);
    const stk = await p.eval(`(function(){var h=${FO},m=h.map,r=m.getCanvas().getBoundingClientRect(),all=[];
      ['Inbound','Outbound'].forEach(function(d){h.premises[d].forEach(function(p,i){var q=m.project([p.lon,p.lat]);all.push({key:d+':'+(i+1),dir:d,id:i+1,x:q.x,y:q.y,r:p.radius_px+1.5})})});
      var c0=m.project(${JSON.stringify(e3.center)}),best=null;
      for(var dx=-40;dx<=40;dx+=2)for(var dy=-40;dy<=40;dy+=2){var x=c0.x+dx,y=c0.y+dy,amb=false,hits=[];
        all.forEach(function(a){var d=Math.hypot(a.x-x,a.y-y);if(Math.abs(d-a.r)<1)amb=true;else if(d<a.r)hits.push(a)});
        if(amb||hits.length<3||!hits.some(function(a){return a.dir==='Inbound'})||!hits.some(function(a){return a.dir==='Outbound'}))continue;
        if(!best||hits.length<best.hits.length)best={x:x,y:y,hits:hits}}
      if(!best)return null;
      best.hits.sort(function(a,b){return a.dir===b.dir?b.id-a.id:a.dir==='Outbound'?-1:1});
      return {px:r.left+best.x,py:r.top+best.y,keys:best.hits.map(function(a){return a.key})}})()`);
    check(!!stk, 'stacked premises: a point over 3 or more premises of both directions found near E3/I9 at zoom 15', stk);
    if (stk) {
      await mouse('mouseMoved', stk.px, stk.py); await sleep(150);
      const hk = await p.eval(`${FO}.hoverKey`);
      check(hk === stk.keys[0].replace(':', ':p'), 'stacked premises: the hover shows the premises on top (the first of the list)', [hk, stk.keys[0]]);
      await mouse('mousePressed', stk.px, stk.py); await mouse('mouseReleased', stk.px, stk.py); await sleep(200);
      const STK = `(function(){var h=${FO},ps=document.querySelectorAll('#focus-map .maplibregl-popup.focus-click');var t=ps[0];if(!t)return null;var b=t.querySelector('.focus-stack');
        var k=h.clickStack.keys[h.clickStack.index].split(':'),p=h.premises[k[0]][k[1]-1];
        return {n:ps.length,tables:document.querySelectorAll('#focus-map .maplibregl-popup table').length,keys:h.clickStack.keys,index:h.clickStack.index,
          label:b?b.querySelector('span').textContent:null,prev:b?[b.children[0].disabled,b.children[0].title]:null,next:b?[b.children[2].disabled,b.children[2].title]:null,
          rows:[].map.call(t.querySelectorAll('tr'),function(tr){return [].map.call(tr.children,function(c){return c.textContent}).join('|')}),
          want:['CVI|Origin|Dest|Species'].concat(p.popup.rows.map(function(r){return r.join('|')})),role:p.tooltip.role}})()`;
      const N = stk.keys.length, roleOf = k => (k.startsWith('Outbound') ? 'Exporter' : 'Importer');
      let s0 = await p.eval(STK);
      check(s0 && JSON.stringify(s0.keys) === JSON.stringify(stk.keys), 'stacked click (real pointer): every premises under the pointer, each once, topmost first', [s0 && s0.keys, stk.keys]);
      let walk = true;
      const steps = [];
      for (let i = 0; i < N; i++) {
        if (i) await p.eval(`document.querySelector('#focus-map .focus-click .focus-stack button[title="Next premises"]').click()`);
        const s1 = await p.eval(STK);
        steps.push(s1 && [s1.label, s1.prev[0], s1.next[0], s1.index]);
        if (!s1 || s1.n !== 1 || s1.tables !== 1 || s1.index !== i || s1.label !== (i + 1) + ' of ' + N + ' · ' + roleOf(stk.keys[i]) || s1.role !== roleOf(stk.keys[i])
          || s1.prev[0] !== (i === 0) || s1.next[0] !== (i === N - 1) || JSON.stringify(s1.rows) !== JSON.stringify(s1.want)) walk = false;
      }
      check(walk, 'stacked click: Next walks 1 of N to N of N, the role and the premises\' CVI table each time, one pop-up, Previous grayed at 1 and Next at N', steps);
      await p.eval(`document.querySelector('#focus-map .focus-click .focus-stack button[title="Next premises"]').click()`);
      s0 = await p.eval(STK);
      check(s0.index === N - 1 && s0.label.startsWith(N + ' of ' + N), 'stacked click: Next at the last premises stays there', s0.label);
      for (let i = N - 1; i > 0; i--) await p.eval(`document.querySelector('#focus-map .focus-click .focus-stack button[title="Previous premises"]').click()`);
      s0 = await p.eval(STK);
      check(s0.index === 0 && s0.label === '1 of ' + N + ' · ' + roleOf(stk.keys[0]) && s0.prev[0] && !s0.next[0] && JSON.stringify(s0.rows) === JSON.stringify(s0.want),
        'stacked click: Previous walks back to 1 of N', [s0.label, s0.prev, s0.next]);
      check(s0.prev[1] === 'Previous premises' && s0.next[1] === 'Next premises', 'stacked click: the buttons are named for screen readers and on hover', [s0.prev, s0.next]);
      await shot('focus-stacked-click');
      // Readable premises tables remain scrollable and interactive in smaller windows.
      for (const [w, h] of [[1366, 768], [1024, 600]]) {
        await p.size(w, h); await p.eval(`void ${FO}.map.resize()`); await sleep(250);
        await p.eval(`(function(){var h=${FO};h.map.jumpTo({center:h.clickPopup.getLngLat(),zoom:15});
          var k=h.clickStack.keys[0].split(':'),pr=h.premises[k[0]][k[1]-1];
          var rows=Array.from({length:25},function(_,i){return ['24-WA-'+i+'-LONG-CERTIFICATE','Synthetic origin with a long name, WA','Synthetic destination with a long name, ID','Synthetic species group']});
          var box=document.querySelector('#focus-map .focus-click table').parentElement;
          box.replaceWith(CVIWA.focusmap.popupElement({rows:rows,more:12}));h.clickPopup.setLngLat(h.clickPopup.getLngLat());return 1})()`);
        await idleFo(); await sleep(200);
        const small = await p.eval(`(function(){var pop=document.querySelector('#focus-map .focus-click'),t=pop.querySelector('table'),b=t.parentElement,c=pop.querySelector('.maplibregl-popup-content');
          var r=c.getBoundingClientRect(),m=document.querySelector('#focus-map').getBoundingClientRect();
          var cells=Array.from(t.querySelector('tbody tr').children),ends=cells.map(function(td){var q=document.createRange();q.selectNodeContents(td);return q.getBoundingClientRect()});
          b.scrollTop=10000;b.scrollLeft=10000;
          return {gaps:ends.slice(1).map(function(r,i){return r.left-ends[i].right}),font:getComputedStyle(t.querySelector('td')).fontSize,rows:t.querySelectorAll('tbody tr').length,
            scroll:[b.scrollTop,b.scrollLeft,b.scrollHeight>b.clientHeight,b.scrollWidth>b.clientWidth],
            contained:r.left>=m.left-1&&r.right<=m.right+1&&r.top>=m.top-1&&r.bottom<=m.bottom+1,
            page:document.documentElement.scrollWidth<=innerWidth,more:b.textContent.includes('+12 more CVIs')}})()`);
        check(small && small.font === '14px' && small.rows === 25 && small.scroll[0] > 0 && (!small.scroll[3] || small.scroll[1] > 0) && small.more,
          'readability '+w+'x'+h+': 14px table; 25 long rows and overflow note reachable by scrolling', small);
        check(small && small.contained && small.page, 'readability '+w+'x'+h+': popup inside map without page horizontal overflow', small);
        check(small.gaps.every(g => g >= 19.5), 'spacing '+w+'x'+h+': at least 20px between long-entry column text', small.gaps);
        fs.writeFileSync(path.join(OUT,'popup_'+w+'x'+h+'.json'), JSON.stringify(small,null,2));
        await shot('focus-popup-long-'+w+'x'+h);
        const nextXY = await p.eval(`(function(){var b=document.querySelector('#focus-map .focus-click button[title="Next premises"]'),r=b.getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2]})()`);
        await mouse('mousePressed', ...nextXY); await mouse('mouseReleased', ...nextXY); await sleep(100);
        const sn = await p.eval(STK);
        check(sn && sn.index === 1 && JSON.stringify(sn.rows) === JSON.stringify(sn.want), 'readability '+w+'x'+h+': real pointer Next shows the next CVI table', sn && sn.label);
        const prevXY = await p.eval(`(function(){var r=document.querySelector('#focus-map .focus-click button[title="Previous premises"]').getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2]})()`);
        await mouse('mousePressed', ...prevXY); await mouse('mouseReleased', ...prevXY); await sleep(100);
        const back = await p.eval(STK);
        check(back && back.index === 0 && JSON.stringify(back.rows) === JSON.stringify(back.want), 'readability '+w+'x'+h+': real pointer Previous restores the first CVI table', back && back.label);
        await shot('focus-popup-readable-'+w+'x'+h);
      }
      const closeXY = await p.eval(`(function(){var r=document.querySelector('#focus-map .focus-click .maplibregl-popup-close-button').getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2]})()`);
      await mouse('mousePressed', ...closeXY); await mouse('mouseReleased', ...closeXY); await sleep(100);
      check(await p.eval(`document.querySelectorAll('#focus-map .focus-click').length`) === 0, 'readability small window: real pointer Close dismisses the popup');
      await p.size(1400, 1000); await p.eval(`void ${FO}.map.resize()`); await sleep(200);
      // Reopen for the existing stale-data check below.
      await p.eval(`(function(){var h=${FO},q=h.map.project(h.map.getCenter());h.map.fire('click',{point:q,lngLat:h.map.getCenter(),originalEvent:{target:h.map.getCanvas()}});return 1})()`);

      const v4 = await p.eval(`(function(){var v=CVIWA.focusState.version,cb=document.querySelector('#fo-quarters input[value="Q4"]');cb.checked=false;cb.dispatchEvent(new Event('change',{bubbles:true}));return v})()`);
      await p.waitFor(`CVIWA.focusState.version > ${v4}`, 5000, 'focus redrawn'); await sleep(300);
      const gone = await p.eval(`document.querySelectorAll('#focus-map .maplibregl-popup.focus-click').length`);
      check(gone === 0, 'stacked click: new data closes the pop-up (its list would be stale)', gone);
      await p.eval(`(function(){var cb=document.querySelector('#fo-quarters input[value="Q4"]');cb.checked=true;cb.dispatchEvent(new Event('change',{bubbles:true}))})()`);
      await sleep(600); await idleFo();
      await mouse('mouseMoved', 5, 5);
    }
    await p.eval(`void ${FO}.map.jumpTo({center:${JSON.stringify(G.camera.center)},zoom:${G.camera.zoom}})`); await idleFo(); await sleep(150);
    cr = await p.eval(CLREAD);
    const c50 = cr.clusters.find(c => c.dir === 'Inbound' && c.count === 50);
    await mouse('mousePressed', c50.px, c50.py); await mouse('mouseReleased', c50.px, c50.py); await sleep(200);
    const afterClusterClick = await p.eval(`document.querySelectorAll('#focus-map .maplibregl-popup table').length`);
    check(afterClusterClick === 0, 'cluster click: no pop-up of its own (CVI has none), the earlier CVI table closed', afterClusterClick);
    await mouse('mouseMoved', 5, 5);
    // Above zoom 12 every premises is drawn on its own.
    const g200 = G.groups.find(g => g.id === 'I200');
    await p.eval(`void ${FO}.map.jumpTo({center:${JSON.stringify(g200.center)},zoom:13})`); await idleFo(); await sleep(150);
    const z13 = await p.eval(`(function(){var m=${FO}.map,ids={};m.queryRenderedFeatures({layers:['focus_points_in']}).forEach(function(f){ids[f.properties.premises_id]=1});return {clusters:m.queryRenderedFeatures({layers:['focus_clusters_in','focus_clusters_out']}).length,ids:Object.keys(ids).sort(),counts:m.getContainer().querySelectorAll('.focus-count').length}})()`);
    check(z13.clusters === 0 && z13.counts === 0 && JSON.stringify(z13.ids) === JSON.stringify(g200.members.slice().sort()), 'zoom 13 (above 12): no clusters or counts, all 200 premises of the group drawn', [z13.clusters, z13.counts, z13.ids.length]);

    // 8b. County Focus Style, on the cluster fixture at the fixed camera: opacity, Hide CVI circles, labels,
    // outlines, Label/Boundary style; its own basemap (USGS answered by this test: tiles, then not found).
    await p.eval(`void ${FO}.map.jumpTo({center:${JSON.stringify(G.camera.center)},zoom:${G.camera.zoom}})`); await idleFo(); await sleep(150);
    const setCtl = (id, v) => p.eval(`(function(){var e=document.getElementById(${JSON.stringify(id)});if(e.type==='checkbox')e.checked=${JSON.stringify(v)};else e.value=${JSON.stringify(v)};e.dispatchEvent(new Event('change',{bubbles:true}));return 1})()`);
    const STY = `(function(){var h=${FO},m=h.map,el=m.getContainer();return {
      pts:['focus_points_in','focus_points_out'].map(function(id){return [m.getLayoutProperty(id,'visibility'),JSON.stringify(m.getPaintProperty(id,'circle-opacity'))]}),
      cls:['focus_clusters_in','focus_clusters_out'].map(function(id){return [m.getLayoutProperty(id,'visibility'),m.getPaintProperty(id,'circle-opacity')]}),
      counts:el.querySelectorAll('.focus-count:not(.collided)').length,grid:[m.getLayoutProperty('county-lines','visibility'),m.getPaintProperty('county-lines','line-color')],
      border:[m.getLayoutProperty('wa_focus_outline_line','visibility')||'visible',m.getPaintProperty('wa_focus_outline_line','line-color')],fill:m.getLayoutProperty('wa_focus_outline_fill','visibility')||'visible',
      labelsShown:h.labels.filter(function(x){return !x.getElement().classList.contains('hidden')}).length,label:el.style.getPropertyValue('--county-label'),
      land:m.getLayoutProperty('wa-land','visibility'),shown:h.shown?h.shown.id:null,failed:!!h.basemapFailed,layers:m.getStyle().layers.map(function(l){return l.id}).filter(function(id){return /^focus_|^wa_focus|county-lines|wa-land/.test(id)}),
      waLabel:${A}.map.getContainer().style.getPropertyValue('--county-label'),waShown:${A}.shown?${A}.shown.id:null,
      note:document.getElementById('fo-basemap-note').hidden?null:document.getElementById('fo-basemap-note').textContent,
      strip:document.getElementById('summary-strip').textContent.replace(/\\s+/g,' ').trim()}})()`;
    const s0 = await p.eval(STY);
    const opCaseFor = op => JSON.stringify(['case', ['boolean', ['feature-state', 'hover'], false], Math.min(1, op + 0.25), op]);
    for (const op of [0.2, 0.4, 0.6, 1.0, 0.8]) {
      await setCtl('fo-opacity', op === 1 ? '1.0' : String(op)); await sleep(60);
      const so = await p.eval(STY);
      check(so.pts.every(x => x[1] === opCaseFor(op)) && so.cls.every(x => x[1] === Math.max(0.55, op)), 'Circle opacity ' + op + ': premises at it (hover +0.25, at most 1), clusters at least 0.55 (CVI)', [so.pts, so.cls]);
    }
    const scaled = await p.eval(`(function(){var e=document.getElementById('fo-scaling'),r=[];['quantile','natural','sqrt','log'].forEach(function(v){e.value=v;e.dispatchEvent(new Event('change',{bubbles:true}));r.push(document.getElementById('fo-bins-field').hidden)});return r})()`);
    check(JSON.stringify(scaled) === '[false,false,true,true]', 'Number of bins shown only for Quantile and Natural breaks (CVI)', scaled);
    await sleep(500); await idleFo();
    const hideAt = at('I50').c;
    await setCtl('fo-hide', true); await sleep(150);
    let s1 = await p.eval(STY);
    await mouse('mouseMoved', hideAt.px, hideAt.py); await sleep(150);
    const hiddenTip = await p.eval(tipText);
    await p.eval(`CVIWA.map.screenshot(${FO}).then(function(){return 1})`);
    const hiddenShot = await p.eval(`${FO}.lastCounts.length`);
    check(s1.pts.every(x => x[0] === 'none') && s1.cls.every(x => x[0] === 'none') && s1.counts === 0 && hiddenTip === null && hiddenShot === 0,
      'Hide CVI circles: premises, clusters and counts off the map, its hover and its screenshot', [s1.pts, s1.cls, s1.counts, hiddenTip, hiddenShot]);
    check(s1.fill === 'visible' && s1.border[0] === 'visible' && s1.labelsShown === s0.labelsShown && s1.strip === s0.strip, 'Hide CVI circles: outlines, county names and the summary kept', [s1.fill, s1.border, s1.labelsShown, s1.strip]);
    await mouse('mouseMoved', 5, 5);
    await setCtl('fo-hide', false); await sleep(200);
    s1 = await p.eval(STY);
    check(s1.pts.every(x => x[0] === 'visible') && s1.cls.every(x => x[0] === 'visible') && s1.counts === s0.counts, 'Hide CVI circles off: everything back', [s1.pts, s1.counts, s0.counts]);
    await setCtl('fo-labels', false); await sleep(80);
    s1 = await p.eval(STY);
    await p.eval(`CVIWA.map.screenshot(${FO}).then(function(){return 1})`);
    const noLabelShot = await p.eval(`${FO}.lastLabels.length`);
    check(s1.labelsShown === 0 && noLabelShot === 0 && s0.labelsShown > 0, 'Show county labels off: no county names on the map or in the screenshot', [s1.labelsShown, noLabelShot]);
    await setCtl('fo-labels', true); await setCtl('fo-outlines', false); await sleep(80);
    s1 = await p.eval(STY);
    check(s1.grid[0] === 'none' && s1.border[0] === 'visible' && s1.fill === 'visible' && s1.labelsShown === s0.labelsShown, 'Show county outlines off: the county grid off, the selected counties still highlighted (CVI)', [s1.grid, s1.border]);
    await setCtl('fo-outlines', true);
    const light = await p.eval(`CVIWA.basemaps.contrast('light','light',false)`);
    await setCtl('fo-label-style', 'light'); await setCtl('fo-boundary-style', 'light'); await sleep(80);
    s1 = await p.eval(STY);
    check(s1.label === light.label && s1.grid[1] === light.line && s1.border[1] === light.line && s1.waLabel === s0.waLabel, 'Label and Boundary style Light: names, grid and selected border in CVI\'s light colors; the WA map unchanged', [s1.label, s1.grid, s1.border, light]);
    await setCtl('fo-label-style', 'auto'); await setCtl('fo-boundary-style', 'auto'); await sleep(80);
    s1 = await p.eval(STY);
    check(s1.label === '#2c3e50' && s1.grid[0] === 'visible' && s1.grid[1] === '#888888' && s1.border[1] === '#245566', 'Label and Boundary style back to Auto: CVI\'s Focus colors', [s1.label, s1.grid, s1.border]);
    // Its own basemap: tiles only from the chosen provider while it is on; Auto follows a dark basemap.
    basemapStep.mode = 'serve'; basemapStep.requests = [];
    const prov0 = log.provider.length;
    await setCtl('fo-basemap', 'usgs-imagery');
    const bmOn = await p.waitFor(`${FO}.shown && ${FO}.shown.id==='usgs-imagery' && ${FO}.tilesOk>0`, 15000, 'Focus basemap').then(() => true, () => false);
    check(bmOn, 'County Focus basemap: the chosen basemap shown on the Focus map, its tiles loaded');
    await idleFo(); await sleep(300);
    s1 = await p.eval(STY);
    const dark = await p.eval(`CVIWA.basemaps.contrast('auto','auto',true)`), usgsCredit = await p.eval(`CVIWA.basemaps.get('usgs-imagery').attribution`);
    await p.eval(`CVIWA.map.screenshot(${FO}).then(function(){return 1})`);
    const bmShot = await p.eval(`[${FO}.lastAttribution, ${FO}.lastCounts.length]`);
    check(s1.shown === 'usgs-imagery' && !s1.failed && s1.land === 'none' && basemapStep.requests.length > 0
      && basemapStep.requests.every(u => /^https:\/\/basemap\.nationalmap\.gov\/arcgis\/rest\/services\/USGSImageryOnly\/MapServer\/tile\//.test(u)) && log.provider.length === prov0,
      'County Focus basemap: tiles only from the chosen basemap, the county land fill hidden', [s1.shown, s1.failed, s1.land, basemapStep.requests.slice(0, 3), log.provider.slice(prov0)]);
    check(JSON.stringify(s1.layers) === JSON.stringify(s0.layers) && s1.counts === s0.counts && s1.note !== null, 'County Focus basemap: the page\'s layers kept on top, the counts and the provider line', [s1.layers, s1.counts, s1.note]);
    check(s1.label === dark.label && s1.grid[1] === dark.line && s1.border[1] === dark.line, 'County Focus on a dark basemap: Auto gives CVI\'s light names and lines (grid and selected border)', [s1.label, s1.grid, s1.border, dark]);
    check(s1.waShown === null && await p.eval(`document.getElementById('s-basemap').value`) === 'offline', 'County Focus basemap is its own: the WA map stays on the offline map', s1.waShown);
    check(typeof bmShot[0] === 'string' && bmShot[0].indexOf(usgsCredit) >= 0 && bmShot[1] === s0.counts, 'screenshot on a basemap: its credit and the counts', bmShot);
    await shot('focus-basemap-dark');
    basemapStep.mode = 'fail';
    await setCtl('fo-basemap', 'usgs-topo');
    check(await p.waitFor(`!document.getElementById('focus-basemap-status').hidden`, 30000, 'Focus basemap failure message').then(() => true, () => false),
      'County Focus basemap that cannot load: a message appears');
    s1 = await p.eval(STY);
    const failMsg = await p.eval(`[document.getElementById('focus-basemap-msg').textContent, document.getElementById('basemap-status').hidden]`);
    check(s1.failed && s1.land === 'visible' && /^Map tiles from USGS The National Map could not be loaded/.test(failMsg[0]) && failMsg[1], 'County Focus basemap that cannot load: the message on the Focus map, the county shapes back', [s1.failed, s1.land, failMsg]);
    await shot('focus-basemap-failed');
    await p.eval(`document.getElementById('focus-basemap-offline').click()`);
    await p.waitFor(`!${FO}.shown && !${FO}.switching`, 10000, 'back to offline'); await idleFo(); await sleep(200);
    basemapStep.mode = null;
    s1 = await p.eval(STY);
    const back = await p.eval(`[document.getElementById('fo-basemap').value, document.getElementById('focus-basemap-status').hidden]`);
    check(back[0] === 'offline' && back[1] && s1.land === 'visible' && s1.label === '#2c3e50' && s1.counts === s0.counts && s1.note === null, '"Back to offline map": the offline county map, CVI\'s Focus colors, the counts', [back, s1.land, s1.label, s1.counts]);
    run.basemapRequests = basemapStep.requests.length;

    // 9. Hover and CVI table text for CVI's payload views (file text as text, a deliberate difference), built as
    // page elements: the lines of CVI's tooltip and the rows of CVI's table, for every premises; no markup from the file.
    const PAY = path.join(ROOT, 'local-test-artifacts', 's5', 'payloads');
    const payRef = JSON.parse(fs.readFileSync(path.join(PAY, 'reference.json'), 'utf8'));
    await p.eval(`window.__cmpPayload=function(rows){var P=CVIWA.focusState.built.premises,F=CVIWA.focusmap,out={n:0,bad:[]};
      var parse=function(h){return new DOMParser().parseFromString('<div>'+h+'</div>','text/html').body.firstChild};
      var lines=function(e){var c=e.cloneNode(true);c.querySelectorAll('br').forEach(function(x){x.replaceWith('|')});return c.textContent.replace(/\\s+/g,' ').trim()};
      var table=function(e){return [].map.call(e.querySelectorAll('tr'),function(tr){return [].map.call(tr.children,function(c){return c.textContent}).join('\\t')}).join('\\n')+'#'+e.textContent};
      var tags=function(e,ok){return [].every.call(e.querySelectorAll('*'),function(x){return ok.indexOf(x.tagName)>=0})};
      rows.forEach(function(r){var p=P.find(function(x){return x.direction===r.direction&&x.premises_id===r.premises_id});
        if(!p){out.bad.push(['missing',r.premises_id]);return;}
        var te=F.tooltipElement(p.tooltip),pe=F.popupElement(p.popup);
        if(lines(te)!==lines(parse(r.safeTooltip)))out.bad.push(['tooltip',r.premises_id,lines(te),lines(parse(r.safeTooltip))]);
        else if(table(pe)!==table(parse(r.popup_html)))out.bad.push(['table',r.premises_id,table(pe),table(parse(r.popup_html))]);
        else if(!tags(te,['STRONG','BR','SPAN'])||!tags(pe,['DIV','TABLE','THEAD','TBODY','TR','TH','TD']))out.bad.push(['markup',r.premises_id]);
        else out.n++;});
      out.premises=P.length;return out}`);
    run.payloadViews = 0; run.payloadPremises = 0;
    for (const c of payRef.cases) {
      const views = c.views.filter(v => v.opts.scaling === 'log' && v.opts.nBins === 5 && !v.missingCoordinates.length).filter((v, i) => c.name === 'full' || i % STRIDE === 0);
      await load(path.join(PAY, c.file));
      for (const v of views) {
        const label = 'payloads ' + c.name + '/' + v.scene + '/' + v.opts.direction + '/' + v.opts.mode;
        const g = await setFocus(v.opts);
        if (g === 'not offered') continue;
        const rows = arr(v.rows).map(r => ({ direction: r.direction, premises_id: r.premises_id, safeTooltip: r.safeTooltip, popup_html: r.popup_html }));
        const res = await p.eval(`window.__cmpPayload(${JSON.stringify(rows)})`);
        run.payloadViews++; run.payloadPremises += res.n;
        check(res.n === rows.length && res.premises === rows.length && !res.bad.length, label + ': hover lines and CVI table as CVI\'s, as page elements', res.bad.slice(0, 2));
      }
    }

    // 9b. Facility layers: CVI's Facility Locations fold and .add_overlay, with the --facilities fixture's
    // manifest folder handed to the page (CVIWA.setFacilityFiles, as the landing page hands over its files). The list
    // against CVI's registry and groups (s5-facilities reference.json); markers only with counties picked and the layer
    // on, the points inside the picked counties (hand-listed from the fixture: King), CVI's marker paint above the
    // premises; real-pointer hover and click give the name as text; Hide CVI circles leaves them; new files replace them.
    {
      const FDIR = path.join(ROOT, 'local-test-artifacts', 's5', 'facilities');
      const FREF = JSON.parse(fs.readFileSync(path.join(FDIR, 'reference.json'), 'utf8')).reference;
      const NOT_LOADED = 'Not loaded: open the CVI map from the landing page with this file to show it.';
      const FACREAD = `(function(){var L=document.getElementById('fo-fac-list');return {open:document.getElementById('fo-fac-block').open,sum:document.getElementById('fo-fac-sum').textContent,
        items:[].map.call(L.querySelectorAll('.fac-grp,.fac-row,.fac-why'),function(e){if(e.classList.contains('fac-grp'))return ['G',e.textContent];if(e.classList.contains('fac-row')){var i=e.querySelector('input');return ['L',e.querySelector('.facility-title').textContent,i.value,i.disabled,e.querySelector('.fac-dot').dataset.color+' '+e.querySelector('.fac-dot').dataset.shape]}return ['W',e.textContent]})}})()`;
      const rgb = h => { h = h.replace('#', ''); return 'rgb(' + [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)).join(', ') + ')'; };
      await load(path.join(PAY, 'full.csv'));
      await p.eval(`document.getElementById('show-focus').click()`); await idleFo();
      let fr = await p.eval(FACREAD);
      const five = [].concat(...FREF.builtin.groups.map(g => [].concat(g.keys)));   // CVI's group order
      check(!fr.open && fr.sum === 'no layer loaded' && JSON.stringify(fr.items.filter(x => x[0] === 'L').map(x => [x[2], x[3]])) === JSON.stringify(five.map(k => [k, true]))
        && fr.items.filter(x => x[0] === 'W').length === 5 && fr.items.filter(x => x[0] === 'W').every(x => x[1] === NOT_LOADED),
        'facilities: without facility files the fold is closed and CVI\'s five layers are listed, grayed, each with why', fr);
      // Hand the manifest folder's files to the page: the manifest, and each layer's file under its key when supplied.
      const send = async (folder, ref) => {
        const dir = path.join(FDIR, folder), texts = {};
        if (fs.existsSync(path.join(dir, 'facility_overlays_manifest.csv'))) texts.manifest = fs.readFileSync(path.join(dir, 'facility_overlays_manifest.csv'), 'utf8');
        ref.layers.forEach(l => { if (fs.existsSync(path.join(dir, l.file))) texts[l.key] = fs.readFileSync(path.join(dir, l.file), 'utf8'); });
        return p.eval(`(function(m){var d={};Object.keys(m).forEach(function(k){d[k]={file:new Blob([m[k]],{type:'text/csv'})}});return CVIWA.setFacilityFiles(d).then(function(f){return Object.keys(f.layers).length})})(${JSON.stringify(texts)})`);
      };
      const R = FREF.manifest, RL = R.layers.filter(l => l.key !== 'master');
      await send('manifest', R);
      fr = await p.eval(FACREAD);
      // Each layer is listed with its mark (shape and color, checked in the UI unit suite); CVI's
      // color is kept as the registry's cviColor, compared with CVI's here.
      const MARKS = await p.eval(`(function(){var r=CVIWA.focusState.fac.reg.layers,o={};r.forEach(function(l){o[l.key]=[l.color,l.shape,l.cviColor]});return o})()`);
      check(RL.every(l => MARKS[l.key] && MARKS[l.key][2] === l.color), 'facilities: CVI\'s color kept as cviColor for every layer',
        RL.map(l => [l.key, l.color, MARKS[l.key]]));
      const wantOrder = [];
      R.groups.forEach(g => { const keys = [].concat(g.keys).filter(k => k !== 'master'); if (!keys.length) return; wantOrder.push(['G', g.group]);
        keys.forEach(k => { const l = RL.find(x => x.key === k); wantOrder.push(['L', l.live_label, k, l.points === null, MARKS[k][0] + ' ' + MARKS[k][1]]); }); });
      check(JSON.stringify(fr.items.filter(x => x[0] !== 'W')) === JSON.stringify(wantOrder), 'facilities: groups, labels, colors and order as CVI\'s registry (.overlay_groups, live_label); layers CVI cannot draw grayed', [fr.items, wantOrder]);
      const whyOf = k => { const i = fr.items.findIndex(x => x[0] === 'L' && x[2] === k), n = fr.items[i + 1]; return n && n[0] === 'W' ? n[1] : ''; };
      check(whyOf('feedlots') === NOT_LOADED && whyOf('absent') === NOT_LOADED && whyOf('restricted') === 'No row has numbers in both coordinate columns.'
        && whyOf('slaughterhouses') === 'Left out: 3 rows without numeric coordinates.' && whyOf('ranges') === 'Left out: 2 rows outside -90..90 / -180..180.' && whyOf('named') === '',
        'facilities: the reason under each grayed layer, and the rows left out of a drawn one', ['feedlots', 'absent', 'restricted', 'slaughterhouses', 'ranges', 'named'].map(k => [k, whyOf(k)]));
      check(fr.items.some(x => x[0] === 'W' && x[1] === 'Manifest row 12 not used: the key "master" is reserved.'), 'facilities: the manifest row with the reserved key is named', fr.items.filter(x => x[0] === 'W'));
      check(fr.sum === 'none shown', 'facilities: nothing switched on by the files (CVI: start unselected)', fr.sum);
      const usable = RL.filter(l => l.points !== null).map(l => l.key);
      await setFocus({ counties: ['King'], direction: 'combined', mode: 'overlap', species: await p.eval('CVIWA.state.master.speciesChoices'),
        years: await p.eval('CVIWA.state.master.yearChoices'), quarters: ['Q1', 'Q2', 'Q3', 'Q4'], rawSpecies: [] });
      await sleep(400); await idleFo();
      const FACMAP = `(function(){var h=${FO},m=h.map,ids=m.getStyle().layers.map(function(l){return l.id});return {drawn:h.fac.drawn,
        layers:ids.filter(function(id){return /^focus_fac_[0-9]+$/.test(id)}).map(function(id){return [id,m.getLayer(id).type,m.getLayoutProperty(id,'icon-image'),m.getLayoutProperty(id,'icon-size'),m.getPaintProperty(id,'icon-opacity'),m.getLayoutProperty(id,'icon-allow-overlap'),m.getLayoutProperty(id,'visibility')||'visible']}),
        firstFac:ids.findIndex(function(id){return /^focus_fac_/.test(id)}),lastPremises:Math.max(ids.indexOf('focus_points_in'),ids.indexOf('focus_clusters_in'),ids.indexOf('focus_points_out'),ids.indexOf('focus_clusters_out'))}})()`;
      let fm = await p.eval(FACMAP);
      check(fm.drawn.every(x => !x[1].length), 'facilities: a layer switched off draws nothing', fm.drawn);
      await p.eval(`document.getElementById('fo-fac-all').click()`); await sleep(150); await idleFo();
      fr = await p.eval(FACREAD); fm = await p.eval(FACMAP);
      check(fr.sum === usable.length + ' of ' + usable.length + ' shown' && JSON.stringify(fr.items.filter(x => x[0] === 'L' && !x[3]).map(x => x[2]).sort()) === JSON.stringify(usable.slice().sort()),
        'facilities: All switches on the usable layers only', [fr.sum, usable]);
      // Each layer's mark (its shape and color, the circle's size: 7 px fill, white 2 px edge) in
      // place of CVI's circle. Its picture is made when a point is first drawn; the rendered checks below need it.
      const wantLayers = RL.filter(l => l.points !== null).map((l, i) => ['focus_fac_' + i, 'symbol',
        'wsda-mark:' + MARKS[l.key][1] + ':' + MARKS[l.key][0], 1, 0.95, true, 'visible']);
      check(JSON.stringify(fm.layers) === JSON.stringify(wantLayers) && fm.firstFac > fm.lastPremises, 'facilities: one layer per usable layer in CVI\'s order, each in its layer\'s mark (opacity 0.95), above the premises', [fm.layers, wantLayers, fm.firstFac, fm.lastPremises]);
      const KING = { slaughterhouses: ['Synthetic Packer King', '<b>Bold</b> & Co'], fairgrounds: ['Synthetic King Fair', ''], markets: ['Second'], claimed: [''],
        named: ['Named One'], fallback: ['Named One'], noname: ['Named One'], ranges: ['In range'] };
      for (let i = 1; i <= 9; i++) KING['auto' + i] = [''];
      const wantKing = usable.map(k => [k, KING[k] || []]);
      check(JSON.stringify(fm.drawn) === JSON.stringify(wantKing), 'facilities: with King picked, each layer\'s points inside King (Whidbey, Yakima and out-of-range points not)', [fm.drawn, wantKing]);
      await p.eval(`(function(){var cb=document.querySelector('#fo-fac-list input[value="named"]');cb.checked=false;cb.dispatchEvent(new Event('change',{bubbles:true}));return 1})()`); await sleep(100);
      fm = await p.eval(FACMAP);
      check(JSON.stringify(fm.drawn) === JSON.stringify(wantKing.map(x => [x[0], x[0] === 'named' ? [] : x[1]])) && (await p.eval(FACREAD)).sum === (usable.length - 1) + ' of ' + usable.length + ' shown',
        'facilities: one layer switched off, the others stay', fm.drawn);
      await p.eval(`document.querySelector('[data-clear="foCounties"]').click()`); await sleep(500); await idleFo();
      fm = await p.eval(FACMAP);
      check(fm.drawn.every(x => !x[1].length), 'facilities: no county picked, no facility markers (as CVI)', fm.drawn);
      await setFocus({ counties: ['King'], direction: 'combined', mode: 'overlap', species: await p.eval('CVIWA.state.master.speciesChoices'),
        years: await p.eval('CVIWA.state.master.yearChoices'), quarters: ['Q1', 'Q2', 'Q3', 'Q4'], rawSpecies: [] });
      await sleep(400); await idleFo();
      // Hover and click on the marker named "<b>Bold</b> & Co" (real pointer): the name as text, no markup made.
      const bold = [-122.2, 47.48];
      await p.eval(`void ${FO}.map.jumpTo({center:${JSON.stringify(bold)},zoom:13})`); await idleFo(); await sleep(150);
      const bp = await p.eval(`(function(){var m=${FO}.map,r=m.getCanvas().getBoundingClientRect(),q=m.project(${JSON.stringify(bold)});return [r.left+q.x,r.top+q.y]})()`);
      await mouse('mouseMoved', bp[0], bp[1]); await sleep(150);
      const ft = await p.eval(`(function(){var t=document.querySelector('#focus-map .maplibregl-popup.focus-tip .maplibregl-popup-content');return t?[t.textContent,t.querySelectorAll('b').length,${FO}.hoverKey]:null})()`);
      check(ft && ft[0] === '<b>Bold</b> & Co' && ft[1] === 0 && /^focus_fac_0:/.test(ft[2]), 'facility hover (real pointer): the name as text (CVI\'s tooltip, its markup not made)', ft);
      await mouse('mouseMoved', bp[0], bp[1] + 6); await sleep(150);
      const hitFacility = await p.eval(`(function(){var e=document.elementFromPoint(${bp[0]},${bp[1] - 6});return e && !!e.closest('.focus-tip')})()`);
      check(!hitFacility, 'facility hover card does not intercept the next pointer location inside the marker', hitFacility);
      await mouse('mousePressed', bp[0], bp[1] - 6); await mouse('mouseReleased', bp[0], bp[1] - 6); await sleep(200);
      const fc = await p.eval(`(function(){var ps=document.querySelectorAll('#focus-map .maplibregl-popup.focus-click');var c=ps[0]&&ps[0].querySelector('.maplibregl-popup-content > div');return c?[ps.length,c.textContent,c.querySelectorAll('*').length,!!ps[0].querySelector('table')]:null})()`);
      check(fc && fc[0] === 1 && fc[1].includes('<b>Bold</b> & Co') && fc[1].includes('Layer:') && fc[1].includes('WA county: King') && !fc[3], 'facility click (real pointer): one shared details pop-up with supplied name/layer/county as text, no CVI table', fc);
      await shot('focus-facilities');
      await p.eval(`(function(){var d=document.getElementById('fo-fac-block');d.open=true;d.scrollIntoView();return 1})()`); await sleep(100);
      await shot('focus-facilities-list');
      await p.eval(`(function(){var d=document.getElementById('fo-fac-block');d.open=false;document.querySelector('.sidebar, aside, #sidebar') && 0;window.scrollTo(0,0);return 1})()`);
      await p.eval(`(function(){var h=${FO};if(h.clickPopup){h.clickPopup.remove();h.clickPopup=null}return 1})()`);
      await mouse('mouseMoved', 5, 5);
      // Hide CVI circles leaves the facility markers.
      await p.eval(`(function(){var e=document.getElementById('fo-hide');e.checked=true;e.dispatchEvent(new Event('change',{bubbles:true}));return 1})()`); await sleep(100);
      fm = await p.eval(FACMAP);
      check(fm.layers.every(x => x[6] === 'visible') && fm.drawn.some(x => x[1].length), 'Hide CVI circles: the facility markers stay', fm.layers.map(x => x[6]));
      await p.eval(`(function(){var e=document.getElementById('fo-hide');e.checked=false;e.dispatchEvent(new Event('change',{bubbles:true}));return 1})()`); await sleep(100);
      // Facility sources, paint and rendered markers survive a tile style and failure recovery.
      const renderedFacilities = () => p.eval(`(function(){var m=${FO}.map,ids=m.getStyle().layers.map(function(l){return l.id}).filter(function(id){return /^focus_fac_[0-9]+$/.test(id)});
        return Array.from(new Set(m.queryRenderedFeatures({layers:ids}).map(function(f){return f.layer.id+':'+f.id}))).sort()})()`);
      const beforeStyle = await p.eval(FACMAP), beforeRendered = await renderedFacilities();
      for (const [basemap, mode] of [['usgs-imagery', 'serve'], ['usgs-topo', 'fail'], ['offline', null]]) {
        basemapStep.mode = mode;
        await p.eval(`(function(){var e=document.getElementById('fo-basemap');e.value=${JSON.stringify(basemap)};e.dispatchEvent(new Event('change',{bubbles:true}));return 1})()`);
        const settled = basemap === 'offline' ? `!${FO}.shown && !${FO}.switching` : mode === 'serve'
          ? `${FO}.shown && ${FO}.shown.id==='${basemap}' && ${FO}.tilesOk>0` : `${FO}.basemapFailed`;
        await p.waitFor(settled, mode === 'fail' ? 30000 : 15000, 'facility basemap '+basemap); await idleFo(); await sleep(200);
        fm = await p.eval(FACMAP);
        const rendered = await renderedFacilities();
        check(beforeRendered.length > 0 && JSON.stringify(fm.layers) === JSON.stringify(beforeStyle.layers)
          && JSON.stringify(fm.drawn) === JSON.stringify(beforeStyle.drawn) && JSON.stringify(rendered) === JSON.stringify(beforeRendered),
          'facility markers survive '+basemap+' ('+mode+'): same sources, paint and rendered marker identities', [fm.layers, beforeStyle.layers, rendered, beforeRendered]);
      }
      basemapStep.mode = null;
      // New files replace the old: the built-ins-only folder (no manifest). Layers no longer listed go from the map; a
      // switch on a layer still usable stays on.
      await send('builtin', FREF.builtin);
      fr = await p.eval(FACREAD); fm = await p.eval(FACMAP);
      const bUsable = FREF.builtin.layers.filter(l => l.points !== null).map(l => l.key);
      const BMARKS = await p.eval(`(function(){var r=CVIWA.focusState.fac.reg.layers,o={};r.forEach(function(l){o[l.key]=[l.color,l.shape,l.cviColor]});return o})()`);
      check(FREF.builtin.layers.every(l => BMARKS[l.key][2] === l.color), 'facilities: the built-in layers keep CVI\'s color as cviColor');
      check(JSON.stringify(fr.items.filter(x => x[0] === 'L').map(x => [x[2], x[3]])) === JSON.stringify(five.map(k => [k, FREF.builtin.layers.find(l => l.key === k).points === null]))
        && JSON.stringify(fm.layers.map(x => x[2])) === JSON.stringify(bUsable.map(k => 'wsda-mark:' + BMARKS[k][1] + ':' + BMARKS[k][0]))
        && fr.sum === bUsable.length + ' of ' + bUsable.length + ' shown', 'facilities: new files replace the list and the map layers; switches of layers still usable stay on', [fr.items, fm.layers, fr.sum]);
      check(JSON.stringify(fm.drawn) === JSON.stringify(bUsable.map(k => [k, k === 'markets' ? ['Market B'] : KING[k]])), 'facilities: the built-in files\' points inside King', fm.drawn);
      await send('malformed', FREF.malformed);
      fr = await p.eval(FACREAD);
      check(fr.items.some(x => x[0] === 'W' && /has no "key" and "file" columns/.test(x[1])) && fr.items.filter(x => x[0] === 'L').length === 5, 'facilities: a malformed manifest is said, the built-in layers listed (CVI warns too)', fr.items.filter(x => x[0] === 'W'));
      // New files handed over without the old ones remove usable, selected markers.
      await send('builtin', FREF.builtin);
      await p.eval(`document.getElementById('fo-fac-all').click()`);
      fm = await p.eval(FACMAP);
      check(fm.drawn.some(x => x[1].length), 'facility replacement precondition: supplied, selected markers are drawn', fm.drawn);
      await p.eval(`(function(){return CVIWA.setFacilityFiles({}).then(function(){return 1})})()`);
      const emptied = await p.eval(`({on:CVIWA.focusState.fac.on,files:Object.values(CVIWA.focusState.fac.layers).every(function(x){return x===null})})`);
      fm = await p.eval(FACMAP);
      check(emptied.files && emptied.on.length === 0 && fm.drawn.length === 0 && fm.layers.length === 0,
        'facility replacement: no files in the new hand-over clears old files, selected switches and rendered markers', [emptied, fm.drawn, fm.layers]);
      await p.eval(`(function(){return CVIWA.setFacilityFiles({
        feedlots:{file:new Blob(['name,lat,long\\nInvalid,91,-122\\n'])},
        restricted:{file:new Blob(['NAME,lat,long\\nInfinite,Inf,-122\\n'])},
        markets:{file:new Blob(['name,lat,long\\nOutside King,46,-117\\nInvalid,-91,-122\\n'])}
      }).then(function(){document.getElementById('fo-fac-all').click();return 1})})()`);
      const invalidOnly = await p.eval(`(function(){var f=CVIWA.focusState.fac;return {on:f.on,
        boxes:['feedlots','restricted','markets'].map(function(k){var e=document.querySelector('#fo-fac-list input[value="'+k+'"]');return [k,e.disabled,e.checked]}),
        reasons:[].map.call(document.querySelectorAll('#fo-fac-list .fac-why'),function(e){return e.textContent}),
        rejected:[f.layers.feedlots.outOfRange,f.layers.restricted.outOfRange],valid:f.layers.markets.points.length}})()`);
      check(JSON.stringify(invalidOnly.boxes) === JSON.stringify([['feedlots',true,false],['restricted',true,false],['markets',false,true]])
        && JSON.stringify(invalidOnly.rejected) === '[1,1]' && invalidOnly.reasons.filter(x => /^No row has valid coordinates/.test(x)).length === 2,
        'facilities: all-out-of-range/nonfinite layers grayed, rejected-row counts and valid-coordinate reasons retained', invalidOnly);
      fm = await p.eval(FACMAP);
      check(JSON.stringify(invalidOnly.on) === '["markets"]' && invalidOnly.valid === 1 && fm.layers.length === 1 && fm.drawn.every(x => !x[1].length),
        'facility All: only usable coordinates selected; valid layer outside picked King stays enabled without markers', [invalidOnly, fm]);
      await p.eval(`CVIWA.setFacilityFiles({}).then(function(){return 1})`);
      await p.eval(`void ${FO}.map.jumpTo({center:[-121.9,47.4],zoom:9})`); await idleFo();

    // 9c. The County Focus legend (CVI's content; opacity-aware swatches and nested 4–24 px sizes; one line with Hide),
    // Browse over the whole master's periods, the County Focus map's own neighboring regions, and Reset All's County
    // Focus part. (In 9b's block: its fixture helpers.)
      const hexBlend = (c, a, u) => '#' + [1, 3, 5].map(i => Math.round(parseInt(c.slice(i, i + 2), 16) * a + parseInt(u.slice(i, i + 2), 16) * (1 - a)).toString(16).padStart(2, '0')).join('');
      const toHex = rgb => '#' + rgb.match(/\d+/g).slice(0, 3).map(x => Number(x).toString(16).padStart(2, '0')).join('');
      const LG = `(function(){var p=document.getElementById('legend-panel-focus');return {hidden:p.hidden,btn:document.getElementById('legend-toggle-focus').getAttribute('aria-expanded'),
        text:p.textContent.trim(),heads:[].map.call(p.querySelectorAll('strong'),function(e){return e.textContent}),
        dots:[].map.call(p.querySelectorAll('.lg-row .lg-dot'),function(e){return [e.nextSibling.textContent,getComputedStyle(e).backgroundColor]}),
        rs:[].map.call(p.querySelectorAll('svg.lg-sizes circle'),function(c){return Number(c.getAttribute('r'))}),labels:[].map.call(p.querySelectorAll('svg.lg-sizes text'),function(t){return t.textContent}),
        cl:[].map.call(p.querySelectorAll('.lg-cl'),function(e){return [e.textContent,getComputedStyle(e).backgroundColor]}),state:CVIWA.focusState.legend&&CVIWA.focusState.legend.state}})()`;
      await setFocus({ counties: [], direction: 'combined', mode: 'overlap', species: await p.eval('CVIWA.state.master.speciesChoices'),
        years: await p.eval('CVIWA.state.master.yearChoices'), quarters: ['Q1', 'Q2', 'Q3', 'Q4'], rawSpecies: [] });
      await p.eval(`document.getElementById('legend-toggle-focus').click()`);
      let lg = await p.eval(LG);
      const waOpen = await p.eval(`[document.getElementById('legend-panel').hidden,document.getElementById('legend-panel-flow').hidden]`);
      check(!lg.hidden && lg.btn === 'true' && waOpen[0] === false && waOpen[1] === false, 'Focus legend: opens with the page\'s one legend state (the WA and Flow legends open too)', [lg.hidden, lg.btn, waOpen]);
      check(lg.text === 'Pick a focus county in the sidebar to view the map.' && lg.state === 'no-picks', 'Focus legend: CVI\'s prompt without counties', lg.text);
      await setFocus({ counties: ['King'], direction: 'combined', mode: 'overlap', species: await p.eval('CVIWA.state.master.speciesChoices'),
        years: await p.eval('CVIWA.state.master.yearChoices'), quarters: ['Q1', 'Q2', 'Q3', 'Q4'], rawSpecies: [], scaling: 'natural', nBins: 5 });
      await sleep(400); await idleFo();
      lg = await p.eval(LG);
      const land = await p.eval(`CVIWA.map.landColor(${FO})`);
      const wantDots = [['Importer — received animals', hexBlend('#1C9CD9', 0.8, land)], ['Exporter — sent animals', hexBlend('#F0A06E', 0.8, land)]];
      check(JSON.stringify(lg.heads) === JSON.stringify(['Premises role', 'Animals per premises']) && JSON.stringify(lg.dots.map(d => [d[0], toHex(d[1])])) === JSON.stringify(wantDots),
        'Focus legend: CVI\'s sections; both role swatches at the circle opacity over the land (S1.1 rule)', [lg.heads, lg.dots, wantDots]);
      const drawnR = await p.eval(`(function(){var h=${FO},s={};['Inbound','Outbound'].forEach(function(d){h.premises[d].forEach(function(x){s[x.radius_px]=1})});return Object.keys(s).map(Number)})()`);
      const legendOf = await p.eval(`CVIWA.focusState.built.legend`);
      check(lg.rs.length >= 2 && lg.rs.every(r => r >= 4 && r <= 24 && drawnR.some(x => Math.abs(x - r) < 1e-9)) && JSON.stringify(lg.labels) === JSON.stringify(await p.eval(`CVIWA.focusState.built.legend.values.map(CVIWA.scaling.comma)`)),
        'Focus legend: nested sizes at radii the map draws for its natural-breaks bins (4–24 px, no cap), CVI\'s tier values', [lg.rs, drawnR, lg.labels]);
      check(JSON.stringify(lg.cl.map(c => [c[0], toHex(c[1])])) === JSON.stringify([['12', '#1c9cd9'], ['8', '#f0a06e']])
        && lg.text.includes('Numbered bubbles group nearby premises (count shown) and keep one size; zoom in, or untick "Group nearby premises", to see each premises sized.')
        && lg.text.endsWith('Counts are activity at each premises. A WA-to-WA shipment between two focus counties appears at both its origin and destination premises, so layer totals are not deduplicated shipment volume.'),
        'Focus legend: CVI\'s cluster examples and notes (American spelling)', lg.text);
      await shot('focus-legend-full');
      // "Group nearby premises": unticked, no clusters on the live map and no
      // cluster example in the legend; ticked again, both back.
      const grouping = on => p.eval(`(async function(){var e=document.getElementById('fo-group');e.checked=${on};
        e.dispatchEvent(new Event('change',{bubbles:true}));var m=${FO}.map;
        await new Promise(function(r){var t=setTimeout(r,3000);m.once('idle',function(){clearTimeout(t);setTimeout(r,200)});m.triggerRepaint()});
        var f=m.querySourceFeatures('focus_src_in').concat(m.querySourceFeatures('focus_src_out'));
        return {clusters:f.filter(function(x){return x.properties.cluster}).length,points:f.filter(function(x){return !x.properties.cluster}).length,
          example:document.querySelectorAll('#legend-panel-focus .lg-cl').length};})()`);
      const ungrouped = await grouping(false), regrouped = await grouping(true);
      check(ungrouped.clusters === 0 && ungrouped.points > 0 && ungrouped.example === 0 && regrouped.clusters > 0 &&
        regrouped.example === 2, 'Focus: "Group nearby premises" off draws every premises, on brings the clusters back',
        { ungrouped, regrouped });
      await p.eval(`(function(){var e=document.getElementById('fo-opacity');e.value='0.4';e.dispatchEvent(new Event('change',{bubbles:true}));return 1})()`);
      lg = await p.eval(LG);
      check(toHex(lg.dots[0][1]) === hexBlend('#1C9CD9', 0.4, land), 'Focus legend: the swatches follow the circle opacity', lg.dots);
      await p.eval(`(function(){var e=document.getElementById('fo-opacity');e.value='0.8';e.dispatchEvent(new Event('change',{bubbles:true}));e=document.getElementById('fo-hide');e.checked=true;e.dispatchEvent(new Event('change',{bubbles:true}));return 1})()`);
      lg = await p.eval(LG);
      check(lg.text === 'CVI circles are hidden ("Hide CVI circles" in County Focus Style).' && !lg.rs.length && !lg.dots.length, 'Focus legend: Hide CVI circles leaves one line in place of the premises sections', lg.text);
      await p.eval(`(function(){var e=document.getElementById('fo-hide');e.checked=false;e.dispatchEvent(new Event('change',{bubbles:true}));return 1})()`);
      // Neighboring regions on the County Focus map: its own switches, off at first; British Columbia on draws it on the
      // Focus map only, Washington's land turns white and the swatches follow; the fit stays the counties'.
      const NRF = `(function(){var h=${FO},w=CVIWA.state.mapHandle,b=document.getElementById('fo-nr-block'),vis=function(m,id){return m.getStyle().layers.filter(function(l){return l.source==='nr_'+id+'_outline'}).map(function(l){return m.getLayoutProperty(l.id,'visibility')||'visible'})};
        return {rows:[].map.call(b.querySelectorAll('.nr-row'),function(r){return [r.dataset.region,r.querySelector('.nr-on').checked,r.querySelector('.nr-sub').hidden]}),shown:!document.getElementById('focus-style').hidden&&!b.hidden,
          fo:vis(h.map,'bc'),wa:vis(w.map,'bc'),waOn:!!CVIWA.state.nr.bc.on,land:CVIWA.map.landColor(h),cam:[h.map.getCenter().lng,h.map.getCenter().lat,h.map.getZoom()]}})()`;
      let nr = await p.eval(NRF);
      check(nr.shown && JSON.stringify(nr.rows.map(r => [r[1], r[2]])) === JSON.stringify(nr.rows.map(() => [false, true])) && nr.rows.length === 3, 'Focus neighbors: the County Focus style has its own switches, all off, counties hidden', nr.rows);
      await p.eval(`(function(){var c=document.querySelector('#fo-nr-list .nr-on[data-region="bc"]');c.checked=true;c.dispatchEvent(new Event('change',{bubbles:true}));return 1})()`);
      await p.waitFor(`${FO}.nr.on.bc === true && !!${FO}.map.getSource('nr_bc_outline')`, 10000, 'BC on the Focus map'); await idleFo();
      nr = await p.eval(NRF);
      lg = await p.eval(LG);
      check(nr.fo.length && nr.fo.every(v => v === 'visible') && !nr.waOn && nr.wa.every(v => v === 'none') && nr.land === '#ffffff' && nr.rows[0][1] && !nr.rows[0][2],
        'Focus neighbors: British Columbia drawn on the Focus map only; Washington white; its counties switch shown', nr);
      check(toHex(lg.dots[0][1]) === hexBlend('#1C9CD9', 0.8, '#ffffff'), 'Focus legend: swatches over white while a neighbor is on', lg.dots);
      await p.eval(`document.getElementById('fit-focus').click()`); await idleFo();
      const camNr = await p.eval(`[${FO}.map.getCenter().lng,${FO}.map.getCenter().lat,${FO}.map.getZoom()]`);
      const wantFit = await p.eval(`(function(){var b=CVIWA.focus.fitBox(${FO}.geo.counties,['King']);var c=${FO}.map.cameraForBounds([[b[0],b[1]],[b[2],b[3]]],{padding:0,maxZoom:12});return [c.center.lng,c.center.lat,c.zoom]})()`);
      check(close(camNr[0], wantFit[0], 1e-6) && close(camNr[1], wantFit[1], 1e-6) && close(camNr[2], wantFit[2], 1e-6), 'Focus neighbors: Fit to selected counties unchanged with a neighbor on (Washington-only)', [camNr, wantFit]);
      // Browse: the whole master's periods (from the file here), the middle first; steps, slider, Play stopping on a view
      // switch, Browse off leaving the last period in the pickers.
      require(path.join(ROOT, 'site/cvi/app/csv.js'));   // quoted fields hold commas: an RFC 4180 reading of the file
      const payCsv = globalThis.CVIWA.csv.parse(fs.readFileSync(path.join(PAY, 'full.csv'), 'utf8'));
      const iy = payCsv.header.indexOf('Reporting.Year'), iq = payCsv.header.indexOf('Reporting.Quarter');
      const quarters = [...new Set(payCsv.rows.map(r => r[iy] + '-' + r[iq]))].sort(), years = [...new Set(payCsv.rows.map(r => r[iy]))].sort();
      const BR = `(function(){var f=CVIWA.focusState,sl=document.getElementById('fo-time-slider');return {browse:f.browse,block:!document.getElementById('fo-browse-block').hidden,pickers:!document.getElementById('fo-pickers').hidden,
        max:Number(sl.max),value:Number(sl.value),label:document.getElementById('fo-time-label').textContent,years:f.years,quarters:f.quarters,step:f.timeStep,playing:f.playing,play:document.getElementById('fo-time-play').getAttribute('aria-label'),version:f.version}})()`;
      let br = await p.eval(BR);
      check(!br.browse && !br.block && br.pickers && br.max === quarters.length && br.value === Math.max(1, Math.ceil(quarters.length / 2)), 'Focus Browse: off at first; the slider over the master\'s periods, in the middle', [br, quarters]);
      await p.eval(`(function(){var c=document.getElementById('fo-browse');c.checked=true;c.dispatchEvent(new Event('change',{bubbles:true}));return 1})()`);
      await sleep(400);
      br = await p.eval(BR);
      const mid = quarters[Math.max(1, Math.ceil(quarters.length / 2)) - 1];
      check(br.browse && br.block && !br.pickers && br.label === mid && JSON.stringify(br.years) === JSON.stringify([Number(mid.split('-')[0])]) && JSON.stringify(br.quarters) === JSON.stringify([mid.split('-')[1]]),
        'Focus Browse: on, the pickers hidden, the middle period on the map', br);
      await p.eval(`(function(){var r=document.querySelector('input[name=fo-time-step][value=year]');r.checked=true;r.dispatchEvent(new Event('change',{bubbles:true}));return 1})()`); await sleep(300);
      br = await p.eval(BR);
      check(br.step === 'year' && br.max === years.length && br.label === years[Math.max(1, Math.ceil(years.length / 2)) - 1] && JSON.stringify(br.quarters) === JSON.stringify(['Q1', 'Q2', 'Q3', 'Q4']),
        'Focus Browse: Step by Year, the master\'s years, the middle one with all quarters', br);
      await p.eval(`(function(){var r=document.querySelector('input[name=fo-time-step][value=quarter]');r.checked=true;r.dispatchEvent(new Event('change',{bubbles:true}));var s=document.getElementById('fo-time-slider');s.value='1';s.dispatchEvent(new Event('input',{bubbles:true}));return 1})()`);
      await sleep(400);
      br = await p.eval(BR);
      check(br.label === quarters[0] && JSON.stringify(br.quarters) === JSON.stringify([quarters[0].split('-')[1]]), 'Focus Browse: the slider puts its period on the map', br);
      await p.eval(`document.getElementById('fo-time-play').click()`); await sleep(100);
      br = await p.eval(BR);
      check(br.playing && br.play === 'Pause', 'Focus Browse: Play', br.play);
      await p.eval(`document.getElementById('show-wa').click()`); await sleep(100);
      const stopped = await p.eval(`CVIWA.focusState.playing`);
      await p.eval(`document.getElementById('show-focus').click()`); await idleFo();
      check(stopped === false, 'Focus Browse: Play stops when the view is switched', stopped);
      // Reset All from the County Focus view: CVI's defaults; Browse off with its slider, step and speed
      // kept; facilities and the Focus neighbors off; the camera kept; the view kept.
      await p.eval(`(function(){var r=document.querySelector('input[name=fo-time-step][value=year]');r.checked=true;r.dispatchEvent(new Event('change',{bubbles:true}));var sp=document.getElementById('fo-time-speed');sp.value='2500';sp.dispatchEvent(new Event('change',{bubbles:true}));return 1})()`);
      await p.eval(`(function(){var d=document;var set=function(id,v){var e=d.getElementById(id);if(e.type==='checkbox')e.checked=v;else e.value=v;e.dispatchEvent(new Event('change',{bubbles:true}))};
        d.querySelector('input[name=fo-direction][value=inbound]').click();d.querySelector('input[name=fo-mode][value=side_by_side]').click();
        set('fo-scaling','quantile');set('fo-bins','7');set('fo-opacity','0.4');set('fo-hide',true);set('fo-labels',false);set('fo-outlines',false);set('fo-label-style','light');return 1})()`);
      await send('builtin', FREF.builtin);
      await p.eval(`document.getElementById('fo-fac-all').click()`);
      await sleep(400); await idleFo();
      await p.eval(`void ${FO}.map.jumpTo({center:[-122.0,47.45],zoom:10.5})`); await idleFo();
      const before = await p.eval(BR);
      const cam0 = await p.eval(`[${FO}.map.getCenter().lng,${FO}.map.getCenter().lat,${FO}.map.getZoom()]`);
      await p.eval(`document.getElementById('reset-all').click()`); await sleep(500); await idleFo();
      const RS = `(function(){var f=CVIWA.focusState,d=document,v=function(id){var e=d.getElementById(id);return e.type==='checkbox'?e.checked:e.value};return {counties:f.counties,direction:f.direction,mode:f.mode,scaling:f.scaling,nBins:f.nBins,opacity:f.opacity,hide:f.hide,labels:f.labels,outlines:f.outlines,ls:f.labelStyle,
        ui:[d.querySelector('input[name=fo-direction]:checked').value,d.querySelector('input[name=fo-mode]:checked').value,v('fo-scaling'),v('fo-bins'),v('fo-opacity'),v('fo-hide'),v('fo-labels'),v('fo-outlines'),v('fo-label-style'),v('fo-boundary-style'),v('fo-basemap')],
        browse:f.browse,step:f.timeStep,index:f.timeIndex,speed:f.speed,fac:f.fac.on,nr:Object.keys(f.nr).filter(function(k){return f.nr[k].on||f.nr[k].counties}),view:CVIWA.state.view,
        map:[${FO}.focusHidden,${FO}.labelsVisible,${FO}.linesVisible,${FO}.fac.drawn.every(function(x){return !x[1].length})],cam:[${FO}.map.getCenter().lng,${FO}.map.getCenter().lat,${FO}.map.getZoom()]}})()`;
      const rs = await p.eval(RS);
      check(JSON.stringify(rs.counties) === '[]' && rs.direction === 'combined' && rs.mode === 'overlap' && rs.scaling === 'log' && rs.nBins === 5 && rs.opacity === '0.8' && !rs.hide && rs.labels && rs.outlines && rs.ls === 'auto'
        && JSON.stringify(rs.ui) === JSON.stringify(['combined', 'overlap', 'log', '5', '0.8', false, true, true, 'auto', 'auto', 'offline']),
        'Reset All (County Focus): counties cleared, CVI\'s defaults in the state and the controls', rs);
      check(!rs.browse && rs.step === 'year' && rs.index === before.value && rs.speed === 2500, 'Reset All (County Focus): Browse off, its slider, step and speed kept (deliberate difference)', [rs.browse, rs.step, rs.index, rs.speed, before.value]);
      check(JSON.stringify(rs.fac) === '[]' && JSON.stringify(rs.nr) === '[]' && rs.view === 'focus' && JSON.stringify(rs.map) === JSON.stringify([false, true, true, true]),
        'Reset All (County Focus): facility layers and its neighboring regions off, the map back to the defaults, the view kept', rs);
      check(close(rs.cam[0], cam0[0], 1e-9) && close(rs.cam[1], cam0[1], 1e-9) && close(rs.cam[2], cam0[2], 1e-9), 'Reset All (County Focus): the camera stays (as CVI)', [rs.cam, cam0]);
      await shot('focus-legend');
      await p.eval(`document.getElementById('legend-toggle-focus').click()`);
      await p.eval(`(function(){return CVIWA.setFacilityFiles({}).then(function(){return 1})})()`);
    }

    // 10. Network and errors.
    run.provider = log.provider.length; run.requests = log.requests.length;
    check(!log.provider.length, 'no request outside the site folder', log.provider.slice(0, 5));
    check(!log.exceptions.length, 'no page exception', log.exceptions.slice(0, 5));
    check(!log.csp.length, 'no Content Security Policy report', log.csp.slice(0, 5));
  } catch (e) {
    fail++; failures.push('run stopped: ' + (e && e.stack || e));
  } finally {
    await b.close();
  }
  run.finished = new Date().toISOString(); run.pass = pass; run.fail = fail; run.failures = failures;
  fs.writeFileSync(path.join(OUT, 'browser_run.json'), JSON.stringify(run, null, 2) + '\n');
  failures.slice(0, 40).forEach(f => console.log('FAIL ' + f));
  console.log('S5 browser (' + PAGE_LABEL + ', Chrome ' + (run.chrome || '?') + '): ' + pass + ' passed, ' + fail + ' failed; ' + run.views
    + ' reference views through the page (' + run.notOffered + ' not offered by the page\'s lists); requests outside the site: ' + (run.provider === undefined ? '?' : run.provider));
  process.exit(fail ? 1 : 0);
})();
