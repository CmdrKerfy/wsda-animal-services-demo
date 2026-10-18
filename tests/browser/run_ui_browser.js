#!/usr/bin/env node
'use strict';
// UI and style-guide browser suite in installed Chrome, through the DevTools protocol, offline, foreground only (Chrome
// does not start from a background job). No packages.
//
// Parts (checks by default; name some to run only those, for example: node tests/browser/run_ui_browser.js checks):
//   checks  each of the six views drawn with synthetic files (the landing page with the all-in-one sample, the CVI
//           page's WA State, National Flow, County Focus and Premise Lookup with the Full tier, the Infrastructure
//           dashboard with its sample): Open Sans loaded from the site and used; the logo drawn (1760 x 724) in a
//           50 px banner; the names and one badge; the footer line; then every visible text the page draws (map
//           names, hover cards and chart text left out by design; Premise Lookup with a sites table row selected):
//           its size at the floor (0.85rem for controls, 0.75rem for everything else) and its contrast with what is
//           behind it (4.5:1, or 3:1 for large text; grayed controls left out, as WCAG does); no request outside the
//           site, no policy report, no page error
//   controls  the buttons, keyboard and "Show as table" checks; every "?" button's target size, 24 px or spaced as
//           WCAG 2.5.8 allows, and that it stays round
//   day3    Preview Stats's added lines, the footer's glossary opened with Enter, and Preview map's time with 200, 800
//           and 2,000 named feedlots
//   chartlabels  every chart text inside its picture, on the page and in the export pictures
//
// Usage (repository root, after node tests/synthetic/make_test_tables.js or an F1 unit run, which write test-tables/):
//   node tests/browser/run_ui_browser.js [checks] [controls] [day3] [chartlabels]
//   Hosted mode: node tests/browser/serve_case_strict.js, then UI_SITE_URL=http://127.0.0.1:8765/ node tests/browser/run_ui_browser.js
// Writes local-test-artifacts/ui/browser/run.json (results).
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join(ROOT, 'local-test-artifacts', 'ui', 'browser');
const TABLES = path.join(ROOT, 'test-tables');
const SITE_URL = process.env.UI_SITE_URL || pathToFileURL(path.join(ROOT, 'site')).href + '/';
const CHROME = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const asked = process.argv.slice(2).filter(a => !a.startsWith('--'));
const PARTS = asked.length ? asked : ['checks'];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const js = x => JSON.stringify(x);
const WIDTH = 1400, HEIGHT = 1000;

// ── Chrome through the DevTools protocol (as the S9 suite) ─────────────────────────────────────────────────────
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
    '--disable-component-update', '--disable-sync', '--window-size=' + WIDTH + ',' + HEIGHT, 'about:blank'],
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
    // A part of the page in window coordinates. Only a page of plain HTML is taken beyond the window: that resizes
    // the page, and a resized MapLibre map is blank until it draws again.
    async shot(file, clip, beyond) {
      const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: !!beyond,
        clip: Object.assign({ scale: 1 }, clip) }, sid);
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
  return { version: version.Browser, log, page, close, send, sid };
}

// ── Checks ─────────────────────────────────────────────────────────────────────────────────────────────────────
let passed = 0, failed = 0;
const failures = [];
function check(ok, name, detail) {
  if (ok) passed++;
  else {
    failed++;
    failures.push(name + (detail !== undefined ? ' :: ' + JSON.stringify(detail).slice(0, 600) : ''));
  }
}

// ── The six views, set up through the pages' own controls and hooks (the same steps for any copy of the site) ───
const T = name => path.join(TABLES, name);
const FULL_DIR = T('tier_full');
const FACILITY_FILES = { manifest: 'facility_overlays_manifest.csv', slaughterhouses: 'usda_wa_slaughter_facilities.csv',
  fairgrounds: 'wa_state_fairs.csv', markets: 'wa_state_public_livestock_markets.csv', feedlots: 'wa_state_feedlots.csv',
  restricted: 'wa_state_restricted_holding_facilities.csv', syn_custommeat: 'synthetic_custom_meat_geocoded.csv',
  syn_disposal: 'synthetic_animal_disposal.csv' };
const facilityTexts = () => {
  const out = {};
  Object.keys(FACILITY_FILES).forEach(k => { out[k] = fs.readFileSync(path.join(FULL_DIR, FACILITY_FILES[k]), 'utf8'); });
  return out;
};
const VIEWS = [
  { id: 'landing', name: 'Landing page (the all-in-one sample loaded)', file: 'index.html' },
  { id: 'wa', name: 'CVI page: WA State (Full tier)', file: 'cvi/index.html' },
  { id: 'flow', name: 'CVI page: National Flow (Full tier)', file: 'cvi/index.html' },
  { id: 'focus', name: 'CVI page: County Focus (Full tier, two counties, facility files)', file: 'cvi/index.html' },
  { id: 'lookup', name: 'CVI page: Premise Lookup (Full tier, two sites, Run query)', file: 'cvi/index.html' },
  { id: 'infra', name: 'Infrastructure dashboard (its sample)', file: 'infrastructure/index.html' }
];
async function openView(b, base, view) {
  const p = b.page;
  await p.viewport(WIDTH, HEIGHT);
  await p.goto(base + view.file);
  if (view.id === 'landing') {
    await p.waitFor('window.WSDA && WSDA.landing && WSDA.landing.state', 15000, 'landing ready');
    const v = await p.eval('WSDA.landing.state.version');
    await p.setFiles('#files-input', [T('WSDA_sample_all_dashboards_synthetic.zip')]);
    await p.waitFor('!WSDA.landing.state.loading && WSDA.landing.state.version > ' + v, 30000, 'sample loaded');
    await sleep(500);
    return;
  }
  if (view.id === 'infra') {
    await p.waitFor('window.WSDA && WSDA.infrastructure && WSDA.infrastructure.state', 15000, 'dashboard ready');
    await p.setFiles('#files-input', [T('infrastructure_synthetic.zip')]);
    await p.waitFor('WSDA.infrastructure.state.facilityFiles > 0 && !WSDA.infrastructure.state.loading', 30000, 'sample loaded');
    await sleep(1200);
    return;
  }
  await p.waitFor('window.CVIWA && CVIWA.state && CVIWA.state.mapHandle && CVIWA.lookupState', 15000, 'CVI page ready');
  const v = await p.eval('CVIWA.state.version');
  await p.setFiles('#file-input', [T('tier_full_master.csv')]);
  await p.waitFor('CVIWA.state.master && !CVIWA.state.loading && CVIWA.state.version > ' + v, 30000, 'master loaded');
  if (view.id === 'wa') {
    await sleep(900);
    return;
  }
  if (view.id === 'lookup') {
    await p.eval(`document.getElementById('show-lookup').click(); true`);
    await p.waitFor(`CVIWA.lookupState.places === 'ready'`, 15000, 'places loaded');
    await p.eval(`CVIWA.lookupState.testSetSites(${js([
      { name: 'Farm A', lat: 47.7365, long: -123.6044 }, { name: 'Farm B', lat: 46.6021, long: -120.5059 }])}); true`);
    await p.eval(`document.getElementById('lk-run').click(); true`);
    await p.waitFor('CVIWA.lookupState.map && CVIWA.lookupState.map.ready && CVIWA.lookupState.map.drawn', 20000, 'match map');
    await sleep(1200);
    return;
  }
  if (view.id === 'focus') {
    await p.eval(`(t => { const d = {};
      Object.keys(t).forEach(k => { d[k] = { file: new Blob([t[k]], { type: 'text/csv' }) }; });
      return CVIWA.setFacilityFiles(d).then(() => true); })(${js(facilityTexts())})`);
  }
  const button = { flow: 'show-flow', focus: 'show-focus' }[view.id];
  const handle = { flow: 'flowHandle', focus: 'focusHandle' }[view.id];
  await p.eval(`document.getElementById('${button}').click(); true`);
  await p.waitFor(`CVIWA.state.${handle} && CVIWA.state.${handle}.ready`, 20000, view.id + ' map ready');
  if (view.id === 'focus') {
    // Each tick redraws the list, so every box is looked up again before it is changed.
    await p.eval(`(() => {
      const box = v => [...document.querySelectorAll('#fo-counties input')].find(x => x.value === v);
      const set = (v, on) => { const x = box(v); if (x && x.checked !== on) { x.checked = on; x.dispatchEvent(new Event('change')); } };
      CVIWA.focusState.counties.slice().forEach(v => set(v, false));
      ['King', 'Yakima'].forEach(v => set(v, true));
      return true; })()`);
  }
  await sleep(1200);
}

