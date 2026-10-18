#!/usr/bin/env node
'use strict';
// Shaded counties and states browser suite: the CVI page's "Show counties as" and "Show states as" switches in
// installed Chrome, through the DevTools protocol, offline, foreground only (Chrome does not start from a background
// job). Synthetic data only. No packages.
//
// Parts (name some to run only those, for example: node tests/browser/run_ch_browser.js wa):
//   wa      WA State's live map: Circles at the start; Shaded counties fills each county in its class's color
//           (checked against choropleth.js's classes from the page's own numbers) with the hatch for "No
//           movements" and white county lines; the controls that follow the switch and their grayed reasons;
//           Measure, Shading classes, Number of bins and Fill opacity; hover; Spotlight; the movement lines taking
//           over and handing back; population density grayed; Compare's one set of classes; Reset All; no request
//           leaves the page.
//   flow    National Flow's live map: Lines at the start; Shaded states fills each state with movements in its
//           class's color (from the page's own lines), the rest plain land, Washington white with its dark outline,
//           no lines drawn, white state lines; the controls that follow; the direction's ramp; hover with the
//           species; a state picked in a chart outlined with the others dimmed; Reset All.
//   records a county whose rows have no animal counts: hatched "No movements", its hover adding "n CVI records, no
//           animal counts"; a county written in capitals shaded as itself and the legend's line for a county the map
//           does not have
//   insets  Alaska and Hawaii on National Flow, on test-tables/flow_alaska_hawaii.csv: the two inset boxes over the
//           map's top left, beside the zoom buttons, on Lines (each line to Alaska or Hawaii
//           from Washington's anchor to the state's center in its box, kept there as the map moves, not on the map
//           itself) and on Shaded states (each outline in its class's color); hover on a line and on an outline; the
//           screenshot; no box on the Full tier (no Alaska or Hawaii rows).
//   png     the branded PNG and GIF through the real buttons: Preview Map's page shaded with the live map's classes;
//           the PNG's pixels at a point inside each county (clear of its name) in its class's color at the fill
//           opacity, or the hatch; Compare's two PNGs from one set of classes; the GIF's frames sharing the classes
//           of every frame; export_params.json; National Flow's PNG and GIF the same way.
//
// Usage (repository root, after node tests/node/run_f1_unit_tests.js, which writes test-tables/):
//   node tests/browser/run_ch_browser.js [wa]
// Writes local-test-artifacts/choropleth/browser/run.json (results).
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join(ROOT, 'local-test-artifacts', 'choropleth', 'browser');
const PAGE = process.env.CH_PAGE_URL || pathToFileURL(path.join(ROOT, 'site', 'cvi', 'index.html')).href;
const CHROME = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ALL_PARTS = ['wa', 'records', 'flow', 'insets', 'png'];
// Parts run only when named on the command line.
const BOARD_PARTS = [];
const asked = process.argv.slice(2).filter(a => !a.startsWith('--'));
const PARTS = asked.length ? asked : ALL_PARTS;
if (PARTS.some(x => ALL_PARTS.indexOf(x) < 0 && BOARD_PARTS.indexOf(x) < 0)) throw new Error('Unknown part: ' + PARTS);
const sleep = ms => new Promise(r => setTimeout(r, ms));


// ── Chrome through the DevTools protocol (as the S7 and S9 suites) ─────────────────────────────────────────────
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
    // The whole page at a given width and height, saved as a PNG.
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

// ── Helpers ────────────────────────────────────────────────────────────────────────────────────────────────────
const FULL = path.join(ROOT, 'test-tables', 'tier_full_master.csv');
async function openCvi(b, file, page) {
  await b.page.goto(page || PAGE);
  await b.page.waitFor('window.CVIWA && CVIWA.state && CVIWA.state.mapHandle && CVIWA.state.mapHandle.ready', 15000,
    'page ready');
  const v = await b.page.eval('CVIWA.state.version');
  await b.page.setFiles('#file-input', [file || FULL]);
  await b.page.waitFor('CVIWA.state.master && !CVIWA.state.loading && CVIWA.state.version > ' + v, 20000,
    'master loaded');
  await sleep(400);
}
// Clicks a control in the page (a real click event) and waits for the map's next drawing.
async function act(p, js) {
  const v = await p.eval('CVIWA.state.version');
  await p.eval('(() => { ' + js + ' })()');
  await p.waitFor('CVIWA.state.version > ' + v, 5000, 'redrawn after: ' + js.slice(0, 80));
  await sleep(150);
}
const pick = (name, value) => `document.querySelector('input[name=${name}][value="${value}"]').click();`;
const choose = (id, value) => `{ const s = document.getElementById('${id}'); s.value = '${value}';
  s.dispatchEvent(new Event('change')); }`;
// The page's numbers for the WA State map now, worked out by the test from the page's own rows (choropleth.js).
const EXPECT = `(() => {
  const st = CVIWA.state, CP = CVIWA.choropleth;
  const lists = st.periodMode === 'compare' ? [st.data, st.dataB] : [st.data];
  const cls = CP.countyClasses(lists, st.shadeMeasure, st.shadeClasses, st.nBins, st.direction);
  return lists.map(rows => {
    const v = CP.countyValues(rows, st.shadeMeasure);
    return CVIWA_GEO.counties.features.map(f => {
      const x = v.has(f.properties.name) ? v.get(f.properties.name) : null;
      const c = cls.classOf(x);
      return { name: f.properties.name, color: c ? cls.colors[c - 1] : null, none: !c };
    });
  });
})()`;
const DRAWN = h => `CVIWA.state.${h}.shadeDrawn.map(p => ({ name: p.name, color: p.none ? null : p.color, none: p.none }))`;
// A rendered pixel of the live map at a county's label point, as [r, g, b].
const PIXEL = (h, name) => `(() => {
  const m = CVIWA.state.${h}.map, l = CVIWA_GEO.labels.find(x => x.name === ${JSON.stringify(name)});
  const q = m.project([l.lon, l.lat]); m.redraw();
  const c = m.getCanvas(), k = c.width / c.clientWidth, g = document.createElement('canvas');
  g.width = c.width; g.height = c.height; const x = g.getContext('2d'); x.drawImage(c, 0, 0);
  const d = x.getImageData(Math.round(q.x * k), Math.round(q.y * k) + 8, 1, 1).data;
  return [d[0], d[1], d[2]];
})()`;
// Unticks every box of a checklist but one value, then ticks that one (real change events, as a click).
const tickOnly = (id, value) => `{ const el = document.getElementById('${id}');
  [...el.querySelectorAll('input[type=checkbox]')].forEach(cb => { if (cb.checked && cb.value !== '${value}') cb.click(); });
  const want = [...el.querySelectorAll('input[type=checkbox]')].find(cb => cb.value === '${value}');
  if (!want.checked) want.click(); }`;
