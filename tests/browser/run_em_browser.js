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
//          density limits (at most seven visible controls outside folds, six before 2.9's Report button; at most one sentence of at most 25 words per
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
//          none ticked says so; every kind ticked again at each load; no ticks for a file with one kind; 2.8, a positive
//          naming two kinds (both ticks, both marks, its hover) and "Refine by species" (picks, the tag, the picture,
//          the Export, the search box past 30 species, the tag at 320 pixels wide)
//   layers 2.8, "Filter by attributes" in each layer by real clicks on the shared list: a layer limited to one value
//          leaves its other sites out of the map, the boxes, "Inside the zones", the nearest site, the Overview's bars,
//          the legend and the picture's key (a funnel, said once) and the Export (layers.csv's Filters,
//          export_params.json's layer_filters); one fold open at a time; the pick kept when the layer is ticked again;
//          Clear; every filter cleared and every fold closed at a new load
//   cvifilter 2.8, the CVI movements tab's "Refine by species" and "Movement's end in a zone" by real clicks: the
//          tab's line and table, the map's CVI premises, the legend's funnel, the picture's key and the Export from one
//          query; a pick dropped with its group; every pick cleared, the fold closed and the end Either at a new load;
//          the search box past 30 species and a master without a Species column (masters it writes in
//          local-test-artifacts/em/)
//   byanimal 2.8, the Overview's "Columns by: Status · Animal" by real clicks: shown with two kinds ticked, Status at
//          each load; by animal each column's and county bar's hover by kind as the rules count it, the kinds' colors
//          clear of the status red, a mixed farm once under "Several kinds"; hidden with one kind ticked or in the file
//          (writes its file and two screenshots in local-test-artifacts/em/byanimal/)
//   kinds  2.8, "Changing the kinds of animals" (site/emergency/changing-kinds.html): the "?" after the line naming
//          species not listed (its note and link, closed again when the line goes); the how-to page (its Copy
//          buttons); its worked example followed on a copy of the
//          site (four ticks, the marks moved); a word left in two kinds and quotes made curly, each giving the red
//          notice and a type picker without HPAI (the copy in local-test-artifacts/em/kinds/, deleted after)
//   report 2.9, E2, the Report view's page 1 from the loaded file (the report scenario on Sep 1, 2026): the button, the
//          head, banner, tiles, source line, counties, map, months, this year's table, cards and foot as the unit suite
//          works them out; every row counted whatever the "Animals" ticks; another date; the print styles, the PDF's
//          letter-size pages and the print window's title; 320 pixels wide (pictures and the PDF in
//          local-test-artifacts/em/report/)
//   figures 2.9, the Report view's "Figures" by real mouse clicks, moves and Enter: the switch, the tiles as printed, the
//          banner from the data only, the one date, each kind of hover, a county and a month narrowing the table and
//          back, the map's "Places | Counties", printing from Figures, 320 pixels wide, Fill in again, a new load and the
//          Overview's link (pictures and a PDF in local-test-artifacts/em/report-figures/)
//   guide  2.9, the guide "Making the HPAI update" (site/emergency/making-the-update.html): the form's opening line
//          links it in a new tab, nothing covering it; the guide opens with no script, each of its contents' links leads to
//          its section, and it fits 1280 and 320 pixels wide
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
// Where the picture parts write: EM_BOARDS_DIR (the slice in progress's review folder), else
// local-test-artifacts/em/pictures.
const BOARDS_DIR = process.env.EM_BOARDS_DIR ? path.resolve(process.env.EM_BOARDS_DIR) : path.join(OUT, 'pictures');
const TABLES = path.join(ROOT, 'test-tables');
// "Today" fixed for every page (2.5; app.js todayIso reads it), so no result depends on the day the suite runs.
const TODAY = '2026-10-30';
const FIXED_TODAY = 'window.WSDA_EMERGENCY_TODAY = ' + JSON.stringify(TODAY) + ';';
const PAGE = process.env.EM_PAGE_URL || pathToFileURL(path.join(ROOT, 'site', 'index.html')).href;
const SITE = new URL('.', PAGE).href;
const CHROME = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ALL_PARTS = ['load', 'page', 'results', 'e1b', 'png', 'chart', 'view', 'overview', 'draw', 'filter', 'layers', 'cvifilter', 'byanimal', 'kinds', 'report', 'form', 'page2', 'figures', 'guide', 'speed'];
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
// person's name or a case number, a warning shown as CVI shows it; nor, from 2.8, the notes of "Layers to check",
// the checklist drawn by the shared list as Infrastructure's).
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
      .filter(p => shown(p) && !p.closest('.status, [role=status], [role=alert], .help-note, .name-note, #load-results, #em-legend, #em-layers, .count-card, label, fieldset, .maplibregl-map, .em-results')
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
  // A site inside is drawn once, highlighted, never also faded (the map keys a site by its layer, place and name).
  const twice = await p.eval(`(() => { const em = WSDA.emergency.state.map.em;
    const keyOf = f => f.geometry.coordinates.join() + '\\r' + String(f.properties.label).split('\\n').slice(0, 2).join('\\r').replace(/ · .*$/, '');
    const inside = new Set(em.inside.features.map(keyOf));
    return { inside: inside.size, both: em.outside.features.filter(f => inside.has(keyOf(f))).length }; })()`);
  check(twice.inside > 0 && twice.both === 0, 'page: no site inside the zones is also drawn faded among the others', twice);
  check(st.boxes[0] === '6Active' && st.boxes[1] === '1Closednone under quarantine'
    && st.lines === null
    && st.boxes[2] === 'Oct 5, 2026Last positiveAs of Oct 30, 2026' && /^\d+Sites inside the zones/.test(st.boxes[3]),
  'page: the value boxes On a day, on today (Oct 30, 2026, fixed), each count once (the active positives, "with zones" only when it differs; the closed one, none under quarantine; the last positive, written "Oct 5, 2026", as of the day; sites inside); no line under them (the animals are the Overview\'s box since 2.3)', [st.boxes, st.lines]);
  // One status unticked: fewer positives get zones than are active, so the box says how many have them; the page keeps
  // them beside the read, never in it.
  await p.click(`document.querySelector('#em-statuses input:checked').click()`);
  await sleep(300);
  const fewer = await p.eval(`({ box: document.getElementById('box-positives').textContent.trim(),
    targets: WSDA.emergency.state.targets.length, written: 'targets' in WSDA.emergency.state.read })`);
  await p.click(`document.querySelector('#em-statuses input:not(:checked)').click()`);
  await sleep(300);
  check(/^6Active(\d) with zones$/.test(fewer.box) && Number(/(\d) with zones/.exec(fewer.box)[1]) === fewer.targets
    && fewer.targets < 6 && !fewer.written
    && await p.eval(`document.getElementById('box-positives').textContent.trim() === '6Active'`),
  'page: a status unticked: "n with zones" under the active positives (the page\'s own count, not written into the read); ticked again, gone', fewer);
  check(same(st.layers, ['poultry', 'premises', 'markets', 'fairgrounds', 'disposal', 'milkproducer', 'feedlots']),
    'page: the type\'s suggested layers ticked first (poultry and cattle positives; no milk processing file in the sample)', st.layers);
  check(same(st.sums, ['positives, 7 facility files and a zone file', '3\u00a0and\u00a010\u00a0km rings, closed hidden', '7 layers']),
    'page: the folds\' summaries ("Positives and zones" says its settings, the counts being in the boxes)', st.sums);
  d = await p.eval(DENSITY);
  // Seven from 2.9: the Report button, the switch's third view (six before).
  check(d.controls.length <= 7, 'density: at most seven visible controls outside folds when the page opens (sample loaded)', d.controls);
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
  check(animals.value === '10,790 cattle' && animals.note === '25 sheep, 18 goats, 2 dogs · 4 commercial, 4 backyard · 1 without a count'
    && await p.eval(`document.getElementById('em-type').value`) === 'hpai',
  'e1b: switching the type picker to HPAI reads the same file as HPAI (its words: cattle, then the other animals by species, 2.8; no birds)', animals);
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
  check(d.controls.length <= 7 && Object.values(d.sections).every(x => x.sentences <= 1 && x.words <= 25),
    'e1b: density with the screwworm outbreak loaded: at most seven visible controls, one short sentence per section', d);
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

// The one-second step at full size (the agreed "Speed" rule): the speed set both sides of the rules check (40
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
    const checked = Array.from(document.querySelectorAll('#em-layers .fac-row input:checked')).map(i => i.parentElement.querySelector('.facility-title').textContent)
      .sort((a, b) => Object.values(${S}.layers).findIndex(l => l.label === a) - Object.values(${S}.layers).findIndex(l => l.label === b));
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
    const sites = s.show === 'zones' && s.zoneFile ? E.zoneSites(s.zoneFile.zones) : E.ringSites(s.targets.concat(added), s.rings, s.unit);
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
  const names = await p.eval(`${S}.targets.map(x => x.name)`);
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
  // A kind's tick, by its key (2.8: the ticks' values are the kinds' keys, no longer their marks' shapes).
  const tick = async key => {
    const q = await middle(`#em-animals input[value="${key}"]`), v = await p.eval(`${S}.version || 0`);
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
      badge: tag('em-badge'), ovBadge: tag('ov-badge'), countedShapes: shapes(s.zoneParts.counted), targetShapes: shapes(s.targets),
      insideSites: (s.result ? s.result.rows : []).every(r => s.zoneParts.sites.some(z => z.id === r.site)) && s.zoneParts.sites.length === s.targets.length,
      insideText: document.getElementById('tab-inside').textContent.slice(0, 80),
      asof: [...document.querySelectorAll('#asof-lines li')].map(l => l.textContent).find(t => /positive/.test(t)) || '' }; })()`);
  const legendAnimals = v => v.legend.slice(v.legend.indexOf('Animals') + 1).filter(t => /^(Birds|Cattle|Other animals)$/.test(t));

  await open([samplePath]);
  const all = await seen();
  check(!all.fieldHidden && same(all.ticks, [['Birds (5)', true, 'circle'], ['Cattle (2)', true, 'square']]) && !all.msg,
  'filter: "Animals" under "Positives and zones": a tick per kind with its shape and the file\'s count, every one ticked after the load', all.ticks);
  check(all.badge === null && all.ovBadge === null && !/only/.test(all.sum) && all.readShapes === 'circle,square',
  'filter: every kind ticked: no tag on the badges, nothing in the summary, every positive read', [all.badge, all.sum]);

  await tick('cattle');
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

  await tick('birds');
  const none = await seen();
  check(none.msg && none.drawn === 0 && none.last === 'Tick at least one kind of animal' && /Tick at least one kind of animal/.test(none.insideText)
    && /no animals ticked/.test(none.sum) && none.badge === null,
  'filter: every kind unticked: "Tick at least one kind of animal." under the ticks, in the "Last positive" box and the "Inside the zones" tab; no positive drawn', [none.last, none.insideText, none.sum]);
  await tick('birds');
  await tick('cattle');
  const back = await seen();
  check(back.drawn === all.drawn && back.box === all.box && back.badge === null && !back.msg && back.readShapes === 'circle,square',
  'filter: both ticked again: the page as at the load', [back.drawn, all.drawn]);

  // The breakdown (2.7), with every layer ticked: each panel row's counts by layer as the Export's
  // inside_the_zones.csv gives them; each layers line inside the column; the rows clear of the notes; the shared-site
  // note when a site is in two positives' zones.
  await p.eval(`(() => { document.getElementById('em-layers-all').click(); return true; })()`);
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

  await tick('cattle');
  let v = await p.eval(`${S}.version`);
  await p.setFiles('#files-input', [samplePath]);
  await emReady(p, v);
  await p.waitFor(`${S}.map.drawn && ${S}.map.drawn.positives > 0`, 15000, 'map drawn again');
  const again = await seen();
  check(same(again.ticks.map(t => t[1]), [true, true]) && again.readShapes === 'circle,square' && again.badge === null,
  'filter: files loaded again: every kind ticked again (question 6)', again.ticks);
  // A zone file chosen with cattle unticked redraws the loaded files' lines: the positives line still counts the file.
  await tick('cattle');
  await p.setFiles('#em-zone-file', [path.join(TABLES, 'em_bundle', 'zones.geojson')]);
  await p.waitFor(`${S}.zoneFile && !${S}.loading`, 20000, 'zone file used');
  await sleep(500);
  const zoned = await seen();
  check(zoned.readShapes === 'circle' && /^7 positives/.test(zoned.asof.replace(/^[^:]*: /, '')),
  'filter: a zone file chosen with cattle unticked: the loaded-file line still counts the whole file (7 positives)', zoned.asof);
  // With birds unticked too, the zone file's zones still count their sites: the tab says to tick a kind first, then
  // lists them, as the "Sites inside" box counts them.
  await tick('birds');
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
  const cviAll = await p.eval(`({ sites: ${S}.cviRes.siteCvis.length, cvis: ${S}.cviRes.summary.cvis, targets: ${S}.targets.length })`);
  await p.eval(`${S}.cviRes = null; true`);
  await tick('cattle');
  await p.waitFor(`${S}.cviRes && ${S}.cviRes.status === 'ok'`, 30000, 'CVI result with cattle unticked');
  const cviBirds = await p.eval(`({ sites: ${S}.cviRes.siteCvis.length, cvis: ${S}.cviRes.summary.cvis, targets: ${S}.targets.length,
    birds: ${S}.targets.every(q => WSDA.emergencyRules.animalShapeOf(${S}.type, q) === 'circle') })`);
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
  const one = await p.eval(`({ hidden: document.getElementById('em-animals-field').hidden, n: document.querySelectorAll('#em-animals input').length,
    refine: document.getElementById('em-refine').hidden })`);
  check(one.hidden && one.n === 0 && one.refine, 'filter: a file with one kind of animal (the screwworm outbreak): no "Animals" ticks and no "Refine by species"', one);

  // ---- 2.8: a positive naming two kinds ("Cattle, Chicken"), and "Refine by species" ----------------------------
  // Three birds, the mixed farm and a dairy, every one mapped: the mixed one counts under both ticks, shows while
  // either is ticked, its mark both shapes side by side, its hover "1000 animals (birds and cattle)".
  const mixedRow = fxRow('FX-005', '46.50', '-120.40', 'Commercial', 'Mixed', '"Cattle, Chicken"');
  const dairyRow = fxRow('FX-006', '46.45', '-120.55', 'Commercial', 'Dairy', 'Dairy Cow');
  const mixedFile = path.join(OUTF, 'em_filter_mixed.csv');
  fs.writeFileSync(mixedFile, [FX.AGREED_HEAD.join(',')].concat(birdsRows, [mixedRow, dairyRow]).join('\n') + '\n');
  // A real click on the element a selector names (the nth match), then the redraw.
  const press = async (sel, nth) => {
    const q = await p.eval(`(() => { const e = document.querySelectorAll(${JSON.stringify(sel)})[${nth || 0}]; e.scrollIntoView({ block: 'nearest' });
      const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
    for (const type of ['mousePressed', 'mouseReleased']) {
      await b.send('Input.dispatchMouseEvent', { type, x: q.x, y: q.y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 }, p.sid);
    }
    await sleep(400);
    await p.waitFor(`!${S}.loading`, 15000, 'filter redrawn');
  };
  const mixedSeen = () => p.eval(`(() => { const s = ${S}, m = s.map.map, tag = document.querySelector('#em-badge .only-tag');
    const f = s.map.em.positives.features.find(x => /^FX-005/.test(x.properties.label)), img = f ? m.getImage(f.properties.mark) : null;
    return { ticks: [...document.querySelectorAll('#em-animals label')].map(l => [l.textContent, l.querySelector('input').checked]),
      drawn: s.map.em.positives.features.map(x => x.properties.label.split('\\n')[0]).sort().join(), box: document.querySelector('#box-positives strong').textContent,
      mark: f ? f.properties.mark.split(':').slice(0, 3).join(':') : null, wide: img ? img.data.width > 1.6 * img.data.height : null,
      // the right shape drawn: a pixel painted in the picture's column at three quarters of its width
      right: img ? Array.from({ length: img.data.height }, (_, y) => img.data.data[4 * (y * img.data.width + Math.round(0.75 * img.data.width)) + 3]).some(a => a > 0) : null,
      tip: f ? (s.map.hoverAt(Object.values(m.project(f.geometry.coordinates))) || { items: [] }).items.map(i => i.lines.join(' | ')).join(' / ') : null,
      legend: [...document.querySelectorAll('#em-legend-content p')].map(q => q.textContent).filter(t => /^(Birds|Cattle)$/.test(t)),
      tag: tag ? tag.textContent : null, sum: document.getElementById('positives-sum').textContent,
      refine: { hidden: document.getElementById('em-refine').hidden, sum: document.getElementById('em-refine-sum').textContent,
        search: !document.getElementById('em-refine-search').hidden,
        kinds: [...document.querySelectorAll('#em-refine-list .refine-kind')].map(k => k.querySelector('.lg-animal').dataset.shape + ' ' + k.textContent),
        rows: [...document.querySelectorAll('#em-refine-list label')].map(l => [l.textContent, l.querySelector('input').checked]) } }; })()`);
  await b.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }, p.sid);
  await open([mixedFile]);
  // The hover is read off the drawn marks: wait for the map to settle first.
  await p.eval(`new Promise(r => { const m = ${S}.map.map; m.once('idle', () => r(true)); m.triggerRepaint(); })`);
  let mx = await mixedSeen();
  check(same(mx.ticks, [['Birds (4)', true], ['Cattle (2)', true]]) && mx.drawn === 'FX-001,FX-002,FX-003,FX-005,FX-006',
  'filter: a positive naming two kinds ("Cattle, Chicken") counts in both ticks: Birds (4), Cattle (2), five positives drawn (2.8)', mx);
  check(mx.mark === 'em-positive:circle+square:now' && mx.wide === true && mx.right === true,
  'filter: its map mark is both shapes side by side, a circle and a square, in one picture twice as wide as tall, the second shape drawn on its right', [mx.mark, mx.wide, mx.right]);
  check(/ 1000 animals \(birds and cattle\)/.test(mx.tip) && same(mx.legend, ['Birds', 'Cattle']),
  'filter: its hover says "1000 animals (birds and cattle)" (the count as the table writes it); the legend has a row for each kind', [mx.tip, mx.legend]);
  await press('#em-animals input[value="birds"]');
  mx = await mixedSeen();
  check(mx.drawn === 'FX-005,FX-006' && mx.box === '2' && mx.tag === 'Cattle only' && /cattle only/.test(mx.sum) && same(mx.legend, ['Birds', 'Cattle'])
    && mx.mark === 'em-positive:circle+square:now',
  'filter: birds unticked by a click: the mixed farm stays with the dairy (2 active), "Cattle only"; its mark keeps both shapes, so the legend keeps Birds', mx);
  await press('#em-animals input[value="birds"]');
  await press('#em-animals input[value="cattle"]');
  mx = await mixedSeen();
  check(mx.drawn === 'FX-001,FX-002,FX-003,FX-005' && mx.box === '4' && mx.tag === 'Birds only' && same(mx.ticks, [['Birds (4)', true], ['Cattle (2)', false]]),
  'filter: cattle unticked instead: the three birds and the mixed farm (4 active), "Birds only"; the ticks\' counts stay the whole file\'s', mx);
  await press('#em-animals input[value="cattle"]');

  // "Refine by species": closed at the load, as CVI's; every species under each kind ticked, the mixed one under both.
  mx = await mixedSeen();
  const closed = await p.eval(`!document.getElementById('em-refine').open`);
  check(!mx.refine.hidden && closed && mx.refine.sum === '' && !mx.refine.search && same(mx.refine.kinds, ['circle Birds', 'square Cattle'])
    && same(mx.refine.rows.map(r => r[0]), ['Chicken \u2014 2 positives, 2,000 animals', 'Cattle, Chicken \u2014 1 positive, 1,000 animals',
      'Duck \u2014 1 positive, 1,000 animals', 'Cattle, Chicken \u2014 1 positive, 1,000 animals', 'Dairy Cow \u2014 1 positive, 1,000 animals'])
    && mx.refine.rows.every(r => !r[1]),
  'filter: "Refine by species" under the ticks, closed at the load: each kind\'s mark and name over its species with their numbers, "Cattle, Chicken" under both, none ticked', mx.refine);
  await press('#em-refine summary');
  await press('#em-refine-list input[value="Cattle, Chicken"]', 1);
  mx = await mixedSeen();
  check(mx.drawn === 'FX-005' && mx.box === '1' && mx.refine.sum === ' (1 ticked)' && mx.refine.rows.filter(r => r[1]).length === 2
    && mx.tag === '"Cattle, Chicken" only' && /"cattle, chicken" only/.test(mx.sum) && same(mx.ticks, [['Birds (4)', true], ['Cattle (2)', true]]),
  'filter: "Cattle, Chicken" ticked under Cattle by a click: ticked under Birds too (one pick), only that farm everywhere, the tag names it in quotes (its comma), the kinds\' ticks untouched', mx);
  await press('#em-refine-list input[value="Chicken"]');
  mx = await mixedSeen();
  check(mx.drawn === 'FX-001,FX-002,FX-005' && mx.refine.sum === ' (2 ticked)' && mx.tag === '"Cattle, Chicken" and Chicken only',
  'filter: Chicken ticked as well: both species\' positives, "(2 ticked)", the tag names both', mx);
  // The picture and the Export with the picks.
  await p.eval(`document.getElementById('export-fold').open = true; ${S}.lastPreview = null; true`);
  await p.click(`document.getElementById('em-preview').click()`);
  await p.waitFor(`${S}.lastPreview`, 60000, 'preview drawn');
  const pic = await p.eval(`(() => { const m = ${S}.lastPreview.model; CVIWA.previews.close && CVIWA.previews.close();
    return { meta: m.meta.left, shapes: m.positives.map(q => q.name + ' ' + q.shapes.join('+')).sort(),
      key: m.keyItems.filter(i => i.glyph && i.glyph.shape === 'animals').map(i => [i.glyph.first].concat(i.glyph.words.map(w => w.label))) }; })()`);
  check(/^Positives: "cattle, chicken" and chicken only · Zones: /.test(pic.meta) && same(pic.shapes, ['FX-001 circle', 'FX-002 circle', 'FX-005 circle+square'])
    && same(pic.key.flat(), ['Birds', 'Cattle']),
  'filter: the map picture: its line over the map names the species, the mixed farm drawn with both marks, the key naming Birds and Cattle', pic);
  await p.eval(`WSDA.sample.download = function () {}; ${S}.lastExport = null; document.getElementById('em-export').click(); true`);
  await p.waitFor(`${S}.lastExport`, 30000, 'export made');
  const pm = await p.eval(`(() => { const e = (${S}.lastExport || []).find(x => /export_params\.json$/.test(x.name)); return e ? JSON.parse(e.data) : {}; })()`);
  check(same(pm.species_shown, ['Cattle, Chicken', 'Chicken']) && same(pm.animals_shown, ['Birds', 'Cattle']),
  'filter: export_params.json names the species picked (species_shown) beside the kinds shown', [pm.species_shown, pm.animals_shown]);
  // Birds unticked: Chicken (a bird only) drops out of the picks; "Cattle, Chicken" is still offered under Cattle and stays.
  await press('#em-animals input[value="birds"]');
  mx = await mixedSeen();
  check(mx.drawn === 'FX-005' && mx.refine.sum === ' (1 ticked)' && same(mx.refine.kinds, ['square Cattle']) && mx.tag === '"Cattle, Chicken" only',
  'filter: birds unticked with both picked: Chicken drops out of the picks, "Cattle, Chicken" stays (still under Cattle)', mx);
  // The same file loaded again in the same page: every pick cleared, every kind ticked again.
  v = await p.eval(`${S}.version`);
  await p.setFiles('#files-input', [mixedFile]);
  await emReady(p, v);
  await p.waitFor(`${S}.map.drawn && ${S}.map.drawn.positives > 0`, 15000, 'map drawn again');
  mx = await mixedSeen();
  const closedAgain = await p.eval(`!document.getElementById('em-refine').open`);
  check(mx.refine.sum === '' && mx.refine.rows.length === 5 && mx.refine.rows.every(r => !r[1]) && mx.tag === null && mx.drawn.split(',').length === 5
    && closedAgain,
  'filter: the file loaded again in the same page: every species pick cleared, every kind ticked again, "Refine by species" closed again', { mx, closedAgain });
  // Then a file with one kind (the screwworm outbreak) in the same page: no ticks and no species list left behind.
  v = await p.eval(`${S}.version`);
  await p.setFiles('#files-input', [path.join(TABLES, 'em_nws_synthetic_positives.csv')]);
  await emReady(p, v);
  await p.waitFor(`${S}.map.drawn && ${S}.map.drawn.positives > 0`, 15000, 'map drawn again');
  const oneAfter = await p.eval(`({ animals: document.getElementById('em-animals-field').hidden, refine: document.getElementById('em-refine').hidden,
    rows: document.querySelectorAll('#em-refine-list label').length })`);
  check(oneAfter.animals && oneAfter.refine && oneAfter.rows === 0,
  'filter: a file with one kind loaded after the mixed file in the same page: no "Animals" ticks and no "Refine by species" left behind', oneAfter);

  // Past 30 species a search box: typing narrows the list; a pick hidden by the search stays picked.
  const manyRows = Array.from({ length: 32 }, (_, k) => fxRow('FX-1' + String(k).padStart(2, '0'), (46.2 + k * 0.02).toFixed(2), '-120.50',
    'Backyard', 'Backyard Flock', 'Duck ' + (k + 1)));
  const manyFile = path.join(OUTF, 'em_filter_many_species.csv');
  fs.writeFileSync(manyFile, [FX.AGREED_HEAD.join(',')].concat(manyRows, [dairyRow]).join('\n') + '\n');
  await open([manyFile]);
  await press('#em-refine summary');
  await press('#em-refine-list input[value="Duck 2"]');
  await press('#em-refine-search');
  await b.send('Input.insertText', { text: 'duck 1' }, p.sid);
  await sleep(300);
  mx = await mixedSeen();
  const narrowed = mx.refine.rows.map(r => r[0].split(' \u2014')[0]);
  check(mx.refine.search && narrowed.length === 11 && narrowed.every(n => /^Duck 1/.test(n)) && mx.refine.sum === ' (1 ticked)' && mx.drawn === 'FX-101',
  'filter: 33 species: a search box over the list; "duck 1" leaves Duck 1 and Duck 10 to 19; Duck 2, hidden by the search, stays picked', [narrowed, mx.refine.sum, mx.drawn]);
  // The same file loaded again in the same page: the search box emptied and the fold closed, the whole list back.
  v = await p.eval(`${S}.version`);
  await p.setFiles('#files-input', [manyFile]);
  await emReady(p, v);
  await p.waitFor(`${S}.map.drawn && ${S}.map.drawn.positives > 0`, 15000, 'map drawn again');
  const fresh = await p.eval(`({ search: document.getElementById('em-refine-search').value, open: document.getElementById('em-refine').open,
    rows: document.querySelectorAll('#em-refine-list label').length })`);
  check(fresh.search === '' && !fresh.open && fresh.rows === 33,
  'filter: 33 species loaded again in the same page: "Refine by species" closed, its search box empty, all 33 listed', fresh);
  await press('#em-refine summary');
  await press('#em-refine-list input[value="Duck 2"]');
  // Each kind's species at full length, not in a box of its own that scrolls (the search box narrows a long list).
  await p.eval(`(() => { const s = document.getElementById('em-refine-search'); s.value = ''; s.dispatchEvent(new Event('input')); return true; })()`);
  const boxes = await p.eval(`[...document.querySelectorAll('#em-refine-list .checklist')].map(x => [x.querySelectorAll('label').length, x.scrollHeight <= x.clientHeight + 1])`);
  check(boxes.length === 2 && boxes[0][0] === 32 && boxes.every(x => x[1]),
  'filter: "Refine by species": each kind\'s species at full length (32 ducks), no box scrolling on its own', boxes);
  // On a phone (320 px) a long white tag wraps inside the map instead of running off its sides.
  for (const d of ['Duck 3', 'Duck 4', 'Duck 5']) await press('#em-refine-list input[value="' + d + '"]');
  await b.send('Emulation.setDeviceMetricsOverride', { width: 320, height: 800, deviceScaleFactor: 1, mobile: true }, p.sid);
  await sleep(600);
  const fits = await p.eval(`(() => { const m = document.getElementById('em-map').getBoundingClientRect(), t = document.querySelector('#em-badge .only-tag');
    const g = document.getElementById('em-badge').getBoundingClientRect(), r = t.getBoundingClientRect();
    return { tag: t.textContent, inside: g.left >= m.left - 0.5 && g.right <= m.right + 0.5 && r.right <= m.right + 0.5, lines: Math.round(r.height / parseFloat(getComputedStyle(t).lineHeight || 17)),
      map: Math.round(m.width), badge: Math.round(g.width) }; })()`);
  await b.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }, p.sid);
  check(fits.tag === 'Duck 2, Duck 3, Duck 4 and 1 more only' && fits.inside && fits.badge > 0.8 * fits.map,
  'filter: at 320 px the white tag with four species picked wraps inside the map, the badge using the map\'s width', fits);
}

