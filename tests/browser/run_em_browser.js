#!/usr/bin/env node
'use strict';
// Emergency Response through installed Chrome (headless, a throw-away profile, offline; no packages). Foreground only.
// Parts (named as arguments; none named runs every part):
//   load   the landing page and the Emergency page: a folder bundle with a GeoJSON zone found on the landing page and
//          sent to the Emergency tab; a loose positives file (also in the agency's agreed HPAI table, or its header
//          alone) goes to Emergency, not to Infrastructure; the
//          Emergency sample loaded on the page itself and its download byte-identical to the Node copy
//   page   the page with the sample: what the map draws, the value boxes, every fold closed after the load, the type
//          picker in its fold's header, the type's "?" and its links, the zone file switch, a ring distance, the
//          density limits (at most six visible controls outside folds; at most one sentence of at most 25 words per
//          section), at 1280 and 320 pixels wide; pictures in local-test-artifacts/em/page/
//   results  the tabs: "Inside the zones" (a fold per layer, the "nearest" line, the left-out fold, "include
//          roughly"), the boxes without the optional columns, the CVI movements without a master and with one (its
//          year filter), the Export ZIP's files and export_params.json, and the marked addresses found in no page
//          text, map label or exported file
//   e1b    E1b on the page: past positives hidden, shown faded and with their rings; the status list hidden without a
//          status column; the "Detected between" window; the play by week (start, pause, the slider, the last step
//          on the latest detection, a step under one second, the CVI movements waiting) and by month; km | miles; the
//          zone hover with days since; the "Zones" list; the rows not mapped; two positives at one spot; the
//          synthetic screwworm outbreak and the switch to HPAI; the density limits; 320 pixels wide
//   png    the map picture: its controls under More options, the download at 200 and 300 dpi (size and dpi read from the
//          file), the title, file name, boxes, rings and key, miles, a paused play's date, the screwworm outbreak's
//          zones; copies in local-test-artifacts/em/png/
//   chart  the chart "Positives over time": its fold (hidden before a load, closed by default), one column per step with
//          each dated, mapped positive counted once, a click and the keyboard moving the window's end, the hover box,
//          the play moving the picked column, the screwworm outbreak by week, 320 pixels wide; pictures in
//          local-test-artifacts/em/chart/
//   speed  the one-second step at full size: 40 positives against 30,000 points, every step of a whole play timed by
//          the page's own hook, without a master, with the 50,000-row synthetic master (make_scale_master.js) and with
//          the CVI movements tab open
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
// Where the picture parts write; in the private repository, the slice in progress's review folder (it moves with
// the slice).
let BOARDS_DIR = path.join(OUT, 'pictures');
const TABLES = path.join(ROOT, 'test-tables');
const PAGE = process.env.EM_PAGE_URL || pathToFileURL(path.join(ROOT, 'site', 'index.html')).href;
const SITE = new URL('.', PAGE).href;
const CHROME = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ALL_PARTS = ['load', 'page', 'results', 'e1b', 'png', 'chart', 'speed'];
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
    'load: the landing page says the files reached the Emergency tab', await p.eval(`document.getElementById('next-opened').textContent`));
  await b.closeTab(tab.targetId);

  // 3. A loose positives file (no bundle.json) goes to Emergency, not to Infrastructure.
  s = await loadLanding(p, [path.join(TABLES, 'em_positives_tool.csv')]);
  check(s.selected === 'emergency' && same(s.found, ['positives']), 'load: a loose positives file is checked for Emergency', s);
  s = await loadLanding(p, [path.join(TABLES, 'em_positives_agreed.csv')]);
  check(s.selected === 'emergency' && same(s.found, ['positives']),
    'load: a file in the agency\'s agreed HPAI table is checked for Emergency (v2.0 sent it to Infrastructure)', s);
  s = await loadLanding(p, [path.join(TABLES, 'em_positives_agreed_header.csv')]);
  check(s.selected === 'emergency' && same(s.found, ['positives']), 'load: the agreed table\'s header alone is checked for Emergency', s);
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
    && await p.eval(`document.getElementById('box-positives').classList.contains('na') && document.getElementById('em-box-lines').hidden`),
  'page: nothing loaded: the map says what to load; the boxes say what they need, with no line under them');
  await shot('empty_1280');
  await p.setFiles('#files-input', [samplePath]);
  await emReady(p);
  await p.waitFor('WSDA.emergency.state.mapData && WSDA.emergency.state.map.drawn && WSDA.emergency.state.map.drawn.positives > 0', 15000, 'map drawn');
  const st = await p.eval(`(() => { const s = WSDA.emergency.state; return { data: s.mapData, drawn: s.map.drawn,
    folds: ['load-fold', 'positives-fold', 'layers-fold', 'options-fold'].map(id => document.getElementById(id).open),
    boxes: ['box-positives', 'box-past', 'box-last', 'box-inside'].map(id => document.getElementById(id).textContent.trim()),
    lines: document.getElementById('em-box-lines').hidden ? null : document.getElementById('em-box-lines').textContent,
    useZones: s.useZones, layers: s.selectedLayers, rows: s.result && s.result.rows.length,
    sums: ['load-summary', 'positives-sum', 'layers-sum'].map(id => document.getElementById(id).textContent) }; })()`);
  check(same(st.folds, [false, false, false, false]), 'page: after a clean load every fold is closed (the map and boxes show first)', st.folds);
  check(st.useZones === false && st.data.zones === 12 && st.drawn.positives === 6 && st.drawn.inside > 0 && st.drawn.outside > 0,
    'page: HPAI\'s rings (two around each of six positives; the sample\'s zone file waits for its tick); six current positives (the past one hidden); sites inside highlighted and others faded', st);
  check(st.boxes[0] === '6Current positives' && st.boxes[1] === '1Past positivesnone under quarantine'
    && st.lines === 'Animals at the current positives: 3 commercial, 3 backyard, 1.2M birds, 3,550 cattle'
    && st.boxes[2] === 'Oct 5, 2026Last positiveAs of Oct 5, 2026' && /^\d+Sites inside the zones/.test(st.boxes[3]),
  'page: the value boxes, each count once (the current positives, "with zones" only when it differs; the past one, none under quarantine; the last positive as of the window\'s end, written "Oct 5, 2026"; sites inside) and the animals under them (the dairies\' cattle apart from the birds)', [st.boxes, st.lines]);
  check(same(st.layers, ['poultry', 'premises', 'markets', 'fairgrounds', 'disposal', 'milkproducer', 'feedlots']),
    'page: the type\'s suggested layers ticked first (poultry and cattle positives; no milk processing file in the sample)', st.layers);
  check(same(st.sums, ['positives, 7 facility files and a zone file', '3\u00a0and\u00a010\u00a0km rings, past hidden', '7 layers']),
    'page: the folds\' summaries ("Positives and zones" says its settings, the counts being in the boxes)', st.sums);
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
  check(zoned.zones === 1 && zoned.sum === 'zones from a file, past hidden' && /Synthetic control area/.test(zoned.legend),
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
  let tab = await p.eval(`({ folds: Array.from(document.querySelectorAll('#tab-inside details.em-layer[data-layer]')).map(d => d.querySelector('summary').textContent),
    lines: Array.from(document.querySelectorAll('#tab-inside .result-line')).map(x => x.textContent),
    left: (document.querySelector('#tab-inside details.em-leftout summary') || {}).textContent || null,
    rules: WSDA.emergency.state.result.layers.map(l => WSDA.emergencyRules.countLine(l)) })`);
  check(tab.folds.length > 0 && tab.folds.concat(tab.lines).sort().join('|') === tab.rules.slice().sort().join('|'),
    'results: one count line per ticked layer, as the rules give them (folds for layers with sites inside, a line for the others)', tab);
  check(tab.lines.some(l => / none inside\. Nearest: .+, [\d.]+ km from /.test(l)), 'results: a layer with nothing inside says its nearest site', tab.lines);
  check(/^Left out: \d+ sites located only roughly$/.test(tab.left || ''), 'results: the left-out line, folded', tab.left);
  const leftOut = await p.eval(`(() => { const d = document.querySelector('#tab-inside details.em-leftout'), b = d.querySelector('summary strong');
    return { bold: b && b.textContent, heads: Array.from(d.querySelectorAll('th')).map(th => th.textContent),
      reasons: Array.from(d.querySelectorAll('tbody tr')).map(r => r.cells[2].textContent) }; })()`);
  check(leftOut.bold === 'Left out' && leftOut.heads[2] === 'Reason' && leftOut.reasons.length > 0 && leftOut.reasons.every(x => x),
    'results: "Left out" in bold as a layer fold\'s name; the reasons in the table\'s Reason column', leftOut);
  // The tables fitted to their contents (E1b's UI pass): a short table narrower than the tab; a number's heading
  // right-aligned over its numbers.
  const fit = await p.eval(`(() => { const tab = document.getElementById('tab-inside').getBoundingClientRect().width;
    const t = document.querySelector('#tab-inside .em-zones-list table'), th = t.querySelectorAll('th')[2];
    return { tab, table: t.getBoundingClientRect().width, num: th.className, align: getComputedStyle(th).textAlign }; })()`);
  check(fit.table < fit.tab * 0.8 && fit.num === 'num' && fit.align === 'right',
    'results: the "Zones" table only as wide as its contents; "Days since" right-aligned over its numbers', fit);
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
  check(same(boxes, ['2', 'Not available: needs Confirmed Diagnosis', 'Not available: needs a facility layer']),
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
    'export_params.json', 'inside_the_zones.csv', 'layers.csv', 'left_out.csv', 'positives.csv', 'zones.csv', 'zones.geojson']),
  'results: Export saves one ZIP with the eight files', [d, Object.keys(files)]);
  let geo = null;
  try { geo = JSON.parse(files['zones.geojson'] || ''); } catch (e) { geo = null; }
  const feats = geo ? geo.features : [];
  check(geo && geo.type === 'FeatureCollection' && feats.length === 12 && feats.every(f => f.properties.group === 'Current')
    && same(Object.keys(feats[0].properties), ['name', 'zone', 'positive', 'group', 'distance', 'unit', 'days_since_last_positive', 'as_of'])
    && /^(Infection|Control) zone \((3|10) km\) around SYN-HPAI-\d{3}$/.test(feats[0].properties.name)
    && feats.every(f => f.geometry.coordinates[0].length === 361) && feats[0].properties.as_of === '2026-10-05',
  'results: zones.geojson: the two rings around each of the six current positives, whole circles, with their properties', feats.slice(0, 1));
  const zl = (files['zones.csv'] || '').trim().split('\n');
  check(zl.length === 7 && /^"?Zone"?,"?Positive"?,"?Ring"?,"?Distance"?,"?Unit"?,"?Last positive"?,"?Days since the last positive"?,"?As of"?/.test(zl[0])
    && /Control zone \(10 km\) around SYN-HPAI-007/.test(zl[1]), 'results: zones.csv: one row per positive\'s outer ring, the most recent first', zl.slice(0, 2));
  const params = files['export_params.json'] ? JSON.parse(files['export_params.json']) : {};
  check(params.tool === 'emergency_response' && /^rings Infection zone 3 km, Control zone 10 km$/.test(params.zones)
    && params.data_note === 'Synthetic sample data' && params.positives === 7 && params.unit === 'km' && params.as_of === '2026-10-05',
  'results: export_params.json says what was exported, with the unit and the as-of date', params);
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
  check(ex.length > 0 && !ex.includes('MARKED-ADDRESS') && ex.includes('"FeatureCollection"'),
    'results: no marked address in any exported file, zones.geojson included');
  await shot2(b, 'results_inside');
}
// E1b on the page: the groups, the window, the play, miles, the zone hover, the "Zones" list, the rows not mapped and
// the switch between the HPAI sample and the synthetic screwworm outbreak.
async function partE1b(b) {
  const p = b.page, S = 'WSDA.emergency.state';
  const samplePath = path.join(OUT, 'sample', 'emergency_synthetic.zip');
  const open = async () => {
    await p.goto(new URL('emergency/index.html', SITE).href);
    await p.waitFor(`window.WSDA && WSDA.emergency && ${S}.map.ready`, 20000, 'Emergency map ready');
  };
  const load = async files => {
    const v = await p.eval(`${S}.version`);
    await p.setFiles('#files-input', files);
    await emReady(p, v);
    await p.waitFor(`${S}.map.drawn && ${S}.map.drawn.positives > 0`, 15000, 'map drawn');
  };
  const view = () => p.eval(`(() => { const s = ${S}, box = id => document.getElementById(id).innerText.replace(/\\s+/g, ' ').trim();
    return { data: s.mapData, positives: box('box-positives'), past: box('box-past'), quar: document.getElementById('box-past').classList.contains('quar'), last: box('box-last'),
      lines: document.getElementById('em-box-lines').hidden ? '' : box('em-box-lines'), sum: document.getElementById('positives-sum').textContent,
      rows: s.result ? s.result.rows.length : 0, window: s.window, legend: Array.from(document.querySelectorAll('#em-legend-content p')).map(e => e.textContent),
      playing: s.playing, play: document.getElementById('em-play').textContent, step: document.getElementById('em-step-label').textContent,
      stepAt: s.stepAt, ms: s.computeMs }; })()`);
  const tick = id => p.click(`document.getElementById('${id}').click()`);
  const setDate = (id, v) => p.eval(`(() => { const i = document.getElementById('${id}'); i.value = '${v}'; i.dispatchEvent(new Event('change')); return true; })()`);

  // ---- The HPAI sample: the agreed table, no status column, one past positive (released) ----
  await open();
  await load([samplePath]);
  await p.eval(`document.getElementById('positives-fold').open = true; true`);
  check(await p.eval(`document.getElementById('em-statuses-field').hidden`),
    'e1b: the file has no status column, so the "Zones around" status list is not shown');
  let v = await view();
  check(v.data.positives === 6 && v.data.past === 0 && v.positives === '6 Current positives' && v.past === '1 Past positives none under quarantine' && !v.quar,
    'e1b: past positives are hidden on the map at first; the boxes count the six current ones and the past one, none under quarantine (not in the warning color)', v);
  // Each box's brand color on its edge and its icon's tile (wider screens): crimson, eggplant, blue-green, evergreen.
  const colors = () => p.eval(`['box-positives', 'box-past', 'box-last', 'box-inside'].map(id => { const c = document.getElementById(id), i = c.querySelector('.card-ic');
    return { icon: i.dataset.icon, drawn: !!i.querySelector('svg'), edge: getComputedStyle(c, '::before').backgroundColor,
      tile: getComputedStyle(i).backgroundColor, color: getComputedStyle(i).color, place: getComputedStyle(i).position }; })`);
  let boxColors = await colors();
  check(same(boxColors.map(c => [c.icon, c.drawn, c.edge, c.tile, c.color, c.place]), [
    ['geo-alt-fill', true, 'rgb(202, 48, 20)', 'rgb(202, 48, 20)', 'rgb(255, 255, 255)', 'absolute'],
    ['clock-history', true, 'rgb(82, 35, 72)', 'rgb(82, 35, 72)', 'rgb(255, 255, 255)', 'absolute'],
    ['calendar-event', true, 'rgb(0, 148, 170)', 'rgb(0, 148, 170)', 'rgb(255, 255, 255)', 'absolute'],
    ['bullseye', true, 'rgb(74, 139, 44)', 'rgb(74, 139, 44)', 'rgb(255, 255, 255)', 'absolute']]),
  'e1b: each box\'s icon on a tile in its brand color, its edge the same (current crimson, past eggplant, last positive blue-green, sites inside evergreen)', boxColors);
  check(await p.eval(`document.getElementById('em-past-fold').hidden`), 'e1b: "Past zones" is hidden until "Show past positives" is ticked');
  await tick('em-past');
  const rowsBefore = v.rows;
  v = await view();
  check(v.data.positives === 7 && v.data.past === 1 && v.positives === '6 Current positives' && v.rows === rowsBefore
    && v.legend.includes('Past (hollow, faded)'),
  'e1b: "Show past positives" draws the past one hollow and faded, named in the legend; it never counts or adds sites', v);
  check(!await p.eval(`document.getElementById('em-past-fold').hidden`), 'e1b: ticked, "Past zones" shows (folded, inside the fold)');
  await p.eval(`document.getElementById('em-past-fold').open = true; true`);
  await tick('em-past-rings');
  v = await view();
  check(v.data.pastZones === 2 && v.rows === rowsBefore && v.legend.includes('Past zones (dashed)'),
    'e1b: "Draw their rings" draws the past positive\'s two rings, gray and dashed; no site is added', v);
  await tick('em-past-rings');
  await tick('em-past');
  // The window.
  check(same(v.window, { start: '2026-07-15', end: '2026-10-05' }) && await p.eval(`document.getElementById('em-from').value === '2026-07-15'
    && document.getElementById('em-to').value === '2026-10-05'`),
  'e1b: "Detected between" starts at the earliest and the latest detection in the file', v.window);
  await setDate('em-to', '2026-09-05');
  v = await view();
  check(v.data.positives === 2 && v.positives === '2 Current positives' && v.lines === 'Animals at the current positives: 2 commercial, 1.2M birds, 2,400 cattle'
    && v.last === 'Sep 2, 2026 Last positive As of Sep 5, 2026'
    && /^1 Past positives /.test(v.past),
  'e1b: a window ending Sep 5 shows the two positives current then; the last positive is the latest inside it, "As of" the end', v);
  await setDate('em-from', '2026-09-30');
  check(await p.eval(`!document.getElementById('em-window-msg').hidden && document.getElementById('em-from').value === '2026-07-15'`),
    'e1b: a first date after the second is refused, with a message');
  await setDate('em-to', '');
  v = await view();
  check(v.window.end === '2026-10-05', 'e1b: a cleared date box goes back to the file\'s date', v.window);
  // The play: 13 epi weeks, one a second; the first step ends on its Saturday, the last on the latest detection.
  check(v.play === 'Play by week' && await p.eval(`document.getElementById('em-step').max`) === '12' && v.step === 'Up to Oct 5, 2026 \u00b7 week 13 of 13'
    && await p.eval(`document.getElementById('em-step').getAttribute('aria-valuetext')`) === v.step,
    'e1b: "Play by week" with a slider over 13 weeks, resting on the last; its label (and the slider\'s spoken value) says what the map shows', v);
  await tick('em-play');
  v = await view();
  check(v.playing && v.play === 'Pause' && v.stepAt === 0 && same(v.window, { start: '2026-07-15', end: '2026-07-18' })
    && v.step === 'Up to Jul 18, 2026 \u00b7 week 1 of 13' && v.data.positives === 1,
  'e1b: Play starts at the first week: the window ends on its Saturday, the map as it stood then', v);
  check(v.ms < 1000, 'e1b: a step redraws in under one second (the sample)', v.ms);
  await tick('em-play');
  await sleep(1300);
  const paused = await view();
  check(!paused.playing && paused.play === 'Play by week' && paused.stepAt === v.stepAt, 'e1b: Pause stops the play where it is', paused);
  await p.eval(`(() => { const i = document.getElementById('em-step'); i.value = '6'; i.dispatchEvent(new Event('input')); return true; })()`);
  v = await view();
  check(v.stepAt === 6 && v.window.end === '2026-08-29' && v.step === 'Up to Aug 29, 2026 \u00b7 week 7 of 13',
    'e1b: the slider moves the window\'s end to that week\'s Saturday', v);
  await tick('em-play');
  await p.eval(`(() => { const i = document.getElementById('em-step'); i.value = '3'; i.dispatchEvent(new Event('input')); return true; })()`);
  v = await view();
  check(!v.playing && v.stepAt === 3 && v.window.end === '2026-08-08',
    'e1b: moving the slider while the play runs pauses it on the week chosen', v);
  await tick('em-play');
  await p.waitFor(`!${S}.playing`, 15000, 'play ends');
  v = await view();
  check(v.stepAt === 12 && v.window.end === '2026-10-05' && v.play === 'Play by week' && v.positives === '6 Current positives',
    'e1b: the play stops on its own at the last step, on the latest detection itself (not its Saturday); no loop', v);
  // Miles: the rings keep their place; the boxes, the legend and the tab read miles; back to km gives 3 and 10 again.
  const kmRows = v.rows;
  await tick('em-unit-mi');
  v = await view();
  const mi = await p.eval(`({ rings: [0, 1].map(k => document.getElementById('em-ring-' + k).value),
    head: Array.from(document.querySelectorAll('#tab-inside details[data-layer] th')).map(t => t.textContent),
    zones: document.querySelector('#tab-inside .em-zones-list summary').textContent })`);
  check(same(mi.rings, ['1.86', '6.21']) && v.legend.includes('Infection zone (1.86 mi)') && v.legend.includes('Control zone (6.21 mi)')
    && v.rows === kmRows && mi.head.includes('Distance (mi)') && /Control zone \(6\.21 mi\)/.test(mi.zones),
  'e1b: miles: the rings shown as 1.86 and 6.21 mi, the same sites inside, the legend, the tab and the "Zones" list in miles', [mi.zones, v.rows, kmRows, v.legend, mi.rings]);
  await p.eval(`(() => { const i = document.getElementById('em-ring-1'); i.value = '600'; i.dispatchEvent(new Event('change')); return true; })()`);
  check(await p.eval(`/at most 500 miles/.test(document.getElementById('em-rings-msg').textContent)`), 'e1b: in miles the cap says 500 miles');
  await tick('em-unit-km');
  v = await view();
  check(same(await p.eval(`[0, 1].map(k => document.getElementById('em-ring-' + k).value)`), ['3', '10']) && v.rows === kmRows
    && v.legend.includes('Infection zone (3 km)'),
  'e1b: back to km: exactly 3 and 10 km again', v.legend);
  // The same number typed in each unit: a 5 km Control zone and a 5 mi one (8.05 km) take in different sites.
  const setControl = d => p.eval(`(() => { const i = document.getElementById('em-ring-1'); i.value = '${d}'; i.dispatchEvent(new Event('change')); return true; })()`);
  const outer = () => p.eval(`({ rows: ${S}.result.rows.length, far: Math.max(...${S}.result.rows.map(r => r.exactKm)),
    legend: Array.from(document.querySelectorAll('#em-legend-content p')).map(e => e.textContent) })`);
  await setControl(5);
  const five = await outer();
  await tick('em-unit-mi');
  await setControl(5);
  const fiveMi = await outer();
  check(five.legend.includes('Control zone (5 km)') && fiveMi.legend.includes('Control zone (5 mi)') && fiveMi.rows > five.rows
    && five.far <= 5 && fiveMi.far > 5 && fiveMi.far <= 5 * 1.609344,
  'e1b: 5 typed in km and 5 typed in miles give different results: 5 mi (8.05 km) takes in sites between 5 and 8.05 km that 5 km leaves out',
  { km: [five.rows, five.far], mi: [fiveMi.rows, fiveMi.far] });
  await tick('em-unit-km');
  await setControl(10);
  // The "Zones" list and the zone hover.
  const zl = await p.eval(`({ sum: document.querySelector('#tab-inside .em-zones-list summary').textContent,
    rows: Array.from(document.querySelectorAll('#tab-inside .em-zones-list tbody tr')).map(r => Array.from(r.cells).map(c => c.textContent)) })`);
  check(zl.sum === 'Zones: days since the last positive in each positive\'s Control zone (10 km), as of Oct 5, 2026' && zl.rows.length === 6
    && same(zl.rows[0], ['SYN-HPAI-007', 'Oct 5, 2026', '0 days'])
    && same(zl.rows[5], ['SYN-HPAI-003', 'Aug 21, 2026', '45 days']),
  'e1b: "Inside the zones" starts with the "Zones" list: one row per positive (named by it, the ring said once), the dates written out, the longest-quiet zone last', zl);
  await p.eval(`${S}.map.map.fitBounds([[-120.45, 46.33], [-120.18, 46.47]], { animate: false }); true`);
  await sleep(500);
  const at = await p.eval(`(() => { const pt = ${S}.map.map.project([-120.315, 46.415]), r = ${S}.map.map.getCanvas().getBoundingClientRect();
    return { x: pt.x, y: pt.y, px: r.left + pt.x, py: r.top + pt.y, lines: ${S}.map.hoverAt([pt.x, pt.y]) }; })()`);
  check(same(at.lines, { items: [{ head: 'SYN-HPAI-002', lines: ['Infection zone (3 km): 25 days', 'Control zone (10 km): 25 days'] }],
    foot: 'Days since the last positive inside each zone, as of Oct 5, 2026', points: false }),
  'e1b: hovering a zone lists every zone under the pointer, smallest ring first, under its positive\'s name once, each with its days since; then the "as of" date', at.lines);
  await b.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at.px, y: at.py }, p.sid);
  await sleep(300);
  const popup = await p.eval(`(() => { const e = document.querySelector('.maplibregl-popup'); return e ? { text: e.textContent,
    head: (e.querySelector('strong') || {}).textContent, foot: (e.querySelector('.tip-foot') || {}).textContent } : null; })()`);
  check(popup && popup.head === 'SYN-HPAI-002' && /Infection zone \(3 km\): 25 days/.test(popup.text)
    && popup.foot === 'Days since the last positive inside each zone, as of Oct 5, 2026',
  'e1b: a real pointer move over the zone opens that tooltip, the positive\'s name in bold, the "as of" line last', popup);
  // Population density: its key under "Population context" in the legend, and the tract's lines in the zone hover.
  await p.eval(`document.getElementById('options-fold').open = true; true`);
  await tick('pc-density');
  await p.waitFor(`WSDA.population.loaded('density') && ${S}.map.map.getLayer('pc-density')`, 15000, 'density drawn');
  await p.eval(`new Promise(r => ${S}.map.map.once('idle', () => r(true)))`);
  v = await view();
  const keyAt = v.legend.indexOf('Population context');
  const tract = await p.eval(`(() => { const pt = ${S}.map.map.project([-120.315, 46.415]); return ${S}.map.hoverAt([pt.x, pt.y]); })()`);
  check(keyAt > 0 && v.legend.slice(keyAt + 1, keyAt + 8).length === 7 && /people per/i.test(v.legend[keyAt + 1]),
    'e1b: "Population density" ticked: the legend adds "Population context", the density title and its six classes', v.legend);
  check(tract && tract.items[0].head === 'SYN-HPAI-002' && tract.context && tract.context.length === 1
    && tract.context[0].head === 'Census tract, 2020' && / people per sq mi of land$/.test(tract.context[0].lines[0])
    && /^2020 population /.test(tract.context[0].lines[1]),
  'e1b: inside a zone, the hover adds the tract: "Census tract, 2020", its people per square mile and its population', tract);
  await b.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at.px + 1, y: at.py }, p.sid);
  await sleep(300);
  check(await p.eval(`(() => { const e = document.querySelector('.maplibregl-popup:not(.pc-tip)');
    return !!e && /Census tract, 2020/.test(e.textContent) && e.querySelector('hr') !== null; })()`),
  'e1b: the tooltip shows the tract under a thin line');
  await tick('pc-density');
  v = await view();
  const plain = await p.eval(`(() => { const pt = ${S}.map.map.project([-120.315, 46.415]); return ${S}.map.hoverAt([pt.x, pt.y]); })()`);
  check(!v.legend.includes('Population context') && !plain.context, 'e1b: unticked, the key and the tract lines go', [v.legend, plain]);
  await p.eval(`document.getElementById('options-fold').open = false; true`);
  // On a phone the hover stays inside the map (narrower than 320 pixels), and the legend sits under the map, open.
  await b.send('Emulation.setDeviceMetricsOverride', { width: 320, height: 900, deviceScaleFactor: 1, mobile: true }, p.sid);
  await p.eval(`document.querySelector('.map-frame').scrollIntoView();
    ${S}.map.map.resize(); ${S}.map.map.setCenter([-120.315, 46.415]); true`);
  await sleep(600);
  const phone = await p.eval(`(() => { const lg = document.getElementById('em-legend'), m = document.getElementById('em-map').getBoundingClientRect(),
    r = lg.getBoundingClientRect(), dates = document.querySelector('.date-row');
    const zones = document.querySelector('#tab-inside .em-zones-list tbody tr'), cells = Array.from(zones.cells).map(c => c.getBoundingClientRect());
    return { open: lg.open, below: r.top >= m.bottom - 1, within: r.left >= m.left - 1 && r.right <= m.right + 1, mapHigh: m.height,
      dateWords: Array.from(dates.querySelectorAll('span')).map(e => e.textContent),
      dateRows: dates.querySelector('#em-to').getBoundingClientRect().top > dates.querySelector('#em-from').getBoundingClientRect().bottom - 1,
      head: getComputedStyle(document.querySelector('#tab-inside .em-zones-list thead')).display,
      twoLines: cells[1].top >= cells[0].bottom - 1, said: zones.cells[1].dataset.label, days: zones.cells[2].innerText,
      sum: getComputedStyle(document.getElementById('positives-sum')).display,
      items: Array.from(document.querySelectorAll('#positives-sum .item')).map(e => [e.textContent, getComputedStyle(e).whiteSpace]) }; })()`);
  check(phone.sum === 'block' && phone.items.length >= 2 && phone.items.every(x => x[1] === 'nowrap')
    && phone.items.map(x => x[0]).join(', ') === await p.eval(`document.getElementById('positives-sum').textContent`),
  'e1b: a fold\'s summary on its own line, each item kept whole', phone.items);
  check(phone.open && phone.below && phone.within && phone.mapHigh >= 300,
    'e1b: at 320 pixels wide the legend sits under the map, open, never over it', phone);
  check(same(phone.dateWords, ['From', 'To']) && phone.dateRows, 'e1b: the date boxes as two rows, "From" and "To"', phone);
  check(phone.head === 'none' && phone.twoLines && phone.said === 'Last positive' && phone.days === '0 days',
    'e1b: at 320 pixels wide a "Zones" row is two lines: the positive, then its date and days with their words', phone);
  // Scrolled to the map again as it is measured: the open chart redraws after the resize and can move the map down.
  const narrow = await p.eval(`(() => { document.querySelector('.map-frame').scrollIntoView();
    const m = ${S}.map.map, pt = m.project([-120.315, 46.415]), r = m.getCanvas().getBoundingClientRect();
    return { px: r.left + pt.x, py: r.top + pt.y, left: r.left, right: r.right }; })()`);
  await b.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: narrow.px, y: narrow.py }, p.sid);
  await sleep(400);
  narrow.tip = await p.eval(`(() => { const e = document.querySelector('.maplibregl-popup'); if (!e) return null; const r = e.getBoundingClientRect();
    return { left: r.left, right: r.right }; })()`);
  check(narrow.tip && narrow.tip.left >= narrow.left - 1 && narrow.tip.right <= narrow.right + 1,
    'e1b: at 320 pixels wide the zone hover fits inside the map', narrow);
  // A wide date ("Aug 21, 2026", as of Aug 29) fits its box at 320 and 480 pixels (it was cut off at its edge).
  await setDate('em-to', '2026-08-29');
  const fits = [];
  for (const w of [320, 480]) {
    await b.send('Emulation.setDeviceMetricsOverride', { width: w, height: 900, deviceScaleFactor: 1, mobile: true }, p.sid);
    await sleep(300);
    fits.push(await p.eval(`(() => { const e = document.querySelector('#box-last strong');
      return { text: e.textContent, fits: e.scrollWidth <= e.clientWidth + 1, size: getComputedStyle(e).fontSize }; })()`));
  }
  check(fits.every(f => f.text === 'Aug 21, 2026' && f.fits), 'e1b: at 320 and 480 pixels wide a wide date fits its "Last positive" box', fits);
  // On a phone the icons are plain, in their box's color; the past box, with one still under quarantine, in the warning color.
  boxColors = await colors();
  check(boxColors.every(c => c.place !== 'absolute' && c.tile === 'rgba(0, 0, 0, 0)') && boxColors[0].color === 'rgb(202, 48, 20)'
    && boxColors[1].color === 'rgb(56, 37, 19)' && boxColors[1].edge === 'rgb(56, 37, 19)',
  'e1b: on a phone each icon is plain, before its label, in its box\'s color; the quarantine one in the warning color', boxColors);
  await b.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }, p.sid);
  await sleep(300);
  boxColors = await colors();
  check(boxColors[1].tile === 'rgb(252, 182, 20)' && boxColors[1].color === 'rgb(56, 37, 19)',
    'e1b: on a wider screen, with one still under quarantine, the past box\'s tile is gold with a dark-brown icon', boxColors[1]);
  await setDate('em-to', '');
  await b.send('Emulation.setDeviceMetricsOverride', { width: 320, height: 900, deviceScaleFactor: 1, mobile: true }, p.sid);
  await b.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 2, y: 2 }, p.sid);
  await b.send('Emulation.clearDeviceMetricsOverride', {}, p.sid);
  await p.eval(`scrollTo(0, 0); ${S}.map.map.resize(); true`);
  // The CVI movements wait while the play runs.
  await load([samplePath, path.join(TABLES, 'em_cvi_master.csv')]);
  await tick('show-cvi');
  await p.waitFor(`${S}.cviRes && ${S}.cviRes.status === 'ok'`, 10000, 'CVI result');
  await tick('em-play');
  const during = await p.eval(`({ text: document.getElementById('cvi-result').textContent, playing: ${S}.playing })`);
  check(during.playing && /worked out when the play stops/.test(during.text), 'e1b: while the play runs, the CVI movements wait', during);
  await tick('em-play');
  check(await p.eval(`!${S}.playing && !!${S}.cviRes && !/worked out when the play stops/.test(document.getElementById('cvi-result').textContent)`),
    'e1b: when the play stops, the CVI movements are worked out for the date shown');
  await tick('show-inside');

  // ---- The agreed-table scenario: more than 26 weeks (by month), two rows not mapped, two positives at one spot ----
  await open();
  await load([path.join(TABLES, 'em_rules_agreed.csv')]);
  v = await view();
  check(v.play === 'Play by month' && v.step === 'Up to Oct 5, 2026 \u00b7 month 24 of 24' && await p.eval(`document.getElementById('em-step').getAttribute('aria-label')`) === 'Month of',
    'e1b: a window over more than 26 weeks plays by month ("Up to Oct 5, 2026 · month 24 of 24")', v);
  check(/2 not mapped: 1 no coordinates, 1 latitude and longitude look swapped/.test(v.lines) && v.past === '5 Past positives 2 still under quarantine' && v.quar
    && await p.eval(`(() => { const b = document.getElementById('box-past'), note = b.querySelector('.card-note'), n = note.querySelector('b'), last = document.querySelector('#box-last .card-note');
      return getComputedStyle(note).color === getComputedStyle(last).color && getComputedStyle(note).fontWeight === getComputedStyle(last).fontWeight
        && !!n && n.textContent === '2' && getComputedStyle(n).color === 'rgb(56, 37, 19)' && getComputedStyle(n).fontWeight === '600'
        && getComputedStyle(b, '::before').backgroundColor !== getComputedStyle(document.getElementById('box-last'), '::before').backgroundColor; })()`),
  'e1b: the past box counts those still under quarantine, the number in bold and the warning color with its edge, the rest of the note as the "As of" note; the line names the rows not mapped', [v.past, v.lines]);
  check(await p.eval(`(() => { const w = Array.from(document.querySelectorAll('#em-box-lines .warn')).map(e => e.textContent);
    return JSON.stringify(w) === JSON.stringify(['2 not mapped: 1 no coordinates, 1 latitude and longitude look swapped', '1 date not readable', '1 without a date']); })()`),
  'e1b: the rows not mapped, the unreadable date and the positive without a date, and only they, are in the warning color');
  const nm = await p.eval(`({ sum: (document.querySelector('#tab-inside .em-notmapped summary') || {}).textContent,
    rows: Array.from(document.querySelectorAll('#tab-inside .em-notmapped tbody tr')).map(r => Array.from(r.cells).map(c => c.textContent)) })`);
  check(nm.sum === 'Not mapped: 2 positives without usable coordinates' && same(nm.rows, [['Lewis 03', 'Lewis', 'Oct 1, 2026', 'no coordinates'],
    ['Yakima 03', 'Yakima', 'Sep 20, 2026', 'latitude and longitude look swapped']]),
  'e1b: "Inside the zones" lists the rows not mapped, with the reason, the dates written out', nm);
  check(await p.eval(`(() => { const b = document.querySelector('#tab-inside .em-notmapped summary strong');
    return !!b && b.textContent === 'Not mapped' && getComputedStyle(b).color !== getComputedStyle(document.querySelector('#tab-inside .em-zones-list summary strong')).color; })()`),
  'e1b: "Not mapped" in bold, in the warning color');
  const undated = await p.eval(`Array.from(document.querySelectorAll('#tab-inside .em-zones-list tbody tr'))
    .map(r => Array.from(r.cells).map(c => c.textContent)).find(r => r[0] === 'Positive 4 (Kittitas)')`);
  check(same(undated, ['Positive 4 (Kittitas)', 'no date', 'unknown']),
    'e1b: a positive without a date: its "Zones" row reads "no date" and "unknown", not empty cells', undated);
  await tick('em-past');
  await p.eval(`${S}.map.map.jumpTo({ center: [-122.96, 46.66], zoom: 11 }); true`);
  await sleep(500);
  const two = await p.eval(`(() => { const pt = ${S}.map.map.project([-122.96, 46.66]); return ${S}.map.hoverAt([pt.x, pt.y]); })()`);
  check(two && two.points && two.items.length === 2
    && two.items.some(it => it.head === 'Lewis 01' && it.lines[0] === 'Detected Jun 10, 2025' && it.lines[1] === 'Past')
    && two.items.some(it => it.head === 'Lewis 02' && it.lines[0] === 'Detected Sep 30, 2026'),
  'e1b: two positives at one spot: the hover lists both, each under its name, the past one marked past', two);
  check(/1\.3M birds, 35 cattle; 1 without an inventory/.test(v.lines), 'e1b: the numbers line counts the herd\'s cattle apart from the birds', v.positives);
  await p.eval(`${S}.map.map.jumpTo({ center: [-122.45, 48.90], zoom: 11 }); true`);
  await sleep(500);
  const herd = await p.eval(`(() => { const pt = ${S}.map.map.project([-122.45, 48.90]); return ${S}.map.hoverAt([pt.x, pt.y]); })()`);
  check(herd && herd.items.length === 1 && [herd.items[0].head].concat(herd.items[0].lines).join('\n') === 'Whatcom 01\nDetected Jul 20, 2026\nBackyard · Dairy · 35 cattle · flock size Small',
    'e1b: a cattle herd\'s hover names its animals cattle, not birds', herd);

  // ---- Dates as Excel and ArcGIS export them; a premises closed after the latest detection; a status-only close ----
  await open();
  await load([path.join(TABLES, 'em_positives_times.csv')]);
  v = await view();
  const times = await p.eval(`({ max: document.getElementById('em-to').max, to: document.getElementById('em-to').value,
    warn: Array.from(document.querySelectorAll('#em-box-lines .warn')).map(e => e.textContent),
    today: (() => { const d = new Date(), t = n => String(n).padStart(2, '0'); return d.getFullYear() + '-' + t(d.getMonth() + 1) + '-' + t(d.getDate()); })() })`);
  check(v.positives === '2 Current positives' && v.past === '1 Past positives 1 still under quarantine' && v.last === 'Oct 1, 2026 Last positive As of Oct 1, 2026'
    && times.warn.includes('2 dates not readable'),
  'e1b: dates written with a time are read ("9/3/2026 0:00"); the two that cannot be read are said in the warning color', [v.positives, v.past, v.last, times.warn]);
  check(times.to === '2026-10-01' && times.max === (times.today > '2026-10-01' ? times.today : '2026-10-01'),
    'e1b: the window opens on the latest detection; its "To" date can run on to today', times);
  await setDate('em-to', '2026-10-21');
  v = await view();
  check(v.positives === '1 Current positives' && v.past === '2 Past positives 2 still under quarantine' && v.last === 'Oct 1, 2026 Last positive As of Oct 21, 2026'
    && v.step === 'Up to Oct 21, 2026 \u00b7 week 5 of 5',
  'e1b: a "To" date after the latest detection: the premises closed on Oct 20 is past (released Nov 30: still under quarantine); the play\'s label says the window\'s end', [v.positives, v.past, v.last, v.step]);
  await p.click(`document.querySelector('button.tip[data-help="em-type"]').click()`);
  const timesHelp = await p.eval(`document.getElementById('help-em-type-text').textContent`);
  check(/no readable close date, shows as past at every step of the play/.test(timesHelp),
    'e1b: the type\'s "?" says a positive closed by its status alone shows as past at every step of the play', timesHelp);
  await load([path.join(TABLES, 'em_positives_agreed.csv')]);
  check(!/no readable close date/.test(await p.eval(`document.getElementById('help-em-type-text').textContent`)),
    'e1b: with close dates for every closed positive, the "?" does not say it');

  // ---- The synthetic screwworm outbreak: the type follows the file, its dispersal areas are the zones ----
  await open();
  await load([path.join(TABLES, 'em_nws_synthetic.zip')]);
  v = await view();
  const nws = await p.eval(`({ type: document.getElementById('em-type').value, useZones: ${S}.useZones, layers: ${S}.selectedLayers,
    synthetic: ${S}.synthetic, zones: Array.from(document.querySelectorAll('#tab-inside .em-zones-list tbody tr')).map(r => Array.from(r.cells).map(c => c.textContent)) })`);
  check(nws.type === 'nws' && nws.useZones && v.data.zones === 2 && nws.synthetic && same(nws.layers, ['markets', 'feedlots', 'fairgrounds']),
    'e1b: the screwworm bundle picks New World screwworm, uses its dispersal areas at once, ticks its livestock layers; marked synthetic', nws);
  check(v.positives === '8 Current positives zones from a file' && v.past === '2 Past positives 1 still under quarantine'
    && v.lines === '1 not mapped: no coordinates · Animals at the current positives: 4 commercial, 4 backyard, 10,835 animals; 1 without an inventory'
    && v.last === 'Oct 9, 2026 Last positive As of Oct 9, 2026',
  'e1b: the screwworm boxes: eight current positives as of Oct 9, two past (one still under quarantine); under them the not-mapped line and the animals', [v.positives, v.past, v.lines, v.last]);
  check(same(nws.zones, [['Synthetic dispersal area: Yakima and Tri-Cities (made up)', 'Oct 2, 2026', '7 days'],
    ['Synthetic dispersal area: Klickitat (made up)', 'Aug 26, 2026', '44 days']]),
  'e1b: the "Zones" list for the dispersal areas, the longest-quiet last', nws.zones);
  check(v.play === 'Play by week' && v.step === 'Up to Oct 9, 2026 \u00b7 week 10 of 10', 'e1b: the screwworm outbreak plays by week (ten weeks)', v);
  // A zone file: a layer with sites in two zones says the count and the zones; the table names each zone.
  const twoZones = await p.eval(`Array.from(document.querySelectorAll('#tab-inside details.em-layer[data-layer] summary')).map(e => e.textContent)`);
  check(twoZones.some(t => /^[^:]+: \d+ in 2 zones$/.test(t)), 'e1b: with a zone file, a layer with sites in two zones reads "n in 2 zones"', twoZones);
  await p.eval(`(() => { const s = document.getElementById('em-type'); s.value = 'hpai'; s.dispatchEvent(new Event('change')); return true; })()`);
  v = await view();
  check(/4 commercial, 4 backyard, 10,790 cattle, 45 other animals; 1 without an inventory/.test(v.lines)
    && await p.eval(`document.getElementById('em-type').value`) === 'hpai',
  'e1b: switching the type picker to HPAI reads the same file as HPAI (its words: cattle and other animals, no birds)', v.lines);
  // The bundle's zone file follows the type: HPAI draws its rings, screwworm the file's zones again.
  check(!await p.eval(`${S}.useZones`) && v.data.zones > 2, 'e1b: switched to HPAI, the bundle\'s zone file gives way to HPAI\'s rings', v.data);
  await p.eval(`(() => { const s = document.getElementById('em-type'); s.value = 'nws'; s.dispatchEvent(new Event('change')); return true; })()`);
  v = await view();
  check(await p.eval(`${S}.useZones`) && v.data.zones === 2, 'e1b: switched back to screwworm, its dispersal areas are the zones again', v.data);
  await load([samplePath]);
  check(await p.eval(`document.getElementById('em-type').value`) === 'hpai' && !await p.eval(`${S}.useZones`),
    'e1b: loading the HPAI sample after it: HPAI, its rings');
  await load([path.join(TABLES, 'em_nws_synthetic.zip')]);
  check(await p.eval(`document.getElementById('em-type').value`) === 'nws',
    'e1b: a new set of files picks the type again (a pick made for the earlier files does not carry over)');
  const d = await p.eval(DENSITY);
  check(d.controls.length <= 6 && Object.values(d.sections).every(x => x.sentences <= 1 && x.words <= 25),
    'e1b: density with the screwworm outbreak loaded: at most six visible controls, one short sentence per section', d);
  await p.eval(`['positives-fold'].forEach(id => document.getElementById(id).open = true); true`);
  const d2 = await p.eval(DENSITY);
  check(Object.values(d2.sections).every(x => x.sentences <= 1 && x.words <= 25),
    'e1b: "Positives and zones" open: still at most one short sentence per section', d2.sections);
  await b.send('Emulation.setDeviceMetricsOverride', { width: 320, height: 900, deviceScaleFactor: 1, mobile: true }, p.sid);
  await sleep(400);
  check(await p.eval(`document.documentElement.scrollWidth <= 321`), 'e1b: at 320 pixels wide, with the window and the play shown, nothing scrolls sideways',
    await p.eval(`document.documentElement.scrollWidth`));
  await b.send('Emulation.clearDeviceMetricsOverride', {}, p.sid);
  // The screwworm positives alone: its one example ring until a zone file comes, its distance said once.
  await load([path.join(TABLES, 'em_nws_synthetic_positives.csv')]);
  v = await view();
  check(!await p.eval(`${S}.useZones`) && v.legend.includes('Example area (20 km)'),
    'e1b: the screwworm positives alone: the example ring, "Example area (20 km)" in the legend', v.legend);
  await tick('em-unit-mi');
  v = await view();
  check(v.legend.includes('Example area (12.43 mi)'), 'e1b: in miles, "Example area (12.43 mi)"', v.legend);
  await tick('em-unit-km');
}

