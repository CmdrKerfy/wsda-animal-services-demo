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
//   e1b    E1b on the page: closed positives hidden, shown faded and with their rings; the status list hidden without a
//          status column; the two time views (2.5: On a day on today, Between dates from the first detection to
//          today, each keeping its dates, the switch by real key presses, the badge, the boxes per view); the play
//          by week in each view (start, pause, the slider, the last step on the day, a step under one second, the CVI
//          movements waiting) and by month; km | miles; the
//          zone hover with days since; the "Zones" list; the rows not mapped; two positives at one spot; the
//          synthetic screwworm outbreak and the switch to HPAI; the density limits; 320 pixels wide
//   png    the map picture: its controls under More options, the download at 200 and 300 dpi (size and dpi read from the
//          file), the title, file name, boxes, rings and key, miles, a paused play's date, the screwworm outbreak's
//          zones; copies in local-test-artifacts/em/png/
//   chart  the chart "Positives over time": one column per week to today with each dated, mapped positive counted
//          once, the day's line or the dates' band (2.5), a click and the keyboard moving the day or making the dates
//          that week, the picked column again giving the opening dates, the hover box, the line following the play, the
//          screwworm outbreak by week, 320 pixels wide; pictures in
//          local-test-artifacts/em/chart/
//   draw   2.6, "Draw a zone", by real input on the map: the fold's buttons, the clicks (a corner each), the live
//          label (distance, area, "Sides can't cross" in crimson), a crossing click refused, Backspace and "Undo
//          corner", a double-click finishing with the map's zoom unchanged, a click on the first corner, Enter, Esc;
//          the zones in place of the rings (and back when unticked, or when the last zone goes), the hover, the legend
//          row, the fold's summary, the name box (a name taken refused), Edit by dragging a corner and a side's middle
//          (a crossing drag going back), Remove; the rectangle and the square (centered on a positive's mark); drawing
//          and "Add a point" never together; a background change keeping the sketch; the Overview's chart; the
//          picture; the Export's zones.geojson, zones.csv and export_params.json, the zones.geojson reopened under
//          "Use a zone file" giving the same results; the browser's "Leave this page?"; touch taps; 320 pixels wide
//   filter 2.7, the animal filter by real clicks on its ticks: each kind left out leaves the map, the boxes, the
//          legend, the zones' days since, "Inside the zones", the badges, the summary, the picture's line and the Export;
//          none ticked says so; every kind ticked again at each load; no ticks for a file with one kind
//   speed  the one-second step at full size: 40 positives against 30,000 points, every step of a whole play timed by
//          the page's own hook, without a master, with the 50,000-row synthetic master (make_scale_master.js) and with
//          the CVI movements tab open
// Every part: no exception, no policy report, no request outside the site. "Today" is fixed at Oct 30, 2026 (TODAY).
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
// "Today" fixed for every page (2.5; app.js todayIso reads it), so no result depends on the day the suite runs.
const TODAY = '2026-10-30';
const FIXED_TODAY = 'window.WSDA_EMERGENCY_TODAY = ' + JSON.stringify(TODAY) + ';';
const PAGE = process.env.EM_PAGE_URL || pathToFileURL(path.join(ROOT, 'site', 'index.html')).href;
const SITE = new URL('.', PAGE).href;
const CHROME = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ALL_PARTS = ['load', 'page', 'results', 'e1b', 'png', 'chart', 'view', 'overview', 'draw', 'filter', 'speed'];
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
  const log = { requests: [], exceptions: [], csp: [], dialogs: [] };
  const watch = sid => listeners.push(m => {
    if (m.sessionId !== sid) return;
    if (m.method === 'Network.requestWillBeSent') log.requests.push(m.params.request.url);
    // A dialog (2.6: the browser's "Leave this page?" while drawn zones exist) is recorded and accepted.
    else if (m.method === 'Page.javascriptDialogOpening') {
      log.dialogs.push(m.params.type);
      send('Page.handleJavaScriptDialog', { accept: true }, sid).catch(() => null);
    }
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
  await send('Page.addScriptToEvaluateOnNewDocument', { source: FIXED_TODAY }, sid);
  // Tabs opened later (by the page or by the test) are attached paused, so nothing they request is missed.
  const opened = [];
  listeners.push(async m => {
    if (m.method !== 'Target.attachedToTarget' || m.sessionId || m.params.targetInfo.type !== 'page') return;
    const s2 = m.params.sessionId;
    watch(s2);
    for (const d of DOMAINS) await send(d, {}, s2);
    await send('Page.addScriptToEvaluateOnNewDocument', { source: FIXED_TODAY }, s2);
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
// lines, help notes, labels or the checklist; nor, from 2.4, CVI's warning under "Optional Filename" not to type a
// person's name or a case number, a warning shown as CVI shows it).
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
      .filter(p => shown(p) && !p.closest('.status, [role=status], [role=alert], .help-note, .name-note, #load-results, #em-legend, .count-card, label, fieldset, .maplibregl-map, .em-results')
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
    show: s.show, layers: s.selectedLayers, rows: s.result && s.result.rows.length,
    sums: ['load-summary', 'positives-sum', 'layers-sum'].map(id => document.getElementById(id).textContent) }; })()`);
  check(same(st.folds, [false, false, false, false]), 'page: after a clean load every fold is closed (the map and boxes show first)', st.folds);
  check(st.show === 'rings' && st.data.zones === 12 && st.drawn.positives === 6 && st.drawn.inside > 0 && st.drawn.outside > 0,
    'page: HPAI\'s rings (two around each of six positives; the sample\'s zone file waits for the switch); six current positives (the past one hidden); sites inside highlighted and others faded', st);
  check(st.boxes[0] === '6Active' && st.boxes[1] === '1Closednone under quarantine'
    && st.lines === null
    && st.boxes[2] === 'Oct 5, 2026Last positiveAs of Oct 30, 2026' && /^\d+Sites inside the zones/.test(st.boxes[3]),
  'page: the value boxes On a day, on today (Oct 30, 2026, fixed), each count once (the active positives, "with zones" only when it differs; the closed one, none under quarantine; the last positive, written "Oct 5, 2026", as of the day; sites inside); no line under them (the animals are the Overview\'s box since 2.3)', [st.boxes, st.lines]);
  check(same(st.layers, ['poultry', 'premises', 'markets', 'fairgrounds', 'disposal', 'milkproducer', 'feedlots']),
    'page: the type\'s suggested layers ticked first (poultry and cattle positives; no milk processing file in the sample)', st.layers);
  check(same(st.sums, ['positives, 7 facility files and a zone file', '3\u00a0and\u00a010\u00a0km rings, closed hidden', '7 layers']),
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
  await p.click(`document.getElementById('em-zone-fold').open = true; document.querySelector('#em-show [data-show="zones"]').click()`);
  await p.waitFor("WSDA.emergency.state.show === 'zones'", 5000, 'zone file');
  const zoned = await p.eval(`({ zones: WSDA.emergency.state.mapData.zones, rows: WSDA.emergency.state.result.rows.map(r => r.name),
    sum: document.getElementById('positives-sum').textContent, legend: document.getElementById('em-legend-content').textContent })`);
  check(zoned.zones === 1 && zoned.sum === 'zones from a file, closed hidden' && /Synthetic control area/.test(zoned.legend),
    'page: Zones (the switch) draws the control area in place of the rings, named in the legend', zoned);
  await shot('sample_1280_zonefile');
  await p.click(`document.querySelector('#em-show [data-show="rings"]').click()`);
  await p.waitFor("WSDA.emergency.state.show === 'rings'", 5000, 'rings');
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
    document.querySelector('.tool-switch[aria-label="Results"]').scrollIntoView(); true`);
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
  const S = 'WSDA.emergency.state';
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
  // The sample with a CVI master: the tick "CVI movements" (3c), off at the load: nothing of the CVI anywhere.
  await loadPage([samplePath, T('em_cvi_master.csv')]);
  const cviState = () => p.eval(`(() => { const s = ${S}, g = id => document.getElementById(id);
    return { shown: !g('em-cvi-field').hidden, on: g('em-cvi').checked, sum: g('layers-sum').textContent, map: s.mapData.cvi, drawn: s.map.drawn.cvi,
      legend: [...document.querySelectorAll('#em-legend-content p')].map(x => x.textContent).filter(x => /CVI|in a zone$/.test(x)),
      gate: g('cvi-gate').hidden ? null : g('cvi-gate').textContent, body: !g('cvi-body').hidden }; })()`);
  await p.click(`document.getElementById('show-cvi').click()`);
  const cviOff = await cviState();
  check(cviOff.shown && !cviOff.on && !/CVI/.test(cviOff.sum) && cviOff.map === 0 && cviOff.drawn === 0 && !cviOff.legend.length && !cviOff.body
    && cviOff.gate === 'CVI movements are off: tick "CVI movements" under "Layers to check" to include them.',
  'results: with a CVI master loaded, the tick "CVI movements" shows, off: no CVI premises on the map or in the legend; the tab says how to turn them on (3c)', cviOff);
  const exportOff = await p.eval(`(async () => { const s = ${S}, n = s.exported || 0, keep = WSDA.sample.download; WSDA.sample.download = function () {};
    document.getElementById('em-export').click();
    for (let i = 0; i < 100 && (s.exported || 0) === n; i++) await new Promise(r => setTimeout(r, 100));
    WSDA.sample.download = keep;
    const files = (s.lastExport || []).filter(e => !e.dir), params = files.find(e => e.name.endsWith('export_params.json'));
    return { names: files.map(e => e.name.slice(e.name.indexOf('/') + 1)), params: params ? JSON.parse(params.data) : null }; })()`);
  check(!exportOff.names.includes('cvi_movements.csv') && exportOff.names.includes('zones.geojson') && exportOff.params
    && exportOff.params.cvi_movements === 'off' && exportOff.params.cvi_master === 'em_cvi_master.csv' && same(exportOff.params.cvi_years, {})
    && same(exportOff.params.cvi_quarters, {}) && same(exportOff.params.cvi_species_groups, {}),
  'results: the tick off, the Export has no cvi_movements.csv and export_params.json says cvi_movements "off" (3c)',
    [exportOff.names, Object.fromEntries(Object.entries(exportOff.params || {}).filter(([k]) => /cvi/.test(k)))]);
  await p.eval(`document.getElementById('layers-fold').open = true; true`);
  // A real click on the tick (the label's box, as a person clicks it).
  const tickAt = await p.eval(`(() => { const e = document.getElementById('em-cvi'); e.scrollIntoView({ block: 'center' });
    const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
  await b.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: tickAt.x, y: tickAt.y, button: 'left', buttons: 1, clickCount: 1 }, p.sid);
  await b.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: tickAt.x, y: tickAt.y, button: 'left', buttons: 0, clickCount: 1 }, p.sid);
  await p.waitFor(`${S}.mapData.cvi > 0`, 10000, 'CVI premises drawn');
  await p.eval('scrollTo(0, 0); true');
  const cviOnNow = await cviState();
  check(cviOnNow.on && /, CVI movements$/.test(cviOnNow.sum) && cviOnNow.map === 4 && cviOnNow.drawn === 4 && cviOnNow.body && cviOnNow.gate === null
    && same(cviOnNow.legend, ['CVI premises', 'Origin in a zone', 'Destination in a zone']),
  'results: ticked, the map draws the four CVI premises with an end in a zone, the legend names them and the fold\'s summary says so (3c)', cviOnNow);
  const cviColors = await p.eval(`${S}.map.em.cvi.features.map(f => f.properties.label.split('\\n')[1].split(' ')[0] + ' ' + f.properties.color).sort()`);
  check(same(cviColors, ['Destination #1C9CD9', 'Destination #1C9CD9', 'Origin #F0A06E', 'Origin #F0A06E']),
    'results: the CVI premises in the picture\'s colors, an origin orange and a destination blue (3c)', cviColors);
  // The hover close in (at the whole view the origin lies under SYN-HPAI-001's mark), the view put back after.
  const cviTip = await p.eval(`(async () => { const st = ${S}.map, f = st.em.cvi.features.find(x => x.properties.label.includes('Origin'));
    const was = { center: st.map.getCenter(), zoom: st.map.getZoom() }, idle = () => new Promise(r => st.map.once('idle', r));
    st.map.jumpTo({ center: f.geometry.coordinates, zoom: 13 }); await idle();
    const q = st.map.project(f.geometry.coordinates), h = st.hoverAt([q.x, q.y]);
    st.map.jumpTo(was); await idle(); return h ? h.items[0] : null; })()`);
  check(same(cviTip, { head: 'CVI premises', lines: ['Origin in a zone · Yakima, WA', '1 CVI: EM-0001'] }),
    'results: the hover on a CVI premises: its end, its place and its CVIs\' numbers, as the CVI movements table writes them (3c, 3d)', cviTip);
  // 3d: the rings small at the state's view and full size close in: a point 9 pixels from a ring's middle is on it
  // at zoom 12 (radius 10 and its line), off it at zoom 6 (0.4 of that).
  const ringAt = await p.eval(`(async () => { const st = ${S}.map, f = st.em.cvi.features[0], idle = () => new Promise(r => st.map.once('idle', r));
    const was = { center: st.map.getCenter(), zoom: st.map.getZoom() }, out = {};
    for (const z of [6, 12]) {
      st.map.jumpTo({ center: f.geometry.coordinates, zoom: z }); await idle();
      const q = st.map.project(f.geometry.coordinates);
      out['z' + z] = st.map.queryRenderedFeatures([q.x + 9, q.y], { layers: ['em_cvi'] }).length > 0;
    }
    st.map.jumpTo(was); await idle(); return out; })()`);
  check(ringAt.z12 && !ringAt.z6, 'results: the CVI rings small at the state\'s view and full size close in (3d)', ringAt);
  let cvi = await p.eval(`({ line: (document.querySelector('#cvi-result .result-line') || {}).textContent, rows: document.querySelectorAll('#cvi-result tbody tr').length,
    cvis: Array.from(document.querySelectorAll('#cvi-result tbody tr')).map(r => r.cells[0].textContent) })`);
  check(cvi.line === '3 CVIs, 1,265 animals, left from or arrived inside the zones: 2 origins and 2 destinations inside.'
    && same(cvi.cvis.sort(), ['EM-0001', 'EM-0002', 'EM-0003']), 'results: the CVI movements that left from or arrived inside the zones, counted as Premise Lookup counts them', cvi);
  await p.click(`document.querySelector('#cvi-years input[value="2026"]').click()`);
  cvi = await p.eval(`({ line: (document.querySelector('#cvi-result .result-line') || {}).textContent, cvis: Array.from(document.querySelectorAll('#cvi-result tbody tr')).map(r => r.cells[0].textContent) })`);
  check(same(cvi.cvis, ['EM-0003']) && /^1 CVI, 25 animals/.test(cvi.line), 'results: unticking 2026 leaves the 2025 movement', cvi);
  const oneYear = await p.eval(`${S}.mapData.cvi`);
  check(oneYear === 2, 'results: the year filter redraws the map\'s CVI premises: the 2025 movement\'s two ends (3c)', oneYear);
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
  check(/^\d{4}-\d\d-\d\d_Emergency\.zip$/.test(d.name || '') && same(Object.keys(files).sort(), ['counties.csv', 'cvi_movements.csv',
    'export_params.json', 'inside_the_zones.csv', 'layers.csv', 'left_out.csv', 'positives.csv', 'zones.csv', 'zones.geojson']),
  'results: Export saves one ZIP with the nine files (counties.csv since 2.3)', [d, Object.keys(files)]);
  const cl = (files['counties.csv'] || '').trim().split('\n');
  check(cl.length === 7 && /^"?County"?,"?Active"?,"?Closed"?,"?Total"?,"?Birds at the active positives"?,"?Cattle at the active positives"?,"?Active positives without a count"?$/.test(cl[0])
    && /^"?Yakima"?,2,0,2,\d{7},0,0$/.test(cl[1]) && /^"?Snohomish"?,0,1,1,,,0$/.test(cl[6]),
  'results: counties.csv: the Overview\'s counties table in the words Active and Closed, the exact animal totals, blank where none is active', cl);
  let geo = null;
  try { geo = JSON.parse(files['zones.geojson'] || ''); } catch (e) { geo = null; }
  const feats = geo ? geo.features : [];
  check(geo && geo.type === 'FeatureCollection' && feats.length === 12 && feats.every(f => f.properties.group === 'Active')
    && same(Object.keys(feats[0].properties), ['name', 'zone', 'positive', 'group', 'distance', 'unit', 'days_since_last_positive', 'as_of'])
    && /^(Infection|Control) zone \((3|10) km\) around SYN-HPAI-\d{3}$/.test(feats[0].properties.name)
    && feats.every(f => f.geometry.coordinates[0].length === 361) && feats[0].properties.as_of === '2026-10-30',
  'results: zones.geojson: the two rings around each of the six active positives, whole circles, with their properties (group Active, as of the day)', feats.slice(0, 1));
  const zl = (files['zones.csv'] || '').trim().split('\n');
  check(zl.length === 7 && /^"?Zone"?,"?Positive"?,"?Ring"?,"?Distance"?,"?Unit"?,"?Last positive"?,"?Days since the last positive"?,"?As of"?/.test(zl[0])
    && /Control zone \(10 km\) around SYN-HPAI-007/.test(zl[1]), 'results: zones.csv: one row per positive\'s outer ring, the most recent first', zl.slice(0, 2));
  const params = files['export_params.json'] ? JSON.parse(files['export_params.json']) : {};
  check(params.tool === 'emergency_response' && /^rings Infection zone 3 km, Control zone 10 km$/.test(params.zones)
    && params.data_note === 'Synthetic sample data' && params.positives === 7 && params.unit === 'km' && params.as_of === '2026-10-30'
    && params.view === 'on a day' && params.day === '2026-10-30' && !('detected_between' in params) && params.closed_shown === false
    && !('past_shown' in params),
  'results: export_params.json says what was exported: the view On a day and its day (today), the unit, the as-of date, closed_shown', params);
  check(params.cvi_movements === 'included' && same(params.cvi_years, [2025, 2026]), 'results: ticked, export_params.json says cvi_movements "included" with the years (3c)',
    [params.cvi_movements, params.cvi_years]);
  check(/^"?Positive"?,/.test(files['positives.csv'] || '') && (files['positives.csv'] || '').split('\n').length === 9
    && /^"?CVI"?,/.test(files['cvi_movements.csv'] || '') && !/Origin\.Address/.test(files['cvi_movements.csv'] || ''),
  'results: the CSVs: seven positives; the CVI rows without the address column', [files['positives.csv'], (files['cvi_movements.csv'] || '').split('\n')[0]]);
  check(/Exported \d{4}-\d\d-\d\d_Emergency\.zip/.test(await p.eval(`document.getElementById('em-export-result').textContent`)),
    'results: the line under Export says what was saved');
  await b.send('Browser.setDownloadBehavior', { behavior: 'default' });
  fs.rmSync(DL, { recursive: true, force: true });
  // 3c: the same files loaded again on the same page, the tick on: it starts off again.
  const v0 = await p.eval(`${S}.version`);
  await p.setFiles('#files-input', [samplePath, T('em_cvi_master.csv')]);
  await p.waitFor(`${S}.version > ${v0}`, 20000, 'loaded again');
  await emReady(p);
  const reloaded = await cviState();
  check(!reloaded.on && reloaded.map === 0 && !reloaded.legend.length && /^CVI movements are off/.test(reloaded.gate || ''),
    'results: the files loaded again on the same page, the tick "CVI movements" is off again: no premises, no legend rows, the tab says so (3c)', reloaded);
  // 3c: a spot that is both an origin and a destination, at a market inside the zones: two rings, the hover naming
  // both ends and the market under them.
  const both = path.join(OUT, 'cvi_master_both_ends.csv');
  fs.writeFileSync(both, ['CVI,Species.Group,Species,Reporting.Year,Reporting.Quarter,Movement,Total.Animals,Origin.State,Origin.County,Origin.County.Lat,Origin.County.Long,Dest.State,Dest.County,Dest.County.Lat,Dest.County.Long,Origin.City,Origin.Lat,Origin.Long,Dest.City,Dest.Lat,Dest.Long',
    'EM-B1,Poultry,Chickens,2026,Q3,Outbound,100,WA,Yakima,46.5,-120.5,OR,Multnomah,45.5,-122.6,Synthetic Town,46.53049,-120.55592,Synthetic Town,45.5,-122.6',
    'EM-B2,Poultry,Chickens,2026,Q3,Inbound,50,ID,Ada,43.6,-116.2,WA,Yakima,46.5,-120.5,Synthetic Town,43.6,-116.2,Synthetic Town,46.53049,-120.55592'].join('\n') + '\n');
  await loadPage([samplePath, both]);
  await p.click(`document.getElementById('em-cvi').click()`);
  const twoEnds = await p.eval(`(async () => { const st = ${S}.map, f = st.em.cvi.features;
    const idle = () => new Promise(r => st.map.once('idle', r));
    st.map.jumpTo({ center: [-120.55592, 46.53049], zoom: 13 }); await idle();
    const q = st.map.project([-120.55592, 46.53049]), h = st.hoverAt([q.x, q.y]);
    return { rings: f.map(x => x.properties.r).sort(), items: h ? h.items.map(i => i.head + ' / ' + i.lines.join(' / ')) : null }; })()`);
  check(same(twoEnds.rings, [10, 14]) && twoEnds.items && twoEnds.items.length === 3
    && same(twoEnds.items.slice(0, 2).sort(), ['CVI premises / Destination in a zone · Yakima, WA / 1 CVI: EM-B2', 'CVI premises / Origin in a zone · Yakima, WA / 1 CVI: EM-B1'])
    && /^Synthetic Valley Market \/ /.test(twoEnds.items[2]),
  'results: a spot both an origin and a destination: two rings, the destination\'s around the origin\'s; the hover names both ends and the site under them (3c)', twoEnds);
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
  await p.click(`document.getElementById('em-cvi').click()`);
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

// The Overview's animals box (2.3): its number and note, read with the Overview shown; then the Map again.
async function overviewAnimals(p) {
  await p.eval(`(document.getElementById('show-overview').click(), true)`);
  await p.waitFor(`WSDA.emergency.state.view === 'overview'`, 5000, 'the Overview shown');
  const a = await p.eval(`(() => { const c = document.getElementById('ov-box-animals');
    return { value: c.querySelector('strong').textContent, note: c.querySelector('.card-note').textContent }; })()`);
  await p.eval(`(document.getElementById('show-map').click(), true)`);
  return a;
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

  // ---- The quarantine status column (2.4): still under quarantine, not known, and a status not read ----
  await open();
  await load([path.join(TABLES, 'em_rules_quarantine.csv')]);
  await tick('em-past');
  await p.waitFor(`${S}.mapData.past > 0`, 5000, 'past shown');
  const qv = await view();
  const qLabels = await p.eval(`${S}.map.em.positives.features.map(f => f.properties.label.split('\\n'))
    .filter(l => /^(Yakima 02|Benton 01|Grant 01)$/.test(l[0])).map(l => l[0] + ': ' + l[2]).sort()`);
  const qTitle = await p.eval(`document.getElementById('box-past').title`);
  check(qv.past === '7 Closed 1 still under quarantine, 2 not known' && qv.quar && /1 quarantine status not read/.test(qv.lines)
    && same(qLabels, ['Benton 01: Closed, quarantine not known', 'Grant 01: Closed', 'Yakima 02: Closed, still under quarantine'])
    && /Quarantine Status/.test(qTitle) && /describes today/.test(qTitle),
  'e1b: the quarantine status table (2.4): the closed box "1 still under quarantine, 2 not known", the status not read named under the boxes, the hovers, the box\'s hover text', [qv.past, qv.lines, qLabels]);

  // ---- The HPAI sample: the agreed table, no status column, one closed positive (released) ----
  await load([samplePath]);
  await p.eval(`document.getElementById('positives-fold').open = true; true`);
  check(await p.eval(`document.getElementById('em-statuses-field').hidden`),
    'e1b: the file has no status column, so the "Zones around" status list is not shown');
  let v = await view();
  check(v.data.positives === 6 && v.data.past === 0 && v.positives === '6 Active' && v.past === '1 Closed none under quarantine' && !v.quar,
    'e1b: closed positives are hidden on the map at first (On a day); the boxes count the six active ones and the closed one, none under quarantine (not in the warning color)', v);
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
  'e1b: each box\'s icon on a tile in its brand color, its edge the same (active crimson, closed eggplant, last positive blue-green, sites inside evergreen)', boxColors);
  check(await p.eval(`document.getElementById('em-past-fold').hidden`), 'e1b: "Closed zones" is hidden until "Show closed positives" is ticked');
  await tick('em-past');
  const rowsBefore = v.rows;
  v = await view();
  check(v.data.positives === 7 && v.data.past === 1 && v.positives === '6 Active' && v.rows === rowsBefore
    && v.legend.includes('Closed (hollow, faded)'),
  'e1b: "Show closed positives" draws the closed one hollow and faded, named in the legend; it never counts or adds sites', v);
  check(!await p.eval(`document.getElementById('em-past-fold').hidden`), 'e1b: ticked, "Closed zones" shows (folded, inside the fold)');
  await p.eval(`document.getElementById('em-past-fold').open = true; true`);
  await tick('em-past-rings');
  v = await view();
  check(v.data.pastZones === 2 && v.rows === rowsBefore && v.legend.includes('Closed zones (dashed)'),
    'e1b: "Draw their rings" draws the closed positive\'s two rings, gray and dashed; no site is added', v);
  await tick('em-past-rings');
  await tick('em-past');
  // The two views (2.5): On a day opens on today (fixed Oct 30, 2026), the file's first detection held.
  const dates = () => p.eval(`({ day: document.getElementById('em-day').value, from: document.getElementById('em-from').value,
    to: document.getElementById('em-to').value, dayRow: !document.getElementById('em-day-row').hidden, rangeRow: !document.getElementById('em-range-row').hidden,
    pressed: ['em-view-day', 'em-view-range'].map(id => document.getElementById(id).getAttribute('aria-pressed')),
    closedTick: !document.getElementById('em-past-label').hidden, badge: document.getElementById('em-badge').textContent,
    badgeIcon: !!document.querySelector('#em-badge svg path'), badgeShown: getComputedStyle(document.getElementById('em-badge')).display !== 'none',
    shown: ['box-detected', 'box-positives', 'box-past', 'box-last', 'box-inside'].filter(id => getComputedStyle(document.getElementById(id)).display !== 'none'),
    detected: document.getElementById('box-detected').innerText.replace(/\\s+/g, ' ').trim(),
    // Anything marked hidden that a style still shows (a box's display: grid once hid nothing; the neighboring
    // regions' counties boxes in "More options" showed from E1a to 2.5).
    hiddenShown: [...document.querySelectorAll('[hidden]')].filter(e => getComputedStyle(e).display !== 'none').map(e => e.id || e.className) })`);
  let tv = await dates();
  check(same(v.window, { view: 'day', start: '2026-07-15', end: '2026-10-30' }) && tv.day === '2026-10-30' && tv.dayRow && !tv.rangeRow
    && same(tv.pressed, ['true', 'false']) && tv.closedTick && tv.badge === 'Oct 30, 2026' && tv.badgeIcon && tv.badgeShown
    && same(tv.shown, ['box-positives', 'box-past', 'box-last', 'box-inside']) && !tv.hiddenShown.length,
  'e1b: after a load the page opens On a day on today: its one date box, the pin badge on the map, the closed tick, the boxes Active, Closed, Last positive, Sites inside (nothing hidden still shown)', [v.window, tv]);
  const layout = await p.eval(`(() => { const w = document.getElementById('em-window-field'), f = document.getElementById('em-past-field');
    return { above: w.getBoundingClientRect().bottom <= f.getBoundingClientRect().top + 1,
      icons: ['em-view-day', 'em-view-range', 'em-day-row', 'em-range-row'].map(id => !!document.querySelector('#' + id + ' svg path')) }; })()`);
  check(layout.above && layout.icons.every(Boolean),
    'e1b: the switch and its dates above "Show closed positives"; the pin and the span drawn on the switch and beside the dates', layout);
  await setDate('em-day', '2026-09-05');
  v = await view();
  let animals = await overviewAnimals(p);
  check(v.data.positives === 2 && v.positives === '2 Active' && v.lines === ''
    && animals.value === '1.2M birds' && animals.note === '2,400 cattle · 2 commercial'
    && v.last === 'Sep 2, 2026 Last positive As of Sep 5, 2026' && /^1 Closed /.test(v.past)
    && (await dates()).badge === 'Sep 5, 2026',
  'e1b: On a day Sep 5 shows the two positives active then, the Franklin dairy among them (the Overview\'s animals theirs); the last positive by then, "As of" the day', [v, animals]);
  // Between dates: its two boxes, from the first detection to today; every positive detected in it, closed ones drawn.
  await tick('em-view-range');
  v = await view();
  tv = await dates();
  check(same(v.window, { view: 'range', start: '2026-07-15', end: '2026-10-30' }) && tv.from === '2026-07-15' && tv.to === '2026-10-30'
    && !tv.dayRow && tv.rangeRow && same(tv.pressed, ['false', 'true']) && !tv.closedTick && v.data.past === 1 && v.data.positives === 7
    && tv.badge === 'Jul 15, 2026 – Oct 30, 2026' && same(tv.shown, ['box-detected', 'box-positives', 'box-past', 'box-inside'])
    && tv.detected === '7 Detected 6 active 1 closed' && v.positives === '6 Active' && !tv.hiddenShown.length,
  'e1b: Between dates opens from the first detection to today: two date boxes, the span badge, Detected 7 (6 active, 1 closed) first, no last positive; the closed one always drawn, its tick hidden (nothing hidden still shown)', [v.window, tv]);
  await setDate('em-from', '2026-09-01');
  v = await view();
  tv = await dates();
  check(tv.detected === '5 Detected 5 active 0 closed' && v.data.positives === 5 && tv.badge === 'Sep 1, 2026 – Oct 30, 2026',
    'e1b: Between Sep 1 and Oct 30: the five detected in it, all active; the Franklin dairy (detected Aug 21) not in it', [tv, v.data]);
  await setDate('em-to', '2026-08-01');
  check(await p.eval(`!document.getElementById('em-window-msg').hidden && document.getElementById('em-to').value === '2026-10-30'`),
    'e1b: a second date before the first is refused, with a message');
  await setDate('em-from', '');
  v = await view();
  check(v.window.start === '2026-07-15' && v.window.end === '2026-10-30', 'e1b: a cleared date box goes back to its opening date', v.window);
  await setDate('em-from', '2026-09-01');
  await tick('em-view-day');
  v = await view();
  check(same(v.window, { view: 'day', start: '2026-07-15', end: '2026-09-05' }), 'e1b: back On a day, its own day kept (Sep 5)', v.window);
  await tick('em-view-range');
  v = await view();
  check(same(v.window, { view: 'range', start: '2026-09-01', end: '2026-10-30' }), 'e1b: back Between dates, its own dates kept', v.window);
  // The switch with the keyboard: real key presses; Tab reaches each button, Enter and Space pick it
  // and the focus stays on it.
  const press = async (k, code, keyCode) => {
    for (const type of ['keyDown', 'keyUp']) {
      await b.send('Input.dispatchKeyEvent', { type, key: k, code, windowsVirtualKeyCode: keyCode, text: type === 'keyDown' ? { Enter: '\r', ' ': ' ' }[k] : undefined }, p.sid);
    }
  };
  await p.eval(`document.getElementById('em-view-range').focus(); true`);
  await press('Tab', 'Tab', 9);
  const afterTab = await p.eval(`document.activeElement.getAttribute('data-help')`);
  await p.eval(`document.getElementById('em-view-day').focus(); true`);
  await press('Enter', 'Enter', 13);
  const byEnter = await p.eval(`[${S}.viewKind, document.activeElement.id, getComputedStyle(document.activeElement).outlineStyle]`);
  await press('Tab', 'Tab', 9);
  await press(' ', 'Space', 32);
  const bySpace = await p.eval(`[${S}.viewKind, document.activeElement.id]`);
  check(afterTab === 'em-time' && same(byEnter.slice(0, 2), ['day', 'em-view-day']) && byEnter[2] !== 'none' && same(bySpace, ['range', 'em-view-range']),
    'e1b: the switch with the keyboard: Enter picks On a day and Space Between dates, the focus staying on the button (its ring shown); Tab goes on to the "?"', [afterTab, byEnter, bySpace]);
  // The play Between dates: the range grows from its first date, one week a step.
  check(v.play === 'Play by week' && v.step === 'Up to Oct 30, 2026 · week 9 of 9', 'e1b: Between Sep 1 and Oct 30, nine weeks to play', v.step);
  await tick('em-play');
  v = await view();
  tv = await dates();
  check(v.playing && same(v.window, { view: 'range', start: '2026-09-01', end: '2026-09-05' }) && v.step === 'Up to Sep 5, 2026 · week 1 of 9'
    && tv.detected === '1 Detected 1 active 0 closed',
  'e1b: Play Between dates starts the range at its first date and ends it on the first week\'s Saturday: Detected counts up', [v.window, tv.detected]);
  await tick('em-play');
  await tick('em-view-day');
  await setDate('em-day', '');
  v = await view();
  check(v.window.end === '2026-10-30', 'e1b: a cleared day goes back to today', v.window);
  // The play On a day: 16 epi weeks from the file's first to today's; the first step ends on its Saturday, the last on the day.
  check(v.play === 'Play by week' && await p.eval(`document.getElementById('em-step').max`) === '15' && v.step === 'Oct 30, 2026 · week 16 of 16'
    && await p.eval(`document.getElementById('em-step').getAttribute('aria-valuetext')`) === v.step,
    'e1b: "Play by week" with a slider over 16 weeks (to today\'s), resting on the last; its label (and the slider\'s spoken value) says the day shown', v);
  await tick('em-play');
  v = await view();
  check(v.playing && v.play === 'Pause' && v.stepAt === 0 && same(v.window, { view: 'day', start: '2026-07-15', end: '2026-07-18' })
    && v.step === 'Jul 18, 2026 · week 1 of 16' && v.data.positives === 1,
  'e1b: Play starts at the first week: the day is its Saturday, the map as the outbreak stood then', v);
  check(v.ms < 1000, 'e1b: a step redraws in under one second (the sample)', v.ms);
  await tick('em-play');
  await sleep(1300);
  const paused = await view();
  check(!paused.playing && paused.play === 'Play by week' && paused.stepAt === v.stepAt, 'e1b: Pause stops the play where it is', paused);
  await p.eval(`(() => { const i = document.getElementById('em-step'); i.value = '6'; i.dispatchEvent(new Event('input')); return true; })()`);
  v = await view();
  check(v.stepAt === 6 && v.window.end === '2026-08-29' && v.step === 'Aug 29, 2026 · week 7 of 16' && (await dates()).day === '2026-08-29',
    'e1b: the slider moves the day to that week\'s Saturday (the date box follows)', v);
  await tick('em-play');
  await p.eval(`(() => { const i = document.getElementById('em-step'); i.value = '3'; i.dispatchEvent(new Event('input')); return true; })()`);
  v = await view();
  check(!v.playing && v.stepAt === 3 && v.window.end === '2026-08-08',
    'e1b: moving the slider while the play runs pauses it on the week chosen', v);
  await tick('em-play');
  await p.waitFor(`!${S}.playing`, 20000, 'play ends');
  v = await view();
  check(v.stepAt === 15 && v.window.end === '2026-10-30' && v.play === 'Play by week' && v.positives === '6 Active',
    'e1b: the play stops on its own at the last step, on the day itself (not its Saturday); no loop', v);
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
  // The population layers are on after each load (2.4): ticked, drawn and in the legend. Turned off here, so the
  // zone hover below reads without the tract, then density is ticked again on its own.
  // A failed wait is a failed check (the part goes on), so a page without the default is caught, not stopped.
  const pcDrawnAfterLoad = await p.waitFor(`['cities', 'places', 'density'].every(l => WSDA.population.loaded(l)) && ${S}.map.map.getLayer('pc-density')`,
    15000, 'population drawn after the load').then(() => true, () => false);
  const pcAfterLoad = await p.eval(`({ drawn: ${pcDrawnAfterLoad}, ticked: Array.from(document.querySelectorAll('#pc-block .pc-on')).filter(b => b.checked).map(b => b.dataset.layer),
    legend: Array.from(document.querySelectorAll('#em-legend-content p')).map(e => e.textContent) })`);
  check(pcAfterLoad.drawn && same(pcAfterLoad.ticked, ['cities', 'places', 'density']) && pcAfterLoad.legend.includes('Population context')
    && pcAfterLoad.legend.includes('City limits (current)') && pcAfterLoad.legend.some(t => /people per/i.test(t)),
  'e1b: after the load the three population layers are on (2.4): ticked, and named in the legend under "Population context"', pcAfterLoad);
  for (const l of ['pc-cities', 'pc-places', 'pc-density']) if (await p.eval(`document.getElementById('${l}').checked`)) await tick(l);
  await p.waitFor(`!document.querySelector('#pc-block .pc-on:checked')`, 5000, 'population off');
  // The "Zones" list and the zone hover.
  const zl = await p.eval(`({ sum: document.querySelector('#tab-inside .em-zones-list summary').textContent,
    rows: Array.from(document.querySelectorAll('#tab-inside .em-zones-list tbody tr')).map(r => Array.from(r.cells).map(c => c.textContent)) })`);
  check(zl.sum === 'Zones: days since the last positive in each positive\'s Control zone (10 km), as of Oct 30, 2026' && zl.rows.length === 6
    && same(zl.rows[0], ['SYN-HPAI-007', 'Oct 5, 2026', '25 days'])
    && same(zl.rows[5], ['SYN-HPAI-003', 'Aug 21, 2026', '70 days']),
  'e1b: "Inside the zones" starts with the "Zones" list: one row per positive (named by it, the ring said once), the dates written out, the longest-quiet zone last', zl);
  await p.eval(`${S}.map.map.fitBounds([[-120.45, 46.33], [-120.18, 46.47]], { animate: false }); true`);
  await sleep(500);
  const at = await p.eval(`(() => { const pt = ${S}.map.map.project([-120.315, 46.415]), r = ${S}.map.map.getCanvas().getBoundingClientRect();
    return { x: pt.x, y: pt.y, px: r.left + pt.x, py: r.top + pt.y, lines: ${S}.map.hoverAt([pt.x, pt.y]) }; })()`);
  check(same(at.lines, { items: [{ head: 'SYN-HPAI-002', lines: ['Infection zone (3 km): 50 days', 'Control zone (10 km): 50 days'] }],
    foot: 'Days since the last positive inside each zone, as of Oct 30, 2026', points: false }),
  'e1b: hovering a zone lists every zone under the pointer, smallest ring first, under its positive\'s name once, each with its days since; then the "as of" date', at.lines);
  await b.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at.px, y: at.py }, p.sid);
  await sleep(300);
  const popup = await p.eval(`(() => { const e = document.querySelector('.maplibregl-popup'); return e ? { text: e.textContent,
    head: (e.querySelector('strong') || {}).textContent, foot: (e.querySelector('.tip-foot') || {}).textContent } : null; })()`);
  check(popup && popup.head === 'SYN-HPAI-002' && /Infection zone \(3 km\): 50 days/.test(popup.text)
    && popup.foot === 'Days since the last positive inside each zone, as of Oct 30, 2026',
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
    r = lg.getBoundingClientRect(), sw = document.querySelector('#em-window-field .ts-switch'), day = document.getElementById('em-day');
    const zones = document.querySelector('#tab-inside .em-zones-list tbody tr'), cells = Array.from(zones.cells).map(c => c.getBoundingClientRect());
    return { open: lg.open, below: r.top >= m.bottom - 1, within: r.left >= m.left - 1 && r.right <= m.right + 1, mapHigh: m.height,
      switchFits: Array.from(sw.querySelectorAll('.btn')).every(e => e.scrollWidth <= e.clientWidth + 1) && sw.getBoundingClientRect().right <= document.getElementById('em-window-field').getBoundingClientRect().right + 1,
      dayFits: day.getBoundingClientRect().right <= document.getElementById('em-window-field').getBoundingClientRect().right + 1,
      head: getComputedStyle(document.querySelector('#tab-inside .em-zones-list thead')).display,
      twoLines: cells[1].top >= cells[0].bottom - 1, said: zones.cells[1].dataset.label, days: zones.cells[2].innerText,
      sum: getComputedStyle(document.getElementById('positives-sum')).display,
      items: Array.from(document.querySelectorAll('#positives-sum .item')).map(e => [e.textContent, getComputedStyle(e).whiteSpace]) }; })()`);
  check(phone.sum === 'block' && phone.items.length >= 2 && phone.items.every(x => x[1] === 'nowrap')
    && phone.items.map(x => x[0]).join(', ') === await p.eval(`document.getElementById('positives-sum').textContent`),
  'e1b: a fold\'s summary on its own line, each item kept whole', phone.items);
  check(phone.open && phone.below && phone.within && phone.mapHigh >= 300,
    'e1b: at 320 pixels wide the legend sits under the map, open, never over it', phone);
  check(phone.switchFits && phone.dayFits, 'e1b: at 320 pixels wide the switch\'s two buttons fit whole, and the day\'s box', phone);
  await tick('em-view-range');
  check(await p.eval(`(() => { const a = document.getElementById('em-from').getBoundingClientRect(), b = document.getElementById('em-to').getBoundingClientRect(),
    f = document.getElementById('em-window-field').getBoundingClientRect(); return b.top > a.bottom - 1 && b.right <= f.right + 1; })()`),
  'e1b: at 320 pixels wide Between dates\' two boxes as two rows, joined by the span\'s bracket');
  await tick('em-view-day');
  await p.eval(`${S}.map.map.resize(); ${S}.map.map.setCenter([-120.315, 46.415]); true`);
  await sleep(600);
  check(phone.head === 'none' && phone.twoLines && phone.said === 'Last positive' && phone.days === '25 days',
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
  // A wide date ("Aug 21, 2026", on Aug 29) fits its box at 320 and 480 pixels (it was cut off at its edge).
  await setDate('em-day', '2026-08-29');
  const fits = [];
  for (const w of [320, 480]) {
    await b.send('Emulation.setDeviceMetricsOverride', { width: w, height: 900, deviceScaleFactor: 1, mobile: true }, p.sid);
    await sleep(300);
    // The text's own right edge against the box's inside edge (the box clips what runs past it).
    fits.push(await p.eval(`(() => { const e = document.querySelector('#box-last strong'), c = e.closest('.count-card'), r = document.createRange();
      r.selectNodeContents(e);
      const right = r.getBoundingClientRect().right, inside = c.getBoundingClientRect().right - parseFloat(getComputedStyle(c).paddingRight);
      return { text: e.textContent, fits: right <= inside + 1, size: getComputedStyle(e).fontSize, right, inside }; })()`));
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
    'e1b: on a wider screen, with one still under quarantine, the closed box\'s tile is gold with a dark-brown icon', boxColors[1]);
  await setDate('em-day', '');
  await b.send('Emulation.setDeviceMetricsOverride', { width: 320, height: 900, deviceScaleFactor: 1, mobile: true }, p.sid);
  await b.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 2, y: 2 }, p.sid);
  await b.send('Emulation.clearDeviceMetricsOverride', {}, p.sid);
  await p.eval(`scrollTo(0, 0); ${S}.map.map.resize(); true`);
  // The CVI movements wait while the play runs.
  await load([samplePath, path.join(TABLES, 'em_cvi_master.csv')]);
  await tick('em-cvi');
  await tick('show-cvi');
  await p.waitFor(`${S}.cviRes && ${S}.cviRes.status === 'ok'`, 10000, 'CVI result');
  const before = await p.eval(`${S}.mapData.cvi`);
  await tick('em-play');
  const during = await p.eval(`({ text: document.getElementById('cvi-result').textContent, playing: ${S}.playing })`);
  check(during.playing && /worked out when the play stops/.test(during.text), 'e1b: while the play runs, the CVI movements wait', during);
  const whilePlaying = await p.eval(`${S}.cviKey !== null ? 'the CVI query ran during the play'
    : [...document.querySelectorAll('#em-legend-content p')].some(x => x.textContent === 'CVI premises') ? 'the legend names CVI premises' : ${S}.mapData.cvi`);
  await tick('em-play');
  // After the stop, the premises for the day shown (the play stops on an early week, so perhaps none are in a zone).
  const after = await p.eval(`(() => { const s = ${S}, e = WSDA.emergencyRules.cviEnds(s.cviRes ? s.cviRes.matched : []);
    return { drawn: s.mapData.cvi, expected: s.cviRes ? e.origins.length + e.dests.length : null, day: s.window.end }; })()`);
  check(before > 0 && whilePlaying === 0 && after.expected !== null && after.drawn === after.expected,
    'e1b: the map\'s CVI premises are not drawn while the play runs and come back for the day shown when it stops (3c)', { before, whilePlaying, after });
  // From the week before the last, so the stop lands on the last week, where the premises are in their zones.
  await p.eval(`(() => { const r = document.getElementById('em-step'); r.value = String(Number(r.max) - 1); r.dispatchEvent(new Event('input')); return true; })()`);
  // The slider at rest first (its own redraw done), so only the play's end can draw the premises again.
  await p.waitFor(`!${S}.sliding`, 3000, 'the slider at rest');
  await sleep(300);
  await tick('em-play');
  await p.waitFor(`!${S}.playing`, 10000, 'the play ends on the last week');
  const late = await p.eval(`${S}.mapData.cvi`);
  check(late > 0, 'e1b: the play ending on the last week by itself, the CVI premises are drawn again (3c)', late);
  check(await p.eval(`!${S}.playing && !!${S}.cviRes && !/worked out when the play stops/.test(document.getElementById('cvi-result').textContent)`),
    'e1b: when the play stops, the CVI movements are worked out for the date shown');
  await tick('show-inside');

  // ---- The agreed-table scenario: more than 26 weeks (by month), two rows not mapped, two positives at one spot ----
  await open();
  await load([path.join(TABLES, 'em_rules_agreed.csv')]);
  v = await view();
  check(v.play === 'Play by month' && v.step === 'Oct 30, 2026 \u00b7 month 24 of 24' && await p.eval(`document.getElementById('em-step').getAttribute('aria-label')`) === 'Month of',
    'e1b: more than 26 weeks to today plays by month ("Oct 30, 2026 · month 24 of 24")', v);
  check(/2 not mapped: 1 no coordinates, 1 latitude and longitude look swapped/.test(v.lines) && v.past === '5 Closed 2 still under quarantine' && v.quar
    && await p.eval(`(() => { const b = document.getElementById('box-past'), note = b.querySelector('.card-note'), n = note.querySelector('b'), last = document.querySelector('#box-last .card-note');
      return getComputedStyle(note).color === getComputedStyle(last).color && getComputedStyle(note).fontWeight === getComputedStyle(last).fontWeight
        && !!n && n.textContent === '2' && getComputedStyle(n).color === 'rgb(56, 37, 19)' && getComputedStyle(n).fontWeight === '600'
        && getComputedStyle(b, '::before').backgroundColor !== getComputedStyle(document.getElementById('box-last'), '::before').backgroundColor; })()`),
  'e1b: the closed box counts those still under quarantine, the number in bold and the warning color with its edge, the rest of the note as the "As of" note; the line names the rows not mapped', [v.past, v.lines]);
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
    && two.items.some(it => it.head === 'Lewis 01' && it.lines[0] === 'Detected Jun 10, 2025' && it.lines[1] === 'Closed')
    && two.items.some(it => it.head === 'Lewis 02' && it.lines[0] === 'Detected Sep 30, 2026'),
  'e1b: two positives at one spot: the hover lists both, each under its name, the closed one marked closed', two);
  animals = await overviewAnimals(p);
  check(animals.value === '1.3M birds' && /^35 cattle · .+ · 1 without a count$/.test(animals.note),
    'e1b: the Overview\'s animals count the herd\'s cattle apart from the birds, and name the positive without a count', animals);
  await p.eval(`${S}.map.map.jumpTo({ center: [-122.45, 48.90], zoom: 11 }); true`);
  await sleep(500);
  const herd = await p.eval(`(() => { const pt = ${S}.map.map.project([-122.45, 48.90]); return ${S}.map.hoverAt([pt.x, pt.y]); })()`);
  check(herd && herd.items.length === 1 && [herd.items[0].head].concat(herd.items[0].lines).join('\n') === 'Whatcom 01\nDetected Jul 20, 2026\nBackyard · Dairy · 35 cattle · flock size Small',
    'e1b: a cattle herd\'s hover names its animals cattle, not birds', herd);

  // ---- Dates as Excel and ArcGIS export them; a premises closed after the latest detection; a status-only close ----
  await open();
  await load([path.join(TABLES, 'em_positives_times.csv')]);
  v = await view();
  const times = await p.eval(`({ max: document.getElementById('em-day').max, day: document.getElementById('em-day').value,
    warn: Array.from(document.querySelectorAll('#em-box-lines .warn')).map(e => e.textContent),
    today: (() => { const d = new Date(), t = n => String(n).padStart(2, '0'); return d.getFullYear() + '-' + t(d.getMonth() + 1) + '-' + t(d.getDate()); })() })`);
  check(v.positives === '1 Active' && v.past === '2 Closed 2 still under quarantine' && v.last === 'Oct 1, 2026 Last positive As of Oct 30, 2026'
    && times.warn.includes('2 dates not readable'),
  'e1b: dates written with a time are read ("9/3/2026 0:00"); the two that cannot be read are said in the warning color; on today the premises closed on Oct 20 is closed (released Nov 30: still under quarantine)', [v.positives, v.past, v.last, times.warn]);
  check(times.day === '2026-10-30' && times.max === '2026-10-30',
    'e1b: On a day opens on today, after the latest detection (Oct 1); the day can run up to today', times);
  await setDate('em-day', '2026-10-01');
  v = await view();
  check(v.positives === '2 Active' && v.past === '1 Closed 1 still under quarantine' && v.last === 'Oct 1, 2026 Last positive As of Oct 1, 2026'
    && v.step === 'Oct 1, 2026 \u00b7 week 5 of 5',
  'e1b: On a day Oct 1, the latest detection: the premises closed on Oct 20 is still active; the play\'s label says the day', [v.positives, v.past, v.last, v.step]);
  await p.click(`document.querySelector('button.tip[data-help="em-type"]').click()`);
  const timesHelp = await p.eval(`document.getElementById('help-em-type-text').textContent`);
  check(/with no readable close or release date, shows as closed on every day: the page cannot tell when it closed\./.test(timesHelp)
    && !/closes on its quarantine release date/.test(timesHelp),
  'e1b: the type\'s "?" says a positive closed by its status with neither date shows as closed on every day (no release date here)', timesHelp);
  await load([path.join(TABLES, 'em_positives_agreed.csv')]);
  check(!/no readable close date/.test(await p.eval(`document.getElementById('help-em-type-text').textContent`)),
    'e1b: with close dates for every closed positive, the "?" does not say it');

  // ---- The closing day (2.5): closed by Status, from the release date ----
  await load([path.join(TABLES, 'em_rules_closed_day.csv')]);
  const dayLines = () => p.eval(`Array.from(document.querySelectorAll('#em-box-lines .warn')).map(e => e.textContent)`);
  v = await view();
  let cdLines = await dayLines();
  check(v.positives === '3 Active' && /^5 Closed/.test(v.past) && !cdLines.some(l => /day not known/.test(l)),
    'closing day: on today 3 active and 5 closed; no "closed on a day not known" line on today', [v.positives, v.past, cdLines]);
  await setDate('em-day', '2023-04-01');
  v = await view();
  check(v.positives === '2 Active' && v.past === '0 Closed',
    'closing day: On a day Apr 1, 2023: Yakima 11 (closed by Status, released Jun 1, 2023) active then, with the undated one; nothing closed', [v.positives, v.past]);
  await setDate('em-day', '2025-10-01');
  v = await view();
  cdLines = await dayLines();
  check(v.positives === '1 Active' && /^5 Closed/.test(v.past) && cdLines.includes('2 closed on a day not known'),
    'closing day: On a day Oct 1, 2025: "2 closed on a day not known" in the warning color under the boxes', [v.positives, v.past, cdLines]);
  const cdHelp = await p.eval(`document.getElementById('help-em-type-text').textContent`);
  check(/A positive closed by its status, with no readable close date, closes on its quarantine release date\./.test(cdHelp)
    && /with no readable close or release date, shows as closed on every day/.test(cdHelp),
  'closing day: the type\'s "?" says both: closed from the release date, and with neither date closed on every day', cdHelp);
  await setDate('em-day', '');
  // The same table on an earlier today (May 1, 2023; the page opens on the file's last detection, after it): Yakima
  // 11's and 12's releases are after today, so neither is their closing day. On Apr 1, 2023 Yakima 11 is closed
  // already (on today's real date it was active then), and the "?" says why.
  await p.eval(`${S}.today = '2023-05-01'; true`);
  await load([path.join(TABLES, 'em_rules_closed_day.csv')]);
  await setDate('em-day', '2023-04-01');
  v = await view();
  const laterHelp = await p.eval(`document.getElementById('help-em-type-text').textContent`);
  check(v.positives === '1 Active' && /^1 Closed/.test(v.past)
    && /A positive closed by its status, with a release date after today, shows as closed on every day: that date cannot be when it closed\./.test(laterHelp)
    && !/closes on its quarantine release date/.test(laterHelp),
  'closing day: on an earlier today a release date after it is not the closing day: on Apr 1, 2023 Yakima 11 closed, the undated one active; the "?" says so', [v.positives, v.past, laterHelp]);

  // ---- The synthetic screwworm outbreak: the type follows the file, its dispersal areas are the zones ----
  await open();
  await load([path.join(TABLES, 'em_nws_synthetic.zip')]);
  v = await view();
  const nws = await p.eval(`({ type: document.getElementById('em-type').value, show: ${S}.show, layers: ${S}.selectedLayers,
    synthetic: ${S}.synthetic, zones: Array.from(document.querySelectorAll('#tab-inside .em-zones-list tbody tr')).map(r => Array.from(r.cells).map(c => c.textContent)) })`);
  check(nws.type === 'nws' && nws.show === 'zones' && v.data.zones === 2 && nws.synthetic && same(nws.layers, ['markets', 'feedlots', 'fairgrounds']),
    'e1b: the screwworm bundle picks New World screwworm, uses its dispersal areas at once, ticks its livestock layers; marked synthetic', nws);
  check(v.positives === '8 Active zones from a file' && v.past === '2 Closed 1 still under quarantine'
    && v.lines === '1 not mapped: no coordinates' && v.last === 'Oct 9, 2026 Last positive As of Oct 30, 2026'
    && (animals = await overviewAnimals(p)).value === '10,835 animals' && animals.note === '4 commercial, 4 backyard · 1 without a count',
  'e1b: the screwworm boxes: eight active positives on today, two closed (one still under quarantine); under them the not-mapped line; the Overview\'s animals in screwworm\'s word', [v.positives, v.past, v.lines, v.last, animals]);
  check(same(nws.zones, [['Synthetic dispersal area: Yakima and Tri-Cities (made up)', 'Oct 2, 2026', '28 days'],
    ['Synthetic dispersal area: Klickitat (made up)', 'Aug 26, 2026', '65 days']]),
  'e1b: the "Zones" list for the dispersal areas, the longest-quiet last', nws.zones);
  check(v.play === 'Play by week' && v.step === 'Oct 30, 2026 \u00b7 week 13 of 13', 'e1b: the screwworm outbreak plays by week (13 weeks, to today\'s)', v);
  // A zone file: a layer with sites in two zones says the count and the zones; the table names each zone.
  const twoZones = await p.eval(`Array.from(document.querySelectorAll('#tab-inside details.em-layer[data-layer] summary')).map(e => e.textContent)`);
  check(twoZones.some(t => /^[^:]+: \d+ in 2 zones$/.test(t)), 'e1b: with a zone file, a layer with sites in two zones reads "n in 2 zones"', twoZones);
  await p.eval(`(() => { const s = document.getElementById('em-type'); s.value = 'hpai'; s.dispatchEvent(new Event('change')); return true; })()`);
  v = await view();
  animals = await overviewAnimals(p);
  check(animals.value === '10,790 cattle' && animals.note === '45 other animals · 4 commercial, 4 backyard · 1 without a count'
    && await p.eval(`document.getElementById('em-type').value`) === 'hpai',
  'e1b: switching the type picker to HPAI reads the same file as HPAI (its words: cattle and other animals, no birds)', animals);
  // The bundle's zone file follows the type: HPAI draws its rings, screwworm the file's zones again.
  check(await p.eval(`${S}.show`) === 'rings' && v.data.zones > 2, 'e1b: switched to HPAI, the bundle\'s zone file gives way to HPAI\'s rings', v.data);
  await p.eval(`(() => { const s = document.getElementById('em-type'); s.value = 'nws'; s.dispatchEvent(new Event('change')); return true; })()`);
  v = await view();
  check(await p.eval(`${S}.show`) === 'zones' && v.data.zones === 2, 'e1b: switched back to screwworm, its dispersal areas are the zones again', v.data);
  await load([samplePath]);
  check(await p.eval(`document.getElementById('em-type').value`) === 'hpai' && await p.eval(`${S}.show`) === 'rings',
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
  check(await p.eval(`${S}.show`) === 'rings' && v.legend.includes('Example area (20 km)'),
    'e1b: the screwworm positives alone: the example ring, "Example area (20 km)" in the legend', v.legend);
  await tick('em-unit-mi');
  v = await view();
  check(v.legend.includes('Example area (12.43 mi)'), 'e1b: in miles, "Example area (12.43 mi)"', v.legend);
  await tick('em-unit-km');
}