// Moves the pointer onto a county's label point (real mouse events) and returns the pop-up's text.
async function hover(b, h, name) {
  const p = b.page;
  const at = await p.eval(`(() => { const m = CVIWA.state.${h}.map, l = CVIWA_GEO.labels.find(x => x.name === ${JSON.stringify(name)});
    const q = m.project([l.lon, l.lat]), r = m.getCanvas().getBoundingClientRect();
    return [r.left + q.x, r.top + q.y + 8]; })()`);
  await b.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at[0] - 3, y: at[1] }, b.sid);
  await b.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at[0], y: at[1] }, b.sid);
  await sleep(250);
  return p.eval(`(() => { const t = document.querySelector('#map .maplibregl-popup-content, #map-b .maplibregl-popup-content');
    return t ? t.textContent : ''; })()`);
}
// The UI suite's check of every visible text (size and WCAG contrast; tests/browser/run_ui_browser.js pageAudit),
// read from that file so both suites judge text the same way; run while the shaded controls and legend show.
const UI_SRC = fs.readFileSync(path.join(ROOT, 'tests', 'browser', 'run_ui_browser.js'), 'utf8');
const AUDIT_FN = UI_SRC.slice(UI_SRC.indexOf('function pageAudit()'), UI_SRC.indexOf('\nconst AUDIT = ') + 1);
const AUDIT = '(' + AUDIT_FN.replace(/^function pageAudit\(\)/, 'function ()') + ')()';
async function textAudit(p, tag) {
  const a = await p.eval(AUDIT);
  const low = a.items.filter(it => it.ratio < (it.large ? 3 : 4.5));
  const small = a.items.filter(it => it.size < (it.control ? 13.6 : 12) - 0.005);
  check(a.counts.texts > 50 && !low.length, tag + ': every visible text at 4.5:1 or more (the UI suite\'s check)',
    low.slice(0, 5));
  check(!small.length, tag + ': every visible text at the UI suite\'s sizes', small.slice(0, 5));
}
const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const blend = (c, a, under) => c.map((x, i) => Math.round(x * a + under[i] * (1 - a)));
const near = (a, b, tol) => a.every((x, i) => Math.abs(x - b[i]) <= (tol || 6));

