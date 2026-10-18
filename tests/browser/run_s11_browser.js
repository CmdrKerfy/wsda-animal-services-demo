#!/usr/bin/env node
'use strict';
// S11 browser suite: the Premise Lookup side of the CVI page in installed Chrome, through the DevTools protocol,
// offline, foreground only (Chrome does not start from a background job). No packages.
//
// Parts (name some to run only those, for example: node tests/browser/run_s11_browser.js page):
//   page    the Maps / Premise Lookup switch (the Maps side hidden and back as it was); Run query grayed with its
//           reason without a master and without premises coordinates (the Partner tier); the filters filled from the
//           master; "Add a site" with CVI's messages; editing a cell (double-click, Enter, Escape, the keyboard);
//           selecting and removing rows, Clear all; the pages of the sites table; "Paste rows" and "Upload CSV" with
//           CVI's messages; the downloaded template; then CVI's own Run query cases (the R reference ran CVI's
//           module on them, tests/oracle/s11_proximity_oracle.R), each set up through the sidebar's controls: the
//           messages under the button in CVI's order, the five tiles, the table's rows, a result shown exactly when
//           CVI stores one; the match map (loaded at the first result; the rings, points and sites drawn; the view
//           holding every site; a site's hover text and its click pop-up); the matched-CVI table (sorted by CVI,
//           ten to a page, the search); a new master clears the result.
//   day3    zones through the file picker (KML checked here against sf and GEOS, as only the browser reads KML;
//           files refused with their messages; a run with zones); the Place column; facilities inside from the Full
//           tier's facility files (counts worked out here), their dots, hover and the legend (also in the screenshot);
//           the export ZIP (the matched rows as CVI's own Export CSV, the facilities, export_params.json, the file the
//           browser saved); Pick on map with real mouse clicks; a facilities-only run with the Partner tier.
//   day4    Premise Lookup's population switches (on at first, the Maps side's off; the match map, its legend and
//           screenshot, the PNG); the Export card's PNG controls; Preview branded map (Streets, Default, High, timed
//           against 3 s and 6 s), facility labels, the PNG's layers following the "Facilities inside" ticks, tile
//           backgrounds answered by this suite (drawn, then refused: the Default background and the notice); Export
//           ZIP with the PNG and export_params.json; a facilities-only PNG.
//   day5    "Find coordinates" offline: the address box and the geocode cache file picker, both offline messages,
//           refused files, every lookup in the main cache file against CVI's module (its coordinates and text), a
//           failed second file leaving the first in use, and Add site after a hit; then spell check and autocomplete
//           off on the typed boxes, a large cache file, and export_params.json after a band edit.
//
// Usage (repository root, after node tests/node/run_f1_unit_tests.js, node tests/synthetic/make_s11_fixtures.js and
// Rscript tests/oracle/s11_proximity_oracle.R):
//   node tests/browser/run_s11_browser.js [page] [day3] [day4] [day5]
// Writes local-test-artifacts/s11/browser/run.json (results).
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join(ROOT, 'local-test-artifacts', 's11', 'browser');
const PAGE = process.env.S11_PAGE_URL || pathToFileURL(path.join(ROOT, 'site', 'cvi', 'index.html')).href;
const CHROME = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ALL_PARTS = ['page', 'day3', 'day4', 'day5'];
const asked = process.argv.slice(2).filter(a => !a.startsWith('--'));
const PARTS = asked.length ? asked : ALL_PARTS;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const REF = JSON.parse(fs.readFileSync(path.join(ROOT, 'local-test-artifacts', 's11', 'oracle_s11.json'), 'utf8'));
const FX = JSON.parse(fs.readFileSync(path.join(ROOT, 'local-test-artifacts', 's11', 'fixtures', 'scenarios.json'),
  'utf8'));

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


// ── The page ───────────────────────────────────────────────────────────────────────────────────────────────────
const FULL = FX.full;
const js = v => JSON.stringify(v);
async function openPage(b) {
  await b.page.goto(PAGE);
  await b.page.waitFor('window.CVIWA && CVIWA.lookupState && CVIWA.state && CVIWA.state.mapHandle', 15000, 'page ready');
}
async function loadMaster(b, rel) {
  const v = await b.page.eval('CVIWA.state.version');
  await b.page.setFiles('#file-input', [path.join(ROOT, rel)]);
  await b.page.waitFor('CVIWA.state.master && !CVIWA.state.loading && CVIWA.state.version > ' + v, 20000,
    'master loaded: ' + rel);
  await sleep(200);
}
const click = (b, id) => b.page.eval(`document.getElementById(${js(id)}).click(); true`);
const setValue = (b, id, v) => b.page.eval(`(() => { const e = document.getElementById(${js(id)});
  e.value = ${js(v === null || v === undefined ? '' : String(v))};
  e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true }));
  return true; })()`);
const lines = (b, id) => b.page.eval(`[...document.getElementById(${js(id)}).querySelectorAll('.status')]
  .map(e => ({ level: e.className.replace('status ', ''), text: e.textContent }))`);
const shown = (b, id) => b.page.eval(`(() => { const e = document.getElementById(${js(id)});
  return !!e && !e.closest('[hidden]') && e.getClientRects().length > 0; })()`);
// The sites table as shown: its header cells and each row's cells (row number first).
const sitesShown = b => b.page.eval(`(() => { const t = document.querySelector('#lk-sites table');
  return { head: [...t.querySelectorAll('thead th')].map(th => th.textContent),
    rows: [...t.querySelectorAll('tbody tr')].map(tr => [...tr.children].map(td => td.textContent)),
    selected: [...t.querySelectorAll('tbody tr.selected')].length,
    info: document.querySelector('#lk-sites .lk-info').textContent }; })()`);
const sitesState = b => b.page.eval(`CVIWA.lookupState.sites.map(s => ({ name: s.name, lat: s.lat, long: s.long,
  buffer_km: s.buffer_km, bands_csv: s.bands_csv }))`);
// A cell edit through the page's own events: a double-click on the cell, the text typed, then a key.
const editCell = (b, row, field, text, key) => b.page.eval(`(() => {
  const td = document.querySelectorAll('#lk-sites tbody tr')[${row}].querySelector('td[data-field=${js(field)}]');
  td.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  const input = td.querySelector('input');
  if (!input) return false;
  input.value = ${js(text)};
  input.dispatchEvent(new KeyboardEvent('keydown', { key: ${js(key || 'Enter')}, bubbles: true }));
  return true; })()`);
// The sidebar's filters set as asked: the checklist cleared, then each value ticked by a click. A value the list does
// not offer (a year the master does not have) cannot be ticked; it is then set in the page's state directly, and the
// function says so.
async function setChecks(b, key, values) {
  await click(b, 'lk-' + key + '-clear');
  return b.page.eval(`(() => { const want = ${js(values.map(String))};
    const boxes = [...document.querySelectorAll('#lk-${key} input')];
    boxes.forEach(cb => { if (want.indexOf(cb.value) >= 0) cb.click(); });
    const offered = want.filter(v => boxes.some(cb => cb.value === v));
    if (offered.length === want.length) return 'clicked';
    CVIWA.lookupState.${key} = ${js(values)};
    return 'set directly'; })()`);
}
const radio = (b, name, value) => b.page.eval(`document.querySelector('input[name=${name}][value=${value}]').click(); true`);
const formatR = (b, x) => b.page.eval(`CVIWA.scaling.formatR([${js(x)}])[0].trim()`);
// The sites drawn under one of the map's buttons (zoom and fit at the top left, the screenshot at the top right):
// each site's circle (radius 8) against each button group's box, measured in the page.
const UNDER_BUTTONS = `(() => { const m = CVIWA.lookupState.map, map = m.map, r = map.getContainer().getBoundingClientRect();
  const boxes = [...map.getContainer().querySelectorAll('.maplibregl-ctrl-top-left .maplibregl-ctrl, .maplibregl-ctrl-top-right .maplibregl-ctrl')]
    .map(e => e.getBoundingClientRect());
  const sites = CVIWA.lookupState.result.sites.map(s => { const xy = map.project([s.lon, s.lat]); return { name: s.name,
    x: r.left + xy.x, y: r.top + xy.y }; });
  const inside = sites.filter(q => q.x > r.left && q.x < r.right && q.y > r.top && q.y < r.bottom);
  const under = sites.filter(q => boxes.some(b => q.x + 8 > b.left && q.x - 8 < b.right && q.y + 8 > b.top && q.y - 8 < b.bottom));
  return { sites: sites.length, inside: inside.length, under: under.map(q => q.name), boxes: boxes.length }; })()`;
const LEVEL = { warning: ['warn'], error: ['err'], message: ['ok', 'info'], default: ['ok', 'info'] };
const sameNotes = (page, cvi) => page.length === cvi.length &&
  page.every((m, i) => m.text === cvi[i].text && (LEVEL[cvi[i].type] || []).indexOf(m.level) >= 0);

// ── Part day3: zones, the Place column, facilities inside, Pick on map, the legend, the export ───────────────────
// Expected values come from outside the page: the zones from sf and GEOS (the R reference), the facility counts
// worked out here from the facility files with this file's own haversine, the CSV from CVI's own Export CSV.
const ZF = FX.zones, ZR = REF.zones;
const ZDIR = path.join(ROOT, ZF.dir);
const TIER = path.join(ROOT, 'local-test-artifacts', 'f1', 'tiers', 'full');
const R_KM = 6378.137;
const hav = (la1, lo1, la2, lo2) => {
  const r = d => d * Math.PI / 180, a = Math.sin(r(la2 - la1) / 2) ** 2 +
    Math.cos(r(la1)) * Math.cos(r(la2)) * Math.sin(r(lo2 - lo1) / 2) ** 2;
  return 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * R_KM;
};
// The facility files of the Full tier, as the hand-off gives them: key -> text (the manifest under "manifest").
function facilityTexts() {
  const files = { manifest: 'facility_overlays_manifest.csv', slaughterhouses: 'usda_wa_slaughter_facilities.csv',
    fairgrounds: 'wa_state_fairs.csv', markets: 'wa_state_public_livestock_markets.csv', feedlots: 'wa_state_feedlots.csv',
    restricted: 'wa_state_restricted_holding_facilities.csv', syn_custommeat: 'synthetic_custom_meat_geocoded.csv',
    syn_disposal: 'synthetic_animal_disposal.csv' };
  const out = {};
  Object.keys(files).forEach(k => { out[k] = fs.readFileSync(path.join(TIER, files[k]), 'utf8'); });
  return out;
}
// Each facility file's points, read here: the first lat and long columns, quotes and a byte order mark removed.
function facilityPoints(text) {
  const rows = text.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim() !== '')
    .map(l => l.split(',').map(c => c.replace(/^"|"$/g, '').trim()));
  const h = rows[0].map(c => c.toLowerCase());
  const iLat = h.findIndex(c => /^(lat|latitude|y)$/.test(c)), iLon = h.findIndex(c => /^(long|lon|lng|longitude|x)$/.test(c));
  return rows.slice(1).map(r => [Number(r[iLat]), Number(r[iLon])]).filter(p => Number.isFinite(p[0]) && Number.isFinite(p[1]));
}
const sendFacilities = (b, texts) => b.page.eval(`(t => { const d = {};
  Object.keys(t).forEach(k => { d[k] = { file: new Blob([t[k]], { type: 'text/csv' }) }; });
  return CVIWA.setFacilityFiles(d).then(() => true); })(${js(texts)})`);
const waitMap = b => b.page.waitFor(`CVIWA.lookupState.map && CVIWA.lookupState.map.ready && CVIWA.lookupState.map.drawn`,
  15000, 'match map');
const idle = b => b.page.eval(`new Promise(res => { const m = CVIWA.lookupState.map.map;
  if (m.loaded() && !m.isMoving()) { res(true); return; } m.once('idle', () => res(true)); setTimeout(() => res(true), 4000); })`);

