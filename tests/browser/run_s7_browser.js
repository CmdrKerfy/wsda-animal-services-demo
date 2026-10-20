#!/usr/bin/env node
'use strict';
// S7 browser suite: the charts on the CVI page (site/cvi/index.html) in installed Chrome, through the DevTools
// protocol, offline, foreground only (Chrome does not start from a background job). No packages.
//
// Parts (all by default; name some to run only those, for example: node tests/browser/run_s7_browser.js png):
//   png       every chart form drawn to a PNG by the page: PNG bytes, CVI's export size, 150 dpi, a drawing in it
//   layout    Map, Map + charts and Charts in each view at three window sizes: map size, legend, chart placement
//   charts    every chart drawn on the page against its chart model, for each view and measure
//   spotlight click-to-spotlight on the WA State map (click, Enter, Space, Clear, Reset All, Compare) and hover
//   measure   the Measure picker (Unique CVIs grayed without a CVI column) and the same quarter last year
//   subsets   the Partner and Public tiers in every view (top premises grayed without premises coordinates)
//   perf      a 20,000-row master: charts within 1 second of a settled change; Play keeps its frame interval
//   checkpoint the chart panel's "Show charts by:" bar, top-premises card height, 14 pt export text
//   previews  the three preview dialogs against CVI's own preview table and Stats text (S7 fixture, Full tier)
//   exports   the Export button: the downloaded ZIP against CVI's files, folder names, messages, partial export,
//             "Exports this session", the Map View switched while an export or Preview Charts draws
//   special   a species group with HTML and XML special characters, shown as text; a control character in a picture
//
// Usage (repository root, after node tests/synthetic/make_cvi_s7_fixtures.js and the F1 unit run):
//   node tests/browser/run_s7_browser.js [part ...]
//   Hosted mode: node tests/browser/serve_case_strict.js, then
//   S7_PAGE_URL=http://127.0.0.1:8765/cvi/index.html node tests/browser/run_s7_browser.js
// Writes local-test-artifacts/s7/browser/run.json (results) and screens/ (pictures).
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join(ROOT, 'local-test-artifacts', 's7', 'browser');
const PAGE = process.env.S7_PAGE_URL || pathToFileURL(path.join(ROOT, 'site', 'cvi', 'index.html')).href;
const CHROME = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const FIXTURE = path.join(ROOT, 'local-test-artifacts', 's7', 'fixtures', 'cvi_master_s7.csv');
const ALL_PARTS = ['png', 'layout', 'charts', 'spotlight', 'measure', 'subsets', 'perf', 'checkpoint', 'previews',
  'exports', 'special'];
const asked = process.argv.slice(2).filter(a => !a.startsWith('--'));
const PARTS = asked.length ? asked : ALL_PARTS;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Chrome through the DevTools protocol ────────────────────────────────────────────────────────────────────
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
  // An input event that Chrome does not confirm within 20 seconds fails the step instead of stopping the run.
  const sendInput = (method, params) => Promise.race([send(method, params, sid),
    sleep(20000).then(() => { throw new Error(method + ' timed out'); })]);
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
    // The window's inner size, as a user's window would be.
    async viewport(width, height) {
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }, sid);
      await sleep(150);
    },
    // A real mouse click or move at page coordinates.
    async mouse(type, x, y) {
      const base = { x, y, button: 'left', clickCount: 1 };
      if (type === 'click') {
        await sendInput('Input.dispatchMouseEvent', Object.assign({ type: 'mousePressed' }, base));
        await sendInput('Input.dispatchMouseEvent', Object.assign({ type: 'mouseReleased' }, base));
      } else {
        await sendInput('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
      }
    },
    // A real key press (Enter, Space) on the focused element.
    async key(name, code, text) {
      for (const type of ['keyDown', 'keyUp']) {
        const e = { type, key: name, code: name, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code };
        if (type === 'keyDown' && text) e.text = text;
        await sendInput('Input.dispatchKeyEvent', e);
      }
    },
    // The whole page at a given width and height.
    async screenshotFull(file, width, height) {
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }, sid);
      await sleep(200);
      const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true,
        clip: { x: 0, y: 0, width, height, scale: 1 } }, sid);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
    },
    // One part of the page (page coordinates), also beyond the window.
    async screenshotClip(file, clip) {
      const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true,
        clip: Object.assign({ scale: 1 }, clip) }, sid);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
    },
    async screenshot(file) {
      const r = await send('Page.captureScreenshot', { format: 'png' }, sid);
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
  return { version: version.Browser, log, page, close, send, listeners };
}

// ── Checks ─────────────────────────────────────────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
const failures = [];
const counts = {};
function check(ok, name, detail) {
  if (process.env.S7_VERBOSE) console.log((ok ? 'ok   ' : 'FAIL ') + name);   // each check as it happens
  const part = name.split(':')[0];
  counts[part] = (counts[part] || 0) + 1;
  if (ok) {
    passed++;
  } else {
    failed++;
    failures.push(name + (detail === undefined ? '' : ' :: ' + JSON.stringify(detail).slice(0, 500)));
  }
}

// Loads a master CSV through the page's own "Choose File" and waits until every view has computed.
async function loadMaster(page, file) {
  const v = await page.eval('CVIWA.state.version');
  await page.setFiles('#file-input', [file]);
  await page.waitFor('CVIWA.state.master && !CVIWA.state.loading && CVIWA.state.version > ' + v, 20000, 'master loaded');
  await sleep(400);
}

// ── Part: PNG output ───────────────────────────────────────────────────────────────────────────────────────
// Every chart form of the S7 fixture drawn to a PNG by chartsvg.png(), read back by the browser: the PNG signature,
// CVI's export size, and a drawing in it (not a blank picture; colored marks present).
const PNG_PROBE = `(async () => {
  const W = window.CVIWA, m = CVIWA.state.master;
  const years = m.yearChoices.slice(), quarters = ['Q1', 'Q2', 'Q3', 'Q4'];
  const opts = { measure: 'animals', compare: 'previous', years: years.map(String), quarters };
  const rowsWa = W.summary.mapRows(m, { species: m.speciesChoices.slice(), years, quarters,
    direction: ['Inbound', 'Outbound'], rawSpecies: [] }) || [];
  const charts = W.charts.chartsFor('wa', { rows: rowsWa }, opts, true);
  const fo = Object.assign(W.focus.resetDefaults(m), { counties: W.focus.countyChoices(m).slice(0, 3) });
  W.charts.chartsFor('focus', { rows: W.focus.summaryRows(m, fo) || [], premises: W.focus.build(m, fo).premises },
    opts, true).forEach(c => charts.push(c));
  const out = [];
  for (const c of charts) {
    const r = { id: c.id, kind: c.kind, want: W.chartsvg.exportSize(c) };
    try {
      const blob = await W.chartsvg.png(c, { caption: 'WA State | test', footer: 'Exported 2026-10-11' });
      const head = new Uint8Array(await blob.slice(0, 8).arrayBuffer());
      r.signature = Array.from(head).join(',') === '137,80,78,71,13,10,26,10';
      // The chunk after IHDR (bytes 33 to 53), checked in Node: pHYs with 150 dpi.
      r.afterIhdr = Array.from(new Uint8Array(await blob.slice(33, 54).arrayBuffer()));
      const img = await createImageBitmap(blob);
      r.size = { width: img.width, height: img.height };
      const cv = document.createElement('canvas');
      cv.width = img.width;
      cv.height = img.height;
      const ctx = cv.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, img.width, img.height).data;
      let ink = 0, colored = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i] < 245 || d[i + 1] < 245 || d[i + 2] < 245) ink++;
        if (Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]) > 60) colored++;
      }
      r.ink = ink / (d.length / 4);
      r.colored = colored / (d.length / 4);
    } catch (e) {
      r.error = String((e && e.message) || e);
    }
    out.push(r);
  }
  return out;
})()`;
async function partPng(b) {
  const p = b.page;
  await p.goto(PAGE);
  await p.waitFor('window.CVIWA && CVIWA.chartsvg && CVIWA.state', 15000, 'page ready');
  await loadMaster(p, FIXTURE);
  const results = await p.eval(PNG_PROBE);
  check(results.length >= 10, 'png: every chart form of the fixture drawn', results.map(r => r.id));
  for (const kind of ['bars', 'bars_by_direction', 'bars_by_panel', 'lines', 'change', 'heatmap']) {
    check(results.some(r => r.kind === kind), 'png: a ' + kind + ' chart drawn');
  }
  results.forEach(r => {
    const name = 'png: ' + r.id + ' (' + r.kind + ')';
    check(!r.error, name + ' drawn without error', r.error);
    if (r.error) return;
    check(r.signature, name + ' is a PNG');
    const after = Buffer.from(r.afterIhdr);
    check(after.readUInt32BE(0) === 9 && after.toString('latin1', 4, 8) === 'pHYs' && after.readUInt32BE(8) === 5905
      && after.readUInt32BE(12) === 5905 && after[16] === 1 && after.readUInt32BE(17) === zlib.crc32(after.subarray(4, 17)),
    name + ' records 150 dpi (pHYs after IHDR, as CVI\'s PNGs)', after.toString('hex'));
    check(r.size.width === r.want.width && r.size.height === r.want.height, name + ' at CVI\'s export size',
      { got: r.size, want: r.want });
    check(r.ink > 0.01, name + ' holds a drawing', r.ink);
    check(r.colored > 0.002, name + ' has colored marks', r.colored);
  });
  return results;
}

// ── Page helpers ───────────────────────────────────────────────────────────────────────────────────────────
async function openPage(b) {
  await b.page.goto(PAGE);
  await b.page.waitFor('window.CVIWA && CVIWA.chartsvg && CVIWA.state && CVIWA.state.mapHandle', 15000, 'page ready');
}
// Map View switched by its button; County Focus gets its first two counties picked (as the reference's scenario).
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
async function setLayout(p, layout) {
  const v = await p.eval('CVIWA.state.chartsVersion');
  await p.eval(`document.querySelector('.layout-switch [data-layout="${layout}"]').click(); true`);
  if (layout !== 'map') await p.waitFor('CVIWA.state.chartsVersion > ' + v, 5000, 'charts drawn');
  await sleep(350);
}
// Where things are on screen, for the view shown.
const GEOMETRY = `(() => {
  const st = CVIWA.state, view = st.view;
  const rect = el => { if (!el || !el.offsetParent) return null; const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
  const frame = view === 'wa' ? document.querySelector('#maps .map-frame') : document.getElementById(view + '-frame');
  const handle = { wa: st.mapHandle, flow: st.flowHandle, focus: st.focusHandle }[view];
  const canvas = handle.map.getCanvas(), container = handle.map.getContainer();
  const legend = document.getElementById({ wa: 'legend-toggle', flow: 'legend-toggle-flow', focus: 'legend-toggle-focus' }[view]);
  const cards = [...document.querySelectorAll('#chart-grid .chart-card')].map(c => {
    const svg = c.querySelector('svg'), box = c.querySelector('.chart-svg');
    return { id: c.dataset.chart, rect: rect(c), svgWidth: svg ? Number(svg.getAttribute('width')) : null,
      boxWidth: box.clientWidth, label: svg ? svg.getAttribute('aria-label') : null };
  });
  return { view, layout: st.layouts[view], below: document.getElementById('view-area').classList.contains('below'),
    mapArea: rect(document.getElementById('map-area')), frame: rect(frame), panel: rect(document.getElementById('chart-panel')),
    canvasWidth: canvas.clientWidth, containerWidth: container.clientWidth, canvasHeight: canvas.clientHeight,
    containerHeight: container.clientHeight, legend: rect(legend), cards,
    pressed: [...document.querySelectorAll('.layout-switch [aria-pressed="true"]')].map(b => b.dataset.layout),
    windowWidth: innerWidth };
})()`;