// ── Part: WA State's live map ──────────────────────────────────────────────────────────────────────────────────
async function partWa(b) {
  const p = b.page;
  await openCvi(b);
  await p.viewport(1400, 1000);
  const H = 'mapHandle';
  const before = b.log.requests.length;
  // At the start: Circles, the shading's controls hidden, nothing shaded.
  let ui = await p.eval(UI);
  check(ui.shape === 'circles' && ui.measureHidden && ui.classesHidden && !ui.scalingHidden &&
    ui.opacityLabel === 'Circle opacity', 'wa: Circles at the start, the shading controls hidden', ui);
  check(await p.eval(`CVIWA.state.mapHandle.shadeDrawn === undefined || !CVIWA.state.mapHandle.shadeDrawn.length`),
    'wa: nothing shaded at the start');

  // Shaded counties: every county filled in its class's color, or hatched.
  await act(p, pick('wa-shape', 'shaded'));
  ui = await p.eval(UI);
  check(ui.shape === 'shaded' && !ui.measureHidden && !ui.classesHidden && ui.scalingHidden && !ui.binsHidden &&
    ui.opacityLabel === 'Fill opacity' && ui.opacity === '0.8', 'wa: Shaded: Measure, Shading classes, bins and ' +
    'Fill opacity 80% shown, Circle size scaling hidden', ui);
  check(ui.classes === 'natural' && ui.smoothDisabled && ui.tenDisabled, 'wa: Natural breaks by default, the smooth ' +
    'scalings and 6, 7 and 10 bins grayed', ui);
  check(ui.modeDisabled && !ui.modeReasonHidden && ui.paletteDisabled && !ui.paletteReasonHidden,
    'wa: Display Mode and Color palette grayed with their reasons', ui);
  let exp = await p.eval(EXPECT);
  let drawn = await p.eval(DRAWN(H));
  check(JSON.stringify(drawn) === JSON.stringify(exp[0]), 'wa: each county\'s drawn fill is its class\'s color',
    { drawn: drawn.slice(0, 4), exp: exp[0].slice(0, 4) });
  check(drawn.length === 39 && drawn.every(c => !c.none), 'wa: 39 counties, every one shaded (each has movements ' +
    'in the full synthetic table)', drawn.filter(c => c.none).map(c => c.name));
  const circles = await p.eval(`CVIWA.state.mapHandle.map.querySourceFeatures('circles_source').length`);
  check(circles === 0, 'wa: no circles while shaded', circles);
  const lines = await p.eval(`CVIWA.state.mapHandle.map.getPaintProperty('county-lines', 'line-color')`);
  check(lines === '#ffffff', 'wa: county lines white (Boundary style Auto)', lines);
  // Rendered pixels: a shaded county at its class's color at 80% over the land; a hatched one light gray.
  const one = exp[0].find(c => !c.none);
  const px = await p.eval(PIXEL(H, one.name));
  check(near(px, blend(hex(one.color), 0.8, hex('#ececec')), 8), 'wa: ' + one.name + ' drawn in its class color',
    { px, want: blend(hex(one.color), 0.8, hex('#ececec')) });
  const legend = await p.eval(`document.getElementById('legend-panel').textContent`);
  check(/Total animals \(Combined\)/.test(legend) && /No movements/.test(legend) && /Natural breaks, \d classes/.test(legend),
    'wa: the legend names the measure, the direction, the classes and No movements', legend);
  await p.screenshotFull(path.join(OUT, 'wa_shaded.png'), 1400, 1000);
  const strip = await p.eval(`document.getElementById('summary-strip').textContent`);
  check(/Mode: Shaded counties/.test(strip), 'wa: the strip names the shaded map', strip);
  await p.eval(`(() => { const t = document.getElementById('legend-toggle'); if (document.getElementById('legend-panel')
    .hidden) t.click(); return true; })()`);
  await textAudit(p, 'wa');

  // Hover: the county under the pointer gives its name and animals.
  let tip = await hover(b, H, one.name);
  check(tip.indexOf(one.name) === 0 && /Combined total: [\d,]+ animals/.test(tip), 'wa: hover gives the county and ' +
    'its Combined total', tip);

  // Inbound alone, one quarter of one year: the Blues ramp, and counties with no movements hatched.
  await act(p, `document.querySelector('input[name=direction][value=Outbound]').click();`);
  await act(p, tickOnly('f-quarters', 'Q1'));
  await act(p, tickOnly('f-years', '2024'));
  exp = await p.eval(EXPECT);
  drawn = await p.eval(DRAWN(H));
  check(JSON.stringify(drawn) === JSON.stringify(exp[0]), 'wa: Inbound, 2024 Q1: each county\'s fill is its class\'s ' +
    'color', { drawn: drawn.slice(0, 4), exp: exp[0].slice(0, 4) });
  const blues = await p.eval(`CVIWA.choropleth.FIVE.Inbound`);
  check(drawn.filter(c => !c.none).every(c => blues.indexOf(c.color) >= 0), 'wa: Inbound draws the Blues ramp',
    [...new Set(drawn.map(c => c.color))]);
  const none = drawn.filter(c => c.none);
  check(none.length > 0, 'wa: some counties have no movements in 2024 Q1 Inbound', none.length);
  if (none.length) {
    const hpx = await p.eval(PIXEL(H, none[0].name));
    check(hpx.every(x => x >= 185) && Math.max(...hpx) - Math.min(...hpx) <= 6, 'wa: ' + none[0].name + ' hatched ' +
      '(light gray, no class color)', hpx);
    tip = await hover(b, H, none[0].name);
    check(tip === none[0].name + 'No movements', 'wa: hover on a hatched county says No movements', tip);
  }
  let lg = await p.eval(`document.getElementById('legend-panel').textContent`);
  check(/Total animals \(Inbound\)/.test(lg), 'wa: the legend names Inbound', lg);

  // Animals per square mile: the values divided by the land area; the classes follow; hover adds the line.
  await act(p, choose('s-measure', 'per_sq_mi'));
  exp = await p.eval(EXPECT);
  drawn = await p.eval(DRAWN(H));
  check(JSON.stringify(drawn) === JSON.stringify(exp[0]), 'wa: per square mile: each fill is its class\'s color');
  lg = await p.eval(`document.getElementById('legend-panel').textContent`);
  check(/Animals per square mile \(Inbound\)/.test(lg), 'wa: the legend names Animals per square mile', lg);
  const shadedOne = drawn.find(c => !c.none);
  tip = await hover(b, H, shadedOne.name);
  check(/Inbound: [\d,]+ animals[\d.,]+ animals per sq mi$/.test(tip), 'wa: hover adds the animals per sq mi', tip);

  // Quantile, 3 bins, a solid fill.
  await act(p, choose('s-classes', 'quantile'));
  await act(p, choose('s-bins', '3'));
  exp = await p.eval(EXPECT);
  drawn = await p.eval(DRAWN(H));
  check(JSON.stringify(drawn) === JSON.stringify(exp[0]), 'wa: Quantile, 3 bins: each fill is its class\'s color');
  const three = await p.eval(`CVIWA.choropleth.rampColors('Inbound', 3)`);
  check([...new Set(drawn.filter(c => !c.none).map(c => c.color))].every(c => three.indexOf(c) >= 0),
    'wa: 3 classes take the 3 colors evenly from the five', three);
  await act(p, choose('s-opacity', '1.0'));
  const solid = drawn.find(c => !c.none);
  const spx = await p.eval(PIXEL(H, solid.name));
  check(near(spx, hex(solid.color), 4), 'wa: Fill opacity 100% draws the class color itself', { spx, want: solid.color });
  // The circles keep their own opacity: back on Circles, Circle opacity shows 60%.
  await act(p, pick('wa-shape', 'circles'));
  ui = await p.eval(UI);
  check(ui.opacityLabel === 'Circle opacity' && ui.opacity === '0.6' && !ui.scalingHidden && ui.measureHidden &&
    !ui.modeDisabled && !ui.paletteDisabled, 'wa: back on Circles, the circles\' controls and opacity return', ui);
  check(await p.eval(`CVIWA.state.mapHandle.shadeDrawn.length === 0 &&
    CVIWA.state.mapHandle.map.querySourceFeatures('circles_source').length > 0`), 'wa: back on Circles, circles drawn');
  check(await p.eval(`CVIWA.state.mapHandle.map.getPaintProperty('county-lines', 'line-color')`) === '#8a8a8a',
    'wa: back on Circles, county lines gray again');
  await act(p, pick('wa-shape', 'shaded'));
  ui = await p.eval(UI);
  check(ui.opacity === '1.0' && ui.classes === 'quantile', 'wa: Shaded again keeps Fill opacity and classes', ui);

  // Spotlight: the other counties dimmed, the spotlit one outlined.
  const lit = drawn.find(c => !c.none).name;
  await act(p, tickOnly('f-spotlight', lit));
  const sp = await p.eval(`CVIWA.state.mapHandle.shadeDrawn.map(c => [c.name, c.dim, c.spot])`);
  check(sp.every(([n, dim, spot]) => (n === lit ? !dim && spot : dim && !spot)), 'wa: Spotlight: the others dimmed, ' +
    lit + ' outlined', sp.filter(x => x[0] === lit));
  const outline = await p.eval(`CVIWA.state.mapHandle.map.queryRenderedFeatures({ layers: ['choro-spot'] })
    .map(f => f.properties.name)`);
  check(outline.length > 0 && outline.every(n => n === lit), 'wa: the outline drawn for ' + lit, outline);
  await act(p, `document.querySelector('[data-clear=spotlight]') ? document.querySelector('[data-clear=spotlight]').click()
    : null;`);

  // The movement lines take over: the switch grayed with its reason; turned off, the shading comes back.
  await act(p, `document.getElementById('mv-on').click();`);
  ui = await p.eval(UI);
  check(ui.shapeDisabled && !ui.shapeReasonHidden && ui.shape === 'shaded', 'wa: movement lines on: the switch ' +
    'grayed with its reason, the choice kept', ui);
  check(await p.eval(`CVIWA.state.mapHandle.shadeDrawn.length === 0`), 'wa: movement lines on: no shading drawn');
  check(!ui.densityDisabled, 'wa: movement lines on: population density available', ui);
  await act(p, `document.getElementById('mv-on').click();`);
  check(await p.eval(`CVIWA.state.mapHandle.shadeDrawn.length === 39`), 'wa: movement lines off: the shading comes back');

  // Population density grayed with the reason while shaded.
  ui = await p.eval(UI);
  check(ui.densityDisabled && ui.pcReason === 'Population density cannot be shown over a county fill; switch to Circles.',
    'wa: population density grayed with its reason', ui);

  // Compare: both maps shaded with one set of classes and the same legend.
  await act(p, pick('period-mode', 'compare'));
  await p.waitFor('CVIWA.state.mapHandleB && CVIWA.state.mapHandleB.ready', 15000, 'right map ready');
  await act(p, choose('s-bins', '5'));
  await p.waitFor('CVIWA.state.mapHandleB.shadeDrawn && CVIWA.state.mapHandleB.shadeDrawn.length === 39', 8000,
    'right map shaded');
  exp = await p.eval(EXPECT);
  const dA = await p.eval(DRAWN('mapHandle'));
  const dB = await p.eval(DRAWN('mapHandleB'));
  check(JSON.stringify(dA) === JSON.stringify(exp[0]) && JSON.stringify(dB) === JSON.stringify(exp[1]),
    'wa: Compare: both maps\' fills from one set of classes worked out from both maps\' values');
  const lgA = await p.eval(`document.getElementById('legend-panel').textContent`);
  const lgB = await p.eval(`document.getElementById('legend-panel-b').textContent`);
  check(lgA === lgB && /No movements/.test(lgA), 'wa: Compare: one legend on both maps', { lgA, lgB });
  await act(p, pick('period-mode', 'single'));

  // Reset All: back to Circles, Total animals, Natural breaks and 80%.
  await act(p, `document.getElementById('reset-all').click();`);
  ui = await p.eval(UI);
  check(ui.shape === 'circles' && ui.measureHidden && ui.opacityLabel === 'Circle opacity' &&
    (await p.eval(`[CVIWA.state.shadeMeasure, CVIWA.state.shadeClasses, CVIWA.state.fillOpacity].join()`)) ===
    'total,natural,0.8', 'wa: Reset All: Circles, Total animals, Natural breaks, 80%', ui);
  check(b.log.requests.length === before || b.log.requests.slice(before).every(u => /^(file|data|blob):/.test(u)),
    'wa: no request leaves the page', b.log.requests.slice(before));
}
// ── Part: National Flow's live map ─────────────────────────────────────────────────────────────────────────────
const FLOW_UI = `(() => {
  const $ = id => document.getElementById(id);
  return { shape: document.querySelector('input[name=fl-shape]:checked').value,
    classesHidden: $('fl-classes-field').hidden, scalingHidden: $('fl-scaling-field').hidden,
    binsHidden: $('fl-bins-field').hidden, opacityLabel: $('fl-opacity-label').textContent, opacity: $('fl-opacity').value,
    multDisabled: $('fl-mult').disabled, multReason: !$('fl-mult-reason').hidden,
    paletteDisabled: $('fl-palette').disabled, paletteReason: !$('fl-palette-reason').hidden,
    combineDisabled: $('fl-combine').disabled, combineReason: !$('fl-combine-reason').hidden,
    tenDisabled: ['6', '7', '10'].every(v => [...$('fl-bins').options].find(o => o.value === v).disabled) };
})()`;
// What the test expects the Flow map to shade, from the page's own lines (flow.lines per species group).
const FLOW_EXPECT = `(() => {
  const fl = CVIWA.flowState, CP = CVIWA.choropleth, FL = CVIWA.flow, st = CVIWA.state;
  const f = CVIWA.crossfilter.mapFilters('flow', { direction: fl.direction, species: fl.species, speciesSub: fl.speciesSub,
    years: fl.years, quarters: fl.quarters, combine: false, scaling: fl.scaling, nBins: fl.nBins }, st.cf);
  const lines = FL.lines(st.master, f, FL.centers(window.WSDA_STATE_CENTERS));
  const cls = CP.stateClasses([lines], fl.shadeClasses, fl.nBins, fl.direction);
  const sv = CP.stateValues(lines);
  return [...sv.values.keys()].sort().map(code => { const c = cls.classOf(sv.values.get(code));
    return { code, color: c ? cls.colors[c - 1] : null }; });
})()`;
const FLOW_DRAWN = `CVIWA.state.flowHandle.shadeDrawn.map(s => ({ code: s.code, color: s.none ? null : s.color }))`;
// A rendered pixel of the Flow map at a state's center, as [r, g, b].
const FLOW_PIXEL = code => `(() => {
  const m = CVIWA.state.flowHandle.map, c = CVIWA.flow.centers(window.WSDA_STATE_CENTERS).get(${JSON.stringify(code)});
  const q = m.project([c.lon, c.lat]); m.redraw();
  const cv = m.getCanvas(), k = cv.width / cv.clientWidth, g = document.createElement('canvas');
  g.width = cv.width; g.height = cv.height; const x = g.getContext('2d'); x.drawImage(cv, 0, 0);
  const d = x.getImageData(Math.round(q.x * k), Math.round(q.y * k) + 10, 1, 1).data;
  return [d[0], d[1], d[2]];
})()`;
async function flowAct(p, js) {
  const v = await p.eval('CVIWA.flowState.version');
  await p.eval('(() => { ' + js + ' })()');
  await p.waitFor('CVIWA.flowState.version > ' + v, 5000, 'Flow redrawn after: ' + js.slice(0, 80));
  await sleep(200);
}
async function partFlow(b) {
  const p = b.page;
  await openCvi(b);
  await p.viewport(1400, 1000);
  await p.eval(`document.querySelector('.map-toggle-group [data-view=flow]').click()`);
  await p.waitFor('CVIWA.state.flowHandle && CVIWA.state.flowHandle.ready && CVIWA.flowState.drawn', 20000, 'Flow ready');
  await sleep(500);
  let ui = await p.eval(FLOW_UI);
  check(ui.shape === 'lines' && ui.classesHidden && !ui.scalingHidden && ui.opacityLabel === 'Line opacity' &&
    !ui.multDisabled && !ui.paletteDisabled && !ui.combineDisabled, 'flow: Lines at the start, the shading controls ' +
    'hidden', ui);
  check(await p.eval(`CVIWA.state.flowHandle.drawn.length > 0`), 'flow: lines drawn at the start');

  await flowAct(p, pick('fl-shape', 'shaded'));
  ui = await p.eval(FLOW_UI);
  check(ui.shape === 'shaded' && !ui.classesHidden && ui.scalingHidden && !ui.binsHidden && ui.opacityLabel ===
    'Fill opacity' && ui.opacity === '0.8' && ui.tenDisabled, 'flow: Shaded: Shading classes, bins and Fill opacity ' +
    '80% shown', ui);
  check(ui.multDisabled && ui.multReason && ui.paletteDisabled && ui.paletteReason && ui.combineDisabled &&
    ui.combineReason, 'flow: Line width, Color palette and Combine species grayed with their reasons', ui);
  check(await p.eval(`CVIWA.state.flowHandle.drawn.length === 0`), 'flow: no lines drawn while shaded');
  let exp = await p.eval(FLOW_EXPECT);
  let drawn = await p.eval(FLOW_DRAWN);
  check(exp.length > 0 && JSON.stringify(drawn) === JSON.stringify(exp), 'flow: each state\'s fill is its class\'s ' +
    'color (Inbound)', { drawn, exp });
  const blues = await p.eval(`CVIWA.choropleth.FIVE.Inbound`);
  check(drawn.every(x => blues.indexOf(x.color) >= 0), 'flow: Inbound draws the Blues ramp', drawn.map(x => x.color));
  const st0 = exp[0];
  const px = await p.eval(FLOW_PIXEL(st0.code));
  check(near(px, blend(hex(st0.color), 0.8, hex('#ececec')), 10), 'flow: ' + st0.code + ' drawn in its class color',
    { px, want: blend(hex(st0.color), 0.8, hex('#ececec')) });
  const wa = await p.eval(FLOW_PIXEL('WA'));
  check(wa.every(x => x >= 250), 'flow: Washington drawn white (the hub)', wa);
  const nonePx = await p.eval(FLOW_PIXEL('TX'));
  const texas = exp.find(x => x.code === 'TX');
  if (!texas) check(near(nonePx, hex('#ececec'), 4), 'flow: a state with no movements stays land gray', nonePx);
  const lines = await p.eval(`CVIWA.state.flowHandle.map.getPaintProperty('state-lines', 'line-color')`);
  check(lines === '#ffffff', 'flow: state lines white while shaded', lines);
  let legend = await p.eval(`document.getElementById('legend-panel-flow').textContent`);
  check(/Total animals \(Inbound\)/.test(legend) && /No movements/.test(legend) && /Washington/.test(legend) &&
    /Species added together/.test(legend), 'flow: the legend names the measure, direction, No movements, ' +
    'Washington and the species', legend);
  await p.screenshotFull(path.join(OUT, 'flow_shaded.png'), 1400, 1000);
  await p.eval(`(() => { const t = document.getElementById('legend-toggle-flow');
    if (document.getElementById('legend-panel-flow').hidden) t.click(); return true; })()`);
  await textAudit(p, 'flow');

  // Hover on a shaded state: its total and species.
  const at = await p.eval(`(() => { const m = CVIWA.state.flowHandle.map,
    c = CVIWA.flow.centers(window.WSDA_STATE_CENTERS).get(${JSON.stringify(st0.code)});
    const q = m.project([c.lon, c.lat]), r = m.getCanvas().getBoundingClientRect(); return [r.left + q.x, r.top + q.y + 10]; })()`);
  await b.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at[0] - 3, y: at[1] }, b.sid);
  await b.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at[0], y: at[1] }, b.sid);
  await sleep(250);
  const tip = await p.eval(`(() => { const t = document.querySelector('#flow-map .maplibregl-popup-content');
    return t ? t.textContent : ''; })()`);
  check(tip.indexOf(st0.code + 'Total: ') === 0 && / animals/.test(tip), 'flow: hover gives the state\'s total and ' +
    'species', tip);

  // Outbound: the Oranges ramp; Combined: GnBu.
  await flowAct(p, `document.querySelector('input[name=fl-direction][value=outbound]').click();`);
  exp = await p.eval(FLOW_EXPECT);
  drawn = await p.eval(FLOW_DRAWN);
  const oranges = await p.eval(`CVIWA.choropleth.FIVE.Outbound`);
  check(JSON.stringify(drawn) === JSON.stringify(exp) && drawn.every(x => oranges.indexOf(x.color) >= 0),
    'flow: Outbound: each fill its class\'s Oranges color', { drawn, exp });
  await flowAct(p, `document.querySelector('input[name=fl-direction][value=combined]').click();`);
  exp = await p.eval(FLOW_EXPECT);
  drawn = await p.eval(FLOW_DRAWN);
  const gnbu = await p.eval(`CVIWA.choropleth.FIVE.Combined`);
  check(JSON.stringify(drawn) === JSON.stringify(exp) && drawn.every(x => gnbu.indexOf(x.color) >= 0),
    'flow: Combined: each fill its class\'s GnBu color', { drawn, exp });

  // A state picked in a chart: outlined, the others dimmed.
  const picked = exp[0].code;
  await flowAct(p, `CVIWA.state.cf.flow.place = [${JSON.stringify(picked)}];
    document.querySelector('input[name=fl-direction][value=combined]').dispatchEvent(new Event('change'));`);
  const marks = await p.eval(`CVIWA.state.flowHandle.shadeDrawn.map(s => [s.code, !!s.dim, !!s.picked])`);
  check(marks.every(([c, dim, pk]) => (c === picked ? !dim && pk : dim && !pk)), 'flow: a picked state outlined, ' +
    'the others dimmed', marks.slice(0, 5));
  await p.eval(`CVIWA.state.cf.flow.place = [];`);

  // Back to Lines: the lines and the gray state lines come back.
  await flowAct(p, pick('fl-shape', 'lines'));
  ui = await p.eval(FLOW_UI);
  check(ui.opacityLabel === 'Line opacity' && !ui.multDisabled && !ui.scalingHidden, 'flow: back on Lines, the line ' +
    'controls return', ui);
  check(await p.eval(`CVIWA.state.flowHandle.drawn.length > 0 && CVIWA.state.flowHandle.shadeDrawn.length === 0 &&
    CVIWA.state.flowHandle.map.getPaintProperty('state-lines', 'line-color') === '#888888'`), 'flow: back on Lines, ' +
    'lines drawn and the state lines gray');
  await flowAct(p, pick('fl-shape', 'shaded'));
  await flowAct(p, `document.getElementById('reset-all').click();`);
  ui = await p.eval(FLOW_UI);
  check(ui.shape === 'lines' && ui.opacityLabel === 'Line opacity', 'flow: Reset All: back to Lines', ui);
}

