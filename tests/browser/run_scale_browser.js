#!/usr/bin/env node
'use strict';
// Scale suite: the pages with a master the size of the real one (50,000 synthetic rows, 39 columns, made by
// tests/synthetic/make_scale_master.js), in installed Chrome through the DevTools protocol, offline, foreground
// only. It times the main actions and records the times; a step fails only when it takes over 30 seconds (a
// strict limit would trip under a busy computer's load, and the times are what matter):
//   handoff   the landing page reads the file, then "Open the CVI map" until the CVI tab has drawn it
//   load      the CVI page's own "Choose File" until "Master loaded", and until WA State has drawn
//   play      Browse over time, Play from the first quarter to the last at the fastest speed (the time the page
//             spends drawing the frames is the time counted, from its drawTotalMs hook; Play's own pauses are not)
//   charts    the map and charts side by side, until the charts are drawn
//   focus     County Focus with all 39 counties picked, until the map has drawn their premises
//   gif       Export with only the time-series GIF of WA State, until the export is done
//   lookup    Premise Lookup: one site with the default buffer, Run query until the result is drawn
// Downloads are refused (nothing is written to a Downloads folder).
//
// Usage (repository root): node tests/synthetic/make_scale_master.js, then node tests/browser/run_scale_browser.js
//   Hosted mode: node tests/browser/serve_case_strict.js, then SCALE_SITE_URL=http://127.0.0.1:8765/ node ...
// Writes local-test-artifacts/scale/run.json (the times and the checks).
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join(ROOT, 'local-test-artifacts', 'scale');
const MASTER = path.join(OUT, 'cvi_master_50000.csv');
const SITE = process.env.SCALE_SITE_URL || pathToFileURL(path.join(ROOT, 'site')).href + '/';
const LANDING = new URL('index.html', SITE).href;
const CVI = new URL('cvi/index.html', SITE).href;
const CHROME = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const LIMIT_MS = 30000;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Chrome through the DevTools protocol (as the MC suite), with the tabs a page opens attached too ─────────
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
  // Every tab's requests, exceptions and policy reports go into one log.
  const log = { requests: [], exceptions: [], csp: [] };
  const watch = sid => listeners.push(m => {
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
  const DOMAINS = ['Network.enable', 'Runtime.enable', 'Log.enable', 'Page.enable', 'DOM.enable'];
  function makePage(sid) {
    const page = {
      async goto(url) {
        const done = new Promise(res => {
          const h = m => {
            if (m.method === 'Page.loadEventFired' && m.sessionId === sid) {
              listeners.splice(listeners.indexOf(h), 1);
              res();
            }
          };
          listeners.push(h);
        });
        await send('Page.navigate', { url }, sid);
        await Promise.race([done, sleep(15000)]);
      },
      // userGesture: as a user's click, so the page may open a tab.
      async eval(expr, userGesture) {
        const r = await Promise.race([
          send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: !!userGesture }, sid),
          sleep(120000).then(() => { throw new Error('eval timed out: ' + expr.slice(0, 120)); })
        ]);
        if (r.exceptionDetails) {
          throw new Error('eval: ' + ((r.exceptionDetails.exception || {}).description || r.exceptionDetails.text));
        }
        return r.result.value;
      },
      async waitFor(expr, ms, label) {
        const t0 = Date.now();
        while (Date.now() - t0 < ms) {
          try {
            if (await page.eval('!!(' + expr + ')')) return true;
          } catch (e) { /* not ready yet */ }
          await sleep(50);
        }
        throw new Error('timeout: ' + label);
      },
      async setFiles(selector, files) {
        const { root } = await send('DOM.getDocument', { depth: 1 }, sid);
        const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector }, sid);
        await send('DOM.setFileInputFiles', { files, nodeId }, sid);
      },
      async front() { await send('Page.bringToFront', {}, sid); }
    };
    return page;
  }
  // Tabs opened later (by the landing page) are attached paused, so nothing they ask for is missed.
  const opened = [];
  listeners.push(async m => {
    if (m.method !== 'Target.attachedToTarget' || m.sessionId || m.params.targetInfo.type !== 'page') return;
    const s2 = m.params.sessionId;
    watch(s2);
    for (const d of DOMAINS) await send(d, {}, s2);
    await send('Runtime.runIfWaitingForDebugger', {}, s2);
    opened.push(makePage(s2));
  });
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId: sid } = await send('Target.attachToTarget', { targetId, flatten: true });
  watch(sid);
  for (const d of DOMAINS) await send(d, {}, sid);
  await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
  await send('Browser.setDownloadBehavior', { behavior: 'deny' });
  return {
    version: version.Browser, log, page: makePage(sid), opened,
    async waitTab(n) {
      for (let i = 0; i < 600 && opened.length <= n; i++) await sleep(50);
      if (opened.length <= n) throw new Error('no new tab');
      return opened[n];
    },
    async close() {
      try { await send('Browser.close'); } catch (e) { /* closing */ }
      await exited(5000);
      killGroup();
      await exited(3000);
      fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  };
}