// 2.8, "Filter by attributes" in each layer, by real clicks on the shared list (shared/facility-ui.js): the sample's
// Commercial Poultry limited to Layers leaves its other sites out of the map, the boxes, "Inside the zones", the
// nearest site, the Overview's bars, the legend (a funnel), the picture's key and the Export.
async function partLayers(b) {
  const p = b.page, S = 'WSDA.emergency.state', R = 'WSDA.emergencyRules';
  const samplePath = path.join(OUT, 'sample', 'emergency_synthetic.zip');
  // A real click on the element the expression gives.
  const click = async expr => {
    const q = await p.eval(`(() => { const e = ${expr}; e.scrollIntoView({ block: 'nearest' });
      const r = e.getBoundingClientRect(); return { x: Math.round(r.left + Math.min(8, r.width / 2)), y: Math.round(r.top + r.height / 2) }; })()`);
    for (const type of ['mousePressed', 'mouseReleased']) {
      await b.send('Input.dispatchMouseEvent', { type, x: q.x, y: q.y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 }, p.sid);
    }
    await sleep(300);
    await p.waitFor(`!${S}.loading`, 15000, 'redrawn after a click');
  };
  const open = async () => {
    await p.goto(new URL('emergency/index.html', SITE).href);
    await p.waitFor('window.WSDA && WSDA.emergency && WSDA.emergency.state.map.ready', 20000, 'Emergency map ready');
    await p.setFiles('#files-input', [samplePath]);
    await emReady(p);
    await p.waitFor(`${S}.map.drawn && ${S}.map.drawn.positives > 0`, 15000, 'map drawn');
    await p.eval(`document.getElementById('layers-fold').open = true; scrollTo(0, 0); true`);
  };
  // The row of a layer by its name, and its parts.
  const ROW = name => `[...document.querySelectorAll('#em-layers .facility-layer')].find(r => r.querySelector('.facility-title').textContent === ${JSON.stringify(name)})`;
  const seen = () => p.eval(`(() => { const s = ${S}, row = ${ROW('Commercial Poultry')}, fold = row.querySelector('details.facility-filters');
    const cp = s.layers.poultry, all = s.prepared.layers.find(l => l.key === 'poultry').points;
    const rows = (s.result ? s.result.rows : []).filter(r => r.layer === 'poultry');
    const nearest = (s.result.layers.find(l => l.key === 'poultry') || {}).nearest;
    const bars = ${R}.overviewBars([], s.result).layers.find(l => l.label === 'Commercial Poultry');
    return { groups: [...document.querySelectorAll('#em-layers .fac-grp')].map(h => h.textContent),
      counts: [...document.querySelectorAll('#em-layers .facility-layer')].filter(r => r.querySelector('.fac-row input').checked)
        .map(r => [r.querySelector('.facility-title').textContent, r.querySelector('.facility-local-count').textContent]),
      sizes: Object.fromEntries(Object.values(s.layers).map(l => [l.label, l.points.length])),
      openFolds: [...document.querySelectorAll('#em-layers details.facility-filters')].filter(d => d.open).map(d => d.closest('.facility-layer').querySelector('.facility-title').textContent),
      noFilters: [...document.querySelectorAll('#em-layers .facility-layer')].filter(r => /No eligible attribute filters/.test(r.textContent)).map(r => r.querySelector('.facility-title').textContent),
      foldText: fold.querySelector('summary').textContent, types: [...fold.querySelectorAll('.facility-refine label')].map(l => l.textContent.trim()),
      cpTypes: [...new Set(cp.points.map(q => q.values.Type))], cpCount: cp.points.length, layersInFile: all.filter(q => q.values.Type === 'Layers').length,
      allCount: all.length, insideRows: rows.length, insideTypes: [...new Set(rows.map(r => cp.points.find(q => q.name === r.name) ? 'kept' : 'other'))],
      nearest: nearest ? (cp.points.some(q => q.name === nearest.name) ? 'kept' : nearest.name) : null,
      box: document.querySelector('#box-inside strong').textContent.replace(/\\D/g, ''), total: s.result.total,
      bars: bars ? bars.total : null, cpInside: (s.result.layers.find(l => l.key === 'poultry') || {}).inside,
      legend: [...document.querySelectorAll('#em-legend-content p')].map(q => [q.textContent, !!q.querySelector('.lg-funnel')]).filter(([, f]) => f).map(([t]) => t),
      order: s.selectedLayers.join() }; })()`);

  await open();
  const start = await seen();
  check(start.groups.length > 1 && start.counts.length === Object.keys(start.sizes).length
    && start.counts.every(([name, n]) => n === ' — ' + start.sizes[name]),
  'layers: "Layers to check" drawn by the shared list: the group headings, each ticked layer with its number of sites', [start.groups, start.counts]);
  check(!start.openFolds.length && start.foldText === 'Filter by attributes' && start.noFilters.includes('Feedlots'),
  'layers: every fold closed after the load, none says a filter is on; a layer with no column to filter says so', [start.openFolds, start.foldText, start.noFilters]);

  await click(`${ROW('Commercial Poultry')}.querySelector('details.facility-filters > summary')`);
  const opened = await seen();
  check(same(opened.openFolds, ['Commercial Poultry']) && same(opened.types, ['Broilers', 'Ducks', 'Layers', 'Turkeys']),
  'layers: Commercial Poultry\'s fold opened by a click lists its Type values', [opened.openFolds, opened.types]);

  await click(`${ROW('Commercial Poultry')}.querySelector('.facility-refine input[value="Layers"]')`);
  const layers = await seen();
  check(/1 filter on$/.test(layers.foldText) && same(layers.openFolds, ['Commercial Poultry']),
  'layers: Layers ticked by a click: the fold says "1 filter on" and stays open', [layers.foldText, layers.openFolds]);
  check(same(layers.cpTypes, ['Layers']) && layers.cpCount === layers.layersInFile && layers.cpCount < layers.allCount
    && same(layers.counts.find(c => c[0] === 'Commercial Poultry'), ['Commercial Poultry', ' — ' + layers.layersInFile]),
  'layers: the layer keeps only its Layers sites, and its row counts them', [layers.cpTypes, layers.cpCount, layers.allCount, layers.counts]);
  check(layers.total < start.total && same(layers.insideTypes, ['kept']) && layers.insideRows < start.insideRows,
  'layers: "Inside the zones" lists only the Layers farms, and the sites inside are fewer', [start.total, layers.total, layers.insideRows]);
  check(layers.box === String(layers.total) && start.box === String(start.total),
  'layers: the box "Sites inside the zones" counts them', [start.box, layers.box, layers.total]);
  check(layers.nearest === 'kept' || layers.nearest === null,
  'layers: the nearest Commercial Poultry site is a Layers farm', layers.nearest);
  check(layers.bars === layers.cpInside && layers.bars < start.bars,
  'layers: the Overview\'s bar for the layer counts only the Layers farms inside', [start.bars, layers.bars]);
  check(same(layers.legend, ['Commercial Poultry', 'Filtered: some sites left out']),
  'layers: the legend puts a funnel before the layer\'s name and says once what it means', layers.legend);

  // One fold open at a time (as the worst case drew it).
  await click(`${ROW('Premise PINs by Species')}.querySelector('details.facility-filters > summary')`);
  const other = await seen();
  check(same(other.openFolds, ['Premise PINs by Species']) && /1 filter on$/.test(other.foldText),
  'layers: opening another layer\'s fold closes Commercial Poultry\'s, whose filter stays on', [other.openFolds, other.foldText]);

  // The picture's key: the layer's row with a funnel before its name, the funnel said once.
  await p.eval(`document.getElementById('export-fold').open = true; ${S}.lastPreview = null; true`);
  await p.click(`document.getElementById('em-preview').click()`);
  await p.waitFor(`${S}.lastPreview`, 60000, 'preview drawn');
  const key = await p.eval(`(() => { const m = ${S}.lastPreview.model; CVIWA.previews.close && CVIWA.previews.close();
    const rows = m.keyItems.filter(it => it.facility);
    return { filtered: rows.filter(it => it.funnel).map(it => it.label), others: rows.filter(it => !it.funnel).length,
      notes: m.keyRows.filter(r => r.label === 'Filtered: some sites left out').length }; })()`);
  check(same(key.filtered, ['Commercial Poultry']) && key.others > 0,
  'layers: the picture\'s key marks only the filtered layer\'s row with a funnel', key);
  check(key.notes === 1, 'layers: the picture\'s key says once what the funnel means, under the layers', key);

  // The Export: inside_the_zones.csv, layers.csv's Filters and export_params.json's layer_filters.
  await p.eval(`WSDA.sample.download = function () {}; document.getElementById('em-export').click(); true`);
  const ex = await p.eval(`(() => { const s = ${S}, files = {};
    (s.lastExport || []).filter(e => !e.dir).forEach(e => { files[e.name.replace(/^.*\\//, '')] = e.data; });
    const kept = new Set(s.layers.poultry.points.map(q => q.name));
    const inside = files['inside_the_zones.csv'].split('\\n').filter(l => l.includes(',Commercial Poultry,'));
    return { inside: inside.length, others: inside.filter(l => ![...kept].some(n => l.includes(',' + n + ','))).length,
      layers: files['layers.csv'].split('\\n').slice(0, 1).concat(files['layers.csv'].split('\\n').filter(l => /^Commercial Poultry,|^Feedlots,/.test(l))),
      params: JSON.parse(files['export_params.json']).layer_filters }; })()`);
  check(ex.inside === layers.insideRows && ex.others === 0,
  'layers: the Export\'s inside_the_zones.csv lists only the Layers farms of the layer', ex);
  check(/,Filters$/.test(ex.layers[0]) && ex.layers.some(l => /^Commercial Poultry,.*,Type: Layers$/.test(l)) && ex.layers.some(l => /^Feedlots,.*,$/.test(l))
    && ex.params === 'Commercial Poultry (Type: Layers)',
  'layers: layers.csv\'s Filters column and export_params.json\'s layer_filters name the pick; an unfiltered layer\'s is blank', ex);

  // Unticked and ticked again: the pick kept; "Clear": every site back, no funnel.
  await click(`${ROW('Commercial Poultry')}.querySelector('.fac-row input')`);
  await click(`${ROW('Commercial Poultry')}.querySelector('.fac-row input')`);
  const again = await seen();
  check(/1 filter on$/.test(again.foldText) && again.cpCount === layers.layersInFile,
  'layers: the layer unticked and ticked again keeps its pick', [again.foldText, again.cpCount]);
  // The load's order (the type's suggestions first) kept through every click.
  check(layers.order === start.order && again.order === start.order,
  'layers: the legend keeps the load\'s order of the layers through a filter and a layer ticked again', [start.order, layers.order, again.order]);
  await click(`${ROW('Commercial Poultry')}.querySelector('details.facility-filters > summary')`);
  await click(`${ROW('Commercial Poultry')}.querySelector('[data-refine-clear]')`);
  const cleared = await seen();
  check(cleared.cpCount === cleared.allCount && cleared.total === start.total && !cleared.legend.length && cleared.foldText === 'Filter by attributes',
  'layers: "Clear" brings every site back, and the funnel leaves the legend', [cleared.cpCount, cleared.total, cleared.legend]);
  await p.eval(`document.getElementById('em-export').click(); true`);
  const none = await p.eval(`JSON.parse(${S}.lastExport.find(e => /export_params\\.json$/.test(e.name)).data).layer_filters`);
  check(none === 'none', 'layers: with no filter on, export_params.json\'s layer_filters says "none"', none);

  // A layer whose filters leave no site (the Mailing premises are all placed by rooftop): its line in "Inside the
  // zones" says the filters left none, not that the file has no usable locations.
  const PREM = ROW('Premise PINs by Species');
  await click(`${PREM}.querySelector('details.facility-filters > summary')`);
  await click(`${PREM}.querySelector('.facility-refine input[value="Mailing"]')`);
  await click(`${PREM}.querySelector('.facility-refine input[value="city"]')`);
  const emptied = await p.eval(`(() => { const lines = [...document.querySelectorAll('#tab-inside p, #tab-inside summary')].map(e => e.textContent);
    return { count: ${PREM}.querySelector('.facility-local-count').textContent, points: ${S}.layers.premises.points.length,
      line: lines.find(l => /^Premise PINs by Species:/.test(l)) || null }; })()`);
  check(emptied.points === 0 && emptied.line === 'Premise PINs by Species: none inside (no sites match the filters)',
  'layers: a layer whose filters leave no site: "none inside (no sites match the filters)", not "no usable locations"', emptied);
  // "Mailing" unticked: the one city-placed site matches but is located only roughly, so left out: no usable location.
  await click(`${PREM}.querySelector('.facility-refine input[value="Mailing"]')`);
  const rough = await p.eval(`({ points: ${S}.layers.premises.points.length, line: [...document.querySelectorAll('#tab-inside p, #tab-inside summary')]
    .map(e => e.textContent).find(l => /^Premise PINs by Species:/.test(l)) || null })`);
  check(rough.points === 1 && rough.line === 'Premise PINs by Species: none inside (no usable locations)',
  'layers: a filtered layer whose only site is located roughly: "no usable locations", not "no sites match the filters"', rough);
  await click(`${PREM}.querySelector('.facility-refine input[value="city"]')`);
  await click(`${PREM}.querySelector('details.facility-filters > summary')`);

  // A new load: every filter cleared and every fold closed (2.7's rule for the animal ticks). Commercial Poultry's fold
  // opened again first (opening another layer's closed it) and a pick made, so the load has a fold and a filter to clear.
  await click(`${ROW('Commercial Poultry')}.querySelector('details.facility-filters > summary')`);
  await click(`${ROW('Commercial Poultry')}.querySelector('.facility-refine input[value="Ducks"]')`);
  const before = await seen();
  check(before.openFolds.includes('Commercial Poultry') && /1 filter on$/.test(before.foldText) && before.cpCount < before.allCount,
  'layers: before the new load, Commercial Poultry\'s fold open with one filter on', [before.openFolds, before.foldText, before.cpCount]);
  const v = await p.eval(`${S}.version`);
  await p.setFiles('#files-input', [samplePath]);
  await emReady(p, v);
  await p.waitFor(`${S}.map.drawn && ${S}.map.drawn.positives > 0`, 15000, 'map drawn again');
  await sleep(300);
  const reload = await seen();
  check(reload.cpCount === reload.allCount && !reload.openFolds.length && reload.foldText === 'Filter by attributes' && !reload.legend.length,
  'layers: a new load clears every filter and closes every fold', [reload.cpCount, reload.openFolds, reload.foldText]);
}