// ── Part: counties without animal counts, and county names ─────────────────────────────────────────────────────
async function partRecords(b) {
  const p = b.page;
  await openCvi(b);
  await p.viewport(1400, 1000);
  await p.eval(`(() => { CVIWA.state.mapHandle.map.resize(); document.getElementById('fit-wa').click(); return true; })()`);
  await sleep(600);
  // In the loaded rows (synthetic): one county's animal counts blanked, another county's name written in capitals,
  // and a row placed in a county the map does not have.
  const picked = await p.eval(`(() => { const rows = CVIWA.state.master.rows, n = new Map();
    const at = r => r.Movement === 'Inbound' ? r['Dest.County'] : r['Origin.County'];
    rows.forEach(r => { if (r.Movement === 'Inbound' || r.Movement === 'Outbound') n.set(at(r), (n.get(at(r)) || 0) + 1); });
    const names = CVIWA_GEO.counties.features.map(f => f.properties.name).filter(x => n.has(x));
    const blank = names.sort((a, c) => n.get(a) - n.get(c) || (a < c ? -1 : 1))[0];
    rows.forEach(r => { if ((r.Movement === 'Inbound' || r.Movement === 'Outbound') && at(r) === blank) r['Total.Animals'] = null; });
    const upper = names.filter(x => x !== blank && n.get(x) > 3)[0];
    rows.forEach(r => { if (r.Movement === 'Inbound' && r['Dest.County'] === upper) r['Dest.County'] = upper.toUpperCase();
      if (r.Movement === 'Outbound' && r['Origin.County'] === upper) r['Origin.County'] = upper.toUpperCase(); });
    const extra = Object.assign({}, rows.find(r => r.Movement === 'Inbound'), { 'Dest.County': 'Yakama Nation', 'Total.Animals': 77 });
    rows.push(extra);
    return { blank, upper, records: n.get(blank) }; })()`);
  await act(p, pick('wa-shape', 'shaded'));
  const tip = await hover(b, 'mapHandle', picked.blank);
  check(tip.indexOf(picked.blank) === 0 && /No movements/.test(tip) &&
    tip.indexOf(picked.records + ' CVI ' + (picked.records === 1 ? 'record' : 'records') + ', no animal counts') > 0,
  'records: a county whose rows have no animal counts: "No movements" and its CVI records on hover',
  { tip, picked });
  const drawn = await p.eval(DRAWN('mapHandle'));
  const up = drawn.find(x => x.name === picked.upper);
  check(up && !up.none, 'records: a county written in capitals shaded as itself', up);
  const legend = await p.eval(`document.getElementById('legend-panel').textContent`);
  check(/Not on the map: 77 animals in counties named Yakama Nation/.test(legend), 'records: the legend names the ' +
    'animals in a county the map does not have', legend.slice(-160));
}