// The chart "Positives over time": its fold under the value boxes (hidden before a load, closed by default), one column
// per step of the play with the file's dated, mapped positives counted once, a click and the keyboard moving the
// window's end (as the slider), the hover box, the play moving the picked column, a start after the clicked step
// going back to the earliest detection, the screwworm outbreak by week, 320 pixels wide. Pictures of the value boxes
// and the chart in local-test-artifacts/em/chart/ for a look.
async function partChart(b) {
  const p = b.page, S = 'WSDA.emergency.state', OUTC = path.join(OUT, 'chart');
  const samplePath = path.join(OUT, 'sample', 'emergency_synthetic.zip'), nwsPath = path.join(TABLES, 'em_nws_synthetic.zip');
  fs.rmSync(OUTC, { recursive: true, force: true });
  fs.mkdirSync(OUTC, { recursive: true });
  // The value boxes down to the chart's fold (with the hover box when shown), scrolled into view.
  const shot = async name => {
    await sleep(300);
    const r = await p.eval(`(() => { document.getElementById('em-boxes').scrollIntoView(); const a = document.getElementById('em-boxes').getBoundingClientRect(),
      z = document.getElementById('em-chart-fold').getBoundingClientRect(), t = document.getElementById('em-chart-tip').getBoundingClientRect();
      const bottom = Math.max(z.bottom, document.getElementById('em-chart-tip').hidden ? 0 : t.bottom);
      return { x: 0, y: a.top + scrollY - 6, width: document.documentElement.clientWidth, height: bottom - a.top + 12 }; })()`);
    fs.writeFileSync(path.join(OUTC, name + '.png'), Buffer.from((await b.send('Page.captureScreenshot',
      { format: 'png', captureBeyondViewport: false, clip: Object.assign(r, { scale: 1 }) }, p.sid)).data, 'base64'));
  };
  await p.goto(new URL('emergency/index.html', SITE).href);
  await p.waitFor(`window.WSDA && WSDA.emergency && ${S}.map.ready`, 20000, 'Emergency map ready');
  check(await p.eval(`document.getElementById('em-chart-fold').hidden`), 'chart: no fold before a positives file is loaded');
  const load = async files => {
    const v = await p.eval(`${S}.version`);
    await p.setFiles('#files-input', files);
    await emReady(p, v);
    await p.waitFor(`${S}.map.drawn && ${S}.map.drawn.positives > 0`, 15000, 'map drawn');
  };
  await load([samplePath]);
  const view = () => p.eval(`(() => { const s = ${S}, f = document.getElementById('em-chart-fold');
    const cols = Array.from(document.querySelectorAll('#em-chart .chart-col'));
    return { hidden: f.hidden, open: f.open, sum: document.getElementById('em-chart-sum').textContent,
      note: document.getElementById('em-chart-note').hidden ? '' : document.getElementById('em-chart-note').textContent,
      steps: s.steps.steps.length, by: s.steps.by, stepAt: s.stepAt, window: s.window, to: document.getElementById('em-to').value,
      slider: document.getElementById('em-step').value, positives: document.getElementById('box-positives').querySelector('strong').textContent,
      counts: s.chart ? s.chart.columns.map(c => [c.current, c.past, c.outside]) : [],
      dated: s.read.positives.filter(x => x.detected).length, mapped: s.read.positives.length, dropped: s.read.dropped.length,
      cols: cols.length, current: cols.findIndex(c => c.getAttribute('aria-current') === 'true'),
      stops: cols.filter(c => c.getAttribute('tabindex') === '0').map(c => Number(c.getAttribute('data-col'))),
      hovers: cols.map(c => c.getAttribute('data-hover')), focus: document.activeElement && document.activeElement.getAttribute('data-col'),
      svgWidth: (document.querySelector('#em-chart svg') || {}).clientWidth || 0, boxWidth: document.getElementById('em-chart').clientWidth,
      tip: document.getElementById('em-chart-tip').hidden ? null : document.getElementById('em-chart-tip').textContent }; })()`);
  await p.waitFor(`document.querySelectorAll('#em-chart .chart-col').length > 0`, 5000, 'chart drawn').catch(() => false);
  let v = await view();
  check(!v.hidden && v.open && v.cols > 0 && v.sum === (v.by === 'month' ? 'by month' : 'by week'),
    'chart: after the load, the fold shows under the value boxes, open and drawn, its summary naming weeks or months', v);
  const d = await p.eval(DENSITY);
  check(d.controls.length <= 6 && !d.controls.some(c => /chart/.test(c)), 'chart: the open chart adds no visible control (density)', d.controls);
  // Closed by the user, it stays closed while the page works the results out again; a new set of files opens it.
  await p.eval(`document.getElementById('em-chart-fold').open = false; document.getElementById('em-unit-mi').click(); true`);
  await sleep(200);
  check(!await p.eval(`document.getElementById('em-chart-fold').open`), 'chart: closed, it stays closed when a control changes');
  await load([samplePath]);
  check(await p.eval(`document.getElementById('em-chart-fold').open`), 'chart: a new set of files opens it again');
  await p.eval(`document.getElementById('em-unit-km').click(); document.getElementById('em-chart-fold').open = true; true`);
  await p.waitFor(`document.querySelectorAll('#em-chart .chart-col').length > 0`, 5000, 'chart drawn again');
  v = await view();
  const total = v.counts.reduce((t, c) => t + c[0] + c[1] + c[2], 0);
  check(v.cols === v.steps && v.steps > 1 && total === v.dated && v.current === v.steps - 1 && same(v.stops, [v.steps - 1])
    && v.counts.every(c => c[2] === 0) && v.svgWidth === v.boxWidth,
  'chart: opened, one column per step of the play, each dated mapped positive counted once, the last step picked and the one keyboard stop, nothing outside the window, as wide as its fold', v);
  await shot('chart_01_hpai_sample_open');
  check((v.dropped || v.mapped > v.dated) ? /^Not counted: /.test(v.note) : v.note === '', 'chart: the note names what is not counted, only when something is', v.note);
  // A click on an earlier column with positives: the window's end moves to that step's end, as the slider does.
  const at = v.counts.findIndex(c => c[0] + c[1] > 0);
  const step = await p.eval(`${S}.steps.steps[${at}]`);
  await p.click(`document.querySelector('#em-chart .chart-col[data-col="${at}"]').dispatchEvent(new MouseEvent('click', { bubbles: true })); true`);
  await p.waitFor(`${S}.stepAt === ${at}`, 5000, 'chart click');
  v = await view();
  const later = v.counts.slice(at + 1).reduce((t, c) => t + c[2], 0), laterAll = total - v.counts.slice(0, at + 1).reduce((t, c) => t + c[0] + c[1] + c[2], 0);
  check(v.window.end === step.end && v.to === step.end && v.slider === String(at) && v.current === at && same(v.stops, [at])
    && later === laterAll && later > 0,
  'chart: a click on a column moves the window\'s end to its step\'s end (the date box and the slider follow); the later positives turn "outside the window"', v);
  check(v.positives === await p.eval(`String(WSDA.emergencyRules.groups(${S}.read, ${S}.window).current.length)`),
    'chart: the "Positives" box follows the click', v.positives);
  // The hover box: the column's counts and its click's hint.
  await p.eval(`(() => { const c = document.querySelector('#em-chart .chart-col[data-col="${at}"]'), r = c.getBoundingClientRect();
    c.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + 30 })); return true; })()`);
  v = await view();
  check(v.tip === v.hovers[at] + 'Click to show the map as of ' + (await p.eval(`WSDA.emergencyRules.dayLabel('${step.end}')`)) && /: \d+ (current|past)/.test(v.tip),
    'chart: the pointer over a column shows its counts and what a click does', v.tip);
  await shot('chart_02_hpai_sample_clicked_hover');
  await p.eval(`document.getElementById('em-chart').dispatchEvent(new PointerEvent('pointerleave')); true`);
  // The keyboard: the picked column is the stop; the left arrow moves along, Enter picks.
  await p.eval(`document.querySelector('#em-chart .chart-col[tabindex="0"]').focus(); true`);
  await p.eval(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); true`);
  v = await view();
  check(v.focus === String(at + 1) && same(v.stops, [at + 1]) && v.tip === v.hovers[at + 1] + 'Click to show the map as of '
    + (await p.eval(`WSDA.emergencyRules.dayLabel(${S}.steps.steps[${at + 1}].end)`)) && v.stepAt === at,
  'chart: the right arrow moves the focus (and the hover box) to the next column without moving the window', v);
  await p.eval(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); true`);
  await p.waitFor(`${S}.stepAt === ${at + 1}`, 5000, 'chart Enter');
  v = await view();
  check(v.current === at + 1 && v.focus === String(at + 1), 'chart: Enter picks the focused column; the focus stays on it after the redraw', v);
  // A start after the clicked step's end goes back to the earliest detection.
  const fw = await p.eval(`${S}.fileWindow`);
  await p.eval(`(() => { const i = document.getElementById('em-from'); i.value = '${fw.end}'; i.dispatchEvent(new Event('change')); return true; })()`);
  await p.click(`document.querySelector('#em-chart .chart-col[data-col="0"]').dispatchEvent(new MouseEvent('click', { bubbles: true })); true`);
  await p.waitFor(`${S}.stepAt === 0`, 5000, 'chart click on the first column');
  v = await view();
  check(v.window.start === fw.start && v.window.end === (await p.eval(`${S}.steps.steps[0].end`)),
    'chart: with the window starting after the clicked step, the start goes back to the earliest detection (never an empty window)', v.window);
  // The play moves the picked column; Pause stops it.
  await p.click(`document.getElementById('em-play').click()`);
  await p.waitFor(`${S}.stepAt >= 1`, 5000, 'one step played');
  v = await view();
  check(v.current === v.stepAt, 'chart: while the play runs, the picked column follows its step', v);
  await p.click(`document.getElementById('em-play').click()`);
  // The screwworm outbreak: ten weeks.
  await p.eval(`document.activeElement.blur(); true`);
  await load([nwsPath]);
  v = await view();
  check(v.open && v.by === 'week' && v.sum === 'by week' && v.cols === 10 && v.counts.reduce((t, c) => t + c[0] + c[1] + c[2], 0) === 10
    && v.note === 'Not counted: 1 not mapped' && /^Week of /.test(v.hovers[0]),
  'chart: the screwworm outbreak, by week: ten columns, its ten mapped positives, the row without coordinates named', v);
  await shot('chart_03_screwworm_by_week');
  await b.send('Emulation.setDeviceMetricsOverride', { width: 320, height: 900, deviceScaleFactor: 1, mobile: true }, p.sid);
  await sleep(400);
  v = await view();
  check(await p.eval(`document.documentElement.scrollWidth <= 321`) && v.svgWidth === v.boxWidth && v.boxWidth <= 300,
    'chart: at 320 pixels wide it is redrawn at the fold\'s width; nothing scrolls sideways', [v.svgWidth, v.boxWidth]);
  await shot('chart_04_screwworm_320px');
  await b.send('Emulation.clearDeviceMetricsOverride', {}, p.sid);
}