// ── Part: layouts ──────────────────────────────────────────────────────────────────────────────────────────
// Each layout in each view at 1400 x 1000, 1366 x 768 and 1024 x 600: the map resized and filling
// its area, the legend inside the map, the charts beside the map or under it (below 1,200 px), the Charts layout
// without the map and two charts to a row, each chart drawn at its card's width with its title as text alternative.
const SIZES = [[1400, 1000], [1366, 768], [1024, 600]];
async function partLayout(b) {
  const p = b.page;
  await openPage(b);
  await loadMaster(p, FIXTURE);
  const seen = [];
  for (const view of ['wa', 'focus', 'flow']) {
    await showView(p, view);
    for (const [w, h] of SIZES) {
      await p.viewport(w, h);
      for (const layout of ['map', 'split', 'charts']) {
        await setLayout(p, layout);
        const g = await p.eval(GEOMETRY);
        const name = 'layout: ' + view + ' ' + layout + ' ' + w + 'x' + h;
        seen.push({ name, below: g.below, cards: g.cards.length });
        check(g.pressed.length === 1 && g.pressed[0] === layout, name + ' button pressed', g.pressed);
        if (layout === 'map') {
          check(!g.panel, name + ' no chart panel', g.panel);
        } else {
          check(!!g.panel && g.cards.length === 4, name + ' four charts', g.cards.map(c => c.id));
          g.cards.forEach(c => {
            check(c.svgWidth === Math.max(240, Math.floor(c.boxWidth)), name + ' ' + c.id + ' drawn at its card width',
              [c.svgWidth, c.boxWidth]);
            check(!!c.label && c.label.length > 3, name + ' ' + c.id + ' has a text alternative', c.label);
          });
        }
        if (layout === 'charts') {
          check(!g.mapArea, name + ' maps hidden', g.mapArea);
          check(g.cards.length === 4 && Math.abs(g.cards[0].rect.top - g.cards[1].rect.top) < 1
            && g.cards[1].rect.left > g.cards[0].rect.right, name + ' two charts to a row');
          continue;
        }
        check(!!g.mapArea && !!g.frame, name + ' map shown');
        check(Math.abs(g.canvasWidth - g.containerWidth) <= 1 && Math.abs(g.canvasHeight - g.containerHeight) <= 1,
          name + ' map resized to its area', [g.canvasWidth, g.containerWidth, g.canvasHeight, g.containerHeight]);
        check(g.legend && g.legend.left >= g.frame.left && g.legend.bottom <= g.frame.bottom + 1, name + ' legend inside the map',
          [g.legend, g.frame]);
        if (layout === 'split') {
          const wantBelow = w < 1200;
          check(g.below === wantBelow, name + (wantBelow ? ' charts under the map' : ' charts beside the map'), g.below);
          if (wantBelow) {
            check(g.panel.top >= g.frame.bottom - 1, name + ' panel under the map', [g.panel.top, g.frame.bottom]);
          } else {
            check(g.panel.left >= g.frame.right - 1 && g.panel.width >= 359 && g.panel.width <= 561,
              name + ' panel beside the map, 360 to 560 px wide', [g.panel, g.frame.right]);
            check(g.cards.every(c => Math.abs(c.rect.left - g.cards[0].rect.left) < 1), name + ' one column of charts');
          }
        }
        if (view === 'wa' && h === 1000) await p.screenshot(path.join(OUT, 'screens', view + '_' + layout + '_' + w + 'x' + h + '.png'));
      }
      if (h === 768) {
        for (const layout of ['split', 'charts']) {
          await setLayout(p, layout);
          await p.screenshot(path.join(OUT, 'screens', view + '_' + layout + '_' + w + 'x' + h + '.png'));
        }
      }
    }
    await setLayout(p, 'map');
  }
  await p.viewport(1400, 1000);
  return seen;
}

// ── Part: charts drawn ─────────────────────────────────────────────────────────────────────────────────────
// Every chart drawn on the page against the chart model it was drawn from (charts.js, itself checked against CVI in
// the Node suite): marks, their order, colors and exact values (hover and screen-reader text), the bar labels.
const DRAWN = `(() => {
  const out = [];
  CVIWA.state.charts.charts.forEach(c => {
    const svg = document.querySelector('#chart-grid .chart-card[data-chart="' + c.id + '"] svg');
    const marks = [...svg.querySelectorAll('.chart-mark')];
    const spots = [...svg.querySelectorAll('.chart-spot')];
    // Bar labels as they appear on screen, top to bottom.
    const labels = [...svg.querySelectorAll('text[text-anchor="end"]')]
      .sort((a, b) => Number(a.getAttribute('y')) - Number(b.getAttribute('y'))).map(t => t.textContent);
    out.push({ id: c.id, kind: c.kind, empty: c.empty, title: c.title, svgLabel: svg.getAttribute('aria-label'),
      emptyShown: [...svg.querySelectorAll('text')].some(t => t.textContent === c.empty),
      picks: svg.querySelectorAll('.chart-pick').length,
      marks: marks.map(m => ({ fill: m.getAttribute('fill'), hover: m.getAttribute('data-hover'),
        aria: m.getAttribute('aria-label') })),
      spots: spots.map(s => ({ value: s.getAttribute('data-spot'), hover: s.getAttribute('data-hover'),
        pressed: s.getAttribute('aria-pressed'), tab: s.getAttribute('tabindex'), role: s.getAttribute('role'),
        label: s.querySelector('text').textContent })),
      labels, model: c });
  });
  return out;
})()`;
function expectedMarks(c) {
  if (c.kind === 'bars' || c.kind === 'change') return c.bars.map(b => ({ fill: b.color, hover: b.hover }));
  if (c.kind === 'bars_by_direction') return [].concat(...c.groups.map(g => g.bars.map(b => ({ fill: b.color, hover: b.hover }))));
  if (c.kind === 'bars_by_panel') return [].concat(...c.panels.map(p => p.bars.map(b => ({ fill: b.color, hover: b.hover }))));
  if (c.kind === 'lines') return [].concat(...c.series.map(s => s.values.map((v, i) => ({ fill: s.color, hover: s.hover[i] }))));
  return [];
}
function rowLabels(c) {
  if (c.kind === 'bars' || c.kind === 'change') return c.bars.map(b => b.label);
  if (c.kind === 'bars_by_direction') return c.groups.map(g => g.label);
  if (c.kind === 'bars_by_panel') return [].concat(...c.panels.map(p => p.bars.map(b => b.label)));
  return null;
}
function checkDrawn(drawn, name, clickable) {
  drawn.forEach(d => {
    const n = name + ' ' + d.id;
    check(d.svgLabel.startsWith(d.title), n + ': title is the text alternative', d.svgLabel);
    if (d.empty) {
      check(d.emptyShown && !d.marks.length, n + ': gray message "' + d.empty + '"');
      return;
    }
    const want = expectedMarks(d.model);
    // Since MC every mark a click filters by is a button (.chart-pick) that carries the hover text, as S7's spotlight
    // buttons (.chart-spot, also .chart-pick) do.
    const spotted = d.spots.length > 0 || d.picks > 0;
    if (!spotted) {
      check(d.marks.length === want.length, n + ': one mark per value', [d.marks.length, want.length]);
      check(d.marks.every((m, i) => want[i] && m.fill === want[i].fill), n + ': colors in order');
      check(d.marks.every((m, i) => want[i] && m.hover === want[i].hover && m.aria === want[i].hover),
        n + ': exact values for hover and screen readers', d.marks.slice(0, 3));
    } else {
      check(d.marks.length === want.length && d.marks.every((m, i) => m.fill === want[i].fill), n + ': colors in order');
    }
    const rows = rowLabels(d.model);
    if (rows) {
      check(d.labels.length === rows.length && d.labels.every((l, i) => l === rows[i]
        || (l.endsWith('…') && rows[i].startsWith(l.slice(0, -1)))), n + ': labels top to bottom', [d.labels, rows]);
    }
    const shouldClick = clickable && (d.id === 'top_places' || d.id === 'emerging');
    // Spotlight buttons only on the WA State county charts. Since MC the other charts' marks can be clicked too (chart
    // filters, tests/browser/run_mc_browser.js), so this checks the spotlight buttons only.
    if (!shouldClick) check(!d.spots.length, n + ': no spotlight button', d.spots.length);
    else {
      check(spotted, n + ': county bars are buttons', d.spots.length);
      check(d.spots.every(s => s.role === 'button' && s.tab === '0' && s.label !== 'Non-WA'), n + ': keyboard buttons, never Non-WA');
    }
  });
}
async function partCharts(b) {
  const p = b.page;
  await openPage(b);
  await loadMaster(p, FIXTURE);
  const out = {};
  for (const view of ['wa', 'focus', 'flow']) {
    await showView(p, view);
    await setLayout(p, 'charts');
    for (const measure of ['animals', 'records', 'cvis']) {
      const v = await p.eval('CVIWA.state.chartsVersion');
      await p.eval(`(() => { const s = document.getElementById('chart-measure'); s.value = '${measure}';
        s.dispatchEvent(new Event('change')); return true; })()`);
      await p.waitFor('CVIWA.state.chartsVersion > ' + v, 5000);
      const drawn = await p.eval(DRAWN);
      check(drawn.every(d => d.model && measureInTitle(d, measure)), 'charts: ' + view + ' ' + measure + ' charts use the measure');
      checkDrawn(drawn, 'charts: ' + view + ' ' + measure, view === 'wa');
      out[view + '_' + measure] = drawn.map(d => ({ id: d.id, empty: d.empty, marks: d.marks.length }));
    }
    await p.eval(`(() => { const s = document.getElementById('chart-measure'); s.value = 'animals';
      s.dispatchEvent(new Event('change')); return true; })()`);
    await setLayout(p, 'map');
  }
  return out;
}
// The chart titles name the measure where CVI's would not (charts.js); with animals they are CVI's.
function measureInTitle(d, measure) {
  const t = d.title;
  if (measure === 'animals') return !/CVI records|unique CVIs|Unique CVIs/.test(t);
  if (d.id === 'emerging') return true;   // the measure is in its subtitle
  return measure === 'records' ? /CVI records/.test(t) : /nique CVIs/.test(t);
}

