#!/usr/bin/env node
'use strict';
// Emergency Response through installed Chrome (headless, a throw-away profile, offline; no packages). Foreground only.
// Parts (named as arguments; none named runs every part):
//   load   the landing page and the Emergency page: a folder bundle with a GeoJSON zone found on the landing page and
//          sent to the Emergency tab; a loose positives file goes to Emergency, not to Infrastructure; the
//          Emergency sample loaded on the page itself and its download byte-identical to the Node copy
//   page   the page with the sample: what the map draws, the value boxes, every fold closed after the load, the type
//          picker in its fold's header, the type's "?" and its links, the zone file switch, a ring distance, the
//          density limits (at most six visible controls outside folds; at most one sentence of at most 25 words per
//          section), at 1280 and 320 pixels wide; pictures in local-test-artifacts/em/page/
//   results  the tabs: "Inside the zones" (a fold per layer, the "nearest" line, the left-out fold, "include
//          roughly"), the boxes without the optional columns, the CVI movements without a master and with one (its
//          year filter), the Export ZIP's files and export_params.json, and the marked addresses found in no page
//          text, map label or exported file
// Every part: no exception, no policy report, no request outside the site.
// Hosted mode: EM_PAGE_URL=http://127.0.0.1:8765/index.html (the case-strict server, tests/browser/serve_case_strict.js).
// Needs: node tests/synthetic/make_em_fixtures.js (also run by the Emergency unit suite).
// Writes local-test-artifacts/em/browser_<file|http>.json.
// The Chrome harness (launch) is copied from tests/browser/run_s6_browser.js, written out one step per line.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join(ROOT, 'local-test-artifacts', 'em');
const TABLES = path.join(ROOT, 'test-tables');
const PAGE = process.env.EM_PAGE_URL || pathToFileURL(path.join(ROOT, 'site', 'index.html')).href;
const SITE = new URL('.', PAGE).href;
const CHROME = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ALL_PARTS = ['load', 'page', 'results'];
const asked = process.argv.slice(2).filter(a => !a.startsWith('--'));
const PARTS = asked.length ? asked : ALL_PARTS;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function launch() {
  fs.mkdirSync(OUT, { recursive: true });
  // Profiles left by an earlier run that was stopped before its clean-up.
  for (const d of fs.readdirSync(OUT)) {
    if (d.startsWith('chrome-profile-')) fs.rmSync(path.join(OUT, d), { recursive: true, force: true });
  }
  const profile = fs.mkdtempSync(path.join(OUT, 'chrome-profile-'));
  const proc = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + profile, '--no-first-run',
    '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', '--disable-component-update',
    '--disable-sync', '--window-size=1280,900', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'], detached: true });
  // Chrome leads its own process group: closing ends the whole group, also when this script stops early.
  const killGroup = () => {
    try { process.kill(-proc.pid, 'SIGKILL'); } catch (e) { /* gone */ }
  };
  const exited = ms => proc.exitCode !== null || proc.signalCode !== null ? Promise.resolve()
    : new Promise(res => {
      const t = setTimeout(res, ms);
      proc.once('exit', () => { clearTimeout(t); res(); });
    });
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
    throw new Error('Chrome did not start (set CHROME_BIN)');
  }
  const ver = await (await fetch('http://127.0.0.1:' + port + '/json/version')).json();
  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const pending = new Map(), listeners = [];
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) p.rej(new Error(m.error.message));
      else p.res(m.result);
    } else if (m.method) listeners.forEach(f => f(m));
  };
  const send = (method, params, sessionId) => new Promise((res, rej) => {
    const i = ++id;
    pending.set(i, { res, rej });
    ws.send(JSON.stringify({ id: i, method, params: params || {}, sessionId }));
  });
  // Every tab's requests, exceptions and policy reports go into the same log (each dashboard opens in its own tab).
  const log = { requests: [], exceptions: [], csp: [] };
  const watch = sid => listeners.push(m => {
    if (m.sessionId !== sid) return;
    if (m.method === 'Network.requestWillBeSent') log.requests.push(m.params.request.url);
    else if (m.method === 'Runtime.exceptionThrown') {
      log.exceptions.push((m.params.exceptionDetails.exception || {}).description || m.params.exceptionDetails.text);
    } else if (m.method === 'Log.entryAdded' && /content security policy|refused to/i.test(m.params.entry.text)) {
      log.csp.push(m.params.entry.text);
    }
  });
  const DOMAINS = ['Network.enable', 'Runtime.enable', 'Log.enable', 'Page.enable', 'DOM.enable'];
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId: sid } = await send('Target.attachToTarget', { targetId, flatten: true });
  watch(sid);
  for (const d of DOMAINS) await send(d, {}, sid);
  // Tabs opened later (by the page or by the test) are attached paused, so nothing they request is missed.
  const opened = [];
  listeners.push(async m => {
    if (m.method !== 'Target.attachedToTarget' || m.sessionId || m.params.targetInfo.type !== 'page') return;
    const s2 = m.params.sessionId;
    watch(s2);
    for (const d of DOMAINS) await send(d, {}, s2);
    await send('Runtime.runIfWaitingForDebugger', {}, s2);
    opened.push({ targetId: m.params.targetInfo.targetId, page: makePage(s2) });
  });
  await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });

  function makePage(sid) {
    const loadedOnce = () => new Promise(res => {
      const h = m => {
        if (m.method === 'Page.loadEventFired' && m.sessionId === sid) {
          listeners.splice(listeners.indexOf(h), 1);
          res();
        }
      };
      listeners.push(h);
    });
    const page = {
      sid,
      async goto(url) {
        const loaded = loadedOnce();
        await send('Page.navigate', { url }, sid);
        await Promise.race([loaded, sleep(15000)]);
      },
      async eval(expr) {
        const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }, sid);
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
          } catch (e) { /* not ready */ }
          await sleep(50);
        }
        throw new Error('timeout: ' + (label || expr));
      },
      async setFiles(sel, files) {
        const { root } = await send('DOM.getDocument', { depth: 1 }, sid);
        const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector: sel }, sid);
        await send('DOM.setFileInputFiles', { files, nodeId }, sid);
      },
      // As a user's click (pop-ups allowed).
      async click(expr) { await send('Runtime.evaluate', { expression: expr, userGesture: true }, sid); }
    };
    return page;
  }
  const page = makePage(sid);
  async function waitTab(n) {
    for (let i = 0; i < 300 && opened.length <= n; i++) await sleep(50);
    if (opened.length <= n) throw new Error('no new tab');
    return opened[n];
  }
  const closeTab = targetId => send('Target.closeTarget', { targetId });
  async function close() {
    try { await Promise.race([send('Browser.close'), sleep(5000)]); } catch (e) { /* closing */ }
    await exited(5000);
    killGroup();
    await exited(2000);
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
  return { version: ver.Browser, log, page, opened, waitTab, closeTab, send, listeners, close };
}

