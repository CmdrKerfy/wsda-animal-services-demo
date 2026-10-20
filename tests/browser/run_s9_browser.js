#!/usr/bin/env node
'use strict';
// S9 browser suite: the branded map PNGs drawn by the CVI page (site/cvi/index.html) in installed Chrome, through
// the DevTools protocol, offline, foreground only (Chrome does not start from a background job). No packages.
//
// Parts (all by default; name some to run only those, for example: node tests/browser/run_s9_browser.js png):
//   png     the WA State page drawn by the page's own code from a loaded master: PNG bytes, 2200 x 1700 at 200 dpi
//           and 3300 x 2550 at 300 dpi with the resolution recorded, the header's teal, the logo's colors, the
//           land and the circles in the picture, the same bytes when drawn twice, within the time budget
//   export  the real controls: Preview Map on each view (the dialog's PNG), Export with "Branded map (.png)" (the
//           PNG in the ZIP after the charts, CVI's file name, the same bytes as the preview, 200 dpi), PNG resolution
//           High (the map at 3300 x 2550 and every chart at twice its Standard size, 300 dpi recorded),
//           export_params.json's PNG choices, CVI's message when nothing matches
//   additions what the screen adds since CVI, set through the page's own controls, each through Preview Map: the
//           spotlight, the movement view, neighboring regions (with British Columbia's statement), Compare (two
//           PNGs, "_left" and "_right"), Browse (the frame on screen), a state picked in a chart on National Flow
//           and a county picked on County Focus (the others faded, named in the "Highlighted:" line); saves the
//           pictures side by side in one picture (additions.png)
//   backgrounds the tile backgrounds with no network: the suite answers every request to server.arcgisonline.com
//           itself (DevTools Fetch) with a synthetic picture (tests/synthetic/make_s9_tiles.js), or refuses it:
//           the export image asked in Web Mercator at the map box's size (twice with High quality), the picture
//           masked to Washington or the focus counties, CVI's themes and 85% opacity, the credit, the tiles when the
//           export image fails (CVI's zoom, +2 with High), Default with a notice when nothing loads, National
//           Flow offering Default only; the pictures saved side by side (backgrounds.png)
//   names   County Focus with the synthetic facility layers (tests/synthetic/make_s9_facilities.js) handed to the
//           page: the markers, the legend's FACILITY LOCATIONS, "Name markers in PNG" (shown on County Focus only,
//           All and Clear), the names placed apart, export_params.json's overlay_labels_on_png; the picture saved
//           (names.png)
//   facilities the Infrastructure dashboard (site/infrastructure/index.html) with the statewide synthetic facility
//           layers and the Full tier's master loaded through its own file picker: Preview in each output style and
//           coverage view (the Density fallback notice, CVI's message without layers), the PNG sizes and dpi
//           (Branded 2200 x 1700 and 3300 x 2550, Report 1300 x 660 and 1950 x 990), the tiles and Density fill in the
//           picture, Export (one ZIP: the folder, CVI_Facilities_<date>.png with the preview's bytes,
//           export_params.json), name markers, the custom title, CVI activity, a tile background answered by the
//           suite and a refused one (the notice), the time budget; CVI's PNG saved beside the page's
//           (facilities_*.png)
//   gif     the time-series GIF on National Flow through the real controls (the Full tier): "Time-series GIF (.gif)"
//           and "GIF frame interval" offered on National Flow only; Export by quarter and by year (the ZIP's GIF under
//           CVI's name, export_params.json's frame interval); the file decoded by Chrome's own decoder (ImageDecoder:
//           frame count, 1650 x 1275, 0.8 s with the last 2.4 s, endless loop); the first and last frames compared
//           pixel by pixel with the same page drawn by the page's PNG step; "GIF frame i of n: label" for each frame;
//           the page answering during the export; Cancel (no download, "Export canceled; nothing was saved.");
//           a 12-frame GIF within 30 seconds
//   viewgif the WA State and County Focus GIF through the real controls (the Full tier): nothing marked hidden shows
//           on the landing page, the CVI page's three views or the Infrastructure dashboard, County Focus's notice
//           hidden by Reset All; the box grayed with its
//           reason under the movement lines and "Hide CVI circles", free again after; Export by quarter on each view
//           (the ZIP's GIF under its name, export_params.json's interval, "Preparing the GIF frames…" then "GIF frame
//           i of n: label"); the file decoded by Chrome (frames, size, delays, loop, the first and last frames against
//           the page's PNG step); one legend, the strip and names held still in the frames' models; a tile background
//           drawn as Default with the notice; Streets on County Focus; 12 frames of each view within 30 seconds
//
// Usage (repository root, after node tests/node/run_f1_unit_tests.js and Rscript tests/oracle/s9_branded_oracle.R):
//   node tests/browser/run_s9_browser.js [part ...]
//   Hosted mode: node tests/browser/serve_case_strict.js, then
//   S9_PAGE_URL=http://127.0.0.1:8765/cvi/index.html node tests/browser/run_s9_browser.js
// Writes local-test-artifacts/s9/browser/run.json (results).
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..', '..');
const { syntheticPng, COLORS: TILE_COLORS } = require('../synthetic/make_s9_tiles.js');
const OUT = path.join(ROOT, 'local-test-artifacts', 's9', 'browser');
const ORACLE = path.join(ROOT, 'local-test-artifacts', 's9');
const PAGE = process.env.S9_PAGE_URL || pathToFileURL(path.join(ROOT, 'site', 'cvi', 'index.html')).href;
const CHROME = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ALL_PARTS = ['png', 'export', 'additions', 'backgrounds', 'names', 'facilities', 'gif', 'viewgif'];
const INFRA = process.env.S9_INFRA_URL || pathToFileURL(path.join(ROOT, 'site', 'infrastructure', 'index.html')).href;
const asked = process.argv.slice(2).filter(a => !a.startsWith('--'));
const PARTS = asked.length ? asked : ALL_PARTS;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Chrome through the DevTools protocol (as the S7 suite) ─────────────────────────────────────────────────────
// Chrome leads its own process group, so closing ends every helper too, also when this script stops early. The
// profile folder is deleted at the end; profiles left by an earlier, interrupted run are deleted at the start.
async function launch() {
  fs.mkdirSync(OUT, { recursive: true });
  for (const d of fs.readdirSync(OUT)) {
    if (d.startsWith('chrome-profile-')) fs.rmSync(path.join(OUT, d), { recursive: true, force: true });
  }
  const profile = fs.mkdtempSync(path.join(OUT, 'chrome-profile-'));
  const proc = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + profile,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking',
    '--disable-component-update', '--disable-sync', '--window-size=1400,1000', 'about:blank'],
  { stdio: ['ignore', 'ignore', 'pipe'], detached: true });
  const killGroup = () => {
    try { process.kill(-proc.pid, 'SIGKILL'); } catch (e) { /* already gone */ }
  };
  const exited = ms => (proc.exitCode !== null || proc.signalCode !== null ? Promise.resolve()
    : new Promise(res => {
      const t = setTimeout(res, ms);
      proc.once('exit', () => { clearTimeout(t); res(); });
    }));
  process.once('exit', killGroup);
  process.once('SIGINT', () => process.exit(130));
  let port = null;
  for (let i = 0; i < 100 && !port; i++) {
    await sleep(100);
    const f = path.join(profile, 'DevToolsActivePort');
    if (fs.existsSync(f)) port = fs.readFileSync(f, 'utf8').split('\n')[0].trim();
  }
  if (!port) {
    killGroup();
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    throw new Error('Chrome did not start (set CHROME_BIN; run in the foreground)');
  }
  const version = await (await fetch('http://127.0.0.1:' + port + '/json/version')).json();
  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let lastId = 0;
  const pending = new Map();
  const listeners = [];
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) p.rej(new Error(m.error.message)); else p.res(m.result);
    } else if (m.method) {
      listeners.forEach(f => f(m));
    }
  };
  const send = (method, params, sessionId) => new Promise((res, rej) => {
    const id = ++lastId;
    pending.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method, params: params || {}, sessionId }));
  });
  const log = { requests: [], exceptions: [], csp: [] };
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId: sid } = await send('Target.attachToTarget', { targetId, flatten: true });
  listeners.push(m => {
    if (m.sessionId !== sid) return;
    if (m.method === 'Network.requestWillBeSent') log.requests.push(m.params.request.url);
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      log.exceptions.push((d.exception || {}).description || d.text);
    }
    if (m.method === 'Log.entryAdded' && /content security policy|refused to/i.test(m.params.entry.text)) {
      log.csp.push(m.params.entry.text);
    }
  });
  for (const d of ['Network.enable', 'Runtime.enable', 'Log.enable', 'Page.enable', 'DOM.enable']) await send(d, {}, sid);
  const loaded = () => new Promise(res => {
    const h = m => {
      if (m.method === 'Page.loadEventFired' && m.sessionId === sid) {
        listeners.splice(listeners.indexOf(h), 1);
        res();
      }
    };
    listeners.push(h);
  });
  const page = {
    async goto(url) {
      const done = loaded();
      await send('Page.navigate', { url }, sid);
      await Promise.race([done, sleep(15000)]);
    },
    // A step that does not answer within a minute fails with a message instead of stopping the run silently.
    async eval(expr) {
      const r = await Promise.race([
        send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }, sid),
        sleep(60000).then(() => { throw new Error('eval timed out: ' + expr.slice(0, 120)); })
      ]);
      if (r.exceptionDetails) {
        throw new Error('eval: ' + ((r.exceptionDetails.exception || {}).description || r.exceptionDetails.text));
      }
      return r.result.value;
    },
    async waitFor(expr, ms, label) {
      const t0 = Date.now();
      while (Date.now() - t0 < (ms || 15000)) {
        try {
          if (await page.eval('!!(' + expr + ')')) return true;
        } catch (e) { /* not ready yet */ }
        await sleep(50);
      }
      throw new Error('timeout: ' + (label || expr));
    },
    async setFiles(selector, files) {
      const { root } = await send('DOM.getDocument', { depth: 1 }, sid);
      const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector }, sid);
      await send('DOM.setFileInputFiles', { files, nodeId }, sid);
    },
    async viewport(width, height) {
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }, sid);
      await sleep(150);
    },
    // The whole page at a given width and height (for the saved pictures).
    async screenshotFull(file, width, height) {
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }, sid);
      await sleep(200);
      const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true,
        clip: { x: 0, y: 0, width, height, scale: 1 } }, sid);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
    }
  };
  async function close() {
    try { await Promise.race([send('Browser.close'), sleep(5000)]); } catch (e) { /* closing */ }
    await exited(5000);
    killGroup();
    await exited(2000);
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
  return { version: version.Browser, log, page, close, send, listeners, sid };
}

// ── Checks ─────────────────────────────────────────────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
const failures = [];
const counts = {};
function check(ok, name, detail) {
  const part = name.split(':')[0];
  counts[part] = (counts[part] || 0) + 1;
  if (ok) {
    passed++;
  } else {
    failed++;
    failures.push(name + (detail === undefined ? '' : ' :: ' + JSON.stringify(detail).slice(0, 500)));
  }
}

async function openPage(b) {
  await b.page.goto(PAGE);
  await b.page.waitFor('window.CVIWA && CVIWA.brandedmaps && CVIWA.state && CVIWA.state.mapHandle', 15000, 'page ready');
}
// Loads a master CSV through the page's own "Choose File" and waits until every view has computed.
async function loadMaster(page, file) {
  const v = await page.eval('CVIWA.state.version');
  await page.setFiles('#file-input', [file]);
  await page.waitFor('CVIWA.state.master && !CVIWA.state.loading && CVIWA.state.version > ' + v, 20000, 'master loaded');
  await sleep(400);
}
const oracleOf = fx => JSON.parse(fs.readFileSync(path.join(ORACLE, 'oracle_s9_' + fx + '.json'), 'utf8'));

// The page's WA State PNG for a scenario of the reference (CVI's input names), drawn in the page: the aggregate the
// map draws, the branded page, its PNG at dpi. Returns timings and the PNG as a data URL (and its first bytes).
const PAGE_PNG = (inputs, dpi, style) => `(async () => {
  const W = CVIWA, B = WSDA.branded, m = W.state.master, inp = ${JSON.stringify(inputs)};
  const list = x => (x === null || x === undefined ? [] : Array.isArray(x) ? x : [x]);
  const f = { species: list(inp.county_species), years: list(inp.county_year).map(Number),
    quarters: list(inp.county_quarter), direction: list(inp.county_direction), rawSpecies: list(inp.county_species_sub),
    mode: inp.county_mode, scaling: inp.county_scaling, nBins: Number(inp.county_n_bins) };
  const t0 = performance.now();
  const rows = W.aggregate.build(m.rows, Object.assign({}, f, { hasSpecies: m.hasSpecies }));
  const built = W.brandedmaps.wa({ rows, f, universe: m.speciesChoices, palette: inp.county_palette,
    opacity: inp.county_opacity, title: inp.export_title, date: new Date(2026, 9, 12), counties: CVIWA_GEO.counties.features },
    ${style ? 'B.CVI_STYLE' : 'null'});
  const size = B.pixelSize(${dpi});
  const blob = await B.png(B.svg(built.parts, size), size, ${dpi});
  const ms = performance.now() - t0;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const url = await new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob); });
  return { ms, url, head: Array.from(bytes.slice(0, 54)), length: bytes.length, title: built.model.title };
})()`;