// The chart "Positives over time": in the Overview's "Over time" (2.3; no switch before a load, the Map shown after
// each load, the chart drawn once the Overview shows), one column per step of the play with the file's dated, mapped positives counted once, a click and the keyboard moving the
// window's end (as the slider), the hover box, the slider or the play leaving no column picked (2.5),
// the screwworm outbreak by week, 320 pixels wide. Pictures of the chart's
// panel in local-test-artifacts/em/chart/ for a look.
async function partChart(b) {
  const p = b.page, S = 'WSDA.emergency.state', OUTC = path.join(OUT, 'chart');
  const samplePath = path.join(OUT, 'sample', 'emergency_synthetic.zip'), nwsPath = path.join(TABLES, 'em_nws_synthetic.zip');
  fs.rmSync(OUTC, { recursive: true, force: true });
  fs.mkdirSync(OUTC, { recursive: true });
  // The chart's panel (with the hover box when shown), scrolled into view.
  const shot = async name => {
    await sleep(300);
    const r = await p.eval(`(() => { document.getElementById('ov-time').scrollIntoView(); const a = document.getElementById('ov-time').getBoundingClientRect(),
      z = a, t = document.getElementById('em-chart-tip').getBoundingClientRect();
      const bottom = Math.max(z.bottom, document.getElementById('em-chart-tip').hidden ? 0 : t.bottom);
      return { x: 0, y: a.top + scrollY - 6, width: document.documentElement.clientWidth, height: bottom - a.top + 12 }; })()`);
    fs.writeFileSync(path.join(OUTC, name + '.png'), Buffer.from((await b.send('Page.captureScreenshot',
      { format: 'png', captureBeyondViewport: false, clip: Object.assign(r, { scale: 1 }) }, p.sid)).data, 'base64'));
  };
  await p.goto(new URL('emergency/index.html', SITE).href);
  await p.waitFor(`window.WSDA && WSDA.emergency && ${S}.map.ready`, 20000, 'Emergency map ready');
  check(await p.eval(`document.getElementById('em-view').hidden && document.getElementById('view-overview').hidden`),
    'chart: no switch to the Overview before a positives file is loaded');
  const load = async files => {
    const v = await p.eval(`${S}.version`);
    await p.setFiles('#files-input', files);
    await emReady(p, v);
    await p.waitFor(`${S}.map.drawn && ${S}.map.drawn.positives > 0`, 15000, 'map drawn');
  };
  await load([samplePath]);
  check(await p.eval(`${S}.view === 'map' && !document.getElementById('em-view').hidden && !document.querySelector('#em-chart .chart-col')`),
    'chart: after the load the Map shows, the switch with it; the chart waits until the Overview shows');
  const overview = () => p.eval(`(document.getElementById('show-overview').click(), true)`);
  await overview();
  const view = () => p.eval(`(() => { const s = ${S};
    const cols = Array.from(document.querySelectorAll('#em-chart .chart-col'));
    return { hidden: document.getElementById('ov-s-time').hidden, open: s.view === 'overview', sum: document.getElementById('em-chart-sum').textContent,
      note: document.getElementById('em-chart-note').hidden ? '' : document.getElementById('em-chart-note').textContent,
      steps: s.steps.steps.length, by: s.steps.by, stepAt: s.stepAt, window: s.window, to: document.getElementById('em-to').value,
      day: document.getElementById('em-day').value, mark: s.chartMark, chartCols: s.chartSteps.steps.length,
      line: document.querySelectorAll('#em-chart .chart-line').length, band: document.querySelectorAll('#em-chart .chart-band').length,
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
    'chart: on the Overview, "Over time" shows the chart drawn, its heading naming weeks or months', v);
  const d = await p.eval(DENSITY);
  const helps = d.controls.filter(c => c === 'button:?'), others = d.controls.filter(c => c !== 'button:?' && !/^show-(map|overview)$/.test(c));
  check(others.length <= 6 && !d.controls.some(c => /chart/.test(c)) && helps.length === 7,
    'chart: the Overview adds no control but the switch and its six "?" (the chart\'s columns one keyboard stop, below; density)', d.controls);
  // The Overview stays shown while the page works the results out again; a new set of files opens on the Map.
  await p.eval(`document.getElementById('em-unit-mi').click(); true`);
  await sleep(200);
  check(await p.eval(`${S}.view === 'overview' && !document.getElementById('view-overview').hidden && document.getElementById('view-map').hidden`),
    'chart: the Overview stays shown when a control changes');
  await load([samplePath]);
  check(await p.eval(`${S}.view === 'map' && !document.getElementById('view-map').hidden && document.getElementById('view-overview').hidden
    && document.getElementById('show-map').getAttribute('aria-pressed') === 'true' && document.getElementById('show-overview').getAttribute('aria-pressed') === 'false'`),
  'chart: a new set of files opens on the Map (the switch says so)');
  await p.eval(`document.getElementById('em-unit-km').click(); document.getElementById('show-overview').click(); true`);
  await p.waitFor(`document.querySelectorAll('#em-chart .chart-col').length > 0`, 5000, 'chart drawn again');
  v = await view();
  const total = v.counts.reduce((t, c) => t + c[0] + c[1] + c[2], 0);
  check(v.cols === v.chartCols && v.cols === 16 && v.steps === 16 && total === v.dated && v.current === -1 && same(v.stops, [v.cols - 1])
    && v.counts.every(c => c[2] === 0) && v.svgWidth === v.boxWidth && same(v.mark, { kind: 'line', col: 15, at: 1 }) && v.line === 1 && v.band === 0,
  'chart: On a day on today: one column per week from the file\'s first to today\'s (16), each dated mapped positive counted once, no column picked (the last the one keyboard stop), nothing after the day, the day\'s line on today, as wide as its panel', v);
  await shot('chart_01_hpai_sample_open');
  check((v.dropped || v.mapped > v.dated) ? /^Not counted: /.test(v.note) : v.note === '', 'chart: the note names what is not counted, only when something is', v.note);
  // A click on an earlier column with positives On a day: the day moves to the column's last day (the date box follows).
  const at = v.counts.findIndex(c => c[0] + c[1] > 0);
  const column = await p.eval(`${S}.chartSteps.steps[${at}]`);
  await p.click(`document.querySelector('#em-chart .chart-col[data-col="${at}"]').dispatchEvent(new MouseEvent('click', { bubbles: true })); true`);
  await p.waitFor(`${S}.picked === ${at}`, 5000, 'chart click');
  v = await view();
  const later = v.counts.slice(at + 1).reduce((t, c) => t + c[2], 0), laterAll = total - v.counts.slice(0, at + 1).reduce((t, c) => t + c[0] + c[1] + c[2], 0);
  check(v.window.view === 'day' && v.window.end === column.end && v.day === column.end && v.current === at && same(v.stops, [at])
    && later === laterAll && later > 0 && v.mark.kind === 'line' && v.mark.col === at,
  'chart: On a day a click on a column moves the day to its last day (the date box follows), the line with it; the later positives turn "after the day"', v);
  check(v.positives === await p.eval(`String(WSDA.emergencyRules.groups(${S}.read, ${S}.window).current.length)`),
    'chart: the "Active" box follows the click', v.positives);
  // The hover box: the column's counts and its click's hint.
  await p.eval(`(() => { const c = document.querySelector('#em-chart .chart-col[data-col="${at}"]'), r = c.getBoundingClientRect();
    c.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + 30 })); return true; })()`);
  v = await view();
  check(v.tip === v.hovers[at] + 'Click again for the opening dates' && /: \d+ (active|closed)/.test(v.tip),
    'chart: the pointer over the picked column shows its counts and that a click again gives the opening dates', v.tip);
  await shot('chart_02_hpai_sample_clicked_hover');
  await p.eval(`document.getElementById('em-chart').dispatchEvent(new PointerEvent('pointerleave')); true`);
  // The keyboard: the picked column is the stop; the right arrow moves along, Enter picks.
  await p.eval(`document.querySelector('#em-chart .chart-col[tabindex="0"]').focus(); true`);
  await p.eval(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); true`);
  v = await view();
  check(v.focus === String(at + 1) && same(v.stops, [at + 1]) && v.tip === v.hovers[at + 1] + 'Click to move the day to '
    + (await p.eval(`WSDA.emergencyRules.dayLabel(${S}.chartSteps.steps[${at + 1}].end)`)) && v.window.end === column.end,
  'chart: the right arrow moves the focus (and the hover box) to the next column without moving the day', v);
  await p.eval(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); true`);
  await p.waitFor(`${S}.picked === ${at + 1}`, 5000, 'chart Enter');
  v = await view();
  check(v.current === at + 1 && v.focus === String(at + 1), 'chart: Enter picks the focused column; the focus stays on it after the redraw', v);
  // The slider after a pick: the day's line moves to the step, and no column stays picked (its hint gone with it).
  await p.eval(`(() => { const i = document.getElementById('em-step'); i.value = '0'; i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await p.waitFor(`${S}.picked === null`, 5000, 'the slider after a pick');
  await p.eval(`(() => { const c = document.querySelector('#em-chart .chart-col[data-col="${at + 1}"]'), r = c.getBoundingClientRect();
    c.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + 30 })); return true; })()`);
  v = await view();
  await p.eval(`document.getElementById('em-chart').dispatchEvent(new PointerEvent('pointerleave')); true`);
  check(v.current === -1 && v.mark.kind === 'line' && v.mark.col !== at + 1
    && v.window.end === await p.eval(`${S}.steps.steps[0].end`) && v.tip.startsWith(v.hovers[at + 1] + 'Click to move the day to '),
  'chart: the slider after a pick moves the day\'s line to its step; no column stays picked (the column once picked says "Click to move the day")', v);
  await p.click(`document.querySelector('#em-chart .chart-col[data-col="${at + 1}"]').dispatchEvent(new MouseEvent('click', { bubbles: true })); true`);
  await p.waitFor(`${S}.picked === ${at + 1}`, 5000, 'chart click again after the slider');
  // The picked column again: the view's opening dates (today), no column picked.
  await p.click(`document.querySelector('#em-chart .chart-col[data-col="${at + 1}"]').dispatchEvent(new MouseEvent('click', { bubbles: true })); true`);
  await p.waitFor(`${S}.picked === null`, 5000, 'chart unpick');
  v = await view();
  check(v.window.end === '2026-10-30' && v.day === '2026-10-30' && v.current === -1 && same(v.stops, [v.cols - 1]) && v.counts.every(c => c[2] === 0),
    'chart: On a day a click on the picked column gives back the opening day (today), no column picked', v);
  check(await p.eval(`document.getElementById('ov-time-help').textContent === 'One column per week, to today. The line is the day; click a column to move the day to its end.'
    && /goes back to the opening dates\.$/.test(document.getElementById('help-ov-time').textContent)`),
  'chart: On a day the line over the chart says the line is the day; its "?" says a click again goes back to the opening dates');
  // Between dates: the band over the dates; a column becomes the dates alone; again, the opening dates.
  await p.eval(`document.getElementById('em-view-range').click(); true`);
  await p.waitFor(`${S}.viewKind === 'range'`, 5000, 'Between dates');
  v = await view();
  check(same(v.mark, { kind: 'band', from: 0, to: 15 }) && v.band === 1 && v.line === 0 && v.counts.every(c => c[2] === 0)
    && await p.eval(`document.getElementById('ov-time-help').textContent === 'One column per week, to today. The band is the dates; click a column to see that week alone.'`)
    && await p.eval(`document.getElementById('ov-badge').textContent === 'Jul 15, 2026 – Oct 30, 2026' && !!document.querySelector('#ov-badge svg')
      && getComputedStyle(document.getElementById('ov-badge')).display !== 'none'`),
  'chart: Between dates the band over every column from the first detection to today; the Overview\'s badge the span and both dates', v);
  const wk = v.counts.findIndex((c, k) => k > at && c[0] + c[1] > 0), week = await p.eval(`${S}.chartSteps.steps[${wk}]`);
  await p.click(`document.querySelector('#em-chart .chart-col[data-col="${wk}"]').dispatchEvent(new MouseEvent('click', { bubbles: true })); true`);
  await p.waitFor(`${S}.picked === ${wk}`, 5000, 'chart click Between dates');
  v = await view();
  const inWeek = v.counts[wk][0] + v.counts[wk][1];
  check(same(v.window, { view: 'range', start: week.start, end: week.end }) && same(v.mark, { kind: 'band', from: wk, to: wk })
    && v.counts.every((c, k) => k === wk || c[0] + c[1] === 0) && inWeek > 0
    && await p.eval(`document.querySelector('#box-detected strong').textContent`) === String(inWeek),
  'chart: Between dates a click on a column makes the dates that week alone: the band on it, the boxes count what was detected in it', v);
  await p.click(`document.querySelector('#em-chart .chart-col[data-col="${wk}"]').dispatchEvent(new MouseEvent('click', { bubbles: true })); true`);
  await p.waitFor(`${S}.picked === null`, 5000, 'chart unpick Between dates');
  v = await view();
  check(same(v.window, { view: 'range', start: '2026-07-15', end: '2026-10-30' }) && same(v.mark, { kind: 'band', from: 0, to: 15 }),
    'chart: Between dates the picked column again gives back the opening dates', v);
  // The first column (the week of Sunday, Jul 12): its first date the file's first detection (Jul 15), never earlier
  // than the first date box allows.
  await p.click(`document.querySelector('#em-chart .chart-col[data-col="0"]').dispatchEvent(new MouseEvent('click', { bubbles: true })); true`);
  await p.waitFor(`${S}.picked === 0`, 5000, 'chart first column Between dates');
  v = await view();
  const firstWeek = await p.eval(`${S}.chartSteps.steps[0]`);
  check(firstWeek.start === '2026-07-12' && same(v.window, { view: 'range', start: '2026-07-15', end: firstWeek.end })
    && await p.eval(`(() => { const f = document.getElementById('em-from'); return f.value === '2026-07-15' && f.value >= f.min; })()`),
  'chart: Between dates the first column starts on the file\'s first detection (Jul 15), not its Sunday; the first date box within its limits', v.window);
  await p.click(`document.querySelector('#em-chart .chart-col[data-col="0"]').dispatchEvent(new MouseEvent('click', { bubbles: true })); true`);
  await p.waitFor(`${S}.picked === null`, 5000, 'chart first column unpicked');
  await p.eval(`document.querySelector('#em-chart .chart-col[data-col="${at}"]').focus(); true`);
  await p.eval(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true })); true`);
  await p.waitFor(`${S}.picked === ${at}`, 5000, 'chart Space');
  await p.eval(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true })); true`);
  await p.waitFor(`${S}.picked === null`, 5000, 'chart Space again');
  v = await view();
  check(v.window.start === '2026-07-15' && v.window.end === '2026-10-30' && v.current === -1, 'chart: Space on a column picks it, Space again gives the opening dates back', v);
  // The pick was made on the Overview: the map's fit waits for the Map.
  check(await p.eval(`${S}.fitNext === true`), 'chart: a pick on the Overview leaves the map\'s fit waiting for the Map');
  // The play On a day moves the line along the columns; Pause stops it.
  await p.eval(`document.getElementById('em-view-day').click(); true`);
  await p.click(`document.getElementById('em-play').click()`);
  await p.waitFor(`${S}.stepAt >= 1`, 5000, 'one step played');
  v = await view();
  check(v.mark.kind === 'line' && v.mark.col === v.stepAt && v.current === -1, 'chart: while the play runs On a day, the line follows its step (no column picked)', v);
  await p.click(`document.getElementById('em-play').click()`);
  // The screwworm outbreak: 13 weeks, to today's.
  await p.eval(`document.activeElement.blur(); true`);
  await load([nwsPath]);
  await overview();
  v = await view();
  check(v.open && v.by === 'week' && v.sum === 'by week' && v.cols === 13 && v.counts.reduce((t, c) => t + c[0] + c[1] + c[2], 0) === 10
    && v.note === 'Not counted: 1 not mapped' && /^Week of /.test(v.hovers[0]),
  'chart: the screwworm outbreak, by week: 13 columns to today\'s, its ten mapped positives, the row without coordinates named', v);
  await shot('chart_03_screwworm_by_week');
  await b.send('Emulation.setDeviceMetricsOverride', { width: 320, height: 900, deviceScaleFactor: 1, mobile: true }, p.sid);
  await sleep(400);
  v = await view();
  check(await p.eval(`document.documentElement.scrollWidth <= 321`) && v.svgWidth === v.boxWidth && v.boxWidth <= 300,
    'chart: at 320 pixels wide it is redrawn at its panel\'s width; nothing scrolls sideways', [v.svgWidth, v.boxWidth]);
  await shot('chart_04_screwworm_320px');
  await b.send('Emulation.clearDeviceMetricsOverride', {}, p.sid);
}