let passed = 0, failed = 0;
const failures = [];
const check = (ok, name, detail) => {
  if (ok) passed++;
  else { failed++; failures.push({ name, detail }); }
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// What the Emergency page holds: its loaded files (names and texts), its status lines and the checklist's features.
const EM_STATE = `(async () => {
  const a = WSDA.emergency, c = a.checklist.state, files = {};
  for (const [id, d] of Object.entries(a.state.datasets)) files[id] = { name: d.name, path: d.path, kind: d.kind, text: await d.file.text() };
  return { files, version: a.state.version, source: a.state.source, synthetic: a.state.synthetic,
    asof: Array.from(document.querySelectorAll('#asof-lines li')).map(li => li.textContent),
    entry: document.getElementById('entry-status').textContent, status: document.getElementById('load-status').textContent,
    summary: document.getElementById('load-summary').textContent, folded: !document.getElementById('load-fold').open,
    features: (c.features || []).map(f => f.id + ':' + f.on) };
})()`;
const emReady = (page, after) => page.waitFor(`window.WSDA && WSDA.emergency && WSDA.emergency.state.version > ${after || 0}` +
  ' && !WSDA.emergency.state.loading && !WSDA.emergency.checklist.state.busy', 20000, 'Emergency page loaded');

// The landing page: the files chosen at once, then the checklist and the cards settled.
async function loadLanding(p, files) {
  const v = await p.eval('WSDA.landing.state.version');
  await p.setFiles('#files-input', files);
  await p.waitFor(`!WSDA.landing.state.loading && !WSDA.landing.checklist.state.busy && WSDA.landing.state.version > ${v}`,
    20000, 'landing checked');
  await p.waitFor(`Array.from(document.querySelectorAll('#profiles .card-ready')).every(e => !e.hidden && e.getAttribute('data-ready') !== 'checking')`,
    15000, 'cards settled');
  return p.eval(`({ selected: WSDA.landing.state.selected, next: document.getElementById('next-text').textContent,
    open: document.getElementById('next-open').hidden ? null : document.getElementById('next-open').textContent,
    cards: Array.from(document.querySelectorAll('#profiles .card')).map(c => c.getAttribute('data-profile') + ': ' +
      c.querySelector('.card-ready').textContent),
    found: WSDA.landing.checklist.state.result.datasets.filter(d => d.status === 'found').map(d => d.id) })`);
}

async function partLoad(b) {
  const p = b.page;
  const bundleDir = path.join(TABLES, 'em_bundle');
  const bundleFiles = ['bundle.json', 'emergency_case_sites.csv', 'wa_state_feedlots.csv', 'zones.geojson']
    .map(n => path.join(bundleDir, n));
  await p.goto(PAGE);
  await p.waitFor('window.WSDA && WSDA.landing && WSDA.landing.state', 15000, 'landing page');

  // 1. A bundle with a GeoJSON zone, on the landing page: checked for Emergency, which is ready to open.
  let s = await loadLanding(p, bundleFiles);
  check(s.selected === 'emergency' && same(s.found, ['positives', 'feedlots', 'zones'])
    && s.next === 'Next: open Emergency Response. Your files have what it needs.' && s.open === 'Open Emergency Response',
  'load: the bundle (positives, a feedlots file, a GeoJSON zone) is checked for Emergency, ready to open', s);
  check(s.cards.includes('emergency: Ready; off with these files: CVI movements, CVI movements by species.'),
    'load: the Emergency card says it is ready, with the CVI movements off (no master)', s.cards);

  // 2. Sent to the Emergency tab, the zone file with it.
  let n = b.opened.length;
  await p.click(`document.getElementById('next-open').click()`);
  const tab = await b.waitTab(n);
  await emReady(tab.page);
  let em = await tab.page.eval(EM_STATE);
  const zoneText = fs.readFileSync(path.join(bundleDir, 'zones.geojson'), 'utf8');
  check(em.source === 'hub' && same(Object.keys(em.files).sort(), ['feedlots', 'positives', 'zones'])
    && em.files.zones.text === zoneText && em.files.zones.kind === 'zone' && em.files.zones.name === 'zones.geojson'
    && em.files.positives.text === fs.readFileSync(path.join(bundleDir, 'emergency_case_sites.csv'), 'utf8'),
  'load: the Emergency tab receives the positives, the feedlots and the zone file unchanged', Object.keys(em.files));
  check(em.asof[0] === 'Emergency – synthetic test bundle · prepared 2026-10-20' && em.synthetic === true
    && em.entry === 'Loaded in this tab: positives, 1 facility file and a zone file.' && em.folded,
  'load: the Emergency tab names the bundle and what is loaded, and folds the loader', em);
  check(await tab.page.eval('/emergency\\/index\\.html$/.test(location.pathname)'), 'load: the tab is the Emergency page');
  await p.waitFor(`/is open in its own tab with your files/.test(document.getElementById('next-opened').textContent)`,
    10000, 'landing told').catch(() => null);
  check(/^Emergency Response is open in its own tab with your files\./.test(await p.eval(`document.getElementById('next-opened').textContent`)),
    'load: the landing page says the files reached the Emergency tab');
  await b.closeTab(tab.targetId);

  // 3. A loose positives file (no bundle.json) goes to Emergency, not to Infrastructure.
  s = await loadLanding(p, [path.join(TABLES, 'em_positives_tool.csv')]);
  check(s.selected === 'emergency' && same(s.found, ['positives']), 'load: a loose positives file is checked for Emergency', s);
  s = await loadLanding(p, [path.join(TABLES, 'em_no_marker.csv')]);
  check(s.selected === 'infrastructure', 'load: a file with coordinates but no marker column still goes to Infrastructure', s);

  // 4. The Emergency page on its own: the sample, made by Node from the page's own file, loaded here.
  const sampleCtx = { TextEncoder, TextDecoder };
  sampleCtx.window = sampleCtx;
  const vm = require('vm');
  vm.createContext(sampleCtx);
  for (const f of ['shared/zip.js', 'shared/sample.js', 'emergency/sample.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'site', f), 'utf8'), sampleCtx);
  }
  const SAMPLE = Buffer.from(sampleCtx.WSDA.sample.zip(sampleCtx.WSDA.samples.emergency.entries()));
  const samplePath = path.join(OUT, 'sample', 'emergency_synthetic.zip');
  fs.mkdirSync(path.dirname(samplePath), { recursive: true });
  fs.writeFileSync(samplePath, SAMPLE);
  await p.goto(new URL('emergency/index.html', SITE).href);
  await p.waitFor('window.WSDA && WSDA.emergency', 15000, 'Emergency page');
  check(/^No data loaded\./.test(await p.eval(`document.getElementById('load-status').textContent`)),
    'page: opened on its own, it says no data is loaded');
  await p.setFiles('#files-input', [samplePath]);
  await emReady(p);
  em = await p.eval(EM_STATE);
  check(same(Object.keys(em.files).sort(), ['disposal', 'fairgrounds', 'feedlots', 'manifest', 'markets',
    'milkproducer', 'positives', 'poultry', 'premises', 'zones']) && em.source === 'direct' && em.synthetic === true,
  'page: the sample loads its positives, seven layers, the manifest and the zone', Object.keys(em.files));
  check(em.asof[0] === 'Emergency Response – synthetic sample, as of 2026-10-20'
    && em.summary === 'positives, 7 facility files and a zone file'
    && same(em.features, ['positives:true', 'layers:true', 'cvi-movements:false', 'species-refine:false']),
  'page: the banner, the loader\'s summary and the features (CVI movements off without a master)', em);

  // 5. The sample download: Chrome saves the same bytes as the Node copy.
  const DL = path.join(OUT, 'download');
  fs.rmSync(DL, { recursive: true, force: true });
  fs.mkdirSync(DL, { recursive: true });
  await b.send('Browser.setDownloadBehavior', { behavior: 'allowAndName', downloadPath: DL, eventsEnabled: true });
  const download = new Promise(res => {
    let name = null;
    const t = setTimeout(() => { b.listeners.splice(b.listeners.indexOf(h), 1); res({ state: 'timeout', name }); }, 20000);
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
  await p.eval(`document.getElementById('load-fold').open = true; true`);
  await p.click(`document.querySelector('button[data-sample="emergency"]').click()`);
  const d = await download;
  const got = d.state === 'completed' ? fs.readFileSync(path.join(DL, d.guid)) : Buffer.alloc(0);
  check(d.state === 'completed' && d.name === 'emergency_synthetic.zip' && Buffer.compare(got, SAMPLE) === 0,
    'page: the sample download is byte-identical to the Node copy', d);
  await b.send('Browser.setDownloadBehavior', { behavior: 'default' });
  fs.rmSync(DL, { recursive: true, force: true });
}

// The density limits, counted on the page as it shows: the visible controls outside folds (buttons, inputs, selects
// and links not inside a closed fold's body and not the map's own buttons; a fold's header is the fold, but a control
// inside a header counts), and per section the visible sentences of explanation (paragraphs and notes, not status
// lines, help notes, labels or the checklist).
const DENSITY = `(() => {
  const shown = e => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
  const inClosedBody = e => { for (let d = e.closest('details'); d; d = d.parentElement && d.parentElement.closest('details')) {
    const s = d.querySelector(':scope > summary'); if (!d.open && !(s && s.contains(e))) return true; } return false; };
  const controls = Array.from(document.querySelectorAll('main button, main input, main select, main textarea, main a[href]'))
    .filter(e => shown(e) && !inClosedBody(e) && !e.closest('.maplibregl-ctrl, .maplibregl-popup, #em-legend'))
    .map(e => e.id || e.getAttribute('data-tab') || e.getAttribute('data-sample') || e.tagName.toLowerCase() + ':' + (e.textContent || e.value || '').trim().slice(0, 20));
  const sections = {};
  document.querySelectorAll('[data-section], .em-main').forEach(sec => {
    const name = sec.getAttribute('data-section') || 'main';
    const prose = Array.from(sec.querySelectorAll('p, .em-note'))
      .filter(p => shown(p) && !p.closest('.status, [role=status], [role=alert], .help-note, #load-results, #em-legend, .count-card, label, fieldset, .maplibregl-map, .em-results')
        && !p.classList.contains('status'))
      .map(p => p.textContent.trim()).filter(Boolean);
    const sentences = prose.flatMap(t => t.split(/(?<=[.!?])\s+(?=[A-Z])/));
    sections[name] = { sentences: sentences.length, words: Math.max(0, ...sentences.map(t => t.split(/\s+/).length)), text: sentences };
  });
  return { controls, sections };
})()`;

async function partPage(b) {
  const p = b.page, OUTP = path.join(OUT, 'page');
  fs.mkdirSync(OUTP, { recursive: true });
  const shot = async name => fs.writeFileSync(path.join(OUTP, name + '.png'),
    Buffer.from((await b.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, p.sid)).data, 'base64'));
  const samplePath = path.join(OUT, 'sample', 'emergency_synthetic.zip');
  await p.goto(new URL('emergency/index.html', SITE).href);
  await p.waitFor('window.WSDA && WSDA.emergency && WSDA.emergency.state.map.ready', 20000, 'Emergency map ready');
  let d = await p.eval(DENSITY);
  check(await p.eval(`document.getElementById('load-fold').open && !document.getElementById('positives-fold').open
    && !document.getElementById('layers-fold').open && !document.getElementById('options-fold').open`),
  'page: nothing loaded: "Load your data" open, the other folds closed');
  check(/^Load a positives file/.test(await p.eval(`document.getElementById('em-zero').textContent`))
    && await p.eval(`document.getElementById('box-positives').classList.contains('na')`),
  'page: nothing loaded: the map says what to load; the boxes say what they need');
  await shot('empty_1280');
  await p.setFiles('#files-input', [samplePath]);
  await emReady(p);
  await p.waitFor('WSDA.emergency.state.mapData && WSDA.emergency.state.map.drawn && WSDA.emergency.state.map.drawn.positives > 0', 15000, 'map drawn');
  const st = await p.eval(`(() => { const s = WSDA.emergency.state; return { data: s.mapData, drawn: s.map.drawn,
    folds: ['load-fold', 'positives-fold', 'layers-fold', 'options-fold'].map(id => document.getElementById(id).open),
    boxes: ['box-positives', 'box-last', 'box-inside'].map(id => document.getElementById(id).textContent.trim()),
    useZones: s.useZones, layers: s.selectedLayers, rows: s.result && s.result.rows.length,
    sums: ['load-summary', 'positives-sum', 'layers-sum'].map(id => document.getElementById(id).textContent) }; })()`);
  check(same(st.folds, [false, false, false, false]), 'page: after a clean load every fold is closed (the map and boxes show first)', st.folds);
  check(st.useZones === false && st.data.zones === 12 && st.drawn.positives === 7 && st.drawn.inside > 0 && st.drawn.outside > 0,
    'page: HPAI\'s rings (two around each of six positives; the sample\'s zone file waits for its tick); seven positives; sites inside highlighted and others faded', st);
  check(st.boxes[0].replace(/\s+/g, ' ') === '7Positives6 with zones' && /^2026-10-05/.test(st.boxes[1]) && /^\d+Sites inside the zones/.test(st.boxes[2]),
    'page: the value boxes (positives, last positive, sites inside)', st.boxes);
  check(same(st.layers, ['poultry', 'premises', 'markets', 'fairgrounds', 'disposal', 'milkproducer', 'feedlots']),
    'page: the type\'s suggested layers ticked first (poultry and cattle positives; no milk processing file in the sample)', st.layers);
  check(same(st.sums, ['positives, 7 facility files and a zone file', '6 with zones', '7 layers']), 'page: the folds\' summaries', st.sums);
  d = await p.eval(DENSITY);
  check(d.controls.length <= 6, 'density: at most six visible controls outside folds when the page opens (sample loaded)', d.controls);
  check(Object.values(d.sections).every(x => x.sentences <= 1 && x.words <= 25), 'density: at most one sentence of at most 25 words per section', d.sections);
  await shot('sample_1280_folded');
  // The type picker in the fold's header: choosing does not fold; the "?" opens the fold and its note with the links.
  await p.click(`document.getElementById('em-type').click()`);
  check(!await p.eval(`document.getElementById('positives-fold').open`), 'page: a click on the type picker does not open its fold');
  await p.click(`document.querySelector('button.tip[data-help="em-type"]').click()`);
  const help = await p.eval(`({ open: document.getElementById('positives-fold').open, note: !document.getElementById('help-em-type').hidden,
    text: document.getElementById('help-em-type-text').textContent,
    links: Array.from(document.querySelectorAll('#em-type-links a')).map(a => [a.textContent, a.href, a.target, a.rel]) })`);
  check(help.open && help.note && /examples until WSDA staff confirm them/.test(help.text) && help.links.length === 2
    && help.links.every(l => /^https:\/\//.test(l[1]) && l[2] === '_blank' && l[3] === 'noopener noreferrer'),
  'page: the type\'s "?" opens the fold and its note: the "examples" sentence and the reference links, each in a new tab', help);
  for (const id of ['layers-fold', 'options-fold']) await p.eval(`document.getElementById('${id}').open = true; true`);
  d = await p.eval(DENSITY);
  check(Object.values(d.sections).every(x => x.sentences <= 1 && x.words <= 25), 'density: folds open: still at most one sentence per section', d.sections);
  await shot('sample_1280_open');
  // The zone file's tick: its zone replaces the rings; unticked, the rings come back. Then a ring distance.
  await p.click(`document.getElementById('em-zone-fold').open = true; document.getElementById('em-use-zones').click()`);
  await p.waitFor('WSDA.emergency.state.useZones === true', 5000, 'zone file');
  const zoned = await p.eval(`({ zones: WSDA.emergency.state.mapData.zones, rows: WSDA.emergency.state.result.rows.map(r => r.name),
    sum: document.getElementById('positives-sum').textContent, legend: document.getElementById('em-legend-content').textContent })`);
  check(zoned.zones === 1 && zoned.sum === 'zones from a file' && /Synthetic control area/.test(zoned.legend),
    'page: ticking "Use the file\'s zones" draws the control area in place of the rings, named in the legend', zoned);
  await shot('sample_1280_zonefile');
  await p.click(`document.getElementById('em-use-zones').click()`);
  await p.waitFor('WSDA.emergency.state.useZones === false', 5000, 'rings');
  const rings = await p.eval(`({ zones: WSDA.emergency.state.mapData.zones, rows: WSDA.emergency.state.result.rows.length })`);
  check(rings.zones === 12 && rings.rows > 0, 'page: unticked, the two rings around each of the six positives come back', rings);
  await p.eval(`(() => { const i = document.getElementById('em-ring-1'); i.value = '20'; i.dispatchEvent(new Event('change')); return true; })()`);
  const wider = await p.eval(`WSDA.emergency.state.result.rows.length`);
  check(wider > rings.rows, 'page: a wider Control zone takes in more sites', [rings.rows, wider]);
  await p.eval(`(() => { const i = document.getElementById('em-ring-1'); i.value = '2'; i.dispatchEvent(new Event('change')); return true; })()`);
  check(await p.eval(`!document.getElementById('em-rings-msg').hidden && document.getElementById('em-ring-1').value === '20'`),
    'page: a ring smaller than the one inside it is refused, with a message');
  await shot('sample_1280_rings');
  // A short window, every fold open, scrolled down to the result tabs: the sidebar stays in view beside them.
  await b.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 700, deviceScaleFactor: 1, mobile: false }, p.sid);
  await p.eval(`['load-fold','positives-fold','layers-fold','options-fold'].forEach(id => document.getElementById(id).open = true);
    document.querySelector('.tool-switch').scrollIntoView(); true`);
  await sleep(300);
  const side = await p.eval(`(() => { const r = document.querySelector('.em-controls').getBoundingClientRect();
    return { scrolled: Math.round(scrollY), top: Math.round(r.top), bottom: Math.round(r.bottom) }; })()`);
  check(side.scrolled > 0 && side.top >= 0 && side.top <= 16 && side.bottom <= 700,
    'page: scrolled down to the result tabs, the sidebar stays in view beside them', side);
  await p.eval(`(() => { const f = document.querySelector('footer.foot');
    scrollTo(0, Math.max(0, f.getBoundingClientRect().top + scrollY - innerHeight)); return true; })()`);
  await sleep(300);
  const foot = await p.eval(`(() => { const r = document.querySelector('.em-controls').getBoundingClientRect();
    return { scrolled: Math.round(scrollY), top: Math.round(r.top), bottom: Math.round(r.bottom) }; })()`);
  check(foot.scrolled > side.scrolled && foot.top >= 0 && foot.bottom <= 700,
    'page: scrolled down to the footer, the sidebar is still whole in the window', foot);
  await p.eval(`scrollTo(0, 0); true`);
  // 320 pixels wide: no sideways scroll.
  await b.send('Emulation.setDeviceMetricsOverride', { width: 320, height: 900, deviceScaleFactor: 1, mobile: true }, p.sid);
  await sleep(400);
  check(await p.eval(`document.documentElement.scrollWidth <= 321`), 'page: at 320 pixels wide nothing scrolls sideways',
    await p.eval(`document.documentElement.scrollWidth`));
  await shot('sample_320');
  await b.send('Emulation.clearDeviceMetricsOverride', {}, p.sid);
}


async function partResults(b) {
  const p = b.page, samplePath = path.join(OUT, 'sample', 'emergency_synthetic.zip');
  const T = n => path.join(TABLES, n);
  const ZIPJS = (() => { const box = { TextDecoder, TextEncoder }; box.window = box; require('vm').createContext(box);
    require('vm').runInContext(fs.readFileSync(path.join(ROOT, 'site', 'shared', 'zip.js'), 'utf8'), box); return box.WSDA.zip; })();
  const loadPage = async files => {
    await p.goto(new URL('emergency/index.html', SITE).href);
    await p.waitFor('window.WSDA && WSDA.emergency && WSDA.emergency.state.map.ready', 20000, 'Emergency map ready');
    await p.setFiles('#files-input', files);
    await emReady(p);
  };
  // The sample alone: the inside tab, then the CVI tab without a master.
  await loadPage([samplePath]);
  let tab = await p.eval(`({ folds: Array.from(document.querySelectorAll('#tab-inside details.em-layer')).map(d => d.querySelector('summary').textContent),
    lines: Array.from(document.querySelectorAll('#tab-inside .result-line')).map(x => x.textContent),
    left: (document.querySelector('#tab-inside details.em-leftout summary') || {}).textContent || null,
    rules: WSDA.emergency.state.result.layers.map(l => WSDA.emergencyRules.countLine(l)) })`);
  check(tab.folds.length > 0 && tab.folds.concat(tab.lines).sort().join('|') === tab.rules.slice().sort().join('|'),
    'results: one count line per ticked layer, as the rules give them (folds for layers with sites inside, a line for the others)', tab);
  check(tab.lines.some(l => / none inside\. Nearest: .+, [\d.]+ km from /.test(l)), 'results: a layer with nothing inside says its nearest site', tab.lines);
  check(/^Left out: \d+ sites located only roughly \(/.test(tab.left || ''), 'results: the left-out line, folded', tab.left);
  await p.eval(`document.getElementById('options-fold').open = true; document.getElementById('em-coarse').click(); true`);
  const all = await p.eval(`({ left: !!document.querySelector('#tab-inside details.em-leftout'), note: document.getElementById('tab-inside').textContent })`);
  check(!all.left && /known only roughly are included/.test(all.note), 'results: "Include locations known only roughly" empties the left-out list', all);
  await p.click(`document.getElementById('show-cvi').click()`);
  const gate = await p.eval(`({ gate: document.getElementById('cvi-gate').hidden ? null : document.getElementById('cvi-gate').textContent,
    body: !document.getElementById('cvi-body').hidden, inside: !document.getElementById('tab-inside').hidden })`);
  check(/^CVI movements need a CVI master \(CVI_Consolidated_Master\.csv\)/.test(gate.gate || '') && !gate.body && !gate.inside,
    'results: without a master the CVI movements tab says what it needs', gate);
  // Boxes without the optional columns.
  await loadPage([T('em_positives_no_date.csv')]);
  const boxes = await p.eval(`['box-positives', 'box-last', 'box-inside'].map(id => document.querySelector('#' + id + ' strong').textContent)`);
  check(same(boxes, ['2', 'Not available: needs Detection Date', 'Not available: needs a facility layer']),
    'results: the boxes say what they need, never zero', boxes);
  // The sample with a CVI master: the movements, and a year filter.
  await loadPage([samplePath, T('em_cvi_master.csv')]);
  await p.click(`document.getElementById('show-cvi').click()`);
  let cvi = await p.eval(`({ line: (document.querySelector('#cvi-result .result-line') || {}).textContent, rows: document.querySelectorAll('#cvi-result tbody tr').length,
    cvis: Array.from(document.querySelectorAll('#cvi-result tbody tr')).map(r => r.cells[0].textContent) })`);
  check(cvi.line === '3 CVIs, 1,265 animals, left from or arrived inside the zones: 2 origins and 2 destinations inside.'
    && same(cvi.cvis.sort(), ['EM-0001', 'EM-0002', 'EM-0003']), 'results: the CVI movements that left from or arrived inside the zones, counted as Premise Lookup counts them', cvi);
  await p.click(`document.querySelector('#cvi-years input[value="2026"]').click()`);
  cvi = await p.eval(`({ line: (document.querySelector('#cvi-result .result-line') || {}).textContent, cvis: Array.from(document.querySelectorAll('#cvi-result tbody tr')).map(r => r.cells[0].textContent) })`);
  check(same(cvi.cvis, ['EM-0003']) && /^1 CVI, 25 animals/.test(cvi.line), 'results: unticking 2026 leaves the 2025 movement', cvi);
  await p.click(`document.querySelector('#cvi-years input[value="2026"]').click()`);
  // The Export ZIP.
  const DL = path.join(OUT, 'download');
  fs.rmSync(DL, { recursive: true, force: true });
  fs.mkdirSync(DL, { recursive: true });
  await b.send('Browser.setDownloadBehavior', { behavior: 'allowAndName', downloadPath: DL, eventsEnabled: true });
  const download = new Promise(res => {
    let name = null;
    const t = setTimeout(() => { b.listeners.splice(b.listeners.indexOf(h), 1); res({ state: 'timeout', name }); }, 20000);
    const h = m => {
      if (m.method === 'Browser.downloadWillBegin') name = m.params.suggestedFilename;
      if (m.method === 'Browser.downloadProgress' && (m.params.state === 'completed' || m.params.state === 'canceled')) {
        clearTimeout(t); b.listeners.splice(b.listeners.indexOf(h), 1); res({ state: m.params.state, guid: m.params.guid, name });
      }
    };
    b.listeners.push(h);
  });
  await p.click(`document.getElementById('em-export').click()`);
  const d = await download;
  const zipBytes = d.state === 'completed' ? fs.readFileSync(path.join(DL, d.guid)) : Buffer.alloc(0);
  const listing = zipBytes.length ? await ZIPJS.open(new File([zipBytes], 'x.zip')) : { entries: [] };
  const files = {};
  for (const e of listing.entries) files[e.path.replace(/^[^/]+\//, '')] = new TextDecoder().decode(await e.read());
  check(/^\d{4}-\d\d-\d\d_Emergency\.zip$/.test(d.name || '') && same(Object.keys(files).sort(), ['cvi_movements.csv',
    'export_params.json', 'inside_the_zones.csv', 'layers.csv', 'left_out.csv', 'positives.csv']),
  'results: Export saves one ZIP with the six files', [d, Object.keys(files)]);
  const params = files['export_params.json'] ? JSON.parse(files['export_params.json']) : {};
  check(params.tool === 'emergency_response' && /^rings Infection zone 3 km, Control zone 10 km$/.test(params.zones)
    && params.data_note === 'Synthetic sample data' && params.positives === 7, 'results: export_params.json says what was exported', params);
  check(/^"?Positive"?,/.test(files['positives.csv'] || '') && (files['positives.csv'] || '').split('\n').length === 9
    && /^"?CVI"?,/.test(files['cvi_movements.csv'] || '') && !/Origin\.Address/.test(files['cvi_movements.csv'] || ''),
  'results: the CSVs: seven positives; the CVI rows without the address column', [files['positives.csv'], (files['cvi_movements.csv'] || '').split('\n')[0]]);
  check(/Exported \d{4}-\d\d-\d\d_Emergency\.zip/.test(await p.eval(`document.getElementById('em-export-result').textContent`)),
    'results: the line under Export says what was saved');
  await b.send('Browser.setDownloadBehavior', { behavior: 'default' });
  fs.rmSync(DL, { recursive: true, force: true });
  // Add a point on the map: a real click near SYN-HPAI-001 while picking, then a typed name used on the map, in the
  // results and in the export; an emptied name goes back to the first one; a removed point's name is not given again.
  await loadPage([samplePath]);
  await p.eval(`document.getElementById('positives-fold').open = true; document.getElementById('em-pick-fold').open = true;
    document.getElementById('em-pick').click(); document.getElementById('em-map').scrollIntoView({ block: 'center' }); true`);
  await sleep(300);
  const pickAt = await p.eval(`(() => { const s = WSDA.emergency.state, m = s.map.map, r = m.getContainer().getBoundingClientRect();
    const q = s.read.positives.find(x => x.name === 'SYN-HPAI-001'), xy = m.project([q.lon, q.lat]);
    return { x: Math.round(r.left + xy.x + 6), y: Math.round(r.top + xy.y + 6) }; })()`);
  await b.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pickAt.x, y: pickAt.y, button: 'left', buttons: 1, clickCount: 1 }, p.sid);
  await b.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pickAt.x, y: pickAt.y, button: 'left', buttons: 0, clickCount: 1 }, p.sid);
  await sleep(300);
  const named = async name => p.eval(`(() => { const i = document.querySelector('#em-points .em-point-name');
    i.value = ${JSON.stringify(name)}; i.dispatchEvent(new Event('change')); return i.value; })()`);
  const typed = await named('  Smith   farm call-in ');
  await p.eval(`WSDA.sample.download = function () {}; document.getElementById('em-export').click(); true`);
  const pt = await p.eval(`(() => { const s = WSDA.emergency.state, files = {};
    (s.lastExport || []).filter(e => !e.dir).forEach(e => { files[e.name.replace(/^.*\\//, '')] = e.data; });
    return { box: document.querySelector('#em-points .em-point-name').value, map: JSON.stringify(s.map.em).includes('Smith farm call-in'),
      tab: document.getElementById('tab-inside').textContent.includes('Smith farm call-in'),
      inside: (files['inside_the_zones.csv'] || '').includes('Smith farm call-in'),
      params: JSON.parse(files['export_params.json'] || '{}').added_points }; })()`);
  check(typed === 'Smith farm call-in' && pt.map && pt.tab && pt.inside && /^Smith farm call-in \(/.test(String(pt.params || '')),
    'results: an added point\'s typed name is used on the map, in the results and in the export (spaces tidied)', pt);
  const emptied = await named('   ');
  const removed = await p.eval(`(() => { document.querySelector('#em-points button').click();
    return { left: document.querySelectorAll('#em-points li').length, tab: document.getElementById('tab-inside').textContent.includes('Smith farm call-in') }; })()`);
  await p.eval(`document.getElementById('em-pick').click(); true`);
  await b.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pickAt.x, y: pickAt.y, button: 'left', buttons: 1, clickCount: 1 }, p.sid);
  await b.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pickAt.x, y: pickAt.y, button: 'left', buttons: 0, clickCount: 1 }, p.sid);
  await sleep(300);
  const second = await p.eval(`document.querySelector('#em-points .em-point-name').value`);
  check(emptied === 'Added point 1' && removed.left === 0 && !removed.tab && second === 'Added point 2',
    'results: an emptied name goes back to "Added point 1"; Remove takes the point out; the next point is "Added point 2"', { emptied, removed, second });
  // The marked addresses (the tool-form positives, a premises file, the master's address column) reach nothing.
  await loadPage([T('em_positives_tool.csv'), T('em_premises_location.csv'), T('em_cvi_master.csv')]);
  await p.click(`document.getElementById('show-cvi').click()`);
  const scan = await p.eval(`(() => { const s = WSDA.emergency.state; return { page: document.body.innerText.includes('MARKED-ADDRESS'),
    map: JSON.stringify(s.map.em).includes('MARKED-ADDRESS'), result: JSON.stringify(s.result || {}).includes('MARKED-ADDRESS'),
    names: s.read.positives.map(p => p.name) }; })()`);
  check(!scan.page && !scan.map && !scan.result && same(scan.names, ['Positive 1 (Yakima)', 'Positive 2 (Yakima)', 'Positive 3 (Franklin)',
    'Positive 4 (Skagit)', 'Positive 5 (Umatilla (Oregon))', 'Positive 6 (Lewis)']),
  'results: no marked address on the page, in the map\'s labels or in the results; positives named "Positive n (County)"', scan);
  const ex = await p.eval(`(() => { document.getElementById('em-export').click(); return (WSDA.emergency.state.lastExport || []).map(e => typeof e.data === 'string' ? e.data : '').join('\\n'); })()`);
  check(ex.length > 0 && !ex.includes('MARKED-ADDRESS'), 'results: no marked address in any exported file');
  await shot2(b, 'results_inside');
}
async function shot2(b, name) {
  fs.mkdirSync(path.join(OUT, 'page'), { recursive: true });
  fs.writeFileSync(path.join(OUT, 'page', name + '.png'),
    Buffer.from((await b.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, b.page.sid)).data, 'base64'));
}

