#!/usr/bin/env node
'use strict';
// NR browser test (neighboring regions): opens site/cvi/index.html in the installed Google Chrome (headless, throw-away
// profile). Every request outside the site folder is answered "not found" here and recorded (none is expected).
// Part 1 (single offline map): the switches (all off when the page opens, in list order; a counties switch hidden until
// its region is on, back to off when the region is turned off); no region file loaded before its switch, and loaded
// once; outline, land fill and counties drawn and hidden; region names while on; county names only from zoom 7 (and
// with "Show county labels"); circles, value boxes and the camera unchanged by a switch; Fit to Washington the same
// with all on and all off; Boundary style on the neighbor lines; a missing region file: message, switch back off.
// Part 2: the land fill (by pixel): while any neighbor is on Washington is white and the neighbors in its usual gray,
// with all off Washington's gray as before, the background around them; on a tile basemap (USGS Topo, its tiles
// answered here with one color) the layers kept and both land fills hidden, also for a region first turned on while the
// basemap is shown or while its style is swapped, and back on the offline map; a basemap that does not load brings both
// land fills back; Compare (both maps follow the switches, the hidden right map catches up when Compare is turned on);
// the screenshot (neighbor county lines by pixel, the names drawn, the Statistics Canada credit while British Columbia
// is on, none added for Idaho or Oregon); the credit on the map and opened; both statements in the footer with the
// license link; Label style on the neighbor names; Reset All turns every switch off.
// Also: the "County lines and labels" header and both blocks as named groups, the counties switches named with their
// region, region names inside the opening view, legend and spotlight unchanged by the neighbors, Boundary style on
// neighbor county lines, focus kept when a failed load hides a focused switch, and a region file without its data or
// with shapes that cannot be drawn refused like a missing one.
// Usage (repository root): node tests/browser/run_nr_browser.js      (Node >= 22; Chrome installed; no packages)
// Optional: CHROME_BIN=<path to chrome>; NR_PAGE_URL=<another copy of the page, e.g. over local http>.
// Writes only local-test-artifacts/nr/browser_run.json, nr/screens/ (pictures for review) and a temporary profile
// (deleted on exit).
const { spawn } = require('child_process');
const fs = require('fs'), path = require('path'), vm = require('vm');
const { pathToFileURL, fileURLToPath } = require('url');
const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join(ROOT, 'local-test-artifacts', 'nr');
const PAGE = process.env.NR_PAGE_URL || pathToFileURL(path.join(ROOT, 'site', 'cvi', 'index.html')).href;
const SITE_BASE = new URL('..', PAGE).href;
const PAGE_LABEL = /^file:/.test(PAGE) ? path.relative(ROOT, fileURLToPath(PAGE)).split(path.sep).join('/') + ' (file://)' : PAGE.split(/[?#]/)[0];
const FIX = f => path.join(ROOT, 'tests', 'synthetic', f);
const CHROME = process.env.CHROME_BIN || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  : process.platform === 'win32' ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : 'google-chrome');
const sleep = ms => new Promise(r => setTimeout(r, ms));

// The region list, read the way the page reads it.
const SB = { window: {} };
vm.createContext(SB);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'site', 'geo', 'regions', 'index.js'), 'utf8'), SB, { filename: 'index.js' });
const REGIONS = SB.window.WSDA_REGIONS;