// The one-second step at full size (scope section 3, "Speed"): the speed set both sides of the rules check (40
// positives and 30,000 points, tests/synthetic/make_em_fixtures.js) written as a positives file in the agreed columns,
// detected two days apart over twelve weeks (every eighth one closed), and a markets layer of 30,000 points; then the
// 50,000-row synthetic CVI master (tests/synthetic/make_scale_master.js). Every step of a whole play is timed by the
// page's own hook (state.computeMs, one redraw's work): without a master, with one, and with the CVI movements tab
// open (the query waits for the play to stop). The CVI query after the play is timed too, for the record only.
// The animals' shapes, the legend's Animals rows and the view (2.4): each positive in its animal's shape; the view
// takes in what is shown, clear of the legend and the map's buttons, after each tick, date change, pick and stop of the play, and never
// during the play; the home button fits the same.
async function partView(b) {
  const p = b.page, S = 'WSDA.emergency.state', OUTV = path.join(OUT, 'view');
  const samplePath = path.join(OUT, 'sample', 'emergency_synthetic.zip');
  fs.rmSync(OUTV, { recursive: true, force: true });
  fs.mkdirSync(OUTV, { recursive: true });
  // The map, scrolled into view (a map picture is taken inside the window).
  const shot = async name => {
    await sleep(800);
    const r = await p.eval(`(() => { const m = document.getElementById('em-map'); m.scrollIntoView(); const a = m.getBoundingClientRect();
      return { x: a.left, y: a.top + scrollY, width: a.width, height: a.height }; })()`);
    fs.writeFileSync(path.join(OUTV, name + '.png'), Buffer.from((await b.send('Page.captureScreenshot',
      { format: 'png', captureBeyondViewport: false, clip: Object.assign(r, { scale: 1 }) }, p.sid)).data, 'base64'));
  };
  await p.goto(new URL('emergency/index.html', SITE).href);
  await p.waitFor(`window.WSDA && WSDA.emergency && ${S}.map.ready`, 20000, 'Emergency map ready');
  const load = async files => {
    const v = await p.eval(`${S}.version`);
    await p.setFiles('#files-input', files);
    await emReady(p, v);
    await p.waitFor(`${S}.map.drawn && ${S}.map.drawn.positives > 0`, 15000, 'map drawn');
  };
  const tick = id => p.click(`document.getElementById('${id}').click()`);
  // Moves the map far off (the Olympic coast, zoomed in), so a fit afterwards shows.
  const away = () => p.eval(`(${S}.map.map.jumpTo({ center: [-124.5, 47.9], zoom: 10 }), true)`);
  // Where the view is, and whether every positive shown is inside it and clear of the legend and of the map's own
  // buttons, scale and attribution (its mark's reach too: about 16 pixels from its middle, halo included).
  const seen = () => p.eval(`(() => { const s = ${S}, m = s.map.map, c = m.getCanvas().getBoundingClientRect();
    const lg = document.getElementById('em-legend').getBoundingClientRect(), R = 16;
    const ctrls = Array.from(m.getContainer().querySelectorAll('.maplibregl-ctrl')).map(e => e.getBoundingClientRect())
      .filter(r => r.width && r.height);
    const pts = s.map.em.positives.features.map(f => m.project(f.geometry.coordinates));
    const inView = pts.every(q => q.x >= R && q.y >= R && q.x <= c.width - R && q.y <= c.height - R);
    const off = (q, r) => c.left + q.x + R < r.left || c.left + q.x - R > r.right || c.top + q.y + R < r.top || c.top + q.y - R > r.bottom;
    const clear = pts.every(q => (c.left + q.x + R < lg.left || c.top + q.y + R < lg.top || c.top + q.y - R > lg.bottom)
      && ctrls.every(r => off(q, r)));
    const z = s.map.em.pastZones.features.flatMap(f => f.geometry.coordinates[0]).map(x => m.project(x));
    return { n: pts.length, inView, clear, pastZonesIn: z.every(q => q.x >= 0 && q.y >= 0 && q.x <= c.width && q.y <= c.height),
      center: m.getCenter().toArray().map(x => Math.round(x * 1e4) / 1e4), zoom: Math.round(m.getZoom() * 1e3) / 1e3, fitNext: s.fitNext,
      pastZones: s.map.em.pastZones.features.length }; })()`);
  await load([samplePath]);

  // The shapes: each positive's mark from its animal, the picture made; past ones their own picture.
  const marks = await p.eval(`(() => { const s = ${S}, E = WSDA.emergencyRules, m = s.map.map;
    const byName = new Map(s.read.positives.map(x => [x.name, x]));
    return s.map.em.positives.features.map(f => { const x = byName.get(f.properties.label.split('\\n')[0]);
      return [f.properties.mark, E.animalShapeOf(s.read.type, x), m.hasImage(f.properties.mark)]; }); })()`);
  check(marks.length === 6 && marks.every(([id, shape, has]) => id.indexOf('em-positive:' + shape + ':now:') === 0 && has)
    && marks.filter(x => x[1] === 'square').length === 2 && marks.filter(x => x[1] === 'circle').length === 4
    && await p.eval(`${S}.map.map.getLayer('em_positives').type === 'symbol'`),
  'view: each positive in its animal\'s shape (the two dairies squares, the birds circles), its picture made', marks);
  const legend = () => p.eval(`Array.from(document.querySelectorAll('#em-legend-content p')).map(e => {
    const a = e.querySelector('.lg-animal'); return (a ? a.dataset.shape + ' ' : '') + e.textContent; })`);
  let lg = await legend();
  const head = lg.indexOf('Animals');
  check(head > lg.findIndex(t => /^Control zone/.test(t)) && same(lg.slice(head + 1, head + 3), ['circle Birds', 'square Cattle'])
    && !lg.some(t => /Other animals/.test(t)),
  'view: the legend\'s "Animals" rows after the zones, one per kind drawn (birds a circle, cattle a square)', lg);
  check(await p.eval(`(() => { const b = document.querySelector('#em-map .map-fit'); return b.title === 'Fit to the positives shown' && b.getAttribute('aria-label') === 'Fit to the positives shown'; })()`),
    'view: the home button reads "Fit to the positives shown"');

  // After the load: every positive in view and clear of the legend (the Franklin dairy sits at the bottom right).
  let v = await seen();
  check(v.n === 6 && v.inView && v.clear && !v.fitNext, 'view: after the load every positive shown is in view, clear of the legend and the map\'s buttons', v);
  await shot('view_01_sample_open');
  // "Show closed positives" and "Draw their rings": the view takes them in when ticked.
  await away();
  await tick('em-past');
  await p.waitFor(`${S}.mapData.past > 0`, 5000, 'past shown');
  v = await seen();
  check(v.n === 7 && v.inView && v.clear, 'view: ticking "Show closed positives" fits the view to them too', v);
  await p.eval(`document.getElementById('em-past-fold').open = true; true`);
  await away();
  await tick('em-past-rings');
  await p.waitFor(`${S}.map.em.pastZones.features.length > 0`, 5000, 'past rings drawn');
  v = await seen();
  check(v.pastZones > 0 && v.pastZonesIn && v.inView, 'view: ticking "Draw their rings" fits the view to the closed zones too', v);
  lg = await legend();
  check(lg.indexOf('Closed zones (dashed)') >= 0 && lg.indexOf('Animals') > lg.indexOf('Closed zones (dashed)'), 'view: the "Animals" rows after the closed zones\' line', lg);
  await shot('view_02_past_and_rings');
  await away();
  await tick('em-past-rings');
  await tick('em-past');
  await p.waitFor(`${S}.mapData.past === 0`, 5000, 'past hidden');
  v = await seen();
  check(v.n === 6 && v.inView && v.clear, 'view: unticking fits the view to what is still shown', v);
  // A date box changed: the view fits what the new window shows.
  await away();
  await p.eval(`(() => { const i = document.getElementById('em-day'); i.value = '2026-09-10'; i.dispatchEvent(new Event('change')); return true; })()`);
  await p.waitFor(`${S}.window.end === '2026-09-10'`, 5000, 'date changed');
  v = await seen();
  check(v.n === 3 && v.inView && v.clear, 'view: a changed date box fits the view to the positives it shows', v);
  // The home button: the same fit.
  await away();
  await p.click(`document.querySelector('#em-map .map-fit').click()`);
  v = await seen();
  check(v.n === 3 && v.inView && v.clear, 'view: the home button fits the positives shown', v);
  // The play: the view stays still while it steps, then fits once when it stops.
  await p.eval(`(() => { const i = document.getElementById('em-day'); i.value = ''; i.dispatchEvent(new Event('change')); return true; })()`);
  await p.waitFor(`${S}.window.end === '2026-10-30'`, 5000, 'date cleared');
  await away();
  const before = await seen();
  await p.click(`document.getElementById('em-play').click()`);
  await p.waitFor(`${S}.playing && ${S}.stepAt >= 2`, 8000, 'two steps played');
  const during = await seen();
  await p.waitFor(`!${S}.playing`, 40000, 'the play ends');
  v = await seen();
  check(same(during.center, before.center) && during.zoom === before.zoom && !v.fitNext && v.n === 6 && v.inView && v.clear,
    'view: still while the play steps (no jump each second), fitted once when it ends', [before, during, v]);
  await away();
  await p.click(`document.getElementById('em-play').click()`);
  await p.waitFor(`${S}.playing && ${S}.stepAt >= 1`, 8000, 'one step played');
  await p.click(`document.getElementById('em-play').click()`);
  v = await seen();
  check(!await p.eval(`${S}.playing`) && v.inView && v.clear && v.zoom !== 10, 'view: Pause fits the view to the step shown', v);
  // A pick on the chart is made on the Overview: the map fits when it is shown again.
  await away();
  await p.click(`document.getElementById('show-overview').click()`);
  await p.waitFor(`document.querySelectorAll('#em-chart .chart-col').length > 0`, 5000, 'chart drawn');
  await p.click(`document.querySelector('#em-chart .chart-col[data-col="9"]').dispatchEvent(new MouseEvent('click', { bubbles: true })); true`);
  await p.waitFor(`${S}.picked === 9`, 5000, 'chart pick');
  await p.click(`document.getElementById('show-map').click()`);
  await sleep(300);
  v = await seen();
  check(!v.fitNext && v.inView && v.clear && v.n === await p.eval(`WSDA.emergencyRules.groups(${S}.read, ${S}.window).current.length`),
    'view: a chart pick on the Overview fits the map when the Map is shown', v);
  // A narrow window: the legend sits above the map, so no room is kept for it.
  await b.send('Emulation.setDeviceMetricsOverride', { width: 400, height: 900, deviceScaleFactor: 1, mobile: true }, p.sid);
  await sleep(500);
  check(await p.eval(`${S}.map.legendWidth() === 0`), 'view: on a phone the legend is above the map, so the fit keeps no room for it');
  // A fresh page, 1280 by 1000 (the map fitted by its height, so the legend's room shows): the first load's fit keeps
  // the open legend's full width clear (the legend was once made after the fit, so it had no room).
  await b.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false }, p.sid);
  await p.goto(new URL('emergency/index.html', SITE).href);
  await p.waitFor(`window.WSDA && WSDA.emergency && ${S}.map.ready`, 20000, 'Emergency map ready');
  await load([samplePath]);
  await sleep(300);
  v = await seen();
  const room = await p.eval(`(() => { const lg = document.getElementById('em-legend');
    return [${S}.map.legendWidth(), parseFloat(getComputedStyle(lg).maxWidth) + 8, lg.open]; })()`);
  check(v.n === 6 && v.inView && v.clear && room[2] && room[0] === room[1],
    'view: on a fresh page after the first load every positive is clear of the legend, its full width kept', [v, room]);
  // The day to Sep 5, then the closed positive shown: it lies at the view's top left, where the map's buttons are
  // (with an edge of 40 pixels its mark sat under them).
  await p.eval(`(() => { const i = document.getElementById('em-day'); i.value = '2026-09-05'; i.dispatchEvent(new Event('change')); return true; })()`);
  await p.waitFor(`${S}.window.end === '2026-09-05'`, 5000, 'date changed');
  await tick('em-past');
  await p.waitFor(`${S}.mapData.past > 0`, 5000, 'past shown');
  v = await seen();
  check(v.n === 3 && v.inView && v.clear, 'view: a closed positive at the view\'s edge is clear of the map\'s buttons', v);
  // A day before the first detection, and dates with no detection between them (2.5): the boxes say so in the view's
  // words; 2.4's line under the dates is gone.
  const setDate = (id, value) => p.eval(`(() => { const i = document.getElementById('${id}'); i.value = '${value}'; i.dispatchEvent(new Event('change')); return true; })()`);
  await setDate('em-day', '2026-07-01');
  await p.waitFor(`${S}.window.end === '2026-07-01'`, 5000, 'a day before the first detection');
  const empty = await p.eval(`[!!document.getElementById('em-window-empty'), document.querySelector('#box-last strong').textContent,
    document.querySelector('#box-positives strong').textContent]`);
  check(same(empty, [false, 'None by this day', '0']),
    'dates: On a day before the first detection "Last positive" reads "None by this day" and Active 0; no line under the dates (2.4\'s stopgap gone)', empty);
  await tick('em-view-range');
  await setDate('em-from', '2026-09-03');
  await setDate('em-to', '2026-09-05');
  await p.waitFor(`${S}.window.start === '2026-09-03' && ${S}.window.end === '2026-09-05'`, 5000, 'dates with no detection');
  check(await p.eval(`document.querySelector('#box-detected strong').textContent === '0' && getComputedStyle(document.getElementById('box-last')).display === 'none'`),
    'dates: Between dates with no detection between them, Detected 0 (no last positive box in this view)');
  await tick('em-view-day');
  await setDate('em-day', '2026-09-05');
  await p.waitFor(`${S}.window.end === '2026-09-05'`, 5000, 'day back');
  check(await p.eval(`document.querySelector('#box-last strong').textContent === 'Sep 2, 2026'`),
    'dates: with a positive by the day again, "Last positive" is its date');
  // The population layers (2.4): on after a load of a positives file; turned off, they stay off when the same
  // positives file comes again (as when a layer or a zone file is added), and a new positives file turns them on.
  const pcTicked = () => p.eval(`Array.from(document.querySelectorAll('#pc-block .pc-on')).filter(b => b.checked).map(b => b.dataset.layer)`);
  const pcFirst = await pcTicked();
  await tick('pc-density');
  await p.waitFor(`!document.getElementById('pc-density').checked`, 5000, 'density off');
  await load([samplePath]);
  await sleep(300);
  const pcSame = await pcTicked();
  await load([path.join(TABLES, 'em_rules_quarantine.csv')]);
  await sleep(300);
  const pcNew = await pcTicked();
  check(same(pcFirst, ['cities', 'places', 'density']) && same(pcSame, ['cities', 'places'])
    && same(pcNew, ['cities', 'places', 'density']),
  'view: the population layers on after a load; density turned off stays off when the same positives file comes again; a new positives file turns it on',
    { first: pcFirst, same: pcSame, new: pcNew });
  // Quarantines not known (2.4): the Past positives icon striped gold when some are not known and none is under
  // quarantine, solid gold when one is; "n not known" in bold either way. The file as it is (1 under, 2 not known),
  // then a copy with Yakima 02 released (none under, 2 not known).
  const pastBox = () => p.eval(`(() => { const box = document.getElementById('box-past'), ic = getComputedStyle(box.querySelector('.card-ic'));
    return { quar: box.classList.contains('quar'), unk: box.classList.contains('unk'), striped: /repeating-linear-gradient/.test(ic.backgroundImage),
      bold: Array.from(box.querySelectorAll('.card-note b')).map(e => e.textContent), note: box.querySelector('.card-note').textContent }; })()`);
  const oneUnder = await pastBox();
  const released = path.join(OUTV, 'quarantine_none_under.csv');
  fs.writeFileSync(released, fs.readFileSync(path.join(TABLES, 'em_rules_quarantine.csv'), 'utf8').replace(/,Under quarantine(\r?\n)/, ',Released$1'));
  await load([released]);
  await sleep(300);
  const noneUnder = await pastBox();
  check(oneUnder.quar && oneUnder.unk && !oneUnder.striped && same(oneUnder.bold, ['1', '2 not known'])
    && oneUnder.note === '1 still under quarantine, 2 not known'
    && !noneUnder.quar && noneUnder.unk && noneUnder.striped && same(noneUnder.bold, ['2 not known'])
    && noneUnder.note === 'none under quarantine, 2 not known',
  'boxes: quarantines not known: the icon striped gold when none is under quarantine (solid gold when one is), "2 not known" in bold',
    { oneUnder, noneUnder });
  await b.send('Emulation.clearDeviceMetricsOverride', {}, p.sid);
}

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
      // Each step's own redraw (stepMs): the stop's redraw, which works out the CVI movements when ticked, is not a step.
      const s = await p.eval(`({ at: ${S}.stepAt, ms: ${S}.stepMs, playing: ${S}.playing,
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
  // The Overview shown: each step also works out the Overview, the people inside the zones among it.
  await p.click(`document.getElementById('show-overview').click()`);
  await p.waitFor(`${S}.overview && ${S}.overview.people`, 30000, 'the people worked out');
  const onOverview = await play();
  check(onOverview.steps === set.steps && onOverview.max < 1000,
    'speed: with the Overview shown (the people inside the zones worked out again at each step), every step redraws in under one second', onOverview);
  await p.click(`document.getElementById('show-map').click()`);

  await load([positivesFile, marketsFile, MASTER]);
  const masterRows = await p.eval(`${S}.master ? ${S}.master.physicalRows : 0`);
  check(masterRows === 50000, 'speed: the 50,000-row CVI master loads beside them', masterRows);
  const withMaster = await play();
  check(withMaster.steps === set.steps && withMaster.max < 1000,
    'speed: with the 50,000-row master loaded, every step still redraws in under one second', withMaster);

  await p.click(`document.getElementById('em-cvi').click()`);   // 3c: ticked, the query runs
  await p.click(`document.getElementById('show-cvi').click()`);
  await p.waitFor(`${S}.cviRes && ${S}.cviRes.status === 'ok'`, 60000, 'CVI result');
  const onTab = await play();
  check(onTab.steps === set.steps && onTab.max < 1000 && !onTab.cviWhilePlaying,
    'speed: with the CVI movements tab open, every step redraws in under one second; the query waits for the play to stop', onTab);
  const cviMs = await p.eval(`(() => { const t = performance.now(); ${S}.cviKey = null; document.getElementById('show-inside').click();
    document.getElementById('show-cvi').click(); return performance.now() - t; })()`);
  await p.click(`document.getElementById('show-inside').click()`);
  // 3c: ticked, the slider dragged across every week: each step quick, the CVI query only after the last move.
  const drag = await p.eval(`(async () => { const s = ${S}, r = document.getElementById('em-step'), times = [];
    let ran = false;
    for (let i = 0; i <= Number(r.max); i++) {
      r.value = String(i); r.dispatchEvent(new Event('input')); times.push(s.computeMs);
      if (s.cviKey !== null) ran = true;
      await new Promise(q => setTimeout(q, 40));
    }
    await new Promise(q => setTimeout(q, 1500));
    return { steps: times.length, max: Math.round(Math.max(...times)), ran, after: s.cviKey !== null }; })()`);
  check(drag.max < 1000 && !drag.ran && drag.after,
    'speed: ticked, dragging the slider across every week redraws each step in under one second; the CVI query waits for the last move, then runs once (3c)', drag);
  console.log(`  speed: the slider dragged over ${drag.steps} weeks, slowest step ${drag.max} ms`);
  console.log(`  speed: steps ${set.steps}; slowest step ${alone.max} ms alone, ${onOverview.max} ms on the Overview, ${withMaster.max} ms with the master, ${onTab.max} ms on the CVI tab; the CVI query over 50,000 rows ${Math.round(cviMs)} ms`);
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
        nameLayers: m.nameLayers, names: (m.names || []).length, facilityNames: (m.facilityNames || []).map(n => n.layer),
        streetNames: (m.streetNames || []).length, background: m.background, source: m.source,
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
    return { button: document.getElementById('em-png').textContent.trim(), nextToExport: document.getElementById('em-png').previousElementSibling.previousElementSibling.id,
      inOptions: !!f && f.contains(document.getElementById('em-png')) && f.contains(document.getElementById('em-png-background'))
        && f.parentElement.matches('aside') && !f.nextElementSibling && f.querySelector('summary').textContent === 'Export & Preview'
        && !document.querySelector('.em-main #em-export'), closed: !!f && !f.open,
      backgrounds: Array.from(document.getElementById('em-png-background').options).map(o => o.textContent),
      resolutions: Array.from(document.getElementById('em-png-resolution').options).map(o => o.textContent),
      quality: document.getElementById('em-png-quality-field').hidden, provider: document.getElementById('em-png-provider').hidden }; })()`);
  check(ctl.button === 'Map picture (PNG)' && ctl.nextToExport === 'em-export' && ctl.inOptions && ctl.closed
    && same(ctl.backgrounds, ['Default', 'Satellite', 'Shaded Relief', 'Hillshade', 'Streets (vector)'])
    && same(ctl.resolutions, ['Standard (200 dpi)', 'High (300 dpi)']) && ctl.quality && ctl.provider,
  'png: "Map picture (PNG)" under Export and Preview Map, all with the picture\'s options in "Export & Preview", closed, the sidebar\'s last section (Default, the tile backgrounds and Streets, 200 or 300 dpi); quality and provider hidden for Default', ctl);
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
    && v.meta.right.indexOf('As of Oct 30, 2026 · Last Updated: ') === 0 && v.stats.left[0].prefix === 'Active on' && v.stats.left[0].value === 'Oct 30, 2026'
    && v.stats.left[0].icon === 'pin',
  'png: the title from the type, the zones, "As of" and the period line On a day ("Active on Oct 30, 2026", the pin)', [v.title, v.meta, v.stats]);
  check(same(v.boxes.slice(0, 1), [['Active positives', '6']]) && v.boxes[1][0] === 'Sites inside' && v.boxes.length === 2
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
  check(shown === '2026-09-05' && v.stats.left[0].value === 'Sep 5, 2026' && v.meta.right.indexOf('As of Sep 5, 2026') === 0
    && same(v.boxes[0], ['Active positives', '2']), 'png: during a paused play the picture shows the day shown (Sep 5, two active positives)', [shown, v.stats, v.boxes]);
  // Between dates (2.5): the span, "Detected" and the two dates, and a "Detected" box first.
  await p.click(`document.getElementById('em-view-range').click()`);
  await p.eval(`(() => { const i = document.getElementById('em-from'); i.value = '2026-09-01'; i.dispatchEvent(new Event('change')); return true; })()`);
  await p.eval(`(() => { const i = document.getElementById('em-to'); i.value = '2026-10-05'; i.dispatchEvent(new Event('change')); return true; })()`);
  v = await picture();
  check(v.stats.left[0].icon === 'span' && v.stats.left[0].prefix + ' ' + v.stats.left[0].value === 'Detected Sep 1, 2026 to Oct 5, 2026'
    && same(v.boxes.slice(0, 2), [['Detected', '5'], ['Active positives', '5']]) && v.meta.right.indexOf('As of Oct 5, 2026') === 0,
  'png: Between dates the span and "Detected Sep 1, 2026 to Oct 5, 2026", a "Detected" box first', [v.stats, v.boxes]);
  await p.click(`document.getElementById('em-view-day').click()`);

  // 2.4: the controls in the approved order: the background, the resolution, "Name markers in PNG" (open: "Positives"
  // ticked, then each checked layer not ticked, in the layers' order), "Optional Filename" with its note, "Optional Map
  // Title", then Export, Preview Map and the PNG button.
  await open();
  await load([samplePath]);
  const order = await p.eval(`(() => { const f = document.getElementById('export-fold').querySelector('.section-body');
    const ids = Array.from(f.querySelectorAll('#em-png-background, #em-png-resolution, #em-names, #em-png-label, .name-note, #em-png-title, #em-export, #em-preview, #em-png'))
      .map(e => e.id || e.className);
    const boxes = Array.from(document.querySelectorAll('#em-name-list input'));
    const checked = Array.from(document.querySelectorAll('#em-layers input:checked')).map(i => i.parentElement.textContent.replace(/ \\(\\d+\\)$/, ''));
    return { ids, open: document.getElementById('em-names').open, names: boxes.map(i => i.parentElement.textContent.trim()),
      ticked: boxes.filter(i => i.checked).map(i => i.value), checked,
      note: document.querySelector('#export-fold .name-note').textContent,
      holders: [document.getElementById('em-png-label').placeholder, document.getElementById('em-png-title').placeholder],
      preview: document.getElementById('em-preview').textContent.trim() }; })()`);
  check(same(order.ids, ['em-png-background', 'em-png-resolution', 'em-names', 'em-png-label', 'muted name-note', 'em-png-title', 'em-export', 'em-preview', 'em-png'])
    && order.open && same(order.names, ['Positives'].concat(order.checked)) && order.checked.length >= 6 && same(order.ticked, ['positives'])
    && /^Do not type a person's name or a case number here/.test(order.note) && same(order.holders, ['Auto-named if blank', 'Auto-titled if blank'])
    && order.preview === 'Preview Map',
  'png: "Name markers in PNG" ("Positives" ticked, each checked layer not), "Optional Filename" with its note and "Optional Map Title" above Export, Preview Map and the PNG button', order);
  // Preview Map: the picture the button would save, in CVI's window, nothing downloaded; closed by its Close button.
  const dlBefore = fs.readdirSync(DL).length;
  await p.click(`document.getElementById('em-preview').click()`);
  await p.waitFor(`document.getElementById('preview-dialog') && document.getElementById('preview-dialog').open
    && document.querySelector('#preview-body img') && document.querySelector('#preview-body img').complete
    && document.querySelector('#preview-body img').naturalWidth > 0`, 60000, 'preview shown');
  const pv = await p.eval(`(() => { const d = document.getElementById('preview-dialog'), img = d.querySelector('#preview-body img');
    return { title: d.querySelector('#preview-title').textContent, note: d.querySelector('#preview-note').textContent,
      width: img.naturalWidth, height: img.naturalHeight, alt: img.alt, caption: d.querySelector('figcaption').textContent,
      button: document.getElementById('em-preview').textContent.trim(), enabled: !document.getElementById('em-preview').disabled
        && !document.getElementById('em-png').disabled, model: (${S}.lastPreview || {}).model.fileName }; })()`);
  await p.click(`document.getElementById('preview-close').click()`);
  const pvClosed = await p.eval(`!document.getElementById('preview-dialog').open`);
  check(pv.title === 'Map preview' && pv.note === 'This is what the PNG will look like when exported.' && pv.width === 2200 && pv.height === 1700
    && pv.alt === 'HPAI RESPONSE MAP' && pv.caption === 'emergency_hpai_' + today + '.png' && pv.model === pv.caption && pv.button === 'Preview Map'
    && pv.enabled && pvClosed && fs.readdirSync(DL).length === dlBefore,
  'png: Preview Map shows the picture the button saves in the "Map preview" window ("This is what the PNG will look like when exported."), saves nothing; Close closes it', [pv, pvClosed]);
  // The name markers: All names every layer's sites inside, Clear names no one; a layer unchecked in "Layers to check"
  // leaves the list, and comes back not ticked.
  await p.click(`document.getElementById('em-names-all').click()`);
  v = await picture('hpai_all_names_200dpi');
  const allTicked = await p.eval(`Array.from(document.querySelectorAll('#em-name-list input')).every(i => i.checked)`);
  check(allTicked && v.names === 6 && v.facilityNames.length > 0 && v.nameLayers.length === order.names.length,
    'png: "All" ticks every name marker: the positives and every layer\'s sites inside named', [v.nameLayers, v.names, v.facilityNames.length]);
  await p.click(`document.getElementById('em-names-clear').click()`);
  v = await picture();
  check(v.names === 0 && !v.facilityNames.length && same(v.nameLayers, []),
    'png: "Clear" unticks them all: no names on the picture', [v.names, v.facilityNames]);
  const firstLayer = await p.eval(`document.querySelector('#em-layers input:checked').value`);
  await p.eval(`(() => { document.querySelector('#em-name-list input[value="${firstLayer}"]').click(); const i = document.querySelector('#em-layers input[value="${firstLayer}"]');
    i.click(); return true; })()`);
  const gone = await p.eval(`!document.querySelector('#em-name-list input[value="${firstLayer}"]')`);
  await p.eval(`(() => { document.querySelector('#em-layers input[value="${firstLayer}"]').click(); return true; })()`);
  const back = await p.eval(`(() => { const i = document.querySelector('#em-name-list input[value="${firstLayer}"]'); return i ? i.checked : null; })()`);
  check(gone && back === false, 'png: a layer unchecked in "Layers to check" leaves the name markers; checked again it comes back not ticked', [firstLayer, gone, back]);
  await p.eval(`(() => { const i = document.querySelector('#em-name-list input[value="positives"]'); i.click(); return true; })()`);
  // The two fields: the title typed on the picture; the picture and the CSV ZIP named from the file name, which
  // export_params.json records.
  await p.eval(`(() => { document.getElementById('em-png-title').value = 'Briefing map'; document.getElementById('em-png-label').value = 'Briefing Oct/22';
    return true; })()`);
  v = await picture('hpai_title_filename_200dpi');
  const exportsBefore = await p.eval(`${S}.exported || 0`);
  await p.click(`document.getElementById('em-export').click()`);
  await p.waitFor(`(${S}.exported || 0) > ${exportsBefore}`, 15000, 'export made');
  const zipFolder = await p.eval(`${S}.lastExport[0].name`);
  const params = await p.eval(`JSON.parse(${S}.lastExport.find(e => /export_params\\.json$/.test(e.name)).data)`);
  check(v.name === today + '_Briefing_Oct_22.png' && v.title === 'Briefing map' && params.export_label === 'Briefing Oct/22'
    && zipFolder === today + '_Briefing_Oct_22/',
    'png: "Optional Map Title" on the picture; "Optional Filename" names the picture and the CSV ZIP (<date>_<name>), recorded in export_params.json', [v.name, v.title, params.export_label, zipFolder]);
  await p.eval(`(() => { document.getElementById('em-png-title').value = ''; document.getElementById('em-png-label').value = ''; return true; })()`);
  // Streets (vector): no network note or quality; the streets data loaded when first used; roads, water and place
  // names drawn, the source line naming them.
  await pick('em-png-background', 'vector:streets');
  const stCtl = await p.eval(`({ quality: document.getElementById('em-png-quality-field').hidden, provider: document.getElementById('em-png-provider').hidden,
    loaded: !!window.WSDA_STREETS })`);
  v = await picture('hpai_streets_200dpi');
  check(stCtl.quality && stCtl.provider && !stCtl.loaded && v.background === 'vector:streets' && v.streetNames > 3
    && /Streets: U\.S\. Census Bureau TIGER\/Line/.test(v.source) && !v.notices.length && v.name === 'emergency_hpai_' + today + '.png',
  'png: Streets (vector): no quality or provider line, its data loaded when first used, place names and the streets\' source on the picture', [stCtl, v.background, v.streetNames, v.source]);
  await pick('em-png-background', 'standard');
  // The Streets data failing to load (a fresh page, its script refused once by the test): the Default background and
  // a notice; the next picture tries again and gets the streets.
  await open();
  await load([samplePath]);
  await p.eval(`(() => { const add = document.head.appendChild.bind(document.head); window.refusedStreets = 0;
    document.head.appendChild = n => { if (n.tagName === 'SCRIPT' && /streets-wa\\.js$/.test(n.src) && !window.refusedStreets++)
      n.src = n.src.replace('streets-wa.js', 'refused-by-the-test.js'); return add(n); }; return true; })()`);
  await pick('em-png-background', 'vector:streets');
  const stFailed = await picture();
  const stAgain = await picture();
  check(stFailed.state === 'completed' && stFailed.background === 'standard'
    && same(stFailed.notices, ['The Streets background could not be loaded, so the Default background was used.'])
    && stAgain.background === 'vector:streets' && !stAgain.notices.length && stAgain.streetNames > 3,
  'png: the Streets data not loaded: the picture on the Default background with a notice; the next picture tries again and has the streets',
    [stFailed.background, stFailed.notices, stAgain.background, stAgain.notices]);
  await pick('em-png-background', 'standard');

  // With the small CVI master: the CVI premises in a zone drawn and named in the key with the CVI tab's years.
  await open();
  await load([samplePath, path.join(TABLES, 'em_cvi_master.csv')]);
  await p.click(`document.getElementById('em-past').click()`);
  await p.click(`document.getElementById('em-past-rings').click()`);
  v = await picture('hpai_cvi_master_off_200dpi');
  check(v.boxes.length === 2 && !v.keyCounts.some(l => /^CVI PREMISES/.test(l)) && v.cvi.length === 0,
    'png: with a CVI master but the tick "CVI movements" off, no CVI boxes, no "CVI PREMISES" and no CVI premises drawn (3c)', [v.boxes, v.cvi]);
  await p.click(`document.getElementById('em-cvi').click()`);
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
      'Synthetic dispersal area: Yakima and Tri-Cities (made up)']) && same(v.boxes[0], ['Active positives', '8']) && v.panel.length === 2 && same(v.footer, [['Zones with a site inside', '2 of 2']]),
  'png: the screwworm outbreak: its title and file name, its two dispersal areas as zones (their names whole, on two lines), eight current positives', v);
  await b.send('Browser.setDownloadBehavior', { behavior: 'default' });
  fs.rmSync(DL, { recursive: true, force: true });
}