// ── Part: Alaska and Hawaii ────────────────────────────────────────────────────────────────────────────────────
const AKHI = path.join(ROOT, 'test-tables', 'flow_alaska_hawaii.csv');
const INSETS = `(() => { const h = CVIWA.state.flowHandle, m = h.insetsDrawn, layer = h.map.getContainer().querySelector('svg.flow-insets');
  const q = h.map.project(CVIWA.flow.WA_ANCHOR);
  return { boxes: m.boxes.map(b => ({ code: b.code, x: b.x, y: b.y, w: b.w, h: b.h, anchor: b.anchor, fill: b.fill,
    fillOpacity: b.fillOpacity, value: b.value })), lines: m.lines.map(l => ({ state: l.state, d: l.d })),
    rects: layer ? layer.querySelectorAll('rect').length : 0, paths: layer ? layer.querySelectorAll('path').length : 0,
    hub: [q.x, q.y], mapStates: h.drawn.map(f => f.properties.state),
    nav: h.map.getContainer().querySelector('.maplibregl-ctrl-top-left').getBoundingClientRect().right -
      h.map.getContainer().getBoundingClientRect().left }; })()`;
async function partInsets(b) {
  const p = b.page;
  await openCvi(b, AKHI);
  await p.viewport(1400, 1000);
  await p.eval(`document.querySelector('.map-toggle-group [data-view=flow]').click()`);
  await p.waitFor('CVIWA.state.flowHandle && CVIWA.state.flowHandle.ready && CVIWA.flowState.drawn', 20000, 'Flow ready');
  await flowAct(p, `document.querySelector('input[name=fl-direction][value=combined]').click();`);
  await sleep(300);
  let ins = await p.eval(INSETS);
  const want = await p.eval(`CVIWA.flow.draw(CVIWA.flowState.data, CVIWA.flowState).lines.filter(a => a.state === 'AK' ||
    a.state === 'HI').map(a => a.state)`).catch(() => null);
  check(ins.boxes.map(x => x.code).join() === 'AK,HI' && ins.rects === 2, 'insets: Lines: a box for Alaska and for ' +
    'Hawaii', ins.boxes);
  check(ins.boxes.every(x => x.h === ins.boxes[0].h) && ins.boxes[0].x >= ins.nav && ins.boxes[0].y >= 0 &&
    ins.boxes[0].x + ins.boxes[0].w < ins.boxes[1].x, 'insets: the boxes as tall, beside the zoom buttons, side by ' +
    'side', { nav: ins.nav, boxes: ins.boxes.map(x => [x.x, x.y, x.w, x.h]) });
  check(ins.lines.length > 0 && ins.lines.every(l => l.state === 'AK' || l.state === 'HI') &&
    !ins.mapStates.some(s => s === 'AK' || s === 'HI') && ins.mapStates.length > 0, 'insets: the lines to Alaska and ' +
    'Hawaii drawn to the boxes, not on the map; the others on the map', { lines: ins.lines.length, want });
  const ends = l => l.d.match(/-?[\d.]+/g).map(Number);
  const close = (a, c) => Math.abs(a - c) < 0.11;
  check(ins.lines.every(l => { const e = ends(l), box = ins.boxes.find(x => x.code === l.state);
    return close(e[0], ins.hub[0]) && close(e[1], ins.hub[1]) && close(e[2], box.anchor[0]) && close(e[3], box.anchor[1]); }),
  'insets: each line from Washington\'s anchor to its state\'s center in the box', ins.lines.map(l => l.d));
  check(ins.boxes.every(x => x.fill === '#ececec' && x.fillOpacity === 1) && ins.boxes.every(x => x.value > 0),
    'insets: Lines: the outlines land gray, each box with its animals', ins.boxes);
  // Hover on Alaska's line (real pointer events at its middle).
  const mid = await p.eval(`(() => { const h = CVIWA.state.flowHandle, l = h.insetsDrawn.lines.find(x => x.state === 'AK');
    const n = l.d.match(/-?[\\d.]+/g).map(Number), r = h.map.getContainer().getBoundingClientRect();
    return [r.left + (n[0] + n[2]) / 2, r.top + (n[1] + n[3]) / 2]; })()`);
  await b.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: mid[0] - 2, y: mid[1] }, b.sid);
  await b.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: mid[0], y: mid[1] }, b.sid);
  await sleep(250);
  let tip = await p.eval(`(() => { const t = document.querySelector('#flow-map .maplibregl-popup-content'); return t ? t.textContent : ''; })()`);
  check(tip.indexOf('AK') === 0 && / animals/.test(tip), 'insets: hover on Alaska\'s line gives its tooltip', tip);
  await b.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 700, y: 900 }, b.sid);
  // The map moves: the lines follow Washington, the boxes stay.
  await p.eval(`CVIWA.state.flowHandle.map.jumpTo({ center: [-100, 41] }); true`);
  await sleep(300);
  const moved = await p.eval(INSETS);
  check(moved.hub[0] !== ins.hub[0] && moved.lines.every(l => { const e = ends(l);
    return close(e[0], moved.hub[0]) && close(e[1], moved.hub[1]); }) && moved.boxes[0].x === ins.boxes[0].x,
  'insets: when the map moves the lines follow Washington and the boxes stay', { before: ins.hub, after: moved.hub });
  await p.eval(`CVIWA.flowmap.fitView(CVIWA.state.flowHandle); true`);
  await sleep(300);

  // Shaded states: each outline in its class's color.
  await flowAct(p, pick('fl-shape', 'shaded'));
  await sleep(300);
  ins = await p.eval(INSETS);
  const shadeOf = await p.eval(`CVIWA.state.flowHandle.shadeDrawn.filter(s => s.code === 'AK' || s.code === 'HI')
    .map(s => ({ code: s.code, color: s.color, value: s.value }))`);
  check(ins.boxes.map(x => x.code).join() === 'AK,HI' && ins.lines.length === 0 && ins.boxes.every(x => {
    const s = shadeOf.find(y => y.code === x.code); return s && x.fill === s.color && x.fillOpacity === 0.8 &&
      x.value === s.value; }), 'insets: Shaded: each outline in its class\'s color at the fill opacity, no line',
  { boxes: ins.boxes, shadeOf });
  const ak = ins.boxes[0];
  const at = await p.eval(`(() => { const r = CVIWA.state.flowHandle.map.getContainer().getBoundingClientRect();
    return [r.left, r.top]; })()`);
  const shot = await b.send('Page.captureScreenshot', { format: 'png', clip: { x: at[0] + ak.anchor[0] - 6,
    y: at[1] + ak.anchor[1] - 6, width: 12, height: 12, scale: 1 } }, b.sid);
  const px = await p.eval(`new Promise(res => { const i = new Image(); i.onload = () => { const c = document.createElement('canvas');
    c.width = 12; c.height = 12; const g = c.getContext('2d'); g.drawImage(i, 0, 0); const d = g.getImageData(6, 6, 1, 1).data;
    res([d[0], d[1], d[2]]); }; i.src = 'data:image/png;base64,${shot.data}'; })`);
  const under = blend(hex('#ffffff'), 0.92, hex('#f8f9fa'));
  check(near(px, blend(hex(ak.fill), 0.8, under), 10), 'insets: Alaska drawn in its class color on screen',
    { px, want: blend(hex(ak.fill), 0.8, under) });
  const shapeAt = [at[0] + ak.anchor[0], at[1] + ak.anchor[1]];
  await b.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: shapeAt[0] - 2, y: shapeAt[1] }, b.sid);
  await b.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: shapeAt[0], y: shapeAt[1] }, b.sid);
  await sleep(250);
  tip = await p.eval(`(() => { const t = document.querySelector('#flow-map .maplibregl-popup-content'); return t ? t.textContent : ''; })()`);
  check(tip.indexOf('AKTotal: ') === 0, 'insets: hover on Alaska\'s outline gives its total and species', tip);
  await b.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 700, y: 900 }, b.sid);
  await p.eval(`CVIWA.flowmap.screenshot(CVIWA.state.flowHandle).then(() => true)`);
  check((await p.eval(`(CVIWA.state.flowHandle.lastInsets || []).join()`)) === 'AK,HI', 'insets: the screenshot ' +
    'draws both boxes');
  await textAudit(p, 'insets');

  // The Full tier has no Alaska or Hawaii row: no box.
  await openCvi(b);
  await p.eval(`document.querySelector('.map-toggle-group [data-view=flow]').click()`);
  await p.waitFor('CVIWA.state.flowHandle && CVIWA.state.flowHandle.ready && CVIWA.flowState.drawn', 20000, 'Flow ready');
  await sleep(300);
  ins = await p.eval(INSETS);
  check(ins.boxes.length === 0 && ins.rects === 0, 'insets: no box without Alaska or Hawaii rows', ins.boxes);
}