// Outside the site folder only USGS Topo's tiles are answered (one color, as in the S3 suite); launch() below is the S3
// suite's. mode 'down' fails every outside request (a basemap that does not load).
let mode = 'normal';
const REDIRECT_TO = 'about:blank';
const USGS = [200, 162, 107];
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; }
  return (crc ^ 0xffffffff) >>> 0;
}
function png(w, h, rgba) {   // a plain RGBA PNG of one color
  const chunk = (type, data) => { const len = Buffer.alloc(4), t = Buffer.from(type, 'ascii'), crc = Buffer.alloc(4);
    len.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const row = Buffer.alloc(1 + 4 * w); for (let x = 0; x < w; x++) Buffer.from(rgba).copy(row, 1 + 4 * x);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', require('zlib').deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const USGS_TILE = png(256, 256, [...USGS, 255]);
const synth = url => (/^https:\/\/basemap\.nationalmap\.gov\/arcgis\/rest\/services\/USGSTopo\/MapServer\/tile\/\d+\/\d+\/\d+$/.test(url)
  ? { type: 'image/png', body: USGS_TILE } : null);

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
      const hd = m.params.request.headers || {}, hk = Object.keys(hd).map(x => x.toLowerCase());
      log.provider.push({ url, t: Date.now(), mode, page: s === sid, referer: hk.indexOf('referer') >= 0, cookie: hk.indexOf('cookie') >= 0 });
      const isStyle = /\/styles\/[a-z]+$/.test(new URL(url).pathname), isVecTile = /\.pbf$/.test(url) && !/\/fonts\//.test(url);
      if (mode === 'hang') return;
      if (mode === 'down') { send('Fetch.failRequest', { requestId: rid, errorReason: 'InternetDisconnected' }, s).catch(() => {}); return; }
      if ((mode === 'redirect-tile' && isVecTile) || (mode === 'redirect-style' && isStyle)) {
        send('Fetch.fulfillRequest', { requestId: rid, responseCode: 302, responseHeaders: [{ name: 'Location', value: REDIRECT_TO },
          { name: 'Access-Control-Allow-Origin', value: '*' }] }, s).catch(() => {});
        return;
      }
      const r = synth(url);
      const answer = () => send('Fetch.fulfillRequest', { requestId: rid, responseCode: r ? 200 : 404, body: (r ? r.body : Buffer.from('not found')).toString('base64'),
        responseHeaders: [{ name: 'Content-Type', value: r ? r.type : 'text/plain' }, { name: 'Access-Control-Allow-Origin', value: '*' }] }, s).catch(() => {});
      if ((mode === 'slowstyle' && isStyle) || (mode === 'slowtiles' && /\/tile\//.test(url))) setTimeout(answer, mode === 'slowtiles' ? 3000 : 2500); else answer();
    }
  });
  for (const d of ['Network.enable', 'Runtime.enable', 'Log.enable', 'Page.enable', 'DOM.enable']) await send(d, {}, sid);
  await send('Fetch.enable', FETCH, sid);
  // Records the options of every fetch() the page makes (the page's basemap requests, checked against what the
  // network saw).
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `(function(){var f=window.fetch;window.__fetches=[];window.fetch=function(u,o){
    try{window.__fetches.push({url:String(typeof u==='string'?u:u.url),redirect:o&&o.redirect,credentials:o&&o.credentials,referrerPolicy:o&&o.referrerPolicy})}catch(e){}
    return f.apply(this,arguments)}})()` }, sid);
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
    // Another tab in front for ms (Chrome hides the page: document.hidden, no animation frames), then the page again.
    async background(ms, during) {
      const { targetId: other } = await send('Target.createTarget', { url: 'about:blank' });
      await send('Target.activateTarget', { targetId: other });
      await sleep(300); const seen = during ? await during() : null; await sleep(ms);
      const seen2 = during ? await during() : null;
      await send('Target.activateTarget', { targetId }); await send('Target.closeTarget', { targetId: other });
      return [seen, seen2];
    },
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
const A = 'CVIWA.state.mapHandle', AB = 'CVIWA.state.mapHandleB';
// The switches, layers, labels and camera as the checks need them (of the left map, or of the map H).
const STATE_OF = H => `(function(){var s=${H},m=s.map,rows={};
  document.querySelectorAll('#nr-list .nr-row').forEach(function(r){var id=r.dataset.region,sub=r.querySelector('.nr-sub');
    var vis=function(p){var l='nr-'+id+'-'+p;return m.getLayer(l)?(m.getLayoutProperty(l,'visibility')||'visible'):null};
    var L=s.nr.labels[id],shown=function(mk){return !mk.getElement().classList.contains('hidden')};
    rows[id]={label:r.querySelector('label').textContent.trim(),on:r.querySelector('.nr-on').checked,subHidden:sub.hidden&&sub.offsetHeight===0&&getComputedStyle(sub).display==='none',
      subLabel:sub.textContent.trim(),counties:r.querySelector('.nr-counties').checked,land:vis('land'),outline:vis('outline'),countyLines:vis('counties'),
      name:L?shown(L.name):false,countyNames:L?L.counties.filter(shown).length:0,ariaSub:r.querySelector('.nr-counties').getAttribute('aria-label'),
      nameIn:L?(function(a,b){return a.width>0&&a.left>=b.left&&a.right<=b.right&&a.top>=b.top&&a.bottom<=b.bottom})(L.name.getElement().getBoundingClientRect(),m.getContainer().getBoundingClientRect()):false,
      drawnCounties:m.getLayer('nr-'+id+'-counties')&&vis('counties')==='visible'?m.queryRenderedFeatures({layers:['nr-'+id+'-counties']}).map(function(f){return f.properties.key}).filter(function(k,i,a){return a.indexOf(k)===i}).length:0,
      drawnOutline:m.getLayer('nr-'+id+'-outline')&&vis('outline')==='visible'?m.queryRenderedFeatures({layers:['nr-'+id+'-outline']}).length:0}});
  var bx=document.getElementById('value-boxes');
  return {order:Object.keys(rows),rows:rows,loaded:Object.keys(window.WSDA_REGION_DATA||{}),center:m.getCenter().toArray(),zoom:m.getZoom(),
    circles:m.queryRenderedFeatures({layers:['circles','circles_dim','circles_spotlight']}).map(function(f){return f.properties.county+'|'+f.properties.direction+'|'+f.properties.amount}).sort().join(';'),
    boxes:bx?bx.textContent.replace(/\\s+/g,' ').trim():'',strip:(document.getElementById('summary-strip')||{}).textContent,
    msg:document.getElementById('nr-msg').hidden?null:document.getElementById('nr-msg').textContent,
    waLine:m.getPaintProperty('county-lines','line-color'),nrLines:Object.keys(s.nr.data).map(function(id){return m.getPaintProperty('nr-'+id+'-outline','line-color')}),
    nrCountyLines:Object.keys(s.nr.data).map(function(id){return m.getPaintProperty('nr-'+id+'-counties','line-color')}),failed:!!s.failed,
    waLand:m.getLayoutProperty('wa-land','visibility')||'visible',
    nrLand:Object.keys(s.nr.data).map(function(id){return m.getPaintProperty('nr-'+id+'-land','fill-color')}),
    attribution:(function(a){return a?a.textContent.replace(/\\s+/g,' ').trim():null})(m.getContainer().querySelector('.maplibregl-ctrl-attrib-inner')),
    creditOpen:(function(a){return !!a&&a.classList.contains('maplibregl-compact-show')})(m.getContainer().querySelector('.maplibregl-ctrl-attrib'))}})()`;
const NRSTATE = STATE_OF(A);
// Pixels of the map H at [lon, lat] points (the map's own frame, drawn on the spot as the screenshot does).
const PIX = (H, pts) => `(function(){var m=${H}.map;m.redraw();var c=m.getCanvas(),o=document.createElement('canvas');o.width=c.width;o.height=c.height;
  var g=o.getContext('2d');g.drawImage(c,0,0);var k=c.width/c.clientWidth;
  return ${JSON.stringify(pts)}.map(function(p){var q=m.project(p),d=g.getImageData(Math.round(q.x*k),Math.round(q.y*k),1,1).data;return [d[0],d[1],d[2]]})})()`;
const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const near = (a, b, tol) => a && b && a.every((v, i) => Math.abs(v - b[i]) <= (tol === undefined ? 3 : tol));
// Points for the pixel checks, at the land-fill camera below: inside Washington, Oregon, Idaho and British Columbia away
// from every line and name drawn in the canvas, and the Pacific (background).
const LAND_CAM = { center: [-120.5, 47.5], zoom: 5.2 };
const PT = { wa: [-118.6, 47.0], or: [-118.9, 43.2], id: [-115.2, 45.9], bc: [-122.0, 51.3], sea: [-128.5, 45.0] };
// The screenshot as pixels: the picture CVIWA.map.screenshot() makes of the map H, read back (kept in the page as
// window.__shots[name] for DIFF), with the names it drew and its credit band.
const SHOT = (H, name, pts) => `CVIWA.map.screenshot(${H}).then(function(b){return createImageBitmap(b)}).then(function(i){var c=document.createElement('canvas');
  c.width=i.width;c.height=i.height;var g=c.getContext('2d');g.drawImage(i,0,0);var m=${H}.map,k=i.width/m.getCanvas().clientWidth,d=g.getImageData(0,0,c.width,c.height).data;
  (window.__shots=window.__shots||{})['${name}']={d:d,w:c.width,h:c.height};
  return {labels:${H}.lastLabels.slice(),attribution:${H}.lastAttribution,w:c.width,h:c.height,
    px:${JSON.stringify(pts || [])}.map(function(p){var q=m.project(p),j=(Math.round(q.y*k)*c.width+Math.round(q.x*k))*4;return [d[j],d[j+1],d[j+2]]})}})`;
// Pixels that differ (any channel by more than 24) between two kept screenshots, inside the box [lon0, lat0, lon1, lat1]
// of the map H (same camera for both).
const DIFF = (H, a, b, box) => `(function(){var A=window.__shots['${a}'],B=window.__shots['${b}'],m=${H}.map,k=A.w/m.getCanvas().clientWidth;
  var p0=m.project([${box[0]},${box[3]}]),p1=m.project([${box[2]},${box[1]}]),n=0;
  var x0=Math.max(0,Math.round(p0.x*k)),y0=Math.max(0,Math.round(p0.y*k)),x1=Math.min(A.w,Math.round(p1.x*k)),y1=Math.min(A.h,Math.round(p1.y*k));
  for(var y=y0;y<y1;y++)for(var x=x0;x<x1;x++){var j=(y*A.w+x)*4;if(Math.abs(A.d[j]-B.d[j])>24||Math.abs(A.d[j+1]-B.d[j+1])>24||Math.abs(A.d[j+2]-B.d[j+2])>24)n++}
  return n})()`;