async function partDay3(b) {
  const p = b.page;
  await openPage(b);
  await click(b, 'show-lookup');
  await p.waitFor(`CVIWA.lookupState.places === 'ready'`, 15000, 'places loaded');

  // ── The Place column ──
  const pl = await p.eval(`(() => { const c = WSDA_CITYLIMITS.cities.find(x => x.name === 'Ellensburg');
    const d = WSDA_PLACES.places.find(x => x.kind === 'cdp' && x.trim === 'none' && x.name === 'Spanaway');
    return { city: c.label, cdp: d.label }; })()`);
  const oos = FX.scenarios.find(s => s.sites.some(x => x.name === 'Oregon premises')).sites.find(x => x.name === 'Oregon premises');
  await p.eval(`CVIWA.lookupState.testSetSites(${js([
    { name: 'In a city', lat: pl.city[1], long: pl.city[0] }, { name: 'In a CDP', lat: pl.cdp[1], long: pl.cdp[0] },
    { name: 'Wheat field', lat: 47.3, long: -118.62 }, { name: oos.name, lat: oos.lat, long: oos.long },
    { name: 'Offshore', lat: 47.0, long: -126.0 }])})`);
  let t = await sitesShown(b);
  const places = t.rows.map(r => r[5]);
  const wheat = await p.eval(`WSDA.population.placeAt(-118.62, 47.3)`);
  check(t.head[5] === 'Place' && js(places) === js(['Ellensburg', 'Spanaway CDP', 'Outside city limits', 'Outside Washington',
    'Outside Washington']) && wheat === null, 'day3: the Place column: a city, a census-designated place ("CDP"), a field ' +
    'outside city limits, a premises in Oregon and a point at sea outside Washington', places);

  // ── Zones through the file picker ──
  await click(b, 'lk-clear');
  const pickZone = async f => {
    await p.eval(`(() => { const m = document.getElementById('lk-zone-msg'); m.replaceChildren(); m.hidden = true; return true; })()`);
    await p.setFiles('#lk-zone-file', [path.join(ZDIR, f)]);
    await p.waitFor(`[...document.querySelectorAll('#lk-zone-msg .status')].some(e => !/^Reading/.test(e.textContent))`,
      10000, 'zone message ' + f);
    return lines(b, 'lk-zone-msg');
  };
  let msg = await pickZone('zones.kml');
  t = await sitesShown(b);
  check(js(msg) === js([{ level: 'ok', text: 'Added 4 zone(s) from zones.kml. Left out 1 shape that is not a polygon.' }]) &&
    js(t.rows.map(r => r[1])) === js(['Control area A', 'Two pastures', 'Ring with a hole', 'Zone 4']) &&
    t.rows.every(r => r[4] === 'Zone (zones.kml)'), 'day3: a KML zone file adds its four zones as sites, the ' +
    'placemark that is not a polygon left out and counted', { msg, rows: t.rows });
  // KML is read by the browser's XML reader, so it is checked here against sf and GEOS: every test point.
  const kmlCheck = await p.eval(`(pts => { const S = CVIWA.lookupState.sites, PX = WSDA.proximity;
    return pts.map(q => (q[0] === null || q[1] === null || !PX.usable(q[1], q[0])) ? [] :
      S.map((s, k) => (PX.inZone(q[0], q[1], s.zone) ? k + 1 : 0)).filter(Boolean)); })(${js(zonePointsOf())})`);
  const kref = ZR.files['zones.kml'];
  const bad = kmlCheck.filter((h, i) => js(h) !== js(kref.holding[i] === undefined ? [] : [].concat(kref.holding[i]))).length;
  check(bad === 0 && kmlCheck.length === kref.holding.length, 'day3: the KML zones hold exactly the points sf and GEOS ' +
    'hold (' + kmlCheck.length + ' points)', { bad, n: kmlCheck.length });
  // A zone's point and buffer cells are fixed; its name can be edited.
  const fixed = await p.eval(`(() => { const tr = document.querySelector('#lk-sites tbody tr');
    const cells = [...tr.children]; cells[2].dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    const latOpen = !!cells[2].querySelector('input');
    const nameCell = tr.querySelector('td[data-field=name]');
    return { latOpen, nameEditable: !!nameCell, fixedCells: tr.querySelectorAll('td.lk-fixed').length }; })()`);
  check(!fixed.latOpen && fixed.nameEditable && fixed.fixedCells === 3, 'day3: a zone row\'s point and "Zone" cells are ' +
    'fixed, its name editable', fixed);
  const refused = {
    'broken.kml': '"broken.kml" could not be read as KML (the file is not well-formed XML with a <kml> root).',
    'zones_projected_shp.zip': 'The shapefile "zones.shp" in "zones_projected_shp.zip" is in a projected coordinate system ' +
      '(NAD_1983_HARN_StatePlane_Washington_South_FIPS_4602_Feet). Save it in longitude and latitude (WGS 84 or NAD 83) ' +
      'and load it again; the page cannot convert coordinate systems.',
    'zones.kmz': '"zones.kmz" is a KMZ (a zipped KML). Unzip it and load the .kml file inside.'
  };
  for (const f of Object.keys(refused)) {
    msg = await pickZone(f);
    check(js(msg) === js([{ level: 'err', text: refused[f] }]) && (await sitesState(b)).length === 4,
      'day3: ' + f + ' is refused with its message and adds nothing', msg);
  }
  msg = await pickZone('zones_shp.zip');
  check(msg[0].text === 'Added 4 zone(s) from zones_shp.zip. Left out 1 shape that is not a polygon.' &&
    (await sitesState(b)).length === 8, 'day3: a zipped shapefile adds its four zones', msg);

  // ── A run with zones (the Full tier): the rows matched are those sf and GEOS put in a zone ──
  await click(b, 'lk-clear');
  await loadMaster(b, FULL);
  await pickZone('zones.geojson');
  // Nothing ticked means every value (CVI's rule), as the reference ran: a row with a missing quarter, year or
  // species group then counts too.
  for (const k of ['years', 'quarters', 'species']) await click(b, 'lk-' + k + '-clear');
  await click(b, 'lk-run');
  await waitMap(b);
  const nG = ZF.points.length, nR = ZR.n_rows, ref = ZR.files['zones.geojson'];
  let want = 0;
  for (let i = 0; i < nR; i++) if ([].concat(ref.holding[nG + i] || [], ref.holding[nG + nR + i] || []).length) want++;
  const zr = await p.eval(`(() => { const r = CVIWA.lookupState.lastRun, m = CVIWA.lookupState.map;
    return { status: r.status, rows: new Set(r.membership.map(x => x.row)).size, zeros: r.matched.every(x => x.nearestSiteKm === 0),
      bands: m.drawn.bands, legend: m.legendRows.map(x => x.label) }; })()`);
  check(zr.status === 'ok' && zr.rows === want && zr.zeros && zr.bands === 4 && zr.legend.indexOf('Inside a zone') >= 0,
    'day3: Run query with four zones matches the ' + want + ' rows sf and GEOS put in a zone (0 km each); the map draws ' +
    'the four zones and the legend names them', zr);

  // ── Facilities inside (the Full tier's facility files) ──
  const texts = facilityTexts();
  await sendFacilities(b, texts);
  const fl = await p.eval(`(() => ({ boxes: [...document.querySelectorAll('#lk-fac-list input[type=checkbox][id^=lk-layer-]')]
    .map(c => ({ key: c.value, on: c.checked, usable: !c.disabled })), none: document.getElementById('lk-fac-none').hidden }))()`);
  const usableKeys = fl.boxes.filter(x => x.usable).map(x => x.key);
  check(usableKeys.length === 7 && fl.boxes.filter(x => x.usable).every(x => x.on) && fl.none,
    'day3: the facility files list their layers, every usable layer ticked (as on the Infrastructure dashboard)', fl);
  // Sites near facilities, then counts worked out here.
  const pts = {};
  ['slaughterhouses', 'fairgrounds', 'markets', 'feedlots', 'restricted', 'syn_custommeat', 'syn_disposal']
    .forEach(k => { pts[k] = facilityPoints(texts[k]); });
  const f1 = pts.feedlots[0], m1 = pts.markets[0];
  const siteList = [{ name: 'Near feedlot', lat: Number((f1[0] + 0.012).toFixed(5)), long: f1[1] },
    { name: 'Near market', lat: m1[0], long: Number((m1[1] - 0.05).toFixed(5)) }];
  await click(b, 'lk-clear');
  await p.eval(`CVIWA.lookupState.testSetSites(${js(siteList)})`);
  await radio(b, 'lk-mode', 'bands');
  await setValue(b, 'lk-bands', '3, 10, 50');
  await click(b, 'lk-run');
  await p.waitFor(`!document.getElementById('lk-fac-card').hidden`, 10000, 'facilities card');
  const fit = await p.eval(`(() => { const card = document.getElementById('lk-fac-card').getBoundingClientRect(),
    box = document.querySelector('#lk-fac-counts .lk-fac-scroll'); return { inside: !!box && box.getBoundingClientRect().right <= card.right + 0.5,
    scrolls: !!box && getComputedStyle(box).overflowX === 'auto' }; })()`);
  check(fit.inside && fit.scrolls, 'day3: the counts table stays inside its card (scrolling sideways when wide)', fit);
  const fc = await p.eval(`(() => { const t = document.querySelector('#lk-fac-counts table');
    return { head: [...t.querySelectorAll('th')].map(e => e.textContent), rows: [...t.querySelectorAll('tbody tr')]
      .map(tr => [...tr.children].map(e => e.textContent)), labels: CVIWA.lookupState.facResult.layers.map(l => l.key) }; })()`);
  // The page's columns follow the registry's order; the counts here are worked out in that order.
  const layerKeys = fc.labels;
  const countsIn = radius => siteList.map(s => layerKeys.map(key => pts[key]
    .filter(q => hav(q[0], q[1], s.lat, s.long) <= radius).length));
  const wantFc = countsIn(50);
  const gotFc = fc.rows.map(r => r.slice(2, 2 + layerKeys.length).map(Number));
  check(js([...layerKeys].sort()) === js([...usableKeys].sort()) && js(gotFc) === js(wantFc) && fc.rows.every((r, k) => Number(r[r.length - 1]) ===
    wantFc[k].reduce((a, c) => a + c, 0)) && wantFc[0].reduce((a, c) => a + c, 0) > 0 && fc.rows[0][1] === '3 / 10 / 50 km',
  'day3: Facilities inside: per site and layer, the counts worked out here from the facility files (within 50 km)',
  { got: gotFc, want: wantFc, head: fc.head });
  const list3 = await p.eval(`CVIWA.lookupState.facResult.rows.map(r => [r.site, r.layer, r.km, r.bandKm])`);
  const ringOk = list3.every(r => r[3] === [3, 10, 50].find(x => x >= r[2] - 0.005));
  const near3 = siteList.map((s, k) => usableKeys.reduce((t2, key) => t2 + pts[key].filter(q => hav(q[0], q[1], s.lat, s.long) <= 3).length, 0));
  check(ringOk && near3.every((n, k) => list3.filter(r => r[0] === k + 1 && r[3] === 3).length === n),
    'day3: each facility in the smallest ring holding it (the 3 km ring counted here too)', { near3 });
  await p.eval(`document.getElementById('lk-fac-card').scrollIntoView(); true`);
  const facLines = await lines(b, 'lk-run-lines');
  // The filters do not apply to facilities: a run whose filters match no CVI still lists them.
  {
    await setChecks(b, 'years', [1990]);
    await click(b, 'lk-run');
    await sleep(200);
    const nf = await p.eval(`({ lines: [...document.querySelectorAll('#lk-run-lines .status')].map(e => e.textContent),
      note: document.getElementById('lk-cvi-off').textContent, noteShown: document.getElementById('lk-cvi-off').getClientRects().length > 0,
      facShown: document.getElementById('lk-fac-card').getClientRects().length > 0,
      tiles: document.getElementById('lk-tiles').getClientRects().length, total: CVIWA.lookupState.facResult && CVIWA.lookupState.facResult.total })`);
    check(nf.lines[0] === 'No CVIs match the current filters.' && nf.noteShown &&
      nf.note === 'No CVIs match the current filters. The facilities inside are below.' && nf.facShown && !nf.tiles &&
      nf.total === wantFc.reduce((a, r) => a + r.reduce((x, y) => x + y, 0), 0),
    'day3: with no CVI matching the filters, the facilities inside still show, with CVI\'s line', nf);
    await click(b, 'lk-years-all');
    await click(b, 'lk-run');
    await sleep(200);
  }
  const total = wantFc.reduce((a, r) => a + r.reduce((x, y) => x + y, 0), 0);
  check(facLines[facLines.length - 1].text === 'Found ' + total + ' facilities inside the buffers or zones of 2 site(s).',
    'day3: the run\'s last line counts the facilities inside', facLines);
  // The map draws one dot per facility inside, in its layer's color; hovering one names it and its layer.
  await waitMap(b);
  await p.eval(`document.getElementById('lookup-map').scrollIntoView({ block: 'center' }); true`);
  await sleep(150);
  await idle(b);
  const dots = await p.eval(`(() => { const m = CVIWA.lookupState.map, f = m.lookup.facilities.features[0];
    const xy = m.map.project(f.geometry.coordinates), r = m.map.getContainer().getBoundingClientRect();
    return { n: m.drawn.facilities, x: r.left + xy.x, y: r.top + xy.y, label: f.properties.label, color: f.properties.color }; })()`);
  const uniq = new Set();
  siteList.forEach(s => usableKeys.forEach(key => pts[key].forEach(q => { if (hav(q[0], q[1], s.lat, s.long) <= 50) uniq.add(key + q.join()); })));
  await b.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: dots.x, y: dots.y }, b.sid);
  await sleep(300);
  const hov = await p.eval(`CVIWA.lookupState.map.hoverLabel`);
  check(dots.n === uniq.size && hov === dots.label && / \(.+\)$/.test(hov), 'day3: the map draws each facility inside ' +
    'once (' + uniq.size + '); hovering one names it and its layer', { dots, hov });
  // The legend: what is drawn, the rings in their chosen colors; in the screenshot too; no county name under it.
  const lg = await p.eval(`(() => { const e = document.getElementById('lookup-legend'), f = document.getElementById('lookup-frame');
    const r = e.getBoundingClientRect(), fr = f.getBoundingClientRect();
    const names = [...document.querySelectorAll('#lookup-map .county-label')].filter(n => !n.classList.contains('covered') &&
      getComputedStyle(n).visibility !== 'hidden' && n.offsetWidth).map(n => n.getBoundingClientRect())
      .filter(n => n.left < r.right && n.right > r.left && n.top < r.bottom && n.bottom > r.top).length;
    // The population layers are on at first, so their block follows; the rows checked here are those before it.
    const all = [...e.children].map(c => c.textContent), pcAt = all.indexOf('Population context');
    return { rows: pcAt < 0 ? all : all.slice(0, pcAt), shown: !e.hidden, left: r.left - fr.left, bottom: fr.bottom - r.bottom,
      rings: [...e.querySelectorAll('.lg-ring')].map(x => getComputedStyle(x).borderTopColor), under: names }; })()`);
  const facRows = layerKeys.map((k, j) => j).filter(j => wantFc.some(r => r[j] > 0));
  check(lg.shown && lg.left < 20 && lg.bottom < 20 && lg.rows[0] === 'Legend' && lg.rows.indexOf('Site') === 1 &&
    lg.rows.indexOf('Buffers') > 0 && js(lg.rows.slice(-3)) === js(['Within 3 km', 'Within 10 km', 'Within 50 km']) &&
    js(lg.rings) === js(['rgb(252, 182, 20)', 'rgb(143, 201, 101)', 'rgb(167, 215, 226)']) &&
    lg.rows.filter(x => / \(\d+\)$/.test(x)).length === facRows.length && lg.under === 0,
  'day3: the match map\'s legend (bottom left): the sites and points drawn, each facility layer with its count, the ' +
    'three rings in their colors; no county name under it', lg);
  // A county name moved under the legend is hidden (the view above may have none there): the map is panned so a
  // shown name's anchor lands on the legend's middle.
  const under = await p.eval(`(async () => { const st = CVIWA.lookupState.map, map = st.map;
    const lg = document.getElementById('lookup-legend').getBoundingClientRect(), fr = map.getContainer().getBoundingClientRect();
    const m = st.labels.find(x => x.getElement().offsetWidth && !x.getElement().classList.contains('covered'));
    if (!m) return { found: false };
    const at = map.project(m.getLngLat());
    map.panBy([at.x - (lg.left - fr.left + lg.width / 2), at.y - (lg.top - fr.top + lg.height / 2)], { animate: false });
    await new Promise(r => setTimeout(r, 300));
    const e = m.getElement(), r = e.getBoundingClientRect();
    return { found: true, name: e.textContent, covered: e.classList.contains('covered'),
      overlaps: r.left < lg.right && r.right > lg.left && r.top < lg.bottom && r.bottom > lg.top }; })()`);
  check(under.found && under.overlaps && under.covered, 'day3: a county name under the legend is hidden', under);
  const shot = await p.eval(`(async () => { const st = CVIWA.lookupState.map, blob = await CVIWA.map.screenshot(st);
    const img = await createImageBitmap(blob), c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    // The site's mark is a bullseye (its middle is the red dot).
    const dot = document.querySelector('#lookup-legend .lg-bullseye').getBoundingClientRect(), fr = st.map.getContainer().getBoundingClientRect();
    const k = img.width / st.map.getContainer().clientWidth;
    const px = g.getImageData(Math.round((dot.left + dot.width / 2 - fr.left) * k), Math.round((dot.top + dot.height / 2 - fr.top) * k), 1, 1).data;
    return { legend: st.lastLegend, px: [...px].slice(0, 3) }; })()`);
  const shotRows = shot.legend.indexOf('Population context') < 0 ? shot.legend
    : shot.legend.slice(0, shot.legend.indexOf('Population context'));
  check(js(shotRows) === js(lg.rows.slice(1)) && Math.abs(shot.px[0] - 0xc0) < 12 && Math.abs(shot.px[1] - 0x39) < 12 &&
    Math.abs(shot.px[2] - 0x2b) < 12, 'day3: the screenshot draws the legend (its rows, the site dot red where the page shows it)', shot);

  // ── The export ZIP (Full tier, CVI's own case "single, three sites") ──
  const ci = FX.module.runs.findIndex(r => r.name === 'single, three sites');
  const cs = FX.module.runs[ci];
  await radio(b, 'lk-mode', 'single');
  await setValue(b, 'lk-default', cs.default_buffer_km);
  await p.eval(`CVIWA.lookupState.testSetSites(${js(cs.sites)})`);
  await click(b, 'lk-run');
  await p.waitFor(`!document.getElementById('lk-export-card').hidden`, 10000, 'export card');
  const DL = path.join(OUT, 'downloads-day3');
  fs.rmSync(DL, { recursive: true, force: true });
  fs.mkdirSync(DL, { recursive: true });
  await b.send('Browser.setDownloadBehavior', { behavior: 'allowAndName', downloadPath: DL, eventsEnabled: true });
  // "Branded map (.png)" is ticked at first; this export is checked without it (part day4 checks it).
  await p.eval(`(c => { if (c.checked) c.click(); return true; })(document.querySelector('input[name=lk-format][value=branded_png]'))`);
  await click(b, 'lk-export');
  await p.waitFor(`CVIWA.lookupState.lastExport`, 10000, 'export');
  const ex = await p.eval(`CVIWA.lookupState.lastExport`);
  const t0 = Date.now();
  // The finished file (Chrome writes a .crdownload first, then renames it).
  const done = () => fs.readdirSync(DL).filter(f => !/\.crdownload$/.test(f));
  while (Date.now() - t0 < 10000 && !done().length) await sleep(100);
  await sleep(200);
  await b.send('Browser.setDownloadBehavior', { behavior: 'default' });
  const zipBytes = done().map(f => fs.readFileSync(path.join(DL, f)))[0] || Buffer.alloc(0);
  const day = await p.eval(`CVIWA.exports.localDate(new Date())`);
  const params = JSON.parse(ex.files[2].text);
  const facCsv = ex.files[1].text.split('\n').filter(Boolean);
  const facTotal = await p.eval(`CVIWA.lookupState.facResult.total`);
  check(ex.zipName === 'premise_lookup_' + day + '.zip' && ex.files[0].name === 'premise_lookup_matches_' + day + '.csv' &&
    ex.files[0].text === REF.module.runs[ci].csv, 'day3: Export ZIP: the matched rows exactly as CVI\'s Export CSV writes ' +
    'them for the same case (its module, run by the reference)', ex.files.map(f => f.name));
  check(ex.files[1].name === 'premise_lookup_facilities_' + day + '.csv' && (facTotal ? facCsv.length === facTotal + 1 :
    facCsv[1] === '"No facilities inside the buffers."') && params.tool === 'premise_lookup' &&
    params.buffer_style === 'single_buffer' && params.default_buffer_km === cs.default_buffer_km &&
    params.master_file === 'CVI_Consolidated_Master.csv' && [].concat(params.facility_layers).length === usableKeys.length,
  'day3: Export ZIP: the facilities inside and export_params.json', { lines: facCsv.length, facTotal, params });
  const zipText = zipBytes.toString('latin1');
  check(zipBytes.length > 0 && ex.files.every(f => zipText.indexOf('premise_lookup_' + day + '/' + f.name) >= 0),
    'day3: the ZIP was saved by the browser with the three files in its folder', zipBytes.length);
  await p.eval(`document.querySelectorAll('input[name=lk-format]').forEach(c => { c.checked = false; }); true`);
  await click(b, 'lk-export');
  check(js(await lines(b, 'lk-export-msg')) === js([{ level: 'warn', text: 'Select at least one export format.' }]),
    'day3: Export with no format ticked says so');
  await p.eval(`document.querySelectorAll('input[name=lk-format]').forEach(c => { c.checked = true; }); true`);
  const warning = await p.eval(`document.querySelector('#lk-export-card .lk-warning').textContent.trim()`);
  check(/Exports and maps contain premises addresses and coordinates: handle as sensitive data and share only with authorized responders\.$/.test(warning),
    'day3: CVI\'s sensitive-data warning beside the export (a colon in place of its hyphen)', warning);

  // ── Pick on map ──
  await loadMaster(b, FULL);   // a new master clears the result
  await click(b, 'lk-clear');
  check(await p.eval(`document.getElementById('lk-map-card').hidden`), 'day3: with no result the match map is hidden');
  await click(b, 'lk-pick');
  await p.waitFor(`!document.getElementById('lk-map-card').hidden && CVIWA.lookupState.map && CVIWA.lookupState.map.ready`, 15000, 'pick map');
  await p.eval(`document.getElementById('lookup-map').scrollIntoView({ block: 'center' }); true`);
  await sleep(200);
  await idle(b);
  const at = await p.eval(`(() => { const r = CVIWA.lookupState.map.map.getContainer().getBoundingClientRect();
    return { x: Math.round(r.left + r.width * 0.55), y: Math.round(r.top + r.height * 0.45),
      pressed: document.getElementById('lk-pick').getAttribute('aria-pressed') }; })()`);   // whole pixels, as a pointer
  await b.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: at.x, y: at.y, button: 'left', buttons: 1, clickCount: 1 }, b.sid);
  await b.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: at.x, y: at.y, button: 'left', buttons: 0, clickCount: 1 }, b.sid);
  await sleep(200);
  // Where the pointer was, by the map's own projection now (the map did not move: a click while picking only marks).
  const picked = await p.eval(`(() => { const m = CVIWA.lookupState.map.map, r = m.getContainer().getBoundingClientRect();
    const ll = m.unproject([${at.x} - r.left, ${at.y} - r.top]);
    return { lat: Number(document.getElementById('lk-new-lat').value), lon: Number(document.getElementById('lk-new-long').value),
      wantLat: Number(ll.lat.toFixed(5)), wantLon: Number(ll.lng.toFixed(5)),
      marks: CVIWA.lookupState.map.lookup.pick.features.length, focus: document.activeElement && document.activeElement.id,
      crosshair: document.getElementById('lookup-map').classList.contains('picking') }; })()`);
  Object.assign(at, { lat: picked.wantLat, lon: picked.wantLon });
  check(at.pressed === 'true' && picked.crosshair && Math.abs(picked.lat - at.lat) < 2e-5 && Math.abs(picked.lon - at.lon) < 2e-5 &&
    picked.marks === 1 && picked.focus === 'lk-new-name', 'day3: Pick on map: a click on the match map fills in Latitude ' +
    'and Longitude (5 decimals) where the pointer was, marks the spot and moves to Name', { at, picked });
  await setValue(b, 'lk-new-name', 'Picked farm');
  await click(b, 'lk-add');
  await sleep(150);
  const added = await p.eval(`({ sites: CVIWA.lookupState.sites.map(s => [s.name, s.lat, s.long]), picking: CVIWA.lookupState.picking,
    pressed: document.getElementById('lk-pick').getAttribute('aria-pressed'), marks: CVIWA.lookupState.map.lookup.pick.features.length,
    hidden: document.getElementById('lk-map-card').hidden })`);
  check(js(added.sites) === js([['Picked farm', picked.lat, picked.lon]]) && !added.picking && added.pressed === 'false' &&
    added.marks === 0 && added.hidden, 'day3: Add site adds the picked site and ends picking (the map hides again ' +
    'until a result)', added);
  await click(b, 'lk-pick');
  await p.waitFor(`CVIWA.lookupState.map.drawn && CVIWA.lookupState.map.drawn.sites === 1`, 5000, 'sites drawn while picking');
  // Escape inside a box (editing a cell, typing a name) does not end picking.
  await p.eval(`document.getElementById('lk-new-name').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); true`);
  check(await p.eval(`CVIWA.lookupState.picking`), 'day3: Escape inside a text box does not end picking');
  // A click on another copy of the world (the map moved 360 degrees east) gives a longitude within -180 to 180.
  await p.eval(`(() => { const m = CVIWA.lookupState.map.map, c = m.getCenter(); m.jumpTo({ center: [c.lng + 360, c.lat] }); return true; })()`);
  await sleep(200);
  await b.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: at.x, y: at.y, button: 'left', buttons: 1, clickCount: 1 }, b.sid);
  await b.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: at.x, y: at.y, button: 'left', buttons: 0, clickCount: 1 }, b.sid);
  await sleep(200);
  const wrapped = await p.eval(`({ lon: Number(document.getElementById('lk-new-long').value),
    raw: CVIWA.lookupState.map.map.unproject([${at.x} - CVIWA.lookupState.map.map.getContainer().getBoundingClientRect().left, 0]).lng })`);
  check(wrapped.raw > 180 && wrapped.lon >= -180 && wrapped.lon <= 180 && Math.abs(wrapped.lon - (wrapped.raw - 360)) < 1e-4,
    'day3: a pick on another copy of the world gives the longitude within -180 to 180', wrapped);
  await p.eval(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); true`);
  check(!(await p.eval(`CVIWA.lookupState.picking`)), 'day3: while picking, the sites so far are drawn; Escape ends picking');

  // ── Facilities only: the Partner tier (no premises coordinates) with facility files ──
  await loadMaster(b, FX.module.runs.find(r => r.name === 'missing coordinate columns').master);
  await sendFacilities(b, texts);
  const gate = await p.eval(`({ disabled: document.getElementById('lk-run').disabled, reason: document.getElementById('lk-run-reason').textContent })`);
  check(!gate.disabled && /^The CVI match is grayed: Needs the columns Origin\.Lat, Origin\.Long, Dest\.Lat and Dest\.Long in the CVI master table\. Run query checks the facilities only\.$/.test(gate.reason),
    'day3: with the Partner tier and facility layers, Run query stays on and says it checks the facilities only', gate);
  await p.eval(`CVIWA.lookupState.testSetSites(${js(siteList)})`);
  await click(b, 'lk-run');
  await p.waitFor(`!document.getElementById('lk-fac-card').hidden`, 10000, 'facilities only');
  // Seen or not on screen (a box with no size), not only the hidden flag: a style can show a hidden element.
  const only = await p.eval(`({ status: CVIWA.lookupState.lastRun.status,
    cviCard: !document.getElementById('lk-cvi-card').getClientRects().length,
    tiles: !document.getElementById('lk-tiles').getClientRects().length,
    offShown: document.getElementById('lk-cvi-off').getClientRects().length > 0,
    off: document.getElementById('lk-cvi-off').textContent,
    matchesBox: document.querySelector('input[name=lk-format][value=matches_csv]').disabled,
    facBox: document.querySelector('input[name=lk-format][value=facilities_csv]').disabled,
    total: CVIWA.lookupState.facResult.total })`);
  const want3 = countsIn(3).reduce((a, r) => a + r.reduce((x, y) => x + y, 0), 0);
  check(only.status === 'facilities_only' && only.cviCard && only.tiles && only.offShown &&
    /^The CVI match is grayed: Needs the columns/.test(only.off) &&
    only.matchesBox && !only.facBox && only.total === want3, 'day3: a facilities-only run: no tiles or CVI table, the ' +
    'reason shown, the facilities inside (' + want3 + ' within 3 km, worked out here), the matched-rows CSV grayed', only);
  // While a master is still loading there is no facilities-only run: Run query waits, with CVI's
  // reason. (The page's loading flag is set here as the loader sets it; new facility files make the page gate again.)
  await p.eval(`CVIWA.state.loading = true; true`);
  await sendFacilities(b, texts);
  const gate3 = await p.eval(`({ disabled: document.getElementById('lk-run').disabled, reason: document.getElementById('lk-run-reason').textContent })`);
  await p.eval(`CVIWA.state.loading = false; true`);
  await sendFacilities(b, texts);
  check(gate3.disabled && gate3.reason === 'The master dataset is still loading — try again in a moment.',
    'day3: while a master loads, Run query waits (no facilities-only run)', gate3);
  await click(b, 'lk-fac-clear');
  const gate2 = await p.eval(`({ disabled: document.getElementById('lk-run').disabled, reason: document.getElementById('lk-run-reason').textContent })`);
  check(gate2.disabled && /^Needs the columns/.test(gate2.reason), 'day3: with no layer ticked Run query is grayed with the ' +
    'CVI reason again', gate2);
}
// The points R tested for the zones: the grid, then the Full tier's origins and destinations as the page reads them.
// The master is read here with the page's own reader (in Node), so the rows are in the reference's order.
function zonePointsOf() {
  const vm = require('vm'), vmctx = { window: {} };
  vmctx.window.window = vmctx.window;
  vm.createContext(vmctx);
  for (const f of ['cvi/app/csv.js', 'cvi/app/master.js', 'cvi/app/scaling.js', 'cvi/app/summary.js', 'shared/proximity.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'site', f), 'utf8'), vmctx);
  }
  const m = vmctx.window.CVIWA.master.load(fs.readFileSync(path.join(ROOT, FX.full), 'utf8'));
  const n = vmctx.window.WSDA.proximity.number;
  return ZF.points.concat(m.rows.map(r => [n(r['Origin.Long']), n(r['Origin.Lat'])]),
    m.rows.map(r => [n(r['Dest.Long']), n(r['Dest.Lat'])]));
}


// ── Part day4: the branded proximity PNG and Premise Lookup's population switches ──────────────────────────────
// Expected values come from outside the page where they can: the page's PNG model is checked against CVI's own page
// in the unit suite (the same builder); here the clicks, the dialog, the ZIP, the timings, the switches and the
// live map. Tile backgrounds are answered by this suite (a solid picture, or a refusal), so nothing leaves the
// computer.
const zlib = require('zlib');
// A solid-color PNG of w x h pixels, written here (for the answered tile requests).
function solidPng(w, h, rgb) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = buf => { let c = 0xffffffff; for (const x of buf) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3).fill(Buffer.from(rgb))]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const PNG_SITES = () => FX.pngs.find(x => x.name === 'facilities and labels').run.sites;
async function previewOnce(b) {
  const p = b.page;
  await p.eval(`(() => { CVIWA.lookupState.lastPreview = null; const d = document.getElementById('preview-dialog');
    if (d && d.open) d.close(); return true; })()`);
  const t0 = Date.now();
  await click(b, 'lk-preview');
  await p.waitFor(`CVIWA.lookupState.lastPreview && document.getElementById('preview-dialog') &&
    document.getElementById('preview-dialog').open && !document.getElementById('lk-preview').disabled`, 30000, 'preview');
  const ms = Date.now() - t0;
  const info = await p.eval(`(async () => { const ps = CVIWA.lookupState, m = ps.lastPng.model, drawMs = ps.lastPng.ms;
    const img = await createImageBitmap(ps.lastPreview.blob);
    const shown = document.querySelector('#preview-dialog img');
    return { ms: 0, title: m.title, background: m.background, dpi: ps.lastPng.dpi, notices: ps.lastPng.notices, width: img.width,
      height: img.height, shown: !!shown && shown.complete && shown.naturalWidth === img.width, facilityNames: m.facilityNames.length,
      facilities: m.facilities.map(l => l.points.length), population: m.population ? m.population.on : null, fileName: m.fileName,
      dialogTitle: document.getElementById('preview-title').textContent, keyItems: m.keyItems.map(i => i.label),
      sites: m.sites.length, underlay: ps.lastPng.underlay, drawMs }; })()`);
  info.ms = ms;   // from the click to the dialog, as the user waits
  await p.eval(`document.getElementById('preview-close').click(); true`);
  return info;
}
async function partDay4(b) {
  const p = b.page;
  const texts = facilityTexts();
  // Tile requests answered here: 'ok' a solid picture, 'fail' refused.
  let tileMode = 'ok';
  const tileSeen = [];
  b.listeners.push(async m => {
    if (m.method !== 'Fetch.requestPaused' || m.sessionId !== b.sid) return;
    const url = m.params.request.url;
    if (!/^https:\/\/server\.arcgisonline\.com\//.test(url)) return;   // the PNG's tile backgrounds only
    tileSeen.push(url);
    if (tileMode === 'fail') {
      await b.send('Fetch.failRequest', { requestId: m.params.requestId, errorReason: 'Failed' }, b.sid);
      return;
    }
    const size = /\/export\?/.test(url) ? (url.match(/size=(\d+),(\d+)/) || []).slice(1).map(Number) : [256, 256];
    await b.send('Fetch.fulfillRequest', { requestId: m.params.requestId, responseCode: 200,
      body: solidPng(size[0] || 256, size[1] || 256, [90, 120, 80]).toString('base64'),
      responseHeaders: [{ name: 'Content-Type', value: 'image/png' }, { name: 'Access-Control-Allow-Origin', value: '*' }] }, b.sid);
  });
  // The live map's basemap hosts (OpenFreeMap here): refused, so nothing leaves the computer.
  const basemapSeen = [];
  b.listeners.push(async m => {
    if (m.method !== 'Fetch.requestPaused' || m.sessionId !== b.sid) return;
    const url = m.params.request.url;
    if (!/^https:\/\/tiles\.openfreemap\.org\//.test(url)) return;
    basemapSeen.push(url);
    await b.send('Fetch.failRequest', { requestId: m.params.requestId, errorReason: 'Failed' }, b.sid);
  });
  await b.send('Fetch.enable', { patterns: [{ urlPattern: '*server.arcgisonline.com*' }, { urlPattern: '*tiles.openfreemap.org*' }] },
    b.sid);
  b.answered = url => /^https:\/\/(server\.arcgisonline\.com|tiles\.openfreemap\.org)\//.test(url);

  await openPage(b);
  await p.viewport(1400, 1000);
  await click(b, 'show-lookup');
  // ── The population switches: Premise Lookup's own, all on at first ──
  const sw0 = await p.eval(`(() => ({ lk: [...document.querySelectorAll('#lk-pc-block .lk-pc-on')].map(c => [c.dataset.layer, c.checked, c.disabled]),
    maps: [...document.querySelectorAll('#pc-block .pc-on')].map(c => c.checked) }))()`);
  check(js(sw0.lk) === js([['cities', true, false], ['places', true, false], ['density', true, false]]) &&
    sw0.maps.every(x => !x), 'day4: three population switches in Premise Lookup\'s "Map Style", all on when the page opens; ' +
    'the Maps side\'s off', sw0);
  // The two Export buttons the same height, the zone picker offers .kmz, room under Add site.
  const lay = await p.eval(`(() => { const pv = document.getElementById('lk-preview'), ex = document.getElementById('lk-export');
    document.getElementById('lk-export-card').hidden = false;
    const r = [pv.getBoundingClientRect().height, ex.getBoundingClientRect().height];
    document.getElementById('lk-export-card').hidden = true;
    return { heights: r, accept: document.getElementById('lk-zone-file').accept,
      gap: parseFloat(getComputedStyle(document.querySelector('.lk-add-buttons')).marginBottom),
      section: document.querySelector('#lk-pc-section > summary').textContent,
      basemaps: [...document.getElementById('lk-basemap').options].map(o => o.value),
      mapsBasemaps: [...document.getElementById('s-basemap').options].map(o => o.value) }; })()`);
  check(lay.heights[0] > 0 && Math.abs(lay.heights[0] - lay.heights[1]) < 0.5 && /\.kmz/.test(lay.accept) && lay.gap >= 8 &&
    lay.section === 'Map Style' && lay.basemaps[0] === 'offline' && js(lay.basemaps) === js(lay.mapsBasemaps),
  'day4: same-size Export buttons, .kmz offered, room under Add site; "Map Style" with the Maps side\'s basemap list', lay);
  // ── A run near the Full tier's facilities ──
  await loadMaster(b, FULL);
  await sendFacilities(b, texts);
  await p.eval(`CVIWA.lookupState.testSetSites(${js(PNG_SITES())}); true`);
  await setValue(b, 'lk-default', 20);
  await click(b, 'lk-run');
  await waitMap(b);
  // ── The export card's PNG controls ──
  const ctl = await p.eval(`(() => ({ png: (b => b && b.checked && !b.disabled)(document.querySelector('input[name=lk-format][value=branded_png]')),
    bg: document.getElementById('lk-png-background').value, qualityHidden: document.getElementById('lk-png-quality-field').hidden,
    res: document.getElementById('lk-png-resolution').value, labels: document.getElementById('lk-png-labels').checked,
    options: [...document.getElementById('lk-png-background').options].map(o => o.value) }))()`);
  // A public copy (shared/release.js) offers no Esri background: Streets and Default only, and the
  // tile-background checks below stay with the private build.
  const publicCopy = await p.eval('!!(window.WSDA && WSDA.release && WSDA.release.publicCopy)');
  const esri = publicCopy ? [] : ['raster:esri_satellite', 'raster:esri_relief', 'raster:esri_hillshade'];
  check(ctl.png && ctl.bg === 'vector:streets' && ctl.qualityHidden && ctl.res === 'standard' && !ctl.labels &&
    js(ctl.options) === js(['vector:streets', 'standard'].concat(esri)),
  'day4: Branded map (.png) ticked; options: Streets (CVI\'s default), Default and the three Esri backgrounds (none in a ' +
    'public copy); Standard; labels off', ctl);
  if (!publicCopy) {
    await setValue(b, 'lk-png-background', 'raster:esri_satellite');
    check(!(await p.eval(`document.getElementById('lk-png-quality-field').hidden`)), 'day4: Export quality shown for a tile background');
  }
  // ── Preview branded map: Streets (its data loads the first time), then Default, timed ──
  await setValue(b, 'lk-png-background', 'vector:streets');
  const st1 = await previewOnce(b);
  const st2 = await previewOnce(b);
  check(st1.title === 'PREMISE PROXIMITY ASSESSMENT - ALL SPECIES - 3 SITES' && st1.background === 'vector:streets' &&
    st1.width === 2200 && st1.height === 1700 && st1.shown && st1.dialogTitle === 'Branded proximity map preview' &&
    /^premise_proximity_\d{4}-\d\d-\d\d\.png$/.test(st1.fileName) && !st1.notices.length,
  'day4: Preview branded map shows the 2200 x 1700 page on Streets in the dialog', st1);
  check(st2.ms < 3000, 'day4: Streets preview within the 3 s Standard budget (the data already loaded)', [st1.ms, st2.ms]);
  await setValue(b, 'lk-png-background', 'standard');
  const df = await previewOnce(b);
  check(df.background === 'standard' && df.ms < 3000, 'day4: Default preview within 3 s', df.ms);
  await setValue(b, 'lk-png-resolution', 'high');
  const hi = await previewOnce(b);
  check(hi.width === 3300 && hi.height === 2550 && hi.dpi === 300 && hi.ms < 6000, 'day4: High: 3300 x 2550 at 300 dpi within 6 s',
    [hi.width, hi.ms]);
  await setValue(b, 'lk-png-resolution', 'standard');
  // The facilities drawn: those of the ticked layers inside a buffer (the run's facilities card), names when ticked.
  const facRun = await p.eval(`(() => { const f = CVIWA.lookupState.facResult; const seen = {};
    f.rows.forEach(r => { seen[r.layer] = seen[r.layer] || new Set(); seen[r.layer].add(r.lat + ',' + r.lon + ',' + r.name); });
    return Object.keys(seen).map(k => seen[k].size); })()`);
  check(js(df.facilities.slice().sort()) === js(facRun.slice().sort()) && df.facilityNames === 0 &&
    df.keyItems.indexOf('FACILITY LOCATIONS') >= 0, 'day4: the PNG draws the facilities inside, by layer, without names', [df.facilities, facRun]);
  await p.eval(`document.getElementById('lk-png-labels').click(); true`);
  const lb = await previewOnce(b);
  check(lb.facilityNames === facRun.reduce((a, c) => a + c, 0), 'day4: Show facility labels prints their names', lb.facilityNames);
  await p.eval(`document.getElementById('lk-png-labels').click(); true`);
  // A layer unticked under "Facilities inside", then Run query: it leaves the PNG too.
  await p.eval(`(() => { const c = document.querySelector('#lk-fac-list input[value=markets]'); if (c.checked) c.click(); return true; })()`);
  await click(b, 'lk-run');
  await sleep(600);
  const nm = await previewOnce(b);
  check(!nm.keyItems.some(l => /^Markets:/.test(l)) && nm.keyItems.some(l => /^Feedlots:/.test(l)),
    'day4: the PNG\'s layers follow the "Facilities inside" ticks', nm.keyItems);
  // ── Tile backgrounds, answered here: drawn; refused: the Default background with a notice (private build only) ──
  if (!publicCopy) {
    await setValue(b, 'lk-png-background', 'raster:esri_relief');
    tileMode = 'ok';
    const tl = await previewOnce(b);
    check(tl.background === 'raster:esri_relief' && tl.underlay && !tl.notices.length && tileSeen.length > 0,
      'day4: a tile background is drawn under the page (requests answered by this suite)', [tl.underlay, tileSeen.length]);
    tileMode = 'fail';
    const tf = await previewOnce(b);
    check(tf.background === 'standard' && js(tf.notices) === js(['The Shaded Relief background could not be loaded, so the ' +
      'Default background was used.']), 'day4: a background that cannot be loaded gives the Default background and a notice',
    tf.notices);
    const shownNotice = await lines(b, 'lk-export-msg');
    check(shownNotice.some(l => l.level === 'warn' && /Shaded Relief/.test(l.text)), 'day4: the notice is shown under the buttons',
      shownNotice);
    await setValue(b, 'lk-png-background', 'standard');
  }

  // ── Population: all three on at first, Premise Lookup's only; the match map, its legend, its
  // screenshot and the PNG ──
  await p.waitFor(`['cities', 'places', 'density'].every(l => WSDA.population.loaded(l)) &&
    CVIWA.lookupState.map.map.getLayer('pc-cities-fill') && CVIWA.lookupState.map.map.getLayer('pc-density')`, 30000, 'layers on');
  for (const id of ['lk-pc-places', 'lk-pc-density']) await p.eval(`document.getElementById(${js(id)}).click(); true`);
  await sleep(500);
  const pc1 = await p.eval(`(() => { const st = CVIWA.lookupState.map, m = st.map;
    const mapsMap = CVIWA.state.mapHandle && CVIWA.state.mapHandle.map;
    return { vis: m.getLayoutProperty('pc-cities-fill', 'visibility'), dens: m.getLayoutProperty('pc-density', 'visibility'),
      legend: st.legendRows.map(r => r.label),
      shownLegend: [...document.querySelectorAll('#lookup-legend > div')].map(d => d.textContent),
      mapsBox: document.getElementById('pc-cities').checked,
      mapsLayer: !!(mapsMap && mapsMap.getLayer('pc-cities-fill') && mapsMap.getLayoutProperty('pc-cities-fill', 'visibility') === 'visible') }; })()`);
  check(pc1.vis === 'visible' && pc1.dens === 'none' && pc1.legend.indexOf('Population context') >= 0 &&
    pc1.legend.indexOf('City limits (current)') >= 0 && pc1.shownLegend.indexOf('City limits (current)') >= 0 && !pc1.mapsBox &&
    !pc1.mapsLayer, 'day4: City limits left on: drawn on the match map with its legend rows (density off); the Maps side\'s ' +
    'switch and map unchanged', pc1);
  const shot = await p.eval(`(async () => { const st = CVIWA.lookupState.map; await CVIWA.map.screenshot(st); return st.lastLegend; })()`);
  check(shot.indexOf('Population context') >= 0 && shot.indexOf('City limits (current)') >= 0,
    'day4: the screenshot draws the legend\'s population rows', shot);
  const pp = await previewOnce(b);
  check(pp.population && pp.population.cities && !pp.population.places && !pp.population.density,
    'day4: the PNG draws the population layers switched on in Premise Lookup', pp.population);
  // The Maps side's switch does not change Premise Lookup's.
  await click(b, 'show-maps');
  await p.eval(`document.getElementById('pc-density').click(); true`);
  await p.waitFor(`WSDA.population.loaded('density')`, 20000, 'density loaded');
  await click(b, 'show-lookup');
  await sleep(400);
  const pc2 = await p.eval(`(() => ({ lk: [...document.querySelectorAll('#lk-pc-block .lk-pc-on')].map(c => c.checked),
    dens: CVIWA.lookupState.map.map.getLayoutProperty('pc-density', 'visibility') === 'visible' }))()`);
  check(js(pc2.lk) === js([true, false, false]) && !pc2.dens, 'day4: the Maps side\'s density switch leaves Premise Lookup\'s off', pc2);
  await click(b, 'show-maps');
  await p.eval(`document.getElementById('pc-density').click(); true`);
  await click(b, 'show-lookup');
  await p.eval(`document.getElementById('lk-pc-cities').click(); true`);
  await sleep(400);
  const pc3 = await p.eval(`(() => ({ vis: CVIWA.lookupState.map.map.getLayoutProperty('pc-cities-fill', 'visibility'),
    legend: CVIWA.lookupState.map.legendRows.map(r => r.label) }))()`);
  check(pc3.vis === 'none' && pc3.legend.indexOf('Population context') < 0, 'day4: switched off: gone from the map and legend', pc3);
  const pq = await previewOnce(b);
  check(!pq.population, 'day4: and from the PNG', pq.population);

  // ── The live map's basemap: a tile basemap through the gate; its requests refused here, the
  // county shapes come back with the message; the offline map again clears it ──
  await setValue(b, 'lk-basemap', 'ofm-liberty');
  await p.waitFor(`!document.getElementById('lookup-status').hidden && /could not be loaded/.test(document.getElementById('lookup-status').textContent)`,
    30000, 'basemap message');
  const bm1 = await p.eval(`(() => ({ chosen: CVIWA.lookupState.map.basemap && CVIWA.lookupState.map.basemap.id,
    text: document.getElementById('lookup-status').textContent, note: document.getElementById('lk-basemap-note').textContent }))()`);
  check(bm1.chosen === 'ofm-liberty' && /OpenFreeMap/.test(bm1.text) && basemapSeen.length > 0 &&
    basemapSeen.every(u => /^https:\/\/tiles\.openfreemap\.org\//.test(u)), 'day4: a tile basemap on the live map asks only ' +
    'its own host (refused here): the message, the county shapes', { bm1, seen: basemapSeen.slice(0, 3) });
  await setValue(b, 'lk-basemap', 'offline');
  await sleep(500);
  check(await p.eval(`document.getElementById('lookup-status').hidden && !CVIWA.lookupState.map.basemap`),
    'day4: the offline map again clears the message');

  // ── One PNG per county: the facility sites lie in three counties ──
  await p.eval(`document.getElementById('lk-png-counties').click(); true`);
  const cpv = await previewOnce(b);
  const pages = await p.eval(`(() => ({ names: CVIWA.lookupState.lastPreviews.map(x => x.name),
    shown: document.querySelectorAll('#preview-dialog img').length,
    titles: CVIWA.lookupState.lastPng.pages.map(m => m.title), areas: CVIWA.lookupState.lastPng.pages.map(m => m.area),
    sites: CVIWA.lookupState.lastPng.pages.map(m => m.sites.map(x => x.name)),
    bgs: CVIWA.lookupState.lastPng.pages.map(m => m.background) }))()`);
  const wantCounties = await p.eval(`(() => { const c = CVIWA_GEO.counties.features, seen = [];
    CVIWA.lookupState.result.sites.forEach(s => { const n = CVIWA.brandedmaps.siteCounty(s, c); if (n && seen.indexOf(n) < 0) seen.push(n); });
    return seen; })()`);
  check(wantCounties.length === 3 && pages.names.length === 4 && pages.areas[0] === null &&
    pages.areas.slice(1).every((a, k) => js(a) === js([wantCounties[k]])) &&
    pages.titles.slice(1).every((t, k) => t.endsWith(' - 1 SITE - ' + wantCounties[k].toUpperCase() + ' COUNTY')) &&
    pages.names.slice(1).every((n, k) => n === cpv.fileName.replace(/\.png$/, '_' + wantCounties[k].replace(/[^A-Za-z0-9]+/g, '_') + '.png')) &&
    pages.sites.slice(1).every(x => x.length === 1) && pages.bgs.slice(1).every(x => x === 'vector:streets'),
  'day4: "Also one PNG per county": the usual page, then one Streets page per county with its own site', { pages, wantCounties });
  await p.eval(`document.getElementById('lk-png-counties').click(); true`);

  // ── Export ZIP with the PNG: the picture, its name and export_params.json ──
  await p.eval(`document.getElementById('lk-pc-places').click(); true`);
  await p.waitFor(`WSDA.population.loaded('places')`, 20000, 'places loaded');
  await p.eval(`CVIWA.lookupState.lastExport = null; true`);
  await click(b, 'lk-export');
  await p.waitFor(`CVIWA.lookupState.lastExport && !document.getElementById('lk-export').disabled`, 30000, 'export');
  const ex = await p.eval(`CVIWA.lookupState.lastExport`);
  const day = await p.eval(`CVIWA.exports.localDate(new Date())`);
  const pngFile = ex.files.find(f => f.name === 'premise_proximity_' + day + '.png');
  const params = JSON.parse(ex.files.find(f => f.name === 'export_params.json').text);
  check(pngFile && pngFile.bytes > 100000 && params.png_background === 'standard' && params.png_resolution === 'standard' &&
    params.facility_labels_on_png === false && params.population_layers === 'population_centers' &&
    js(params.formats) === js(['matches_csv', 'facilities_csv', 'branded_png']),
  'day4: Export ZIP holds premise_proximity_<date>.png and export_params.json names the PNG\'s choices', { files: ex.files.map(f => [f.name, f.bytes]), params });
  await p.eval(`document.getElementById('lk-pc-places').click(); true`);
  // With "Also one PNG per county": the county pages in the ZIP, named in export_params.json.
  await p.eval(`document.getElementById('lk-png-counties').click(); CVIWA.lookupState.lastExport = null; true`);
  await click(b, 'lk-export');
  await p.waitFor(`CVIWA.lookupState.lastExport && !document.getElementById('lk-export').disabled`, 60000, 'export with counties');
  const exc = await p.eval(`CVIWA.lookupState.lastExport`);
  const pc = JSON.parse(exc.files.find(f => f.name === 'export_params.json').text);
  check(exc.files.filter(f => /^premise_proximity_.*_[A-Za-z_]+\.png$/.test(f.name) && f.bytes > 50000).length === 3 &&
    js([].concat(pc.county_pngs)) === js(wantCounties), 'day4: Export ZIP with the three county pages, listed in ' +
    'export_params.json', { files: exc.files.map(f => [f.name, f.bytes]), county: pc.county_pngs });
  await p.eval(`document.getElementById('lk-png-counties').click(); true`);
  // Unticked: no PNG and no PNG fields.
  await p.eval(`document.querySelector('input[name=lk-format][value=branded_png]').click(); CVIWA.lookupState.lastExport = null; true`);
  await click(b, 'lk-export');
  await p.waitFor(`CVIWA.lookupState.lastExport`, 15000, 'export 2');
  const ex2 = await p.eval(`CVIWA.lookupState.lastExport`);
  const params2 = JSON.parse(ex2.files.find(f => f.name === 'export_params.json').text);
  check(!ex2.files.some(f => /\.png$/.test(f.name)) && !('png_background' in params2), 'day4: with the box unticked, no PNG', ex2.files);
  await p.eval(`document.querySelector('input[name=lk-format][value=branded_png]').click(); true`);

  // ── Facilities only (the Partner tier): the PNG counts the facilities inside ──
  await loadMaster(b, 'local-test-artifacts/f1/tiers/partner/partner_county_totals.csv');
  await sendFacilities(b, texts);
  await p.eval(`CVIWA.lookupState.testSetSites(${js(PNG_SITES())}); true`);
  await setValue(b, 'lk-default', 20);
  await click(b, 'lk-run');
  await sleep(800);
  const fo = await previewOnce(b);
  check(fo.title === 'FACILITY PROXIMITY ASSESSMENT - 3 SITES' && fo.keyItems.indexOf('FACILITY LOCATIONS') >= 0 &&
    !fo.keyItems.some(l => /^Matched/.test(l)), 'day4: a facilities-only run gets its own PNG, counting the facilities inside', fo);
  await b.send('Fetch.disable', {}, b.sid);
  // ms: from the click to the dialog (as the user waits); draw: the page's own time to draw (data loading included).
  return { timings: { streetsFirst: st1.ms, streets: st2.ms, standard: df.ms, high: hi.ms },
    draw: { streetsFirst: st1.drawMs, streets: st2.drawMs, standard: df.drawMs, high: hi.drawMs }, tiles: tileSeen.length };
}


// ── Part: the page ─────────────────────────────────────────────────────────────────────────────────────────────
async function partPage(b) {
  const p = b.page;
  const out = {};
  await openPage(b);
  await p.viewport(1400, 1000);

  // The switch.
  check(await shown(b, 'maps-side') && await shown(b, 'maps-main') && !(await shown(b, 'lookup-side')) &&
    !(await shown(b, 'lookup-main')) && await p.eval(`document.getElementById('show-maps').getAttribute('aria-pressed') === 'true'`),
  'page: the page opens on Maps, Premise Lookup hidden');
  await click(b, 'show-lookup');
  check(!(await shown(b, 'maps-side')) && !(await shown(b, 'maps-main')) && !(await shown(b, 'maps-view-block')) &&
    await shown(b, 'lookup-side') && await shown(b, 'lookup-main') && await shown(b, 'master-status') &&
    await p.eval(`document.getElementById('show-lookup').getAttribute('aria-pressed') === 'true' &&
      document.getElementById('show-maps').getAttribute('aria-pressed') === 'false'`),
  'page: Premise Lookup shows its sidebar and results, hides Map View, the Maps sections and the maps; Master dataset stays');
  check(await p.eval(`document.getElementById('lk-run').disabled && /Load a master dataset/.test(document.getElementById('lk-run-reason').textContent)
    && !document.getElementById('lk-run-reason').hidden`), 'page: Run query grayed without a master, with the reason');
  check(await p.eval(`document.getElementById('lk-empty').textContent`) ===
    'Run query is grayed: Load a master dataset (Master dataset, above) to run a query.',
  'page: without a master the result area says why Run query is grayed');
  check(!b.log.requests.some(u => /lookupmap\.js/.test(u)), 'page: the match map\'s file is not loaded before a result');

  // The Partner tier: no premises coordinates.
  await loadMaster(b, 'local-test-artifacts/f1/tiers/partner/partner_county_totals.csv');
  const partnerReason = await p.eval(`document.getElementById('lk-run-reason').textContent`);
  check(await p.eval(`document.getElementById('lk-run').disabled`) &&
    partnerReason === 'Needs the columns Origin.Lat, Origin.Long, Dest.Lat and Dest.Long in the CVI master table.' &&
    await p.eval(`document.getElementById('lk-empty').textContent`) === 'Run query is grayed: ' + partnerReason,
  'page: with the Partner tier Run query is grayed, naming the four columns, also in the result area', partnerReason);

  // The Full tier: filters filled, every year and species group ticked, the four quarters.
  await loadMaster(b, FULL);
  const filt = await p.eval(`(() => { const m = CVIWA.state.master, read = id => [...document.querySelectorAll('#' + id + ' input')];
    return { years: read('lk-years').map(c => c.value), yearsOn: read('lk-years').every(c => c.checked),
      species: read('lk-species').map(c => c.value), speciesOn: read('lk-species').every(c => c.checked),
      quarters: read('lk-quarters').map(c => c.value), quartersOn: read('lk-quarters').every(c => c.checked),
      wantYears: m.yearChoices.map(String), wantSpecies: m.speciesChoices, run: !document.getElementById('lk-run').disabled,
      reasonHidden: document.getElementById('lk-run-reason').hidden }; })()`);
  check(js(filt.years) === js(filt.wantYears) && filt.yearsOn && js(filt.species) === js(filt.wantSpecies) &&
    filt.speciesOn && js(filt.quarters) === js(['Q1', 'Q2', 'Q3', 'Q4']) && filt.quartersOn,
  'page: the filters list the master\'s years and species groups and the four quarters, all ticked (CVI)', filt);
  check(filt.run && filt.reasonHidden && await p.eval(`document.getElementById('lk-empty').textContent`) ===
    'Configure your sites and filters in the sidebar and click Run query to see results.',
  'page: with the Full tier Run query is on and the result area says what to do');
  await click(b, 'lk-years-clear');
  check(await shown(b, 'lk-years-none') && await p.eval(`CVIWA.lookupState.years.length === 0`),
    'page: Clear unticks every year and says none ticked means every year');
  await click(b, 'lk-years-all');
  check(!(await shown(b, 'lk-years-none')) && await p.eval(`CVIWA.lookupState.years.length === CVIWA.state.master.yearChoices.length`),
    'page: All ticks every year again');

  // Add a site.
  await click(b, 'lk-add');
  check(js(await lines(b, 'lk-add-msg')) === js([{ level: 'warn', text: 'Enter a latitude and longitude to add a site.' }]),
    'page: Add site without coordinates gives CVI\'s message');
  await setValue(b, 'lk-new-lat', 91); await setValue(b, 'lk-new-long', -120);
  await click(b, 'lk-add');
  check((await lines(b, 'lk-add-msg'))[0].text === 'Latitude must be -90 to 90 and longitude -180 to 180.' &&
    (await sitesState(b)).length === 0, 'page: Add site out of range gives CVI\'s message and adds nothing');
  await setValue(b, 'lk-new-lat', 46.6); await setValue(b, 'lk-new-long', -120.5);
  await click(b, 'lk-add');
  let t = await sitesShown(b);
  check((await lines(b, 'lk-add-msg'))[0].text === 'Added "Site 1".' && t.rows.length === 1 &&
    js(t.rows[0].slice(0, 5)) === js(['1', 'Site 1', '46.6', '-120.5', '']) && await p.eval(`['lk-new-name', 'lk-new-lat',
      'lk-new-long', 'lk-new-buffer'].every(id => document.getElementById(id).value === '')`),
  'page: an unnamed site becomes "Site 1", shown in the table, the form emptied', t.rows);
  await setValue(b, 'lk-new-name', 'Farm A'); await setValue(b, 'lk-new-lat', 47.1);
  await setValue(b, 'lk-new-long', -120.2); await setValue(b, 'lk-new-buffer', 2.5);
  await click(b, 'lk-add');
  t = await sitesShown(b);
  // The table ends with the Place column (its values have their own checks, part "day3").
  check(t.rows.length === 2 && js(t.rows[1].slice(0, 5)) === js(['2', 'Farm A', '47.1', '-120.2', '2.5']) &&
    js(t.head) === js(['', 'Site name', 'Lat', 'Long', 'Buffer (km, optional)', 'Place']),
  'page: a named site with its own buffer is the second row; Single mode shows the Buffer column', t);

  // Editing cells.
  check(await editCell(b, 0, 'name', 'Yakima Valley', 'Enter'), 'page: a double-click opens the cell for editing');
  check((await sitesState(b))[0].name === 'Yakima Valley' && (await sitesShown(b)).rows[0][1] === 'Yakima Valley',
    'page: Enter keeps the edit');
  await editCell(b, 0, 'lat', 'north', 'Enter');
  check((await sitesState(b))[0].lat === null && (await sitesShown(b)).rows[0][2] === '',
    'page: a latitude that is not a number becomes empty (CVI\'s as.numeric)');
  await editCell(b, 0, 'name', 'Not kept', 'Escape');
  check((await sitesState(b))[0].name === 'Yakima Valley', 'page: Escape drops the edit');
  await editCell(b, 0, 'lat', ' 46.6 ', 'Enter');
  const kb = await p.eval(`(() => { const td = document.querySelector('#lk-sites tbody tr td[data-field=buffer_km]');
    td.focus(); td.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    const input = td.querySelector('input'); if (!input) return null;
    input.value = '5'; input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    const again = document.querySelector('#lk-sites tbody tr td[data-field=buffer_km]');
    return { buffer: CVIWA.lookupState.sites[0].buffer_km, focused: document.activeElement === again }; })()`);
  check(kb && kb.buffer === 5 && kb.focused && (await sitesState(b))[0].lat === 46.6,
    'page: Enter on a focused cell edits it from the keyboard, and the cell keeps the focus', kb);

  // A real double-click (the browser's own mouse input, two clicks): the first click selects the row without
  // rebuilding it (Safari sends no double-click when the second click lands on a new cell),
  // the second unselects it, and the double-click opens the cell.
  const at = await p.eval(`(() => { const td = document.querySelectorAll('#lk-sites tbody tr')[0].querySelector('td[data-field=name]');
    td.scrollIntoView({ block: 'center' }); window.__s11Cell = td; const r = td.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  const press = async n => {
    await b.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: at.x, y: at.y, button: 'left', buttons: 1, clickCount: n }, b.sid);
    await b.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: at.x, y: at.y, button: 'left', buttons: 0, clickCount: n }, b.sid);
  };
  await press(1);
  const one = await p.eval(`({ same: document.contains(window.__s11Cell), selected: document.querySelectorAll('#lk-sites tbody tr.selected').length,
    focused: document.activeElement === window.__s11Cell })`);
  check(one.same && one.selected === 1 && one.focused,
    'page: a real click selects the row in place (the same cell stays, with the focus)', one);
  await press(2);
  await sleep(100);
  const two = await p.eval(`(() => { const td = window.__s11Cell, input = td.querySelector('input');
    const r = { same: document.contains(td), editing: !!input && document.activeElement === input,
      selected: document.querySelectorAll('#lk-sites tbody tr.selected').length };
    if (input) input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return r; })()`);
  check(two.same && two.editing && two.selected === 0 && (await sitesState(b))[0].name === 'Yakima Valley',
    'page: a real double-click opens the cell for editing and leaves the selection as it was', two);
  // Two single clicks (no double-click from the browser: a pause and a 3 px move between them, which Safari counts as
  // two clicks) still open the cell; two clicks further apart than the page's limit
  // only select and unselect.
  const single = async (dx, gap) => {
    await b.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: at.x, y: at.y, button: 'left', buttons: 1, clickCount: 1 }, b.sid);
    await b.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: at.x, y: at.y, button: 'left', buttons: 0, clickCount: 1 }, b.sid);
    await sleep(gap);
    await b.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: at.x + dx, y: at.y, button: 'left', buttons: 1, clickCount: 1 }, b.sid);
    await b.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: at.x + dx, y: at.y, button: 'left', buttons: 0, clickCount: 1 }, b.sid);
    await sleep(100);
    return p.eval(`(() => { const td = document.querySelectorAll('#lk-sites tbody tr')[0].querySelector('td[data-field=name]');
      const input = td.querySelector('input');
      const r = { editing: !!input && document.activeElement === input,
        selected: document.querySelectorAll('#lk-sites tbody tr.selected').length };
      if (input) input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return r; })()`);
  };
  const near2 = await single(3, 300);
  check(near2.editing && near2.selected === 0,
    'page: two single clicks on one cell 300 ms and 3 px apart open it for editing (Safari counts no double-click)', near2);
  const far2 = await single(0, 900);
  check(!far2.editing && far2.selected === 0, 'page: two clicks 900 ms apart only select and unselect the row', far2);

  // Selecting and removing.
  await p.eval(`document.querySelectorAll('#lk-sites tbody tr')[1].querySelector('td[data-field=name]').click(); true`);
  t = await sitesShown(b);
  check(t.selected === 1 && await p.eval(`document.querySelectorAll('#lk-sites tbody tr')[1].getAttribute('aria-selected') === 'true'`),
    'page: a click on a row selects it');
  await p.eval(`(() => { const td = document.querySelector('#lk-sites tbody tr td.row-no');
    td.focus(); td.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true })); return true; })()`);
  check((await sitesShown(b)).selected === 2, 'page: Space on a row number selects that row too');
  await p.eval(`(() => { const td = document.querySelector('#lk-sites tbody tr td.row-no');
    td.focus(); td.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true })); return true; })()`);
  check((await sitesShown(b)).selected === 1, 'page: Space again unselects it');
  await click(b, 'lk-remove');
  t = await sitesShown(b);
  check(t.rows.length === 1 && t.rows[0][1] === 'Yakima Valley' && t.selected === 0,
    'page: Remove selected deletes only the selected row', t.rows);
  await p.eval(`(() => { const td = document.querySelector('#lk-sites tbody tr td[data-field=name]');
    if (td) td.click(); return true; })()`);
  await click(b, 'lk-remove');
  check((await sitesState(b)).length === 0 && (await sitesShown(b)).rows[0][0] === 'No data available in table',
    'page: the last row removed, the table empty');
  await click(b, 'lk-remove');
  check((await sitesState(b)).length === 0, 'page: Remove selected with nothing selected does nothing');

  // Paste rows.
  await p.eval(`document.getElementById('lk-bulk').open = true; true`);
  await click(b, 'lk-paste-add');
  check(js(await lines(b, 'lk-bulk-msg')) === js([{ level: 'warn', text: 'Paste box is empty.' }]),
    'page: an empty paste box gives CVI\'s message');
  const three = FX.module.pastes.find(x => x.name === 'three sites').text;
  await setValue(b, 'lk-paste', three + '\nFarm X, abc, -120\nonly two, 47');
  await click(b, 'lk-paste-add');
  t = await sitesShown(b);
  check((await lines(b, 'lk-bulk-msg'))[0].text === 'Added 3 site(s). Skipped 2 unparseable line(s).' &&
    t.rows.length === 3 && t.rows[1][4] === '10' && t.rows[2][4] === '' &&
    await p.eval(`document.getElementById('lk-paste').value === ''`),
  'page: pasted rows added with CVI\'s message, the short line counted as skipped (a recorded difference); the box emptied', t.rows);
  await radio(b, 'lk-mode', 'bands');
  t = await sitesShown(b);
  check(t.head[4] === 'Bands (km, optional)' && t.rows[2][4] === '1,3,5' && t.rows[1][4] === '' &&
    await shown(b, 'lk-bands-block') && !(await shown(b, 'lk-single-block')),
  'page: Concentric bands shows the Bands column (the pasted 1, 3, 5) and the band radii box', t);
  await radio(b, 'lk-mode', 'single');

  // The pages of the sites table.
  const grid = FX.scenarios.find(x => x.name === 'grid_60_sites').sites.slice(0, 11);
  await setValue(b, 'lk-paste', grid.map(g => [g.name, g.lat, g.long].join(', ')).join('\n'));
  await click(b, 'lk-paste-add');
  t = await sitesShown(b);
  check(t.rows.length === 8 && t.info === 'Showing 1 to 8 of 14 entries', 'page: the sites table shows 8 rows a page', t.info);
  await p.eval(`[...document.querySelectorAll('#lk-sites .dt-page')].find(x => x.textContent === 'Next').click(); true`);
  t = await sitesShown(b);
  check(t.rows.length === 6 && t.info === 'Showing 9 to 14 of 14 entries' && t.rows[0][0] === '9',
    'page: Next shows the second page, numbered on', t.info);
  await click(b, 'lk-clear');
  t = await sitesShown(b);
  check(t.rows.length === 1 && t.info === 'Showing 0 to 0 of 0 entries', 'page: Clear all empties the table', t);

  // Upload CSV.
  const up = name => path.join(ROOT, FX.module.uploads.find(x => x.name === name).file);
  await p.setFiles('#lk-upload', [up('good')]);
  await p.waitFor(`CVIWA.lookupState.sites.length === 3`, 5000, 'upload read');
  t = await sitesShown(b);
  check((await lines(b, 'lk-bulk-msg'))[0].text === 'Loaded 3 site(s) from CSV.' && t.rows.length === 3 &&
    t.rows[1][1] === 'Farm, with comma', 'page: Upload CSV adds the file\'s sites with CVI\'s message', t.rows);
  await p.setFiles('#lk-upload', [up('no long')]);
  await p.waitFor(`/must include/.test(document.getElementById('lk-bulk-msg').textContent)`, 5000, 'upload refused');
  check((await lines(b, 'lk-bulk-msg'))[0].level === 'err' && (await sitesState(b)).length === 3,
    'page: a file without a longitude column is refused with CVI\'s message, the table unchanged');
  await p.setFiles('#lk-upload', [up('good')]);
  await p.waitFor(`(CVIWA.lookupState.sites.length === 6)`, 5000, 'same file again');
  check(true, 'page: the same file can be chosen again');
  // A pick that sends no event (Safari sometimes showed nothing after a pick): the
  // picker is clicked, then holds a file with no "input" or "change" event; the page still reads it, once.
  const quietPick = (id, name, text) => p.eval(`(() => { const input = document.getElementById(${js(id)});
    input.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const dt = new DataTransfer(); dt.items.add(new File([${js(text)}], ${js(name)}, { type: 'text/csv' }));
    input.files = dt.files; return input.files.length; })()`);
  check(await quietPick('lk-upload', 'good.csv', fs.readFileSync(up('good'), 'utf8')) === 1, 'page: a quiet pick placed in Upload CSV');
  await p.waitFor(`(CVIWA.lookupState.sites.length === 9)`, 5000, 'quiet upload pick');
  await sleep(1200);
  const quietUp = await p.eval(`({ n: CVIWA.lookupState.sites.length, left: document.getElementById('lk-upload').files.length })`);
  check(quietUp.n === 9 && quietUp.left === 0,
    'page: Upload CSV reads a pick that sent no event, once, and empties the picker', quietUp);
  // A pick that sends only "input" (no click before it, no "change"): read too.
  await p.eval(`(() => { const input = document.getElementById('lk-upload');
    const dt = new DataTransfer(); dt.items.add(new File([${js(fs.readFileSync(up('good'), 'utf8'))}], 'good.csv', { type: 'text/csv' }));
    input.files = dt.files; input.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await p.waitFor(`(CVIWA.lookupState.sites.length === 12)`, 5000, 'input-only pick');
  check(await p.eval(`document.getElementById('lk-upload').files.length === 0`),
    'page: Upload CSV reads a pick that sent only an "input" event');
  const masterName = path.basename(FULL);
  check(await quietPick('file-input', masterName, fs.readFileSync(path.join(ROOT, FULL), 'utf8')) === 1,
    'page: a quiet pick placed in Master dataset');
  await p.waitFor(`document.getElementById('master-status').textContent.indexOf(${js('Master loaded (')} + ${js(masterName)} + ')') === 0`, 10000, 'quiet master pick');
  await sleep(1200);
  const quietMaster = await p.eval(`({ loading: CVIWA.state.loading, left: document.getElementById('file-input').files.length,
    run: !document.getElementById('lk-run').disabled })`);
  check(!quietMaster.loading && quietMaster.left === 0 && quietMaster.run,
    'page: Master dataset reads a pick that sent no event and empties the picker; Run query is blue again', quietMaster);
  await click(b, 'lk-clear');

  // The template, downloaded.
  const dl = path.join(OUT, 'downloads');
  fs.rmSync(dl, { recursive: true, force: true });
  fs.mkdirSync(dl, { recursive: true });
  await b.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dl, eventsEnabled: true });
  await click(b, 'lk-template');
  const tf = path.join(dl, 'premise_lookup_template.csv');
  for (let i = 0; i < 50 && !fs.existsSync(tf); i++) await sleep(100);
  const tpl = fs.existsSync(tf) ? fs.readFileSync(tf, 'utf8') : null;
  check(tpl === '"name","lat","long","buffer_km"\n"Affected Farm A",46.5,-120.5,3\n"Affected Farm B",47,-120,NA\n',
    'page: Download CSV template saves CVI\'s template file', tpl);

  // CVI's Run query cases, set up through the sidebar.
  let master = FULL, mapSeen = false, runLinesChecked = 0;
  out.runs = [];
  for (let i = 0; i < FX.module.runs.length; i++) {
    const cs = FX.module.runs[i], cvi = REF.module.runs[i], name = 'run "' + cs.name + '"';
    if (cs.master !== master) { await loadMaster(b, cs.master); master = cs.master; }
    if (cs.name === 'missing coordinate columns') {
      check(await p.eval(`document.getElementById('lk-run').disabled`),
        'page: ' + name + ': Run query grayed (a recorded difference; CVI runs and says the columns are missing)');
      continue;
    }
    await radio(b, 'lk-mode', cs.mode);
    await setValue(b, 'lk-default', cs.default_buffer_km);
    await setValue(b, 'lk-bands', cs.band_radii);
    await radio(b, 'lk-endpoint', cs.endpoint);
    const how = [await setChecks(b, 'years', cs.years), await setChecks(b, 'quarters', cs.quarters),
      await setChecks(b, 'species', cs.species)];
    if (how.indexOf('set directly') >= 0) out.runs.setDirectly = (out.runs.setDirectly || []).concat([cs.name]);
    await p.eval(`CVIWA.lookupState.testSetSites(${js(cs.sites.map(x => ({ name: x.name,
      lat: x.lat === null || x.lat === undefined ? null : Number(x.lat), long: x.long === null ? null : Number(x.long),
      buffer_km: x.buffer_km === undefined ? null : x.buffer_km, bands_csv: x.bands_csv === undefined ? null : x.bands_csv })))}); true`);
    const before = await p.eval(`CVIWA.lookupState.result`) !== null;
    const t0 = Date.now();
    await click(b, 'lk-run');
    const ms = Date.now() - t0;
    const msgs = await lines(b, 'lk-run-lines');
    // Only in the result area: nothing with a line under Run query, the box above the
    // five boxes, hidden when empty, and read out by screen readers.
    const main = await p.eval(`(() => { const box = document.getElementById('lk-run-lines'), run = document.getElementById('lk-run'),
      tiles = document.getElementById('lk-tiles');
      const after = [...run.parentElement.children].slice([...run.parentElement.children].indexOf(run) + 1);
      return { hidden: box.hidden, above: !!(box.compareDocumentPosition(tiles) & Node.DOCUMENT_POSITION_FOLLOWING),
        live: box.getAttribute('role') === 'status' && box.getAttribute('aria-live') === 'polite',
        inMain: !!box.closest('main'), sidebarLines: after.reduce((n, e) => n + e.querySelectorAll('.status').length + (e.matches('.status') ? 1 : 0), 0),
        oldBox: !!document.getElementById('lk-messages') }; })()`);
    check(main.hidden === (msgs.length === 0) && main.above && main.live && main.inMain && !main.oldBox &&
      (msgs.length === 0 || main.sidebarLines === 0),
      'page: ' + name + ': the run\'s lines show only at the top of the result area, above the five boxes', { main, msgs });
    runLinesChecked++;
    const res = await p.eval(`(() => { const r = CVIWA.lookupState.result; return { shown: !document.getElementById('lk-results').hidden,
      result: !!r, tiles: [...document.querySelectorAll('#lk-tiles .metric-value')].map(e => e.textContent),
      info: (document.querySelector('#lk-table .dt-info') || {}).textContent || '',
      note: (document.querySelector('#lk-table td') || {}).textContent || '' }; })()`);
    out.runs.push({ name: cs.name, ms, messages: msgs.length });
    if (cs.name === 'empty default buffer') {
      check(js(msgs) === js([{ level: 'warn', text: 'Enter a default buffer (km).' }]),
        'page: ' + name + ': the run stops and asks for the default buffer (a recorded difference)', msgs);
      continue;
    }
    check(sameNotes(msgs, cvi.notes), 'page: ' + name + ': the run\'s lines are CVI\'s, in order',
      [msgs, cvi.notes]);
    if (!cvi.result) {
      // CVI stores no result: "No CVIs match the current filters" clears the one shown; every other early stop
      // leaves it (CVI's returns before query_result changes).
      const clears = cvi.notes.some(n => n.text === 'No CVIs match the current filters.');
      check(clears ? !res.shown && !res.result : res.result === before,
        'page: ' + name + ': ' + (clears ? 'the result cleared, as CVI' : 'the result shown before kept, as CVI'),
        [res, before]);
      continue;
    }
    const sm = cvi.result.summary;
    const want = [];
    for (const x of [sm.n_cvis, sm.n_animals, sm.n_origins, sm.n_dests, sm.n_sites_hit]) want.push(await formatR(b, x));
    if (cs.name === 'repeated rows') {
      check(res.shown && res.tiles[0] === want[0] && res.tiles[1] !== want[1] && res.tiles.slice(2).join() === want.slice(2).join(),
        'page: ' + name + ': the tiles as CVI\'s but Total animals (N17 counts the repeated rows)', [res.tiles, want]);
      continue;
    }
    check(res.shown && js(res.tiles) === js(want), 'page: ' + name + ': the five tiles show CVI\'s counts', [res.tiles, want]);
    if (cs.name === 'single, three sites') {
      const icons = await p.eval(`[...document.querySelectorAll('#lk-tiles .metric-icon')].map(e => (e.querySelector('svg') || {}).className ?
        e.querySelector('svg').getAttribute('class').trim() : '')`);
      check(js(icons) === js(['bi bi-file-earmark-medical', 'bi bi-stack', 'bi bi-geo', 'bi bi-geo-alt-fill', 'bi bi-crosshair']),
        'page: the tiles carry CVI\'s five icons (from icons.js)', icons);
    }
    const rows = cvi.result.matched;
    check(rows ? new RegExp('of ' + rows.toLocaleString('en-US') + ' entries$').test(res.info) : res.note === 'No matches.',
      'page: ' + name + ': the table holds CVI\'s ' + rows + ' matched rows', res);
    if (!mapSeen && rows) {
      mapSeen = true;
      await p.waitFor(`CVIWA.lookupState.map && CVIWA.lookupState.map.ready && CVIWA.lookupState.map.drawn`, 15000, 'match map');
      check(b.log.requests.some(u => /lookupmap\.js/.test(u)), 'page: the match map\'s file is loaded at the first result');
      // The ring colors, read from the page and from the drawn map.
      const rings = await p.eval(`(() => { const m = CVIWA.lookupState.map.map; return { colors: CVIWA.lookup.BAND_COLORS.slice(),
        fill: m.getPaintProperty('lookup_band_fill', 'fill-opacity'), line: m.getPaintProperty('lookup_band_line', 'line-width') }; })()`);
      check(js(rings) === js({ colors: ['#fcb614', '#8fc965', '#a7d7e2'], fill: 0.35, line: 2 }),
        'page: the rings in their colors (Gold, light green, Light Blue inward to outward; fill 0.35, outline 2 px)', rings);
    }
    if (mapSeen && rows) {
      const drawn = await p.eval(`(() => { const m = CVIWA.lookupState.map, d = CVIWA.lookup.mapData(CVIWA.lookupState.result);
        return { drawn: m.drawn, want: { bands: d.bands.length, origins: d.origins.length, dests: d.dests.length,
          sites: d.sites.length, facilities: d.facilities.length } }; })()`);
      const view = await p.eval(UNDER_BUTTONS);
      drawn.view = view;
      check(js(drawn.drawn) === js(drawn.want) && drawn.want.sites === cvi.result.sites.length &&
        view.inside === view.sites && !view.under.length && view.boxes >= 2,
        'page: ' + name + ': the map draws every band, matched endpoint and site, every site in view and clear of ' +
        'the map\'s buttons', drawn);
    }
  }
  check(runLinesChecked === FX.module.runs.length - 1, 'page: the place of the run\'s lines checked in every run case',
    runLinesChecked);

  // The match map: hover and click on a site.
  await loadMaster(b, FULL);
  const A = FX.module.runs.find(x => x.name === 'single, three sites');
  await radio(b, 'lk-mode', 'single'); await setValue(b, 'lk-default', 3); await radio(b, 'lk-endpoint', 'either');
  for (const k of ['years', 'quarters', 'species']) await click(b, 'lk-' + k + '-all');
  check(!(await shown(b, 'lk-results')) && await p.eval(`document.getElementById('lk-empty').textContent`) ===
    'Configure your sites and filters in the sidebar and click Run query to see results.',
  'page: a new master clears the result on screen (a recorded difference)');
  await p.eval(`CVIWA.lookupState.testSetSites(${js(A.sites)}); true`);
  await click(b, 'lk-run');
  await p.waitFor(`CVIWA.lookupState.map.drawn && CVIWA.lookupState.map.drawn.sites === 3`, 5000, 'drawn again');
  await sleep(400);
  const pt = await p.eval(`(() => { const m = CVIWA.lookupState.map, s = CVIWA.lookupState.result.sites[2];
    const xy = m.map.project([s.lon, s.lat]), r = m.map.getContainer().getBoundingClientRect();
    return { x: r.left + xy.x, y: r.top + xy.y, name: s.name }; })()`);
  await p.eval(`document.getElementById('lookup-map').scrollIntoView({ block: 'center' }); true`);
  await sleep(300);
  const pt2 = await p.eval(`(() => { const m = CVIWA.lookupState.map, s = CVIWA.lookupState.result.sites[2];
    const xy = m.map.project([s.lon, s.lat]), r = m.map.getContainer().getBoundingClientRect();
    return { x: r.left + xy.x, y: r.top + xy.y }; })()`);
  await b.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pt2.x, y: pt2.y }, b.sid);
  await sleep(300);
  const hover = await p.eval(`({ label: CVIWA.lookupState.map.hoverLabel,
    tip: (document.querySelector('#lookup-map .maplibregl-popup-content') || {}).textContent || '' })`);
  check(hover.label === pt.name && hover.tip === pt.name, 'page: hovering a site shows its name (CVI\'s tooltip)', hover);
  await b.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pt2.x, y: pt2.y, button: 'left', clickCount: 1 }, b.sid);
  await b.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pt2.x, y: pt2.y, button: 'left', clickCount: 1 }, b.sid);
  await sleep(300);
  check(await p.eval(`CVIWA.lookupState.map.clickedSite`) === pt.name, 'page: a click on a site opens its name (CVI\'s popup)');

  // County names never cover a site or a matched point: each name box shown, against each point's circle, measured
  // from the page itself.
  const cover = await p.eval(`(() => { const m = CVIWA.lookupState.map, map = m.map, r = map.getContainer().getBoundingClientRect();
    const d = CVIWA.lookup.mapData(CVIWA.lookupState.result);
    const pts = [].concat(d.sites.map(s => [s.lon, s.lat, 8]), d.origins.map(s => [s.lon, s.lat, 5]), d.dests.map(s => [s.lon, s.lat, 5]))
      .map(q => { const xy = map.project([q[0], q[1]]); return { x: r.left + xy.x, y: r.top + xy.y, r: q[2] }; });
    const names = m.labels.map(k => k.getElement()).filter(e => !e.classList.contains('covered') && e.offsetWidth)
      .map(e => e.getBoundingClientRect());
    const hits = names.filter(b => pts.some(q => q.x + q.r > b.left && q.x - q.r < b.right && q.y + q.r > b.top && q.y - q.r < b.bottom));
    return { shown: names.length, hidden: m.namesHidden, hits: hits.length }; })()`);
  check(cover.hits === 0 && cover.hidden > 0 && cover.shown > 0,
    'page: no county name shown covers a site or a matched point (' + cover.hidden + ' hidden, ' + cover.shown + ' shown)', cover);

  // The matched-CVI table: sorted by CVI, ten a page, the search.
  const tb = await p.eval(`(() => { const rows = [...document.querySelectorAll('#lk-table tbody tr')].map(tr => tr.children[0].textContent);
    const head = [...document.querySelectorAll('#lk-table thead th')].map(th => th.textContent);
    const all = CVIWA.lookup.table(CVIWA.lookupState.result).rows.map(r => String(r[0])).sort((a, b) => a.localeCompare(b, 'en'));
    return { rows, head, first: all.slice(0, 10), info: document.querySelector('#lk-table .dt-info').textContent,
      sorted: document.querySelector('#lk-table thead th').getAttribute('aria-sort') }; })()`);
  check(js(tb.head) === js(['CVI', 'Reporting.Year', 'Reporting.Quarter', 'Movement', 'Species.Group', 'Species',
    'Total.Animals', 'Origin.City', 'Origin.State', 'Origin.County', 'Dest.City', 'Dest.State', 'Dest.County',
    'matched_sites', 'nearest_site_km']), 'page: the matched-CVI table has CVI\'s columns', tb.head);
  check(tb.rows.length === Math.min(10, tb.first.length) && js(tb.rows) === js(tb.first) && tb.sorted === 'ascending',
    'page: the table opens sorted by CVI, ten rows a page (DT\'s default)', tb);
  const word = await p.eval(`String(CVIWA.lookupState.result.matched[0]['Origin.County'] || CVIWA.lookupState.result.matched[0].CVI)`);
  await p.eval(`(() => { const s = document.querySelector('#lk-table .dt-search'); s.value = ${js(word)};
    s.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  const searched = await p.eval(`document.querySelector('#lk-table .dt-info').textContent`);
  check(/\(filtered from \d+ total entries\)$/.test(searched) || /of \d+ entries$/.test(searched),
    'page: the search box filters the table', searched);

  // A tall window (the map wider than it is tall in degrees): the sites still clear of the buttons. Farm A, far west,
  // and the Yakima Valley with its bands.
  await radio(b, 'lk-mode', 'bands');
  await p.eval(`CVIWA.lookupState.testSetSites(${js(FX.module.runs.find(x => x.name === 'bands, site override').sites)}); true`);
  await click(b, 'lk-run');
  await p.viewport(1400, 1300);
  await p.eval(`new Promise(res => { const m = CVIWA.lookupState.map; m.map.resize(); CVIWA.lookupmap.fit(m);
    m.map.once('idle', () => res(true)); m.map.triggerRepaint(); })`);
  const tall = await p.eval(UNDER_BUTTONS);
  check(tall.inside === tall.sites && tall.sites === 2 && !tall.under.length,
    'page: in a tall window every site is in view and clear of the map\'s buttons', tall);
  await p.viewport(1400, 1000);
  await radio(b, 'lk-mode', 'single');

  // A run whose filters match no row clears the result on screen (CVI's query_result(NULL)).
  await p.eval(`CVIWA.lookupState.testSetSites(${js(A.sites)}); true`);
  await click(b, 'lk-run');
  const had = await p.eval(`CVIWA.lookupState.result !== null && !document.getElementById('lk-results').hidden`);
  await p.eval(`CVIWA.lookupState.years = [1990]; true`);
  await click(b, 'lk-run');
  check(had && await p.eval(`CVIWA.lookupState.result === null && document.getElementById('lk-results').hidden`) &&
    (await lines(b, 'lk-run-lines'))[0].text === 'No CVIs match the current filters.',
  'page: a run matching no rows (a year not in the master, set in the page\'s state) clears the result shown');
  await click(b, 'lk-years-all');

  // Back to Maps: as it was.
  await p.eval(`CVIWA.state.view === 'wa'`);
  await click(b, 'show-maps');
  await sleep(300);
  check(await shown(b, 'maps-main') && await shown(b, 'maps-side') && !(await shown(b, 'lookup-side')) &&
    await p.eval(`CVIWA.state.mapHandle.map.getCanvas().clientWidth > 300 && CVIWA.state.data.length > 0`),
  'page: back on Maps, the WA State map and its sidebar are shown and drawn');
  return out;
}


// ── Part day5: "Find coordinates" offline, in a geocode cache file the user loads ───────────────────────────────
// Expected values come from CVI's own module (the R reference ran geocode_find on the same cases with its network
// steps stubbed): the coordinates put in the boxes and the text on a hit, CVI's text for an empty box; where CVI
// found nothing and would have gone online, the page's two offline messages (a recorded difference).
async function partDay5(b) {
  const p = b.page, G = FX.geocode, CG = REF.module.geocode;
  const GDIR = path.join(ROOT, G.dir);
  await openPage(b);
  await click(b, 'show-lookup');
  const row = await p.eval(`(() => { const a = document.getElementById('lk-new-address').getBoundingClientRect(),
    f = document.getElementById('lk-geo-find').getBoundingClientRect();
    return { a: [a.left, a.right, a.top, a.bottom], f: [f.left, f.right, f.top, f.bottom] }; })()`);
  check(await shown(b, 'lk-new-address') && await shown(b, 'lk-geo-find') && await shown(b, 'lk-geo-file') &&
    row.f[0] >= row.a[1] && Math.abs(row.f[2] - row.a[2]) < 4 && Math.abs(row.f[3] - row.a[3]) < 4,
  'day5: the address box with Find coordinates beside it on one row, and the cache file picker', row);
  const find = async address => {
    await setValue(b, 'lk-new-lat', '');
    await setValue(b, 'lk-new-long', '');
    await setValue(b, 'lk-new-address', address);
    await click(b, 'lk-geo-find');
    return { msg: await lines(b, 'lk-geo-msg'), lat: await p.eval(`document.getElementById('lk-new-lat').value`),
      long: await p.eval(`document.getElementById('lk-new-long').value`) };
  };
  const NO_FILE = 'Load a geocode cache file to look up addresses, or enter lat/long manually.';
  const NO_MATCH = 'No match for that address in the geocode cache file. Enter lat/long manually.';
  let r = await find('123 Main St, Yakima, WA 98901');
  check(js(r.msg) === js([{ level: 'warn', text: NO_FILE }]) && r.lat === '' && r.long === '',
    'day5: without a cache file, Find coordinates asks for one (nothing looked up online)', r);
  r = await find('   ');
  check(js(r.msg) === js([{ level: 'warn', text: 'Enter a street address first.' }]), 'day5: an empty box: CVI\'s message', r);

  const pick = async f => {
    await p.eval(`(() => { const m = document.getElementById('lk-geo-msg'); m.replaceChildren(); m.hidden = true; return true; })()`);
    await p.setFiles('#lk-geo-file', [path.join(GDIR, f)]);
    // A "Reading …" line shows first; the answer is the line after it.
    await p.waitFor(`[...document.querySelectorAll('#lk-geo-msg .status')].some(e => !/^Reading /.test(e.textContent))`, 10000,
      'cache message ' + f);
    return lines(b, 'lk-geo-msg');
  };
  let msg = await pick('cache_wrong_cols.csv');
  check(js(msg) === js([{ level: 'err', text: 'cache_wrong_cols.csv is not a geocode cache: it needs the columns address, lat and long.' }]),
    'day5: a file without CVI\'s column names is refused with its reason', msg);
  r = await find('123 Main St, Yakima, WA 98901');
  check(r.msg[0] && r.msg[0].text === NO_FILE, 'day5: a refused file is not used', r);
  msg = await pick('cache_main.csv');
  check(js(msg) === js([{ level: 'ok', text: 'Loaded 11 address(es) from cache_main.csv. 4 without an address or usable ' +
    'coordinates will be passed over.' }]), 'day5: the cache file loaded, its rows and those passed over counted', msg);

  let hits = 0;
  for (let i = 0; i < G.cases.length; i++) {
    const cs = G.cases[i], cvi = CG[i];
    if (cs.cache !== 'cache_main.csv') continue;
    r = await find(cs.address);
    const label = 'day5: "' + cs.address + '"';
    if (cvi.level === 'success') {
      hits++;
      check(js(r.msg) === js([{ level: 'ok', text: cvi.text }]) && Number(r.lat) === cvi.lat && Number(r.long) === cvi.long &&
        r.lat !== '' && r.long !== '', label + ': CVI\'s coordinates in the boxes and CVI\'s text', { page: r, cvi });
    } else if (cvi.online) {
      check(js(r.msg) === js([{ level: 'warn', text: NO_MATCH }]) && r.lat === '' && r.long === '',
        label + ': not in the file: the offline message, the boxes left empty (CVI would have gone online)', r);
    } else {
      check(js(r.msg) === js([{ level: 'warn', text: cvi.text }]), label + ': CVI\'s message', { page: r, cvi });
    }
  }
  check(hits >= 6, 'day5: the cases include hits', hits);

  msg = await pick('cache_empty.csv');
  check(js(msg) === js([{ level: 'err', text: 'cache_empty.csv is empty or unreadable. cache_main.csv stays in use.' }]),
    'day5: an empty file is refused and the file before stays in use', msg);
  r = await find('1 Precise Pl, Spokane, WA');
  const precise = CG.find(g => g.address === '1 Precise Pl, Spokane, WA' && g.cache === 'cache_main.csv');
  check(Number(r.lat) === precise.lat && Number(r.long) === precise.long, 'day5: the file before still answers', r);

  // Add site after a hit: the site has the found coordinates; the address box and its message are cleared (CVI).
  await click(b, 'lk-clear');
  await setValue(b, 'lk-new-name', 'Found by address');
  await click(b, 'lk-add');
  const sites = await sitesState(b);
  const after = { address: await p.eval(`document.getElementById('lk-new-address').value`), msg: await lines(b, 'lk-geo-msg'),
    add: await lines(b, 'lk-add-msg') };
  check(sites.length === 1 && sites[0].name === 'Found by address' && sites[0].lat === precise.lat &&
    sites[0].long === precise.long && after.address === '' && !after.msg.length &&
    js(after.add) === js([{ level: 'ok', text: 'Added "Found by address".' }]),
  'day5: Add site uses the found coordinates and clears the address and its message, as CVI', { sites, after });

  // ── Typed boxes, large cache files and export_params.json ──
  // Spell check and autocomplete off on the typed boxes and the cell editor.
  const spell = await p.eval(`(() => { const o = {};
    ['lk-new-address', 'lk-new-name', 'lk-paste'].forEach(id => { const e = document.getElementById(id);
      o[id] = [e.spellcheck, e.getAttribute('autocomplete')]; });
    const td = document.querySelector('#lk-sites tbody tr td[data-field=name]');
    td.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    const ed = td.querySelector('input');
    o.editor = ed ? [ed.spellcheck, ed.autocomplete] : null;
    if (ed) ed.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return o; })()`);
  check(['lk-new-address', 'lk-new-name', 'lk-paste'].every(id => spell[id][0] === false && spell[id][1] === 'off') &&
    js(spell.editor) === js([false, 'off']), 'day5: spell check and autocomplete off on the typed boxes and the cell editor', spell);
  // A file over 32 MB refused before it is read, the file before kept; Find during a read says so; of two quick
  // picks the later one is used.
  const bigPick = (mb, rows, findToo) => p.eval(`(() => { const head = 'address,lat,long\\n', line = '"Bulk ' + 'x'.repeat(40) + '",47,-120\\n';
    const parts = [head]; let size = head.length;
    while (size < ${mb} * 1048576) { parts.push(line); size += line.length; }
    parts.push(${js(rows)});
    const dt = new DataTransfer(); dt.items.add(new File(parts, 'bulk.csv', { type: 'text/csv' }));
    const input = document.getElementById('lk-geo-file'); input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    if (${js(!!findToo)}) {
      document.getElementById('lk-new-address').value = 'Bulk';
      document.getElementById('lk-geo-find').click();
    }
    return [...document.querySelectorAll('#lk-geo-msg .status')].map(e => e.textContent); })()`);
  let lines7 = await bigPick(33, '', false);
  check(lines7.length === 1 && /^bulk\.csv is 33\.0 MB; the page reads geocode cache files up to 32 MB\. cache_main\.csv stays in use\.$/.test(lines7[0]),
    'day5: a cache file over 32 MB refused before it is read, the file before kept', lines7);
  lines7 = await bigPick(30, '"Only In Bulk",46.5,-121\n', true);
  const reading = lines7.slice();
  await p.waitFor(`/^Loaded /.test((document.querySelector('#lk-geo-msg .status') || {}).textContent || '')`, 30000, 'bulk loaded');
  check(js(reading) === js(['Still reading bulk.csv; try again in a moment.']), 'day5: Find during a read says the file is still being read',
    reading);
  r = await find('Only In Bulk');
  check(r.lat === '46.5' && r.long === '-121', 'day5: the large file is used once read', r);
  await p.eval(`(() => { const pick = (name, text) => { const dt = new DataTransfer(); dt.items.add(new File([text], name, { type: 'text/csv' }));
      const input = document.getElementById('lk-geo-file'); input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true })); };
    pick('first.csv', 'address,lat,long\\n' + '"Bulk",47,-120\\n'.repeat(400000) + '"Which",45,-118\\n');
    pick('second.csv', 'address,lat,long\\n"Which",46,-119\\n');
    return true; })()`);
  await p.waitFor(`/^Loaded 1 address\\(es\\) from second\\.csv/.test((document.querySelector('#lk-geo-msg .status') || {}).textContent || '')`,
    30000, 'second pick');
  await sleep(1500);   // time for the first file's read to end too
  r = await find('Which');
  check(r.lat === '46' && r.long === '-119' && /second\.csv/.test(await p.eval(`CVIWA.lookupState.geocacheName`)),
    'day5: of two quick picks, the later one is used', r);
  // export_params.json describes the sites as run, also after a site's bands are edited.
  await loadMaster(b, FULL);
  await radio(b, 'lk-mode', 'bands');
  await setValue(b, 'lk-bands', '3, 10, 20');
  await p.eval(`CVIWA.lookupState.testSetSites(${js([{ name: 'Banded', lat: 46.6, long: -120.5, bands_csv: '1, 3, 5' },
    { name: 'Banded', lat: 46.6, long: -120.5, bands_csv: '2, 4' }])}); true`);
  await click(b, 'lk-run');
  await p.waitFor(`CVIWA.lookupState.result && !document.getElementById('lk-export-card').hidden`, 15000, 'bands run');
  check(await editCell(b, 0, 'bands_csv', '7, 8, 9', 'Enter'), 'day5: a band cell edited after the run');
  await p.eval(`document.querySelectorAll('input[name=lk-format]').forEach(c => { c.checked = c.value === 'matches_csv'; }); true`);
  await p.eval(`CVIWA.lookupState.lastExport = null; true`);
  await click(b, 'lk-export');
  await p.waitFor(`CVIWA.lookupState.lastExport`, 15000, 'export');
  const params = JSON.parse(await p.eval(`CVIWA.lookupState.lastExport.files.find(f => f.name === 'export_params.json').text`));
  check(js([].concat(params.sites)) === js(['Banded (46.6, -120.5; bands 1, 3, 5 km)', 'Banded (46.6, -120.5; bands 2, 4 km)']),
    'day5: export_params.json names the bands as run, each row its own, after an edit', params.sites);
  return { hits };
}

// ── Run ────────────────────────────────────────────────────────────────────────────────────────────────────────
(async () => {
  const b = await launch();
  const run = { chrome: b.version, page: PAGE, parts: PARTS, started: new Date().toISOString(), results: {} };
  try {
    for (const part of PARTS) {
      if (part === 'page') run.results.page = await partPage(b);
      else if (part === 'day3') run.results.day3 = await partDay3(b);
      else if (part === 'day4') run.results.day4 = await partDay4(b);
      else if (part === 'day5') run.results.day5 = await partDay5(b);
      else throw new Error('Unknown part ' + part);
    }
  } catch (e) {
    failed++;
    failures.push('run stopped: ' + (e && e.stack ? e.stack : e));
  } finally {
    check(!b.log.exceptions.length, 'page: no exceptions', b.log.exceptions);
    check(!b.log.csp.length, 'page: no Content Security Policy reports', b.log.csp);
    // Requests the suite answered itself (part day4's tile backgrounds) are not counted.
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
  console.log('S11 browser (' + PARTS.join(', ') + '): ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch(e => {
  console.error(e);
  process.exit(1);
});