// The one-second step at full size (scope section 3, "Speed"): the speed set both sides of the rules check (40
// positives and 30,000 points, tests/synthetic/make_em_fixtures.js) written as a positives file in the agreed columns,
// detected two days apart over twelve weeks (every eighth one closed), and a markets layer of 30,000 points; then the
// 50,000-row synthetic CVI master (tests/synthetic/make_scale_master.js). Every step of a whole play is timed by the
// page's own hook (state.computeMs, one redraw's work): without a master, with one, and with the CVI movements tab
// open (the query waits for the play to stop). The CVI query after the play is timed too, for the record only.
async function partSpeed(b) {
  const p = b.page, S = 'WSDA.emergency.state', OUTS = path.join(OUT, 'speed');
  const MASTER = path.join(ROOT, 'local-test-artifacts', 'scale', 'cvi_master_50000.csv');
  if (!fs.existsSync(MASTER)) {
    check(false, 'speed: run node tests/synthetic/make_scale_master.js first (local-test-artifacts/scale/cvi_master_50000.csv is missing)');
    return;
  }
  const FX = require(path.join(ROOT, 'tests', 'synthetic', 'make_em_fixtures.js'));
  const sp = FX.RULES.speed;
  const md = ms => { const d = new Date(ms); return (d.getUTCMonth() + 1) + '/' + d.getUTCDate() + '/' + d.getUTCFullYear(); };
  const first = Date.UTC(2026, 6, 6);
  const rows = sp.positives.map(([lat, long], i) => {
    const detected = first + i * 2 * 86400000;
    const closed = i % 8 === 7;
    return ['SPD-' + String(i + 1).padStart(3, '0'), md(detected - 86400000), closed ? md(detected + 20 * 86400000) : '', md(detected), '',
      '(synthetic) Example Farm', '(synthetic) Example Road', 'Synthetic Town', 'Synthetic', lat, long, closed ? 'Closed' : 'Active',
      'H5N1 2.3.4.4b', i % 2 ? 'Backyard' : 'Commercial', 'Commercial Table Egg Layer', 'Chicken', '1000', '1000', '1', 'Landfill'].join(',');
  });
  fs.rmSync(OUTS, { recursive: true, force: true });
  fs.mkdirSync(OUTS, { recursive: true });
  const positivesFile = path.join(OUTS, 'emergency_case_sites.csv');
  const marketsFile = path.join(OUTS, 'wa_state_public_livestock_markets.csv');
  fs.writeFileSync(positivesFile, [FX.AGREED_HEAD.join(',')].concat(rows).join('\n') + '\n');
  fs.writeFileSync(marketsFile, ['name,lat,long'].concat(sp.points.map(([lat, long], i) => 'Speed Point ' + (i + 1) + ',' + lat + ',' + long))
    .join('\n') + '\n');

  await p.goto(new URL('emergency/index.html', SITE).href);
  await p.waitFor(`window.WSDA && WSDA.emergency && ${S}.map.ready`, 20000, 'Emergency map ready');
  const load = async files => {
    const v = await p.eval(`${S}.version`);
    await p.setFiles('#files-input', files);
    await emReady(p, v);
    await p.waitFor(`${S}.map.drawn && ${S}.map.drawn.positives > 0`, 30000, 'map drawn');
  };
  // A whole play, every step's redraw time read from the page's hook as the step changes; also whether the CVI tab
  // ever showed movements (not its waiting line) while the play ran.
  const play = async () => {
    const times = {};
    let cviWhilePlaying = false;
    await p.click(`document.getElementById('em-play').click()`);
    for (let i = 0; i < 400; i++) {
      const s = await p.eval(`({ at: ${S}.stepAt, ms: ${S}.computeMs, playing: ${S}.playing,
        waits: /worked out when the play stops/.test(document.getElementById('cvi-result').textContent) })`);
      times[s.at] = s.ms;
      if (!s.playing) break;
      if (!s.waits) cviWhilePlaying = true;
      await sleep(100);
    }
    const ms = Object.values(times);
    return { steps: ms.length, max: Math.round(Math.max(...ms)), mean: Math.round(ms.reduce((a, x) => a + x, 0) / ms.length), cviWhilePlaying };
  };

  await load([positivesFile, marketsFile]);
  const set = await p.eval(`({ positives: ${S}.read.positives.length, points: (${S}.layers.markets || { points: [] }).points.length,
    layers: ${S}.selectedLayers, play: document.getElementById('em-play').textContent, steps: Number(document.getElementById('em-step').max) + 1 })`);
  check(set.positives === 40 && set.layers.includes('markets') && set.play === 'Play by week' && set.steps >= 12,
    'speed: the speed set loads: 40 positives, the markets layer ticked, a play by week over twelve weeks or more', set);
  const alone = await play();
  check(alone.steps === set.steps && alone.max < 1000,
    'speed: every step of the play redraws in under one second at full size (40 positives against 30,000 points)', alone);

  await load([positivesFile, marketsFile, MASTER]);
  const masterRows = await p.eval(`${S}.master ? ${S}.master.physicalRows : 0`);
  check(masterRows === 50000, 'speed: the 50,000-row CVI master loads beside them', masterRows);
  const withMaster = await play();
  check(withMaster.steps === set.steps && withMaster.max < 1000,
    'speed: with the 50,000-row master loaded, every step still redraws in under one second', withMaster);

  await p.click(`document.getElementById('show-cvi').click()`);
  await p.waitFor(`${S}.cviRes && ${S}.cviRes.status === 'ok'`, 60000, 'CVI result');
  const onTab = await play();
  check(onTab.steps === set.steps && onTab.max < 1000 && !onTab.cviWhilePlaying,
    'speed: with the CVI movements tab open, every step redraws in under one second; the query waits for the play to stop', onTab);
  const cviMs = await p.eval(`(() => { const t = performance.now(); ${S}.cviKey = null; document.getElementById('show-inside').click();
    document.getElementById('show-cvi').click(); return performance.now() - t; })()`);
  console.log(`  speed: steps ${set.steps}; slowest step ${alone.max} ms alone, ${withMaster.max} ms with the master, ${onTab.max} ms on the CVI tab; the CVI query over 50,000 rows ${Math.round(cviMs)} ms`);
  await p.click(`document.getElementById('show-inside').click()`);
}