const click = (id, cls) => `(function(){document.querySelector('#nr-list .${cls}[data-region="${id}"]').click();return true})()`;
const camera = s => s.center.map(v => v.toFixed(6)).join(',') + '@' + s.zoom.toFixed(6);

(async () => {
  fs.mkdirSync(path.join(OUT, 'screens'), { recursive: true });
  const run = { started: new Date().toISOString(), page: PAGE_LABEL };
  const b = await launch(), p = b.page, log = b.log;
  run.chrome = b.version;
  const regionFileRequests = id => log.requests.filter(u => u.split('?')[0].endsWith('/geo/regions/' + id + '.js')).length;
  const idle = () => p.waitFor(`${A}.map.loaded() && !${A}.map.isMoving()`, 15000, 'map idle').then(() => sleep(150));
  const shot = async name => { await idle(); await p.capture(path.join(OUT, 'screens', name + '.png')); };
  try {
    await p.goto(PAGE);
    await p.waitFor(`window.CVIWA && CVIWA.state && ${A} && ${A}.ready`, 20000, 'map ready');
    await p.setFiles('#file-input', [FIX('cvi_master_s2.csv')]);
    await p.waitFor(`!CVIWA.state.loading && CVIWA.state.data.length > 0`, 15000, 'data loaded');
    await idle();

    // 1. The page opens with every region off and no region file loaded.
    let s0 = await p.eval(NRSTATE);
    const ids = REGIONS.map(r => r.id);
    check(JSON.stringify(s0.order) === JSON.stringify(ids) && ids.every((id, i) => s0.rows[id].label === REGIONS[i].name),
      'switches: one per region of the list, in list order, named as the list', s0.order);
    check(ids.every(id => !s0.rows[id].on && !s0.rows[id].counties && s0.rows[id].subHidden && s0.rows[id].land === null),
      'page opens: every region off, counties switches hidden (not drawn), no neighbor layers', s0.rows);
    check(!s0.loaded.length && ids.every(id => regionFileRequests(id) === 0), 'page opens: no region file loaded', s0.loaded);
    check(log.requests.some(u => /\/geo\/regions\/index\.js$/.test(u)) && log.requests.some(u => /\/shared\/regions\.js$/.test(u)), 'page loads the region list and the shared part');
    check(ids.every((id, i) => s0.rows[id].ariaSub === REGIONS[i].name + ' ' + REGIONS[i].countiesLabel.toLowerCase()),
      'switches: each counties switch named with its region for screen readers (e.g. "Idaho counties")', ids.map(id => s0.rows[id].ariaSub));
    const heads = await p.eval(`(function(){var g=function(id){var e=document.getElementById(id),h=document.getElementById(e.getAttribute('aria-labelledby'));
      return {role:e.getAttribute('role'),head:h?h.textContent.trim():null}};var lb=document.getElementById('s-labels').parentNode,ln=document.getElementById('s-lines').parentNode;
      return {nr:g('nr-block'),county:g('county-block'),inCounty:document.getElementById('county-block').contains(lb)&&document.getElementById('county-block').contains(ln),
        order:!!(document.getElementById('nr-block').compareDocumentPosition(document.getElementById('county-block'))&Node.DOCUMENT_POSITION_FOLLOWING),
        sameStyle:getComputedStyle(document.getElementById('nr-head')).fontWeight===getComputedStyle(document.getElementById('county-head')).fontWeight&&
          getComputedStyle(document.getElementById('nr-head')).fontSize===getComputedStyle(document.getElementById('county-head')).fontSize,
        labelsTip:lb.title,linesTip:ln.title}})()`);
    check(heads.nr.role === 'group' && heads.nr.head === 'Neighboring regions' && heads.county.role === 'group' && heads.county.head === 'County lines and labels' &&
      heads.inCounty && heads.order && heads.sameStyle, 'header "County lines and labels" over both county switches, after "Neighboring regions", in its style; both blocks are named groups', heads);
    check(/neighboring regions' county names/.test(heads.labelsTip) && /Washington's county lines/.test(heads.linesTip),
      '"Show county labels" hover text names the neighbors\' county names; "Show county lines" Washington\'s lines', [heads.labelsTip, heads.linesTip]);
    await shot('nr-0-all-off');
    const base = s0;

    // 2. Each region on, then its counties, then off again.
    for (const r of REGIONS) {
      await p.eval(click(r.id, 'nr-on'));
      await p.waitFor(`!!((window.WSDA_REGION_DATA||{})['${r.id}'] && ${A}.map.getLayer('nr-${r.id}-outline'))`, 10000, r.id + ' loaded');
      await idle();
      let s = await p.eval(NRSTATE), x = s.rows[r.id];
      check(x.on && !x.subHidden && !x.counties && x.subLabel === r.countiesLabel, r.name + ' on: its "' + r.countiesLabel + '" switch shown, off', x);
      check(x.outline === 'visible' && x.land === 'visible' && x.countyLines === 'none' && x.drawnOutline > 0 && x.drawnCounties === 0,
        r.name + ' on: outline and land fill drawn, counties not', x);
      check(x.name && x.nameIn && x.countyNames === 0, r.name + ' on: its name shown inside the opening view, no county names', x);
      check(regionFileRequests(r.id) === 1, r.name + ': its file loaded once, when turned on', regionFileRequests(r.id));
      check(camera(s) === camera(base) && s.circles === base.circles && s.boxes === base.boxes && s.strip === base.strip,
        r.name + ' on: camera, circles, value boxes and strip unchanged', { cam: [camera(s), camera(base)] });
      await p.eval(click(r.id, 'nr-counties')); await idle();
      s = await p.eval(NRSTATE); x = s.rows[r.id];
      check(x.counties && x.countyLines === 'visible' && x.drawnCounties > 0 && x.countyNames === 0,
        r.name + ' counties on: county lines drawn, county names hidden below zoom 7', x);
      check(camera(s) === camera(base) && s.circles === base.circles && s.boxes === base.boxes, r.name + ' counties on: camera, circles and value boxes unchanged');
      await p.eval(click(r.id, 'nr-on')); await idle();
      s = await p.eval(NRSTATE); x = s.rows[r.id];
      check(!x.on && x.subHidden && !x.counties && x.outline === 'none' && x.land === 'none' && x.countyLines === 'none' && !x.name && x.countyNames === 0,
        r.name + ' off: everything hidden, its counties switch hidden and back to off', x);
      await p.eval(click(r.id, 'nr-on')); await idle();
      s = await p.eval(NRSTATE); x = s.rows[r.id];
      check(x.on && !x.counties && x.countyLines === 'none' && regionFileRequests(r.id) === 1, r.name + ' on again: counties stay off, file not loaded again', x);
    }
    await shot('nr-1-regions-on');
    await p.eval(`(function(){var r=document.querySelector('#nr-list .nr-row');r.querySelector('.nr-on').click();document.getElementById('nr-block').scrollIntoView();return true})()`);
    await shot('nr-1b-switches-one-off');   // the first region off again (its counties switch hidden), the others on
    await p.eval(click(REGIONS[0].id, 'nr-on'));
    for (const r of REGIONS) await p.eval(click(r.id, 'nr-counties'));
    await shot('nr-2-regions-and-counties-on');

    // 3. County names from zoom 7 only, and only with "Show county labels".
    const zoomTo = (lon, lat, z) => p.eval(`(function(){${A}.map.jumpTo({center:[${lon},${lat}],zoom:${z}});return true})()`);
    for (const r of REGIONS) {
      await zoomTo(r.anchor[0], r.anchor[1], 6.9); await idle();
      const lo = (await p.eval(NRSTATE)).rows[r.id];
      await zoomTo(r.anchor[0], r.anchor[1], 7.0); await idle();
      const hi = (await p.eval(NRSTATE)).rows[r.id];
      check(lo.countyNames === 0 && hi.countyNames > 0, r.name + ': county names hidden at zoom 6.9, shown at 7', [lo.countyNames, hi.countyNames]);
    }
    await zoomTo(-117.0, 47.2, 7.6); await shot('nr-3-idaho-zoom-7.6');
    await zoomTo(-122.6, 45.75, 8); await shot('nr-4-oregon-zoom-8');
    await zoomTo(-122.95, 48.9, 9.5); await shot('nr-5-bc-wa-border-zoom-9.5');   // where the two agencies' files meet
    await p.eval(`document.getElementById('s-labels').click()`); await idle();
    let s = await p.eval(NRSTATE);
    check(REGIONS.every(r => s.rows[r.id].countyNames === 0 && s.rows[r.id].name), '"Show county labels" off: neighbor county names hidden too, region names kept',
      REGIONS.map(r => s.rows[r.id].countyNames));
    await p.eval(`document.getElementById('s-labels').click()`);

    // 4a. Washington-only: the legend, a spotlight and its circles identical with every region and its counties on as with
    // all off, apart from the legend's swatch colors: since S1.1 they show the circles' color over the land
    // under them, white while a neighbor is on, #ececec with all off.
    await p.eval(`document.getElementById('fit-wa').click()`);
    await p.eval(`(function(){document.querySelector('#f-spotlight input').click();return true})()`); await idle();
    const WAONLY = `(function(){var m=${A}.map;return {legend:document.getElementById('legend-panel').innerHTML.replace(/background: rgb\\([0-9, ]+\\);?/g,''),
      spot:[].map.call(document.querySelectorAll('#f-spotlight input:checked'),function(i){return i.value}).join(),filter:JSON.stringify(m.getFilter('circles_spotlight')),
      circles:m.queryRenderedFeatures({layers:['circles','circles_dim','circles_spotlight']}).map(function(f){return f.layer.id+'|'+f.properties.county+'|'+f.properties.amount}).sort().join(';')}})()`;
    const SW = `JSON.parse(JSON.stringify(CVIWA.state.legend.swatches))`;
    const wOn = await p.eval(WAONLY), swOn = await p.eval(SW);
    for (const r of REGIONS) await p.eval(click(r.id, 'nr-on'));
    await idle();
    const wOff = await p.eval(WAONLY), swOff = await p.eval(SW);
    const mix = (h, u) => '#' + [1, 3, 5].map(i => Math.round(parseInt(h.slice(i, i + 2), 16) * 0.6 + parseInt(u.slice(i, i + 2), 16) * 0.4).toString(16).padStart(2, '0')).join('');
    check(swOn.length === 2 && swOn.every(w => w.land === '#ffffff' && w.shown === mix(w.color, '#ffffff')) && swOff.every(w => w.land === '#ececec' && w.shown === mix(w.color, '#ececec')),
      'legend swatches over the land under the circles: white with neighbors on, #ececec with all off (S1.1)', { swOn, swOff });
    check(!!wOn.spot && wOn.legend.length > 0 && /circles_spotlight/.test(wOn.circles) && JSON.stringify(wOn) === JSON.stringify(wOff),
      'Washington-only: legend (but its swatch colors), spotlight and circles identical with every neighbor on and all off',
      { spot: [wOn.spot, wOff.spot], legend: wOn.legend.length, spotCircles: /circles_spotlight/.test(wOn.circles), same: JSON.stringify(wOn) === JSON.stringify(wOff) });
    for (const r of REGIONS) await p.eval(click(r.id, 'nr-on'));
    for (const r of REGIONS) await p.eval(click(r.id, 'nr-counties'));
    await p.eval(`(function(){document.querySelector('#f-spotlight input').click();return true})()`); await idle();

    // 4. Fit to Washington: the same camera with every region and its counties on as with all off.
    await p.eval(`document.getElementById('fit-wa').click()`); await idle();
    const fitOn = camera(await p.eval(NRSTATE));
    for (const r of REGIONS) await p.eval(click(r.id, 'nr-on'));
    await p.eval(`document.getElementById('fit-wa').click()`); await idle();
    const fitOff = camera(await p.eval(NRSTATE));
    check(fitOn === fitOff && fitOff === camera(base), 'Fit to Washington: same view with all on as with all off (the opening view)', [fitOn, fitOff, camera(base)]);

    // 5. Boundary style applies to the neighbor lines.
    for (const r of REGIONS) await p.eval(click(r.id, 'nr-on'));
    for (const v of ['dark', 'light', 'auto']) {
      await p.eval(`(function(){var e=document.getElementById('s-boundary-style');e.value='${v}';e.dispatchEvent(new Event('change'));return true})()`);
      s = await p.eval(NRSTATE);
      check(s.nrLines.length === REGIONS.length && s.nrLines.every(c => c === s.waLine), 'Boundary style ' + v + ': neighbor lines in Washington\'s line color', [s.waLine, s.nrLines]);
      check(s.nrCountyLines.length === REGIONS.length && s.nrCountyLines.every(c => c === s.waLine), 'Boundary style ' + v + ': neighbor county lines in Washington\'s line color', [s.waLine, s.nrCountyLines]);
    }

    // 6. A region file that cannot be loaded: a message, the switch back off, the map unaffected.
    await p.goto(PAGE);
    await p.waitFor(`window.CVIWA && CVIWA.state && ${A} && ${A}.ready`, 20000, 'map ready again');
    await p.setFiles('#file-input', [FIX('cvi_master_s2.csv')]);
    await p.waitFor(`!CVIWA.state.loading && CVIWA.state.data.length > 0`, 15000, 'data loaded again');
    await idle();
    const before = await p.eval(NRSTATE), last = REGIONS[REGIONS.length - 1];
    await p.eval(`WSDA_REGIONS.find(function(r){return r.id==='${last.id}'}).file='geo/regions/missing-test.js';true`);
    await p.eval(`(function(){var r=document.querySelector('#nr-list .nr-row[data-region="${last.id}"]');r.querySelector('.nr-on').click();r.querySelector('.nr-counties').focus();return true})()`);
    await p.waitFor(`!document.getElementById('nr-msg').hidden`, 10000, 'missing-file message');
    s = await p.eval(NRSTATE);
    check(!s.rows[last.id].on && s.rows[last.id].subHidden && s.rows[last.id].land === null && /could not be loaded/.test(s.msg) && s.msg.indexOf(last.name) >= 0,
      'missing region file: message names the region, switch back off, nothing drawn', { row: s.rows[last.id], msg: s.msg });
    check(camera(s) === camera(before) && s.circles === before.circles && s.boxes === before.boxes, 'missing region file: the rest of the map unchanged');
    check(await p.eval(`document.activeElement===document.querySelector('#nr-list .nr-on[data-region="${last.id}"]')`),
      'missing region file: focus moves from the hidden counties switch to its region switch');
    const first = REGIONS[0];
    await p.eval(click(first.id, 'nr-on'));
    await p.waitFor(`!!${A}.map.getLayer('nr-${first.id}-outline')`, 10000, first.id + ' after a failure');
    s = await p.eval(NRSTATE);
    check(s.rows[first.id].outline === 'visible' && s.msg === null, 'after a failure: another region still turns on, the message goes', s.msg);
    // A file that loads but defines no data for its region (e.g. broken or truncated): the same message and switch off.
    const mid = REGIONS[1];
    await p.eval(`WSDA_REGIONS.find(function(r){return r.id==='${mid.id}'}).file='geo/regions/index.js';true`);
    await p.eval(click(mid.id, 'nr-on'));
    await p.waitFor(`!document.getElementById('nr-msg').hidden`, 10000, 'no-data file message');
    s = await p.eval(NRSTATE);
    check(!s.rows[mid.id].on && s.rows[mid.id].land === null && /could not be loaded/.test(s.msg) && s.msg.indexOf(mid.name) >= 0 && !s.failed &&
      s.rows[first.id].outline === 'visible' && camera(s) === camera(before) && s.circles === before.circles,
      'region file without its data: message, switch back off, the rest of the map unaffected', { row: s.rows[mid.id], msg: s.msg, failed: s.failed });
    // Data whose shapes cannot be drawn (MapLibre draws nothing and reports nothing for them): refused like a
    // broken file, so the region turns off with the message; the map, the other region and the circles are unaffected.
    await p.eval(`(function(){var e=WSDA_REGIONS.find(function(r){return r.id==='${last.id}'});e.file='geo/regions/missing-test.js';document.getElementById('nr-msg').hidden=true;(window.WSDA_REGION_DATA=window.WSDA_REGION_DATA||{})['${last.id}']=
      {id:e.id,name:e.name,code:e.code,source:'test',attribution:'Boundaries: test',labels:[],
       outline:{type:'Feature',properties:{name:e.name,key:e.code},geometry:{type:'MultiPolygon',coordinates:null}},
       counties:{type:'FeatureCollection',features:[{type:'Feature',properties:{name:'Bad',key:e.code+':bad',gid:'x'},geometry:{type:'MultiPolygon',coordinates:null}}]}};return true})()`);
    await p.eval(click(last.id, 'nr-on'));
    await p.waitFor(`!document.getElementById('nr-msg').hidden || ${A}.failed`, 10000, 'malformed-shapes outcome');
    await sleep(500); await idle().catch(() => {});
    s = await p.eval(NRSTATE);
    check(!s.failed && !s.rows[last.id].on && s.rows[last.id].land === null && /could not be loaded/.test(s.msg || '') && (s.msg || '').indexOf(last.name) >= 0 &&
      s.rows[first.id].outline === 'visible' && camera(s) === camera(before) && s.circles === before.circles,
      'region data with shapes that cannot be drawn: refused, that region off with the message, the map and the other region unaffected', { row: s.rows[last.id], msg: s.msg, failed: s.failed });

    check(!log.provider.length, 'part 1: no request outside the site folder', log.provider.map(x => x.url).slice(0, 5));

    // ---- Part 2 --------------------------------------------------------------------------------------------------
    const reload = async () => {
      await p.goto(PAGE);
      await p.waitFor(`window.CVIWA && CVIWA.state && ${A} && ${A}.ready`, 20000, 'map ready (reload)');
      await p.setFiles('#file-input', [FIX('cvi_master_s2.csv')]);
      await p.waitFor(`!CVIWA.state.loading && CVIWA.state.data.length > 0`, 15000, 'data loaded (reload)');
      await idle();
    };
    const idleOf = H => p.waitFor(`${H}.map.loaded() && !${H}.map.isMoving()`, 15000, 'idle ' + H).then(() => sleep(150));
    const rowsOf = async H => (await p.eval(STATE_OF(H))).rows;
    // Every region on (or off), its counties as asked.
    const setAll = async (on, counties) => {
      for (const r of REGIONS) {
        if ((await rowsOf(A))[r.id].on !== on) await p.eval(click(r.id, 'nr-on'));
        if (!on) continue;
        await p.waitFor(`!!${A}.map.getLayer('nr-${r.id}-outline') || ${A}.switching`, 10000, r.id + ' on');
        if ((await rowsOf(A))[r.id].counties !== !!counties) await p.eval(click(r.id, 'nr-counties'));
      }
      await idle();
    };
    const directions = on => p.eval(`(function(){document.querySelectorAll('input[name=direction]').forEach(function(c){if(c.checked!==${on})c.click()});return true})()`);
    const choose = id => `(function(){var e=document.getElementById('s-basemap');e.value='${id}';e.dispatchEvent(new Event('change'));return true})()`;
    const jump = cam => p.eval(`(function(){${A}.map.jumpTo(${JSON.stringify(cam)});return true})()`);
    const periodMode = v => p.eval(`(function(){document.getElementById('period-block').open=true;document.querySelector('input[name=period-mode][value=${v}]').click();return true})()`);
    const ALL_PTS = [PT.wa, PT.or, PT.id, PT.bc, PT.sea];
    const BC = REGIONS.find(r => r.id === 'bc'), STATCAN = BC.credit, USGS_CREDIT = 'Tiles courtesy of the U.S. Geological Survey';
    const outside0 = log.provider.length;

    // 7. Land fill on the offline map: while any neighbor is on,
    // Washington white and the neighbors in Washington's usual gray; with all off, Washington's gray as before.
    await reload();
    const LAND_HEX = await p.eval('CVIWA.map.LAND_PAINT["fill-color"]'), NR_HEX = await p.eval('CVIWA.map.NR_LAND_PAINT["fill-color"]');
    const WA_ON_HEX = await p.eval('CVIWA.map.WA_LAND_WITH_NEIGHBORS');
    const LAND = rgb(LAND_HEX), NRL = rgb(NR_HEX), WHITE = rgb(WA_ON_HEX), BG = [248, 249, 250];
    run.landFill = { washingtonAlone: LAND_HEX, washingtonWithNeighbors: WA_ON_HEX, neighbors: NR_HEX };
    check(LAND_HEX === '#ececec' && WA_ON_HEX === '#ffffff' && NR_HEX === LAND_HEX, 'land fill: Washington #ececec alone, white with neighbors on; neighbors in #ececec (by design)', run.landFill);
    await directions(false);   // no circles over the pixels read
    await jump(LAND_CAM); await idle();
    const px0 = await p.eval(PIX(A, ALL_PTS));
    check(near(px0[0], LAND) && [1, 2, 3, 4].every(i => near(px0[i], BG)), 'land fill, all off: Washington gray, the background around it', px0);
    await setAll(true, false);
    const px1 = await p.eval(PIX(A, ALL_PTS)), st7 = await p.eval(NRSTATE);
    check(near(px1[0], WHITE) && [1, 2, 3].every(i => near(px1[i], NRL)) && near(px1[4], BG),
      'land fill, all on: Washington white, Oregon, Idaho and British Columbia gray, the sea background', px1);
    check(st7.nrLand.length === REGIONS.length && st7.nrLand.every(c => c === NR_HEX) && st7.waLand === 'visible', 'land fill: every neighbor layer in the gray', st7.nrLand);
    for (const r of REGIONS.slice(1)) await p.eval(click(r.id, 'nr-on'));
    await idle();
    const px1b = await p.eval(PIX(A, ALL_PTS));
    check(near(px1b[0], WHITE) && near(px1b[3], NRL) && near(px1b[1], BG) && near(px1b[2], BG), 'land fill, one neighbor on: Washington still white', px1b);
    await p.eval(click(REGIONS[0].id, 'nr-on')); await idle();
    const px1c = await p.eval(PIX(A, ALL_PTS));
    check(near(px1c[0], LAND), 'land fill, the last neighbor off: Washington back to its gray', px1c);
    await setAll(true, false);
    await shot('nr-6-land-fill');

    // 8. Tile basemap (USGS Topo, answered here): regions first turned on while it is shown, neighbor layers kept and
    // both land fills hidden; switches flipped during a style swap; back to the offline map; a basemap that does not load.
    await reload();
    await directions(false);
    await jump(LAND_CAM); await idle();
    const bmAt = log.provider.length;
    await p.eval(choose('usgs-topo'));
    await p.waitFor(`${A}.tilesOk > 0`, 15000, 'USGS tiles'); await idle();
    await setAll(true, false);
    let r8 = await p.eval(NRSTATE);
    check(REGIONS.every(r => r8.rows[r.id].on && r8.rows[r.id].outline === 'visible' && r8.rows[r.id].drawnOutline > 0 && r8.rows[r.id].land === 'none') && r8.waLand === 'none',
      'basemap: regions first turned on while it is shown: outlines drawn, land fills hidden (Washington\'s too)', r8.rows);
    let px8 = await p.eval(PIX(A, [PT.wa, PT.or, PT.id, PT.bc]));
    check(px8.every(x => near(x, USGS)), 'basemap: its tiles show inside Washington and the neighbors (no land fill over them)', px8);
    check((r8.attribution || '').indexOf(USGS_CREDIT) >= 0 && (r8.attribution || '').indexOf(STATCAN) >= 0 && r8.creditOpen,
      'basemap: the map credit names the basemap and Statistics Canada, open', r8.attribution);
    let sh8 = await p.eval(SHOT(A, 'bm'));
    check((sh8.attribution || '').indexOf(USGS_CREDIT) >= 0 && (sh8.attribution || '').indexOf(STATCAN) >= 0 && REGIONS.every(r => sh8.labels.indexOf(r.name) >= 0),
      'basemap: the screenshot carries both credits and the region names', { attribution: sh8.attribution, labels: sh8.labels.filter(t => REGIONS.some(r => r.name === t)) });
    await shot('nr-7-basemap');
    // Flipped in the same moment as a basemap change (while MapLibre swaps the style).
    await p.eval(`(function(){${choose('offline')};document.querySelector('#nr-list .nr-counties[data-region="or"]').click();return true})()`);
    await p.waitFor(`!${A}.switching && ${A}.map.isStyleLoaded()`, 15000, 'offline style'); await idle();
    r8 = await p.eval(NRSTATE); px8 = await p.eval(PIX(A, [PT.wa, PT.or, PT.id, PT.bc]));
    check(REGIONS.every(r => r8.rows[r.id].outline === 'visible' && r8.rows[r.id].land === 'visible') && r8.rows.or.countyLines === 'visible' && r8.rows.or.drawnCounties > 0 && r8.waLand === 'visible',
      'back to the offline map (Oregon\'s counties turned on during the swap): layers kept, counties drawn, land fills back', r8.rows);
    check(near(px8[0], WHITE) && [1, 2, 3].every(i => near(px8[i], NRL)), 'back to the offline map: Washington white, neighbors gray', px8);
    await p.eval(`(function(){${choose('usgs-topo')};document.querySelector('#nr-list .nr-on[data-region="id"]').click();return true})()`);
    await p.waitFor(`${A}.tilesOk > 0 && !${A}.switching`, 15000, 'USGS tiles again'); await idle();
    r8 = await p.eval(NRSTATE);
    check(!r8.rows.id.on && r8.rows.id.outline === 'none' && r8.rows.or.outline === 'visible' && r8.rows.or.countyLines === 'visible' && r8.rows.or.land === 'none' && r8.rows.bc.land === 'none',
      'basemap chosen while Idaho is turned off: Idaho hidden, the others kept without land fill', r8.rows);
    await p.eval(click('id', 'nr-on')); await idle();
    r8 = await p.eval(NRSTATE);
    check(r8.rows.id.outline === 'visible' && r8.rows.id.land === 'none', 'basemap: a region turned on again while it is shown gets no land fill', r8.rows.id);
    await p.eval(choose('offline')); await p.waitFor(`!${A}.switching`, 15000, 'offline'); await idle();
    // A basemap that does not load: the county land fill comes back, and with it the neighbors' lighter fill.
    mode = 'down';
    await p.eval(choose('usgs-topo'));
    await p.waitFor(`!document.getElementById('basemap-status').hidden`, 30000, 'basemap failure message'); await idle();
    r8 = await p.eval(NRSTATE); px8 = await p.eval(PIX(A, [PT.wa, PT.or, PT.id, PT.bc]));
    check(r8.waLand === 'visible' && REGIONS.every(r => r8.rows[r.id].land === 'visible' && r8.rows[r.id].outline === 'visible'),
      'basemap that does not load: Washington\'s and the neighbors\' land fills back, outlines kept', { wa: r8.waLand, rows: r8.rows });
    check(near(px8[0], WHITE) && [1, 2, 3].every(i => near(px8[i], NRL)), 'basemap that does not load: Washington white, neighbors gray', px8);
    await shot('nr-8-basemap-failed');
    await p.eval(`document.getElementById('basemap-offline').click()`);
    await p.waitFor(`!${A}.switching && ${A}.shown === null && !${A}.basemap`, 15000, 'back to offline'); await idle();
    mode = 'normal';
    const bmRequests = log.provider.slice(bmAt).map(x => x.url);
    check(outside0 === bmAt && bmRequests.length > 0 && bmRequests.every(u => /^https:\/\/basemap\.nationalmap\.gov\/arcgis\/rest\/services\/USGSTopo\/MapServer\/tile\//.test(u)),
      'basemap part: outside requests only to the chosen basemap\'s tiles, none before it', bmRequests.filter(u => !/nationalmap/.test(u)).slice(0, 5));
    const offAt = log.provider.length;
    await directions(true);

    // 9. Compare: both maps follow the switches; the right map, hidden outside Compare, catches up when it is turned on.
    const same = (a, b) => REGIONS.every(r => ['on', 'outline', 'land', 'countyLines', 'name'].every(k => a[r.id][k] === b[r.id][k]));
    await periodMode('compare');
    await p.waitFor(`${AB} && ${AB}.ready && !!${AB}.map.getLayer('nr-bc-outline')`, 20000, 'right map with the regions'); await idleOf(AB); await idle();
    let ra = await rowsOf(A), rb = await rowsOf(AB);
    check(same(ra, rb) && REGIONS.every(r => rb[r.id].outline === 'visible' && rb[r.id].drawnOutline > 0 && rb[r.id].name) && rb.or.countyLines === 'visible' && rb.or.drawnCounties > 0,
      'Compare: the right map, made now, draws the regions and counties that are on', { ra, rb });
    await p.eval(click('id', 'nr-on')); await p.eval(click('bc', 'nr-counties')); await idleOf(AB); await idle();
    ra = await rowsOf(A); rb = await rowsOf(AB);
    check(same(ra, rb) && rb.id.outline === 'none' && rb.bc.countyLines === 'visible' && ra.bc.countyLines === 'visible', 'Compare: both maps follow a switch', { ra, rb });
    const statB = (await p.eval(STATE_OF(AB))).attribution;
    check((statB || '').indexOf(STATCAN) >= 0, 'Compare: the right map credits Statistics Canada while British Columbia is on', statB);
    await shot('nr-9-compare');
    await periodMode('single'); await idle();
    await p.eval(click('bc', 'nr-on')); await p.eval(click('id', 'nr-on'));
    await p.waitFor(`!!${A}.map.getLayer('nr-id-outline')`, 10000, 'id'); await p.eval(click('id', 'nr-counties')); await idle();
    await periodMode('compare'); await idleOf(AB); await idle();
    ra = await rowsOf(A); rb = await rowsOf(AB);
    check(same(ra, rb) && rb.bc.outline === 'none' && rb.id.outline === 'visible' && rb.id.countyLines === 'visible',
      'Compare again: the right map catches up with switches flipped outside Compare', { ra, rb });
    await p.eval(click('bc', 'nr-on')); await idleOf(AB);
    const shB = await p.eval(SHOT(AB, 'b'));
    check((shB.attribution || '').indexOf(STATCAN) >= 0 && shB.labels.indexOf(BC.name) >= 0, 'Compare: the right map\'s screenshot has British Columbia\'s name and credit', shB.attribution);
    await periodMode('single'); await idle();

    // 10. Screenshot (offline map): the names drawn as shown, neighbor lines by pixel, the credit while BC is on.
    await setAll(false); await directions(false);
    await p.eval(`void CVIWA.map.fitView(${A})`); await idle();
    await p.eval(click('bc', 'nr-on')); await p.eval(click('or', 'nr-on'));
    await p.waitFor(`!!${A}.map.getLayer('nr-or-outline')`, 10000, 'or'); await idle();
    const s1 = await p.eval(SHOT(A, 's1', [[-119.0, 45.45], [-118.2, 47.12]]));   // Oregon and Washington in the opening view, away from the names drawn
    check(s1.labels.indexOf(BC.name) >= 0 && s1.labels.indexOf('Oregon') >= 0 && s1.labels.indexOf('Idaho') < 0,
      'screenshot: the names of the regions on (and not of one off)', s1.labels.filter(t => REGIONS.some(r => r.name === t)));
    check((s1.attribution || '').indexOf(STATCAN) >= 0 && (s1.attribution || '').indexOf('U.S. Census Bureau') >= 0, 'screenshot: credit band with the Census Bureau and Statistics Canada while BC is on', s1.attribution);
    check(near(s1.px[0], NRL) && near(s1.px[1], WHITE), 'screenshot: the land fills in the picture (Oregon gray, Washington white)', s1.px);
    await p.eval(click('or', 'nr-counties')); await idle();
    const s2 = await p.eval(SHOT(A, 's2'));
    const orBox = [-124.5, 44.2, -116.6, 45.9], dCounties = await p.eval(DIFF(A, 's1', 's2', orBox));
    check(dCounties > 300, 'screenshot: Oregon\'s county lines in the picture (pixels changed in Oregon)', dCounties);
    await p.eval(click('bc', 'nr-on')); await idle();
    const s3 = await p.eval(SHOT(A, 's3'));
    const dBC = await p.eval(DIFF(A, 's2', 's3', [-126.5, 48.2, -115, 52]));
    check(dBC > 100 && s3.labels.indexOf(BC.name) < 0, 'screenshot: British Columbia\'s outline, fill and name leave the picture when it is off', dBC);
    await p.eval(click('or', 'nr-on')); await p.eval(click('id', 'nr-on'));
    await p.waitFor(`!!${A}.map.getLayer('nr-id-outline')`, 10000, 'id'); await idle();
    const s4 = await p.eval(SHOT(A, 's4'));
    check(s4.attribution === null && s4.labels.indexOf('Idaho') >= 0, 'screenshot: Idaho alone adds no credit band (the Census Bureau is the page\'s own credit)', s4.attribution);
    await p.eval(click('id', 'nr-counties'));
    await jump({ center: [-116.2, 46.8], zoom: 7.3 }); await idle();
    // Idaho's county names shown on screen and inside the map: the picture draws exactly these (with counties off, none).
    const inView = await p.eval(`(function(){var s=${A},m=s.map,c=m.getCanvas();return s.nr.labels.id.counties.filter(function(k){var q=m.project(k.getLngLat());
      return !k.getElement().classList.contains('hidden')&&q.x>=0&&q.y>=0&&q.x<=c.clientWidth&&q.y<=c.clientHeight}).length})()`);
    const s5 = await p.eval(SHOT(A, 's5'));
    await p.eval(click('id', 'nr-counties')); await idle();
    const s6 = await p.eval(SHOT(A, 's6'));
    check(inView > 0 && s5.labels.length - s6.labels.length === inView, 'screenshot at zoom 7.3: Idaho\'s county names drawn as the map shows them', { inView, on: s5.labels.length, off: s6.labels.length });
    await p.eval(click('id', 'nr-on')); await p.eval(`void CVIWA.map.fitView(${A})`); await idle();
    await directions(true);

    // 11. The credit on the map: Statistics Canada while BC is drawn, opened when it is turned on (also after a real drag
    // folded the credit); none added for Idaho or Oregon.
    await p.eval(click('id', 'nr-on')); await p.eval(click('or', 'nr-on'));
    await p.waitFor(`!!${A}.map.getLayer('nr-or-outline')`, 10000, 'or'); await idle();
    let c11 = await p.eval(NRSTATE);
    check(c11.attribution === 'Boundaries: U.S. Census Bureau', 'map credit: Idaho and Oregon add nothing (the Census Bureau once)', c11.attribution);
    await p.drag(700, 450, 40, 20); await idle();
    check(!(await p.eval(NRSTATE)).creditOpen, 'map credit: a real drag folds it (MapLibre)');
    await p.eval(click('bc', 'nr-on')); await idle();
    c11 = await p.eval(NRSTATE);
    check((c11.attribution || '').indexOf(STATCAN) >= 0 && c11.creditOpen, 'map credit: British Columbia on: Statistics Canada named, the credit opened', c11.attribution);
    await p.eval(click('bc', 'nr-on')); await idle();
    c11 = await p.eval(NRSTATE);
    check((c11.attribution || '').indexOf('Statistics Canada') < 0, 'map credit: British Columbia off: Statistics Canada gone', c11.attribution);

    // 12. The footer: each source's statement in full, the license linked.
    const foot = await p.eval(`(function(){return Array.from(document.querySelectorAll('#nr-statements .nr-statement')).map(function(e){var a=e.querySelector('a');
      return {region:e.dataset.region,text:e.textContent.replace(/\\s+/g,' ').trim(),href:a&&a.getAttribute('href'),link:a&&a.textContent,rel:a&&a.rel,target:a&&a.target}})})()`);
    const withStatement = REGIONS.filter(r => r.statement);
    check(withStatement.length >= 1 && foot.length === withStatement.length && withStatement.every((r, i) => foot[i].region === r.id && foot[i].text === r.name + ' boundaries: ' + r.statement &&
      (!r.license || (foot[i].href === r.license.url && foot[i].link === r.license.name && /noopener/.test(foot[i].rel) && foot[i].target === '_blank'))),
      'footer: the Statistics Canada statement in full and the Open Government Licence – Canada linked, with the region off', foot);
    check(/Adapted from Statistics Canada, 2021 Census Boundary Files/.test((foot[0] || {}).text) && /does not constitute an endorsement by Statistics Canada/.test((foot[0] || {}).text) &&
      /Contains information licensed under the Open Government Licence – Canada/.test((foot[0] || {}).text), 'footer: both statements', foot[0]);
    check(/^Boundaries: U\.S\. Census Bureau/.test(await p.eval(`document.getElementById('attrib').textContent`)), 'footer: the Census Bureau line kept');

    // 13. Label style: the neighbor names take the chosen colors, as Washington's.
    await p.eval(click('bc', 'nr-on')); await p.eval(click('id', 'nr-on'));
    await p.waitFor(`!!${A}.map.getLayer('nr-id-outline')`, 10000, 'id'); await p.eval(click('id', 'nr-counties'));
    await jump({ center: [-116.6, 47.4], zoom: 7.2 }); await idle();
    for (const v of ['dark', 'light', 'auto']) {
      await p.eval(`(function(){var e=document.getElementById('s-label-style');e.value='${v}';e.dispatchEvent(new Event('change'));return true})()`);
      const col = await p.eval(`(function(){var s=${A},c=function(e){var k=getComputedStyle(e);return k.color+'/'+k.textShadow};
        return {wa:c(s.labels[0].getElement()),name:c(s.nr.labels.id.name.getElement()),county:c(s.nr.labels.id.counties[0].getElement()),label:s.contrast.label}})()`);
      check(col.wa === col.name && col.wa === col.county, 'Label style ' + v + ': neighbor names in Washington\'s label colors', col);
    }
    await shot('nr-10-idaho-labels');
    await p.eval(`void CVIWA.map.fitView(${A})`); await idle();

    // 14. Reset All turns every switch off, on both maps.
    await setAll(true, true);
    await periodMode('compare'); await idleOf(AB);
    await p.eval(`document.getElementById('reset-all').click()`); await idle();
    const r14 = await p.eval(NRSTATE);
    check(REGIONS.every(r => { const x = r14.rows[r.id]; return !x.on && !x.counties && x.subHidden && x.outline === 'none' && x.land === 'none' && x.countyLines === 'none' && !x.name && x.countyNames === 0; }) &&
      r14.msg === null && (r14.attribution || '').indexOf('Statistics Canada') < 0, 'Reset All: every region and counties switch off, nothing drawn, the credit gone', r14.rows);
    await periodMode('compare'); await idleOf(AB);
    const rb14 = await rowsOf(AB);
    check(REGIONS.every(r => rb14[r.id].outline === 'none' && rb14[r.id].countyLines === 'none' && !rb14[r.id].name), 'Reset All: the right map shows none either', rb14);
    await periodMode('single');

    check(log.provider.length === offAt, 'after the basemap part: no request outside the site folder', log.provider.slice(offAt).map(x => x.url).slice(0, 5));
    check(log.requests.filter(u => /\/geo\/regions\//.test(u)).every(u => u.startsWith(SITE_BASE)), 'region files only from the site folder');
    check(!log.exceptions.length, 'no uncaught page errors', log.exceptions);
  } catch (e) {
    check(false, 'run aborted', { error: String(e && e.message || e), exceptions: log.exceptions.slice(0, 3),
      requests: log.requests.filter(u => /regions/.test(u)), state: await p.eval(NRSTATE).catch(x => String(x)) });
  } finally {
    await b.close();
  }
  run.finished = new Date().toISOString(); run.pass = pass; run.fail = fail; run.failures = failures;
  fs.writeFileSync(path.join(OUT, 'browser_run.json'), JSON.stringify(run, null, 1));
  console.log('NR browser [' + PAGE_LABEL + ']: ' + pass + '/' + (pass + fail) + ' passed' + (fail ? '\n  ' + failures.join('\n  ') : ''));
  process.exitCode = fail ? 1 : 0;
})();
