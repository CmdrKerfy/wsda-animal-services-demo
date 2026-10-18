#!/usr/bin/env node
'use strict';
// Population-context browser suite: site/shared/population.js in installed Chrome, through the DevTools protocol, offline, foreground only (Chrome does not start from a
// background job). No packages.
//
// Parts (name some to run only those, for example: node tests/browser/run_pc_browser.js cvi infra):
//   cvi     the CVI page's switches: all off at the start and no request for a data file until
//           its switch is turned on, later turns using the loaded copy; the live layers in drawing order, the
//           both-on rule, the live legend, the map's credits, the names (10,000 or more on WA State, the picked
//           counties' on County Focus; none hidden under another), the hover text, the screenshot's names and
//           credits; grayed on National Flow with the reason; both Compare maps; the movement view's PNG; the
//           branded PNG and export_params.json with the layers; Reset All; a missing data file grays its switch with
//           the message.
//   infra   the Infrastructure dashboard's switches: the same start, legend and names; density grayed with the reason
//           while the PNG's Density (choropleth) view applies, its pick coming back with Locations; the picked
//           counties' names; the Facilities PNG with the layers (the Density view draws the outlines only) and
//           export_params.json; Reset All; the High-quality Branded preview timed with all three layers on (S9's
//           budget: 6 seconds; Standard 3).
//
// Usage (repository root, after node tests/node/run_f1_unit_tests.js and Rscript tests/oracle/s9_branded_oracle.R,
// whose fixture and facility files the parts reuse):
//   node tests/browser/run_pc_browser.js [cvi] [infra]
// Writes local-test-artifacts/pc/browser/run.json (results).
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join(ROOT, 'local-test-artifacts', 'pc', 'browser');
const S9 = path.join(ROOT, 'local-test-artifacts', 's9');
const PAGE = process.env.PC_PAGE_URL || pathToFileURL(path.join(ROOT, 'site', 'cvi', 'index.html')).href;
const INFRA = process.env.PC_INFRA_URL || pathToFileURL(path.join(ROOT, 'site', 'infrastructure', 'index.html')).href;
const CHROME = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ALL_PARTS = ['cvi', 'infra'];
const asked = process.argv.slice(2).filter(a => !a.startsWith('--'));
const PARTS = asked.length ? asked : ALL_PARTS;
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
    // The whole page at a given width and height.
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


const oracleOf = fx => JSON.parse(fs.readFileSync(path.join(S9, 'oracle_s9_' + fx + '.json'), 'utf8'));

async function openCvi(b, o) {
  await b.page.goto(PAGE);
  await b.page.waitFor('window.CVIWA && CVIWA.brandedmaps && CVIWA.state && CVIWA.state.mapHandle', 15000, 'page ready');
  const v = await b.page.eval('CVIWA.state.version');
  await b.page.setFiles('#file-input', [path.join(ROOT, o.file)]);
  await b.page.waitFor('CVIWA.state.master && !CVIWA.state.loading && CVIWA.state.version > ' + v, 20000, 'master loaded');
  await sleep(400);
}


// ── Shared steps of the cvi and infra parts ────────────────────────────────────────────────────────────────────
const DATA_FILE = /\/geo\/(citylimits|places|tracts)-wa\.js/;
const LAYER_OF = { cities: 'pc-cities-line', places: 'pc-places-fill', density: 'pc-density' };
const CITY_CREDIT = 'City limits: WA Department of Revenue';
const CENSUS_CREDIT = 'Population: U.S. Census Bureau, 2020 Census';
const DL = path.join(OUT, 'downloads');
// The three boxes as the page shows them.
const boxes = p => p.eval(`Object.fromEntries(['cities', 'places', 'density'].map(l => {
  const i = document.getElementById('pc-' + l); return [l, { checked: i.checked, disabled: i.disabled }]; }))`);
const clickBox = (p, l) => p.eval(`(() => { document.getElementById('pc-${l}').click(); return true; })()`);
// Waits until a layer is drawn (visible) or not on the map of handle (an expression).
const waitLayer = (p, handle, l, on) => p.waitFor(`(() => { const m = ${handle}.map, id = '${LAYER_OF[l]}';
  return ${on ? `!!m.getLayer(id) && m.getLayoutProperty(id, 'visibility') === 'visible'`
    : `!m.getLayer(id) || m.getLayoutProperty(id, 'visibility') === 'none'`}; })()`, 15000, l + (on ? ' drawn' : ' hidden'));