// ── Checks and times ─────────────────────────────────────────────────────────────────────────────────────────
let passed = 0, failed = 0;
const failures = [];
function check(ok, name, detail) {
  if (ok) passed++;
  else {
    failed++;
    failures.push(name + (detail === undefined ? '' : ' :: ' + JSON.stringify(detail).slice(0, 400)));
  }
}
const times = {};
// Records a step's time (milliseconds) and checks it against the limit.
function timed(step, ms, note) {
  times[step] = Object.assign({ ms: Math.round(ms) }, note || {});
  check(ms < LIMIT_MS, step + ': under 30 seconds', times[step]);
}

// The CVI page has drawn the loaded master itself on WA State (a drawing made while the file was still being read
// does not count: its drawnMaster hook is the master the last drawing used).
const WA_DRAWN = 'CVIWA.state.master && !CVIWA.state.loading && CVIWA.state.drawnMaster === CVIWA.state.master';
const ROWS = 'CVIWA.state.master && CVIWA.state.master.physicalRows';

async function stepHandoff(b) {
  const p = b.page;
  await p.goto(LANDING);
  await p.waitFor('window.WSDA && WSDA.landing && WSDA.landing.state', 15000, 'landing page ready');
  const v0 = await p.eval('WSDA.landing.state.version');
  let t0 = Date.now();
  await p.setFiles('#files-input', [MASTER]);
  await p.waitFor('!WSDA.landing.state.loading && WSDA.landing.state.version > ' + v0 + ' && '
    + '!document.getElementById("next-open").hidden', LIMIT_MS * 2, 'landing page read the file');
  timed('landing page reads the file', Date.now() - t0);
  const n = b.opened.length;
  t0 = Date.now();
  await p.eval('document.getElementById("next-open").click(); true', true);
  const tab = await b.waitTab(n);
  await tab.waitFor('window.CVIWA && CVIWA.state && ' + WA_DRAWN, LIMIT_MS * 2, 'CVI tab drew the handed-off file');
  timed('hand-off to the CVI tab, until WA State is drawn', Date.now() - t0);
  check(await tab.eval(ROWS) === 50000, 'hand-off: 50,000 rows in the CVI tab', await tab.eval(ROWS));
  return tab;
}

async function stepLoad(p) {
  await p.goto(CVI);
  await p.waitFor('window.CVIWA && CVIWA.state && CVIWA.state.mapHandle && CVIWA.state.mapHandle.ready', 15000, 'CVI page ready');
  const t0 = Date.now();
  await p.setFiles('#file-input', [MASTER]);
  await p.waitFor('/^Master loaded/.test(document.getElementById("master-status").textContent)', LIMIT_MS * 2, 'master loaded');
  timed('load the master on the CVI page', Date.now() - t0);
  await p.waitFor(WA_DRAWN, LIMIT_MS * 2, 'WA State drawn');
  timed('load, until WA State is drawn', Date.now() - t0);
  const status = await p.eval('document.getElementById("master-status").textContent');
  check(await p.eval(ROWS) === 50000 && /50,000 rows in the file/.test(status), 'load: 50,000 rows, said in the status', status);
}