// ── What the page draws: every visible text's size and contrast (runs in the page) ──────────────────────────────
// Left out: text on the maps (names, counts, hover cards, MapLibre's controls), chart text (SVG), and grayed controls
// (WCAG 1.4.3 exempts inactive controls). The background is the nearest one behind the text, translucent ones blended
// over white; a background picture makes it unknown (counted, not judged).
function pageAudit() {
  const parse = c => {
    const m = /rgba?\(([^)]+)\)/.exec(c || '');
    if (!m) return null;
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const over = (top, under) => ({ r: top.r * top.a + under.r * (1 - top.a), g: top.g * top.a + under.g * (1 - top.a),
    b: top.b * top.a + under.b * (1 - top.a), a: 1 });
  const lum = c => {
    const f = v => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const ratio = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
  const hex = c => '#' + [c.r, c.g, c.b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
  const behind = el => {
    const layers = [];
    let opacity = 1;
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
      const cs = getComputedStyle(e);
      opacity *= Number(cs.opacity);
      if (cs.backgroundImage && cs.backgroundImage !== 'none') return { unknown: true };
      const c = parse(cs.backgroundColor);
      if (c && c.a > 0) {
        layers.push(c);
        if (c.a >= 1) break;
      }
    }
    let bg = { r: 255, g: 255, b: 255, a: 1 };
    for (let i = layers.length - 1; i >= 0; i--) bg = over(layers[i], bg);
    return { bg, opacity };
  };
  const MAP = '.maplibregl-map, .focus-counts, .facility-counts';
  const GRAYED = 'button:disabled, input:disabled, select:disabled, fieldset:disabled, [aria-disabled="true"], .gated, ' +
    '.unusable, .metric-zero, label:has(input:disabled)';
  const CONTROL = 'button, select, input, textarea, summary, .btn, [role="button"]';
  const items = [];
  const counts = { texts: 0, map: 0, chart: 0, grayed: 0, unknown: 0 };
  const record = (el, text) => {
    if (el.closest(MAP)) { counts.map++; return; }
    if (el.closest('svg')) { counts.chart++; return; }
    if (el.closest(GRAYED)) { counts.grayed++; return; }
    const cs = getComputedStyle(el);
    const size = parseFloat(cs.fontSize), weight = Number(cs.fontWeight) || 400;
    const b = behind(el);
    if (b.unknown) { counts.unknown++; return; }
    const fg = parse(cs.color);
    const seen = over({ r: fg.r, g: fg.g, b: fg.b, a: fg.a * b.opacity }, b.bg);
    const control = !!el.closest(CONTROL);
    const mono = !!el.closest('code, pre, kbd, .stats-text');
    const id = el.id ? '#' + el.id : '';
    const cls = typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).join('.') : '';
    items.push({ text: text.trim().slice(0, 50), el: el.tagName.toLowerCase() + id + cls, size, weight, control, mono,
      font: cs.fontFamily.split(',')[0].replace(/"/g, ''), fg: hex(seen), bg: hex(b.bg), ratio: Number(ratio(seen, b.bg).toFixed(2)),
      large: size >= 24 || (size >= 18.66 && weight >= 700) });
    counts.texts++;
  };
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.textContent.trim()) continue;
    const el = n.parentElement;
    if (!el || !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
    if (['SCRIPT', 'STYLE', 'OPTION', 'TITLE', 'NOSCRIPT'].includes(el.tagName)) continue;
    const range = document.createRange();
    range.selectNodeContents(n);
    const r = range.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    record(el, n.textContent);
  }
  // Fields and lists show their text without a text node of their own (a select's choice, a typed value).
  document.querySelectorAll('select, textarea, input').forEach(el => {
    if (el.tagName === 'INPUT' && !['text', 'number', 'search', 'file', ''].includes(el.type)) return;
    if (!el.checkVisibility({ checkVisibilityCSS: true })) return;
    record(el, el.tagName === 'SELECT' ? (el.selectedOptions[0] || {}).text || '' : el.value || el.type);
  });
  return { counts, items };
}
const AUDIT = '(' + pageAudit.toString() + ')()';
// The floor: controls 0.85rem (13.6 px), everything else 0.75rem (12 px); half a hundredth of a pixel
// is allowed for rounding.
const floorOf = it => (it.control ? 13.6 : 12) - 0.005;
const minRatio = it => (it.large ? 3 : 4.5);

async function viewFacts(p) {
  return p.eval(`document.fonts.ready.then(() => {
    const logo = document.querySelector('header.top img.brand-logo');
    const h1 = document.querySelector('header.top h1');
    return { fonts: [...document.fonts].map(f => f.family + ' ' + f.status),
      openSans: document.fonts.check('16px "Open Sans"'), body: getComputedStyle(document.body).fontFamily,
      title: document.title, banner: Math.round(document.querySelector('header.top').getBoundingClientRect().height),
      logo: logo ? { complete: logo.complete, w: logo.naturalWidth, h: logo.naturalHeight,
        shown: Math.round(logo.getBoundingClientRect().height), alt: logo.alt,
        above: Math.round(logo.getBoundingClientRect().top - document.querySelector('header.top').getBoundingClientRect().top),
        below: Math.round(document.querySelector('header.top').getBoundingClientRect().bottom - logo.getBoundingClientRect().bottom) } : null,
      h1: h1 ? h1.textContent.replace(/\\s+/g, ' ').trim() : '',
      badges: [...document.querySelectorAll('.badge')].map(e => e.textContent),
      foot: ((document.querySelector('footer .foot-line') || {}).textContent || '').replace(/\\s+/g, ' ').trim() };
  })`);
}

