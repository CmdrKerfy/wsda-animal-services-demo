#!/usr/bin/env node
'use strict';
// MC browser suite: chart cross-filtering on the CVI page (site/cvi/index.html) in installed
// Chrome, through the DevTools protocol, offline, foreground only (Chrome does not start from a background job).
// No packages. The rules themselves are checked against CVI in tests/node/run_mc_unit_tests.js; this suite checks
// that the page applies them.
//
// Parts (all by default; name some to run only those, for example: node tests/browser/run_mc_browser.js wa):
//   marks  every chart of every view: each mark a click filters by is a keyboard button with its exact values and what
//          a click does as hover and screen-reader text; "Non-WA" and grayed charts offer nothing
//   wa     WA State: a species bar (click, Enter, Space), a period point, a county (the spotlight); the map, value boxes
//          and strip equal the sidebar pick; the chip bar (×, Clear chart filters) in every layout; a filter dropped
//          when the sidebar removes its value; Browse and Compare; Reset All
//   flow   National Flow: a state's bar and a corridor's bar pick the state; the other states' lines dimmed; the other
//          charts filtered to the state
//   focus  County Focus: a premises, a corridor and a county; the premises highlighted on the map; the other charts
//          filtered; top premises grayed on the Partner tier
//   movement the WA State movement view on the movement fixture: lines and rings in
//          place of the circles, the "Lines shown" picker, badges 1 to 3 matching the corridor chart, hover, the
//          spotlight, a corridor click, the legend and the line under the map, Browse, Compare, the screenshot,
//          Reset All
//   exports with a chart filter on (WA species, period, spotlight; Flow state and species; County Focus premises):
//          the exported files as the matching sidebar pick or without the filter, Stats and export_params.json naming
//          the chart filters, the exported charts as the screen's with faint marks, Preview Charts the same, the corridor
//          chart with the movement view
//   perf   a 20,000-row master: a click redraws the charts within 1 second
//
// Usage (repository root, after the F1 unit run, which writes test-tables/):
//   node tests/browser/run_mc_browser.js [part ...]
//   Hosted mode: node tests/browser/serve_case_strict.js, then
//   MC_PAGE_URL=http://127.0.0.1:8765/cvi/index.html node tests/browser/run_mc_browser.js
// Writes local-test-artifacts/mc/browser/run.json (results) and screens/ (screenshots).
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join(ROOT, 'local-test-artifacts', 'mc', 'browser');
const PAGE = process.env.MC_PAGE_URL || pathToFileURL(path.join(ROOT, 'site', 'cvi', 'index.html')).href;
const CHROME = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const TIER_FULL = path.join(ROOT, 'test-tables', 'tier_full_master.csv');
const TIER_PARTNER = path.join(ROOT, 'test-tables', 'tier_partner_master.csv');
const MOVEMENT = path.join(ROOT, 'test-tables', 'cvi_master_movement.csv');
const ALL_PARTS = ['marks', 'wa', 'flow', 'focus', 'movement', 'exports', 'perf'];
const asked = process.argv.slice(2).filter(a => !a.startsWith('--'));
const PARTS = asked.length ? asked : ALL_PARTS;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Chrome through the DevTools protocol (as the S7 suite) ──────────────────────────────────────────────────
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
    // The whole page at a given width and height (a full-page screenshot).
    async screenshotFull(file, width, height) {
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }, sid);
      await sleep(200);
      const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true,
        clip: { x: 0, y: 0, width, height, scale: 1 } }, sid);
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
  if (process.env.MC_VERBOSE) console.log((ok ? 'ok   ' : 'FAIL ') + name);   // each check as it happens
  const part = name.split(':')[0];
  counts[part] = (counts[part] || 0) + 1;
  if (ok) {
    passed++;
  } else {
    failed++;
    failures.push(name + (detail === undefined ? '' : ' :: ' + JSON.stringify(detail).slice(0, 500)));
  }
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ── Page helpers ───────────────────────────────────────────────────────────────────────────────────────────
async function openPage(b) {
  await b.page.goto(PAGE);
  await b.page.waitFor('window.CVIWA && CVIWA.crossfilter && CVIWA.state && CVIWA.state.mapHandle', 15000, 'page ready');
}
// Loads a master CSV through the page's own "Choose File" and waits until every view has computed.
async function loadMaster(page, file) {
  const v = await page.eval('CVIWA.state.version');
  await page.setFiles('#file-input', [file]);
  await page.waitFor('CVIWA.state.master && !CVIWA.state.loading && CVIWA.state.version > ' + v, 20000, 'master loaded');
  await sleep(400);
}
// Map View switched by its button; County Focus gets its two busiest counties picked.
async function showView(p, view) {
  const id = { wa: 'show-wa', flow: 'show-flow', focus: 'show-focus' }[view];
  await p.eval(`document.getElementById('${id}').click(); true`);
  const handle = { wa: 'mapHandle', flow: 'flowHandle', focus: 'focusHandle' }[view];
  await p.waitFor(`CVIWA.state.${handle} && CVIWA.state.${handle}.ready`, 20000, view + ' map ready');
  if (view === 'focus') {
    await p.eval(`(() => {
      const fo = CVIWA.focusState, m = CVIWA.state.master;
      const rows = CVIWA.focus.summaryRows(m, Object.assign({}, fo, { counties: fo.countyChoices, rawSpecies: [] })) || [];
      const tally = new Map();
      rows.forEach(r => { const c = r.Movement === 'Inbound' ? r['Dest.County'] : r['Origin.County'];
        tally.set(c, (tally.get(c) || 0) + (r['Total.Animals'] || 0)); });
      const two = [...tally.keys()].sort((a, b) => tally.get(b) - tally.get(a)).slice(0, 2);
      [...document.querySelectorAll('#fo-counties input')].forEach(b => {
        const on = two.indexOf(b.value) >= 0;
        if (b.checked !== on) { b.checked = on; b.dispatchEvent(new Event('change')); }
      });
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
// After a click: the charts at once, the map after the page's 250 ms pause.
async function settle(p) {
  await sleep(500);
}

// The clickable marks of a chart on screen: each button's pick (kind and value from its id), state and texts.
const BUTTONS = id => `(() => {
  const svg = document.querySelector('#chart-grid .chart-card[data-chart="${id}"] svg');
  if (!svg) return null;
  return [...svg.querySelectorAll('.chart-pick')].map(b => {
    const key = b.getAttribute('data-pick'), bar = key.indexOf('|');
    return { id: key, kind: key.slice(0, bar), value: decodeURIComponent(key.slice(bar + 1)),
      pressed: b.getAttribute('aria-pressed'), role: b.getAttribute('role'), tab: b.getAttribute('tabindex'),
      hover: b.getAttribute('data-hover'), click: b.getAttribute('data-click'), aria: b.getAttribute('aria-label'),
      spot: b.getAttribute('data-spot'), spotClass: b.classList.contains('chart-spot'),
      faint: !!b.querySelector('.chart-mark[fill-opacity]'), inner: b.querySelectorAll('.chart-mark[data-hover]').length };
  });
})()`;
// The faint marks outside any button (an over-time chart's points, or a mark that cannot be clicked).
const FAINT_OUTSIDE = id => `(() => {
  const svg = document.querySelector('#chart-grid .chart-card[data-chart="${id}"] svg');
  return [...svg.querySelectorAll('.chart-mark')].filter(m => !m.closest('.chart-pick'))
    .map(m => m.getAttribute('fill-opacity') !== null);
})()`;
// Clicks a chart's button for a pick with a real mouse click on its target, scrolled into view. A missing button is a
// failed check (named after the part running), not a stop, so the checks after it still run.
let partNow = 'run';
async function clickMark(p, chart, kind, value) {
  const c = await p.eval(`(() => {
    const b = [...document.querySelectorAll('#chart-grid .chart-card[data-chart="${chart}"] .chart-pick')]
      .find(x => x.getAttribute('data-pick') === ${JSON.stringify(kind + '|' + encodeURIComponent(value))});
    if (!b) return null;
    b.scrollIntoView({ block: 'center' });
    const r = b.querySelector('.chart-hit').getBoundingClientRect();
    return { x: r.left + r.width * 0.6, y: r.top + r.height / 2 };
  })()`);
  check(!!c, partNow + ': a button to click for ' + chart + ' ' + kind + ' ' + value);
  if (!c) return false;
  await p.mouse('click', c.x, c.y);
  await settle(p);
  return true;
}
// The chip bar as shown.
const CHIPS = `(() => {
  const bar = document.getElementById('chart-filters');
  return { shown: !bar.hidden && bar.offsetParent !== null,
    chips: [...bar.querySelectorAll('.cf-chip')].map(c => c.firstChild.textContent),
    message: document.getElementById('chart-filters-msg').hidden ? null : document.getElementById('chart-filters-msg').textContent,
    clear: !document.getElementById('chart-filters-clear').hidden };
})()`;
// What a chart's button must say, from the chart model the page drew (CVIWA.state.charts) and the pick it stands for.
const EXPECTED_BUTTONS = id => `(() => {
  const W = CVIWA, st = W.state, view = st.view;
  const c = st.charts.charts.find(x => x.id === '${id}');
  if (!c || c.empty) return [];
  const marks = c.kind === 'bars' || c.kind === 'change' ? c.bars.map(b => ({ mark: b, hover: b.hover }))
    : c.kind === 'bars_by_direction' ? c.groups.map(g => ({ mark: g, hover: g.bars.map(b => b.hover).join('; ') }))
    : c.kind === 'bars_by_panel' ? [].concat(...c.panels.map(p => p.bars.map(b => ({ mark: b, hover: b.hover }))))
    : c.kind === 'lines' ? c.periods.map((p, i) => ({ mark: p, hover: c.series.map(s => s.hover[i]).join('; ') })) : [];
  const mode = view === 'wa' ? st.periodMode : view === 'flow' && W.flowState.browse ? 'browse' : 'single';
  return marks.map(m => {
    const pick = W.crossfilter.pickOf(view, c, m.mark, { periodMode: mode });
    if (!pick) return null;
    const spot = pick.kind === 'place' && view === 'wa'
      ? st.spotlightChoices.find(x => String(x).trim() === pick.value) : undefined;
    if (spot === undefined && pick.kind === 'place' && view === 'wa') return null;
    const on = pick.kind === 'place' && view === 'wa' ? st.spotlight.indexOf(spot) >= 0
      : W.crossfilter.isPicked(st.cf, view, pick);
    return { kind: pick.kind, value: pick.value, hover: m.hover, click: W.crossfilter.hoverText(view, pick, on),
      pressed: String(on), spot: spot === undefined ? null : spot };
  }).filter(Boolean);
})()`;

// The different "why not" hints on the over-time chart's points, [] when it has none.
const OVER_TIME_HINTS = `(() => {
  const svg = document.querySelector('#chart-grid .chart-card[data-chart="over_time"] svg');
  if (!svg) return null;
  return [...new Set([...svg.querySelectorAll('.chart-hit, .chart-mark')].map(m => m.getAttribute('data-click'))
    .filter(Boolean))];
})()`;

// ── Part: marks ────────────────────────────────────────────────────────────────────────────────────────────
// Every chart of every view, Full tier: each mark a click filters by is a keyboard button (role button, tab stop,
// not pressed) whose hover and screen-reader text are its exact values and what a click does; its marks carry no hover
// of their own; on WA State a county's button is S7's spotlight button. Then "Non-WA" and the grayed top premises.
async function checkButtons(p, view, prefix) {
  const charts = await p.eval('CVIWA.state.charts.charts.map(c => c.id)');
  for (const id of charts) {
    const got = await p.eval(BUTTONS(id));
    const want = await p.eval(EXPECTED_BUTTONS(id));
    const n = 'marks: ' + prefix + view + ' ' + id;
    check(got && got.length === want.length, n + ': one button per clickable mark', [got && got.length, want.length]);
    if (!got || got.length !== want.length) continue;
    check(got.every((g, i) => g.kind === want[i].kind && g.value === want[i].value), n + ': each button\'s pick');
    check(got.every((g, i) => g.hover === want[i].hover && g.click === want[i].click), n + ': hover text and what a click does',
      got.slice(0, 2).map((g, i) => [g.hover, want[i].hover, g.click, want[i].click]));
    check(got.every((g, i) => g.aria === want[i].hover + '. ' + want[i].click), n + ': screen-reader text');
    check(got.every((g, i) => g.role === 'button' && g.tab === '0' && g.pressed === want[i].pressed), n + ': keyboard buttons');
    check(got.every(g => g.inner === 0), n + ': the button carries the hover, not its marks');
    check(got.every((g, i) => (want[i].spot !== null) === g.spotClass && (want[i].spot === null || g.spot === want[i].spot)),
      n + ': WA State counties are spotlight buttons');
  }
}
async function partMarks(b) {
  const p = b.page;
  await openPage(b);
  await p.viewport(1400, 1000);
  await loadMaster(p, TIER_FULL);
  for (const view of ['wa', 'flow', 'focus']) {
    await showView(p, view);
    await setLayout(p, 'charts');
    await checkButtons(p, view, '');
    const ids = await p.eval('CVIWA.state.charts.charts.filter(c => !c.empty).map(c => c.id)');
    const withButtons = [];
    for (const id of ids) if ((await p.eval(BUTTONS(id))).length) withButtons.push(id);
    const wantClickable = { wa: ['species', 'top_places', 'over_time', 'emerging'], flow: ['species', 'top_places', 'over_time', 'corridors'],
      focus: ['species', 'top_premises', 'corridors', 'emerging'] }[view].filter(id => ids.indexOf(id) >= 0);
    check(same(withButtons, wantClickable), 'marks: ' + view + ' every drawn chart can be clicked', [withButtons, wantClickable]);
  }
  // Partner tier: no premises coordinates, so County Focus's top premises is grayed and has no button.
  await loadMaster(p, TIER_PARTNER);
  await showView(p, 'focus');
  const tp = await p.eval(`(() => ({ empty: CVIWA.state.charts.charts.find(c => c.id === 'top_premises').empty,
    buttons: document.querySelectorAll('#chart-grid .chart-card[data-chart="top_premises"] .chart-pick').length }))()`);
  check(tp.empty && tp.buttons === 0, 'marks: a grayed chart offers nothing to click', tp);
  await checkButtons(p, 'focus', 'Partner tier ');
  // "Non-WA": a copy of the Full tier whose largest Inbound row has the destination county "N/A".
  const lines = fs.readFileSync(TIER_FULL, 'utf8').replace(/\r?\n$/, '').split(/\r?\n/);
  const head = lines[0].split(','), at = name => head.indexOf(name);
  const k = lines.findIndex((l, i) => i > 0 && !/"/.test(l) && l.split(',')[at('Movement')] === 'Inbound');
  const cells = lines[k].split(',');
  cells[at('Dest.County')] = 'N/A';
  cells[at('Total.Animals')] = '99999999';
  lines[k] = cells.join(',');
  const nonWaFile = path.join(OUT, 'non_wa_master.csv');
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(nonWaFile, lines.join('\n') + '\n');
  await loadMaster(p, nonWaFile);
  await showView(p, 'wa');
  const top = await p.eval(`(() => ({ first: CVIWA.state.charts.charts.find(c => c.id === 'top_places').groups[0].label }))()`);
  const buttons = await p.eval(BUTTONS('top_places'));
  check(top.first === 'Non-WA' && buttons.length > 0 && buttons.every(x => x.value !== 'Non-WA'),
    'marks: "Non-WA" cannot be clicked', [top.first, buttons.map(x => x.value)]);
}

// ── Part: WA State ─────────────────────────────────────────────────────────────────────────────────────────
// The map, value boxes and strip against the page's own builders given the sidebar pick (species groups, years and
// quarters; null keeps the sidebar's).
const WA_AS_PICK = (species, years, quarters) => `(() => {
  const W = CVIWA, st = W.state, m = st.master;
  const f = { species: ${JSON.stringify(species)} || st.species, years: ${JSON.stringify(years)} || st.years,
    quarters: ${JSON.stringify(quarters)} || st.quarters, direction: st.direction, rawSpecies: st.speciesSub, mode: st.mode };
  const data = W.aggregate.build(m.rows, Object.assign({ scaling: st.scaling, nBins: st.nBins, hasSpecies: m.hasSpecies }, f));
  return { circles: JSON.stringify(data) === JSON.stringify(st.data),
    boxes: JSON.stringify(W.summary.valueBoxes(W.summary.summary(m, f))) === JSON.stringify(st.valueBoxes),
    strip: JSON.stringify(W.summary.strip(m, f, data)) === JSON.stringify(st.strip), n: data.length };
})()`;
// The charts other than skip, against charts built from rows chosen by the expression rowsOf (a function of the page's
// W, st and the sidebar's rows), so the expected rows are made without crossfilter.js.
const OTHERS_AS = (skip, rowsOf) => `(() => {
  const W = CVIWA, st = W.state, m = st.master, view = st.view;
  const sidebar = view === 'wa' ? W.summary.mapRows(m, { species: st.species, years: st.years, quarters: st.quarters,
    direction: st.direction, rawSpecies: st.speciesSub }) || []
    : view === 'flow' ? W.flow.mapRows(m, Object.assign({}, W.flowState, { speciesSub: W.flowState.speciesSub })) || []
    : W.focus.summaryRows(m, Object.assign({}, W.focusState, { rawSpecies: W.focusState.speciesSub })) || [];
  const rows = (${rowsOf})(W, st, sidebar);
  const opts = Object.assign({}, st.charts.opts, { view });
  return st.charts.charts.filter(c => ${JSON.stringify(skip)}.indexOf(c.id) < 0 && c.id !== 'top_premises').map(c => ({ id: c.id,
    same: JSON.stringify(W.charts.build(c.id, { rows }, opts)) === JSON.stringify(c) }));
})()`;
// A place pick keeps each loader copy at its own end, before charts.js merges them for its totals across directions.
const eachCopy = test => `(W, st, rows) => rows.filter(${test})`;
async function expectAllSame(p, expr, name) {
  const r = await p.eval(expr);
  check(r.length > 0 && r.every(x => x.same), name, r);
}
async function partWa(b) {
  const p = b.page;
  await openPage(b);
  await p.viewport(1400, 1000);
  await loadMaster(p, TIER_FULL);
  await showView(p, 'wa');
  await setLayout(p, 'split');
  const base = await p.eval('JSON.stringify(CVIWA.state.charts.charts.find(c => c.id === "species"))');
  const groups = (await p.eval(BUTTONS('species'))).map(x => x.value);
  const s1 = groups[1], s2 = groups[2];

  // A species bar: the map, boxes and strip become the sidebar pick's; the other charts are filtered; the species
  // chart keeps all its bars, the others faint; the chip bar names it.
  await clickMark(p, 'species', 'species', s1);
  let c = await p.eval(CHIPS);
  check(c.shown && same(c.chips, ['Species group: ' + s1]) && c.clear, 'wa: a species click shows its chip', c);
  let m = await p.eval(WA_AS_PICK([s1], null, null));
  check(m.circles && m.boxes && m.strip && m.n > 0, 'wa: map, value boxes and strip as the sidebar pick of the group', m);
  await expectAllSame(p, OTHERS_AS(['species'], `(W, st, rows) => rows.filter(r => r['Species.Group'] === ${JSON.stringify(s1)})`),
    'wa: the other charts as the sidebar pick\'s');
  check(await p.eval('JSON.stringify(CVIWA.state.charts.charts.find(c => c.id === "species"))') === base,
    'wa: the species chart keeps all its bars');
  let bt = await p.eval(BUTTONS('species'));
  check(bt.every(x => (x.value === s1) === (x.pressed === 'true') && (x.value === s1) === !x.faint),
    'wa: the picked bar pressed and in full color, the others faint');
  // A second click removes it.
  await clickMark(p, 'species', 'species', s1);
  c = await p.eval(CHIPS);
  m = await p.eval(WA_AS_PICK(null, null, null));
  check(!c.shown && m.circles && m.boxes, 'wa: a second click removes the filter', c);
  check((await p.eval(BUTTONS('species'))).every(x => x.pressed === 'false' && !x.faint), 'wa: nothing pressed or faint');

  // Keyboard: Enter picks, Space removes; the focus stays on the bar.
  await p.eval(`[...document.querySelectorAll('#chart-grid .chart-card[data-chart="species"] .chart-pick')]
    .find(x => x.getAttribute('data-pick') === ${JSON.stringify('species|' + encodeURIComponent(s2))}).focus(); true`);
  await p.key('Enter', 13, '\r');
  await settle(p);
  c = await p.eval(CHIPS);
  const focused = () => p.eval(`document.activeElement && document.activeElement.getAttribute('data-pick')`);
  check(same(c.chips, ['Species group: ' + s2]) && await focused() === 'species|' + encodeURIComponent(s2),
    'wa: Enter picks a bar and keeps the focus', [c.chips, await focused()]);
  await p.key(' ', 32, ' ');
  await settle(p);
  check(!(await p.eval(CHIPS)).shown && await focused() === 'species|' + encodeURIComponent(s2), 'wa: Space removes it, focus kept');

  // A period point: the map becomes that year and quarter alone; the over-time chart keeps its points, the other
  // periods' faint; with a species too, both apply.
  const periods = await p.eval('CVIWA.state.charts.charts.find(c => c.id === "over_time").periods');
  const last = periods[periods.length - 1], [year, quarter] = last.split(' ');
  await clickMark(p, 'over_time', 'period', last);
  c = await p.eval(CHIPS);
  m = await p.eval(WA_AS_PICK(null, [Number(year)], [quarter]));
  check(same(c.chips, ['Period: ' + last]) && m.circles && m.boxes && m.strip, 'wa: a period click: map as that year and quarter', [c, m]);
  const faint = await p.eval(FAINT_OUTSIDE('over_time'));
  const series = await p.eval('CVIWA.state.charts.charts.find(c => c.id === "over_time").series.length');
  check(faint.filter(Boolean).length === (periods.length - 1) * series, 'wa: the other periods\' points faint',
    [faint.filter(Boolean).length, periods.length, series]);
  await clickMark(p, 'species', 'species', s1);
  c = await p.eval(CHIPS);
  m = await p.eval(WA_AS_PICK([s1], [Number(year)], [quarter]));
  check(same(c.chips, ['Species group: ' + s1, 'Period: ' + last]) && m.circles && m.boxes, 'wa: species and period combine', c);
  // A chip's × removes that kind only; "Clear chart filters" the rest.
  await p.eval(`document.querySelector('#chart-filters .cf-chip[data-kind="species"] .cf-x').click(); true`);
  await settle(p);
  check(same((await p.eval(CHIPS)).chips, ['Period: ' + last]), 'wa: a chip\'s × removes that filter only');
  await p.eval(`document.getElementById('chart-filters-clear').click(); true`);
  await settle(p);
  check(!(await p.eval(CHIPS)).shown && (await p.eval(WA_AS_PICK(null, null, null))).circles, 'wa: Clear chart filters');

  // A county bar is the spotlight (S7), and now filters the other charts to the rows counted there.
  const county = (await p.eval(BUTTONS('top_places')))[0].value;
  await clickMark(p, 'top_places', 'place', county);
  c = await p.eval(CHIPS);
  const spot = await p.eval('CVIWA.state.spotlight.slice()');
  check(same(c.chips, ['Spotlight: ' + county]) && spot.length === 1, 'wa: a county click spotlights it, with its chip', [c, spot]);
  await expectAllSame(p, OTHERS_AS(['top_places', 'emerging'], eachCopy(`r => W.charts.placeOf(r, 'wa') === ${JSON.stringify(county)}`)),
    'wa: the spotlight filters the other charts to the rows counted at the county');
  await p.eval(`document.querySelector('#chart-filters .cf-chip[data-kind="place"] .cf-x').click(); true`);
  await settle(p);
  check(!(await p.eval('CVIWA.state.spotlight.length')) && !(await p.eval(`document.querySelectorAll('#f-spotlight input:checked').length`)),
    'wa: the spotlight chip\'s × clears Spotlight Counties');

  // The chip bar in every layout, above the value boxes.
  await clickMark(p, 'species', 'species', s1);
  for (const layout of ['map', 'charts', 'split']) {
    await setLayout(p, layout);
    const g = await p.eval(`(() => { const a = document.getElementById('chart-filters').getBoundingClientRect(),
      v = document.getElementById('value-boxes').getBoundingClientRect(); return { shown: a.height > 0, above: a.bottom <= v.top + 1 }; })()`);
    check(g.shown && g.above, 'wa: the chip bar shows in the ' + layout + ' layout, above the value boxes', g);
  }
  await p.screenshot(path.join(OUT, 'screens', 'wa_species_chip_split.png'));

  // A sidebar change that removes the value drops the filter, with a message.
  await p.eval(`(() => { const i = [...document.querySelectorAll('#f-species input')].find(x => x.value === ${JSON.stringify(s1)});
    i.checked = false; i.dispatchEvent(new Event('change')); return true; })()`);
  await settle(p);
  c = await p.eval(CHIPS);
  check(c.shown && !c.chips.length && c.message === 'Chart filter removed (Species group: ' + s1 + '). The sidebar filters no longer include it.',
    'wa: unticking the group drops its filter, with a message', c);
  check((await p.eval(WA_AS_PICK(null, null, null))).circles, 'wa: the map then follows the sidebar');
  await p.eval(`document.querySelector('[data-all="species"]').click(); true`);
  await settle(p);

  // What a click does, written out here rather than taken from crossfilter.hoverText.
  const speciesButton = (await p.eval(BUTTONS('species'))).find(x => x.value === s1);
  check(!!speciesButton && speciesButton.click === 'Click to filter by ' + s1 + '.' && speciesButton.pressed === 'false',
    'wa: a species bar says "Click to filter by …." in words', speciesButton);
  // Browse sets the period: a period filter is dropped when it starts, and period points cannot be clicked.
  await clickMark(p, 'over_time', 'period', last);
  await p.eval(`(() => { const r = document.querySelector('input[name=period-mode][value=browse]');
    r.checked = true; r.dispatchEvent(new Event('change')); return true; })()`);
  await sleep(900);
  c = await p.eval(CHIPS);
  check(!c.chips.length && c.message === 'Chart filter removed (Period: ' + last + '). Browse and Compare set the period.',
    'wa: Browse drops the period filter, with a message', c);
  check((await p.eval(BUTTONS('over_time'))).length === 0, 'wa: no period point can be clicked while browsing');
  check(same(await p.eval(OVER_TIME_HINTS), ['Browse sets the period, so the points cannot be clicked.']),
    'wa: while browsing, the over-time points\' hover says why they cannot be clicked',
    await p.eval(OVER_TIME_HINTS));
  await p.eval(`(() => { const r = document.querySelector('input[name=period-mode][value=single]');
    r.checked = true; r.dispatchEvent(new Event('change')); return true; })()`);
  await sleep(700);

  // Compare: a species filter applies to both maps, not to a right map with its own species.
  await clickMark(p, 'species', 'species', s1);
  await p.eval(`(() => { const r = document.querySelector('input[name=period-mode][value=compare]');
    r.checked = true; r.dispatchEvent(new Event('change')); return true; })()`);
  await sleep(1200);
  check(same(await p.eval(OVER_TIME_HINTS), ['Each map has its own period in Compare, so the points cannot be clicked.']),
    'wa: in Compare, the over-time points\' hover says why they cannot be clicked',
    await p.eval(OVER_TIME_HINTS));
  const right = own => `(() => { const W = CVIWA, st = W.state, m = st.master;
    const r = W.periods.rightFilters(st);
    const f = Object.assign({ direction: st.direction, mode: st.mode, scaling: st.scaling, nBins: st.nBins, hasSpecies: m.hasSpecies }, r,
      ${own} ? {} : { species: [${JSON.stringify(s1)}] });
    return JSON.stringify(W.aggregate.build(m.rows, f)) === JSON.stringify(st.dataB) && st.dataB.length > 0; })()`;
  check(await p.eval(right(false)), 'wa: in Compare the right map takes the species filter');
  check((await p.eval(BUTTONS('over_time'))).length === 0, 'wa: no period point can be clicked in Compare');
  await p.eval(`(() => { const c = document.getElementById('species-b-on'); c.checked = true; c.dispatchEvent(new Event('change')); return true; })()`);
  await sleep(900);
  check(await p.eval(right(true)), 'wa: a right map with its own species does not');
  await p.screenshot(path.join(OUT, 'screens', 'wa_compare_species_filter.png'));

  // Reset All clears every chart filter.
  await p.eval("document.getElementById('reset-all').click(); true");
  await sleep(900);
  check(!(await p.eval(CHIPS)).shown && !(await p.eval('CVIWA.crossfilter.isActive(CVIWA.state.cf, "wa")')),
    'wa: Reset All clears the chart filters');
}

// ── Part: National Flow ────────────────────────────────────────────────────────────────────────────────────
// A state's bar picks the state: the other states' lines dimmed on the map, the other charts filtered to the rows of
// that partner state; a corridor's bar picks its non-WA state too. The lines themselves are not filtered.
const FLOW_LINES_AS = species => `(() => {
  const W = CVIWA, fl = W.flowState, m = W.state.master, ctr = W.flow.centers(window.WSDA_STATE_CENTERS);
  const f = Object.assign({}, fl, ${JSON.stringify(species)} ? { species: ${JSON.stringify(species)} } : {});
  return JSON.stringify(W.flow.lines(m, f, ctr)) === JSON.stringify(fl.data);
})()`;
const FLOW_PAINT = `JSON.stringify(CVIWA.state.flowHandle.map.getPaintProperty('flow_lines', 'line-opacity'))`;
async function partFlow(b) {
  const p = b.page;
  await openPage(b);
  await p.viewport(1400, 1000);
  await loadMaster(p, TIER_FULL);
  await showView(p, 'flow');
  await setLayout(p, 'split');
  const before = await p.eval(FLOW_PAINT);
  const state = (await p.eval(BUTTONS('top_places')))[0].value;
  const corridorsBefore = await p.eval('JSON.stringify(CVIWA.state.charts.charts.find(c => c.id === "corridors"))');
  await clickMark(p, 'top_places', 'place', state);
  let c = await p.eval(CHIPS);
  check(same(c.chips, ['State: ' + state]), 'flow: a state click shows its chip', c);
  const paint = JSON.parse(await p.eval(FLOW_PAINT));
  check(paint[0] === 'case' && same(paint[1], ['in', ['get', 'state'], ['literal', [state]]]) && same(paint[2], JSON.parse(before))
    && paint[3] === 0.1, 'flow: the other states\' lines dimmed to 0.10', paint);
  check(await p.eval(FLOW_LINES_AS(null)), 'flow: the lines themselves are not filtered');
  await expectAllSame(p, OTHERS_AS(['top_places', 'corridors'], eachCopy(`r => W.charts.placeOf(r, 'flow') === ${JSON.stringify(state)}`)),
    'flow: the other charts filtered to the state\'s rows');
  check(await p.eval('JSON.stringify(CVIWA.state.charts.charts.find(c => c.id === "corridors"))') === corridorsBefore,
    'flow: the corridor chart, which picks states too, keeps all its bars');
  // A corridor's bar adds its non-WA state.
  const corridor = (await p.eval(BUTTONS('corridors'))).find(x => x.value !== state);
  await clickMark(p, 'corridors', 'place', corridor.value);
  c = await p.eval(CHIPS);
  check(same(c.chips, ['State: ' + state + ', ' + corridor.value]), 'flow: a corridor click adds its non-WA state', c);
  await p.screenshot(path.join(OUT, 'screens', 'flow_two_states.png'));
  // A species filters the lines, as its sidebar pick.
  await p.eval(`document.getElementById('chart-filters-clear').click(); true`);
  await settle(p);
  check(await p.eval(FLOW_PAINT) === before, 'flow: Clear chart filters undims the lines');
  const group = (await p.eval(BUTTONS('species')))[0].value;
  await clickMark(p, 'species', 'species', group);
  check(await p.eval(FLOW_LINES_AS([group])), 'flow: a species click draws the lines of the sidebar pick');
  // The WA State map keeps its own chart filters.
  await showView(p, 'wa');
  check(!(await p.eval(CHIPS)).shown, 'flow: the WA State view has none of the Flow view\'s chart filters');
  await showView(p, 'flow');
  check(same((await p.eval(CHIPS)).chips, ['Species group: ' + group]), 'flow: back on National Flow its filter is still on');
}

// ── Part: County Focus ─────────────────────────────────────────────────────────────────────────────────────
// A premises, a corridor and a county: the premises they stand for stay bright on the map, the others dimmed; the
// other charts are filtered to their rows.
const FOCUS_LIT = `(() => {
  const h = CVIWA.state.focusHandle, f = h.focus;
  const lit = [].concat(f.Inbound, f.Outbound).filter(x => x.properties.lit);
  return { lit: lit.map(x => x.properties.direction + '|' + x.properties.premises_id).sort(),
    all: f.Inbound.length + f.Outbound.length,
    paint: JSON.stringify(h.map.getPaintProperty('focus_points_in', 'circle-opacity')) };
})()`;
// The premises that should be bright: those whose rows pass the test (a function of the page's W and a row).
const FOCUS_WANT = test => `(() => {
  const W = CVIWA, m = W.state.master;
  return W.focusState.built.premises.filter(p => p.row_indices.some(i => (${test})(W, m.rows[i])))
    .map(p => p.direction + '|' + p.premises_id).sort();
})()`;
async function partFocus(b) {
  const p = b.page;
  await openPage(b);
  await p.viewport(1400, 1000);
  await loadMaster(p, TIER_FULL);
  await showView(p, 'focus');
  await setLayout(p, 'split');
  let lit = await p.eval(FOCUS_LIT);
  check(lit.lit.length === lit.all && lit.paint.indexOf('lit') < 0, 'focus: without a filter every premises bright, S5\'s paint', lit);
  // A premises bar.
  const prem = (await p.eval(BUTTONS('top_premises')))[0];
  await clickMark(p, 'top_premises', 'premises', prem.value);
  let c = await p.eval(CHIPS);
  const label = await p.eval(`CVIWA.state.cf.focus.labels[${JSON.stringify(prem.value)}]`);
  check(same(c.chips, ['Premises: ' + label]), 'focus: a premises click shows its chip with its label', c);
  lit = await p.eval(FOCUS_LIT);
  const want = await p.eval(FOCUS_WANT(`(W, r) => W.focus.premisesKey(r) === ${JSON.stringify(prem.value)}`));
  const dimmed = JSON.parse(lit.paint);
  check(same(lit.lit, want) && want.length === 1 && lit.paint.indexOf('lit') > 0 && dimmed[dimmed.length - 1] === 0.1,
    'focus: that premises bright, the others dimmed to 0.10', [lit.lit, want, lit.paint]);
  await expectAllSame(p, OTHERS_AS([], `(W, st, rows) => rows.filter(r => W.focus.premisesKey(r) === ${JSON.stringify(prem.value)})`),
    'focus: the other charts filtered to the premises\' rows');
  await p.screenshot(path.join(OUT, 'screens', 'focus_premises.png'));
  await p.eval(`document.getElementById('chart-filters-clear').click(); true`);
  await settle(p);
  // A corridor.
  const pair = (await p.eval(BUTTONS('corridors')))[0];
  const [o, d] = pair.value.split('\u0000');
  await clickMark(p, 'corridors', 'pair', pair.value);
  c = await p.eval(CHIPS);
  check(same(c.chips, ['Corridor: ' + o + ' → ' + d]), 'focus: a corridor click shows its chip', c);
  const inPair = `(W, r) => W.charts.countyLabel(r['Origin.County']) === ${JSON.stringify(o)} && W.charts.countyLabel(r['Dest.County']) === ${JSON.stringify(d)}`;
  lit = await p.eval(FOCUS_LIT);
  check(same(lit.lit, await p.eval(FOCUS_WANT(inPair))) && lit.lit.length > 0, 'focus: the premises with a row in the corridor bright', lit.lit.length);
  await expectAllSame(p, OTHERS_AS(['corridors'], `(W, st, rows) => rows.filter(r => (${inPair})(W, r))`),
    'focus: the other charts filtered to the corridor\'s rows');
  await p.eval(`document.getElementById('chart-filters-clear').click(); true`);
  await settle(p);
  // A county of Emerging vs cooling.
  const em = await p.eval(BUTTONS('emerging'));
  if (em.length) {
    await clickMark(p, 'emerging', 'place', em[0].value);
    c = await p.eval(CHIPS);
    check(same(c.chips, ['County: ' + em[0].value]), 'focus: a county click shows its chip', c);
    lit = await p.eval(FOCUS_LIT);
    const byCounty = await p.eval(`CVIWA.focusState.built.premises.filter(p => CVIWA.charts.countyLabel(p.county) === ${JSON.stringify(em[0].value)})
      .map(p => p.direction + '|' + p.premises_id).sort()`);
    check(same(lit.lit, byCounty) && byCounty.length > 0, 'focus: the county\'s premises bright', [lit.lit.length, byCounty.length]);
    await expectAllSame(p, OTHERS_AS(['emerging'], eachCopy(`r => W.charts.placeOf(r, 'focus') === ${JSON.stringify(em[0].value)}`)),
      'focus: the other charts filtered to the rows counted in the county');
  } else {
    check(false, 'focus: Emerging vs cooling has a county to click');
  }
  // Unticking the picked county in the sidebar drops the county filter.
  await p.eval(`(() => { const i = [...document.querySelectorAll('#fo-counties input')].find(x => x.value === ${JSON.stringify(em.length ? em[0].value : '')});
    if (i) { i.checked = false; i.dispatchEvent(new Event('change')); } return !!i; })()`);
  await settle(p);
  c = await p.eval(CHIPS);
  check(!c.chips.length && /^Chart filter removed \(County: /.test(c.message || ''), 'focus: a county left out of the sidebar drops its filter', c);
  lit = await p.eval(FOCUS_LIT);
  check(lit.lit.length === lit.all && lit.paint.indexOf('lit') < 0, 'focus: without a filter S5\'s paint again', lit.paint);
}

// ── Part: movement view ────────────────────────────────────────────────────────────────────────────────────
// What the map draws, against movement.js given the page's own filters (its rules are checked against the R
// reference in the Node suite), and what the page shows around it.
const MV_STATE = `(() => {
  const W = CVIWA, st = W.state, h = st.mapHandle, m = h.map, v = h.mcView;
  const vis = id => (m.getLayer(id) ? m.getLayoutProperty(id, 'visibility') || 'visible' : null);
  return { on: st.movementOn, drawn: !!v, lines: v ? v.lines.map(l => ({ key: l.key, on: l.on, badge: l.badge, w: l.width_px, c: l.color, a: l.arrow_px })) : [],
    rings: v ? v.rings.length : 0, layers: W.map.MC_LAYERS.filter(id => !!m.getLayer(id)),
    circles: ['circles', 'circles_dim', 'circles_spotlight'].map(vis),
    legend: document.getElementById('legend-panel').textContent, note: document.getElementById('mv-note').hidden ? null
      : document.getElementById('mv-note').textContent, cap: st.movementCap, capShown: !document.getElementById('mv-cap-row').hidden };
})()`;
// movement.js on the page's filters, with the corridor chart's first three bars as badges (the expected drawing).
const MV_EXPECTED = `(() => {
  const W = CVIWA, st = W.state, MV = W.movement, cf = W.crossfilter;
  const fm = cf.mapFilters('wa', { species: st.species, years: st.years, quarters: st.quarters }, st.cf);
  const r = MV.rows(st.master, { species: fm.species, years: fm.years, quarters: fm.quarters, keep: fm.keep, rawSpecies: st.speciesSub });
  const spot = new Set(st.spotlight);
  const rows = MV.betweenRows(r.counted).filter(x => !spot.size || spot.has(x['Origin.County']) || spot.has(x['Dest.County']));
  const chart = W.charts.build('corridors', { rows }, { view: 'wa', measure: st.chartMeasure });
  const badges = chart.empty ? [] : chart.bars.slice(0, 3).map(b => MV.pairKey(...b.label.split('  \u2192  ')));
  const v = MV.mapView(MV.pairs(r.counted), MV.points(r.counted), { cap: st.movementCap, measure: st.chartMeasure, scaling: st.scaling, nBins: st.nBins,
    spotlight: st.spotlight, picked: st.cf.wa.pair, badges, bySpecies: MV.pairs(r.counted, { bySpecies: true }) });
  return { lines: v.lines.map(l => ({ key: l.key, on: l.on, badge: l.badge, w: l.width_px, c: l.color, a: l.arrow_px })), rings: v.rings.length,
    leftOut: MV.leftOutText(r.leftOut), badges, chartBars: chart.empty ? [] : chart.bars.map(b => b.label) };
})()`;
// The legend's sample rows: "1st–5th busiest: lo–hi animals" (plain words; formerly "Ranks 1–5"), each
// with its line's color and width.
const legendSamples = p => p.eval(`(() => [...document.querySelectorAll('#legend-panel .lg-mv')].filter(r => r.querySelector('polygon'))
  .map(r => r.textContent + ' ' + r.querySelector('line').getAttribute('stroke') + ' ' + r.querySelector('line').getAttribute('stroke-width')))()`);
// The same rows worked out from pairs() order (the most animals first) for a Top cap, without a spotlight.
const expectedSamples = (p, cap) => p.eval(`(() => {
  const W = CVIWA, st = W.state, MV = W.movement, fm = W.crossfilter.mapFilters('wa', { species: st.species, years: st.years, quarters: st.quarters }, st.cf);
  const r = MV.rows(st.master, { species: fm.species, years: fm.years, quarters: fm.quarters, keep: fm.keep, rawSpecies: st.speciesSub });
  const top = MV.between(MV.pairs(r.counted)).slice(0, ${cap});
  const groups = [[1, 5, '#245566', '7.0'], [6, 10, '#0094aa', '5.0'], [11, 25, '#4fb0bf', '3.0'], [26, 50, '#8cc5cf', '2.0']];
  const n = x => W.charts.exact(x) + (x === 1 ? ' animal' : ' animals');
  return groups.filter(g => top.length >= g[0]).map(g => {
    const a = top.slice(g[0] - 1, g[1]).map(p => p.animals), lo = Math.min(...a), hi = Math.max(...a);
    const last = Math.min(g[1], top.length);
    const ord = k => k + ((k % 100 >= 11 && k % 100 <= 13) ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' })[k % 10] || 'th');
    return (g[0] === last ? ord(g[0]) : ord(g[0]) + '\u2013' + ord(last)) + ' busiest: '
      + (lo === hi ? n(hi) : W.charts.exact(lo) + '\u2013' + n(hi)) + ' ' + g[2] + ' ' + g[3];
  }); })()`);
// A Washington county name's size and weight on the screen, and its size in the screenshot's font.
const labelLook = p => p.eval(`(async () => { const h = CVIWA.state.mapHandle;
  const el = [...document.querySelectorAll('#map .county-label')].find(e => !e.classList.contains('hidden')
    && !e.classList.contains('region-name') && !e.classList.contains('neighbor-county'));
  const cs = getComputedStyle(el);
  await CVIWA.map.screenshot(h);
  const font = h.lastLabelFonts[h.lastLabels.indexOf(el.textContent)] || '';
  const size = (font.match(/([0-9.]+)px/) || [])[1];
  const k = h.map.getCanvas().width / h.map.getCanvas().clientWidth;
  return [cs.fontSize, cs.fontWeight, (Number(size) / k) + 'px' + (/^(600|bold)/.test(font) ? '' : ' (not semibold)')]; })()`);
async function mvToggle(p, on) {
  await p.eval(`(() => { const c = document.getElementById('mv-on'); c.checked = ${on}; c.dispatchEvent(new Event('change')); return true; })()`);
  await sleep(700);
}
async function partMovement(b) {
  const p = b.page;
  await openPage(b);
  await p.viewport(1400, 1000);
  await loadMaster(p, MOVEMENT);
  await showView(p, 'wa');
  await setLayout(p, 'split');
  let s = await p.eval(MV_STATE);
  check(!s.on && !s.drawn && !s.layers.length && s.circles.every(x => x === 'visible') && !s.capShown && s.note === null,
    'movement: off when the page opens: the circles as before, no movement layers', s);
  const before = await p.eval('CVIWA.state.charts.charts.map(c => c.id)');

  // On: lines and rings in place of the circles, as movement.js gives them; the corridor chart added; badges 1 to 3
  // on the lines of its first three bars.
  await mvToggle(p, true);
  s = await p.eval(MV_STATE);
  let want = await p.eval(MV_EXPECTED);
  check(s.drawn && same(s.lines, want.lines) && s.rings === want.rings && want.lines.length >= 10,
    'movement: lines and rings as movement.js gives them (widths, colors, arrowhead sizes)', [s.lines.length, want.lines.length, s.rings]);
  check(same(s.layers, ['mc-lines', 'mc-heads', 'mc-rings', 'mc-hit', 'mc-county-hit', 'mc-badges']) && s.circles.every(x => x === 'none'),
    'movement: its layers on the map, the circles hidden', s);
  check(s.capShown && s.cap === 10 && (await p.eval("document.getElementById('mv-cap').value")) === '10',
    'movement: "Lines shown" shown, Top 10 by default');
  // Each line in its own color, a filled arrowhead (a picture in that color) at each line's end.
  const paint = await p.eval(`(() => { const m = CVIWA.state.mapHandle.map, v = CVIWA.state.mapHandle.mcView;
    const heads = CVIWA.state.mapHandle.mc.heads.features;
    return { lineColor: m.getPaintProperty('mc-lines', 'line-color'), headType: m.getLayer('mc-heads').type,
      images: v.lines.every(l => m.hasImage('mc-arrow-' + l.color)),
      atEnds: v.lines.every((l, i) => JSON.stringify(heads[i].geometry.coordinates) === JSON.stringify(l.line[l.line.length - 1])
        && heads[i].properties.c === l.color && heads[i].properties.b === l.head.bearing) }; })()`);
  check(same(paint.lineColor, ['get', 'c']) && paint.headType === 'symbol' && paint.images && paint.atEnds,
    'movement: lines in their own colors, an arrowhead picture of that color at each line\'s end', paint);
  // The label at the size of the other check boxes.
  const sizes = await p.eval(`(() => { const f = e => getComputedStyle(e).fontSize;
    return { mv: f(document.getElementById('mv-on').closest('label')), labels: f(document.getElementById('s-labels').closest('label')) }; })()`);
  check(sizes.mv === sizes.labels && sizes.mv !== '16px', 'movement: the switch\'s label as large as "Show county labels"', sizes);
  const charts = await p.eval('CVIWA.state.charts.charts.map(c => c.id + "|" + c.title)');
  check(same(charts.map(c => c.split('|')[0]), before.concat(['corridors']))
    && charts[charts.length - 1].split('|')[1] === 'Top movement corridors within Washington', 'movement: the corridor chart added', charts);
  const badged = s.lines.filter(l => l.badge).sort((a, b) => a.badge - b.badge).map(l => l.key);
  check(same(badged, want.badges) && badged.length === 3, 'movement: badges 1 to 3 on the corridor chart\'s first three bars', [badged, want.badges]);
  check(/^Movement between WA counties/.test(s.legend) && /The busiest 10 of \d+ county pairs\. Lines join county centers; they are not travel routes\./.test(s.legend),
    'movement: the legend says what is drawn', s.legend);
  // The legend's sample lines: one per rank group drawn (Top 10: ranks 1-5 and 6-10), in the group's width and color,
  // with the animals of its pairs; the ranks taken from pairs() order (the most animals first), not from mapView.
  check((await legendSamples(p)).join(' | ') === (await expectedSamples(p, 10)).join(' | '),
    'movement: the legend\'s sample lines, one per rank group', [await legendSamples(p), await expectedSamples(p, 10)]);
  check(/Lines: county pairs ranked by animals \("Show charts by:"\)/.test(s.legend), 'movement: the legend names the ranking', s.legend);
  // County names larger and semibold while the view is on (13C), on the screen and in the screenshot.
  check(same(await labelLook(p), ['12.5px', '600', '12.5px']), 'movement: county names 12.5 px semibold while it is on', await labelLook(p));
  check(s.note === 'Direction does not split this view: a movement within Washington is both a departure and an arrival. ' + want.leftOut,
    'movement: the line under the map, with the rows left out', [s.note, want.leftOut]);
  await p.screenshot(path.join(OUT, 'screens', 'movement_top10_split.png'));

  // "Show charts by:" ranks the lines too (13D): the map is drawn again, its Top 10 are the corridor chart's first
  // ten bars, badges 1 to 3 on ranks 1 to 3 and no extra lines.
  for (const measure of ['records', 'cvis']) {
    await p.eval(`(() => { const c = document.getElementById('chart-measure'); c.value = '${measure}'; c.dispatchEvent(new Event('change')); return true; })()`);
    await sleep(700);
    s = await p.eval(MV_STATE);
    want = await p.eval(MV_EXPECTED);
    const ranks = await p.eval(`(() => { const v = CVIWA.state.mapHandle.mcView;
      return { measure: v.measure, top: v.lines.slice().sort((a, b) => a.rank - b.rank).map(l => l.origin + '  \u2192  ' + l.dest),
        badges: v.lines.filter(l => l.badge).map(l => [l.badge, l.rank]) }; })()`);
    check(ranks.measure === measure && same(s.lines, want.lines) && s.lines.length === 10
      && same(ranks.top, want.chartBars.slice(0, 10)),
    'movement: by ' + measure + ', the map drawn again and its Top 10 the corridor chart\'s first ten bars', [ranks.top.slice(0, 3), want.chartBars.slice(0, 3)]);
    check(ranks.badges.length === 3 && ranks.badges.every(([badge, rank]) => badge === rank),
      'movement: by ' + measure + ', badges 1 to 3 on ranks 1 to 3', ranks.badges);
    check(new RegExp('ranked by ' + (measure === 'records' ? 'CVI records' : 'unique CVIs') + ' ').test(s.legend),
      'movement: by ' + measure + ', the legend names the ranking', s.legend);
  }
  await p.eval(`(() => { const c = document.getElementById('chart-measure'); c.value = 'animals'; c.dispatchEvent(new Event('change')); return true; })()`);
  await sleep(700);
  check(same((await p.eval(MV_STATE)).lines, (await p.eval(MV_EXPECTED)).lines), 'movement: back to animals');
  // "Show charts by:" changed on another view draws the WA map again, so coming back it is ranked by
  // the new measure (lines, badges, legend), not the old one.
  await showView(p, 'flow');
  await p.eval(`(() => { const c = document.getElementById('chart-measure'); c.value = 'records'; c.dispatchEvent(new Event('change')); return true; })()`);
  await sleep(700);
  await showView(p, 'wa');
  s = await p.eval(MV_STATE);
  want = await p.eval(MV_EXPECTED);
  const back = await p.eval(`(() => { const v = CVIWA.state.mapHandle.mcView;
    return { measure: v.measure, badges: v.lines.filter(l => l.badge).sort((a, b) => a.badge - b.badge).map(l => l.key) }; })()`);
  check(back.measure === 'records' && same(s.lines, want.lines) && same(back.badges, want.badges)
    && /ranked by CVI records /.test(s.legend),
  'movement: "Show charts by:" changed on National Flow ranks the WA lines by it on coming back',
  [back, want.badges, s.legend.slice(0, 80)]);
  await p.eval(`(() => { const c = document.getElementById('chart-measure'); c.value = 'animals'; c.dispatchEvent(new Event('change')); return true; })()`);
  await sleep(700);
  check((await p.eval('CVIWA.state.mapHandle.mcView.measure')) === 'animals', 'movement: back to animals again');
  // Unticking both Direction boxes keeps a species filter and a picked corridor (a corridor alone would stay anyway:
  // it is tested against the movement view's rows); ticking the boxes again brings them back as they were.
  const firstSpecies = (await p.eval(BUTTONS('species')))[0];
  await clickMark(p, 'species', 'species', firstSpecies.value);
  const firstBar = (await p.eval(BUTTONS('corridors')))[0];   // the corridor chart under that species
  await clickMark(p, 'corridors', 'pair', firstBar.value);
  const dirs = on => p.eval(`(() => { const b = [...document.querySelectorAll('input[name="direction"]')];
    b.forEach(x => { x.checked = ${on}; x.dispatchEvent(new Event('change')); }); return b.length; })()`);
  check((await dirs(false)) === 2, 'movement: the two Direction boxes found');
  await sleep(700);
  const emptied = await p.eval(CHIPS);
  await dirs(true);
  await sleep(700);
  const ticked = await p.eval(CHIPS);
  check(emptied.chips.length === 2 && emptied.message === null && ticked.chips.length === 2
    && (await p.eval('CVIWA.state.mapHandle.mcView.lines.filter(l => l.on).length')) === 1,
  'movement: no Direction ticked keeps the chart filters; ticked again, they are as before', [emptied, ticked]);
  await clickMark(p, 'corridors', 'pair', firstBar.value);
  await clickMark(p, 'species', 'species', firstSpecies.value);
  await p.eval("document.getElementById('legend-toggle').click(); true");
  await sleep(300);
  await p.screenshot(path.join(OUT, 'screens', 'movement_top10_legend.png'));
  await p.eval("document.getElementById('legend-toggle').click(); true");
  await sleep(300);

  // The picker: Top 5 draws five lines and any badge's line.
  await p.eval(`(() => { const c = document.getElementById('mv-cap'); c.value = '5'; c.dispatchEvent(new Event('change')); return true; })()`);
  await sleep(600);
  s = await p.eval(MV_STATE);
  want = await p.eval(MV_EXPECTED);
  check(same(s.lines, want.lines) && s.lines.length >= 5 && s.lines.length <= 8 && /The busiest 5 of/.test(s.legend),
    'movement: Top 5', s.lines.length);
  for (const cap of ['10', '50', '25']) {
    await p.eval(`(() => { const c = document.getElementById('mv-cap'); c.value = '${cap}'; c.dispatchEvent(new Event('change')); return true; })()`);
    await sleep(500);
    check(same((await p.eval(MV_STATE)).lines, (await p.eval(MV_EXPECTED)).lines), 'movement: Top ' + cap);
  }

  // Hover: a county's three numbers; a line's pair, animals, records and top species.
  const hover = async lngLat => {
    const q = await p.eval(`(() => { const m = CVIWA.state.mapHandle.map, r = m.getCanvas().getBoundingClientRect(),
      q = m.project(${JSON.stringify(lngLat)}); return { x: r.left + q.x, y: r.top + q.y }; })()`);
    await p.mouse('move', q.x, q.y);
    await sleep(250);
    return p.eval(`(() => { const t = document.querySelector('#map .maplibregl-popup-content'); return t ? t.innerText : null; })()`);
  };
  const tips = await p.eval(`(() => { const v = CVIWA.state.mapHandle.mcView;
    const c = v.counties.slice().sort((a, b) => a.county < b.county ? -1 : 1)[0];
    const l = v.lines[v.lines.length - 1];
    return { county: [c.lon, c.lat], countyTip: c.tip, line: l.middle, lineTip: l.tip }; })()`);
  const countyText = await hover(tips.county);
  check(countyText && countyText.replace(/\s+/g, ' ') === tips.countyTip.join(' '), 'movement: a county\'s hover: within, sent, received',
    [countyText, tips.countyTip]);
  const lineText = await hover(tips.line);
  check(lineText && lineText.replace(/\s+/g, ' ') === tips.lineTip.join(' '), 'movement: a line\'s hover: pair, animals, records, top species',
    [lineText, tips.lineTip]);
  await p.mouse('move', 5, 5);

  // A spotlighted county: every pair touching it drawn and in full color, no other pair.
  const county = (await p.eval(BUTTONS('top_places')))[0].spot;
  await p.eval(`(() => { const i = [...document.querySelectorAll('#f-spotlight input')].find(x => x.value === ${JSON.stringify(county)});
    i.checked = true; i.dispatchEvent(new Event('change')); return true; })()`);
  await sleep(700);
  s = await p.eval(MV_STATE);
  want = await p.eval(MV_EXPECTED);
  const touching = s.lines.filter(l => l.key.split('\u0000').indexOf(county) >= 0);
  check(same(s.lines, want.lines) && touching.length > 0 && s.lines.every(l => l.on === (l.key.split('\u0000').indexOf(county) >= 0)),
    'movement: with a spotlight, the pairs touching it in full color', [touching.length, s.lines.length]);
  check(new RegExp('^.*Every pair touching ' + county + ' \\(' + touching.length + '\\)').test(s.legend), 'movement: the legend names the spotlight', s.legend);
  const corridorBars = await p.eval(BUTTONS('corridors'));
  check(corridorBars.length > 0 && corridorBars.every(x => x.value.split('\u0000').indexOf(county) >= 0),
    'movement: the corridor chart keeps the pairs touching the spotlight', corridorBars.map(x => x.value));
  await p.eval("document.querySelector('[data-clear=\"spotlight\"]').click(); true");
  await sleep(600);

  // A corridor bar: that line alone in full color; the other charts filtered to its rows; turning the view off drops it.
  const pair = (await p.eval(BUTTONS('corridors')))[1];
  const [o, d] = pair.value.split('\u0000');
  await clickMark(p, 'corridors', 'pair', pair.value);
  const c = await p.eval(CHIPS);
  check(same(c.chips, ['Corridor: ' + o + ' \u2192 ' + d]), 'movement: a corridor click shows its chip', c);
  s = await p.eval(MV_STATE);
  check(s.lines.filter(l => l.on).map(l => l.key).join() === pair.value && /The corridor picked in the chart/.test(s.legend),
    'movement: that line alone in full color', s.lines.filter(l => l.on));
  await expectAllSame(p, OTHERS_AS(['corridors'], `(W, st, rows) => rows.filter(r => r['Origin.State'] === 'WA' && r['Dest.State'] === 'WA'
    && r['Origin.County'] === ${JSON.stringify(o)} && r['Dest.County'] === ${JSON.stringify(d)})`),
  'movement: the other charts filtered to the corridor\'s rows');
  await p.screenshot(path.join(OUT, 'screens', 'movement_corridor_picked.png'));
  await mvToggle(p, false);
  const off = await p.eval(CHIPS);
  check(!off.chips.length && off.message === 'Chart filter removed (Corridor: ' + o + ' \u2192 ' + d + '). The movement view is off.',
    'movement: turning the view off drops a corridor filter, with a message', off);
  s = await p.eval(MV_STATE);
  check(!s.drawn && !s.layers.length && s.circles.every(x => x === 'visible') && s.note === null && !s.capShown,
    'movement: off again: the circles back, no movement layers');
  const offLook = await labelLook(p);
  check(offLook[0] === '11px' && offLook[1] === '400' && /^11px \(not semibold\)$/.test(offLook[2]),
    'movement: off again: county names as before (11 px, normal weight)', offLook);
  check(same(await p.eval('CVIWA.state.charts.charts.map(c => c.id)'), before), 'movement: the corridor chart gone');

  // The screenshot holds the lines and the badges.
  await mvToggle(p, true);
  const shot = await p.eval(`(async () => { const blob = await CVIWA.map.screenshot(CVIWA.state.mapHandle);
    const img = await createImageBitmap(blob), cv = document.createElement('canvas');
    cv.width = img.width; cv.height = img.height;
    const g = cv.getContext('2d'); g.drawImage(img, 0, 0);
    const px = g.getImageData(0, 0, img.width, img.height).data;
    let teal = 0;
    for (let i = 0; i < px.length; i += 4) if (Math.abs(px[i] - 0x24) < 20 && Math.abs(px[i + 1] - 0x55) < 20 && Math.abs(px[i + 2] - 0x66) < 20) teal++;
    return { teal, w: img.width }; })()`);
  check(shot.teal > 500, 'movement: the screenshot draws the lines', shot);
  // The arrowheads in the screenshot: for the busiest line, points inside its arrowhead beside the line (where the line
  // alone draws nothing) and on its axis have the line's color; county names off so they cannot cover the points.
  await p.eval("(() => { const c = document.getElementById('s-labels'); c.checked = false; c.dispatchEvent(new Event('change')); return true; })()");
  await sleep(500);
  const arrow = await p.eval(`(async () => { const h = CVIWA.state.mapHandle, m = h.map, v = h.mcView;
    const l = v.lines[v.lines.length - 1];
    const blob = await CVIWA.map.screenshot(h);
    const img = await createImageBitmap(blob), cv = document.createElement('canvas');
    cv.width = img.width; cv.height = img.height;
    const g = cv.getContext('2d'); g.drawImage(img, 0, 0);
    const k = img.width / m.getCanvas().clientWidth;
    const base = m.project(l.head.at), rad = l.head.bearing * Math.PI / 180;
    const fwd = { x: Math.sin(rad), y: -Math.cos(rad) }, side = { x: -fwd.y, y: fwd.x };
    const half = l.arrow_px * 13.8 / 22.8;
    const at = (f, s) => { const x = Math.round((base.x + fwd.x * f + side.x * s) * k), y = Math.round((base.y + fwd.y * f + side.y * s) * k);
      return Array.from(g.getImageData(x, y, 1, 1).data.slice(0, 3)); };
    const c = [1, 3, 5].map(i => parseInt(l.color.substr(i, 2), 16));
    const want = c.map(x => 0.9 * x + 0.1 * 0xec);
    const pts = [at(0.15 * l.arrow_px, 0.6 * half), at(0.15 * l.arrow_px, -0.6 * half), at(0.5 * l.arrow_px, 0)];
    return { ok: pts.every(q => q.every((x, i) => Math.abs(x - want[i]) < 30)), pts, want, key: l.key }; })()`);
  await p.eval("(() => { const c = document.getElementById('s-labels'); c.checked = true; c.dispatchEvent(new Event('change')); return true; })()");
  await sleep(300);
  check(arrow.ok, 'movement: the screenshot draws a filled arrowhead at the busiest line\'s end, pointing along it', arrow);

  // Browse: the lines follow the frame; Compare: the right map draws its own.
  await p.eval(`(() => { const r = document.querySelector('input[name=period-mode][value=browse]');
    r.checked = true; r.dispatchEvent(new Event('change')); return true; })()`);
  await sleep(900);
  s = await p.eval(MV_STATE);
  want = await p.eval(MV_EXPECTED);
  check(same(s.lines, want.lines) && (await p.eval('CVIWA.state.years.length')) === 1, 'movement: Browse draws the frame\'s movement', s.lines.length);
  await p.eval(`(() => { const r = document.querySelector('input[name=period-mode][value=compare]');
    r.checked = true; r.dispatchEvent(new Event('change')); return true; })()`);
  await sleep(1500);
  const right = await p.eval(`(() => { const h = CVIWA.state.mapHandleB; return { drawn: !!(h && h.mcView), layers: h ? CVIWA.map.MC_LAYERS.filter(id => !!h.map.getLayer(id)).length : 0,
    badges: h && h.mcView ? h.mcView.lines.filter(l => l.badge).length : -1 }; })()`);
  check(right.drawn && right.layers === 6 && right.badges === 0, 'movement: in Compare the right map draws its own movement, without badges', right);
  await p.screenshot(path.join(OUT, 'screens', 'movement_compare.png'));

  // Reset All turns the view off and puts Top 10 back.
  await p.eval(`(() => { const c = document.getElementById('mv-cap'); c.value = '50'; c.dispatchEvent(new Event('change')); return true; })()`);
  await p.eval("document.getElementById('reset-all').click(); true");
  await sleep(1200);
  s = await p.eval(MV_STATE);
  check(!s.on && !s.drawn && s.cap === 10 && !(await p.eval("document.getElementById('mv-on').checked")) && s.circles.every(x => x === 'visible'),
    'movement: Reset All turns it off, Top 10 again', s);
}

// ── Part: exports and previews ──────────────────────────────────────────────────────────────────────────────────
// With a chart filter on, Export writes the files of the matching sidebar pick (a species or a period: the page's own
// builders given that pick, without crossfilter.js) or of no filter at all (a place, which only highlights); the Stats
// text and export_params.json name the chart filter, and otherwise equal those of that pick (time masked); the
// exported charts are the screen's charts, the picked kind's chart with faint marks; Preview Charts does the same.
// Chrome is told to refuse the downloads, so nothing is saved; the ZIP is read from the page's own bytes.
// A stored ZIP's entries (local headers in order): name and data.
function readZip(buf) {
  const out = {};
  let at = 0;
  while (at + 30 <= buf.length && buf.readUInt32LE(at) === 0x04034b50) {
    const size = buf.readUInt32LE(at + 18), nameLen = buf.readUInt16LE(at + 26), extra = buf.readUInt16LE(at + 28);
    const name = buf.slice(at + 30, at + 30 + nameLen).toString('utf8');
    const start = at + 30 + nameLen + extra;
    out[name.split('/').slice(1).join('/')] = buf.slice(start, start + size);
    at = start + size;
  }
  return out;
}
// Export with these formats ticked; the ZIP's files by their path inside the folder.
async function exportNow(p, formats) {
  const r = await p.eval(`(async () => {
    document.querySelectorAll('input[name=export-format]').forEach(i => { i.checked = ${JSON.stringify(formats)}.includes(i.value); });
    const before = CVIWA.state.lastExport;
    document.getElementById('run-export').click();
    for (let i = 0; i < 300 && (CVIWA.state.lastExport === before || CVIWA.state.exporting); i++) await new Promise(r => setTimeout(r, 100));
    const e = CVIWA.state.lastExport;
    if (e === before) return null;
    let s = '';
    for (let i = 0; i < e.bytes.length; i += 32768) s += String.fromCharCode.apply(null, e.bytes.subarray(i, i + 32768));
    return { name: e.name, errors: e.errors, b64: btoa(s) };
  })()`);
  check(!!r && !r.errors.length, partNow + ': an export was made', r && r.errors);
  return r ? Object.assign(readZip(Buffer.from(r.b64, 'base64')), { zipName: r.name }) : {};
}
// The Stats text Preview Stats shows (the dialog closed again through the page's own function).
const STATS_TEXT = `(() => { document.getElementById('preview-stats').click();
  const t = document.querySelector('#preview-dialog .stats-text'); const text = t ? t.textContent : null;
  CVIWA.previews.close(); return text; })()`;
// What the page's own builders give for the view's sidebar filters with pick laid over them (no chart filters): the
// two CSV files, the Stats lines and export_params.json, for the same time.
const EXPECTED_FILES = (view, pick) => `(() => {
  const W = CVIWA, st = W.state, m = st.master, EX = W.exports, pick = ${JSON.stringify(pick || {})};
  const now = new Date();
  let f, rows, agg;
  if ('${view}' === 'wa') {
    f = Object.assign({ species: st.species, years: st.years, quarters: st.quarters, direction: st.direction,
      rawSpecies: st.speciesSub, mode: st.mode, scaling: st.scaling, nBins: st.nBins }, pick);
    rows = W.summary.mapRows(m, f) || [];
    agg = W.aggregate.build(m.rows, Object.assign({}, f, { hasSpecies: m.hasSpecies }));
  } else if ('${view}' === 'flow') {
    const fl = W.flowState;
    f = Object.assign({ direction: fl.direction, species: fl.species, speciesSub: fl.speciesSub, years: fl.years,
      quarters: fl.quarters, combine: fl.combine, scaling: fl.scaling, nBins: fl.nBins, palette: fl.palette,
      multiplier: fl.multiplier, opacity: fl.opacity }, pick);
    rows = W.flow.mapRows(m, f) || [];
    agg = W.flow.lines(m, f, W.flow.centers(window.WSDA_STATE_CENTERS)) || [];
  } else {
    const fo = W.focusState;
    f = Object.assign({ counties: fo.counties, direction: fo.direction, mode: fo.mode, species: fo.species,
      rawSpecies: fo.speciesSub, years: fo.years, quarters: fo.quarters, scaling: fo.scaling, nBins: fo.nBins }, pick);
    rows = W.focus.summaryRows(m, f) || [];
    agg = W.focus.build(m, f).premises;
  }
  return { csv: EX.filteredRowsCsv(m, rows).text, summary: EX.summaryTableCsv('${view}', agg, f.combine),
    stats: EX.statsLines('${view}', f, rows, agg, now), params: EX.exportParams('${view}', f, { label: '',
      formats: ['csv', 'summary_csv'], layersOn: [] }, now) };
})()`;
// The files of an export with chart filters against the expected files: the CSVs byte for byte; the Stats text and
// export_params.json with the time masked and the chart filter line taken out, which must name exactly these chips.
async function compareExport(p, view, pick, chips, label) {
  const want = await p.eval(EXPECTED_FILES(view, pick));
  const got = await exportNow(p, ['csv', 'summary_csv']);
  const text = b => (b ? b.toString('utf8') : null);
  check(text(got['filtered_rows.csv']) === want.csv && text(got['summary_table.csv']) === want.summary,
    partNow + ': ' + label + ': filtered_rows.csv and summary_table.csv as ' + (Object.keys(pick).length ? 'the sidebar pick' : 'without the filter'),
    [got.zipName, (text(got['filtered_rows.csv']) || '').length, want.csv.length]);
  const masked = list => list.filter(l => !/^Generated: |^  Chart filters: |"exported_at"|"chart_filters"/.test(l));
  const stats = (await p.eval(STATS_TEXT) || '').split('\n');
  const dir = stats.findIndex(l => /^  Direction: /.test(l));
  check(stats[dir + 1] === '  Chart filters: ' + chips.join('; ') && same(masked(stats), masked(want.stats)),
    partNow + ': ' + label + ': the Stats text names the chart filters, the rest as the pick\'s', [stats[dir + 1], chips]);
  const params = text(got['export_params.json']).split('\n');
  const named = params.find(l => /"chart_filters"/.test(l));
  const wantNamed = '  "chart_filters": ' + (chips.length === 1 ? JSON.stringify(chips[0]) : '[' + chips.map(c => JSON.stringify(c)).join(', ') + ']') + ',';
  check(named === wantNamed && same(masked(params), masked(want.params.split('\n'))),
    partNow + ': ' + label + ': export_params.json names the chart filters, the rest as the pick\'s', [named, wantNamed]);
}
const clearChartFilters = p => p.eval("(() => { const b = document.getElementById('chart-filters-clear'); if (!b.hidden) b.click(); return true; })()").then(() => settle(p));
async function partExports(b) {
  const p = b.page;
  await b.send('Browser.setDownloadBehavior', { behavior: 'deny' });
  await openPage(b);
  await p.viewport(1400, 1000);
  await loadMaster(p, TIER_FULL);
  await showView(p, 'wa');
  await setLayout(p, 'split');

  // WA State: a species, a period, a county (the spotlight).
  await clickMark(p, 'species', 'species', 'Cattle');
  await compareExport(p, 'wa', { species: ['Cattle'] }, ['Species group: Cattle'], 'WA species');
  // The exported charts are the screen's, the species chart with faint marks; Preview Charts the same.
  const before = await p.eval('CVIWA.state.lastExportCharts');
  const zip = await exportNow(p, ['charts']);
  const ex = await p.eval(`(() => { const e = CVIWA.state.lastExportCharts, s = CVIWA.state.charts.charts;
    return { faded: e.faded, caption: e.caption, sameAsScreen: e.charts.filter(c => s.some(x => x.id === c.id))
      .every(c => JSON.stringify(c) === JSON.stringify(s.find(x => x.id === c.id))), ids: e.charts.map(c => c.id) }; })()`);
  check(ex.sameAsScreen && ex.ids.indexOf('species') >= 0 && same(ex.faded, ['species']) && before === null,
    'exports: WA species: the exported charts are the screen\'s, the species chart faint where not picked', ex);
  check(/ \| Chart filters: Species group: Cattle$/.test(ex.caption), 'exports: WA species: the charts\' caption names the chart filter', ex.caption);
  const drawn = await p.eval(`(async () => { const e = CVIWA.state.lastExportCharts, CS = CVIWA.chartsvg;
    const b64 = async blob => { const a = new Uint8Array(await blob.arrayBuffer()); let s = '';
      for (let i = 0; i < a.length; i += 32768) s += String.fromCharCode.apply(null, a.subarray(i, i + 32768)); return btoa(s); };
    const plain = id => CS.png(e.charts.find(c => c.id === id), { caption: e.caption, footer: e.footer, measure: CVIWA.state.chartMeasure });
    return { species: await b64(await plain('species')), places: await b64(await plain('top_places')) }; })()`);
  check(!!zip['charts/species_breakdown.png'] && zip['charts/species_breakdown.png'].toString('base64') !== drawn.species
    && !!zip['charts/top_counties.png'] && zip['charts/top_counties.png'].toString('base64') === drawn.places,
  'exports: WA species: the exported species chart differs from it drawn without faint marks, an unpicked kind\'s does not');
  await p.eval(`(async () => { document.getElementById('preview-charts').click();
    for (let i = 0; i < 200 && CVIWA.state.exporting; i++) await new Promise(r => setTimeout(r, 100));
    CVIWA.previews.close(); return true; })()`);
  const pv = await p.eval('(() => { const e = CVIWA.state.lastExportCharts; return { faded: e.faded, caption: e.caption }; })()');
  check(same(pv.faded, ['species']) && pv.caption === ex.caption, 'exports: WA species: Preview Charts draws the same charts', pv);
  await clearChartFilters(p);

  const period = (await p.eval(BUTTONS('over_time')))[1].value;
  await clickMark(p, 'over_time', 'period', period);
  const [py, pq] = period.split(' ');
  const pick = await p.eval(`(() => ({ years: CVIWA.state.years.filter(y => Number(y) === ${Number(py)}), quarters: ['${pq}'] }))()`);
  await compareExport(p, 'wa', pick, ['Period: ' + period], 'WA period');
  await clearChartFilters(p);

  const county = (await p.eval(BUTTONS('top_places')))[0];
  await clickMark(p, 'top_places', 'place', county.value);
  await compareExport(p, 'wa', {}, ['Spotlight: ' + county.spot], 'WA spotlight');
  await p.eval("document.querySelector('[data-clear=\"spotlight\"]').click(); true");
  await settle(p);

  // WA State with the movement view on: the corridor chart is exported too.
  await p.eval("(() => { const c = document.getElementById('mv-on'); c.checked = true; c.dispatchEvent(new Event('change')); return true; })()");
  await sleep(700);
  const mvZip = await exportNow(p, ['charts']);
  check(!!mvZip['charts/corridors.png'] && (await p.eval("CVIWA.state.lastExportCharts.charts.some(c => c.id === 'corridors' && c.title === 'Top movement corridors within Washington')")),
    'exports: WA movement view: the corridor chart within Washington is exported');
  await p.eval("(() => { const c = document.getElementById('mv-on'); c.checked = false; c.dispatchEvent(new Event('change')); return true; })()");
  await sleep(500);

  // National Flow: a state (highlight) and a species.
  await showView(p, 'flow');
  await setLayout(p, 'split');
  const state = (await p.eval(BUTTONS('top_places')))[0].value;
  await clickMark(p, 'top_places', 'place', state);
  const flowChips = (await p.eval(CHIPS)).chips;
  await compareExport(p, 'flow', {}, flowChips, 'Flow state');
  await clearChartFilters(p);
  await clickMark(p, 'species', 'species', 'Cattle');
  await compareExport(p, 'flow', { species: ['Cattle'] }, ['Species group: Cattle'], 'Flow species');
  await clearChartFilters(p);

  // County Focus: a premises (highlight).
  await showView(p, 'focus');
  await setLayout(p, 'split');
  const prem = (await p.eval(BUTTONS('top_premises')))[0].value;
  await clickMark(p, 'top_premises', 'premises', prem);
  const focusChips = (await p.eval(CHIPS)).chips;
  check(focusChips.length === 1 && /^Premises: /.test(focusChips[0]), 'exports: County Focus: the premises chip', focusChips);
  await compareExport(p, 'focus', {}, focusChips, 'Focus premises');
  await clearChartFilters(p);
}

// ── Part: performance ──────────────────────────────────────────────────────────────────────────────────────
// A synthetic 20,000-row master (the Full tier repeated, each copy with its own CVI number): a click redraws the charts
// within 1 second (S7's budget), in each view; the map's redraw time is recorded too.
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
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(file, out.join('\n') + '\n');
  return file;
}
// Clicks a chart's first button in the page and returns how long the click took to redraw the charts (ms).
const TIMED_CLICK = chart => `(() => {
  const b = document.querySelector('#chart-grid .chart-card[data-chart="${chart}"] .chart-pick');
  const t0 = performance.now();
  b.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  return { ms: performance.now() - t0, drawnIn: CVIWA.state.chartsMs };
})()`;
async function partPerf(b) {
  const p = b.page;
  await openPage(b);
  await p.viewport(1400, 1000);
  await loadMaster(p, bigMaster());
  const rows = await p.eval('CVIWA.state.master.physicalRows');
  check(rows === 20000, 'perf: 20,000 rows loaded', rows);
  const out = {};
  for (const view of ['wa', 'flow', 'focus']) {
    await showView(p, view);
    await setLayout(p, 'split');
    const times = [];
    for (let i = 0; i < 3; i++) {
      const t = await p.eval(TIMED_CLICK('species'));
      times.push(t.ms);
      await sleep(600);   // the map's redraw after the 250 ms pause
    }
    const median = times.slice().sort((a, b) => a - b)[1];
    out[view] = { times, median };
    check(median < 1000, 'perf: ' + view + ' a click redraws the charts within 1 second', times.map(t => Math.round(t)));
  }
  return out;
}

// ── Run ────────────────────────────────────────────────────────────────────────────────────────────────────
(async () => {
  for (const f of [TIER_FULL, TIER_PARTNER, MOVEMENT]) {
    if (!fs.existsSync(f)) throw new Error('Missing ' + f + ': run node tests/synthetic/make_test_tables.js');
  }
  const b = await launch();
  const run = { chrome: b.version, page: PAGE, parts: PARTS, started: new Date().toISOString(), results: {} };
  try {
    for (const part of PARTS) {
      partNow = part;
      if (part === 'marks') run.results.marks = await partMarks(b);
      else if (part === 'wa') run.results.wa = await partWa(b);
      else if (part === 'flow') run.results.flow = await partFlow(b);
      else if (part === 'focus') run.results.focus = await partFocus(b);
      else if (part === 'movement') run.results.movement = await partMovement(b);
      else if (part === 'exports') await partExports(b);
      else if (part === 'perf') run.results.perf = await partPerf(b);
      else throw new Error('Unknown part ' + part);
    }
  } catch (e) {
    failed++;
    failures.push('run stopped: ' + (e && e.stack ? e.stack : e));
  } finally {
    check(!b.log.exceptions.length, 'page: no exceptions', b.log.exceptions);
    check(!b.log.csp.length, 'page: no Content Security Policy reports', b.log.csp);
    const outside = b.log.requests.filter(u => !/^(file:|data:|blob:|http:\/\/127\.0\.0\.1:8765\/)/.test(u));
    check(!outside.length, 'page: no request leaves this computer', outside);
    await b.close();
  }
  run.passed = passed;
  run.failed = failed;
  run.counts = counts;
  run.failures = failures;
  fs.writeFileSync(path.join(OUT, 'run.json'), JSON.stringify(run, null, 1));
  Object.keys(counts).forEach(k => console.log('  ' + k + ': ' + counts[k] + ' checks'));
  if (run.results.perf) console.log('  perf medians (ms): ' + Object.entries(run.results.perf).map(([k, v]) => k + ' ' + Math.round(v.median)).join(', '));
  failures.slice(0, 40).forEach(f => console.log('FAIL ' + f));
  console.log('MC browser (' + PARTS.join(', ') + '): ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch(e => {
  console.error(e);
  process.exit(1);
});
