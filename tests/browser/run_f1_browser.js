#!/usr/bin/env node
'use strict';
// F1 browser test: opens site/index.html over file:// in the installed Google Chrome (headless, throw-away profile)
// under the page's own Content Security Policy, and loads the synthetic bundles through the real
// controls: multi-file selection, folder selection and drag-and-drop. Every extracted file is checked against its
// source (CRC-32 computed outside the page); damaged inputs must give plain messages; no request may leave the machine.
// Every case of the hand-written checklist oracle (tiers and negative cases) is loaded through the page and its
// recognition, bundle.json banner, checklist panel and feature gating compared with the oracle; the conflict chooser
// and the "which layer is this file?" picker are used through their dropdowns.
// Usage (repository root): node tests/node/run_f1_unit_tests.js && node tests/browser/run_f1_browser.js
// (the unit tests generate local-test-artifacts/f1/checkpoint/, tiers/ and negative/). Node >= 22; Chrome installed; no packages.
// Optional: CHROME_BIN=<path to chrome>; F1_PAGE_URL=<another copy of the page, e.g. http(s)>; F1_TRACE=1 prints each
// checklist run, and the page state if the run aborts.
// The "What data does this need?" section, its links, and the sample bundle download (saved by Chrome into
// local-test-artifacts/f1/download/ and compared byte for byte with the one tests/synthetic/make_bundles.js writes with
// the page's own code), then loaded back through the page; screenshots of the guide in local-test-artifacts/f1/guide/.
// AB (all-in-one bundle): section 9, readiness on every card, direct open, release fields, the
// guide's all-in-one part and its download; also writes local-test-artifacts/ab/fixtures/ and ab/shots/.
// Writes only local-test-artifacts/f1/browser_run.json, handoff/bad_master_crc.zip, download/ and guide/ (+ a temporary
// profile there, deleted on exit).
const { spawn } = require('child_process');
const fs = require('fs'), path = require('path');
const { pathToFileURL, fileURLToPath } = require('url');
const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join(ROOT, 'local-test-artifacts', 'f1');
const CP = path.join(OUT, 'checkpoint');
const PAGE = process.env.F1_PAGE_URL || pathToFileURL(path.join(ROOT, 'site', 'index.html')).href;
const PAGE_ORIGIN = /^https?:/.test(PAGE) ? new URL(PAGE).origin : null;
// The site's own folder (the landing page's folder): every request must stay inside it, not merely on its origin,
// which on GitHub Pages is shared with other sites.
const SITE_BASE = new URL('.', PAGE).href;
const PAGE_LABEL = /^file:/.test(PAGE) ? path.relative(ROOT, fileURLToPath(PAGE)).split(path.sep).join('/') + ' (file://)' : PAGE.split(/[?#]/)[0];
const CHROME = process.env.CHROME_BIN || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  : process.platform === 'win32' ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : 'google-chrome');
const sleep = ms => new Promise(r => setTimeout(r, ms));
require(path.join(ROOT, 'site', 'shared', 'zip.js'));
const crc32 = globalThis.WSDA.zip.crc32;

// ---- minimal DevTools Protocol driver (as in run_s1_browser.js, plus drag-and-drop) ------------------------------
async function launch() {
  fs.mkdirSync(OUT, { recursive: true });
  // profiles left by an earlier run that was stopped before its clean-up
  for (const d of fs.readdirSync(OUT)) if (d.startsWith('chrome-profile-')) fs.rmSync(path.join(OUT, d), { recursive: true, force: true });
  const profile = fs.mkdtempSync(path.join(OUT, 'chrome-profile-'));
  const proc = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + profile, '--no-first-run',
    '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', '--disable-component-update',
    '--disable-sync', '--window-size=1200,900', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'], detached: true });
  // Chrome leads its own process group: closing ends the whole group (helpers included), also when this script stops early
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
  const log = { requests: [], exceptions: [], csp: [] };
  // Every tab's requests, exceptions and CSP reports go into the same log (the CVI map opens in its own tab).
  const watch = sid => listeners.push(m => {
    if (m.sessionId !== sid) return;
    if (m.method === 'Network.requestWillBeSent') log.requests.push(m.params.request.url);
    else if (m.method === 'Runtime.exceptionThrown') log.exceptions.push((m.params.exceptionDetails.exception || {}).description || m.params.exceptionDetails.text);
    else if (m.method === 'Log.entryAdded' && /content security policy|refused to/i.test(m.params.entry.text)) log.csp.push(m.params.entry.text);
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
    const s2 = m.params.sessionId; watch(s2);
    for (const d of DOMAINS) await send(d, {}, s2);
    await send('Runtime.runIfWaitingForDebugger', {}, s2);
    opened.push({ targetId: m.params.targetInfo.targetId, page: makePage(s2) });
  });
  await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
  const page = makePage(sid);
  function makePage(sid) { const page = {
    sid,
    async goto(url) { const loaded = new Promise(res => { const h = m => { if (m.method === 'Page.loadEventFired' && m.sessionId === sid) { listeners.splice(listeners.indexOf(h), 1); res(); } }; listeners.push(h); }); await send('Page.navigate', { url }, sid); await Promise.race([loaded, sleep(15000)]); },
    async eval(expr) { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }, sid); if (r.exceptionDetails) throw new Error('eval: ' + ((r.exceptionDetails.exception || {}).description || r.exceptionDetails.text)); return r.result.value; },
    async waitFor(expr, ms, label) { const t0 = Date.now(); while (Date.now() - t0 < (ms || 15000)) { try { const v = await page.eval(expr); if (v) return v; } catch (e) { /* not ready */ } await sleep(50); } throw new Error('timeout: ' + (label || expr)); },
    async setFiles(sel, files) { const { root } = await send('DOM.getDocument', { depth: 1 }, sid); const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector: sel }, sid); await send('DOM.setFileInputFiles', { files, nodeId }, sid); },
    async drop(sel, files) {
      const box = await page.eval(`(function(){var el=document.querySelector(${JSON.stringify(sel)});el.scrollIntoView({block:'center'});var r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
      const data = { items: [], files, dragOperationsMask: 1 };
      for (const type of ['dragEnter', 'dragOver', 'drop']) await send('Input.dispatchDragEvent', { type, x: box.x, y: box.y, data }, sid);
    },
    async front() { await send('Page.bringToFront', {}, sid); },   // the user switches to this tab
    async click(expr) { await send('Runtime.evaluate', { expression: expr, userGesture: true }, sid); },   // as a user's click (pop-ups allowed)
    async key(k, code, text) { for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', Object.assign({ type, key: k, code: k, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code }, type === 'keyDown' && text ? { text } : {}), sid); },   // a real key press
    async reload() { const loaded = new Promise(res => { const h = m => { if (m.method === 'Page.loadEventFired' && m.sessionId === sid) { listeners.splice(listeners.indexOf(h), 1); res(); } }; listeners.push(h); }); await send('Page.reload', {}, sid); await Promise.race([loaded, sleep(15000)]); }
  }; return page; }
  const pages = async re => (await send('Target.getTargets')).targetInfos.filter(t => t.type === 'page' && re.test(t.url));
  async function newTab(url) { const n = opened.length; await send('Target.createTarget', { url }); return waitTab(n); }
  async function waitTab(n) { for (let i = 0; i < 300 && opened.length <= n; i++) await sleep(50); if (opened.length <= n) throw new Error('no new tab'); return opened[n]; }
  const closeTab = targetId => send('Target.closeTarget', { targetId });
  return { version: ver.Browser, log, page, opened, pages, newTab, waitTab, closeTab, send, listeners, async close() { try { await send('Browser.close'); } catch (e) { /* closing */ } await exited(5000); killGroup(); await exited(2000); fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } };
}

// ---- checks ---------------------------------------------------------------------------------------------------
let pass = 0, fail = 0; const failures = [], notes = [];
// F1_TRACE=1 prints each check as it is made, with the seconds since the start (to see where a slow run is).
const T0 = Date.now();
const check = (ok, name, detail) => {
  if (process.env.F1_TRACE) console.log(Math.round((Date.now() - T0) / 1000) + ' s ' + (ok ? 'ok   ' : 'FAIL ') + name.slice(0, 100));
  if (ok) pass++; else { fail++; failures.push(name + (detail !== undefined ? ' :: ' + JSON.stringify(detail).slice(0, 600) : '')); }
};
const crcOf = f => crc32(fs.readFileSync(f));
const SMALL = crcOf(path.join(ROOT, 'tests', 'synthetic', 'cvi_master_small.csv')), WA = crcOf(path.join(ROOT, 'tests', 'synthetic', 'cvi_master_wa39.csv'));
const cp = f => path.join(CP, f);
// Expected checksums computed here from the generator's sources, independently of the page's ZIP reader.
const gen = require(path.join(ROOT, 'tests', 'synthetic', 'make_bundles.js'));
const BUNDLE = gen.crc32(gen.CHECKPOINT_BUNDLE_JSON);
const LARGE_BYTES = gen.largeCsv(fs.readFileSync(path.join(ROOT, 'tests', 'synthetic', 'cvi_master_wa39.csv')), 400), LARGE = gen.crc32(LARGE_BYTES);

// Reads every received file inside the page and returns its CRC, so content is verified end to end.
const SNAPSHOT = `(async function(){var r=WSDA.landing.state.result,s=document.getElementById('load-status');
  if(!r) return {status:s.textContent, cls:s.className, items:[], ignored:[], errors:[]};
  var items=[]; for (var i of r.items) { var o={path:i.path,source:i.source,size:i.size};
    try { var t0=performance.now(), b=await i.read(); o.crc=WSDA.zip.crc32(b); o.bytes=b.length; o.ms=Math.round(performance.now()-t0); } catch(e) { o.readError=e.message; }
    items.push(o); }
  return {status:s.textContent, cls:s.className, items:items, ignored:r.ignored, errors:r.errors, sources:r.sources,
    rows:document.querySelectorAll('#items-table tbody tr').length, skippedRows:document.querySelectorAll('#ignored-table tbody tr').length};})()`;

(async () => {
  if (!fs.existsSync(cp('deflate.zip'))) { console.error('Run node tests/node/run_f1_unit_tests.js first (generates the test fixtures).'); process.exit(2); }
  const b = await launch(); const p = b.page;
  const run = { chrome: b.version, platform: process.platform, page: PAGE_LABEL, started: new Date().toISOString(), timings: {} };
  const version = () => p.eval('WSDA.landing.state.version');
  const settle = async (v0, ms) => { await p.waitFor('!WSDA.landing.state.loading && WSDA.landing.state.version > ' + v0, ms || 15000, 'load'); return p.eval(SNAPSHOT); };
  const pick = async (sel, files, ms) => { const v0 = await version(); await p.setFiles(sel, files); return settle(v0, ms); };
  const byPath = (snap, re) => snap.items.find(i => re.test(i.path));
  try {
    // 1. Page, CSP and browser capabilities
    await p.goto(PAGE);
    await p.waitFor('window.WSDA && WSDA.landing && WSDA.zip && WSDA.load', 10000, 'page ready');
    const env = await p.eval(`(function(){var ok=false;try{new DecompressionStream('deflate-raw');ok=true}catch(e){}
      return {deflateRaw:ok, webkitdirectory:'webkitdirectory' in document.createElement('input'), secure:window.isSecureContext,
        csp:document.querySelector('meta[http-equiv="Content-Security-Policy"]').content}})()`);
    run.env = env;
    check(env.deflateRaw, 'DecompressionStream("deflate-raw") available under the CSP');
    check(env.webkitdirectory, 'folder selection (webkitdirectory) supported');
    check(/connect-src 'none'/.test(env.csp) && /default-src 'none'/.test(env.csp), 'page CSP blocks network connections');
    check(/No data loaded/.test(await p.eval('document.getElementById("load-status").textContent')), 'initial status');
    // Profile cards; no next step before any files are loaded
    const cards = await p.eval(`Array.from(document.querySelectorAll('#profiles .card')).map(c=>({id:c.getAttribute('data-profile'), h:c.querySelector('h3').textContent,
      button:(c.querySelector('button[data-open]')||{}).textContent||null, soon:(c.querySelector('.soon-badge')||{}).textContent||null}))`);
    check(cards.length === 3 && cards[0].id === 'cvi' && cards[0].h === 'CVI Traceability' && cards[0].button === 'Open the CVI map' && !cards[0].soon
      && cards[1].id === 'emergency' && cards[1].h === 'Emergency Response' && cards[1].button === null && cards[1].soon === 'In preparation' && cards[2].id === 'infrastructure' && cards[2].button === 'Open Infrastructure' && !cards[2].soon, 'cards: CVI available, Emergency in preparation', cards);
    check(await p.eval('document.getElementById("next-step").hidden'), 'next step hidden before any files are loaded');
    // Version 1.1: before any files are loaded each card says to load them first, and a dashboard opened then says
    // at once that nothing was loaded (not after the 10-second wait). Each tab is closed again, so the later clicks
    // open new ones.
    const firstLines = await p.eval(`Array.from(document.querySelectorAll('#profiles .card-ready')).map(e => e.hidden ? null : e.textContent)`);
    check(firstLines.length === 2 && firstLines.every(t => t === 'Load your data below first.'), 'cards before any files: "Load your data below first."', firstLines);
    for (const [id, file, status] of [['cvi', /\/cvi\/index\.html/, 'master-status'], ['infrastructure', /\/infrastructure\/index\.html/, 'load-status']]) {
      const n = b.opened.length, t0 = Date.now();
      await p.click(`document.querySelector('#profiles button[data-open="${id}"]').click()`);
      const t = await b.waitTab(n);
      const said = await t.page.waitFor(`/Nothing has been loaded on the landing page yet/.test((document.getElementById('${status}') || {}).textContent || '')`, 5000, id + ' empty notice').then(() => true, () => false);
      const text = await t.page.eval(`(document.getElementById('${status}') || {}).textContent`);
      check(said && Date.now() - t0 < 8000 && file.test(await t.page.eval('location.pathname')), id + ' opened before any files: says at once that nothing was loaded', text);
      await b.closeTab(t.targetId);
    }

    // 2. Multi-file selection: ZIPs (deflate, stored, Finder style, real tools) and loose files
    let s = await pick('#files-input', [cp('deflate.zip')]);
    check(s.items.length === 3 && s.rows === 3 && s.cls === 'status ok', 'deflate ZIP: 3 files listed', s);
    check(byPath(s, /small\.csv$/).crc === SMALL && byPath(s, /wa39\.csv$/).crc === WA && byPath(s, /bundle\.json$/).crc === BUNDLE, 'deflate ZIP: all 3 files match their sources (CRC-32)');
    check(s.items.every(i => i.source === 'zip'), 'deflate ZIP: source recorded');
    s = await pick('#files-input', [cp('stored.zip'), path.join(ROOT, 'tests', 'synthetic', 'cvi_master_small.csv'), path.join(ROOT, 'tests', 'synthetic', 'cvi_master_wa39.csv')]);
    check(s.items.length === 4 && s.items.filter(i => i.source === 'files').length === 2, 'stored ZIP plus two loose CSVs in one selection', s.items);
    check(s.items.every(i => i.crc === (/small/.test(i.path) ? SMALL : WA)), 'stored ZIP and loose files: contents byte-identical', s.items);
    s = await pick('#files-input', [cp('finder_style.zip')]);
    check(s.items.length === 2 && s.skippedRows === 2 && s.items.some(i => /Données – petit\.csv$/.test(i.path)), 'Finder-style ZIP: UTF-8 name, metadata skipped', s);
    check(byPath(s, /petit\.csv$/).crc === SMALL && byPath(s, /wa39\.csv$/).crc === WA, 'Finder-style ZIP (data descriptors): contents byte-identical');
    for (const f of ['zip_cli.zip', 'ditto_finder.zip']) {
      if (!fs.existsSync(cp(path.join('tools', f)))) { if (process.platform === 'darwin') check(false, f + ' missing; run the unit tests first'); else notes.push(f + ' not present (non-macOS run)'); continue; }
      s = await pick('#files-input', [cp(path.join('tools', f))]);
      check(s.items.length === 2 && byPath(s, /wa39\.csv$/).crc === WA && byPath(s, /small\.csv$/).crc === SMALL, f + ' (macOS tool): 2 CSVs byte-identical', s.items);
      check(s.ignored.some(x => /ZIP inside a ZIP/.test(x.reason)), f + ': nested ZIP skipped with reason');
    }
    const t0 = Date.now();
    s = await pick('#files-input', [cp('large_deflate.zip')], 120000);
    run.timings.large_zip_list_and_read_ms = Date.now() - t0;
    run.timings.large_entry_inflate_ms = s.items[0] && s.items[0].ms;
    run.timings.large_entry_bytes = s.items[0] && s.items[0].bytes;
    check(s.items.length === 1 && s.items[0].bytes === LARGE_BYTES.length && s.items[0].crc === LARGE && !s.items[0].readError, '~58 MB deflate entry matches its source (length and CRC-32 computed outside the page)', s.items);

    // 3. Folder selection
    s = await pick('#folder-input', [cp(path.join('folder', 'CVI data'))]);
    run.folderSelectionPaths = s.items.map(i => i.path);
    check(s.items.length === 4, 'folder: 2 CSVs + 2 from the ZIP inside', s.items.map(i => i.path));
    check(byPath(s, /^CVI data\/cvi_master_wa39\.csv$/) && byPath(s, /^CVI data\/facilities\/cvi_master_small\.csv$/), 'folder: relative paths kept (subfolders read)', s.items.map(i => i.path));
    check(s.items.every(i => i.crc === (/small/.test(i.path) ? SMALL : WA)), 'folder: contents byte-identical', s.items);
    // Compare with the system files actually on disk now: macOS Finder may remove or replace .DS_Store after browsing.
    const sysOnDisk = fs.readdirSync(cp(path.join('folder', 'CVI data'))).filter(n => /^(\.DS_Store|\._.*|Thumbs\.db)$/.test(n)).sort();
    check(sysOnDisk.length >= 2 && s.ignored.map(x => x.path.split('/').pop()).sort().join() === sysOnDisk.join() && s.ignored.every(x => /system file/.test(x.reason)),
      'folder: macOS and Windows system files skipped', { ignored: s.ignored, onDisk: sysOnDisk });
    check(s.sources.some(x => x.kind === 'folder' && x.path === 'CVI data'), 'folder: folder name reported', s.sources);
    s = await pick('#folder-input', [cp('empty_folder')]);
    check(s.items.length === 0 && s.cls === 'status warn' && /No usable files/.test(s.status), 'empty folder: plain warning', s);

    // 4. Drag and drop (files; folders as dropped entries)
    let v0 = await version(); await p.drop('#drop', [cp('deflate.zip'), path.join(ROOT, 'tests', 'synthetic', 'cvi_master_small.csv')]); s = await settle(v0);
    check(s.items.length === 4 && s.items.filter(i => i.crc === SMALL).length === 2, 'drop: ZIP plus loose CSV', s.items);
    // DevTools-simulated drags give folder entries no file-system backing (EncodingError), unlike a real mouse drag,
    // so a simulated folder drop must either read the folder or fail with the plain fallback message, never silently.
    v0 = await version(); await p.drop('#drop', [cp(path.join('folder', 'CVI data'))]); s = await settle(v0);
    run.folderDrop = s.items.length ? 'read' : 'fallback message (simulated drag; real drag needs the manual check)';
    check((s.items.length === 4 && byPath(s, /^CVI data\/facilities\/cvi_master_small\.csv$/) && s.items.every(i => i.crc === (/small/.test(i.path) ? SMALL : WA)))
      || (s.items.length === 0 && s.cls === 'status err' && /Use "Choose a folder" instead/.test(s.status)), 'drop: folder read recursively, or a plain fallback message', s);
    if (!s.items.length) notes.push('folder drop: simulated drag cannot be read (Chrome DevTools limitation); fallback message shown; verify a real drag manually');

    // 5. Damaged, wrong and unsupported inputs give plain messages and never break the page
    s = await pick('#files-input', [cp('truncated.zip')]);
    check(s.cls === 'status err' && /incomplete or damaged/.test(s.status), 'truncated ZIP: error message', s.status);
    s = await pick('#files-input', [cp('not_really.zip')]);
    check(s.cls === 'status err' && /is not a ZIP file/.test(s.status), 'renamed CSV: error message', s.status);
    s = await pick('#files-input', [cp('truncated.zip'), cp('stored.zip')]);
    check(s.items.length === 2 && s.errors.length === 1, 'a bad ZIP does not stop a good one in the same selection', s);
    s = await pick('#files-input', [cp('bad_crc.zip')]);
    check(s.items.length === 1 && /integrity check/.test(s.items[0].readError || ''), 'bad CRC: refused on read', s.items);
    s = await pick('#files-input', [cp('garbled_data.zip')]);
    check(s.items.some(i => /damaged/.test(i.readError || '')), 'garbled deflate data: refused on read', s.items);
    s = await pick('#files-input', [cp('encrypted_entry.zip')]);
    check(s.items.length === 1 && s.ignored.some(x => /password-protected/.test(x.reason)), 'encrypted entry: skipped with reason', s.ignored);
    s = await pick('#files-input', [cp('unsupported_method.zip')]);
    check(s.items.length === 1 && s.ignored.some(x => /BZIP2/.test(x.reason)), 'unsupported compression: skipped with reason', s.ignored);
    s = await pick('#files-input', [cp('empty.zip')]);
    check(s.items.length === 0 && s.cls === 'status warn', 'empty ZIP: plain warning', s);
    s = await pick('#files-input', [cp('deflate.zip')]);
    check(s.items.length === 3 && s.cls === 'status ok', 'recovers after errors');

    // 7. Recognition, bundle.json banner, data checklist and feature gating inside Chrome, for every case of
    //    the hand-written oracle (tests/synthetic/f1_checklist_matrix.json), loaded through the page's own controls.
    //    Conflict choices and picks are made in the panel's dropdowns when the panel offers one; a pick the panel does
    //    not offer (a file that is not unclear) goes through the same function the dropdown calls.
    const matrix = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'synthetic', 'f1_checklist_matrix.json'), 'utf8'));
    const clVersion = () => p.eval('WSDA.landing.checklist.state.version');
    const clSettle = v0 => p.waitFor('!WSDA.landing.checklist.state.busy && WSDA.landing.checklist.state.version > ' + v0, 15000, 'checklist');
    const idOf = name => p.eval(`(WSDA.landing.state.result.items.find(i => i.name === ${JSON.stringify(name)}) || {}).id`);
    const uiSelect = async (attr, key, value) => {   // sets a panel dropdown as a user would; false if not offered
      const v0 = await clVersion();
      // Focus first, as a user opening the dropdown does: layer options are filled in on focus. The panel's fold is
      // opened first when it is closed, as a user would open it to reach the dropdown.
      const ok = await p.eval(`(function(){var s=Array.from(document.querySelectorAll('select[${attr}]')).find(x=>x.getAttribute('${attr}')===${JSON.stringify(key)});
        if(!s) return false; var d=s.closest('details'); if(d&&!d.open) d.querySelector('summary').click(); s.focus(); if(!Array.from(s.options).some(o=>o.value===${JSON.stringify(value)})) return false;
        s.value=${JSON.stringify(value)}; s.dispatchEvent(new Event('change',{bubbles:true})); return true;})()`);
      if (ok) await clSettle(v0);
      return ok;
    };
    const VIEW = `(function(){var c=WSDA.landing.checklist.state, r=c.result, ban=document.getElementById('bundle-banner');
      var shown=td=>{if(!td)return null;var s=td.querySelector('select');return s?s.options[s.selectedIndex].textContent:td.textContent;};
      var rows=sel=>Array.from(document.querySelectorAll(sel)).map(t=>({key:t.getAttribute('data-dataset')||t.getAttribute('data-feature')||t.getAttribute('data-file'),
        status:t.getAttribute('data-status'), on:t.getAttribute('data-on'), text:t.textContent, pick:!!t.querySelector('select[data-pick]'), choose:!!t.querySelector('select[data-choose]'),
        fileCell:shown(t.cells[2]), usedAs:shown(t.cells[3])}));
      return {status:document.getElementById('load-status').textContent, errors:WSDA.landing.state.result?WSDA.landing.state.result.errors:[],
        banner:ban.hidden?null:ban.textContent, warnings:c.bundle?[...c.bundle.warnings,...c.mappingWarnings]:[],
        datasets:r?r.datasets.map(d=>({id:d.id,status:d.status,path:d.path,name:d.name,options:d.options,missingUseful:d.missingUseful.map(u=>u.columns[0])})):[],
        files:r?r.files.map(f=>({id:f.id,name:f.name,status:f.status,dataset:f.dataset,reason:f.reason,warning:f.warning,via:f.via,candidates:f.candidates,layers:f.layers})):[],
        features:c.features||[], manifest:r?r.manifest:null, items:WSDA.landing.state.result?WSDA.landing.state.result.items.length:0,
        dsRows:rows('#datasets-table tbody tr'), featRows:rows('#features-table tbody tr'), fileRows:rows('#items-table tbody tr'),
        focus:document.activeElement&&document.activeElement.tagName, focusKey:document.activeElement&&(document.activeElement.getAttribute('data-pick')||document.activeElement.getAttribute('data-choose'))};})()`;
    const leaf = q => q.split(/\/| › /).pop();
    const viewDataset = d => d.status === 'found' ? leaf(d.path) : d.status === 'conflict' ? { conflict: d.options.map(o => leaf(o.path)).sort() } : 'missing';
    const viewFile = f => f.status === 'used' || f.status === 'conflict' ? f.status + ':' + f.dataset : f.status === 'bundle' ? 'bundle' : 'not-used:' + f.reason;
    const fileOk = (exp, got) => exp.startsWith('not-used:') ? got.startsWith('not-used:') && got.includes(exp.slice(9)) : exp === got;
    const loadVia = async (mode, src) => {
      const full = path.join(OUT, src);
      if (mode === 'drop') { const v0 = await version(); await p.drop('#drop', [full]); return settle(v0); }
      return pick(src.endsWith('.zip') ? '#files-input' : '#folder-input', [full]);
    };
    const runs = [];
    for (const [name, c] of Object.entries(matrix.cases)) for (const src of c.source) runs.push({ name, c, src, mode: src.endsWith('.zip') ? 'files' : 'folder' });
    for (const t of ['full', 'partner', 'public']) runs.push({ name: t, c: matrix.cases[t], src: 'tiers/' + t + '.zip', mode: 'drop' });
    let viaUi = 0, viaApi = 0, nextChecked = 0;
    const NEXT = `(function(){var b=document.getElementById('next-step'),o=document.getElementById('next-open');
      return {hidden:b.hidden, kind:b.getAttribute('data-kind'), text:document.getElementById('next-text').textContent,
        notes:Array.from(document.querySelectorAll('#next-notes li')).map(l=>l.textContent), open:o.hidden?null:o.textContent,
        routed:Array.from(document.querySelectorAll('#profiles .card.routed')).map(c=>c.getAttribute('data-profile')),
        guide:!document.getElementById('next-guide').hidden};})()`;
    for (const { name, c, src, mode } of runs) {
      const tag = `checklist ${name} [${src}, ${mode}]`; if (process.env.F1_TRACE) console.log(tag);
      await loadVia(mode, src);
      for (const [ds, file] of Object.entries((c.options || {}).choices || {})) {
        const ok = await uiSelect('data-choose', ds, await idOf(file));
        check(ok, tag + ': conflict chooser offered for ' + ds); viaUi++;
      }
      for (const [file, ds] of Object.entries((c.options || {}).assign || {})) {
        const id = await idOf(file);
        if (await uiSelect('data-pick', id, ds)) { viaUi++; continue; }
        const v0 = await clVersion(); await p.eval(`WSDA.landing.checklist.assign(${JSON.stringify(id)}, ${JSON.stringify(ds)})`); await clSettle(v0); viaApi++;
      }
      const v = await p.eval(VIEW);
      check(c.loadError ? v.errors.some(e => e.message.includes(c.loadError)) : v.errors.length === 0, tag + ': load errors', v.errors);
      const badDs = v.datasets.filter(d => JSON.stringify(viewDataset(d)) !== JSON.stringify(c.datasets[d.id] === undefined ? 'missing' : c.datasets[d.id]));
      check(Object.keys(c.datasets).every(id => v.datasets.some(d => d.id === id)) && !badDs.length, tag + ': datasets found / missing / conflict', badDs.map(d => [d.id, viewDataset(d)]));
      check(v.files.map(f => f.name).sort().join('|') === Object.keys(c.files).sort().join('|'), tag + ': file list complete', v.files.map(f => f.name));
      const got = Object.fromEntries(v.files.map(f => [f.name, viewFile(f)]));
      const badF = Object.keys(c.files).filter(k => !(k in got) || !fileOk(c.files[k], got[k]));
      check(!badF.length, tag + ': each file used / not used with reason', badF.map(k => [k, got[k]]));
      if (c.via) { const badV = Object.entries(c.via).filter(([k, x]) => (v.files.find(f => f.name === k) || {}).via !== x); check(!badV.length, tag + ': recognized via', badV); }
      if (c.missingUseful) check(Object.entries(c.missingUseful).every(([id, e]) => JSON.stringify((v.datasets.find(d => d.id === id) || {}).missingUseful) === JSON.stringify(e)), tag + ': missing optional columns');
      if (c.candidates) check(Object.entries(c.candidates).every(([k, e]) => JSON.stringify((v.files.find(f => f.name === k) || {}).candidates) === JSON.stringify(e)), tag + ': picker candidates');
      if (c.manifestAdded) check(v.manifest && JSON.stringify(v.manifest.added) === JSON.stringify(c.manifestAdded), tag + ': manifest layers added', v.manifest);
      const expB = c.bundle || { banner: null, warnings: [] };
      check(v.banner === expB.banner, tag + ': banner shown in the page', v.banner);
      check(v.warnings.length === expB.warnings.length && expB.warnings.every((w, k) => v.warnings[k].includes(w)), tag + ': bundle.json warnings', v.warnings);
      // S5: the two County Focus features, hand-listed as in run_f1_unit_tests.js (the matrix file is outside
      // S5's file list): the map as the WA map; the premises only with the Full tier's master (the four coordinates).
      const cf = Object.assign({}, c.features, { 'focus-map': c.features['wa-map'], 'focus-premises': { full: 'on', full_pick_overrides_name: 'on',
        duplicate_master: 'off:choose', wrong_file: 'off:CVI master table', corrupt_zip: 'off:CVI master table', empty_folder: 'off:CVI master table' }[name] || 'off:Origin.Lat' });
      const badG = v.features.filter(f => { const e = cf[f.id] || ''; return e === 'on' ? !f.on : !(e.startsWith('off:') && !f.on && f.reason.includes(e.slice(4))); });
      check(v.features.length === Object.keys(cf).length && !badG.length, tag + ': features on / off with reason', badG);
      // What the user sees agrees with the result: one row per dataset, feature and file, with matching status.
      check(v.dsRows.length === v.datasets.length && v.datasets.every((d, k) => v.dsRows[k].key === d.id && v.dsRows[k].status === d.status), tag + ': Datasets table matches', v.dsRows.map(r => [r.key, r.status]));
      check(v.featRows.length === v.features.length && v.features.every((f, k) => v.featRows[k].key === f.id && v.featRows[k].on === (f.on ? '1' : '0') && (f.on || v.featRows[k].text.toLowerCase().includes(f.reason.toLowerCase()))), tag + ': Features table shows on / off and the reason', v.featRows);
      check(v.fileRows.length === v.items, tag + ': one row per file received', [v.fileRows.length, v.items]);
      const expW = c.fileWarnings || {};
      check(v.files.every(f => expW[f.name] ? (f.warning || '').includes(expW[f.name]) : f.warning === null), tag + ': warnings on files', v.files.filter(f => f.warning).map(f => [f.name, f.warning]));
      // What each row visibly says: "Used as" for every file and the File cell of every dataset, from the oracle.
      const dsName = id => (v.datasets.find(d => d.id === id) || {}).name;
      const picks = (c.options && c.options.assign) || {};
      const badUsed = v.files.filter(f => {
        const row = v.fileRows.find(r => r.key === f.id), exp = c.files[f.name] || '', u = row && row.usedAs;
        if (!row) return true;
        if (exp.startsWith('used:')) { const n = dsName(exp.slice(5)); return !(u === n || (row.pick && !picks[f.name] && u === n + ' (automatic)')); }
        if (exp === 'bundle') return !/^Bundle description/.test(u);
        if (exp.startsWith('conflict:')) return !(u === 'Choose in Datasets above' || (row.pick && picks[f.name] && u === 'Your choice: choose in Datasets above'));
        return !(u === 'Not used' || (row.pick && (picks[f.name] ? u === 'Not used (your choice did not fit)' : (u === 'Which layer is this file?' || u === 'Not used (automatic)'))));
      });
      check(!badUsed.length, tag + ': "Used as" shown for every file as the oracle says', badUsed.map(f => [f.name, (v.fileRows.find(r => r.key === f.id) || {}).usedAs]));
      const badCell = v.datasets.filter(d => {
        const row = v.dsRows.find(r => r.key === d.id), exp = c.datasets[d.id], t = row && row.fileCell;
        if (!row) return true;
        if (exp === undefined || exp === 'missing') return !/^expected name: /.test(t);
        if (typeof exp === 'string') return leaf(t) !== exp;
        return t !== 'Choose a file…';
      });
      check(!badCell.length, tag + ': Datasets File cell shown as the oracle says', badCell.map(d => [d.id, (v.dsRows.find(r => r.key === d.id) || {}).fileCell]));
      if (c.layers) check(Object.entries(c.layers).every(([k, e]) => JSON.stringify((v.files.find(f => f.name === k) || {}).layers) === JSON.stringify(e)), tag + ': change-layer options');
      check(v.fileRows.every(r => { const f = v.files.find(x => x.id === r.key) || {}; return r.pick === !!(f.candidates || (f.layers && f.layers.length > 1) || picks[f.name]); }),
        tag + ': layer dropdown shown exactly for unclear files and files that could be more than one layer', v.fileRows.filter(r => r.pick).map(r => r.key));
      check(v.dsRows.every(r => r.choose === ((v.datasets.find(d => d.id === r.key) || { options: [] }).options.length > 1)), tag + ': chooser shown whenever files compete (and kept after a choice)');
      // The next step after the checklist, from the oracle's features and master status
      const nx = await p.eval(NEXT), m = c.datasets.master;
      if (!v.items) check(nx.hidden, tag + ': no next step when no file was received', nx);
      else if (c.features['wa-map'] === 'on') {
        const OFF = { 'species-refine': 'Refine by species (needs the column Species in the CVI master table)',
          'unique-cvis': 'Unique CVIs in current view (needs the column CVI in the CVI master table)',   // S2a: CVI column
          'focus-premises': 'County Focus premises (needs the columns Origin.Lat, Origin.Long, Dest.Lat and Dest.Long in the CVI master table)' };   // S5
        const offs = Object.keys(OFF).filter(k => cf[k] !== 'on');
        const offNote = offs.length ? 'Not available with these files: ' + offs.map(k => OFF[k]).join('; ') + '.' : null;
        check(!nx.hidden && nx.kind === 'ok' && nx.text === 'Next: open the CVI map. Your files have what it needs.' && nx.open === 'Open the CVI map'
          && nx.notes.includes(offNote) === !!offNote, tag + ': next step: Open the CVI map', nx);
      } else if (m && typeof m === 'object') check(!nx.hidden && nx.kind === 'warn' && nx.open === null && /^Next: choose which file is the CVI master table in Datasets below\./.test(nx.text), tag + ': next step: choose the master first', nx);
      else check(!nx.hidden && nx.kind === 'warn' && nx.open === null && /^The CVI map needs the CVI master table \(CVI_Consolidated_Master\.csv\)(, and none of your files is it\.|\. \S+ (looks|is named) like the CVI master table but is missing the columns? .+\. Ask for a copy with every column listed under "What data does this need\?", then choose all your files again, together\.$)/.test(nx.text), tag + ': next step: says what is missing (a near miss named with its reason)', nx);
      const prof = await p.eval('(WSDA.landing.checklist.state.bundle||{info:null}).info && WSDA.landing.checklist.state.bundle.info.profile');
      check(JSON.stringify(nx.routed) === JSON.stringify(prof === 'cvi' || prof === 'emergency' ? [prof] : []), tag + ': card of the bundle.json profile marked', [prof, nx.routed]);
      if (name === 'other_profile_bundle') check(nx.routed[0] === 'emergency' && nx.notes.some(t => /Emergency Response, which is in preparation/.test(t)), tag + ': routed to Emergency (in preparation), checked against CVI', nx);
      if (name === 'partner') check(nx.routed[0] === 'cvi', tag + ': Partner bundle routed to CVI', nx);
      // A missing column with a feature and a later use names both in the master's notes.
      if (name === 'partner') { const notes = await p.eval(`(function(){var r=document.querySelector('#datasets-table tbody tr[data-dataset="master"]');return r?r.cells[3].textContent:null})()`);
        check(/Without the column CVI: Unique CVIs in current view is off; no certificate numbers in the County Focus hover and CVI table/.test(notes || ''), tag + ': master notes name the feature off and what County Focus shows without it', notes); }
      nextChecked++;
    }
    run.checklistRuns = runs.length; run.picksViaDropdown = viaUi; run.picksViaApi = viaApi; run.nextStepRuns = nextChecked;

    // Landing page streamline: the checklist's tables in a fold under a one-line result naming the
    // dashboard, closed when everything was found, open when something needs attention, and kept open after a choice
    // settles it; the user's own open or close kept until new files are loaded.
    const FOLD = `({open:(document.getElementById('checklist-details')||{}).open, summary:document.getElementById('checklist-summary').textContent})`;
    await loadVia('files', 'tiers/full.zip');
    const fFull = await p.eval(FOLD);
    check(fFull.open === false && /^CVI Traceability: All required data found\. \d+ of \d+ features available\.$/.test(fFull.summary),
      'checklist fold: closed for the Full tier, under a one-line result naming the dashboard', fFull);
    await p.click(`document.querySelector('#checklist-details > summary').click()`);
    check((await p.eval(FOLD)).open === true, 'checklist fold: opens from its summary');
    await loadVia('folder', 'negative/duplicate_master');
    const fDup = await p.eval(FOLD);
    check(fDup.open === true && /^CVI Traceability: Choose which file/.test(fDup.summary), 'checklist fold: open when a file must be chosen (a new load forgets the earlier open)', fDup);
    // Interaction: undoing a choice or a pick, and keyboard focus kept on the dropdown after the panel redraws.
    let v = await p.eval(VIEW);
    check(/Choose which file is the CVI master table/.test(await p.eval('document.getElementById("checklist-summary").textContent')), 'chooser: summary asks the user to choose');
    await uiSelect('data-choose', 'master', await idOf('cvi_master_copy.csv'));
    v = await p.eval(VIEW);
    check(v.features.every(f => f.on === (f.id !== 'unique-cvis' && f.id !== 'focus-premises')) && v.focus === 'SELECT' && v.focusKey === 'master', 'chooser: choice turns features on (Unique CVIs off: no CVI column; S5: County Focus premises off: no premises coordinates); focus stays on that same dropdown', [v.features, v.focus, v.focusKey]);
    check((await p.eval(FOLD)).open === true, 'checklist fold: still open after the choice settles it');
    await uiSelect('data-choose', 'master', '');
    v = await p.eval(VIEW);
    check(v.datasets[0].status === 'conflict' && v.features.every(f => !f.on), 'chooser: clearing the choice asks again');
    await loadVia('folder', 'negative/unclear_facility');
    const fid = await idOf('feedlots_2025.csv');
    await uiSelect('data-pick', fid, 'restricted');
    v = await p.eval(VIEW);
    check(v.datasets.find(d => d.id === 'restricted').status === 'found' && v.fileRows.find(r => r.key === fid).pick && v.focusKey === fid, 'picker: pick used; dropdown stays to change it, with focus on it', v.focusKey);
    await uiSelect('data-pick', fid, '');
    v = await p.eval(VIEW);
    check(v.datasets.find(d => d.id === 'restricted').status === 'missing' && (v.files.find(f => f.id === fid) || {}).candidates, 'picker: clearing the pick makes the file unclear again');
    // "Change layer" on a file placed by bundle.json: the user's pick outranks bundle.json in the page.
    await loadVia('folder', 'tiers/partner');
    const pf = await idOf('feedlots_2025.csv');
    const label0 = await p.eval(`document.querySelector('select[data-pick="${pf}"]').options[0].textContent`);
    check(label0 === 'Feedlots (automatic)', 'change layer: dropdown on a recognized file starts at the automatic result', label0);
    check(await uiSelect('data-pick', pf, 'restricted'), 'change layer: offered on a file named in bundle.json');
    v = await p.eval(VIEW);
    check(v.datasets.find(d => d.id === 'restricted').status === 'found' && v.datasets.find(d => d.id === 'feedlots').status === 'missing' && (v.files.find(f => f.id === pf) || {}).via === 'your choice',
      'change layer: the user\'s pick outranks bundle.json', v.datasets.map(d => [d.id, d.status]));
    await uiSelect('data-pick', pf, '');
    v = await p.eval(VIEW);
    check(v.datasets.find(d => d.id === 'feedlots').status === 'found' && (v.files.find(f => f.id === pf) || {}).via === 'bundle.json', 'change layer: undo restores bundle.json\'s placement');
    // In the page: a dropdown kept from the previous panel cannot change a newer load, and a pending
    // bundle.json read is not lost. Driven in-page with a delayed bundle.json read; the old element gets a real event.
    const race = await p.eval(`(async()=>{const W=WSDA,c=W.landing.checklist;
      const load=async files=>W.load.fromFileList(files.map(([n,t])=>new File([t],n)),'files');
      const idle=async v=>{for(let k=0;k<400;k++){if(!c.state.busy&&c.state.version>v)return;await new Promise(r=>setTimeout(r,5));}throw Error('idle timeout')};
      let v0=c.state.version; await c.show(await load([['wa_state_feedlots.csv','name,lat,long\\n'],['other.csv','name,lat,long\\n']])); await idle(v0);
      const old=document.querySelector('select[data-pick]'); if(!old) return {error:'no dropdown'};
      const next=await load([['wa_state_public_livestock_markets.csv','name,lat,long\\n'],['bundle.json','{"label":"NEW","files":{"feedlots":"wa_state_public_livestock_markets.csv"}}']]);
      let release; const bj=next.items[1], t0=bj.text; bj.text=()=>new Promise(r=>{release=async()=>r(await t0());});
      v0=c.state.version; const pending=c.show(next); await Promise.resolve();
      const oldGone=!document.contains(old); old.focus(); old.value=old.options[old.options.length-1].value; old.dispatchEvent(new Event('change',{bubbles:true}));
      await new Promise(r=>setTimeout(r,20)); await release(); await pending; await idle(v0);
      return {oldGone, banner:document.getElementById('bundle-banner').textContent, picks:Object.keys(c.state.assign).length,
        feedlots:(c.state.result.datasets.find(d=>d.id==='feedlots')||{}).status, busy:c.state.busy};})()`);
    check(race.oldGone && race.banner === 'NEW' && race.picks === 0 && race.feedlots === 'found' && race.busy === false,
      'race: old dropdown removed and ignored; pending bundle.json still applied (banner and mapping)', race);

    s = await pick('#files-input', [cp('truncated.zip')]);
    v = await p.eval(VIEW);
    check(v.banner === null && v.datasets.every(d => d.status === 'missing') && v.features.every(f => !f.on) && v.fileRows.length === 0 && /incomplete or damaged/.test(v.status),
      'after a failed load the previous checklist and banner are replaced (nothing found, features off)', v);

    // 8. "Open the CVI map". The CVI page (S1, moved to site/cvi/) opens in its own tab, reused on the next click,
    //    and receives the files its features use from the landing page, in memory.
    //    Reference: the same page opened directly with the single CSV the tiers are made from (cvi_master_wa39.csv).
    const CVI_URL = new URL('cvi/index.html', PAGE).href;
    const MAP = `(function(){var s=CVIWA.state,g=document.querySelector('[data-feature="species-refine"]'),why=g.querySelector('[data-gate-reason]'),ban=document.getElementById('bundle-banner');
      return {master:!!s.master, status:document.getElementById('master-status').textContent, banner:ban.hidden?null:ban.textContent, opener:!!window.opener,
        name:window.name, received:s.received||null, rows:s.data.map(r=>[r.county,r.direction,r.total_animals,r.radius_px,r.lat,r.lon]), live:s.liveTooltips,
        legend:s.legend&&s.legend.sizes, features:s.features, gated:g.classList.contains('gated'), reason:why.hidden?null:why.textContent,
        disabled:Array.from(g.querySelectorAll('input')).filter(x=>x.disabled).length, inputs:g.querySelectorAll('input').length,
        look:(function(){var c=getComputedStyle(g.querySelector('summary'));return c.color+' '+c.cursor;})(), sub:s.speciesSub.slice()};})()`;
    // --muted #666666 / --disabled #999999 (the brand colors; formerly #5d6873 / #9aa3ab)
    const LOOK_ON = 'rgb(102, 102, 102) pointer', LOOK_GATED = 'rgb(153, 153, 153) not-allowed';
    // Opening "Refine by species" with the keyboard (focus its summary, press Enter): returns whether it opened.
    const keyOpen = async tab => { await tab.page.eval(`(function(){var d=document.querySelector('[data-feature="species-refine"] details');d.open=false;d.querySelector('summary').focus();return true;})()`);
      await tab.page.front(); await tab.page.key('Enter', 13, '\r'); await sleep(150);
      return tab.page.eval(`(function(){var d=document.querySelector('[data-feature="species-refine"] details'),o=d.open;d.open=false;return o;})()`); };
    const fresh = (tab, extra) => tab.page.waitFor(`!window.__stale && window.CVIWA && CVIWA.state && document.readyState === 'complete'${extra ? ' && ' + extra : ''}`, 20000, 'CVI page');
    const mapReady = (tab, re) => fresh(tab, `!CVIWA.state.loading && CVIWA.state.master && ${re}.test(document.getElementById('master-status').textContent) && CVIWA.state.data.length > 0`);
    const sameMap = (a, r) => JSON.stringify([a.rows, a.live, a.legend]) === JSON.stringify([r.rows, r.live, r.legend]);
    const tryOpen = tab => tab.page.eval(`(async()=>{var d=document.querySelector('[data-feature="species-refine"] details');d.open=true;await new Promise(r=>setTimeout(r,50));return d.open;})()`);
    // Reference, and gating on the CVI page itself (no landing page involved)
    const ref = await b.newTab(CVI_URL);
    await fresh(ref);
    let mv = await ref.page.eval(MAP);
    check(!mv.opener && !mv.master && mv.banner === null && mv.gated && mv.reason === 'Needs the CVI master table (CVI_Consolidated_Master.csv).' && !(await tryOpen(ref)),
      'CVI page opened directly: no data yet, "Refine by species" grayed with the reason and cannot be opened', mv);
    check(mv.look === LOOK_GATED && mv.inputs === 0 && !(await keyOpen(ref)), 'gated "Refine by species" looks grayed (color, not-allowed cursor), has no checkboxes and does not open from the keyboard', mv.look);
    await ref.page.setFiles('#file-input', [path.join(ROOT, 'tests', 'synthetic', 'cvi_master_wa39.csv')]);
    await mapReady(ref, /cvi_master_wa39\.csv/);
    const refMap = await ref.page.eval(MAP);
    check(refMap.rows.length > 0 && !refMap.gated && refMap.reason === null && refMap.disabled === 0 && refMap.features.every(f => f.on === (f.id !== 'focus-premises')), 'CVI page, single CSV with Species: every feature on but County Focus premises (S5: this master has no premises coordinates), refine available', refMap.features);
    check(refMap.look === LOOK_ON && refMap.inputs > 0 && await keyOpen(ref), 'available "Refine by species" keeps its normal look and opens from the keyboard', [refMap.look, refMap.inputs]);
    await ref.page.setFiles('#file-input', [path.join(OUT, 'tiers', 'partner', 'partner_county_totals.csv')]);
    await mapReady(ref, /partner_county_totals\.csv/);
    mv = await ref.page.eval(MAP);
    check(mv.gated && mv.reason === 'Needs the column Species in the CVI master table.' && mv.inputs === 0 && mv.look === LOOK_GATED && !(await tryOpen(ref)) && !(await keyOpen(ref)) && sameMap(mv, refMap),
      'CVI page, master without Species chosen directly: refine grayed with the reason (no checkboxes left); same map', [mv.reason, mv.inputs, mv.look]);
    await b.closeTab(ref.targetId);

    // From the landing page: Full, Partner and Public tiers in turn, then a reload of the map tab
    const cviTabs = async () => (await b.pages(/\/cvi\/index\.html/)).length;
    let nx;
    const n0 = b.opened.length;
    await loadVia('files', 'tiers/full.zip');
    await p.click(`document.getElementById('next-open').click()`);
    const tab = await b.waitTab(n0);
    await mapReady(tab, /CVI_Consolidated_Master\.csv/);
    // S5: County Focus's facility layers and the manifest go with the master (hand-listed from the Full
    // tier's files: the five built-in layers, the manifest and its two extra layers); the CVI tab reads them all.
    const FULL_FAC = ['fairgrounds', 'feedlots', 'markets', 'restricted', 'slaughterhouses', 'syn_custommeat', 'syn_disposal'];
    await tab.page.waitFor('CVIWA.state.received && CVIWA.state.received.facilities', 8000, 'facility files read');
    mv = await tab.page.eval(MAP);
    const recv = mv.received ? Object.assign({}, mv.received, { datasets: mv.received.datasets.slice().sort() }) : null;
    check(mv.opener && mv.name === 'wsda-cvi' && JSON.stringify(recv) === JSON.stringify({ datasets: FULL_FAC.concat(['manifest', 'master']).sort(), banner: 'Full – synthetic test bundle · prepared 2026-09-15 · covers 2024–2025', facilities: FULL_FAC }),
      'hand-off Full: CVI map in its own tab; the master, the facility layers and the manifest (the data its features use) and the banner sent', [mv.name, mv.received]);
    check(mv.banner === 'Full – synthetic test bundle · prepared 2026-09-15 · covers 2024–2025' && sameMap(mv, refMap) && !mv.gated, 'hand-off Full: banner shown; map identical to the single CSV; refine available', mv.banner);
    const OPENED = 'document.getElementById("next-opened").textContent';
    check(await p.waitFor(`/is open in its own tab with your files/.test(${OPENED})`, 5000, 'opened report').catch(() => false), 'landing: confirms the map was opened with the files once the CVI tab has loaded them', await p.eval(OPENED));
    // Exercise the actual Full ZIP handoff in County Focus, not an injected King facility fixture.
    await tab.page.front();
    await tab.page.click(`document.getElementById('show-focus').click()`);
    await tab.page.waitFor('CVIWA.state.focusHandle && CVIWA.state.focusHandle.ready', 15000, 'Full Focus ready');
    const focusIdle = () => tab.page.waitFor('CVIWA.state.focusHandle.map.loaded() && !CVIWA.state.focusHandle.map.isMoving()', 15000, 'Full Focus idle');
    const pickFocus = async name => {
      await tab.page.click(`(function(){document.querySelector('[data-clear="foCounties"]').click();var c=[].find.call(document.querySelectorAll('#fo-counties input'),function(x){return x.value===${JSON.stringify(name)}});c.click()})()`);
      await sleep(700); await focusIdle();
    };
    const focusDrawn = () => tab.page.eval(`CVIWA.state.focusHandle.fac.drawn`);
    await pickFocus('King');
    await tab.page.click(`document.getElementById('fo-fac-block').open=true;document.getElementById('fo-fac-all').click()`);
    await sleep(200); await focusIdle();
    let fd = await focusDrawn();
    check(fd.length === 7 && fd.every(x => x[1].length === 0), 'Full ZIP Focus King: no facility markers (actual sample has none inside King)', fd);
    await pickFocus('Pierce');
    fd = await focusDrawn();
    // Hand-listed from the actual Full CSV coordinates: two packing plants and one custom-meat point in Pierce.
    check(JSON.stringify(fd.filter(x => x[1].length)) === JSON.stringify([
      ['slaughterhouses', ['Synthetic Packing Plant 1', 'Synthetic Packing Plant 2']], ['syn_custommeat', ['Synthetic Custom Meat 6']]
    ]), 'Full ZIP Focus Pierce: supplied facility markers drawn after All through the sidebar', fd);
    const h = 'CVIWA.state.focusHandle';
    // Center on the first actual packing plant; a click is sent through Chrome input, not map.fire or an API hook.
    const facilityPoint = await tab.page.eval(`${h}.fac.layers.find(x=>x.key==='slaughterhouses').points[0]`);
    await tab.page.eval(`void ${h}.map.jumpTo({center:[${facilityPoint.lon},${facilityPoint.lat}],zoom:13})`); await focusIdle();
    const clickMapPoint = async (lon, lat) => {
      const xy = await tab.page.eval(`(function(){var m=${h}.map,r=m.getCanvas().getBoundingClientRect(),q=m.project([${lon},${lat}]);return [r.left+q.x,r.top+q.y]})()`);
      for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
        await b.send('Input.dispatchMouseEvent', { type, x:xy[0], y:xy[1], button:type==='mouseMoved'?'none':'left', buttons:type==='mousePressed'?1:0, clickCount:type==='mouseMoved'?0:1 }, tab.page.sid);
        await sleep(100);
      }
    };
    await clickMapPoint(facilityPoint.lon, facilityPoint.lat);
    let clicked = await tab.page.eval(`document.querySelector('#focus-map .focus-fac-click .maplibregl-popup-content')?.textContent`);
    check(clicked && clicked.includes('Synthetic Packing Plant 1'), 'Full ZIP Focus: real click opens the supplied facility name popup', clicked);
    await tab.page.eval(`if(${h}.clickPopup)${h}.clickPopup.remove()`);
    await pickFocus('King');
    const actualPremise = await tab.page.eval(`${h}.premises.Outbound[0]`);
    await tab.page.eval(`void ${h}.map.jumpTo({center:[${actualPremise.lon},${actualPremise.lat}],zoom:13})`); await focusIdle();
    await clickMapPoint(actualPremise.lon, actualPremise.lat);
    clicked = await tab.page.eval(`({tables:document.querySelectorAll('#focus-map .focus-click table').length,stack:${h}.clickStack})`);
    check(clicked.tables === 1 && clicked.stack.keys.length > 0, 'Full ZIP Focus: real click at zoom 13 opens the actual premises CVI table', clicked);
    fs.mkdirSync(path.join(OUT, 'handoff'), { recursive: true });
    fs.writeFileSync(path.join(OUT, 'handoff', 'full_focus.json'), JSON.stringify({facilities:fd,clicked},null,2));
    await tab.page.eval(`if(${h}.clickPopup)${h}.clickPopup.remove()`);
    await tab.page.click(`document.getElementById('show-wa').click()`); await sleep(200);
    // A species ticked under "Refine by species" with Full does not carry over to a master without Species
    await tab.page.eval(`(function(){var i=document.querySelector('#f-species-sub input');i.click();return i.checked;})()`);
    await tab.page.waitFor(`CVIWA.state.speciesSub.length === 1`, 5000, 'raw species ticked'); await sleep(700);
    mv = await tab.page.eval(MAP);
    check(mv.sub.length === 1 && !sameMap(mv, refMap), 'Full: a species ticked under "Refine by species" changes the map', mv.sub);
    const tierRuns = [['partner', /partner_county_totals\.csv/, 'Partner – county totals only · prepared 2026-09-15 · covers 2024–2025', 'Needs the column Species in the CVI master table.'],
      ['public', /CVI_Consolidated_Master\.csv/, null, null]];
    for (const [tier, re, banner, reason] of tierRuns) {
      await p.front(); await loadVia('files', 'tiers/' + tier + '.zip');
      await tab.page.eval('window.__stale = 1');
      await p.click(`document.getElementById('next-open').click()`);
      await mapReady(tab, re);
      await tab.page.waitFor('CVIWA.state.received && CVIWA.state.received.facilities', 8000, 'facility files read');
      mv = await tab.page.eval(MAP);
      check(b.opened.length === n0 + 1 && await cviTabs() === 1, `hand-off ${tier}: the same CVI tab is reused`, [b.opened.length - n0, await cviTabs()]);
      // S5: Partner's two facility layers go with it; Public has none, so none stays loaded from the earlier hand-off.
      const fac = { partner: ['feedlots', 'markets'], public: [] }[tier];
      check(JSON.stringify(mv.received.datasets.slice().sort()) === JSON.stringify(fac.concat(['master']).sort()) && JSON.stringify(mv.received.facilities) === JSON.stringify(fac),
        `hand-off ${tier}: the master and its facility layers sent and read; no layer kept from the earlier hand-off`, mv.received);
      check(mv.banner === banner && mv.reason === reason && mv.gated === !!reason && sameMap(mv, refMap) && mv.sub.length === 0,
        `hand-off ${tier}: banner, gating and a map identical to the single CSV (default view; the earlier species tick gone)`, [mv.banner, mv.reason, mv.received, mv.sub]);
      check(mv.look === (reason ? LOOK_GATED : LOOK_ON), `hand-off ${tier}: "Refine by species" looks ${reason ? 'grayed' : 'normal'}`, mv.look);
    }
    await tab.page.eval('window.__stale = 1');
    await tab.page.reload();
    await mapReady(tab, /CVI_Consolidated_Master\.csv/);
    mv = await tab.page.eval(MAP);
    check(mv.banner === null && sameMap(mv, refMap) && await cviTabs() === 1, 'reloading the CVI tab gets the same files again while the landing tab is open');
    // Files may only come from the page that opened the tab: a message from any other window (here the tab itself) is ignored.
    await tab.page.eval(`window.postMessage({type:'wsda-files',profile:'cvi',banner:'FAKE',datasets:{master:{name:'fake.csv',path:'fake.csv',file:new File(['a,b\\n1,2\\n'],'fake.csv')}}},'*')`);
    await sleep(300);
    mv = await tab.page.eval(MAP);
    check(mv.banner === null && /CVI_Consolidated_Master\.csv/.test(mv.status) && sameMap(mv, refMap), 'CVI tab ignores files sent by a window other than its opener', [mv.banner, mv.status]);
    // While a choice is rechecked, the next step says so and nothing can be opened (the CVI tab is untouched)
    await p.front(); await pick('#files-input', [path.join(ROOT, 'tests', 'synthetic', 'cvi_master_small.csv'), path.join(ROOT, 'tests', 'synthetic', 'cvi_master_wa39.csv')]);
    await p.eval(`WSDA.landing.checklist.choose('master', WSDA.landing.checklist.state.load.items[0].id)`);
    nx = await p.eval(NEXT);
    check(nx.kind === 'ok' && nx.open === 'Open the CVI map', 'conflict resolved by a choice: the next step offers Open', nx);
    await tab.page.eval('window.__keep = 1');
    await p.eval(`window.__realRecognize = WSDA.recognize.recognize; WSDA.recognize.recognize = (...a) => new Promise(r => { window.__releaseRecheck = () => __realRecognize(...a).then(r); }); void WSDA.landing.checklist.choose('master', ''); true`);
    const busy = await p.eval(`(function(){var n=${NEXT};n.busy=WSDA.landing.checklist.state.busy;n.disabled=Array.from(document.querySelectorAll('button[data-open]')).map(b=>b.disabled);
      n.direct=WSDA.landing.openProfile('cvi');document.getElementById('next-open').click();document.querySelector('#profiles button[data-open="cvi"]').click();return n;})()`);
    await sleep(500);
    const kept = await tab.page.eval(`({keep: window.__keep === 1, master: !!CVIWA.state.master})`);
    check(busy.busy && !busy.hidden && busy.kind === 'checking' && busy.text === 'Checking your files again… The next step appears here when that is done.' && busy.open === null && busy.disabled.length === 3 && busy.disabled.every(Boolean),
      'while rechecking, the next step says the files are being checked and every Open button is disabled', busy);
    check(busy.direct === null && kept.keep && kept.master, 'Open while rechecking does nothing (the CVI tab keeps its map)', [busy.direct, kept]);
    await p.eval(`__releaseRecheck(); WSDA.recognize.recognize = __realRecognize; true`);
    await p.waitFor('!WSDA.landing.checklist.state.busy', 5000, 'recheck done');
    nx = await p.eval(NEXT);
    const enabled = await p.eval(`Array.from(document.querySelectorAll('button[data-open]')).every(b => !b.disabled)`);
    check(nx.kind === 'warn' && nx.open === null && /^Next: choose which file is the CVI master table/.test(nx.text) && enabled, 'after the recheck the next step is current again (choose a master) and the buttons work', nx);
    // Files without a master table: no Open button in the next step; the card's button opens the map without data.
    await p.front(); await loadVia('folder', 'negative/wrong_file');
    nx = await p.eval(NEXT);
    check(nx.open === null && nx.kind === 'warn', 'no master: the next step offers no Open button', nx);
    await tab.page.eval('window.__stale = 1');
    await p.click(`document.querySelector('#profiles button[data-open="cvi"]').click()`);
    await fresh(tab); await sleep(500);
    mv = await tab.page.eval(MAP);
    check(!mv.master && mv.received === null && /No master dataset loaded/.test(mv.status) && mv.reason === 'Needs the CVI master table (CVI_Consolidated_Master.csv).' && await cviTabs() === 1,
      'card button without a master: the CVI tab opens with no data and says what it needs', mv);
    // A master whose header reads but whose body fails the ZIP integrity check (one byte changed): the
    // landing page reports that the files could not be sent, the CVI tab says so, and nothing claims success.
    const badZip = path.join(OUT, 'handoff', 'bad_master_crc.zip');
    { const gen = require(path.join(ROOT, 'tests', 'synthetic', 'make_bundles.js')), name = 'CVI_Consolidated_Master.csv', csv = fs.readFileSync(path.join(OUT, 'tiers', 'public', name));
      const z = gen.makeZip([{ name, data: csv, method: 0 }]); z[30 + Buffer.byteLength(name) + csv.length - 3] ^= 1;
      fs.mkdirSync(path.dirname(badZip), { recursive: true }); fs.writeFileSync(badZip, z); }
    await p.front(); await pick('#files-input', [badZip]);
    nx = await p.eval(NEXT);
    check(nx.kind === 'ok' && nx.open === 'Open the CVI map', 'damaged master: its header is recognized, so the next step offers Open', nx);
    await tab.page.eval('window.__stale = 1');
    await p.click(`document.getElementById('next-open').click()`);
    await fresh(tab);
    await tab.page.waitFor(`/could not be sent from the landing page/.test(document.getElementById('master-status').textContent)`, 8000, 'CVI read-failure message').catch(() => null);
    mv = await tab.page.eval(MAP);
    const sent = await p.eval(`({text:${OPENED}, cls:document.getElementById('next-opened').className})`);
    check(/^Your files could not be sent to the CVI map: "CVI_Consolidated_Master\.csv" failed its integrity check; the ZIP may be damaged\. Choose all your files again, together \(a new copy if one is damaged\), then click "Open the CVI map"\.$/.test(sent.text) && /err/.test(sent.cls),
      'landing reports the failed read with what to do, not success', sent);
    check(!mv.master && mv.banner === null && /^Your files could not be sent from the landing page: .*integrity check.* No dataset is active\./.test(mv.status) && /integrity check/.test((mv.received || {}).error),
      'the CVI tab says the files could not be sent and has no data', [mv.status, mv.received]);
    // After a completed hand-off, another document in the CVI tab (here: a different page of the site) asks
    // the landing page for the files like the CVI page does, with its own channel. Without the click's key it gets nothing.
    await p.front(); await loadVia('files', 'tiers/partner.zip');
    await tab.page.eval('window.__stale = 1');
    await p.click(`document.getElementById('next-open').click()`);
    await mapReady(tab, /partner_county_totals\.csv/);
    const tabKey = await tab.page.eval('location.search');
    await tab.page.goto(PAGE);
    await tab.page.waitFor('window.WSDA && WSDA.landing', 10000, 'other page in the CVI tab');
    const later = await tab.page.eval(`(async function(){var got=[],asks=[{type:'wsda-ready',profile:'cvi'},{type:'wsda-ready',profile:'cvi',key:'0'.repeat(32)},{type:'wsda-ready',profile:'cvi',key:'f'.repeat(32)}];
      var t=location.protocol==='file:'?'*':location.origin;
      for (var a of asks) { var ch=new MessageChannel(); ch.port1.onmessage=function(e){got.push(Object.keys(e.data||{}));}; opener.postMessage(a,t,[ch.port2]); }
      addEventListener('message',function(e){if(e.data&&e.data.type==='wsda-files')got.push('window');}); opener.postMessage({type:'wsda-ready',profile:'cvi'},t);
      await new Promise(r=>setTimeout(r,600));
      var direct; try { direct = !!opener.WSDA.landing.state; } catch (e) { direct = 'blocked'; }
      return {got:got, sameOriginRead:direct, opener:!!opener, name:window.name};})()`);
    check(/^\?handoff=[0-9a-f]{32}$/.test(tabKey) && later.opener && later.got.length === 0,
      'a later document in the CVI tab gets nothing from the landing page (no key: no answer, on a channel or otherwise)', [tabKey, later]);
    if (PAGE_ORIGIN) notes.push('Residual (http): a later document of the same origin can read the landing page directly: ' + later.sameOriginRead + ' (browser same-origin rule; hosting must not share the origin)');
    else check(later.sameOriginRead === 'blocked', 'over file:// another local page cannot read the landing page directly', later.sameOriginRead);

    // Through the hand-off: a master with a facility layer's extra columns (name, lat, long) and another name
    // is found on the landing page and opens in the CVI tab like the same file chosen there.
    await p.front(); await loadVia('folder', 'negative/master_extra_columns');
    nx = await p.eval(NEXT);
    await tab.page.eval('window.__stale = 1');
    await p.click(`document.getElementById('next-open').click()`);
    await mapReady(tab, /movements_with_places\.csv/);
    mv = await tab.page.eval(MAP);
    const extraRows = await tab.page.eval('CVIWA.state.master.physicalRows');
    check(nx.open === 'Open the CVI map' && extraRows === 1500 && mv.features.every(f => f.on === (f.id !== 'unique-cvis' && f.id !== 'focus-premises')) && !mv.gated, 'a master with extra name/lat/long columns opens in the CVI tab with every feature on (Unique CVIs off: no CVI column; S5: County Focus premises off: its lat/long are not the premises columns)', [nx, extraRows, mv.features]);

    // Files handed over late (a slow read on the landing page, held here) never replace a file chosen on the
    // CVI page in the meantime, nor report a failure over it; the landing page says what happened.
    const SMALL_CSV = path.join(ROOT, 'tests', 'synthetic', 'cvi_master_small.csv');
    const holdRead = fail => p.eval(`(function(){var it=WSDA.landing.state.result.items.find(i=>i.name==='CVI_Consolidated_Master.csv'),read=it.read;
      it.read=function(){return new Promise(function(res,rej){window.__release=function(){${fail ? "rej(new Error('Simulated slow read failure.'))" : 'read().then(res,rej)'}};});};return true;})()`);
    const KEPT = `(function(){var s=CVIWA.state;return {rows:s.master&&s.master.physicalRows, status:document.getElementById('master-status').textContent,
      banner:document.getElementById('bundle-banner').hidden?null:document.getElementById('bundle-banner').textContent, received:s.received||null, loading:s.loading};})()`;
    for (const fail of [false, true]) {
      const tag = 'delayed hand-off ' + (fail ? 'failure' : 'success');
      await p.front(); await loadVia('files', 'tiers/full.zip'); await holdRead(fail);
      await tab.page.eval('window.__stale = 1');
      await p.click(`document.getElementById('next-open').click()`);
      await fresh(tab, '!CVIWA.state.master && !CVIWA.state.loading');
      await tab.page.setFiles('#file-input', [SMALL_CSV]);
      await mapReady(tab, /cvi_master_small\.csv/);
      await p.eval('window.__release()');
      await tab.page.waitFor('CVIWA.state.received', 8000, tag + ': delivery').catch(() => null);
      await sleep(600);
      const k = await tab.page.eval(KEPT), said = await p.eval(OPENED);
      check(k.rows === 22 && /^Master loaded \(cvi_master_small\.csv\): 22 rows/.test(k.status) && k.banner === null && !k.loading && k.received && k.received.superseded === true,
        tag + ': the file chosen on the CVI page stays, with its own status and no banner', k);
      check(fail ? /^Your files could not be sent to the CVI map: Simulated slow read failure\./.test(said)
        : said === 'The CVI map could not load your files: a file was chosen on the map page while yours were on their way, and that file is kept. Click "Open the CVI map" to send yours again.',
        tag + ': the landing page says what happened', said);
    }
    // ... and a file chosen while the handed-over master is still being read on the CVI page: its read held there, either
    // not yet started (it then finishes after the newer choice) or in progress (the newer choice aborts it).
    for (const mode of ['finishes late', 'aborted']) {
      await p.front(); await loadVia('files', 'tiers/full.zip'); await holdRead(false);
      await tab.page.eval('window.__stale = 1');
      await p.click(`document.getElementById('next-open').click()`);
      await fresh(tab, '!CVIWA.state.master && !CVIWA.state.loading');
      await tab.page.eval(`(function(){var r=FileReader.prototype.readAsText,first=true;FileReader.prototype.readAsText=function(f){var self=this;
        if(!first) return r.call(this,f); first=false;
        ${mode === 'aborted' ? `var stopped=false;Object.defineProperty(self,'readyState',{get:function(){return stopped?2:1;}});
          self.abort=function(){stopped=true;if(self.onabort)self.onabort(new ProgressEvent('abort'));};
          setTimeout(function(){if(!stopped)r.call(self,f);},1500);` : 'setTimeout(function(){r.call(self,f);},1500);'}};return true;})()`);
      await p.eval('window.__release()');
      await tab.page.waitFor('CVIWA.state.loading && CVIWA.state.received', 8000, 'hand-off read started');
      await tab.page.setFiles('#file-input', [SMALL_CSV]);
      await mapReady(tab, /cvi_master_small\.csv/);
      await sleep(2000);
      const k3 = await tab.page.eval(KEPT), said3 = await p.eval(OPENED);
      check(k3.rows === 22 && /cvi_master_small\.csv/.test(k3.status) && /a file was chosen on the map page while yours were on their way/.test(said3),
        `a file chosen while the handed-over master is read (${mode}) replaces it, and the landing page is told (not left at "sending")`, [k3, said3]);
    }

    // When the browser blocks the new tab (window.open gives null, simulated here) the page says what to do.
    await p.front(); await loadVia('files', 'tiers/public.zip');
    await p.eval(`(function(){var o=window.open;window.open=function(){return null};document.getElementById('next-open').click();window.open=o;})()`);
    check(/blocked the new tab\. Allow pop-ups for this page/.test(await p.eval('document.getElementById("next-opened").textContent')), 'a blocked tab is reported with what to do');
    run.handoffTabs = b.opened.length - n0;

    // 9. "What data does this need?" (generated from the dataset list) and the synthetic sample bundle download.
    //    The download must be byte-identical to the archive make_bundles.js writes with the
    //    page's own code, whose files are the Full tier's (unit tests), and must load back as the Full bundle.
    await p.front(); await p.goto(PAGE);
    await p.waitFor('window.WSDA && WSDA.landing && WSDA.guide', 10000, 'landing page again');
    require(path.join(ROOT, 'site', 'cvi', 'datasets.js'));
    const CVI = globalThis.WSDA.profiles.cvi;
    // Landing page streamline: every part of the guide in a fold, closed until a link to it opens
    // it; the five facility layers in one row; one sample button, the all-in-one sample, at the top of the section.
    const guide = await p.eval(`(function(){var rows=Array.from(document.querySelectorAll('table[data-guide-profile="cvi"] tbody tr'));
      return {h2:(document.getElementById('guide')||{}).textContent, h3:(document.getElementById('guide-cvi')||{}).textContent,
        ids:rows.map(r=>r.getAttribute('data-guide-dataset')), files:rows.map(r=>r.cells[1].textContent), req:rows.map(r=>r.querySelector('.req').textContent),
        soon:(document.querySelector('[data-guide-soon="emergency"]')||{}).textContent||null,
        buttons:Array.from(document.querySelectorAll('#guide-section button[data-sample]')).map(b=>b.getAttribute('data-sample')+':'+b.textContent),
        parts:Array.from(document.querySelectorAll('details.guide-part')).map(d=>d.getAttribute('data-guide-part')+':'+d.open),
        cardLink:(document.querySelector('#profiles a[data-guide-link="cvi"]')||{}).getAttribute&&document.querySelector('#profiles a[data-guide-link="cvi"]').getAttribute('href'),
        introLink:document.getElementById('intro-guide').getAttribute('href'), geo:!!window.CVIWA_GEO,
        geoScripts:document.querySelectorAll('script[src$="wa-counties.js"]').length};})()`);
    check(guide.h2 === 'What data does this need?' && guide.h3 === 'CVI Traceability' && guide.soon === 'Emergency Response', 'guide: section with CVI and Emergency (in preparation)', guide);
    const facilityFiles = CVI.datasets.filter(d => d.kind === 'facility').map(d => d.file);
    check(guide.ids.join() === 'master,facility-layers,manifest' && guide.files[0] === CVI.datasets[0].file &&
      facilityFiles.every(f => guide.files[1].indexOf(f) >= 0) && guide.req.join() === 'required,optional,optional',
    'guide: the master, the five facility layers in one row (each layer\'s file named) and the manifest', guide);
    check(guide.cardLink === '#guide-cvi' && guide.introLink === '#guide' && guide.buttons.join() === 'all:Download a sample bundle (ZIP)'
      && guide.parts.join() === 'all:false,cvi:false,infrastructure:false', 'guide: linked from the CVI card and the intro; one sample ' +
      'button; every part folded', guide);
    check(!guide.geo && guide.geoScripts === 0, 'guide: the county file is not read before the sample is asked for', guide);
    await p.click(`document.querySelector('#profiles a[data-guide-link="cvi"]').click()`);
    await sleep(300);
    const jump = await p.eval(`({hash:location.hash, top:Math.round(document.getElementById('guide-cvi').getBoundingClientRect().top), focus:document.activeElement&&document.activeElement.id,
      open:document.querySelector('details[data-guide-part="cvi"]').open, others:document.querySelector('details[data-guide-part="infrastructure"]').open})`);
    check(jump.hash === '#guide-cvi' && jump.open && !jump.others && jump.top >= -2 && jump.top < 60, 'guide: the card link opens the CVI part and scrolls to it', jump);
    run.guideFocus = jump.focus;
    // Next step: linked when data is missing (no master; or Partner, which has no Species), not when everything is there
    const GL = `({hidden:document.getElementById('next-guide').hidden, href:document.querySelector('#next-guide a').getAttribute('href')})`;
    await loadVia('folder', 'negative/wrong_file'); const glMissing = await p.eval(GL);
    await loadVia('files', 'tiers/partner.zip'); const glPartner = await p.eval(GL);
    await loadVia('files', 'tiers/full.zip'); const glFull = await p.eval(GL);
    check(!glMissing.hidden && glMissing.href === '#guide-cvi' && !glPartner.hidden && glFull.hidden, 'next step: "What data does this need?" shown when the master or a feature\'s columns are missing, hidden for Full', [glMissing, glPartner, glFull]);
    // The next step's link opens the part too (closed first).
    await loadVia('files', 'tiers/partner.zip');
    await p.eval(`document.querySelector('details[data-guide-part="cvi"]').open = false; location.hash = ''; true`);
    await p.click(`document.querySelector('#next-guide a').click()`); await sleep(300);
    check(await p.eval(`document.querySelector('details[data-guide-part="cvi"]').open && location.hash === '#guide-cvi'`),
      'next step: its "What data does this need?" link opens the CVI part');
    // The one sample button, as a user's click, saved by Chrome (its bytes and loading back are checked in 9h).
    const DL = path.join(OUT, 'download');
    fs.rmSync(DL, { recursive: true, force: true }); fs.mkdirSync(DL, { recursive: true });
    await b.send('Browser.setDownloadBehavior', { behavior: 'allowAndName', downloadPath: DL, eventsEnabled: true });
    const download = () => new Promise(res => {
      let name = null; const t = setTimeout(() => { b.listeners.splice(b.listeners.indexOf(h), 1); res({ state: 'timeout', name }); }, 20000);
      const h = m => {
        if (m.method === 'Browser.downloadWillBegin') name = m.params.suggestedFilename;
        if (m.method === 'Browser.downloadProgress' && (m.params.state === 'completed' || m.params.state === 'canceled')) {
          clearTimeout(t); b.listeners.splice(b.listeners.indexOf(h), 1); res({ state: m.params.state, guid: m.params.guid, name });
        }
      };
      b.listeners.push(h);
    });
    const SAMPLE = fs.readFileSync(path.join(OUT, 'sample', gen.allInOne().fileName));
    const SAMPLE_STATUS = 'document.querySelector(\'[data-sample-status="all"]\')';
    let dl = download(); const dlStart = Date.now();
    await p.click(`document.querySelector('button[data-sample="all"]').click()`);
    let d1 = await dl; run.timings.sample_download_ms = Date.now() - dlStart;
    const got1 = d1.state === 'completed' ? fs.readFileSync(path.join(DL, d1.guid)) : Buffer.alloc(0);
    check(d1.state === 'completed' && Buffer.compare(got1, SAMPLE) === 0, 'sample: Chrome saves the all-in-one sample, byte-identical to the generator\'s', d1);
    await p.waitFor(`${SAMPLE_STATUS}.className === 'status ok'`, 5000, 'sample status').catch(() => null);
    const st1 = await p.eval(`({text:${SAMPLE_STATUS}.textContent, cls:${SAMPLE_STATUS}.className, disabled:document.querySelector('button[data-sample="all"]').disabled,
      geoScripts:document.querySelectorAll('script[src$="wa-counties.js"]').length, downloads:WSDA.landing.guide.state.downloads})`);
    check(/^Saved to your Downloads folder, unless your browser asks where: WSDA_sample_all_dashboards_synthetic\.zip \(\d+ KB of made-up data\)\. Load it under "Load your data" above\. If no file appears, your browser or IT policy blocked the download\.$/.test(st1.text) && st1.cls === 'status ok' && !st1.disabled
      && st1.geoScripts === 1 && st1.downloads === 1, 'sample: the page says what was saved and what to do next; the button is ready again', st1);
    // A second click makes the same file again, without reading the county file twice
    dl = download(); await p.click(`document.querySelector('button[data-sample="all"]').click()`);
    const d2 = await dl, got2 = d2.state === 'completed' ? fs.readFileSync(path.join(DL, d2.guid)) : Buffer.alloc(0);
    check(Buffer.compare(got2, SAMPLE) === 0 && await p.eval('document.querySelectorAll(\'script[src$="wa-counties.js"]\').length') === 1, 'sample: a second download is identical; the county file is read once', d2);
    // A failure while making the sample is reported with what to do
    await p.eval(`WSDA.landing.ALL_IN_ONE.build = async function(){ throw new Error('Simulated failure.'); }`);
    await p.click(`document.querySelector('button[data-sample="all"]').click()`); await sleep(200);
    const st3 = await p.eval(`({text:${SAMPLE_STATUS}.textContent, cls:${SAMPLE_STATUS}.className, disabled:document.querySelector('button[data-sample="all"]').disabled})`);
    check(st3.text === 'The sample bundle could not be made: Simulated failure. Reload the page and try again.' && st3.cls === 'status err' && !st3.disabled, 'sample: a failure is reported plainly', st3);
    await b.send('Browser.setDownloadBehavior', { behavior: 'default' });
    // Screenshots for review (not compared): the guide, and the next step with its link
    const GUIDE_DIR = path.join(OUT, 'guide'); fs.mkdirSync(GUIDE_DIR, { recursive: true });
    const shot = async name => fs.writeFileSync(path.join(GUIDE_DIR, name), Buffer.from((await b.send('Page.captureScreenshot', { format: 'png' }, p.sid)).data, 'base64'));
    await p.goto(PAGE); await p.waitFor('window.WSDA && WSDA.guide', 10000, 'landing page');
    await p.eval(`document.getElementById('guide').scrollIntoView()`); await sleep(200); await shot('guide.png');
    await p.eval(`document.querySelector('button[data-sample="all"]').scrollIntoView({block:'end'})`); await sleep(200); await shot('guide_sample.png');
    await loadVia('files', 'tiers/partner.zip');
    await p.eval(`document.getElementById('next-step').scrollIntoView()`); await sleep(200); await shot('next_step_partner.png');

    // 9. AB: one all-in-one bundle for every dashboard. Readiness on every card from one load, a
    //    ready card opens its dashboard with one click (the list in bundle.json is advice, not a lock), the release
    //    in the banner, the guide's all-in-one part and its download. Fixtures are written below from the page's own
    //    generator (local-test-artifacts/ab/fixtures/); screenshots for review in local-test-artifacts/ab/shots/.
    const AB = path.join(ROOT, 'local-test-artifacts', 'ab'), ABFIX = path.join(AB, 'fixtures'), SHOTS = path.join(AB, 'shots');
    fs.rmSync(ABFIX, { recursive: true, force: true }); fs.mkdirSync(SHOTS, { recursive: true });
    const ALL = gen.allInOne(), ALL_ZIP = path.join(OUT, 'sample', ALL.fileName);
    // A copy of the all-in-one folder with another bundle.json (or none), and extra files.
    const variant = (name, bundleJson, extra) => {
      const dir = path.join(ABFIX, name);
      for (const e of ALL.entries) {
        const rel = e.name.slice(ALL.folder.length + 1);
        if (!rel || e.dir || rel === 'bundle.json') continue;
        fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
        fs.writeFileSync(path.join(dir, rel), e.data);
      }
      if (bundleJson) fs.writeFileSync(path.join(dir, 'bundle.json'), JSON.stringify(bundleJson, null, 2) + '\n');
      for (const [rel, text] of Object.entries(extra || {})) { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); }
      return dir;
    };
    const CARDS = `Array.from(document.querySelectorAll('#profiles .card')).map(function(c){var b=c.querySelector('button[data-open]'),r=c.querySelector('.card-ready'),n=c.querySelector('.card-note');
      return {id:c.getAttribute('data-profile'), button:b?b.textContent:null, direct:b?b.getAttribute('data-direct'):null, disabled:b?b.disabled:null,
        help:(c.querySelector('.card-open-help')||{}).textContent||null, ready:r&&!r.hidden?r.textContent:null, kind:r?r.getAttribute('data-ready'):null,
        note:n.hidden?null:n.textContent, unlisted:n.classList.contains('unlisted'), routed:c.classList.contains('routed')};})`;
    const byCard = (cs, id) => cs.find(c => c.id === id);
    // Waits until every available card shows its readiness (none "Checking…"), and returns how long that took.
    const cardsSettled = async () => {
      const t0 = Date.now();
      await p.waitFor(`!WSDA.landing.state.loading && !WSDA.landing.checklist.state.busy && ${CARDS}.filter(c=>c.button).every(c=>c.ready && c.kind!=='checking')`, 15000, 'card readiness');
      return { ms: Date.now() - t0, cards: await p.eval(CARDS) };
    };
    const BANNER = `(function(){var b=document.getElementById('bundle-banner');return b.hidden?null:b.textContent;})()`;
    const INFRA_SNAP = `(async()=>{const a=WSDA.infrastructure,files={};for(const [id,d] of Object.entries(a.state.datasets))files[id]=d.name;
      const b=document.getElementById('bundle-banner');return {files,banner:b.hidden?null:b.textContent,search:location.search,name:window.name,
      status:document.getElementById('load-status').textContent};})()`;
    const infraReady = page => page.waitFor('window.WSDA&&WSDA.infrastructure&&WSDA.infrastructure.state.version>0&&!WSDA.infrastructure.state.loading&&!WSDA.infrastructure.checklist.state.busy', 20000, 'Infrastructure page');
    const tabFor = async re => { const t = (await b.pages(re))[0]; return t ? b.opened.find(o => o.targetId === t.targetId) : null; };
    const ALL_BANNER = 'All dashboards – synthetic sample bundle · prepared 2026-09-15 · covers 2024–2025 · release Synthetic sample, version 1, 2026-09-15';
    const FAC8 = ['fairgrounds', 'feedlots', 'manifest', 'markets', 'restricted', 'slaughterhouses', 'syn_custommeat', 'syn_disposal'];

    // 9a. The all-in-one ZIP: both dashboards listed and ready; CVI's checklist first; the release in the banner
    await p.front();
    const t9 = Date.now(); s = await pick('#files-input', [ALL_ZIP]); const loadMs = Date.now() - t9;
    let st9 = await cardsSettled(); let cs = st9.cards;
    run.timings.ab_all_in_one_load_ms = loadMs; run.timings.ab_readiness_after_load_ms = st9.ms;
    check(s.items.length === 10 && await p.eval('WSDA.landing.state.selected') === 'cvi' && await p.eval(BANNER) === ALL_BANNER,
      'AB all-in-one ZIP: ten files; CVI\'s checklist first (first listed); the release at the end of the banner', [s.items.length, await p.eval(BANNER)]);
    check(byCard(cs, 'cvi').ready === 'Ready.' && byCard(cs, 'cvi').kind === 'ready' && byCard(cs, 'cvi').button === 'Open the CVI map' && byCard(cs, 'cvi').direct === ''
      && byCard(cs, 'infrastructure').ready === 'Ready.' && byCard(cs, 'infrastructure').button === 'Open Infrastructure' && byCard(cs, 'infrastructure').direct === '1'
      && byCard(cs, 'infrastructure').help === 'Opens in a new tab with your files.' && !byCard(cs, 'infrastructure').disabled
      && byCard(cs, 'cvi').help === 'Opens in a new tab with your files.',
      'AB all-in-one ZIP: both cards say "Ready."; Infrastructure\'s button opens it directly', cs);
    check(byCard(cs, 'cvi').routed && byCard(cs, 'infrastructure').routed && !byCard(cs, 'emergency').routed && byCard(cs, 'emergency').ready === null
      && cs.every(c => !c.unlisted) && byCard(cs, 'cvi').note === 'Your bundle.json says the files are for this dashboard.',
      'AB all-in-one ZIP: both listed cards marked; Emergency untouched; no "Not listed"', cs);
    check(st9.ms < 1000, 'AB all-in-one ZIP: every card\'s readiness shown within a second of the checklist', st9.ms);
    await p.eval(`document.getElementById('profiles').scrollIntoView()`); await sleep(150);
    fs.writeFileSync(path.join(SHOTS, 'ab_cards_all_in_one.png'), Buffer.from((await b.send('Page.captureScreenshot', { format: 'png' }, p.sid)).data, 'base64'));

    // 9b. One click on the Infrastructure card opens Infrastructure with its files; the checklist stays on CVI
    let n9 = b.opened.length, infraTab = await tabFor(/infrastructure\/index\.html/);
    if (infraTab) await infraTab.page.eval('window.__stale = 1');
    await p.click(`document.querySelector('#profiles button[data-open="infrastructure"]').click()`);
    if (!infraTab) infraTab = await b.waitTab(n9);
    await infraTab.page.waitFor('!window.__stale', 20000, 'fresh Infrastructure page'); await infraReady(infraTab.page);
    let ig = await infraTab.page.eval(INFRA_SNAP);
    check(Object.keys(ig.files).sort().join() === FAC8.concat(['master']).sort().join() && ig.banner === ALL_BANNER && ig.name === 'wsda-infrastructure' && /^\?handoff=[0-9a-f]{32}$/.test(ig.search),
      'AB direct open: Infrastructure in its own tab with the eight facility files, the master and the banner, through the usual hand-off', ig);
    check(!/CVI-labeled/.test(ig.status), 'AB: a bundle listing both dashboards is not treated as a CVI-only bundle on the Infrastructure page', ig.status);
    check(await p.waitFor(`/^Infrastructure is open in its own tab with your files/.test(document.getElementById("next-opened").textContent)`, 5000, 'opened report').catch(() => false)
      && await p.eval('WSDA.landing.state.selected') === 'cvi', 'AB direct open: the landing page confirms it; its checklist is still CVI\'s', await p.eval('document.getElementById("next-opened").textContent'));
    // The CVI card (the selected one) opens the CVI map with the master, as before
    await p.front(); n9 = b.opened.length;
    let cviTab = await tabFor(/\/cvi\/index\.html/);
    if (cviTab) await cviTab.page.eval('window.__stale = 1');
    await p.click(`document.querySelector('#profiles button[data-open="cvi"]').click()`);
    if (!cviTab) cviTab = await b.waitTab(n9);
    await mapReady(cviTab, /CVI_Consolidated_Master\.csv/);
    let cm = await cviTab.page.eval(MAP);
    check(cm.master && cm.banner === ALL_BANNER && cm.received && cm.received.datasets.includes('master') && cm.received.facilities.length === 7 && await cviTabs() === 1,
      'AB: the CVI card opens the CVI map with the master and the facility layers; one CVI tab', cm.received);

    // The Infrastructure page loading files itself: a bundle that lists both dashboards is not called "CVI-labeled";
    // the Full tier (CVI only) is, which shows the check can see the message. Every status line is recorded, since a
    // later line replaces it.
    const tDirect = Date.now();
    const direct = await b.newTab(new URL('infrastructure/index.html', PAGE).href);
    await direct.page.front();
    await direct.page.waitFor('!!(window.WSDA && WSDA.infrastructure)', 15000, 'Infrastructure page');   // a true/false: the object cannot be returned by value
    run.timings.ab_direct_infrastructure_ready_ms = Date.now() - tDirect;
    await direct.page.eval(`window.__lines=[];new MutationObserver(function(){__lines.push(document.getElementById('load-status').textContent);})
      .observe(document.getElementById('load-status'),{childList:true,characterData:true,subtree:true});true`);
    const directLines = async zip => {
      const v = await direct.page.eval('WSDA.infrastructure.state.version');
      await direct.page.eval('window.__lines=[];true');
      await direct.page.setFiles('#files-input', [zip]);
      await infraReady(direct.page); await direct.page.waitFor('WSDA.infrastructure.state.version > ' + v, 15000, 'Infrastructure load');
      return direct.page.eval('window.__lines');
    };
    const linesAll = await directLines(ALL_ZIP), linesFull = await directLines(path.join(OUT, 'tiers', 'full.zip'));
    check(linesAll.length > 0 && !linesAll.some(t => /CVI-labeled/.test(t)) && linesFull.some(t => /CVI-labeled/.test(t)),
      'AB: on the Infrastructure page, the all-in-one bundle is not called "CVI-labeled"; the CVI-only Full tier is', { linesAll, linesFull });
    await b.closeTab(direct.targetId);

    // 9c. The all-in-one as a folder (subfolders cvi/ and facilities/): the same readiness
    await p.front();
    s = await pick('#folder-input', [variant('all_folder', JSON.parse(ALL.bundleJson))]);
    cs = (await cardsSettled()).cards;
    check(s.items.length === 10 && s.items.some(i => /\/cvi\/CVI_Consolidated_Master\.csv$/.test(i.path)) && s.items.filter(i => /\/facilities\//.test(i.path)).length === 8
      && byCard(cs, 'cvi').ready === 'Ready.' && byCard(cs, 'infrastructure').ready === 'Ready.' && byCard(cs, 'infrastructure').direct === '1',
      'AB all-in-one folder: subfolders read; both cards "Ready."', { paths: s.items.map(i => i.path), cs });

    // 9d. Advice, not a lock: the Full tier says "cvi" only, yet Infrastructure is ready and opens with one click
    await loadVia('files', 'tiers/full.zip');
    cs = (await cardsSettled()).cards;
    check(byCard(cs, 'infrastructure').note === 'Not listed in this bundle.' && byCard(cs, 'infrastructure').unlisted && !byCard(cs, 'infrastructure').routed
      && byCard(cs, 'infrastructure').ready === 'Ready.' && byCard(cs, 'infrastructure').direct === '1' && byCard(cs, 'cvi').routed,
      'AB advice: an unlisted dashboard says "Not listed in this bundle." and still opens directly', cs);
    await p.eval(`document.getElementById('profiles').scrollIntoView()`); await sleep(150);
    fs.writeFileSync(path.join(SHOTS, 'ab_cards_full_tier_unlisted.png'), Buffer.from((await b.send('Page.captureScreenshot', { format: 'png' }, p.sid)).data, 'base64'));
    await infraTab.page.eval('window.__stale = 1');
    await p.click(`document.querySelector('#profiles button[data-open="infrastructure"]').click()`);
    await infraTab.page.waitFor('!window.__stale', 20000, 'fresh Infrastructure page'); await infraReady(infraTab.page);
    ig = await infraTab.page.eval(INFRA_SNAP);
    check(Object.keys(ig.files).sort().join() === FAC8.concat(['master']).sort().join() && ig.banner === 'Full – synthetic test bundle · prepared 2026-09-15 · covers 2024–2025' && (await b.pages(/infrastructure\/index\.html/)).length === 1,
      'AB advice: the unlisted Infrastructure opens with the files; its tab is reused', ig);

    // 9e. A bundle listing Infrastructure only: its checklist first; CVI unlisted, ready, and opens directly with the master
    await p.front();
    s = await pick('#folder-input', [variant('infra_only_listed', { label: 'Facilities first', profiles: ['infrastructure'] })]);
    cs = (await cardsSettled()).cards;
    check(await p.eval('WSDA.landing.state.selected') === 'infrastructure' && byCard(cs, 'cvi').note === 'Not listed in this bundle.' && byCard(cs, 'cvi').ready === 'Ready.'
      && byCard(cs, 'cvi').direct === '1' && byCard(cs, 'cvi').button === 'Open the CVI map' && byCard(cs, 'infrastructure').routed,
      'AB: "profiles": ["infrastructure"]: Infrastructure\'s checklist first; CVI unlisted but ready', cs);
    await cviTab.page.eval('window.__stale = 1');
    await p.click(`document.querySelector('#profiles button[data-open="cvi"]').click()`);
    await mapReady(cviTab, /CVI_Consolidated_Master\.csv/);
    cm = await cviTab.page.eval(MAP);
    check(cm.master && cm.banner === 'Facilities first' && cm.received.datasets.includes('master') && await p.eval('WSDA.landing.state.selected') === 'infrastructure',
      'AB direct open of CVI from Infrastructure\'s checklist: the master arrives; the checklist stays on Infrastructure', cm.received);

    // 9f. Readiness that is not "Ready.": a missing master, and a choice to make
    await p.front();
    const infraOnly = path.join(ROOT, 'test-tables', 'infrastructure_synthetic.zip');
    await pick('#files-input', [infraOnly]);
    cs = (await cardsSettled()).cards;
    check(await p.eval('WSDA.landing.state.selected') === 'infrastructure' && byCard(cs, 'cvi').ready === 'Needs: the CVI master table (CVI_Consolidated_Master.csv).'
      && byCard(cs, 'cvi').kind === 'needs' && byCard(cs, 'cvi').button === 'Check files for CVI Traceability' && byCard(cs, 'cvi').direct === ''
      && byCard(cs, 'cvi').note === 'Not listed in this bundle.' && byCard(cs, 'cvi').help === 'Checks the loaded files for this dashboard.',
      'AB: Infrastructure\'s own sample: the CVI card names the missing master and keeps "Check files for"', cs);
    // Two masters: the selected CVI card asks for the choice below; Infrastructure has no facility file
    await pick('#files-input', [path.join(ROOT, 'tests', 'synthetic', 'cvi_master_small.csv'), path.join(ROOT, 'tests', 'synthetic', 'cvi_master_wa39.csv')]);
    cs = (await cardsSettled()).cards;
    check(byCard(cs, 'cvi').ready === 'Choose a file in Datasets below.' && byCard(cs, 'cvi').kind === 'choose'
      && byCard(cs, 'infrastructure').ready === 'Needs: at least one recognized facility file (a manifest supplies no points).' && byCard(cs, 'infrastructure').button === 'Check files for Infrastructure',
      'AB: two masters: CVI asks for a choice in Datasets below; Infrastructure names what it needs', cs);
    // Two feedlot files and nothing else, in a bundle for CVI: Infrastructure (not selected) needs a choice first
    const feed = n => 'name,lat,long\nSynthetic Feedlot ' + n + ',47.25,-122.35\n';
    const twoFeed = path.join(ABFIX, 'two_feedlots');
    for (const [rel, text] of [['a/wa_state_feedlots.csv', feed('A')], ['b/wa_state_feedlots.csv', feed('B')], ['bundle.json', '{ "profiles": ["cvi"] }\n']]) {
      fs.mkdirSync(path.dirname(path.join(twoFeed, rel)), { recursive: true }); fs.writeFileSync(path.join(twoFeed, rel), text);
    }
    await pick('#folder-input', [twoFeed]);
    cs = (await cardsSettled()).cards;
    check(await p.eval('WSDA.landing.state.selected') === 'cvi' && byCard(cs, 'infrastructure').ready === 'Choose a file first: click the button below to check.'
      && byCard(cs, 'infrastructure').kind === 'choose' && byCard(cs, 'infrastructure').button === 'Check files for Infrastructure' && byCard(cs, 'infrastructure').direct === '',
      'AB: two feedlot files: the Infrastructure card asks for a choice first and keeps "Check files for"', cs);
    // A choice made in the checklist is used for the other card too (as a switch would): its readiness is worked out again
    const key0 = await p.eval('WSDA.landing.state.readyKey');
    const feedChoice = await p.eval(`WSDA.landing.checklist.state.result.datasets.find(d=>d.id==='feedlots').options[0].id`);
    await p.eval(`WSDA.landing.checklist.choose('feedlots', ${JSON.stringify(feedChoice)})`);
    cs = (await cardsSettled()).cards;
    check(await p.eval('WSDA.landing.state.readyKey') !== key0 && /^Ready/.test(byCard(cs, 'infrastructure').ready) && byCard(cs, 'infrastructure').direct === '1',
      'AB: after the choice in CVI\'s checklist, the Infrastructure card is ready and opens directly', cs);
    // A non-ready card's button still switches the checklist (no tab opens)
    await pick('#files-input', [infraOnly]); await cardsSettled();
    n9 = b.opened.length;
    await p.click(`document.querySelector('#profiles button[data-open="cvi"]').click()`);
    await p.waitFor(`WSDA.landing.state.selected === 'cvi' && !WSDA.landing.state.loading && !WSDA.landing.checklist.state.busy`, 10000, 'switched to CVI');
    await sleep(300);
    check(b.opened.length === n9 && await p.eval(`document.getElementById('next-text').textContent`) === 'The CVI map needs the CVI master table (CVI_Consolidated_Master.csv), and none of your files is it. Add that file, then choose all your files again, together.',
      'AB: a card that is not ready rechecks the files for its dashboard, as before; no tab opens', await p.eval(`document.getElementById('next-text').textContent`));

    // 9g. Release fields with problems: plain notes, the banner without them, the files still load
    s = await pick('#folder-input', [variant('bad_release', { label: 'Odd release', release: { name: 'R', date: '2026-13-01', level: 'x' } })]);
    const notes9 = await p.eval(`Array.from(document.querySelectorAll('#checklist-notes li')).map(l=>l.textContent)`);
    check(await p.eval(BANNER) === 'Odd release · release R' && notes9.some(t => /"release" entries not understood and ignored: level/.test(t)) && notes9.some(t => /"release" "date" is not a date/.test(t)) && s.items.length === 10,
      'AB release: a bad date and an unknown entry are noted; the rest is shown; the files load', [await p.eval(BANNER), notes9]);
    // Old and new names given together, disagreeing: "profiles" wins, with a note
    s = await pick('#folder-input', [variant('profile_and_profiles', { profile: 'emergency', profiles: ['infrastructure', 'cvi'] })]);
    cs = (await cardsSettled()).cards;
    check(await p.eval('WSDA.landing.state.selected') === 'infrastructure' && (await p.eval(`document.getElementById('checklist-notes').textContent`)).includes('"profiles" was used')
      && byCard(cs, 'cvi').routed && byCard(cs, 'infrastructure').routed && !byCard(cs, 'emergency').routed, 'AB: "profile" and "profiles" disagree: the list is used, with a note', cs);

    // 9g2. More readiness cases: competing files, stale answers, files that cannot be checked, a dashboard in preparation.
    // The all-in-one folder plus a second feedlots file: Infrastructure can draw, but asks for the choice first
    s = await pick('#folder-input', [variant('second_feedlots', { profiles: ['cvi', 'infrastructure'] }, { 'extra/wa_state_feedlots.csv': feed('C') })]);
    cs = (await cardsSettled()).cards;
    check(s.items.length === 11 && byCard(cs, 'infrastructure').ready === 'Choose a file first (the Feedlots): click the button below to check.'
      && byCard(cs, 'infrastructure').kind === 'choose' && byCard(cs, 'infrastructure').direct === '' && byCard(cs, 'infrastructure').button === 'Check files for Infrastructure',
      'AB: two files claiming a facility layer: the other card asks for the choice first, no direct open', cs);
    await p.click(`document.querySelector('#profiles button[data-open="infrastructure"]').click()`);
    await p.waitFor(`WSDA.landing.state.selected === 'infrastructure' && !WSDA.landing.state.loading && !WSDA.landing.checklist.state.busy`, 10000, 'switched to Infrastructure');
    cs = (await cardsSettled()).cards;
    check(byCard(cs, 'infrastructure').ready === 'Choose a file in Datasets below for the Feedlots.' && byCard(cs, 'infrastructure').kind === 'choose',
      'AB: once switched, the Infrastructure card says where to choose', cs);
    // An answer worked out for older files is never shown. Every change of the Infrastructure card's line is
    // recorded with the checklist's version and the version its answer was worked out for.
    s = await pick('#files-input', [ALL_ZIP]); await cardsSettled();
    await p.eval(`(function(){window.__abLines=[];var el=document.querySelector('#profiles .card[data-profile="infrastructure"] .card-ready');
      new MutationObserver(function(){var r=WSDA.landing.state.ready.infrastructure;window.__abLines.push({text:el.hidden?null:el.textContent,
        cl:WSDA.landing.checklist.state.version,ready:r?r.version:null});}).observe(el,{childList:true,characterData:true,subtree:true,attributes:true});})()`);
    const masterId = await p.eval(`WSDA.landing.checklist.state.result.files.find(f=>f.dataset==='master').id`);
    await p.eval(`WSDA.landing.checklist.assign(${JSON.stringify(masterId)}, 'master')`);
    cs = (await cardsSettled()).cards;
    const lines9 = await p.eval('window.__abLines');
    check(lines9.length > 0 && lines9.every(l => l.text === null || l.text === 'Checking…' || l.ready === l.cl) && byCard(cs, 'infrastructure').ready === 'Ready.',
      'AB: after a pick, the other card says "Checking…" until its answer for the new files is ready', lines9);
    // Files that cannot be checked: no card keeps "Checking…" or an older answer (the status says why)
    await p.eval(`window.__rec = WSDA.recognize.recognize; WSDA.recognize.recognize = function(){ return Promise.reject(new Error('injected')); }`);
    s = await pick('#files-input', [ALL_ZIP]);
    await p.waitFor('!WSDA.landing.checklist.state.busy', 10000, 'failed check');
    cs = await p.eval(CARDS);
    const failText = await p.eval(`document.getElementById('load-results').textContent`);
    await p.eval('WSDA.recognize.recognize = window.__rec');
    check(cs.filter(c => c.button).every(c => c.ready === null) && /could not be checked: injected/.test(failText),
      'AB: when the files cannot be checked, no card shows a readiness line', [cs, failText]);
    // A listed dashboard in preparation says it cannot be opened yet
    s = await pick('#folder-input', [variant('emergency_and_cvi', { profiles: ['emergency', 'cvi'] })]);
    cs = (await cardsSettled()).cards;
    check(byCard(cs, 'emergency').note === 'Listed in this bundle; in preparation, so it cannot be opened yet.' && byCard(cs, 'emergency').routed
      && byCard(cs, 'cvi').note === 'Your bundle.json says the files are for this dashboard.' && await p.eval('WSDA.landing.state.selected') === 'cvi',
      'AB: a listed Emergency card says it cannot be opened yet; CVI gets the checklist', cs);

    // 9h. The guide's all-in-one part and its download
    await p.goto(PAGE); await p.waitFor('window.WSDA && WSDA.guide', 10000, 'landing page');
    const gp = await p.eval(`(function(){var all=document.getElementById('guide-all'),cvi=document.getElementById('guide-cvi'),sec=document.getElementById('guide-section');
      return {first: !!all && !!cvi && (all.compareDocumentPosition(cvi) & Node.DOCUMENT_POSITION_FOLLOWING) > 0, button:(document.querySelector('button[data-sample="all"]')||{}).textContent,
        safety:(document.querySelector('.guide-safety')||{}).textContent, curator:document.querySelector('[data-guide-curator]').textContent,
        curatorOpen:document.querySelector('[data-guide-curator]').open, layout:document.querySelector('pre.guide-layout').textContent};})()`);
    check(gp.first && gp.button === 'Download a sample bundle (ZIP)' && gp.safety === 'This viewer does not make a bundle safe to share (see "For people preparing bundles" below).'
      && /labels, not protection/.test(gp.curator) && !gp.curatorOpen && /facilities\//.test(gp.layout), 'AB guide: the part comes first, the one sample button, the safety note in one line and in full in the folded curator\'s details', gp);
    await b.send('Browser.setDownloadBehavior', { behavior: 'allowAndName', downloadPath: DL, eventsEnabled: true });
    dl = download();
    await p.click(`document.querySelector('button[data-sample="all"]').click()`);
    const d9 = await dl, got9 = d9.state === 'completed' ? fs.readFileSync(path.join(DL, d9.guid)) : Buffer.alloc(0);
    const want9 = fs.readFileSync(ALL_ZIP);
    check(d9.state === 'completed' && d9.name === ALL.fileName && Buffer.compare(got9, want9) === 0, 'AB guide: Chrome saves the all-in-one sample, byte-identical to the generator\'s', d9);
    await p.waitFor(`document.querySelector('[data-sample-status="all"]').className === 'status ok'`, 5000, 'all-in-one status').catch(() => null);
    check(/^Saved to your Downloads folder, unless your browser asks where: WSDA_sample_all_dashboards_synthetic\.zip \(\d+ KB of made-up data\)\. Load it under "Load your data" above\. If no file appears, your browser or IT policy blocked the download\.$/.test(await p.eval(`document.querySelector('[data-sample-status="all"]').textContent`)),
      'AB guide: the page says what was saved');
    await b.send('Browser.setDownloadBehavior', { behavior: 'default' });
    const saved9 = path.join(DL, ALL.fileName); fs.writeFileSync(saved9, got9);
    s = await pick('#files-input', [saved9]);
    cs = (await cardsSettled()).cards;
    check(s.items.length === 10 && byCard(cs, 'cvi').ready === 'Ready.' && byCard(cs, 'infrastructure').ready === 'Ready.', 'AB guide: the downloaded sample loads back with both dashboards ready', cs);
    await p.eval(`document.querySelector('details[data-guide-part="all"]').open = true; document.getElementById('guide-all').scrollIntoView(); document.querySelector('[data-guide-curator]').open = true;`); await sleep(200);
    fs.writeFileSync(path.join(SHOTS, 'ab_guide_all_in_one.png'), Buffer.from((await b.send('Page.captureScreenshot', { format: 'png' }, p.sid)).data, 'base64'));

    // 6. Network, CSP and errors over the whole session (every tab)
    const nonLocal = b.log.requests.filter(u => !/^(blob|data|about):/.test(u) && !u.startsWith(SITE_BASE));
    check(nonLocal.length === 0, 'no requests outside the site folder (' + (PAGE_ORIGIN ? 'same origin and path' : 'local files') + ')', nonLocal);
    check(b.log.csp.length === 0, 'no CSP violations', b.log.csp);
    check(b.log.exceptions.length === 0, 'no exceptions', b.log.exceptions);
    run.requestSchemes = [...new Set(b.log.requests.map(u => u.split(':')[0]))];
  } catch (e) {
    check(false, 'run aborted', String(e && e.stack || e)); if (process.env.F1_TRACE) { console.log(b.log.exceptions); try { console.log(await p.eval('JSON.stringify({s:document.getElementById("load-status").textContent, l:WSDA.landing.state.loading, v:WSDA.landing.state.version, cb:WSDA.landing.checklist.state.busy})')); } catch (x) { console.log(x); } }
  } finally {
    await b.close();
  }
  Object.assign(run, { passed: pass, failed: fail, failures, notes, finished: new Date().toISOString() });
  fs.writeFileSync(path.join(OUT, 'browser_run.json'), JSON.stringify(run, null, 1));
  failures.forEach(f => console.log('  FAIL ' + f));
  notes.forEach(n => console.log('  note ' + n));
  console.log(b.version + ' | ' + run.page + ' | timings ' + JSON.stringify(run.timings) + ' | request schemes: ' + (run.requestSchemes || []).join(', '));
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