// 2.8: the CVI movements tab's "Refine by species" and "Movement's end in a zone", by real clicks: the tab's line and
// table, the map's CVI premises, the legend's funnel, the picture's key, the Export, a group unticked, a new load;
// the search box past 30 species and a master without a Species column, on masters the part writes itself.
async function partCviFilter(b) {
  const p = b.page, S = 'WSDA.emergency.state';
  const samplePath = path.join(OUT, 'sample', 'emergency_synthetic.zip'), masterPath = path.join(TABLES, 'em_cvi_master.csv');
  // Two masters made from the test master: 36 species (EM-0002's row once per species), and no Species column.
  const text = fs.readFileSync(masterPath, 'utf8').trim().split('\n'), head = text[0].split(','), col = head.indexOf('Species');
  const manyPath = path.join(OUT, 'cvi_master_36_species.csv'), plainPath = path.join(OUT, 'cvi_master_no_species.csv');
  const row2 = text.find(l => l.startsWith('EM-0002,')).split(',');
  const many = Array.from({ length: 33 }, (x, i) => row2.map((v, j) => (j === 0 ? 'EM-1' + String(i).padStart(3, '0') : j === col ? 'Dairy breed ' + String(i + 1).padStart(2, '0') : v)).join(','));
  fs.writeFileSync(manyPath, text.concat(many).join('\n') + '\n');
  fs.writeFileSync(plainPath, text.map(l => l.split(',').filter((v, j) => j !== col).join(',')).join('\n') + '\n');
  // A real click on the element the expression gives.
  const click = async expr => {
    const q = await p.eval(`(() => { const e = ${expr}; e.scrollIntoView({ block: 'nearest' });
      const r = e.getBoundingClientRect(); return { x: Math.round(r.left + Math.min(8, r.width / 2)), y: Math.round(r.top + r.height / 2) }; })()`);
    for (const type of ['mousePressed', 'mouseReleased']) {
      await b.send('Input.dispatchMouseEvent', { type, x: q.x, y: q.y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 }, p.sid);
    }
    await sleep(300);
    await p.waitFor(`!${S}.loading`, 15000, 'redrawn after a click');
  };
  const load = async files => {
    const v = await p.eval(`${S}.version`);   // read before the pick, so a load that ends first is not missed
    await p.setFiles('#files-input', files);
    await emReady(p, v);
    await p.waitFor(`${S}.map.drawn && ${S}.map.drawn.positives > 0`, 15000, 'map drawn');
  };
  const open = async files => {
    await p.goto(new URL('emergency/index.html', SITE).href);
    await p.waitFor('window.WSDA && WSDA.emergency && WSDA.emergency.state.map.ready', 20000, 'Emergency map ready');
    await load(files);
    await p.eval(`document.getElementById('layers-fold').open = true; scrollTo(0, 0); true`);
    await click(`document.getElementById('em-cvi')`);
    await click(`document.getElementById('show-cvi')`);
  };
  const SPECIES = name => `document.querySelector('#cvi-refine-list input[value=${JSON.stringify(name)}]')`;
  const END = key => `document.querySelector('input[name="cvi-end"][value="${key}"]')`;
  const seen = () => p.eval(`(() => { const s = ${S}, g = id => document.getElementById(id);
    return { fold: !g('cvi-refine').hidden, open: g('cvi-refine').open, sum: g('cvi-refine').querySelector('summary').textContent,
      species: [...document.querySelectorAll('#cvi-refine-list label')].map(l => l.textContent.trim()),
      ticked: [...document.querySelectorAll('#cvi-refine-list input:checked')].map(i => i.value), picks: s.cvi.rawSpecies.slice(),
      search: !g('cvi-refine-search').hidden, note: (g('cvi-refine-list').querySelector('p') || {}).textContent || null,
      end: (document.querySelector('input[name="cvi-end"]:checked') || {}).value, state: s.cvi.end,
      ends: [...document.querySelectorAll('input[name="cvi-end"]')].map(i => i.value + ' ' + i.parentNode.textContent.trim()),
      line: (document.querySelector('#cvi-result .result-line') || {}).textContent,
      cvis: [...document.querySelectorAll('#cvi-result tbody tr')].map(r => r.cells[0].textContent).sort(),
      map: s.map.em.cvi.features.map(f => f.properties.label.split('\\n')[1].split(' ')[0]).sort(),
      legend: [...document.querySelectorAll('#em-legend-content p')].map(q => q.textContent + (q.querySelector('.lg-funnel') ? ' (funnel)' : ''))
        .filter(t => /in a zone|CVI premises|^Filtered/.test(t)) }; })()`);

  await open([samplePath, masterPath]);
  const start = await seen();
  check(same(start.ends, ['either Either', 'origin Origin', 'dest Destination']),
    'cvifilter: "Movement\'s end in a zone" offers Either, Origin and Destination', start.ends);
  check(start.fold && !start.open && start.sum === 'Refine by species' && start.end === 'either' && start.state === 'either'
    && start.line === '3 CVIs, 1,265 animals, left from or arrived inside the zones: 2 origins and 2 destinations inside.',
  'cvifilter: after the load "Refine by species" is closed with none ticked, the movement\'s end is Either, every movement counted', start);
  await click(`document.querySelector('#cvi-refine > summary')`);
  const opened = await seen();
  check(opened.open && same(opened.species, ['Chickens', 'Dairy cows', 'Turkeys']) && !opened.search,
    'cvifilter: opened by a click, the fold lists the raw species of the groups ticked, in CVI\'s order, no search box under 30', opened);

  await click(SPECIES('Dairy cows'));
  const cows = await seen();
  check(same(cows.ticked, ['Dairy cows']) && cows.sum === 'Refine by species · 1 of 3 species'
    && cows.line === '2 CVIs, 65 animals, left from or arrived inside the zones: 1 origin and 2 destinations inside.'
    && same(cows.cvis, ['EM-0002', 'EM-0003']),
  'cvifilter: Dairy cows ticked by a click: the fold says "1 of 3 species", the tab counts only its movements (as CVI\'s query in R)', cows);
  check(same(cows.map, ['Destination', 'Destination', 'Origin'])
    && same(cows.legend, ['CVI premises', 'Origin in a zone (funnel)', 'Destination in a zone (funnel)', 'Filtered: some sites left out (funnel)']),
  'cvifilter: the map draws only those movements\' premises; the legend puts a funnel before them and says once what it means', [cows.map, cows.legend]);

  await click(END('origin'));
  const origin = await seen();
  check(origin.state === 'origin' && origin.line === '1 CVI, 25 animals, left from inside the zones: 1 origin inside.'
    && same(origin.cvis, ['EM-0003']) && same(origin.map, ['Origin'])
    && same(origin.legend, ['CVI premises', 'Origin in a zone (funnel)', 'Filtered: some sites left out (funnel)']),
  'cvifilter: Origin picked by a click: only the movements that left from a zone, the map draws only their origins, the legend names only them', origin);
  await click(END('dest'));
  const dest = await seen();
  check(dest.state === 'dest' && dest.line === '2 CVIs, 65 animals, arrived inside the zones: 2 destinations inside.'
    && same(dest.cvis, ['EM-0002', 'EM-0003']) && same(dest.map, ['Destination', 'Destination'])
    && same(dest.legend, ['CVI premises', 'Destination in a zone (funnel)', 'Filtered: some sites left out (funnel)']),
  'cvifilter: Destination picked by a click: only the movements that arrived in a zone, the map draws only their destinations', dest);

  // The picture: its boxes and its key from the same query.
  await p.eval(`document.getElementById('export-fold').open = true; ${S}.lastPreview = null; true`);
  await p.click(`document.getElementById('em-preview').click()`);
  await p.waitFor(`${S}.lastPreview`, 60000, 'preview drawn');
  const pic = await p.eval(`(() => { const m = ${S}.lastPreview.model; CVIWA.previews.close && CVIWA.previews.close();
    return { rows: m.keyItems.filter(i => /in a zone$/.test(i.label)).map(i => i.label + ' ' + i.count + (i.funnel ? ' (funnel)' : '')),
      notes: m.keyRows.filter(r => r.label === 'Filtered: some sites left out').length, premises: m.cviPremises.map(q => q.end) }; })()`);
  check(same(pic.rows, ['Destination in a zone 2']) && pic.notes === 0 && same(pic.premises, ['destination', 'destination']),
    'cvifilter: the map picture draws the same two destinations; its key names only them, with no funnel (the legend has it)', pic);

  // The Export: cvi_movements.csv from the same query; export_params.json names the species and the end.
  await p.eval(`WSDA.sample.download = function () {}; document.getElementById('em-export').click(); true`);
  const ex = await p.eval(`(() => { const files = {};
    (${S}.lastExport || []).filter(e => !e.dir).forEach(e => { files[e.name.replace(/^.*\\//, '')] = e.data; });
    const params = JSON.parse(files['export_params.json']);
    return { cvis: files['cvi_movements.csv'].split('\\n').filter(l => /^"?EM-/.test(l)).map(l => l.split(',')[0].replace(/"/g, '')).sort(),
      species: params.cvi_species, end: params.cvi_end, groups: params.cvi_species_groups }; })()`);
  // (CVI's writer, exports.js jsonValue, writes a list of one as its value, as R's auto_unbox does.)
  check(same(ex.cvis, ['EM-0002', 'EM-0003']) && ex.species === 'Dairy cows' && ex.end === 'destination' && same(ex.groups, ['Cattle', 'Poultry']),
    'cvifilter: the Export\'s cvi_movements.csv holds the same movements; export_params.json names the species and the end', ex);

  // Cattle unticked: Dairy cows drops out; no poultry movement arrived in a zone, and the tab says so.
  await click(`document.querySelector('#cvi-species input[value="Cattle"]')`);
  const noCattle = await seen();
  check(!noCattle.picks.length && same(noCattle.species, ['Chickens', 'Turkeys']) && noCattle.sum === 'Refine by species'
    && noCattle.line === 'No CVI movement arrived inside the zones with these years, quarters and species groups.' && !noCattle.legend.length,
  'cvifilter: Cattle unticked: Dairy cows drops out of the picks and the list; no poultry movement arrived in a zone, and the line says so', noCattle);
  await click(`document.querySelector('#cvi-species input[value="Cattle"]')`);
  await click(SPECIES('Turkeys'));
  await click(END('origin'));
  const turkeys = await seen();
  check(turkeys.line === 'No CVI movement left from inside the zones with these years, quarters, species groups and species.',
    'cvifilter: a species picked that no movement in a zone has: the line names the species among the filters', turkeys.line);

  // A new load: the fold closed, nothing picked, the end Either.
  await load([samplePath, masterPath]);
  await click(`document.getElementById('em-cvi')`);
  await click(`document.getElementById('show-cvi')`);
  const reload = await seen();
  check(!reload.open && !reload.picks.length && !reload.ticked.length && reload.end === 'either' && reload.state === 'either'
    && reload.line === start.line && !reload.legend.some(t => /funnel/.test(t)),
  'cvifilter: a new load closes the fold, clears the picks and sets the end back to Either', reload);

  // Past 30 species, a search box narrows the list and keeps the picks.
  await open([samplePath, manyPath]);
  await click(`document.querySelector('#cvi-refine > summary')`);
  await click(SPECIES('Dairy breed 07'));
  await p.eval(`(() => { const e = document.getElementById('cvi-refine-search'); e.value = 'breed 1'; e.dispatchEvent(new Event('input')); return true; })()`);
  const found = await seen();
  await p.eval(`(() => { const e = document.getElementById('cvi-refine-search'); e.value = 'zebra'; e.dispatchEvent(new Event('input')); return true; })()`);
  const none = await seen();
  check(found.search && found.species.length === 10 && found.species.every(x => /^Dairy breed 1/.test(x)) && same(found.picks, ['Dairy breed 07'])
    && found.sum === 'Refine by species · 1 of 36 species' && none.note === 'No species matches "zebra".',
  'cvifilter: past 30 species a search box narrows the list, the pick kept; a word nothing matches is said', [found.species, found.picks, found.sum, none.note]);

  // A master without a Species column: no fold, every movement of the groups counted.
  await open([samplePath, plainPath]);
  const plain = await seen();
  check(!plain.fold && plain.line === start.line, 'cvifilter: a master without a Species column has no "Refine by species"', plain);
}