// The Overview (2.3): the "Map | Overview" switch (none before a load, the Map after each load, the keyboard), the
// three boxes (the people's "~" and what a screen reader hears) and the six "?" notes, the bars, the tables and the
// bars' hover box, the window and the play changing every figure (the people once the slider stops), no zones, the
// past rings adding no people and an added point's adding them, the Map shown again at its size; then the Overview's
// scenario (test-tables/em_rules_overview.csv with the agreed rings, 2 and 6 miles) against R's
// exact reference (local-test-artifacts/em/oracle_em.json): both tables cell for cell, the people inside the rings and
// inside the zone with a hole within 1% (or 25 people), each touched tract counted, the Idaho ring's "Washington
// only"; the fit made on the Map filling it; 320 pixels wide; the tracts' file failing to load. Pictures in
// local-test-artifacts/em/overview/ for a look.
async function partOverview(b) {
  const p = b.page, S = 'WSDA.emergency.state', OUTO = path.join(OUT, 'overview');
  const ORACLE = path.join(OUT, 'oracle_em.json');
  if (!fs.existsSync(ORACLE)) {
    check(false, 'overview: R reference missing: run Rscript tests/oracle/em_oracle.R first');
    return;
  }
  const R = JSON.parse(fs.readFileSync(ORACLE, 'utf8')).overview;
  const samplePath = path.join(OUT, 'sample', 'emergency_synthetic.zip');
  fs.rmSync(OUTO, { recursive: true, force: true });
  fs.mkdirSync(OUTO, { recursive: true });
  const shot = async name => fs.writeFileSync(path.join(OUTO, name + '.png'),
    Buffer.from((await b.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, p.sid)).data, 'base64'));
  const load = async files => {
    const v = await p.eval(`${S}.version`);
    await p.setFiles('#files-input', files);
    await emReady(p, v);
    await p.waitFor(`${S}.map.drawn && ${S}.map.drawn.positives > 0`, 15000, 'map drawn');
  };
  const show = v => p.eval(`(document.getElementById('show-${v}').click(), true)`);
  // The people worked out (the tracts' file loads the first time the Overview shows).
  const settled = () => p.waitFor(`${S}.view === 'overview' && ${S}.overview && !/Working out/.test(document.getElementById('ov-box-people').textContent)`,
    20000, 'the Overview worked out');
  const key = async (k, code) => {
    for (const type of ['keyDown', 'keyUp']) {
      await b.send('Input.dispatchKeyEvent', { type, key: k, code, windowsVirtualKeyCode: k === 'Enter' ? 13 : 32,
        text: type === 'keyDown' && k === 'Enter' ? '\r' : undefined }, p.sid);
    }
  };
  // The Overview as shown: each box's number, what a screen reader hears of it, and its note; the bars' hovers and
  // totals; the two tables' cells.
  const view = () => p.eval(`(() => { const s = ${S};
    // What shows (without the text for screen readers only) and what a screen reader hears (without what is hidden from it).
    const box = id => { const c = document.getElementById(id), st = c.querySelector('strong'), seen = st.cloneNode(true), heard = st.cloneNode(true);
      seen.querySelectorAll('.sr-only').forEach(e => e.remove());
      heard.querySelectorAll('[aria-hidden="true"]').forEach(e => e.remove());
      return { shown: seen.textContent, heard: heard.textContent, note: c.querySelector('.card-note').textContent, na: c.classList.contains('na') }; };
    const table = id => Array.from(document.querySelectorAll('#' + id + ' tr')).map(tr => Array.from(tr.children).map(c => c.textContent));
    const bars = id => { const svg = document.querySelector('#' + id + ' svg');
      return svg ? { width: Number(svg.getAttribute('width')), box: document.getElementById(id).clientWidth, text: svg.textContent,
        marks: Array.from(svg.querySelectorAll('.chart-mark')).map(m => m.getAttribute('data-hover')),
        totals: Array.from(svg.querySelectorAll('text[fill="#37474f"]')).map(t => t.textContent),
        above: !svg.querySelector('text[text-anchor="end"]') } : { text: document.getElementById(id).textContent, marks: [], totals: [] }; };
    const o = s.overview || {};
    return { view: s.view, map: !document.getElementById('view-map').hidden, overview: !document.getElementById('view-overview').hidden,
      pressed: ['map', 'overview'].map(v => document.getElementById('show-' + v).getAttribute('aria-pressed')),
      counties: box('ov-box-counties'), animals: box('ov-box-animals'), people: box('ov-box-people'),
      tilde: (document.querySelector('#ov-box-people strong [aria-hidden="true"]') || {}).textContent || null,
      county: bars('ov-county-chart'), layer: bars('ov-layer-chart'), ct: table('ov-counties-table'), pt: table('ov-positives-table'),
      total: o.people ? o.people.total : null, tracts: o.people ? o.people.tracts.length : null, window: s.window,
      scroll: document.documentElement.scrollWidth }; })()`);
  // The same figures worked out in the page by the rules alone, from its state: the people from the zones drawn.
  const rules = () => p.eval(`(() => { const s = ${S}, E = WSDA.emergencyRules, C = CVIWA_GEO.counties.features, d = WSDA.population.loaded('density');
    const tracts = d.tracts.map(t => ({ geoid: t.geoid, pop: t.pop, coordinates: WSDA.population.geometry(t).coordinates }));
    const added = s.points.map((q, k) => ({ index: 'added-' + k, name: q.name, lat: q.lat, lon: q.lon }));
    const sites = s.show === 'zones' && s.zoneFile ? E.zoneSites(s.zoneFile.zones) : E.ringSites(s.read.targets.concat(added), s.rings, s.unit);
    const people = sites.length ? E.peopleInside(sites, tracts, { year: d.year, counties: C }) : null;
    return { boxes: E.overviewBoxes(s.read, s.window, C, people), rows: E.countyRows(s.read, s.window, C).length,
      positives: E.positiveRows(s.read, s.window, C).rows.length, total: people && people.total }; })()`);

  await p.goto(new URL('emergency/index.html', SITE).href);
  await p.waitFor(`window.WSDA && WSDA.emergency && ${S}.map.ready`, 20000, 'Emergency map ready');
  check(await p.eval(`document.getElementById('em-view').hidden && document.getElementById('view-overview').hidden && !document.getElementById('view-map').hidden`),
    'overview: before a load no switch; the page is the map');
  await load([samplePath]);
  let v = await view();
  check(v.view === 'map' && v.map && !v.overview && same(v.pressed, ['true', 'false'])
    && await p.eval(`(() => { const g = document.getElementById('em-view'); return !g.hidden && g.getAttribute('role') === 'group' && g.getAttribute('aria-label') === 'View'
      && document.getElementById('show-overview').textContent === 'Overview'; })()`),
  'overview: after the load the Map shows, the switch "Map | Overview" above it, Map pressed', v.pressed);
  // The keyboard: Enter on "Overview" shows it; Space on "Map" goes back.
  await p.eval(`(document.getElementById('show-overview').focus(), true)`);
  await key('Enter', 'Enter');
  await settled();
  v = await view();
  check(v.view === 'overview' && v.overview && !v.map && same(v.pressed, ['false', 'true']), 'overview: Enter on "Overview" shows the Overview, the Map hidden', v.pressed);
  await p.eval(`(document.getElementById('show-map').focus(), true)`);
  await key(' ', 'Space');
  v = await view();
  check(v.view === 'map' && v.map && !v.overview && same(v.pressed, ['true', 'false']), 'overview: Space on "Map" shows the Map again', v.pressed);
  await show('overview');
  await settled();
  v = await view();
  let r = await rules();
  check(v.counties.shown === '5' && v.counties.note === '6 counties since Jul 2026' && v.animals.shown === '1.2M birds'
    && v.animals.note === '3,550 cattle · 3 commercial, 3 backyard' && v.counties.shown === String(r.boxes.counties.value),
  'overview: the sample\'s counties (5 with an active positive, 6 since Jul 2026) and animals (1.2M birds; the cattle and the flock types under it)', [v.counties, v.animals]);
  const shownPeople = '~' + r.boxes.people.value.toLocaleString('en-US');
  check(v.people.shown === shownPeople && v.tilde === '~' && v.people.heard === 'about ' + r.boxes.people.value.toLocaleString('en-US')
    && v.people.note === 'Estimate from ' + v.tracts + ' Census tracts (2020)' && v.total === r.total && v.tracts > 0,
  'overview: the people inside the zones as "~260,000" (the rules\' figure from the zones drawn), a screen reader hearing "about"; the note names the tracts and the year',
  [v.people, v.tilde, v.total, r.total]);
  // Each "?" opens its plain sentence and closes it again.
  const helps = await p.eval(`(() => { const out = [];
    for (const t of document.querySelectorAll('#view-overview button.tip')) {
      const n = document.getElementById(t.getAttribute('aria-controls'));
      t.click(); const open = !n.hidden && t.getAttribute('aria-expanded') === 'true' && n.textContent.length > 40 && t.title === n.textContent;
      t.click(); out.push({ help: t.dataset.help, open, closed: n.hidden && t.getAttribute('aria-expanded') === 'false', text: n.textContent });
    } return out; })()`);
  check(same(helps.map(h => h.help), ['ov-counties', 'ov-animals', 'ov-people', 'ov-time', 'ov-county', 'ov-layer']) && helps.every(h => h.open && h.closed)
    && /Department of Health/.test(helps[2].text) && /not a count of people exposed or sick/.test(helps[2].text),
  'overview: a "?" on each of its three boxes and three charts opens its plain sentence (the same on hover) and closes it; the people\'s names the Department of Health', helps);
  const sums = await p.eval(`${S}.result.layers.map(l => String(l.inside))`);
  check(v.county.marks.includes('Yakima: 2 active') && v.county.marks.includes('Snohomish: 1 closed') && same(v.county.totals, ['2', '1', '1', '1', '1', '1'])
    && v.county.width === v.county.box && same(v.layer.totals, sums) && /Infection zone/.test(v.layer.text) && /Control zone/.test(v.layer.text)
    && v.layer.marks.some(m => /^Commercial Poultry: \d+ in the Infection zone$/.test(m)),
  'overview: the bars by county (active and closed, a total per county, as wide as their panel) and by layer (each ring\'s count, the layer\'s total as "Inside the zones")', [v.county, v.layer]);
  check(same(v.ct[0], ['County', 'Active', 'Closed', 'Total', 'Animals (active)']) && same(v.ct[1], ['Yakima', '2', '0', '2', '1.2M birds'])
    && v.ct.length === 7 && v.pt.length === 8 && v.pt[1][0] === 'SYN-HPAI-007' && v.pt[0][0] === 'Case ID',
  'overview: the counties table (Yakima first, its 1.2M birds) and the positives table (every positive by the day, newest first)', [v.ct.slice(0, 2), v.pt.slice(0, 2)]);
  await p.eval(`(() => { const m = document.querySelector('#ov-county-chart .chart-mark'), r = m.getBoundingClientRect();
    m.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: r.left + 4, clientY: r.top + 4 })); return true; })()`);
  const tip = await p.eval(`document.getElementById('em-chart-tip').hidden ? null : document.getElementById('em-chart-tip').textContent`);
  check(tip === v.county.marks[0], 'overview: the pointer over a bar shows its count', tip);
  await p.eval(`(document.getElementById('ov-county-chart').dispatchEvent(new PointerEvent('pointerleave')), true)`);
  await shot('ov_01_sample_1280');
  // The day: an earlier day changes every figure, as the rules give it.
  const before = v;
  check(await p.eval(`document.getElementById('ov-badge').textContent === 'Oct 30, 2026' && !!document.querySelector('#ov-badge svg')
    && getComputedStyle(document.getElementById('ov-badge')).display !== 'none'
    && document.querySelector('#ov-box-counties .card-label').textContent === 'Counties with an active positive?'`),
  'overview: On a day the badge above it says the day with the pin; the counties box "Counties with an active positive"');
  await p.eval(`(() => { const i = document.getElementById('em-day'); i.value = '2026-09-05'; i.dispatchEvent(new Event('change')); return true; })()`);
  await settled();
  v = await view();
  r = await rules();
  check(v.counties.shown === String(r.boxes.counties.value) && v.ct.length === r.rows + 1 && v.pt.length === r.positives + 1
    && v.total === r.total && v.total !== before.total && v.pt.length < before.pt.length && v.animals.shown === r.boxes.animals.value,
  'overview: On a day Sep 5 changes the boxes, the people, the bars and both tables, as the rules give them', [v.counties, v.animals, v.total, r]);
  // Between dates: the counties with a positive detected, "n with an active one".
  await p.eval(`document.getElementById('em-view-range').click(); true`);
  await p.eval(`(() => { const i = document.getElementById('em-from'); i.value = '2026-09-01'; i.dispatchEvent(new Event('change')); return true; })()`);
  await settled();
  r = await rules();
  const between = await p.eval(`(() => { const c = document.getElementById('ov-box-counties');
    return { label: c.querySelector('.card-label').textContent, value: c.querySelector('strong').textContent, note: c.querySelector('.card-note').textContent,
      badge: document.getElementById('ov-badge').textContent }; })()`);
  check(between.label === 'Counties with a positive detected?' && between.value === String(r.boxes.counties.value) && between.note === r.boxes.counties.note
    && /^\d+ with an active one/.test(between.note) && between.badge === 'Sep 1, 2026 – Oct 30, 2026',
  'overview: Between dates the counties box counts the counties with a positive detected, "n with an active one" under it, as the rules give it; the badge the span and both dates', [between, r.boxes.counties]);
  await p.eval(`document.getElementById('em-view-day').click(); true`);
  await settled();
  // The play: each step's figures.
  await p.click(`document.getElementById('em-play').click()`);
  await p.waitFor(`${S}.stepAt >= 2`, 8000, 'two steps played');
  await p.click(`document.getElementById('em-play').click()`);
  await settled();
  // The slider: while it moves the people wait ("Working out…"), then they are worked out for the step shown.
  const sliding = await p.eval(`(() => { const i = document.getElementById('em-step'); i.value = '7'; i.dispatchEvent(new Event('input'));
    return document.getElementById('ov-box-people').textContent; })()`);
  await settled();
  v = await view();
  r = await rules();
  check(/Working out/.test(sliding) && v.total === r.total && v.people.shown === '~' + r.boxes.people.value.toLocaleString('en-US'),
    'overview: the slider moved: "Working out…" at once, then the people for the step shown, as the rules give them', [sliding, v.people, r.total]);
  v = await view();
  r = await rules();
  check(v.ct.length === r.rows + 1 && v.pt.length === r.positives + 1 && v.total === r.total && v.counties.shown === String(r.boxes.counties.value),
    'overview: the play\'s step shows its own figures', [v.window, r]);
  // No zones: every status unticked; the people box says what it needs, never zero.
  const statuses = await p.eval(`Array.from(document.querySelectorAll('#em-statuses input:checked')).map(i => (i.click(), i.value))`);
  await settled();
  v = await view();
  check(statuses.length > 0 && v.people.na && v.people.shown === 'Not available: needs zones' && v.people.note === '',
    'overview: no zones (every status unticked): "Not available: needs zones", never zero', [statuses, v.people]);
  await p.eval(`(Array.from(document.querySelectorAll('#em-statuses input')).forEach(i => { if (!i.checked) i.click(); }), true)`);
  await settled();
  // The closed positives' rings drawn add no people; an added point's rings add those inside them.
  r = await rules();
  const ringsOnly = r.total;
  await p.eval(`document.getElementById('positives-fold').open = true; true`);
  await p.click(`document.getElementById('em-past').click()`);
  await p.click(`document.getElementById('em-past-rings').click()`);
  await settled();
  v = await view();
  const pastRings = await p.eval(`${S}.zoneParts.pastSites.length`);
  check(pastRings > 0 && v.total === ringsOnly, 'overview: the closed positives\' rings drawn add no people', [pastRings, v.total, ringsOnly]);
  // With the past rings still drawn, a point added: the people worked out again, the added point's rings counted and
  // the past rings not.
  await p.eval(`(${S}.points.push({ name: 'Call-in', lat: 47.61, lon: -122.33 }), WSDA.emergency.compute(), true)`);
  await settled();
  v = await view();
  r = await rules();
  check(v.total === r.total && v.total > ringsOnly + 1000,
    'overview: an added point\'s rings add the people inside them, the closed rings still not, as the rules count them', [v.total, r.total, ringsOnly]);
  await p.eval(`(${S}.points.pop(), WSDA.emergency.compute(), true)`);
  await p.click(`document.getElementById('em-past-rings').click()`);
  await p.click(`document.getElementById('em-past').click()`);
  await settled();
  // The sample's zone file: its one zone named in the layer chart's key.
  await p.click(`document.querySelector('#em-show [data-show="zones"]').click()`);
  await settled();
  v = await view();
  check(/^Synthetic control area/.test(v.layer.text) && same(v.layer.marks, ['Commercial Poultry: 1 in Synthetic control area', 'Premise PINs by Species: 1 in Synthetic control area']),
    'overview: with the sample\'s zone file, the layer bars by its zone, named in the key', v.layer);
  await p.click(`document.querySelector('#em-show [data-show="rings"]').click()`);
  await settled();
  // The Map again, at its size.
  await show('map');
  check(await p.eval(`${S}.view === 'map' && ${S}.map.map.getCanvas().clientWidth > 300 && ${S}.map.map.getCanvas().clientHeight > 200`),
    'overview: back on the Map, the map has its size again');

  // The Overview's scenario against R.
  await load([path.join(TABLES, 'em_rules_overview.csv'), path.join(TABLES, 'em_zone_hole.geojson')]);
  check(await p.eval(`${S}.view`) === 'map', 'overview: a new set of files opens on the Map');
  await p.click(`document.getElementById('em-unit-mi').click()`);
  await p.eval(`(() => { [2, 6].forEach((d, k) => { const i = document.getElementById('em-ring-' + k); i.value = String(d); i.dispatchEvent(new Event('change')); }); return true; })()`);
  await show('overview');
  await settled();
  v = await view();
  const ring = await p.eval(`${S}.rings.map(x => x.distance).join(',') + ' ' + ${S}.unit`);
  const names = await p.eval(`${S}.read.targets.map(x => x.name)`);
  check(ring === '2,6 mi' && same(names, R.targets), 'overview: the scenario: rings of 2 and 6 miles around R\'s seven active positives', [ring, names]);
  const want = await p.eval(`(() => { const E = WSDA.emergencyRules, R = ${JSON.stringify(R.counties)};
    const text = c => [[c.birds, 'birds'], [c.cattle, 'cattle']].filter(x => x[0] !== null).map(x => E.bigNumber(x[0]) + ' ' + x[1]).join(', ');
    return R.map(c => [c.county, String(c.current), String(c.past), String(c.current + c.past), text(c)]); })()`);
  const byName = rows => rows.slice().sort((a, b) => (a[0] < b[0] ? -1 : 1));
  check(same(byName(v.ct.slice(1)), byName(want)), 'overview: the counties table equals R\'s, cell for cell (the blank County by its shape, Outside Washington, the cattle apart)',
    [v.ct.slice(1), want]);
  check(same(v.pt.slice(1), R.positives), 'overview: the positives table equals R\'s, cell for cell and in order', [v.pt.slice(1, 3), R.positives.slice(0, 2)]);
  const near = (got, exact) => Math.abs(got - exact) <= Math.max(25, exact * 0.01);
  check(near(v.total, R.people.rings.total) && v.tracts === R.people.rings.tracts.length
    && v.people.shown === '~' + (await p.eval(`WSDA.emergencyRules.roughly(${v.total})`)).toLocaleString('en-US')
    && v.people.note === 'Estimate from ' + v.tracts + ' Census tracts (2020) · Washington only',
  'overview: the people inside the rings within 1% of R\'s exact areas, the same tracts touched; Idaho 01\'s ring makes it "Washington only"',
  [v.total, R.people.rings.total, v.tracts, R.people.rings.tracts.length, v.people.note]);
  // The zone file ticked while the Overview shows: the map's fit to the zone waits for the Map.
  const zoomBefore = await p.eval(`${S}.map.map.getZoom()`);
  await p.click(`document.querySelector('#em-show [data-show="zones"]').click()`);
  await settled();
  v = await view();
  check(near(v.total, R.people.zone.total) && v.tracts === R.people.zone.tracts.length && /^Not available: needs a facility layer$/.test(v.layer.text),
    'overview: the people inside the zone with a hole within 1% of R\'s, the same tracts touched; no layer, no layer bars', [v.total, R.people.zone.total, v.tracts]);
  await shot('ov_02_scenario_zone_1280');
  const waiting = await p.eval(`${S}.fitNext`);
  await show('map');
  await sleep(300);
  const fitted = await p.eval(`(() => { const s = ${S}, m = s.map.map, b = m.getBounds(), box = [180, 90, -180, -90];
    const walk = a => (typeof a[0] === 'number' ? (box[0] = Math.min(box[0], a[0]), box[1] = Math.min(box[1], a[1]),
      box[2] = Math.max(box[2], a[0]), box[3] = Math.max(box[3], a[1])) : a.forEach(walk));
    s.zoneFile.zones.forEach(z => walk(z.geometry.coordinates));
    const zoneBox = box.slice();
    WSDA.emergencyRules.groups(s.read, s.window).current.forEach(x => walk([x.lon, x.lat]));
    const sw = m.project([box[0], box[1]]), ne = m.project([box[2], box[3]]), c = m.getCanvas();
    return { fitNext: s.fitNext, zoom: m.getZoom(), inside: b.getWest() <= box[0] && b.getSouth() <= box[1] && b.getEast() >= box[2] && b.getNorth() >= box[3],
      span: Math.max((ne.x - sw.x) / c.clientWidth, (sw.y - ne.y) / c.clientHeight), wider: box[0] < zoneBox[0] || box[2] > zoneBox[2] }; })()`);
  check(waiting && !fitted.fitNext && fitted.inside && fitted.span >= 0.5 && fitted.wider,
    'overview: the zone file ticked on the Overview: the map\'s fit waits, then on the Map it fits the zone and the positives shown (2.4), filling at least half the map', [waiting, zoomBefore, fitted]);
  await show('overview');
  await settled();
  // 320 pixels wide: one column, the boxes one to a row, the bars' labels above them, nothing scrolling sideways.
  await b.send('Emulation.setDeviceMetricsOverride', { width: 320, height: 900, deviceScaleFactor: 1, mobile: true }, p.sid);
  await sleep(500);
  v = await view();
  const boxes = await p.eval(`Array.from(document.querySelectorAll('#ov-boxes .count-card')).map(c => { const r = c.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top)]; })`);
  check(v.scroll <= 321 && boxes.every(x => x[0] === boxes[0][0]) && boxes[1][1] > boxes[0][1] && boxes[2][1] > boxes[1][1]
    && v.county.above && v.county.width === v.county.box && v.county.box <= 300,
  'overview: at 320 pixels wide nothing scrolls sideways, the boxes one to a row, the bars\' labels above their bars at the panel\'s width', [v.scroll, boxes, v.county.width]);
  await shot('ov_03_scenario_320');
  await b.send('Emulation.clearDeviceMetricsOverride', {}, p.sid);
  // The tracts' file failing to load (a fresh page, its load refused before the files, since the density layer is
  // on after a load): the people box says so, never zero.
  await p.goto(new URL('emergency/index.html', SITE).href);
  await p.waitFor(`window.WSDA && WSDA.emergency && ${S}.map.ready`, 20000, 'Emergency map ready');
  await p.eval(`(WSDA.population.load = () => Promise.reject(new Error('refused by the test')), true)`);
  await load([samplePath]);
  await show('overview');
  await settled();
  v = await view();
  check(v.people.na && v.people.shown === 'Not available: the Census tracts could not be loaded' && v.people.note === ''
    && v.counties.shown === '5', 'overview: the tracts\' file not loaded: the people box says so (never zero), the other boxes as before', [v.people, v.counties]);
}