// The page's National Flow PNG for a scenario of the reference, drawn in the page (the state files are loaded as
// the page loads them when the Flow view opens).
const FLOW_PNG = (inputs, dpi, style) => `(async () => {
  const load = src => new Promise((res, rej) => { const s = document.createElement('script'); s.onload = res;
    s.onerror = rej; s.src = src; document.head.appendChild(s); });
  if (!window.WSDA_US_STATES) await load('../geo/us-states.js');
  if (!window.WSDA_STATE_CENTERS) await load('../geo/state-centers.js');
  const W = CVIWA, B = WSDA.branded, m = W.state.master, inp = ${JSON.stringify(inputs)};
  const list = x => (x === null || x === undefined ? [] : Array.isArray(x) ? x : [x]);
  const f = { direction: inp.flow_direction, species: list(inp.flow_species), speciesSub: list(inp.flow_species_sub),
    years: list(inp.flow_year).map(Number), quarters: list(inp.flow_quarter), combine: !!inp.flow_combine_species,
    scaling: inp.flow_scaling, nBins: Number(inp.flow_n_bins), palette: inp.flow_palette,
    multiplier: inp.flow_width_mult, opacity: inp.flow_opacity, lines: !!inp.flow_show_state_lines };
  const t0 = performance.now();
  const lines = W.flow.lines(m, f, W.flow.centers(WSDA_STATE_CENTERS));
  const built = W.brandedmaps.flow({ lines, f, universe: m.speciesChoices, title: inp.export_title,
    date: new Date(2026, 9, 12), states: WSDA_US_STATES.states.features }, ${style ? 'B.CVI_STYLE' : 'null'});
  const size = B.pixelSize(${dpi});
  const blob = await B.png(B.svg(built.parts, size), size, ${dpi});
  const ms = performance.now() - t0;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const url = await new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob); });
  return { ms, url, head: Array.from(bytes.slice(0, 54)), length: bytes.length, title: built.model.title };
})()`;
// The page's County Focus PNG for a scenario of the reference (focus.build's premises, as the map draws them).
const FOCUS_PNG = (inputs, dpi, style) => `(async () => {
  const W = CVIWA, B = WSDA.branded, m = W.state.master, inp = ${JSON.stringify(inputs)};
  if (inp.export_png_background === 'vector:streets' && !window.WSDA_STREETS) {
    await new Promise((res, rej) => { const s = document.createElement('script'); s.onload = res; s.onerror = rej;
      s.src = '../geo/streets-wa.js'; document.head.appendChild(s); });
  }
  const list = x => (x === null || x === undefined ? [] : Array.isArray(x) ? x : [x]);
  const f = { counties: list(inp.intra_counties), species: list(inp.intra_species), rawSpecies: list(inp.intra_species_sub),
    years: list(inp.intra_year).map(Number), quarters: list(inp.intra_quarter), direction: inp.intra_filter_dir,
    mode: inp.intra_mode, scaling: inp.intra_scaling, nBins: Number(inp.intra_n_bins), opacity: inp.intra_opacity,
    hideCircles: !!inp.hide_cvi_circles };
  const t0 = performance.now();
  const premises = W.focus.build(m, f).premises;
  const built = W.brandedmaps.focus({ premises, f, universe: m.speciesChoices, title: inp.export_title,
    date: new Date(2026, 9, 12), counties: CVIWA_GEO.counties.features, background: inp.export_png_background || 'standard',
    streets: window.WSDA_STREETS || null }, ${style ? 'B.CVI_STYLE' : 'null'});
  const size = B.pixelSize(${dpi});
  const blob = await B.png(B.svg(built.parts, size), size, ${dpi});
  const ms = performance.now() - t0;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const url = await new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob); });
  return { ms, url, head: Array.from(bytes.slice(0, 54)), length: bytes.length, title: built.model.title };
})()`;
const DRAW = { wa: PAGE_PNG, flow: FLOW_PNG, focus: FOCUS_PNG };

// ── Part: the PNG ──────────────────────────────────────────────────────────────────────────────────────────────
// Pixel counts in a PNG (read back by the browser): how many pixels of a region are near a color.
const PIXELS = (url, probes) => `(async () => {
  const img = new Image();
  img.src = ${JSON.stringify(url)};
  await img.decode();
  const cv = document.createElement('canvas');
  cv.width = img.width;
  cv.height = img.height;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const probes = ${JSON.stringify(probes)};
  const out = { width: img.width, height: img.height };
  for (const p of probes) {
    const x = Math.round(p.x * img.width), y = Math.round(p.y * img.height);
    const w = Math.round(p.w * img.width), h = Math.round(p.h * img.height);
    const d = ctx.getImageData(x, y, w, h).data;
    const c = [1, 3, 5].map(i => parseInt(p.color.slice(i, i + 2), 16));
    let n = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (Math.abs(d[i] - c[0]) <= p.tol && Math.abs(d[i + 1] - c[1]) <= p.tol && Math.abs(d[i + 2] - c[2]) <= p.tol) n++;
    }
    out[p.name] = n / (w * h);
  }
  return out;
})()`;
// Regions as fractions of the picture (origin top left): the header's right end, the logo's box, the map.
const PROBES = [
  { name: 'headerTeal', x: 0.90, y: 0.005, w: 0.09, h: 0.08, color: '#245566', tol: 3 },
  { name: 'logoLightBlue', x: 0.005, y: 0.006, w: 0.13, h: 0.08, color: '#54bbec', tol: 40 },
  { name: 'logoGreen', x: 0.005, y: 0.006, w: 0.13, h: 0.08, color: '#41963b', tol: 40 },
  { name: 'land', x: 0.05, y: 0.25, w: 0.65, h: 0.55, color: '#e8e8e8', tol: 2 },
  { name: 'inboundCircle', x: 0, y: 0.10, w: 0.77, h: 0.90, color: '#6bbbe6', tol: 30 },
  { name: 'gutterWhite', x: 0.79, y: 0.55, w: 0.2, h: 0.02, color: '#ffffff', tol: 0 }
];

async function partPng(b) {
  const p = b.page;
  const o = oracleOf('tier_full');
  await openPage(b);
  await loadMaster(p, path.join(ROOT, o.file));
  const out = {};
  for (const [view, dpi] of [['wa', 200], ['wa', 300], ['flow', 200], ['flow', 300], ['focus', 200], ['focus', 300]]) {
    const inputs = o.views[view].default.inputs;
    const r = await p.eval(DRAW[view](inputs, dpi, false));
    const tag = view + ' ' + dpi;
    const want = dpi === 200 ? { width: 2200, height: 1700 } : { width: 3300, height: 2550 };
    const sig = r.head.slice(0, 8).join(',') === '137,80,78,71,13,10,26,10';
    const px = r.head.slice(16, 24);
    const width = ((px[0] << 24) | (px[1] << 16) | (px[2] << 8) | px[3]) >>> 0;
    const height = ((px[4] << 24) | (px[5] << 16) | (px[6] << 8) | px[7]) >>> 0;
    check(sig, 'png: ' + tag + ' dpi PNG signature');
    check(width === want.width && height === want.height, 'png: ' + tag + ' dpi size', [width, height]);
    // The chunk after IHDR: pHYs with the dpi in pixels per meter.
    const phys = Buffer.from(r.head.slice(33, 54));
    const ppm = Math.floor(dpi / 0.0254);
    check(phys.toString('latin1', 4, 8) === 'pHYs' && phys.readUInt32BE(8) === ppm && phys.readUInt32BE(12) === ppm &&
      phys[16] === 1, 'png: ' + tag + ' dpi recorded in the file', Array.from(phys));
    // Budget: 3 seconds at Standard, 6 at High.
    check(r.ms < (dpi === 200 ? 3000 : 6000), 'png: ' + tag + ' dpi drawn within the budget', Math.round(r.ms));
    const probes = view === 'wa' ? PROBES : view === 'focus' ? PROBES.concat([
      { name: 'goldBox', x: 0.46, y: 0.10, w: 0.31, h: 0.06, color: '#c8842c', tol: 3 },
      { name: 'insetBlue', x: 0.63, y: 0.89, w: 0.13, h: 0.075, color: '#1c5a83', tol: 3 }]) :
      PROBES.filter(q => q.name !== 'inboundCircle').concat([
      { name: 'topBadge', x: 0, y: 0.10, w: 0.77, h: 0.90, color: '#ee7e2c', tol: 6 },
      { name: 'waFill', x: 0, y: 0.10, w: 0.77, h: 0.90, color: '#e6f0f6', tol: 8 }]);
    const px2 = await p.eval(PIXELS(r.url, probes));
    check(px2.headerTeal > 0.95, 'png: ' + tag + ' dpi header bar in Dark Teal', px2.headerTeal);
    check(px2.logoLightBlue > 0.03 && px2.logoGreen > 0.01, 'png: ' + tag + ' dpi logo drawn', px2);
    check(px2.land > 0.30, 'png: ' + tag + ' dpi land in CVI\'s gray', px2.land);
    if (view === 'wa') check(px2.inboundCircle > 0.001, 'png: ' + tag + ' dpi inbound circles drawn', px2.inboundCircle);
    if (view === 'focus') {
      check(px2.goldBox > 0.05, 'png: ' + tag + ' dpi Total Animals box in gold', px2.goldBox);
      check(px2.insetBlue > 0.01, 'png: ' + tag + ' dpi inset focus counties in Dark Blue', px2.insetBlue);
    }
    if (view === 'flow') {
      check(px2.topBadge > 0.0005, 'png: ' + tag + ' dpi Top 3 badges drawn', px2.topBadge);
      check(px2.waFill > 0.002, 'png: ' + tag + ' dpi Washington highlighted', px2.waFill);
    }
    check(px2.gutterWhite > 0.5, 'png: ' + tag + ' dpi the gutter between the boxes is white', px2.gutterWhite);
    const again = await p.eval(DRAW[view](inputs, dpi, false));
    check(again.url === r.url, 'png: ' + tag + ' dpi the same bytes when drawn again');
    out[tag] = { ms: Math.round(r.ms), bytes: r.length, pixels: px2 };
  }
  return out;
}