// Measured twice: as the view opens, then with every folded section open (and, on WA State, the charts beside the
// map), so text in closed sections is measured too.
async function measure(p, view) {
  const first = await p.eval(AUDIT);
  await p.eval(`(() => { document.querySelectorAll('details').forEach(d => { if (!d.closest('.maplibregl-map')) d.open = true; });
    document.querySelectorAll('.fold-toggle[aria-expanded="false"]').forEach(t => t.click()); return true; })()`);
  if (view.id === 'wa') {
    const v = await p.eval('CVIWA.state.chartsVersion');
    await p.eval(`document.querySelector('.layout-switch [data-layout="split"]').click(); true`);
    await p.waitFor('CVIWA.state.chartsVersion > ' + v, 5000, 'charts drawn');
  }
  await sleep(400);
  const second = await p.eval(AUDIT);
  return { first, second, a: { counts: second.counts, items: first.items.concat(second.items) } };
}

async function partChecks(b) {
  const p = b.page;
  const results = {};
  for (const view of VIEWS) {
    await openView(b, SITE_URL, view);
    const f = await viewFacts(p);
    if (view.id === 'lookup') {
      // A selected row, so its gray cells are measured on the selected row's blue.
      const sel = await p.eval(`(() => { const tr = document.querySelector('#lk-sites tbody tr[data-uid]');
        if (!tr) return null;
        tr.querySelector('td.row-no').click();
        return { selected: tr.classList.contains('selected') }; })()`);
      check(sel && sel.selected, 'lookup: a sites table row selected before the text is measured', sel);
    }
    const { first, second, a } = await measure(p, view);
    const tag = view.id + ': ';
    const dashboard = { landing: null, infra: 'Infrastructure' }[view.id] === undefined ? 'CVI Traceability'
      : { landing: null, infra: 'Infrastructure' }[view.id];
    check(f.fonts.includes('Open Sans loaded') && f.openSans && /^"?Open Sans"?,/.test(f.body),
      tag + 'Open Sans loaded from the site and used for the page', f);
    check(f.logo && f.logo.complete && f.logo.w === 1760 && f.logo.h === 724 && f.logo.shown === 32
      && f.logo.alt === 'Washington State Department of Agriculture', tag + 'the logo drawn, 32 px high, with its alt text', f.logo);
    check(f.banner === 50, tag + 'the banner is 50 px high (the CVI page\'s layout subtracts --banner-height)', f.banner);
    // The guide's clear space: at least the "W"'s height (about 8.3 px) above and below the logo.
    check(f.logo && f.logo.above >= 9 && f.logo.below >= 9, tag + 'at least 9 px above and below the logo', f.logo);
    check(f.h1 === 'Animal Services Division · Visualization Platform' + (dashboard ? ' ' + dashboard : ''),
      tag + 'the banner\'s names', f.h1);
    check(f.badges.length === 1 && f.badges[0] === 'SYNTHETIC DATA ONLY', tag + 'one badge', f.badges);
    check(/^Washington State Department of Agriculture · Synthetic test data only\. Not an official WSDA service\./.test(f.foot || ''),
      tag + 'the footer line', f.foot);
    check(first.counts.texts > 40 && second.counts.texts > first.counts.texts,
      tag + 'the page\'s text read (' + first.counts.texts + ' texts, ' + second.counts.texts + ' with the sections open)',
      [first.counts, second.counts]);
    const small = a.items.filter(it => it.size < floorOf(it));
    check(!small.length, tag + 'every text at the floor (controls 0.85rem, the rest 0.75rem)', small.slice(0, 8));
    const low = a.items.filter(it => it.ratio < minRatio(it));
    check(!low.length, tag + 'every text at 4.5:1 against its background (3:1 when large)', low.slice(0, 8));
    // File and column names in <code> and the Stats text are monospace on purpose.
    const notOpenSans = a.items.filter(it => it.font !== 'Open Sans' && !it.mono);
    check(!notOpenSans.length, tag + 'every text in Open Sans (outside maps, charts and code)', notOpenSans.slice(0, 8));
    results[view.id] = { facts: f, counts: a.counts, pairs: summarize(a.items) };
  }
  const outside = b.log.requests.filter(u => !u.startsWith(SITE_URL) && !u.startsWith('data:') && !u.startsWith('blob:'));
  check(!outside.length, 'no request outside the site', outside.slice(0, 5));
  check(b.log.requests.some(u => /shared\/fonts\/OpenSans-Variable-latin\.woff2$/.test(u)), 'the font file was read from the site');
  // A layer color the browser draws but the page does not read (a name, hsl()) is drawn as written in
  // the lists, legends and count cards; anything else falls back to gray.
  const marks = await p.eval(`(() => { const F = WSDA.facilities, fill = c => (F.markSvg({ color: c, shape: 'circle' })
    .match(/ fill="([^"]*)"/) || [])[1];
    return { hsl: fill('hsl(200, 50%, 30%)'), name: fill('teal'), bad: fill('url(#x)'), quote: fill('red" onload="x'),
      nonsense: fill('notacolor') }; })()`);
  check(marks.hsl === 'hsl(200, 50%, 30%)' && marks.name === 'teal' && marks.bad === '#666666' &&
    marks.quote === '#666666' && marks.nonsense === '#666666', 'marks: hsl() and color names drawn as written in the ' +
    'lists, other text gray', marks);
  return results;
}

// Unique text and background pairs, with how often each appears and an example.
function summarize(items) {
  const by = new Map();
  items.forEach(it => {
    const k = it.fg + ' ' + it.bg + ' ' + (it.large ? 'L' : 'N');
    const e = by.get(k) || { fg: it.fg, bg: it.bg, ratio: it.ratio, large: it.large, count: 0, examples: [] };
    e.count++;
    if (e.examples.length < 3 && !e.examples.some(x => x.el === it.el)) e.examples.push({ text: it.text, el: it.el, size: it.size });
    by.set(k, e);
  });
  return [...by.values()].sort((x, y) => x.ratio - y.ratio);
}