(async () => {
  for (const f of ['em_bundle/zones.geojson', 'em_positives_tool.csv', 'em_no_marker.csv']) {
    if (!fs.existsSync(path.join(TABLES, f))) {
      console.error('Run node tests/synthetic/make_em_fixtures.js first (test-tables/' + f + ' is missing).');
      process.exit(2);
    }
  }
  const b = await launch();
  const run = { chrome: b.version, page: PAGE, parts: PARTS, started: new Date().toISOString() };
  try {
    for (const part of PARTS) {
      if (part === 'load') await partLoad(b);
      else if (part === 'page') await partPage(b);
      else if (part === 'results') await partResults(b);
      else check(false, 'unknown part ' + part);
    }
  } catch (e) {
    check(false, 'run aborted', String(e && e.stack || e));
  }
  check(b.log.exceptions.length === 0, 'no exceptions', b.log.exceptions);
  check(b.log.csp.length === 0, 'no policy reports', b.log.csp);
  // The boards' own pages and pictures (local files the test writes) are not the site's requests.
  const BOARDS_URL = pathToFileURL(path.join(ROOT, 'local-test-artifacts', 'owner-documents', 'e1a', 'boards')).href;
  // The earlier site copy that boards3 compares with is a local folder too.
  const BEFORE = process.env.EM_BEFORE_SITE || BOARDS_URL;
  const outside = b.log.requests.filter(u => !u.startsWith(SITE) && !u.startsWith(BOARDS_URL) && !u.startsWith(BEFORE) && !/^(data|blob|about):/.test(u));
  check(outside.length === 0, 'no request outside the site', outside.slice(0, 5));
  await b.close();
  Object.assign(run, { passed, failed, failures });
  fs.writeFileSync(path.join(OUT, 'browser_' + (PAGE.startsWith('file:') ? 'file' : 'http') + '.json'),
    JSON.stringify(run, null, 2) + '\n');
  for (const f of failures) console.log('  FAIL ' + f.name + (f.detail !== undefined ? ' :: ' + JSON.stringify(f.detail).slice(0, 500) : ''));
  console.log(`Emergency Chrome (${PARTS.join(' ')}, ${PAGE.startsWith('file:') ? 'file://' : 'http'}): ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