// ── Part: the export controls ─────────────────────────────────────────────────────────────────────────────────
// A stored ZIP's entries (local headers in order), as the S7 suite reads them.
function readZip(buf) {
  const out = [];
  let at = 0;
  while (at + 30 <= buf.length && buf.readUInt32LE(at) === 0x04034b50) {
    const size = buf.readUInt32LE(at + 18);
    const nameLen = buf.readUInt16LE(at + 26);
    const extra = buf.readUInt16LE(at + 28);
    const name = buf.slice(at + 30, at + 30 + nameLen).toString('utf8');
    const start = at + 30 + nameLen + extra;
    out.push({ name, data: buf.slice(start, start + size) });
    at = start + size;
  }
  return out;
}
const pngInfo = data => {
  if (!data || data.length < 54 || data.readUInt32BE(0) !== 0x89504e47) return null;
  const phys = data.toString('latin1', 37, 41) === 'pHYs' ? data.readUInt32BE(41) : null;
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20), ppm: phys };
};
// The Map View switched by its button, as the S7 suite does; County Focus gets its first two counties.
async function showView(p, view) {
  const id = { wa: 'show-wa', flow: 'show-flow', focus: 'show-focus' }[view];
  await p.eval(`document.getElementById('${id}').click(); true`);
  const handle = { wa: 'mapHandle', flow: 'flowHandle', focus: 'focusHandle' }[view];
  await p.waitFor(`CVIWA.state.${handle} && CVIWA.state.${handle}.ready`, 20000, view + ' map ready');
  if (view === 'focus') {
    await p.eval(`(() => {
      const boxes = [...document.querySelectorAll('#fo-counties input')];
      boxes.forEach((b, i) => { if (b.checked !== (i < 2)) { b.checked = i < 2; b.dispatchEvent(new Event('change')); } });
      return true; })()`);
  }
  await sleep(700);
}
async function partExport(b) {
  const p = b.page;
  const DL = path.join(OUT, 'downloads');
  fs.rmSync(DL, { recursive: true, force: true });
  fs.mkdirSync(DL, { recursive: true });
  await b.send('Browser.setDownloadBehavior', { behavior: 'allowAndName', downloadPath: DL, eventsEnabled: true });
  const download = () => new Promise(res => {
    let name = null;
    const h = m => {
      if (m.method === 'Browser.downloadWillBegin') name = m.params.suggestedFilename;
      if (m.method === 'Browser.downloadProgress' && (m.params.state === 'completed' || m.params.state === 'canceled')) {
        clearTimeout(t);
        b.listeners.splice(b.listeners.indexOf(h), 1);
        res({ state: m.params.state, guid: m.params.guid, name });
      }
    };
    const t = setTimeout(() => { b.listeners.splice(b.listeners.indexOf(h), 1); res({ state: 'timeout', name }); }, 60000);
    b.listeners.push(h);
  });
  const exportNow = async () => {
    const dl = download();
    await p.eval(`document.getElementById('run-export').click(); true`);
    const got = await dl;
    await p.waitFor('!CVIWA.state.exporting', 30000, 'export finished');
    return got.state === 'completed' ? readZip(fs.readFileSync(path.join(DL, got.guid))) : [];
  };
  const formats = list => p.eval(`(() => { document.querySelectorAll('input[name=export-format]').forEach(i => {
    i.checked = ${JSON.stringify(list)}.includes(i.value); }); return true; })()`);
  const resolution = v => p.eval(`(() => { const s = document.getElementById('export-resolution'); s.value = '${v}';
    s.dispatchEvent(new Event('change')); return true; })()`);
  // Preview Map: the dialog's picture as bytes (base64), its caption and the dialog's texts.
  const previewMap = async () => {
    await p.eval(`document.getElementById('preview-map').click(); true`);
    await p.waitFor('!CVIWA.state.exporting && (CVIWA.previews.isOpen() || !document.getElementById("preview-message").hidden)',
      30000, 'preview drawn');
    return p.eval(`(async () => {
      const msg = document.getElementById('preview-message');
      if (!CVIWA.previews.isOpen()) return { open: false, message: msg.hidden ? null : msg.textContent };
      const d = document.querySelector('dialog[open]');
      const buf = new Uint8Array(await CVIWA.state.lastPreviewMap[0].blob.arrayBuffer());
      let bin = '';
      for (let i = 0; i < buf.length; i += 8192) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 8192));
      const out = { open: true, title: d.querySelector('h2, .dialog-title, header') ? d.querySelector('h2, .dialog-title, header').textContent : '',
        text: d.textContent, caption: d.querySelector('figcaption').textContent, b64: btoa(bin) };
      CVIWA.previews.close();
      return out; })()`);
  };
  const o = oracleOf('tier_full');
  await openPage(b);
  await p.viewport(1400, 1000);
  await loadMaster(p, path.join(ROOT, o.file));
  await p.eval(`(() => { document.getElementById('export-section').open = true; return true; })()`);
  const out = {};
  for (const view of ['wa', 'flow', 'focus']) {
    await showView(p, view);
    await resolution('standard');
    await formats(['summary_csv', 'charts', 'branded_png']);
    const tag = 'export: ' + view;
    const prev = await previewMap();
    check(prev.open && /Map preview/.test(prev.text) && /This is what the PNG will look like when exported\./.test(prev.text),
      tag + ' Preview Map opens CVI\'s dialog', prev.message || prev.title);
    const model = await p.eval('CVIWA.state.lastBranded && CVIWA.state.lastBranded.models[0].fileName');
    check(prev.caption === model, tag + ' the preview names the file', [prev.caption, model]);
    const entries = await exportNow();
    const brandedEntry = entries.find(e => e.name.endsWith('/' + model));
    const names = entries.map(e => e.name.replace(/^[^/]*\//, ''));
    check(!!brandedEntry, tag + ' the ZIP holds ' + model, names);
    const order = names.filter(n => n && !n.endsWith('/'));
    const iBranded = order.indexOf(model);
    const lastChart = Math.max(...order.map((n, i) => (n.startsWith('charts/') ? i : -1)));
    check(iBranded > lastChart && order[order.length - 1] === 'export_params.json', tag +
      ' written after the charts and before export_params.json (CVI\'s order)', order);
    const prevBytes = Buffer.from(prev.b64 || '', 'base64');
    check(brandedEntry && Buffer.compare(brandedEntry.data, prevBytes) === 0, tag + ' the export\'s bytes are the preview\'s');
    const info = brandedEntry && pngInfo(brandedEntry.data);
    check(info && info.width === 2200 && info.height === 1700 && info.ppm === Math.floor(200 / 0.0254), tag +
      ' 2200 x 1700 at 200 dpi', info);
    const pat = { wa: /^CVI_County_Map_\d{4}(-\d{4})?_Q1Q2Q3Q4_INB\+OUT\.png$/, flow: /^CVI_Flow_Map_\d{4}(-\d{4})?_Q1Q2Q3Q4_INBOUND\.png$/,
      focus: /^CVI_CountyFocus_InboundOutbound_[A-Za-z]+_\d{4}(-\d{4})?_Q1Q2Q3Q4\.png$/ }[view];
    check(pat.test(model), tag + ' CVI\'s file name pattern', model);
    const params = entries.find(e => e.name.endsWith('/export_params.json')).data.toString('utf8');
    // The PNG choices, then the coordinate system (version 1.1), before "exported_at".
    check(/"png_background": "standard",\n  "export_quality": "standard",\n  "png_resolution": "standard",\n  "coordinates": "WGS 84 longitude and latitude \(EPSG:4326\)",\n  "exported_at"/.test(params),
      tag + ' export_params.json names the PNG choices', params);
    const standardCharts = entries.filter(e => /\/charts\/.+\.png$/.test(e.name)).map(e => ({ name: e.name, info: pngInfo(e.data) }));

    // High resolution: the map at 3300 x 2550 and each chart at twice its Standard size, 300 dpi recorded.
    await resolution('high');
    const high = await exportNow();
    const hb = high.find(e => e.name.endsWith('/' + model));
    const hi = hb && pngInfo(hb.data);
    check(hi && hi.width === 3300 && hi.height === 2550 && hi.ppm === Math.floor(300 / 0.0254), tag + ' High: 3300 x 2550 at 300 dpi', hi);
    const highCharts = high.filter(e => /\/charts\/.+\.png$/.test(e.name)).map(e => ({ name: e.name, info: pngInfo(e.data) }));
    check(highCharts.length === standardCharts.length && highCharts.length > 0 && highCharts.every((c, i) =>
      c.info.width === Math.floor(standardCharts[i].info.width * 2) && c.info.height === Math.floor(standardCharts[i].info.height * 2) &&
      c.info.ppm === Math.floor(300 / 0.0254) && standardCharts[i].info.ppm === Math.floor(150 / 0.0254)),
    tag + ' High: every chart at twice its Standard size, 300 dpi (Standard 150)', [standardCharts.slice(0, 2), highCharts.slice(0, 2)]);
    const hp = high.find(e => e.name.endsWith('/export_params.json')).data.toString('utf8');
    check(/"png_resolution": "high"/.test(hp), tag + ' High recorded in export_params.json');
    // Charts only at Standard: CVI's export_params.json, without PNG choices.
    await resolution('standard');
    await formats(['summary_csv', 'charts']);
    const plain = await exportNow();
    const pp = plain.find(e => e.name.endsWith('/export_params.json')).data.toString('utf8');
    check(!/png_/.test(pp) && !plain.some(e => e.name.endsWith('/' + model)), tag + ' without the branded map: no PNG choices, no map');
    out[view] = { file: model, bytes: brandedEntry ? brandedEntry.data.length : null, high: hb ? hb.data.length : null };
  }
  // Nothing to draw: CVI's message under the buttons.
  await showView(p, 'wa');
  await p.eval(`(() => { document.querySelector('[data-clear="species"]').click(); return true; })()`);
  await sleep(600);
  const none = await previewMap();
  check(!none.open && none.message === 'Preview failed: Branded county map: no data matches current filters.',
    'export: nothing to draw gives CVI\'s message', none);
  await b.send('Browser.setDownloadBehavior', { behavior: 'default' });
  fs.rmSync(DL, { recursive: true, force: true });
  return out;
}

// ── Part: the page additions ─────────────────────────────────────────────────────────────────────────────────
async function partAdditions(b) {
  const p = b.page;
  const o = oracleOf('tier_full');
  await openPage(b);
  await p.viewport(1400, 1000);
  await loadMaster(p, path.join(ROOT, o.file));
  await p.eval(`(() => { document.getElementById('export-section').open = true; return true; })()`);
  // Preview Map, then what was drawn (the models) and the pictures as data URLs.
  const preview = async () => {
    await p.eval(`document.getElementById('preview-map').click(); true`);
    await p.waitFor('!CVIWA.state.exporting && (CVIWA.previews.isOpen() || !document.getElementById("preview-message").hidden)',
      30000, 'preview drawn');
    return p.eval(`(async () => {
      const open = CVIWA.previews.isOpen();
      const pics = open ? CVIWA.state.lastPreviewMap : [];
      const urls = await Promise.all(pics.map(x => new Promise(res => { const r = new FileReader();
        r.onload = () => res(r.result); r.readAsDataURL(x.blob); })));
      if (open) CVIWA.previews.close();
      const m = CVIWA.state.lastBranded;
      return { open, names: pics.map(x => x.name), urls, models: m ? JSON.parse(JSON.stringify(m.models)) : [] };
    })()`);
  };
  const tick = (sel, on) => p.eval(`(() => { const i = document.querySelector(${JSON.stringify(sel)});
    if (i.checked !== ${on}) { i.checked = ${on}; i.dispatchEvent(new Event('change', { bubbles: true })); } return true; })()`);
  const mode = m => p.eval(`(() => { const r = document.querySelector('input[name=period-mode][value=${m}]');
    r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  const shots = [];
  const keep = (label, r) => r.urls.forEach((u, i) => shots.push({ label: label + (r.urls.length > 1 ? ' (' + r.names[i] + ')' : ''), url: u }));
  await showView(p, 'wa');

  // Spotlight: two counties at full opacity, the others at 10%, drawn under them; named in the Highlighted line.
  await p.eval(`(() => { const boxes = [...document.querySelectorAll('#f-spotlight input')].filter(i => i.value === 'King' || i.value === 'Pierce');
    boxes.forEach(i => { i.checked = true; i.dispatchEvent(new Event('change', { bubbles: true })); }); return boxes.length; })()`);
  await sleep(600);
  let r = await preview();
  let m = r.models[0];
  const lit = m.circles.filter(c => c.spot === true);
  const dim = m.circles.filter(c => c.spot === false);
  check(r.open && lit.length > 0 && lit.every(c => ['King', 'Pierce'].includes(c.county) && c.opacity > 0.1) &&
    dim.length > 0 && dim.every(c => c.opacity === 0.1), 'additions: spotlight lit and dimmed circles', [lit.length, dim.length]);
  const lastDim = Math.max(...m.circles.map((c, i) => (c.spot === false ? i : -1)));
  const firstLit = Math.min(...m.circles.map((c, i) => (c.spot === true ? i : m.circles.length)));
  check(lastDim < firstLit, 'additions: spotlit circles drawn on top');
  check(m.highlights.length === 1 && /^Spotlight: /.test(m.highlights[0]) && /King/.test(m.highlights[0]),
    'additions: spotlight named in the Highlighted line', m.highlights);
  keep('Spotlight King and Pierce', r);

  // The movement view in place of the circles.
  await tick('#mv-on', true);
  await sleep(800);
  r = await preview();
  m = r.models[0];
  check(r.open && m.movement === true && m.lines.length > 0 && !m.circles, 'additions: movement view drawn', m.lines && m.lines.length);
  check(/^Top 3 Movements/.test(m.top.title) && m.top.rows.length > 0 && m.top.rows.every(x => / → /.test(x.label)),
    'additions: the gutter box lists the top movements', m.top);
  // A true spotlight: only the pairs touching King or Pierce, none faded.
  check(m.lines.length > 0 && m.lines.every(l => l.opacity > 0.5 && /(^|\u0000)(King|Pierce)(\u0000|$)/.test(l.key)),
    'additions: only the spotlight\'s lines, none faded',
    m.lines.map(l => l.opacity));
  keep('Movement view (with the spotlight)', r);
  await tick('#mv-on', false);
  await p.eval(`(() => { document.querySelector('[data-clear="spotlight"]').click(); return true; })()`);
  await sleep(600);

  // Neighboring regions: Idaho and British Columbia (counties on), Washington white, BC's statement.
  for (const id of ['id', 'bc']) {
    await tick('#nr-list .nr-row[data-region="' + id + '"] .nr-on', true);
    await p.waitFor(`WSDA.regions.loaded('${id}')`, 20000, id + ' loaded');
  }
  await tick('#nr-list .nr-row[data-region="bc"] .nr-counties', true);
  await sleep(600);
  r = await preview();
  m = r.models[0];
  check(r.open && JSON.stringify(m.regions) === JSON.stringify(['bc', 'id']), 'additions: neighboring regions drawn', m.regions);
  check(m.source === 'Data: WSDA Animal Services CVI records · County boundaries: U.S. Census Bureau · Adapted from Statistics Canada',
    'additions: the source line credits Statistics Canada once and the Census Bureau once', m.source);
  for (const id of ['id', 'bc']) await tick('#nr-list .nr-row[data-region="' + id + '"] .nr-on', false);
  keep('Neighboring regions: Idaho, British Columbia with its regional districts', r);
  await sleep(400);

  // Compare: two PNGs, one per map, each with its own period.
  await mode('compare');
  await sleep(900);
  r = await preview();
  check(r.open && r.names.length === 2 && /_left\.png$/.test(r.names[0]) && /_right\.png$/.test(r.names[1]),
    'additions: Compare gives two PNGs', r.names);
  keep('Compare', r);

  // Browse: the frame on screen.
  await mode('browse');
  await sleep(900);
  const frame = await p.eval('({ years: CVIWA.state.years.slice(), quarters: CVIWA.state.quarters.slice() })');
  r = await preview();
  m = r.models[0];
  const want = frame.quarters.length === 1 ? { Q1: 'Jan – Mar', Q2: 'Apr – Jun', Q3: 'Jul – Sep', Q4: 'Oct – Dec' }[frame.quarters[0]] : null;
  check(r.open && r.names.length === 1 && m.stats.left[0].prefix === 'CY ' + frame.years[0] + ':' && (!want || m.stats.left[0].value === want),
    'additions: Browse exports the frame on screen', [frame, m.stats.left[0]]);
  keep('Browse (the frame on screen)', r);
  await mode('single');
  await sleep(600);

  // National Flow: a state picked in a chart; the other states' lines at 10%.
  await showView(p, 'flow');
  await p.eval(`(() => { CVIWA.state.cf = CVIWA.crossfilter.toggle(CVIWA.state.cf, 'flow', { kind: 'place', value: 'ID' }); return true; })()`);
  r = await preview();
  m = r.models[0];
  check(r.open && m.lines.filter(l => l.state === 'ID').every(l => l.opacity > 0.1) &&
    m.lines.filter(l => l.state !== 'ID').every(l => l.opacity === 0.1) && m.lines.some(l => l.state !== 'ID'),
  'additions: Flow highlights the picked state\'s lines');
  check(JSON.stringify(m.highlights) === JSON.stringify(['State: ID']), 'additions: Flow names the pick', m.highlights);
  keep('National Flow, Idaho picked in a chart', r);
  await p.eval(`(() => { CVIWA.state.cf = CVIWA.crossfilter.toggle(CVIWA.state.cf, 'flow', { kind: 'place', value: 'ID' }); return true; })()`);

  // County Focus: a county picked in a chart; circles holding none of its premises at 10%.
  await showView(p, 'focus');
  const county = await p.eval('CVIWA.state.cf && document.querySelector("#fo-counties input:checked").value');
  await p.eval(`(() => { CVIWA.state.cf = CVIWA.crossfilter.toggle(CVIWA.state.cf, 'focus', { kind: 'place', value: ${JSON.stringify(county)} }); return true; })()`);
  r = await preview();
  m = r.models[0];
  check(r.open && m.circles.some(c => c.lit) && m.circles.some(c => c.lit === false && c.opacity === 0.1),
    'additions: County Focus fades the circles outside the picked county', county);
  check(m.highlights.length === 1 && m.highlights[0] === 'County: ' + county, 'additions: Focus names the pick', m.highlights);
  keep('County Focus, ' + county + ' picked in a chart', r);

  const out = { pictures: shots.length };
  return out;
}

// ── Part: tile backgrounds (no network) ───────────────────────────────────────────────────────────────────────
// A public copy (shared/release.js) offers no Esri background: the tile-background checks stay with the
// private build, and a public copy checks instead that its pickers offer none.
const publicCopy = p => p.eval('!!(window.WSDA && WSDA.release && WSDA.release.publicCopy)');
const noEsriOffered = (p, id) => p.eval(`[...document.getElementById('${id}').options].map(o => o.value)`)
  .then(opts => ({ opts, ok: opts.includes('standard') && !opts.some(v => /^raster:esri/.test(v)) }));

async function partBackgrounds(b) {
  const p = b.page;
  const seen = [];
  let mode = 'ok';   // 'ok': every request answered; 'tiles': the export image refused, tiles answered; 'fail': all refused
  const KIND = { World_Imagery: 'satellite', World_Shaded_Relief: 'relief', World_Hillshade: 'hillshade' };
  const handler = async m => {
    if (m.method !== 'Fetch.requestPaused' || m.sessionId !== b.sid) return;
    const url = m.params.request.url;
    seen.push(url);
    const kind = Object.keys(KIND).find(k => url.indexOf(k) >= 0);
    const isExport = /\/export\?/.test(url);
    if (mode === 'fail' || (mode === 'tiles' && isExport)) {
      await b.send('Fetch.failRequest', { requestId: m.params.requestId, errorReason: 'Failed' }, b.sid);
      return;
    }
    const size = isExport ? (url.match(/size=(\d+),(\d+)/) || []).slice(1).map(Number) : [256, 256];
    const body = syntheticPng(size[0], size[1], isExport ? KIND[kind] : 'tile').toString('base64');
    await b.send('Fetch.fulfillRequest', { requestId: m.params.requestId, responseCode: 200, body,
      responseHeaders: [{ name: 'Content-Type', value: 'image/png' }, { name: 'Access-Control-Allow-Origin', value: '*' }] },
    b.sid);
  };
  b.listeners.push(handler);
  await b.send('Fetch.enable', { patterns: [{ urlPattern: '*server.arcgisonline.com*' }] }, b.sid);
  b.answered = url => /^https:\/\/server\.arcgisonline\.com\//.test(url);   // the final check leaves these out

  const o = oracleOf('tier_full');
  await openPage(b);
  await p.viewport(1400, 1000);
  await loadMaster(p, path.join(ROOT, o.file));
  await p.eval(`(() => { document.getElementById('export-section').open = true; return true; })()`);
  if (await publicCopy(p)) {
    const none = await noEsriOffered(p, 'export-background');
    check(none.ok, 'backgrounds: public copy: no Esri background offered (Default and Streets only)', none.opts);
    await b.send('Fetch.disable', {}, b.sid);
    b.listeners.splice(b.listeners.indexOf(handler), 1);
    return { publicCopy: true, options: none.opts };
  }
  const pick = (id, v) => p.eval(`(() => { const s = document.getElementById('${id}'); s.value = '${v}';
    s.dispatchEvent(new Event('change')); return true; })()`);
  const preview = async () => {
    await p.eval(`document.getElementById('preview-map').click(); true`);
    await p.waitFor('!CVIWA.state.exporting && (CVIWA.previews.isOpen() || !document.getElementById("preview-message").hidden)',
      60000, 'preview drawn');
    return p.eval(`(async () => {
      const open = CVIWA.previews.isOpen();
      const pics = open ? CVIWA.state.lastPreviewMap : [];
      const url = pics.length ? await new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result);
        r.readAsDataURL(pics[0].blob); }) : null;
      if (open) CVIWA.previews.close();
      const msg = document.getElementById('preview-message');
      return { open, url, message: msg.hidden ? null : msg.textContent,
        branded: JSON.parse(JSON.stringify(CVIWA.state.lastBranded)) };
    })()`);
  };
  // The share of a lon/lat box's pixels (in the page's Mercator map box) near a color.
  const share = (r, lon0, lon1, lat0, lat1, color, tol) => {
    const u = r.branded.models[0].underlay || r.branded.models[0].underlayFor;
    const e = u.extent;
    const my = lat => Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360));
    const fx = lon => (u.box.left + (lon - e.west) / (e.east - e.west) * u.box.width) / 792;
    const fy = lat => (u.box.top + (my(e.north) - my(lat)) / (my(e.north) - my(e.south)) * u.box.height) / 612;
    return p.eval(PIXELS(r.url, [{ name: 'v', x: fx(lon0), y: fy(lat1), w: fx(lon1) - fx(lon0), h: fy(lat0) - fy(lat1),
      color, tol }])).then(x => x.v);
  };
  const shots = [];

  // WA State on Satellite: the export image in Web Mercator at the map box's size, masked to Washington.
  await showView(p, 'wa');
  await pick('export-background', 'raster:esri_satellite');
  seen.length = 0;
  let r = await preview();
  let m = r.branded.models[0];
  const exp = seen.find(u => /World_Imagery\/MapServer\/export\?/.test(u));
  const wantW = Math.round(m.underlay.box.width * 200 / 72);
  check(r.open && m.background === 'raster:esri_satellite' && r.branded.underlay[0].how === 'export', 'backgrounds: WA Satellite drawn from the export image', r.message);
  check(exp && /bboxSR=3857/.test(exp) && /imageSR=3857/.test(exp) && new RegExp('size=' + wantW + ',').test(exp),
    'backgrounds: the export image asked in Web Mercator at the map box\'s size', exp);
  check(m.basemap === 'Source: Esri, Maxar, Earthstar Geographics', 'backgrounds: the Satellite credit', m.basemap);
  check(m.circles.every(c => Math.abs(c.opacity - 0.6 * 0.85) < 1e-9), 'backgrounds: circles at 85% of their opacity');
  r.branded.models[0].underlayFor = m.underlay;
  const inside = await share(r, -120.6, -120.3, 48.62, 48.85, TILE_COLORS.satellite[0], 12) +
    await share(r, -120.6, -120.3, 48.62, 48.85, TILE_COLORS.satellite[1], 12);
  const outside = await share(r, -116.9, -116.6, 46.8, 48.6, TILE_COLORS.satellite[0], 40) +
    await share(r, -116.9, -116.6, 46.8, 48.6, TILE_COLORS.satellite[1], 40);
  check(inside > 0.5 && outside < 0.01, 'backgrounds: the picture inside Washington only (masked)', { inside, outside });
  shots.push({ label: 'WA State, Satellite (synthetic picture)', url: r.url });
  // High quality: the image asked at twice the size.
  await pick('export-quality', 'high');
  seen.length = 0;
  r = await preview();
  const exp2 = seen.find(u => /\/export\?/.test(u));
  check(exp2 && new RegExp('size=' + Math.min(4096, wantW * 2) + ',').test(exp2), 'backgrounds: High quality asks twice the size', exp2);
  // 300 dpi with High quality: capped at 4096 pixels, the picture's shape the box's.
  await pick('export-resolution', 'high');
  seen.length = 0;
  r = await preview();
  const exp3 = seen.find(u => /\/export\?/.test(u)) || '';
  const sz = (exp3.match(/size=(\d+),(\d+)/) || []).slice(1).map(Number);
  const bb = (exp3.match(/bbox=([-\d.]+),([-\d.]+),([-\d.]+),([-\d.]+)/) || []).slice(1).map(Number);
  check(sz.length === 2 && bb.length === 4 && Math.max(...sz) === 4096 &&
    Math.abs(sz[0] / sz[1] - (bb[2] - bb[0]) / (bb[3] - bb[1])) < 0.002,
  'backgrounds: 300 dpi High asks at most 4096 pixels in the box\'s shape', { sz, bb });
  await pick('export-resolution', 'standard');
  // The export image refused: CVI's tiles at its zoom (10, +2 with High).
  mode = 'tiles';
  seen.length = 0;
  r = await preview();
  const tileZ = seen.filter(u => /\/tile\//.test(u)).map(u => Number(u.match(/\/tile\/(\d+)\//)[1]));
  // CVI's zoom 10 + 2, lowered while the tiles would hold more than four times the picture's width (High).
  const ex = r.branded.models[0].underlay;
  const pxW = ex.box.width * 200 / 72;
  let wantZ = 12;
  while (256 * Math.pow(2, wantZ) * (ex.extent.east - ex.extent.west) / 360 > 4 * pxW) wantZ--;
  check(r.open && r.branded.underlay[0] && r.branded.underlay[0].how === 'tiles' && tileZ.length > 0 &&
    tileZ.every(z => z === wantZ), 'backgrounds: tiles at CVI\'s zoom + 2, lowered to ' + wantZ + ', when the export image fails',
  [r.branded.underlay, tileZ.length, tileZ.slice(0, 3), r.message]);
  await pick('export-quality', 'standard');
  // Nothing loads: Default with a notice.
  mode = 'fail';
  r = await preview();
  check(r.open && r.branded.models[0].background === 'standard' &&
    r.message === 'The Satellite background could not be loaded, so the Default background was used.',
  'backgrounds: Default with a notice when the background cannot be loaded', r.message);
  mode = 'ok';

  // County Focus on Hillshade: masked to the focus counties, CVI's theme, names near-black.
  await showView(p, 'focus');
  await pick('export-background', 'raster:esri_hillshade');
  r = await preview();
  m = r.branded.models[0];
  check(r.open && m.background === 'raster:esri_hillshade' && m.theme === 'hillshade' && m.nameColor === '#222222' &&
    m.underlay.mask.length === 2 && m.underlay.zoom === 11, 'backgrounds: County Focus on Hillshade', [m.theme, m.nameColor]);
  check(m.circles.every(c => c.opacity === Math.max(0.1, Math.min(0.8, 0.8) * 0.85)), 'backgrounds: Focus circles at 85%');
  shots.push({ label: 'County Focus, Hillshade (synthetic picture)', url: r.url });
  // Satellite keeps CVI's light names on a dark halo.
  await pick('export-background', 'raster:esri_satellite');
  r = await preview();
  check(r.branded.models[0].nameColor === '#f7f7f0', 'backgrounds: Satellite keeps CVI\'s light names', r.branded.models[0].nameColor);
  shots.push({ label: 'County Focus, Satellite (synthetic picture)', url: r.url });
  // Streets (vector), County Focus only: drawn from the bundled data, no request to Esri.
  seen.length = 0;
  await pick('export-background', 'vector:streets');
  r = await preview();
  m = r.branded.models[0];
  check(r.open && m.background === 'vector:streets' && m.streetNames.some(n => n.kind === 'place') && !r.message &&
    !seen.length, 'backgrounds: County Focus Streets from the bundled data, no network', [m.background, r.message, seen.length]);
  shots.push({ label: 'County Focus, Streets (bundled Census, USGS and Natural Earth data)', url: r.url });

  // National Flow: Default only, with CVI's note, and no Export quality.
  await showView(p, 'flow');
  const flowCtl = await p.eval(`(() => ({ value: document.getElementById('export-background').value,
    offered: [...document.getElementById('export-background').options].filter(o => !o.disabled).map(o => o.value),
    note: !document.getElementById('export-background-note').hidden,
    quality: !document.getElementById('export-quality-field').hidden }))()`);
  check(flowCtl.value === 'standard' && JSON.stringify(flowCtl.offered) === '["standard"]' && flowCtl.note && !flowCtl.quality,
    'backgrounds: National Flow offers Default only, with the note', flowCtl);
  await showView(p, 'wa');
  const back = await p.eval(`[...document.getElementById('export-background').options].filter(o => !o.disabled).map(o => o.value)`);
  check(back.length === 4 && back.indexOf('vector:streets') < 0, 'backgrounds: WA State offers the four backgrounds, not Streets', back);

  await b.send('Fetch.disable', {}, b.sid);
  b.listeners.splice(b.listeners.indexOf(handler), 1);
  const out = { requests: seen.length };
  return out;
}

// ── Part: name markers (County Focus with facility layers) ─────────────────────────────────────────────────────
async function partNames(b) {
  const p = b.page;
  require('../synthetic/make_s9_facilities.js').generate();
  const FAC = path.join(ORACLE, 'facilities');
  const texts = { markets: 'wa_state_public_livestock_markets.csv', feedlots: 'wa_state_feedlots.csv',
    fairgrounds: 'wa_state_fairs.csv' };
  for (const k of Object.keys(texts)) texts[k] = fs.readFileSync(path.join(FAC, texts[k]), 'utf8');
  const o = oracleOf('tier_full');
  await openPage(b);
  await p.viewport(1400, 1000);
  await loadMaster(p, path.join(ROOT, o.file));
  await p.eval(`(() => { document.getElementById('export-section').open = true; return true; })()`);
  await p.eval(`(function (m) { var d = {}; Object.keys(m).forEach(function (k) { d[k] = { file: new Blob([m[k]], { type: 'text/csv' }) }; });
    return CVIWA.setFacilityFiles(d).then(function () { return true; }); })(${JSON.stringify(texts)})`);
  const shownOn = v => p.eval(`!document.getElementById('export-names').hidden`);
  await showView(p, 'wa');
  check(!(await shownOn('wa')), 'names: "Name markers in PNG" hidden on WA State');
  await showView(p, 'focus');
  check(await shownOn('focus'), 'names: "Name markers in PNG" shown on County Focus');
  await p.eval(`(() => { const boxes = [...document.querySelectorAll('#fo-counties input')];
    boxes.forEach(b => { const on = b.value === 'Grant' || b.value === 'Yakima';
      if (b.checked !== on) { b.checked = on; b.dispatchEvent(new Event('change')); } }); return true; })()`);
  await sleep(900);
  await p.eval(`document.getElementById('fo-fac-all').click(); true`);   // every facility layer on, as a user would
  await sleep(500);
  const offered = await p.eval(`[...document.querySelectorAll('#export-name-list input')].map(i => i.value)`);
  check(JSON.stringify(offered) === JSON.stringify(['fairgrounds', 'markets', 'feedlots']),
    'names: one box per facility layer with a file, in the registry\'s order', offered);
  await p.eval(`(() => { document.querySelectorAll('#export-name-list input').forEach(i => {
    if (i.value === 'markets' || i.value === 'feedlots') { i.checked = true; i.dispatchEvent(new Event('change', { bubbles: true })); } });
    return true; })()`);
  await p.eval(`document.getElementById('preview-map').click(); true`);
  await p.waitFor('!CVIWA.state.exporting && (CVIWA.previews.isOpen() || !document.getElementById("preview-message").hidden)', 30000, 'preview');
  const r = await p.eval(`(async () => {
    const pics = CVIWA.state.lastPreviewMap || [];
    const url = pics.length ? await new Promise(res => { const f = new FileReader(); f.onload = () => res(f.result); f.readAsDataURL(pics[0].blob); }) : null;
    CVIWA.previews.close();
    return { url, m: JSON.parse(JSON.stringify(CVIWA.state.lastBranded.models[0])) }; })()`);
  const m = r.m;
  check(JSON.stringify(m.facilities.map(l => [l.key, l.points.length])) === '[["fairgrounds",2],["markets",3],["feedlots",4]]',
    'names: the three layers\' markers in the PNG', m.facilities.map(l => [l.key, l.points.length]));
  const rec = o.views.focus.facility_names;
  const repel = rec.page.find(e => e.kind === 'plot').plot.layers.find(l => l.geom === 'GeomTextRepel').data;
  const pageNames = m.facilityNames.map(n => n.lines.join('\n') + '|' + n.color).sort();
  const cviNames = repel.map(d => d.label + '|' + d.colour).sort();
  check(JSON.stringify(pageNames) === JSON.stringify(cviNames), 'names: the names, wrapping and colors as CVI\'s', [pageNames, cviNames]);
  check(m.facilityNames.every(n => n.at.free), 'names: every name apart from the others and the markers');
  check(m.facilityNames.some(n => n.at.leader), 'names: a leader line where a name had to move');
  // All and Clear.
  await p.eval(`document.getElementById('export-names-clear').click(); true`);
  const cleared = await p.eval(`CVIWA.state.nameLayers.length`);
  await p.eval(`document.getElementById('export-names-all').click(); true`);
  const all = await p.eval(`CVIWA.state.nameLayers.slice()`);
  check(cleared === 0 && JSON.stringify(all) === '["fairgrounds","markets","feedlots"]', 'names: Clear and All', [cleared, all]);
  // export_params.json names the picks as CVI writes them.
  await p.eval(`(() => { document.getElementById('export-names-clear').click();
    document.querySelectorAll('#export-name-list input').forEach(i => { if (i.value === 'markets' || i.value === 'feedlots') {
      i.checked = true; i.dispatchEvent(new Event('change', { bubbles: true })); } });
    document.querySelectorAll('input[name=export-format]').forEach(i => { i.checked = i.value === 'branded_png'; }); return true; })()`);
  const DL = path.join(OUT, 'downloads');
  fs.rmSync(DL, { recursive: true, force: true });
  fs.mkdirSync(DL, { recursive: true });
  await b.send('Browser.setDownloadBehavior', { behavior: 'allowAndName', downloadPath: DL, eventsEnabled: true });
  const done = new Promise(res => {
    const h = msg => {
      if (msg.method === 'Browser.downloadProgress' && msg.params.state === 'completed') {
        b.listeners.splice(b.listeners.indexOf(h), 1);
        res(msg.params.guid);
      }
    };
    b.listeners.push(h);
    setTimeout(() => res(null), 60000);
  });
  await p.eval(`document.getElementById('run-export').click(); true`);
  const guid = await done;
  await p.waitFor('!CVIWA.state.exporting', 30000, 'export finished');
  const params = guid ? readZip(fs.readFileSync(path.join(DL, guid))).find(e => e.name.endsWith('/export_params.json')).data.toString('utf8') : '';
  check(/"overlays_active": \["fairgrounds", "markets", "feedlots"\]/.test(params) && /"overlay_labels_on_png": "markets, feedlots"/.test(params),
    'names: export_params.json names the layers on and the names picked, as CVI', params);
  await b.send('Browser.setDownloadBehavior', { behavior: 'default' });
  fs.rmSync(DL, { recursive: true, force: true });
  const out = {};
  return out;
}



// ── Part: Facilities on the Infrastructure dashboard ────────────────────────────────────────────────────────────
async function partFacilities(b) {
  const p = b.page;
  const o = oracleOf('tier_full');
  const facDir = path.join(ORACLE, 'facilities-wa');
  const files = fs.readdirSync(facDir).filter(f => f.endsWith('.csv')).map(f => path.join(facDir, f));
  // Requests to Esri answered by the suite (a synthetic picture), or refused.
  let mode = 'ok';
  const seen = [];
  const handler = async m => {
    if (m.method !== 'Fetch.requestPaused' || m.sessionId !== b.sid) return;
    const url = m.params.request.url;
    seen.push(url);
    if (mode === 'fail') {
      await b.send('Fetch.failRequest', { requestId: m.params.requestId, errorReason: 'Failed' }, b.sid);
      return;
    }
    const isExport = /\/export\?/.test(url);
    const size = isExport ? (url.match(/size=(\d+),(\d+)/) || []).slice(1).map(Number) : [256, 256];
    const body = syntheticPng(size[0], size[1], isExport ? 'satellite' : 'tile').toString('base64');
    await b.send('Fetch.fulfillRequest', { requestId: m.params.requestId, responseCode: 200, body,
      responseHeaders: [{ name: 'Content-Type', value: 'image/png' }, { name: 'Access-Control-Allow-Origin', value: '*' }] },
    b.sid);
  };
  b.listeners.push(handler);
  await b.send('Fetch.enable', { patterns: [{ urlPattern: '*server.arcgisonline.com*' }] }, b.sid);
  b.answered = url => /^https:\/\/server\.arcgisonline\.com\//.test(url);
  const DL = path.join(OUT, 'downloads');
  fs.rmSync(DL, { recursive: true, force: true });
  fs.mkdirSync(DL, { recursive: true });
  await b.send('Browser.setDownloadBehavior', { behavior: 'allowAndName', downloadPath: DL, eventsEnabled: true });

  await p.goto(INFRA);
  await p.waitFor('window.WSDA && WSDA.infrastructure && WSDA.infrastructureBranded', 15000, 'dashboard ready');
  await p.viewport(1400, 1000);
  await p.setFiles('#files-input', files.concat([path.join(ROOT, o.file)]));
  await p.waitFor('WSDA.infrastructure.state.facilityFiles === 5 && WSDA.infrastructure.state.master && ' +
    '!WSDA.infrastructure.state.loading', 30000, 'files loaded');
  await sleep(500);
  await p.eval(`(() => { document.getElementById('export-section').open = true; return true; })()`);

  const S = 'WSDA.infrastructure.state';
  const setLayers = keys => p.eval(`(() => {
    document.getElementById('infrastructure-layers-clear').click();
    for (const k of ${JSON.stringify(keys)}) {
      const box = [...document.querySelectorAll('#facility-controls input[type=checkbox]')].find(i => i.value === k);
      if (box && !box.checked) box.click();
    }
    return ${S}.result.layers.map(l => l.key); })()`);
  const choose = (name, v) => p.eval(`(() => { const r = document.querySelector('input[name="${name}"][value="${v}"]');
    r.click(); return r.checked; })()`);
  const pick = (id, v) => p.eval(`(() => { const s = document.getElementById('${id}'); s.value = ${JSON.stringify(v)};
    s.dispatchEvent(new Event('change')); s.dispatchEvent(new Event('input')); return true; })()`);
  const preview = async () => {
    const t0 = Date.now();
    await p.eval(`document.getElementById('preview-facilities').click(); true`);
    await p.waitFor(`!document.getElementById('preview-facilities').disabled && (CVIWA.previews.isOpen() ||
      !document.getElementById('preview-message').hidden)`, 60000, 'preview drawn');
    const ms = Date.now() - t0;
    const r = await p.eval(`(async () => {
      const open = CVIWA.previews.isOpen();
      const made = open ? ${S}.lastPreview : null;
      const url = made ? await new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result);
        r.readAsDataURL(made.blob); }) : null;
      const img = open ? document.querySelector('#preview-body img') : null;
      if (open) CVIWA.previews.close();
      const msg = document.getElementById('preview-message');
      const m = made ? made.model : null;
      return { open, url, alt: img && img.alt, caption: open && document.querySelector('#preview-body figcaption').textContent,
        message: msg.hidden ? null : msg.textContent, last: JSON.parse(JSON.stringify({
          coverage: m && m.coverage, title: m && m.title, fileName: m && m.fileName, tiles: m && m.tiles,
          markerNames: m && m.markerNames, background: m && m.background, basemap: m && m.basemap,
          dpi: made && made.dpi, notices: made && made.notices, chrome: m && m.chrome,
          underlay: ${S}.lastFacilitiesPng && ${S}.lastFacilitiesPng.underlay })) };
    })()`);
    r.ms = ms;
    r.png = r.url ? pngInfo(Buffer.from(r.url.split(',')[1], 'base64')) : null;
    return r;
  };
  const download = () => new Promise(res => {
    const h = m => {
      if (m.method === 'Browser.downloadProgress' && (m.params.state === 'completed' || m.params.state === 'canceled')) {
        clearTimeout(t);
        b.listeners.splice(b.listeners.indexOf(h), 1);
        res({ state: m.params.state, guid: m.params.guid });
      }
    };
    const t = setTimeout(() => { b.listeners.splice(b.listeners.indexOf(h), 1); res({ state: 'timeout' }); }, 60000);
    b.listeners.push(h);
  });
  const exportNow = async () => {
    const dl = download();
    await p.eval(`document.getElementById('run-export').click(); true`);
    const got = await dl;
    await p.waitFor(`!document.getElementById('run-export').disabled`, 30000, 'export finished');
    const info = await p.eval(`(() => ({ name: ${S}.lastExport && ${S}.lastExport.name,
      result: document.getElementById('export-result').textContent }))()`);
    return Object.assign(info, { entries: got.state === 'completed' ? readZip(fs.readFileSync(path.join(DL, got.guid))) : [] });
  };
  const two = n => String(n).padStart(2, '0');
  const d = new Date();
  const today = d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate());
  const dpiOf = info => info && info.ppm ? Math.round(info.ppm * 0.0254) : null;
  const shots = [];

  // The PNG map style's choices (CVI's "PNG coverage view"): Density grayed or not, which one is ticked, the reason
  // shown.
  const coverage = () => p.eval(`(() => {
    const d = document.querySelector('input[name="coverage"][value="density"]');
    const on = document.querySelector('input[name="coverage"]:checked');
    const reason = document.getElementById('coverage-reason');
    return { densityDisabled: d.disabled, checked: on && on.value, reason: reason.hidden ? null : reason.textContent,
      rampHidden: document.getElementById('ramp-field').hidden };
  })()`);
  const REASON = 'Density needs exactly one facility layer shown and CVI activity off; the PNG uses Locations.';

  // Every layer on (the dashboard's start): Density grayed with its reason, Locations drawn with no notice (CVI
  // keeps Density clickable and shows its fallback notice).
  const all = await setLayers(['slaughterhouses', 'fairgrounds', 'markets', 'feedlots', 'restricted']);
  check(all.length === 5, 'facilities: five layers shown', all);
  let cv = await coverage();
  check(cv.densityDisabled && cv.checked === 'locations' && cv.reason === REASON && cv.rampHidden,
    'coverage: five layers: Density grayed with the reason, Locations ticked, no Density map color', cv);
  let r = await preview();
  check(r.open && r.last.coverage === 'locations' && !r.message, 'coverage: five layers: Locations drawn, no fallback notice',
    [r.last.coverage, r.message]);
  check(r.png && r.png.width === 2200 && r.png.height === 1700 && dpiOf(r.png) === 200, 'facilities: Branded 2200 x 1700 ' +
    'at 200 dpi', r.png);
  check(r.caption === 'CVI_Facilities_' + today + '.png' && r.alt === 'FACILITIES BY COUNTY', 'facilities: the preview ' +
    'names CVI\'s file and the title', [r.caption, r.alt]);
  check(r.ms < 3000, 'facilities: Branded preview within 3 seconds (Standard)', r.ms);
  // Feedlots in the guide's Blue Green (CVI: #0097a7).
  const tiles = await p.eval(PIXELS(r.url, [{ name: 'feedlots', x: 0.005, y: 0.12, w: 0.76, h: 0.06, color: '#0094aa', tol: 2 },
    { name: 'markets', x: 0.005, y: 0.12, w: 0.76, h: 0.06, color: '#f07325', tol: 2 }]));
  check(tiles.feedlots > 0.05 && tiles.markets > 0.05, 'facilities: the layers\' tiles in the picture', tiles);
  shots.push({ scen: 'locations_all', url: r.url });

  // One layer: Density again (the pick comes back), no notice; Grant's darkest class and the Dark Teal tiles.
  await setLayers(['feedlots']);
  cv = await coverage();
  check(!cv.densityDisabled && cv.checked === 'density' && cv.reason === null && !cv.rampHidden,
    'coverage: one layer: Density available and ticked again, the reason gone', cv);
  r = await preview();
  check(r.open && r.last.coverage === 'density' && !r.message, 'facilities: Density with one layer, no notice', r.message);
  check(JSON.stringify(r.last.tiles.map(t => t.value)) === JSON.stringify(['20', '8 of 39', 'Grant: 6']),
    'facilities: the Density tiles (Facilities, Counties covered, Busiest county)', r.last.tiles);
  const dens = await p.eval(PIXELS(r.url, [{ name: 'grant', x: 0, y: 0.2, w: 0.77, h: 0.78, color: '#1c6fa8', tol: 1 },
    { name: 'teal', x: 0.26, y: 0.12, w: 0.5, h: 0.06, color: '#245566', tol: 1 }]));
  check(dens.grant > 0.005 && dens.teal > 0.3, 'facilities: the darkest class and the Dark Teal tiles drawn', dens);
  shots.push({ scen: 'density', url: r.url });
  await pick('export-ramp', 'gold');
  r = await preview();
  const gold = await p.eval(PIXELS(r.url, [{ name: 'grant', x: 0, y: 0.2, w: 0.77, h: 0.78, color: '#c8892a', tol: 1 }]));
  check(gold.grant > 0.005, 'facilities: Density map color Gold drawn', gold);
  await pick('export-ramp', 'blue');
  // A Locations pick is kept through a spell with Density grayed.
  await choose('coverage', 'locations');
  await setLayers(['feedlots', 'markets']);
  await setLayers(['feedlots']);
  cv = await coverage();
  check(!cv.densityDisabled && cv.checked === 'locations' && cv.rampHidden, 'coverage: the Locations pick kept', cv);
  await choose('coverage', 'density');

  // Report: 1300 x 660 at 200 dpi; High: 1950 x 990 at 300 dpi; Branded High: 3300 x 2550.
  await choose('output-style', 'report');
  r = await preview();
  check(r.png && r.png.width === 1300 && r.png.height === 660 && dpiOf(r.png) === 200 && r.last.chrome === 'report',
    'facilities: Report 1300 x 660 at 200 dpi', r.png);
  shots.push({ scen: 'report_density', url: r.url });
  await pick('export-resolution', 'high');
  r = await preview();
  check(r.png && r.png.width === 1950 && r.png.height === 990 && dpiOf(r.png) === 300, 'facilities: Report High 1950 x 990 ' +
    'at 300 dpi', r.png);
  await choose('output-style', 'branded');
  r = await preview();
  check(r.png && r.png.width === 3300 && r.png.height === 2550 && dpiOf(r.png) === 300, 'facilities: Branded High ' +
    '3300 x 2550 at 300 dpi', r.png);
  check(r.ms < 6000, 'facilities: Branded preview within 6 seconds (High)', r.ms);
  await pick('export-resolution', 'standard');

  // Export: one ZIP, the folder, the PNG with the preview's bytes, export_params.json.
  const before = await preview();
  const ex = await exportNow();
  const names = ex.entries.map(e => e.name);
  const folder = today + '_Facilities';
  check(ex.name === folder + '.zip' && JSON.stringify(names) === JSON.stringify([folder + '/', folder + '/CVI_Facilities_' +
    today + '.png', folder + '/export_params.json']), 'facilities: the ZIP holds the folder, the PNG and export_params.json',
  [ex.name, names]);
  const pngEntry = ex.entries.find(e => e.name.endsWith('.png'));
  check(pngEntry && before.url && Buffer.compare(pngEntry.data, Buffer.from(before.url.split(',')[1], 'base64')) === 0,
    'facilities: the exported PNG has the preview\'s bytes');
  const params = JSON.parse((ex.entries.find(e => e.name.endsWith('.json')) || { data: Buffer.from('{}') }).data.toString());
  check(params.map === 'facilities' && params.output_style === 'branded' && params.png_coverage_view === 'density' &&
    params.coverage_drawn === 'density' && params.png_resolution === 'standard' && params.png_background === 'standard' &&
    JSON.stringify(params.facility_layers) === '["feedlots"]' && params.cvi_activity === null,
  'facilities: export_params.json names the choices', params);
  check(/^Facilities PNG exported\./.test(ex.result), 'facilities: the export result', ex.result);
  await pick('export-label', 'My synthetic map');
  const ex2 = await exportNow();
  check(ex2.name === today + '_My_synthetic_map.zip', 'facilities: Optional Filename names the ZIP as CVI\'s folder', ex2.name);
  await pick('export-label', '');

  // Name markers and the custom title.
  await setLayers(['slaughterhouses', 'fairgrounds', 'markets', 'feedlots', 'restricted']);
  await choose('coverage', 'locations');
  const nm = await p.eval(`(() => { const boxes = [...document.querySelectorAll('#export-name-list input')];
    boxes.forEach(i => { if (['markets', 'restricted'].includes(i.value) !== i.checked) i.click(); });
    return { offered: boxes.map(i => i.value), picked: ${S}.nameLayers }; })()`);
  check(nm.offered.length === 5 && JSON.stringify(nm.picked.slice().sort()) === '["markets","restricted"]',
    'facilities: Name markers in PNG lists the five layers', nm);
  await pick('export-title', '  Synthetic facilities map  ');
  r = await preview();
  const lone = (r.last.markerNames || []).map(x => x.lines.join(' '));
  check(lone.length === 12 && lone.includes('Synthetic Market 3') && !lone.includes('Synthetic Market 1') &&
    lone.includes('Synthetic Holding Facility 1'), 'facilities: the lone facilities of the picked layers named', lone);
  check(r.last.title === 'Synthetic facilities map', 'facilities: the custom title, trimmed', r.last.title);
  shots.push({ scen: 'names', url: r.url });
  await pick('export-title', '');
  await p.eval(`document.getElementById('export-names-clear').click(); true`);

  // CVI activity: its title, the Total Animals tile first, in gold.
  await p.eval(`(() => { const c = document.getElementById('activity-on'); if (!c.checked) c.click(); return true; })()`);
  await sleep(300);
  r = await preview();
  check(r.last.title === 'WASHINGTON FACILITIES + CVI ACTIVITY – ALL SPECIES' && r.last.tiles[0].label === 'Total Animals' &&
    r.last.tiles[0].color === '#c8842c', 'facilities: CVI activity\'s title and Total Animals tile', [r.last.title, r.last.tiles[0]]);
  shots.push({ scen: 'cvi', url: r.url });
  // One layer with CVI activity on: Density grayed with the reason.
  await setLayers(['feedlots']);
  cv = await coverage();
  check(cv.densityDisabled && cv.checked === 'locations' && cv.reason === REASON, 'coverage: CVI activity on: Density grayed', cv);
  r = await preview();
  check(r.open && r.last.coverage === 'locations' && !r.message, 'coverage: CVI activity on: Locations drawn, no notice',
    [r.last.coverage, r.message]);
  await setLayers(['slaughterhouses', 'fairgrounds', 'markets', 'feedlots', 'restricted']);
  await p.eval(`(() => { const c = document.getElementById('activity-on'); if (c.checked) c.click(); return true; })()`);

  // A tile background answered by the suite, then refused: the Default background and the notice (in a public copy,
  // no Esri background offered).
  if (await publicCopy(p)) {
    const none = await noEsriOffered(p, 'export-background');
    check(none.ok, 'facilities: public copy: no Esri background offered', none.opts);
  } else {
    await pick('export-background', 'raster:esri_satellite');
    seen.length = 0;
    r = await preview();
    check(r.open && r.last.background === 'raster:esri_satellite' && r.last.underlay && r.last.underlay.how === 'export' &&
      r.last.basemap === 'Source: Esri, Maxar, Earthstar Geographics' && seen.some(u => /bboxSR=3857/.test(u)),
    'facilities: Satellite drawn from the export image, credited', r.last);
    mode = 'fail';
    r = await preview();
    check(r.open && r.last.background === 'standard' && r.message === 'The Satellite background could not be loaded, so the ' +
      'Default background was used.', 'facilities: a refused background falls back to Default with a notice', r.message);
    mode = 'ok';
    await pick('export-background', 'standard');
  }

  // No layer: CVI's message, no dialog.
  await setLayers([]);
  r = await preview();
  check(!r.open && r.message === 'Select at least one facility layer before previewing.', 'facilities: CVI\'s message ' +
    'without a layer', r.message);

  await b.send('Fetch.disable', {}, b.sid);
  b.listeners.splice(b.listeners.indexOf(handler), 1);
  await b.send('Browser.setDownloadBehavior', { behavior: 'default' });

  const out = {};
  return out;
}
// ── Part: the time-series GIF (S10) ───────────────────────────────────────────────────────────────────────────
// A GIF read by Chrome's own decoder (ImageDecoder): frame count, loop, each frame's size and duration, and for the
// frames asked, the share of pixels equal to the page's PNG step drawing of the same page (B.pixels), the largest
// channel difference, and whether the header's Dark Teal is exact.
const GIF_DECODE = (b64, compare) => `(async () => {
  const bin = atob(${JSON.stringify(b64)});
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const dec = new ImageDecoder({ data: bytes, type: 'image/gif' });
  await dec.tracks.ready;
  await dec.completed;
  const track = dec.tracks.selectedTrack;
  // Infinity (loop forever) as text, so it survives JSON.
  const out = { frameCount: track.frameCount, repetitionCount: String(track.repetitionCount), frames: [] };
  const B = WSDA.branded, size = CVIWA.timeseries.size(), parts = CVIWA.state.lastGif.parts;
  for (let i = 0; i < track.frameCount; i++) {
    const { image } = await dec.decode({ frameIndex: i });
    const fr = { width: image.displayWidth, height: image.displayHeight, duration: image.duration };
    if (${JSON.stringify(compare)}.includes(i)) {
      const cv = document.createElement('canvas');
      cv.width = image.displayWidth;
      cv.height = image.displayHeight;
      const ctx = cv.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(image, 0, 0);
      const got = ctx.getImageData(0, 0, cv.width, cv.height).data;
      const want = (await B.pixels(B.svg(parts[i], size), size)).data;
      let same = 0, worst = 0, teal = 0, tealAll = 0;
      for (let k = 0; k < got.length; k += 4) {
        const d = Math.max(Math.abs(got[k] - want[k]), Math.abs(got[k + 1] - want[k + 1]), Math.abs(got[k + 2] - want[k + 2]));
        if (d === 0) same++;
        if (d > worst) worst = d;
        if (want[k] === 0x24 && want[k + 1] === 0x55 && want[k + 2] === 0x66) {
          tealAll++;
          if (d === 0) teal++;
        }
      }
      fr.sameShare = same / (got.length / 4);
      fr.worst = worst;
      fr.tealExact = tealAll ? teal / tealAll : null;
    }
    image.close();
    out.frames.push(fr);
  }
  dec.close();
  return out;
})()`;
// The frames asked, decoded by Chrome, as PNG data URLs (for the saved pictures).
const GIF_FRAME_URLS = (b64, which) => `(async () => {
  const bin = atob(${JSON.stringify(b64)});
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const dec = new ImageDecoder({ data: bytes, type: 'image/gif' });
  await dec.tracks.ready;
  await dec.completed;
  const out = [];
  for (const i of ${JSON.stringify(which)}) {
    const { image } = await dec.decode({ frameIndex: i });
    const cv = document.createElement('canvas');
    cv.width = image.displayWidth;
    cv.height = image.displayHeight;
    cv.getContext('2d').drawImage(image, 0, 0);
    image.close();
    out.push(cv.toDataURL('image/png'));
  }
  dec.close();
  return out;
})()`;
// The export controls and download watching the GIF parts share: { DL, download, formats, interval, shown, watch,
// unwatch, exportNow }.
async function gifTools(b) {
  const p = b.page;
  const DL = path.join(OUT, 'downloads');
  fs.rmSync(DL, { recursive: true, force: true });
  fs.mkdirSync(DL, { recursive: true });
  await b.send('Browser.setDownloadBehavior', { behavior: 'allowAndName', downloadPath: DL, eventsEnabled: true });
  // The next download, or { state: 'timeout' } after ms.
  const download = ms => new Promise(res => {
    let name = null;
    const h = m => {
      if (m.method === 'Browser.downloadWillBegin') name = m.params.suggestedFilename;
      if (m.method === 'Browser.downloadProgress' && (m.params.state === 'completed' || m.params.state === 'canceled')) {
        clearTimeout(t);
        b.listeners.splice(b.listeners.indexOf(h), 1);
        res({ state: m.params.state, guid: m.params.guid, name });
      }
    };
    const t = setTimeout(() => { b.listeners.splice(b.listeners.indexOf(h), 1); res({ state: 'timeout', name }); }, ms);
    b.listeners.push(h);
  });
  const formats = list => p.eval(`(() => { document.querySelectorAll('input[name=export-format]').forEach(i => {
    if (!i.disabled) i.checked = ${JSON.stringify(list)}.includes(i.value); });
    document.getElementById('export-gif').dispatchEvent(new Event('change')); return true; })()`);
  const interval = v => p.eval(`(() => { const s = document.getElementById('export-gif-by'); s.value = '${v}';
    s.dispatchEvent(new Event('change')); return true; })()`);
  const shown = id => p.eval(`(() => { const e = document.getElementById('${id}');
    return !e.hidden && !e.closest('[hidden]') && e.getClientRects().length > 0; })()`);
  // Watches the progress line and the page's responsiveness during an export: every text the line shows, and the
  // longest gap between ticks of a 20 ms timer.
  const watch = () => p.eval(`(() => {
    const w = window.__gifWatch = { texts: [], maxGap: 0, last: performance.now() };
    const t = document.getElementById('gif-progress-text');
    w.obs = new MutationObserver(() => { if (t.textContent && w.texts[w.texts.length - 1] !== t.textContent) w.texts.push(t.textContent); });
    w.obs.observe(t, { childList: true, characterData: true, subtree: true });
    w.timer = setInterval(() => { const n = performance.now(); w.maxGap = Math.max(w.maxGap, n - w.last); w.last = n; }, 20);
    return true; })()`);
  const unwatch = () => p.eval(`(() => { const w = window.__gifWatch; w.obs.disconnect(); clearInterval(w.timer);
    return { texts: w.texts, maxGap: Math.round(w.maxGap) }; })()`);
  const exportNow = async () => {
    const dl = download(120000);
    const t0 = Date.now();
    await p.eval(`document.getElementById('run-export').click(); true`);
    const got = await dl;
    await p.waitFor('!CVIWA.state.exporting', 120000, 'export finished');
    const ms = Date.now() - t0;
    return { ms, entries: got.state === 'completed' ? readZip(fs.readFileSync(path.join(DL, got.guid))) : [] };
  };
  return { DL, download, formats, interval, shown, watch, unwatch, exportNow };
}
// Every frame decoded by Chrome, drawn width pixels wide, as JPEG data URLs (for the saved pictures).
const GIF_FRAME_THUMBS = (b64, width) => `(async () => {
  const bin = atob(${JSON.stringify(b64)});
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const dec = new ImageDecoder({ data: bytes, type: 'image/gif' });
  await dec.tracks.ready;
  await dec.completed;
  const out = [];
  for (let i = 0; i < dec.tracks.selectedTrack.frameCount; i++) {
    const { image } = await dec.decode({ frameIndex: i });
    const cv = document.createElement('canvas');
    cv.width = ${width};
    cv.height = Math.round(${width} * image.displayHeight / image.displayWidth);
    cv.getContext('2d').drawImage(image, 0, 0, cv.width, cv.height);
    image.close();
    out.push(cv.toDataURL('image/jpeg', 0.9));
  }
  dec.close();
  return out;
})()`;
async function partGif(b) {
  const p = b.page;
  const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
  const { DL, download, formats, interval, shown, watch, unwatch, exportNow } = await gifTools(b);
  const o = oracleOf('tier_full');
  const ref = o.views.gif || {};
  await openPage(b);
  await p.viewport(1400, 1000);
  await loadMaster(p, path.join(ROOT, o.file));
  await p.eval(`(() => { document.getElementById('export-section').open = true; return true; })()`);
  const out = {};

  // The controls: the box on every view (the WA State and County Focus GIF); the interval only while it is ticked;
  // the pick kept when the view changes.
  await showView(p, 'wa');
  check(await shown('export-gif') && !(await shown('export-gif-by')), 'gif: WA State offers the GIF, interval hidden');
  await showView(p, 'flow');
  check(await shown('export-gif') && !(await shown('export-gif-by')), 'gif: National Flow offers the GIF, interval hidden');
  check(await p.eval(`document.getElementById('export-gif').checked === false`), 'gif: the GIF is not ticked at first');
  await formats(['branded_gif']);
  check(await shown('export-gif-by') && await p.eval(`document.getElementById('export-gif-by').value === 'quarter'`),
    'gif: ticked, "GIF frame interval" shows, Quarter by default');
  await showView(p, 'focus');
  check(await shown('export-gif') && await shown('export-gif-by') &&
    await p.eval(`document.getElementById('export-gif').checked`), 'gif: on County Focus the pick and the interval stay');
  await showView(p, 'flow');
  check(await p.eval(`document.getElementById('export-gif').checked`), 'gif: back on National Flow, still ticked');

  // Export by quarter and by year: the ZIP, the frames, the progress line, the decoded file.
  for (const by of ['quarter', 'year']) {
    const tag = 'gif: ' + by;
    await formats(['branded_gif']);
    await interval(by);
    await watch();
    const ex = await exportNow();
    const seen = await unwatch();
    const lg = await p.eval(`(() => { const g = CVIWA.state.lastGif; return { specs: g.specs, skipped: g.skipped,
      labels: g.models.map(m => m.frame.label), delays: g.models.map(m => m.frame.delay), frames: g.frames,
      result: document.getElementById('export-result').textContent,
      progressHidden: document.getElementById('gif-progress').hidden }; })()`);
    const refRec = by === 'quarter' ? ref.default : ref.year;
    const gifEntry = ex.entries.find(e => /\.gif$/.test(e.name));
    const wantName = refRec && refRec.gif ? refRec.gif.output_file : null;
    check(gifEntry && wantName && gifEntry.name.endsWith('/' + wantName), tag + ' the ZIP holds CVI\'s file name',
      [ex.entries.map(e => e.name), wantName]);
    const order = ex.entries.map(e => e.name.replace(/^[^/]*\//, '')).filter(n => n && !n.endsWith('/'));
    check(same(order, [wantName, 'export_params.json']), tag + ' only the GIF and export_params.json', order);
    const params = (ex.entries.find(e => e.name.endsWith('/export_params.json')) || { data: Buffer.from('') }).data
      .toString('utf8');
    // One format is written as a plain string, as CVI's jsonlite (auto_unbox) writes it.
    check(params.includes('"formats": "branded_gif",') && params.includes('"gif_frame_interval": "' + by + '",\n  "coordinates": "WGS 84 longitude and latitude (EPSG:4326)",\n  "exported_at"'),
      tag + ' export_params.json names the format and the frame interval', params);
    const drawn = refRec ? refRec.frames.map(f => by === 'year' ? String(f.render.year_filter)
      : f.render.year_filter + '-' + f.render.quarter_filter) : null;
    check(same(lg.specs, refRec.gif.progress.map(x => x.label)) && same(lg.labels, drawn), tag +
      ' frame list and frames as CVI\'s', [lg.specs, lg.labels, drawn]);
    check(same(seen.texts, lg.labels.map((l, i) => 'GIF frame ' + (i + 1) + ' of ' + lg.labels.length + ': ' + l)) &&
      lg.progressHidden, tag + ' "GIF frame i of n: label" for each frame, then hidden', seen.texts);
    check(seen.maxGap < 2000, tag + ' the page answers during the export (longest pause under 2 s)', seen.maxGap);
    check(/^Exported /.test(lg.result) && lg.result.includes(wantName), tag + ' the result lists the GIF', lg.result);
    if (!gifEntry) {
      check(false, tag + ' a GIF in the ZIP to decode');
      continue;
    }
    const last = lg.labels.length - 1;
    const dec = await p.eval(GIF_DECODE(gifEntry.data.toString('base64'), [0, last]));
    check(dec.frameCount === lg.labels.length && dec.repetitionCount === 'Infinity', tag +
      ' Chrome decodes every frame, looping forever', [dec.frameCount, dec.repetitionCount]);
    check(dec.frames.every(f => f.width === 1650 && f.height === 1275), tag + ' every frame 1650 x 1275');
    check(same(dec.frames.map(f => f.duration), lg.delays.map(d => d * 10000)) &&
      dec.frames[last].duration === (last ? 2400000 : 800000) && (last === 0 || dec.frames[0].duration === 800000),
    tag + ' durations 0.8 s, the last 2.4 s', dec.frames.map(f => f.duration));
    for (const i of [0, last]) {
      const f = dec.frames[i];
      check(f.sameShare > 0.97 && f.worst <= 64 && f.tealExact === 1, tag + ' frame ' + (i + 1) +
        ' matches the page drawn by its PNG step (most pixels exact, the header\'s teal exact)',
      { same: f.sameShare, worst: f.worst, teal: f.tealExact });
    }
    out[by] = { ms: ex.ms, bytes: gifEntry ? gifEntry.data.length : null, frames: lg.labels.length,
      maxGap: seen.maxGap, colors: lg.frames.map(f => f.colors), exactPixels: dec.frames.filter(f => f.sameShare)
        .map(f => Math.round(f.sameShare * 10000) / 10000) };
  }

  // Cancel: the export ends with nothing saved.
  await interval('quarter');
  const dl = download(8000);
  await p.eval(`document.getElementById('run-export').click(); true`);
  await p.waitFor(`/GIF frame 2 of/.test(document.getElementById('gif-progress-text').textContent)`, 60000, 'second frame');
  await p.eval(`document.getElementById('gif-cancel').click(); true`);
  await p.waitFor('!CVIWA.state.exporting', 60000, 'export stopped');
  const canceled = await dl;
  const msg = await p.eval(`document.getElementById('export-result').textContent`);
  check(canceled.state === 'timeout' && msg === 'Export canceled; nothing was saved.', 'gif: Cancel saves nothing',
    [canceled.state, msg]);
  // Cancel stops the drawing itself, not only the saving: fewer pages built than frames.
  const built = await p.eval(`CVIWA.state.lastGif.models.length + ' of ' + CVIWA.state.lastGif.specs.length`);
  check(Number(built.split(' of ')[0]) < Number(built.split(' of ')[1]), 'gif: Cancel stops before every frame is drawn', built);
  check(await p.eval(`!document.getElementById('run-export').disabled && document.getElementById('gif-progress').hidden`),
    'gif: after Cancel, Export is ready and the progress line hidden');

  // A 12-frame GIF within 30 seconds: the Full tier's frames repeated to 12, drawn and written by
  // the page's own steps.
  const timing = await p.eval(`(async () => {
    const W = CVIWA, m = W.state.master, TS = W.timeseries;
    const f = { direction: 'inbound', species: m.speciesChoices, speciesSub: [], years: [2024, 2025],
      quarters: ['Q1', 'Q2', 'Q3', 'Q4'], combine: false, scaling: 'log', nBins: 5, palette: 'WSDA Default',
      multiplier: 1, opacity: 0.6 };
    const fr = TS.frames(m, f, 'quarter', W.flow.centers(WSDA_STATE_CENTERS));
    while (fr.frames.length < 12) fr.frames.push(Object.assign({}, fr.frames[fr.frames.length % 8], { label: 'R' + fr.frames.length }));
    const t0 = performance.now();
    const prepared = TS.prepare(fr, { universe: m.speciesChoices, title: '', date: new Date(),
      states: WSDA_US_STATES.states.features, stateLines: true });
    const made = await TS.encode(prepared, {});
    return { ms: Math.round(performance.now() - t0), frames: made.frames.length, bytes: made.blob.size };
  })()`);
  check(timing.frames === 12 && timing.ms < 30000, 'gif: a 12-frame GIF within 30 seconds', timing);
  out.twelve = timing;

  await b.send('Browser.setDownloadBehavior', { behavior: 'default' });
  fs.rmSync(DL, { recursive: true, force: true });
  return out;
}

// ── Part: the WA State and County Focus GIF ──────────────────────────────────────────────────────────────────────
// Elements marked hidden that still take room on the page (a display rule overriding [hidden]).
const HIDDEN_SHOWN = `[...document.querySelectorAll('[hidden]')].filter(e => e.getClientRects().length > 0)
  .map(e => e.id || e.className || e.tagName)`;
async function partViewGif(b) {
  const p = b.page;
  const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
  const out = {};

  // Nothing marked hidden shows: the landing page and the Infrastructure dashboard as they open.
  const others = [['landing page', '../index.html'], ['Infrastructure dashboard', '../infrastructure/index.html']];
  for (const [name, rel] of others) {
    await p.goto(new URL(rel, PAGE).href);
    await p.waitFor(`document.readyState === 'complete'`, 15000, name + ' ready');
    await sleep(500);
    const shownHidden = await p.eval(HIDDEN_SHOWN);
    check(!shownHidden.length, 'viewgif hidden: nothing marked hidden shows on the ' + name, shownHidden);
  }

  const { DL, formats, interval, shown, watch, unwatch, exportNow } = await gifTools(b);
  const o = oracleOf('tier_full');
  await openPage(b);
  await p.viewport(1400, 1000);
  await p.eval(`(() => { document.getElementById('export-section').open = true; return true; })()`);
  const atOpen = await p.eval(HIDDEN_SHOWN);
  check(!atOpen.length, 'viewgif hidden: nothing marked hidden shows on the CVI page before a file is loaded', atOpen);
  // A tip row marked hidden takes no room (the GIF row, the only one the page hides, now shows on every view,
  // so it is marked hidden here for the check and set up again by the page).
  const tipRow = await p.eval(`(() => { const r = document.getElementById('export-gif-row'); r.hidden = true;
    const rects = r.getClientRects().length; CVIWA.state.syncPngControls(); return { rects, back: !r.hidden }; })()`);
  check(tipRow.rects === 0 && tipRow.back, 'viewgif hidden: a tip row marked hidden takes no room', tipRow);
  check(await shown('export-gif') && await p.eval(`!document.getElementById('export-gif').disabled`),
    'viewgif controls: the GIF box offered as the page opens on WA State');
  await loadMaster(p, path.join(ROOT, o.file));
  await p.eval(`(() => { document.getElementById('export-section').open = true; return true; })()`);
  for (const view of ['wa', 'flow', 'focus']) {
    await showView(p, view);
    const shownHidden = await p.eval(HIDDEN_SHOWN);
    check(!shownHidden.length, 'viewgif hidden: nothing marked hidden shows on the CVI page, ' + view, shownHidden);
  }
  // County Focus's notice is hidden again by Reset All.
  await p.eval(`(() => { const n = document.getElementById('fo-fac-notice');
    n.textContent = 'Cleared unavailable attribute selections.'; n.hidden = false; return true; })()`);
  const noticeBefore = await shown('fo-fac-notice');
  await p.eval(`document.getElementById('reset-all').click(); true`);
  await sleep(700);
  check(noticeBefore && !(await shown('fo-fac-notice')), 'viewgif hidden: Reset All hides County Focus\'s notice',
    noticeBefore);
  await showView(p, 'focus');
  await p.eval(`(() => { document.getElementById('export-section').open = true; return true; })()`);

  // The box grayed with its reason while the GIF cannot apply, free again after.
  const box = () => p.eval(`(() => { const g = document.getElementById('export-gif');
    const w = document.getElementById('export-gif-why');
    return { disabled: g.disabled, why: w.hidden ? null : w.textContent, whyShown: w.getClientRects().length > 0 }; })()`);
  const toggle = id => p.eval(`(() => { const i = document.getElementById('${id}'); i.click(); return i.checked; })()`);
  let g = await box();
  check(!g.disabled && g.why === null, 'viewgif controls: County Focus offers the GIF', g);
  await toggle('fo-hide');
  await sleep(300);
  g = await box();
  check(g.disabled && g.whyShown && /Hide CVI circles/.test(g.why),
    'viewgif controls: grayed while the circles are hidden, with the reason', g);
  await toggle('fo-hide');
  await sleep(300);
  g = await box();
  check(!g.disabled && g.why === null, 'viewgif controls: free again when the circles show', g);
  await showView(p, 'wa');
  await toggle('mv-on');
  await sleep(1200);
  g = await box();
  check(g.disabled && g.whyShown && /Show lines between WA counties/.test(g.why),
    'viewgif controls: grayed with the movement lines on, with the reason', g);
  await toggle('mv-on');
  await sleep(1200);
  g = await box();
  check(!g.disabled && g.why === null, 'viewgif controls: free again with the lines off', g);

  // Export on each view by quarter: the ZIP, the progress line, the decoded file, the frames' models.
  const exportGif = async (view, tag, background) => {
    await showView(p, view);
    await p.eval(`(() => { document.getElementById('export-section').open = true;
      const s = document.getElementById('export-background'); s.value = '${background}';
      s.dispatchEvent(new Event('change')); return true; })()`);
    await formats(['branded_gif']);
    await interval('quarter');
    await watch();
    const ex = await exportNow();
    const seen = await unwatch();
    const lg = await p.eval(`(() => { const g = CVIWA.state.lastGif; return { view: g.view, specs: g.specs,
      skipped: g.skipped, labels: g.models.map(m => m.frame.label), delays: g.models.map(m => m.frame.delay),
      legends: g.models.map(m => JSON.stringify(m.legend)), strips: g.models.map(m => m.strip && m.strip.current),
      names: g.models.map(m => (m.labelPlaces || m.names).map(n => [n.name, n.x, n.y])),
      streetNames: g.models.map(m => (m.streetNames || []).map(n => [n.name, n.x, n.y])),
      backgrounds: g.models.map(m => m.background), obstacles: g.obstacles,
      result: document.getElementById('export-result').textContent,
      progressHidden: document.getElementById('gif-progress').hidden }; })()`);
    const gifEntry = ex.entries.find(e => /\.gif$/.test(e.name));
    const want = view === 'wa' ? /\/CVI_County_Map_TimeSeries_2024-2025_INB\+OUT\.gif$/
      : /\/CVI_CountyFocus_TimeSeries_[A-Za-z-]+_[A-Za-z0-9-]+_2024-2025\.gif$/;
    check(gifEntry && want.test(gifEntry.name) && lg.view === view, tag + ' the ZIP holds the GIF under its name',
      ex.entries.map(e => e.name));
    const params = (ex.entries.find(e => e.name.endsWith('/export_params.json')) || { data: Buffer.from('') }).data
      .toString('utf8');
    check(params.includes('"gif_frame_interval": "quarter"'), tag + ' export_params.json names the frame interval');
    check(lg.labels.length > 1 && same(lg.labels, lg.specs.filter(x => !lg.skipped.includes(x))),
      tag + ' one frame per period with rows', [lg.specs, lg.skipped, lg.labels]);
    const wantTexts = ['Preparing the GIF frames…'].concat(lg.labels.map((l, i) => 'GIF frame ' + (i + 1) + ' of ' +
      lg.labels.length + ': ' + l));
    check(same(seen.texts, wantTexts) && lg.progressHidden,
      tag + ' "Preparing the GIF frames…", then "GIF frame i of n: label", then hidden', seen.texts);
    check(seen.maxGap < 2000, tag + ' the page answers during the export (longest pause under 2 s)', seen.maxGap);
    check(lg.legends.every(l => l === lg.legends[0]), tag + ' one legend in every frame');
    check(same(lg.strips, lg.labels), tag + ' every frame has the period strip, its period marked');
    const placeOf = new Map();
    let still = true;
    // Keyed by name and its turn in the frame: a river's name can be written on several of its stretches.
    // County names and Streets' names apart: a town can share its county's name (Asotin).
    for (const frame of lg.names.map(f => f.map(n => ['county ' + n[0], n[1], n[2]]))
      .concat(lg.streetNames.map(f => f.map(n => ['streets ' + n[0], n[1], n[2]])))) {
      const turn = new Map();
      for (const [name, x, y] of frame) {
        const k = name + '#' + (turn.get(name) || 0);
        turn.set(name, (turn.get(name) || 0) + 1);
        if (placeOf.has(k) && placeOf.get(k) !== x + ',' + y) still = still === true ? [k, placeOf.get(k), x + ',' + y] : still;
        placeOf.set(k, x + ',' + y);
      }
    }
    check(still === true && placeOf.size > 0, tag + ' every name keeps one place in every frame', [placeOf.size, still]);
    if (!gifEntry) return { lg, ex };
    const last = lg.labels.length - 1;
    const dec = await p.eval(GIF_DECODE(gifEntry.data.toString('base64'), [0, last]));
    check(dec.frameCount === lg.labels.length && dec.repetitionCount === 'Infinity', tag +
      ' Chrome decodes every frame, looping forever', [dec.frameCount, dec.repetitionCount]);
    check(dec.frames.every(f => f.width === 1650 && f.height === 1275), tag + ' every frame 1650 x 1275');
    check(same(dec.frames.map(f => f.duration), lg.delays.map(d => d * 10000)) && dec.frames[last].duration === 2400000 &&
      dec.frames[0].duration === 800000, tag + ' durations 0.8 s, the last 2.4 s', dec.frames.map(f => f.duration));
    for (const i of [0, last]) {
      const f = dec.frames[i];
      check(f.sameShare > 0.97 && f.worst <= 64 && f.tealExact === 1, tag + ' frame ' + (i + 1) +
        ' matches the page drawn by its PNG step (most pixels exact, the header\'s teal exact)',
      { same: f.sameShare, worst: f.worst, teal: f.tealExact });
    }
    const mid = Math.floor(last / 2);
    const full = await p.eval(GIF_FRAME_URLS(gifEntry.data.toString('base64'), [0, mid, last]));
    const frames = await p.eval(GIF_FRAME_THUMBS(gifEntry.data.toString('base64'), 1080));
    // Before: the branded PNG of the first period with the same choices (each frame drawn as its period's PNG,
    // TS.CVI_OPTIONS), at 150 dpi, the GIF's frame size.
    const before = await p.eval(`(async () => {
      const B = WSDA.branded, built = CVIWA.state.lastGif.plainFirst();
      const size = B.pixelSize(150);
      const blob = await B.png(B.svg(built.parts, size), size, 150);
      return new Promise(res => { const r = new FileReader();
        r.onload = () => res({ url: r.result, label: built.model.frame.label }); r.readAsDataURL(blob); });
    })()`);
    return { lg, ex, gifEntry, full, frames, before, ms: ex.ms, bytes: gifEntry.data.length };
  };
  const wa = await exportGif('wa', 'viewgif wa:', 'standard');
  // A tile background picked: the GIF on Default with the notice (a public copy offers no tile background).
  if (!(await publicCopy(p))) {
    const waTile = await exportGif('wa', 'viewgif wa tiles:', 'raster:esri_satellite');
    check(waTile.lg.backgrounds.every(x => x === 'standard') && /uses the Default background/.test(waTile.lg.result),
      'viewgif wa tiles: a tile background picked, the GIF drawn on Default with the notice', [waTile.lg.backgrounds,
        waTile.lg.result]);
  }
  const focus = await exportGif('focus', 'viewgif focus:', 'vector:streets');
  check(focus.lg.backgrounds.every(x => x === 'vector:streets') && focus.lg.streetNames.some(n => n.length),
    'viewgif focus: Streets drawn in every frame, its names held', focus.lg.backgrounds);
  await p.eval(`(() => { const s = document.getElementById('export-background'); s.value = 'standard';
    s.dispatchEvent(new Event('change')); return true; })()`);
  out.wa = { ms: wa.ms, bytes: wa.bytes, frames: wa.lg.labels.length, obstacles: wa.lg.obstacles };
  out.focus = { ms: focus.ms, bytes: focus.bytes, frames: focus.lg.labels.length, obstacles: focus.lg.obstacles };

  // 12 frames of each view within 30 seconds (the Full tier's frames repeated to 12), drawn and written by the page's
  // own steps.
  for (const view of ['wa', 'focus']) {
    const timing = await p.eval(`(async () => {
      const W = CVIWA, m = W.state.master, TS = W.timeseries;
      const view = '${view}';
      const years = [2024, 2025], quarters = ['Q1', 'Q2', 'Q3', 'Q4'];
      const counties = [...document.querySelectorAll('#fo-counties input')].slice(0, 2).map(i => i.value);
      const f = view === 'wa'
        ? { species: m.speciesChoices, years, quarters, direction: ['Inbound', 'Outbound'], rawSpecies: [],
          mode: 'separate', scaling: 'log', nBins: 5 }
        : { counties, species: m.speciesChoices, rawSpecies: [], years, quarters, direction: 'combined',
          mode: 'overlap', scaling: 'log', nBins: 5 };
      const fr = view === 'wa' ? TS.waFrames(m, f, 'quarter') : TS.focusFrames(m, f, 'quarter');
      const n = fr.frames.length;
      while (fr.frames.length < 12) fr.frames.push(Object.assign({}, fr.frames[fr.frames.length % n], { label: 'R' + fr.frames.length }));
      const t0 = performance.now();
      const input = { universe: m.speciesChoices, title: '', date: new Date(), counties: CVIWA_GEO.counties.features };
      if (view === 'focus') input.frameF = { opacity: 0.8, hideCircles: false };
      const made = await TS.encode(TS.prepareView(view, fr, input), {});
      return { ms: Math.round(performance.now() - t0), frames: made.frames.length, bytes: made.blob.size };
    })()`);
    check(timing.frames === 12 && timing.ms < 30000, 'viewgif timing: 12 ' + view + ' frames within 30 seconds', timing);
    out['twelve_' + view] = timing;
  }

  await b.send('Browser.setDownloadBehavior', { behavior: 'default' });
  fs.rmSync(DL, { recursive: true, force: true });
  return out;
}

// ── Run ────────────────────────────────────────────────────────────────────────────────────────────────────────
(async () => {
  const b = await launch();
  const run = { chrome: b.version, page: PAGE, parts: PARTS, started: new Date().toISOString(), results: {} };
  try {
    for (const part of PARTS) {
      if (part === 'png') run.results.png = await partPng(b);
      else if (part === 'export') run.results.export = await partExport(b);
      else if (part === 'additions') run.results.additions = await partAdditions(b);
      else if (part === 'backgrounds') run.results.backgrounds = await partBackgrounds(b);
      else if (part === 'names') run.results.names = await partNames(b);
      else if (part === 'facilities') run.results.facilities = await partFacilities(b);
      else if (part === 'gif') run.results.gif = await partGif(b);
      else if (part === 'viewgif') run.results.viewgif = await partViewGif(b);
      else throw new Error('Unknown part ' + part);
    }
  } catch (e) {
    failed++;
    failures.push('run stopped: ' + (e && e.stack ? e.stack : e));
  } finally {
    check(!b.log.exceptions.length, 'page: no exceptions', b.log.exceptions);
    check(!b.log.csp.length, 'page: no Content Security Policy reports', b.log.csp);
    // Requests the suite answered itself (the backgrounds part) are not counted.
    // Only the site's own files (file://, the local server or a hosted copy of site/) and in-page addresses.
    const siteBase = new URL('../', PAGE).href;
    const outside = b.log.requests.filter(u => !/^(data:|blob:|about:)/.test(u) && !u.startsWith(siteBase) &&
      !(b.answered && b.answered(u)));
    check(!outside.length, 'page: no request outside the site', outside);
    await b.close();
  }
  run.passed = passed;
  run.failed = failed;
  run.counts = counts;
  run.failures = failures;
  fs.writeFileSync(path.join(OUT, 'run.json'), JSON.stringify(run, null, 1));
  Object.keys(counts).forEach(k => console.log('  ' + k + ': ' + counts[k] + ' checks'));
  failures.slice(0, 40).forEach(f => console.log('FAIL ' + f));
  console.log('S9 browser (' + PARTS.join(', ') + '): ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch(e => {
  console.error(e);
  process.exit(1);
});