// ── Part: the branded PNG and GIF ──────────────────────────────────────────────────────────────────────────────
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
async function exportTools(b) {
  const p = b.page;
  const DL = path.join(OUT, 'downloads');
  fs.rmSync(DL, { recursive: true, force: true });
  fs.mkdirSync(DL, { recursive: true });
  await b.send('Browser.setDownloadBehavior', { behavior: 'allowAndName', downloadPath: DL, eventsEnabled: true });
  const download = ms => new Promise(res => {
    const h = m => {
      if (m.method === 'Browser.downloadProgress' && (m.params.state === 'completed' || m.params.state === 'canceled')) {
        clearTimeout(t);
        b.listeners.splice(b.listeners.indexOf(h), 1);
        res({ state: m.params.state, guid: m.params.guid });
      }
    };
    const t = setTimeout(() => { b.listeners.splice(b.listeners.indexOf(h), 1); res({ state: 'timeout' }); }, ms);
    b.listeners.push(h);
  });
  const formats = list => p.eval(`(() => { document.getElementById('export-section').open = true;
    document.querySelectorAll('input[name=export-format]').forEach(i => {
    if (!i.disabled) i.checked = ${JSON.stringify(list)}.includes(i.value); });
    document.getElementById('export-gif').dispatchEvent(new Event('change')); return true; })()`);
  const exportNow = async () => {
    const dl = download(120000);
    await p.eval(`document.getElementById('run-export').click(); true`);
    const got = await dl;
    await p.waitFor('!CVIWA.state.exporting', 120000, 'export finished');
    return got.state === 'completed' ? readZip(fs.readFileSync(path.join(DL, got.guid))) : [];
  };
  const preview = async () => {
    await p.eval(`CVIWA.state.lastBranded = null; document.getElementById('preview-map').click(); true`);
    await p.waitFor('CVIWA.state.lastBranded && !CVIWA.state.exporting', 60000, 'preview drawn');
    await p.eval(`(() => { const d = document.querySelector('dialog[open]'); if (d) d.close(); return true; })()`);
    return p.eval(`CVIWA.state.lastBranded.models.map(m => ({ fileName: m.fileName, shade: m.shade && { breaks:
      m.shade.breaks, colors: m.shade.colors, counties: m.shade.counties && m.shade.counties.map(c => [c.name, c.none ?
      null : c.color]), states: m.shade.states && m.shade.states.map(x => [x.code, x.color]) }, circles: m.circles &&
      m.circles.length, lines: m.lines && m.lines.length }))`);
  };
  return { formats, exportNow, preview };
}
// WA State's PNG drawn in the page from the live map's rows and classes, its pixels read back, and a point inside
// each county clear of its name (and 4 points from its edges): the color there against the class's.
const WA_PNG_PIXELS = `(async () => {
  const st = CVIWA.state, BM = CVIWA.brandedmaps, BR = WSDA.branded, CP = CVIWA.choropleth;
  const f = { species: st.species, years: st.years, quarters: st.quarters, direction: st.direction, mode: st.mode,
    scaling: st.scaling, nBins: st.nBins, rawSpecies: st.speciesSub };
  const input = { rows: st.data, f, universe: st.master.speciesChoices, title: '', date: new Date(2026, 9, 16),
    counties: CVIWA_GEO.counties.features, shade: { measure: st.shadeMeasure, method: st.shadeClasses, nBins: st.nBins,
    opacity: st.fillOpacity, cls: st.shade.cls } };
  const built = BM.wa(input, null);
  const fit = BM.waLayout(input).fit;
  const size = BR.pixelSize(100);
  const img = await BR.pixels(BR.svg(built.parts, size), size);
  const k = size.width / BR.W;
  const boxes = built.model.labelPlaces.map(l => l.box);
  const pad = 8;   // a name's white halo reaches past its box
  const out = [];
  for (const c of built.model.shade.counties) {
    const feat = CVIWA_GEO.counties.features.find(x => x.properties.name === c.name);
    const inside = (x, y) => BR.insideGeometry(feat.geometry, fit.project, x, y);
    const rings = feat.geometry.type === 'Polygon' ? feat.geometry.coordinates : feat.geometry.coordinates.flat(1);
    const pts = [].concat(...rings).map(q => fit.project(q[0], q[1]));
    const xs = pts.map(q => q[0]), ys = pts.map(q => q[1]);
    let at = null;
    for (let y = Math.min(...ys); y < Math.max(...ys) && !at; y += 2) {
      for (let x = Math.min(...xs); x < Math.max(...xs) && !at; x += 2) {
        // Inside on every side by 7 points, so a tiny island (left out of the PNG's paths) is never the sample.
        const ok = [[0, 0], [7, 0], [-7, 0], [0, 7], [0, -7], [5, 5], [-5, 5], [5, -5], [-5, -5]]
          .every(([dx, dy]) => inside(x + dx, y + dy)) &&
          !boxes.some(b => x > b.x0 - pad && x < b.x1 + pad && y > b.y0 - pad && y < b.y1 + pad);
        if (ok) at = [x, y];
      }
    }
    if (!at) { out.push({ name: c.name, missing: true }); continue; }
    const i = (Math.round(at[1] * k) * size.width + Math.round(at[0] * k)) * 4;
    out.push({ name: c.name, none: c.none, color: c.color, at, px: [img.data[i], img.data[i + 1], img.data[i + 2]] });
  }
  let debug = null;
  if (window.__chDebug) {
    const cv = await BR.draw(BR.svg(built.parts, size), size);
    const g = cv.getContext('2d'); g.strokeStyle = '#ff00ff'; g.lineWidth = 2;
    out.filter(o => o.at).forEach(o => { g.beginPath(); g.arc(o.at[0] * k, o.at[1] * k, 4, 0, 7); g.stroke(); });
    debug = cv.toDataURL('image/png');
  }
  return { opacity: Number(st.fillOpacity), samples: out, debug };
})()`;
async function partPng(b) {
  const p = b.page;
  const { formats, exportNow, preview } = await exportTools(b);
  await openCvi(b);
  await p.viewport(1400, 1000);
  await act(p, pick('wa-shape', 'shaded'));
  await act(p, `document.querySelector('input[name=direction][value=Outbound]').click();`);
  await act(p, tickOnly('f-years', '2024'));
  // Preview Map: the page's PNG shaded with the live map's classes and colors.
  let models = await preview();
  const live = await p.eval(`({ breaks: CVIWA.state.shade.cls.breaks, counties: CVIWA.state.mapHandle.shadeDrawn.map(c =>
    [c.name, c.none ? null : c.color]) })`);
  check(models.length === 1 && models[0].shade && JSON.stringify(models[0].shade.breaks) === JSON.stringify(live.breaks)
    && JSON.stringify(models[0].shade.counties) === JSON.stringify(live.counties) && models[0].circles === 0,
  'png: WA State: Preview Map\'s page shaded as the live map', { model: models[0] && models[0].shade, live });
  // The PNG's pixels.
  if (process.env.CH_DEBUG) await p.eval('window.__chDebug = true');
  const px = await p.eval(WA_PNG_PIXELS);
  if (px.debug) fs.writeFileSync(path.join(OUT, 'debug_png.png'), Buffer.from(px.debug.split(',')[1], 'base64'));
  const missing = px.samples.filter(x => x.missing).map(x => x.name);
  // The narrow or island counties (Island, Kitsap, San Juan, Wahkiakum) have no point 7 points inside on every side.
  check(missing.length <= 4 && px.samples.length === 39, 'png: WA State: a sample point inside 35 or more counties, ' +
    'clear of its name', missing);
  const bad = px.samples.filter(x => !x.missing).filter(x => (x.none
    ? !(x.px.every(v => v >= 185) && Math.max(...x.px) - Math.min(...x.px) <= 8)
    : !near(x.px, blend(hex(x.color), px.opacity, [255, 255, 255]), 8)));
  check(!bad.length && px.samples.some(x => x.none), 'png: WA State: each county\'s pixels in its class color at the ' +
    'fill opacity, or the hatch', bad.slice(0, 4));

  // Export: the PNG, the GIF by quarter (four frames sharing one set of classes) and export_params.json.
  await formats(['branded_png', 'branded_gif']);
  let entries = await exportNow();
  const names = entries.map(e => e.name.split('/').pop());
  check(names.some(n => /^CVI_County_Map_.*\.png$/.test(n)) && names.some(n => /TimeSeries.*\.gif$/.test(n)),
    'png: WA State: the export holds the PNG and the GIF', names);
  const params = JSON.parse((entries.find(e => /export_params\.json$/.test(e.name)) || { data: '{}' }).data.toString());
  const cls = await p.eval(`CVIWA.state.shade.cls.breaks`);
  check(params.map_style === 'shaded' && params.shade_measure === 'total_animals' &&
    params.shade_classes === 'natural_breaks' && JSON.stringify(params.shade_breaks) ===
    JSON.stringify(cls.map(x => Number(Number(x).toPrecision(6)))), 'png: export_params.json records the shaded map',
  params);
  const gif = await p.eval(`(() => { const g = CVIWA.state.lastGif, st = CVIWA.state, CP = CVIWA.choropleth;
    const f = { species: st.species, years: st.years, quarters: st.quarters, direction: st.direction, mode: st.mode,
      scaling: st.scaling, nBins: st.nBins, rawSpecies: st.speciesSub };
    const fr = CVIWA.timeseries.waFrames(st.master, f, 'quarter');
    const all = CP.countyClasses(fr.frames.map(x => x.rows), st.shadeMeasure, st.shadeClasses, st.nBins, st.direction);
    return { n: g.models.length, breaks: g.models.map(m => m.shade && m.shade.breaks), want: all.breaks,
      names: g.models.map(m => m.labelPlaces.map(l => l.name + l.x + ',' + l.y).join()) }; })()`);
  check(gif.n === 4 && gif.breaks.every(x => JSON.stringify(x) === JSON.stringify(gif.want)),
    'png: GIF: every frame shaded with the classes of every frame\'s values', gif);
  check(gif.names.every(x => x === gif.names[0]), 'png: GIF: every county\'s name held still');

  // Compare: the left and right PNGs from one set of classes.
  await act(p, pick('period-mode', 'compare'));
  await p.waitFor('CVIWA.state.mapHandleB && CVIWA.state.mapHandleB.ready', 15000, 'right map ready');
  await p.waitFor('CVIWA.state.mapHandleB.shadeDrawn && CVIWA.state.mapHandleB.shadeDrawn.length === 39', 8000,
    'right map shaded');
  models = await preview();
  const both = await p.eval(`CVIWA.state.shade.cls.breaks`);
  check(models.length === 2 && /_left\.png$/.test(models[0].fileName) && /_right\.png$/.test(models[1].fileName) &&
    models.every(m => JSON.stringify(m.shade.breaks) === JSON.stringify(both)), 'png: Compare: the left and right ' +
    'PNGs shaded from one set of classes', models.map(m => [m.fileName, m.shade && m.shade.breaks]));
  await act(p, pick('period-mode', 'single'));

  // National Flow: the PNG shaded as the live map; the GIF's frames sharing classes.
  await p.eval(`document.getElementById('show-flow').click(); true`);
  await p.waitFor('CVIWA.state.flowHandle && CVIWA.state.flowHandle.ready && CVIWA.flowState.drawn', 20000, 'Flow ready');
  await flowAct(p, pick('fl-shape', 'shaded'));
  models = await preview();
  const fl = await p.eval(`({ breaks: CVIWA.flowState.shade.cls.breaks, states: CVIWA.flowState.shade.states.map(s =>
    [s.code, s.none ? null : s.color]) })`);
  check(models.length === 1 && models[0].shade && JSON.stringify(models[0].shade.breaks) === JSON.stringify(fl.breaks)
    && JSON.stringify(models[0].shade.states) === JSON.stringify(fl.states) && models[0].lines === 0,
  'png: Flow: Preview Map\'s page shaded as the live map, no lines', { model: models[0] && models[0].shade, fl });
  await formats(['branded_gif']);
  entries = await exportNow();
  const fgif = await p.eval(`(() => { const g = CVIWA.state.lastGif;
    return { n: g.models.length, breaks: g.models.map(m => m.shade && m.shade.breaks), lines: g.models.map(m =>
      m.lines.length) }; })()`);
  check(fgif.n > 1 && fgif.breaks.every(x => x && JSON.stringify(x) === JSON.stringify(fgif.breaks[0])) &&
    fgif.lines.every(n => n === 0), 'png: Flow GIF: every frame shaded with one set of classes, no lines', fgif);
  check(entries.some(e => /CVI_Flow_TimeSeries_.*\.gif$/.test(e.name)), 'png: Flow GIF written',
    entries.map(e => e.name));
}