// The map picture (PNG): its controls under More options, the download at 200 and 300 dpi (the file's own size and
// dpi read from its bytes), the model's title, file name, boxes and rings, miles, a paused play's date, the screwworm
// outbreak's zones. Copies of the pictures in local-test-artifacts/em/png/ for a look. Tile backgrounds are checked in
// the unit suite (a request outside the site fails every part).
async function partPng(b) {
  const p = b.page, S = 'WSDA.emergency.state', OUTP = path.join(OUT, 'png'), DL = path.join(OUT, 'download');
  const samplePath = path.join(OUT, 'sample', 'emergency_synthetic.zip');
  fs.rmSync(OUTP, { recursive: true, force: true });
  fs.mkdirSync(OUTP, { recursive: true });
  fs.rmSync(DL, { recursive: true, force: true });
  fs.mkdirSync(DL, { recursive: true });
  const open = async () => {
    await p.goto(new URL('emergency/index.html', SITE).href);
    await p.waitFor(`window.WSDA && WSDA.emergency && ${S}.map.ready`, 20000, 'Emergency map ready');
  };
  const load = async files => {
    const v = await p.eval(`${S}.version`);
    await p.setFiles('#files-input', files);
    await emReady(p, v);
    await p.waitFor(`${S}.map.drawn && ${S}.map.drawn.positives > 0`, 15000, 'map drawn');
  };
  const pick = (id, value) => p.eval(`(() => { const s = document.getElementById('${id}'); s.value = '${value}';
    s.dispatchEvent(new Event('change')); return true; })()`);
  // One click of "Map picture (PNG)": the file saved, its bytes' size and dpi, and the page's model.
  const picture = async keep => {
    const download = new Promise(res => {
      let name = null;
      const t = setTimeout(() => { b.listeners.splice(b.listeners.indexOf(h), 1); res({ state: 'timeout', name }); }, 60000);
      const h = m => {
        if (m.method === 'Browser.downloadWillBegin') name = m.params.suggestedFilename;
        if (m.method === 'Browser.downloadProgress' && (m.params.state === 'completed' || m.params.state === 'canceled')) {
          clearTimeout(t); b.listeners.splice(b.listeners.indexOf(h), 1); res({ state: m.params.state, guid: m.params.guid, name });
        }
      };
      b.listeners.push(h);
    });
    const was = await p.eval(`(${S}.lastPng || {}).bytes || 0`);
    await p.click(`document.getElementById('em-png').click()`);
    const d = await download;
    await p.waitFor(`!document.getElementById('em-png').disabled`, 60000, 'picture drawn');
    const bytes = d.state === 'completed' ? fs.readFileSync(path.join(DL, d.guid)) : Buffer.alloc(0);
    if (keep && bytes.length) fs.writeFileSync(path.join(OUTP, keep + '.png'), bytes);
    const at = bytes.indexOf('pHYs');
    const info = { name: d.name, state: d.state, png: bytes.subarray(1, 4).toString() === 'PNG',
      width: bytes.length > 24 ? bytes.readUInt32BE(16) : 0, height: bytes.length > 24 ? bytes.readUInt32BE(20) : 0,
      ppm: at > 0 ? bytes.readUInt32BE(at + 4) : 0, was };
    const st = await p.eval(`(() => { const l = ${S}.lastPng || {}, m = l.model || {};
      return { title: m.title, fileName: m.fileName, meta: m.meta, stats: m.stats, boxes: (m.boxes || []).map(x => [x.label, x.value]),
        rings: (m.rings || []).map(r => r.color), zones: (m.rings || []).filter(r => r.zone).length, key: (m.keyItems || []).map(i => i.label),
        panel: ((m.panel || {}).rows || []).map(r => (r.names || [r.name]).join(' ')), footer: m.footer, dpi: l.dpi, size: l.size, notices: l.notices,
        cvi: (m.cviPremises || []).map(q => q.end), keyMode: m.keyMode, keyFits: m.keyFits, keyShown: m.keyShown, panelH: m.panelH,
        layersIn: (m.facilities || []).length, keyCounts: (m.keyItems || []).map(i => i.label + (i.count ? ' ' + i.count : '')),
        line: document.getElementById('em-export-result').textContent }; })()`);
    return Object.assign(info, st);
  };
  await b.send('Browser.setDownloadBehavior', { behavior: 'allowAndName', downloadPath: DL, eventsEnabled: true });
  const today = await p.eval(`(() => { const d = new Date(), two = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate()); })()`);

  // The controls: the button under Export, its options above them, in "Export & Preview" at the sidebar's end (closed).
  await open();
  await load([samplePath]);
  const ctl = await p.eval(`(() => { const f = document.getElementById('export-fold');
    return { button: document.getElementById('em-png').textContent.trim(), nextToExport: document.getElementById('em-png').previousElementSibling.id,
      inOptions: !!f && f.contains(document.getElementById('em-png')) && f.contains(document.getElementById('em-png-background'))
        && f.parentElement.matches('aside') && !f.nextElementSibling && f.querySelector('summary').textContent === 'Export & Preview'
        && !document.querySelector('.em-main #em-export'), closed: !!f && !f.open,
      backgrounds: Array.from(document.getElementById('em-png-background').options).map(o => o.textContent),
      resolutions: Array.from(document.getElementById('em-png-resolution').options).map(o => o.textContent),
      quality: document.getElementById('em-png-quality-field').hidden, provider: document.getElementById('em-png-provider').hidden }; })()`);
  check(ctl.button === 'Map picture (PNG)' && ctl.nextToExport === 'em-export' && ctl.inOptions && ctl.closed
    && same(ctl.backgrounds, ['Default', 'Satellite', 'Shaded Relief', 'Hillshade'])
    && same(ctl.resolutions, ['Standard (200 dpi)', 'High (300 dpi)']) && ctl.quality && ctl.provider,
  'png: "Map picture (PNG)" under Export, both with the picture\'s options in "Export & Preview", closed, the sidebar\'s last section (Default and the tile backgrounds, 200 or 300 dpi); quality and provider hidden for Default', ctl);
  await pick('em-png-background', 'raster:esri_satellite');
  const sat = await p.eval(`({ quality: document.getElementById('em-png-quality-field').hidden,
    provider: document.getElementById('em-png-provider').textContent })`);
  check(!sat.quality && /Esri/.test(sat.provider), 'png: a tile background shows the quality picker and where its tiles come from', sat);
  await pick('em-png-background', 'standard');

  // The HPAI sample at 200 dpi.
  let v = await picture('hpai_sample_200dpi');
  check(v.state === 'completed' && v.name === 'emergency_hpai_' + today + '.png' && v.png && v.width === 2200 && v.height === 1700
    && v.ppm === 7874 && v.dpi === 200, 'png: the picture saves as emergency_hpai_<date>.png, 2200 x 1700 pixels at 200 dpi', v);
  check(v.title === 'HPAI RESPONSE MAP' && v.meta.left === 'Zones: Infection zone 3 km (1.9 mi), Control zone 10 km (6.2 mi)'
    && v.meta.right.indexOf('As of Oct 5, 2026 · Last Updated: ') === 0 && v.stats.left[0].value === 'Jul 15, 2026 and Oct 5, 2026',
  'png: the title from the type, the zones, "As of" and the detection window', [v.title, v.meta, v.stats]);
  check(same(v.boxes.slice(0, 1), [['Current positives', '6']]) && v.boxes[1][0] === 'Sites inside' && v.boxes.length === 2
    && same(v.footer, [['Positives with a site inside', '6 of 6']]) && v.rings.length === 12
    && v.rings.filter(c => c === '#cb181d').length === 6 && v.panel.length === 6 && v.key[1] === 'Confirmed positive'
    && v.key.includes('Control zone (10 km / 6.2 mi)') && /^Saved emergency_hpai_.*blocked the download\.$/.test(v.line),
  'png: the boxes, the rings in the type\'s colors, one panel row per positive with zones, the key; the line under Export', v);
  // 300 dpi, then miles.
  await pick('em-png-resolution', 'high');
  v = await picture();
  check(v.width === 3300 && v.height === 2550 && v.ppm === 11811 && v.dpi === 300, 'png: High: 3300 x 2550 pixels at 300 dpi', v);
  await pick('em-png-resolution', 'standard');
  await p.click(`document.getElementById('em-unit-mi').click()`);
  v = await picture();
  check(v.meta.left === 'Zones: Infection zone 1.86 mi (3 km), Control zone 6.21 mi (10 km)' && v.key.includes('Control zone (6.21 mi / 10 km)'),
    'png: with miles shown, the zones and the key in miles first, km after', [v.meta.left, v.key]);
  await p.click(`document.getElementById('em-unit-km').click()`);
  // A paused play: the picture shows the date shown.
  await p.eval(`document.getElementById('positives-fold').open = true; true`);
  await p.click(`document.getElementById('em-play').click()`);
  await p.eval(`(() => { const i = document.getElementById('em-step'); i.value = '7'; i.dispatchEvent(new Event('input')); return true; })()`);
  const shown = await p.eval(`${S}.window.end`);
  v = await picture();
  check(shown === '2026-09-05' && v.stats.left[0].value === 'Jul 15, 2026 and Sep 5, 2026' && v.meta.right.indexOf('As of Sep 5, 2026') === 0
    && same(v.boxes[0], ['Current positives', '2']), 'png: during a paused play the picture shows the week shown (Sep 5, two current positives)', [shown, v.stats, v.boxes]);

  // With the small CVI master: the CVI premises in a zone drawn and named in the key with the CVI tab's years.
  await open();
  await load([samplePath, path.join(TABLES, 'em_cvi_master.csv')]);
  await p.click(`document.getElementById('em-past').click()`);
  await p.click(`document.getElementById('em-past-rings').click()`);
  v = await picture('hpai_cvi_master_200dpi');
  const head = v.keyCounts.find(l => /^CVI PREMISES/.test(l)) || '';
  check(same(v.boxes.slice(2), [['CVIs in or out', v.boxes[2] && v.boxes[2][1]], ['Animals moved', v.boxes[3] && v.boxes[3][1]]])
    && Number(v.boxes[2][1]) > 0 && /^CVI PREMISES, \d{4}(–\d{4}|(, \d{4})*)$/.test(head) && v.cvi.length > 0
    && v.keyCounts.includes('Origin in a zone ' + v.cvi.filter(e => e === 'origin').length)
    && v.keyCounts.includes('Destination in a zone ' + v.cvi.filter(e => e === 'destination').length),
  'png: with a CVI master: "CVIs in or out" and "Animals moved"; the CVI premises in a zone drawn and counted under "CVI PREMISES" with the years', [v.boxes, v.keyCounts, v.cvi]);
  check(v.keyMode === 'one' && v.keyShown.length === v.layersIn && v.layersIn >= 6 && v.panelH < 0.46,
    'png: a master and past positives shown: the key lists every layer, taking room from the POSITIVES panel', [v.keyMode, v.keyFits, v.keyShown, v.layersIn, v.panelH]);

  // The synthetic screwworm outbreak: its type, its dispersal areas.
  await open();
  await load([path.join(TABLES, 'em_nws_synthetic.zip')]);
  v = await picture('nws_synthetic_200dpi');
  check(v.name === 'emergency_nws_' + today + '.png' && v.title === 'NEW WORLD SCREWWORM RESPONSE MAP' && v.zones === 2
    && /^Zones: /.test(v.meta.left) && v.key.includes('Zone (from file)') && same(v.panel, ['Synthetic dispersal area: Klickitat (made up)',
      'Synthetic dispersal area: Yakima and Tri-Cities (made up)']) && same(v.boxes[0], ['Current positives', '8']) && v.panel.length === 2 && same(v.footer, [['Zones with a site inside', '2 of 2']]),
  'png: the screwworm outbreak: its title and file name, its two dispersal areas as zones (their names whole, on two lines), eight current positives', v);
  await b.send('Browser.setDownloadBehavior', { behavior: 'default' });
  fs.rmSync(DL, { recursive: true, force: true });
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
      else if (part === 'e1b') await partE1b(b);
      else if (part === 'png') await partPng(b);
      else if (part === 'chart') await partChart(b);
      else if (part === 'speed') await partSpeed(b);
      else check(false, 'unknown part ' + part);
    }
  } catch (e) {
    check(false, 'run aborted', String(e && e.stack || e));
  }
  check(b.log.exceptions.length === 0, 'no exceptions', b.log.exceptions);
  check(b.log.csp.length === 0, 'no policy reports', b.log.csp);
  // The picture parts' own pages and pictures (local files the test writes) are not the site's requests.
  const BOARDS_URL = pathToFileURL(BOARDS_DIR).href;
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