// ── The controls ─────────────────────────────────────────────────────────────────────────────────────────────────
// Every visible button on a view, with every section open: its text, classes, computed look and size, and whether it
// has an icon. Runs in the page.
function buttonSurvey() {
  document.querySelectorAll('details').forEach(d => { d.open = true; });
  const out = [];
  document.querySelectorAll('button').forEach(e => {
    const r = e.getBoundingClientRect(), cs = getComputedStyle(e);
    if (!r.width || !r.height || cs.visibility === 'hidden' || e.closest('.maplibregl-map')) return;
    out.push({ id: e.id, text: e.textContent.trim().replace(/\s+/g, ' ').slice(0, 40), cls: e.className,
      bg: cs.backgroundColor, border: cs.borderTopColor + ' ' + cs.borderTopWidth + ' ' + cs.borderTopStyle,
      appearance: cs.appearance, font: cs.fontSize, weight: cs.fontWeight, h: Math.round(r.height), w: Math.round(r.width),
      icon: !!e.querySelector('svg'), label: e.getAttribute('aria-label') || '', title: !!e.title });
  });
  return out;
}
// Accessibility basics on a view, with every section open: each control the keyboard reaches, its name (as
// a screen reader would announce it: aria-label, aria-labelledby, a <label>, its words, title), and whether focusing
// it from the keyboard shows an outline; elements that look clickable (pointer cursor) but the keyboard cannot
// reach; pictures without alt text. Runs in the page.
// The "?" buttons' target size (WCAG 2.2 AA 2.5.8), with every folded section open: a button passes
// when a click anywhere in the 24 x 24 px square around its middle reaches it (its hit area, measured by hit
// testing, so a hit area larger than the drawn circle counts), or, under 24 px, when a 24 px circle around its
// middle touches no other control (the rule's spacing exception).
function targetSurvey() {
  document.querySelectorAll('details').forEach(d => { if (!d.closest('.maplibregl-map')) d.open = true; });
  const shown = el => el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) && el.getClientRects().length;
  const others = [...document.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea, summary, label')]
    .filter(el => shown(el) && !el.matches('button.tip') && !el.closest('.maplibregl-map, svg'));
  const near = (r, x, y) => {
    const dx = Math.max(r.left - x, 0, x - r.right), dy = Math.max(r.top - y, 0, y - r.bottom);
    return Math.hypot(dx, dy) < 12;
  };
  return [...document.querySelectorAll('button.tip')].filter(shown).map(t => {
    t.scrollIntoView({ block: 'center' });
    const r = t.getBoundingClientRect(), x = (r.left + r.right) / 2, y = (r.top + r.bottom) / 2;
    const points = [[-11.5, -11.5], [11.5, -11.5], [-11.5, 11.5], [11.5, 11.5], [0, -11.5], [0, 11.5], [-11.5, 0], [11.5, 0]];
    const misses = points.filter(([dx, dy]) => {
      const e = document.elementFromPoint(x + dx, y + dy);
      return !e || e.closest('button.tip') !== t;
    }).map(([dx, dy]) => {
      const e = document.elementFromPoint(x + dx, y + dy);
      return [dx, dy, e ? e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + '.' + e.className : null];
    });
    const hit24 = !misses.length;
    const touching = others.filter(o => !o.contains(t) && [...o.getClientRects()].some(q => near(q, x, y)))
      .map(o => o.tagName.toLowerCase() + (o.id ? '#' + o.id : '') + ' ' + (o.textContent || '').trim().slice(0, 30));
    // The hit area may not take its neighbors' own points: the text right before the "?" (its label) and
    // any control within 12 px, sampled at their edges nearest the "?".
    const stolen = [];
    const sample = (q, what, owner) => {
      const px = Math.min(Math.max(x, q.left + 0.5), q.right - 0.5), py = Math.min(Math.max(y, q.top + 0.5), q.bottom - 0.5);
      if (Math.hypot(px - x, py - y) >= 12) return;
      // Points under the "?" circle itself belong to it; only the invisible hit area around it counts.
      if (px >= r.left - 0.5 && px <= r.right + 0.5 && py >= r.top - 0.5 && py <= r.bottom + 0.5) return;
      const e = document.elementFromPoint(px, py);
      if (!e || e.closest('button.tip') !== t) return;
      // Only a neighbor that is there to be clicked (not one clipped out of a scrolled list): with the "?" set aside,
      // the point is the neighbor's.
      t.style.pointerEvents = 'none';
      const under = document.elementFromPoint(px, py);
      t.style.pointerEvents = '';
      if (under && owner.contains(under)) stolen.push([what, Math.round(px - x), Math.round(py - y)]);
    };
    let prev = t.previousSibling;
    while (prev && prev.nodeType === 3 && !prev.textContent.trim()) prev = prev.previousSibling;
    if (prev) {
      const range = document.createRange();
      range.selectNodeContents(prev);
      const owner = prev.nodeType === 3 ? prev.parentNode : prev;
      [...range.getClientRects()].forEach(q => sample(q, 'label: ' + (prev.textContent || '').trim().slice(-20), owner));
    }
    others.filter(o => !o.contains(t)).forEach(o => [...o.getClientRects()].forEach(q => sample(q, o.tagName.toLowerCase() +
      (o.id ? '#' + o.id : ''), o)));
    return { help: t.dataset.help, w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10, hit24,
      misses: misses.slice(0, 3),
      spaced: !touching.length, touching: touching.slice(0, 3), stolen: stolen.slice(0, 3) };
  });
}
function a11ySurvey() {
  document.querySelectorAll('details').forEach(d => { d.open = true; });
  const visible = e => {
    const r = e.getBoundingClientRect(), cs = getComputedStyle(e);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
  };
  const words = e => (e.textContent || '').trim().replace(/\s+/g, ' ');
  const nameOf = e => {
    if (e.getAttribute('aria-label')) return e.getAttribute('aria-label');
    const by = e.getAttribute('aria-labelledby');
    if (by) return by.split(/\s+/).map(id => document.getElementById(id)).filter(Boolean).map(words).join(' ');
    if (e.labels && e.labels.length) return [...e.labels].map(words).join(' ');
    if (/^(BUTTON|A|SUMMARY)$/.test(e.tagName) && words(e)) return words(e);
    if (e.tagName === 'INPUT' && /^(button|submit)$/.test(e.type) && e.value) return e.value;
    return e.title || '';
  };
  const focusable = [...document.querySelectorAll('button, a[href], input, select, textarea, summary, [tabindex]')]
    .filter(e => !e.disabled && e.tabIndex >= 0 && visible(e) && e.type !== 'hidden');
  const describe = e => (e.id ? '#' + e.id : e.tagName.toLowerCase() + (e.className && typeof e.className === 'string'
    ? '.' + e.className.trim().split(/\s+/).join('.') : '')) + ' "' + words(e).slice(0, 30) + '"';
  const unnamed = focusable.filter(e => !nameOf(e).trim()).map(describe);
  const noOutline = [];
  focusable.forEach(e => {
    e.focus({ preventScroll: true, focusVisible: true });
    const cs = getComputedStyle(e);
    const outline = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0;
    if (document.activeElement === e && !outline && cs.boxShadow === 'none') noOutline.push(describe(e));
  });
  if (document.activeElement) document.activeElement.blur();
  const reachable = new Set(focusable);
  const clickOnly = [...document.querySelectorAll('body *')].filter(e => visible(e) && !reachable.has(e)
    && getComputedStyle(e).cursor === 'pointer' && !e.closest('button, a[href], label, summary, .maplibregl-map')
    && !(e.parentElement && getComputedStyle(e.parentElement).cursor === 'pointer')).map(describe);
  const noAlt = [...document.querySelectorAll('img')].filter(e => visible(e) && !e.hasAttribute('alt')).map(describe);
  return { focusable: focusable.length, unnamed, noOutline, clickOnly, noAlt };
}
// The buttons that carry an icon on each view (the page's own buttons; MapLibre's map buttons are its own).
const ICONED = {
  landing: ['next-open'],
  wa: ['show-wa', 'show-focus', 'show-flow', 'reset-all', 'fit-wa', 'preview-map', 'preview-table', 'preview-stats',
    'preview-charts', 'run-export'],
  focus: ['reset-all', 'fit-focus', 'run-export'],
  flow: ['reset-all', 'fit-conus', 'run-export'],
  lookup: ['lk-geo-find', 'lk-add', 'lk-pick', 'lk-paste-add', 'lk-template', 'lk-run', 'lk-remove', 'lk-clear',
    'lk-preview', 'lk-export'],
  infra: ['reset-all', 'fit-wa', 'preview-facilities', 'run-export']
};
async function partControls(b) {
  const p = b.page, views = {}, a11y = {}, targets = {};
  for (const view of VIEWS) {
    await openView(b, SITE_URL, view);
    const list = views[view.id] = await p.eval('(' + buttonSurvey.toString() + ')()');
    const btns = list.filter(x => /\bbtn\b/.test(x.cls));
    check(btns.length > 0 && btns.every(x => x.font === '13.6px' && x.h >= 32),
      view.id + ': every action button at 0.85rem and at least 2rem high',
      btns.filter(x => x.font !== '13.6px' || x.h < 32).map(x => [x.id || x.text, x.font, x.h]));
    check(!list.some(x => /outset/.test(x.border)), view.id + ': no button in the browser\'s gray look',
      list.filter(x => /outset/.test(x.border)).map(x => x.id || x.text));
    check(await p.eval(`[...document.querySelectorAll('button[hidden]')].every(e => !e.getClientRects().length)`),
      view.id + ': a hidden button stays hidden');
    const missing = ICONED[view.id].filter(id => !list.some(x => x.id === id && x.icon));
    check(!missing.length, view.id + ': the main buttons show their icon', missing);
    if (view.id !== 'landing' && view.id !== 'lookup') {
      // The CVI page's Reset All closes its Filters section; Infrastructure's sits between its filters and Map Style.
      const reset = await p.eval(`(() => { const r = document.getElementById('reset-all');
        const host = r.parentElement.closest('details') && !r.nextElementSibling ? r.parentElement.closest('details') : r;
        const after = host.nextElementSibling;
        return [r.textContent.trim(), r.classList.contains('full') && r.classList.contains('reset'),
          !!r.querySelector('.btn-icon svg'), getComputedStyle(r).width === getComputedStyle(r.parentElement).width
            || r.getBoundingClientRect().width > 200,
          after && after.tagName === 'DETAILS' && /Map Style/.test(after.querySelector('summary').textContent)]; })()`);
      check(reset[0] === 'Reset All' && reset[1] && reset[2] && reset[3] && reset[4], view.id + ': one Reset All, full ' +
        'width and gray, at the end of the filters (right above Map Style)', reset);
    }
    if (view.id === 'landing' || view.id === 'infra') {
      // The drop area, reached with Tab, opens the file chooser with Enter or Space.
      const opened = await p.eval(`(() => { const input = document.getElementById('files-input'), drop = document.getElementById('drop');
        let n = 0; input.click = () => { n++; };
        drop.focus();
        ['Enter', ' ', 'a'].forEach(key => drop.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })));
        delete input.click;
        return [n, drop.getAttribute('role'), drop.getAttribute('aria-label')]; })()`);
      check(opened[0] === 2 && opened[1] === 'button' && /press Enter to choose files/.test(opened[2]),
        view.id + ': the drop area opens the file chooser with Enter and Space (not other keys)', opened);
    }
    a11y[view.id] = await p.eval('(' + a11ySurvey.toString() + ')()');
    const a = a11y[view.id];
    check(!a.unnamed.length && !a.noOutline.length && !a.noAlt.length, view.id + ': every control named and showing a ' +
      'focus outline from the keyboard; every picture with alt text', a);
    // Premise Lookup's site rows select with a click, and from the keyboard with Space on any of their cells
    // (each cell is in the Tab order), so the row itself needs no place in it.
    const clickOnly = a.clickOnly.filter(d => !(view.id === 'lookup' && /^tr /.test(d)));
    check(!clickOnly.length, view.id + ': nothing clickable the keyboard cannot reach', clickOnly);
    if (view.id === 'infra') {
      // S12's place: "Coverage (planned)", grayed, after CVI Activity; a click does not tick
      // it and Reset All leaves it as it is.
      const cov = await p.eval(`(() => { const f = document.getElementById('planned-coverage-fold');
        const box = document.getElementById('planned-coverage-on');
        if (!f || !box) return null;
        f.open = true;
        box.click();
        const afterClick = box.checked;
        document.getElementById('reset-all').click();
        const label = box.closest('label');
        return { summary: f.querySelector('summary').textContent, label: label.textContent.trim(),
          note: f.querySelector('p.muted').textContent, disabled: box.disabled, afterClick, checked: box.checked,
          color: getComputedStyle(label).color, prev: f.previousElementSibling.id, next: f.nextElementSibling.id }; })()`);
      check(cov && cov.summary === 'Coverage (planned)' && cov.label === 'Show coverage' &&
        cov.note === 'Planned for a later update; not part of this release.' && cov.disabled && !cov.afterClick &&
        !cov.checked && cov.color === 'rgb(153, 153, 153)' && cov.prev === 'activity-fold' && cov.next === 'reset-all',
      'infra: "Coverage (planned)" after CVI Activity, grayed, not ticked by a click or changed by Reset All', cov);
    }
    // Last for this view: it opens every folded section.
    const tips = targets[view.id] = await p.eval('(' + targetSurvey.toString() + ')()');
    const small = tips.filter(t => !t.hit24 && !t.spaced);
    check(view.id === 'landing' || view.id === 'lookup' || tips.length > 5, view.id + ': the "?" buttons found (' + tips.length + ')', tips.length);
    check(!small.length, view.id + ': every "?" button a 24 px target, or spaced as WCAG 2.5.8 allows', small.slice(0, 6));
    const covering = tips.filter(t => t.stolen.length);
    check(!covering.length, view.id + ': no "?" hit area covers its label\'s text or a control beside it',
      covering.slice(0, 6).map(t => [t.help, t.stolen]));
    const squeezed = tips.filter(t => Math.abs(t.w - t.h) > 0.5);
    check(!squeezed.length, view.id + ': every "?" button round (none squeezed beside a long label)',
      squeezed.map(t => [t.help, t.w, t.h]));
  }
  // "Show as table": each chart of WA State with Map + charts, its numbers under it and back.
  await openView(b, SITE_URL, VIEWS.find(v => v.id === 'wa'));
  await p.eval(`document.querySelector('[data-layout="split"]').click(); true`);
  await p.waitFor(`CVIWA.state.charts && CVIWA.state.charts.charts.length === document.querySelectorAll('#chart-grid .chart-card').length`,
    15000, 'charts drawn');
  const ids = await p.eval(`[...document.querySelectorAll('#chart-grid .chart-card')].map(c => c.dataset.chart)`);
  for (const id of ids) {
    const sel = `#chart-grid .chart-card[data-chart="${id}"]`;
    const closed = await p.eval(`(() => { const t = document.querySelector('${sel} .chart-table-toggle');
      return [t.textContent, t.getAttribute('aria-expanded'), document.querySelector('${sel} .chart-table').hidden]; })()`);
    await p.eval(`(() => { const t = document.querySelector('${sel} .chart-table-toggle'); t.focus(); t.click(); return true; })()`);
    await sleep(200);
    const open = await p.eval(`(() => { const card = document.querySelector('${sel}'), t = card.querySelector('.chart-table-toggle');
      const c = CVIWA.state.charts.charts.find(x => x.id === '${id}');
      const rows = card.querySelectorAll('.chart-table tbody tr').length;
      const want = c.empty ? 0 : c.bars ? c.bars.length : c.groups ? c.groups.length : c.periods ? c.periods.length
        : c.panels.reduce((n, q) => n + q.bars.length, 0);
      return [t.textContent, t.getAttribute('aria-expanded'), card.querySelector('.chart-table').hidden, rows, want,
        document.activeElement === t, (card.querySelector('.chart-table caption') || {}).textContent || c.empty]; })()`);
    check(same(closed, ['Show as table', 'false', true]) && open[0] === 'Hide table' && open[1] === 'true' && !open[2] &&
      open[3] === open[4] && open[5], 'Show as table: ' + id + ' opens its numbers (one row per bar, point or period), ' +
      'the button keeps the focus', [closed, open]);
    await p.eval(`document.querySelector('${sel} .chart-table-toggle').click(); true`);
    await sleep(150);
    check(await p.eval(`document.querySelector('${sel} .chart-table').hidden && !document.querySelector('${sel} .chart-table table')`),
      'Show as table: ' + id + ' closes again');
  }
  fs.writeFileSync(path.join(OUT, 'controls.json'), JSON.stringify(views, null, 1));
  fs.writeFileSync(path.join(OUT, 'a11y.json'), JSON.stringify(a11y, null, 1));
  fs.writeFileSync(path.join(OUT, 'targets.json'), JSON.stringify(targets, null, 1));
  return { views: Object.fromEntries(Object.entries(views).map(([k, v]) => [k, v.length])), charts: ids };
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);