// ── Part: click-to-spotlight and hover ─────────────────────────────────────────────────────────────────────
// On the WA State map, with the Full tier: a click, Enter or Space on a county's bar adds it to
// Spotlight Counties or removes it; the list, the map's spotlight layers and the charts' highlighting agree; Clear
// and Reset All clear it; Reset All leaves the layout and the Measure. Hover shows the exact value and what a click
// does.
const TIER_FULL = path.join(ROOT, 'test-tables', 'tier_full_master.csv');
const TIER_PARTNER = path.join(ROOT, 'test-tables', 'tier_partner_master.csv');
const TIER_PUBLIC = path.join(ROOT, 'test-tables', 'tier_public_master.csv');
const SPOT_STATE = `(() => {
  const st = CVIWA.state, svgOf = id => document.querySelector('#chart-grid .chart-card[data-chart="' + id + '"] svg');
  const buttons = id => [...(svgOf(id) ? svgOf(id).querySelectorAll('.chart-spot') : [])].map(s => ({
    value: s.getAttribute('data-spot'), pressed: s.getAttribute('aria-pressed'),
    faint: !!s.querySelector('rect.chart-mark[fill-opacity]') }));
  const layers = st.mapHandle.layers || {};
  return { spotlight: st.spotlight.slice(),
    ticked: [...document.querySelectorAll('#f-spotlight input:checked')].map(i => i.value),
    top: buttons('top_places'), emerging: buttons('emerging'),
    spotCircles: (layers.circles_spotlight || []).map(f => f.properties.county),
    dimCircles: (layers.circles_dim || []).length, allCircles: (layers.circles || []).length,
    focused: document.activeElement && document.activeElement.classList && document.activeElement.classList.contains('chart-spot')
      ? { chart: document.activeElement.closest('.chart-card').dataset.chart, value: document.activeElement.getAttribute('data-spot') } : null,
    layout: st.layouts.wa, measure: st.chartMeasure };
})()`;
// The center of a county's row in a chart, scrolled into view.
const spotCenter = (chart, value) => `(() => {
  const s = [...document.querySelectorAll('#chart-grid .chart-card[data-chart="${chart}"] .chart-spot')]
    .find(x => x.getAttribute('data-spot') === ${JSON.stringify(value)});
  s.scrollIntoView({ block: 'center' });
  const r = s.querySelector('.chart-hit').getBoundingClientRect();
  return { x: r.left + r.width * 0.6, y: r.top + r.height / 2 };
})()`;
async function settleSpot(p) {
  await sleep(450);   // the map follows after the page's 250 ms pause
  return p.eval(SPOT_STATE);
}
async function partSpotlight(b) {
  const p = b.page;
  await openPage(b);
  await p.viewport(1400, 1000);
  await loadMaster(p, TIER_FULL);
  await showView(p, 'wa');
  await setLayout(p, 'split');
  let s = await p.eval(SPOT_STATE);
  check(s.top.length >= 2, 'spotlight: top counties are buttons', s.top.length);
  const v = s.top[0].value, w = s.top[1].value;

  // Hover: the exact value and what a click does.
  let c = await p.eval(spotCenter('top_places', v));
  await p.mouse('move', c.x, c.y);
  await sleep(100);
  const tip = await p.eval(`(() => { const t = document.getElementById('chart-tip');
    return { shown: !t.hidden, text: t.textContent }; })()`);
  check(tip.shown && tip.text.indexOf(v + ' — ') === 0 && /animals/.test(tip.text), 'spotlight: hover shows the exact values', tip);
  check(tip.text.indexOf('Click to add ' + v + ' to Spotlight Counties.') > 0, 'spotlight: hover says what a click does', tip.text);
  await p.mouse('move', 5, 5);
  await sleep(100);
  check(await p.eval("document.getElementById('chart-tip').hidden"), 'spotlight: hover box goes when the pointer leaves');

  // A click adds the county; the list, map and charts agree.
  await p.mouse('click', c.x, c.y);
  s = await settleSpot(p);
  check(JSON.stringify(s.spotlight) === JSON.stringify([v]), 'spotlight: a click adds the county', s.spotlight);
  check(JSON.stringify(s.ticked) === JSON.stringify([v]), 'spotlight: ticked in Spotlight Counties', s.ticked);
  check(s.spotCircles.length > 0 && s.spotCircles.every(x => x === v) && s.dimCircles > 0 && s.allCircles === 0,
    'spotlight: the map spotlights it', [s.spotCircles, s.dimCircles, s.allCircles]);
  check(s.top.concat(s.emerging).every(x => (x.value === v) === (x.pressed === 'true')), 'spotlight: its bars pressed, others not');
  check(s.top.filter(x => x.value !== v).every(x => x.faint) && !s.top.find(x => x.value === v).faint,
    'spotlight: the other counties drawn faint');
  // A click on the same county removes it.
  c = await p.eval(spotCenter('top_places', v));
  await p.mouse('click', c.x, c.y);
  s = await settleSpot(p);
  check(!s.spotlight.length && !s.ticked.length && s.allCircles > 0 && !s.spotCircles.length,
    'spotlight: a second click removes it', s);
  check(s.top.every(x => x.pressed === 'false' && !x.faint), 'spotlight: no bar pressed or faint');

  // Keyboard: Enter adds, Space removes, the focus stays on the county's button.
  await p.eval(`[...document.querySelectorAll('#chart-grid .chart-card[data-chart="top_places"] .chart-spot')]
    .find(x => x.getAttribute('data-spot') === ${JSON.stringify(w)}).focus(); true`);
  await p.key('Enter', 13, '\r');
  s = await settleSpot(p);
  check(JSON.stringify(s.spotlight) === JSON.stringify([w]), 'spotlight: Enter adds the county', s.spotlight);
  check(s.focused && s.focused.chart === 'top_places' && s.focused.value === w, 'spotlight: focus kept after Enter', s.focused);
  check(await p.eval("!document.getElementById('chart-tip').hidden"), 'spotlight: a focused bar shows its hover box');
  await p.key(' ', 32, ' ');
  s = await settleSpot(p);
  check(!s.spotlight.length, 'spotlight: Space removes it', s.spotlight);
  check(s.focused && s.focused.value === w, 'spotlight: focus kept after Space', s.focused);

  // Two counties, then the list's Clear.
  for (const x of [v, w]) {
    c = await p.eval(spotCenter('top_places', x));
    await p.mouse('click', c.x, c.y);
    await sleep(80);
  }
  s = await settleSpot(p);
  check(JSON.stringify(s.spotlight) === JSON.stringify([v, w]), 'spotlight: two counties in the order clicked', s.spotlight);
  await p.eval("document.querySelector('[data-clear=\"spotlight\"]').click(); true");
  s = await settleSpot(p);
  check(!s.spotlight.length && s.top.every(x => x.pressed === 'false'), 'spotlight: Clear clears the charts too', s.spotlight);

  // Ticking a county in the list presses its bars.
  await p.eval(`(() => { const i = [...document.querySelectorAll('#f-spotlight input')].find(x => x.value === ${JSON.stringify(w)});
    i.checked = true; i.dispatchEvent(new Event('change')); return true; })()`);
  s = await settleSpot(p);
  check(s.top.find(x => x.value === w).pressed === 'true', 'spotlight: a county ticked in the list is pressed in the charts');

  // Reset All clears the spotlight and keeps the layout and the Measure.
  await p.eval(`(() => { const s = document.getElementById('chart-measure'); s.value = 'records';
    s.dispatchEvent(new Event('change')); return true; })()`);
  await p.eval("document.getElementById('reset-all').click(); true");
  s = await settleSpot(p);
  check(!s.spotlight.length && s.top.every(x => x.pressed === 'false'), 'spotlight: Reset All clears it', s.spotlight);
  check(s.layout === 'split' && s.measure === 'records', 'spotlight: Reset All keeps the layout and the Measure', [s.layout, s.measure]);
  check(await p.eval("document.querySelector('.layout-switch [aria-pressed=\"true\"]').dataset.layout === 'split'"),
    'spotlight: the layout switch still shows Map + charts');

  // Compare: the charts go under the two maps, follow the left map, and still spotlight.
  await p.eval(`(() => { const r = document.querySelector('input[name=period-mode][value=compare]');
    r.checked = true; r.dispatchEvent(new Event('change')); return true; })()`);
  await sleep(900);
  // The right map on the earliest year only, so the left map's and the right map's years differ.
  await p.eval(`(() => { const boxes = [...document.querySelectorAll('#f-years-b input')];
    boxes.forEach((i, k) => { if (i.checked !== (k === 0)) { i.checked = k === 0; i.dispatchEvent(new Event('change')); } });
    return true; })()`);
  await sleep(700);
  const cmp = await p.eval(`(() => ({ below: document.getElementById('view-area').classList.contains('below'),
    years: CVIWA.state.charts.opts.years, left: CVIWA.state.years.map(String), right: CVIWA.state.yearsB.map(String) }))()`);
  check(cmp.below, 'spotlight: in Compare the charts are under the maps');
  check(JSON.stringify(cmp.years) === JSON.stringify(cmp.left) && JSON.stringify(cmp.left) !== JSON.stringify(cmp.right),
    'spotlight: in Compare the charts follow the left map', cmp);
  s = await p.eval(SPOT_STATE);
  c = await p.eval(spotCenter('top_places', s.top[0].value));
  await p.mouse('click', c.x, c.y);
  s = await settleSpot(p);
  check(s.spotlight.length === 1, 'spotlight: a click works in Compare too', s.spotlight);
  await p.screenshot(path.join(OUT, 'screens', 'wa_compare_split_1400x1000.png'));
  await p.eval("document.getElementById('reset-all').click(); true");
  await sleep(500);

  // A "Non-WA" bar is never a button. No fixture has a Washington-end county written "N/A", so a copy of the Full
  // tier gets one: an Inbound row with the destination county "N/A" and the most animals, at the top of the chart.
  const lines = fs.readFileSync(TIER_FULL, 'utf8').replace(/\r?\n$/, '').split(/\r?\n/);
  const head = lines[0].split(','), at = name => head.indexOf(name);
  const k = lines.findIndex((l, i) => i > 0 && !/"/.test(l) && l.split(',')[at('Movement')] === 'Inbound');
  const cells = lines[k].split(',');
  cells[at('Dest.County')] = 'N/A';
  cells[at('Total.Animals')] = '99999999';
  lines[k] = cells.join(',');
  const nonWaFile = path.join(OUT, 'non_wa_master.csv');
  fs.writeFileSync(nonWaFile, lines.join('\n') + '\n');
  await p.eval(`(() => { const s = document.getElementById('chart-measure'); s.value = 'animals';
    s.dispatchEvent(new Event('change')); return true; })()`);
  await loadMaster(p, nonWaFile);
  await sleep(500);
  const nonWa = await p.eval(`(() => {
    const svg = document.querySelector('#chart-grid .chart-card[data-chart="top_places"] svg');
    const first = [...svg.querySelectorAll('text[text-anchor="end"]')].sort((a, b) => a.getAttribute('y') - b.getAttribute('y'))[0];
    return { first: first.textContent, buttons: [...svg.querySelectorAll('.chart-spot')].map(s => s.querySelector('text').textContent) };
  })()`);
  check(nonWa.first === 'Non-WA', 'spotlight: the test file puts a Non-WA bar at the top', nonWa.first);
  check(nonWa.buttons.length > 0 && nonWa.buttons.indexOf('Non-WA') < 0, 'spotlight: the Non-WA bar cannot be clicked', nonWa.buttons);
  return { first: v, second: w, nonWa };
}

// ── Part: Measure picker and Emerging comparison ───────────────────────────────────────────────────────────
// Unique CVIs grayed with the reason without a CVI column (the Partner tier); the
// comparison with the same quarter last year names both periods, or says the year is not selected.
async function partMeasure(b) {
  const p = b.page;
  await openPage(b);
  await p.viewport(1400, 1000);
  await loadMaster(p, FIXTURE);
  await showView(p, 'wa');
  await setLayout(p, 'charts');
  const measureState = () => p.eval(`(() => { const o = document.querySelector('#chart-measure option[value="cvis"]'),
    r = document.getElementById('chart-measure-reason');
    return { disabled: o.disabled, reason: r.hidden ? null : r.textContent, value: document.getElementById('chart-measure').value }; })()`);
  let m = await measureState();
  check(!m.disabled && m.reason === null, 'measure: Unique CVIs offered with a CVI column', m);
  await p.eval(`(() => { const s = document.getElementById('chart-measure'); s.value = 'cvis';
    s.dispatchEvent(new Event('change')); return true; })()`);
  await sleep(200);
  check(await p.eval("CVIWA.state.charts.opts.measure === 'cvis'"), 'measure: Unique CVIs drawn');

  // Same quarter last year.
  const setCompare = async value => {
    const v = await p.eval('CVIWA.state.chartsVersion');
    await p.eval(`(() => { const s = document.getElementById('chart-compare'); s.value = '${value}';
      s.dispatchEvent(new Event('change')); return true; })()`);
    await p.waitFor('CVIWA.state.chartsVersion > ' + v, 5000);
    return p.eval(`(() => { const c = CVIWA.state.charts.charts.find(x => x.id === 'emerging'),
      svg = document.querySelector('#chart-grid .chart-card[data-chart="emerging"] svg');
      return { from: c.from, to: c.to, subtitle: c.subtitle, empty: c.empty, label: svg.getAttribute('aria-label'),
        drawn: [...svg.querySelectorAll('text')].map(t => t.textContent) }; })()`);
  };
  let e = await setCompare('last_year');
  const sameQuarter = e.from && e.to && Number(e.from.split(' ')[0]) === Number(e.to.split(' ')[0]) - 1
    && e.from.split(' ')[1] === e.to.split(' ')[1];
  check(!e.empty && sameQuarter && e.subtitle.indexOf(e.from) > 0 && e.subtitle.indexOf(e.to) > 0,
    'measure: same quarter last year names both periods', e);
  check(e.label.indexOf(e.subtitle) > 0, 'measure: the subtitle is in the text alternative', e.label);
  check(e.drawn.indexOf(e.subtitle) >= 0, 'measure: the subtitle is drawn', e.drawn.slice(0, 4));
  // Only the latest year selected: the year before is not there, and the chart says so.
  const latest = await p.eval('CVIWA.state.master.yearChoices.slice(-1)[0]');
  await p.eval(`(() => { [...document.querySelectorAll('#f-years input')].forEach(i => { const on = i.value === '${latest}';
    if (i.checked !== on) { i.checked = on; i.dispatchEvent(new Event('change')); } }); return true; })()`);
  await sleep(600);
  e = await p.eval(`CVIWA.state.charts.charts.find(x => x.id === 'emerging')`);
  check(e.empty && /^Same quarter last year \(\d{4} \S+\) is not in the selected years$/.test(e.empty),
    'measure: says when last year is not selected', e.empty);
  e = await setCompare('previous');
  check(!!e, 'measure: back to the previous quarter');

  // The Partner tier has no CVI column: Unique CVIs grayed with the reason, the picker back on Animals.
  await loadMaster(p, TIER_PARTNER);
  await sleep(400);
  m = await measureState();
  check(m.disabled && m.reason === 'Unique CVIs: Needs the column CVI in the CVI master table.' && m.value === 'animals',
    'measure: Unique CVIs grayed with the reason without a CVI column', m);
  await loadMaster(p, TIER_FULL);
  await sleep(400);
  m = await measureState();
  check(!m.disabled && m.reason === null, 'measure: offered again with the Full tier', m);
  return { lastYear: e };
}

// ── Part: data subsets ─────────────────────────────────────────────────────────────────────────────────────
// The Partner tier (13 columns) and the Public tier: every view's charts draw, matching their models.
async function partSubsets(b) {
  const p = b.page;
  await openPage(b);
  await p.viewport(1400, 1000);
  const out = {};
  for (const [name, file] of [['partner', TIER_PARTNER], ['public', TIER_PUBLIC]]) {
    await loadMaster(p, file);
    for (const view of ['wa', 'focus', 'flow']) {
      await showView(p, view);
      await setLayout(p, 'charts');
      const drawn = await p.eval(DRAWN);
      check(drawn.length === 4, 'subsets: ' + name + ' ' + view + ' four charts');
      checkDrawn(drawn, 'subsets: ' + name + ' ' + view, view === 'wa');
      // These tiers have no premises coordinates: with counties picked, top premises says so and the other charts
      // are drawn.
      if (view === 'focus') {
        const picked = await p.eval('CVIWA.focusState.counties.length');
        const tp = drawn.find(d => d.id === 'top_premises');
        check(picked === 2 && tp && tp.empty === 'Needs premises coordinates (Origin.Lat, Origin.Long, Dest.Lat, Dest.Long)'
          && tp.emptyShown && drawn.filter(d => d.id !== 'top_premises').every(d => !d.empty),
        'subsets: ' + name + ' focus with counties: top premises grayed with the missing coordinates, the others drawn',
        { picked, empty: drawn.map(d => [d.id, d.empty]) });
      }
      out[name + '_' + view] = drawn.map(d => ({ id: d.id, empty: d.empty, marks: d.marks.length }));
      await setLayout(p, 'map');
    }
    await showView(p, 'wa');
  }
  return out;
}

// ── Part: performance ──────────────────────────────────────────────────────────────────────────────────────
// A synthetic 20,000-row master (the Full tier's rows repeated with new CVI numbers): the charts redrawn within
// 1 second of a settled filter change in each view, and Play at its fastest speed keeping its frame interval with
// the charts shown.
function bigMaster() {
  const file = path.join(OUT, 'perf_master_20000.csv');
  const lines = fs.readFileSync(TIER_FULL, 'utf8').replace(/\r?\n$/, '').split(/\r?\n/);
  const head = lines[0], body = lines.slice(1);
  const cviAt = head.split(',').indexOf('CVI');
  const out = [head];
  for (let i = 0; out.length <= 20000; i++) {
    const cells = body[i % body.length].split(',');
    if (cviAt >= 0 && !/"/.test(body[i % body.length])) cells[cviAt] = 'PERF-' + i;
    out.push(cells.join(','));
  }
  fs.writeFileSync(file, out.join('\n') + '\n');
  return file;
}
async function partPerf(b) {
  const p = b.page;
  await openPage(b);
  await p.viewport(1400, 1000);
  await loadMaster(p, bigMaster());
  const rows = await p.eval('CVIWA.state.master.physicalRows');
  check(rows === 20000, 'perf: 20,000 rows loaded', rows);
  const out = {};
  for (const view of ['wa', 'focus', 'flow']) {
    await showView(p, view);
    if (view === 'focus') {
      await p.eval(`(() => { const boxes = [...document.querySelectorAll('#fo-counties input')];
        boxes.forEach(b => { if (!b.checked) { b.checked = true; b.dispatchEvent(new Event('change')); } }); return true; })()`);
      await sleep(1500);
    }
    await setLayout(p, 'split');
    const list = { wa: '#f-quarters', flow: '#fl-quarters', focus: '#fo-quarters' }[view];
    const v = await p.eval('CVIWA.state.chartsVersion');
    const t0 = Date.now();
    await p.eval(`(() => { const i = document.querySelector('${list} input'); i.checked = !i.checked;
      i.dispatchEvent(new Event('change')); return true; })()`);
    await p.waitFor('CVIWA.state.chartsVersion > ' + v, 10000, 'charts redrawn');
    const settled = Date.now() - t0 - 250;   // the page waits 250 ms for the filters to settle
    const ms = await p.eval('CVIWA.state.chartsMs');
    out[view] = { settledMs: settled, drawMs: Math.round(ms) };
    check(settled < 1000, 'perf: ' + view + ' charts within 1 second of a settled filter change', out[view]);
    await setLayout(p, 'map');
  }
  // Play at the fastest speed (2.5 s a frame) on the WA map with the charts shown.
  await showView(p, 'wa');
  await setLayout(p, 'split');
  await p.eval(`(() => { const r = document.querySelector('input[name=period-mode][value=browse]'); r.checked = true;
    r.dispatchEvent(new Event('change')); const s = document.getElementById('time-speed'); s.value = '2500';
    s.dispatchEvent(new Event('change')); const sl = document.getElementById('time-slider'); sl.value = '1';
    sl.dispatchEvent(new Event('input')); return true; })()`);
  await sleep(800);
  const f0 = await p.eval('({ frames: CVIWA.state.frames || 0, charts: CVIWA.state.chartsVersion })');
  await p.eval("document.getElementById('time-play').click(); true");
  const t0 = Date.now();
  await sleep(7900);
  const f1 = await p.eval('({ frames: CVIWA.state.frames || 0, charts: CVIWA.state.chartsVersion, ms: CVIWA.state.chartsMs, playing: CVIWA.state.playing })');
  const frames = f1.frames - f0.frames;
  out.play = { frames, seconds: (Date.now() - t0) / 1000, chartsDrawn: f1.charts - f0.charts, lastDrawMs: Math.round(f1.ms) };
  check(frames === 3, 'perf: Play keeps its 2.5 s frame interval with the charts shown', out.play);
  check(f1.charts - f0.charts >= frames, 'perf: the charts follow every Play frame', out.play);
  check(f1.ms < 2500, 'perf: drawing the charts takes less than a frame', out.play);
  await p.eval("if (CVIWA.state.playing) document.getElementById('time-play').click(); true");
  return out;
}


// ── Part: the chart bar, card height, text size ─────────────────────────────────────────────────────────────────
// "Show charts by:" in a shaded bar across the top of the chart panel (bold label,
// larger control, three named options, in view while the chart column scrolls); the top-premises card about 560 px
// tall; export PNGs with 14 pt text (the page keeps 12 pt). The County Focus folder name is checked in "exports".
async function partCheckpoint(b) {
  const p = b.page;
  await openPage(b);
  await p.viewport(1400, 1000);
  await loadMaster(p, FIXTURE);
  await showView(p, 'wa');
  await setLayout(p, 'split');
  const bar = await p.eval(`(() => {
    const head = document.querySelector('#chart-panel .chart-head'), label = head.querySelector('label'),
      sel = document.getElementById('chart-measure'), grid = document.getElementById('chart-grid');
    const cs = getComputedStyle(head), r = head.getBoundingClientRect(), g = grid.getBoundingClientRect();
    return { label: label.textContent, labelFor: label.htmlFor, labelWeight: getComputedStyle(label).fontWeight,
      labelSize: parseFloat(getComputedStyle(label).fontSize), selectSize: parseFloat(getComputedStyle(sel).fontSize),
      options: [...sel.options].map(o => o.textContent), background: cs.backgroundColor, position: cs.position,
      width: r.width, gridWidth: g.width, aboveCharts: r.bottom <= g.top + 0.5 };
  })()`);
  check(bar.label === 'Show charts by:' && bar.labelFor === 'chart-measure', 'checkpoint: the control reads "Show charts by:"', bar);
  check(JSON.stringify(bar.options) === JSON.stringify(['Animals moved', 'CVI records', 'Unique CVIs']),
    'checkpoint: options Animals moved, CVI records, Unique CVIs', bar.options);
  check(Number(bar.labelWeight) >= 700 && bar.labelSize >= 15 && bar.selectSize >= 15, 'checkpoint: bold label, larger control', bar);
  // --info-bg (Dark Blue 10%, #e8eff3; formerly #e8f0f6).
  check(bar.background === 'rgb(232, 239, 243)', 'checkpoint: the bar is shaded', bar.background);
  check(Math.abs(bar.width - bar.gridWidth) <= 2 && bar.aboveCharts, 'checkpoint: the bar spans the chart panel above the charts', bar);
  // In the scrolling chart column the bar stays at the top.
  const scrolled = await p.eval(`(() => {
    const panel = document.getElementById('chart-panel'); panel.scrollTop = 400;
    const r = document.querySelector('#chart-panel .chart-head').getBoundingClientRect(), q = panel.getBoundingClientRect();
    return { scrollTop: panel.scrollTop, headTop: r.top, panelTop: q.top, sticky: getComputedStyle(document.querySelector('.chart-head')).position };
  })()`);
  check(scrolled.scrollTop > 0 && scrolled.sticky === 'sticky' && Math.abs(scrolled.headTop - scrolled.panelTop) <= 1,
    'checkpoint: the bar stays in view while the chart column scrolls', scrolled);
  await setLayout(p, 'map');

  // The top-premises card on County Focus: 560 px tall.
  await showView(p, 'focus');
  await setLayout(p, 'charts');
  const card = await p.eval(`(() => {
    const svg = document.querySelector('#chart-grid .chart-card[data-chart="top_premises"] svg');
    return { height: Number(svg.getAttribute('height')), drawn: svg.getBoundingClientRect().height,
      other: Number(document.querySelector('#chart-grid .chart-card[data-chart="species"] svg').getAttribute('height')) };
  })()`);
  check(card.height === 560 && card.other === 320, 'checkpoint: the top-premises chart 560 px tall, the others 320', card);
  await setLayout(p, 'map');

  // Text sizes in the SVG of an export PNG (14 pt at 150 dpi) and of the page's chart (12 pt at 96 dpi): CVI's theme
  // gives the title base + 1 pt and the axis text 0.8 of the base.
  const sizes = await p.eval(`(async () => {
    const W = CVIWA, m = CVIWA.state.master, years = m.yearChoices.slice();
    const rows = W.summary.mapRows(m, { species: m.speciesChoices.slice(), years, quarters: ['Q1', 'Q2', 'Q3', 'Q4'],
      direction: ['Inbound', 'Outbound'], rawSpecies: [] }) || [];
    const chart = W.charts.build('species', { rows }, { view: 'wa', measure: 'animals' });
    const Real = window.Blob;
    let markup = null;
    window.Blob = function (parts, o) { if (o && o.type === 'image/svg+xml') markup = parts[0]; return new Real(parts, o); };
    try { await W.chartsvg.png(chart, {}); } finally { window.Blob = Real; }
    const screen = W.chartsvg.svg(chart, { width: 640 });
    const read = svg => {
      const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
      const texts = [...doc.querySelectorAll('text')];
      const title = texts.find(t => t.getAttribute('font-weight') === 'bold');
      const axis = texts.find(t => t.getAttribute('text-anchor') === 'end');
      return { title: Number(title.getAttribute('font-size')), axis: Number(axis.getAttribute('font-size')) };
    };
    return { png: read(markup), screen: read(screen) };
  })()`);
  const near = (a, x) => Math.abs(a - x) <= 0.01;
  check(near(sizes.png.title, 15 * 150 / 72) && near(sizes.png.axis, 11.2 * 150 / 72), 'checkpoint: export PNG text at 14 pt (title 15 pt, axis 11.2 pt)', sizes.png);
  check(near(sizes.screen.title, 13 * 96 / 72) && near(sizes.screen.axis, 9.6 * 96 / 72), 'checkpoint: the page keeps 12 pt (title 13 pt, axis 9.6 pt)', sizes.screen);
  return { bar, scrolled, card, sizes };
}

// ── Helpers for the Export & Preview parts ─────────────────────────────────────────────────────────────────
const ORACLE_S7 = path.join(ROOT, 'local-test-artifacts', 's7', 'oracle_s7_s7.json');
const ORACLE_FULL = path.join(ROOT, 'local-test-artifacts', 's7', 'oracle_s7_tier_full.json');
const listOf = x => (x === null || x === undefined ? [] : Array.isArray(x) ? x : [x]);
const maskGenerated = text => text.replace(/^Generated: .*$/m, 'Generated: TIME');
// The page's Stats text writes the quarters "Q1, Q2" and adds Unique CVIs, a note when WA-to-WA movements count at
// both ends, and the change from the previous quarter (additions by design); this takes them back out, so the rest
// is compared with CVI's text as before.
function cviStatsForm(lines) {
  const out = [];
  let inNote = false, inChange = false;
  for (const l of lines) {
    if (inChange) { if (l === '') inChange = false; continue; }
    if (l.startsWith('CHANGE FROM THE ')) { inChange = true; continue; }
    if (inNote) { if (l === '') { inNote = false; out.push(l); } continue; }
    if (l.startsWith('  Unique CVIs: ')) { inNote = true; continue; }
    out.push(l.startsWith('  Quarters:  ') ? l.replace(/, /g, '') : l);
  }
  return out;
}
const cviStatsText = text => cviStatsForm(text.split('\n')).join('\n');
// The export time masked, and the page's one added line (the coordinate system, a deliberate addition checked in the
// S7 unit suite) left out, so the rest is compared with CVI's file byte for byte.
const maskExported = text => text.replace(/\n  "coordinates": "WGS 84 longitude and latitude \(EPSG:4326\)",/, '')
  .replace(/"exported_at": "[^"]*"/, '"exported_at": "TIME"');
async function openExportSection(p) {
  await p.eval(`(() => { const d = document.getElementById('export-section'); d.open = true;
    d.scrollIntoView(); return true; })()`);
}
// Puts the page's view in a reference scenario's choices (the S7 fixture's scenarios used here): WA State default,
// National Flow inbound, County Focus with two or four counties. Returns the page's choices, to check they match.
async function enterScenario(p, view, rec) {
  if (view === 'focus') {
    await p.eval(`document.getElementById('show-focus').click(); true`);
    await p.waitFor('CVIWA.state.focusHandle && CVIWA.state.focusHandle.ready', 20000, 'focus map ready');
    const want = JSON.stringify(listOf(rec.inputs.intra_counties));
    await p.eval(`(() => { const want = ${want};
      [...document.querySelectorAll('#fo-counties input')].forEach(i => { if (i.checked) { i.checked = false; i.dispatchEvent(new Event('change')); } });
      want.forEach(v => { const i = [...document.querySelectorAll('#fo-counties input')].find(x => x.value === v);
        i.checked = true; i.dispatchEvent(new Event('change')); });
      return true; })()`);
    await sleep(800);
    return p.eval(`(() => { const f = CVIWA.focusState; return { counties: f.counties.slice(), species: f.species.slice().sort(),
      years: f.years.map(String).sort(), quarters: f.quarters.slice().sort(), direction: f.direction }; })()`);
  }
  await showView(p, view);
  if (view === 'flow') {
    await p.eval(`(() => { const c = document.getElementById('fl-combine');
      if (c.checked !== ${rec.inputs.flow_combine_species === true}) { c.checked = !c.checked; c.dispatchEvent(new Event('change')); }
      return true; })()`);
    await sleep(600);
    return p.eval(`(() => { const f = CVIWA.flowState; return { species: f.species.slice().sort(), years: f.years.map(String).sort(),
      quarters: f.quarters.slice().sort(), direction: f.direction, combine: f.combine }; })()`);
  }
  return p.eval(`(() => { const s = CVIWA.state; return { species: s.species.slice().sort(), years: s.years.map(String).sort(),
    quarters: s.quarters.slice().sort(), direction: s.direction.slice().sort() }; })()`);
}
function scenarioMatches(view, got, inp) {
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const sorted = x => listOf(x).map(String).sort();
  if (view === 'wa') {
    return same(got.species, sorted(inp.county_species)) && same(got.years, sorted(inp.county_year))
      && same(got.quarters, sorted(inp.county_quarter)) && same(got.direction, sorted(inp.county_direction));
  }
  if (view === 'flow') {
    return same(got.species, sorted(inp.flow_species)) && same(got.years, sorted(inp.flow_year))
      && same(got.quarters, sorted(inp.flow_quarter)) && got.direction === inp.flow_direction && got.combine === inp.flow_combine_species;
  }
  return same(got.counties, listOf(inp.intra_counties)) && same(got.species, sorted(inp.intra_species))
    && same(got.years, sorted(inp.intra_year)) && same(got.quarters, sorted(inp.intra_quarter)) && got.direction === inp.intra_filter_dir;
}
// The dialog as shown: open or not, title, footer note, and its table or text. A closed dialog gives empty lists, so
// a check after an unexpected close fails instead of stopping the run.
const DIALOG = `(() => {
  const d = document.getElementById('preview-dialog');
  if (!d || !d.open) return { open: false, columns: [], rows: [], info: null, text: null, pictures: [] };
  const table = d.querySelector('.dt-table');
  return { open: true, title: d.querySelector('#preview-title').textContent, note: d.querySelector('#preview-note').textContent,
    columns: table ? [...table.querySelectorAll('thead tr:first-child th')].map(th => th.textContent) : null,
    rows: table ? [...table.querySelectorAll('tbody tr')].map(tr => [...tr.children].map(td => td.textContent)) : null,
    info: table ? d.querySelector('.dt-info').textContent : null,
    text: d.querySelector('.stats-text') ? d.querySelector('.stats-text').textContent : null,
    pictures: [...d.querySelectorAll('.chart-preview')].map(f => ({ file: f.dataset.file, caption: f.querySelector('figcaption').textContent,
      alt: f.querySelector('img').alt, width: f.querySelector('img').naturalWidth, height: f.querySelector('img').naturalHeight,
      complete: f.querySelector('img').complete })),
    focused: document.activeElement ? document.activeElement.id || document.activeElement.className : null };
})()`;
// A button pressed as a user would: focused, then clicked.
async function clickButton(p, id) {
  await p.eval(`(() => { const b = document.getElementById('${id}'); b.focus(); b.click(); return true; })()`);
  await sleep(300);
}
// Every row of the Map Data table, page by page through the Next button.
async function allTableRows(p) {
  const rows = [];
  for (let i = 0; i < 200; i++) {
    const d = await p.eval(DIALOG);
    d.rows.forEach(r => rows.push(r));
    const more = await p.eval(`(() => { const n = [...document.querySelectorAll('#preview-dialog[open] .dt-pager .dt-page')].find(x => x.textContent === 'Next');
      if (!n || n.disabled) return false; n.click(); return true; })()`);
    if (!more) break;
  }
  return rows;
}
// Opens Preview Map Data again if it has closed (a mutant can close it on any click), so the next check still runs.
async function tableShown(p) {
  if (!(await p.eval(`!!(document.getElementById('preview-dialog') || {}).open`))) await clickButton(p, 'preview-table');
}
// Closing the dialog. Escape and a click beside the dialog are sent as page events (an Escape keydown at the element
// with the focus, and a press and click on the dialog element outside its box), not as DevTools key presses or mouse
// clicks: in headless Chrome synthetic input aimed at a modal dialog can leave the page unanswering. The test never
// closes the dialog itself, so the page's own handling is what is checked. Real key presses and clicks are checked by
// hand, in Chrome and Safari.
async function closeDialog(p, how) {
  if (how === 'escape') {
    await p.eval(`(() => { const d = document.getElementById('preview-dialog');
      const at = d.contains(document.activeElement) ? document.activeElement : d;
      at.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); return true; })()`);
  } else if (how === 'backdrop') {
    await p.eval(`(() => { const d = document.getElementById('preview-dialog'), r = d.getBoundingClientRect();
      const at = { bubbles: true, clientX: Math.max(2, r.left / 2), clientY: Math.max(2, r.top / 2) };
      d.dispatchEvent(new PointerEvent('pointerdown', at));
      d.dispatchEvent(new MouseEvent('click', at));
      return true; })()`);
  } else {
    await p.eval(`document.getElementById('${how === 'x' ? 'preview-dialog' : 'preview-close'}')${how === 'x' ? ".querySelector('.preview-x')" : ''}.click(); true`);
  }
  await sleep(250);
  return !(await p.eval(`document.getElementById('preview-dialog').open`));
}
// The charts an export of the view on screen writes (the set in charts.js), with CVI's export sizes.
const EXPECTED_CHARTS = `(() => {
  const W = CVIWA, st = W.state, view = st.view, m = st.master;
  const per = view === 'wa' ? st : view === 'flow' ? W.flowState : W.focusState;
  const fo = Object.assign({}, W.focusState, { rawSpecies: W.focusState.speciesSub });
  const input = view === 'wa' ? { rows: W.summary.mapRows(m, { species: st.species, years: st.years, quarters: st.quarters,
    direction: st.direction, rawSpecies: st.speciesSub }) }
    : view === 'flow' ? { rows: W.flow.mapRows(m, Object.assign({}, W.flowState)) }
    : { rows: W.focus.summaryRows(m, fo), premises: W.focus.build(m, fo).premises,
      missingCoordinates: W.focus.build(m, fo).missingCoordinates };
  const charts = W.charts.chartsFor(view, input, { measure: st.chartMeasure, compare: st.chartCompare,
    years: per.years.map(String), quarters: per.quarters.slice() }, true);
  return charts.map(c => ({ file: W.charts.fileName(c.id, view), size: W.chartsvg.exportSize(c), title: c.title }));
})()`;
const cvText = v => (v === null || v === undefined ? '' : String(v));

// ── Part: previews ─────────────────────────────────────────────────────────────────────────────────────────
// Preview Map Data, Preview Stats and Preview Charts in each view, on the S7 fixture, against CVI's own dialogs in the
// reference (the table's rows as CVI serves them, the Stats text with the time masked, the titles and footers); the
// table's search, column filters, sorting and pages on the Full tier; CVI's messages; closing the dialog.
async function partPreviews(b) {
  const p = b.page;
  const oracle = JSON.parse(fs.readFileSync(ORACLE_S7, 'utf8'));
  await openPage(b);
  await p.viewport(1400, 1000);
  const gate = await p.eval(`(() => ({ disabled: ['preview-table', 'preview-stats', 'preview-charts', 'run-export']
    .map(id => document.getElementById(id).disabled), reason: document.getElementById('export-gate-reason').textContent,
    shown: !document.getElementById('export-gate-reason').hidden, open: document.getElementById('export-section').open }))()`);
  check(gate.disabled.every(Boolean) && gate.shown && gate.reason === 'Load a master dataset.',
    'previews: grayed with the reason before a master is loaded', gate);
  check(gate.open === false, 'previews: the section is closed when the page opens, as CVI\'s', gate.open);
  await loadMaster(p, FIXTURE);
  const ready = await p.eval(`['preview-table', 'preview-stats', 'preview-charts', 'run-export'].every(id => !document.getElementById(id).disabled)
    && document.getElementById('export-gate-reason').hidden`);
  check(ready, 'previews: offered once a master is loaded');
  await openExportSection(p);
  const out = {};
  for (const [view, scen] of [['wa', 'default'], ['flow', 'inbound'], ['focus', 'two_counties'], ['focus', 'four_counties']]) {
    const rec = oracle.views[view][scen];
    const name = 'previews: ' + view + ' ' + scen;
    const got = await enterScenario(p, view, rec);
    check(scenarioMatches(view, got, rec.inputs), name + ' page choices match the reference scenario', { got, inputs: rec.inputs });
    await openExportSection(p);
    // Preview Map Data
    const cviTable = rec.previews.preview_table;
    await clickButton(p, 'preview-table');
    let d = await p.eval(DIALOG);
    check(d.open && d.title === cviTable.modal.title && d.note === cviTable.modal.footer, name + ' Map Data title and footer as CVI', [d.title, d.note]);
    check(JSON.stringify(d.columns) === JSON.stringify(cviTable.table.columns), name + ' Map Data columns as CVI', d.columns);
    const rows = await allTableRows(p);
    const want = cviTable.table.rows.map(r => r.map(cvText));
    check(JSON.stringify(rows) === JSON.stringify(want), name + ' Map Data rows as CVI serves them', { page: rows.slice(0, 3), cvi: want.slice(0, 3), n: [rows.length, want.length] });
    const inside = await p.eval(`(() => { const d = document.getElementById('preview-dialog'), r = d.getBoundingClientRect();
      d.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: r.left + 20, clientY: r.top + 20 })); return d.open; })()`);
    check(inside, name + ' a click inside the dialog leaves it open', inside);
    if (!inside) await clickButton(p, 'preview-table');   // so the checks below still run
    // A drag that starts inside (selecting text) and is released on the dimmed page leaves it open.
    const dragged = await p.eval(`(() => { const d = document.getElementById('preview-dialog'), r = d.getBoundingClientRect();
      const t = document.getElementById('preview-title').getBoundingClientRect();
      document.getElementById('preview-title').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: t.left + 5, clientY: t.top + 5 }));
      d.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: Math.max(2, r.left / 2), clientY: Math.max(2, r.top / 2) }));
      return d.open; })()`);
    check(dragged, name + ' a drag from inside released beside the dialog leaves it open', dragged);
    if (!dragged) await clickButton(p, 'preview-table');
    // Escape pressed in the search box, where the dialog puts the focus (a page event; Safari's search box keeps a
    // real Escape for itself, so the page closes the dialog on the key).
    const fromSearch = await p.eval(`(() => { const s = document.querySelector('#preview-dialog .dt-search');
      const focused = document.activeElement === s;
      s.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      return { focused, open: document.getElementById('preview-dialog').open }; })()`);
    check(fromSearch.focused && !fromSearch.open, name + ' Escape in the search box closes the dialog', fromSearch);
    await clickButton(p, 'preview-table');
    check(await closeDialog(p, 'close'), name + ' Close closes the dialog');
    // Preview Stats
    const cviStats = rec.previews.preview_stats.modal;
    await clickButton(p, 'preview-stats');
    d = await p.eval(DIALOG);
    check(d.open && d.title === cviStats.title && d.note === cviStats.footer, name + ' Stats title and footer as CVI', [d.title, d.note]);
    check(d.text !== null && maskGenerated(cviStatsText(d.text)) === maskGenerated(cviStats.pre), name + ' Stats text as CVI (time masked, the page\'s additions taken out)',
      firstDiff(maskGenerated(cviStatsText(d.text || '')), maskGenerated(cviStats.pre)));
    check(/^Generated: \d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/m.test(d.text || ''), name + ' Stats time as CVI writes it');
    check(await closeDialog(p, 'escape'), name + ' Escape closes the dialog');
    // Preview Charts: the PNGs an export writes (the page's chart set), each at CVI's export size.
    const expected = await p.eval(EXPECTED_CHARTS);
    // Each PNG takes about a second to encode in headless Chrome.
    const chartsStart = Date.now();
    await clickButton(p, 'preview-charts');
    await p.waitFor(`document.getElementById('preview-dialog').open && [...document.querySelectorAll('.chart-preview img')].every(i => i.complete && i.naturalWidth > 0)`, 60000, 'chart pictures');
    if (process.env.S7_VERBOSE) console.log('     Preview Charts took ' + (Date.now() - chartsStart) + ' ms');
    d = await p.eval(DIALOG);
    check(d.title === 'Charts preview (' + expected.length + ')' && d.note === rec.previews.preview_charts.modal.footer,
      name + ' Charts title and CVI\'s footer', [d.title, d.note]);
    check(JSON.stringify(d.pictures.map(x => x.file)) === JSON.stringify(expected.map(x => x.file)), name + ' Charts: the export\'s files in order', d.pictures.map(x => x.file));
    check(d.pictures.every((x, i) => expected[i] && x.width === expected[i].size.width && x.height === expected[i].size.height
      && x.caption === 'charts/' + expected[i].file && x.alt.startsWith(expected[i].title)), name + ' Charts: each at CVI\'s export size, named, with its title as text', d.pictures);
    check(await closeDialog(p, 'backdrop'), name + ' a click beside the dialog closes it');
    out[view + '_' + scen] = { rows: rows.length, charts: d.pictures.length };
  }

  // County Focus without a county: CVI's message for each preview, no dialog.
  const noCounty = oracle.views.focus.no_counties;
  await p.eval(`(() => { [...document.querySelectorAll('#fo-counties input')].forEach(i => { if (i.checked) { i.checked = false; i.dispatchEvent(new Event('change')); } }); return true; })()`);
  await sleep(400);
  for (const [id, key] of [['preview-table', 'preview_table'], ['preview-stats', 'preview_stats'], ['preview-charts', 'preview_charts']]) {
    await clickButton(p, id);
    const msg = await p.eval(`(() => { const m = document.getElementById('preview-message'); return { shown: !m.hidden, text: m.textContent,
      open: document.getElementById('preview-dialog') ? document.getElementById('preview-dialog').open : false }; })()`);
    const cvi = noCounty.previews[key].notes.map(n => n.text);
    check(msg.shown && !msg.open && msg.text === cvi[0], 'previews: ' + id + ' without a county gives CVI\'s message', { msg, cvi });
  }

  // The table's tools on the Full tier's WA State default (78 rows): pages of 15, search, a column filter, sorting.
  const fullRec = JSON.parse(fs.readFileSync(ORACLE_FULL, 'utf8')).views.wa.default;
  const full = fullRec.previews.preview_table;
  await loadMaster(p, TIER_FULL);
  await showView(p, 'wa');
  // A new file keeps the species picked before (as CVI), so every group is ticked again for the reference's default.
  await p.eval(`(() => { document.querySelector('[data-all="species"]').click(); return true; })()`);
  await sleep(400);
  const fullGot = await enterScenario(p, 'wa', fullRec);
  check(scenarioMatches('wa', fullGot, fullRec.inputs), 'previews: Full tier page choices match the reference default', fullGot);
  await openExportSection(p);
  await clickButton(p, 'preview-table');
  let d = await p.eval(DIALOG);
  const total = full.table.rows.length;
  check(d.rows.length === 15 && d.info === 'Showing 1 to 15 of ' + total + ' entries', 'previews: 15 rows per page with DT\'s line', [d.rows.length, d.info]);
  const rows = await allTableRows(p);
  const fullWant = full.table.rows.map(r => r.map(cvText));
  const firstOff = rows.findIndex((r, i) => JSON.stringify(r) !== JSON.stringify(fullWant[i]));
  check(rows.length === fullWant.length && firstOff < 0, 'previews: Full tier Map Data rows as CVI serves them, over every page',
    { n: [rows.length, fullWant.length], at: firstOff, page: rows[firstOff], cvi: fullWant[firstOff] });
  // Search: every row shown holds the text; DT's line says what was filtered.
  await tableShown(p);
  await p.eval(`(() => { const s = document.querySelector('.dt-search'); s.value = 'yak'; s.dispatchEvent(new Event('input')); return true; })()`);
  d = await p.eval(DIALOG);
  const yak = full.table.rows.filter(r => r.some(v => cvText(v).toLowerCase().includes('yak')));
  check(d.rows.length === yak.length && d.rows.every(r => r.some(v => v.toLowerCase().includes('yak')))
    && d.info === 'Showing 1 to ' + yak.length + ' of ' + yak.length + ' entries (filtered from ' + total + ' total entries)',
  'previews: the search box keeps the matching rows', [d.rows.length, yak.length, d.info]);
  // Word by word, as DT's smart search: "yakima outbound" keeps the rows holding both words.
  await tableShown(p);
  await p.eval(`(() => { const s = document.querySelector('.dt-search'); s.value = 'yakima outbound'; s.dispatchEvent(new Event('input')); return true; })()`);
  d = await p.eval(DIALOG);
  const both = full.table.rows.filter(r => ['yakima', 'outbound'].every(w => r.map(v => cvText(v).toLowerCase()).join('  ').includes(w)))
    .map(r => r.map(cvText));
  check(both.length > 0 && JSON.stringify(d.rows) === JSON.stringify(both), 'previews: the search matches word by word, as DT\'s', [d.rows.length, both.length]);
  await p.eval(`(() => { const s = document.querySelector('.dt-search'); if (!s) return false; s.value = ''; s.dispatchEvent(new Event('input')); return true; })()`);
  // A column filter: direction "Outbound".
  const dirAt = full.table.columns.indexOf('direction');
  await tableShown(p);
  await p.eval(`(() => { const f = document.querySelectorAll('.dt-filter')[${dirAt}]; f.value = 'outb'; f.dispatchEvent(new Event('input')); return true; })()`);
  const outRows = await allTableRows(p);
  const outWant = full.table.rows.filter(r => r[dirAt] === 'Outbound').map(r => r.map(cvText));
  check(JSON.stringify(outRows) === JSON.stringify(outWant), 'previews: a column filter keeps that column\'s matches', [outRows.length, outWant.length]);
  await p.eval(`(() => { const f = document.querySelectorAll('.dt-filter')[${dirAt}]; if (!f) return false; f.value = ''; f.dispatchEvent(new Event('input')); return true; })()`);
  // Sorting by total_animals, up then down (numbers by value).
  const totAt = full.table.columns.indexOf('total_animals');
  const sortBy = async () => {
    await tableShown(p);
    await p.eval(`(() => { document.querySelectorAll('.dt-sort')[${totAt}].click(); return true; })()`);
  };
  await sortBy();
  const up = (await allTableRows(p)).map(r => Number(r[totAt]));
  await sortBy();
  const down = (await allTableRows(p)).map(r => Number(r[totAt]));
  const values = full.table.rows.map(r => r[totAt]);
  check(JSON.stringify(up) === JSON.stringify(values.slice().sort((a, b) => a - b)), 'previews: sorting by a number column, up', up.slice(0, 5));
  check(JSON.stringify(down) === JSON.stringify(values.slice().sort((a, b) => b - a)), 'previews: sorting again, down', down.slice(0, 5));
  const aria = await p.eval(`(th => (th ? th.getAttribute('aria-sort') : null))(document.querySelectorAll('.dt-table thead tr:first-child th')[${totAt}])`);
  check(aria === 'descending', 'previews: the sorted column says so to screen readers', aria);
  check(await closeDialog(p, 'x'), 'previews: the × button closes the dialog');
  const back = await p.eval(`document.activeElement && document.activeElement.id`);
  check(back === 'preview-table', 'previews: keyboard focus returns to the button that opened the dialog', back);
  return out;
}
function firstDiff(a, b) {
  if (a === b) return undefined;
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  return { at: i, page: a.slice(Math.max(0, i - 60), i + 80), cvi: b.slice(Math.max(0, i - 60), i + 80) };
}

// ── Part: exports ──────────────────────────────────────────────────────────────────────────────────────────
// The Export button with every format ticked, in each view's reference scenario on the S7 fixture: Chrome saves one
// ZIP named after the folder; inside, the folder and its files, byte for byte against CVI's own files for the same
// rows (filtered_rows.csv, summary_table.csv) and CVI's export_params.json (time masked); the chart PNGs at CVI's
// export sizes; the result message listing the files as CVI lists them; above 3 County Focus counties the area part
// "<n>Counties" (by design). Then CVI's messages, a partial export, "Exports this session",
// Reset All keeping the choices, and the ZIP entries' date.
// A stored ZIP's entries (local headers in order): name, data, MS-DOS time and date.
function readZip(buf) {
  const out = [];
  let at = 0;
  while (at + 30 <= buf.length && buf.readUInt32LE(at) === 0x04034b50) {
    const method = buf.readUInt16LE(at + 8), time = buf.readUInt16LE(at + 10), date = buf.readUInt16LE(at + 12);
    const size = buf.readUInt32LE(at + 18), nameLen = buf.readUInt16LE(at + 26), extra = buf.readUInt16LE(at + 28);
    const name = buf.slice(at + 30, at + 30 + nameLen).toString('utf8');
    const start = at + 30 + nameLen + extra;
    out.push({ name, method, time, date, data: buf.slice(start, start + size) });
    at = start + size;
  }
  return out;
}
// The MS-DOS date and time a ZIP entry holds for a local date (worked out here, apart from the page's own code).
function dosDateTime(d) {
  return { time: d.getHours() * 2048 + d.getMinutes() * 32 + Math.floor(d.getSeconds() / 2),
    date: (d.getFullYear() - 1980) * 512 + (d.getMonth() + 1) * 32 + d.getDate() };
}
const pngSize = data => (data.length > 24 && data.readUInt32BE(0) === 0x89504e47
  ? { width: data.readUInt32BE(16), height: data.readUInt32BE(20) } : null);
async function partExports(b) {
  const p = b.page;
  const oracle = JSON.parse(fs.readFileSync(ORACLE_S7, 'utf8'));
  const DL = path.join(OUT, 'downloads');
  fs.rmSync(DL, { recursive: true, force: true });
  fs.mkdirSync(DL, { recursive: true });
  await b.send('Browser.setDownloadBehavior', { behavior: 'allowAndName', downloadPath: DL, eventsEnabled: true });
  const download = () => new Promise(res => {
    let name = null;
    const t = setTimeout(() => { b.listeners.splice(b.listeners.indexOf(h), 1); res({ state: 'timeout', name }); }, 30000);
    const h = m => {
      if (m.method === 'Browser.downloadWillBegin') name = m.params.suggestedFilename;
      if (m.method === 'Browser.downloadProgress' && (m.params.state === 'completed' || m.params.state === 'canceled')) {
        clearTimeout(t);
        b.listeners.splice(b.listeners.indexOf(h), 1);
        res({ state: m.params.state, guid: m.params.guid, name });
      }
    };
    b.listeners.push(h);
  });
  const result = () => p.eval(`(() => { const r = document.getElementById('export-result');
    return { shown: !r.hidden, cls: r.className, lines: [...r.children].map(d => d.textContent),
      bold: r.children[0] ? getComputedStyle(r.children[0]).fontWeight : null }; })()`);
  const exportNow = async () => {
    const dl = download();
    await p.eval(`document.getElementById('run-export').click(); true`);
    const got = await dl;
    await p.waitFor('!CVIWA.state.exporting', 15000, 'export finished');
    return got;
  };
  await openPage(b);
  await p.viewport(1400, 1000);
  await loadMaster(p, FIXTURE);
  await openExportSection(p);
  // Every S7 format (CVI's Tables and Charts); S9's Branded map and GIF are left off, so the ZIP stays CVI's.
  await p.eval(`(() => { document.querySelectorAll('input[name=export-format]').forEach(i => { i.checked = ['csv', 'summary_csv', 'charts'].includes(i.value); }); return true; })()`);
  const out = {};
  const today = await p.eval(`CVIWA.exports.localDate(new Date())`);
  for (const [view, scen] of [['wa', 'default'], ['flow', 'inbound'], ['focus', 'two_counties'], ['focus', 'four_counties']]) {
    const rec = oracle.views[view][scen];
    const name = 'exports: ' + view + ' ' + scen;
    const got = await enterScenario(p, view, rec);
    check(scenarioMatches(view, got, rec.inputs), name + ' page choices match the reference scenario', { got, inputs: rec.inputs });
    await openExportSection(p);
    const clickedAt = Date.now();
    const dl = await exportNow();
    // CVI's folder name, with today's date and, above 3 County Focus counties, "<n>Counties" as the area part.
    const counties = listOf(rec.inputs.intra_counties);
    let folder = today + rec.export.folder.slice(10);
    if (view === 'focus' && counties.length > 3) {
      folder = folder.replace('_CountyFocus_' + counties.map(c => c.replace(/[^A-Za-z0-9]/g, '')).join('-') + '_',
        '_CountyFocus_' + counties.length + 'Counties_');
    }
    check(dl.state === 'completed' && dl.name === folder + '.zip', name + ' Chrome saves ' + folder + '.zip', dl);
    if (view === 'focus' && counties.length > 3) {
      check(dl.name && dl.name.indexOf('_CountyFocus_' + counties.length + 'Counties_') > 0, name + ' the area part says "' + counties.length + 'Counties"', dl.name);
    }
    if (dl.state !== 'completed') continue;
    const entries = readZip(fs.readFileSync(path.join(DL, dl.guid)));
    const byName = n => entries.find(e => e.name === folder + '/' + n);
    check(entries.length > 0 && entries.every(e => e.method === 0 && e.name.startsWith(folder + '/')), name + ' every entry stored inside the folder', entries.map(e => e.name));
    check(entries[0].name === folder + '/' && byName('charts/'), name + ' the folder and charts/ as entries');
    const ap = rec.approved;
    check(byName('filtered_rows.csv') && byName('filtered_rows.csv').data.toString('utf8') === ap.filtered_rows_csv,
      name + ' filtered_rows.csv byte for byte as CVI writes these rows');
    check(byName('summary_table.csv') && byName('summary_table.csv').data.toString('utf8') === ap.summary_table_csv,
      name + ' summary_table.csv byte for byte as CVI writes these rows');
    const params = byName('export_params.json') ? byName('export_params.json').data.toString('utf8') : '';
    check(maskExported(params) === maskExported(rec.export.export_params_json), name + ' export_params.json as CVI\'s (time masked)',
      firstDiff(maskExported(params), maskExported(rec.export.export_params_json)));
    const charts = entries.filter(e => e.name.startsWith(folder + '/charts/') && !e.name.endsWith('/'));
    const expected = await p.eval(EXPECTED_CHARTS);
    check(JSON.stringify(charts.map(e => e.name.slice(folder.length + 8))) === JSON.stringify(expected.map(x => x.file)),
      name + ' the chart files of the view, in order', charts.map(e => e.name));
    check(charts.every((e, i) => expected[i] && JSON.stringify(pngSize(e.data)) === JSON.stringify(expected[i].size)),
      name + ' each chart a PNG at CVI\'s export size', charts.map(e => [e.name.slice(folder.length + 1), pngSize(e.data)]));
    // The message: where the file went, then the files as CVI lists them (its charts are the page's chart set).
    const r = await result();
    const cviLines = listOf(rec.export.result).slice(1).filter(l => !l.startsWith('charts/'));
    const pageLines = r.lines.slice(1).filter(l => !l.startsWith('charts/'));
    check(r.shown && r.cls === 'status ok' && r.lines[0] === 'Exported ' + folder + '.zip: handed to your browser to save, usually your Downloads folder.'
      + ' If no file appears, your browser or IT policy blocked the download.'
      && Number(r.bold) >= 700, name + ' the message says where the file went', r.lines[0]);
    check(JSON.stringify(pageLines) === JSON.stringify(cviLines), name + ' the files listed as CVI lists them', { page: pageLines, cvi: cviLines });
    check(JSON.stringify(r.lines.slice(1).filter(l => l.startsWith('charts/'))) === JSON.stringify(charts.map(e => e.name.slice(folder.length + 1))),
      name + ' the chart files listed', r.lines);
    // The entries carry the export's local date and time (MS-DOS form, to the even second).
    const dosNow = dosDateTime(new Date(clickedAt));
    check(entries.every(e => e.date === dosNow.date && Math.abs(e.time - dosNow.time) <= 64), name + ' ZIP entries dated at the export', [entries[0].date, entries[0].time, dosNow]);
    out[view + '_' + scen] = { file: dl.name, entries: entries.length, charts: charts.length };
  }

  // "Exports this session": the exports above, newest first, as "Oct 11 14:05 — name" cut to 30 characters.
  let hist = await p.eval(`(() => ({ shown: !document.getElementById('export-history').hidden,
    items: [...document.querySelectorAll('#export-history-list li')].map(li => ({ text: li.textContent, title: li.title })) }))()`);
  const names = Object.values(out).map(o => o.file).reverse();
  check(hist.shown && hist.items.length === 4 && hist.items.every((it, i) => it.title === names[i]
    && /^[A-Z][a-z]{2} \d\d \d\d:\d\d — /.test(it.text) && it.text.endsWith(names[i].length > 30 ? names[i].slice(0, 30) + '…' : names[i])),
  'exports: "Exports this session" lists them newest first', hist);
  // Two more: only the last five are kept.
  await exportNow();
  await exportNow();
  hist = await p.eval(`[...document.querySelectorAll('#export-history-list li')].length`);
  check(hist === 5, 'exports: "Exports this session" keeps the last five', hist);

  // The Map View switched to National Flow right after the click, while the pictures are drawn: the export and
  // Preview Charts keep the view, measure and comparison of the click.
  const waRec = oracle.views.wa.default;
  await enterScenario(p, 'wa', waRec);
  await openExportSection(p);
  const waCharts = (await p.eval(EXPECTED_CHARTS)).map(x => x.file);
  const raceDl = download();
  await p.eval(`(() => { document.getElementById('run-export').click(); document.getElementById('show-flow').click(); return true; })()`);
  const race = await raceDl;
  await p.waitFor('!CVIWA.state.exporting', 15000, 'export finished');
  const raceView = await p.eval('CVIWA.state.view');
  if (race.state === 'completed') {
    const re = readZip(fs.readFileSync(path.join(DL, race.guid)));
    const rf = today + waRec.export.folder.slice(10);
    const rParams = (re.find(e => e.name === rf + '/export_params.json') || { data: Buffer.alloc(0) }).data.toString('utf8');
    const rCharts = re.filter(e => e.name.startsWith(rf + '/charts/') && !e.name.endsWith('/')).map(e => e.name.slice(rf.length + 8));
    check(raceView === 'flow' && race.name === rf + '.zip' && JSON.stringify(rCharts) === JSON.stringify(waCharts)
      && maskExported(rParams) === maskExported(waRec.export.export_params_json),
    'exports: switching the Map View during an export keeps the export\'s view', { raceView, name: race.name, rCharts, waCharts });
  } else {
    check(false, 'exports: switching the Map View during an export keeps the export\'s view', race);
  }
  await enterScenario(p, 'wa', waRec);
  await openExportSection(p);
  const drawing = await p.eval(`(() => { const b = document.getElementById('preview-charts'); b.click();
    const during = { text: b.textContent, disabled: b.disabled, exportOff: document.getElementById('run-export').disabled };
    document.getElementById('show-flow').click(); return during; })()`);
  await p.waitFor(`document.getElementById('preview-dialog').open && [...document.querySelectorAll('.chart-preview img')].every(i => i.complete && i.naturalWidth > 0)`, 60000, 'chart pictures');
  const shownFiles = (await p.eval(DIALOG)).pictures.map(x => x.file);
  check(drawing.text === 'Drawing…' && drawing.disabled && drawing.exportOff, 'exports: Preview Charts grayed with "Drawing…" while it draws', drawing);
  check(JSON.stringify(shownFiles) === JSON.stringify(waCharts), 'exports: switching the Map View during Preview Charts keeps its view', shownFiles);
  await closeDialog(p, 'close');
  const after = await p.eval(`(() => { const b = document.getElementById('preview-charts'); return { text: b.textContent, disabled: b.disabled }; })()`);
  check(after.text === 'Preview Charts' && !after.disabled, 'exports: Preview Charts usable again afterward', after);
  await showView(p, 'focus');

  // CVI's messages, in its order: no format; County Focus without a county; no rows.
  await p.eval(`(() => { document.querySelectorAll('input[name=export-format]').forEach(i => { i.checked = false; }); return true; })()`);
  await p.eval(`document.getElementById('run-export').click(); true`);
  await sleep(300);
  let r = await result();
  check(r.cls === 'status warn' && JSON.stringify(r.lines) === JSON.stringify(['Select at least one export format.']), 'exports: no format ticked gives CVI\'s message', r);
  // CVI's formats only; S9's Branded map left off.
  await p.eval(`(() => { document.querySelectorAll('input[name=export-format]').forEach(i => { i.checked = ['csv', 'summary_csv', 'charts'].includes(i.value); }); return true; })()`);
  await p.eval(`(() => { [...document.querySelectorAll('#fo-counties input')].forEach(i => { if (i.checked) { i.checked = false; i.dispatchEvent(new Event('change')); } }); return true; })()`);
  await sleep(400);
  await p.eval(`document.getElementById('run-export').click(); true`);
  await sleep(300);
  r = await result();
  check(JSON.stringify(r.lines) === JSON.stringify([oracle.views.focus.no_counties.export.notes[0].text]), 'exports: County Focus without a county gives CVI\'s message', r);
  await showView(p, 'wa');
  await p.eval(`(() => { document.querySelector('[data-clear="species"]').click(); return true; })()`);
  await sleep(400);
  await p.eval(`document.getElementById('run-export').click(); true`);
  await sleep(300);
  r = await result();
  check(JSON.stringify(r.lines) === JSON.stringify(['No rows match current filters — export cancelled.']), 'exports: no rows gives CVI\'s message', r);
  await p.eval(`(() => { document.querySelector('[data-all="species"]').click(); return true; })()`);
  await sleep(400);

  // A chart that cannot be drawn: a partial export, the others written, CVI's wording with what failed.
  await p.eval(`(() => { const real = CVIWA.chartsvg.png; window.__realPng = real;
    CVIWA.chartsvg.png = (c, o) => (c.id === 'species' ? Promise.reject(new Error('Simulated failure.')) : real(c, o)); return true; })()`);
  const partial = await exportNow();
  await p.eval(`(() => { CVIWA.chartsvg.png = window.__realPng; return true; })()`);
  r = await result();
  const pEntries = partial.state === 'completed' ? readZip(fs.readFileSync(path.join(DL, partial.guid))).map(e => e.name) : [];
  check(r.cls === 'status warn' && r.lines[0] === 'Partial export: ' + partial.name && r.lines[1].startsWith('Written: filtered_rows.csv (')
    && r.lines[2] === 'Errors: charts/species_breakdown.png: Simulated failure.', 'exports: a failing chart gives a partial export with CVI\'s wording', r.lines);
  check(pEntries.length > 0 && !pEntries.some(n => n.endsWith('species_breakdown.png')) && pEntries.some(n => n.endsWith('top_counties.png')),
    'exports: the partial ZIP holds the other files', pEntries);

  // The Partner tier (13 columns: no CVI, Species or premises coordinates). WA State exports CVI's files for its rows;
  // County Focus gives CVI's message for the missing coordinates on Export, CVI's message on Preview Map Data, and
  // CVI's Stats text.
  const partner = JSON.parse(fs.readFileSync(path.join(ROOT, 'local-test-artifacts', 's7', 'oracle_s7_tier_partner.json'), 'utf8'));
  await loadMaster(p, TIER_PARTNER);
  await showView(p, 'wa');
  await p.eval(`(() => { document.querySelector('[data-all="species"]').click(); return true; })()`);
  await sleep(400);
  const pw = partner.views.wa.default;
  const pGot = await enterScenario(p, 'wa', pw);
  check(scenarioMatches('wa', pGot, pw.inputs), 'exports: Partner tier page choices match the reference default', pGot);
  await openExportSection(p);
  const pdl = await exportNow();
  const pFolder = today + pw.export.folder.slice(10);
  check(pdl.state === 'completed' && pdl.name === pFolder + '.zip', 'exports: Partner tier ZIP named as CVI\'s folder', pdl);
  if (pdl.state === 'completed') {
    const pe = readZip(fs.readFileSync(path.join(DL, pdl.guid)));
    const file = n => (pe.find(e => e.name === pFolder + '/' + n) || { data: Buffer.alloc(0) }).data.toString('utf8');
    check(file('filtered_rows.csv') === pw.approved.filtered_rows_csv && file('summary_table.csv') === pw.approved.summary_table_csv,
      'exports: Partner tier CSVs byte for byte as CVI writes these rows');
    check(maskExported(file('export_params.json')) === maskExported(pw.export.export_params_json), 'exports: Partner tier export_params.json as CVI\'s');
  }
  const pf = partner.views.focus.two_counties;
  await enterScenario(p, 'focus', pf);
  await p.eval(`(() => { document.querySelector('[data-all="foSpecies"]').click(); return true; })()`);
  await sleep(600);
  const pfGot = await enterScenario(p, 'focus', pf);
  check(scenarioMatches('focus', pfGot, pf.inputs), 'exports: Partner tier County Focus choices match the reference', pfGot);
  await openExportSection(p);
  await p.eval(`document.getElementById('run-export').click(); true`);
  await sleep(300);
  r = await result();
  // CVI's message names steps of its own R pipeline; the page says it in plain words: the same
  // missing columns as CVI's reference names, in the page's sentence.
  const cviCols = (/coordinates \(([^)]*)\)/.exec(pf.export.notes[0].text) || [])[1];
  check(r.cls === 'status err' && !!cviCols && JSON.stringify(r.lines) === JSON.stringify(['County Focus export needs ' +
    'premises coordinates (' + cviCols + '), which this master file does not have. Ask for a CVI master table that ' +
    'includes them, then load it again.']),
    'exports: County Focus without premises coordinates: CVI\'s missing columns, in plain words', r.lines);
  await clickButton(p, 'preview-table');
  const pm = await p.eval(`(() => { const m = document.getElementById('preview-message'); return { shown: !m.hidden, text: m.textContent }; })()`);
  check(pm.shown && pm.text === pf.previews.preview_table.notes[0].text, 'exports: Preview Map Data there gives CVI\'s message', pm);
  await clickButton(p, 'preview-stats');
  const ps = await p.eval(DIALOG);
  check(ps.open && ps.text !== null && maskGenerated(cviStatsText(ps.text)) === maskGenerated(pf.previews.preview_stats.modal.pre), 'exports: Preview Stats there as CVI\'s (the page\'s additions taken out)',
    firstDiff(maskGenerated(cviStatsText(ps.text || '')), maskGenerated(pf.previews.preview_stats.modal.pre)));
  await closeDialog(p, 'close');
  await loadMaster(p, FIXTURE);
  await showView(p, 'wa');

  // An Optional Filename names the ZIP and its folder, with CVI's clean-up; Reset All keeps the section's choices.
  await p.eval(`(() => { const i = document.getElementById('export-label'); i.value = 'My export: test/1'; return true; })()`);
  const labeled = await exportNow();
  check(labeled.name === today + '_My_export__test_1.zip', 'exports: the Optional Filename names the ZIP as CVI names its folder', labeled.name);
  await p.eval(`(() => { document.querySelector('input[name=export-format][value=csv]').checked = false; document.getElementById('reset-all').click(); return true; })()`);
  await sleep(400);
  const kept = await p.eval(`({ label: document.getElementById('export-label').value,
    formats: [...document.querySelectorAll('input[name=export-format]:checked')].map(i => i.value) })`);
  check(kept.label === 'My export: test/1' && JSON.stringify(kept.formats) === JSON.stringify(['summary_csv', 'charts']), 'exports: Reset All leaves the export choices, as CVI', kept);
  // The defaults when the page opens: Aggregated totals and Charts ticked, Source records not (CVI's), and the branded
  // map ticked too, so an export holds a map (a deliberate difference).
  await openPage(b);
  const defaults = await p.eval(`[...document.querySelectorAll('input[name=export-format]:checked')].map(i => i.value)`);
  check(JSON.stringify(defaults) === JSON.stringify(['summary_csv', 'charts', 'branded_png']), 'exports: CVI\'s default formats and the branded map', defaults);
  await b.send('Browser.setDownloadBehavior', { behavior: 'default' });
  return out;
}

// ── Part: special characters ───────────────────────────────────────────────────────────────────────────────
// A species group with HTML and XML special characters (the S7 fixture's Equids renamed)
// shows as text in the chart, its hover text and the Stats preview, and nothing in it becomes markup; an export
// picture whose text holds it and a control character still draws.
const ODD = 'Equids<b>&"\'x';
function specialFixture() {
  const lines = fs.readFileSync(FIXTURE, 'utf8').replace(/\r?\n$/, '').split(/\r?\n/);
  const at = lines[0].split(',').indexOf('Species.Group');
  const quoted = '"' + ODD.replace(/"/g, '""') + '"';
  const out = [lines[0]].concat(lines.slice(1).map(l => {
    if (/"/.test(l)) return l;   // rows with quoted cells are left as they are
    const c = l.split(',');
    if (c[at] === 'Equids') c[at] = quoted;
    return c.join(',');
  }));
  const file = path.join(OUT, 'special_master.csv');
  fs.writeFileSync(file, out.join('\n') + '\n');
  return file;
}
async function partSpecial(b) {
  const p = b.page;
  await openPage(b);
  await p.viewport(1400, 1000);
  await loadMaster(p, specialFixture());
  await showView(p, 'wa');
  await p.eval(`(() => { document.querySelector('[data-all="species"]').click(); return true; })()`);
  await sleep(400);
  await setLayout(p, 'charts');
  const odd = JSON.stringify(ODD);
  const chart = await p.eval(`(() => { const card = document.querySelector('#chart-grid .chart-card[data-chart="species"]');
    return { markup: document.querySelectorAll('#chart-grid b, #chart-grid img, #chart-grid script').length,
      label: [...card.querySelectorAll('text')].some(t => t.textContent === ${odd}),
      hover: [...card.querySelectorAll('[data-hover]')].some(e => e.getAttribute('data-hover').startsWith(${odd} + ': ')) }; })()`);
  check(chart.markup === 0 && chart.label && chart.hover, 'special: the species group shows as text in the chart and its hover text', chart);
  await setLayout(p, 'map');
  await openExportSection(p);
  await clickButton(p, 'preview-stats');
  const stats = await p.eval(`(() => { const body = document.getElementById('preview-body');
    return { text: body.textContent.includes(${odd}), markup: body.querySelectorAll('b, img, script').length }; })()`);
  check(stats.text && stats.markup === 0, 'special: the species group shows as text in the Stats preview', stats);
  await closeDialog(p, 'close');
  const picture = await p.eval(`(async () => { const W = CVIWA, m = W.state.master;
    const rows = W.summary.mapRows(m, { species: m.speciesChoices.slice(), years: m.yearChoices.slice(),
      quarters: ['Q1', 'Q2', 'Q3', 'Q4'], direction: ['Inbound', 'Outbound'], rawSpecies: [] }) || [];
    const c = W.charts.build('species', { rows }, { view: 'wa' });
    try {
      const blob = await W.chartsvg.png(c, { caption: 'WA State | ' + ${odd} + ' \\u0001', footer: 'x' });
      return { ok: blob.size > 1000, labeled: c.bars.some(x => x.label === ${odd}) };
    } catch (e) { return { error: String((e && e.message) || e) }; } })()`);
  check(picture.ok && picture.labeled, 'special: an export picture with special and control characters in its text draws', picture);
  return { chart, stats, picture };
}


// ── Run ────────────────────────────────────────────────────────────────────────────────────────────────────
(async () => {
  if (!fs.existsSync(FIXTURE)) throw new Error('Missing ' + FIXTURE + ': run node tests/synthetic/make_cvi_s7_fixtures.js');
  const b = await launch();
  const run = { chrome: b.version, page: PAGE, parts: PARTS, started: new Date().toISOString(), results: {} };
  try {
    for (const part of PARTS) {
      if (part === 'png') run.results.png = await partPng(b);
      else if (part === 'layout') run.results.layout = await partLayout(b);
      else if (part === 'charts') run.results.charts = await partCharts(b);
      else if (part === 'spotlight') run.results.spotlight = await partSpotlight(b);
      else if (part === 'measure') run.results.measure = await partMeasure(b);
      else if (part === 'subsets') run.results.subsets = await partSubsets(b);
      else if (part === 'perf') run.results.perf = await partPerf(b);
      else if (part === 'checkpoint') run.results.checkpoint = await partCheckpoint(b);
      else if (part === 'previews') run.results.previews = await partPreviews(b);
      else if (part === 'exports') run.results.exports = await partExports(b);
      else if (part === 'special') run.results.special = await partSpecial(b);
      else throw new Error('Unknown part ' + part);
    }
  } catch (e) {
    failed++;
    failures.push('run stopped: ' + (e && e.stack ? e.stack : e));
  } finally {
    check(!b.log.exceptions.length, 'page: no exceptions', b.log.exceptions);
    check(!b.log.csp.length, 'page: no Content Security Policy reports', b.log.csp);
    // Only the site's own files (file://, the local server or a hosted copy of site/) and in-page data addresses.
    const siteBase = new URL('../', PAGE).href;
    const outside = b.log.requests.filter(u => !/^(data:|blob:)/.test(u) && !u.startsWith(siteBase));
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
  console.log('S7 browser (' + PARTS.join(', ') + '): ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch(e => {
  console.error(e);
  process.exit(1);
});