async function partByAnimal(b) {
  const p = b.page, S = 'WSDA.emergency.state', R = 'WSDA.emergencyRules';
  const samplePath = path.join(OUT, 'sample', 'emergency_synthetic.zip'), OUTB = path.join(OUT, 'byanimal');
  fs.mkdirSync(OUTB, { recursive: true });
  // A made-up file: two birds and a mixed farm in Yakima, a dairy in Franklin, every one mapped and detected in Sep.
  const FX = require(path.join(ROOT, 'tests', 'synthetic', 'make_em_fixtures.js'));
  const row = (id, day, county, lat, long, species) => [id, '', '', day, '', '(synthetic) Example Farm', '(synthetic) Example Road',
    'Synthetic Town', county, lat, long, 'Active', 'H5N1 2.3.4.4b', 'Commercial', 'Mixed', species, '1000', '1000', '1', 'Landfill'].join(',');
  const mixedFile = path.join(OUTB, 'em_byanimal_mixed.csv');
  fs.writeFileSync(mixedFile, [FX.AGREED_HEAD.join(','), row('BA-001', '09/02/2026', 'Yakima', '46.55', '-120.47', 'Chicken'),
    row('BA-002', '09/10/2026', 'Yakima', '46.40', '-120.32', 'Duck'), row('BA-003', '09/12/2026', 'Yakima', '46.50', '-120.40', '"Cattle, Chicken"'),
    row('BA-004', '09/03/2026', 'Franklin', '46.30', '-119.10', 'Dairy Cow')].join('\n') + '\n');
  // A real click on the element a selector names, then the redraw.
  const press = async sel => {
    const q = await p.eval(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.scrollIntoView({ block: 'nearest' });
      const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
    for (const type of ['mousePressed', 'mouseReleased']) {
      await b.send('Input.dispatchMouseEvent', { type, x: q.x, y: q.y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 }, p.sid);
    }
    await sleep(400);
    await p.waitFor(`!${S}.loading`, 15000, 'redrawn after a click');
  };
  const open = async files => {
    await p.goto(new URL('emergency/index.html', SITE).href);
    await p.waitFor('window.WSDA && WSDA.emergency && WSDA.emergency.state.map.ready', 20000, 'Emergency map ready');
    await p.setFiles('#files-input', files);
    await emReady(p);
    await p.waitFor(`${S}.map.drawn && ${S}.map.drawn.positives > 0`, 15000, 'map drawn');
    await p.eval(`document.getElementById('positives-fold').open = true; ${S}.overview = null; document.getElementById('show-overview').click(); true`);
    await p.waitFor(`${S}.view === 'overview' && ${S}.overview && ${S}.chart`, 20000, 'the Overview drawn');
  };
  // What the Overview shows: the switch, the two charts' keys, hovers and fills; and what the rules give for them.
  const seen = () => p.eval(`(() => { const s = ${S}, R = ${R}, box = document.getElementById('ov-by');
    const keyOf = id => [...document.querySelectorAll('#' + id + ' svg text')].map(t => t.textContent);
    const fills = id => [...new Set([...document.querySelectorAll('#' + id + ' svg rect')].map(r => (r.getAttribute('fill') || '').toLowerCase()))];
    // The hatched parts: each one's pattern, found in its own chart, by its stripes' color.
    const hatch = id => [...document.querySelectorAll('#' + id + ' svg > rect')].filter(r => /^url\\(#/.test(r.getAttribute('fill') || '')).map(r => {
      const pid = r.getAttribute('fill').slice(5, -1), pat = document.querySelector('#' + id + ' svg pattern[id="' + pid + '"]');
      return pid + ' ' + (pat ? pat.querySelectorAll('rect')[1].getAttribute('fill') : 'missing'); });
    const cols = [...document.querySelectorAll('#em-chart .chart-col')].map(c => c.getAttribute('data-hover'));
    const bars = [...document.querySelectorAll('#ov-county-chart .chart-mark')].map(c => c.getAttribute('data-hover'));
    const t = R.overTime(s.read, s.window, s.chartSteps), rows = R.countyRows(s.read, s.window, CVIWA_GEO.counties.features);
    return { hidden: box.hidden, shown: getComputedStyle(box).display !== 'none', pressed: [...box.querySelectorAll('button')].map(x => [x.textContent, x.getAttribute('aria-pressed')]),
      by: s.overview.columnsBy, timeKey: keyOf('em-chart'), countyKey: keyOf('ov-county-chart'), timeFills: fills('em-chart'), countyFills: fills('ov-county-chart'),
      timeHatch: hatch('em-chart'), countyHatch: hatch('ov-county-chart'), cols, bars, label: document.querySelector('#em-chart svg').getAttribute('aria-label'),
      kinds: t.columns.map(c => [c.label, c.kinds, c.current + c.past, c.outside]), rows: rows.map(r => [r.county, r.kinds, r.total]),
      animals: s.animals.slice() }; })()`);
  const has = (list, words) => words.every(w => list.includes(w));

  await open([samplePath]);
  const start = await seen();
  check(!start.hidden && start.shown && same(start.pressed, [['Status', 'true'], ['Animal', 'false']]) && start.by === 'status'
    && has(start.timeKey, ['Active']) && !has(start.timeKey, ['Birds']),
  'byanimal: the sample (birds and cattle) on the Overview: "Columns by" shown over the charts, Status pressed after the load, the charts by status', start.pressed);
  await press('#ov-by button[data-by="animal"]');
  const animal = await seen();
  // Each column's hover as the rules count it: the kinds in the type's order, then those outside (after the day).
  const hoverWords = { birds: 'with birds', cattle: 'with cattle', other: 'with other animals', several: 'with several kinds' };
  const want = animal.kinds.map(([label, kinds, inside, outside]) => {
    const parts = Object.keys(hoverWords).filter(k => kinds[k]).map(k => kinds[k] + ' ' + hoverWords[k]).concat(outside ? [outside + ' after the day'] : []);
    return label + ': ' + (parts.length ? parts.join(', ') : 'no positives');
  });
  check(same(animal.pressed, [['Status', 'false'], ['Animal', 'true']]) && animal.by === 'animal' && has(animal.timeKey, ['Birds', 'Cattle'])
    && !has(animal.timeKey, ['Active']) && /by animal/.test(animal.label),
  'byanimal: Animal clicked: pressed, the time chart\'s key names Birds and Cattle, no longer Active and Closed', [animal.pressed, animal.timeKey.slice(0, 6)]);
  check(same(animal.cols, want) && animal.kinds.every(([l, k, inside]) => Object.values(k).reduce((s, n) => s + n, 0) === inside),
  'byanimal: each column\'s hover counts the positives of each kind, active and closed together, as the rules give them ("2 with birds")', [animal.cols.filter(c => /with/.test(c)), want.filter(c => /with/.test(c))]);
  check(has(animal.timeFills, ['#1c5a83', '#4a8b2c']) && !animal.timeFills.includes('#a50f15') && has(animal.countyFills, ['#1c5a83', '#4a8b2c'])
    && !animal.countyFills.includes('#a50f15'),
  'byanimal: the kinds in WSDA dark blue (birds) and evergreen (cattle), clear of the status red, in both charts', [animal.timeFills, animal.countyFills]);
  const wantBars = animal.rows.flatMap(([county, kinds]) => Object.keys(hoverWords).filter(k => k in kinds).map(k => county + ': ' + kinds[k] + ' ' + hoverWords[k]));
  check(has(animal.countyKey, ['Birds', 'Cattle']) && has(animal.bars, wantBars) && animal.bars.filter(x => !/: 0 /.test(x)).length === wantBars.length,
  'byanimal: the county bars by kind, each bar\'s hover as the rules count it ("Yakima: 2 with birds")', [animal.bars, wantBars]);
  await b.send('Page.captureScreenshot', { format: 'png' }, p.sid).then(r => fs.writeFileSync(path.join(OUTB, 'sample_by_animal.png'), Buffer.from(r.data, 'base64')));

  // One kind ticked: no switch, the charts by status; both again: Animal still chosen.
  await press('#em-animals input[value="cattle"]');
  const one = await seen();
  check(one.hidden && !one.shown && one.by === 'status' && has(one.timeKey, ['Active']) && same(one.animals, ['birds']),
  'byanimal: cattle unticked: one kind left, "Columns by" hidden and the charts by status', [one.hidden, one.by]);
  await press('#em-animals input[value="cattle"]');
  const both = await seen();
  check(!both.hidden && both.by === 'animal' && same(both.pressed, [['Status', 'false'], ['Animal', 'true']]),
  'byanimal: cattle ticked again: the switch back, Animal kept', both.pressed);
  // Between dates: the gray part says "outside the dates".
  await press('#em-view-range');
  await p.waitFor(`${S}.viewKind === 'range' && ${S}.overview`, 15000, 'Between dates');
  const range = await seen();
  check(range.by === 'animal' && has(range.timeKey, ['Birds', 'Cattle']) && range.cols.every(c => !/after the day/.test(c)),
  'byanimal: Between dates, still by animal, nothing "after the day"', range.timeKey);
  await press('#ov-by button[data-by="status"]');
  const status = await seen();
  check(status.by === 'status' && same(status.pressed, [['Status', 'true'], ['Animal', 'false']]) && has(status.timeKey, ['Active']) && status.timeFills.includes('#a50f15'),
  'byanimal: Status clicked: the charts by status again, in the status red', status.pressed);

  // A mixed farm ("Cattle, Chicken"): counted once, under "Several kinds", hatched; Status again at a new
  // load in the same page.
  await press('#ov-by button[data-by="animal"]');
  const v = await p.eval(`${S}.version`);
  await p.setFiles('#files-input', [mixedFile]);
  await emReady(p, v);
  await p.waitFor(`${S}.map.drawn && ${S}.map.drawn.positives === 4`, 15000, 'the mixed file drawn');
  await p.eval(`${S}.overview = null; document.getElementById('show-overview').click(); true`);
  await p.waitFor(`${S}.view === 'overview' && ${S}.overview && ${S}.chart`, 20000, 'the Overview drawn for the mixed file');
  const m0 = await seen();
  check(m0.by === 'status' && same(m0.pressed, [['Status', 'true'], ['Animal', 'false']]),
  'byanimal: a new load in the same page after Animal: Status again', m0.pressed);
  await press('#ov-by button[data-by="animal"]');
  const mx = await seen();
  const yak = mx.rows.find(r => r[0] === 'Yakima') || [];
  check(has(mx.timeKey, ['Birds', 'Cattle', 'Several kinds']) && has(mx.countyKey, ['Birds', 'Cattle', 'Several kinds']) && !animal.timeHatch.length
    && mx.timeHatch.length > 0 && mx.countyHatch.length > 0 && [...mx.timeHatch, ...mx.countyHatch].every(h => / #4d4d4d$/.test(h))
    && !mx.timeHatch.some(h => mx.countyHatch.some(c => c.split(' ')[0] === h.split(' ')[0]))
    && same(yak, ['Yakima', { birds: 2, several: 1 }, 3]) && mx.bars.includes('Yakima: 1 with several kinds') && mx.bars.includes('Yakima: 2 with birds')
    && mx.cols.some(c => /1 with birds, 1 with several kinds/.test(c)),
  'byanimal: the mixed farm counted once, under "Several kinds", hatched in dark gray on white (each chart its own pattern; none in the sample); Yakima 2 with birds and 1 with several kinds, adding up to its 3', [mx.timeKey, yak, mx.bars, mx.timeHatch, mx.countyHatch]);
  await b.send('Page.captureScreenshot', { format: 'png' }, p.sid).then(r => fs.writeFileSync(path.join(OUTB, 'mixed_by_animal.png'), Buffer.from(r.data, 'base64')));
  // A file with one kind (the screwworm outbreak): no switch.
  await open([path.join(TABLES, 'em_nws_synthetic_positives.csv')]);
  const nws = await seen();
  check(nws.hidden && nws.by === 'status', 'byanimal: a file with one kind of animal: no "Columns by"', nws.hidden);
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
    const rr = E.inside(E.ringSites(s.targets, s.rings, s.unit), layers, { mode: 'rings', rings: s.rings, unit: s.unit, positives: s.targets });
    const zr = E.inside(E.zoneSites(E.zoneSet(s.zoneFile.zones, s.drawn)), layers, { mode: 'zones', positives: s.targets });
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
  const ringN = await p.eval(`${S}.targets.length`);
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
  await p.eval(`(document.querySelector('#em-animals input[value="cattle"]').click(), true)`);
  await sleep(400);
  await p.waitFor(`!${S}.loading`, 15000, 'cattle unticked');
  const asCattle = await refuse('SYN-HPAI-003');
  await p.eval(`(document.querySelector('#em-animals input[value="cattle"]').click(), true)`);
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

// 2.8, "Changing the kinds of animals" (site/emergency/changing-kinds.html) followed on a copy of the site, the page
// itself, and the "?" of the line naming species not listed. The copy, in local-test-artifacts/em/kinds/site, is opened over file:// in either mode.
// ---- report: 2.9, E2, the Report view's page 1 from the loaded file, and print --------------------------------------
// The report scenario (em_rules_report.csv, 17 rows, one per rule; its figures worked out by hand in the unit suite
// and in R) on Sep 1, 2026: the Report button, page 1's figures as printed, every row counted whatever the "Animals"
// ticks, a later date, the print styles (only the pages, one per sheet), the PDF's pages and the print window's title,
// 320 pixels wide; pictures and the PDF in local-test-artifacts/em/report/.
async function partReport(b) {
  const p = b.page, OUTR = path.join(OUT, 'report');
  fs.mkdirSync(OUTR, { recursive: true });
  const shot = async (name, full) => fs.writeFileSync(path.join(OUTR, name + '.png'),
    Buffer.from((await b.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: !!full }, p.sid)).data, 'base64'));
  await b.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }, p.sid);
  await p.goto(new URL('emergency/index.html', SITE).href);
  await p.waitFor('window.WSDA && WSDA.emergency && WSDA.emergency.state.map.ready', 20000, 'Emergency map ready');
  check(await p.eval(`document.getElementById('show-report').hidden && document.getElementById('em-view').hidden`),
    'report: nothing loaded: no Report button');
  await p.setFiles('#files-input', [path.join(OUT, 'fixtures', 'em_rules_report.csv')]);
  await emReady(p);
  check(await p.eval(`!document.getElementById('show-report').hidden && WSDA.emergency.state.view === 'map'
    && document.getElementById('show-report').textContent.trim() === 'Report'`), 'report: the file loaded: the Report button, the page on the Map');
  await p.click(`document.getElementById('show-report').click()`);
  await p.waitFor(`!document.getElementById('view-report').hidden && WSDA.emergencyReportView.last`, 10000, 'Report shown');
  const today = await p.eval(`document.getElementById('rp-date').value`);
  check(today === TODAY && await p.eval(`document.body.classList.contains('rp-on') && document.getElementById('view-map').hidden
    && document.getElementById('view-overview').hidden && document.getElementById('show-report').getAttribute('aria-pressed') === 'true'`),
    'report: the Report view on today\'s date (Oct 30, 2026), the Map and Overview hidden', today);
  // The date picked as staff would: typed into the date box.
  const setDate = async iso => {
    await p.eval(`(() => { const i = document.getElementById('rp-date'); i.focus(); i.value = ${JSON.stringify(iso)};
      i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    let drawn = true;
    try {
      await p.waitFor(`WSDA.emergencyReportView.last.figures.date === ${JSON.stringify(iso)}`, 5000, 'report on ' + iso);
    } catch (e) { drawn = false; }
    check(drawn, 'report: the date typed (' + iso + ') is the update\'s date, the pages drawn again', iso);
    await p.eval('document.fonts.ready.then(() => new Promise(r => setTimeout(r, 100)))');
  };
  await setDate('2026-09-01');
  const PAGE1 = `(() => { const pg = document.querySelector('#rp-preview .rp-page'), t = s => (pg.querySelector(s) || {}).textContent || '';
    return { pages: document.querySelectorAll('#rp-preview .rp-page').length, count: document.getElementById('rp-count').textContent,
      note: document.getElementById('rp-note').hidden ? '' : document.getElementById('rp-note').textContent,
      date: t('.rp-head .d'), title: t('.rp-head .t b'), banner: t('.rp-banner b'), line: t('.rp-banner div span'),
      tiles: Array.from(pg.querySelectorAll('.rp-tile')).map(e => [e.querySelector('.l').textContent, e.querySelector('.v').textContent,
        (e.querySelector('.s') || {}).textContent || '', e.classList.contains('act')]),
      src: Array.from(pg.querySelectorAll('.rp-src')).map(e => e.textContent),
      counties: Array.from(pg.querySelectorAll('.rp-clist div')).map(e => [e.querySelector('span').textContent, e.querySelector('em').textContent, !e.classList.contains('out')]),
      dots: pg.querySelectorAll('.rp-map circle[filter]').length, active: pg.querySelectorAll('.rp-map circle[data-active]').length,
      under: t('.rp-under'), mapLink: (pg.querySelector('.rp-under a') || {}).href,
      months: new Set(Array.from(pg.querySelectorAll('.rp-chart rect')).map(r => r.getAttribute('data-month'))).size,
      rows: Array.from(pg.querySelectorAll('table.rp-dt tr')).slice(1).map(r => Array.from(r.cells).map(c => c.textContent)),
      cards: Array.from(document.querySelectorAll('#rp-preview .rp-card b.h')).map(e => e.textContent),
      cardPage: Array.from(document.querySelectorAll('#rp-preview .rp-page')).findIndex(x => x.querySelector('.rp-card')) + 1,
      links: Array.from(document.querySelectorAll('#rp-preview .rp-card a')).map(a => a.href),
      icons: Array.from(document.querySelectorAll('#rp-preview .rp-card')).map(c => { const s = c.querySelector('svg.em-ic');
        return s ? [s.getAttribute('viewBox'), s.getAttribute('width'), getComputedStyle(s).color, s.querySelectorAll('path').length] : null; }),
      feet: Array.from(document.querySelectorAll('#rp-preview .rp-foot')).length,
      foot: t('.rp-foot'), pg: t('.rp-head .pg') }; })()`;
  let r = await p.eval(PAGE1);
  check(r.date.startsWith('September 1, 2026') && r.title === 'Highly Pathogenic Avian Influenza (HPAI) Update' && r.pg === 'Page 1 of ' + r.pages
    && r.pages >= 1 && r.count === r.pages + (r.pages === 1 ? ' page' : ' pages') + ', as they print',
    'report: the page\'s head: the title, the date and "Page 1 of n"; the count beside the date', r);
  check(r.banner === '3 active detections: 2 flocks · 1 dairy herd'
    && r.line === 'Washington has active detections of highly pathogenic avian influenza in domestic flocks. Last detection Aug 28, 2026, 4 days ago.',
    'report: the banner as the unit suite works it out (every kind, split by kind; the wording that fits)', [r.banner, r.line]);
  check(same(r.tiles, [['Active now', '3', '2 flocks · 1 dairy herd', true], ['This year', '6', 'detections in 2026', false],
    ['Flocks since 2022', '14', '2 commercial · 10 backyard · 2 other', false], ['Birds affected', '1.25M', '1,251,396 since 2022, 1 without a count', false],
    ['Counties', '9', 'of 39, since 2022', false], ['Last detection', 'Aug 28', '4 days ago', false]]),
    'report: the six tiles as printed', r.tiles);
  check(r.src[0] === 'Source: WSDA HPAI table, as of September 1, 2026. Every row is a case, mapped or not, since the start of the outbreak in 2022.'
    + ' 1 case without a detection date: in the totals only. Also since 2022: 2 dairy herds (3,550 cattle) · 1 premises with other animals (6 other animals)'
    + ' · 1 case naming more than one kind of animal.', 'report: the source line and the other kinds named apart', r.src[0]);
  check(same(r.counties, [['Franklin', '2', true], ['King', '2', true], ['Pierce', '2', true], ['Snohomish', '2', true], ['Yakima', '2', true],
    ['Clark', '1', true], ['Lewis', '1', true], ['Thurston', '1', true], ['Whatcom', '1', true], ['Multnomah', '1', false], ['Not given', '1', false]])
    && r.src.includes('Multnomah: not a Washington county; Not given: no county and no map point in the table.'),
    'report: the cases by county, the most first; Multnomah and "not given" last, each said under the list', [r.counties, r.src]);
  check(r.dots === 14 && r.active === 3 && /Surveillance areas are active around 2 cases in 2 counties\.$/.test(r.under)
    && r.mapLink === 'https://arcg.is/05KT8S', 'report: the map: a dot per case of a Washington county (14), the 3 active in crimson; the outbreak map\'s link; the zones line', r);
  check(r.months === 13, 'report: the months with detections drawn (13 of the 55)', r.months);
  check(same(r.rows, [['3/14/26', 'Franklin', 'Large', 'Commercial', 'Turkey', 'Released'], ['6/10/26', 'Lewis', 'Small', 'Backyard', 'Cattle, Chicken', 'Released'],
    ['7/1/26', 'Whatcom', 'Small', 'Backyard', 'Meat Goat', 'Released'], ['8/20/26', 'Franklin', 'Large', 'Commercial', 'Dairy cattle', 'Active'],
    ['8/25/26', 'Yakima', 'Small', 'Backyard', 'Chicken', 'Active'], ['8/28/26', 'Thurston', 'Small', 'Backyard', 'Chicken', 'Active']]),
    'report: this year\'s detections, oldest first, with the flock of exactly 1,000 Large', r.rows);
  check(same(r.cards, ['Protect your flock', 'Low risk to the public', 'Moving dairy cattle', '1 active livestock case in Washington'])
    && r.links.includes('https://www.aphis.usda.gov/sites/default/files/national-milk-testing-strategy-5-stage.pdf') && r.links.every(u => u.startsWith('https://'))
    && /Sick birds\? Call the Sick Bird Hotline, 1-800-606-3056, or report online at agr\.wa\.gov\/birdflu/.test(r.foot)
    && /alternate format\? Contact WSDA at \(360\) 902-1976 or TTY Relay 800-833-6388\./.test(r.foot)
    && r.feet === r.pages && r.pages === 3 && r.cardPage === 2 && r.note === '1 row detected after September 1, 2026 left out.',
    'report: the key messages and the livestock card from the data (on page 2: six of this year\'s rows fill page 1), page 2\'s blocks after them (3 pages); their links; the hotline and the alternate-format line on every page; Skagit 11, after the date, said left out', r);
  // The cards' icons (2.9 step 3, message-icons.js): Filled by default, OCHA's shield, person and truck on their own grids
  // and Phosphor's filled drop for the livestock card, 22 pixels, in the dark teal.
  const TEAL = 'rgb(36, 85, 102)';
  check(same(r.icons, [['0 0 44 48', '22', TEAL, 1], ['0 0 33.99994 44', '22', TEAL, 2], ['0 0 40 48', '22', TEAL, 2], ['0 0 256 256', '22', TEAL, 1]]),
    'report: the cards\' icons Filled by default (OCHA\'s shield, person and truck; Phosphor\'s filled drop), 22 pixels, in the dark teal', r.icons);
  // Outline, chosen with the form's "Icon style", then Filled again.
  await p.click(`document.querySelector('input[name="rp-icons"][value="outline"]').click()`);
  try {
    await p.waitFor(`document.querySelector('#rp-preview .rp-card svg.em-ic').getAttribute('viewBox') === '0 0 256 256'`, 5000, 'Outline drawn');
  } catch (e) { /* the check below names it */ }
  const outline = (await p.eval(PAGE1)).icons;
  await p.click(`document.querySelector('input[name="rp-icons"][value="filled"]').click()`);
  try {
    await p.waitFor(`document.querySelector('#rp-preview .rp-card svg.em-ic').getAttribute('viewBox') !== '0 0 256 256'`, 5000, 'Filled drawn');
  } catch (e) { /* the check below names it */ }
  check(same(outline, [['0 0 256 256', '22', TEAL, 1], ['0 0 256 256', '22', TEAL, 1], ['0 0 256 256', '22', TEAL, 1], ['0 0 256 256', '22', TEAL, 1]])
    && same((await p.eval(PAGE1)).icons, r.icons),
    'report: with the Outline style every card takes Phosphor\'s regular icon; back to Filled after', outline);
  await shot('report_1280');
  // Every row counted whatever the "Animals" ticks: cattle unticked leaves the update as it was, and the note says so.
  await p.click(`(() => { const t = Array.from(document.querySelectorAll('#em-animals input[type=checkbox]')).find(i => i.value === 'cattle'); t.click(); })()`);
  await p.waitFor(`/whatever the "Animals" ticks/.test(document.getElementById('rp-note').textContent)`, 5000, 'note shown');
  const r2 = await p.eval(PAGE1);
  check(same(r2.tiles, r.tiles) && r2.note === '1 row detected after September 1, 2026 left out. The update counts every kind of animal, whatever the "Animals" ticks.',
    'report: cattle unticked under "Animals": the update unchanged, and the note says why', r2.note);
  await p.click(`(() => { const t = Array.from(document.querySelectorAll('#em-animals input[type=checkbox]')).find(i => i.value === 'cattle'); t.click(); })()`);
  await p.waitFor(`!/Animals/.test(document.getElementById('rp-note').textContent)`, 5000, 'note back');
  // On screen, the Report view takes the page's width: the sidebar's controls and the value boxes are hidden.
  const onScreen = await p.eval(`(() => { const shown = s => Array.from(document.querySelectorAll(s)).filter(e => e.getClientRects().length).length;
    return { aside: shown('.em-controls'), boxes: shown('#em-boxes'), form: shown('#rp-form') }; })()`);
  check(same(onScreen, { aside: 0, boxes: 0, form: 1 }), 'report: on screen the sidebar and the value boxes are hidden beside the form', onScreen);
  // The print styles: only the pages, at their own size, one per sheet; the PDF's pages are the preview's.
  await b.send('Emulation.setEmulatedMedia', { media: 'print' }, p.sid);
  const pr = await p.eval(`(() => { const shown = s => Array.from(document.querySelectorAll(s)).filter(e => e.getClientRects().length).length;
    const pg = document.querySelector('.rp-page').getBoundingClientRect();
    return { aside: shown('.em-controls'), top: shown('header.top'), foot: shown('footer.foot'), bar: shown('.rp-bar-top'), boxes: shown('#em-boxes'),
      pages: shown('.rp-page'), w: pg.width, h: pg.height, scale: getComputedStyle(document.querySelector('.rp-sheets')).transform }; })()`);
  await b.send('Emulation.setEmulatedMedia', { media: '' }, p.sid);
  check(pr.aside === 0 && pr.top === 0 && pr.foot === 0 && pr.bar === 0 && pr.boxes === 0 && pr.pages === r.pages && pr.w === 816 && pr.h === 1056
    && pr.scale === 'none', 'report: printed, only the pages show, each 8.5 by 11 inches, not scaled', pr);
  const pdf = Buffer.from((await b.send('Page.printToPDF', { preferCSSPageSize: true, printBackground: true }, p.sid)).data, 'base64');
  fs.writeFileSync(path.join(OUTR, 'report_2026-09-01.pdf'), pdf);
  const pdfPages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
  const mediaBox = (pdf.toString('latin1').match(/\/MediaBox\s*\[\s*0 0 ([\d.]+) ([\d.]+)\s*\]/) || []).slice(1).map(Number);
  check(pdfPages === r.pages && Math.round(mediaBox[0]) === 612 && Math.round(mediaBox[1]) === 792,
    'report: the PDF has the preview\'s pages, each letter size (612 by 792 points)', { pdfPages, pages: r.pages, mediaBox });
  // "Print / Save as PDF": the print window's title names the file; the page's own title comes back after.
  const titles = await p.eval(`(() => { const was = document.title, real = window.print; let during = null;
    window.print = () => { during = document.title; };
    document.getElementById('rp-print').click(); window.print = real;
    window.dispatchEvent(new Event('afterprint')); return { was, during, after: document.title }; })()`);
  check(titles.during === 'HPAI update 2026-09-01' && titles.after === titles.was, 'report: printing, the title "HPAI update 2026-09-01" (the PDF\'s name), then the page\'s own again', titles);
  // A later date: the September row comes in; an earlier one leaves later rows out, and the note says how many.
  await setDate('2026-08-01');
  const r3 = await p.eval(PAGE1);
  check(r3.banner === '1 active detection: 1 premises with other animals; none in domestic flocks' && r3.line.startsWith('Washington is currently considered free')
    && r3.note === '4 rows detected after August 1, 2026 left out.' && r3.date.startsWith('August 1, 2026'),
    'report: on Aug 1 only the goats are active ("free" in domestic flocks); the four rows after it (Franklin 12, Yakima 12, Thurston 11, Skagit 11) left out, as the note says', [r3.banner, r3.note]);
  await setDate('2026-09-01');
  // 320 pixels wide: the pages scaled into the column, nothing wider than the screen.
  await b.send('Emulation.setDeviceMetricsOverride', { width: 320, height: 800, deviceScaleFactor: 2, mobile: true }, p.sid);
  await p.eval('new Promise(r => setTimeout(r, 300))');
  const ph = await p.eval(`(() => { const b = document.getElementById('rp-preview').getBoundingClientRect(), pg = document.querySelector('.rp-page').getBoundingClientRect();
    return { wide: document.documentElement.scrollWidth, box: Math.round(b.width), page: Math.round(pg.width), right: Math.round(pg.right) }; })()`);
  check(ph.wide <= 320 && ph.page <= ph.box && ph.right <= 320, 'report: 320 pixels wide: the page scaled into the column, no sideways scrolling', ph);
  await shot('report_320');
  await b.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }, p.sid);
}

// ---- form: 2.9, E2, the Report view's form (report-form.js) driven as staff would -----------------------------------
// The report scenario on Sep 1, 2026 (2 active flocks and the dairy herd): each fold's heading, the status, the milk
// testing stage, the map's look, the note, the key messages (typed, highlighted, moved, an icon picked, set aside and
// put back, removed and undone, added), the icon style, the boxes, "Ready to send" and the DRAFT mark, the print, and
// "Save report text" and "Load last month's" (a file that is not one, a value the page does not know, a file too big).
// Clicks are the mouse's and words are typed (Chrome's own input events); the milk stage's list is chosen by its value
// (a native list). Pictures and the saved files in local-test-artifacts/em/report-form/.
async function partForm(b) {
  const p = b.page, OUTF = path.join(OUT, 'report-form');
  fs.rmSync(OUTF, { recursive: true, force: true });
  fs.mkdirSync(OUTF, { recursive: true });
  await b.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }, p.sid);
  await p.goto(new URL('emergency/index.html', SITE).href);
  await p.waitFor('window.WSDA && WSDA.emergency && WSDA.emergency.state.map.ready', 20000, 'Emergency map ready');
  await p.setFiles('#files-input', [path.join(OUT, 'fixtures', 'em_rules_report.csv')]);
  await emReady(p);
  await p.click(`document.getElementById('show-report').click()`);
  await p.waitFor(`!document.getElementById('view-report').hidden && WSDA.emergencyReportView.last`, 10000, 'Report shown');
  await p.eval(`(() => { const i = document.getElementById('rp-date'); i.value = '2026-09-01'; i.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await p.waitFor(`WSDA.emergencyReportView.last.figures.date === '2026-09-01'`, 5000, 'report on Sep 1');
  // The mouse on an element's middle (scrolled into view first), typing (the words replace the box's), and keys.
  const mouse = async sel => {
    const at = await p.eval(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({ block: 'center' });
      const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    if (!at) throw new Error('form: nothing at ' + sel);
    for (const type of ['mousePressed', 'mouseReleased']) {
      await b.send('Input.dispatchMouseEvent', { type, x: at.x, y: at.y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 }, p.sid);
    }
  };
  const press = async (key, keyCode) => {
    for (const type of ['keyDown', 'keyUp']) await b.send('Input.dispatchKeyEvent', { type, key, code: key, windowsVirtualKeyCode: keyCode }, p.sid);
  };
  const typeIn = async (sel, words) => {
    await p.eval(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.scrollIntoView({ block: 'center' }); e.focus(); e.select(); })()`);
    if (words) await b.send('Input.insertText', { text: words }, p.sid);
    else await press('Backspace', 8);
  };
  const radio = (name, value) => `label:has(> input[name="${name}"][value="${value}"])`;
  const settle = () => p.eval('new Promise(r => setTimeout(r, 400))');
  const PAGES = `(() => { const pv = document.getElementById('rp-preview'), q = s => Array.from(pv.querySelectorAll(s));
    return { pages: q('.rp-page').length, drafts: q('.rp-draft').length, draftTags: q('.rp-draft-tag').length,
      line: (pv.querySelector('.rp-banner div span') || {}).textContent, head: (pv.querySelector('.rp-head') || {}).textContent,
      cards: q('.rp-card').map(c => [c.querySelector('b.h').textContent, c.classList.contains('hl')]),
      cardLinks: q('.rp-card').map(c => { const a = c.querySelector('a'); return a ? a.href : null; }),
      icons: q('.rp-card .rp-ic svg').map(s => s.getAttribute('viewBox')), firstIcon: (pv.querySelector('.rp-card .rp-ic') || {}).innerHTML,
      lv: (q('.rp-card').pop() || {}).textContent, note: (pv.querySelector('.rp-note-p') || {}).textContent || '',
      shaded: q('.rp-map path[data-cases]').length, key: (pv.querySelector('.rp-key') || {}).textContent || '', dots: q('.rp-map circle[filter]').length,
      feet: q('.rp-foot').map(f => f.textContent), footLinks: q('.rp-foot a').map(a => a.href) }; })()`;
  const FORM = `(() => { const $ = id => document.getElementById(id), tag = id => [$(id).textContent, $(id).className];
    const said = el => el.hidden ? '' : el.textContent, a = document.activeElement;
    return { tags: { date: tag('rp-t-date'), status: tag('rp-t-status'), data: tag('rp-t-data'), msgs: tag('rp-t-msgs'), boxes: tag('rp-t-boxes') },
      status: (document.querySelector('input[name="rp-status"]:checked') || {}).value, statusWarn: said($('rp-status-warn')), milkWarn: said($('rp-milk-warn')),
      boxesWarn: said($('rp-boxes-warn')), own: !$('rp-own').hidden, milkOwn: !$('rp-milk-own').hidden,
      msgs: Array.from(document.querySelectorAll('#rp-msgs .rp-msg')).map(m => ({ h: m.querySelector('[data-f="headline"]').value, hl: m.classList.contains('hl'),
        warn: said(m.querySelector('[data-warn]')), lines: m.querySelector('[data-lines]').textContent })),
      aside: $('rp-aside').hidden ? [] : Array.from($('rp-aside').querySelectorAll('li span')).map(s => s.textContent), undo: said($('rp-msg-undo')),
      where: $('rp-msgs-where').textContent, ready: $('rp-ready').checked, readyNote: [$('rp-ready-note').textContent, $('rp-ready-note').className],
      fileNote: [said($('rp-file-note')), $('rp-file-note').className], picker: !!document.querySelector('#rp-msgs .rp-picker'),
      focus: a ? (a.id || (a.dataset.act ? a.dataset.act + '@' + ((a.closest('.rp-msg') || {}).dataset || {}).i : '') || (a.dataset.back !== undefined ? 'back' + a.dataset.back : '') || a.tagName) : null }; })()`;
  const form = () => p.eval(FORM), pages = () => p.eval(PAGES);
  // A wait for the pages that runs out is a failed check named for what the pages should show, and the part goes on.
  const waitPages = async (cond, label) => {
    try { await p.waitFor(`(pg => ${cond})(${PAGES})`, 5000, label); } catch (e) { check(false, 'form: the pages show: ' + label, await pages()); }
  };
  const shot = async name => fs.writeFileSync(path.join(OUTF, name + '.png'),
    Buffer.from((await b.send('Page.captureScreenshot', { format: 'png' }, p.sid)).data, 'base64'));

  // 1. The form beside the pages on Sep 1: each fold's heading; the dairy herd active, so the milk stage asks to be checked.
  let f = await form(), g = await pages();
  check(same(f.tags, { date: ['September 1, 2026', 'tag'], status: ['Check', 'tag warn'], data: ['Automatic', 'tag ok'], msgs: ['3 messages', 'tag'],
    boxes: ['Kept month to month', 'tag'] }) && f.status === 'active' && f.statusWarn === ''
    && f.milkWarn === '1 active dairy herd on September 1, 2026: check the milk testing stage.',
  'form: each fold\'s heading on Sep 1 (the date, "Check" for the active dairy herd\'s milk stage, "Automatic", the messages, the boxes); the wording that fits ticked', f);
  check(g.drafts === g.pages && g.draftTags === g.pages && g.pages === 3 && !f.ready
    && same(f.readyNote, ['Every page says DRAFT until this is ticked. Still to check: Washington: the status, National (USDA), Wild birds and testing (WADDL).', 'rp-ready-note warn']),
  'form: every page marked DRAFT until "Ready to send"; the line beside it names the fold still saying "Check"', [g.drafts, g.pages, f.readyNote]);
  check(f.msgs.length === 3 && f.msgs.every(m => /^About \d+ lines? on the card\.$/.test(m.lines)) && f.where === 'The key messages print on page 2 (3 pages in all).',
    'form: each message\'s lines on its card, and the page the messages print on', [f.msgs.map(m => m.lines), f.where]);
  await shot('form_1280');

  // 2. The status: "free" while flocks are active warns; "Write my own" opens the box, and the words typed print after a pause.
  await mouse(radio('rp-status', 'free'));
  await waitPages(`/^Washington is currently considered free/.test(pg.line)`, 'free wording printed');
  f = await form();
  check(f.statusWarn === 'The data has 2 active flocks on September 1, 2026: this wording says there are none. Pick the other wording, or write your own.'
    && f.tags.status[0] === 'Check', 'form: "free" clicked while 2 flocks are active: printed, with the warning', f.statusWarn);
  await mouse(radio('rp-status', 'own'));
  f = await form();
  check(f.own && f.statusWarn === 'Write the sentence, or pick an approved wording.', 'form: "Write my own" clicked: its box shown, asking for the sentence', f);
  await typeIn('#rp-own', 'Washington is watching two flocks closely.');
  const soon = (await pages()).line;
  await waitPages(`pg.line.startsWith('Washington is watching two flocks closely.')`, 'own words printed');
  f = await form();
  check(!soon.startsWith('Washington is watching') && f.statusWarn === '' && f.focus === 'rp-own',
    'form: the words typed print a moment after the typing stops, the box keeping the focus; no warning', { soon, f: f.focus });
  await mouse(radio('rp-status', 'active'));
  await waitPages(`/^Washington has active detections/.test(pg.line)`, 'active wording printed');
  check(!(await form()).own, 'form: an approved wording clicked: the own box hidden, that wording printed');

  // 3. The milk testing stage: "Write my own" asks for both the stage and its sentence; they print on the livestock card.
  await p.eval(`(() => { const s = document.getElementById('rp-milk'); s.value = 'own'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await typeIn('#rp-milk-stage', 'Stage 2');
  await settle();
  f = await form();
  check(f.milkOwn && f.milkWarn === '1 active dairy herd on September 1, 2026: check the milk testing stage. Write the stage and its sentence.',
    'form: a milk stage of staff\'s own: its boxes shown; the stage alone asks for its sentence', f.milkWarn);
  await typeIn('#rp-milk-text', 'Bulk tank sampling continues monthly.');
  await waitPages(`/Stage 2/.test(pg.lv) && /Bulk tank sampling continues monthly\\./.test(pg.lv)`, 'own milk stage printed');
  check((await form()).milkWarn === '1 active dairy herd on September 1, 2026: check the milk testing stage.',
    'form: the stage and its sentence typed: printed on the livestock card, the reminder for the active herd left');
  await p.eval(`(() => { const s = document.getElementById('rp-milk'); s.value = '0'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await waitPages(`/Unaffected \\/ Stage 4/.test(pg.lv)`, 'update\'s milk stage back');
  check(!(await form()).milkOwn, 'form: the update\'s own milk stage picked again: the own boxes hidden, its stage printed');
  await mouse('label:has(> #rp-suspected)');
  const sus = await p.eval(`[document.getElementById('rp-suspected').checked, WSDA.emergency.state.reportText.suspected]`);
  await mouse('label:has(> #rp-suspected)');
  check(same(sus, [true, true]) && !(await p.eval(`WSDA.emergency.state.reportText.suspected`)), 'form: "Suspected livestock cases" ticked and unticked by the mouse', sus);

  // 4. The map's look and the note.
  await mouse(radio('rp-map', 'counties'));
  await waitPages(`pg.shaded > 0`, 'counties shaded');
  g = await pages();
  check(g.shaded === 39 && g.dots === 0 && g.key === 'Cases:12 to 34 to 78 or more', 'form: "Counties shaded" clicked: the 39 counties shaded, the key under the map, no dots', g);
  await mouse(radio('rp-map', 'dots'));
  await waitPages(`pg.dots === 14`, 'dots back');
  await typeIn('#rp-note-in', 'Two counties reported late.');
  await waitPages(`pg.note === 'Note: Two counties reported late.'`, 'note printed');
  g = await pages();
  check(g.dots === 14 && g.shaded === 0 && g.note === 'Note: Two counties reported late.', 'form: "Soft dots" again (14 dots); the note typed prints under Washington\'s figures', g);

  // 5. The key messages.
  await p.eval(`document.getElementById('rp-m0-headline').dataset.mark = 'kept'; true`);
  await typeIn('#rp-m0-headline', 'Protect every flock');
  await waitPages(`pg.cards[0][0] === 'Protect every flock'`, 'headline printed');
  f = await form();
  check(f.focus === 'rp-m0-headline' && await p.eval(`document.getElementById('rp-m0-headline').dataset.mark === 'kept'`),
    'form: a headline typed prints on its card; the box typed in is the same one, still with the focus (the list not drawn again)', f.focus);
  await mouse('#rp-msgs .rp-msg[data-i="0"] label:has(> input[data-f="highlight"])');
  await waitPages(`pg.cards[0][1] === true`, 'card highlighted');
  check((await form()).msgs[0].hl, 'form: "Highlight" ticked: the card shaded on the page and in the form');
  await mouse('#rp-msgs .rp-msg[data-i="2"] [data-act="up"]');
  await waitPages(`pg.cards[1][0] === 'Moving dairy cattle'`, 'moved up');
  g = await pages(); f = await form();
  check(same(g.cards.map(c => c[0]), ['Protect every flock', 'Moving dairy cattle', 'Low risk to the public', '1 active livestock case in Washington'])
    && f.focus === 'up@1', 'form: the third message moved up: the cards in the new order, the focus on its arrow', [g.cards, f.focus]);
  await mouse('#rp-msgs .rp-msg[data-i="0"] [data-act="pick"]');
  f = await form();
  check(f.picker && await p.eval(`document.activeElement.getAttribute('aria-pressed') === 'true' && document.activeElement.dataset.key === 'shield-check'`),
    'form: the icon button clicked: the icon list open, the focus on the icon in use', f.picker);
  await mouse('#rp-msgs .rp-picker [data-key="turkey"]');
  // The turkey as the browser writes it back (a <path/> read as <path></path>).
  await waitPages(`pg.firstIcon === Object.assign(document.createElement('div'), { innerHTML: WSDA.emergencyMessageIcons.svg('turkey', 'filled', 22) }).innerHTML`, 'turkey printed');
  f = await form();
  check(!f.picker && f.focus === 'pick@0', 'form: an icon picked: the card takes it, the list closes, the focus back on the icon button', f);
  await mouse('#rp-msgs .rp-msg[data-i="1"] [data-act="pick"]');
  await press('Escape', 27);
  f = await form();
  check(!f.picker && f.focus === 'pick@1', 'form: Escape closes the icon list, the focus back on its button', f);
  await typeIn('#rp-m2-url', 'www.cdc.gov/bird-flu');
  await waitPages(`pg.cardLinks[2] === null`, 'link words only');
  f = await form();
  check(f.msgs[2].warn === 'This address does not start with https:// (or http://), so it would not open: it prints as words only. Copy it from the browser\'s address bar.'
    && same(f.tags.msgs, ['Check: 1 message', 'tag warn']), 'form: an address without https:// warned, the card\'s link words printed without a link, the fold says "Check"', f.msgs[2]);
  await typeIn('#rp-m2-url', 'https://www.cdc.gov/bird-flu/worker-safety/index.html');
  await waitPages(`pg.cardLinks[2] === 'https://www.cdc.gov/bird-flu/worker-safety/index.html'`, 'link back');
  await mouse('#rp-msgs .rp-msg[data-i="1"] [data-act="aside"]');
  await waitPages(`pg.cards.length === 3`, 'set aside');
  f = await form(); g = await pages();
  check(same(f.aside, ['Moving dairy cattle']) && f.msgs.length === 2 && f.focus === 'back0' && !g.cards.some(c => c[0] === 'Moving dairy cattle'),
    'form: "Set aside": the message off the pages, listed under "Set aside", the focus on its "Put back"', [f.aside, f.focus]);
  await mouse('#rp-aside [data-back="0"]');
  await waitPages(`pg.cards.length === 4`, 'put back');
  f = await form(); g = await pages();
  check(same(f.aside, []) && same(g.cards.map(c => c[0]).slice(0, 3), ['Protect every flock', 'Low risk to the public', 'Moving dairy cattle']) && f.focus === 'rp-m2-headline',
    'form: "Put back": the message back at the end of the list and the pages', [g.cards, f.focus]);
  await mouse('#rp-msgs .rp-msg[data-i="0"] [data-act="remove"]');
  await waitPages(`pg.cards.length === 3`, 'removed');
  f = await form();
  check(f.undo === 'Undo: put message 1 back' && f.msgs.length === 2 && f.msgs[0].h === 'Low risk to the public', 'form: a message removed: off the list and the pages; "Undo" offered', f.undo);
  await mouse('#rp-msg-undo');
  await waitPages(`pg.cards.length === 4 && pg.cards[0][0] === 'Protect every flock'`, 'undone');
  f = await form();
  check(f.undo === '' && f.msgs[0].h === 'Protect every flock' && f.msgs[0].hl && f.focus === 'rp-m0-headline',
    'form: "Undo": the message back in its place, still highlighted; "Undo" gone', f);
  await mouse('#rp-msg-add');
  await settle();
  f = await form(); g = await pages();
  check(f.msgs.length === 4 && f.msgs[3].warn === 'Message 4 is empty, so it is left off the pages: write it, or remove it.' && f.focus === 'rp-m3-headline'
    && g.cards.length === 4 && same(f.tags.msgs, ['Check: 1 message', 'tag warn']),
  'form: "Add a message": an empty one, the focus in its headline, warned and left off the pages until written', f);
  await typeIn('#rp-m3-headline', 'Fair season');
  await waitPages(`pg.cards.length === 5 && pg.cards[3][0] === 'Fair season'`, 'new message printed');
  check((await form()).msgs[3].warn === '', 'form: the new message\'s headline typed: printed before the livestock card, the warning gone');
  await mouse(radio('rp-icons', 'outline'));
  await waitPages(`pg.icons.every(v => v === '0 0 256 256')`, 'outline icons');
  g = await pages();
  check(g.icons.length === 5, 'form: "Outline" clicked: every card\'s icon in the outline style (the livestock card\'s too)', g.icons);

  // 6. The boxes: the foot of every page and the line under the title, warnings for a missing address or number.
  await mouse('#rp-f-boxes > summary');
  await typeIn('#rp-hot-number', '1-800-555-0100');
  await waitPages(`pg.feet.every(t => t.includes('1-800-555-0100'))`, 'hotline printed');
  check((await pages()).feet.length === 3, 'form: the hotline\'s number typed prints in the foot of every page');
  await typeIn('#rp-online-url', '');
  await waitPages(`!pg.footLinks.includes('https://agr.wa.gov/birdflu')`, 'online link gone');
  f = await form();
  check(f.boxesWarn === '"Report online at" has no address: it prints as words only.' && same(f.tags.boxes, ['Check', 'tag warn'])
    && same(f.readyNote, ['Every page says DRAFT until this is ticked. Still to check: Washington: the status, National (USDA), Wild birds and testing (WADDL), Boxes and resources.', 'rp-ready-note warn']),
  'form: "report online at" emptied: its words print without a link, warned, the fold named beside "Ready to send"', f);
  await typeIn('#rp-online-url', 'https://agr.wa.gov/birdflu');
  await typeIn('#rp-heading', 'Issued on the first of each month.');
  await waitPages(`pg.head.includes('Issued on the first of each month.') && pg.footLinks.includes('https://agr.wa.gov/birdflu')`, 'heading printed');
  check((await form()).boxesWarn === '', 'form: the line under the title typed prints under it; the address back, no warning');

  // 7. "Ready to send": the DRAFT mark off every page, the folds still saying "Check" named; the print.
  await mouse('label.rp-ready');
  await waitPages(`pg.drafts === 0 && pg.draftTags === 0`, 'draft off');
  f = await form();
  check(f.ready && same(f.readyNote, ['Still to check: Washington: the status, National (USDA), Wild birds and testing (WADDL).', 'rp-ready-note warn']),
    'form: "Ready to send" ticked: no DRAFT mark; still names the fold saying "Check"', f.readyNote);
  await b.send('Emulation.setEmulatedMedia', { media: 'print' }, p.sid);
  const prReady = await p.eval(`(() => { const shown = s => Array.from(document.querySelectorAll(s)).filter(e => e.getClientRects().length).length;
    return { form: shown('#rp-form'), pages: shown('.rp-page'), drafts: shown('.rp-draft'), ready: shown('.rp-send') }; })()`);
  await b.send('Emulation.setEmulatedMedia', { media: '' }, p.sid);
  await mouse('label.rp-ready');
  await waitPages(`pg.drafts === pg.pages`, 'draft back');
  await b.send('Emulation.setEmulatedMedia', { media: 'print' }, p.sid);
  const prDraft = await p.eval(`(() => { const shown = s => Array.from(document.querySelectorAll(s)).filter(e => e.getClientRects().length).length;
    return { form: shown('#rp-form'), pages: shown('.rp-page'), drafts: shown('.rp-draft'), tags: shown('.rp-draft-tag') }; })()`);
  await b.send('Emulation.setEmulatedMedia', { media: '' }, p.sid);
  check(prReady.form === 0 && prReady.ready === 0 && prReady.drafts === 0 && prReady.pages === 3 && prDraft.form === 0 && prDraft.drafts === 3 && prDraft.tags === 3,
    'form: printed, the form never shows; a draft prints DRAFT on every page, a report ready to send none', { prReady, prDraft });

  // 8. "Save report text": one small file named for the report, the form's words and choices.
  const DL = path.join(OUTF, 'download');
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
  await mouse('#rp-save');
  const d = await download;
  await b.send('Browser.setDownloadBehavior', { behavior: 'default' });
  const SAVED = path.join(OUTF, 'HPAI update 2026-09-01 report text.json');
  if (d.state === 'completed') fs.renameSync(path.join(DL, d.guid), SAVED);
  const savedWords = fs.existsSync(SAVED) ? fs.readFileSync(SAVED, 'utf8') : '';
  const pageWords = await p.eval(`WSDA.emergencyReportForm.toFile(WSDA.emergency.state.reportText, WSDA.emergency.state.type, '2026-09-01', '2026-10-30')`);
  f = await form();
  check(d.state === 'completed' && d.name === 'HPAI update 2026-09-01 report text.json' && savedWords === pageWords
    && same(f.fileNote, ['Saved as "HPAI update 2026-09-01 report text.json" in your downloads. Keep it on the R drive for next month.', 'rp-file-note']),
  'form: "Save report text" downloads "HPAI update 2026-09-01 report text.json", the form\'s words and choices, and says where', { d, note: f.fileNote });
  const so = savedWords ? JSON.parse(savedWords) : { text: {} };
  check(same((so.text.messages || []).map(m => m.headline), ['Protect every flock', 'Low risk to the public', 'Moving dairy cattle', 'Fair season'])
    && so.text.messages[0].icon === 'turkey' && so.text.messages[0].highlight === true && so.text.iconStyle === 'outline' && so.text.note === 'Two counties reported late.'
    && so.text.hotline.number === '1-800-555-0100' && so.text.heading === 'Issued on the first of each month.' && !/Franklin|Yakima|Thurston|SYN-/.test(savedWords),
  'form: the saved file has what was typed and chosen (the messages, the turkey, the highlight, Outline, the note, the boxes), nothing from the table', so.text);

  // 9. "Load last month's": the form back as saved, a draft; files that are not one refused, the form left as it was.
  await typeIn('#rp-m0-headline', 'Something else');
  await mouse(radio('rp-icons', 'filled'));
  await mouse('label.rp-ready');
  await waitPages(`pg.cards[0][0] === 'Something else' && pg.drafts === 0`, 'changed before loading');
  await p.setFiles('#rp-load-file', [SAVED]);
  await waitPages(`pg.cards[0][0] === 'Protect every flock' && pg.drafts === pg.pages`, 'loaded');
  f = await form(); g = await pages();
  check(f.msgs[0].h === 'Protect every flock' && f.msgs.length === 4 && !f.ready && g.icons.every(v => v === '0 0 256 256')
    && same(f.fileNote, ['Loaded "HPAI update 2026-09-01 report text.json", the report text of September 1, 2026. The numbers are this table\'s.', 'rp-file-note'])
    && await p.eval(`document.getElementById('rp-load-file').value === '' && document.getElementById('rp-note-in').value === 'Two counties reported late.'`),
  'form: "Load last month\'s": the form and the pages as saved, a draft again ("Ready to send" unticked), and the note says so', f);
  await p.setFiles('#rp-load-file', [path.join(OUT, 'fixtures', 'em_rules_report.csv')]);
  await p.waitFor(`/em_rules_report\\.csv/.test(document.getElementById('rp-file-note').textContent)`, 5000, 'csv refused');
  f = await form();
  check(same(f.fileNote, ['"em_rules_report.csv": This file is not a report text saved from this page.', 'rp-file-note warn']) && f.msgs[0].h === 'Protect every flock',
    'form: a table loaded as a report text refused, said in orange; the form left as it was', f.fileNote);
  const ODD = path.join(OUTF, 'odd report text.json');
  fs.writeFileSync(ODD, savedWords.replace('"mapLook": "dots"', '"mapLook": "squares"').replace('"Fair season"', '"Fair weather"'));
  await p.setFiles('#rp-load-file', [ODD]);
  await p.waitFor(`/odd report text/.test(document.getElementById('rp-file-note').textContent)`, 5000, 'odd loaded');
  f = await form();
  check(same(f.fileNote, ['Loaded "odd report text.json", the report text of September 1, 2026. The numbers are this table\'s. The map\'s look is not one this page knows: Soft dots instead.',
    'rp-file-note warn']) && f.msgs[3].h === 'Fair weather', 'form: a saved file with a value the page does not know: the rest loaded, that one named in orange', f.fileNote);
  const BIG = path.join(OUTF, 'big.json');
  fs.writeFileSync(BIG, JSON.stringify({ kind: 'WSDA Emergency Response report text', version: 1, type: 'hpai', text: { note: 'x'.repeat(1100000) } }));
  await p.setFiles('#rp-load-file', [BIG]);
  await p.waitFor(`/big\\.json/.test(document.getElementById('rp-file-note').textContent)`, 5000, 'big refused');
  f = await form();
  check(same(f.fileNote, ['"big.json" is too big to be a report text saved from this page.', 'rp-file-note warn']) && f.msgs[3].h === 'Fair weather',
    'form: a file over a million bytes refused before it is read; the form left as it was', f.fileNote);
  await p.eval(`document.getElementById('rp-form').scrollTop = 0; window.scrollTo(0, 0); true`);
  await shot('form_after');
  // The report text is kept while the table is loaded again.
  await p.setFiles('#files-input', [path.join(OUT, 'fixtures', 'em_rules_report.csv')]);
  await emReady(p);
  check(await p.eval(`WSDA.emergency.state.reportText.messages[3].headline === 'Fair weather'`), 'form: the table loaded again: the form\'s words kept');
  // Another type's file in between (New World screwworm, no report words): the words typed for HPAI come back with it.
  // (With HPAI the only type with report words, the page never makes another type's text, so this holds with or
  // without app.js's one text per type; that guards a second type with report words.)
  let vT = await p.eval('WSDA.emergency.state.version');
  await p.setFiles('#files-input', [path.join(TABLES, 'em_nws_synthetic_positives.csv')]);
  await emReady(p, vT);
  const between = await p.eval(`[WSDA.emergency.state.type.id, document.getElementById('show-report').hidden]`);
  vT = await p.eval('WSDA.emergency.state.version');
  await p.setFiles('#files-input', [path.join(OUT, 'fixtures', 'em_rules_report.csv')]);
  await emReady(p, vT);
  check(same(between, ['nws', true]) && await p.eval(`WSDA.emergency.state.type.id === 'hpai' && WSDA.emergency.state.reportText.messages[3].headline === 'Fair weather'`),
    'form: a screwworm file loaded in between (no Report button), then the HPAI table again: the form\'s words kept', between);
  fs.rmSync(DL, { recursive: true, force: true });
}

// ---- page2: 2.9, E2, page 2 of the update (report-form.js page 2) and a premises detected twice on the map ----------
// Real typing and mouse clicks: page 2's boxes filled from the update of September 1, 2026, the checks' lines and the
// folds' headings, the "no detections" ticks, a category and a link added, moved and removed, USDA's pictures picked
// as a file and pasted (a paste with words refused), "Save for ArcGIS" and "Save report text" downloaded and read, and
// "Load last month's" for another month leaving page 2's figures and pictures empty; then the map's badge and hover box
// for Yakima 11 and 12 (one map point). A paste is sent as the page's own paste event with a picture on it, since a
// headless browser has no clipboard of its own.
async function partPage2(b) {
  const p = b.page, OUTF = path.join(OUT, 'report-page2'), DL = path.join(OUTF, 'download');
  fs.rmSync(OUTF, { recursive: true, force: true });
  fs.mkdirSync(DL, { recursive: true });
  // The picture slots wait for a paste when they take the focus: a headless page has it only with focus emulation.
  await b.send('Emulation.setFocusEmulationEnabled', { enabled: true }, p.sid);
  await b.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }, p.sid);
  await p.goto(new URL('emergency/index.html', SITE).href);
  await p.waitFor('window.WSDA && WSDA.emergency && WSDA.emergency.state.map.ready', 20000, 'Emergency map ready');
  await p.setFiles('#files-input', [path.join(OUT, 'fixtures', 'em_rules_report.csv')]);
  await emReady(p);
  await p.click(`document.getElementById('show-report').click()`);
  await p.waitFor(`!document.getElementById('view-report').hidden && WSDA.emergencyReportView.last`, 10000, 'Report shown');
  const setDate = iso => p.eval(`(() => { const i = document.getElementById('rp-date'); i.value = '${iso}'; i.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await setDate('2026-09-01');
  await p.waitFor(`WSDA.emergencyReportView.last.figures.date === '2026-09-01'`, 5000, 'report on Sep 1');
  const mouse = async sel => {
    const at = await p.eval(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({ block: 'center' });
      const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    // Nothing to click (a step before it failed): a failed check, and the part goes on.
    if (!at) { check(false, 'page2: nothing to click at ' + sel); return; }
    for (const type of ['mousePressed', 'mouseReleased']) {
      await b.send('Input.dispatchMouseEvent', { type, x: at.x, y: at.y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 }, p.sid);
    }
  };
  const typeIn = async (sel, words) => {
    await p.eval(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.scrollIntoView({ block: 'center' }); e.focus(); e.select(); })()`);
    if (words) await b.send('Input.insertText', { text: words }, p.sid);
    else for (const type of ['keyDown', 'keyUp']) await b.send('Input.dispatchKeyEvent', { type, key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 }, p.sid);
  };
  const box = id => '#rp-p2-' + id;
  // What the form and the pages show: the folds' headings, every box's line, the pages' page 2.
  const SHOWN = `(() => { const $ = id => document.getElementById(id), pv = $('rp-preview'), q = s => Array.from(pv.querySelectorAll(s));
    const h3s = q('.rp-page h3').map(h => h.firstChild.textContent);
    const blk = name => { const h = q('.rp-page h3').find(x => x.firstChild.textContent === name); return h ? h.closest('.rp-blk') : null; };
    const tiles = name => { const k = blk(name); return k ? Array.from(k.querySelectorAll('.rp-tile')).map(t => [t.querySelector('.l').textContent, t.querySelector('.v').textContent,
      (t.querySelector('.s') || {}).textContent || '']) : []; };
    const said = el => el.hidden ? '' : el.textContent;
    return { nat: $('rp-t-nat').textContent, natHow: $('rp-t-nat').className, wild: $('rp-t-wild').textContent, boxes: $('rp-t-boxes').textContent,
      why: Object.fromEntries(Array.from(document.querySelectorAll('#rp-form [data-why]')).filter(e => !e.hidden).map(e => [e.dataset.why, e.textContent])),
      edges: Array.from(document.querySelectorAll('#rp-form .chk')).length, compared: $('rp-p2-cmp').textContent, flocks: $('rp-p2-flocks').textContent,
      boxesWarn: said($('rp-boxes-warn')), fileNote: said($('rp-file-note')), readyNote: $('rp-ready-note').textContent,
      pages: q('.rp-page').length, h3s, national: tiles('National (USDA)'), wildTiles: tiles('Washington: wild birds and wild mammals'),
      natSrc: (blk('National (USDA)') || { querySelector: () => null }).querySelector('.rp-src') ? blk('National (USDA)').querySelector('.rp-src').textContent : '',
      maps: q('.rp-maps figure').map(f => [f.querySelector('figcaption').textContent, !!f.querySelector('img'), f.querySelector('.sub:last-child').textContent]),
      imgs: q('.rp-maps img').map(i => i.src.slice(0, 22)), notFilled: q('.rp-page .rp-nf').length,
      testing: blk('Testing (WADDL)') ? blk('Testing (WADDL)').querySelector('.rp-p').textContent : '',
      bars: q('.rp-bars text[text-anchor="end"]').map(t => t.textContent), barValues: q('.rp-bars text[font-weight="700"]').map(t => t.textContent),
      quick: blk('Testing (WADDL)') ? Array.from(blk('Testing (WADDL)').querySelectorAll('.rp-res > div')).map(d => Array.from(d.children).map(c => c.textContent)) : [],
      call: (pv.querySelector('.rp-call') || {}).textContent || '', resources: blk('Resources') ? Array.from(blk('Resources').querySelectorAll('.rp-res a')).map(a => a.href) : [],
      slots: Array.from(document.querySelectorAll('#rp-pics .rp-slot')).map(s => ({ k: s.dataset.pic, wait: s.classList.contains('wait'), img: !!s.querySelector('img'),
        st: said(s.querySelector('[data-st]')), from: (s.querySelector('.from') || {}).textContent || '', paste: said(s.querySelector('[data-paste]')),
        btn: s.querySelector('[data-pic-act="add"]').textContent })),
      focus: document.activeElement ? (document.activeElement.getAttribute('aria-label') || document.activeElement.id || document.activeElement.className) : '' }; })()`;
  const shown = () => p.eval(SHOWN);
  // A wait that runs out is a failed check named for what it waited for, and the part goes on.
  const soft = async (expr, label) => { try { await p.waitFor(expr, 3000, label); } catch (e) { check(false, 'page2: ' + label); } };
  const waitShown = async (cond, label) => {
    try { await p.waitFor(`(s => ${cond})(${SHOWN})`, 5000, label); } catch (e) { check(false, 'page2: the page shows: ' + label, await shown()); }
  };
  const shot = async name => fs.writeFileSync(path.join(OUTF, name + '.png'),
    Buffer.from((await b.send('Page.captureScreenshot', { format: 'png' }, p.sid)).data, 'base64'));
  // A download started by a click: its name and words.
  const downloaded = async (sel, file) => {
    await b.send('Browser.setDownloadBehavior', { behavior: 'allowAndName', downloadPath: DL, eventsEnabled: true });
    const done = new Promise(res => {
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
    await mouse(sel);
    const d = await done;
    await b.send('Browser.setDownloadBehavior', { behavior: 'default' });
    if (d.state === 'completed') fs.renameSync(path.join(DL, d.guid), path.join(OUTF, file));
    return Object.assign(d, { words: fs.existsSync(path.join(OUTF, file)) ? fs.readFileSync(path.join(OUTF, file), 'utf8') : '' });
  };

  // 1. Nothing typed yet: the folds count the boxes not filled and the pictures to add; page 2 prints "not filled".
  let s = await shown();
  check(s.nat === '15 not filled · 3 pictures' && s.natHow === 'tag warn' && s.wild === '14 not filled' && s.pages === 3
    && same(s.why, { 'nat.asOf': 'Not filled. Type the date on USDA\'s page.', 'tests.asOf': 'Not filled. Type the date on WADDL\'s page.' })
    && s.flocks === 'Flocks in all: not filled (added up, never typed)' && s.notFilled === 20 && s.maps.every(m => !m[1])
    && same(s.h3s.slice(-6), ['Key messages', 'National (USDA)', 'States with detections, last 30 days', 'Washington: wild birds and wild mammals', 'Testing (WADDL)', 'Resources']),
  'page2: nothing typed: "15 not filled · 3 pictures" and WADDL\'s "14 not filled"; page 2\'s blocks after the key messages, "not filled" where a box is empty', s);

  // 2. The update of September 1 typed into the National fold, box by box.
  const NAT = [['nat-asOf', 'September 1, 2026'], ['nat-birds', '208.33'], ['nat-states', '50'], ['nat-commercial', '1032'], ['nat-backyard', '1211'], ['nat-territories', '1'],
    ['nat-c30', '3'], ['nat-b30', '4'], ['nat-birds30', '0.15'], ['nat-regional30', '3'], ['nat-lastFlock', '9/1/2026'], ['nat-lvStates', '1'], ['nat-lvCases', '2'],
    ['nat-lvRegional', '0'], ['nat-lastLivestock', 'Aug 14, 2026']];
  for (const [id, words] of NAT) await typeIn(box(id), words);
  await waitShown(`s.nat === '3 pictures' && s.national.length === 6 && s.national[1][1] === '2,243'`, 'National typed');
  s = await shown();
  check(same(s.national, [['Birds affected', '208.33M', 'since 2022'], ['Flocks', '2,243', '1,032 commercial · 1,211 backyard'], ['States', '50', 'and 1 territory'],
    ['Flocks, 30 days', '7', '3 commercial · 4 backyard'], ['Birds, 30 days', '0.15M', 'in those flocks'], ['Livestock, 30 days', '2', 'cases in 1 state']])
    && s.flocks === 'Flocks in all: 2,243 (added up, never typed)' && /^Regional confirmations in the last 30 days: 3 flocks, 0 livestock\./.test(s.natSrc)
    && same(s.maps.map(m => m[2]), ['Data source', 'Data source', 'Data source']) && s.h3s.includes('National (USDA)'),
  'page2: the National boxes typed: the six tiles as the update has them, the flocks added up (2,243, never typed), the 30 days\' flocks added up (7)', s.national);
  check((s.maps[0] || [])[0] === 'Domestic flocks' && /Last reported detection: September 1, 2026/.test(await p.eval(`(document.querySelector('.rp-maps figure .sub') || {}).textContent || ''`)),
    'page2: a date typed 9/1/2026 prints as "September 1, 2026"');
  // A slip: an old "as of" date and a last-30-days number above its total, each said under its box, the heading counting.
  await typeIn(box('nat-asOf'), 'July 30, 2026');
  await typeIn(box('nat-c30'), '1320');
  await waitShown(`s.nat === '2 to check · 3 pictures'`, 'two slips counted');
  s = await shown();
  check(same(s.why, { 'nat.asOf': 'July 30, 2026 is 33 days before the report\'s date. Is it USDA\'s latest?',
    'nat.c30': '1,320 in the last 30 days is more than the 1,032 commercial flocks since the outbreak began.', 'tests.asOf': 'Not filled. Type the date on WADDL\'s page.' }) && s.edges === 3
    && (s.national[3] || [])[1] === '1,324' && /National \(USDA\)/.test(s.readyNote),
  'page2: two slips typed: an orange edge and a line under each, the heading "2 to check"; the pages print what was typed (a check never changes a number)', s);
  await typeIn(box('nat-asOf'), 'September 1, 2026');
  await typeIn(box('nat-c30'), '3');
  await waitShown(`s.nat === '3 pictures' && !s.why['nat.c30']`, 'slips fixed');

  // 3. Wild birds and testing: the boxes, the "no detections" ticks, WADDL's numbers.
  await typeIn(box('wild-since'), '690');
  await typeIn(box('wild-window'), 'July 28 to August 27, 2026');
  await typeIn(box('wild-d30'), '5');
  await mouse('label:has(> #rp-p2-wild-d30None)');
  await mouse('label:has(> #rp-p2-wild-m30None)');
  await typeIn(box('tests-asOf'), 'September 1, 2026');
  await typeIn(box('tests-total'), '9,575');
  const N = [195, 41, 6920, 148, 2937, 4, 2627, 424];
  for (let i = 0; i < N.length; i++) await typeIn(`#rp-cats .rp-cat[data-i="${i}"] [data-k="n"]`, String(N[i]));
  await waitShown(`s.wild === 'All filled' && s.barValues.length === 8 && !s.barValues.includes('not filled')`, 'WADDL typed');
  s = await shown();
  const ticked = await p.eval(`[document.getElementById('rp-p2-wild-d30').disabled, document.getElementById('rp-p2-wild-d30').value, WSDA.emergency.state.reportText.p2.wild.d30None]`);
  check(same(s.wildTiles, [['Wild birds since 2021', '690', 'detections'], ['Wild birds, last 30 days', 'None', 'no detections reported'],
    ['Wild mammals, last 30 days', 'None', 'no detections reported']]) && same(ticked, [true, '', true]),
  'page2: "No wild bird detections" ticked by the mouse: its box emptied and grayed, "None, no detections reported" printed', [s.wildTiles, ticked]);
  check(same(s.bars, ['Domestic Cattle/Milk', 'Domestic Poultry', 'Wild Birds', 'Wildlife', 'Animal Feed', 'Domestic Mammal (Other)', 'Domestic Cats', 'Not Specified'])
    && same(s.barValues, ['6,920', '2,937', '2,627', '424', '195', '148', '41', '4']) && /There have been over 9,575 HPAI PCR tests run for Washington since January 1, 2024\.$/.test(s.testing),
  'page2: WADDL\'s tests by category printed largest first, "Not Specified" last; the total as typed with its comma', [s.bars, s.barValues]);
  // A category added with the mouse (the new row takes the focus), typed, printed; then removed.
  await mouse('#rp-cat-add');
  await soft(`document.activeElement && document.activeElement.closest('.rp-cat[data-i="8"]')`, 'the new category focused');
  await b.send('Input.insertText', { text: 'Swine' }, p.sid);
  await typeIn('#rp-cats .rp-cat[data-i="8"] [data-k="n"]', 'lots');
  await waitShown(`s.why['cat.8'] && s.wild === '1 to check'`, 'category checked');
  s = await shown();
  check(s.why['cat.8'] === '"lots" is not a number. Type the tests as WADDL shows them, e.g. 2937.' && s.bars.includes('Swine'),
    'page2: "+ Add a category" clicked: a new row, focused; a word for its tests is a check ("1 to check"), printed as typed', s.why);
  await mouse('#rp-cats .rp-cat[data-i="8"] [data-act="remove"]');
  await waitShown(`s.wild === 'All filled' && !s.bars.includes('Swine')`, 'category removed');
  // A link added to WADDL's Quick links, with an address that would not open; moved up; removed.
  await mouse('[data-list-add="testingLists.1"]');
  await soft(`document.activeElement && document.activeElement.closest('[data-list="testingLists.1"] .rp-link[data-i="3"]')`, 'the new link focused');
  await b.send('Input.insertText', { text: 'Report form' }, p.sid);
  await typeIn('[data-list="testingLists.1"] .rp-link[data-i="3"] [data-k="url"]', 'waddl.vetmed.wsu.edu/form');
  await waitShown(`s.wild === '1 to check'`, 'link checked');
  s = await shown();
  check(s.why['list.1.3'] === 'This address would not open: it prints as words only.' && same(s.quick[1], ['Quick links', 'Submit a sample', 'Sample packing guidelines',
    'Sample shipping guidelines', 'Report form']),
  'page2: "+ Add a link" in Quick links: an address that would not open is a check, the link printed as its words', [s.why, s.quick]);
  await mouse('[data-list="testingLists.1"] .rp-link[data-i="3"] [data-act="up"]');
  await waitShown(`s.quick[1] && s.quick[1][3] === 'Report form'`, 'link moved up');
  check((await p.eval(`document.activeElement.getAttribute('aria-label')`)) === 'Move link 3 up', 'page2: a link moved up with the mouse: printed one place up, the focus on its arrow');
  await mouse('[data-list="testingLists.1"] .rp-link[data-i="2"] [data-act="remove"]');
  await waitShown(`s.wild === 'All filled' && s.quick[1].length === 4`, 'link removed');
  // A resource's address that would not open: "Boxes and resources" says "Check".
  await mouse('#rp-f-boxes > summary');
  await typeIn('[data-list="resources.2"] .rp-link[data-i="1"] [data-k="url"]', 'cdc.gov/bird-flu');
  await waitShown(`s.boxes === 'Check'`, 'resource checked');
  s = await shown();
  check(s.boxesWarn === 'Public health, link 2 ("National (CDC)"): its address would not open, so it prints as words only.' && s.resources.length === 9,
    'page2: a resource\'s address that would not open: said in "Boxes and resources", the link printed as words', [s.boxesWarn, s.resources.length]);
  await typeIn('[data-list="resources.2"] .rp-link[data-i="1"] [data-k="url"]', 'https://www.cdc.gov/bird-flu/situation-summary/index.html');
  await typeIn('#rp-p2-call0-headline', 'Report sick birds to WSDA');
  await waitShown(`s.boxes === 'Kept month to month' && /^Report sick birds to WSDA/.test(s.call)`, 'box headline');
  check(/Sick Bird Hotline 1-800-606-3056Report Sick Wild Birds to WDFW/.test((await shown()).call),
    'page2: the box\'s headline typed prints; the hotline\'s name and number from "Boxes and resources" follow its first part');

  // 4. USDA's pictures: one picked as a file, one pasted, a paste with words refused, one removed.
  const PIC = path.join(OUTF, 'usda-flocks.png');
  fs.writeFileSync(PIC, Buffer.from((await p.eval(`(() => { const c = document.createElement('canvas'); c.width = 240; c.height = 150; const g = c.getContext('2d');
    g.fillStyle = '#dfe9ee'; g.fillRect(0, 0, 240, 150); g.fillStyle = '#245566'; g.fillRect(60, 40, 50, 30); return c.toDataURL('image/png').split(',')[1]; })()`)), 'base64'));
  await mouse('.rp-slot[data-pic="flocks"] [data-pic-act="add"]');
  await p.setFiles('#rp-pic-file', [PIC]);
  await waitShown(`s.slots[0].img && s.imgs.length === 1`, 'picture picked');
  s = await shown();
  check(s.slots[0].from === 'usda-flocks.png' && s.slots[0].btn === 'Change' && (s.maps[0] || [])[1] && s.imgs[0] === 'data:image/png;base64,' && s.nat === '2 pictures',
    'page2: "Add USDA\'s picture" and a file picked: the slot shows it and its name, "Change"; page 2 prints it in its frame; "2 pictures" to add', s.slots[0]);
  await mouse('.rp-slot[data-pic="livestock"] b');
  await waitShown(`s.slots[1].wait`, 'slot waiting');
  s = await shown();
  check(s.slots[1].st === 'Ready: press Ctrl+V to paste' && !s.slots[1].paste && /^Domestic livestock: USDA/.test(s.focus),
    'page2: a slot clicked: it waits with a dashed edge, "Ready: press Ctrl+V to paste"', s.slots[1]);
  const paste = what => p.eval(`(async () => { const dt = new DataTransfer();
    if (${JSON.stringify(what)} === 'picture') { const c = document.createElement('canvas'); c.width = 200; c.height = 120; c.getContext('2d').fillRect(10, 10, 50, 50);
      const blob = await new Promise(r => c.toBlob(r, 'image/png')); dt.items.add(new File([blob], 'image.png', { type: 'image/png' })); }
    else dt.setData('text/plain', 'some copied words');
    document.activeElement.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); return true; })()`);
  await paste('picture');
  await waitShown(`s.slots[1].img`, 'picture pasted');
  s = await shown();
  check(s.slots[1].from === 'Pasted picture, October 30, 2026' && (s.maps[1] || [])[1] && s.nat === '1 picture',
    'page2: a snip pasted on the waiting slot: shown as "Pasted picture" with the day; printed in its frame; "1 picture" to add', s.slots[1]);
  await mouse('.rp-slot[data-pic="wild"] b');
  await waitShown(`s.slots[2].wait`, 'wild slot waiting');
  await paste('words');
  await waitShown(`/clipboard holds no picture/.test(s.slots[2].st)`, 'words refused');
  s = await shown();
  check(s.slots[2].st === 'The clipboard holds no picture (it has words). Snip USDA\'s map first: on Windows, Win+Shift+S.' && !s.slots[2].img && !(s.maps[2] || [])[1],
    'page2: a paste with words on the clipboard: the slot says it holds no picture and how to snip one; nothing added', s.slots[2]);
  await mouse('#rp-p2-tests-total');
  await waitShown(`!s.slots[2].wait && s.slots[2].st === 'No picture yet'`, 'slot left');
  check(true, 'page2: leaving the slot: the dashed edge and the note gone, "No picture yet"');
  await mouse('.rp-slot[data-pic="livestock"] [data-pic-act="remove"]');
  await waitShown(`!s.slots[1].img && !s.maps[1][1] && s.nat === '2 pictures'`, 'picture removed');
  check(true, 'page2: "Remove": the slot and its frame without a picture again, "2 pictures"');
  await mouse('.rp-slot[data-pic="wild"] [data-pic-act="add"]');
  await p.setFiles('#rp-pic-file', [path.join(OUT, 'fixtures', 'em_rules_report.csv')]);
  await waitShown(`/is not a picture/.test(s.slots[2].st)`, 'a table refused as a picture');
  check(!(await shown()).slots[2].img, 'page2: a file that is not a picture picked: refused, said in its slot, nothing added');
  await p.eval(`document.getElementById('rp-form').scrollTop = 0; true`);
  await shot('page2_filled');

  // 5. "Save for ArcGIS": hpai-monthly-figures.csv, one row, as the page works it out.
  const arc = await downloaded('#rp-arcgis', 'hpai-monthly-figures.csv');
  const arcPage = await p.eval(`WSDA.emergencyReportForm.arcgisFile(WSDA.emergency.state.reportText, WSDA.emergency.state.type, '2026-09-01', WSDA.emergencyReportView.last.words).csv`);
  const arcRow = arc.words ? arc.words.split('\r\n')[1] : '';
  s = await shown();
  check(arc.state === 'completed' && arc.name === 'hpai-monthly-figures.csv' && arc.words === arcPage && arc.words.startsWith('report_date,wa_status,wa_livestock,wa_milk_stage,us_as_of,')
    && /^"September 1, 2026",Washington has active detections of highly pathogenic avian influenza in domestic flocks\.,There is 1 active confirmed livestock case/.test(arcRow)
    && /,208\.33,2243,1032,1211,50,1,3,4,0\.15,3,1,2,0,"September 1, 2026","August 14, 2026","July 28 to August 27, 2026",690,No detections reported,No detections reported,9575,"January 1, 2024"$/.test(arcRow)
    && /^Saved "hpai-monthly-figures\.csv": page 2's figures and the status, livestock and milk testing sentences/.test(s.fileNote),
  'page2: "Save for ArcGIS" downloads hpai-monthly-figures.csv: the monthly table\'s columns, the status and livestock sentences as printed, page 2\'s figures without commas', { arc: arc.name, arcRow, note: s.fileNote });

  // 6. "Save report text", then "Load last month's" a month later: page 2's figures and pictures empty, compared with.
  const saved = await downloaded('#rp-save', 'report text.json');
  const so = saved.words ? JSON.parse(saved.words) : { text: {} };
  check(saved.state === 'completed' && so.text.p2 && so.text.p2.nat.backyard === '1211' && so.text.past[0].date === '2026-09-01' && !/data:image/.test(saved.words),
    'page2: "Save report text" keeps page 2 as typed and its figures to compare with next month, never the pictures', so.text.past);
  await setDate('2026-10-01');
  await soft(`WSDA.emergencyReportView.last.figures.date === '2026-10-01'`, 'the report on Oct 1');
  await p.setFiles('#rp-load-file', [path.join(OUTF, 'report text.json')]);
  await waitShown(`/left empty for October 1, 2026/.test(s.fileNote)`, 'loaded for October');
  s = await shown();
  const values = await p.eval(`[...document.querySelectorAll('#rp-form [data-p2]')].filter(e => !/source|lvSource|sequencing/.test(e.dataset.p2) && e.value).map(e => e.dataset.p2)`);
  check(same(values, []) && s.slots.every(x => !x.img) && s.nat === '15 not filled · 3 pictures' && s.compared === 'Compared with: the report text of September 1, 2026 (loaded).'
    && (s.quick[1] || []).length === 4 && /Page 2's numbers, dates and pictures are left empty for October 1, 2026: type this month's; last month's are kept to check them against\. To go on with that report instead, set the report date to September 1, 2026 and load the file again\./.test(s.fileNote),
  'page2: "Load last month\'s" on October 1: page 2\'s numbers, dates and pictures empty, the lists as saved, compared with September 1 and said so', { values, s });
  await typeIn(box('nat-backyard'), '1200');
  await waitShown(`s.why['nat.backyard']`, 'lower than last month');
  check((await shown()).why['nat.backyard'] === '1,200 is lower than last month\'s 1,211. A number since the outbreak began never goes down.',
    'page2: October\'s number typed lower than September\'s: the check names last month\'s 1,211');
  await setDate('2026-09-01');
  await soft(`WSDA.emergencyReportView.last.figures.date === '2026-09-01'`, 'the report on Sep 1 again');
  await p.setFiles('#rp-load-file', [path.join(OUTF, 'report text.json')]);
  await waitShown(`s.national.length === 6 && s.national[1][1] === '2,243'`, 'loaded for the same day');
  check(!/left empty/.test((await shown()).fileNote), 'page2: the same report text loaded for its own date (September 1): page 2\'s figures back as saved');
  await shot('page2_loaded');

  // 7. The map: Yakima 11 and 12 at one point: a badge with 2 on the shown mark, the hover's box naming both.
  await p.click(`document.getElementById('show-map').click()`);
  await p.waitFor(`!document.getElementById('view-map').hidden`, 5000, 'Map shown');
  await p.eval(`(() => { const st = WSDA.emergency.state.map; return new Promise(r => { st.map.resize(); st.map.once('idle', () => r(1)); setTimeout(() => r(2), 3000); }); })()`);
  const mark = await p.eval(`(() => { const st = WSDA.emergency.state.map, f = st.em.positives.features.find(x => x.properties.at);
    return f ? { mark: f.properties.mark, at: f.properties.at, shared: st.em.shared[f.properties.at], n: WSDA.emergency.state.mapData.shared } : null; })()`);
  check(!!(mark && mark.shared) && /^em-positive:[a-z+-]+:(now|past):(zones|none):2:/.test(mark.mark) && mark.n === 1 && mark.shared.head === '2 cases at this map point:'
    && mark.shared.lines.length === 2 && /^Yakima 11: detected .+, closed/.test(mark.shared.lines[0]) && /^Yakima 12: detected .+, active$/.test(mark.shared.lines[1]),
  'page2 map: Yakima 11 (closed) and 12 (active) at one point: the shown mark carries a badge with 2; the box names each, the earliest first, with its dates', mark);
  if (mark && mark.at) {
    const [lat, lon] = mark.at.split(',').map(Number);
    await p.eval(`(() => { const m = WSDA.emergency.state.map.map; m.jumpTo({ center: [${lon}, ${lat}], zoom: 11 }); return new Promise(r => { m.once('idle', () => r(1)); setTimeout(() => r(2), 3000); }); })()`);
    const at = await p.eval(`(() => { const m = WSDA.emergency.state.map.map, q = m.project([${lon}, ${lat}]), r = m.getContainer().getBoundingClientRect(); return { x: r.left + q.x, y: r.top + q.y }; })()`);
    await b.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at.x, y: at.y }, p.sid);
    await p.waitFor(`document.querySelector('.maplibregl-popup .tip-shared')`, 3000, 'hover box').catch(() => null);
    const tip = await p.eval(`(() => { const t = document.querySelector('.maplibregl-popup .tip-shared'); return { box: t ? t.textContent : '', label: WSDA.emergency.state.map.hoverLabel || '' }; })()`);
    check(tip.box.startsWith('2 cases at this map point:Yakima 11: detected') && tip.label.includes('2 cases at this map point:\nYakima 11: detected'),
      'page2 map: the mouse on the mark: its hover gains the gold-edged box naming both cases', tip);
    await shot('page2_map_hover');
  }
  await b.send('Emulation.setFocusEmulationEnabled', { enabled: false }, p.sid);
  fs.rmSync(DL, { recursive: true, force: true });
}

// ---- figures: 2.9, E2, the Report view's "Figures" (report-figures.js) driven as staff would ---------------------------
// The report scenario on Sep 1, 2026: the switch "Figures | Fill in", the tiles and the banner from the data only (a
// typed status that does not fit left out), the one date for both, each kind of hover under the real mouse (its words
// report.js's), a county and a month clicked to narrow the table and clicked again, the "×", Enter on a county, the map's
// "Places | Counties" and a county clicked on it, printing from Figures (the update's pages, never Figures), 320 pixels
// wide, Fill in again, a new load starting Figures again, and the Overview's link. Clicks and moves are the mouse's
// (Chrome's input events); a wait that runs out is a named failed check. Pictures in local-test-artifacts/em/report-figures/.
// 2.9: the guide "Making the HPAI update", linked from the form's opening line.
async function partGuide(b) {
  const p = b.page;
  await b.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }, p.sid);
  await p.goto(new URL('emergency/index.html', SITE).href);
  await p.waitFor('window.WSDA && WSDA.emergency && WSDA.emergency.state.map.ready', 20000, 'Emergency map ready');
  const v = await p.eval('WSDA.emergency.state.version');
  await p.setFiles('#files-input', [path.join(OUT, 'fixtures', 'em_rules_report.csv')]);
  await emReady(p, v);
  await p.eval(`document.getElementById('show-report').click()`);
  await p.eval('new Promise(r => setTimeout(r, 300))');
  const link = await p.eval(`(() => { const a = document.getElementById('rp-guide'); if (!a) return null; a.scrollIntoView({ block: 'center' });
    // Its first line's box: a link that wraps has an outline whose middle can fall between its lines.
    const r = a.getClientRects()[0]; return { text: a.textContent, href: a.href, target: a.target, rel: a.rel, shown: !!r && r.width > 0 && r.height > 0,
      x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  check(link && link.shown && link.text === 'Making the HPAI update' && link.href === new URL('emergency/making-the-update.html', SITE).href
    && link.target === '_blank' && link.rel === 'noopener',
  'guide: the form\'s opening line shows a link "Making the HPAI update", opening the guide in a new tab', link);
  // The link is the one under the pointer at its first line (a headless browser opens no tab from a file:// link, so
  // the guide is then opened in this tab, as the kinds part opens its how-to page).
  check(link && await p.eval(`(() => { const e = document.elementFromPoint(${link ? link.x : 0}, ${link ? link.y : 0}); return !!e && e.id === 'rp-guide'; })()`),
    'guide: nothing covers the link');
  await p.goto(new URL('emergency/making-the-update.html', SITE).href);
  const page = await p.eval(`(() => { const nav = [...document.querySelectorAll('nav a')];
    return { title: document.title, h1: document.querySelector('h1').textContent, scripts: document.scripts.length,
      sections: nav.length, lead: nav.every(a => a.getAttribute('href').startsWith('#') && document.getElementById(a.getAttribute('href').slice(1))),
      wide: document.documentElement.scrollWidth <= innerWidth }; })()`);
  check(same(page, { title: 'Making the HPAI update', h1: 'Making the HPAI update', scripts: 0, sections: 8, lead: true, wide: true }),
    'guide: it opens with no script; each of its 8 contents\' links leads to its section; nothing runs past 1280 pixels', page);
  await b.send('Emulation.setDeviceMetricsOverride', { width: 320, height: 800, deviceScaleFactor: 1, mobile: false }, p.sid);
  await p.eval('new Promise(r => setTimeout(r, 300))');
  const phone = await p.eval('document.documentElement.scrollWidth');
  check(phone <= 320, 'guide: at 320 pixels wide nothing runs past the screen', phone);
  await b.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }, p.sid);
}

async function partFigures(b) {
  const p = b.page, OUTF = path.join(OUT, 'report-figures');
  fs.rmSync(OUTF, { recursive: true, force: true });
  fs.mkdirSync(OUTF, { recursive: true });
  const shot = async name => fs.writeFileSync(path.join(OUTF, name + '.png'),
    Buffer.from((await b.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, p.sid)).data, 'base64'));
  const wait = async (expr, ms, name) => {
    try { await p.waitFor(expr, ms, name); return true; } catch (e) { check(false, 'figures: waited for ' + name); return false; }
  };
  await b.send('Emulation.setFocusEmulationEnabled', { enabled: true }, p.sid);
  await b.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }, p.sid);
  await p.goto(new URL('emergency/index.html', SITE).href);
  await p.waitFor('window.WSDA && WSDA.emergency && WSDA.emergency.state.map.ready', 20000, 'Emergency map ready');
  let v = await p.eval('WSDA.emergency.state.version');
  await p.setFiles('#files-input', [path.join(OUT, 'fixtures', 'em_rules_report.csv')]);
  await emReady(p, v);
  // The mouse on an element's middle (or a point inside it): a press and release, or a move only.
  const at = sel => p.eval(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({ block: 'center' });
    const r = e.getBoundingClientRect(); return { x: r.left + Math.min(r.width / 2, 30), y: r.top + r.height / 2 }; })()`);
  const mouse = async sel => {
    const pt = await at(sel);
    if (!pt) { check(false, 'figures: nothing to click at ' + sel); return; }
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
      await b.send('Input.dispatchMouseEvent', { type, x: pt.x, y: pt.y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 }, p.sid);
    }
    await p.eval('new Promise(r => setTimeout(r, 60))');
  };
  const TIP = `(() => { const t = document.querySelector('#rp-figures .rp-tipbox'), f = document.getElementById('rp-figures').getBoundingClientRect();
    if (t.hidden) return null; const r = t.getBoundingClientRect();
    return { text: t.innerText, inside: r.left >= f.left - 1 && r.right <= f.right + 1, w: Math.round(r.width), left: Math.round(r.left) }; })()`;
  const hoverOn = async sel => {
    const pt = await at(sel);
    if (!pt) { check(false, 'figures: nothing to hover at ' + sel); return null; }
    await b.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pt.x, y: pt.y }, p.sid);
    await p.eval('new Promise(r => setTimeout(r, 60))');
    return p.eval(TIP);
  };
  // A hover's words as the page writes them (report.js hover's head, text and lines).
  const said = js => p.eval(`(() => { const t = ${js}; return t.head + (t.text ? ': ' + t.text : '') + t.lines.map(l => '\\n' + l).join(''); })()`);
  const F = 'WSDA.emergencyReportFigures.last', RPJ = 'WSDA.emergencyReport';
  await mouse('#show-report');
  await wait(`!document.getElementById('view-report').hidden && WSDA.emergencyReportView.last`, 10000, 'Report shown');
  await p.eval(`(() => { const i = document.getElementById('rp-date'); i.value = '2026-09-01'; i.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await wait(`WSDA.emergencyReportView.last.figures.date === '2026-09-01'`, 5000, 'the report on Sep 1');
  const STATE = `(() => { const $ = id => document.getElementById(id), fig = $('rp-figures'), lay = document.querySelector('.rp-layout');
    return { fill: $('rp-show-fill').getAttribute('aria-pressed'), figures: $('rp-show-figures').getAttribute('aria-pressed'), shown: !fig.hidden && fig.getClientRects().length > 0,
      form: getComputedStyle(lay).visibility, pages: document.querySelectorAll('#rp-preview .rp-page').length }; })()`;
  check(same(await p.eval(STATE), { fill: 'true', figures: 'false', shown: false, form: 'visible', pages: 3 }),
    'figures: the Report view opens on Fill in, the form and the pages shown, Figures hidden', await p.eval(STATE));
  // A typed status that does not fit the data ("free" with two active flocks): the pages print it, Figures does not.
  await mouse('input[name="rp-status"][value="free"]');
  await wait(`/considered free/.test(document.querySelector('#rp-preview .rp-banner div span').textContent)`, 5000, 'the typed "free" on the pages');
  await mouse('#rp-show-figures');
  await wait(`${F} && !document.getElementById('rp-figures').hidden`, 5000, 'Figures shown');
  check(same(await p.eval(STATE), { fill: 'false', figures: 'true', shown: true, form: 'hidden', pages: 3 }),
    'figures: "Figures" pressed: Figures shown, the form and the pages out of sight but still drawn (3 pages)', await p.eval(STATE));
  const FIG = `(() => { const q = s => Array.from(document.querySelectorAll('#rp-fig-body ' + s)), t = s => (document.querySelector('#rp-fig-body ' + s) || {}).textContent || '';
    return { banner: t('.rp-banner b'), line: t('.rp-banner div span'), src: t('.rp-src'),
      tiles: q('.rp-tile').map(e => [e.querySelector('.l').textContent, e.querySelector('.v').textContent, (e.querySelector('.s') || {}).textContent || '']),
      counties: q('.rp-clist [data-county]').map(e => [e.dataset.county, e.querySelector('em').textContent, e.classList.contains('sel')]),
      heading: (document.querySelector('#rp-fig-table h3') || {}).firstChild ? document.querySelector('#rp-fig-table h3').firstChild.textContent : '',
      chip: t('#rp-fig-table .rp-chip'), count: t('#rp-fig-table h3 small'),
      rows: q('#rp-fig-table table.rp-dt tr').slice(1).map(r => Array.from(r.cells).map(c => c.textContent)),
      places: q('.rp-map .rp-place').length, active: q('.rp-map .rp-place[data-active]').length, shaded: q('.rp-map path[data-county]').length,
      zones: q('.rp-map .rp-zone').map(e => [e.getAttribute('stroke'), +e.getAttribute('r')]),
      months: q('.rp-chart .rp-hit').length, clickable: q('.rp-chart .rp-hit[tabindex]').length, picked: q('.rp-chart .rp-hit.sel').map(e => e.dataset.month),
      look: q('.rp-look [aria-pressed="true"]').map(e => e.dataset.look), date: document.getElementById('rp-fig-date').value }; })()`;
  let r = await p.eval(FIG);
  const printed = await p.eval(`Array.from(document.querySelectorAll('#rp-preview .rp-page')[0].querySelectorAll('.rp-tile')).map(e => [e.querySelector('.l').textContent,
    e.querySelector('.v').textContent, (e.querySelector('.s') || {}).textContent || ''])`);
  check(same(r.tiles, printed) && r.tiles.length === 6 && r.tiles[0][1] === '3',
    'figures: the six tiles are the printed page\'s, word for word', [r.tiles, printed]);
  check(r.banner === '3 active detections: 2 flocks · 1 dairy herd'
    && r.line === 'Washington has active detections of highly pathogenic avian influenza in domestic flocks. Last detection Aug 28, 2026, 4 days ago.'
    && r.src.startsWith('Source: WSDA HPAI table, as of September 1, 2026.') && r.date === '2026-09-01',
    'figures: only what the data says: the banner\'s line is the wording that fits (the typed "free" left out), the source line, the date', r);
  check(same(r.counties.map(c => [c[0], c[1]]), [['Franklin', '2'], ['King', '2'], ['Pierce', '2'], ['Snohomish', '2'], ['Yakima', '2'], ['Clark', '1'],
    ['Lewis', '1'], ['Thurston', '1'], ['Whatcom', '1'], ['Multnomah', '1'], ['county not given', '1']]) && r.counties.every(c => !c[2]),
    'figures: the cases by county as printed, nothing picked', r.counties);
  check(r.heading === '2026 detections' && r.chip === '' && r.rows.length === 6 && r.count === '6 of 6 · Small under 100 · Medium 100 to 999 · Large 1,000 or more'
    && r.places === 12 && r.active === 2 && r.shaded === 0 && r.months === 55 && r.clickable === 13 && same(r.look, ['places'])
    && r.zones.length === 4 && same(r.zones.map(z => z[0]), ['#fd8d3c', '#cb181d', '#fd8d3c', '#cb181d']) && Math.abs(r.zones[0][1] / r.zones[1][1] - 10 / 3) < 0.1,
    'figures: this year\'s 6 detections; the map on Places, 12 places (the two active crimson, each with its 10 and 3 km rings); 55 months, the 13 with detections clickable', r);
  await shot('figures_1280');
  // The hovers under the mouse, each with report.js's words, inside the frame.
  const W = `${RPJ}.wording(${F}.figures, WSDA.emergency.state.type, {}, 39)`;
  const hovers = [
    ['#rp-fig-body .rp-tile:nth-child(1)', `${RPJ}.hover.tile(${F}.figures, WSDA.emergency.state.type, ${W}, 0, 39)`, 'the "Active now" tile'],
    ['#rp-fig-body .rp-tile:nth-child(4)', `${RPJ}.hover.tile(${F}.figures, WSDA.emergency.state.type, ${W}, 3, 39)`, 'the birds affected tile'],
    ['#rp-fig-body .rp-tile:nth-child(6)', `${RPJ}.hover.tile(${F}.figures, WSDA.emergency.state.type, ${W}, 5, 39)`, 'the last tile (its hover turned back at the right edge)'],
    ['#rp-fig-counties [data-county="Franklin"]', `${RPJ}.hover.county(${F}.figures, ${F}.figures.counties[0], false)`, 'a county in the list'],
    ['.rp-hit[data-month="2026-08"]', `${RPJ}.hover.month(${F}.figures, ${F}.figures.byMonth.find(m => m.month === '2026-08'), false)`, 'a month'],
    ['[data-split="animals"]', `${RPJ}.hover.split(${F}.figures, WSDA.emergency.state.type, 'animals')`, 'the birds\' bar'],
    ['.rp-place[data-cases="2"]', `${RPJ}.hover.place(${RPJ}.places(${F}.figures).find(x => x.cases.length === 2))`, 'a place with two cases']];
  for (const [sel, js, name] of hovers) {
    const got = await hoverOn(sel), want = await said(js);
    check(got && got.text === want && got.inside, 'figures: the mouse on ' + name + ': one hover, its number and rule, inside the frame', [got, want]);
  }
  // By the right edge the box turns back to the pointer's left at its own width (not wrapped narrow against the edge).
  const edge = await hoverOn('#rp-fig-body .rp-tile:nth-child(6)'), mid = await hoverOn('#rp-fig-body .rp-tile:nth-child(1)');
  const tile6 = await at('#rp-fig-body .rp-tile:nth-child(6)');
  check(edge && mid && edge.w >= 200 && edge.left + edge.w < tile6.x, 'figures: the last tile\'s hover at its own width, to the left of the pointer', [edge, mid, tile6]);
  // The mouse on an empty part of Figures, then away from it: no hover.
  const gap = await p.eval(`(() => { const r = document.querySelector('#rp-fig-body .rp-panel').getBoundingClientRect(); return { x: r.left + 3, y: r.top + 3 }; })()`);
  await b.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: gap.x, y: gap.y }, p.sid);
  await p.eval('new Promise(r => setTimeout(r, 60))');
  check(await p.eval(TIP) === null, 'figures: the mouse on an empty part of Figures: no hover');
  await b.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 }, p.sid);
  await p.eval('new Promise(r => setTimeout(r, 60))');
  check(await p.eval(TIP) === null, 'figures: the mouse away: no hover');
  // A county clicked narrows the table; clicked again gives it back; the "×" too.
  await mouse('#rp-fig-counties [data-county="Franklin"]');
  r = await p.eval(FIG);
  check(r.chip === 'Franklin ×' && same(r.rows.map(x => x[0]), ['3/14/26', '8/20/26']) && r.count.startsWith('2 of 6 ·')
    && same(r.counties.filter(c => c[2]).map(c => c[0]), ['Franklin']) && same(await p.eval(`${F}.pick`), { county: 'Franklin' }),
    'figures: Franklin clicked: the table lists its 2 cases this year, "2 of 6", the chip, the row marked', r);
  await mouse('#rp-fig-counties [data-county="Franklin"]');
  r = await p.eval(FIG);
  check(r.chip === '' && r.rows.length === 6 && r.counties.every(c => !c[2]), 'figures: Franklin clicked again: every 2026 detection back', r.rows.length);
  await mouse('#rp-fig-counties [data-county="Yakima"]');
  await mouse('#rp-fig-table .rp-chip');
  r = await p.eval(FIG);
  check(r.chip === '' && r.rows.length === 6 && await p.eval(`${F}.pick`) === null, 'figures: a county picked, then its "×": every 2026 detection back', r);
  // A month clicked: its cases, whatever the year; again gives this year's back.
  await mouse('.rp-hit[data-month="2026-08"]');
  r = await p.eval(FIG);
  check(r.heading === 'Detections' && r.chip === 'August 2026 ×' && same(r.rows.map(x => x[1]), ['Franklin', 'Yakima', 'Thurston']) && same(r.picked, ['2026-08'])
    && r.count.startsWith('3 of 6 ·'), 'figures: August 2026 clicked: its 3 cases, the column shaded', r);
  await mouse('.rp-hit[data-month="2022-03"]');
  r = await p.eval(FIG);
  check(r.chip === 'March 2022 ×' && same(r.rows, [['3/10/22', 'King', 'Large', 'Commercial', 'Chicken', 'Released']]) && r.count.startsWith('1 ·'),
    'figures: March 2022 clicked: the month\'s one case, from another year (no "of")', r);
  await mouse('.rp-hit[data-month="2022-03"]');
  r = await p.eval(FIG);
  check(r.chip === '' && r.rows.length === 6 && r.picked.length === 0, 'figures: March 2022 clicked again: this year\'s back', r);
  await mouse('.rp-hit[data-month="2023-06"]');
  check((await p.eval(FIG)).chip === '' && await p.eval(`${F}.pick`) === null, 'figures: a month without detections: a click does nothing');
  // The keyboard: Enter on a county picks it, the focus stays on it and its hover says so.
  await p.eval(`document.querySelector('#rp-fig-counties [data-county="King"]').focus()`);
  for (const type of ['keyDown', 'keyUp']) await b.send('Input.dispatchKeyEvent', { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }, p.sid);
  await p.eval('new Promise(r => setTimeout(r, 60))');
  r = await p.eval(FIG);
  const kb = await p.eval(`({ on: (document.activeElement || {}).dataset ? document.activeElement.dataset.county : null })`), kTip = await p.eval(TIP);
  check(r.chip === 'King ×' && r.rows.length === 0 && kb.on === 'King' && kTip && /Listed below; click again to show every county\.$/.test(kTip.text),
    'figures: Enter on King: picked (none this year, said), the focus kept on it, its hover saying how to give it back', [r.chip, kb, kTip]);
  const none = await p.eval(`(document.querySelector('#rp-fig-table .rp-none') || {}).textContent`);
  check(none === 'No detections in 2026 in King so far.', 'figures: a county without detections this year says so', none);
  await mouse('#rp-fig-table .rp-chip');
  // The map's "Places | Counties": the counties shaded as printed; a click on one lists its cases.
  await mouse('.rp-look [data-look="counties"]');
  r = await p.eval(FIG);
  const fills = await p.eval(`Array.from(document.querySelectorAll('#rp-fig-body .rp-map path[data-county]')).map(e => [e.dataset.county, e.getAttribute('fill')]).sort()`);
  check(same(r.look, ['counties']) && r.places === 0 && r.shaded === 9 && same(fills, [['Clark', '#d2dee6'], ['Franklin', '#93b4cb'], ['King', '#93b4cb'], ['Lewis', '#d2dee6'],
    ['Pierce', '#93b4cb'], ['Snohomish', '#93b4cb'], ['Thurston', '#d2dee6'], ['Whatcom', '#d2dee6'], ['Yakima', '#93b4cb']]),
    'figures: Counties: the 9 counties with cases shaded in the printed steps (1; 2 to 3), no places', [r, fills]);
  await mouse('.rp-map path[data-county="Yakima"]');
  r = await p.eval(FIG);
  check(r.chip === 'Yakima ×' && same(r.rows.map(x => x[0]), ['8/25/26']) && same(r.counties.filter(c => c[2]).map(c => c[0]), ['Yakima']),
    'figures: Yakima clicked on the shaded map: listed as a click in the county list lists it', r);
  await shot('figures_counties');
  await mouse('.rp-map path[data-county="Yakima"]');
  await mouse('.rp-look [data-look="places"]');
  r = await p.eval(FIG);
  check(same(r.look, ['places']) && r.places === 12 && r.chip === '', 'figures: Places again: the 12 places', r);
  // The one date: Figures' date moves the form's and the pages', and back.
  await p.eval(`(() => { const i = document.getElementById('rp-fig-date'); i.focus(); i.value = '2026-08-01'; i.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await wait(`${F}.figures.date === '2026-08-01'`, 5000, 'Figures on Aug 1');
  const dates = await p.eval(`({ form: document.getElementById('rp-date').value, pages: WSDA.emergencyReportView.last.figures.date, banner: document.querySelector('#rp-fig-body .rp-banner b').textContent })`);
  check(same(dates, { form: '2026-08-01', pages: '2026-08-01', banner: '1 active detection: 1 premises with other animals; none in domestic flocks' }),
    'figures: Aug 1 typed in Figures\' date: the form\'s date and the pages follow; the goats alone active', dates);
  await p.eval(`(() => { const i = document.getElementById('rp-fig-date'); i.value = '2026-09-01'; i.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await wait(`${F}.figures.date === '2026-09-01'`, 5000, 'Figures on Sep 1 again');
  // Printing from Figures: the update's pages, never Figures (its real places among them).
  await b.send('Emulation.setEmulatedMedia', { media: 'print' }, p.sid);
  const pr = await p.eval(`(() => { const shown = s => Array.from(document.querySelectorAll(s)).filter(e => e.getClientRects().length).length;
    return { fig: shown('#rp-figures'), sw: shown('.rp-switch'), places: shown('.rp-place'), pages: shown('.rp-page'), w: document.querySelector('.rp-page').getBoundingClientRect().width }; })()`);
  const pdf = Buffer.from((await b.send('Page.printToPDF', { preferCSSPageSize: true, printBackground: true }, p.sid)).data, 'base64');
  await b.send('Emulation.setEmulatedMedia', { media: '' }, p.sid);
  const pdfPages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
  fs.writeFileSync(path.join(OUTF, 'printed_from_figures.pdf'), pdf);
  check(same(pr, { fig: 0, sw: 0, places: 0, pages: 3, w: 816 }) && pdfPages === 3,
    'figures: printed from Figures: only the update\'s 3 pages, at their own size; no Figures, no switch, no real place', [pr, pdfPages]);
  // 320 pixels wide: nothing wider than the screen, tiles two by two, the month chart scrolled to its latest months.
  await b.send('Emulation.setDeviceMetricsOverride', { width: 320, height: 800, deviceScaleFactor: 2, mobile: true }, p.sid);
  await p.eval('new Promise(r => setTimeout(r, 400))');
  const ph = await p.eval(`(() => { const s = document.querySelector('#rp-fig-body .rp-fig-scroll'), t = Array.from(document.querySelectorAll('#rp-fig-body .rp-tile')).map(e => Math.round(e.getBoundingClientRect().top));
    const cells = Array.from(document.querySelectorAll('#rp-fig-table tr:first-child th')).filter(c => c.getClientRects().length).map(c => c.textContent);
    const panel = document.getElementById('rp-fig-table');
    return { wide: document.documentElement.scrollWidth, rows: new Set(t).size, end: s.scrollWidth > s.clientWidth && s.scrollLeft + s.clientWidth >= s.scrollWidth - 2, cells,
      fits: panel.scrollWidth <= panel.clientWidth }; })()`);
  check(ph.wide <= 320 && ph.rows === 3 && ph.end && same(ph.cells, ['Confirmed', 'County', 'Flock type', 'Status']) && ph.fits,
    'figures: 320 pixels wide: no sideways scrolling, the tiles two by two, the month chart scrolling inside its frame from its latest months, the table without Flock size and Animals, inside its panel', ph);
  await shot('figures_320');
  await b.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }, p.sid);
  await p.eval('new Promise(r => setTimeout(r, 300))');
  // Fill in again: the form and the pages at their place, fitted to the column.
  await mouse('#rp-show-fill');
  const back = await p.eval(`(() => { const b = document.getElementById('rp-preview'); return { st: ${STATE}, h: b.offsetHeight, scale: getComputedStyle(b.querySelector('.rp-sheets')).transform }; })()`);
  check(same(back.st, { fill: 'true', figures: 'false', shown: false, form: 'visible', pages: 3 }) && back.h > 500 && back.scale !== 'none',
    'figures: "Fill in" pressed: the form and the pages back, fitted to the column', back);
  // A new load starts Figures again (nothing picked, Places), opening on the Map.
  await mouse('#rp-show-figures');
  await mouse('#rp-fig-counties [data-county="Pierce"]');
  await mouse('.rp-look [data-look="counties"]');
  v = await p.eval('WSDA.emergency.state.version');
  await p.setFiles('#files-input', [path.join(OUT, 'fixtures', 'em_rules_report.csv')]);
  await emReady(p, v);
  check(await p.eval(`WSDA.emergency.state.view === 'map'`), 'figures: a new load opens on the Map');
  await mouse('#show-report');
  await p.eval(`(() => { const i = document.getElementById('rp-fig-date'); i.value = '2026-09-01'; i.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await wait(`${F}.figures.date === '2026-09-01' && !document.getElementById('rp-figures').hidden`, 5000, 'Figures after the new load');
  r = await p.eval(FIG);
  check(r.chip === '' && same(r.look, ['places']) && r.places === 12, 'figures: after the new load nothing is picked and the map is on Places', r);
  // The Overview's link opens the Report view on Figures.
  await mouse('#rp-show-fill');
  await mouse('#show-overview');
  const link = await p.eval(`(() => { const a = document.getElementById('ov-to-figures'); return { shown: !a.hidden && a.getClientRects().length > 0, words: a.textContent }; })()`);
  check(same(link, { shown: true, words: 'The update\'s figures: Report' }), 'figures: the Overview\'s link "The update\'s figures: Report"', link);
  await mouse('#ov-to-figures');
  check(same(await p.eval(`({ view: WSDA.emergency.state.view, fig: !document.getElementById('rp-figures').hidden, pressed: document.getElementById('rp-show-figures').getAttribute('aria-pressed') })`),
    { view: 'report', fig: true, pressed: 'true' }), 'figures: the Overview\'s link opens the Report view on Figures');
  await mouse('#rp-show-fill');
  await b.send('Emulation.setFocusEmulationEnabled', { enabled: false }, p.sid);
}

async function partKinds(b) {
  const p = b.page, S = 'WSDA.emergency.state', R = 'WSDA.emergencyRules';
  const species = path.join(TABLES, 'em_rules_species.csv');
  const press = async sel => {
    // A control that is not there is left (its check then fails), so the part goes on to the end.
    const q = await p.eval(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({ block: 'nearest' });
      const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
    if (!q) return;
    for (const type of ['mousePressed', 'mouseReleased']) {
      await b.send('Input.dispatchMouseEvent', { type, x: q.x, y: q.y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 }, p.sid);
    }
    await sleep(400);
    await p.waitFor(`!${S}.loading`, 15000, 'redrawn after a click');
  };
  const open = async (url, files) => {
    await p.goto(url);
    await p.waitFor('window.WSDA && WSDA.emergency && WSDA.emergency.state.map.ready', 20000, 'Emergency map ready');
    if (!files) return;
    await p.setFiles('#files-input', files);
    await emReady(p);
    await p.eval(`document.getElementById('positives-fold').open = true; true`);
  };
  const notice = () => p.eval(`(() => { const n = document.getElementById('em-type-problems');
    return { hidden: n.hidden, lines: [...n.querySelectorAll('p')].map(x => x.textContent), red: n.classList.contains('err'),
      types: [...document.querySelectorAll('#em-type option')].map(o => o.value) }; })()`);
  const tipState = () => p.eval(`(() => { const t = document.querySelector('#em-box-lines button.tip'), n = document.getElementById('help-em-unlisted');
    const line = t && t.previousElementSibling;
    return { tip: !!t, after: line ? line.textContent : null, expanded: t ? t.getAttribute('aria-expanded') : null,
      note: n.hidden ? null : n.textContent, shown: n.getClientRects().length > 0 }; })()`);

  // ---- The page as it is: no notice; the "?" after the unlisted line opens and closes its note ------------------
  await open(new URL('emergency/index.html', SITE).href, [species]);
  const plain = await notice(), closedTip = await tipState();
  check(plain.hidden && plain.types.includes('hpai') && closedTip.tip && closedTip.expanded === 'false' && closedTip.note === null
    && closedTip.after === '2 positives with a species not listed: Bobcat, Opossum',
  'kinds: no red notice with every type file read; a "?" right after the line naming the species not listed, its note closed', [plain, closedTip]);
  await press('#em-box-lines button.tip');
  const openTip = await tipState();
  const howLink = await p.eval(`(() => { const a = document.querySelector('#help-em-unlisted a'); return a ? [a.textContent, a.href, a.target] : null; })()`);
  check(openTip.expanded === 'true' && openTip.shown && openTip.note === 'A species no kind of animal names counts under the last kind. To give it a'
    + ' word or a kind of its own, see Changing the kinds of animals (also as CHANGING_THE_KINDS_OF_ANIMALS.txt in site/emergency).'
    && howLink && howLink[0] === 'Changing the kinds of animals' && howLink[1] === new URL('emergency/changing-kinds.html', SITE).href && howLink[2] === '_blank',
  'kinds: the "?" opens its note, linking the how-to page (in a new tab) and naming its plain-text twin', [openTip, howLink]);
  // Other animals unticked: the line and its note go; ticked again: the line is back with its note closed.
  await press('#em-animals input[value="other"]');
  const gone = await tipState();
  await press('#em-animals input[value="other"]');
  const back = await tipState();
  check(!gone.tip && gone.note === null && back.tip && back.expanded === 'false' && back.note === null,
    'kinds: with Other animals unticked the line and its note go; ticked again, the line is back with its note closed', [gone, back]);
  await press('#em-box-lines button.tip');
  await press('#em-box-lines button.tip');
  check((await tipState()).note === null, 'kinds: the "?" again closes the note');

  // ---- The how-to page: it opens with no error, its Copy buttons copy -------------------------------------------
  await p.goto(new URL('emergency/changing-kinds.html', SITE).href);
  const page = await p.eval(`(async () => { const b = [...document.querySelectorAll('.paste .copy')]; if (b[0]) b[0].click();
    await new Promise(r => setTimeout(r, 200));
    return { title: document.title, copies: b.length, pastes: document.querySelectorAll('.paste').length, after: b[0] ? b[0].textContent : null,
      back: document.querySelector('header a').getAttribute('href'), wide: document.documentElement.scrollWidth <= innerWidth }; })()`);
  check(same(page, { title: 'Changing the kinds of animals', copies: 8, pastes: 8, after: 'Copied', back: 'index.html', wide: true }),
    'kinds: the how-to page opens from the "?", a Copy button beside each of its 8 lines, a click copies, a link back to the dashboard', page);

  // ---- The how-to's worked example, on a copy of the site --------------------------------------------------------
  const html = fs.readFileSync(path.join(ROOT, 'site', 'emergency', 'changing-kinds.html'), 'utf8');
  const blocks = [...html.matchAll(/<div class="paste[^"]*"><span class="label">[^<]*<\/span><code>([^<]*)<\/code><\/div>/g)].map(m => m[1].trim());
  const cattle = blocks.find(x => /key: 'cattle'/.test(x)), pasted = blocks.find(x => /key: 'mink'/.test(x));
  const COPY = path.join(OUT, 'kinds', 'site'), HPAI = path.join(COPY, 'emergency', 'types', 'hpai.js');
  fs.rmSync(path.dirname(COPY), { recursive: true, force: true });
  fs.cpSync(path.join(ROOT, 'site'), COPY, { recursive: true });
  const original = fs.readFileSync(HPAI, 'utf8');
  const indent = /\n( *)\{ key: 'cattle'/.exec(original)[1];
  // Step 1, the line pasted under the cattle kind's line (the line that starts with the text the how-to gives); step 2,
  // "mink" taken out of Other animals (before the paste, so the new line's own "'mink', " stays).
  const step1 = (from, line) => {
    const end = from.indexOf('\n', from.indexOf(cattle));
    return from.slice(0, end) + '\n' + indent + line + from.slice(end);
  };
  const example = step1(original.replace("'equine', 'mink', ", "'equine', "), pasted);
  check(original.includes(cattle) && original.includes("'equine', 'mink', ") && example.includes(indent + pasted)
    && example.match(/'mink'/g).length === 2, 'kinds: the how-to\'s lines found in hpai.js and its two steps applied to the copy', blocks);
  const copyUrl = pathToFileURL(path.join(COPY, 'emergency', 'index.html')).href;
  fs.writeFileSync(HPAI, example);
  await open(copyUrl, [species]);
  const made = await p.eval(`(() => { const s = ${S};
    return { kinds: ${R}.animalKindsOf(s.readAll).map(k => k.label + ' ' + k.shape),
      ticks: [...document.querySelectorAll('#em-animals label')].map(l => l.textContent),
      legend: document.getElementById('em-legend') ? document.getElementById('em-legend').textContent : '',
      notice: document.getElementById('em-type-problems').hidden }; })()`);
  check(made.notice && same(made.kinds, ['Birds circle', 'Cattle square', 'Mink triangle', 'Other animals diamond'])
    && same(made.ticks, ['Birds (7)', 'Cattle (3)', 'Mink (1)', 'Other animals (12)']) && /Mink/.test(made.legend),
  'kinds: the how-to\'s example followed: four ticks, Mink with the triangle and Other animals moved to the diamond, Mink in the legend, no notice', made);

  // ---- Two slips: "mink" left in Other animals, and quotes made curly -------------------------------------------
  const before = b.log.exceptions.length;
  fs.writeFileSync(HPAI, step1(original, pasted));
  await open(copyUrl);
  const twice = await notice();
  fs.writeFileSync(HPAI, step1(original, pasted.replace(/'mink'/g, '‘mink’')));
  await open(copyUrl);
  const curly = await notice();
  const pointer = 'Changing the kinds of animals (also as CHANGING_THE_KINDS_OF_ANIMALS.txt in site/emergency) says how to find and fix it.';
  check(!twice.hidden && twice.red && same(twice.lines, ['The emergency type file "types/hpai.js" was not used. Emergency type "hpai": "kinds[3].words"'
    + ' should be words no earlier kind has ("mink" is in kinds[2], "Mink", too).', pointer]) && same(twice.types, ['nws']),
  'kinds: "mink" left in Other animals too: the red notice names the file and the field, and the type picker has no HPAI', twice);
  check(!curly.hidden && same(curly.lines, ['The emergency type file "types/hpai.js" could not be read: a typing slip in it, such as quotes made'
    + ' curly or a missing comma or bracket, or the file is missing.', pointer]) && same(curly.types, ['nws']),
  'kinds: quotes made curly: the red notice says the file could not be read', curly);
  // Every type file broken (screwworm's with curly quotes too): both named, and a file loaded says no type was read.
  const NWS = path.join(COPY, 'emergency', 'types', 'nws.js'), nwsOriginal = fs.readFileSync(NWS, 'utf8');
  fs.writeFileSync(HPAI, step1(original, pasted));
  fs.writeFileSync(NWS, nwsOriginal.replace("id: 'nws'", 'id: ‘nws’'));
  // With no type the map is never made, so the page is ready when its notice shows.
  await p.goto(copyUrl);
  await p.waitFor(`!document.getElementById('em-type-problems').hidden`, 8000, 'the red notice').catch(() => null);
  const none = await notice();
  await p.setFiles('#files-input', [species]);
  await p.waitFor(`/could not be applied/.test(document.getElementById('load-status').textContent)`, 15000, 'the load refused').catch(() => null);
  const noneLoad = await p.eval(`document.getElementById('load-status').textContent`);
  check(none.lines.length === 3 && /"types\/hpai\.js" was not used/.test(none.lines[0]) && /"types\/nws\.js" could not be read/.test(none.lines[1])
    && same(none.types, []) && noneLoad === 'The files could not be applied: no emergency type could be read (see the red notice above).',
  'kinds: every type file broken: the notice names both, and a file loaded says no emergency type could be read', [none, noneLoad]);
  // The slips' own errors (the type refused, the file's syntax; Chrome reports each one twice) are what the notice
  // reports, not the page's.
  const slips = b.log.exceptions.splice(before), refused = /^Uncaught TypeError: Emergency type "hpai": "kinds\[3\]\.words"/;
  check(slips.length && slips.every(x => refused.test(x) || /^Uncaught SyntaxError: Invalid or unexpected token$/.test(x)
    || /^Uncaught TypeError: Cannot read properties of undefined \(reading 'id'\)$/.test(x))
    && slips.some(x => refused.test(x)) && slips.some(x => /SyntaxError/.test(x)),
    'kinds: the only errors on the slip pages are the type files\' own (and, with no type left, the page\'s start stopping on the missing type)', slips);
  fs.rmSync(path.dirname(COPY), { recursive: true, force: true });
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
      else if (part === 'layers') await partLayers(b);
      else if (part === 'cvifilter') await partCviFilter(b);
      else if (part === 'byanimal') await partByAnimal(b);
      else if (part === 'kinds') await partKinds(b);
      else if (part === 'report') await partReport(b);
      else if (part === 'form') await partForm(b);
      else if (part === 'page2') await partPage2(b);
      else if (part === 'figures') await partFigures(b);
      else if (part === 'guide') await partGuide(b);
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
  // So is the kinds part's copy of the site.
  const KINDS_COPY = pathToFileURL(path.join(OUT, 'kinds')).href;
  const outside = b.log.requests.filter(u => !u.startsWith(SITE) && !u.startsWith(BOARDS_URL) && !u.startsWith(BEFORE) && !u.startsWith(KINDS_COPY)
    && !/^(data|blob|about):/.test(u));
  check(outside.length === 0, 'no request outside the site', outside.slice(0, 5));
  await b.close();
  Object.assign(run, { passed, failed, failures });
  fs.writeFileSync(path.join(OUT, 'browser_' + (PAGE.startsWith('file:') ? 'file' : 'http') + '.json'),
    JSON.stringify(run, null, 2) + '\n');
  for (const f of failures) console.log('  FAIL ' + f.name + (f.detail !== undefined ? ' :: ' + JSON.stringify(f.detail).slice(0, 500) : ''));
  console.log(`Emergency Chrome (${PARTS.join(' ')}, ${PAGE.startsWith('file:') ? 'file://' : 'http'}): ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