// 2.6, "Draw a zone", by real input: mouse presses and releases, moves, drags and keys through the DevTools protocol
// (the map's own events, as a user's), and touch taps with Chrome's touch emulation. The sample loaded, near Yakima:
// a six-corner zone around SYN-HPAI-001 beside the sample's zone file.
// 2.7, the animal filter ("Animals" under "Positives and zones"), by real clicks on its ticks: each kind left out
// leaves the map, the boxes, the legend, the zones' days since, "Inside the zones", the badges, the fold's summary,
// the map picture's line and the Export; none ticked says so; every kind ticked again at each load; no ticks for a
// file with one kind. The breakdown (2.7): with every layer ticked, the picture's counts by positive and
// layer against the Export's inside_the_zones.csv, drawn on the county line, inside the column, clear of the notes.
async function partFilter(b) {
  const p = b.page, S = 'WSDA.emergency.state', R = 'WSDA.emergencyRules';
  const samplePath = path.join(OUT, 'sample', 'emergency_synthetic.zip');
  const middle = sel => p.eval(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.scrollIntoView({ block: 'nearest' });
    const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
  const tick = async shape => {
    const q = await middle(`#em-animals input[value="${shape}"]`), v = await p.eval(`${S}.version || 0`);
    for (const type of ['mousePressed', 'mouseReleased']) {
      await b.send('Input.dispatchMouseEvent', { type, x: q.x, y: q.y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 }, p.sid);
    }
    await sleep(400);
    await p.waitFor(`!${S}.loading`, 15000, 'filter redrawn');
    return v;
  };
  const open = async files => {
    await p.goto(new URL('emergency/index.html', SITE).href);
    await p.waitFor('window.WSDA && WSDA.emergency && WSDA.emergency.state.map.ready', 20000, 'Emergency map ready');
    await p.setFiles('#files-input', files);
    await emReady(p);
    await p.waitFor(`${S}.map.drawn && ${S}.map.drawn.positives > 0`, 15000, 'map drawn');
    await p.eval(`document.getElementById('positives-fold').open = true; scrollTo(0, 0); true`);
  };
  // What the page shows, and what the rules give for the kinds ticked.
  const seen = () => p.eval(`(() => { const s = ${S}, R = ${R}, shapes = list => [...new Set(list.map(q => R.animalShapeOf(s.type, q)))].sort().join();
    const g = R.groups(s.read, s.window), tag = id => { const t = document.querySelector('#' + id + ' .only-tag'); return t ? t.textContent : null; };
    return { ticks: [...document.querySelectorAll('#em-animals label')].map(l => [l.textContent, l.querySelector('input').checked, l.querySelector('.lg-animal').dataset.shape]),
      fieldHidden: document.getElementById('em-animals-field').hidden, msg: !document.getElementById('em-animals-msg').hidden,
      readShapes: shapes(s.read.positives), allCount: s.readAll.positives.length, drawn: s.map.drawn.positives, current: g.current.length,
      box: document.querySelector('#box-positives strong').textContent.replace(/\\D/g, ''), last: document.querySelector('#box-last strong').textContent,
      legend: [...document.querySelectorAll('#em-legend-content p')].map(q => q.textContent), sum: document.getElementById('positives-sum').textContent,
      badge: tag('em-badge'), ovBadge: tag('ov-badge'), countedShapes: shapes(s.zoneParts.counted), targetShapes: shapes(s.read.targets || []),
      insideSites: (s.result ? s.result.rows : []).every(r => s.zoneParts.sites.some(z => z.id === r.site)) && s.zoneParts.sites.length === (s.read.targets || []).length,
      insideText: document.getElementById('tab-inside').textContent.slice(0, 80),
      asof: [...document.querySelectorAll('#asof-lines li')].map(l => l.textContent).find(t => /positive/.test(t)) || '' }; })()`);
  const legendAnimals = v => v.legend.slice(v.legend.indexOf('Animals') + 1).filter(t => /^(Birds|Cattle|Other animals)$/.test(t));

  await open([samplePath]);
  const all = await seen();
  check(!all.fieldHidden && same(all.ticks, [['Birds (5)', true, 'circle'], ['Cattle (2)', true, 'square']]) && !all.msg,
  'filter: "Animals" under "Positives and zones": a tick per kind with its shape and the file\'s count, every one ticked after the load', all.ticks);
  check(all.badge === null && all.ovBadge === null && !/only/.test(all.sum) && all.readShapes === 'circle,square',
  'filter: every kind ticked: no tag on the badges, nothing in the summary, every positive read', [all.badge, all.sum]);

  await tick('square');
  const birds = await seen();
  check(birds.readShapes === 'circle' && birds.drawn === birds.current && birds.drawn < all.drawn && birds.box === String(birds.current)
    && same(legendAnimals(birds), ['Birds']),
  'filter: cattle unticked by a click: only the birds\' positives on the map, in the "Active" box and in the legend\'s Animals', [birds.drawn, all.drawn, birds.box, legendAnimals(birds)]);
  check(birds.countedShapes === 'circle' && birds.targetShapes === 'circle' && birds.insideSites,
  'filter: the zones\' days since the last positive count the birds only, and every site inside belongs to a bird positive\'s zones', [birds.countedShapes, birds.targetShapes]);
  check(birds.badge === 'Birds only' && birds.ovBadge === 'Birds only' && /birds only/.test(birds.sum) && /^7 positives/.test(birds.asof.replace(/^[^:]*: /, '')),
  'filter: said on the map\'s and the Overview\'s badges ("Birds only") and in the fold\'s summary; the loaded-file line still counts the whole file', [birds.badge, birds.sum, birds.asof]);
  // The Overview's boxes, bars and tables and its chart: as the rules give them for the birds, not for the whole file.
  await p.eval(`${S}.overview = null; document.getElementById('show-overview').click(); true`);
  await p.waitFor(`${S}.view === 'overview' && ${S}.overview && ${S}.chart`, 20000, 'the Overview drawn with cattle unticked');
  const ov = await p.eval(`(() => { const s = ${S}, R = ${R}, o = s.overview, win = s.window, counties = CVIWA_GEO.counties.features, J = JSON.stringify;
    const boxesOf = read => { const b = R.overviewBoxes(read, win, counties, o.people); delete b.people; return J(b); };
    const shown = Object.assign({}, o.boxes); delete shown.people;
    const as = read => ({ rows: J(R.countyRows(read, win, counties)), positives: J(R.positiveRows(read, win, counties)),
      bars: J(R.overviewBars(R.countyRows(read, win, counties), s.result)), boxes: boxesOf(read), chart: J(R.overTime(read, win, s.chartSteps)) });
    const birds = as(s.read), all = as(s.readAll), now = { rows: J(o.rows), positives: J(o.positives), bars: J(o.bars), boxes: J(shown), chart: J(s.chart) };
    return Object.fromEntries(Object.keys(now).map(k => [k, [now[k] === birds[k], birds[k] !== all[k]]])); })()`);
  await p.eval(`(document.getElementById('show-map').click(), true)`);
  check(Object.values(ov).every(([same]) => same) && ['rows', 'positives', 'boxes', 'chart'].every(k => ov[k][1]),
  'filter: cattle unticked: the Overview\'s boxes, county bars and tables and the chart count the birds\' positives only (2.7)', ov);

  await p.eval(`document.getElementById('export-fold').open = true; ${S}.lastPreview = null; true`);
  await p.click(`document.getElementById('em-preview').click()`);
  await p.waitFor(`${S}.lastPreview`, 60000, 'preview drawn');
  const meta = await p.eval(`(() => { const m = ${S}.lastPreview.model; CVIWA.previews.close && CVIWA.previews.close(); return m.meta.left; })()`);
  check(/^Positives: birds only · Zones: /.test(meta), 'filter: the map picture\'s line over the map starts "Positives: birds only"', meta);
  await p.eval(`WSDA.sample.download = function () {}; document.getElementById('em-export').click(); true`);
  const files = await p.eval(`(() => { const out = {}; (${S}.lastExport || []).filter(e => !e.dir).forEach(e => { out[e.name.replace(/^.*\\//, '')] = e.data; }); return out; })()`);
  const params = JSON.parse(files['export_params.json'] || '{}');
  const csvNames = String(files['positives.csv'] || '').split('\n').slice(1).filter(Boolean).map(l => l.split(',')[0]);
  const birdNames = await p.eval(`${S}.read.positives.map(q => q.name)`);
  // One kind is written plain ("Birds"), as export_params.json writes every one-element list (R's auto_unbox).
  check(params.animals_shown === 'Birds' && params.positives === birdNames.length && csvNames.length > 0 && csvNames.every(n => birdNames.includes(n.replace(/"/g, ''))),
  'filter: the Export: export_params.json animals_shown "Birds" and its positives count, positives.csv the birds\' positives only', [params.animals_shown, params.positives, csvNames, birdNames]);

  await tick('circle');
  const none = await seen();
  check(none.msg && none.drawn === 0 && none.last === 'Tick at least one kind of animal' && /Tick at least one kind of animal/.test(none.insideText)
    && /no animals ticked/.test(none.sum) && none.badge === null,
  'filter: every kind unticked: "Tick at least one kind of animal." under the ticks, in the "Last positive" box and the "Inside the zones" tab; no positive drawn', [none.last, none.insideText, none.sum]);
  await tick('circle');
  await tick('square');
  const back = await seen();
  check(back.drawn === all.drawn && back.box === all.box && back.badge === null && !back.msg && back.readShapes === 'circle,square',
  'filter: both ticked again: the page as at the load', [back.drawn, all.drawn]);

  // The breakdown (2.7), with every layer ticked: each panel row's counts by layer as the Export's
  // inside_the_zones.csv gives them; each layers line inside the column; the rows clear of the notes; the shared-site
  // note when a site is in two positives' zones.
  await p.eval(`(() => { document.querySelectorAll('#em-layers input:not(:checked)').forEach(i => i.click()); return true; })()`);
  await p.waitFor(`!${S}.loading && ${S}.result`, 15000, 'every layer checked');
  await p.eval(`${S}.lastPreview = null; true`);
  await p.click(`document.getElementById('em-preview').click()`);
  await p.waitFor(`${S}.lastPreview`, 60000, 'preview drawn with every layer');
  const pan = await p.eval(`(() => { const m = ${S}.lastPreview.model, s = ${S}; CVIWA.previews.close && CVIWA.previews.close();
    const label = Object.fromEntries(s.result.layers.map(l => [l.key, l.label])), seen = new Map();
    s.result.rows.forEach(r => { const k = r.layer + '|' + r.lat + '|' + r.lon + '|' + r.name; seen.set(k, (seen.get(k) || new Set()).add(r.site)); });
    const BR = WSDA.branded, column = (0.96 - 0.05) * BR.px(BR.LAYOUT.gutterW), P = m.panel;
    const lineEnd = ln => ln.x + ln.items.reduce((t, it) => t + 0.84 * ln.pt + 0.25 * ln.pt + BR.textWidth(String(it.n), ln.pt, true) + 0.9 * ln.pt, 0) - 0.9 * ln.pt;
    return { rows: P.rows.map(r => ({ name: r.name, count: r.count, layers: r.layers.map(x => [label[x.key], x.n]), onCounty: !!(r.layerLines[0] && r.layerLines[0].y === r.subY),
        inColumn: r.layerLines.every(ln => lineEnd(ln) <= column + 1e-6), drawnAll: [].concat(...r.layerLines.map(ln => ln.items)).length === r.layers.length })),
      layersIn: s.result.layers.filter(l => l.inside > 0).length, notes: P.notes,
      clear: P.rowsTop - P.rows.reduce((t, r) => t + r.height, 0) >= P.footTop + (P.notes.length ? 0.045 + 0.03 * (P.notes.length - 1) : 0) / P.u - 1e-9,
      shared: [...seen.values()].some(set => set.size > 1) }; })()`);
  await p.eval(`(() => { ${S}.lastExport = null; document.getElementById('em-export').click(); return true; })()`);
  await p.waitFor(`${S}.lastExport`, 30000, 'export with every layer');
  const insideRows = await p.eval(`(() => { const f = (${S}.lastExport || []).find(e => /inside_the_zones\\.csv$/.test(e.name));
    return f ? CVIWA.csv.parse(f.data).rows : []; })()`);
  const fromCsv = name => {
    const by = new Map();
    insideRows.filter(r => r[0] === name).forEach(r => by.set(r[1], (by.get(r[1]) || new Set()).add(r[2])));
    return [...by].map(([l, set]) => [l, set.size]);
  };
  const sorted = list => list.slice().sort((a, b) => (a[0] < b[0] ? -1 : 1));
  check(pan.rows.length > 0 && pan.layersIn >= 3 && pan.rows.some(r => r.layers.length > 1)
    && pan.rows.every(r => same(sorted(r.layers), sorted(fromCsv(r.name))) && r.layers.reduce((t, x) => t + x[1], 0) === Number(r.count.replace(/,/g, ''))),
  'filter: the map picture with every layer: each POSITIVES row\'s sites inside by layer as the Export\'s inside_the_zones.csv gives them, adding up to its count (2.7)',
    pan.rows.map(r => [r.name, r.count, r.layers.map(x => x.join(' ')).join(', ')]));
  check(pan.rows.filter(r => r.layers.length).every(r => r.inColumn && r.drawnAll) && pan.rows.some(r => r.onCounty) && pan.clear
    && same(pan.notes.filter(t => /shared/.test(t)), pan.shared ? ['A shared site counts under each positive'] : []),
  'filter: the map picture: each layer\'s mark and count drawn on the county line and under it, inside the column, the rows clear of the notes; the shared-site note when a site is in two positives\' zones (2.7)',
    [pan.rows.map(r => [r.name, r.onCounty, r.inColumn]), pan.notes, pan.shared]);

  await tick('square');
  await p.setFiles('#files-input', [samplePath]);
  await emReady(p, await p.eval(`${S}.version`));
  await p.waitFor(`${S}.map.drawn && ${S}.map.drawn.positives > 0`, 15000, 'map drawn again');
  const again = await seen();
  check(same(again.ticks.map(t => t[1]), [true, true]) && again.readShapes === 'circle,square' && again.badge === null,
  'filter: files loaded again: every kind ticked again (question 6)', again.ticks);
  // A zone file chosen with cattle unticked redraws the loaded files' lines: the positives line still counts the file.
  await tick('square');
  await p.setFiles('#em-zone-file', [path.join(TABLES, 'em_bundle', 'zones.geojson')]);
  await p.waitFor(`${S}.zoneFile && !${S}.loading`, 20000, 'zone file used');
  await sleep(500);
  const zoned = await seen();
  check(zoned.readShapes === 'circle' && /^7 positives/.test(zoned.asof.replace(/^[^:]*: /, '')),
  'filter: a zone file chosen with cattle unticked: the loaded-file line still counts the whole file (7 positives)', zoned.asof);
  // With birds unticked too, the zone file's zones still count their sites: the tab says to tick a kind first, then
  // lists them, as the "Sites inside" box counts them.
  await tick('circle');
  const zonedNone = await p.eval(`(() => { const s = ${S}, tab = document.getElementById('tab-inside');
    return { first: tab.firstElementChild ? tab.firstElementChild.textContent : '', zones: tab.querySelectorAll('.em-zones-list').length,
      sites: s.result ? s.result.rows.length : 0, layers: tab.querySelectorAll('details.em-layer[data-layer]').length,
      box: document.querySelector('#box-inside strong').textContent }; })()`);
  check(zonedNone.first === 'Tick at least one kind of animal.' && zonedNone.zones === 1 && zonedNone.sites > 0 && zonedNone.layers > 0
    && zonedNone.box !== '0',
  'filter: every kind unticked with a zone file: "Inside the zones" says to tick a kind, then still lists the zones and their sites inside', zonedNone);
  // ... and the Export and the map picture are refused, saying the same.
  await p.eval(`(() => { const s = ${S}; s.lastExport = null; s.lastPreview = null; document.getElementById('export-fold').open = true;
    document.getElementById('em-export').click(); return true; })()`);
  const exportSaid = await p.eval(`document.getElementById('em-export-result').textContent`);
  await p.eval(`(document.getElementById('em-preview').click(), true)`);
  await sleep(1500);
  const refused = await p.eval(`({ said: document.getElementById('em-export-result').textContent, made: !!(${S}.lastExport || ${S}.lastPreview) })`);
  check(exportSaid === 'Tick at least one kind of animal.' && refused.said === 'Tick at least one kind of animal.' && !refused.made,
  'filter: every kind unticked: the Export and the map picture are not made; the line under them says "Tick at least one kind of animal."', [exportSaid, refused]);

  // The CVI movements with cattle unticked: looked up around the birds' positives with zones only.
  await open([samplePath, path.join(TABLES, 'em_cvi_master.csv')]);
  await p.eval(`(document.getElementById('em-cvi').click(), document.getElementById('show-cvi').click(), true)`);
  await p.waitFor(`${S}.cviRes && ${S}.cviRes.status === 'ok'`, 30000, 'CVI result');
  const cviAll = await p.eval(`({ sites: ${S}.cviRes.siteCvis.length, cvis: ${S}.cviRes.summary.cvis, targets: ${S}.read.targets.length })`);
  await p.eval(`${S}.cviRes = null; true`);
  await tick('square');
  await p.waitFor(`${S}.cviRes && ${S}.cviRes.status === 'ok'`, 30000, 'CVI result with cattle unticked');
  const cviBirds = await p.eval(`({ sites: ${S}.cviRes.siteCvis.length, cvis: ${S}.cviRes.summary.cvis, targets: ${S}.read.targets.length,
    birds: ${S}.read.targets.every(q => WSDA.emergencyRules.animalShapeOf(${S}.type, q) === 'circle') })`);
  check(cviAll.sites === cviAll.targets && cviBirds.sites === cviBirds.targets && cviBirds.birds && cviBirds.sites < cviAll.sites && cviBirds.cvis <= cviAll.cvis,
  'filter: cattle unticked: the CVI movements are looked up around the birds\' positives with zones only (2.7)', [cviAll, cviBirds]);

  // The kinds are the whole file's, its rows not mapped too: cattle whose only row has no coordinates still get a
  // tick (and stay in "Not mapped"); with no row mapped at all, every kind is still ticked and nothing says to tick one.
  const FX = require(path.join(ROOT, 'tests', 'synthetic', 'make_em_fixtures.js')), OUTF = path.join(OUT, 'filter');
  fs.mkdirSync(OUTF, { recursive: true });
  const fxRow = (id, lat, long, flock, production, species) => [id, '09/01/2026', '', '09/02/2026', '', '(synthetic) Example Farm',
    '(synthetic) Example Road', 'Synthetic Town', 'Yakima', lat, long, 'Active', 'H5N1 2.3.4.4b', flock, production, species, '1000', '1000', '1', 'Landfill'].join(',');
  const birdsRows = [fxRow('FX-001', '46.55', '-120.47', 'Commercial', 'Commercial Table Egg Layer', 'Chicken'),
    fxRow('FX-002', '46.40', '-120.32', 'Backyard', 'Backyard Flock', 'Chicken'), fxRow('FX-003', '46.60', '-120.60', 'Backyard', 'Backyard Flock', 'Duck')];
  const cattleRow = fxRow('FX-004', '', '', 'Commercial', 'Dairy', 'Dairy Cow');
  const unmapped = path.join(OUTF, 'em_filter_cattle_unmapped.csv'), noneMapped = path.join(OUTF, 'em_filter_none_mapped.csv');
  fs.writeFileSync(unmapped, [FX.AGREED_HEAD.join(',')].concat(birdsRows, [cattleRow]).join('\n') + '\n');
  fs.writeFileSync(noneMapped, [FX.AGREED_HEAD.join(',')].concat(birdsRows.map(r => r.replace(/,46\.\d+,-120\.\d+,/, ',,,')), [cattleRow]).join('\n') + '\n');
  const fileSeen = () => p.eval(`(() => { const s = ${S};
    return { ticks: [...document.querySelectorAll('#em-animals label')].map(l => [l.textContent, l.querySelector('input').checked]),
      hidden: document.getElementById('em-animals-field').hidden, msg: !document.getElementById('em-animals-msg').hidden,
      dropped: s.read.dropped.map(q => q.name), mapped: s.read.positives.length, last: document.querySelector('#box-last strong').textContent,
      notMapped: !!document.querySelector('#tab-inside .em-notmapped'), inside: document.getElementById('tab-inside').textContent.slice(0, 80) }; })()`);
  await open([unmapped]);
  const u = await fileSeen();
  check(!u.hidden && same(u.ticks, [['Birds (3)', true], ['Cattle (1)', true]]) && same(u.dropped, ['FX-004']) && u.notMapped && !u.msg,
  'filter: a cattle row that could not be mapped, beside mapped birds: the cattle still get a tick, counted, and the row stays in "Not mapped"', u);
  await p.goto(new URL('emergency/index.html', SITE).href);
  await p.waitFor('window.WSDA && WSDA.emergency && WSDA.emergency.state.map.ready', 20000, 'Emergency map ready');
  await p.setFiles('#files-input', [noneMapped]);
  await emReady(p);
  await p.waitFor(`${S}.read && !${S}.loading`, 15000, 'a file with no row mapped read');
  const n0 = await fileSeen();
  check(!n0.hidden && same(n0.ticks, [['Birds (3)', true], ['Cattle (1)', true]]) && n0.mapped === 0 && n0.dropped.length === 4 && !n0.msg
    && n0.last !== 'Tick at least one kind of animal' && n0.notMapped && !/Tick at least one kind/.test(n0.inside),
  'filter: a file with no row mapped: every kind ticked, no "Tick at least one kind of animal.", and "Inside the zones" lists the rows not mapped', n0);
  // A positives file with its header only: no kind, no ticks, and nothing says to tick one.
  const headerOnly = path.join(OUTF, 'em_filter_header_only.csv');
  fs.writeFileSync(headerOnly, FX.AGREED_HEAD.join(',') + '\n');
  await p.goto(new URL('emergency/index.html', SITE).href);
  await p.waitFor('window.WSDA && WSDA.emergency && WSDA.emergency.state.map.ready', 20000, 'Emergency map ready');
  await p.setFiles('#files-input', [headerOnly]);
  await emReady(p);
  await sleep(500);
  const h0 = await p.eval(`(() => { const s = ${S}; return { read: !!s.readAll, rows: s.readAll ? s.readAll.positives.length + s.readAll.dropped.length : null,
    hidden: document.getElementById('em-animals-field').hidden, msg: !document.getElementById('em-animals-msg').hidden,
    last: document.querySelector('#box-last strong').textContent, inside: document.getElementById('tab-inside').textContent.slice(0, 80) }; })()`);
  check(h0.read && h0.rows === 0 && h0.hidden && !h0.msg && h0.last !== 'Tick at least one kind of animal' && !/Tick at least one kind/.test(h0.inside),
  'filter: a positives file with its header only: no "Animals" ticks and no "Tick at least one kind of animal."', h0);

  await open([path.join(TABLES, 'em_nws_synthetic_positives.csv')]);
  const one = await p.eval(`({ hidden: document.getElementById('em-animals-field').hidden, n: document.querySelectorAll('#em-animals input').length })`);
  check(one.hidden && one.n === 0, 'filter: a file with one kind of animal (the screwworm outbreak): no "Animals" ticks', one);
}

async function partDraw(b) {
  const p = b.page, S = 'WSDA.emergency.state', D = 'WSDA.emergency.draw', R = 'WSDA.emergencyRules';
  const samplePath = path.join(OUT, 'sample', 'emergency_synthetic.zip'), DIR = path.join(OUT, 'draw');
  fs.mkdirSync(DIR, { recursive: true });
  const VIEW = [[-120.53, 46.355], [-120.25, 46.61]];
  const CORNERS = [[-120.505, 46.598], [-120.43, 46.59], [-120.405, 46.553], [-120.418, 46.515], [-120.47, 46.508], [-120.52, 46.54]];
  const HOVER_AT = [-120.452, 46.523];
  const mouse = (type, q, extra) => b.send('Input.dispatchMouseEvent', Object.assign({ type, x: q.x, y: q.y,
    button: type === 'mouseMoved' ? 'none' : 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 }, extra || {}), p.sid);
  // A click (count 2: a double-click, sent as Chrome sends one: two presses and releases, the second with clickCount 2).
  const click = async (q, count) => {
    for (let k = 1; k <= (count || 1); k++) {
      await mouse('mousePressed', q, { clickCount: k });
      await mouse('mouseReleased', q, { clickCount: k });
    }
    await sleep(150);
  };
  const move = async q => { await mouse('mouseMoved', q); await sleep(100); };
  // A drag with the button held, in steps.
  const dragTo = async (from, to) => {
    await mouse('mouseMoved', from);
    await mouse('mousePressed', from);
    for (let k = 1; k <= 4; k++) {
      await mouse('mouseMoved', { x: Math.round(from.x + (to.x - from.x) * k / 4), y: Math.round(from.y + (to.y - from.y) * k / 4) },
        { button: 'left', buttons: 1 });
      await sleep(40);
    }
    await mouse('mouseReleased', to);
    await sleep(200);
  };
  const KEYS = { Enter: ['Enter', 13], Escape: ['Escape', 27], Backspace: ['Backspace', 8] };
  const key = async k => {
    const [code, vk] = KEYS[k];
    await b.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code, windowsVirtualKeyCode: vk }, p.sid);
    await b.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk }, p.sid);
    await sleep(150);
  };
  // A [lon, lat] as a point of the window, and an element's middle.
  const at = ll => p.eval(`(() => { const m = ${S}.map.map, r = m.getCanvas().getBoundingClientRect(), q = m.project(${JSON.stringify(ll)});
    return { x: Math.round(r.left + q.x), y: Math.round(r.top + q.y) }; })()`);
  const middle = sel => p.eval(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.scrollIntoView({ block: 'nearest' });
    const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
  const press = async sel => click(await middle(sel));
  // The label as shown, and the rules' lines for the corners placed and the pointer at a window point.
  const label = q => p.eval(`(() => { const l = document.getElementById('dz-label'), m = ${S}.map.map, r = m.getCanvas().getBoundingClientRect();
    const ll = m.unproject([${q ? q.x : 0} - r.left, ${q ? q.y : 0} - r.top]);
    return { shown: !l.hidden, text: l.innerText, warn: l.classList.contains('warn'),
      want: ${R}.drawLabel(${D}.corners(), [ll.lng, ll.lat], ${S}.unit).lines.join('\\n'), corners: ${D}.corners().length }; })()`);
  const view = () => p.eval(`(() => { ${S}.map.map.fitBounds(${JSON.stringify(VIEW)}, { padding: 40, animate: false }); return true; })()`)
    .then(() => sleep(400));
  const open = async files => {
    await p.goto(new URL('emergency/index.html', SITE).href);
    await p.waitFor('window.WSDA && WSDA.emergency && WSDA.emergency.state.map.ready', 20000, 'Emergency map ready');
    await p.setFiles('#files-input', files);
    await emReady(p);
    await p.waitFor(`${S}.map.drawn && ${S}.map.drawn.positives > 0`, 15000, 'map drawn');
    await p.eval(`document.getElementById('positives-fold').open = true; document.getElementById('dz-fold').open = true; scrollTo(0, 0); true`);
    await view();
  };
  const zoneState = () => p.eval(`(() => { const s = ${S}, m = s.map.map; return { mode: ${D}.mode(), drawn: s.drawn.map(z => ({ name: z.name,
      vertices: z.vertices, shape: z.shape })), show: s.show,
    pressed3: [...document.querySelectorAll('#em-show [data-show]')].filter(x => x.getAttribute('aria-pressed') === 'true').map(x => x.dataset.show).join(),
    switchOff: [...document.querySelectorAll('#em-show [data-show]')].filter(x => x.disabled).map(x => x.dataset.show).join(),
    ringsHidden: document.getElementById('em-rings-field').hidden,
    zones: s.mapData.zones, guide: s.mapData.guide, zonesMode: s.days.zonesMode, zoom: m.getZoom(), center: m.getCenter().toArray(),
    dblZoom: m.doubleClickZoom.isEnabled(), badge: document.getElementById('dz-badge').hidden ? null : document.getElementById('dz-badge').textContent,
    label: !document.getElementById('dz-label').hidden, start: document.getElementById('dz-start').textContent,
    pressed: document.getElementById('dz-start').getAttribute('aria-pressed'), tools: !document.getElementById('dz-tools').hidden,
    status: document.getElementById('dz-status').hidden ? null : document.getElementById('dz-status').textContent,
    list: [...document.querySelectorAll('#dz-list li')].map(li => [li.querySelector('input').value, ...[...li.querySelectorAll('button')].map(x => x.textContent),
      li.querySelector('.dz-area').textContent]),
    sketch: s.map.em.draw.features.map(f => f.properties.kind), crosshair: m.getContainer().classList.contains('drawing') }; })()`);

  await b.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }, p.sid);
  await open([samplePath]);
  let z = await zoneState();
  check(z.mode === null && z.show === 'rings' && z.pressed3 === 'rings' && z.switchOff === '' && z.zones === 12 && z.list.length === 0 && z.start === 'Draw on map'
    && z.pressed === 'false' && !z.tools && z.dblZoom, 'draw: the sample loaded: the rings, the switch on Rings with Zones and Both free (the sample has a zone file), no drawn zone', z);

  // ---- Freehand: the clicks, the label, a crossing refused, Backspace and Undo, the double-click ----------------------
  await press('#dz-start');
  z = await zoneState();
  check(z.mode === 'freehand' && z.start === 'Drawing' && z.pressed === 'true' && z.tools && z.badge === 'Drawing a zone' && z.crosshair
    && !z.dblZoom && z.status === 'Click the map for each corner.' && z.zones === 12 && z.guide === 0,
  'draw: a real click on "Draw on map": "Drawing" filled, Finish, Undo corner and Cancel beside it, the badge, the crosshair, the double-click zoom off, the rings kept as a guide', z);
  const zoom0 = z.zoom, center0 = z.center;
  const px = [];
  for (const c of CORNERS) px.push(await at(c));
  await click(px[0]);
  const toward = (a, c, t) => ({ x: Math.round(a.x + (c.x - a.x) * t), y: Math.round(a.y + (c.y - a.y) * t) });
  let q = toward(px[1], px[2], 0.4);
  await move(q);
  let l = await label(q);
  check(l.shown && l.corners === 1 && /^\d+\.\d km from the first click$/.test(l.text) && l.text === l.want && !l.warn,
    'draw: after the first corner the label beside the pointer says the distance from the first click, as the rules give it', l);
  for (const k of [1, 2, 3]) await click(px[k]);
  q = toward(px[3], px[4], 0.9);
  await move(q);
  l = await label(q);
  check(l.corners === 4 && /^\d+\.\d km from the first click\nArea \d+\.\d sq mi, [\d,]+ acres$/.test(l.text) && l.text === l.want,
    'draw: from the third corner the label also says the area the shape would have if closed at the pointer', l);
  z = await zoneState();
  check(same(z.sketch.filter(k => k !== 'corner'), ['fill', 'side', 'next']) && z.sketch.filter(k => k === 'corner').length === 4,
    'draw: the sketch: the shape so far filled, its sides, the side to the pointer, each corner', z.sketch);
  // No hover while drawing.
  await move(await at(HOVER_AT));
  check(await p.eval(`${S}.map.hoverLabel === null && !document.querySelector('.maplibregl-popup')`), 'draw: no hover while drawing');
  await click(px[4]);
  const crossAt = await at([-120.462, 46.606]);
  await move(crossAt);
  l = await label(crossAt);
  check(l.text === 'Sides can’t cross' && l.warn && l.want === l.text, 'draw: a pointer whose side would cross another: the label says "Sides can’t cross", in crimson', l);
  await click(crossAt);
  l = await label(crossAt);
  check(l.corners === 5, 'draw: a click whose side would cross another places no corner', l);
  // A click on an earlier corner (the third), a few pixels short of it toward the last corner: without landing on
  // the corner it would be placed (its side ends inside the shape); on the corner the sides touch, refused as crossing.
  const toLast = Math.hypot(px[4].x - px[2].x, px[4].y - px[2].y);
  const onThird = { x: Math.round(px[2].x + 4 * (px[4].x - px[2].x) / toLast), y: Math.round(px[2].y + 4 * (px[4].y - px[2].y) / toLast) };
  await move(onThird);
  const touchLabel = await label(onThird);
  await click(onThird);
  const onEarlier = await label(onThird);
  check(touchLabel.text === 'Sides can’t cross' && touchLabel.warn && onEarlier.corners === 5,
    'draw: a click on an earlier corner (sides touching) is refused: "Sides can’t cross", no corner placed', [touchLabel, onEarlier.corners]);
  await key('Backspace');
  const afterBack = (await label(crossAt)).corners;
  await press('#dz-undo');
  const afterUndo = (await label(crossAt)).corners;
  check(afterBack === 4 && afterUndo === 3, 'draw: Backspace takes back the last corner; a real click on "Undo corner" another', [afterBack, afterUndo]);
  await click(px[3]); await click(px[4]);
  await move(px[5]);
  await click(px[5], 2);
  const zoomRightAfter = await p.eval(`${S}.map.map.doubleClickZoom.isEnabled()`);
  await sleep(600);
  z = await zoneState();
  check(zoomRightAfter === false, 'draw: the double-click zoom stays off for the double-click\'s window after a shape closes', zoomRightAfter);
  const area1 = await p.eval(`${R}.areaText(${R}.areaM2(${S}.drawn[0].geometry))`);
  check(z.mode === null && z.drawn.length === 1 && z.drawn[0].name === 'Drawn zone 1' && z.drawn[0].vertices === 7 && z.dblZoom
    && z.zoom === zoom0 && same(z.center, center0) && z.badge === null && !z.label && z.start === 'Draw on map' && !z.tools && !z.crosshair,
  'draw: a double-click places the sixth corner and closes the zone ("Drawn zone 1", six corners), the map\'s zoom and center unchanged, the zoom back on', z);
  check(z.show === 'both' && z.pressed3 === 'both' && !z.ringsHidden && !z.zonesMode && z.zones === 14
    && same(z.list, [['Drawn zone 1', 'Edit', 'Remove', area1 + ' · 6 corners']]) && z.status === 'Drawn zone 1: ' + area1 + '.',
  'draw: the zone finished on Rings picks Both (3b): the rings, the drawn zone and the file\'s zone together; its row: name box, Edit, Remove, its area and corners', z);
  // Zones, for the checks of the zone on its own (Both is checked below, with the switch).
  await press('#em-show [data-show="zones"]');
  await view();   // the switch fits the map to what shows; the checks' fixed view again
  z = await zoneState();
  check(z.show === 'zones' && z.pressed3 === 'zones' && z.ringsHidden && z.zonesMode && z.zones === 2,
    'draw: a real click on Zones: the drawn zone and the file\'s zone in the rings\' place, the rings\' boxes hidden', z);

  // ---- The zone on the page: the hover, the legend, the fold's summary, the results -------------------------------
  await move(await at(HOVER_AT));
  const hover = await p.eval(`${S}.map.hoverLabel`);
  const days1 = await p.eval(`(() => { const s = ${S}, k = s.days.sites.findIndex(d => d.name === 'Drawn zone 1'); return s.days.sites[k].days; })()`);
  check(new RegExp('^Drawn zone 1\\n' + days1 + ' days?\\nDrawn · ' + area1.replace(/[.]/g, '\\.') + '\\n\\nDays since the last positive inside each zone, as of ').test(hover || ''),
    'draw: the hover over the drawn zone: its name, its days since the last positive, "Drawn" and its area, then the "as of" line', hover);
  await move({ x: 5, y: 5 });
  const page = await p.eval(`(() => ({ legend: [...document.querySelectorAll('#em-legend-content p')].map(x => [x.textContent, !!x.querySelector('.lg-ring.dashed')]),
    sum: document.getElementById('positives-sum').textContent, box: document.querySelector('#box-positives .card-note').textContent,
    zones: [...document.querySelectorAll('#tab-inside .em-zones-list tbody tr')].map(tr => tr.children[0].textContent),
    dash: ${S}.map.map.getLayer('em_zone_dash') ? ${S}.map.map.queryRenderedFeatures({ layers: ['em_zone_dash'] }).map(f => f.properties.label) : null }))()`);
  check(page.legend.some(x => same(x, ['Synthetic control area', false])) && page.legend.some(x => same(x, ['Drawn zone 1 (drawn)', true]))
    && page.sum === '1 zone from a file and 1 drawn, closed hidden' && page.box === '1 zone from a file and 1 drawn'
    && page.zones.includes('Drawn zone 1') && page.zones.includes('Synthetic control area') && same([...new Set(page.dash)], ['Drawn zone 1']),
  'draw: the legend\'s file row and dashed drawn row, the fold\'s summary, the box\'s note, the "Zones" list; only the drawn zone\'s outline dashed on the map', page);
  // The name box: a typed name used everywhere; a name another zone has refused.
  const rename = async name => p.eval(`(() => { const i = document.querySelector('#dz-list .em-point-name'); i.value = ${JSON.stringify(name)};
    i.dispatchEvent(new Event('change')); return { box: i.value, name: ${S}.drawn[0].name, status: document.getElementById('dz-status').textContent,
      legend: document.getElementById('em-legend-content').textContent, list: document.getElementById('tab-inside').textContent }; })()`);
  const named = await rename('  Along   the river ');
  const taken = await rename('Synthetic control area');
  check(named.name === 'Along the river' && named.box === 'Along the river' && /Along the river \(drawn\)/.test(named.legend) && named.list.includes('Along the river'),
    'draw: a typed name (spaces tidied) is used in the legend and the results', named);
  check(taken.name === 'Along the river' && taken.box === 'Along the river' && /^Another zone is named "Synthetic control area": the name stays Along the river\.$/.test(taken.status),
    'draw: a name another zone has is refused, with a line saying so; the name stays', taken);

  // ---- Edit: a corner dragged, a side's middle dragged, a crossing drag going back ----------------------------------
  await press('#dz-list li button');
  z = await zoneState();
  check(z.mode === 'edit' && z.badge === 'Editing Along the river' && z.list[0][1] === 'Done' && z.sketch.filter(k => k === 'corner').length === 6
    && z.sketch.filter(k => k === 'mid').length === 6 && z.status === 'Drag a corner, or a side’s middle to add a corner.',
  'draw: a real click on Edit: a handle on each corner and at each side\'s middle, "Done", the badge "Editing …"', z);
  const cornersNow = () => p.eval(`${R}.cornersOf(${S}.drawn[0])`);
  const before = await cornersNow();
  // A click on a corner handle, and on a middle handle, without moving: nothing changes.
  const version00 = await p.eval(`${S}.zonesVersion`);
  await click(await at(before[0]));
  await click(await at([(before[0][0] + before[1][0]) / 2, (before[0][1] + before[1][1]) / 2]));
  const still = await cornersNow();
  check(same(still, before) && await p.eval(`${S}.zonesVersion`) === version00 && await p.eval(`${S}.map.em.draw.features.filter(f => f.properties.kind === 'corner').length`) === 6,
    'draw: a click on a corner or a middle handle without a drag changes nothing', [still.length, before.length]);
  const version0 = await p.eval(`${S}.zonesVersion`);
  const k2 = before.findIndex(c => Math.abs(c[0] - CORNERS[2][0]) < 0.002 && Math.abs(c[1] - CORNERS[2][1]) < 0.002);
  const from = await at(before[k2]), to = { x: from.x + 40, y: from.y + 10 };
  await dragTo(from, to);
  const moved = await cornersNow();
  const want = await p.eval(`(() => { const m = ${S}.map.map, r = m.getCanvas().getBoundingClientRect(), ll = m.unproject([${to.x} - r.left, ${to.y} - r.top]);
    return [Number(ll.lng.toFixed(6)), Number(ll.lat.toFixed(6))]; })()`);
  z = await zoneState();
  check(moved.length === 6 && Math.abs(moved[k2][0] - want[0]) < 2e-6 && Math.abs(moved[k2][1] - want[1]) < 2e-6
    && await p.eval(`${S}.zonesVersion`) > version0 && same(z.center, center0) && z.mode === 'edit',
  'draw: dragging a corner moves it to where the drag ends (the map does not pan); the results are worked out again', [moved[k2], want, z.center]);
  check(z.list[0][1] === 'Done' && await p.eval(`document.querySelector('#dz-list li button').getAttribute('aria-pressed')`) === 'true',
    'draw: after a drag the zone is still being edited: its button still reads "Done"', z.list[0]);
  const mid = [(moved[0][0] + moved[1][0]) / 2, (moved[0][1] + moved[1][1]) / 2], midFrom = await at(mid);
  await dragTo(midFrom, { x: midFrom.x, y: midFrom.y - 30 });
  const added = await cornersNow();
  z = await zoneState();
  check(added.length === 7 && /· 7 corners$/.test(z.list[0][3]), 'draw: dragging a side\'s middle handle adds a corner there', [added.length, z.list[0]]);
  // A corner dragged across the far side: the sides would cross, so it goes back.
  const c0 = await at(added[0]), far = await at([added[3][0] + 0.03, added[3][1]]);
  await dragTo(c0, far);
  const back = await cornersNow();
  l = await p.eval(`({ text: document.getElementById('dz-label').innerText, warn: document.getElementById('dz-label').classList.contains('warn'),
    handles: ${S}.map.em.draw.features.filter(f => f.properties.kind === 'corner').map(f => f.geometry.coordinates) })`);
  check(same(back, added) && same(l.handles, added) && l.text === 'Sides can’t cross' && l.warn,
    'draw: a drag that would make sides cross goes back (the zone and its handles), and the label says so', [back.length, l.text, l.warn]);
  await press('#dz-list li button');
  z = await zoneState();
  check(z.mode === null && z.sketch.length === 0 && z.list[0][1] === 'Edit' && z.badge === null, 'draw: a real click on Done ends the edit; the handles go', z);

  // ---- Esc, Enter, a click on the first corner, Remove ------------------------------------------------------------
  const tri = [[-120.36, 46.47], [-120.3, 46.47], [-120.33, 46.43]];
  const tpx = [];
  for (const c of tri) tpx.push(await at(c));
  await press('#dz-start');
  z = await zoneState();
  const rendered = await p.eval(`new Set(${S}.map.map.queryRenderedFeatures({ layers: ['em_zone_line'] }).map(f => f.properties.label)).size`);
  check(z.mode === 'freehand' && z.zonesMode && z.zones === 2 && z.guide === 12 && rendered > 2,
    'draw: drawing again with the zones in the rings\' place: the rings come back on the map as a guide, not counted', [z.zones, z.guide, rendered]);
  await click(tpx[0]); await click(tpx[1]);
  await key('Escape');
  await sleep(600);
  z = await zoneState();
  check(z.mode === null && z.drawn.length === 1 && z.sketch.length === 0 && z.dblZoom && z.guide === 0 && z.zones === 2,
    'draw: Esc drops the shape and leaves the mode; the rings\' guide goes', z);
  await press('#dz-start');
  for (const t of tpx) await click(t);
  await key('Enter');
  z = await zoneState();
  check(z.mode === null && z.drawn.length === 2 && z.drawn[1].name === 'Drawn zone 2' && z.drawn[1].vertices === 4, 'draw: Enter closes a shape of three corners ("Drawn zone 2")', z.drawn);
  await press('#dz-start');
  for (const t of tpx) await click({ x: t.x + 60, y: t.y });
  const zoomFirst = await p.eval(`${S}.map.map.getZoom()`);
  // One click on the first corner closes the shape; the double-click's second click then lands on a closed shape.
  const firstAgain = { x: tpx[0].x + 63, y: tpx[0].y + 2 };
  await mouse('mousePressed', firstAgain, { clickCount: 1 }); await mouse('mouseReleased', firstAgain, { clickCount: 1 });
  await sleep(150);
  const afterOne = await p.eval(`({ mode: ${D}.mode(), drawn: ${S}.drawn.length })`);
  await mouse('mousePressed', firstAgain, { clickCount: 2 }); await mouse('mouseReleased', firstAgain, { clickCount: 2 });
  await sleep(600);
  z = await zoneState();
  check(afterOne.mode === null && afterOne.drawn === 3 && z.drawn.length === 3 && z.drawn[2].name === 'Drawn zone 3' && z.drawn[2].vertices === 4
    && z.zoom === zoomFirst && z.dblZoom,
  'draw: one click on the first corner closes the shape; a double-click there does not zoom the map', [afterOne, z.drawn, z.zoom, zoomFirst]);
  await press('#dz-start');
  await click(tpx[0]); await click(tpx[1]);
  await press('#dz-finish');
  z = await zoneState();
  check(z.mode === 'freehand' && z.drawn.length === 3 && z.status === 'A zone needs at least 3 corners.', 'draw: Finish with two corners says a zone needs three, and keeps drawing', z);
  await press('#dz-cancel');
  await press('#dz-list li:nth-child(3) button:nth-of-type(2)');
  await press('#dz-list li:nth-child(2) button:nth-of-type(2)');
  z = await zoneState();
  check(z.mode === null && z.drawn.length === 1 && z.list.length === 1 && z.show === 'zones', 'draw: Cancel leaves the mode; Remove takes a zone out (no confirm); drawing on Zones stays on Zones', z);

  // ---- The rectangle and the square ----------------------------------------------------------------------------
  await press('#dz-shapes [data-shape="rectangle"]');
  await press('#dz-start');
  z = await zoneState();
  check(z.mode === 'rectangle' && z.status === 'Click two opposite corners.' && !await p.eval(`document.getElementById('dz-finish').hidden === false`)
    && await p.eval(`document.getElementById('dz-size').hidden`), 'draw: Rectangle picked: "Click two opposite corners.", Cancel only, no size box', z);
  const ra = await at([-120.36, 46.45]), rb = await at([-120.28, 46.4]);
  // A double-click on the first corner that moved a few pixels between its clicks.
  await mouse('mousePressed', ra, { clickCount: 1 }); await mouse('mouseReleased', ra, { clickCount: 1 });
  const ra2 = { x: ra.x + 3, y: ra.y + 2 };
  await mouse('mousePressed', ra2, { clickCount: 2 }); await mouse('mouseReleased', ra2, { clickCount: 2 });
  await sleep(200);
  const onFirst = await p.eval(`({ mode: ${D}.mode(), corners: ${D}.corners().length, drawn: ${S}.drawn.length })`);
  check(onFirst.mode === 'rectangle' && onFirst.corners === 1 && onFirst.drawn === 1, 'draw: a double-click on the rectangle\'s first corner makes no zone', onFirst);
  await move(rb);
  const rl = await p.eval(`(() => { const m = ${S}.map.map, r = m.getCanvas().getBoundingClientRect();
    const a = m.unproject([${ra.x} - r.left, ${ra.y} - r.top]), b = m.unproject([${rb.x} - r.left, ${rb.y} - r.top]);
    return { text: document.getElementById('dz-label').innerText, want: ${R}.rectangleLabel([a.lng, a.lat], [b.lng, b.lat], ${S}.unit).join('\\n') }; })()`);
  check(/^\d+\.\d km by \d+\.\d km\nArea \d+\.\d sq mi, [\d,]+ acres$/.test(rl.text) && rl.text === rl.want, 'draw: the rectangle\'s label: its size and its area', rl);
  await click(rb);
  z = await zoneState();
  check(z.drawn.length === 2 && z.drawn[1].shape.kind === 'rectangle' && z.drawn[1].vertices === 5 && /· Rectangle, \d+\.\d km by \d+\.\d km$/.test(z.list[1][3]) && z.mode === null,
    'draw: the second click makes the rectangle, its row "Rectangle, … km by … km"', z.list);
  await press('#dz-list li:nth-child(2) button:nth-of-type(2)');
  await press('#dz-shapes [data-shape="square"]');
  const sizeBox = await p.eval(`({ shown: !document.getElementById('dz-size').hidden, value: document.getElementById('dz-size-in').value, unit: document.getElementById('dz-size-unit').textContent })`);
  check(sizeBox.shown && sizeBox.value === '3' && sizeBox.unit === 'km each way', 'draw: Square picked: the size box, "3 km each way"', sizeBox);
  await press('#dz-start');
  // No hover of any kind while drawing: the shared map's population hover (on after a load) over a tract too.
  await move(await at([-120.36, 46.5]));
  const popups = await p.eval(`[...document.querySelectorAll('.maplibregl-popup')].filter(e => getComputedStyle(e).display !== 'none').map(e => e.textContent)`);
  check(popups.length === 0, 'draw: no hover shows while drawing, the population layers\' hover included', popups);
  const p001 = await p.eval(`(() => { const q = ${S}.read.positives.find(x => x.name === 'SYN-HPAI-001'); return [q.lon, q.lat]; })()`);
  const onMark = await at(p001);
  await move({ x: onMark.x + 2, y: onMark.y + 1 });
  const sl = await p.eval(`document.getElementById('dz-label').innerText`);
  check(sl === 'Around SYN-HPAI-001\n6.0 km across (3.0 km each way)\nArea 13.9 sq mi, 8,896 acres', 'draw: the square over a positive\'s mark: "Around SYN-HPAI-001", its size and area', sl);
  await click({ x: onMark.x + 2, y: onMark.y + 1 });
  const sq = await p.eval(`(() => { const z = ${S}.drawn[1], c = ${R}.cornersOf(z);
    return { shape: z.shape, mid: [(c[0][0] + c[2][0]) / 2, (c[0][1] + c[2][1]) / 2], row: document.querySelectorAll('#dz-list .dz-area')[1].textContent }; })()`);
  check(sq.shape.kind === 'square' && sq.shape.km === 3 && Math.abs(sq.mid[0] - p001[0]) <= 1e-6 && Math.abs(sq.mid[1] - p001[1]) <= 1e-6
    && sq.row === '13.9 sq mi, 8,896 acres · Square, 6.0 km across', 'draw: a click on the mark centers the square on the positive exactly; its row "Square, 6.0 km across"', [sq, p001]);
  await press('#dz-list li:nth-child(2) button:nth-of-type(2)');
  await p.eval(`(() => { const i = document.getElementById('dz-size-in'); i.value = '0'; i.dispatchEvent(new Event('change')); return true; })()`);
  await press('#dz-start');
  z = await zoneState();
  check(z.mode === null && z.status === 'Type a size from 0.1 to 100.', 'draw: a square size out of bounds: no drawing, and a line saying the sizes allowed', z);
  await p.eval(`(() => { const i = document.getElementById('dz-size-in'); i.value = '3'; i.dispatchEvent(new Event('change')); return true; })()`);
  // The circle (3b): the size box as its radius, centered on a positive's mark, a row with no Edit.
  await press('#dz-shapes [data-shape="circle"]');
  const radiusBox = await p.eval(`({ shown: !document.getElementById('dz-size').hidden, value: document.getElementById('dz-size-in').value, unit: document.getElementById('dz-size-unit').textContent,
    rows: [...document.querySelectorAll('#dz-shapes .btn')].map(x => Math.round(x.getBoundingClientRect().top)) })`);
  check(radiusBox.shown && radiusBox.value === '3' && radiusBox.unit === 'km radius' && new Set(radiusBox.rows).size === 2,
    'draw: Circle picked: the size box, "3 km radius"; the four shapes in two rows', radiusBox);
  await press('#dz-start');
  z = await zoneState();
  check(z.mode === 'circle' && z.status === 'Click where the middle goes.', 'draw: drawing a circle: "Click where the middle goes."', z);
  const onMark2 = await at(p001);
  await move({ x: onMark2.x + 2, y: onMark2.y + 1 });
  const cl = await p.eval(`document.getElementById('dz-label').innerText`);
  check(cl === 'Around SYN-HPAI-001\n3.0 km radius\nArea 10.9 sq mi, 6,984 acres', 'draw: the circle over a positive\'s mark: "Around SYN-HPAI-001", its radius and area', cl);
  await click({ x: onMark2.x + 2, y: onMark2.y + 1 });
  const ci = await p.eval(`(() => { const z = ${S}.drawn[1], c = ${R}.cornersOf(z);
    return { shape: z.shape, vertices: z.vertices, far: c.map(q => WSDA.proximity.distanceKm(${p001[1]}, ${p001[0]}, q[1], q[0])),
      row: [...document.querySelectorAll('#dz-list li')][1] ? [...[...document.querySelectorAll('#dz-list li')][1].querySelectorAll('button')].map(x => x.textContent) : null,
      area: document.querySelectorAll('#dz-list .dz-area')[1].textContent }; })()`);
  check(ci.shape.kind === 'circle' && ci.shape.km === 3 && ci.vertices === 121 && ci.far.every(d => Math.abs(d - 3) < 2e-4)
    && same(ci.row, ['Remove']) && ci.area === '10.9 sq mi, 6,984 acres · Circle, 3.0 km radius',
  'draw: a click on the mark places the circle around the positive (120 corners, each 3 km away); its row Remove only, "Circle, 3.0 km radius"', [ci.row, ci.area, Math.max(...ci.far.map(d => Math.abs(d - 3)))]);
  await press('#dz-list li:nth-child(2) button');
  await press('#dz-shapes [data-shape="freehand"]');

  // ---- Drawing and "Add a point" never together; a background change keeps the sketch -----------------------------
  await p.eval(`document.getElementById('em-pick-fold').open = true; true`);
  await press('#dz-start');
  await press('#em-pick');
  const ex1 = await p.eval(`({ mode: ${D}.mode(), picking: ${S}.picking })`);
  await press('#dz-start');
  const ex2 = await p.eval(`({ mode: ${D}.mode(), picking: ${S}.picking, pick: document.getElementById('em-pick').getAttribute('aria-pressed') })`);
  check(ex1.mode === null && ex1.picking && ex2.mode === 'freehand' && !ex2.picking && ex2.pick === 'false',
    'draw: "Pick on map" ends the drawing, and "Draw on map" ends picking', [ex1, ex2]);
  await click(px[0]); await click(px[1]);
  await p.eval(`(() => { const s = document.getElementById('em-basemap'); s.value = ''; s.dispatchEvent(new Event('change')); return true; })()`);
  // Redrawn: the new style in place and the sketch's corners rendered again.
  await p.waitFor(`${S}.map.ready && !${S}.map.switching && ${S}.map.map.getLayer('em_draw_corner')
    && ${S}.map.map.queryRenderedFeatures({ layers: ['em_draw_corner'] }).length > 0`, 15000, 'background redrawn');
  await sleep(300);
  const kept = await p.eval(`(() => { const m = ${S}.map.map; return { layers: ['em_draw_fill', 'em_draw_side', 'em_draw_next', 'em_draw_corner', 'em_zone_dash'].every(id => !!m.getLayer(id)),
    corners: m.queryRenderedFeatures({ layers: ['em_draw_corner'] }).length, mode: ${D}.mode() }; })()`);
  check(kept.layers && kept.corners === 2 && kept.mode === 'freehand', 'draw: a background change keeps the sketch and its two corners', kept);
  await press('#dz-cancel');

  // ---- The switch (3b): Rings with the drawn zone kept, Both, then Zones again --------------------------------------
  await press('#em-show [data-show="rings"]');
  await view();
  const off = await zoneState();
  await p.eval(`WSDA.sample.download = function () {}; document.getElementById('export-fold').open = true; document.getElementById('em-export').click(); true`);
  const ringsGeo = await p.eval(`(() => { const e = (${S}.lastExport || []).find(x => /zones\.geojson$/.test(x.name)); return e ? JSON.parse(e.data).features.map(f => [f.properties.source || f.properties.group, f.properties.name]) : []; })()`);
  check(ringsGeo.some(f => f[0] === 'drawn' && f[1] === 'Along the river') && ringsGeo.some(f => f[0] === 'Active'),
    'draw: with the rings shown, the Export\'s zones.geojson keeps the drawn zone beside the rings', ringsGeo.filter(f => f[0] === 'drawn'));
  await p.eval(`document.getElementById('export-fold').open = false; scrollTo(0, 0); true`);
  const ringsBox = await p.eval(`document.querySelector('#box-inside strong').textContent`);
  await press('#em-show [data-show="both"]');
  await view();
  const both = await zoneState();
  const bp = await p.eval(`(() => { const s = ${S}, E = ${R}; const keys = res => new Set(res.rows.map(r => r.layer + '|' + r.lat + '|' + r.lon + '|' + r.name));
    const layers = s.selectedLayers.map(k => s.layers[k]);
    const rr = E.inside(E.ringSites(s.read.targets, s.rings, s.unit), layers, { mode: 'rings', rings: s.rings, unit: s.unit, positives: s.read.targets });
    const zr = E.inside(E.zoneSites(E.zoneSet(s.zoneFile.zones, s.drawn)), layers, { mode: 'zones', positives: s.read.targets });
    return { box: document.querySelector('#box-inside strong').textContent, union: new Set([...keys(rr), ...keys(zr)]).size, total: s.result.total,
      legend: [...document.querySelectorAll('#em-legend-content p')].map(x => x.textContent),
      zones: [...document.querySelectorAll('#tab-inside .em-zones-list tbody tr')].map(tr => tr.children[0].textContent),
      sum: document.getElementById('positives-sum').textContent }; })()`);
  check(both.show === 'both' && both.pressed3 === 'both' && !both.ringsHidden && both.zones === 14 && bp.total === bp.union && bp.box === String(bp.union)
    && Number(bp.box) >= Number(ringsBox),
  'draw: Both: the rings and the zones on the map; "Sites inside the zones" each site once (the rings\' and the zones\' sites together)', [both.zones, bp, ringsBox]);
  check(bp.legend.includes('Infection zone (3 km)') && bp.legend.includes('Synthetic control area') && bp.legend.includes('Along the river (drawn)')
    && bp.legend.indexOf('Control zone (10 km)') < bp.legend.indexOf('Synthetic control area')
    && bp.zones.includes('Along the river') && bp.zones.some(t => /^Control zone \(10 km\) around SYN-HPAI-\d+$/.test(t))
    && bp.sum === '3\u00a0and\u00a010\u00a0km rings, 1 zone from a file and 1 drawn, closed hidden',
  'draw: Both: the legend\'s rings then zones; the "Zones" list with each positive\'s outer ring and each zone; the fold\'s summary', bp);
  await move(await at(HOVER_AT));
  const bothHover = await p.eval(`${S}.map.hoverLabel`);
  await move({ x: 5, y: 5 });
  check(/^Along the river\n/.test(bothHover || '') && /\nSYN-HPAI-001\n/.test(bothHover || '') && /Control zone \(10 km\): /.test(bothHover || ''),
    'draw: Both: the hover inside the drawn zone and a ring names the zone, then the positive\'s ring', bothHover);
  await p.eval(`(document.getElementById('show-overview').click(), true)`);
  await p.waitFor(`${S}.view === 'overview' && ${S}.overview && ${S}.overview.people !== null`, 20000, 'the Overview worked out');
  const bothOv = await p.eval(`({ chart: document.getElementById('ov-layer-chart').textContent, people: ${S}.overview.people.total,
    key: [...document.querySelectorAll('#ov-layer-chart svg rect[width="11"]')].map(r => [r.nextElementSibling ? r.nextElementSibling.textContent : '', r.getAttribute('fill')]),
    rings: ${S}.rings.map(r => [r.label, r.color]) })`);
  await p.eval(`(document.getElementById('show-map').click(), true)`);
  await view();
  check(bothOv.chart.includes('Infection zone') && bothOv.chart.includes('Along the river') && bothOv.chart.includes('Synthetic control area') && bothOv.people > 0
    && bothOv.rings.every(([l, c]) => bothOv.key.some(k => k[0] === l && k[1] === c)) && new Set(bothOv.key.map(k => k[1])).size === bothOv.key.length,
  'draw: Both: the Overview\'s "Sites inside the zones by layer" has the rings\' parts (in their colors) and the zones\' (in other colors); the people inside counted', bothOv);
  await p.eval(`document.getElementById('export-fold').open = true; true`);
  await p.eval(`${S}.lastPreview = null; true`);
  await p.click(`document.getElementById('em-preview').click()`);
  await p.waitFor(`${S}.lastPreview`, 60000, 'preview drawn in Both');
  const bothPic = await p.eval(`(() => { const m = ${S}.lastPreview.model; CVIWA.previews.close && CVIWA.previews.close();
    return { meta: m.meta.left, keys: m.keyItems.map(i => i.label), rows: m.panel.rows.map(r => [r.name, r.subLeft]) }; })()`);
  // Too long for its room with the rings in full, the line says them short, as the fold's summary does (2.7).
  check(bothPic.meta === 'Zones: 3 and 10 km rings; synthetic_control_area.geojson and 1 drawn'
    && bothPic.keys.some(k => /^Infection zone/.test(k)) && bothPic.keys.includes('Zone (from file)') && bothPic.keys.includes('Zone (drawn)')
    && bothPic.rows.some(r => r[0] === 'Along the river' && /sq mi, [\d,]+ acres$/.test(r[1])) && bothPic.rows.some(r => /^SYN-HPAI-/.test(r[0])),
  'draw: Both: the map picture\'s meta line names the rings, then the zones; the key has the rings\' and the zones\' rows; the panel the positives and the zones', bothPic);
  await p.eval(`WSDA.sample.download = function () {}; document.getElementById('export-fold').open = true; document.getElementById('em-export').click(); true`);
  const bothFiles = await p.eval(`(() => { const out = {}; (${S}.lastExport || []).filter(e => !e.dir).forEach(e => { out[e.name.replace(/^.*\\//, '')] = e.data; }); return out; })()`);
  const bothGeo = JSON.parse(bothFiles['zones.geojson'] || '{"features":[]}'), bothParams = JSON.parse(bothFiles['export_params.json'] || '{}');
  const bothCsv = (bothFiles['zones.csv'] || '').trim().split('\n');
  check(bothGeo.features.filter(f => f.properties.source).length === 2 && bothGeo.features.filter(f => f.properties.group === 'Active').length === 12
    && bothParams.zones_shown === 'both' && /^rings Infection zone 3 km, Control zone 10 km; zones synthetic_control_area\.geojson and 1 drawn$/.test(bothParams.zones)
    && bothCsv.length === 1 + 6 + 2,
  'draw: Both: the Export\'s zones.geojson holds the rings and both zones, zones.csv a row each, export_params.json zones_shown "both"', [bothParams.zones, bothParams.zones_shown, bothCsv.length]);
  await p.eval(`document.getElementById('export-fold').open = false; scrollTo(0, 0); true`);
  await press('#em-show [data-show="zones"]');
  await view();   // the switch fits the map to what shows; the checks' fixed view again
  const on = await zoneState();
  check(off.show === 'rings' && off.zones === 12 && !off.ringsHidden && off.drawn.length === 1 && on.show === 'zones' && on.zones === 2,
    'draw: Rings: the rings come back with the drawn zone kept; Zones again, the zones', [off, on]);

  // ---- The Overview, the picture, the Export --------------------------------------------------------------------
  await p.eval(`(document.getElementById('show-overview').click(), true)`);
  await p.waitFor(`${S}.view === 'overview' && ${S}.overview && ${S}.overview.people !== null`, 20000, 'the Overview worked out');
  const ov = await p.eval(`({ chart: document.getElementById('ov-layer-chart').textContent, people: ${S}.overview.people.total })`);
  check(ov.chart.includes('Along the river') && ov.chart.includes('Synthetic control area') && ov.people > 0,
    'draw: the Overview\'s "Sites inside the zones by layer" names the drawn zone and the file\'s; the people inside the zones counted', ov);
  await p.eval(`(document.getElementById('show-map').click(), true)`);
  await p.eval(`document.getElementById('export-fold').open = true; true`);
  await p.eval(`${S}.lastPreview = null; true`);
  await p.click(`document.getElementById('em-preview').click()`);
  await p.waitFor(`${S}.lastPreview`, 60000, 'preview drawn');
  const pic = await p.eval(`(() => { const m = ${S}.lastPreview.model; CVIWA.previews.close && CVIWA.previews.close();
    return { meta: m.meta.left, keys: m.keyItems.map(i => i.label), dashed: m.keyItems.filter(i => i.glyph && i.glyph.dashed).map(i => i.label),
      rows: m.panel.rows.map(r => [r.name, r.subLeft]) }; })()`);
  check(pic.meta === 'Zones: synthetic_control_area.geojson and 1 drawn' && pic.keys.includes('Zone (from file)') && same(pic.dashed, ['Zone (drawn)'])
    && pic.rows.some(r => r[0] === 'Along the river' && /sq mi, [\d,]+ acres$/.test(r[1])),
  'draw: the map picture: the meta line "Zones: <file> and 1 drawn", the key\'s rows "Zone (from file)" and "Zone (drawn)" (dashed), each zone\'s area in the panel', pic);
  await p.eval(`WSDA.sample.download = function () {}; document.getElementById('em-export').click(); true`);
  const files = await p.eval(`(() => { const out = {}; (${S}.lastExport || []).filter(e => !e.dir).forEach(e => { out[e.name.replace(/^.*\\//, '')] = e.data; }); return out; })()`);
  const geo = JSON.parse(files['zones.geojson'] || '{"features":[]}'), params = JSON.parse(files['export_params.json'] || '{}');
  const dz = geo.features.find(f => f.properties.name === 'Along the river') || { properties: {} };
  const csv = (files['zones.csv'] || '').trim().split('\n');
  check(geo.features.length === 2 && dz.properties.zone === 'Drawn zone' && dz.properties.source === 'drawn' && dz.properties.area_sq_mi > 0
    && dz.properties.area_acres > 0 && geo.features.some(f => f.properties.source === 'file') && dz.geometry.coordinates[0].length === 8,
  'draw: zones.geojson: the drawn zone (zone "Drawn zone", source "drawn", its area) and the file\'s zone', dz.properties);
  check(/"?Area \(sq mi\)"?,"?Area \(acres\)"?$/.test(csv[0]) && csv.some(r => /^"?Along the river"?,/.test(r)) && params.drawn_zones === 1
    && params.zones_shown === 'zones' && params.zones === 'zones synthetic_control_area.geojson and 1 drawn',
  'draw: zones.csv\'s two area columns and the drawn zone\'s row; export_params.json: drawn_zones 1, zones_shown "zones", the zones named', [csv[0], params.zones, params.drawn_zones]);
  // Reopened under "Use a zone file" (the drawn zone removed first): the same sites inside each zone, the same days.
  const byZone = () => p.eval(`(() => { const s = ${S}, out = {}; s.days.sites.forEach(d => { out[d.name] = { days: d.days,
    inside: [...new Set(s.result.rows.filter(r => r.zone === d.name).map(r => r.layer + ' ' + r.name))].sort() }; }); return out; })()`);
  const was = await byZone();
  fs.writeFileSync(path.join(DIR, 'zones.geojson'), files['zones.geojson']);
  // Opened while the drawn zone still exists: the status line says a drawn zone has the same name.
  await p.eval(`document.getElementById('em-zone-fold').open = true; true`);
  await p.setFiles('#em-zone-file', [path.join(DIR, 'zones.geojson')]);
  await p.waitFor(`${S}.zoneFile && ${S}.zoneFile.name === 'zones.geojson'`, 10000, 'zones.geojson read');
  const twice = await p.eval(`({ text: document.getElementById('em-zone-status').textContent, warn: document.getElementById('em-zone-status').classList.contains('warn') })`);
  check(twice.warn && twice.text === 'zones.geojson: 2 zones read. A drawn zone has the same name (Along the river): remove or rename the drawn one.',
    'draw: a zone file read while a drawn zone has one of its names says so', twice);
  await press('#dz-list li button:nth-of-type(2)');
  const gone = await zoneState();
  const reopened = await byZone();
  check(gone.drawn.length === 0 && gone.show === 'zones' && gone.zones === 2 && same(reopened, was) && Object.keys(was).length === 2 && was['Along the river'].inside.length > 0,
    'draw: the Export\'s zones.geojson reopened under "Use a zone file" gives the same sites inside and days since for each zone, by name', [was, reopened]);

  // ---- No zone file: removing the last drawn zone brings the rings back; the "Leave this page?" prompt ----------
  await open([path.join(TABLES, 'em_positives_tool.csv')]);
  // The page's own "Leave this page?" handler, asked by a cancelable beforeunload event (a real navigation's dialog
  // would hold every later call while it is open): it asks only while a drawn zone exists.
  const asks = () => p.eval(`(() => { const e = new Event('beforeunload', { cancelable: true }); dispatchEvent(e); return e.defaultPrevented; })()`);
  const asked0 = await asks();
  await press('#dz-start');
  for (const t of tpx) await click(t);
  await key('Enter');
  const one = await zoneState();
  await press('#dz-list li button:nth-of-type(2)');
  const none = await zoneState();
  check(one.show === 'both' && one.zones === none.zones + 1 && !one.ringsHidden && none.show === 'rings' && none.pressed3 === 'rings' && none.zones > 1
    && !none.ringsHidden && none.switchOff === 'zones,both',
  'draw: with no zone file, a drawn zone picks Both; removing it goes back to Rings and grays Zones and Both', [one, none]);
  const asked1 = one.drawn.length === 1 ? await (async () => {
    await press('#dz-start');
    for (const t of tpx) await click(t);
    await key('Enter');
    const a = await asks();
    await press('#dz-list li button:nth-of-type(2)');
    return a;
  })() : null;
  const asked2 = await asks();
  check(asked0 === false && asked1 === true && asked2 === false && b.log.dialogs.length === 0,
    'draw: leaving the page asks first ("Leave this page?") while a drawn zone exists, and not when none does', [asked0, asked1, asked2, b.log.dialogs]);

  // ---- Both, further (3b's review): the CVI movements, the layer table, the marks, the closed rings, a type change, a
  // file zone named as a ring in the Overview ------------------------------------------------------------------------
  await open([samplePath, path.join(TABLES, 'em_cvi_master.csv')]);
  await p.eval(`document.getElementById('em-cvi').click(); true`);
  const cviSites = () => p.eval(`(() => { const s = ${S}; document.getElementById('show-cvi').click();
    return s.cviRes && s.cviRes.siteCvis ? s.cviRes.siteCvis.length : null; })()`);
  const ringN = await p.eval(`${S}.read.targets.length`);
  const cR = await cviSites();
  await press('#em-show [data-show="zones"]'); await view();
  const cZ = await cviSites();
  const zoneMark = await p.eval(`${S}.map.em.inside.features.map(f => f.properties.label).filter(l => / · inside Synthetic control area$/.test(l)).length`);
  await press('#em-show [data-show="both"]'); await view();
  const cB = await cviSites();
  await p.eval(`(document.getElementById('show-inside').click(), true)`);
  check(cR === ringN && cZ === 1 && cB === ringN + 1, 'draw: Both: the CVI movements are looked up around the positives (their rings) and in the zone together', [cR, cZ, cB, ringN]);
  check(zoneMark > 0, 'draw: a site matched to a zone says "inside <zone>" on its mark, not "0 km from" it', zoneMark);
  const table = await p.eval(`(() => { const d = document.querySelector('#tab-inside details.em-layer[data-layer="poultry"]');
    const heads = [...d.querySelectorAll('thead th')].map(th => th.textContent), rows = [...d.querySelectorAll('tbody tr')].map(tr => [...tr.children].map(td => td.textContent));
    const k = heads.indexOf('Distance (km)'), z = heads.indexOf('Zone');
    return { heads, zoneRows: rows.filter(r => r[z] === 'Synthetic control area').map(r => r[k]), ringRows: rows.filter(r => r[z] !== 'Synthetic control area').map(r => r[k]) }; })()`);
  check(table.heads.includes('Positive or zone') && table.zoneRows.length > 0 && table.zoneRows.every(d => d === '') && table.ringRows.every(d => /^\d/.test(d)),
    'draw: Both: a layer\'s table heads "Positive or zone"; a zone\'s rows have no distance, a ring\'s have theirs', table);
  // The closed positives' rings ("Draw their rings") in Both, not on Zones.
  await p.eval(`(() => { const e = document.getElementById('em-past'); if (!e.checked) e.click(); document.getElementById('em-past-fold').open = true;
    const r = document.getElementById('em-past-rings'); if (!r.checked) r.click(); return true; })()`);
  await sleep(500);
  const pastBoth = await p.eval(`({ past: ${S}.mapData.pastZones, off: document.getElementById('em-past-rings').disabled })`);
  await press('#em-show [data-show="zones"]'); await view();
  const pastZones = await p.eval(`({ past: ${S}.mapData.pastZones, off: document.getElementById('em-past-rings').disabled })`);
  await press('#em-show [data-show="both"]'); await view();
  await p.eval(`(() => { document.getElementById('em-past-rings').click(); document.getElementById('em-past').click(); return true; })()`);
  check(pastBoth.past > 0 && !pastBoth.off && pastZones.past === 0 && pastZones.off,
    'draw: "Draw their rings" draws the closed positives\' rings in Both; on Zones it is grayed and draws none', [pastBoth, pastZones]);
  // A type change on Both with the bundle's zone file: screwworm (zones from a file) keeps Both; HPAI again, with no
  // drawn zone, gives the bundle's zone file way to the rings, as before 3b.
  const type = async id => { await p.eval(`(() => { const t = document.getElementById('em-type'); t.value = '${id}'; t.dispatchEvent(new Event('change')); return true; })()`); await sleep(800); };
  await type('nws');
  const onNws = await p.eval(`${S}.show`);
  await type('hpai');
  const onHpai = await p.eval(`${S}.show`);
  check(onNws === 'both' && onHpai === 'rings', 'draw: a type change on Both: screwworm keeps Both; HPAI again (no drawn zone) the rings', [onNws, onHpai]);
  // A zone file whose zone is named as a ring: in Both the Overview's bars keep the ring's count and the zone's apart.
  // The sample's zone file as read (its one zone), written again under the ring's name.
  const asRingFile = await p.eval(`({ type: 'FeatureCollection', features: ${S}.zoneFile.zones.map(z => ({ type: 'Feature', properties: { name: 'Control zone' }, geometry: z.geometry })) })`);
  fs.writeFileSync(path.join(DIR, 'zone_named_as_a_ring.geojson'), JSON.stringify(asRingFile));
  await p.eval(`document.getElementById('em-zone-fold').open = true; true`);
  await p.setFiles('#em-zone-file', [path.join(DIR, 'zone_named_as_a_ring.geojson')]);
  await p.waitFor(`${S}.zoneFile && ${S}.zoneFile.name === 'zone_named_as_a_ring.geojson'`, 10000, 'zone named as a ring read');
  await press('#em-show [data-show="both"]');
  await p.eval(`(document.getElementById('show-overview').click(), true)`);
  await p.waitFor(`${S}.view === 'overview' && ${S}.overview && ${S}.overview.people !== null`, 20000, 'the Overview worked out');
  const ovClash = await p.eval(`(() => { const l = ${S}.result.layers.find(x => x.key === 'poultry'), ring = l.byZone.find(z => z.ring && z.label === 'Control zone'), zone = l.byZone.find(z => !z.ring && z.label === 'Control zone');
    const hovers = [...document.querySelectorAll('#ov-layer-chart [data-hover]')].map(e => e.getAttribute('data-hover'));
    return { ring: ring.count, zone: zone.count, hovers: hovers.filter(h => /^Commercial Poultry: /.test(h)) }; })()`);
  await p.eval(`(document.getElementById('show-map').click(), true)`);
  check(ovClash.ring !== ovClash.zone && ovClash.hovers.includes('Commercial Poultry: ' + ovClash.ring + ' in the Control zone') && ovClash.hovers.includes('Commercial Poultry: ' + ovClash.zone + ' in Control zone'),
    'draw: Both: a file zone named as a ring ("Control zone") keeps its own bar in the Overview, beside the ring\'s', ovClash);
  // A drawn zone cannot take a ring's or a positive's name.
  await press('#dz-start');
  for (const t of tpx) await click(t);
  await key('Enter');
  const refuse = async name => p.eval(`(() => { const i = document.querySelector('#dz-list .em-point-name'); i.value = ${JSON.stringify(name)};
    i.dispatchEvent(new Event('change')); return { name: ${S}.drawn[0].name, status: document.getElementById('dz-status').textContent }; })()`);
  const asRing = await refuse('Infection zone'), asPositive = await refuse('SYN-HPAI-001');
  check(asRing.name === 'Drawn zone 1' && asRing.status === 'A ring is named "Infection zone": the name stays Drawn zone 1.'
    && asPositive.name === 'Drawn zone 1' && asPositive.status === 'A positive is named "SYN-HPAI-001": the name stays Drawn zone 1.',
  'draw: a drawn zone\'s name a ring or a positive has is refused, with a line saying which', [asRing, asPositive]);
  // With cattle unticked, a cattle positive's name is still refused: the names are the whole file's (2.7).
  await p.eval(`(document.querySelector('#em-animals input[value="square"]').click(), true)`);
  await sleep(400);
  await p.waitFor(`!${S}.loading`, 15000, 'cattle unticked');
  const asCattle = await refuse('SYN-HPAI-003');
  await p.eval(`(document.querySelector('#em-animals input[value="square"]').click(), true)`);
  await sleep(400);
  await p.waitFor(`!${S}.loading`, 15000, 'cattle ticked again');
  check(asCattle.name === 'Drawn zone 1' && asCattle.status === 'A positive is named "SYN-HPAI-003": the name stays Drawn zone 1.',
  'draw: with cattle unticked, a cattle positive\'s name ("SYN-HPAI-003") is still refused for a drawn zone (2.7)', asCattle);
  await press('#dz-list li button:nth-of-type(2)');

  // ---- Touch taps (Chrome's touch emulation): three taps and Finish; the label at the last tap ---------------------
  await open([samplePath]);
  await b.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 }, p.sid);
  const tap = async q => {
    await b.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: q.x, y: q.y }] }, p.sid);
    await b.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }, p.sid);
    await sleep(450);
  };
  await tap(await middle('#dz-start'));
  for (const c of tri) await tap(await at(c));
  const touched = await p.eval(`(() => { const l = document.getElementById('dz-label'), m = ${S}.map.map, r = m.getCanvas().getBoundingClientRect(),
    q = m.project(${D}.corners().slice(-1)[0]), b = l.getBoundingClientRect();
    return { corners: ${D}.corners().length, shown: !l.hidden, near: Math.abs(b.left - (r.left + q.x)) < 40 && Math.abs(b.top - (r.top + q.y)) < 40, text: l.innerText }; })()`);
  await tap(await middle('#dz-finish'));
  const tz = await zoneState();
  await b.send('Emulation.setTouchEmulationEnabled', { enabled: false }, p.sid);
  check(touched.corners === 3 && touched.shown && touched.near && /^\d+\.\d km from the first click\nArea /.test(touched.text) && tz.drawn.length === 1 && tz.mode === null,
    'draw: by touch: a tap for each corner, the label at the last tap (no pointer moving), Finish closes the zone', [touched, tz.drawn]);
  await press('#dz-list li button:nth-of-type(2)');

  // ---- 320 pixels wide: the fold fits, the label inside the map ------------------------------------------------------
  await b.send('Emulation.setDeviceMetricsOverride', { width: 320, height: 900, deviceScaleFactor: 1, mobile: true }, p.sid);
  await sleep(400);
  await p.eval(`document.getElementById('dz-fold').scrollIntoView(); true`);
  await press('#dz-start');
  await p.eval(`document.getElementById('em-map').scrollIntoView({ block: 'center' }); true`);
  await sleep(300);
  const nb = await p.eval(`${S}.map.map.getBounds().toArray()`);
  const n0 = [nb[0][0] + (nb[1][0] - nb[0][0]) * 0.3, nb[0][1] + (nb[1][1] - nb[0][1]) * 0.6];
  const n1 = [nb[0][0] + (nb[1][0] - nb[0][0]) * 0.9, nb[0][1] + (nb[1][1] - nb[0][1]) * 0.55];
  await click(await at(n0));
  await move(await at(n1));
  const narrow = await p.eval(`(() => { const f = document.querySelector('.map-frame').getBoundingClientRect(), l = document.getElementById('dz-label').getBoundingClientRect(),
    fold = [...document.querySelectorAll('#dz-fold button, #dz-fold input')].filter(e => e.getClientRects().length).map(e => e.getBoundingClientRect());
    return { scroll: document.documentElement.scrollWidth, inside: l.left >= f.left && l.right <= f.right, shown: !document.getElementById('dz-label').hidden,
      fold: fold.every(r => r.right <= 320) }; })()`);
  check(narrow.scroll <= 321 && narrow.shown && narrow.inside && narrow.fold, 'draw: at 320 pixels wide nothing scrolls sideways; the fold\'s buttons fit; the label stays inside the map', narrow);
  await press('#dz-cancel');
  await b.send('Emulation.clearDeviceMetricsOverride', {}, p.sid);
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
      else if (part === 'view') await partView(b);
      else if (part === 'overview') await partOverview(b);
      else if (part === 'draw') await partDraw(b);
      else if (part === 'filter') await partFilter(b);
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