// The WA State map's shading controls as the page shows them.
const UI = `(() => {
  const $ = id => document.getElementById(id);
  return { shape: document.querySelector('input[name=wa-shape]:checked').value,
    measureHidden: $('measure-field').hidden, classesHidden: $('classes-field').hidden,
    scalingHidden: $('scaling-field').hidden, binsHidden: $('bins-field').hidden,
    opacityLabel: $('s-opacity-label').textContent, opacity: $('s-opacity').value, classes: $('s-classes').value,
    smoothDisabled: ['log', 'sqrt', 'linear'].every(v => [...$('s-classes').options].find(o => o.value === v).disabled),
    tenDisabled: ['6', '7', '10'].every(v => [...$('s-bins').options].find(o => o.value === v).disabled),
    modeDisabled: [...document.querySelectorAll('input[name=mode]')].every(r => r.disabled),
    modeReasonHidden: $('mode-reason').hidden, paletteDisabled: $('s-palette').disabled,
    paletteReasonHidden: $('palette-reason').hidden,
    shapeDisabled: [...document.querySelectorAll('input[name=wa-shape]')].every(r => r.disabled),
    shapeReasonHidden: $('shape-reason').hidden, densityDisabled: $('pc-density').disabled,
    pcReason: $('pc-reason').hidden ? '' : $('pc-reason').textContent };
})()`;


// ── Run ────────────────────────────────────────────────────────────────────────────────────────────────────────
(async () => {
  const t0 = Date.now();
  const b = await launch();
  const results = { browser: b.version, parts: PARTS };
  try {
    for (const part of PARTS) {
      try {
        if (part === 'wa') await partWa(b);
        if (part === 'records') await partRecords(b);
        if (part === 'flow') await partFlow(b);
        if (part === 'insets') await partInsets(b);
        if (part === 'png') await partPng(b);
      } catch (e) {
        check(false, part + ': the part ran to its end', String(e && e.stack || e));
      }
    }
    check(!b.log.exceptions.length, 'page: no uncaught exception', b.log.exceptions);
    check(!b.log.csp.length, 'page: no Content-Security-Policy message', b.log.csp);
  } finally {
    await b.close();
  }
  Object.assign(results, { passed, failed, counts, failures, seconds: Math.round((Date.now() - t0) / 1000) });
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'run.json'), JSON.stringify(results, null, 2));
  for (const f of failures) console.log('FAIL ' + f);
  console.log('CH browser: ' + passed + ' passed, ' + failed + ' failed (' + results.seconds + ' s) ' +
    JSON.stringify(counts));
  process.exitCode = failed ? 1 : 0;
})();