// A preview dialog's picture as a data: URL (the PNG the export would write).
// (Read through a canvas: the page's policy refuses fetch() of its own blob: pictures.)
const PREVIEW_PNG = `(() => { const img = document.querySelector('#preview-dialog img');
  const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
  c.getContext('2d').drawImage(img, 0, 0); return c.toDataURL('image/png'); })()`;
async function previewPng(p, button) {
  await p.eval(`(() => { const d = document.getElementById('preview-dialog'); if (d && d.open) d.close();
    document.getElementById('${button}').click(); return true; })()`);
  await p.waitFor(`(() => { const d = document.getElementById('preview-dialog'), i = d && d.querySelector('img');
    return d && d.open && i && i.complete && i.naturalWidth > 0; })()`, 60000, 'preview ' + button);
  const url = await p.eval(PREVIEW_PNG);
  await p.eval(`document.getElementById('preview-dialog').close(); true`);
  return url;
}

// ── The Stats text, the glossary and name markers' speed ──────────────────────────────────────────────────────────
// A key pressed through the browser's own input (not a synthetic event), so the page sees what a keyboard does.
async function pressKey(b, key) {
  const k = { Enter: { code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' }, Tab: { code: 'Tab', windowsVirtualKeyCode: 9 } }[key];
  await b.send('Input.dispatchKeyEvent', Object.assign({ type: 'keyDown', key }, k), b.sid);
  await b.send('Input.dispatchKeyEvent', Object.assign({ type: 'keyUp', key }, k, { text: undefined }), b.sid);
  await sleep(120);
}
// N synthetic feedlots with names, spread over Washington east of -122 degrees (where names have room, the slow case
// for a placer that tests every placed name), to time the PNG's name markers.
function manyFeedlots(n, word) {
  const lines = ['name,lat,long'];
  for (let i = 0; i < n; i++) {
    const lat = 46.05 + 2.8 * ((i * 37) % 101) / 100, lon = -122.0 + 4.85 * ((i * 53) % 103) / 102;
    lines.push('Synthetic ' + (word || 'Feedlot') + ' ' + (i + 1) + ',' + lat.toFixed(4) + ',' + lon.toFixed(4));
  }
  return lines.join('\n') + '\n';
}
// 10,000 unnamed markets on a finer grid, markers the names must keep clear of (the placer's slow case).
function manyMarkets() {
  const lines = ['name,lat,long'];
  for (let i = 0; i < 100; i++) {
    for (let j = 0; j < 100; j++) {
      lines.push('Synthetic Market ' + (i * 100 + j + 1) + ',' + (46.06 + 0.028 * i).toFixed(4) + ',' + (-121.99 + 0.0485 * j).toFixed(4));
    }
  }
  return lines.join('\n') + '\n';
}
async function partDay3(b) {
  const p = b.page, out = {};
  // The Stats text (WA State, Full tier): the quarters, Unique CVIs and the change, following "Compare with".
  await openView(b, SITE_URL, VIEWS.find(v => v.id === 'wa'));
  await p.eval(`(() => { document.getElementById('export-section').open = true; return true; })()`);
  const stats = async () => {
    await p.eval(`document.getElementById('preview-stats').click(); true`);
    await p.waitFor(`document.getElementById('preview-dialog').open && document.querySelector('#preview-dialog .stats-text')`,
      15000, 'stats dialog');
    const t = await p.eval(`document.querySelector('#preview-dialog .stats-text').textContent`);
    await p.eval(`document.getElementById('preview-dialog').close(); true`);
    return t.split('\n');
  };
  let lines = await stats();
  const q = await p.eval(`CVIWA.state.quarters.slice().sort().join(', ')`);
  check(lines.includes('  Quarters:  ' + q), 'stats: the quarters written "Q1, Q2" (the page)', [q, lines.find(l => /Quarters/.test(l))]);
  const box = await p.eval(`(CVIWA.state.valueBoxes.metrics.find(x => /Unique CVIs/.test(x.label)) || {}).text`);
  check(lines.includes('  Unique CVIs:      ' + box), 'stats: Unique CVIs equal the value box', [box, lines.filter(l => /Unique/.test(l))]);
  check(lines.some(l => /^  each end \(Inbound and Outbound\): [\d,]+ movements? here\.$/.test(l)),
    'stats: the WA-to-WA note (the Full tier has WA-to-WA movements, both directions picked)');
  check(lines.some(l => /^CHANGE FROM THE PREVIOUS QUARTER \(\d{4} Q\d to \d{4} Q\d\)$/.test(l)), 'stats: the change from the previous quarter');
  await p.eval(`document.querySelector('[data-layout="split"]').click(); true`);
  await p.waitFor(`document.getElementById('chart-compare')`, 15000, 'charts drawn');
  await p.eval(`(() => { const s = document.getElementById('chart-compare'); s.value = 'last_year';
    s.dispatchEvent(new Event('change')); return true; })()`);
  lines = await stats();
  check(lines.some(l => /^CHANGE FROM THE SAME QUARTER LAST YEAR/.test(l)), 'stats: "Compare with" Same quarter last year followed');
  out.stats = lines;

  // The glossary: in every page's footer, closed, opened from the keyboard; its five terms.
  for (const view of [VIEWS[0], VIEWS[1], VIEWS[5]]) {
    await openView(b, SITE_URL, view);
    const g = await p.eval(`(() => { const d = document.querySelector('footer.foot details.glossary');
      if (!d) return null; d.scrollIntoView(); d.querySelector('summary').focus();
      return { open: d.open, terms: [...d.querySelectorAll('dt')].map(x => x.textContent), focused: document.activeElement.tagName }; })()`);
    await pressKey(b, 'Enter');
    const opened = await p.eval(`!!(document.querySelector('footer.foot details.glossary') || {}).open`);
    check(g && !g.open && same(g.terms, ['CVI', 'Premises', 'WA-to-WA', 'Bundle', 'Shaded map (choropleth)']) && g.focused === 'SUMMARY' && opened,
      view.id + ': the glossary in the footer, closed, opened with Enter', [g, opened]);
    // The tab title and icon: WSDA's own site icon, as the browser decodes it.
    const icon = await p.eval(`(async () => { const href = document.querySelector('link[rel="icon"]').href;
      if (!/^data:image\\/x-icon;base64,/.test(href)) return { href: href.slice(0, 30), title: document.title };
      const im = new Image(); im.src = href; await im.decode();
      const c = document.createElement('canvas'); c.width = im.width; c.height = im.height;
      const g = c.getContext('2d'); g.drawImage(im, 0, 0);
      const px = g.getImageData(0, 0, c.width, c.height).data; let opaque = 0;
      for (let i = 3; i < px.length; i += 4) if (px[i] > 128) opaque++;
      return { w: im.width, h: im.height, opaque, title: document.title }; })()`);
    const wantTitle = { landing: 'WSDA Animal Services — Visualization Platform', wa: 'CVI Traceability — WSDA Animal Services',
      infra: 'Infrastructure — WSDA Animal Services' }[view.id];
    check(icon.w >= 16 && icon.w === icon.h && icon.opaque > icon.w * icon.h / 4 && icon.title === wantTitle,
      view.id + ': the tab title "' + wantTitle + '" and WSDA\'s site icon', icon);
    if (view.id === 'infra') {
      // Every "?" opens its note here too (the population switches' once did not).
      const tip = await p.eval(`(() => { const t = document.querySelector('button.tip[data-help="pc-cities"]'); t.click();
        return [!document.getElementById('help-pc-cities').hidden, t.getAttribute('aria-expanded')]; })()`);
      check(same(tip, [true, 'true']), 'infra: the "?" beside City limits opens its note', tip);
    }
  }

  // Name markers: County Focus with every county, 200, 800 and 2,000 named feedlots spread over the state and
  // 10,000 unnamed markets; the time from Preview map to the picture and the placer's own, every drawn feedlot named.
  out.names = [];
  for (const n of [200, 800, 2000]) {
    await openView(b, SITE_URL, VIEWS.find(v => v.id === 'focus'));
    await p.eval(`((t, m) => CVIWA.setFacilityFiles({ feedlots: { file: new Blob([t], { type: 'text/csv' }) },
      markets: { file: new Blob([m], { type: 'text/csv' }) } }).then(() => true))(${js(manyFeedlots(n))}, ${js(manyMarkets())})`);
    await sleep(800);
    // Every county in focus, so the PNG shows the whole state.
    await p.eval(`(() => {
      const boxes = () => [...document.querySelectorAll('#fo-counties input')];
      boxes().map(x => x.value).forEach(v => { const x = boxes().find(y => y.value === v);
        if (x && !x.checked) { x.checked = true; x.dispatchEvent(new Event('change')); } });
      return true; })()`);
    await sleep(1500);
    await p.eval(`document.getElementById('fo-fac-all').click(); true`);
    await sleep(800);
    await p.eval(`(() => { document.getElementById('export-section').open = true;
      document.querySelectorAll('#export-name-list input').forEach(i => { if (i.value === 'feedlots' && !i.checked) {
        i.checked = true; i.dispatchEvent(new Event('change', { bubbles: true })); } }); return true; })()`);
    // The placer's own time, measured around WSDA.labels.place in the page.
    await p.eval(`(() => { const L = WSDA.labels, place = L.place; window.__place = [];
      L.place = function () { const t = performance.now(), r = place.apply(this, arguments);
        window.__place.push([arguments[0].length, Math.round(performance.now() - t)]); return r; }; return true; })()`);
    const t0 = Date.now();
    await previewPng(p, 'preview-map');
    const placeCalls = await p.eval('window.__place');
    const secs = (Date.now() - t0) / 1000;
    const [named, drawn] = await p.eval(`(() => { const m = CVIWA.state.lastBranded.models[0];
      const f = m.facilities.find(l => l.key === 'feedlots');
      return [m.facilityNames.length, f ? f.points.length : 0]; })()`);
    out.names.push({ n, secs, named, drawn, placeCalls });
    check(named === drawn && drawn >= 0.85 * n, 'names: every drawn feedlot named in the PNG (' + n + ' in the file, ' +
      'those inside the focus counties drawn)', [named, drawn]);
    // Measured here: the placer once took 468, 1,714 and 1,853 ms for 200, 800 and 2,000 names, before it was made
    // faster, now 24, 57 and 137 ms; drawing the 10,000 markets takes most of the rest.
    const placeMs = placeCalls.reduce((t, c) => t + c[1], 0), budget = 100 + n / 5;
    check(placeCalls.length === 1 && placeCalls[0][0] === n && placeMs < budget, 'names: ' + n + ' names placed in under ' +
      budget + ' ms', placeCalls);
    check(secs < 5, 'names: ' + n + ' names, Preview map done in under 5 s', secs);
  }
  fs.writeFileSync(path.join(OUT, 'day3.json'), JSON.stringify(out, null, 1));
  return out.names;
}


// ── Chart labels inside their pictures (none cut off) ────────────────────────────────────────────────────────────
// Every text of every chart (bounding box, rotation included) inside its SVG, on the page with Map + charts and with
// Charts at 1400 and 1024 px, and in the export pictures of the same charts (the export set: heatmaps too), on WA
// State, National Flow and County Focus with the Full tier. Returns the texts that run out.
const CHART_TEXTS_OUT = `(() => {
  const out = [];
  const check = (svg, where) => {
    const box = svg.getBoundingClientRect(), k = box.width / Number(svg.getAttribute('width'));
    svg.querySelectorAll('text').forEach(t => {
      const r = t.getBoundingClientRect();
      if (!r.width) return;
      const over = Math.max(box.left - r.left, r.right - box.right, box.top - r.top, r.bottom - box.bottom) / k;
      if (over > 0.5) out.push(where + ' ' + svg.getAttribute('data-chart') + ': "' + t.textContent + '" ' + over.toFixed(1) + ' px out');
    });
  };
  document.querySelectorAll('#chart-grid .chart-svg svg').forEach(svg => check(svg, 'page'));
  return out;
})()`;
const EXPORT_TEXTS_OUT = `(() => {
  const W = CVIWA, st = W.state, view = st.view, m = st.master;
  const per = view === 'wa' ? st : view === 'flow' ? W.flowState : W.focusState;
  const fo = Object.assign({}, W.focusState, { rawSpecies: W.focusState.speciesSub });
  const input = view === 'wa' ? { rows: W.summary.mapRows(m, { species: st.species, years: st.years, quarters: st.quarters,
    direction: st.direction, rawSpecies: st.speciesSub }) }
    : view === 'flow' ? { rows: W.flow.mapRows(m, Object.assign({}, W.flowState)) }
    : { rows: W.focus.summaryRows(m, fo), premises: W.focus.build(m, fo).premises,
      missingCoordinates: W.focus.build(m, fo).missingCoordinates };
  const charts = W.charts.chartsFor(view, input, { measure: st.chartMeasure, compare: st.chartCompare,
    years: per.years.map(String), quarters: per.quarters.slice() }, true).filter(c => !c.empty);
  const holder = document.createElement('div');
  holder.style.cssText = 'position:absolute;left:0;top:0;visibility:hidden';
  document.body.appendChild(holder);
  const out = [];
  charts.forEach(c => {
    const size = W.chartsvg.exportSize(c);
    holder.innerHTML = W.chartsvg.svg(c, { width: size.width, height: size.height, dpi: 150, basePt: 14,
      caption: 'Caption', footer: 'Footer' });
    const svg = holder.querySelector('svg'), box = svg.getBoundingClientRect();
    svg.querySelectorAll('text').forEach(t => {
      const r = t.getBoundingClientRect();
      if (!r.width) return;
      const over = Math.max(box.left - r.left, r.right - box.right, box.top - r.top, r.bottom - box.bottom);
      if (over > 0.5) out.push('export ' + c.id + ': "' + t.textContent + '" ' + over.toFixed(1) + ' px out');
    });
  });
  holder.remove();
  return { n: charts.length, out };
})()`;
async function partChartLabels(b) {
  const p = b.page, found = [];
  for (const id of ['wa', 'flow', 'focus']) {
    await openView(b, SITE_URL, VIEWS.find(v => v.id === id));
    for (const width of [1400, 1024]) {
      await p.viewport(width, 1600);
      for (const layout of ['split', 'charts']) {
        await p.eval(`document.querySelector('[data-layout="${layout}"]').click(); true`);
        await p.waitFor(`CVIWA.state.charts && document.querySelectorAll('#chart-grid .chart-card').length > 0`, 15000, 'charts');
        await sleep(600);
        const out = await p.eval(CHART_TEXTS_OUT);
        const n = await p.eval(`document.querySelectorAll('#chart-grid .chart-svg svg').length`);
        check(n > 0 && !out.length, 'chart labels: ' + id + ' at ' + width + ' px, ' + layout + ': every text of ' + n +
          ' charts inside its picture', out.slice(0, 6));
        found.push(...out.map(o => id + ' ' + width + ' ' + layout + ' ' + o));
      }
    }
    const ex = await p.eval(EXPORT_TEXTS_OUT);
    check(ex.n > 0 && !ex.out.length, 'chart labels: ' + id + ': every text of ' + ex.n + ' export pictures inside it',
      ex.out.slice(0, 6));
    found.push(...ex.out.map(o => id + ' ' + o));
  }
  fs.writeFileSync(path.join(OUT, 'chart_labels.json'), JSON.stringify(found, null, 1));
  return { out: found.length };
}


// ── Run ────────────────────────────────────────────────────────────────────────────────────────────────────────
(async () => {
  for (const f of ['tier_full_master.csv', 'WSDA_sample_all_dashboards_synthetic.zip', 'infrastructure_synthetic.zip']) {
    if (!fs.existsSync(T(f))) throw new Error('Missing test-tables/' + f + ': run node tests/synthetic/make_test_tables.js');
  }
  const b = await launch();
  const run = { chrome: b.version, site: SITE_URL, parts: PARTS, started: new Date().toISOString(), results: {} };
  try {
    for (const part of PARTS) {
      if (part === 'checks') run.results.checks = await partChecks(b);
      else if (part === 'controls') run.results.controls = await partControls(b);
      else if (part === 'day3') run.results.day3 = await partDay3(b);
      else if (part === 'chartlabels') run.results.chartlabels = await partChartLabels(b);
      else throw new Error('Unknown part ' + part);
    }
  } catch (e) {
    failed++;
    failures.push('run stopped: ' + (e && e.stack ? e.stack : e));
  } finally {
    check(!b.log.exceptions.length, 'page: no exceptions', b.log.exceptions);
    check(!b.log.csp.length, 'page: no Content Security Policy reports', b.log.csp);
    await b.close();
  }
  run.finished = new Date().toISOString();
  run.passed = passed;
  run.failed = failed;
  run.failures = failures;
  fs.writeFileSync(path.join(OUT, 'run.json'), JSON.stringify(run, null, 1));
  console.log('UI browser (' + PARTS.join(' ') + '): ' + passed + '/' + (passed + failed) + ' passed' +
    (failed ? '\n  ' + failures.join('\n  ') : ''));
  process.exitCode = failed ? 1 : 0;
})();