// The live names: those shown do not overlap each other or a county name shown, and lie inside the map.
const NAMES = handle => `(() => {
  const st = ${handle}, c = st.map.getContainer().getBoundingClientRect();
  const rect = e => e.getBoundingClientRect();
  const shown = st.pcLabels.map(m => m.getElement()).filter(e => !e.classList.contains('collided'));
  const counties = [...st.map.getContainer().querySelectorAll('.county-label:not(.pc-name):not(.hidden)')].map(rect);
  const meet = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 &&
    Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5;
  const rs = shown.map(rect);
  return { all: st.pcLabels.map(m => m.getElement().textContent), shown: shown.map(e => e.textContent),
    italic: shown.filter(e => e.classList.contains('pc-cdp')).map(e => getComputedStyle(e).fontStyle),
    apart: rs.every((a, i) => rs.every((b, j) => i === j || !meet(a, b))),
    clearOfCounties: rs.every(a => !counties.some(b => meet(a, b))),
    inside: rs.every(a => a.left >= c.left - 0.5 && a.right <= c.right + 0.5 && a.top >= c.top - 0.5 &&
      a.bottom <= c.bottom + 0.5) };
})()`;
// The names the page should ask for: from the data files (not the module), the both-on rule's sources.
const WANT_NAMES = (on, min, counties) => `(() => {
  const on = ${JSON.stringify(on)}, min = ${min};
  const cities = on.cities ? WSDA_CITYLIMITS.cities.map(c => ({ name: c.name, pop: c.pop, label: c.label })) : [];
  let places = [];
  if (on.places) {
    places = on.cities ? WSDA_PLACES.places.filter(p => p.kind === 'cdp' && p.trim !== 'dropped').map(p => {
      const t = p.trim === 'clipped' ? WSDA_PLACES.cdpOutsideCities.find(c => c.geoid === p.geoid) : null;
      return { name: p.name, pop: p.pop, label: t ? t.label : p.label };
    }) : WSDA_PLACES.places.map(p => ({ name: p.name, pop: p.pop, label: p.label }));
  }
  const feats = ${JSON.stringify(counties || null)} && CVIWA_GEO.counties.features.filter(f =>
    ${JSON.stringify(counties || [])}.includes(f.properties.name));
  const inRing = (x, y, r) => { let k = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    if ((r[i][1] > y) !== (r[j][1] > y) && x < (r[j][0] - r[i][0]) * (y - r[i][1]) / (r[j][1] - r[i][1]) + r[i][0]) k = !k; }
    return k; };
  const inF = (x, y, g) => (g.type === 'Polygon' ? [g.coordinates] : g.coordinates).some(p => inRing(x, y, p[0]) &&
    !p.slice(1).some(h => inRing(x, y, h)));
  return cities.concat(places).filter(n => (n.pop || 0) >= min)
    .filter(n => !feats || feats.some(f => inF(n.label[0], n.label[1], f.geometry))).map(n => n.name).sort();
})()`;
// The sidebar around the population group: which Fit buttons are shown and whether each lies below the group;
// whether the group's switch rows and names note are displayed; the switch labels' computed size; whether
// "County lines and labels" ends above the population group (the CVI page's order).
const SIDEBAR = `(() => {
  const block = document.getElementById('pc-block').getBoundingClientRect();
  const shown = e => !!e && e.getClientRects().length > 0;
  const fits = ['fit-wa', 'fit-focus', 'fit-conus'].map(id => document.getElementById(id)).filter(shown);
  const rows = [...document.querySelectorAll('#pc-block .tip-row, #pc-block .pc-names-note')];
  const label = getComputedStyle(document.querySelector('#pc-block .tip-row > label'));
  return { fits: fits.map(e => e.id), below: fits.every(e => e.getBoundingClientRect().top >= block.bottom - 0.5),
    rowsShown: rows.filter(shown).length, rows: rows.length, label: [label.fontSize, label.display, label.gap].join(' '),
    countyAbove: (() => { const g = document.getElementById('county-head').closest('.field');
      return shown(g) && g.getBoundingClientRect().bottom <= block.top + 0.5; })(),
    sample: (() => { const l = document.createElement('span'); l.className = 'lg-pc-line'; document.body.appendChild(l);
      const c = getComputedStyle(l).borderTopColor; l.remove(); return c; })() };
})()`;
// The live map's attribution control text.
const ATTRIB = handle => `(${handle}.map.getContainer().querySelector('.maplibregl-ctrl-attrib-inner') || {}).textContent || ''`;
// A pointer move at a point of the map (page pixels), through the browser's input.
async function hoverAt(b, x, y) {
  await b.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }, b.sid);
  await sleep(250);
}
const download = b => new Promise(res => {
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

// ── Part: the CVI page ─────────────────────────────────────────────────────────────────────────────────────────
async function partCvi(b) {
  const p = b.page;
  const o = oracleOf('tier_full');
  const out = {};
  await openCvi(b, o);
  await p.viewport(1400, 1000);
  const H = 'CVIWA.state.mapHandle';
  const fileRequests = () => b.log.requests.filter(u => DATA_FILE.test(u));
  const legendText = id => p.eval(`document.getElementById('${id}').textContent`);

  // At the start: three boxes, off and available; no data file asked for; nothing on the map or in the legend.
  let bx = await boxes(p);
  check(Object.values(bx).every(x => !x.checked && !x.disabled), 'cvi: three switches off and available at the start', bx);
  check(!fileRequests().length, 'cvi: no data file requested before a switch is turned on', fileRequests());
  check(await p.eval(`!CVIWA.state.mapHandle.map.getLayer('pc-cities-line') && !/Population context/.test(
    document.getElementById('legend-panel').textContent)`), 'cvi: no layer and no legend block at the start');
  // Fit to Washington alone, below the group; the switch labels at the check-box size
  // (0.85rem, 13.6 px, a flex row with a 0.4rem gap); the legend's outline sample in the lighter gray (#737373).
  let side = await p.eval(SIDEBAR);
  check(JSON.stringify(side.fits) === '["fit-wa"]' && side.below, 'cvi: WA State: Fit to Washington alone, below ' +
    'the population group', side);
  check(side.rowsShown === 4 && side.label === '13.6px flex 6.4px', 'cvi: WA State: the switch rows shown, labels at ' +
    'the check-box size', side);
  check(side.sample === 'rgb(115, 115, 115)', 'cvi: the live legend\'s outline sample in #737373', side.sample);

  // City limits: its file once, the layer, the legend, the credits, the names of 10,000 or more.
  await clickBox(p, 'cities');
  await waitLayer(p, H, 'cities', true);
  check(fileRequests().length === 1 && /citylimits-wa\.js/.test(fileRequests()[0]), 'cvi: city limits loads its file',
    fileRequests());
  let lg = await legendText('legend-panel');
  check(/Population context/.test(lg) && /City limits \(current\)/.test(lg) && !/Census-designated place/.test(lg),
    'cvi: live legend, city limits', lg.slice(-200));
  await p.eval(`new Promise(res => { const m = ${H}.map; m.once('idle', () => res(true)); m.triggerRepaint(); setTimeout(() => res(true), 4000); })`);
  let at = await p.eval(ATTRIB(H));
  check(at.includes(CITY_CREDIT) && at.includes(CENSUS_CREDIT), 'cvi: the map\'s credits with city limits on', at);
  let nm = await p.eval(NAMES(H));
  let want = await p.eval(WANT_NAMES({ cities: true }, 10000));
  check(JSON.stringify(nm.all.slice().sort()) === JSON.stringify(want), 'cvi: WA State asks for the cities of 10,000 ' +
    'or more', [nm.all.length, want.length]);
  check(nm.shown.length > 0 && nm.apart && nm.clearOfCounties && nm.inside, 'cvi: names shown apart, clear of the ' +
    'county names, inside the map', nm);
  check(nm.all.includes('Sedro-Woolley') && !nm.all.includes('Sedro Woolley'), 'cvi: the 2020 Census name printed');

  // Both outline layers: the census-designated places only (trimmed); the legend's entries change.
  await clickBox(p, 'places');
  await waitLayer(p, H, 'places', true);
  check(await p.eval(`${H}.pcPlaces === 'cdp' && ${H}.map.getLayoutProperty('pc-places-cdp', 'visibility') === 'visible'`),
    'cvi: both outline layers: the places source holds the census-designated places only');
  lg = await legendText('legend-panel');
  check(/City limits \(current\)/.test(lg) && /Census-designated place/.test(lg) && !/City or town, 2020/.test(lg),
    'cvi: live legend, both outline layers', lg.slice(-200));
  const lineColors = await p.eval(`['pc-cities-line', 'pc-places-line', 'pc-places-cdp'].map(id =>
    ${H}.map.getPaintProperty(id, 'line-color'))`);
  check(lineColors.every(c => c === '#737373'), 'cvi: the live outlines in #737373', lineColors);
  nm = await p.eval(NAMES(H));
  want = await p.eval(WANT_NAMES({ cities: true, places: true }, 10000));
  check(JSON.stringify(nm.all.slice().sort()) === JSON.stringify(want) && nm.italic.every(x => x === 'italic'),
    'cvi: names of both layers, census-designated places in italics', [nm.all.length, want.length]);

  // Density: under the outlines, the county lines and the circles; six classes in the legend.
  await clickBox(p, 'density');
  await waitLayer(p, H, 'density', true);
  const order = await p.eval(`${H}.map.getStyle().layers.map(l => l.id).filter(id => /^pc-|^wa-land$|^county-lines$|^circles$/.test(id))`);
  const ix = id => order.indexOf(id);
  check(ix('wa-land') < ix('pc-density') && ix('pc-density') < ix('pc-places-fill') && ix('pc-places-fill') <
    ix('pc-cities-fill') && ix('pc-cities-line') < ix('county-lines') && ix('county-lines') < ix('circles'),
  'cvi: drawing order land, density, places, cities, county lines, circles', order);
  lg = await legendText('legend-panel');
  check(['People per sq mi of land (2020)', 'Under 10', '10 – 50', '50 – 250', '250 – 1,000', '1,000 – 5,000',
    '5,000 and over'].every(t => lg.includes(t)), 'cvi: live legend, the density classes', lg.slice(-300));
  check(fileRequests().length === 3, 'cvi: each data file requested once', fileRequests());

  // Off and on again: the loaded copy, no new request; the layer hidden while off.
  await clickBox(p, 'cities');
  await waitLayer(p, H, 'cities', false);
  check(await p.eval(`${H}.pcPlaces === 'all'`), 'cvi: city limits off: every place again (cities and towns solid)');
  await clickBox(p, 'cities');
  await waitLayer(p, H, 'cities', true);
  check(fileRequests().length === 3, 'cvi: a later turn uses the loaded copy', fileRequests().length);

  // Hover over Sedro-Woolley, close up: the city and the tract.
  const sw = await p.eval(`(() => { const c = WSDA_CITYLIMITS.cities.find(x => x.geoid === '5363210'); return c.label; })()`);
  await p.eval(`new Promise(res => { const m = ${H}.map; m.jumpTo({ center: ${JSON.stringify(sw)}, zoom: 12 });
    m.once('idle', () => res(true)); setTimeout(() => res(true), 6000); })`);
  const mid = await p.eval(`(() => { const r = ${H}.map.getCanvas().getBoundingClientRect(); const q = ${H}.map.project(${JSON.stringify(sw)});
    return [r.left + q.x, r.top + q.y]; })()`);
  await hoverAt(b, mid[0], mid[1]);
  const tip = await p.eval(`({ text: ${H}.pcHoverText || [], open: !!document.querySelector('.pc-tip') })`);
  check(tip.open && tip.text[0] === 'Sedro-Woolley' && /^City limits, current \(WA Department of Revenue, \d{4} Q\d\)$/
    .test(tip.text[1]) && tip.text[2] === '2020 population 12,421 (U.S. Census Bureau)' &&
    tip.text[3] === 'Census tract, 2020' && / people per sq mi of land$/.test(tip.text[4]), 'cvi: hover over a city ' +
    'with density on: the city and its tract', tip);
  // The screenshot draws the names shown and the credits.
  await p.eval(`CVIWA.map.screenshot(${H}).then(() => true)`);
  const cap = await p.eval(`({ names: ${H}.lastPcNames || [], credit: ${H}.lastAttribution || '' })`);
  check(cap.names.includes('Sedro-Woolley') && cap.credit.includes(CITY_CREDIT) && cap.credit.includes(CENSUS_CREDIT),
    'cvi: the map screenshot carries the names and the credits', cap);
  await hoverAt(b, 5, 5);
  await p.eval(`new Promise(res => { CVIWA.map.fitView(${H}); ${H}.map.once('idle', () => res(true)); setTimeout(() => res(true), 5000); })`);

  // The branded PNG (Preview Map) and the export with all three on.
  fs.mkdirSync(DL, { recursive: true });
  await b.send('Browser.setDownloadBehavior', { behavior: 'allowAndName', downloadPath: DL, eventsEnabled: true });
  await p.eval(`(() => { document.getElementById('export-section').open = true; return true; })()`);
  const preview = async () => {
    const t0 = Date.now();
    await p.eval(`document.getElementById('preview-map').click(); true`);
    await p.waitFor('!CVIWA.state.exporting && (CVIWA.previews.isOpen() || !document.getElementById("preview-message").hidden)',
      30000, 'preview drawn');
    const ms = Date.now() - t0;
    return Object.assign(await p.eval(`(() => {
      const open = CVIWA.previews.isOpen();
      if (open) CVIWA.previews.close();
      const m = CVIWA.state.lastBranded;
      return { open, models: m ? JSON.parse(JSON.stringify(m.models.map(x => ({ view: x.view, movement: !!x.movement,
        source: x.source, population: x.population ? { on: x.population.on, names: x.population.names.length } : null,
        fileName: x.fileName })))) : [] }; })()`), { ms });
  };
  let pv = await preview();
  const m0 = pv.models[0] || {};
  check(pv.open && m0.population && m0.population.on.cities && m0.population.on.places && m0.population.on.density &&
    m0.population.names > 0, 'cvi: Preview Map draws the layers and their names (WA State)', m0.population);
  check(m0.source && m0.source.endsWith(' · ' + CITY_CREDIT + ' · ' + CENSUS_CREDIT), 'cvi: the PNG\'s source line ' +
    'carries the credits', m0.source);
  out.previewMs = pv.ms;
  // export_params.json names the layers and their sources.
  await p.eval(`(() => { document.querySelectorAll('input[name=export-format]').forEach(i => {
    i.checked = i.value === 'branded_png'; }); return true; })()`);
  const dl = download(b);
  await p.eval(`document.getElementById('run-export').click(); true`);
  const got = await dl;
  await p.waitFor('!CVIWA.state.exporting', 30000, 'export finished');
  const entries = got.state === 'completed' ? readZip(fs.readFileSync(path.join(DL, got.guid))) : [];
  const params = (entries.find(e => e.name.endsWith('/export_params.json')) || { data: Buffer.from('') }).data.toString('utf8');
  check(/"population_layers": \["city_limits", "population_centers", "population_density"\]/.test(params) &&
    /"population_sources": \["City limits: WA Department of Revenue, downloaded \d{4}-\d\d-\d\d \(\d{4} Q\d\); 2020 population: U\.S\. Census Bureau", "Population: U\.S\. Census Bureau, 2020 Census \(2020\)"\]/
      .test(params) && params.indexOf('"population_sources"') < params.indexOf('"exported_at"'),
  'cvi: export_params.json records the layers and their sources', params);

  // The movement view's PNG carries them too.
  await p.eval(`(() => { const t = document.getElementById('mv-on'); if (t && !t.checked) t.click(); return !!t; })()`);
  await sleep(600);
  // Its live legend stays the movement legend, with the population block, also after a switch changes.
  const mvLegend = () => legendText('legend-panel');
  let ml = await mvLegend();
  const mvOk = t => /Movement between WA counties/.test(t) && /Population context/.test(t) && !/Circle size/.test(t);
  check(mvOk(ml), 'cvi: movement view: the live legend is the movement legend with the population block', ml.slice(0, 300));
  await clickBox(p, 'places');
  await waitLayer(p, H, 'places', false);
  ml = await mvLegend();
  check(mvOk(ml), 'cvi: movement view: a population switch keeps the movement legend', ml.slice(0, 300));
  await clickBox(p, 'places');
  await waitLayer(p, H, 'places', true);
  pv = await preview();
  const mv = pv.models[0] || {};
  check(mv.movement && mv.population && mv.population.on.density && mv.source && mv.source.includes(CITY_CREDIT),
    'cvi: the movement view\'s PNG draws the layers, with the credits', mv);
  await p.eval(`(() => { const t = document.getElementById('mv-on'); if (t && t.checked) t.click(); return true; })()`);

  // Compare: the right map draws them as the left.
  await p.eval(`(() => { const r = document.querySelector('input[name=period-mode][value=compare]'); r.checked = true;
    r.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  await p.waitFor('CVIWA.state.mapHandleB && CVIWA.state.mapHandleB.ready', 20000, 'right map ready');
  await waitLayer(p, 'CVIWA.state.mapHandleB', 'density', true);
  check(await p.eval(`['pc-cities-line', 'pc-places-cdp', 'pc-density'].every(id => CVIWA.state.mapHandleB.map.getLayoutProperty(id, 'visibility') === 'visible')`),
    'cvi: Compare: the right map draws the three layers');
  lg = await legendText('legend-panel-b');
  check(/Population context/.test(lg), 'cvi: Compare: the right map\'s legend has the block');
  pv = await preview();
  check(pv.models.length === 2 && pv.models.every(x => x.population && x.population.on.cities),
    'cvi: Compare: both PNGs carry the layers', pv.models.map(x => x.fileName));
  await p.eval(`(() => { const r = document.querySelector('input[name=period-mode][value=single]'); r.checked = true;
    r.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);

  // National Flow: grayed with the reason; back on WA State, available again.
  await p.eval(`document.getElementById('show-flow').click(); true`);
  await sleep(500);
  bx = await boxes(p);
  const reason = await p.eval(`(() => { const r = document.getElementById('pc-reason'); return r.hidden ? null : r.textContent; })()`);
  check(Object.values(bx).every(x => x.disabled && x.checked) && reason === 'Washington-only layers; not shown on the national map.',
    'cvi: National Flow: the switches grayed with the reason (kept on for the other maps)', [bx, reason]);
  check(await p.eval(`!/Population context/.test(document.getElementById('legend-panel-flow').textContent)`),
    'cvi: National Flow: no legend block');
  // Fit to Lower 48 alone, below the group, which shows only its heading and the reason.
  side = await p.eval(SIDEBAR);
  check(JSON.stringify(side.fits) === '["fit-conus"]' && side.below, 'cvi: National Flow: Fit to Lower 48 alone, ' +
    'below the population group', side);
  check(side.rowsShown === 0 && side.rows === 4, 'cvi: National Flow: the grayed group collapsed to its heading and ' +
    'the reason', side);

  // County Focus with Yakima: the layers, and every city and place in Yakima named.
  await p.eval(`document.getElementById('show-focus').click(); true`);
  await p.waitFor('CVIWA.state.focusHandle && CVIWA.state.focusHandle.ready', 20000, 'focus map ready');
  bx = await boxes(p);
  check(Object.values(bx).every(x => !x.disabled && x.checked), 'cvi: County Focus: the switches available and on', bx);
  side = await p.eval(SIDEBAR);
  check(JSON.stringify(side.fits) === '["fit-focus"]' && side.below && side.rowsShown === 4, 'cvi: County Focus: Fit ' +
    'to selected counties alone, below the group, the switch rows shown again', side);
  await p.eval(`(() => { const boxes = [...document.querySelectorAll('#fo-counties input')];
    boxes.forEach(b => { const on = b.value === 'Yakima'; if (b.checked !== on) { b.checked = on; b.dispatchEvent(new Event('change')); } });
    return true; })()`);
  await sleep(900);
  await waitLayer(p, 'CVIWA.state.focusHandle', 'density', true);
  nm = await p.eval(NAMES('CVIWA.state.focusHandle'));
  want = await p.eval(WANT_NAMES({ cities: true, places: true }, 0, ['Yakima']));
  check(JSON.stringify(nm.all.slice().sort()) === JSON.stringify(want) && want.includes('Sunnyside') &&
    !want.includes('Seattle'), 'cvi: County Focus asks for every city and place in the picked county',
  [nm.all.length, want.length]);
  check(nm.apart && nm.clearOfCounties && nm.inside, 'cvi: County Focus names apart and clear', nm);
  lg = await legendText('legend-panel-focus');
  check(/Population context/.test(lg) && /Census-designated place/.test(lg), 'cvi: County Focus legend block');
  pv = await preview();
  const fm = pv.models[0] || {};
  check(fm.view === 'focus' && fm.population && fm.population.on.cities && fm.source.includes(CENSUS_CREDIT),
    'cvi: County Focus PNG draws the layers with the credits', fm);

  // Reset All: the three off, nothing drawn, no legend block, no names.
  await p.eval(`document.getElementById('reset-all').click(); true`);
  await sleep(500);
  await p.eval(`document.getElementById('show-wa').click(); true`);
  await sleep(500);
  bx = await boxes(p);
  check(Object.values(bx).every(x => !x.checked && !x.disabled), 'cvi: Reset All turns the three off', bx);
  check(await p.eval(`['pc-cities-line', 'pc-places-fill', 'pc-density'].every(id => ${H}.map.getLayoutProperty(id, 'visibility') === 'none')
    && !${H}.pcLabels.length && !/Population context/.test(document.getElementById('legend-panel').textContent)`),
  'cvi: after Reset All nothing drawn, no names, no legend block');
  pv = await preview();
  check(pv.models[0] && !pv.models[0].population && !/Census Bureau, 2020/.test(pv.models[0].source || ''),
    'cvi: after Reset All the PNG has no layers and no credits', pv.models[0]);
  await b.send('Browser.setDownloadBehavior', { behavior: 'default' });

  // A copy of the site without a data file: the switch turns back off, grayed, with the message; the rest works.
  await openCvi(b, o);
  await p.eval(`(() => { WSDA.population.FILES.density = 'geo/not-in-this-copy.js'; return true; })()`);
  await clickBox(p, 'density');
  await p.waitFor(`!document.getElementById('pc-msg').hidden`, 15000, 'missing-file message');
  bx = await boxes(p);
  const msg = await p.eval(`document.getElementById('pc-msg').textContent`);
  check(!bx.density.checked && bx.density.disabled && !bx.cities.disabled && !bx.places.disabled &&
    msg.startsWith('This layer\'s file is not in this copy of the site (geo/not-in-this-copy.js).') &&
    /The rest of the map is unaffected\.$/.test(msg), 'cvi: a missing data file grays its switch with the message',
  [bx, msg]);
  await clickBox(p, 'cities');
  await waitLayer(p, H, 'cities', true);
  check(await p.eval(`!${H}.map.getLayer('pc-density')`), 'cvi: the other layers still work without the missing file');
  // That request failing is expected; it is not an error of the page.
  b.log.exceptions = b.log.exceptions.filter(x => !/not-in-this-copy/.test(x));
  return out;
}

// ── Part: the Infrastructure dashboard ─────────────────────────────────────────────────────────────────────────
async function openInfra(b) {
  const p = b.page;
  await p.goto(INFRA);
  await p.waitFor('window.WSDA && WSDA.infrastructure && WSDA.infrastructureBranded && WSDA.infrastructure.state.map && ' +
    'WSDA.infrastructure.state.map.ready', 20000, 'dashboard ready');
  const facDir = path.join(S9, 'facilities-wa');
  const files = fs.readdirSync(facDir).filter(f => f.endsWith('.csv')).map(f => path.join(facDir, f));
  await p.setFiles('#files-input', files);
  await p.waitFor('WSDA.infrastructure.state.facilityFiles === 5 && !WSDA.infrastructure.state.loading', 30000,
    'facility files loaded');
  await sleep(400);
}
async function partInfra(b) {
  const p = b.page;
  const out = {};
  await openInfra(b);
  await p.viewport(1400, 1000);
  const S = 'WSDA.infrastructure.state';
  const H = S + '.map';
  const fileRequests = () => b.log.requests.filter(u => DATA_FILE.test(u));
  const before = fileRequests().length;
  // The switch labels at the CVI page's check-box size (13.6 px, a flex row with a 6.4 px gap;
  // 16 px block before), Fit to Washington below the group, the legend's outline sample in #737373.
  const side = await p.eval(SIDEBAR);
  check(side.label === '13.6px flex 6.4px' && side.rowsShown === 4, 'infra: the switch labels at the CVI page\'s size',
    side);
  check(JSON.stringify(side.fits) === '["fit-wa"]' && side.below, 'infra: Fit to Washington below the population group',
    side);
  check(side.sample === 'rgb(115, 115, 115)', 'infra: the live legend\'s outline sample in #737373', side.sample);
  // The CVI page's order: County lines and labels above Population context.
  check(side.countyAbove === true, 'infra: County lines and labels above the population group, as on the CVI page', side);
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
    const r = await p.eval(`(() => {
      const open = CVIWA.previews.isOpen();
      const made = open ? ${S}.lastPreview : null;
      if (open) CVIWA.previews.close();
      const m = made ? made.model : null;
      return { open, coverage: m && m.coverage, source: m && m.source, dpi: made && made.dpi, caption: m && m.caption,
        squeezed: !!(m && m.legend && m.legend.squeezed), overlap: !!(m && m.legend && m.legend.overlap),
        drawn: m && m.populationDrawn ? m.populationDrawn.on : null,
        names: m && m.population ? m.population.names.length : null,
        overFill: !!(m && m.population && m.population.densityOverFill) };
    })()`);
    r.ms = ms;
    return r;
  };
  const keys = await setLayers(['slaughterhouses', 'fairgrounds', 'markets', 'feedlots', 'restricted']);
  check(keys.length === 5, 'infra: five facility layers shown', keys);

  // At the start: off and available, no data file asked for (by this page), no legend block.
  let bx = await boxes(p);
  check(Object.values(bx).every(x => !x.checked && !x.disabled), 'infra: three switches off and available', bx);
  check(fileRequests().length === before, 'infra: no data file requested before a switch is turned on');
  check(await p.eval(`!/Population context/.test(document.getElementById('facility-legend-content').textContent)`),
    'infra: no legend block at the start');

  // A first preview at High with the layers off (S9's case, for comparison), then all three on.
  await pick('export-resolution', 'high');
  const offHigh = await preview();
  out.highOffMs = offHigh.ms;
  for (const l of ['cities', 'places', 'density']) await clickBox(p, l);
  for (const l of ['cities', 'places', 'density']) await waitLayer(p, H, l, true);
  check(fileRequests().length === before + 3, 'infra: each data file requested once', fileRequests().length - before);
  const lg = await p.eval(`document.getElementById('facility-legend-content').textContent`);
  check(/Population context/.test(lg) && /City limits \(current\)/.test(lg) && /Census-designated place/.test(lg) &&
    /5,000 and over/.test(lg), 'infra: live legend block', lg.slice(-250));
  let nm = await p.eval(NAMES(H));
  let want = await p.eval(WANT_NAMES({ cities: true, places: true }, 10000));
  check(JSON.stringify(nm.all.slice().sort()) === JSON.stringify(want) && nm.apart && nm.clearOfCounties && nm.inside,
    'infra: statewide names of 10,000 or more, apart and clear', [nm.all.length, want.length, nm.apart, nm.clearOfCounties]);
  await p.eval(`new Promise(res => { const m = ${H}.map; m.once('idle', () => res(true)); m.triggerRepaint(); setTimeout(() => res(true), 4000); })`);
  const at = await p.eval(ATTRIB(H));
  check(at.includes(CITY_CREDIT) && at.includes(CENSUS_CREDIT), 'infra: the map\'s credits', at);

  // Hover over Sedro-Woolley, close up, where no facility is: the city and its tract (the Infrastructure map kind).
  const sw = await p.eval(`WSDA_CITYLIMITS.cities.find(x => x.geoid === '5363210').label`);
  await p.eval(`new Promise(res => { const m = ${H}.map; m.jumpTo({ center: ${JSON.stringify(sw)}, zoom: 12 });
    m.once('idle', () => res(true)); setTimeout(() => res(true), 6000); })`);
  const mid = await p.eval(`(() => { const r = ${H}.map.getCanvas().getBoundingClientRect(); const q = ${H}.map.project(${JSON.stringify(sw)});
    return [r.left + q.x, r.top + q.y]; })()`);
  await hoverAt(b, mid[0], mid[1]);
  const tip = await p.eval(`({ text: ${H}.pcHoverText || [], open: !!document.querySelector('.pc-tip') })`);
  check(tip.open && tip.text[0] === 'Sedro-Woolley' && tip.text[3] === 'Census tract, 2020', 'infra: hover over a city ' +
    'with density on: the city and its tract', tip);
  await hoverAt(b, 5, 5);
  await p.eval(`new Promise(res => { CVIWA.map.fitView(${H}); ${H}.map.once('idle', () => res(true)); setTimeout(() => res(true), 5000); })`);

  // The High-quality Branded preview with all three layers on, Locations view, five layers statewide (budget 6 s),
  // three times; and at Standard (budget 3 s).
  const highs = [];
  for (let i = 0; i < 3; i++) {
    const r = await preview();
    check(r.open && r.coverage === 'locations' && r.dpi === 300 && r.drawn && r.drawn.cities && r.drawn.places &&
      r.drawn.density && r.names > 0, 'infra: High preview draws the three layers (run ' + (i + 1) + ')', r);
    highs.push(r.ms);
  }
  out.highOnMs = highs;
  check(Math.max(...highs) < 6000, 'infra: Branded preview within 6 seconds (High) with all three layers on', highs);
  await pick('export-resolution', 'standard');
  const std = await preview();
  out.standardOnMs = std.ms;
  check(std.ms < 3000, 'infra: Branded preview within 3 seconds (Standard) with all three layers on', std.ms);
  check(std.source && std.source.endsWith(' · ' + CITY_CREDIT + ' · ' + CENSUS_CREDIT), 'infra: the PNG\'s source ' +
    'line carries the credits', std.source);
  check(!std.squeezed && !std.overlap, 'infra: Branded legend holds the population rows without drawing rows closer',
    std);
  await choose('output-style', 'report');
  const rep = await preview();
  check(rep.caption && rep.caption.includes(CITY_CREDIT) && rep.caption.includes(CENSUS_CREDIT) && !rep.overlap,
    'infra: Report caption carries the credits; legend samples apart', [rep.caption, rep.squeezed, rep.overlap]);
  out.reportSqueezed = rep.squeezed;
  await choose('output-style', 'branded');

  // One layer: the Density (choropleth) view applies, so the density switch is grayed with the reason (kept on);
  // the live map hides density; the PNG draws the outlines only.
  await setLayers(['feedlots']);
  await sleep(300);
  bx = await boxes(p);
  const reason = await p.eval(`(() => { const r = document.getElementById('pc-reason'); return r.hidden ? null : r.textContent; })()`);
  check(bx.density.disabled && bx.density.checked && !bx.cities.disabled && reason ===
    'Population density cannot be shown over a county fill; switch to Locations.', 'infra: density grayed with the ' +
    'reason over the Density view', [bx, reason]);
  // A check, not a stop: a layer still drawn must fail here and let the PNG checks below run.
  const densityHidden = await waitLayer(p, H, 'density', false).then(() => true, () => false);
  check(densityHidden, 'infra: the live map hides density over the Density view');
  let r = await preview();
  check(r.coverage === 'density' && r.drawn && !r.drawn.density && r.drawn.cities && r.drawn.places && r.names === 0,
    'infra: Density view PNG: the outlines only, no names', r);
  check(r.source && r.source.endsWith(' · ' + CITY_CREDIT + ' · ' + CENSUS_CREDIT), 'infra: Density view PNG: the ' +
    'credits of the outlines drawn', r.source);
  // S9's High case (Density view, one layer, 300 dpi), with all three switched on (the outlines drawn), three times.
  await pick('export-resolution', 'high');
  const densityHigh = [];
  for (let i = 0; i < 3; i++) {
    const h = await preview();
    check(h.open && h.coverage === 'density' && h.dpi === 300, 'infra: High Density preview drawn (run ' + (i + 1) + ')', h);
    densityHigh.push(h.ms);
  }
  out.highDensityOnMs = densityHigh;
  check(Math.max(...densityHigh) < 6000, 'infra: Density view preview within 6 seconds (High), switches on', densityHigh);
  await pick('export-resolution', 'standard');
  // Locations: density available again, the pick back.
  await choose('coverage', 'locations');
  await sleep(300);
  bx = await boxes(p);
  check(!bx.density.disabled && bx.density.checked, 'infra: Locations: density available and on again', bx);
  await waitLayer(p, H, 'density', true);
  await choose('coverage', 'density');

  // Picked counties: every city and place in them named.
  await setLayers(['slaughterhouses', 'fairgrounds', 'markets', 'feedlots', 'restricted']);
  await p.eval(`(() => { for (const box of document.querySelectorAll('#facility-counties input')) {
    if (box.value === 'King' && !box.checked) box.click(); } return true; })()`);
  await sleep(600);
  nm = await p.eval(NAMES(H));
  want = await p.eval(WANT_NAMES({ cities: true, places: true }, 0, ['King']));
  check(JSON.stringify(nm.all.slice().sort()) === JSON.stringify(want) && want.includes('Seattle'),
    'infra: King picked: every city and place in King asked for', [nm.all.length, want.length]);

  // export_params.json: the layers and their sources (Locations, so density is drawn).
  await choose('coverage', 'locations');
  await sleep(300);
  fs.mkdirSync(DL, { recursive: true });
  await b.send('Browser.setDownloadBehavior', { behavior: 'allowAndName', downloadPath: DL, eventsEnabled: true });
  const dl = download(b);
  await p.eval(`document.getElementById('run-export').click(); true`);
  const got = await dl;
  await p.waitFor(`!document.getElementById('run-export').disabled`, 30000, 'export finished');
  const entries = got.state === 'completed' ? readZip(fs.readFileSync(path.join(DL, got.guid))) : [];
  const params = JSON.parse((entries.find(e => e.name.endsWith('/export_params.json')) || { data: Buffer.from('{}') }).data.toString('utf8'));
  const pcx = params.population_context || {};
  check(pcx.city_limits === true && pcx.population_centers === true && pcx.population_density === true &&
    pcx.sources && pcx.sources.city_limits && pcx.sources.city_limits.source === CITY_CREDIT &&
    /^\d{4} Q\d$/.test(pcx.sources.city_limits.quarter) && pcx.sources.population_density.year === 2020,
  'infra: export_params.json records the layers and their sources', pcx);
  await b.send('Browser.setDownloadBehavior', { behavior: 'default' });

  // Reset All: the three off, nothing drawn, no legend block, no names.
  await p.eval(`document.getElementById('reset-all').click(); true`);
  await sleep(500);
  bx = await boxes(p);
  check(Object.values(bx).every(x => !x.checked && !x.disabled), 'infra: Reset All turns the three off', bx);
  check(await p.eval(`['pc-cities-line', 'pc-places-fill', 'pc-density'].every(id => ${H}.map.getLayoutProperty(id, 'visibility') === 'none')
    && !${H}.pcLabels.length && !/Population context/.test(document.getElementById('facility-legend-content').textContent)`),
  'infra: after Reset All nothing drawn, no names, no legend block');
  return out;
}

// ── Run ────────────────────────────────────────────────────────────────────────────────────────────────────────
(async () => {
  const b = await launch();
  const run = { chrome: b.version, page: PAGE, parts: PARTS, started: new Date().toISOString(), results: {} };
  try {
    for (const part of PARTS) {
      if (part === 'cvi') run.results.cvi = await partCvi(b);
      else if (part === 'infra') run.results.infra = await partInfra(b);
      else throw new Error('Unknown part ' + part);
    }
  } catch (e) {
    failed++;
    failures.push('run stopped: ' + (e && e.stack ? e.stack : e));
  } finally {
    check(!b.log.exceptions.length, 'page: no exceptions', b.log.exceptions);
    check(!b.log.csp.length, 'page: no Content Security Policy reports', b.log.csp);
    // Only the site's own files (file://, the local server or a hosted copy of site/) and in-page addresses.
    const siteBase = new URL('../', PAGE).href;
    const outside = b.log.requests.filter(u => !/^(data:|blob:|about:)/.test(u) && !u.startsWith(siteBase));
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
  console.log('PC browser (' + PARTS.join(', ') + '): ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch(e => {
  console.error(e);
  process.exit(1);
});