async function stepPlay(p) {
  await p.eval(`(() => {
    document.querySelector('input[name="period-mode"][value="browse"]').click();
    const speed = document.getElementById('time-speed');
    speed.value = [...speed.options].map(o => o.value).sort((a, b) => a - b)[0];
    speed.dispatchEvent(new Event('change', { bubbles: true }));
    // Play goes on from the period shown: start at the first, so it steps through all of them.
    const slider = document.getElementById('time-slider');
    slider.value = slider.min;
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await sleep(1500);
  const before = await p.eval('({ frames: CVIWA.state.frames || 0, speed: CVIWA.state.speed, '
    + 'version: CVIWA.state.version, drawn: CVIWA.state.drawTotalMs || 0 })');
  const t0 = Date.now();
  await p.eval('document.getElementById("time-play").click(); true');
  await p.waitFor('!CVIWA.state.playing', 300000, 'Play reached the last period');
  // Each frame is drawn once after its step: wait for the last frame's drawing too.
  const frames = (await p.eval('CVIWA.state.frames || 0')) - before.frames;
  await p.waitFor('CVIWA.state.version >= ' + (before.version + frames), LIMIT_MS * 2, 'last frame drawn');
  const total = Date.now() - t0;
  const drawing = (await p.eval('CVIWA.state.drawTotalMs')) - before.drawn;
  timed('Browse Play, the time spent drawing its frames', drawing,
    { frames, speedMs: before.speed, totalMs: total, perFrameMs: frames ? Math.round(drawing / frames) : null });
  check(frames >= 15, 'Play: every quarter of four years shown', frames);
  await p.eval('document.querySelector(\'input[name="period-mode"][value="single"]\').click(); true');
  await sleep(1500);
}

async function stepCharts(p) {
  const v = await p.eval('CVIWA.state.chartsVersion');
  const t0 = Date.now();
  await p.eval('document.querySelector(\'.layout-switch [data-layout="split"]\').click(); true');
  await p.waitFor('CVIWA.state.chartsVersion > ' + v, LIMIT_MS * 2, 'charts drawn');
  timed('the charts beside the map', Date.now() - t0, { drawnInMs: Math.round(await p.eval('CVIWA.state.chartsMs')) });
  await p.eval('document.querySelector(\'.layout-switch [data-layout="map"]\').click(); true');
  await sleep(500);
}

async function stepFocus(p) {
  await p.eval('document.getElementById("show-focus").click(); true');
  await p.waitFor('CVIWA.state.focusHandle && CVIWA.state.focusHandle.ready', 20000, 'County Focus map ready');
  await sleep(800);
  const v = await p.eval('CVIWA.focusState.version');
  const t0 = Date.now();
  await p.eval('[...document.querySelectorAll("#fo-counties input")].forEach(c => { if (!c.checked) c.click(); }); true');
  await p.waitFor('CVIWA.focusState.counties.length === 39 && CVIWA.focusState.version > ' + v + ' && '
    + 'CVIWA.state.focusHandle.map.loaded() && !CVIWA.state.focusHandle.map.isMoving()', LIMIT_MS * 2, 'County Focus drawn');
  timed('County Focus with all 39 counties', Date.now() - t0);
  check(await p.eval('CVIWA.focusState.counties.length') === 39, 'County Focus: 39 counties picked');
  await p.eval('document.getElementById("show-wa").click(); true');
  await p.waitFor('CVIWA.state.mapHandle && CVIWA.state.mapHandle.ready', 20000, 'WA State again');
  await sleep(800);
}

async function stepGif(p) {
  await p.eval(`(() => {
    document.querySelectorAll('input[name="export-format"]').forEach(c => { if (c.checked !== (c.value === 'branded_gif')) c.click(); });
    return true;
  })()`);
  const ready = await p.eval('document.getElementById("export-gif").checked && !document.getElementById("export-gif").disabled');
  check(ready, 'GIF: only the time-series GIF ticked');
  const before = await p.eval('CVIWA.state.lastExport && CVIWA.state.lastExport.name');
  const t0 = Date.now();
  await p.eval('document.getElementById("run-export").click(); true');
  await p.waitFor('!CVIWA.state.exporting && CVIWA.state.lastExport && CVIWA.state.lastExport.name !== ' + JSON.stringify(before),
    LIMIT_MS * 4, 'GIF export done');
  const e = await p.eval('({ written: CVIWA.state.lastExport.written, bytes: CVIWA.state.lastExport.bytes.length })');
  timed('Export the time-series GIF', Date.now() - t0, { bytes: e.bytes });
  check(e.written.some(f => /\.gif$/.test(f)), 'GIF: the ZIP holds the GIF', e.written);
}

async function stepLookup(p) {
  await p.eval('document.getElementById("show-lookup").click(); true');
  await p.waitFor('CVIWA.lookupState', 10000, 'Premise Lookup shown');
  await p.eval(`(() => {
    const set = (id, v) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); };
    set('lk-new-name', 'Synthetic site'); set('lk-new-lat', '46.46'); set('lk-new-long', '-120.74');
    document.getElementById('lk-add').click();
    return true;
  })()`);
  await p.waitFor('CVIWA.lookupState.sites.length === 1', 5000, 'site added');
  const before = await p.eval('CVIWA.lookupState.lastRun || null');
  const t0 = Date.now();
  await p.eval('document.getElementById("lk-run").click(); true');
  await p.waitFor('CVIWA.lookupState.result && CVIWA.lookupState.lastRun !== ' + JSON.stringify(before) + ' && '
    + 'CVIWA.lookupState.map && CVIWA.lookupState.map.drawn', LIMIT_MS * 2, 'Run query drawn');
  const res = await p.eval('({ status: CVIWA.lookupState.result.status, rows: (CVIWA.lookupState.result.matched || []).length })');
  timed('Premise Lookup, Run query', Date.now() - t0, res);
  check(res.status === 'ok' && res.rows > 0, 'Premise Lookup: matched rows found', res);
}

(async () => {
  if (!fs.existsSync(MASTER)) {
    console.error('Missing ' + path.relative(ROOT, MASTER) + ': run node tests/synthetic/make_scale_master.js first.');
    process.exit(2);
  }
  const b = await launch();
  const run = { chrome: b.version, site: SITE, started: new Date().toISOString() };
  try {
    await stepHandoff(b);
    await b.page.front();
    await stepLoad(b.page);
    await stepPlay(b.page);
    await stepCharts(b.page);
    await stepFocus(b.page);
    await stepGif(b.page);
    await stepLookup(b.page);
  } catch (e) {
    failed++;
    failures.push('run stopped: ' + (e && e.stack ? e.stack : e));
  } finally {
    check(!b.log.exceptions.length, 'pages: no exceptions', b.log.exceptions);
    check(!b.log.csp.length, 'pages: no Content Security Policy reports', b.log.csp);
    const outside = b.log.requests.filter(u => !/^(data:|blob:)/.test(u) && !u.startsWith(SITE));
    check(!outside.length, 'pages: no request outside the site', outside);
    await b.close();
  }
  Object.assign(run, { times, passed, failed, failures });
  fs.writeFileSync(path.join(OUT, 'run.json'), JSON.stringify(run, null, 1) + '\n');
  Object.entries(times).forEach(([k, t]) => console.log('  ' + k + ': ' + (t.ms / 1000).toFixed(1) + ' s'
    + (Object.keys(t).length > 1 ? ' ' + JSON.stringify(Object.assign({}, t, { ms: undefined })) : '')));
  failures.forEach(f => console.log('FAIL ' + f));
  console.log('Scale browser: ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch(e => {
  console.error(e);
  process.exit(1);
});
