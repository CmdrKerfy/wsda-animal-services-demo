#!/usr/bin/env node
'use strict';
// S3 browser test (opt-in tile basemaps): opens site/cvi/index.html in the installed Google Chrome (headless, throw-away
// profile) and answers every request to a basemap provider itself, through the DevTools Fetch domain, with synthetic
// local responses (a style, TileJSON, a vector tile encoded here, sprites, fonts, PNG tiles). Nothing goes to the
// internet. Checks: nothing is requested while the offline county map is shown; a chosen basemap fetches only from its
// own hosts; the page's CSP lists exactly the basemap hosts and refuses others; requests to other hosts that a style
// asks for are refused by the page before they are sent; the tiles are drawn under the page's circles, the county land
// fill is hidden on a basemap and back on the offline map; switching keeps the camera and the circles; attribution on
// the map and in the screenshot (and the screenshot saves); a basemap that cannot load shows a message naming the
// provider, the county shapes come back, "Back to offline map" works; Compare draws the basemap on both maps.
// Also: every provider request is made by the page itself (not MapLibre's workers) with
// redirects refused, no credentials and no referrer; a redirect to another host is never followed; tiles that are all
// missing (404), a raster provider that is down and a provider that never answers each show the failure message; a
// failed sprite or a refused request does not; the credit is open on the map after a real drag; a raster basemap's
// last tiles are stretched past its max zoom; rapid switching and a slow style leave no request to an older choice.
// S1.1: the legend swatches over white on a tile basemap, over the county land on the offline map and after a failure.
// Usage (repository root): node tests/browser/run_s3_browser.js      (Node >= 22; Chrome installed; no packages)
// Optional: CHROME_BIN=<path to chrome>; S3_PAGE_URL=<another copy of the page, e.g. over local http>.
// Writes only local-test-artifacts/s3/browser_run.json, s3/download/ (the saved screenshot), s3/screens/ (pictures of
// the page on each basemap, for review) and a temporary profile (deleted on exit).
const { spawn } = require('child_process');
const fs = require('fs'), path = require('path'), zlib = require('zlib'), vm = require('vm');
const { pathToFileURL, fileURLToPath } = require('url');
const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join(ROOT, 'local-test-artifacts', 's3');
const PAGE = process.env.S3_PAGE_URL || pathToFileURL(path.join(ROOT, 'site', 'cvi', 'index.html')).href;
const SITE_BASE = new URL('..', PAGE).href;
const PAGE_LABEL = /^file:/.test(PAGE) ? path.relative(ROOT, fileURLToPath(PAGE)).split(path.sep).join('/') + ' (file://)' : PAGE.split(/[?#]/)[0];
const FIX = f => path.join(ROOT, 'tests', 'synthetic', f);
const CHROME = process.env.CHROME_BIN || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  : process.platform === 'win32' ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : 'google-chrome');
const sleep = ms => new Promise(r => setTimeout(r, ms));

// The page's basemap list, read the way the page reads it (shared/release.js first), from the site under test: this
// repository's site/, or another copy named by SITE_ROOT (such as the release copy, which offers fewer basemaps).
const SITE = process.env.SITE_ROOT ? path.resolve(process.env.SITE_ROOT) : path.join(ROOT, 'site');
const SB = { console, URL };
vm.createContext(SB);
for (const f of ['shared/release.js', 'cvi/app/basemaps.js']) {
  vm.runInContext(fs.readFileSync(path.join(SITE, f), 'utf8'), SB, { filename: f });
}
const BM = SB.CVIWA.basemaps;

// ---- synthetic provider responses ------------------------------------------------------------------------------
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
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
// A Mapbox Vector Tile (protobuf written by hand): layer "water" with one square covering the tile and its buffer,
// layer "place" with one named point.
function mvt() {
  const varint = n => { const b = []; while (n > 127) { b.push((n & 127) | 128); n = Math.floor(n / 128); } b.push(n); return Buffer.from(b); };
  const zz = n => (n << 1) ^ (n >> 31);
  const field = (no, wt, payload) => Buffer.concat([varint((no << 3) | wt), wt === 2 ? varint(payload.length) : Buffer.alloc(0), payload]);
  const vint = (no, v) => field(no, 0, varint(v));
  const bytes = (no, b) => field(no, 2, b);
  const packed = (no, arr) => bytes(no, Buffer.concat(arr.map(varint)));
  const feature = (id, type, geom, tags) => Buffer.concat([vint(1, id), tags ? packed(2, tags) : Buffer.alloc(0), vint(3, type), packed(4, geom)]);
  const layer = (name, feats, keys, values) => Buffer.concat([vint(15, 2), bytes(1, Buffer.from(name)), ...feats.map(f => bytes(2, f)),
    ...(keys || []).map(k => bytes(3, Buffer.from(k))), ...(values || []).map(v => bytes(4, bytes(1, Buffer.from(v)))), vint(5, 4096)]);
  const square = [9, zz(-64), zz(-64), 26, zz(4224), zz(0), zz(0), zz(4224), zz(-4224), zz(0), 15];
  const water = layer('water', [feature(1, 3, square)]);
  const place = layer('place', [feature(2, 1, [9, zz(2048), zz(2048)], [0, 0])], ['name'], ['Testville']);
  return Buffer.concat([bytes(3, water), bytes(3, place)]);
}
const WATER = [42, 111, 219], USGS = [200, 162, 107], NE2 = [120, 150, 90];
// Each basemap draws its own color (vector: the water square covering every tile; raster: the whole tile), so the
// pixel checks tell the basemaps apart. Liberty and USGS Topo keep the colors of the first checks.
const colorOf = key => { let h = 7; for (const ch of key) h = (Math.imul(h, 31) + ch.charCodeAt(0)) >>> 0; return [30 + h % 180, 30 + (h >>> 8) % 180, 30 + (h >>> 16) % 180]; };
const styleKey = b => b.style.replace(/\/style\.json$/, '').split('/').pop();
const colorFor = b => b.id === 'ofm-liberty' ? WATER : b.id === 'usgs-topo' ? USGS : colorOf(b.type === 'vector' ? styleKey(b) : b.tiles);
const RASTERS = BM.LIST.filter(b => b.type === 'raster').map(b => ({ b, re: new RegExp('^' + b.tiles.replace(/[.?+()]/g, '\\$&').replace(/\{[zxy]\}/g, '\\d+') + '$') }));
const CARTO_ATTRIBUTION = '&copy; <a href="https://carto.com/about-carto/" target="_blank" rel="noopener">CARTO</a>, &copy; <a href="http://www.openstreetmap.org/about/" target="_blank">OpenStreetMap</a> contributors';
const OFM_ATTRIBUTION = '<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> <a href="https://www.openmaptiles.org/" target="_blank">&copy; OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>';
const hex = c => '#' + c.map(v => v.toString(16).padStart(2, '0')).join('');
// mode: 'normal'; 'rogue' (the style also asks for a host that is not OpenFreeMap's: one the CSP allows, one it
// does not); 'down' (every provider request fails as if offline); 'missing' (styles and TileJSON answer, every tile is
// 404); 'redirect-tile' / 'redirect-style' (vector tiles / the style answer 302 to basemap.nationalmap.gov);
// 'nosprite' (the sprite is 404, the rest answers); 'slowstyle' (styles answer after 2.5 s); 'hang' (no answer at all).
let mode = 'normal';
const REDIRECT_TO = 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/1/1/1';
function ofmStyle(name) {
  const s = { version: 8, name: 'synthetic ' + name, glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sprite: 'https://tiles.openfreemap.org/sprites/ofm_f384/ofm',
    sources: { ne2_shaded: { type: 'raster', tiles: ['https://tiles.openfreemap.org/natural_earth/ne2sr/{z}/{x}/{y}.png'], tileSize: 256, maxzoom: 6 },
      openmaptiles: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' } },
    layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#f8f4f0' } },
      { id: 'ne2', type: 'raster', source: 'ne2_shaded' },
      { id: 'water', type: 'fill', source: 'openmaptiles', 'source-layer': 'water', paint: { 'fill-color': hex(name === 'liberty' ? WATER : colorOf(name)) } },
      { id: 'place', type: 'symbol', source: 'openmaptiles', 'source-layer': 'place', layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Regular'] } }] };
  if (mode === 'tilejson-elsewhere') { s.sources.openmaptiles.url = 'https://rogue.example.invalid/planet'; delete s.sources.ne2_shaded; s.layers = s.layers.filter(l => l.id !== 'ne2'); }
  if (mode === 'rogue') {
    s.sources.rogue_allowed = { type: 'raster', tiles: ['https://basemap.nationalmap.gov/rogue/{z}/{x}/{y}.png'], tileSize: 256 };
    s.sources.rogue_other = { type: 'raster', tiles: ['https://rogue.example.invalid/{z}/{x}/{y}.png'], tileSize: 256 };
    s.layers.push({ id: 'rogue1', type: 'raster', source: 'rogue_allowed' }, { id: 'rogue2', type: 'raster', source: 'rogue_other' });
  }
  return s;
}
function cartoStyle(name) {
  return { version: 8, name: 'synthetic ' + name, glyphs: 'https://tiles.basemaps.cartocdn.com/fonts/{fontstack}/{range}.pbf',
    sprite: 'https://tiles.basemaps.cartocdn.com/gl/' + name + '/sprite',
    sources: { carto: { type: 'vector', url: 'https://tiles.basemaps.cartocdn.com/vector/carto.streets/v1/tiles.json' } },
    layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#fafaf8' } },
      { id: 'water', type: 'fill', source: 'carto', 'source-layer': 'water', paint: { 'fill-color': hex(colorOf(name)) } },
      { id: 'place', type: 'symbol', source: 'carto', 'source-layer': 'place', layout: { 'text-field': ['get', 'name'], 'text-font': ['Montserrat Regular'] } }] };
}
function synth(url) {
  const u = new URL(url), p = u.pathname, json = o => ({ type: 'application/json', body: Buffer.from(JSON.stringify(o)) });
  if (mode === 'missing' && /\.(pbf|png|mvt)$|\/tile\//.test(p) && !/\/fonts\/|\/sprites?\b/.test(p)) return null;
  if (mode === 'reliefonly' && /\/planet\/test\/.*\.pbf$/.test(p)) return null;
  if (mode === 'nosprite' && /\/sprites?\b/.test(p)) return null;
  let m;
  if (u.hostname === 'basemaps.cartocdn.com' && (m = /^\/gl\/([a-z-]+)\/style\.json$/.exec(p))) return json(cartoStyle(m[1]));
  if (u.hostname === 'tiles.basemaps.cartocdn.com') {
    if (p === '/vector/carto.streets/v1/tiles.json') return json({ tilejson: '2.2.0', name: 'CARTO vector tiles', attribution: CARTO_ATTRIBUTION, minzoom: 0, maxzoom: 14,
      tiles: ['a', 'b', 'c', 'd'].map(x => 'https://tiles-' + x + '.basemaps.cartocdn.com/vectortiles/carto.streets/v1/{z}/{x}/{y}.mvt') });
    if (/^\/fonts\/[^/]+\/\d+-\d+\.pbf$/.test(p)) return { type: 'application/x-protobuf', body: Buffer.alloc(0) };
    if (/^\/gl\/[a-z-]+\/sprite(@2x)?\.json$/.test(p)) return json({ dot: { x: 0, y: 0, width: 4, height: 4, pixelRatio: /@2x/.test(p) ? 2 : 1 } });
    if (/^\/gl\/[a-z-]+\/sprite(@2x)?\.png$/.test(p)) return { type: 'image/png', body: png(4, 4, [255, 0, 0, 255]) };
  }
  if (/^tiles-[a-d]\.basemaps\.cartocdn\.com$/.test(u.hostname) && /^\/vectortiles\/carto\.streets\/v1\/\d+\/\d+\/\d+\.mvt$/.test(p))
    return { type: 'application/x-protobuf', body: mvt() };
  const ras = RASTERS.find(r => r.re.test(url));
  if (ras) return { type: 'image/png', body: png(256, 256, [...colorFor(ras.b), 255]) };
  if (u.hostname === 'tiles.openfreemap.org') {
    if ((m = /^\/styles\/(liberty|bright|positron|dark)$/.exec(p))) return json(ofmStyle(m[1]));
    if (p === '/planet') return json({ tilejson: '3.0.0', tiles: ['https://tiles.openfreemap.org/planet/test/{z}/{x}/{y}.pbf'], attribution: OFM_ATTRIBUTION,
      bounds: [-180, -85.05113, 180, 85.05113], minzoom: 0, maxzoom: 14, name: 'OpenFreeMap' });
    if (/^\/planet\/test\/\d+\/\d+\/\d+\.pbf$/.test(p)) return { type: 'application/vnd.mapbox-vector-tile', body: mvt() };
    if (/^\/fonts\/[^/]+\/\d+-\d+\.pbf$/.test(p)) return { type: 'application/x-protobuf', body: Buffer.alloc(0) };
    if (/^\/sprites\/ofm_f384\/ofm(@2x)?\.json$/.test(p)) return json({ dot: { x: 0, y: 0, width: 4, height: 4, pixelRatio: /@2x/.test(p) ? 2 : 1 } });
    if (/^\/sprites\/ofm_f384\/ofm(@2x)?\.png$/.test(p)) return { type: 'image/png', body: png(4, 4, [255, 0, 0, 255]) };
    if (/^\/natural_earth\/ne2sr\/\d+\/\d+\/\d+\.png$/.test(p)) return { type: 'image/png', body: png(256, 256, [...NE2, 255]) };
  }
  return null;
}

// ---- minimal DevTools Protocol driver (as the S2 suite's), plus Fetch interception on the page and its workers --
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
const near = (a, b, tol) => a && b && a.length >= 3 && [0, 1, 2].every(i => Math.abs(a[i] - b[i]) <= (tol || 3));
const hostOf = u => { try { return new URL(u).hostname; } catch (e) { return u; } };
const OWN_LAYERS = ['wa-land', 'county-lines', 'circles', 'circles_dim', 'circles_spotlight'];
const LAND = [236, 236, 236], BG = [248, 249, 250];

// Pixels of a map's own canvas (no labels, no controls) at fractions of its size, drawn on the spot.
const PIXELS = (handle, pts) => `(function(){var m=${handle}.map;m.redraw();var c=m.getCanvas(),o=document.createElement('canvas');o.width=c.width;o.height=c.height;
  var g=o.getContext('2d');g.drawImage(c,0,0);return ${JSON.stringify(pts)}.map(function(p){return [].slice.call(g.getImageData(Math.round(p[0]*(c.width-1)),Math.round(p[1]*(c.height-1)),1,1).data)})})()`;
// The map's state as the checks need it.
const MAPSTATE = handle => `(function(){var s=${handle},m=s.map,G=m.getStyle(),L=G?G.layers.map(function(l){return l.id}):[];
  var a=m.getContainer().querySelector('.maplibregl-ctrl-attrib-inner');
  return {basemap:s.basemap?s.basemap.id:null,failed:!!s.failed,basemapFailed:!!s.basemapFailed,switching:!!s.switching,tilesOk:s.tilesOk,blocked:s.blocked.slice(),
    layers:L,land:m.getLayer('wa-land')?m.getLayoutProperty('wa-land','visibility')||'visible':null,lines:m.getLayer('county-lines')?m.getLayoutProperty('county-lines','visibility'):null,
    attribution:a?a.textContent.replace(/\\s+/g,' ').trim():null,creditOpen:!!a&&a.offsetWidth>0&&getComputedStyle(a).display!=='none',center:m.getCenter().toArray(),zoom:m.getZoom(),
    circles:m.getLayer('circles')?m.queryRenderedFeatures({layers:['circles','circles_dim','circles_spotlight']}).length:-1}})()`;

(async () => {
  fs.mkdirSync(path.join(OUT, 'screens'), { recursive: true });
  const DL = path.join(OUT, 'download'); fs.rmSync(DL, { recursive: true, force: true }); fs.mkdirSync(DL, { recursive: true });
  const b = await launch(); const p = b.page, log = b.log;
  const run = { chrome: b.version, platform: process.platform, page: PAGE_LABEL, started: new Date().toISOString() };
  const A = 'CVIWA.state.mapHandle';
  const ms = () => p.eval(MAPSTATE(A));
  const idle = async (handle, label) => {
    try { await p.waitFor(`(function(){var s=${handle};return s.ready&&!s.switching&&s.map.loaded()&&s.map.areTilesLoaded()})()`, 15000, label || 'map idle'); }
    catch (e) { throw new Error(e.message + ' ' + JSON.stringify(await p.eval(`(function(){var s=${handle};return {ready:s.ready,switching:s.switching,loaded:s.map.loaded(),
      tiles:s.map.areTilesLoaded(),styleLoaded:s.map.isStyleLoaded(),basemapFailed:s.basemapFailed,fallback:s.fallback,failed:s.failed}})()`))); }
    await sleep(450);   // raster fade-in (300 ms)
  };
  const choose = async id => { await p.eval(`(function(){var s=document.getElementById('s-basemap');s.value=${JSON.stringify(id)};s.dispatchEvent(new Event('change'))})()`); await sleep(100); };
  const providerSince = k => log.provider.slice(k).map(r => r.url);
  // A real drag across the middle of a map, then back to the opening view (the camera checks compare with it).
  const dragMap = async (sel, handle) => {
    const r = await p.eval(`(function(){var b=document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect();return [b.left+b.width/2,b.top+b.height/2]})()`);
    await p.drag(r[0], r[1], 120, 50); await sleep(300);
    await p.eval(`void CVIWA.map.fitView(${handle})`); await idle(handle);
  };
  const msgShown = () => p.eval(`!document.getElementById('basemap-status').hidden`);
  // Choose a basemap in a provider mode and wait for the failure message; then back to the offline map.
  const expectFailure = async (id, m, label, extra) => {
    mode = m; const k = log.provider.length;
    await choose(id);
    try { await p.waitFor(`!document.getElementById('basemap-status').hidden`, 15000, label + ': failure message'); }
    catch (e) { throw new Error(e.message + ' ' + JSON.stringify(await p.eval(`(function(){var s=${A};return {shown:s.shown&&s.shown.id,tilesOk:s.tilesOk,tileTries:s.tileTries,
      sourceErrors:s.sourceErrors,switching:s.switching,loaded:s.map.loaded(),failed:s.basemapFailed}})()`)) + ' sent ' + JSON.stringify(providerSince(k).slice(0, 12))); }
    if (m === 'hang') await sleep(600); else await idle(A, label + ' idle');   // unanswered requests keep the map busy
    const st = await ms(), px = await p.eval(PIXELS(A, PTS)), msg = await p.eval(`document.getElementById('basemap-msg').textContent`);
    const sent = providerSince(k);
    mode = 'normal';
    await choose('offline'); await idle(A);
    return { st, px, msg, sent, extra: extra ? await extra() : null };
  };
  let PTS = null;
  try {
    // 1. Offline county map: the default; the page's CSP; nothing fetched from any provider.
    await p.goto(PAGE);
    await p.waitFor(`window.CVIWA && CVIWA.state && CVIWA.state.version >= 1 && ${A}.ready`, 20000, 'map ready');
    const ui0 = await p.eval(`(function(){var s=document.getElementById('s-basemap');return {value:s.value,first:s.options[0].text,firstValue:s.options[0].value,
      groups:[].map.call(s.querySelectorAll('optgroup'),function(g){return {label:g.label,items:[].map.call(g.querySelectorAll('option'),function(o){return [o.value,o.text]})}}),
      note:document.getElementById('basemap-note').hidden,old:/No tile basemap/.test(document.body.textContent),
      csp:document.querySelector('meta[http-equiv="Content-Security-Policy"]').content}})()`);
    run.csp = ui0.csp;
    check(ui0.value === 'offline' && ui0.firstValue === 'offline' && ui0.first === 'Offline county map (no internet)' && ui0.note,
      'Basemap picker: "Offline county map (no internet)" first and chosen on load, no provider line', ui0);
    const wantGroups = BM.groups().map(g => ({ label: g.group, items: g.items.map(x => [x.id, x.name]) }));
    check(JSON.stringify(ui0.groups) === JSON.stringify(wantGroups), 'Basemap picker: the list\'s groups and names, in order', { page: ui0.groups, want: wantGroups });
    check(!ui0.old, 'the old "No tile basemap in S1" note is gone');
    const connect = (/(?:^|;)\s*connect-src ([^;]*)/.exec(ui0.csp) || [])[1] || '';
    check(JSON.stringify(connect.trim().split(/\s+/).sort()) === JSON.stringify(BM.hosts().map(h => 'https://' + h).sort()),
      'CSP connect-src lists exactly the basemap hosts (https)', { connect, hosts: BM.hosts() });
    // Fonts: the site's own Open Sans file only.
    check(/default-src 'none'/.test(ui0.csp) && /img-src data: blob:;/.test(ui0.csp) && /font-src 'self' file:;/.test(ui0.csp) && /script-src 'self' file:;/.test(ui0.csp),
      'CSP otherwise unchanged: default none, images only data:/blob:, fonts only the site\'s own file, local scripts', ui0.csp);
    let s = await ms();
    check(s.basemap === null && s.land === 'visible' && JSON.stringify(s.layers) === JSON.stringify(['background'].concat(OWN_LAYERS)),
      'offline map: land fill shown, the page\'s own layers only', s);
    check(!/[|]/.test(s.attribution || '') && !/OpenFreeMap|USGS/.test(s.attribution || ''), 'offline map: attribution without any basemap credit', s.attribution);
    let v0 = await p.eval('CVIWA.state.version');
    await p.setFiles('#file-input', [FIX('cvi_master_s2.csv')]);
    await p.waitFor(`!CVIWA.state.loading && CVIWA.state.version > ${v0} && CVIWA.state.data.length > 0`, 15000, 'data loaded');
    await idle(A, 'offline idle');
    await p.eval(`void ${A}.map.jumpTo({center:[-122.3,47.6],zoom:8})`); await idle(A);
    await p.eval(`void CVIWA.map.fitView(${A})`); await idle(A);
    // county lines off for the pixel checks (a line could sit under a sampled point)
    await p.eval(`(function(){var c=document.getElementById('s-lines');if(c.checked)c.click()})()`); await idle(A);
    // a point inside Washington with no circle near it, and one outside Washington
    const clear = await p.eval(`(function(){var m=${A}.map,c=m.getCanvas(),W=c.clientWidth,H=c.clientHeight;
      for(var fy=0.3;fy<=0.7;fy+=0.05)for(var fx=0.3;fx<=0.7;fx+=0.05){var x=fx*W,y=fy*H;
        if(m.queryRenderedFeatures([[x-25,y-25],[x+25,y+25]],{layers:['circles','circles_dim','circles_spotlight']}).length)continue;
        if(!m.queryRenderedFeatures([x,y],{layers:['wa-land']}).length)continue;return [fx,fy]}return null})()`);
    check(!!clear, 'a point inside Washington away from the circles', clear);
    PTS = [clear || [0.5, 0.5], [0.01, 0.99]];
    let px = await p.eval(PIXELS(A, PTS));
    s = await ms();
    run.offline = { pixels: px, circles: s.circles };
    check(s.circles > 0, 'offline map: circles drawn', s.circles);
    check(near(px[0], LAND) && near(px[1], BG), 'offline map: land fill inside Washington, background outside', px);
    check(s.blocked.length === 0, 'offline map: nothing refused by the gate (nothing was asked for)', s.blocked);
    check(log.provider.length === 0 && !log.requests.some(u => !u.startsWith(SITE_BASE) && !/^(data|blob):/.test(u)),
      'offline map: no request outside the site folder (page load, data load, pan and zoom)', log.provider.concat(log.requests.filter(u => !u.startsWith(SITE_BASE) && !/^(data|blob):/.test(u))));
    // The CSP refuses any other host; the browser never sends it.
    const k0 = log.provider.length, c0 = log.csp.length;
    const cspProbe = await p.eval(`fetch('https://example.org/x').then(function(){return 'loaded'},function(e){return 'refused: '+e.message})`);
    await sleep(200);
    check(/^refused/.test(cspProbe) && log.csp.length > c0 && log.provider.length === k0, 'CSP refuses a host that is not a basemap host (not sent)', { cspProbe, csp: log.csp.slice(c0) });
    const shot0 = await p.eval(`CVIWA.map.screenshot(${A}).then(function(){return ${A}.lastAttribution})`);
    check(shot0 === null, 'offline map: screenshot without an attribution band (as before S3)', shot0);
    const cam0 = s.center.concat(s.zoom), circles0 = s.circles;
    // A real drag on the offline map folds the compact attribution to "i" (MapLibre does so on the first drag).
    await dragMap('#map', A);
    s = await ms();
    check(!s.creditOpen, 'a real drag folds the attribution (as MapLibre does)', s.creditOpen);

    // 2. OpenFreeMap Liberty (vector): only tiles.openfreemap.org; style, TileJSON, tiles, sprite, fonts all asked.
    const ofm = BM.get('ofm-liberty');
    let k = log.provider.length;
    await choose('ofm-liberty');
    await p.waitFor(`${A}.tilesOk > 0`, 15000, 'vector tiles'); await idle(A, 'vector idle');
    s = await ms();
    const got = providerSince(k);
    run.liberty = { requests: got.length, hosts: [...new Set(got.map(hostOf))], styleRequests: got.filter(u => /\/styles\//.test(u)).length };
    check(got.length > 0 && got.every(u => hostOf(u) === 'tiles.openfreemap.org'), 'Liberty: every request to tiles.openfreemap.org only', run.liberty);
    check(run.liberty.styleRequests === 1, 'Liberty: the style is read once', run.liberty);
    const kinds = ['/styles/liberty', '/planet', '.pbf', '/sprites/ofm_f384/ofm.json', '/sprites/ofm_f384/ofm.png', '/fonts/', '/natural_earth/ne2sr/'];
    check(kinds.every(x => got.some(u => u.indexOf(x) >= 0)), 'Liberty: style, TileJSON, vector tiles, sprite, fonts and raster relief were requested', got.slice(0, 20));
    check(s.basemap === 'ofm-liberty' && !s.failed && !s.basemapFailed && s.land === 'none' && JSON.stringify(s.layers.slice(-5)) === JSON.stringify(OWN_LAYERS) && s.layers[0] === 'background',
      'Liberty: the provider\'s layers under the page\'s own; land fill hidden', s);
    check(s.circles === circles0 && Math.abs(s.center[0] - cam0[0]) < 1e-9 && Math.abs(s.center[1] - cam0[1]) < 1e-9 && Math.abs(s.zoom - cam0[2]) < 1e-9,
      'Liberty: switching keeps the camera and the circles', { s, cam0, circles0 });
    px = await p.eval(PIXELS(A, PTS));
    run.liberty.pixels = px;
    check(near(px[0], WATER) && near(px[1], WATER), 'Liberty: the vector tiles are drawn (water color inside and outside Washington)', px);
    check(s.attribution && s.attribution.indexOf(ofm.attribution) >= 0, 'Liberty: OpenFreeMap credit in the map\'s attribution', s.attribution);
    check(s.creditOpen, 'Liberty: the credit is open on the map after the earlier drag', s.creditOpen);
    check(await p.eval(`(function(){var n=document.getElementById('basemap-note');return !n.hidden&&n.textContent==='Map tiles come from OpenFreeMap over the internet. Your data stays in this browser.'})()`),
      'Liberty: the provider line under the picker');
    {
      const cf = await p.eval(`(function(){var m=${A}.map,f=m.queryRenderedFeatures({layers:['circles','circles_dim','circles_spotlight']})[0];var q=m.project(f.geometry.coordinates);
        var top=m.queryRenderedFeatures([q.x,q.y])[0];return {top:top&&top.layer.id}})()`);
      check(/^circles/.test(cf.top), 'Liberty: a circle is the top feature at its own point (circles above the tiles)', cf);
    }
    const shot1 = await p.eval(`CVIWA.map.screenshot(${A}).then(function(b){return createImageBitmap(b)}).then(function(i){var c=document.createElement('canvas');c.width=i.width;c.height=i.height;
      var g=c.getContext('2d');g.drawImage(i,0,0);var d=g.getImageData(i.width-300,i.height-30,300,30).data,dark=0,white=0;
      for(var j=0;j<d.length;j+=4){if(d[j]<100&&d[j+1]<100&&d[j+2]<100)dark++;if(d[j]>200&&d[j+1]>200&&d[j+2]>200)white++}
      return {text:${A}.lastAttribution,dark:dark,white:white,w:i.width,h:i.height}})`);
    run.liberty.screenshot = shot1;
    check(shot1.text === s.attribution && shot1.text.indexOf(ofm.attribution) >= 0 && shot1.dark > 20 && shot1.white > 500,
      'Liberty: screenshot carries the map\'s attribution (band with text at the bottom right)', shot1);
    await p.capture(path.join(OUT, 'screens', 'liberty.png'));

    // 3. USGS Topo (raster): only basemap.nationalmap.gov from the switch on.
    await dragMap('#map', A);
    check(!(await ms()).creditOpen, 'Liberty: a drag folds the credit again');
    const usgs = BM.get('usgs-topo');
    k = log.provider.length;
    await choose('usgs-topo');
    await p.waitFor(`${A}.tilesOk > 0`, 15000, 'raster tiles'); await idle(A, 'raster idle');
    s = await ms();
    const got2 = providerSince(k);
    run.usgs = { requests: got2.length, hosts: [...new Set(got2.map(hostOf))] };
    check(got2.length > 0 && got2.every(u => hostOf(u) === 'basemap.nationalmap.gov' && /\/USGSTopo\/MapServer\/tile\/\d+\/\d+\/\d+$/.test(u)),
      'USGS Topo: every request to basemap.nationalmap.gov tiles only (none to OpenFreeMap after the switch)', run.usgs);
    check(s.basemap === 'usgs-topo' && s.land === 'none' && JSON.stringify(s.layers) === JSON.stringify(['background', 'raster-layer'].concat(OWN_LAYERS)),
      'USGS Topo: CVI\'s raster style (background, raster layer) under the page\'s own layers', s.layers);
    px = await p.eval(PIXELS(A, PTS));
    run.usgs.pixels = px;
    check(near(px[0], USGS) && near(px[1], USGS), 'USGS Topo: the raster tiles are drawn', px);
    check(s.attribution && s.attribution.indexOf(usgs.attribution) >= 0 && s.attribution.indexOf('OpenFreeMap') < 0, 'USGS Topo: USGS credit in the attribution (OpenFreeMap\'s gone)', s.attribution);
    check(s.circles === circles0 && Math.abs(s.zoom - cam0[2]) < 1e-9, 'USGS Topo: camera and circles kept', s);
    check(s.creditOpen, 'USGS Topo: the credit is open again on the map', s.creditOpen);
    // Max zoom as CVI's .make_raster_style(): tiles up to it (256-pixel tiles: one level above the map's zoom), and the
    // layer itself ends there, so nothing is asked for beyond it.
    const zOf = u => +/\/tile\/(\d+)\//.exec(u)[1];
    await p.eval(`void ${A}.map.zoomTo(${usgs.maxZoom - 0.1},{animate:false})`);
    await p.waitFor(`${A}.map.getZoom() > ${usgs.maxZoom - 0.2}`, 5000, 'zoom in'); await sleep(300); await idle(A, 'zoom in');
    const kz = log.provider.length;
    await p.eval(`void ${A}.map.zoomTo(17.5,{animate:false})`);
    await p.waitFor(`${A}.map.getZoom() > 17`, 5000, 'deep zoom'); await sleep(300); await idle(A, 'deep zoom');
    const deep = providerSince(k).map(zOf);
    check(Math.max(...deep) === usgs.maxZoom && log.provider.length === kz, 'USGS Topo: tiles up to its max zoom (' + usgs.maxZoom + '), none beyond', [...new Set(deep)]);
    // Past the max zoom the last tiles are stretched, by design (CVI's basemap disappears there).
    const pxDeep = await p.eval(PIXELS(A, [[0.3, 0.3], [0.7, 0.7]]));
    check(pxDeep.every(x => near(x, USGS)), 'USGS Topo: past its max zoom the last tiles are stretched, not blank (deliberate difference)', pxDeep);
    await p.eval(`void CVIWA.map.fitView(${A})`); await idle(A);
    await p.downloadsTo(DL);
    await p.eval(`document.querySelector('#map .map-screenshot').click()`);
    await sleep(800);
    const saved = fs.readdirSync(DL).filter(f => /\.png$/.test(f));
    const shotMsg = await p.eval('CVIWA.state.lastMessage');
    check(saved.length === 1 && /handed to your browser/.test(shotMsg) && (await p.eval(`${A}.lastAttribution`) || '').indexOf(usgs.attribution) >= 0,
      'USGS Topo: the screenshot button saves the picture, with the USGS credit', { saved, shotMsg });
    await p.capture(path.join(OUT, 'screens', 'usgs-topo.png'));

    // 4. Compare: the right map is made on the chosen basemap; both maps draw it.
    await p.eval(`(function(){document.getElementById('period-block').open=true;document.querySelector('input[name=period-mode][value=compare]').click()})()`);
    await p.waitFor(`CVIWA.state.mapHandleB && CVIWA.state.mapHandleB.ready && CVIWA.state.mapHandleB.basemap && CVIWA.state.mapHandleB.tilesOk > 0`, 15000, 'right map basemap');
    await idle('CVIWA.state.mapHandleB', 'right map idle');
    const sB = await p.eval(MAPSTATE('CVIWA.state.mapHandleB'));
    const pxB = await p.eval(PIXELS('CVIWA.state.mapHandleB', [[0.5, 0.5]]));
    check(sB.basemap === 'usgs-topo' && sB.land === 'none' && near(pxB[0], USGS) && sB.attribution.indexOf(usgs.attribution) >= 0,
      'Compare: the right map draws the chosen basemap with its credit', { sB, pxB });
    await p.capture(path.join(OUT, 'screens', 'usgs-topo-compare.png'));
    k = log.provider.length;
    await choose('ofm-liberty');
    await p.waitFor(`${A}.tilesOk > 0 && CVIWA.state.mapHandleB.tilesOk > 0`, 15000, 'both maps on Liberty');
    await idle(A); await idle('CVIWA.state.mapHandleB');
    const both = [await ms(), await p.eval(MAPSTATE('CVIWA.state.mapHandleB'))];
    check(both.every(x => x.basemap === 'ofm-liberty' && x.land === 'none') && providerSince(k).every(u => hostOf(u) === 'tiles.openfreemap.org'),
      'Compare: changing the basemap changes both maps, fetching only from the new provider', both.map(x => x.basemap));
    await p.eval(`document.querySelector('input[name=period-mode][value=single]').click()`); await sleep(400);

    // 5. Back to the offline map: land fill back, own layers only, and no request at all from then on.
    await choose('offline'); await idle(A, 'offline again');
    k = log.provider.length;
    s = await ms();
    await p.eval(`void ${A}.map.jumpTo({center:[-120.5,47.3],zoom:9})`); await idle(A);
    await p.eval(`void CVIWA.map.fitView(${A})`); await idle(A);
    px = await p.eval(PIXELS(A, PTS));
    check(s.basemap === null && s.land === 'visible' && JSON.stringify(s.layers) === JSON.stringify(['background'].concat(OWN_LAYERS)) && near(px[1], BG) && s.circles === circles0,
      'offline again: the page\'s own style, land fill and background as at the start, circles kept', { s, px });
    check(log.provider.length === k, 'offline again: no provider request while panning and zooming', providerSince(k));
    check(await p.eval(`document.getElementById('basemap-note').hidden`), 'offline again: no provider line');
    // Every provider request so far was made by the page itself (none by MapLibre's workers), with redirects refused,
    // no credentials and no referrer; no Referer or Cookie header reached the network.
    {
      const fx = await p.eval('window.__fetches'), prov = log.provider.slice(0, k);
      const href = u => { try { return new URL(u).href; } catch (e) { return u; } };
      const opts = prov.map(r => fx.find(f => href(f.url) === href(r.url)) || null);
      const bad = prov.filter((r, i) => !r.page || r.referer || r.cookie || !opts[i] || opts[i].redirect !== 'error' || opts[i].credentials !== 'omit' || opts[i].referrerPolicy !== 'no-referrer');
      run.requestOptions = { requests: prov.length, workers: prov.filter(r => !r.page).length, bad: bad.length };
      check(prov.length > 30 && bad.length === 0, 'every provider request made by the page with redirect "error", credentials "omit", no referrer; no Referer or Cookie sent',
        { n: prov.length, bad: bad.slice(0, 3), opts: opts.filter((o, i) => bad.indexOf(prov[i]) >= 0).slice(0, 3) });
    }

    // 5b. Every basemap of the list once: only its own hosts; its tiles drawn (its own color) under the
    // page's layers, land fill hidden; its credit open on the map and in the screenshot; the provider line; Auto label
    // and boundary colors as CVI's rule says for it.
    const rgb = h => 'rgb(' + [1, 3, 5].map(i => parseInt(h.substr(i, 2), 16)).join(', ') + ')';
    // A color at an opacity over another (the test's own, not the page's blend).
    const mix = (h, t, u) => '#' + [1, 3, 5].map(i => Math.round(parseInt(h.substr(i, 2), 16) * t + parseInt(u.substr(i, 2), 16) * (1 - t)).toString(16).padStart(2, '0')).join('');
    {
      const cols = BM.LIST.map(colorFor);
      check(cols.every((c, i) => cols.every((d, j) => i === j || Math.abs(c[0] - d[0]) + Math.abs(c[1] - d[1]) + Math.abs(c[2] - d[2]) > 12)),
        'test set-up: one distinct color per basemap', cols);
      const per = [];
      for (const bm of BM.LIST) {
        const k = log.provider.length;
        await choose(bm.id);
        try { await p.waitFor(`${A}.tilesOk > 0`, 15000, bm.id + ' tiles'); await idle(A, bm.id + ' idle'); }
        catch (e) { per.push({ id: bm.id, error: e.message }); continue; }
        const st = await ms(), px = await p.eval(PIXELS(A, [PTS[1]])), sent = providerSince(k);
        const look = await p.eval(`(function(){var l=document.querySelector('#map .county-label'),cs=getComputedStyle(l),m=${A}.map;
          return {label:cs.color,shadow:cs.textShadow,line:m.getPaintProperty('county-lines','line-color'),note:document.getElementById('basemap-note').textContent,
          msg:!document.getElementById('basemap-status').hidden}})()`);
        const shot = await p.eval(`CVIWA.map.screenshot(${A}).then(function(){return ${A}.lastAttribution})`);
        const c = BM.contrast('auto', 'auto', bm.dark), problems = [];
        if (!sent.length || !sent.every(u => bm.hosts.indexOf(hostOf(u)) >= 0)) problems.push('hosts');
        if (!near(px[0], colorFor(bm))) problems.push('pixels ' + px[0]);
        if (st.land !== 'none' || st.basemapFailed || look.msg) problems.push('land or failure');
        if (JSON.stringify(st.layers.slice(-5)) !== JSON.stringify(OWN_LAYERS)) problems.push('layers');
        if (!st.attribution || st.attribution.indexOf(bm.attribution) < 0 || !st.creditOpen) problems.push('credit ' + st.attribution);
        if (!shot || shot.indexOf(bm.attribution) < 0) problems.push('screenshot credit');
        if (look.note !== BM.providerLine(bm)) problems.push('provider line');
        if (look.label !== rgb(c.label) || look.shadow.indexOf(rgb(c.halo)) < 0 || look.line !== c.line) problems.push('contrast ' + JSON.stringify(look));
        if (st.circles !== circles0) problems.push('circles');
        // S1.1: the legend swatches over white on a light basemap, at full strength on a dark one, as drawn.
        const sw = await p.eval(`(function(){var L=CVIWA.state.legend;return {sw:L.swatches.map(function(w){return [w.color,w.shown,w.land]}),
          bg:[].map.call(document.querySelectorAll('#legend-panel .lg-dot'),function(d){return getComputedStyle(d).backgroundColor}),op:Number(CVIWA.state.opacity)}})()`);
        const want = sw.sw.map(([col]) => bm.dark ? col.toLowerCase() : mix(col, sw.op, '#ffffff'));
        if (sw.sw.length !== 2 || !sw.sw.every(([, shown, land], i) => shown === want[i] && land === (bm.dark ? null : '#ffffff') && sw.bg[i] === rgb(want[i]))) problems.push('legend swatches ' + JSON.stringify(sw));
        per.push({ id: bm.id, requests: sent.length, hosts: [...new Set(sent.map(hostOf))], problems });
        await p.capture(path.join(OUT, 'screens', 'basemap-' + bm.id + '.png'));
      }
      run.basemaps = per;
      check(per.length === BM.LIST.length && (BM.LIST.length === 23 || SB.WSDA.release.publicCopy),
        'every basemap offered tried (23; fewer only in a public copy)', [per.length, BM.LIST.length]);
      per.forEach(r => check(!r.error && r.problems.length === 0, r.id + ': own hosts only, its tiles drawn, credit on the map and in the screenshot, provider line, Auto contrast, legend swatches (S1.1)', r));
      await choose('offline'); await idle(A);
    }

    // 5c. WSDOT outside its zoom range (zoom < 7 in tiles): nothing asked for, so no failure; its tiles come when zoomed in.
    {
      await p.eval(`void ${A}.map.jumpTo({center:[-120.5,47.3],zoom:3.5})`); await idle(A);
      const k = log.provider.length;
      await choose('wsdot'); await sleep(1200); await idle(A, 'wsdot zoomed out');
      const st = await ms();
      check(providerSince(k).length === 0 && !st.basemapFailed && !(await msgShown()), 'WSDOT zoomed out past its range: no request, no failure message', { st, sent: providerSince(k) });
      await p.eval(`void CVIWA.map.fitView(${A})`);
      await p.waitFor(`${A}.tilesOk > 0`, 15000, 'wsdot tiles after zooming in'); await idle(A);
      const z = providerSince(k).map(u => +/\/tile\/(\d+)\//.exec(u)[1]);
      check(z.length > 0 && Math.min(...z) >= 7 && !(await ms()).basemapFailed, 'WSDOT: tiles once zoomed in, none below zoom 7', [...new Set(z)]);
      await choose('offline'); await idle(A);
    }

    // 5d. Label style and Boundary style (CVI's rule): choices, all nine pairs on a dark and a light basemap, applied live;
    // kept across basemaps (Auto follows each); the screenshot's labels; Compare; after a failure Auto gives the county
    // map's colors; Reset All back to Auto.
    {
      const look = h => p.eval(`(function(){var s=${h},l=s.map.getContainer().querySelector('.county-label'),cs=getComputedStyle(l);
        return {label:cs.color,shadow:cs.textShadow,line:s.map.getPaintProperty('county-lines','line-color')}})()`);
      const want = (ls, bs, dark) => { const c = BM.contrast(ls, bs, dark); return { label: rgb(c.label), halo: rgb(c.halo), line: c.line }; };
      const ok = (lk, w) => lk.label === w.label && lk.shadow.indexOf(w.halo) >= 0 && lk.line === w.line;
      const setSel = async (id, v) => { await p.eval(`(function(){var s=document.getElementById(${JSON.stringify(id)});s.value=${JSON.stringify(v)};s.dispatchEvent(new Event('change'))})()`); await sleep(60); };
      const sels = () => p.eval(`[document.getElementById('s-label-style').value,document.getElementById('s-boundary-style').value]`);
      const ui = await p.eval(`[].map.call(document.querySelectorAll('#s-label-style option'),function(o){return [o.value,o.text]}).concat([].map.call(document.querySelectorAll('#s-boundary-style option'),function(o){return [o.value,o.text]}))`);
      check(JSON.stringify(ui) === JSON.stringify(BM.LABEL_STYLES.concat(BM.BOUNDARY_STYLES)) && JSON.stringify(await sels()) === '["auto","auto"]',
        'Label style and Boundary style: CVI\'s choices, Auto on load', ui);
      let lk = await look(A);
      check(ok(lk, want('auto', 'auto', false)), 'offline map, Auto: the page\'s colors before S3 (#333333 on white, lines #8a8a8a)', lk);
      const combos = [];
      // The sample dark, light and imagery basemaps: CARTO Dark, Esri World Topo and Esri Imagery, or in a public copy
      // (without CARTO and Esri) OpenFreeMap Dark, USGS Topo and USGS Imagery.
      const DARK = BM.get('carto-dark') ? 'carto-dark' : 'ofm-dark';
      const LIGHT = BM.get('esri-topo') ? 'esri-topo' : 'usgs-topo';
      const IMAGERY = BM.get('esri-imagery') ? 'esri-imagery' : 'usgs-imagery';
      for (const id of [DARK, LIGHT]) {
        await choose(id); await p.waitFor(`${A}.tilesOk > 0`, 15000, id); await idle(A);
        for (const [ls] of BM.LABEL_STYLES) for (const [bs] of BM.BOUNDARY_STYLES) {
          await setSel('s-label-style', ls); await setSel('s-boundary-style', bs);
          const l = await look(A); combos.push({ id, ls, bs, ok: ok(l, want(ls, bs, BM.get(id).dark)), l });
        }
      }
      check(combos.length === 18 && combos.every(c => c.ok), 'all nine label x boundary styles on a dark (' + BM.get(DARK).name + ') and a light (' + BM.get(LIGHT).name + ') basemap: CVI\'s colors, live',
        combos.filter(c => !c.ok));
      // The screenshot draws the labels in the chosen colors (light text on a dark halo, then dark text on white).
      const labelInk = `CVIWA.map.screenshot(${A}).then(function(b){return createImageBitmap(b)}).then(function(i){var c=document.createElement('canvas');c.width=i.width;c.height=i.height;
        var g=c.getContext('2d');g.drawImage(i,0,0);var d=g.getImageData(0,0,i.width,i.height-60).data,n={halo1a:0,white:0,text0:0},q=function(j,r,gg,bb){return Math.abs(d[j]-r)<=6&&Math.abs(d[j+1]-gg)<=6&&Math.abs(d[j+2]-bb)<=6};
        for(var j=0;j<d.length;j+=4){if(q(j,26,26,26))n.halo1a++;if(q(j,255,255,255))n.white++;if(q(j,240,240,240))n.text0++}return n})`;
      await setSel('s-label-style', 'light'); await setSel('s-boundary-style', 'auto');
      const inkLight = await p.eval(labelInk);
      await setSel('s-label-style', 'dark');
      const inkDark = await p.eval(labelInk);
      check(inkLight.halo1a > 300 && inkDark.halo1a < inkLight.halo1a / 5 && inkDark.white > inkLight.white + 1000   // circles have white outlines too
        && inkLight.text0 > inkDark.text0 + 500,   // (#f0f0f0 also appears where white outlines blend into the tiles)
        'screenshot: county labels drawn in the chosen label style (light text #f0f0f0 on #1a1a1a, dark text on white)', { inkLight, inkDark });
      // Kept across basemaps: a fixed choice stays; Auto follows the basemap.
      await setSel('s-label-style', 'dark'); await setSel('s-boundary-style', 'light');
      await choose('usgs-imagery'); await p.waitFor(`${A}.tilesOk > 0`, 15000); await idle(A);
      const kept = await look(A);
      await setSel('s-label-style', 'auto'); await setSel('s-boundary-style', 'auto');
      const autoDark = await look(A);
      await choose('ofm-positron'); await p.waitFor(`${A}.tilesOk > 0`, 15000); await idle(A);
      const autoLight = await look(A);
      check(ok(kept, want('dark', 'light', true)) && ok(autoDark, want('auto', 'auto', true)) && ok(autoLight, want('auto', 'auto', false)),
        'styles kept across basemaps; Auto follows each basemap (USGS Imagery dark, OpenFreeMap Positron light)', { kept, autoDark, autoLight });
      // Compare: the right map takes the same colors, and follows a change.
      await p.eval(`document.querySelector('input[name=period-mode][value=compare]').click()`);
      await choose(DARK);
      await p.waitFor(`${A}.tilesOk > 0 && CVIWA.state.mapHandleB.tilesOk > 0`, 15000, 'compare ' + DARK); await idle(A); await idle('CVIWA.state.mapHandleB');
      const cmpAuto = [await look(A), await look('CVIWA.state.mapHandleB')];
      await setSel('s-label-style', 'dark'); await setSel('s-boundary-style', 'dark');
      const cmpDark = [await look(A), await look('CVIWA.state.mapHandleB')];
      check(cmpAuto.every(x => ok(x, want('auto', 'auto', true))) && cmpDark.every(x => ok(x, want('dark', 'dark', true))),
        'Compare: both maps in the same label and boundary colors, live', { cmpAuto, cmpDark });
      await setSel('s-label-style', 'auto'); await setSel('s-boundary-style', 'auto');
      await p.eval(`document.querySelector('input[name=period-mode][value=single]').click()`); await sleep(400);
      await choose('offline'); await idle(A);
      // After a failure the county map is on screen: Auto gives its colors (the dark basemap is not shown).
      const r = await expectFailure(DARK, 'missing', 'dark basemap all 404', () => look(A));
      check(r.st.basemapFailed && r.msg.includes(BM.get(DARK).provider), 'dark basemap that cannot load: message (' +
        BM.get(DARK).provider + ')', { msg: r.msg });
      // (expectFailure returns to the offline map before reading extra; read the colors while failed instead)
      mode = 'missing'; await choose(DARK); await p.waitFor(`!document.getElementById('basemap-status').hidden`, 15000, 'failure again'); await idle(A);
      const failedLook = await look(A); mode = 'normal';
      check(ok(failedLook, want('auto', 'auto', false)), 'dark basemap failed: Auto label and boundary colors are the county map\'s (#333333, #8a8a8a)', failedLook);
      await choose('offline'); await idle(A);
      // Reset All: both back to Auto.
      await choose(IMAGERY); await p.waitFor(`${A}.tilesOk > 0`, 15000); await idle(A);
      await setSel('s-label-style', 'light'); await setSel('s-boundary-style', 'dark');
      await p.eval(`document.getElementById('reset-all').click()`); await sleep(400); await idle(A);
      lk = await look(A);
      check(JSON.stringify(await sels()) === '["auto","auto"]' && ok(lk, want('auto', 'auto', false)) && (await ms()).basemap === null,
        'Reset All: label and boundary style back to Auto (as CVI), offline map colors', { lk, sels: await sels() });
    }

    // 5e. The hidden right map (Compare off): it neither follows the left map nor takes a new basemap (no requests for
    // it); it catches up when Compare is turned on. Then a failure seen on both Compare maps.
    {
      const B_ = 'CVIWA.state.mapHandleB';
      await choose('usgs-topo'); await p.waitFor(`${A}.tilesOk > 0`, 15000); await idle(A);
      const b0 = await p.eval(`(function(){var s=${B_};return {basemap:s.basemap&&s.basemap.id,tries:s.tileTries,center:s.map.getCenter().toArray()}})()`);
      for (let i = 0; i < 3; i++) { await p.eval(`void ${A}.map.jumpTo({center:[${-121.5 + i * 0.6},47.4],zoom:${7 + i}})`); await idle(A); }
      await choose('ofm-liberty'); await p.waitFor(`${A}.tilesOk > 0`, 15000); await idle(A);
      const b1 = await p.eval(`(function(){var s=${B_};return {basemap:s.basemap&&s.basemap.id,tries:s.tileTries,center:s.map.getCenter().toArray()}})()`);
      check(b1.tries === b0.tries && b1.basemap === b0.basemap && JSON.stringify(b1.center) === JSON.stringify(b0.center) && run.liberty.styleRequests === 1,
        'hidden right map: does not follow the camera, takes no new basemap, asks for nothing', { b0, b1 });
      await p.eval(`void CVIWA.map.fitView(${A})`); await idle(A);
      await p.eval(`document.querySelector('input[name=period-mode][value=compare]').click()`);
      await p.waitFor(`${B_}.basemap && ${B_}.basemap.id === 'ofm-liberty' && ${B_}.tilesOk > 0`, 15000, 'right map catches up'); await idle(B_);
      const sB = await p.eval(MAPSTATE(B_)), sA = await ms();
      check(sB.basemap === 'ofm-liberty' && Math.abs(sB.zoom - sA.zoom) < 1e-6 && Math.abs(sB.center[0] - sA.center[0]) < 1e-6,
        'Compare on again: the right map takes the chosen basemap and the left map\'s camera', { sA: [sA.center, sA.zoom], sB: [sB.center, sB.zoom] });
      mode = 'missing'; await choose('usgs-topo');
      await p.waitFor(`${A}.basemapFailed && ${B_}.basemapFailed`, 15000, 'both maps failed'); await idle(A); await idle(B_);
      const f = [await ms(), await p.eval(MAPSTATE(B_))];
      check(f.every(x => x.basemapFailed && x.land === 'visible') && await msgShown(), 'Compare: a basemap that cannot load: both maps show the county land, one message', f.map(x => [x.basemapFailed, x.land]));
      mode = 'normal'; await choose('offline'); await idle(A);
      await p.eval(`document.querySelector('input[name=period-mode][value=single]').click()`); await sleep(400);
    }

    // 5f. Slow tiles: counted as not loading after the watch time, then shown after all when they arrive.
    {
      await p.eval('CVIWA.map.config.watchMs = 1500');
      mode = 'slowtiles';
      await choose('usgs-topo');
      await p.waitFor(`!document.getElementById('basemap-status').hidden`, 15000, 'slow tiles: message');
      const during = await ms();
      await p.waitFor(`${A}.tilesOk > 0`, 15000, 'slow tiles arrive'); await idle(A);
      const after = await ms(), px = await p.eval(PIXELS(A, PTS));
      check(during.basemapFailed && !after.basemapFailed && after.land === 'none' && !(await msgShown()) && near(px[0], USGS),
        'slow tiles: the message after the watch time goes once tiles arrive; land fill hidden again, tiles shown', { during: during.basemapFailed, after, px });
      mode = 'normal'; await choose('offline'); await idle(A);
      // 5g. A background tab (no animation frames; simulated): a vector style handed over there is not failed by the
      // watch; it loads when the tab is visible again.
      await p.eval('CVIWA.map.config.watchMs = 4000');   // longer than the slow style (2.5 s), shorter than the hidden time
      mode = 'slowstyle';
      await choose('ofm-liberty');
      const look = () => p.eval(`(function(){var s=${A};return {hidden:document.hidden,switching:s.switching,failed:s.basemapFailed,msg:!document.getElementById('basemap-status').hidden}})()`);
      const [bg0, bg] = await p.background(7000, look);
      const bgMsg = bg.msg;
      mode = 'normal';
      try { await p.waitFor(`${A}.tilesOk > 0`, 15000, 'background tab: tiles after return'); }
      catch (e) { throw new Error(e.message + ' ' + JSON.stringify({ bg0, bg, now: await look(), st: await ms(), vis: await p.eval('document.visibilityState') })); }
      await idle(A);
      const fg = await ms();
      check(bg0.hidden && bg.hidden && !bg.failed && !bgMsg && !fg.basemapFailed && fg.basemap === 'ofm-liberty' && fg.land === 'none',
        'background tab: a style waiting for animation frames is not failed by the watch; it shows when the tab is back', { bg0, bg, fg });
      await p.eval('CVIWA.map.config.watchMs = 20000');
      await choose('offline'); await idle(A);
    }

    // 5g2. While a dark vector style is read the county map is on screen: Auto keeps its colors until the dark basemap
    // shows.
    {
      mode = 'slowstyle';
      await choose('ofm-dark'); await sleep(600);
      const reading = await p.eval(`(function(){var cs=getComputedStyle(document.querySelector('#map .county-label'));return {label:cs.color,shown:${A}.shown&&${A}.shown.id}})()`);
      mode = 'normal';
      await p.waitFor(`${A}.tilesOk > 0`, 15000, 'dark style arrives'); await idle(A);
      const shown = await p.eval(`getComputedStyle(document.querySelector('#map .county-label')).color`);
      check(reading.shown === null && reading.label === 'rgb(51, 51, 51)' && shown === 'rgb(240, 240, 240)',
        'dark style being read: labels keep the county map\'s color; light once the dark basemap shows', { reading, shown });
      await choose('offline'); await idle(A);
    }

    // 5h. WSDOT viewed far outside its coverage (Boise): nothing asked for, no failure message.
    {
      await p.eval(`void ${A}.map.jumpTo({center:[-116.2,43.6],zoom:9})`); await idle(A);
      const k = log.provider.length;
      await choose('wsdot'); await sleep(1200); await idle(A);
      const st = await ms();
      check(providerSince(k).length === 0 && !st.basemapFailed && !(await msgShown()), 'WSDOT outside its coverage: no request, no failure message', { st, sent: providerSince(k) });
      await choose('offline'); await p.eval(`void CVIWA.map.fitView(${A})`); await idle(A);
    }

    // 6. The page's own gate: a style that also asks for other hosts gets nothing from them, whether the CSP would
    // allow that host (another basemap's) or not.
    mode = 'rogue'; k = log.provider.length;
    await choose('ofm-liberty');
    await sleep(2500);
    s = await ms();
    const rogueSent = providerSince(k).filter(u => hostOf(u) !== 'tiles.openfreemap.org');
    check(rogueSent.length === 0, 'gate: nothing sent to hosts other than the chosen basemap\'s', rogueSent);
    check(s.blocked.some(u => hostOf(u) === 'basemap.nationalmap.gov') && s.blocked.some(u => hostOf(u) === 'rogue.example.invalid') && !s.failed,
      'gate: the requests were refused by the page and recorded; the map keeps working', { blocked: s.blocked.slice(0, 4), failed: s.failed });
    check(!s.basemapFailed && s.land === 'none' && !(await msgShown()) && s.tilesOk > 0,
      'gate: refused requests do not mark the basemap failed (no message, no land fill over its tiles)', s);
    mode = 'normal';
    await choose('offline'); await idle(A);
    check((await ms()).blocked.length === 0, 'gate: the refused list starts empty for each choice', (await ms()).blocked);

    // 6b. A sprite that cannot be read does not stop a basemap that draws.
    mode = 'nosprite';
    await choose('ofm-liberty'); await p.waitFor(`${A}.tilesOk > 0`, 15000, 'nosprite tiles'); await idle(A, 'nosprite idle');
    s = await ms();
    check(!s.basemapFailed && s.land === 'none' && !(await msgShown()), 'missing sprite: the basemap stays, no message', s);
    mode = 'normal';
    await choose('offline'); await idle(A);

    // 6c. Redirects are not followed: a 302 from the chosen provider to another host the CSP allows.
    {
      let r = await expectFailure('ofm-liberty', 'redirect-style', 'style redirect');
      check(r.sent.length > 0 && r.sent.every(u => hostOf(u) === 'tiles.openfreemap.org') && r.st.basemapFailed && r.st.land === 'visible' && /OpenFreeMap/.test(r.msg),
        'redirected style: not followed (nothing asked of the other host); failure message, county map shown', { sent: r.sent, st: r.st, msg: r.msg });
      // Every vector tile redirected (only the raster relief answers): not followed, and the basemap counts as not
      // loading, since the relief alone is not the basemap.
      r = await expectFailure('ofm-liberty', 'redirect-tile', 'tile redirect');
      check(r.sent.some(u => /\.pbf$/.test(u) && !/fonts/.test(u)) && r.sent.every(u => hostOf(u) === 'tiles.openfreemap.org') && r.st.blocked.length === 0
        && r.st.land === 'visible' && /OpenFreeMap/.test(r.msg),
        'redirected tiles: not followed (nothing asked of the other host); relief only: failure message, county map shown', { other: r.sent.filter(u => hostOf(u) !== 'tiles.openfreemap.org'), st: r.st });
      // The same with plain 404 vector tiles and the relief answering.
      r = await expectFailure('ofm-liberty', 'reliefonly', 'relief only');
      check(r.st.basemapFailed && r.st.land === 'visible' && near(r.px[0], LAND) && /OpenFreeMap/.test(r.msg), 'vector tiles missing, relief loading: failure message, land fill back', { st: r.st, px: r.px });
      // A style whose tile index (TileJSON) is on a host the gate refuses, with no relief: failure message.
      r = await expectFailure('ofm-liberty', 'tilejson-elsewhere', 'tile index refused');
      check(r.st.basemapFailed && r.st.land === 'visible' && /OpenFreeMap/.test(r.msg) && r.sent.every(u => hostOf(u) === 'tiles.openfreemap.org'),
        'tile index on another host: refused, not sent; failure message, land fill back', { st: r.st, sent: r.sent });
    }

    // 6d. Tiles that are all missing (404; MapLibre skips 404 tiles without an error), vector and raster.
    {
      let r = await expectFailure('ofm-liberty', 'missing', 'vector all 404');
      check(r.st.basemapFailed && !r.st.failed && r.st.land === 'visible' && near(r.px[0], LAND) && /OpenFreeMap/.test(r.msg) && r.st.circles === circles0,
        'all tiles missing (vector): failure message; the county land fill comes back over the provider\'s background', { st: r.st, px: r.px, msg: r.msg });
      r = await expectFailure('usgs-topo', 'missing', 'raster all 404');
      check(r.st.basemapFailed && r.st.land === 'visible' && near(r.px[0], LAND) && /USGS/.test(r.msg),
        'all tiles missing (raster): failure message, land fill back', { st: r.st, px: r.px, msg: r.msg });
      // 6e. A raster provider that is down (every tile fails as if offline).
      r = await expectFailure('usgs-topo', 'down', 'raster down');
      check(r.st.basemapFailed && r.st.land === 'visible' && near(r.px[0], LAND) && /USGS/.test(r.msg), 'raster provider down: failure message, land fill back', { st: r.st, px: r.px, msg: r.msg });
      // 6f. A provider that never answers: after the watch time (shortened here) the failure message, raster and vector.
      await p.eval('CVIWA.map.config.watchMs = 1500');
      r = await expectFailure('usgs-topo', 'hang', 'raster no answer');
      check(r.st.basemapFailed && r.st.land === 'visible' && /USGS/.test(r.msg), 'raster provider that never answers: failure message after the watch time', { st: r.st, msg: r.msg });
      r = await expectFailure('ofm-liberty', 'hang', 'vector no answer');
      check(r.st.basemapFailed && r.st.land === 'visible' && /OpenFreeMap/.test(r.msg) && r.st.layers.length === 1 + OWN_LAYERS.length,
        'vector style that never arrives: failure message after the watch time, offline style shown', { st: r.st, msg: r.msg });
      await p.eval('CVIWA.map.config.watchMs = 20000');
    }

    // 6g. Rapid switching ends on the last choice with nothing asked afterwards; a slow style lets the previous
    // basemap go at once and never replaces a newer choice.
    {
      for (const id of ['ofm-liberty', 'usgs-topo', 'ofm-liberty', 'usgs-topo', 'offline']) {
        await p.eval(`(function(){var s=document.getElementById('s-basemap');s.value=${JSON.stringify(id)};s.dispatchEvent(new Event('change'))})()`); await sleep(40);
      }
      await sleep(1500); await idle(A);
      const k3 = log.provider.length;
      await p.eval(`void ${A}.map.jumpTo({center:[-121,47],zoom:8})`); await idle(A); await p.eval(`void CVIWA.map.fitView(${A})`); await idle(A);
      s = await ms();
      check(s.basemap === null && s.land === 'visible' && !s.basemapFailed && log.provider.length === k3 && !(await msgShown()),
        'rapid switching: ends on the offline map, no request afterwards, no message', { s, after: providerSince(k3) });
      await choose('usgs-topo'); await p.waitFor(`${A}.tilesOk > 0`, 15000, 'usgs before slow'); await idle(A);
      mode = 'slowstyle'; const k4 = log.provider.length;
      await choose('ofm-liberty');
      for (let i = 0; i < 4; i++) { await p.eval(`void ${A}.map.jumpTo({center:[${-122 + i * 0.7},47.2],zoom:${7 + i * 0.5}})`); await sleep(200); }
      const during = providerSince(k4);
      check(during.every(u => hostOf(u) === 'tiles.openfreemap.org') && (await ms()).land === 'visible',
        'slow style: no request to the previous basemap while it is read; the county map meanwhile', during.filter(u => hostOf(u) !== 'tiles.openfreemap.org'));
      await p.waitFor(`${A}.shown && ${A}.shown.id === 'ofm-liberty' && ${A}.tilesOk > 0`, 15000, 'slow style arrives'); await idle(A);
      await choose('offline'); await idle(A);
      const k5 = log.provider.length;
      await choose('ofm-liberty'); await sleep(300); mode = 'normal'; await choose('usgs-topo');
      await sleep(3200); await idle(A);
      s = await ms();
      const after = providerSince(k5).filter(u => hostOf(u) === 'tiles.openfreemap.org' && !/\/styles\//.test(u));
      check(s.basemap === 'usgs-topo' && s.layers.indexOf('raster-layer') >= 0 && after.length === 0 && !s.basemapFailed,
        'slow style then another choice: the late style is dropped (its read aborted), only the newer basemap is shown', { s, after });
      await p.eval(`void CVIWA.map.fitView(${A})`);
      await choose('offline'); await idle(A);
    }

    // 7. A basemap that cannot load (every request fails as if offline): a message naming the provider, the county
    // shapes back (the offline style, as the style itself never arrived), "Back to offline map".
    mode = 'down';
    await choose('ofm-liberty');
    await p.waitFor(`!document.getElementById('basemap-status').hidden`, 15000, 'failure message');
    await idle(A, 'fallback idle');
    s = await ms();
    const msg = await p.eval(`document.getElementById('basemap-msg').textContent`);
    px = await p.eval(PIXELS(A, PTS));
    check(/OpenFreeMap/.test(msg) && s.basemapFailed && !s.failed && s.land === 'visible' && near(px[1], BG) && s.circles === circles0,
      'failure: message names the provider; the county map and circles are shown', { msg, s, px });
    const lands = async () => (await p.eval(`JSON.parse(JSON.stringify(CVIWA.state.legend.swatches))`)).map(w => w.land + ' ' + (w.shown === mix(w.color, 0.6, w.land)));
    let lw = await lands();
    check(lw.length === 2 && lw.every(x => x === '#ececec true'), 'failure: the legend swatches over the county land again (S1.1)', lw);
    await p.capture(path.join(OUT, 'screens', 'failure.png'));
    mode = 'normal';
    await p.eval(`document.getElementById('basemap-offline').click()`); await idle(A);
    s = await ms();
    check(await p.eval(`document.getElementById('s-basemap').value==='offline'&&document.getElementById('basemap-status').hidden`) && s.basemap === null && !s.basemapFailed,
      '"Back to offline map": picker on the offline map, message gone');

    // 8. Reset All: back to the offline map (a deliberate difference: CVI resets to CARTO Light).
    await choose('usgs-topo'); await p.waitFor(`${A}.tilesOk > 0`, 15000, 'raster again'); await idle(A);
    lw = await lands();
    check(lw.length === 2 && lw.every(x => x === '#ffffff true'), 'on a tile basemap the legend swatches are the circle color over white (S1.1)', lw);
    await p.eval(`document.getElementById('reset-all').click()`); await sleep(400); await idle(A);
    lw = await lands();
    check(lw.length === 2 && lw.every(x => x === '#ececec true'), 'after Reset All (offline map) the swatches over the county land (S1.1)', lw);
    s = await ms();
    check(s.basemap === null && await p.eval(`document.getElementById('s-basemap').value==='offline'`) && s.land === 'visible', 'Reset All: back to the offline county map', s);

    // 9. A fresh page: the right map made while the label and boundary styles are not Auto takes them at once.
    await p.goto(PAGE);
    await p.waitFor(`window.CVIWA && CVIWA.state && ${A}.ready`, 20000, 'map ready again');
    await p.setFiles('#file-input', [FIX('cvi_master_s2.csv')]);
    await p.waitFor(`!CVIWA.state.loading && CVIWA.state.data.length > 0`, 15000, 'data loaded again');
    await p.eval(`(function(){[['s-label-style','light'],['s-boundary-style','dark']].forEach(function(x){var s=document.getElementById(x[0]);s.value=x[1];s.dispatchEvent(new Event('change'))})})()`);
    await p.eval(`(function(){document.getElementById('period-block').open=true;document.querySelector('input[name=period-mode][value=compare]').click()})()`);
    await p.waitFor(`CVIWA.state.mapHandleB && CVIWA.state.mapHandleB.ready`, 15000, 'right map');
    {
      const lkB = await p.eval(`(function(){var s=CVIWA.state.mapHandleB,cs=getComputedStyle(s.map.getContainer().querySelector('.county-label'));
        return {label:cs.color,line:s.map.getPaintProperty('county-lines','line-color')}})()`);
      check(lkB.label === 'rgb(240, 240, 240)' && lkB.line === '#4a4a4a', 'Compare: a right map made after Light text / Dark lines were chosen shows them', lkB);
    }

    check(!log.exceptions.length, 'no uncaught page errors', log.exceptions);
    run.providerRequests = log.provider.length;
  } catch (e) {
    check(false, 'run aborted', String(e && e.stack || e));
  } finally {
    await b.close();
  }
  run.finished = new Date().toISOString(); run.pass = pass; run.fail = fail; run.failures = failures;
  fs.writeFileSync(path.join(OUT, 'browser_run.json'), JSON.stringify(run, null, 1));
  console.log('S3 browser [' + PAGE_LABEL + ']: ' + pass + '/' + (pass + fail) + ' passed' + (fail ? '\n  ' + failures.join('\n  ') : ''));
  process.exitCode = fail ? 1 : 0;
})();
