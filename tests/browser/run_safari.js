#!/usr/bin/env node
'use strict';
// Safari check, so the pages are not tied to one browser (Safari's remote automation must be switched on). Drives
// the installed Safari through Apple's own /usr/bin/safaridriver (W3C WebDriver over local HTTP,
// Node's fetch; nothing installed). Safari runs in a visible window. Covers what the Chrome suites check through the
// DevTools protocol, as far as WebDriver allows:
//   - the landing page: browser features the loader needs, the guide;
//   - the sample bundle built by the page: SHA-256 equal to the archive tests/synthetic/make_bundles.js writes;
//   - recognition and feature gating for every case of tests/synthetic/f1_checklist_matrix.json that needs no choice by
//     hand, loaded through the page's own file input (files placed with DataTransfer: WebDriver cannot use the file
//     dialog in Safari), ZIPs stored and deflated;
//   - the hand-off: "Open the CVI map" clicked (WebDriver click) opens the CVI page in its own window with the Full tier;
//   - the CVI map: circles, tooltips and legend compared with CVI's R oracle (local-test-artifacts/s1/) for the small
//     fixture and the Full tier in several views, the MapLibre canvas and the 39 county labels;
//   - the National Flow view (S4): the S4 fixture, Map View switched to National Flow, two of CVI's views set through
//     the Flow controls and the lines the map draws (state, group, color, width, tooltip, drawing order, all rendered)
//     compared with CVI's module (local-test-artifacts/s4/); the globe, the 49 state labels; back to WA State.
// Not covered here (WebDriver has no network or console log): requests and CSP reports; exceptions only after the
// page has loaded (window.onerror installed by the test). The download itself (saving a file) is not clicked: Safari
// would save into the user's Downloads folder; the bytes the button saves are the ones compared.
// Usage (repository root, after node tests/node/run_f1_unit_tests.js and Rscript tests/oracle/cvi_r_oracle.R):
//   node tests/browser/run_safari.js        Optional: SAFARI_PAGE_URL=<http(s) copy of site/index.html>
//   S6, S7, MC, S9, PC and S11 parts on their own: --s6-entryflow, --s6-facilities, --s6-focus, --s6-activity, --s7, --mc, --s9, --pc, --s11 (see each part).
//   The all-in-one bundle (AB): --ab (see its part).
//   The UI and style-guide pass (UI): --ui (see its part).
//   The WA State and County Focus GIF and the shaded maps: --gif and --ch; see their parts.
// Writes local-test-artifacts/f1/safari_run.json and popup geometry/screens under local-test-artifacts/s5/safari/.
// S5_SAFARI_OUTPUT can select a run directory relative to local-test-artifacts/s5/, preserving older evidence.
const { spawn } = require('child_process');
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { pathToFileURL } = require('url');
const zlib = require('zlib');
// Ticks exactly the values in args[0] in a ticked list: one change event per toggled box, finding the list again
// each time because the shared facility controls are rebuilt after every change. `target` is a page expression.
const tickRun = target => `const want=args[0].map(String),find=()=>${target};for(const v of [...find().querySelectorAll('input')].map(i=>i.value)){const box=[...find().querySelectorAll('input')].find(i=>i.value===v);if(box.checked!==want.includes(v)){box.checked=!box.checked;box.dispatchEvent(new Event('change',{bubbles:true}));}}return true;`;
const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join(ROOT, 'local-test-artifacts', 'f1'), S1 = path.join(ROOT, 'local-test-artifacts', 's1'), S4 = path.join(ROOT, 'local-test-artifacts', 's4');
const PAGE = process.env.SAFARI_PAGE_URL || pathToFileURL(path.join(ROOT, 'site', 'index.html')).href;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const foreground = () => new Promise((resolve,reject) => {
  const child = spawn('/usr/bin/osascript', ['-e', 'tell application "Safari" to activate'], { stdio: 'ignore' });
  child.once('error',reject); child.once('exit',code => code===0 ? resolve() : reject(new Error('Safari foreground activation exited '+code)));
});

let pass = 0, fail = 0; const failures = [], notes = [];
const check = (ok, name, detail) => { if (ok) pass++; else { fail++; failures.push(name + (detail !== undefined ? ' :: ' + JSON.stringify(detail).slice(0, 600) : '')); } };
const arr = x => x === null || x === undefined ? [] : Array.isArray(x) ? x : [x];
const near = (a, b) => Math.abs(a - b) <= 1e-9;
// S1.1: the page's color for CVI's Flow color c of group g in palette pal: the WSDA guide's where
// palettes.js records CVI's value (with Combine species the palette's first color, Cattle's), otherwise CVI's own.
require(path.join(ROOT, 'site', 'cvi', 'app', 'palettes.js'));
function s11Color(pal, g, c, combine) {
  const P = globalThis.CVIWA.palettes, rec = P.CVI_VALUES.find(r => r[0] === 'species' && r[1] === pal && r[3] === c && (r[2] === g || (combine && r[2] === 'Cattle')));
  return rec ? P.SPECIES_PALETTES[pal][rec[2]] : c;
}

// ---- minimal WebDriver client -----------------------------------------------------------------------------------
async function launch() {
  const port = 4600 + Math.floor(Math.random() * 300);
  const proc = spawn('/usr/bin/safaridriver', ['-p', String(port)], { stdio: ['ignore', 'ignore', 'pipe'] });
  let err = ''; proc.stderr.on('data', d => { err += d; });
  const base = 'http://127.0.0.1:' + port;
  for (let i = 0; i < 100; i++) { try { if ((await fetch(base + '/status')).ok) break; } catch (e) { /* starting */ } await sleep(100); }
  const call = async (method, p, body) => {
    const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const j = await r.json();
    if (!r.ok || (j.value && j.value.error)) throw new Error(method + ' ' + p + ': ' + JSON.stringify(j.value).slice(0, 300));
    return j.value;
  };
  let s;
  try { s = await call('POST', '/session', { capabilities: { alwaysMatch: { browserName: 'safari' } } }); }
  catch (e) { proc.kill(); throw new Error(e.message + (err ? ' | ' + err.trim() : '')); }
  const sid = '/session/' + s.sessionId;
  const d = {
    version: s.capabilities.browserVersion,
    goto: url => call('POST', sid + '/url', { url }),
    // Runs an async function body in the page; arguments are passed as args.
    run: async (body, ...args) => {
      const v = await call('POST', sid + '/execute/async', { script: `var done=arguments[arguments.length-1],args=Array.prototype.slice.call(arguments,0,-1);
        (async function(){${body}})().then(function(v){done({ok:v===undefined?null:v});},function(e){done({error:String(e&&e.message?e.message+' | '+e.stack:e)});});`, args });
      if (v && v.error) throw new Error('page: ' + v.error);
      return v ? v.ok : null;
    },
    async waitFor(expr, ms, label) { const t0 = Date.now(); while (Date.now() - t0 < (ms || 15000)) { try { if (await d.run('return !!(' + expr + ');')) return true; } catch (e) { /* not ready */ } await sleep(80); } throw new Error('timeout: ' + (label || expr)); },
    click: async sel => {
      for(let attempt=0;attempt<3;attempt++) {
      await foreground();
      await d.run(`var e=document.querySelector(args[0]);if(!e||e.disabled)throw new Error('Missing or disabled click target: '+args[0]);
        window.focus();e.scrollIntoView({block:'center',inline:'nearest'});window.__lastClick=null;window.__clickTarget=args[0];if(!window.__clickTrap){window.__clickTrap=1;document.addEventListener('click',function(e){window.__lastClick={matched:!!e.target.closest(window.__clickTarget),id:e.target.id,button:e.target.closest('button')&&e.target.closest('button').id,x:e.clientX,y:e.clientY};},true);}return document.hasFocus();`, sel);
      await sleep(150);
      const q = await d.run(`var e=document.querySelector(args[0]),r=e.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2,hit=document.elementFromPoint(x,y);
        if(!hit||!(e===hit||e.contains(hit)))throw new Error('Click target covered: '+args[0]+' by '+(hit&&hit.outerHTML.slice(0,150)));return [x,y];`, sel);
      await d.pointer(q[0],q[1]);
      await sleep(100);
      const event = await d.run('return window.__lastClick;');
      if(event) {
        if(!event.matched)throw new Error('Safari click reached a different target: '+sel+' '+JSON.stringify(event));
        if(attempt)notes.push('foreground click retry '+attempt+': '+sel);
        return;
      }
      if(attempt===2)throw new Error('Safari delivered no click event after three real pointer attempts: '+sel+' at '+JSON.stringify(q)+'; document focus='+await d.run('return document.hasFocus();'));
      }
    },
    screenshot: () => call('GET', sid + '/screenshot'),
    // S7: a real pointer move without a click (hover), and a real key press (WebDriver key codes, e.g. '' Escape).
    move: (x, y) => call('POST', sid + '/actions', { actions: [{ type: 'pointer', id: 'mouse', parameters: { pointerType: 'mouse' }, actions: [
      { type: 'pointerMove', duration: 0, origin: 'viewport', x: Math.round(x), y: Math.round(y) }] }] }),
    key: value => call('POST', sid + '/actions', { actions: [{ type: 'key', id: 'keyboard', actions: [
      { type: 'keyDown', value }, { type: 'pause', duration: 50 }, { type: 'keyUp', value }] }] }),
    pointer: (x, y) => call('POST', sid + '/actions', { actions: [{ type: 'pointer', id: 'mouse', parameters: { pointerType: 'mouse' }, actions: [
      { type: 'pointerMove', duration: 0, origin: 'viewport', x: Math.round(x), y: Math.round(y) },
      { type: 'pause', duration: 50 }, { type: 'pointerDown', button: 0 }, { type: 'pause', duration: 50 }, { type: 'pointerUp', button: 0 }] }] }),
    handles: () => call('GET', sid + '/window/handles'),
    handle: () => call('GET', sid + '/window'),
    switchTo: async handle => { await call('POST', sid + '/window', { handle }); await foreground(); await d.run('window.focus();return true;'); await sleep(150); },
    size: (width, height) => call('POST', sid + '/window/rect', { width, height }),
    async close() {
      // Close only windows exposed by this automation session; leave the user's other Safari windows alone.
      try {
        for (const handle of await d.handles()) {
          try { await d.switchTo(handle); await call('DELETE', sid + '/window'); } catch (e) { /* session may end with its last window */ }
        }
      } catch (e) { /* session already gone */ }
      try { await call('DELETE', sid); } catch (e) { /* closing */ }
      if (proc.exitCode === null && proc.signalCode === null) {
        const ended = new Promise(resolve => proc.once('exit', resolve));
        proc.kill(); await ended;
      }
    }
  };
  return d;
}

// Places files in an <input type=file> (DataTransfer) and fires "change", as choosing them in the dialog does.
const SET_FILES = `var sel=args[0],files=args[1],dt=new DataTransfer();
  for (var f of files) { var bin=atob(f.b64),u=new Uint8Array(bin.length); for (var i=0;i<bin.length;i++) u[i]=bin.charCodeAt(i); dt.items.add(new File([u],f.name)); }
  var input=document.querySelector(sel); input.files=dt.files; input.dispatchEvent(new Event('change',{bubbles:true})); return dt.files.length;`;
const filesOf = src => {
  const p = path.join(OUT, src);
  const list = fs.statSync(p).isDirectory() ? fs.readdirSync(p).filter(f => fs.statSync(path.join(p, f)).isFile()).map(f => path.join(p, f)) : [p];
  return list.map(f => ({ name: path.basename(f), b64: fs.readFileSync(f).toString('base64') }));
};

function oracleView(o, scenario, dir, mode, scaling, nBins) {
  return o.views.find(v => v.scenario === scenario && arr(v.filters.direction).join('+') === dir && v.mode === mode && v.scaling === scaling && v.n_bins === nBins);
}
function compareToOracle(name, st, ov) {
  const want = arr(ov.rows);
  let bad = st.data.length === want.length ? 0 : 1;
  for (const e of want) {
    const i = st.data.findIndex(x => x.county === e.county && x.direction === e.direction), g = st.data[i];
    if (!(g && g.total_animals === e.total_animals && g.lat === e.lat && g.lon === e.lon && near(g.radius_px, e.radius_px) && st.liveTooltips[i] === e.live_tooltip)) bad++;
  }
  const L = ov.legend, t = st.legend && st.legend.tiers;
  const legendOk = (!L && !t) || (L && t && arr(L.values).length === t.values.length && arr(L.values).every((x, k) => near(x, t.values[k])) && arr(L.radii).every((x, k) => near(x, t.cviRadii[k])));   // CVI's tier radii (S1.1 draws the map's; the S1 suites check those)
  check(!bad && legendOk, name + ': ' + want.length + ' circles, tooltips and legend equal CVI\'s R oracle', { bad, circles: [st.data.length, want.length], legendOk });
}

if (!process.argv.includes('--ab') && !process.argv.includes('--ui') && !process.argv.includes('--s6-activity') && !process.argv.includes('--s6-entryflow') && !process.argv.includes('--s6-facilities') && !process.argv.includes('--s6-focus') && !process.argv.includes('--s7') && !process.argv.includes('--mc') && !process.argv.includes('--s9') && !process.argv.includes('--pc') && !process.argv.includes('--s11') && !process.argv.includes('--gif') && !process.argv.includes('--ch') && !process.argv.includes('--em')) (async () => {
  for (const f of ['sample/CVI_sample_bundle_synthetic.zip', 'tiers/full.zip']) if (!fs.existsSync(path.join(OUT, f))) { console.error('Run node tests/node/run_f1_unit_tests.js first.'); process.exit(2); }
  if (!fs.existsSync(path.join(S1, 'oracle_tier_full.json')) || !fs.existsSync(path.join(S4, 'oracle_s4_cvi_master_s4.json'))) { console.error('Run Rscript tests/oracle/cvi_r_oracle.R first.'); process.exit(2); }
  let d;
  try { d = await launch(); }
  catch (e) {
    console.error('Safari could not be started for testing: ' + e.message.replace(/^POST \/session: /, ''));
    console.error('In Safari: Settings → Advanced → "Show features for web developers"; then Settings → Developer → "Allow remote automation".');
    process.exit(2);
  }
  const run = { safari: d.version, platform: process.platform, page: /^https?:/.test(PAGE) ? new URL(PAGE).origin : 'site/index.html (file://)', started: new Date().toISOString() };
  const ERRORS = 'window.__errors=window.__errors||[];if(!window.__trap){window.__trap=1;addEventListener("error",function(e){__errors.push(String(e.message))});addEventListener("unhandledrejection",function(e){__errors.push(String(e.reason))});}return true;';
  const errors = [];
  const collect = async () => { try { errors.push(...(await d.run('var e=window.__errors||[];window.__errors=[];return e;'))); } catch (e) { /* page gone */ } };
  try {
    // 1. Landing page and the features the loader needs
    await d.goto(PAGE);
    await d.waitFor('window.WSDA && WSDA.landing && WSDA.guide', 15000, 'landing page');
    await d.run(ERRORS);
    const landing = await d.handle();
    const env = await d.run(`var ok=false;try{new DecompressionStream('deflate-raw');ok=true}catch(e){}
      return {deflateRaw:ok, dataTransfer:typeof DataTransfer==='function', webkitdirectory:'webkitdirectory' in document.createElement('input'),
        channel:typeof MessageChannel==='function', csp:!!document.querySelector('meta[http-equiv="Content-Security-Policy"]'), ua:navigator.userAgent};`);
    run.env = env;
    check(env.deflateRaw && env.dataTransfer && env.webkitdirectory && env.channel && env.csp, 'Safari: DecompressionStream("deflate-raw"), folder selection, MessageChannel, CSP meta', env);
    const guide = await d.run(`return Array.from(document.querySelectorAll('table[data-guide-profile="cvi"] tbody tr')).map(function(r){return r.getAttribute('data-guide-dataset');});`);
    require(path.join(ROOT, 'site', 'cvi', 'datasets.js'));
    check(guide.join() === 'master,facility-layers,manifest', 'guide: the CVI master, the facility layers in one row and the manifest', guide);

    // 2. The CVI sample archive, built by Safari with the page's own generator: the same bytes as Node/Chrome. The
    // landing page's one sample button is the all-in-one sample (checked in --ab); the CVI
    // generator it uses is still loaded, and the county file is read through the all-in-one sample's build first.
    const sample = await d.run(`await WSDA.landing.ALL_IN_ONE.build(); var S=WSDA.samples.cvi;
      var out={fileName:S.fileName, bytes:WSDA.sample.zip(S.entries(CVIWA_GEO.labels))},b=out.bytes,s='';
      for (var i=0;i<b.length;i+=32768) s+=String.fromCharCode.apply(null,b.subarray(i,i+32768));
      return {fileName:out.fileName, b64:btoa(s)};`);
    const got = Buffer.from(sample.b64, 'base64'), want = fs.readFileSync(path.join(OUT, 'sample', 'CVI_sample_bundle_synthetic.zip'));
    const sha = b => crypto.createHash('sha256').update(b).digest('hex');
    run.sampleSha256 = { safari: sha(got), node: sha(want) };
    check(sample.fileName === 'CVI_sample_bundle_synthetic.zip' && Buffer.compare(got, want) === 0, 'sample: Safari builds the archive byte-identical to Node/Chrome (SHA-256)', run.sampleSha256);

    // 3. Recognition and gating for every matrix case without a choice by hand, through the page's file input
    const matrix = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'synthetic', 'f1_checklist_matrix.json'), 'utf8'));
    const leaf = q => q.split(/\/| › /).pop();
    const VIEW = `var c=WSDA.landing.checklist.state,r=c.result,s=WSDA.landing.state.result;
      return {errors:s?s.errors.map(function(e){return e.message}):[], datasets:r?r.datasets.map(function(x){return {id:x.id,status:x.status,path:x.path,options:x.options};}):[],
        features:(c.features||[]).map(function(f){return {id:f.id,on:f.on,reason:f.reason};}), next:document.getElementById('next-step').getAttribute('data-kind')};`;
    const viewDs = x => x.status === 'found' ? leaf(x.path) : x.status === 'conflict' ? { conflict: x.options.map(o => leaf(o.path)).sort() } : 'missing';
    const load = async files => {
      const v0 = await d.run('return WSDA.landing.state.version;');
      await d.run(SET_FILES, '#files-input', files);
      await d.waitFor(`!WSDA.landing.state.loading && WSDA.landing.state.version > ${v0} && !WSDA.landing.checklist.state.busy`, 20000, 'load');
      return d.run(VIEW);
    };
    let cases = 0;
    for (const [name, c] of Object.entries(matrix.cases)) {
      if (c.options) continue;
      for (const src of c.source) {
        if (!fs.existsSync(path.join(OUT, src)) || (fs.statSync(path.join(OUT, src)).isDirectory() && !filesOf(src).length)) continue;
        const v = await load(filesOf(src)), tag = `matrix ${name} [${src}]`;
        if (c.loadError) { check(v.errors.some(m => m.includes(c.loadError)), tag + ': load error', v.errors); cases++; continue; }
        const badDs = v.datasets.filter(x => JSON.stringify(viewDs(x)) !== JSON.stringify(c.datasets[x.id] === undefined ? 'missing' : c.datasets[x.id]));
        const cf = Object.assign({}, c.features, { 'focus-map': c.features['wa-map'], 'focus-premises': { full: 'on', full_pick_overrides_name: 'on',
          duplicate_master: 'off:choose', wrong_file: 'off:CVI master table', corrupt_zip: 'off:CVI master table', empty_folder: 'off:CVI master table' }[name] || 'off:Origin.Lat' });
        const badF = v.features.filter(f => { const e = cf[f.id] || ''; return e === 'on' ? !f.on : !(e.startsWith('off:') && !f.on && f.reason.includes(e.slice(4))); });
        check(!v.errors.length && !badDs.length && v.features.length === Object.keys(cf).length && !badF.length, tag + ': datasets and features as the hand-written oracle', { errors: v.errors, badDs: badDs.map(x => [x.id, viewDs(x)]), badF });
        cases++;
      }
    }
    run.matrixRuns = cases;

    // 4. The hand-off: Full tier, "Open the CVI map" clicked, the CVI page in its own window, compared with R
    await load(filesOf('tiers/full.zip'));
    const before = await d.handles();
    await d.click('#next-open');
    let cvi = null;
    for (let i = 0; i < 100 && !cvi; i++) { cvi = (await d.handles()).find(h => !before.includes(h)) || null; if (!cvi) await sleep(100); }
    check(!!cvi, 'hand-off: "Open the CVI map" opens the CVI page in its own window', { before, after: await d.handles(), status: await d.run('var b=document.getElementById("next-open");return {text:document.getElementById("next-opened").textContent,disabled:b.disabled,kind:document.getElementById("next-step").getAttribute("data-kind")};') });
    if (cvi) {
      await d.switchTo(cvi);
      await d.waitFor('window.CVIWA && CVIWA.state && CVIWA.state.master && !CVIWA.state.loading && CVIWA.state.data.length > 0 && CVIWA.state.mapHandle.ready', 30000, 'CVI map with the Full tier');
      await d.run(ERRORS);
      await sleep(400);
      const STATE = 'return JSON.parse(JSON.stringify({data:CVIWA.state.data, liveTooltips:CVIWA.state.liveTooltips, legend:CVIWA.state.legend, version:CVIWA.state.version}));';
      const page = await d.run(`return {rows:CVIWA.state.master.physicalRows, banner:document.getElementById('bundle-banner').textContent, search:location.search,
        canvas:!!document.querySelector('canvas.maplibregl-canvas'), labels:document.querySelectorAll('.county-label').length, unavailable:/Map unavailable/.test(document.body.textContent)};`);
      check(page.rows === 1500 && page.banner === 'Full – synthetic test bundle · prepared 2026-09-15 · covers 2024–2025' && /^\?handoff=[0-9a-f]{32}$/.test(page.search),
        'hand-off: the Full master (1,500 rows) and the banner arrive in the CVI window', page);
      check(page.canvas && page.labels === 39 && !page.unavailable, 'CVI map: MapLibre canvas and 39 county labels', page);
      const oFull = JSON.parse(fs.readFileSync(path.join(S1, 'oracle_tier_full.json'), 'utf8'));
      compareToOracle('Full tier from the landing page, default view', await d.run(STATE), oracleView(oFull, 'default', 'Inbound+Outbound', 'side_by_side', 'log', 5));
      // Views on the small fixture, chosen on the CVI page itself
      const settle = async v0 => { await d.waitFor(`!CVIWA.state.loading && CVIWA.state.version > ${v0}`, 10000, 'recompute'); await sleep(350); return d.run(STATE); };
      let v0 = await d.run('return CVIWA.state.version;');
      await d.run(SET_FILES, '#file-input', [{ name: 'cvi_master_small.csv', b64: fs.readFileSync(path.join(ROOT, 'tests', 'synthetic', 'cvi_master_small.csv')).toString('base64') }]);
      await d.waitFor(`/cvi_master_small\\.csv\\): 22 rows/.test(document.getElementById('master-status').textContent)`, 10000, 'small fixture');
      const oSmall = JSON.parse(fs.readFileSync(path.join(S1, 'oracle_cvi_master_small.json'), 'utf8'));
      let st = await settle(v0);
      compareToOracle('small, default view', st, oracleView(oSmall, 'default', 'Inbound+Outbound', 'side_by_side', 'log', 5));
      // S1.1: the legend as Safari draws it: swatches the circle color at 60% over the land, nested size circles at the
      // legend's radii, largest at the back.
      const lg = await d.run(`var P=document.getElementById('legend-panel'),L=CVIWA.state.legend;return {bg:[].map.call(P.querySelectorAll('.lg-dot'),function(x){return getComputedStyle(x).backgroundColor}),
        shown:L.swatches.map(function(w){return w.shown+' '+(w.shown===CVIWA.palettes.blend(w.color,0.6,'#ececec'))}),r:[].map.call(P.querySelectorAll('svg.lg-sizes circle'),function(c){return +c.getAttribute('r')}),
        want:L.sizes.map(function(z){return z.radius}).sort(function(a,b){return b-a})};`);
      // The radii against the oracle (CVI's .compute_radius for the view's circles; oracle_s1_1.json), not the page's record.
      const ovS = oracleView(oSmall, 'default', 'Inbound+Outbound', 'side_by_side', 'log', 5), iS = oSmall.views.indexOf(ovS) + 1;
      const o11 = JSON.parse(fs.readFileSync(path.join(S1, 'oracle_s1_1.json'), 'utf8')).legend.find(e => e.file === 'oracle_cvi_master_small.json' && e.view === iS);
      lg.oracle = o11 ? arr(o11.radii).slice().sort((a, b) => b - a) : null;
      const rgb = h => 'rgb(' + [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)).join(', ') + ')';
      check(lg.shown.length === 2 && lg.shown.every((x, k) => / true$/.test(x) && lg.bg[k] === rgb(x.split(' ')[0])) && lg.oracle && lg.r.length === lg.oracle.length && lg.r.every((x, k) => near(x, lg.oracle[k])),
        'legend (S1.1): swatches at 60% over the land, nested size circles at the oracle\'s radii', lg);
      const select = async (id, value) => { const w = await d.run('return CVIWA.state.version;'); await d.run(`var s=document.getElementById(args[0]);s.value=args[1];s.dispatchEvent(new Event('change',{bubbles:true}));return true;`, id, String(value)); return settle(w); };
      for (const mode of ['side_by_side', 'total']) {
        const w = await d.run('return CVIWA.state.version;');
        await d.run(`var r=document.querySelector('input[name=mode][value="${mode}"]');if(!r.checked){r.click();}return true;`);
        if (mode === 'total') await settle(w);
        for (const [sc, nb] of [['linear', 5], ['sqrt', 5], ['quantile', 3], ['natural', 4], ['log', 5]]) {
          if (sc === 'quantile' || sc === 'natural') { await select('s-scaling', sc); st = await select('s-bins', nb); }
          else { await select('s-bins', 5); st = await select('s-scaling', sc); }
          compareToOracle(`small, ${mode} ${sc}/${nb}`, st, oracleView(oSmall, 'default', 'Inbound+Outbound', mode, sc, nb));
        }
      }
      // 5. National Flow (S4): the S4 fixture; Map View → National Flow; two of CVI's views set through the Flow controls
      // (the pickers too: after earlier files the page keeps their valid picks, as CVI); the drawn lines against CVI's
      // module. The window at the Chrome suites' 1400 x 1000, so the same lines are on screen.
      await d.size(1400, 1000);
      v0 = await d.run('return CVIWA.state.version;');
      await d.run(SET_FILES, '#file-input', [{ name: 'cvi_master_s4.csv', b64: fs.readFileSync(path.join(ROOT, 'tests', 'synthetic', 'cvi_master_s4.csv')).toString('base64') }]);
      await settle(v0);
      run.beforeFlow = await d.run(`return {view:CVIWA.state.view,wa:document.getElementById('show-wa').getAttribute('aria-pressed'),flow:document.getElementById('show-flow').getAttribute('aria-pressed'),focus:document.getElementById('show-focus').getAttribute('aria-pressed')};`);
      // Establish the starting view through a native click before selecting Flow.
      await d.click('#show-wa');
      await d.click('#show-flow');
      try { await d.waitFor('CVIWA.state.flowHandle && CVIWA.state.flowHandle.ready && CVIWA.flowState.data', 30000, 'National Flow map'); }
      catch (e) {   // what the page shows when the map does not become ready (Safari pauses drawing in a window it hides)
        throw new Error(e.message + ' ' + JSON.stringify(await d.run(`var h=CVIWA.state.flowHandle;return {handle:!!h,ready:!!(h&&h.ready),failed:!!(h&&h.failed),
          loaded:!!(h&&h.map.loaded()),status:document.getElementById('flow-status').textContent,hidden:document.hidden,visibility:document.visibilityState,
          scripts:[].map.call(document.querySelectorAll('script[src]'),function(s){return s.src}).filter(function(s){return /us-states|state-centers|flowmap/.test(s)}),states:!!window.WSDA_US_STATES,centers:!!window.WSDA_STATE_CENTERS,
          flowmap:!!CVIWA.flowmap,view:CVIWA.state.view,selected:document.getElementById('show-flow').getAttribute('aria-pressed'),frame:!document.getElementById('flow-frame').hidden,errors:window.__errors||[]};`)));
      }
      const oS4 = JSON.parse(fs.readFileSync(path.join(S4, 'oracle_s4_cvi_master_s4.json'), 'utf8'));
      const FLOWSET = `var i=args[0],fire=function(el){el.dispatchEvent(new Event('change',{bubbles:true}))},v0=CVIWA.flowState.version;
        var r=document.querySelector('input[name=fl-direction][value="'+i.flow_direction+'"]');r.checked=true;fire(r);
        [['fl-species','flSpecies',i.flow_species],['fl-years','flYears',i.flow_year],['fl-quarters','flQuarters',i.flow_quarter]].forEach(function(p){
          document.querySelector('[data-clear="'+p[1]+'"]').click();
          [].concat(p[2]).forEach(function(v){var cb=[].find.call(document.querySelectorAll('#'+p[0]+' input'),function(x){return x.value===String(v)});
            if(!cb) throw new Error(p[0]+': no choice '+v); cb.checked=true; fire(cb);});});
        [].forEach.call(document.querySelectorAll('#fl-species-sub input'),function(cb){if(cb.checked){cb.checked=false;fire(cb);}});   // these views refine nothing
        var c=document.getElementById('fl-combine');c.checked=!!i.flow_combine_species;fire(c);
        [['fl-scaling',i.flow_scaling],['fl-bins',String(i.flow_n_bins)],['fl-opacity',i.flow_opacity],['fl-mult',i.flow_width_mult],['fl-palette',i.flow_palette]].forEach(function(p){
          var s=document.getElementById(p[0]);s.value=p[1];fire(s);});
        return v0;`;
      const FLOWGOT = `var h=CVIWA.state.flowHandle,m=h.map,f=CVIWA.flowState;return {drawn:h.drawnAll,
        rendered:m.queryRenderedFeatures({layers:['flow_lines']}).map(function(x){return x.id}).filter(function(x,i,a){return a.indexOf(x)===i}).length,
        inInsets:h.insetsDrawn?h.insetsDrawn.lines.length:0,filters:JSON.stringify([f.species,f.speciesSub,f.years.map(String),f.quarters]),proj:m.getProjection&&m.getProjection().type,
        labels:h.labels.filter(function(k){return !k.getElement().classList.contains('hidden')}).length,canvas:!!document.querySelector('#flow-map canvas.maplibregl-canvas')};`;
      for (const [dir, comb] of [['inbound', true], ['combined', false]]) {
        const ov = oS4.views.find(v => v.scenario === 'default' && v.inputs.flow_direction === dir && !!v.inputs.flow_combine_species === comb), i = ov.inputs;
        const w = await d.run(FLOWSET, i);
        await d.waitFor(`CVIWA.flowState.version > ${w}`, 10000, 'Flow recomputed');
        await d.waitFor('CVIWA.state.flowHandle.map.loaded() && !CVIWA.state.flowHandle.map.isMoving()', 10000, 'Flow map idle');
        await sleep(300);
        const g = await d.run(FLOWGOT), wf = arr(arr(ov.layers).find(l => l.id === 'flow_lines').features);
        const bad = wf.filter((e, k) => { const a = g.drawn[k] || {}; return !(a.state === e.state && a.species_group === e.species_group && a.color === s11Color(i.flow_palette, e.species_group, e.color, comb) && near(a.width, e.line_width_px) && a.tooltip === e.tooltip_text); });
        check(g.filters === JSON.stringify([arr(i.flow_species), arr(i.flow_species_sub), arr(i.flow_year), arr(i.flow_quarter)]) && g.drawn.length === wf.length && !bad.length && g.rendered + g.inInsets === wf.length,
          `National Flow, S4 fixture, ${dir}${comb ? ' combine' : ''}: ${wf.length} lines (state, group, color, width, tooltip, order) equal CVI's module, all rendered (Alaska's and Hawaii's in their boxes)`,
          { filters: g.filters, drawn: g.drawn.length, want: wf.length, rendered: g.rendered, inInsets: g.inInsets, bad: bad.slice(0, 2) });
        if (comb) check(g.proj === 'globe' && g.labels === 49 && g.canvas, 'National Flow: MapLibre canvas on a globe, 49 state labels', g);
      }
      await d.click('#show-wa');
      const back = await d.run(`return {view:CVIWA.state.view,maps:!document.getElementById('maps').hidden,flow:!document.getElementById('flow-frame').hidden,rows:CVIWA.state.data.length};`);
      check(back.view === 'wa' && back.maps && !back.flow && back.rows > 0, 'Map View back to WA State: the WA map and its circles shown, the Flow map hidden', back);
      // 6. County Focus: independent CVI premises/payload references, actual pointer clicks and small windows.
      // Chrome's separate full module matrix supplies the complete filter/Browse coverage.
      const focusRoot = path.join(ROOT, 'local-test-artifacts', 's5');
      const focusOutput = path.resolve(focusRoot, process.env.S5_SAFARI_OUTPUT || 'safari');
      if (!focusOutput.startsWith(focusRoot + path.sep)) throw new Error('Safari output must stay under repository-local S5 artifacts');
      fs.mkdirSync(focusOutput, { recursive: true });
      const reference = mode => {
        const r = JSON.parse(fs.readFileSync(path.join(focusRoot, mode, 'reference.json'), 'utf8'));
        const c = r.cases.find(c => c.name === 'full');
        const file = path.join(focusRoot, mode, c.file);
        if (sha(fs.readFileSync(file)) !== c.sha256) throw new Error('Stale Safari Focus input: ' + mode);
        return { c, file };
      };
      await d.click('#show-focus');
      await d.waitFor('CVIWA.state.focusHandle && CVIWA.state.focusHandle.ready', 30000, 'County Focus map');
      const focusIdle = async () => {
        await sleep(500);
        await d.waitFor('!CVIWA.state.focusHandle.map.isMoving() && CVIWA.state.focusHandle.map.loaded()', 15000, 'Focus map idle');
      };
      const focusSet = async i => {
        const w = await d.run(`var i=args[0],f=CVIWA.focusState,w=f.version,fire=function(e){e.dispatchEvent(new Event('change',{bubbles:true}))};
          [['fo-counties','foCounties',i.counties],['fo-species','foSpecies',i.species],['fo-years','foYears',i.years],['fo-quarters','foQuarters',i.quarters]].forEach(function(p){
            document.querySelector('[data-clear="'+p[1]+'"]').click();
            [].concat(p[2]).forEach(function(v){var e=[].find.call(document.querySelectorAll('#'+p[0]+' input'),function(x){return x.value===String(v)});
              if(!e)throw new Error('Focus choice not offered: '+p[0]+' '+v);e.checked=true;fire(e);});});
          ['direction','mode'].forEach(function(k){var e=document.querySelector('input[name=fo-'+k+'][value="'+i[k]+'"]');e.checked=true;fire(e);});
          [].forEach.call(document.querySelectorAll('#fo-species-sub input'),function(e){if(e.checked){e.checked=false;fire(e);}});
          [['fo-scaling',i.scaling],['fo-bins',String(i.nBins)]].forEach(function(p){var e=document.getElementById(p[0]);e.value=p[1];fire(e);});return w;`, i);
        await d.waitFor(`CVIWA.focusState.version > ${w}`, 10000, 'Focus recomputed'); await focusIdle();
      };
      const focusLoad = async file => {
        const w = await d.run('return CVIWA.focusState.version;');
        await d.run(SET_FILES, '#file-input', [{ name: path.basename(file), b64: fs.readFileSync(file).toString('base64') }]);
        await d.waitFor(`!CVIWA.state.loading && CVIWA.focusState.version > ${w}`, 20000, 'Focus fixture'); await focusIdle();
      };
      const fr = reference('premises'); await focusLoad(fr.file);
      for (const direction of ['combined', 'inbound', 'outbound']) for (const mode of ['overlap', 'side_by_side']) {
        const v = fr.c.views.find(v => v.scene === 'all' && v.opts.direction === direction && v.opts.mode === mode && v.opts.scaling === 'log' && v.opts.nBins === 5);
        await focusSet(v.opts);
        const g = await d.run(`var h=CVIWA.state.focusHandle;return {rows:CVIWA.focusState.built.premises,selected:h.focus.sel.features.map(function(x){return x.properties.name}).sort(),
          counts:[h.focus.Inbound.length,h.focus.Outbound.length],view:CVIWA.state.view,canvas:!!document.querySelector('#focus-map canvas.maplibregl-canvas')};`);
        const want = arr(v.rows), bad = want.filter(e => {
          const a = g.rows.find(a => a.direction === e.direction && a.premises_id === e.premises_id);
          return !a || !['lon','lat','radius_px','total_animals','n_shipments','n_cvis'].every(k => near(a[k], e[k])) || a.color !== e.color;
        });
        check(g.view === 'focus' && g.canvas && g.rows.length === want.length && !bad.length && g.counts.reduce((a,b)=>a+b,0) === want.length
          && JSON.stringify(g.selected) === JSON.stringify(v.opts.counties.slice().sort()),
          `County Focus ${direction}/${mode}: premises, coordinates, counts, radii and colors equal independent R reference`, { bad: bad.slice(0,2), counts:g.counts, rows:[g.rows.length,want.length] });
      }
      const pr = reference('payloads'), pv = pr.c.views.find(v => v.scene === 'all' && v.opts.direction === 'combined' && v.opts.mode === 'overlap' && v.opts.scaling === 'log' && v.opts.nBins === 5);
      await focusLoad(pr.file); await focusSet(pv.opts);
      const busy = arr(pv.rows).find(x => x.premises_id === 'Busy'), ll = [busy.lon,busy.lat];
      const stackN = arr(pv.rows).filter(x => near(x.lon,busy.lon) && near(x.lat,busy.lat)).length;
      const openStack = async () => {
        await foreground();
        await d.run('window.focus();window.__lastClick=null;CVIWA.state.focusHandle.map.jumpTo({center:args[0],zoom:15,pitch:0,bearing:0});window.scrollTo(0,0);return true;', ll);
        await focusIdle();
        // jumpTo places the independent reference location at canvas center; use the same paced, hit-tested
        // real pointer helper as the controls, including bounded no-event foreground retries.
        await d.click('#focus-map canvas.maplibregl-canvas');
        try { await d.waitFor('!!document.querySelector("#focus-map .focus-click table")', 5000, 'real pointer Focus popup'); }
        catch(e) { throw new Error(e.message+' '+JSON.stringify(await d.run(`var m=CVIWA.state.focusHandle.map,q=m.project(args[0]);return {focus:document.hasFocus(),event:window.__lastClick,
          point:[q.x,q.y],hits:m.queryRenderedFeatures(q,{layers:['focus_points_in','focus_points_out']}).length,view:CVIWA.state.view};`,ll))); }
      };
      const popupRead = () => d.run(`var p=document.querySelector('#focus-map .focus-click'),r=p.getBoundingClientRect(),m=document.getElementById('focus-map').getBoundingClientRect(),t=p.querySelector('table'),b=t.parentElement,
        buttons=p.querySelectorAll('.focus-stack button'),cells=Array.from(t.querySelector('tbody tr').children),ends=cells.map(function(td){var q=document.createRange();q.selectNodeContents(td);return q.getBoundingClientRect()});return {gaps:ends.slice(1).map(function(r,i){return r.left-ends[i].right}),bounds:[r.left,r.top,r.right,r.bottom],map:[m.left,m.top,m.right,m.bottom],viewport:[innerWidth,innerHeight],font:getComputedStyle(t.querySelector('td')).fontSize,
          label:p.querySelector('.focus-stack span').textContent,prev:buttons[0].disabled,next:buttons[1].disabled,
          rows:[].map.call(t.querySelectorAll('tbody tr'),function(tr){return [].map.call(tr.querySelectorAll('td'),function(td){return td.textContent})}),
          heads:[].map.call(t.querySelectorAll('th'),function(e){return e.textContent}),more:b.textContent,
          scroll:b.scrollHeight>b.clientHeight,contained:r.left>=m.left-1&&r.right<=m.right+1&&r.top>=m.top-1&&r.bottom<=m.bottom+1,
          overflow:document.documentElement.scrollWidth>innerWidth+1};`);
      const wantedBusy = await d.run(`var doc=new DOMParser().parseFromString(args[0],'text/html');return [].map.call(doc.querySelectorAll('tbody tr'),function(tr){return [].map.call(tr.querySelectorAll('td'),function(td){return td.textContent})});`, busy.helperPopup);
      for (const [width,height] of [[1366,768],[1024,600]]) {
        await d.size(width,height); await focusIdle(); await openStack();
        let pop = await popupRead();
        check(pop.prev && !pop.next && pop.label.startsWith('1 of '+stackN+' '), `Focus ${width}x${height}: real click opens independent ${stackN}-premises stack at first item`, pop.label);
        let foundBusy = false;
        for (let index=0; index<stackN; index++) {
          pop = await popupRead();
          if (JSON.stringify(pop.rows) === JSON.stringify(wantedBusy)) {
            foundBusy=true;
            check(pop.rows.length === 25 && pop.heads.join() === 'CVI,Origin,Dest,Species' && /\+5 more CVIs/.test(pop.more), `Focus ${width}x${height}: popup's 25 rows and remainder equal CVI's independent payload`, pop.rows.length);
            const geometry={bounds:pop.bounds,map:pop.map,viewport:pop.viewport,font:pop.font,scroll:pop.scroll,contained:pop.contained,overflow:pop.overflow};
            fs.writeFileSync(path.join(focusOutput,`popup_${width}x${height}.json`),JSON.stringify(geometry,null,2));
            check(pop.font === '14px' && pop.scroll && pop.contained && !pop.overflow, `Focus ${width}x${height}: 14px table, scroll containment and no page overflow`, geometry);
            if(!pop.contained||pop.overflow)fs.writeFileSync(path.join(focusOutput,`popup_${width}x${height}.png`),Buffer.from(await d.screenshot(),'base64'));
            check(await d.run(`var b=document.querySelector('#focus-map .focus-click table').parentElement;b.scrollTop=b.scrollHeight;return b.scrollTop>0;`), `Focus ${width}x${height}: long table can scroll`);
            await d.run(`var h=CVIWA.state.focusHandle,b=document.querySelector('#focus-map .focus-click table').parentElement;
              var rows=Array.from({length:25},function(_,i){return ['24-WA-'+i+'-LONG-CERTIFICATE','Synthetic origin with a long name, WA','Synthetic destination with a long name, ID','Synthetic species group']});
              b.replaceWith(CVIWA.focusmap.popupElement({rows:rows,more:12}));h.clickPopup.setLngLat(h.clickPopup.getLngLat());return true;`);
            await sleep(150);
            const long = await popupRead();
            const scroll = await d.run(`var b=document.querySelector('#focus-map .focus-click table').parentElement;b.scrollTop=b.scrollHeight;b.scrollLeft=b.scrollWidth;return [b.scrollTop,b.scrollLeft,b.scrollWidth>b.clientWidth];`);
            fs.writeFileSync(path.join(focusOutput,`popup_long_${width}x${height}.json`),JSON.stringify({bounds:long.bounds,map:long.map,viewport:long.viewport,font:long.font,gaps:long.gaps,contained:long.contained,overflow:long.overflow,scroll},null,2));
            check(long.gaps.every(g=>g>=19.5), `Focus ${width}x${height}: long-entry columns have at least 20px text separation`, long.gaps);
            check(long.font==='14px' && long.rows.length===25 && /\+12 more CVIs/.test(long.more) && long.contained && !long.overflow && scroll[0]>0 && (!scroll[2] || scroll[1]>0), `Focus ${width}x${height}: long entries retain content, containment and both-axis scrolling`, {long,scroll});

          }
          if(index<stackN-1) await d.click('#focus-map .focus-stack button[aria-label="Next premises"]');
        }
        check(foundBusy && !pop.prev && pop.next && pop.label.startsWith(stackN+' of '+stackN+' '), `Focus ${width}x${height}: every Next click works, last item disables Next`, pop.label);
        await d.click('#focus-map .focus-stack button[aria-label="Previous premises"]');
        const previous = await popupRead();
        check(!previous.next && previous.label.startsWith((stackN-1)+' of '+stackN+' '), `Focus ${width}x${height}: Previous works`);
        await d.click('#focus-map .focus-click .maplibregl-popup-close-button');
        check(await d.run('return !document.querySelector("#focus-map .focus-click");'), `Focus ${width}x${height}: Close works`);
      }
      await d.click('#fo-browse'); await d.click('#fo-time-play');
      check(await d.run('return CVIWA.focusState.browse && CVIWA.focusState.playing;'), 'Focus Browse/Play starts');
      await d.click('#show-wa');
      check(await d.run('return !CVIWA.focusState.playing;'), 'Focus Browse/Play stops when leaving the view');
      await d.click('#show-focus'); await focusIdle();
      const camera = await d.run('var m=CVIWA.state.focusHandle.map,c=m.getCenter();return [c.lng,c.lat,m.getZoom(),m.getPitch(),m.getBearing()];');
      await d.click('#reset-all'); await focusIdle();
      const reset = await d.run(`var f=CVIWA.focusState,m=CVIWA.state.focusHandle.map,c=m.getCenter();return {counties:f.counties,browse:f.browse,fac:f.fac.on,view:CVIWA.state.view,
        direction:f.direction,mode:f.mode,scaling:f.scaling,nBins:f.nBins,cam:[c.lng,c.lat,m.getZoom(),m.getPitch(),m.getBearing()]};`);
      check(!reset.counties.length && !reset.browse && !reset.fac.length && reset.view==='focus' && reset.direction==='combined' && reset.mode==='overlap' && reset.scaling==='log' && reset.nBins===5,
        'Focus Reset All clears picks and restores the defaults', reset);
      check(reset.cam.every((x,i)=>near(x,camera[i])), 'Focus Reset All preserves the camera', [reset.cam,camera]);
      await collect();
      await d.switchTo(landing);
      check(/is open in its own tab with your files/.test(await d.run(`return document.getElementById('next-opened').textContent;`)), 'landing: confirms the CVI page loaded the files');
    }
    await collect();
    check(errors.length === 0, 'no page errors after load (window.onerror / unhandled rejections)', errors);
  } catch (e) {
    check(false, 'run aborted', String(e && e.stack || e));
    try { fs.writeFileSync(path.join(OUT, 'safari_failed.png'), Buffer.from(await d.screenshot(), 'base64')); } catch (e) { /* window may be gone */ }
  } finally {
    await d.close();
  }
  notes.push('not observable through WebDriver: network requests and CSP reports (checked in Chrome)');
  Object.assign(run, { passed: pass, failed: fail, failures, notes, finished: new Date().toISOString() });
  fs.writeFileSync(path.join(OUT, 'safari_run.json'), JSON.stringify(run, null, 1));
  failures.forEach(f => console.log('  FAIL ' + f));
  notes.forEach(n => console.log('  note ' + n));
  console.log('Safari ' + run.safari + ' | ' + run.page + ' | matrix runs ' + (run.matrixRuns || 0));
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();

// S6's entry check only; the CVI/Focus suite above remains available unchanged.
async function runS6Entry() {
  // Reads the fixtures in s6/day2/fixtures; writes the results and pictures to s6/day2.
  const fix = path.join(ROOT, 'local-test-artifacts/s6/day2/fixtures');
  const out = path.join(ROOT, 'local-test-artifacts/s6/day2');
  fs.mkdirSync(out, { recursive: true });
  let d, timer;
  const run = { page: PAGE, started: new Date().toISOString(), limitation: 'Safari does not observe network/CSP; Chrome supplies that evidence.' };
  try {
    d = await launch(); run.safari = d.version; await d.size(1366, 768);
    const input = names => names.map(name => ({ name: path.basename(name), b64: fs.readFileSync(path.join(fix, name)).toString('base64') }));
    const load = async (api, names, folder) => {
      const data = input(names);
      await d.run(`const a=WSDA[args[0]],v=a.state.version,files=args[1].map(x=>{
        const b=Uint8Array.from(atob(x.b64),c=>c.charCodeAt(0)),f=new File([b],x.name);
        if(args[2])Object.defineProperty(f,'webkitRelativePath',{value:'synthetic/'+x.name});return f;
      });const dt=new DataTransfer();for(const f of files)dt.items.add(f);
      const el=document.getElementById(args[2]?'folder-input':'files-input');el.files=dt.files;el.dispatchEvent(new Event('change',{bubbles:true}));return true;`, api, data, !!folder);
      await d.waitFor(`WSDA.${api}.state.version>0&&!WSDA.${api}.state.loading&&!WSDA.${api}.checklist.state.busy`);
    };
    const state = () => d.run(`return {ids:Object.keys(WSDA.infrastructure.state.datasets).sort(),version:WSDA.infrastructure.state.version,
      status:document.getElementById('entry-status').textContent,search:location.search,source:WSDA.infrastructure.state.source};`);
    async function suite() {
      await d.goto(PAGE);await d.waitFor('window.WSDA&&WSDA.landing');
      const hub = await d.handle();
      check(await d.run("return document.querySelectorAll('#profiles .card').length===3;"), 'S6 three dashboard cards');
      // The hub has one sample button (the all-in-one); the Infrastructure generator it still loads
      // must give the dashboard's exact sample bytes.
      check(await d.run("return Array.from(document.querySelectorAll('[data-sample]')).map(b=>b.getAttribute('data-sample')).join()==='all';"), 'S6 hub offers only the all-in-one sample');
      const sample = await d.run(`const S=WSDA.samples.infrastructure;return {name:S.fileName,bytes:Array.from(WSDA.sample.zip(S.entries()))};`);
      check(sample.name==='infrastructure_synthetic.zip'&&Buffer.from(sample.bytes).equals(fs.readFileSync(path.join(fix,sample.name))), 'S6 Safari sample exact bytes');
      await load('landing', ['infrastructure_synthetic.zip']);
      check(await d.run("return WSDA.landing.state.selected==='infrastructure'&&!document.getElementById('next-open').hidden;"), 'S6 ZIP routes Infrastructure without master');
      const before=await d.handles();await d.click('#next-open');
      let infra;
      for(let i=0;i<100&&!infra;i++){infra=(await d.handles()).find(h=>!before.includes(h));if(!infra)await sleep(100);}
      check(!!infra,'S6 Infrastructure own tab');if(!infra)throw new Error('No Infrastructure tab');
      await d.switchTo(infra);await d.waitFor('window.WSDA&&WSDA.infrastructure&&WSDA.infrastructure.state.version>0&&!WSDA.infrastructure.state.loading');
      let st=await state();check(st.ids.join()==='fairgrounds,feedlots,manifest,markets,restricted,slaughterhouses,synthetic_support','S6 facility-only handoff IDs',st);
      const key=st.search;
      await d.switchTo(hub);check(await d.run("return /is open in its own tab with your files/.test(document.getElementById('next-opened').textContent);"),'S6 load acknowledgement');
      await load('landing',['unknown.csv','cvi/bundle.json']);
      await d.run("return await WSDA.landing.selectProfile('infrastructure',true);");
      check(await d.run("return WSDA.landing.checklist.state.result.datasets.find(d=>d.id==='feedlots').status==='found';"),'S6 explicit CVI mapping reuse');
      await d.click('#next-open');await d.switchTo(infra);await d.waitFor(`window.WSDA&&WSDA.infrastructure&&WSDA.infrastructure.state.version>0&&!WSDA.infrastructure.state.loading&&location.search!==${JSON.stringify(key)}`);
      st=await state();check(st.ids.join()==='feedlots'&&(await d.handles()).length===before.length+1,'S6 repeated Open reuses only Infrastructure tab',st);
      const reloadURL=await d.run('return location.href;');await d.goto(reloadURL);await d.waitFor('window.WSDA&&WSDA.infrastructure&&WSDA.infrastructure.state.version>0');
      check((await state()).ids.join()==='feedlots','S6 reload while hub alive');
      await load('infrastructure',['infrastructure_synthetic.zip']);check((await state()).ids.length===7,'S6 direct ZIP');
      await load('infrastructure',fs.readdirSync(path.join(fix,'sample')).map(n=>'sample/'+n),true);check((await state()).ids.length===7,'S6 direct folder FileList');
      await load('infrastructure',['sample/wa_state_feedlots.csv','broken_master.csv']);st=await state();check(st.ids.join()==='feedlots','S6 malformed optional master keeps facilities',st);
      await load('infrastructure',['invalid.csv']);await d.run("return await WSDA.infrastructure.checklist.assign('f1','feedlots');");await d.waitFor('!WSDA.infrastructure.state.loading&&!WSDA.infrastructure.checklist.state.busy');
      st=await state();check(st.ids.join()==='feedlots'&&/Headers recognized/.test(st.status),'S6 invalid-point header explanation',st);
      await load('infrastructure',['sample/facility_overlays_manifest.csv']);st=await state();check(st.ids.join()==='manifest'&&/no points/.test(st.status),'S6 manifest-only explanation',st);
      await d.size(1024,600);fs.writeFileSync(path.join(out,'safari_entry_'+(PAGE.startsWith('file:')?'file':'http')+'.png'),Buffer.from(await d.screenshot(),'base64'));
      await d.switchTo(hub);await d.goto('about:blank');await d.switchTo(infra);await d.goto(reloadURL);
      await d.waitFor("window.WSDA&&WSDA.infrastructure&&/landing page is closed or unavailable/.test(document.getElementById('load-status').textContent)",12000);
      check((await state()).ids.length===0,'S6 hub unavailable/reload empty with explanation');
    }
    await Promise.race([suite(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('S6 Safari seven-minute limit')),420000);})]);
  } catch(e) {check(false,'S6 Safari suite error',e.stack);}
  finally {clearTimeout(timer);if(d)await d.close();}
  Object.assign(run,{passed:pass,failed:fail,failures,notes,finished:new Date().toISOString()});
  fs.writeFileSync(path.join(out,'safari_'+(PAGE.startsWith('file:')?'file':'http')+'.json'),JSON.stringify(run,null,2)+'\n');
  failures.forEach(f=>console.error(f));console.log('S6 entry-flow Safari: '+pass+' passed, '+fail+' failed');process.exitCode=fail?1:0;
}
if (process.argv.includes('--s6-entryflow')) runS6Entry().catch(e=>{console.error(e.stack);process.exitCode=2;});

async function runS6Facilities() {
 const out=path.join(ROOT,'local-test-artifacts/s6/day3'),mode=PAGE.startsWith('file:')?'file':'http';fs.mkdirSync(out,{recursive:true});
 const result={page:PAGE,started:new Date().toISOString(),limitation:'Synthetic FileList; network/CSP unobservable. Real pointer clicks, no DOM click substitute.'};let d,timer;
 try {
  d=await launch();result.safari=d.version;await d.size(1366,768);
  const load=async files=>{const old=await d.run('return WSDA.infrastructure.state.version;');await d.run(SET_FILES,'#files-input',files.map(f=>({name:path.basename(f),b64:fs.readFileSync(f).toString('base64')})));await d.waitFor(`WSDA.infrastructure.state.version>${old}&&!WSDA.infrastructure.state.loading`);await settle();};
  const settle=()=>d.waitFor('WSDA.infrastructure.state.map.ready&&WSDA.infrastructure.state.map.map.loaded()&&!WSDA.infrastructure.state.map.map.isMoving()',30000);
  const county=async name=>{await d.run(tickRun('document.getElementById("facility-counties")'),name?[name]:[]);await settle();};
  const counts=()=>d.run('return WSDA.infrastructure.state.result.counts;');
  const point=async(lon,lat)=>{await foreground();await d.run(`WSDA.infrastructure.state.map.map.jumpTo({center:args,zoom:17});document.getElementById('facility-map').scrollIntoView({block:'center'});return true;`,lon,lat);await settle();
    // Safari can drop a real click sent right after the scripted scroll (seen twice; delivered with a pause).
    await sleep(300);const xy=await d.run(`const m=WSDA.infrastructure.state.map.map,p=m.project(args),r=m.getCanvas().getBoundingClientRect();return [r.x+p.x,r.y+p.y];`,lon,lat);await d.pointer(...xy);};
  async function suite() {
   const base=new URL('.',PAGE).href;await d.goto(new URL('infrastructure/index.html',base).href);await d.waitFor('window.WSDA&&WSDA.infrastructure&&WSDA.infrastructure.state.map.ready');
   await load([path.join(ROOT,'local-test-artifacts/s6/day2/fixtures/infrastructure_synthetic.zip')]);
   check(Object.values(await counts()).reduce((a,n)=>a+n,0)===8,'S6 sample eight rows');
   check(await d.run('return WSDA.infrastructure.state.selectedLayers.length===6;'),'S6 first load all usable');
   check(await d.run("return document.getElementById('infra-basemap').selectedOptions[0].text==='Offline county map';"),'S6 basemap picker opens on the offline map');
   // Measured as in the Chrome suite: every line of a text starts right of its dot.
   const beside=`const besideDot=(dot,text)=>{const r=document.createRange();r.selectNodeContents(text);const lines=[...r.getClientRects()];
     return {lines:new Set(lines.map(x=>Math.round(x.top))).size,beside:lines.every(x=>x.left>=dot.getBoundingClientRect().right-0.5)};};`;
   const legendLines=await d.run(beside+`const legend=document.getElementById('facility-legend');legend.style.maxWidth='130px';
     const out=[...document.querySelectorAll('#facility-legend-content p.lg-line')].map(l=>besideDot(l.querySelector('.facility-swatch'),l.lastChild));
     legend.style.maxWidth='';return out;`);
   check(legendLines.length===6&&legendLines.some(l=>l.lines>1)&&legendLines.every(l=>l.beside),'S6 wrapped legend names continue beside the dot',legendLines);
   const rows=await d.run(beside+`document.getElementById('facility-fold').open=true;const list=document.getElementById('facility-controls');
     const measure=()=>[...list.querySelectorAll('label.fac-row')].map(l=>{const box=l.querySelector('input').getBoundingClientRect(),dot=l.querySelector('.facility-swatch'),name=l.querySelector('.facility-title');
       return {firstLine:Math.abs(box.top-dot.getBoundingClientRect().top)<6&&Math.abs(box.top-name.getBoundingClientRect().top)<6,...besideDot(dot,name)};});
     const wide=measure();list.style.width='140px';const narrow=measure();list.style.width='';return {wide,narrow};`);
   check(rows.wide.length===6&&rows.wide.every(r=>r.firstLine&&r.lines===1)&&rows.narrow.some(r=>r.lines>1)&&rows.narrow.every(r=>r.firstLine&&r.beside),'S6 layer rows on one line, long names wrap beside the dot',rows);
   await d.run("document.getElementById('style-fold').open=true;document.querySelector('#neighbor-controls .nr-on').click();return true;");await settle();
   const indent=await d.run(`const row=document.querySelector('#neighbor-controls .nr-row'),sub=row.querySelector('label.nr-sub');
     return {shown:!sub.hidden,step:sub.getBoundingClientRect().left-row.querySelector('label').getBoundingClientRect().left};`);
   check(indent.shown&&Math.abs(indent.step-22.4)<1,'S6 neighbor counties switch indented under its region',indent);
   await d.run("document.querySelector('#neighbor-controls .nr-on').click();return true;");await settle();
   const camera=await d.run('return CVIWA.map.camera(WSDA.infrastructure.state.map);');
   await county('Pierce');check((await counts()).slaughterhouses===2&&(await counts()).synthetic_support===0,'S6 county restriction and zero layer');
   check(JSON.stringify(await d.run('return CVIWA.map.camera(WSDA.infrastructure.state.map);'))===JSON.stringify(camera),'S6 filtering preserves camera');
   check(await d.run('return document.querySelectorAll("#infrastructure-refine-5-0 input").length===2;'),'S6 choices remain statewide');
   await county('King');await point(-122.33,47.6);await d.waitFor('!!WSDA.infrastructure.state.map.clickPopup');
   const detail=await d.run('return document.querySelector(".facility-details").textContent;');check(/Service: Transport/.test(detail)&&/WA county: King/.test(detail),'S6 real-pointer shared details',detail);
   for(const [w,h]of [[1366,768],[1024,600]]) {await d.size(w,h);await sleep(200);const b=await d.run(`const m=document.getElementById('facility-map').getBoundingClientRect(),p=document.querySelector('.facility-details').getBoundingClientRect(),l=document.getElementById('facility-legend').getBoundingClientRect();return {detail:p.x>=m.x-1&&p.right<=m.right+1&&p.y>=m.y-1&&p.bottom<=m.bottom+1,legend:l.x>=m.x&&l.right<=m.right&&l.y>=m.y&&l.bottom<=m.bottom};`);check(b.detail&&b.legend,'S6 containment '+w+'x'+h,b);fs.writeFileSync(path.join(out,'safari_'+mode+'_details_'+w+'.png'),Buffer.from(await d.screenshot(),'base64'));}
   await d.click('.facility-click .maplibregl-popup-close-button');check(!await d.run('return !!document.querySelector(".facility-details");'),'S6 pointer Close');
   await d.run(tickRun('document.getElementById("infrastructure-refine-5-0")'),['Storage']);await settle();check((await counts()).synthetic_support===1,'S6 attribute picker');
   await point(-122.34,47.61);await d.waitFor('!!WSDA.infrastructure.state.map.clickPopup');check(await d.run(`const t=document.querySelector('.facility-details').textContent;return t.includes('Synthetic Support B')&&!t.includes('Town-level');`),'S6 NA precision supplied name');
   await county('Pierce');check(!await d.run('return !!WSDA.infrastructure.state.map.clickPopup;'),'S6 filtered-out popup closes');
   await d.size(1366,768);
   const fixtures=path.join(ROOT,'local-test-artifacts/s6/day3/fixtures');await load(['usda_wa_slaughter_facilities.csv','wa_state_fairs.csv','wa_state_public_livestock_markets.csv','wa_state_feedlots.csv','wa_state_restricted_holding_facilities.csv'].map(n=>path.join(fixtures,n)));await county('');
   check(Object.values(await counts()).reduce((a,n)=>a+n,0)===10000,'S6 dense 10000 rows');
   await d.run(`WSDA.infrastructure.state.map.map.jumpTo({center:[-122.35,47.25],zoom:23});document.getElementById('facility-map').scrollIntoView({block:'center'});return true;`);await settle();
   const cluster=await d.run(`const m=WSDA.infrastructure.state.map.map;return m.queryRenderedFeatures(m.project([-122.35,47.25]),{layers:['infra_cluster_4']})[0].properties.point_count;`);check(cluster===250,'S6 honest coincident cluster');
   const xy=await d.run(`const m=WSDA.infrastructure.state.map.map,q=m.project([-122.35,47.25]),r=m.getCanvas().getBoundingClientRect();return [q.x+r.x,q.y+r.y];`);await foreground();await d.pointer(...xy);
   check(!await d.run('return !!WSDA.infrastructure.state.map.clickPopup;'),'S6 cluster no click');await d.waitFor(`document.querySelector('.facility-tip')&&document.querySelector('.facility-tip').textContent.includes('...first 15 of 250 shown')`);check(await d.run(`return document.querySelector('.facility-tip').textContent.includes('town-level location');`),'S6 real cluster leaves qualifier/remainder');
   await county('Adams');check(Object.values(await counts()).every(n=>n===0)&&await d.run('return !document.getElementById("facility-zero").hidden&&WSDA.infrastructure.state.selectedLayers.length===5;'),'S6 dense zero case');
   const file=path.join(fixtures,'replacement','wa_state_feedlots.csv');await load([file]);await county('');
   await d.run(tickRun('document.getElementById("infrastructure-refine-3-0")'),['Gamma']);await settle();check((await counts()).feedlots===1,'S6 replacement current choices');
   await load([file]);check(await d.run(`return WSDA.infrastructure.state.attributes.feedlots.Kind.join()==='Gamma';`),'S6 valid picks preserved on replacement');
   await d.click('#infrastructure-layers-clear');await settle();check(await d.run('return WSDA.infrastructure.state.result.layers.length===0&&document.getElementById("facility-cards").textContent==="Select facility layers to see counts.";'),'S6 no selected layers');
   await load([file]);check(await d.run('return WSDA.infrastructure.state.selectedLayers.length===0;'),'S6 no repeated initial selection');
  }
  await Promise.race([suite(),new Promise((_,rej)=>{timer=setTimeout(()=>rej(new Error('S6 Safari seven-minute bound')),420000);})]);
 }catch(e){check(false,'S6 Safari facilities suite',e.stack);}finally{clearTimeout(timer);if(d)await d.close();}
 Object.assign(result,{passed:pass,failed:fail,failures,notes});fs.writeFileSync(path.join(out,'safari_facilities_'+mode+'.json'),JSON.stringify(result,null,2)+'\n');failures.forEach(f=>console.error(f));console.log(`S6 facilities Safari: ${pass} passed, ${fail} failed`);process.exitCode=fail?1:0;
}
if(process.argv.includes('--s6-facilities'))runS6Facilities().catch(e=>{console.error(e.stack);process.exitCode=2;});

async function runS6Focus() {
 const out=path.join(ROOT,'local-test-artifacts/s6/day4'),mode=PAGE.startsWith('file:')?'file':'http',H='CVIWA.state.focusHandle',F='CVIWA.focusState';fs.mkdirSync(out,{recursive:true});
 const result={page:PAGE,started:new Date().toISOString(),limitation:'Synthetic FileList; network/CSP unobservable. Real pointer actions, no DOM click substitution.'};let d,timer;
 try{
  d=await launch();result.safari=d.version;await d.size(1366,768);
  const settle=()=>d.waitFor(`${H}&&${H}.ready&&${H}.map.loaded()&&!${H}.map.isMoving()`,30000);
  const counties=async names=>{await d.run(`document.querySelector('[data-clear="foCounties"]').click();for(const c of document.querySelectorAll('#fo-counties input'))if(args[0].includes(c.value))c.click();return true;`,names);await sleep(650);await settle();};
  const send=async csv=>{await d.run(`return CVIWA.setFacilityFiles({feedlots:{file:new Blob([args[0]])}}).then(()=>true);`,csv);await settle();};
  const count=()=>d.run(`return ${F}.fac.result.counts.feedlots;`);
  const pick=async v=>{await d.run(tickRun('document.querySelector("#fo-fac-list .facility-refine")'),v?[v]:[]);await settle();};
  const point=async()=>{await foreground();await d.run(`void ${H}.map.jumpTo({center:[-122.35,47.25],zoom:17});document.getElementById('focus-map').scrollIntoView({block:'center'});return true;`);await settle();const xy=await d.run(`const m=${H}.map,q=m.project([-122.35,47.25]),r=m.getCanvas().getBoundingClientRect();return [q.x+r.x,q.y+r.y];`);await d.pointer(...xy);};
  async function suite(){
   await d.goto(new URL('cvi/index.html',new URL('.',PAGE)).href);await d.waitFor('window.CVIWA&&CVIWA.state');
   const file=path.join(ROOT,'local-test-artifacts/f1/tiers/full/CVI_Consolidated_Master.csv');await d.run(SET_FILES,'#file-input',[{name:path.basename(file),b64:fs.readFileSync(file).toString('base64')}]);await d.waitFor('CVIWA.state.master&&!CVIWA.state.loading');await d.click('#show-focus');await settle();
   const csv='name,lat,long,Kind,owner,geo_source\n"<img src=x>",47.25,-122.35,Alpha,Secret,google_city\nB,47.26,-122.36,Beta,Other,NA\nC,47.6,-122.33,Alpha,Private,existing\n';
   await send(csv);check(await d.run(`return ${F}.fac.on.length===0;`),'Focus starts off');await d.run(`document.getElementById('fo-fac-all').click();return true;`);await settle();check(await count()===0,'Focus no counties means no points');
   await counties(['Pierce']);check(await count()===2,'Focus local Pierce count');
   // Layer rows as in Infrastructure, measured as in the Chrome suite.
   const rows=await d.run(`const list=document.getElementById('fo-fac-list');if(list.closest('details'))list.closest('details').open=true;
     const measure=()=>[...list.querySelectorAll('label.fac-row')].map(l=>{const box=l.querySelector('input').getBoundingClientRect(),dot=l.querySelector('.facility-swatch'),
       name=l.querySelector('.facility-title'),r=document.createRange();r.selectNodeContents(name);const lines=[...r.getClientRects()];
       return {firstLine:Math.abs(box.top-dot.getBoundingClientRect().top)<6&&Math.abs(box.top-name.getBoundingClientRect().top)<6,
         lines:new Set(lines.map(x=>Math.round(x.top))).size,beside:lines.every(x=>x.left>=dot.getBoundingClientRect().right-0.5)};});
     const wide=measure();list.style.width='140px';const narrow=measure();list.style.width='';return {wide,narrow};`);
   check(rows.wide.length>=5&&rows.wide.every(r=>r.firstLine&&r.lines===1)&&rows.narrow.some(r=>r.lines>1)&&rows.narrow.every(r=>r.firstLine&&r.beside),'Focus layer rows on one line, long names wrap beside the dot',rows);
   await counties(['Pierce','King']);check(await count()===3,'Focus polygon union');
   const movement=await d.run(`return JSON.stringify([${F}.valueBoxes,${F}.strip]);`);await pick('Alpha');check(await count()===2,'Focus shared refine');check(await d.run(`return JSON.stringify([${F}.valueBoxes,${F}.strip]);`)===movement,'movement cards/strip unchanged');
   await d.run(`document.querySelector('[data-clear="foSpecies"]').click();document.querySelector('[data-clear="foYears"]').click();document.querySelector('[data-clear="foQuarters"]').click();return true;`);await sleep(350);await settle();check(await count()===2,'independent CVI filters');
   await d.run(`const el=document.getElementById('fo-hide');el.checked=true;el.dispatchEvent(new Event('change',{bubbles:true}));return true;`);await point();await d.waitFor('document.querySelector(".facility-details")');
   check(await d.run(`const t=document.querySelector('.facility-details').textContent;return t.includes('<img src=x>')&&t.includes('Kind: Alpha')&&t.includes('Town-level location')&&t.includes('WA county: Pierce')&&!t.includes('Secret')&&!document.querySelector('.facility-details img');`),'safe shared details with CVI hidden');
   check(await d.run(`return ${H}.map.getLayoutProperty('focus_points_in','visibility')==='none'&&document.getElementById('legend-panel-focus').textContent.includes('Facility locations');`),'Hide CVI facility independence/legend');
   check(await d.run(`return Object.keys(${H}.map.getStyle().sources.focus_fac_src_0.data.features[0].properties).sort().join()==='name,ref_display,row_id'&&${H}.map.getStyle().sources.focus_fac_src_0.cluster!==true;`),'minimal/unclustered Focus payload');
   for(const [w,h]of [[1366,768],[1024,600]]){await d.size(w,h);await sleep(300);const boxes=await d.run(`document.getElementById('legend-panel-focus').hidden=false;const m=document.getElementById('focus-map').getBoundingClientRect(),p=document.querySelector('.facility-details').getBoundingClientRect(),l=document.getElementById('legend-panel-focus').getBoundingClientRect();return {detail:p.x>=m.x-1&&p.right<=m.right+1&&p.y>=m.y-1&&p.bottom<=m.bottom+1,legend:l.x>=m.x-1&&l.right<=m.right+1&&l.y>=m.y-1&&l.bottom<=m.bottom+1};`);check(boxes.detail&&boxes.legend,'Focus containment '+w+'x'+h,boxes);fs.writeFileSync(path.join(out,'safari_'+mode+'_details_'+w+'.png'),Buffer.from(await d.screenshot(),'base64'));}
   await d.click('.focus-fac-click .maplibregl-popup-close-button');check(!await d.run('return !!document.querySelector(".facility-details");'),'Focus real pointer Close');
   // 2.2: a real click opens a legend group, and the group stays open when the legend is redrawn (an opacity change).
   await d.click('#legend-panel-focus .lg-group[data-group="facilities"] > summary');await sleep(250);
   const grp=()=>d.run(`const g=document.querySelector('#legend-panel-focus .lg-group[data-group="facilities"]');return !!g&&g.open;`);const opened=await grp();
   await d.run(`const o=document.getElementById('fo-opacity');o.dispatchEvent(new Event('change',{bubbles:true}));return true;`);await sleep(300);
   check(opened&&await grp(),'Focus legend group opened by a real click stays open after a redraw');
   await d.run(`const g=document.querySelector('#legend-panel-focus .lg-group[data-group="facilities"]');if(g)g.open=false;return true;`);await sleep(200);   // folded again: open, it covers the point clicked next
   await point();await d.waitFor('document.querySelector(".facility-details")');await pick('Beta');check(!await d.run(`return !!${H}.clickPopup;`),'filtered-out row closes details');
   await counties(['King']);check(await count()===0&&await d.run(`return !document.querySelector('#fo-fac-list input[value="feedlots"]').disabled&&document.getElementById('fo-fac-list').textContent.includes('No facilities match');`),'usable zero result');
   await send(csv.replaceAll('Alpha','Gamma').replaceAll('Beta','Delta'));check(await d.run(`return ${F}.fac.attributes.feedlots.Kind.length===0&&!document.getElementById('fo-fac-notice').hidden&&${F}.fac.prepared.layers[3].choices.Kind.join()==='Delta,Gamma';`),'same-size replacement choices/notice');
   await counties(['Pierce']);await pick('Gamma');await send(csv.replaceAll('Alpha','Gamma').replaceAll('Beta','Delta'));check(await d.run(`return ${F}.fac.attributes.feedlots.Kind.join()==='Gamma';`),'valid replacement pick retained');
   await send('lat,long\n47.25,-122.35\n');check(await count()===1&&await d.run(`return Object.keys(${F}.fac.prepared.layers[3].choices).length===0&&${F}.fac.prepared.layers[3].points[0].geoSource==='existing';`),'reduced data');
   await send('name,lat,long\n');check(await d.run(`return document.querySelector('#fo-fac-list input[value="feedlots"]').disabled;`),'empty input');await d.run('return CVIWA.setFacilityFiles({}).then(()=>true);');check(await d.run(`return ${F}.fac.prepared.layers.every(l=>!l.usable);`),'missing facilities');
   await send(csv);await d.run(`document.getElementById('fo-fac-all').click();document.getElementById('fo-fac-block').open=true;return true;`);await pick('Alpha');const camera=await d.run(`return CVIWA.map.camera(${H});`);await d.click('#reset-all');await sleep(350);await settle();check(await d.run(`return ${F}.fac.on.length===0&&Object.keys(${F}.fac.attributes).length===0&&${F}.counties.length===0&&document.getElementById('fo-fac-block').open;`),'reset picks/fold');check(JSON.stringify(await d.run(`return CVIWA.map.camera(${H});`))===JSON.stringify(camera),'reset camera');
  }
  await Promise.race([suite(),new Promise((_,rej)=>{timer=setTimeout(()=>rej(new Error('S6 Focus Safari seven-minute bound')),420000);})]);
 }catch(e){check(false,'complete Focus Safari suite',e.stack);}finally{clearTimeout(timer);if(d)await d.close();}
 Object.assign(result,{passed:pass,failed:fail,failures,notes});fs.writeFileSync(path.join(out,'safari_focus_'+mode+'.json'),JSON.stringify(result,null,2)+'\n');failures.forEach(f=>console.error(f));console.log(`S6 Focus Safari: ${pass} passed, ${fail} failed`);process.exitCode=fail?1:0;
}
if(process.argv.includes('--s6-focus'))runS6Focus().catch(e=>{console.error(e.stack);process.exitCode=2;});

async function runS6Activity() {
 const out=path.join(ROOT,'local-test-artifacts/s6/day5/activity'),mode=PAGE.startsWith('file:')?'file':'http',S='WSDA.infrastructure.state',H=S+'.map',A=S+'.activity';fs.mkdirSync(out,{recursive:true});let d,timer;
 const result={page:PAGE,started:new Date().toISOString(),limitation:'Synthetic FileList; network/CSP unobservable; screenshot blob checked without writing to user Downloads. Real pointer controls.'};
 try {
  d=await launch();result.safari=d.version;await d.size(1366,768);
  const settle=()=>d.waitFor(`${H}.ready&&!${H}.switching&&${H}.map.loaded()&&!${H}.map.isMoving()`,30000);
  const load=async files=>{const old=await d.run(`return ${S}.version;`);await d.run(SET_FILES,'#files-input',files.map(f=>({name:path.basename(f),b64:fs.readFileSync(f).toString('base64')})));await d.waitFor(`${S}.version>${old}&&!${S}.loading`);await settle();};
  const sample=path.join(ROOT,'local-test-artifacts/s6/day2/fixtures/infrastructure_synthetic.zip'),tier=t=>path.join(ROOT,'local-test-artifacts/f1/tiers',t,t==='partner'?'partner_county_totals.csv':'CVI_Consolidated_Master.csv');
  const pick=async(id,values)=>{await d.run(tickRun(`document.getElementById(${JSON.stringify(id)})`),values);await settle();};
  const values=()=>d.run(`return ${S}.activityData.map(r=>[r.county,r.direction,r.lat,r.lon,r.total_animals,r.radius_px]);`);
  async function suite() {
   await d.goto(new URL('infrastructure/index.html',new URL('.',PAGE)).href);await d.waitFor('window.WSDA&&WSDA.infrastructure&&WSDA.infrastructure.state.map.ready');
   await load([sample]);check(await d.run(`return !${A}.on&&document.getElementById('activity-on').disabled&&${S}.result.layers.length===6;`),'activity facility-only gate');
   await load([sample,tier('full')]);check(await d.run(`return !${A}.on&&!document.getElementById('activity-on').disabled&&${A}.scaling==='log'&&${A}.nBins===5&&${A}.opacity===.6&&${A}.palette==='WSDA Default';`),'activity off/defaults');
   await d.click('#activity-fold summary');await d.click('#activity-on');await settle();check(await d.run(`return ${A}.on&&${S}.activityData.length>0;`),'real-pointer activity toggle');
   const baseline=await values(),camera=await d.run(`return CVIWA.map.camera(${H});`),ref=JSON.parse(fs.readFileSync(path.join(ROOT,'local-test-artifacts/s6/day5/activity_reference.json')));
   for(const scaling of ['log','linear','sqrt','quantile','natural']) {
    await d.run(`document.getElementById('activity-scaling').value=args[0];document.getElementById('activity-scaling').dispatchEvent(new Event('change',{bubbles:true}));return true;`,scaling);await settle();
    const expected=arr(ref.cases['full/'+scaling+'/5'].data).map(x=>[x.county,x.direction,x.lat,x.lon,x.total_animals,x.radius_px]),actual=await values();check(actual.length===expected.length&&actual.every((v,i)=>v.every((x,k)=>typeof x==='number'?Math.abs(x-expected[i][k])<1e-7:x===expected[i][k])),'activity full-module radius/anchor '+scaling);
   }
   await d.run(`document.getElementById('activity-scaling').value='log';document.getElementById('activity-scaling').dispatchEvent(new Event('change',{bubbles:true}));return true;`);await settle();
   await pick('facility-counties',['King']);await pick('infrastructure-refine-5-0',['Storage']);check(JSON.stringify(await values())===JSON.stringify(baseline),'facility filters independent of activity');
   await pick('activity-species',['Cattle']);const raw=await d.run("return [...document.getElementById('activity-raw').querySelectorAll('input')].map(o=>o.value);");await pick('activity-raw',[raw[0]]);check(await d.run(`return ${A}.rawSpecies.length===1&&${S}.result.counts.synthetic_support===1;`),'raw species filter independent of facilities');
   await pick('activity-years',[]);check(await d.run(`return ${S}.activityData.length===0&&!document.getElementById('activity-status').hidden;`),'activity zero reason');
   await load([sample,tier('partner')]);check(await d.run(`return ${S}.master&&!${S}.master.hasSpecies&&document.getElementById('activity-raw').disabled&&${S}.result.layers.length===6;`),'reduced master gates raw refine only');
   await d.click('#reset-all');await settle();check(await d.run(`return !${A}.on&&${S}.selectedLayers.length===0&&${S}.counties.length===0&&document.getElementById('activity-fold').open;`),'activity Reset All clears picks and keeps fold');
   check(JSON.stringify(await d.run(`return CVIWA.map.camera(${H});`))===JSON.stringify(camera),'activity reset preserves camera');
   await load([sample,tier('public')]);check(await d.run(`return ${S}.selectedLayers.length===0&&${S}.master.hasSpecies;`),'Public master/replacement selection');
   await load([sample,tier('full')]);await d.run(`${S}.selectedLayers=${S}.prepared.layers.filter(l=>l.usable).map(l=>l.key);${A}.on=true;WSDA.infrastructure.redraw();document.getElementById('style-fold').open=true;return true;`);await settle();
   for(const id of ['bc','id','or']){await d.click('.nr-on[data-region="'+id+'"]');await d.waitFor(`${H}.nr.on.${id}`);check(await d.run(`return CVIWA.map.landColor(${H})==='#ffffff';`),'neighbor context land '+id);await d.click('.nr-counties[data-region="'+id+'"]');check(await d.run(`return ${H}.nr.counties.${id};`),'neighbor counties '+id);}
   const blob=await d.run(`return CVIWA.map.screenshot(${H}).then(b=>({bytes:b.size,credit:${H}.lastAttribution,labels:${H}.lastLabels}));`);check(blob.bytes>0&&blob.credit.includes('Statistics Canada'),'screenshot blob with BC credit');
   await d.run(`${H}.map.jumpTo({center:[-122,47],zoom:9,bearing:5,pitch:20});return true;`);await settle();await d.click('.map-fit');await settle();const opening=await d.run(`return CVIWA.map.camera(${H});`);await d.run(`${H}.map.jumpTo({center:[-122,47],zoom:9});return true;`);await d.click('#fit-wa');await settle();check(JSON.stringify(await d.run(`return CVIWA.map.camera(${H});`))===JSON.stringify(opening),'both opening-WA fits');
   for(const [w,h]of [[1366,768],[1024,600]]){await d.size(w,h);await sleep(150);await d.run("document.getElementById('facility-map').scrollIntoView({block:'center'});return true;");await settle();check(await d.run("const m=document.getElementById('facility-map').getBoundingClientRect(),l=document.getElementById('facility-legend').getBoundingClientRect();return l.x>=m.x&&l.right<=m.right&&l.y>=m.y&&l.bottom<=m.bottom;"),'activity legend containment '+w);fs.writeFileSync(path.join(out,'safari_'+mode+'_'+w+'.png'),Buffer.from(await d.screenshot(),'base64'));}
   await d.click('#reset-all');await settle();check(await d.run(`return !${A}.on&&Object.values(${S}.neighbors).every(n=>!n.on&&!n.counties)&&${S}.selectedLayers.length===0&&document.getElementById('style-fold').open;`),'complete local reset/folds/neighbors');
   await load([sample]);check(await d.run(`return !${S}.master&&document.getElementById('activity-on').disabled&&${S}.selectedLayers.length===0;`),'missing master and no repeated initial selection');
  }
  await Promise.race([suite(),new Promise((_,rej)=>{timer=setTimeout(()=>rej(new Error('S6 activity Safari seven-minute bound')),420000);})]);
 }catch(e){check(false,'complete activity Safari suite',e.stack);}finally{clearTimeout(timer);if(d)await d.close();}
 Object.assign(result,{passed:pass,failed:fail,failures,notes,finished:new Date().toISOString()});fs.writeFileSync(path.join(out,'safari_'+mode+'.json'),JSON.stringify(result,null,2)+'\n');failures.forEach(f=>console.error(f));console.log(`S6 activity Safari: ${pass} passed, ${fail} failed`);process.exitCode=fail?1:0;
}
if(process.argv.includes('--s6-activity'))runS6Activity().catch(e=>{console.error(e.stack);process.exitCode=2;});

// ── S7: charts, previews and the ZIP export ─────────────────────────────────────────────────────────────────────
// node tests/browser/run_safari.js --s7   Over http: start tests/browser/serve_case_strict.js, then
// SAFARI_PAGE_URL=http://127.0.0.1:8765/index.html node tests/browser/run_safari.js --s7
// The CVI page in Safari at 1400 x 1000, with real pointer clicks and real key presses:
//   - charts: the layout switch clicked; in each view the chart models Safari computes equal the ones Node (V8)
//     computes from the same file and choices, and each drawn chart has one mark per value, in the model's colors
//     and with its hover text; a real hover shows the exact value; a real click and Enter add a county to Spotlight
//     Counties, a second click and Space remove it;
//   - the three preview dialogs against CVI's own dialogs in the reference (WA State default and County Focus with
//     two counties, S7 fixture); closed with the real Escape key (also from the Map Data search box), a real click
//     beside the dialog, the × and Close; a click inside keeps it open; keyboard focus returns to the button when the
//     dialog was opened from the keyboard (Safari does not focus a button clicked with the mouse);
//   - Export (WA State default, National Flow inbound, County Focus with four counties): the real click builds the
//     ZIP, and the bytes Safari hands to its download are read back and compared with CVI's files in the reference.
//     The save itself is not made: Safari would write into the user's Downloads folder, outside the WSDA folder (as
//     for the sample download above); a real save is checked by hand.
// Needs the S7 fixture and reference (local-test-artifacts/s7/) and test-tables/ (the F1 unit run).
// Writes local-test-artifacts/s7/safari/safari_s7_<file|http>.json and a few screenshots there.
const S7_DIR = path.join(ROOT, 'local-test-artifacts', 's7');
const S7_FIXTURE = path.join(S7_DIR, 'fixtures', 'cvi_master_s7.csv');
const S7_TIER_FULL = path.join(ROOT, 'test-tables', 'tier_full_master.csv');
const listOf = x => (x === null || x === undefined ? [] : Array.isArray(x) ? x : [x]);
const cvText = v => (v === null || v === undefined ? '' : String(v));
const maskGenerated = text => text.replace(/^Generated: .*$/m, 'Generated: TIME');
// The page's Stats text writes the quarters "Q1, Q2" and adds Unique CVIs, a note when WA-to-WA movements count at
// both ends, and the change from the previous quarter (additions by design); this takes
// them back out, so the rest is compared with CVI's text as before.
function cviStatsForm(lines) {
  const out = [];
  let inNote = false, inChange = false;
  for (const l of lines) {
    if (inChange) { if (l === '') inChange = false; continue; }
    if (l.startsWith('CHANGE FROM THE ')) { inChange = true; continue; }
    if (inNote) { if (l === '') { inNote = false; out.push(l); } continue; }
    if (l.startsWith('  Unique CVIs: ')) { inNote = true; continue; }
    out.push(l.startsWith('  Quarters:  ') ? l.replace(/, /g, '') : l);
  }
  return out;
}
const cviStatsText = text => cviStatsForm(text.split('\n')).join('\n');
// The coordinates line (version 1.1, not in CVI) taken out, as in the Chrome S7 suite.
const maskExported = text => text.replace(/\n  "coordinates": "WGS 84 longitude and latitude \(EPSG:4326\)",/, '')
  .replace(/"exported_at": "[^"]*"/, '"exported_at": "TIME"');
// JSON with every object's keys sorted: Safari's WebDriver returns objects with their keys in another order.
// Page errors and rejected promises, kept in window.__errors for the end of the run (set once per page).
const S7_ERROR_TRAP = `
  window.__errors = window.__errors || [];
  if (!window.__trap) {
    window.__trap = 1;
    addEventListener('error', e => { window.__errors.push(String(e.message)); });
    addEventListener('unhandledrejection', e => { window.__errors.push(String(e.reason)); });
  }
  return true;`;
const s7Canonical = x => JSON.stringify(x, (k, v) => (v && typeof v === 'object' && !Array.isArray(v)
  ? Object.keys(v).sort().reduce((o, key) => { o[key] = v[key]; return o; }, {}) : v));

// The page's chart and export code loaded in Node, apart from Safari: the expected chart models (V8) for the
// choices Safari reports.
function s7NodePage() {
  const vm = require('vm');
  const sandbox = { window: {}, console };
  vm.createContext(sandbox);
  const app = path.join(ROOT, 'site', 'cvi', 'app');
  for (const f of ['csv.js', 'master.js', 'scaling.js', 'palettes.js', 'aggregate.js', 'summary.js', 'flow.js',
    'focus.js', 'charts.js', 'exports.js', 'chartsvg.js']) {
    vm.runInContext(fs.readFileSync(path.join(app, f), 'utf8'), sandbox, { filename: f });
  }
  return sandbox.window.CVIWA;
}
function s7NodeCharts(W, master, snap, forExport) {
  let input;
  if (snap.view === 'wa') input = { rows: W.summary.mapRows(master, snap.filters) || [] };
  else if (snap.view === 'flow') input = { rows: W.flow.mapRows(master, snap.filters) || [] };
  else {
    const built = W.focus.build(master, snap.filters);
    input = { rows: W.focus.summaryRows(master, snap.filters) || [], premises: built.premises, missingCoordinates: built.missingCoordinates };
  }
  return W.charts.chartsFor(snap.view, input, snap.opts, forExport);
}
// The view's choices as the page passes them to its chart code (ui.js chartInput and renderCharts), and the
// charts it drew.
const S7_SNAPSHOT = `var st = CVIWA.state, fl = CVIWA.flowState, fo = CVIWA.focusState, filters;
  if (st.view === 'wa') {
    filters = { species: st.species, years: st.years, quarters: st.quarters, direction: st.direction,
      rawSpecies: st.speciesSub };
  } else if (st.view === 'flow') {
    filters = { direction: fl.direction, species: fl.species, speciesSub: fl.speciesSub, years: fl.years,
      quarters: fl.quarters, combine: fl.combine, scaling: fl.scaling, nBins: fl.nBins, palette: fl.palette,
      multiplier: fl.multiplier, opacity: fl.opacity };
  } else {
    filters = { counties: fo.counties, direction: fo.direction, mode: fo.mode, species: fo.species,
      rawSpecies: fo.speciesSub, years: fo.years, quarters: fo.quarters, scaling: fo.scaling, nBins: fo.nBins };
  }
  var per = st.view === 'wa' ? st : st.view === 'flow' ? fl : fo;
  var opts = { measure: st.chartMeasure, compare: st.chartCompare, years: per.years.map(String), quarters: per.quarters.slice() };
  return JSON.parse(JSON.stringify({ view: st.view, filters: filters, opts: opts,
    drawnOpts: st.charts ? st.charts.opts : null, charts: st.charts ? st.charts.charts : null,
    chartsView: st.charts ? st.charts.view : null }));`;
// Each drawn chart's marks and spotlight buttons, in drawing order.
const S7_DRAWN = `return CVIWA.state.charts.charts.map(function (c) {
    var svg = document.querySelector('#chart-grid .chart-card[data-chart="' + c.id + '"] svg');
    return { id: c.id, label: svg.getAttribute('aria-label'),
      marks: [].map.call(svg.querySelectorAll('.chart-mark'), function (m) {
        return { fill: m.getAttribute('fill'), hover: m.getAttribute('data-hover') }; }),
      spots: [].map.call(svg.querySelectorAll('.chart-spot'), function (s) { return s.getAttribute('data-spot'); }),
      pickHovers: [].map.call(svg.querySelectorAll('.chart-pick'), function (b) { return b.getAttribute('data-hover'); }) };
  });`;
function s7ExpectedMarks(c) {
  if (c.kind === 'bars' || c.kind === 'change') return c.bars.map(b => ({ fill: b.color, hover: b.hover }));
  if (c.kind === 'bars_by_direction') return [].concat(...c.groups.map(g => g.bars.map(b => ({ fill: b.color, hover: b.hover }))));
  if (c.kind === 'bars_by_panel') return [].concat(...c.panels.map(p => p.bars.map(b => ({ fill: b.color, hover: b.hover }))));
  if (c.kind === 'lines') return [].concat(...c.series.map(s => s.values.map((v, i) => ({ fill: s.color, hover: s.hover[i] }))));
  return [];
}
// A stored ZIP's entries (local headers in order), as in the Chrome suite.
function s7ReadZip(buf) {
  const out = [];
  let at = 0;
  while (at + 30 <= buf.length && buf.readUInt32LE(at) === 0x04034b50) {
    const method = buf.readUInt16LE(at + 8), size = buf.readUInt32LE(at + 18);
    const nameLen = buf.readUInt16LE(at + 26), extra = buf.readUInt16LE(at + 28);
    const name = buf.slice(at + 30, at + 30 + nameLen).toString('utf8');
    const start = at + 30 + nameLen + extra;
    out.push({ name, method, data: buf.slice(start, start + size) });
    at = start + size;
  }
  return out;
}
// The page's choices against a reference scenario's inputs (CVI's input names), as in the Chrome suite.
function s7ScenarioMatches(view, f, inp) {
  const sorted = x => listOf(x).map(String).sort();
  const same = (a, b) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
  if (view === 'wa') {
    return same(f.species, inp.county_species) && same(f.years, inp.county_year) && same(f.quarters, inp.county_quarter)
      && same(f.direction, inp.county_direction);
  }
  if (view === 'flow') {
    return same(f.species, inp.flow_species) && same(f.years, inp.flow_year) && same(f.quarters, inp.flow_quarter)
      && f.direction === inp.flow_direction && f.combine === inp.flow_combine_species;
  }
  return JSON.stringify(f.counties) === JSON.stringify(listOf(inp.intra_counties)) && same(f.species, inp.intra_species)
    && same(f.years, inp.intra_year) && same(f.quarters, inp.intra_quarter) && f.direction === inp.intra_filter_dir;
}
const s7PngSize = data => (data.length > 24 && data.readUInt32BE(0) === 0x89504e47
  ? { width: data.readUInt32BE(16), height: data.readUInt32BE(20) } : null);
// The resolution a PNG records: its pHYs chunk right after IHDR, in dots per inch (null when absent or its CRC is wrong).
function s7PngDpi(data) {
  if (data.length < 54 || data.toString('latin1', 37, 41) !== 'pHYs' || data[49] !== 1) return null;
  if (data.readUInt32BE(50) !== zlib.crc32(data.subarray(37, 50))) return null;
  return Math.round(data.readUInt32BE(41) * 0.0254);
}
// Today's date on this computer, worked out here (the page names the ZIP with its own local date).
function s7Today() {
  const d = new Date(), two = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate());
}
// Keeps what the page hands to the browser's download (the ZIP's blob and the link's file name) and stops the
// save, so nothing is written to the Downloads folder. The page's own code runs unchanged up to the link's click.
const S7_CAPTURE = `if (!window.__s7capture) {
    window.__s7capture = true;
    window.__s7downloads = [];
    var lastBlob = null, createUrl = URL.createObjectURL;
    URL.createObjectURL = function (blob) { lastBlob = blob; return createUrl.call(URL, blob); };
    var realClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (!this.download || this.href.indexOf('blob:') !== 0) return realClick.call(this);
      var item = { name: this.download, type: lastBlob ? lastBlob.type : null, b64: null };
      window.__s7downloads.push(item);
      lastBlob.arrayBuffer().then(function (buf) {
        var b = new Uint8Array(buf), s = '';
        for (var i = 0; i < b.length; i += 32768) s += String.fromCharCode.apply(null, b.subarray(i, i + 32768));
        item.b64 = btoa(s);
      });
    };
  }
  return true;`;

async function runS7() {
  const mode = PAGE.startsWith('file:') ? 'file' : 'http';
  const out = path.join(S7_DIR, 'safari');
  fs.mkdirSync(out, { recursive: true });
  for (const f of [S7_FIXTURE, S7_TIER_FULL, path.join(S7_DIR, 'oracle_s7_s7.json')]) {
    if (!fs.existsSync(f)) { console.error('Missing ' + f + ' (the S7 fixture and reference, and the F1 unit run).'); process.exit(2); }
  }
  const oracle = JSON.parse(fs.readFileSync(path.join(S7_DIR, 'oracle_s7_s7.json'), 'utf8'));
  const W = s7NodePage();
  const nodeMaster = file => W.master.load(fs.readFileSync(file, 'utf8'));
  const result = { page: PAGE, started: new Date().toISOString(),
    limitation: 'Synthetic FileList; network/CSP unobservable; the ZIP checked from the bytes handed to the download, not saved to Downloads.' };
  let d, timer;
  try {
    d = await launch();
    result.safari = d.version;
    await d.size(1400, 1000);
    const cviPage = new URL('cvi/index.html', new URL('.', PAGE)).href;
    const openPage = async () => {
      await d.goto(cviPage);
      await d.waitFor('window.CVIWA && CVIWA.chartsvg && CVIWA.state && CVIWA.state.mapHandle && CVIWA.state.mapHandle.ready', 30000, 'CVI page');
      await d.run(S7_ERROR_TRAP);
    };
    const loadMaster = async file => {
      const v = await d.run('return CVIWA.state.version;');
      await d.run(SET_FILES, '#file-input', [{ name: path.basename(file), b64: fs.readFileSync(file).toString('base64') }]);
      await d.waitFor('CVIWA.state.master && !CVIWA.state.loading && CVIWA.state.version > ' + v, 20000, 'master loaded');
      await sleep(500);
    };
    // Waits until the charts have been drawn again after a change made by the caller.
    const chartsAfter = async (v, label) => {
      await d.waitFor('CVIWA.state.chartsVersion > ' + v, 10000, label || 'charts drawn');
      await sleep(400);
    };
    const showView = async view => {
      const v = await d.run('return CVIWA.state.chartsVersion;');
      await d.click('#show-' + view);
      const handle = { wa: 'mapHandle', flow: 'flowHandle', focus: 'focusHandle' }[view];
      await d.waitFor('CVIWA.state.' + handle + ' && CVIWA.state.' + handle + '.ready', 30000, view + ' map');
      await sleep(700);
      return v;
    };
    // County Focus counties ticked in the list (setup, not the behavior under test).
    const pickCounties = async names => {
      await d.run(`var want = args[0];
        [].forEach.call(document.querySelectorAll('#fo-counties input'), function (i) {
          var on = want.indexOf(i.value) >= 0;
          if (i.checked !== on) { i.checked = on; i.dispatchEvent(new Event('change', { bubbles: true })); }
        });
        return true;`, names);
      await sleep(900);
    };
    // Safari's chart models against Node's for the same file and choices; the drawn marks against the models.
    const compareCharts = async (name, file) => {
      const snap = await d.run(S7_SNAPSHOT);
      const want = s7NodeCharts(W, nodeMaster(file), snap, false);
      const same = s7Canonical(snap.charts) === s7Canonical(want);
      check(snap.chartsView === snap.view && s7Canonical(snap.drawnOpts) === s7Canonical(snap.opts) && same, 'S7 ' + name + ': Safari\'s chart models equal Node\'s for the same file and choices',
        same ? snap.view : { safari: s7Canonical(snap.charts).slice(0, 300), node: s7Canonical(want).slice(0, 300) });
      const drawn = await d.run(S7_DRAWN);
      const bad = drawn.filter((g, i) => {
        const c = snap.charts[i], marks = s7ExpectedMarks(c);
        // Since MC a chart's clickable marks are buttons (spotlight or chart filter) that carry the hover text, so
        // its marks need none of their own; each button must have it (as in the Chrome S7 suite).
        const spotted = g.pickHovers.length > 0;
        if (spotted && !g.pickHovers.every(h => h)) return true;
        return !g.label.startsWith(c.title) || g.marks.length !== marks.length
          || !g.marks.every((m, k) => m.fill === marks[k].fill && (spotted || m.hover === marks[k].hover));
      });
      check(drawn.length === snap.charts.length && !bad.length, 'S7 ' + name + ': each chart drawn with one mark per value, its colors and hover text',
        bad.map(b => b.id));
      return snap;
    };

    async function suite() {
      // 1. Charts on the Full tier, WA State: the layout switch, hover, click-to-spotlight with the pointer and keys.
      await openPage();
      await loadMaster(S7_TIER_FULL);
      let v = await d.run('return CVIWA.state.chartsVersion;');
      await d.click('.layout-switch [data-layout="split"]');
      await chartsAfter(v, 'Map + charts');
      const split = await d.run(`var r = function (id) { var e = document.getElementById(id); return e && e.offsetParent ? e.getBoundingClientRect() : null; };
        var a = r('map-area'), p = r('chart-panel');
        return { layout: CVIWA.state.layouts.wa, below: document.getElementById('view-area').classList.contains('below'),
          beside: !!(a && p && p.left >= a.right - 1), cards: document.querySelectorAll('#chart-grid .chart-card svg').length };`);
      check(split.layout === 'split' && !split.below && split.beside && split.cards === 4, 'S7 layout: a click on Map + charts puts the four charts beside the map', split);
      fs.writeFileSync(path.join(out, 'safari_' + mode + '_split.png'), Buffer.from(await d.screenshot(), 'base64'));
      await compareCharts('Full tier, WA State, Map + charts', S7_TIER_FULL);

      const spotState = () => d.run(`return { spotlight: CVIWA.state.spotlight.slice(),
        ticked: [].map.call(document.querySelectorAll('#f-spotlight input:checked'), function (i) { return i.value; }),
        pressed: [].map.call(document.querySelectorAll('#chart-grid .chart-spot[aria-pressed="true"]'), function (s) { return s.getAttribute('data-spot'); }),
        focused: document.activeElement && document.activeElement.getAttribute ? document.activeElement.getAttribute('data-spot') : null };`);
      const spotCenter = value => d.run(`var s = [].find.call(document.querySelectorAll('#chart-grid .chart-card[data-chart="top_places"] .chart-spot'),
          function (x) { return x.getAttribute('data-spot') === args[0]; });
        s.scrollIntoView({ block: 'center' });
        var r = s.querySelector('.chart-hit').getBoundingClientRect();
        return [r.left + r.width * 0.6, r.top + r.height / 2];`, value);
      const counties = await d.run(`return [].map.call(document.querySelectorAll('#chart-grid .chart-card[data-chart="top_places"] .chart-spot'),
        function (s) { return s.getAttribute('data-spot'); });`);
      check(counties.length >= 2, 'S7 spotlight: the top counties are buttons', counties.length);
      const first = counties[0], second = counties[1];
      // Hover with the real pointer: the exact value and what a click does; gone when the pointer leaves.
      let xy = await spotCenter(first);
      await foreground();
      await d.move(xy[0], xy[1]);
      await sleep(250);
      const tip = await d.run(`var t = document.getElementById('chart-tip'); return { shown: !t.hidden, text: t.textContent };`);
      check(tip.shown && tip.text.indexOf(first + ' — ') === 0 && tip.text.indexOf('Click to add ' + first + ' to Spotlight Counties.') > 0,
        'S7 hover: the real pointer shows the exact value and what a click does', tip);
      await d.move(5, 5);
      await sleep(250);
      check(await d.run('return document.getElementById("chart-tip").hidden;'), 'S7 hover: the box goes when the pointer leaves');
      // A real click adds the county, a second removes it.
      await foreground();
      await d.pointer(xy[0], xy[1]);
      await sleep(600);
      let s = await spotState();
      check(JSON.stringify(s.spotlight) === JSON.stringify([first]) && JSON.stringify(s.ticked) === JSON.stringify([first]) && s.pressed.indexOf(first) >= 0,
        'S7 spotlight: a real click on a bar adds the county (list and charts agree)', s);
      xy = await spotCenter(first);
      await foreground();
      await d.pointer(xy[0], xy[1]);
      await sleep(600);
      s = await spotState();
      check(!s.spotlight.length && !s.ticked.length && !s.pressed.length, 'S7 spotlight: a second real click removes it', s);
      // Keyboard: Enter adds, Space removes, the focus stays on the county's bar.
      await d.run(`[].find.call(document.querySelectorAll('#chart-grid .chart-card[data-chart="top_places"] .chart-spot'),
        function (x) { return x.getAttribute('data-spot') === args[0]; }).focus(); return true;`, second);
      await foreground();
      await d.key('');
      await sleep(600);
      s = await spotState();
      check(JSON.stringify(s.spotlight) === JSON.stringify([second]) && s.focused === second, 'S7 spotlight: the real Enter key adds the county and keeps the focus', s);
      await d.key('');
      await sleep(600);
      s = await spotState();
      check(!s.spotlight.length && s.focused === second, 'S7 spotlight: the real Space key removes it', s);
      v = await d.run('return CVIWA.state.chartsVersion;');
      await d.click('.layout-switch [data-layout="charts"]');
      await chartsAfter(v, 'Charts');
      const full = await d.run(`var a = document.getElementById('map-area'), p = document.getElementById('chart-panel');
        return { layout: CVIWA.state.layouts.wa, mapShown: !!a.offsetParent, panelShown: !!p.offsetParent };`);
      check(full.layout === 'charts' && !full.mapShown && full.panelShown, 'S7 layout: a click on Charts hides the map and shows the charts', full);
      await d.click('.layout-switch [data-layout="map"]');
      await sleep(400);
      const mapOnly = await d.run(`return { layout: CVIWA.state.layouts.wa, mapShown: !!document.getElementById('map-area').offsetParent,
        panelShown: !!document.getElementById('chart-panel').offsetParent };`);
      check(mapOnly.layout === 'map' && mapOnly.mapShown && !mapOnly.panelShown, 'S7 layout: a click on Map shows the map alone', mapOnly);

      // 2. Charts on the S7 fixture in each view (Charts layout), and the "Show charts by:" picker.
      await openPage();
      await loadMaster(S7_FIXTURE);
      for (const view of ['wa', 'flow', 'focus']) {
        await showView(view);
        if (view === 'focus') await pickCounties(listOf(oracle.views.focus.two_counties.inputs.intra_counties));
        if (await d.run('return CVIWA.state.layouts[CVIWA.state.view];') !== 'charts') {
          v = await d.run('return CVIWA.state.chartsVersion;');
          await d.click('.layout-switch [data-layout="charts"]');
          await chartsAfter(v, view + ' charts');
        }
        await compareCharts('S7 fixture, ' + view, S7_FIXTURE);
      }
      v = await d.run('return CVIWA.state.chartsVersion;');
      await d.run(`var s = document.getElementById('chart-measure'); s.value = 'records'; s.dispatchEvent(new Event('change', { bubbles: true })); return true;`);
      await chartsAfter(v, 'CVI records');
      const records = await compareCharts('S7 fixture, focus, CVI records', S7_FIXTURE);
      check(records.opts.measure === 'records' && records.charts.some(c => /CVI records/.test(c.title)), 'S7 measure: "Show charts by:" CVI records changes the charts', records.opts);
      await d.run(`var s = document.getElementById('chart-measure'); s.value = 'animals'; s.dispatchEvent(new Event('change', { bubbles: true })); return true;`);
      await sleep(500);

      // 3. The preview dialogs, WA State default and County Focus with two counties, against CVI's own dialogs.
      await openPage();
      await loadMaster(S7_FIXTURE);
      await d.run(`var e = document.getElementById('export-section'); e.open = true; e.scrollIntoView(); return true;`);
      await d.run(S7_CAPTURE);
      const dialog = () => d.run(`var g = document.getElementById('preview-dialog');
        if (!g || !g.open) return { open: false, focused: document.activeElement ? document.activeElement.id : null };
        var t = g.querySelector('.dt-table');
        return { open: true, title: g.querySelector('#preview-title').textContent, note: g.querySelector('#preview-note').textContent,
          columns: t ? [].map.call(t.querySelectorAll('thead tr:first-child th'), function (h) { return h.textContent; }) : null,
          rows: t ? [].map.call(t.querySelectorAll('tbody tr'), function (r) { return [].map.call(r.children, function (c) { return c.textContent; }); }) : null,
          info: t ? g.querySelector('.dt-info').textContent : null,
          text: g.querySelector('.stats-text') ? g.querySelector('.stats-text').textContent : null,
          pictures: [].map.call(g.querySelectorAll('.chart-preview'), function (f) { var i = f.querySelector('img');
            return { caption: f.querySelector('figcaption').textContent, width: i.naturalWidth, height: i.naturalHeight, complete: i.complete }; }) };`);
      // Safari does not focus a button clicked with the mouse (macOS behavior), so focus can return to the button only
      // when the dialog was opened from the keyboard: the button focused, then a real Enter key.
      const closed = async () => {
        await sleep(400);
        return !(await dialog()).open;
      };
      const focusedId = () => d.run('return document.activeElement ? document.activeElement.id : null;');
      const openWithEnter = async id => {
        await d.run('document.getElementById(args[0]).focus(); return true;', id);
        await foreground();
        await d.key('\uE007');
        await d.waitFor('document.getElementById("preview-dialog") && document.getElementById("preview-dialog").open', 30000, id + ' by keyboard');
      };
      const previews = async (name, rec) => {
        // Map Data, opened by a real click: the first page as CVI serves it; a click inside keeps the dialog; the real
        // Escape key closes it.
        await d.click('#preview-table');
        await d.waitFor('document.getElementById("preview-dialog") && document.getElementById("preview-dialog").open', 10000, 'Map Data dialog');
        let g = await dialog();
        const cvi = rec.previews.preview_table;
        const want = cvi.table.rows.map(r => r.map(cvText));
        check(g.title === cvi.modal.title && g.note === cvi.modal.footer && JSON.stringify(g.columns) === JSON.stringify(cvi.table.columns)
          && JSON.stringify(g.rows) === JSON.stringify(want.slice(0, 15)), 'S7 ' + name + ': Map Data title, footer, columns and first page as CVI',
        { title: g.title, rows: g.rows && g.rows.slice(0, 2), cvi: want.slice(0, 2) });
        if (name === 'WA State default') fs.writeFileSync(path.join(out, 'safari_' + mode + '_map_data.png'), Buffer.from(await d.screenshot(), 'base64'));
        const inSearch = await d.run('return document.activeElement === document.querySelector("#preview-dialog .dt-search");');
        await foreground();
        await d.key('\uE00C');
        check(inSearch && await closed(), 'S7 ' + name + ': the real Escape key closes Map Data from its search box', { inSearch });
        // Stats, opened from the keyboard: CVI's text; a real click beside the dialog closes it, focus back on the button.
        await openWithEnter('preview-stats');
        g = await dialog();
        const stats = rec.previews.preview_stats.modal;
        check(g.title === stats.title && g.note === stats.footer && g.text !== null && maskGenerated(cviStatsText(g.text)) === maskGenerated(stats.pre),
          'S7 ' + name + ': Stats title, footer and text as CVI (time masked, the page\'s additions taken out)', g.text && g.text.slice(0, 200));
        await d.click('#preview-title');
        check((await dialog()).open, 'S7 ' + name + ': a real click inside the dialog leaves it open');
        const beside = await d.run(`var r = document.getElementById('preview-dialog').getBoundingClientRect();
          return r.left >= 24 ? [r.left / 2, r.top + r.height / 2] : [r.left + r.width / 2, r.top / 2];`);
        await foreground();
        await d.pointer(beside[0], beside[1]);
        check(await closed() && await focusedId() === 'preview-stats', 'S7 ' + name + ': a real click beside the dialog closes it, focus back on the button',
          { at: beside, focused: await focusedId() });
        // Charts, opened by a real click: the export's PNGs as Safari draws them, at CVI's export sizes; the × closes.
        const snap = await d.run(S7_SNAPSHOT);
        const files = s7NodeCharts(W, nodeMaster(S7_FIXTURE), snap, true)
          .map(c => ({ caption: 'charts/' + W.charts.fileName(c.id, snap.view), size: W.chartsvg.exportSize(c) }));
        await d.click('#preview-charts');
        await d.waitFor(`document.getElementById('preview-dialog').open && document.querySelectorAll('.chart-preview img').length > 0
          && [].every.call(document.querySelectorAll('.chart-preview img'), function (i) { return i.complete && i.naturalWidth > 0; })`, 60000, 'chart pictures');
        g = await dialog();
        check(g.title === 'Charts preview (' + files.length + ')' && g.note === rec.previews.preview_charts.modal.footer
          && g.pictures.length === files.length && g.pictures.every((p, i) => p.caption === files[i].caption
          && p.width === files[i].size.width && p.height === files[i].size.height),
        'S7 ' + name + ': Preview Charts shows the export\'s files in order, each at CVI\'s export size', { got: g.pictures, want: files });
        await d.click('#preview-dialog .preview-x');
        check(await closed(), 'S7 ' + name + ': the × closes the dialog');
        // Map Data from the keyboard, closed with the real Escape key: focus back on the button.
        await openWithEnter('preview-table');
        await foreground();
        await d.key('\uE00C');
        check(await closed() && await focusedId() === 'preview-table', 'S7 ' + name + ': opened with Enter and closed with Escape, focus back on the button',
          { focused: await focusedId() });
        // Map Data by a real click, closed with Close.
        await d.click('#preview-table');
        await d.waitFor('document.getElementById("preview-dialog").open', 10000, 'Map Data dialog again');
        await d.click('#preview-close');
        check(await closed(), 'S7 ' + name + ': Close closes the dialog');
      };
      await previews('WA State default', oracle.views.wa.default);
      await showView('focus');
      await pickCounties(listOf(oracle.views.focus.two_counties.inputs.intra_counties));
      await d.run(`document.getElementById('export-section').scrollIntoView(); return true;`);
      await previews('County Focus two counties', oracle.views.focus.two_counties);

      // 4. Export: a real click on Export in three scenarios; the ZIP's bytes against CVI's files.
      // Every S7 format; S9's Branded map is left off, so the ZIP stays CVI's.
      await d.run(`document.querySelectorAll('input[name=export-format]').forEach(function (i) { i.checked = ['csv', 'summary_csv', 'charts'].indexOf(i.value) >= 0; }); return true;`);
      const today = s7Today();
      for (const [view, scen] of [['wa', 'default'], ['flow', 'inbound'], ['focus', 'four_counties']]) {
        const rec = oracle.views[view][scen], name = 'S7 export ' + view + ' ' + scen;
        await showView(view);
        if (view === 'focus') await pickCounties(listOf(rec.inputs.intra_counties));
        if (view === 'flow') {
          // Flow opens with Combine species on (CVI's default); the reference's scenario says whether it is on.
          await d.run(`var c = document.getElementById('fl-combine');
            if (c.checked !== args[0]) { c.checked = args[0]; c.dispatchEvent(new Event('change', { bubbles: true })); }
            return true;`, rec.inputs.flow_combine_species === true);
          await sleep(700);
        }
        const choices = await d.run(S7_SNAPSHOT);
        check(s7ScenarioMatches(view, choices.filters, rec.inputs), name + ': page choices match the reference scenario', choices.filters);
        await d.run(`document.getElementById('export-section').scrollIntoView(); return true;`);
        const n = await d.run('return window.__s7downloads.length;');
        await d.click('#run-export');
        await d.waitFor('!CVIWA.state.exporting && window.__s7downloads.length > ' + n + ' && window.__s7downloads[' + n + '].b64', 60000, 'export');
        const got = await d.run('return window.__s7downloads[' + n + '];');
        const counties = listOf(rec.inputs.intra_counties);
        let folder = today + rec.export.folder.slice(10);
        if (view === 'focus' && counties.length > 3) {
          folder = folder.replace('_CountyFocus_' + counties.map(c => c.replace(/[^A-Za-z0-9]/g, '')).join('-') + '_',
            '_CountyFocus_' + counties.length + 'Counties_');
        }
        check(got.name === folder + '.zip' && got.type === 'application/zip', name + ': the ZIP handed to Safari\'s download is named ' + folder + '.zip', { name: got.name, type: got.type });
        const entries = s7ReadZip(Buffer.from(got.b64, 'base64'));
        const file = f => entries.find(e => e.name === folder + '/' + f);
        check(entries.length > 0 && entries.every(e => e.method === 0 && e.name.startsWith(folder + '/')) && entries[0].name === folder + '/',
          name + ': every entry stored inside the folder', entries.map(e => e.name));
        check(!!file('filtered_rows.csv') && file('filtered_rows.csv').data.toString('utf8') === rec.approved.filtered_rows_csv
          && !!file('summary_table.csv') && file('summary_table.csv').data.toString('utf8') === rec.approved.summary_table_csv,
        name + ': filtered_rows.csv and summary_table.csv byte for byte as CVI writes these rows');
        const params = file('export_params.json') ? file('export_params.json').data.toString('utf8') : '';
        check(maskExported(params) === maskExported(rec.export.export_params_json), name + ': export_params.json as CVI\'s (time masked)', params.slice(0, 200));
        const snap = await d.run(S7_SNAPSHOT);
        const want = s7NodeCharts(W, nodeMaster(S7_FIXTURE), snap, true)
          .map(c => ({ name: 'charts/' + W.charts.fileName(c.id, view), size: W.chartsvg.exportSize(c) }));
        const charts = entries.filter(e => e.name.startsWith(folder + '/charts/') && !e.name.endsWith('/'));
        check(charts.length === want.length && charts.every((e, i) => e.name === folder + '/' + want[i].name
          && JSON.stringify(s7PngSize(e.data)) === JSON.stringify(want[i].size)), name + ': the chart PNGs Safari drew, in order, at CVI\'s export sizes',
        charts.map(e => [e.name.slice(folder.length + 1), s7PngSize(e.data)]));
        check(charts.length > 0 && charts.every(e => s7PngDpi(e.data) === 150), name + ': each chart PNG records 150 dpi, as CVI\'s',
          charts.map(e => s7PngDpi(e.data)));
        const message = await d.run('return document.getElementById("export-result").firstChild.textContent;');
        check(message === 'Exported ' + folder + '.zip: handed to your browser to save, usually your Downloads folder.'
          + ' If no file appears, your browser or IT policy blocked the download.', name + ': the message says where the file went', message);
      }
      const errors = await d.run('var e = window.__errors || []; window.__errors = []; return e;');
      check(!errors.length, 'S7: no page errors (window.onerror and unhandled rejections)', errors);
    }
    await Promise.race([suite(), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('S7 Safari eight-minute limit')), 480000);
    })]);
  } catch (e) {
    check(false, 'S7 Safari suite stopped', e && e.stack);
    try { fs.writeFileSync(path.join(out, 'safari_' + mode + '_failed.png'), Buffer.from(await d.screenshot(), 'base64')); } catch (e2) { /* window may be gone */ }
  } finally {
    clearTimeout(timer);
    if (d) await d.close();
  }
  Object.assign(result, { passed: pass, failed: fail, failures, notes, finished: new Date().toISOString() });
  fs.writeFileSync(path.join(out, 'safari_s7_' + mode + '.json'), JSON.stringify(result, null, 2) + '\n');
  failures.forEach(f => console.error('  FAIL ' + f));
  notes.forEach(n => console.log('  note ' + n));
  console.log('S7 Safari ' + (result.safari || '') + ' (' + mode + '): ' + pass + ' passed, ' + fail + ' failed');
  process.exitCode = fail ? 1 : 0;
}
if (process.argv.includes('--s7')) runS7().catch(e => { console.error(e.stack); process.exitCode = 2; });

// ── MC: chart filters, exports with them, the movement view ────────────────────────────────────────────────────
// node tests/browser/run_safari.js --mc   Over http: start tests/browser/serve_case_strict.js, then
// SAFARI_PAGE_URL=http://127.0.0.1:8765/index.html node tests/browser/run_safari.js --mc
// The CVI page in Safari at 1400 x 1000, with real pointer clicks and real key presses:
//   - chart filters (Full tier, WA State, Map + charts): a real click on the species chart's Cattle bar sets the
//     filter (its chip shown), and the map's circles Safari draws equal Node's for Cattle picked in the sidebar; the
//     real Enter key on a period point adds a period filter, the real Space key removes it; a real click on a chip's
//     × removes the species filter;
//   - Export with the species filter on: the real click builds the ZIP; its filtered_rows.csv and summary_table.csv
//     equal Node's for the sidebar pick, export_params.json names the filter; Preview Stats (real click) names it
//     and closes with the real Escape key;
//   - the movement view (movement fixture): a real click on its switch; Top 10; the lines, widths, colors and
//     arrowheads Safari computes equal Node's; in the screenshot, the busiest line's arrowhead drawn in its color at
//     the line's end; the switch's label as large as "Show county labels"; the county names 12.5 px semibold with a
//     halo while it is on; "Show charts by: CVI records" ranks the lines as Node's; a real click on Reset
//     All turns it off.
// The ZIP is read from the bytes handed to Safari's download, which is stopped (S7_CAPTURE): nothing is saved.
// Writes local-test-artifacts/mc/safari/safari_mc_<file|http>.json and a screenshot there.
const MC_DIR = path.join(ROOT, 'local-test-artifacts', 'mc');
const MC_TIER_FULL = path.join(ROOT, 'test-tables', 'tier_full_master.csv');
const MC_MOVEMENT = path.join(ROOT, 'test-tables', 'cvi_master_movement.csv');
// The page's code loaded in Node (V8), apart from Safari, for the expected values.
function mcNodePage() {
  const vm = require('vm');
  const sandbox = { window: {}, console };
  vm.createContext(sandbox);
  const app = path.join(ROOT, 'site', 'cvi', 'app');
  for (const f of ['csv.js', 'master.js', 'scaling.js', 'palettes.js', 'aggregate.js', 'summary.js', 'flow.js',
    'focus.js', 'charts.js', 'movement.js', 'crossfilter.js', 'exports.js']) {
    vm.runInContext(fs.readFileSync(path.join(app, f), 'utf8'), sandbox, { filename: f });
  }
  return sandbox.window.CVIWA;
}
// The first place where a and b differ (a path such as "[3].radius_px"), or null when they agree. Numbers may differ
// by a relative 1e-9: Safari's and V8's Math.log1p and Math.atan2 can differ in the last bit (as the S1 checks allow).
function mcDiff(a, b, at) {
  at = at || '';
  if (typeof a === 'number' && typeof b === 'number') {
    return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b)) ? null : at + ': ' + a + ' vs ' + b;
  }
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return a === b ? null : at + ': ' + JSON.stringify(a) + ' vs ' + JSON.stringify(b);
  const keys = Array.isArray(a) ? (a.length === b.length ? a.map((x, i) => i) : null) : Object.keys(a).sort();
  if (!keys || (!Array.isArray(a) && JSON.stringify(keys) !== JSON.stringify(Object.keys(b).sort()))) return at + ': different shape';
  for (const k of keys) {
    const d = mcDiff(a[k], b[k], at + (Array.isArray(a) ? '[' + k + ']' : '.' + k));
    if (d) return d;
  }
  return null;
}
// The WA State map's sidebar choices as the page holds them.
const MC_SIDEBAR = `var st = CVIWA.state;
  return { species: st.species, years: st.years, quarters: st.quarters, direction: st.direction,
    rawSpecies: st.speciesSub, mode: st.mode, scaling: st.scaling, nBins: st.nBins, measure: st.chartMeasure };`;
const MC_CHIPS = `return [].map.call(document.querySelectorAll('#chart-filters .cf-chip'), function (c) {
  return c.firstChild.textContent; });`;
// The busiest line's arrowhead in the map's screenshot (county names turned off for it by the caller): points inside
// the arrowhead beside the line, and on its axis, in the line's color over the land.
const MC_ARROW_PIXELS = `var h = CVIWA.state.mapHandle, m = h.map, v = h.mcView, l = v.lines[v.lines.length - 1];
  var blob = await CVIWA.map.screenshot(h);
  var img = await createImageBitmap(blob), cv = document.createElement('canvas');
  cv.width = img.width; cv.height = img.height;
  var g = cv.getContext('2d'); g.drawImage(img, 0, 0);
  var k = img.width / m.getCanvas().clientWidth, base = m.project(l.head.at), rad = l.head.bearing * Math.PI / 180;
  var fwd = { x: Math.sin(rad), y: -Math.cos(rad) }, side = { x: -fwd.y, y: fwd.x }, half = l.arrow_px * 13.8 / 22.8;
  var at = function (f, s) {
    var x = Math.round((base.x + fwd.x * f + side.x * s) * k), y = Math.round((base.y + fwd.y * f + side.y * s) * k);
    return Array.from(g.getImageData(x, y, 1, 1).data.slice(0, 3));
  };
  var want = [1, 3, 5].map(function (i) { return 0.9 * parseInt(l.color.substr(i, 2), 16) + 0.1 * 0xec; });
  var pts = [at(0.15 * l.arrow_px, 0.6 * half), at(0.15 * l.arrow_px, -0.6 * half), at(0.5 * l.arrow_px, 0)];
  return { ok: pts.every(function (q) { return q.every(function (x, i) { return Math.abs(x - want[i]) < 30; }); }), pts: pts, want: want };`;
async function runMC() {
  const mode = PAGE.startsWith('file:') ? 'file' : 'http';
  const out = path.join(MC_DIR, 'safari');
  fs.mkdirSync(out, { recursive: true });
  for (const f of [MC_TIER_FULL, MC_MOVEMENT]) {
    if (!fs.existsSync(f)) { console.error('Missing ' + f + ' (the F1 unit run writes test-tables/).'); process.exit(2); }
  }
  const W = mcNodePage();
  const nodeMaster = file => W.master.load(fs.readFileSync(file, 'utf8'));
  const result = { page: PAGE, started: new Date().toISOString(),
    limitation: 'Synthetic FileList; network/CSP unobservable; the ZIP checked from the bytes handed to the download, not saved.' };
  let d, timer;
  try {
    d = await launch();
    result.safari = d.version;
    await d.size(1400, 1000);
    const cviPage = new URL('cvi/index.html', new URL('.', PAGE)).href;
    const loadMaster = async file => {
      const v = await d.run('return CVIWA.state.version;');
      await d.run(SET_FILES, '#file-input', [{ name: path.basename(file), b64: fs.readFileSync(file).toString('base64') }]);
      await d.waitFor('CVIWA.state.master && !CVIWA.state.loading && CVIWA.state.version > ' + v, 20000, 'master loaded');
      await sleep(800);
    };
    const pickSelector = (chart, kind, value) => '#chart-grid .chart-card[data-chart="' + chart + '"] .chart-pick[data-pick="'
      + kind + '|' + encodeURIComponent(value) + '"]';

    async function suite() {
      await d.goto(cviPage);
      await d.waitFor('window.CVIWA && CVIWA.crossfilter && CVIWA.state && CVIWA.state.mapHandle && CVIWA.state.mapHandle.ready', 30000, 'CVI page');
      await d.run(S7_ERROR_TRAP);
      await d.run(S7_CAPTURE);
      await loadMaster(MC_TIER_FULL);
      await d.click('.layout-switch [data-layout="split"]');
      await sleep(800);

      // 1. A species filter by a real click; the map as Node draws the sidebar pick.
      await d.click(pickSelector('species', 'species', 'Cattle'));
      await sleep(900);
      check(JSON.stringify(await d.run(MC_CHIPS)) === JSON.stringify(['Species group: Cattle']), 'MC Safari: a real click on the Cattle bar sets the species filter');
      const side = await d.run(MC_SIDEBAR);
      const master = nodeMaster(MC_TIER_FULL);
      const pick = Object.assign({}, side, { species: ['Cattle'], hasSpecies: master.hasSpecies });
      const wantCircles = W.aggregate.build(master.rows, pick);
      const gotCircles = await d.run('return CVIWA.state.data;');
      const circlesDiff = mcDiff(gotCircles, wantCircles);
      check(!circlesDiff, 'MC Safari: the map\'s circles equal Node\'s for Cattle picked in the sidebar', circlesDiff);

      // 2. Export with the filter on: the files as Node's for the sidebar pick, export_params.json naming the filter.
      await d.run(`document.querySelectorAll('input[name=export-format]').forEach(function (i) {
        i.checked = i.value === 'csv' || i.value === 'summary_csv'; }); document.getElementById('export-section').open = true;
        document.getElementById('export-section').scrollIntoView(); return true;`);
      const n = await d.run('return window.__s7downloads.length;');
      await d.click('#run-export');
      await d.waitFor('!CVIWA.state.exporting && window.__s7downloads.length > ' + n + ' && window.__s7downloads[' + n + '].b64', 60000, 'export');
      const got = await d.run('return window.__s7downloads[' + n + '];');
      const entries = s7ReadZip(Buffer.from(got.b64, 'base64'));
      const file = f => entries.find(e => e.name.endsWith('/' + f));
      const rows = W.summary.mapRows(master, pick) || [];
      check(!!file('filtered_rows.csv') && file('filtered_rows.csv').data.toString('utf8') === W.exports.filteredRowsCsv(master, rows).text
        && !!file('summary_table.csv') && file('summary_table.csv').data.toString('utf8') === W.exports.summaryTableCsv('wa', wantCircles),
      'MC Safari: export with the species filter: filtered_rows.csv and summary_table.csv as Node\'s for the sidebar pick', got.name);
      const params = file('export_params.json') ? file('export_params.json').data.toString('utf8') : '';
      check(params.indexOf('  "chart_filters": "Species group: Cattle",\n') > 0, 'MC Safari: export_params.json names the chart filter', params.slice(0, 300));
      await d.click('#preview-stats');
      await d.waitFor('CVIWA.previews.isOpen()', 10000, 'stats dialog');
      const stats = await d.run(`return document.querySelector('#preview-dialog .stats-text').textContent;`);
      await foreground();
      await d.key('');
      await sleep(500);
      check(/\n  Direction: [^\n]*\n  Chart filters: Species group: Cattle\n/.test(stats) && !(await d.run('return CVIWA.previews.isOpen();')),
        'MC Safari: Preview Stats names the chart filter; the real Escape key closes it', stats.slice(0, 400));
      await d.run(`document.getElementById('chart-grid').scrollIntoView(); return true;`);

      // 3. The real Enter and Space keys on a period point; the chip's × by a real click.
      const period = await d.run(`var b = document.querySelectorAll('#chart-grid .chart-card[data-chart="over_time"] .chart-pick')[1];
        b.focus(); var k = b.getAttribute('data-pick'); return decodeURIComponent(k.slice(k.indexOf('|') + 1));`);
      await foreground();
      await d.key('');
      await sleep(800);
      check(JSON.stringify(await d.run(MC_CHIPS)) === JSON.stringify(['Species group: Cattle', 'Period: ' + period]),
        'MC Safari: the real Enter key on a period point adds the period filter', period);
      await d.run(`var b = document.querySelector(args[0]); if (b) b.focus(); return !!b;`, pickSelector('over_time', 'period', period));
      await d.key('');
      await sleep(800);
      check(JSON.stringify(await d.run(MC_CHIPS)) === JSON.stringify(['Species group: Cattle']), 'MC Safari: the real Space key removes it');
      await d.click('#chart-filters .cf-x[data-kind="species"]');
      await sleep(800);
      check(JSON.stringify(await d.run(MC_CHIPS)) === '[]', 'MC Safari: a real click on the chip\'s × removes the species filter');

      // 4. The movement view on the movement fixture.
      await loadMaster(MC_MOVEMENT);
      await d.click('#mv-on');
      await sleep(1200);
      const view = await d.run(`var v = CVIWA.state.mapHandle.mcView, st = CVIWA.state;
        return { cap: st.movementCap, select: document.getElementById('mv-cap').value, lines: v.lines.map(function (l) {
          return { key: l.key, on: l.on, badge: l.badge, w: l.width_px, c: l.color, a: l.arrow_px, b: l.head.bearing }; }) };`);
      const mvSide = await d.run(MC_SIDEBAR);
      const mvMaster = nodeMaster(MC_MOVEMENT);
      const r = W.movement.rows(mvMaster, { species: mvSide.species, years: mvSide.years, quarters: mvSide.quarters, rawSpecies: mvSide.rawSpecies });
      const chart = W.charts.build('corridors', { rows: W.movement.betweenRows(r.counted) }, { view: 'wa', measure: mvSide.measure });
      const badges = chart.empty ? [] : chart.bars.slice(0, 3).map(b => W.movement.pairKey(...b.label.split('  →  ')));
      const want = W.movement.mapView(W.movement.pairs(r.counted), W.movement.points(r.counted), { cap: 10, measure: mvSide.measure, scaling: mvSide.scaling,
        nBins: mvSide.nBins, badges, bySpecies: W.movement.pairs(r.counted, { bySpecies: true }) }).lines
        .map(l => ({ key: l.key, on: l.on, badge: l.badge, w: l.width_px, c: l.color, a: l.arrow_px, b: l.head.bearing }));
      check(view.cap === 10 && view.select === '10', 'MC Safari: movement view on by a real click, Top 10', view.cap);
      const linesDiff = mcDiff(view.lines, want);
      check(!linesDiff, 'MC Safari: the lines, widths, colors and arrowheads equal Node\'s', linesDiff);
      await d.run(`var c = document.getElementById('s-labels'); c.checked = false; c.dispatchEvent(new Event('change', { bubbles: true })); return true;`);
      await sleep(600);
      const arrow = await d.run(MC_ARROW_PIXELS);
      await d.run(`var c = document.getElementById('s-labels'); c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); return true;`);
      check(arrow.ok, 'MC Safari: the screenshot draws the busiest line\'s arrowhead in its color at the line\'s end', arrow);
      const sizes = await d.run(`var f = function (e) { return getComputedStyle(e.closest('label')).fontSize; };
        return { mv: f(document.getElementById('mv-on')), labels: f(document.getElementById('s-labels')) };`);
      check(sizes.mv === sizes.labels, 'MC Safari: the movement switch\'s label as large as "Show county labels"', sizes);
      const names = await d.run(`var e = Array.prototype.find.call(document.querySelectorAll('#map .county-label'), function (x) {
          return !x.classList.contains('hidden') && !x.classList.contains('region-name') && !x.classList.contains('neighbor-county'); });
        var cs = getComputedStyle(e); return { size: cs.fontSize, weight: cs.fontWeight, halo: cs.textShadow };`);
      check(names.size === '12.5px' && names.weight === '600' && /3px/.test(names.halo),
        'MC Safari: county names 12.5 px semibold with a 3 px halo while the movement view is on', names);
      // "Show charts by: CVI records" ranks the lines (Node's ranking for the same rows).
      await d.run(`var c = document.getElementById('chart-measure'); c.value = 'records'; c.dispatchEvent(new Event('change', { bubbles: true })); return true;`);
      await sleep(1200);
      const byRecords = await d.run(`return CVIWA.state.mapHandle.mcView.lines.map(function (l) { return { key: l.key, rank: l.rank, w: l.width_px, c: l.color }; });`);
      const recordsChart = W.charts.build('corridors', { rows: W.movement.betweenRows(r.counted) }, { view: 'wa', measure: 'records' });
      const wantRecords = W.movement.mapView(W.movement.pairs(r.counted), W.movement.points(r.counted), { cap: 10, measure: 'records',
        badges: recordsChart.bars.slice(0, 3).map(b => W.movement.pairKey(...b.label.split('  →  '))) }).lines
        .map(l => ({ key: l.key, rank: l.rank, w: l.width_px, c: l.color }));
      const recordsDiff = mcDiff(byRecords, wantRecords);
      check(!recordsDiff && byRecords.length === 10, 'MC Safari: "Show charts by: CVI records" ranks the lines as Node\'s', recordsDiff);
      await d.run(`var c = document.getElementById('chart-measure'); c.value = 'animals'; c.dispatchEvent(new Event('change', { bubbles: true })); return true;`);
      await sleep(1200);
      fs.writeFileSync(path.join(out, 'safari_mc_' + mode + '_movement.png'), Buffer.from(await d.screenshot(), 'base64'));
      await d.run(`document.getElementById('mv-cap').value = '50'; document.getElementById('mv-cap').dispatchEvent(new Event('change', { bubbles: true })); return true;`);
      await sleep(500);
      await d.click('#reset-all');
      await sleep(1200);
      const after = await d.run(`return { on: CVIWA.state.movementOn, checked: document.getElementById('mv-on').checked, cap: CVIWA.state.movementCap };`);
      check(!after.on && !after.checked && after.cap === 10, 'MC Safari: a real click on Reset All turns the view off, Top 10 again', after);

      const errors = await d.run('var e = window.__errors || []; window.__errors = []; return e;');
      check(!errors.length, 'MC Safari: no page errors (window.onerror and unhandled rejections)', errors);
    }
    await Promise.race([suite(), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('MC Safari eight-minute limit')), 480000);
    })]);
  } catch (e) {
    check(false, 'MC Safari suite stopped', e && e.stack);
    try { fs.writeFileSync(path.join(out, 'safari_mc_' + mode + '_failed.png'), Buffer.from(await d.screenshot(), 'base64')); } catch (e2) { /* window may be gone */ }
  } finally {
    clearTimeout(timer);
    if (d) await d.close();
  }
  Object.assign(result, { passed: pass, failed: fail, failures, notes, finished: new Date().toISOString() });
  fs.writeFileSync(path.join(out, 'safari_mc_' + mode + '.json'), JSON.stringify(result, null, 2) + '\n');
  failures.forEach(f => console.error('  FAIL ' + f));
  notes.forEach(n => console.log('  note ' + n));
  console.log('MC Safari ' + (result.safari || '') + ' (' + mode + '): ' + pass + ' passed, ' + fail + ' failed');
  process.exitCode = fail ? 1 : 0;
}
if (process.argv.includes('--mc')) runMC().catch(e => { console.error(e.stack); process.exitCode = 2; });

// ── S9: branded PNGs and the time-series GIF ───────────────────────────────────────────────────────────────────
// node tests/browser/run_safari.js --s9   Over http: start tests/browser/serve_case_strict.js, then
// SAFARI_PAGE_URL=http://127.0.0.1:8765/index.html node tests/browser/run_safari.js --s9
// In Safari at 1400 x 1000, with real pointer clicks, the Full tier (test-tables/tier_full_master.csv):
//   - the branded page each view draws for the R reference's "default" scenario, computed by Safari: its SVG equal
//     to Node's (V8) from the same code, numbers within 0.011 (they are written to 2 decimals);
//   - Preview Map (a real click) on WA State, National Flow and County Focus at Standard and High resolution: the PNG
//     at 2200 x 1700 and 3300 x 2550 with its dpi recorded, the header's Dark Teal and the land's gray in the
//     picture (Safari must draw the pages into a canvas at 300 dpi);
//   - Export on National Flow with "Branded map (.png)" and "Time-series GIF (.gif)" (a real click): the ZIP holds
//     both under CVI's names; the GIF read block by block here (GIF89a, 1650 x 1275, loop forever, one frame per
//     quarter, 0.8 s and the last 2.4 s); Safari's own decoder opens it, and its first frame matches the page drawn
//     by the PNG step; "GIF frame i of n: label" shown for each frame;
//   - the Infrastructure dashboard with the statewide synthetic facility layers: Preview (a real click), Branded at
//     2200 x 1700, Report High at 1950 x 990.
// The ZIP is read from the bytes handed to Safari's download, which is stopped (S7_CAPTURE): nothing is saved.
// Writes local-test-artifacts/s9/safari/safari_s9_<file|http>.json.
const S9_DIR = path.join(ROOT, 'local-test-artifacts', 's9');
// The page's branded code loaded in Node (V8), apart from Safari.
function s9NodePage() {
  const vm = require('vm');
  const sandbox = { window: {}, console, TextEncoder, TextDecoder };
  vm.createContext(sandbox);
  const app = path.join(ROOT, 'site', 'cvi', 'app');
  for (const f of ['csv.js', 'master.js', 'scaling.js', 'palettes.js', 'aggregate.js', 'periods.js', 'summary.js',
    'flow.js', 'focus.js', 'chartsvg.js']) {
    vm.runInContext(fs.readFileSync(path.join(app, f), 'utf8'), sandbox, { filename: f });
  }
  for (const f of ['zip.js', 'brand.js', 'branded.js', 'tiles.js', 'labels.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'site', 'shared', f), 'utf8'), sandbox, { filename: f });
  }
  vm.runInContext(fs.readFileSync(path.join(app, 'brandedmaps.js'), 'utf8'), sandbox, { filename: 'brandedmaps.js' });
  for (const f of ['wa-counties.js', 'us-states.js', 'state-centers.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'site', 'geo', f), 'utf8'), sandbox);
  }
  return sandbox.window;
}
// The branded page of a reference scenario, built by the page's code in whichever engine runs it (Safari or Node):
// returns the SVG markup. The body runs with `window` (the page's globals) and args[0] = { view, inputs }.
const S9_PAGE_SVG = `var w = window, W = w.CVIWA, B = w.WSDA.branded, m = args[0].master || W.state.master;
  var view = args[0].view, inp = args[0].inputs, list = function (x) { return x === null || x === undefined ? [] : Array.isArray(x) ? x : [x]; };
  var date = new Date(2026, 9, 12), built;
  if (view === 'wa') {
    var f = { species: list(inp.county_species), years: list(inp.county_year).map(Number), quarters: list(inp.county_quarter),
      direction: list(inp.county_direction), rawSpecies: list(inp.county_species_sub), mode: inp.county_mode,
      scaling: inp.county_scaling, nBins: Number(inp.county_n_bins) };
    var rows = W.aggregate.build(m.rows, Object.assign({}, f, { hasSpecies: m.hasSpecies }));
    built = W.brandedmaps.wa({ rows: rows, f: f, universe: m.speciesChoices, palette: inp.county_palette,
      opacity: inp.county_opacity, title: inp.export_title, date: date, counties: w.CVIWA_GEO.counties.features });
  } else if (view === 'flow') {
    var g = { direction: inp.flow_direction, species: list(inp.flow_species), speciesSub: list(inp.flow_species_sub),
      years: list(inp.flow_year).map(Number), quarters: list(inp.flow_quarter), combine: !!inp.flow_combine_species,
      scaling: inp.flow_scaling, nBins: Number(inp.flow_n_bins), palette: inp.flow_palette,
      multiplier: inp.flow_width_mult, opacity: inp.flow_opacity, lines: !!inp.flow_show_state_lines };
    built = W.brandedmaps.flow({ lines: W.flow.lines(m, g, W.flow.centers(w.WSDA_STATE_CENTERS)), f: g,
      universe: m.speciesChoices, title: inp.export_title, date: date, states: w.WSDA_US_STATES.states.features });
  } else {
    var h = { counties: list(inp.intra_counties), species: list(inp.intra_species), rawSpecies: list(inp.intra_species_sub),
      years: list(inp.intra_year).map(Number), quarters: list(inp.intra_quarter), direction: inp.intra_filter_dir,
      mode: inp.intra_mode, scaling: inp.intra_scaling, nBins: Number(inp.intra_n_bins), opacity: inp.intra_opacity,
      hideCircles: !!inp.hide_cvi_circles };
    built = W.brandedmaps.focus({ premises: W.focus.build(m, h).premises, f: h, universe: m.speciesChoices,
      title: inp.export_title, date: date, counties: w.CVIWA_GEO.counties.features, background: 'standard' });
  }
  return B.svg(built.parts);`;
// Two SVG texts alike: the same text around the numbers, and each number within 0.011. Returns null or the first
// difference.
function s9SvgDiff(a, b) {
  const NUM = /-?\d+(?:\.\d+)?/g;
  const skelA = a.replace(NUM, '#');
  const skelB = b.replace(NUM, '#');
  if (skelA !== skelB) {
    let i = 0;
    while (i < skelA.length && skelA[i] === skelB[i]) i++;
    return 'text differs near: ' + skelA.slice(Math.max(0, i - 60), i + 60);
  }
  const na = a.match(NUM) || [];
  const nb = b.match(NUM) || [];
  for (let i = 0; i < na.length; i++) {
    if (Math.abs(Number(na[i]) - Number(nb[i])) > 0.011) return 'number ' + i + ': ' + na[i] + ' vs ' + nb[i];
  }
  return null;
}
// A GIF89a file's blocks: the screen, the loop count, and per image its size and delay (no pixels decoded here;
// Safari decodes the file itself).
function s9GifBlocks(buf) {
  let p = 13;
  const out = { signature: buf.toString('latin1', 0, 6), width: buf.readUInt16LE(6), height: buf.readUInt16LE(8),
    loop: null, frames: [] };
  if (buf[10] & 0x80) p += 3 * (1 << ((buf[10] & 7) + 1));
  const skip = () => { while (buf[p]) p += buf[p] + 1; p++; };
  let delay = null;
  while (p < buf.length) {
    const b = buf[p++];
    if (b === 0x3b) { out.trailer = p === buf.length; break; }
    if (b === 0x21) {
      const label = buf[p++];
      if (label === 0xf9) { delay = buf.readUInt16LE(p + 2); p += 6; }
      else if (label === 0xff) {
        const id = buf.toString('latin1', p + 1, p + 12);
        p += 12;
        if (id === 'NETSCAPE2.0' && buf[p] === 3 && buf[p + 1] === 1) out.loop = buf.readUInt16LE(p + 2);
        skip();
      } else skip();
      continue;
    }
    if (b !== 0x2c) { out.error = 'unexpected block at ' + (p - 1); break; }
    const fr = { width: buf.readUInt16LE(p + 4), height: buf.readUInt16LE(p + 6), delay };
    const pk = buf[p + 8];
    p += 9;
    if (pk & 0x80) p += 3 * (1 << ((pk & 7) + 1));
    p++;
    skip();
    out.frames.push(fr);
    delay = null;
  }
  return out;
}
// Probes of a PNG blob drawn into a canvas in Safari: its size and the share of the header and the map in a color.
const S9_PNG_PROBE = `var blob = args[0] === 'map' ? CVIWA.state.lastPreviewMap[0].blob : WSDA.infrastructure.state.lastPreview.blob;
  var buf = new Uint8Array(await blob.arrayBuffer());
  var dv = new DataView(buf.buffer);
  var phys = String.fromCharCode(buf[37], buf[38], buf[39], buf[40]) === 'pHYs' ? dv.getUint32(41) : null;
  var img = await createImageBitmap(blob), cv = document.createElement('canvas');
  cv.width = img.width; cv.height = img.height;
  var g = cv.getContext('2d'); g.drawImage(img, 0, 0);
  var share = function (x, y, w, h, hex, tol) {
    var d = g.getImageData(Math.round(x * img.width), Math.round(y * img.height), Math.round(w * img.width), Math.round(h * img.height)).data;
    var c = [1, 3, 5].map(function (i) { return parseInt(hex.substr(i, 2), 16); }), n = 0;
    for (var i = 0; i < d.length; i += 4) if (Math.abs(d[i] - c[0]) <= tol && Math.abs(d[i + 1] - c[1]) <= tol && Math.abs(d[i + 2] - c[2]) <= tol) n++;
    return n / (d.length / 4);
  };
  return { width: dv.getUint32(16), height: dv.getUint32(20), ppm: phys, bitmap: [img.width, img.height],
    teal: share(0.90, 0.005, 0.09, 0.08, '#245566', 3), land: share(0.05, 0.25, 0.65, 0.55, '#e8e8e8', 2) };`;
async function runS9() {
  const mode = PAGE.startsWith('file:') ? 'file' : 'http';
  const out = path.join(S9_DIR, 'safari');
  fs.mkdirSync(out, { recursive: true });
  const ref = JSON.parse(fs.readFileSync(path.join(S9_DIR, 'oracle_s9_tier_full.json'), 'utf8'));
  const facDir = path.join(S9_DIR, 'facilities-wa');
  for (const f of [MC_TIER_FULL, facDir]) {
    if (!fs.existsSync(f)) { console.error('Missing ' + f + ' (F1 unit run; tests/synthetic/make_s9_facilities.js).'); process.exit(2); }
  }
  const nodeWin = s9NodePage();
  const nodeMaster = nodeWin.CVIWA.master.load(fs.readFileSync(MC_TIER_FULL, 'utf8'));
  const nodeSvg = (view, inputs) => new Function('args', 'window', S9_PAGE_SVG)([{ view, inputs, master: nodeMaster }], nodeWin);
  const result = { page: PAGE, started: new Date().toISOString(),
    limitation: 'Synthetic FileList; network/CSP unobservable; the ZIP checked from the bytes handed to the download, not saved.' };
  let d, timer;
  try {
    d = await launch();
    result.safari = d.version;
    await d.size(1400, 1000);
    const cviPage = new URL('cvi/index.html', new URL('.', PAGE)).href;
    const infraPage = new URL('infrastructure/index.html', new URL('.', PAGE)).href;

    async function suite() {
      await d.goto(cviPage);
      await d.waitFor('window.CVIWA && CVIWA.brandedmaps && CVIWA.timeseries && CVIWA.state && CVIWA.state.mapHandle && CVIWA.state.mapHandle.ready', 30000, 'CVI page');
      await d.run(S7_ERROR_TRAP);
      await d.run(S7_CAPTURE);
      const v0 = await d.run('return CVIWA.state.version;');
      await d.run(SET_FILES, '#file-input', [{ name: path.basename(MC_TIER_FULL), b64: fs.readFileSync(MC_TIER_FULL).toString('base64') }]);
      await d.waitFor('CVIWA.state.master && !CVIWA.state.loading && CVIWA.state.version > ' + v0, 20000, 'master loaded');
      await sleep(800);
      await d.run(`document.getElementById('export-section').open = true; return true;`);
      result.views = {};
      for (const view of ['wa', 'flow', 'focus']) {
        await d.click('#show-' + view);
        const handle = { wa: 'mapHandle', flow: 'flowHandle', focus: 'focusHandle' }[view];
        await d.waitFor('CVIWA.state.' + handle + ' && CVIWA.state.' + handle + '.ready', 30000, view + ' map');
        if (view === 'focus') {
          await d.run(`var boxes = [].slice.call(document.querySelectorAll('#fo-counties input'));
            boxes.forEach(function (b, i) { if (b.checked !== (i < 2)) { b.checked = i < 2; b.dispatchEvent(new Event('change')); } }); return true;`);
        }
        await sleep(900);
        // The reference's page computed by Safari against Node's.
        const inputs = ref.views[view].default.inputs;
        const safariSvg = await d.run(S9_PAGE_SVG, { view, inputs });
        const diff = s9SvgDiff(safariSvg, nodeSvg(view, inputs));
        check(!diff, 'S9 Safari: ' + view + ' branded page computed by Safari equals Node\'s', diff);
        // Preview Map at Standard and High.
        const got = {};
        for (const res of ['standard', 'high']) {
          await d.run(`var s = document.getElementById('export-resolution'); s.value = args[0]; s.dispatchEvent(new Event('change')); return true;`, res);
          await d.click('#preview-map');
          await d.waitFor('!CVIWA.state.exporting && CVIWA.previews.isOpen()', 60000, view + ' preview');
          const pr = await d.run(S9_PNG_PROBE, 'map');
          await d.run('CVIWA.previews.close(); return true;');
          const want = res === 'high' ? [3300, 2550, 300] : [2200, 1700, 200];
          check(pr.width === want[0] && pr.height === want[1] && pr.ppm === Math.floor(want[2] / 0.0254) &&
            pr.bitmap[0] === want[0], 'S9 Safari: ' + view + ' Preview Map ' + res + ': ' + want[0] + ' x ' + want[1] + ' at ' + want[2] + ' dpi', pr);
          check(pr.teal > 0.95 && pr.land > 0.10, 'S9 Safari: ' + view + ' ' + res + ': the header\'s Dark Teal and the land drawn', pr);
          got[res] = pr;
        }
        result.views[view] = got;
        await d.run(`var s = document.getElementById('export-resolution'); s.value = 'standard'; s.dispatchEvent(new Event('change')); return true;`);
      }

      // National Flow: Export with the branded PNG and the GIF.
      await d.click('#show-flow');
      await d.waitFor('CVIWA.state.flowHandle && CVIWA.state.flowHandle.ready', 30000, 'flow map');
      await sleep(600);
      await d.run(`document.querySelectorAll('input[name=export-format]').forEach(function (i) {
        if (!i.disabled) i.checked = i.value === 'branded_png' || i.value === 'branded_gif'; });
        document.getElementById('export-gif').dispatchEvent(new Event('change'));
        window.__gifTexts = []; var t = document.getElementById('gif-progress-text');
        new MutationObserver(function () { if (t.textContent && window.__gifTexts[window.__gifTexts.length - 1] !== t.textContent) window.__gifTexts.push(t.textContent); })
          .observe(t, { childList: true, characterData: true, subtree: true });
        document.getElementById('export-section').scrollIntoView(); return true;`);
      check(await d.run(`return !document.getElementById('export-gif-field').hidden && document.getElementById('export-gif').checked;`),
        'S9 Safari: National Flow offers the GIF and its frame interval');
      const n = await d.run('return window.__s7downloads.length;');
      const t0 = Date.now();
      await d.click('#run-export');
      await d.waitFor('!CVIWA.state.exporting && window.__s7downloads.length > ' + n + ' && window.__s7downloads[' + n + '].b64', 120000, 'export');
      result.exportMs = Date.now() - t0;
      const dl = await d.run('return window.__s7downloads[' + n + '];');
      const entries = s7ReadZip(Buffer.from(dl.b64, 'base64'));
      const lg = await d.run(`var g = CVIWA.state.lastGif; return { labels: g.models.map(function (m) { return m.frame.label; }),
        delays: g.models.map(function (m) { return m.frame.delay; }), texts: window.__gifTexts };`);
      const gifName = ref.views.gif.default.gif.output_file;
      const gif = entries.find(e => e.name.endsWith('/' + gifName));
      const png = entries.find(e => /\/CVI_Flow_Map_.*\.png$/.test(e.name));
      check(!!gif && !!png, 'S9 Safari: the ZIP holds the branded PNG and ' + gifName, entries.map(e => e.name));
      const blocks = gif ? s9GifBlocks(gif.data) : null;
      check(blocks && blocks.signature === 'GIF89a' && blocks.width === 1650 && blocks.height === 1275 && blocks.loop === 0 &&
        blocks.trailer && !blocks.error, 'S9 Safari: the GIF\'s screen, endless loop and trailer', blocks && Object.assign({}, blocks, { frames: blocks.frames.length }));
      check(blocks && blocks.frames.length === lg.labels.length && lg.labels.length === 8 &&
        JSON.stringify(blocks.frames.map(f => f.delay)) === JSON.stringify(lg.delays) && lg.delays[7] === 240 && lg.delays[0] === 80 &&
        blocks.frames.every(f => f.width === 1650 && f.height === 1275), 'S9 Safari: one frame per quarter, 0.8 s and the last 2.4 s',
      blocks && blocks.frames.map(f => f.delay));
      check(JSON.stringify(lg.texts) === JSON.stringify(lg.labels.map((l, i) => 'GIF frame ' + (i + 1) + ' of ' + lg.labels.length + ': ' + l)),
        'S9 Safari: "GIF frame i of n: label" for each frame', lg.texts);
      // Safari's own decoder opens the GIF; its first frame against the page drawn by the PNG step.
      const shown = await d.run(`var bin = atob(args[0]), u = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
        var url = URL.createObjectURL(new Blob([u], { type: 'image/gif' })), img = new Image();
        await new Promise(function (res, rej) { img.onload = res; img.onerror = function () { rej(new Error('GIF not opened')); }; img.src = url; });
        var cv = document.createElement('canvas'); cv.width = img.naturalWidth; cv.height = img.naturalHeight;
        var g = cv.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0);
        var got = g.getImageData(0, 0, cv.width, cv.height).data;
        var size = CVIWA.timeseries.size(), B = WSDA.branded;
        var want = (await B.pixels(B.svg(CVIWA.state.lastGif.parts[0], size), size)).data, same = 0;
        for (var k = 0; k < got.length; k += 4) if (got[k] === want[k] && got[k + 1] === want[k + 1] && got[k + 2] === want[k + 2]) same++;
        URL.revokeObjectURL(url);
        return { width: img.naturalWidth, height: img.naturalHeight, same: same / (got.length / 4) };`, gif ? gif.data.toString('base64') : '');
      check(shown.width === 1650 && shown.height === 1275 && shown.same > 0.97, 'S9 Safari: Safari opens the GIF; its first frame matches the page', shown);
      result.gif = { bytes: gif && gif.data.length, frames: blocks && blocks.frames.length, firstFrameSame: shown.same, exportMs: result.exportMs };

      // The Infrastructure dashboard: Branded and Report High.
      await d.goto(infraPage);
      await d.waitFor('window.WSDA && WSDA.infrastructure && WSDA.infrastructureBranded', 30000, 'dashboard');
      await d.run(S7_ERROR_TRAP);
      const facFiles = fs.readdirSync(facDir).filter(f => f.endsWith('.csv')).map(f => path.join(facDir, f)).concat([MC_TIER_FULL]);
      await d.run(SET_FILES, '#files-input', facFiles.map(f => ({ name: path.basename(f), b64: fs.readFileSync(f).toString('base64') })));
      await d.waitFor('WSDA.infrastructure.state.facilityFiles === 5 && WSDA.infrastructure.state.master && !WSDA.infrastructure.state.loading', 30000, 'files loaded');
      await sleep(800);
      await d.run(`document.getElementById('export-section').open = true; document.getElementById('export-section').scrollIntoView(); return true;`);
      const facPreview = async label => {
        await d.click('#preview-facilities');
        await d.waitFor(`!document.getElementById('preview-facilities').disabled && CVIWA.previews.isOpen()`, 60000, 'facilities preview');
        const pr = await d.run(S9_PNG_PROBE, 'facilities');
        await d.run('CVIWA.previews.close(); return true;');
        result['facilities_' + label] = pr;
        return pr;
      };
      // With every layer shown, Density grayed (its label too) with the reason, Locations ticked.
      const f7 = await d.run(`var dn = document.querySelector('input[name="coverage"][value="density"]');
        var on = document.querySelector('input[name="coverage"]:checked');
        return { disabled: dn.disabled, checked: on && on.value, color: getComputedStyle(dn.parentElement).color,
          reason: !document.getElementById('coverage-reason').hidden };`);
      // Grayed: --disabled #999999 (was #9aa3ab).
      check(f7.disabled && f7.checked === 'locations' && f7.color === 'rgb(153, 153, 153)' && f7.reason,
        'S9 Safari: with every layer shown, Density grayed with the reason, Locations ticked', f7);
      const fb = await facPreview('branded');
      check(fb.width === 2200 && fb.height === 1700 && fb.ppm === Math.floor(200 / 0.0254) && fb.teal > 0.95,
        'S9 Safari: Facilities Branded 2200 x 1700 at 200 dpi, the header drawn', fb);
      await d.run(`document.querySelector('input[name="output-style"][value="report"]').click();
        var s = document.getElementById('export-resolution'); s.value = 'high'; s.dispatchEvent(new Event('change')); return true;`);
      const fr = await facPreview('report_high');
      check(fr.width === 1950 && fr.height === 990 && fr.ppm === Math.floor(300 / 0.0254), 'S9 Safari: Facilities Report High 1950 x 990 at 300 dpi', fr);

      const errors = await d.run('var e = window.__errors || []; window.__errors = []; return e;');
      check(!errors.length, 'S9 Safari: no page errors (window.onerror and unhandled rejections)', errors);
    }
    await Promise.race([suite(), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('S9 Safari eight-minute limit')), 480000);
    })]);
  } catch (e) {
    check(false, 'S9 Safari suite stopped', e && e.stack);
    try { fs.writeFileSync(path.join(out, 'safari_s9_' + mode + '_failed.png'), Buffer.from(await d.screenshot(), 'base64')); } catch (e2) { /* window may be gone */ }
  } finally {
    clearTimeout(timer);
    if (d) await d.close();
  }
  Object.assign(result, { passed: pass, failed: fail, failures, notes, finished: new Date().toISOString() });
  fs.writeFileSync(path.join(out, 'safari_s9_' + mode + '.json'), JSON.stringify(result, null, 2) + '\n');
  failures.forEach(f => console.error('  FAIL ' + f));
  notes.forEach(n => console.log('  note ' + n));
  console.log('S9 Safari ' + (result.safari || '') + ' (' + mode + '): ' + pass + ' passed, ' + fail + ' failed');
  process.exitCode = fail ? 1 : 0;
}
if (process.argv.includes('--s9')) runS9().catch(e => { console.error(e.stack); process.exitCode = 2; });

// ── PC: the population-context layers ──────────────────────────────────────────────────────────────────────────
// node tests/browser/run_safari.js --pc   Over http: start tests/browser/serve_case_strict.js, then
// SAFARI_PAGE_URL=http://127.0.0.1:8765/index.html node tests/browser/run_safari.js --pc
// In Safari at 1400 x 1000, the three switches turned on with real pointer clicks, the Full tier
// (test-tables/tier_full_master.csv) and the S9 statewide synthetic facility layers:
//   - CVI page, WA State: the switches off at the start with no data file loaded; the live map's layers (WebGL in
//     Safari) in drawing order, the both-on rule, the legend block, the map's credits, the names asked for (worked
//     out here from the data files) shown apart, clear of the county names and inside the map; the map's own picture
//     (its screenshot) shows the lavender density, and none with the layers off; the hover text over Sedro-Woolley
//     (a real pointer move);
//   - the branded page with all three layers, computed by Safari, equal to Node's (WA State and County Focus), and
//     Preview Map (a real click): the density drawn into the PNG, none with the layers off, the credits in the source
//     line; Export: export_params.json names the layers and their sources;
//   - National Flow grayed with the reason; County Focus (Yakima): every city and place named, the PNG with the
//     layers; Reset All (a real click) turns the three off;
//   - the Infrastructure dashboard: the switches by real clicks, the legend block, the Branded preview with the
//     density drawn and the credits; density grayed with the reason while the Density (choropleth) view applies;
//     Reset All.
// Writes local-test-artifacts/pc/safari/safari_pc_<file|http>.json.
const PC_ON = { cities: true, places: true, density: true };
const PC_CITY_CREDIT = 'City limits: WA Department of Revenue';
const PC_CENSUS_CREDIT = 'Population: U.S. Census Bureau, 2020 Census';
// The S9 Node page with the population module and its three data files.
function pcNodePage() {
  const vm = require('vm');
  const win = s9NodePage();
  const ctx = vm.createContext({ window: win, console });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'site', 'shared', 'population.js'), 'utf8'), ctx);
  for (const f of ['citylimits-wa.js', 'places-wa.js', 'tracts-wa.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'site', 'geo', f), 'utf8'), ctx);
  }
  return win;
}
// The WA State or County Focus branded page of a reference scenario with the layers in args[0].population, built by
// the page's code in whichever engine runs it: returns the SVG markup.
const PC_PAGE_SVG = `var w = window, W = w.CVIWA, B = w.WSDA.branded, m = args[0].master || W.state.master;
  var view = args[0].view, inp = args[0].inputs, pop = args[0].population, built;
  var list = function (x) { return x === null || x === undefined ? [] : Array.isArray(x) ? x : [x]; };
  var date = new Date(2026, 9, 12);
  if (view === 'wa') {
    var f = { species: list(inp.county_species), years: list(inp.county_year).map(Number), quarters: list(inp.county_quarter),
      direction: list(inp.county_direction), rawSpecies: list(inp.county_species_sub), mode: inp.county_mode,
      scaling: inp.county_scaling, nBins: Number(inp.county_n_bins) };
    var rows = W.aggregate.build(m.rows, Object.assign({}, f, { hasSpecies: m.hasSpecies }));
    built = W.brandedmaps.wa({ rows: rows, f: f, universe: m.speciesChoices, palette: inp.county_palette,
      opacity: inp.county_opacity, title: inp.export_title, date: date, counties: w.CVIWA_GEO.counties.features,
      population: pop });
  } else {
    var h = { counties: list(inp.intra_counties), species: list(inp.intra_species), rawSpecies: list(inp.intra_species_sub),
      years: list(inp.intra_year).map(Number), quarters: list(inp.intra_quarter), direction: inp.intra_filter_dir,
      mode: inp.intra_mode, scaling: inp.intra_scaling, nBins: Number(inp.intra_n_bins), opacity: inp.intra_opacity,
      hideCircles: !!inp.hide_cvi_circles };
    built = W.brandedmaps.focus({ premises: W.focus.build(m, h).premises, f: h, universe: m.speciesChoices,
      title: inp.export_title, date: date, counties: w.CVIWA_GEO.counties.features, background: 'standard',
      population: pop });
  }
  return { svg: B.svg(built.parts), names: built.model.population ? built.model.population.names.length : 0 };`;
// The share of lavender pixels (the density ramp over the land: blue above green, red not below green) in a part of
// a picture. args[0]: 'live' (the live map's own picture: args[1] names CVIWA.state's map handle, or 'dashboard'), 'preview' (the CVI
// page's last Preview Map) or 'facilities' (the dashboard's last preview); args[2]: [x, y, w, h] as fractions.
const PC_LAVENDER = `var src = args[0], blob;
  if (src === 'live') blob = await CVIWA.map.screenshot(args[1] === 'dashboard' ? WSDA.infrastructure.state.map : CVIWA.state[args[1]]);
  else if (src === 'preview') blob = CVIWA.state.lastPreviewMap[0].blob;
  else blob = WSDA.infrastructure.state.lastPreview.blob;
  var img = await createImageBitmap(blob), cv = document.createElement('canvas');
  cv.width = img.width; cv.height = img.height;
  var g = cv.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0);
  var r = args[2], d = g.getImageData(Math.round(r[0] * img.width), Math.round(r[1] * img.height),
    Math.round(r[2] * img.width), Math.round(r[3] * img.height)).data, n = 0;
  for (var i = 0; i < d.length; i += 4) if (d[i + 2] - d[i + 1] >= 10 && d[i] >= d[i + 1] && d[i + 2] - d[i] >= 8) n++;
  return { width: img.width, height: img.height, share: n / (d.length / 4) };`;
// The names a map asks for, from the data files (not the module): the both-on rule's sources, the threshold, and the
// picked counties (args: on, min, counties or null).
const PC_WANT_NAMES = `var on = args[0], min = args[1], picked = args[2];
  var cities = on.cities ? WSDA_CITYLIMITS.cities.map(function (c) { return { name: c.name, pop: c.pop, label: c.label }; }) : [];
  var places = [];
  if (on.places) {
    places = on.cities ? WSDA_PLACES.places.filter(function (p) { return p.kind === 'cdp' && p.trim !== 'dropped'; }).map(function (p) {
      var t = p.trim === 'clipped' ? WSDA_PLACES.cdpOutsideCities.find(function (c) { return c.geoid === p.geoid; }) : null;
      return { name: p.name, pop: p.pop, label: t ? t.label : p.label };
    }) : WSDA_PLACES.places.map(function (p) { return { name: p.name, pop: p.pop, label: p.label }; });
  }
  var feats = picked && CVIWA_GEO.counties.features.filter(function (f) { return picked.indexOf(f.properties.name) >= 0; });
  var inRing = function (x, y, r) { var k = false; for (var i = 0, j = r.length - 1; i < r.length; j = i++) {
    if ((r[i][1] > y) !== (r[j][1] > y) && x < (r[j][0] - r[i][0]) * (y - r[i][1]) / (r[j][1] - r[i][1]) + r[i][0]) k = !k; }
    return k; };
  var inF = function (x, y, g) { return (g.type === 'Polygon' ? [g.coordinates] : g.coordinates).some(function (p) {
    return inRing(x, y, p[0]) && !p.slice(1).some(function (h) { return inRing(x, y, h); }); }); };
  return cities.concat(places).filter(function (n) { return (n.pop || 0) >= min; })
    .filter(function (n) { return !feats || feats.some(function (f) { return inF(n.label[0], n.label[1], f.geometry); }); })
    .map(function (n) { return n.name; }).sort();`;
// The live names of a map handle (a page expression): all asked for, those shown, and whether the shown ones lie
// apart, clear of the county names shown and inside the map.
const pcNames = handle => `var st = ${handle}, c = st.map.getContainer().getBoundingClientRect();
  var rect = function (e) { return e.getBoundingClientRect(); };
  var shown = st.pcLabels.map(function (m) { return m.getElement(); }).filter(function (e) { return !e.classList.contains('collided'); });
  var counties = [].slice.call(st.map.getContainer().querySelectorAll('.county-label:not(.pc-name):not(.hidden)')).map(rect);
  var meet = function (a, b) { return Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 &&
    Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5; };
  var rs = shown.map(rect);
  return { all: st.pcLabels.map(function (m) { return m.getElement().textContent; }).sort(), shown: shown.length,
    apart: rs.every(function (a, i) { return rs.every(function (b, j) { return i === j || !meet(a, b); }); }),
    clearOfCounties: rs.every(function (a) { return !counties.some(function (b) { return meet(a, b); }); }),
    inside: rs.every(function (a) { return a.left >= c.left - 0.5 && a.right <= c.right + 0.5 && a.top >= c.top - 0.5 &&
      a.bottom <= c.bottom + 0.5; }) };`;
const PC_BOXES = `var o = {}; ['cities', 'places', 'density'].forEach(function (l) { var i = document.getElementById('pc-' + l);
  o[l] = { checked: i.checked, disabled: i.disabled }; }); return o;`;
// True once each layer of want is visible (true) or not drawn (false) on the map of handle (a page expression).
const pcLayersWait = (handle, want) => `(function () { var m = ${handle}.map, ids = { cities: 'pc-cities-line',
  places: 'pc-places-fill', density: 'pc-density' }, want = ${JSON.stringify(want)};
  return Object.keys(want).every(function (l) { var v = !!m.getLayer(ids[l]) && m.getLayoutProperty(ids[l], 'visibility') === 'visible';
    return v === want[l]; }) && m.loaded(); })()`;
async function runPC() {
  const mode = PAGE.startsWith('file:') ? 'file' : 'http';
  const out = path.join(ROOT, 'local-test-artifacts', 'pc', 'safari');
  fs.mkdirSync(out, { recursive: true });
  const ref = JSON.parse(fs.readFileSync(path.join(S9_DIR, 'oracle_s9_tier_full.json'), 'utf8'));
  const facDir = path.join(S9_DIR, 'facilities-wa');
  for (const f of [MC_TIER_FULL, facDir]) {
    if (!fs.existsSync(f)) { console.error('Missing ' + f + ' (F1 unit run; tests/synthetic/make_s9_facilities.js).'); process.exit(2); }
  }
  const nodeWin = pcNodePage();
  const nodeMaster = nodeWin.CVIWA.master.load(fs.readFileSync(MC_TIER_FULL, 'utf8'));
  const nodeSvg = (view, inputs, population) =>
    new Function('args', 'window', PC_PAGE_SVG)([{ view, inputs, population, master: nodeMaster }], nodeWin);
  const result = { page: PAGE, started: new Date().toISOString(),
    limitation: 'Synthetic FileList; network/CSP unobservable (file loading checked by the data globals); the ZIP checked from the bytes handed to the download, not saved.' };
  let d, timer;
  try {
    d = await launch();
    result.safari = d.version;
    await d.size(1400, 1000);
    const cviPage = new URL('cvi/index.html', new URL('.', PAGE)).href;
    const infraPage = new URL('infrastructure/index.html', new URL('.', PAGE)).href;
    const H = 'CVIWA.state.mapHandle';
    const settle = handle => d.run(`await new Promise(function (res) { var m = ${handle}.map; m.once('idle', function () { res(true); });
      m.triggerRepaint(); setTimeout(function () { res(true); }, 4000); }); return true;`);
    const loadedFiles = () => d.run(`return ['WSDA_CITYLIMITS', 'WSDA_PLACES', 'WSDA_TRACTS'].filter(function (g) { return !!window[g]; })
      .concat([].slice.call(document.scripts).filter(function (s) { return /geo\\/(citylimits|places|tracts)-wa\\.js/.test(s.src); })
      .map(function (s) { return s.src; }));`);
    const cviPreview = async () => {
      await d.click('#preview-map');
      await d.waitFor('!CVIWA.state.exporting && CVIWA.previews.isOpen()', 60000, 'preview');
      const lav = await d.run(PC_LAVENDER, 'preview', null, [0.05, 0.25, 0.65, 0.55]);
      const models = await d.run(`var m = CVIWA.state.lastBranded; CVIWA.previews.close();
        return m.models.map(function (x) { return { view: x.view, source: x.source,
          population: x.population ? { on: x.population.on, names: x.population.names.length } : null }; });`);
      return { lav, models };
    };

    async function suite() {
      // ── The CVI page ──
      await d.goto(cviPage);
      await d.waitFor('window.CVIWA && CVIWA.brandedmaps && WSDA.population && CVIWA.state && CVIWA.state.mapHandle && CVIWA.state.mapHandle.ready',
        30000, 'CVI page');
      await d.run(S7_ERROR_TRAP);
      await d.run(S7_CAPTURE);
      const v0 = await d.run('return CVIWA.state.version;');
      await d.run(SET_FILES, '#file-input', [{ name: path.basename(MC_TIER_FULL), b64: fs.readFileSync(MC_TIER_FULL).toString('base64') }]);
      await d.waitFor('CVIWA.state.master && !CVIWA.state.loading && CVIWA.state.version > ' + v0, 20000, 'master loaded');
      await sleep(800);
      await d.run(`document.getElementById('export-section').open = true; return true;`);

      // At the start: off and available, no data file loaded, nothing drawn; the pictures without density.
      let bx = await d.run(PC_BOXES);
      check(Object.values(bx).every(x => !x.checked && !x.disabled), 'PC Safari: cvi: three switches off and available at the start', bx);
      check(!(await loadedFiles()).length, 'PC Safari: cvi: no data file loaded before a switch is turned on', await loadedFiles());
      await settle(H);
      const liveOff = await d.run(PC_LAVENDER, 'live', 'mapHandle', [0, 0, 1, 1]);
      const pvOff = await cviPreview();
      result.lavender = { liveOff: liveOff.share, previewOff: pvOff.lav.share };
      check(liveOff.share < 0.002 && pvOff.lav.share < 0.002 && !pvOff.models[0].population,
        'PC Safari: cvi: no lavender in the live map or the PNG with the layers off', result.lavender);

      // The three switches by real clicks.
      await d.run(`document.getElementById('pc-block').scrollIntoView({ block: 'center' }); return true;`);
      for (const l of ['cities', 'places', 'density']) {
        await d.click('#pc-' + l);
        await d.waitFor(pcLayersWait(H, { [l]: true }), 20000, l + ' drawn');
      }
      bx = await d.run(PC_BOXES);
      check(Object.values(bx).every(x => x.checked && !x.disabled), 'PC Safari: cvi: the three switches on by real clicks', bx);
      const files = await loadedFiles();
      check(files.filter(f => /^WSDA_/.test(f)).length === 3, 'PC Safari: cvi: the three data files loaded', files);
      const order = await d.run(`return ${H}.map.getStyle().layers.map(function (l) { return l.id; })
        .filter(function (id) { return /^pc-|^wa-land$|^county-lines$|^circles$/.test(id); });`);
      const ix = id => order.indexOf(id);
      check(ix('wa-land') < ix('pc-density') && ix('pc-density') < ix('pc-places-fill') &&
        ix('pc-places-fill') < ix('pc-cities-fill') && ix('pc-cities-line') < ix('county-lines') &&
        ix('county-lines') < ix('circles'), 'PC Safari: cvi: drawing order land, density, places, cities, county lines, circles', order);
      check(await d.run(`return ${H}.pcPlaces === 'cdp' && ${H}.map.getLayoutProperty('pc-places-cdp', 'visibility') === 'visible';`),
        'PC Safari: cvi: both outline layers: the census-designated places only');
      const lg = await d.run(`return document.getElementById('legend-panel').textContent;`);
      check(['Population context', 'City limits (current)', 'Census-designated place', 'People per sq mi of land (2020)',
        'Under 10', '5,000 and over'].every(t => lg.includes(t)) && !lg.includes('City or town, 2020'),
      'PC Safari: cvi: the live legend block', lg.slice(-300));
      await settle(H);
      const attrib = await d.run(`return (${H}.map.getContainer().querySelector('.maplibregl-ctrl-attrib-inner') || {}).textContent || '';`);
      check(attrib.includes(PC_CITY_CREDIT) && attrib.includes(PC_CENSUS_CREDIT), 'PC Safari: cvi: the map\'s credits', attrib);
      let nm = await d.run(pcNames(H));
      let want = await d.run(PC_WANT_NAMES, PC_ON, 10000, null);
      check(JSON.stringify(nm.all) === JSON.stringify(want) && want.includes('Sedro-Woolley'),
        'PC Safari: cvi: WA State asks for the names of 10,000 or more (Census names)', [nm.all.length, want.length]);
      check(nm.shown > 0 && nm.apart && nm.clearOfCounties && nm.inside,
        'PC Safari: cvi: names shown apart, clear of the county names, inside the map', nm.shown);
      // Safari draws the density: the live map's own picture, with the names and credits.
      const liveOn = await d.run(PC_LAVENDER, 'live', 'mapHandle', [0, 0, 1, 1]);
      const cap = await d.run(`return { names: (${H}.lastPcNames || []).length, credit: ${H}.lastAttribution || '' };`);
      result.lavender.liveOn = liveOn.share;
      check(liveOn.share > 0.05, 'PC Safari: cvi: the live map\'s picture shows the lavender density', liveOn);
      check(cap.names === nm.shown && cap.credit.includes(PC_CITY_CREDIT) && cap.credit.includes(PC_CENSUS_CREDIT),
        'PC Safari: cvi: the map\'s picture carries the names shown and the credits', cap);

      // Hover over Sedro-Woolley, close up (a real pointer move): the city and its tract.
      const sw = await d.run(`return WSDA_CITYLIMITS.cities.find(function (c) { return c.geoid === '5363210'; }).label;`);
      await d.run(`${H}.map.getContainer().scrollIntoView({ block: 'center' });
        await new Promise(function (res) { var m = ${H}.map; m.jumpTo({ center: args[0], zoom: 12 });
        m.once('idle', function () { res(true); }); setTimeout(function () { res(true); }, 6000); }); return true;`, sw);
      const at = await d.run(`var r = ${H}.map.getCanvas().getBoundingClientRect(), q = ${H}.map.project(args[0]);
        return [r.left + q.x, r.top + q.y];`, sw);
      await foreground();
      await d.move(at[0] - 3, at[1] - 3);
      await d.move(at[0], at[1]);
      await sleep(400);
      const tip = await d.run(`return { text: ${H}.pcHoverText || [], open: !!document.querySelector('.pc-tip') };`);
      check(tip.open && tip.text[0] === 'Sedro-Woolley' && tip.text[2] === '2020 population 12,421 (U.S. Census Bureau)' &&
        tip.text[3] === 'Census tract, 2020' && / people per sq mi of land$/.test(tip.text[4] || ''),
      'PC Safari: cvi: hover over a city: the city and its tract (a real pointer move)', tip);
      await d.move(5, 5);
      await d.run(`await new Promise(function (res) { CVIWA.map.fitView(${H}); ${H}.map.once('idle', function () { res(true); });
        setTimeout(function () { res(true); }, 5000); }); return true;`);

      // The branded pages with the layers, computed by Safari against Node's.
      for (const view of ['wa', 'focus']) {
        const inputs = ref.views[view].default.inputs;
        const pop = { on: PC_ON, ramp: 'lavender' };
        const sa = await d.run(PC_PAGE_SVG, { view, inputs, population: pop });
        const no = nodeSvg(view, inputs, pop);
        const diff = s9SvgDiff(sa.svg, no.svg);
        check(!diff && sa.names > 0 && sa.names === no.names && /fill="#4b4380"/.test(sa.svg),
          'PC Safari: ' + view + ' branded page with the three layers computed by Safari equals Node\'s', diff || [sa.names, no.names]);
      }

      // Preview Map (a real click): the density in the PNG, the layers and the credits.
      const pvOn = await cviPreview();
      result.lavender.previewOn = pvOn.lav.share;
      const m0 = pvOn.models[0] || {};
      check(pvOn.lav.share > 0.05 && pvOn.lav.width === 2200, 'PC Safari: cvi: Preview Map draws the density into the PNG', pvOn.lav);
      check(m0.population && m0.population.on.cities && m0.population.on.places && m0.population.on.density &&
        m0.population.names > 0 && m0.source && m0.source.endsWith(' · ' + PC_CITY_CREDIT + ' · ' + PC_CENSUS_CREDIT),
      'PC Safari: cvi: the PNG draws the three layers and names, with the credits in the source line', m0);

      // Export (a real click): export_params.json names the layers and their sources.
      await d.run(`document.querySelectorAll('input[name=export-format]').forEach(function (i) {
        if (!i.disabled) i.checked = i.value === 'branded_png'; }); return true;`);
      const n = await d.run('return window.__s7downloads.length;');
      await d.click('#run-export');
      await d.waitFor('!CVIWA.state.exporting && window.__s7downloads.length > ' + n + ' && window.__s7downloads[' + n + '].b64', 120000, 'export');
      const dl = await d.run('return window.__s7downloads[' + n + '];');
      const entries = s7ReadZip(Buffer.from(dl.b64, 'base64'));
      const params = (entries.find(e => e.name.endsWith('/export_params.json')) || { data: Buffer.from('') }).data.toString('utf8');
      check(/"population_layers": \["city_limits", "population_centers", "population_density"\]/.test(params) &&
        /"population_sources": \["City limits: WA Department of Revenue, downloaded \d{4}-\d\d-\d\d \(\d{4} Q\d\); 2020 population: U\.S\. Census Bureau", "Population: U\.S\. Census Bureau, 2020 Census \(2020\)"\]/
          .test(params) && params.indexOf('"population_sources"') < params.indexOf('"exported_at"'),
      'PC Safari: cvi: export_params.json records the layers and their sources', params.slice(-600));

      // National Flow (a real click): grayed with the reason, still ticked for the other maps; no legend block.
      await d.click('#show-flow');
      await d.waitFor('CVIWA.state.flowHandle && CVIWA.state.flowHandle.ready', 30000, 'flow map');
      await sleep(400);
      bx = await d.run(PC_BOXES);
      const reason = await d.run(`var r = document.getElementById('pc-reason'); return r.hidden ? null : r.textContent;`);
      check(Object.values(bx).every(x => x.disabled && x.checked) && reason === 'Washington-only layers; not shown on the national map.' &&
        await d.run(`return !/Population context/.test(document.getElementById('legend-panel-flow').textContent);`),
      'PC Safari: cvi: National Flow: the switches grayed with the reason, no legend block', [bx, reason]);

      // County Focus (a real click) with Yakima picked: every city and place in Yakima named; the PNG with the layers.
      await d.click('#show-focus');
      await d.waitFor('CVIWA.state.focusHandle && CVIWA.state.focusHandle.ready', 30000, 'focus map');
      await d.run(`[].slice.call(document.querySelectorAll('#fo-counties input')).forEach(function (b) {
        var on = b.value === 'Yakima'; if (b.checked !== on) { b.checked = on; b.dispatchEvent(new Event('change')); } }); return true;`);
      await sleep(900);
      await d.waitFor(pcLayersWait('CVIWA.state.focusHandle', PC_ON), 20000, 'focus layers');
      bx = await d.run(PC_BOXES);
      nm = await d.run(pcNames('CVIWA.state.focusHandle'));
      want = await d.run(PC_WANT_NAMES, PC_ON, 0, ['Yakima']);
      check(Object.values(bx).every(x => x.checked && !x.disabled) && JSON.stringify(nm.all) === JSON.stringify(want) &&
        want.includes('Sunnyside') && nm.apart && nm.clearOfCounties && nm.inside,
      'PC Safari: cvi: County Focus (Yakima): every city and place named, apart and clear', [nm.all.length, want.length, nm.shown]);
      const pvFocus = await cviPreview();
      const fm = pvFocus.models[0] || {};
      check(fm.view === 'focus' && fm.population && fm.population.on.density && pvFocus.lav.share > 0.02 &&
        fm.source.includes(PC_CENSUS_CREDIT), 'PC Safari: cvi: County Focus PNG draws the layers with the credits',
      [fm, pvFocus.lav]);
      result.lavender.focusPreview = pvFocus.lav.share;

      // Reset All (a real click): the three off; back on WA State nothing drawn and no legend block.
      await d.click('#reset-all');
      await sleep(500);
      await d.click('#show-wa');
      await d.waitFor(pcLayersWait(H, { cities: false, places: false, density: false }), 20000, 'layers off');
      bx = await d.run(PC_BOXES);
      check(Object.values(bx).every(x => !x.checked && !x.disabled) &&
        await d.run(`return !${H}.pcLabels.length && !/Population context/.test(document.getElementById('legend-panel').textContent);`),
      'PC Safari: cvi: Reset All turns the three off; nothing drawn, no names, no legend block', bx);
      let errors = await d.run('var e = window.__errors || []; window.__errors = []; return e;');
      check(!errors.length, 'PC Safari: cvi: no page errors', errors);

      // ── The Infrastructure dashboard ──
      await d.goto(infraPage);
      await d.waitFor('window.WSDA && WSDA.infrastructure && WSDA.infrastructureBranded && WSDA.infrastructure.state.map && WSDA.infrastructure.state.map.ready',
        30000, 'dashboard');
      await d.run(S7_ERROR_TRAP);
      const IH = 'WSDA.infrastructure.state.map';
      const facFiles = fs.readdirSync(facDir).filter(f => f.endsWith('.csv')).map(f => path.join(facDir, f));
      await d.run(SET_FILES, '#files-input', facFiles.map(f => ({ name: path.basename(f), b64: fs.readFileSync(f).toString('base64') })));
      await d.waitFor('WSDA.infrastructure.state.facilityFiles === 5 && !WSDA.infrastructure.state.loading', 30000, 'files loaded');
      await sleep(600);
      const setLayers = keys => d.run(`document.getElementById('infrastructure-layers-clear').click();
        args[0].forEach(function (k) { var box = [].slice.call(document.querySelectorAll('#facility-controls input[type=checkbox]'))
          .find(function (i) { return i.value === k; }); if (box && !box.checked) box.click(); });
        return WSDA.infrastructure.state.result.layers.map(function (l) { return l.key; });`, keys);
      const shown = await setLayers(['slaughterhouses', 'fairgrounds', 'markets', 'feedlots', 'restricted']);
      check(shown.length === 5, 'PC Safari: infra: five facility layers shown', shown);
      bx = await d.run(PC_BOXES);
      check(Object.values(bx).every(x => !x.checked && !x.disabled) && !(await loadedFiles()).length,
        'PC Safari: infra: three switches off and available, no data file loaded', bx);
      await d.run(`document.getElementById('style-fold').open = true; document.getElementById('pc-block').scrollIntoView({ block: 'center' });
        return true;`);
      for (const l of ['cities', 'places', 'density']) {
        await d.click('#pc-' + l);
        await d.waitFor(pcLayersWait(IH, { [l]: true }), 20000, 'infra ' + l + ' drawn');
      }
      const ilg = await d.run(`return document.getElementById('facility-legend-content').textContent;`);
      check(['Population context', 'City limits (current)', 'Census-designated place', '5,000 and over'].every(t => ilg.includes(t)),
        'PC Safari: infra: the live legend block', ilg.slice(-250));
      const iLive = await d.run(PC_LAVENDER, 'live', 'dashboard', [0, 0, 1, 1]);
      check(iLive.share > 0.05, 'PC Safari: infra: the live map\'s picture shows the lavender density', iLive);
      // The Branded preview (a real click): density drawn, the three layers and the credits.
      await d.run(`document.getElementById('export-section').open = true; document.getElementById('export-section').scrollIntoView(); return true;`);
      const facPreview = async () => {
        await d.click('#preview-facilities');
        await d.waitFor(`!document.getElementById('preview-facilities').disabled && CVIWA.previews.isOpen()`, 60000, 'facilities preview');
        const lav = await d.run(PC_LAVENDER, 'facilities', null, [0.05, 0.25, 0.65, 0.55]);
        const model = await d.run(`var m = WSDA.infrastructure.state.lastPreview.model; CVIWA.previews.close();
          return { coverage: m.coverage, source: m.source, drawn: m.populationDrawn ? m.populationDrawn.on : null,
            names: m.population ? m.population.names.length : null };`);
        return { lav, model };
      };
      const fp = await facPreview();
      result.lavender.facilitiesOn = fp.lav.share;
      check(fp.lav.share > 0.05 && fp.model.coverage === 'locations' && fp.model.drawn && fp.model.drawn.cities &&
        fp.model.drawn.places && fp.model.drawn.density && fp.model.names > 0 &&
        fp.model.source.endsWith(' · ' + PC_CITY_CREDIT + ' · ' + PC_CENSUS_CREDIT),
      'PC Safari: infra: the Branded preview draws the density, the three layers and the credits', fp);
      // One facility layer: the Density (choropleth) view applies, density grayed with the reason (kept on).
      await setLayers(['feedlots']);
      await sleep(400);
      bx = await d.run(PC_BOXES);
      const ireason = await d.run(`var r = document.getElementById('pc-reason'); return r.hidden ? null : r.textContent;`);
      check(bx.density.disabled && bx.density.checked && !bx.cities.disabled &&
        ireason === 'Population density cannot be shown over a county fill; switch to Locations.' &&
        await d.run(`var color = getComputedStyle(document.getElementById('pc-density').parentElement).color; return color === 'rgb(153, 153, 153)';`),
      'PC Safari: infra: density grayed (its label too) with the reason over the Density view', [bx, ireason]);
      await d.waitFor(pcLayersWait(IH, { density: false }), 20000, 'density hidden');
      const fd = await facPreview();
      check(fd.model.coverage === 'density' && fd.model.drawn && !fd.model.drawn.density && fd.model.drawn.cities &&
        fd.model.names === 0, 'PC Safari: infra: Density view PNG: the outlines only, no names', fd.model);
      // Reset All (a real click).
      await d.run(`document.getElementById('reset-all').scrollIntoView({ block: 'center' }); return true;`);
      await d.click('#reset-all');
      await d.waitFor(pcLayersWait(IH, { cities: false, places: false, density: false }), 20000, 'infra layers off');
      bx = await d.run(PC_BOXES);
      check(Object.values(bx).every(x => !x.checked && !x.disabled) &&
        await d.run(`return !/Population context/.test(document.getElementById('facility-legend-content').textContent);`),
      'PC Safari: infra: Reset All turns the three off, no legend block', bx);
      errors = await d.run('var e = window.__errors || []; window.__errors = []; return e;');
      check(!errors.length, 'PC Safari: infra: no page errors', errors);
    }
    await Promise.race([suite(), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('PC Safari eight-minute limit')), 480000);
    })]);
  } catch (e) {
    check(false, 'PC Safari suite stopped', e && e.stack);
    try { fs.writeFileSync(path.join(out, 'safari_pc_' + mode + '_failed.png'), Buffer.from(await d.screenshot(), 'base64')); } catch (e2) { /* window may be gone */ }
  } finally {
    clearTimeout(timer);
    if (d) await d.close();
  }
  Object.assign(result, { passed: pass, failed: fail, failures, notes, finished: new Date().toISOString() });
  fs.writeFileSync(path.join(out, 'safari_pc_' + mode + '.json'), JSON.stringify(result, null, 2) + '\n');
  failures.forEach(f => console.error('  FAIL ' + f));
  notes.forEach(n => console.log('  note ' + n));
  console.log('PC Safari ' + (result.safari || '') + ' (' + mode + '): ' + pass + ' passed, ' + fail + ' failed');
  process.exitCode = fail ? 1 : 0;
}
if (process.argv.includes('--pc')) runPC().catch(e => { console.error(e.stack); process.exitCode = 2; });

// ── S11: Premise Lookup ────────────────────────────────────────────────────────────────────────────────────────
// node tests/browser/run_safari.js --s11   Over http: start tests/browser/serve_case_strict.js, then
// SAFARI_PAGE_URL=http://127.0.0.1:8765/index.html node tests/browser/run_safari.js --s11
// In Safari at 1400 x 1000, with the S11 fixtures and CVI's module results (tests/oracle/s11_proximity_oracle.R):
//   - the Maps / Premise Lookup switch by a real click; three of CVI's Run query cases (Single, Concentric bands, the
//     origin endpoint with filters) set up in the sidebar and run by a real click on Run query: the summary and the
//     message equal CVI's module's; the match map drawn (WebGL in Safari: its own picture shows the Gold ring
//     outline); Pick on map with a real pointer click on the map; a cell opened by a real double-click and closed by
//     Escape;
//   - zone files read by Safari's own XML reader (KML) and its DecompressionStream (a zipped shapefile);
//   - Find coordinates with a geocode cache file: CVI's coordinates for a hit, the offline message for a miss, Add
//     site (real clicks);
//   - Preview branded map (a real click) within S9's 3 s Standard budget for the drawing; Export (a real click): the
//     ZIP handed to the download holds the matched rows exactly as CVI's Export CSV, the facilities and
//     export_params.json, and the PNG.
// Writes local-test-artifacts/s11/safari/safari_s11_<file|http>.json.
async function runS11() {
  const mode = PAGE.startsWith('file:') ? 'file' : 'http';
  const out = path.join(ROOT, 'local-test-artifacts', 's11', 'safari');
  fs.mkdirSync(out, { recursive: true });
  const fxFile = path.join(ROOT, 'local-test-artifacts', 's11', 'fixtures', 'scenarios.json');
  const refFile = path.join(ROOT, 'local-test-artifacts', 's11', 'oracle_s11.json');
  for (const f of [fxFile, refFile]) {
    if (!fs.existsSync(f)) { console.error('Missing ' + f + ' (the S11 fixtures and reference: tests/synthetic/make_s11_fixtures.js and tests/oracle/s11_proximity_oracle.R).'); process.exit(2); }
  }
  const FX = JSON.parse(fs.readFileSync(fxFile, 'utf8')), REF = JSON.parse(fs.readFileSync(refFile, 'utf8'));
  const fileArg = rel => [{ name: path.basename(rel), b64: fs.readFileSync(path.join(ROOT, rel)).toString('base64') }];
  const result = { page: PAGE, started: new Date().toISOString(),
    limitation: 'Synthetic FileList; network/CSP unobservable (the Chrome suite checks requests); the ZIP checked from the bytes handed to the download, not saved.' };
  let d, timer;
  try {
    d = await launch();
    result.safari = d.version;
    await d.size(1400, 1000);
    const cviPage = new URL('cvi/index.html', new URL('.', PAGE)).href;
    const PS = 'CVIWA.lookupState';
    const lines = id => d.run(`return [].slice.call(document.querySelectorAll('#' + args[0] + ' .status'))
      .map(function (e) { return { level: e.className.replace('status ', ''), text: e.textContent }; });`, id);
    const setValue = (id, v) => d.run(`var e = document.getElementById(args[0]); e.value = args[1];
      e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); return true;`, id, v);
    const idle = () => d.run(`await new Promise(function (res) { var m = ${PS}.map.map; m.once('idle', function () { res(true); });
      m.triggerRepaint(); setTimeout(function () { res(true); }, 5000); }); return true;`);

    async function suite() {
      await d.goto(cviPage);
      await d.waitFor('window.CVIWA && CVIWA.lookupState && CVIWA.state && CVIWA.state.mapHandle && CVIWA.state.mapHandle.ready', 30000, 'CVI page');
      await d.run(S7_ERROR_TRAP);
      await d.run(S7_CAPTURE);
      const full = FX.module.runs.find(r => r.name === 'single, three sites').master;
      const v0 = await d.run('return CVIWA.state.version;');
      await d.run(SET_FILES, '#file-input', fileArg(full));
      await d.waitFor('CVIWA.state.master && !CVIWA.state.loading && CVIWA.state.version > ' + v0, 20000, 'master loaded');
      await sleep(500);
      await d.click('#show-lookup');
      await d.waitFor(`${PS}.shown && !document.getElementById('lookup-main').hidden`, 10000, 'Premise Lookup shown');
      check(await d.run(`return !!document.getElementById('lk-run') && document.getElementById('map').closest('[hidden]') !== null;`),
        'S11 Safari: the switch shows Premise Lookup and hides the Maps side (a real click)');

      // ── Three of CVI's Run query cases ──
      for (const name of ['single, three sites', 'bands, global', 'origin endpoint, filters']) {
        const i = FX.module.runs.findIndex(r => r.name === name), cs = FX.module.runs[i], cvi = REF.module.runs[i];
        await d.run(`document.querySelector('input[name=lk-mode][value=' + args[0] + ']').click();
          document.querySelector('input[name=lk-endpoint][value=' + args[1] + ']').click(); return true;`, cs.mode,
        cs.endpoint === 'Origin' ? 'origin' : cs.endpoint === 'Destination' ? 'dest' : cs.endpoint);
        await setValue('lk-default', cs.default_buffer_km === null ? '' : String(cs.default_buffer_km));
        if (cs.band_radii !== undefined && cs.band_radii !== null) await setValue('lk-bands', String(cs.band_radii));
        await d.run(`var ps = ${PS}, cs = args[0], all = function (k, v) { return v && v.length ? v : k; };
          ps.years = all(ps.yearChoices.slice(), (cs.years || []).map(Number));
          ps.quarters = all(['Q1', 'Q2', 'Q3', 'Q4'], cs.quarters || []);
          ps.species = all(ps.speciesChoices.slice(), cs.species || []);
          ps.testSetSites(cs.sites); return true;`, cs);
        await d.click('#lk-run');
        await d.waitFor(`${PS}.result && document.querySelectorAll('#lk-run-lines .status').length`, 20000, 'run ' + name);
        const got = await d.run(`var s = ${PS}.result.summary; return { status: ${PS}.result.status, s: [s.cvis, s.animals,
          s.origins, s.dests, s.sitesHit] };`);
        const want = cvi.result.summary;
        const msg = await lines('lk-run-lines');
        check(got.status === cvi.result.status && JSON.stringify(got.s) === JSON.stringify([want.n_cvis, want.n_animals,
          want.n_origins, want.n_dests, want.n_sites_hit]) && msg.length === cvi.notes.length &&
          msg.every((m, k) => m.text === cvi.notes[k].text), 'S11 Safari: "' + name + '": the summary and message equal CVI\'s module\'s',
        { got, want, msg, notes: cvi.notes });
      }
      // The match map drawn by Safari (WebGL): its own picture shows the Gold ring outline (#fcb614).
      await d.waitFor(`${PS}.map && ${PS}.map.ready && ${PS}.map.drawn`, 20000, 'match map');
      await d.run(`document.getElementById('lookup-map').scrollIntoView({ block: 'center' }); return true;`);
      await idle();
      const gold = await d.run(`var blob = await CVIWA.map.screenshot(${PS}.map), img = await createImageBitmap(blob),
        cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
        var g = cv.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0);
        var px = g.getImageData(0, 0, img.width, img.height).data, n = 0;
        for (var i = 0; i < px.length; i += 4) if (Math.abs(px[i] - 252) < 20 && Math.abs(px[i + 1] - 182) < 24 && px[i + 2] < 70) n++;
        return { width: img.width, height: img.height, gold: n };`);
      result.matchMap = gold;
      check(gold.width > 300 && gold.gold > 40, 'S11 Safari: the match map draws the rings (its picture shows Gold outlines)', gold);

      // Pick on map: a real pointer click on the map fills in the latitude and longitude.
      await d.click('#lk-pick');
      const at = await d.run(`var m = ${PS}.map.map, r = m.getCanvas().getBoundingClientRect();
        return [r.left + r.width * 0.4, r.top + r.height * 0.45];`);
      await foreground();
      await d.pointer(at[0], at[1]);
      await sleep(300);
      // WebDriver clicks whole pixels: the picked point, put back on the map, lies within 2 px of the click.
      const picked = await d.run(`var m = ${PS}.map.map, r = m.getCanvas().getBoundingClientRect(),
        lat = document.getElementById('lk-new-lat').value, lon = document.getElementById('lk-new-long').value;
        var q = lat === '' ? null : m.project([Number(lon), Number(lat)]);
        return { lat: lat, long: lon, px: q ? [r.left + q.x, r.top + q.y] : null, click: [Math.round(args[0]), Math.round(args[1])] };`,
      at[0], at[1]);
      check(!!picked.px && Math.hypot(picked.px[0] - picked.click[0], picked.px[1] - picked.click[1]) <= 2,
        'S11 Safari: Pick on map: a real click fills in the coordinates of the point clicked', picked);
      await d.key('');
      await d.click('#lk-pick');
      await setValue('lk-new-lat', '');
      await setValue('lk-new-long', '');

      // A cell opened by a real double-click, closed by Escape.
      const cell = await d.run(`var td = document.querySelector('#lk-sites tbody tr td[data-field=name]');
        td.scrollIntoView({ block: 'center' }); var r = td.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2];`);
      await foreground();
      await d.pointer(cell[0], cell[1]);
      await d.pointer(cell[0], cell[1]);
      await sleep(200);
      const opened = await d.run(`return !!document.querySelector('#lk-sites td.editing input');`);
      await d.key('');
      await sleep(150);
      const closed = await d.run(`return !document.querySelector('#lk-sites td.editing');`);
      check(opened && closed, 'S11 Safari: a real double-click opens a cell, Escape closes it', { opened, closed });

      // ── Zones: KML (Safari's XML reader) and a zipped shapefile (its DecompressionStream) ──
      for (const [file, text] of [['zones.kml', 'Added 4 zone(s) from zones.kml. Left out 1 shape that is not a polygon.'],
        ['zones_shp.zip', 'Added 4 zone(s) from zones_shp.zip. Left out 1 shape that is not a polygon.']]) {
        await d.run(`var m = document.getElementById('lk-zone-msg'); m.replaceChildren(); m.hidden = true; return true;`);
        await d.run(SET_FILES, '#lk-zone-file', fileArg(path.join(FX.zones.dir, file)));
        await d.waitFor(`[].slice.call(document.querySelectorAll('#lk-zone-msg .status')).some(function (e) { return !/^Reading/.test(e.textContent); })`,
          15000, 'zones ' + file);
        const msg = await lines('lk-zone-msg');
        const zones = await d.run(`return ${PS}.sites.filter(function (s) { return s.zone && s.zoneFile === args[0]; }).length;`, file);
        check(msg[0] && msg[0].level === 'ok' && msg[0].text === text && zones === 4, 'S11 Safari: zones read from ' + file, { msg, zones });
      }

      // ── Find coordinates with a geocode cache file ──
      await d.run(SET_FILES, '#lk-geo-file', fileArg(path.join(FX.geocode.dir, 'cache_main.csv')));
      await d.waitFor(`[].slice.call(document.querySelectorAll('#lk-geo-msg .status')).some(function (e) { return !/^Reading /.test(e.textContent); })`,
        10000, 'cache loaded');
      const hit = REF.module.geocode.find(g => g.address === '1 Precise Pl, Spokane, WA' && g.cache === 'cache_main.csv');
      await setValue('lk-new-address', hit.address);
      await d.click('#lk-geo-find');
      const found = { msg: await lines('lk-geo-msg'), lat: await d.run(`return document.getElementById('lk-new-lat').value;`),
        long: await d.run(`return document.getElementById('lk-new-long').value;`) };
      check(found.msg[0] && found.msg[0].text === hit.text && Number(found.lat) === hit.lat && Number(found.long) === hit.long,
        'S11 Safari: Find coordinates: CVI\'s coordinates and text from the cache file (real click)', found);
      await setValue('lk-new-name', 'Found in Safari');
      const before = await d.run(`return ${PS}.sites.length;`);
      await d.click('#lk-add');
      const added = await d.run(`var s = ${PS}.sites[${PS}.sites.length - 1]; return { n: ${PS}.sites.length, name: s.name, lat: s.lat,
        long: s.long, address: document.getElementById('lk-new-address').value };`);
      check(added.n === before + 1 && added.name === 'Found in Safari' && added.lat === hit.lat && added.long === hit.long &&
        added.address === '', 'S11 Safari: Add site with the found coordinates, the address cleared', added);
      await setValue('lk-new-address', '999 Not Listed Ave, Tacoma, WA');
      await d.click('#lk-geo-find');
      const miss = await lines('lk-geo-msg');
      check(miss[0] && miss[0].text === 'No match for that address in the geocode cache file. Enter lat/long manually.',
        'S11 Safari: an address not in the file: the offline message', miss);

      // ── Search around a premises from your CVI file (2.2), by real clicks: the fold, a tick, the button ──
      await d.click('#lk-prem > summary');
      const premOpen = await d.run(`return document.getElementById('lk-prem').open && !document.getElementById('lk-prem-body').disabled
        && document.querySelectorAll('#lk-prem-list input').length > 0;`);
      const sitesBefore = await d.run(`return ${PS}.sites.length;`);
      await d.click('#lk-prem-list label:first-of-type input');
      const premButton = await d.run(`return document.getElementById('lk-prem-add-text').textContent;`);
      const premName = await d.run(`var g = ${PS}.prem.premises.filter(function (x) { return ${PS}.prem.ticked.has(x.key); });
        return g.length === 1 ? g[0].name : null;`);
      await d.click('#lk-prem-add');
      const premAdded = await d.run(`var s = ${PS}.sites; return { n: s.length, name: s[s.length - 1].name };`);
      check(premOpen && premButton === 'Search around 1 ticked premises' && premName && premAdded.n === sitesBefore + 1 &&
        premAdded.name === premName, 'S11 Safari: Search around a premises: the fold opened, one premises ticked and ' +
        'added as a site by real clicks', { premOpen, premButton, premName, premAdded });

      // ── Preview and Export (real clicks) on CVI's case "single, three sites" ──
      // The Full tier's facility files, as the landing page's hand-off gives them (the Chrome suite does the same),
      // handed over only now, so the three cases above compare Run query's lines with CVI's alone.
      const tier = path.join(ROOT, 'local-test-artifacts', 'f1', 'tiers', 'full');
      const facFiles = { manifest: 'facility_overlays_manifest.csv', slaughterhouses: 'usda_wa_slaughter_facilities.csv',
        fairgrounds: 'wa_state_fairs.csv', markets: 'wa_state_public_livestock_markets.csv', feedlots: 'wa_state_feedlots.csv',
        restricted: 'wa_state_restricted_holding_facilities.csv', syn_custommeat: 'synthetic_custom_meat_geocoded.csv',
        syn_disposal: 'synthetic_animal_disposal.csv' };
      const texts = {};
      Object.keys(facFiles).forEach(k => { texts[k] = fs.readFileSync(path.join(tier, facFiles[k]), 'utf8'); });
      await d.run(`var t = args[0], dd = {}; Object.keys(t).forEach(function (k) { dd[k] = { file: new Blob([t[k]], { type: 'text/csv' }) }; });
        await CVIWA.setFacilityFiles(dd); return true;`, texts);
      // 2.2: no layer ticked when the files arrive; the folded section opened and All clicked, as a user would.
      await d.waitFor(`document.querySelectorAll('#lk-fac-list input[id^=lk-layer-]').length > 0`, 15000, 'facility layers');
      const facStart = await d.run(`return { on: document.querySelectorAll('#lk-fac-list input:checked').length,
        open: document.getElementById('lk-fac-section').open, sum: document.getElementById('lk-fac-sum').textContent };`);
      await d.click('#lk-fac-section > summary');
      await d.click('#lk-fac-all');
      const facAll = await d.run(`return document.getElementById('lk-fac-sum').textContent;`);
      check(facStart.on === 0 && !facStart.open && facStart.sum === 'none ticked' && facAll === '7 of 7 ticked',
        'S11 Safari: facility files arrive with no layer ticked, the section folded; opened and All ticks every layer ' +
        '(real clicks)', { facStart, facAll });
      const ci = FX.module.runs.findIndex(r => r.name === 'single, three sites'), cs = FX.module.runs[ci];
      await d.run(`var ps = ${PS}; ps.years = ps.yearChoices.slice(); ps.quarters = ['Q1', 'Q2', 'Q3', 'Q4'];
        ps.species = ps.speciesChoices.slice();
        document.querySelector('input[name=lk-mode][value=single]').click();
        document.querySelector('input[name=lk-endpoint][value=either]').click(); ps.testSetSites(args[0]); return true;`, cs.sites);
      await setValue('lk-default', String(cs.default_buffer_km));
      await d.click('#lk-run');
      await d.waitFor(`${PS}.result && !document.getElementById('lk-export-card').hidden`, 20000, 'run for export');
      await setValue('lk-png-background', 'standard');
      const preview = async () => {
        await d.run(`${PS}.lastPreview = null; return true;`);
        await d.click('#lk-preview');
        await d.waitFor(`${PS}.lastPreview && document.getElementById('preview-dialog').open && !document.getElementById('lk-preview').disabled`,
          60000, 'preview');
        const info = await d.run(`var ps = ${PS}, img = await createImageBitmap(ps.lastPreview.blob);
          return { ms: ps.lastPng.ms, width: img.width, height: img.height, title: ps.lastPng.model.title };`);
        await d.run(`document.getElementById('preview-close').click(); return true;`);
        return info;
      };
      await preview();
      const pv = await preview();
      result.previewMs = pv.ms;
      check(pv.width === 2200 && pv.height === 1700 && pv.title === 'PREMISE PROXIMITY ASSESSMENT - ALL SPECIES - 3 SITES' &&
        pv.ms < 3000, 'S11 Safari: Preview branded map: the 2200 x 1700 page, drawn within the 3 s Standard budget', pv);
      await d.run(`window.__s7downloads.length = 0; ${PS}.lastExport = null; return true;`);
      await d.click('#lk-export');
      await d.waitFor(`${PS}.lastExport && window.__s7downloads.length && window.__s7downloads[0].b64`, 30000, 'export');
      const ex = await d.run(`var e = ${PS}.lastExport; return { zip: e.zipName, files: e.files.map(function (f) { return f.name; }),
        matches: e.files[0].text, saved: window.__s7downloads[0].name, bytes: window.__s7downloads[0].b64.length };`);
      check(ex.saved === ex.zip && ex.bytes > 1000 && ex.matches === REF.module.runs[ci].csv && ex.files.length === 4 &&
        /^premise_lookup_matches_/.test(ex.files[0]) && /^premise_lookup_facilities_/.test(ex.files[1]) &&
        ex.files.some(f => /^premise_proximity_.*\.png$/.test(f)) && ex.files.includes('export_params.json'),
      'S11 Safari: Export: the ZIP handed to the download, the matched rows exactly as CVI\'s Export CSV, the facilities, ' +
        'the PNG and export_params.json', { zip: ex.zip, files: ex.files, saved: ex.saved, bytes: ex.bytes });

      const errors = await d.run('var e = window.__errors || []; window.__errors = []; return e;');
      check(!errors.length, 'S11 Safari: no page errors', errors);
    }
    await Promise.race([suite(), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('S11 Safari eight-minute limit')), 480000);
    })]);
  } catch (e) {
    check(false, 'S11 Safari suite stopped', e && e.stack);
    try { fs.writeFileSync(path.join(out, 'safari_s11_' + mode + '_failed.png'), Buffer.from(await d.screenshot(), 'base64')); } catch (e2) { /* window may be gone */ }
  } finally {
    clearTimeout(timer);
    if (d) await d.close();
  }
  Object.assign(result, { passed: pass, failed: fail, failures, notes, finished: new Date().toISOString() });
  fs.writeFileSync(path.join(out, 'safari_s11_' + mode + '.json'), JSON.stringify(result, null, 2) + '\n');
  failures.forEach(f => console.error('  FAIL ' + f));
  notes.forEach(n => console.log('  note ' + n));
  console.log('S11 Safari ' + (result.safari || '') + ' (' + mode + '): ' + pass + ' passed, ' + fail + ' failed');
  process.exitCode = fail ? 1 : 0;
}
if (process.argv.includes('--s11')) runS11().catch(e => { console.error(e.stack); process.exitCode = 2; });

// ── AB: one all-in-one bundle for every dashboard ──────────────────────────────────────────────────────────────
// node tests/browser/run_safari.js --ab   Over http: start tests/browser/serve_case_strict.js, then
// SAFARI_PAGE_URL=http://127.0.0.1:8765/index.html node tests/browser/run_safari.js --ab
// In Safari at 1400 x 1000: the all-in-one sample loaded through the page's file input; both cards "Ready." with the
// release in the banner; a real click on the Infrastructure card opens Infrastructure in its own window with the
// facility files and the master while the landing page keeps CVI's checklist; the Full tier (bundle.json names CVI
// only): Infrastructure "Not listed in this bundle." and ready; the all-in-one sample built by Safari byte-identical
// to Node's (the saving itself is checked by hand). Writes local-test-artifacts/ab/safari/safari_ab_<mode>.json.
async function runAB() {
  const mode = PAGE.startsWith('file:') ? 'file' : 'http';
  const out = path.join(ROOT, 'local-test-artifacts', 'ab', 'safari');
  fs.mkdirSync(out, { recursive: true });
  const allZip = path.join(OUT, 'sample', 'WSDA_sample_all_dashboards_synthetic.zip');
  for (const f of [allZip, path.join(OUT, 'tiers', 'full.zip')]) {
    if (!fs.existsSync(f)) { console.error('Missing ' + f + ' (run node tests/node/run_f1_unit_tests.js first).'); process.exit(2); }
  }
  const result = { page: PAGE, started: new Date().toISOString(),
    limitation: 'Synthetic FileList (no folder paths); network/CSP unobservable; the sample checked from the bytes the button saves, not a saved file.' };
  const CARDS = `return Array.from(document.querySelectorAll('#profiles .card')).map(function(c){var b=c.querySelector('button[data-open]'),r=c.querySelector('.card-ready'),n=c.querySelector('.card-note');
    return {id:c.getAttribute('data-profile'), button:b?b.textContent:null, direct:b?b.getAttribute('data-direct'):null, ready:r&&!r.hidden?r.textContent:null,
      kind:r?r.getAttribute('data-ready'):null, note:n.hidden?null:n.textContent};});`;
  const SETTLED = `!WSDA.landing.state.loading && !WSDA.landing.checklist.state.busy && Array.from(document.querySelectorAll('#profiles .card-ready'))
    .every(function(r){return !r.hidden && r.getAttribute('data-ready') !== 'checking';})`;
  const card = (cs, id) => cs.find(c => c.id === id);
  const ALL_BANNER = 'All dashboards – synthetic sample bundle · prepared 2026-09-15 · covers 2024–2025 · release Synthetic sample, version 1, 2026-09-15';
  let d, timer;
  try {
    d = await launch();
    result.safari = d.version;
    await d.size(1400, 1000);
    async function suite() {
      await d.goto(PAGE);
      await d.waitFor('window.WSDA && WSDA.landing && WSDA.guide', 15000, 'landing page');
      await d.run('window.__errors=[];addEventListener("error",function(e){__errors.push(String(e.message))});addEventListener("unhandledrejection",function(e){__errors.push(String(e.reason))});return true;');
      const landing = await d.handle();

      // The all-in-one sample: both cards ready; the release in the banner
      let v0 = await d.run('return WSDA.landing.state.version;');
      await d.run(SET_FILES, '#files-input', [{ name: path.basename(allZip), b64: fs.readFileSync(allZip).toString('base64') }]);
      await d.waitFor('WSDA.landing.state.version > ' + v0 + ' && ' + SETTLED, 20000, 'all-in-one checked');
      let cs = await d.run(CARDS);
      const banner = await d.run(`var b=document.getElementById('bundle-banner');return b.hidden?null:b.textContent;`);
      check(card(cs, 'cvi').ready === 'Ready.' && card(cs, 'infrastructure').ready === 'Ready.' && card(cs, 'infrastructure').direct === '1'
        && card(cs, 'infrastructure').button === 'Open Infrastructure' && banner === ALL_BANNER && await d.run('return WSDA.landing.state.selected;') === 'cvi',
        'AB Safari: the all-in-one sample: both cards "Ready.", Infrastructure opens directly, the release in the banner', { cs, banner });
      fs.writeFileSync(path.join(out, 'safari_ab_' + mode + '_cards.png'), Buffer.from(await d.screenshot(), 'base64'));

      // A real click on the Infrastructure card opens it in its own window with its files
      const before = await d.handles();
      await d.click('#profiles button[data-open="infrastructure"]');
      let infra = null;
      for (let i = 0; i < 100 && !infra; i++) { infra = (await d.handles()).find(h => !before.includes(h)) || null; if (!infra) await sleep(100); }
      check(!!infra, 'AB Safari: a real click on the Infrastructure card opens a new window');
      if (infra) {
        await d.switchTo(infra);
        await d.waitFor('window.WSDA && WSDA.infrastructure && WSDA.infrastructure.state.version > 0 && !WSDA.infrastructure.state.loading && !WSDA.infrastructure.checklist.state.busy', 20000, 'Infrastructure loaded');
        const got = await d.run(`var b=document.getElementById('bundle-banner');return {files:Object.keys(WSDA.infrastructure.state.datasets).sort(), banner:b.hidden?null:b.textContent};`);
        check(got.files.join() === 'fairgrounds,feedlots,manifest,markets,master,restricted,slaughterhouses,syn_custommeat,syn_disposal' && got.banner === ALL_BANNER,
          'AB Safari: Infrastructure received the eight facility files, the master and the banner', got);
        await d.switchTo(landing);
        await d.waitFor(`/^Infrastructure is open in its own tab with your files/.test(document.getElementById('next-opened').textContent)`, 8000, 'opened report').catch(() => null);
        check(/^Infrastructure is open in its own tab with your files/.test(await d.run(`return document.getElementById('next-opened').textContent;`))
          && await d.run('return WSDA.landing.state.selected;') === 'cvi', 'AB Safari: the landing page confirms it and keeps CVI\'s checklist');
      }

      // The Full tier names CVI only: Infrastructure is not listed, ready, and opens directly (advice, not a lock)
      v0 = await d.run('return WSDA.landing.state.version;');
      await d.run(SET_FILES, '#files-input', [{ name: 'full.zip', b64: fs.readFileSync(path.join(OUT, 'tiers', 'full.zip')).toString('base64') }]);
      await d.waitFor('WSDA.landing.state.version > ' + v0 + ' && ' + SETTLED, 20000, 'Full tier checked');
      cs = await d.run(CARDS);
      check(card(cs, 'infrastructure').note === 'Not listed in this bundle.' && card(cs, 'infrastructure').ready === 'Ready.' && card(cs, 'infrastructure').direct === '1',
        'AB Safari: the Full tier: Infrastructure "Not listed in this bundle." and still ready to open', cs);

      // The guide's all-in-one sample, built by Safari: the same bytes as Node's
      const sample = await d.run(`var out=await WSDA.landing.ALL_IN_ONE.build(), b=out.bytes, s='';
        for (var i=0;i<b.length;i+=32768) s+=String.fromCharCode.apply(null,b.subarray(i,i+32768));
        return {fileName:out.fileName, b64:btoa(s), button:document.querySelector('button[data-sample="all"]').textContent};`).catch(e => ({ error: String(e) }));
      const want = fs.readFileSync(allZip), gotZip = sample.b64 ? Buffer.from(sample.b64, 'base64') : Buffer.alloc(0);
      check(sample.fileName === 'WSDA_sample_all_dashboards_synthetic.zip' && Buffer.compare(gotZip, want) === 0 && sample.button === 'Download a sample bundle (ZIP)',
        'AB Safari: the all-in-one sample built by Safari is byte-identical to Node\'s', { fileName: sample.fileName, error: sample.error, got: gotZip.length, want: want.length });
      const errors = await d.run('var e = window.__errors || []; window.__errors = []; return e;');
      check(!errors.length, 'AB Safari: no page errors', errors);
    }
    await Promise.race([suite(), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('AB Safari four-minute limit')), 240000);
    })]);
  } catch (e) {
    check(false, 'AB Safari suite stopped', e && e.stack);
    try { fs.writeFileSync(path.join(out, 'safari_ab_' + mode + '_failed.png'), Buffer.from(await d.screenshot(), 'base64')); } catch (e2) { /* window may be gone */ }
  } finally {
    clearTimeout(timer);
    if (d) await d.close();
  }
  Object.assign(result, { passed: pass, failed: fail, failures, notes, finished: new Date().toISOString() });
  fs.writeFileSync(path.join(out, 'safari_ab_' + mode + '.json'), JSON.stringify(result, null, 2) + '\n');
  failures.forEach(f => console.error('  FAIL ' + f));
  notes.forEach(n => console.log('  note ' + n));
  console.log('AB Safari ' + (result.safari || '') + ' (' + mode + '): ' + pass + ' passed, ' + fail + ' failed');
  process.exitCode = fail ? 1 : 0;
}
if (process.argv.includes('--ab')) runAB().catch(e => { console.error(e.stack); process.exitCode = 2; });

// ---- UI and style guide: node tests/browser/run_safari.js --ui ------------------------------------------------
// Over http: SAFARI_PAGE_URL=http://127.0.0.1:8765/index.html node tests/browser/run_safari.js --ui
// In Safari at 1400 x 1000, on the landing page, the CVI page (Full tier) and the Infrastructure dashboard (its sample):
// Open Sans loaded from the site, the logo drawn, one badge; the footer's glossary closed with its five terms, opened by
// a real click; the main buttons with their icons and one "Reset All"; on the CVI page a "?" note opened by a real click
// with its reworded text, Preview Stats with its added lines, "Show as table" under a chart (real click), County
// Focus's facility list with a mark per layer; Infrastructure's count cards with their marks. Writes
// local-test-artifacts/ui/safari/safari_ui_<mode>.json.
async function runUI() {
  const mode = PAGE.startsWith('file:') ? 'file' : 'http';
  const out = path.join(ROOT, 'local-test-artifacts', 'ui', 'safari');
  fs.mkdirSync(out, { recursive: true });
  const TABLES = path.join(ROOT, 'test-tables');
  const tierFull = path.join(TABLES, 'tier_full_master.csv'), infraZip = path.join(TABLES, 'infrastructure_synthetic.zip');
  for (const f of [tierFull, infraZip]) {
    if (!fs.existsSync(f)) { console.error('Missing ' + f + ' (run node tests/synthetic/make_test_tables.js first).'); process.exit(2); }
  }
  const result = { page: PAGE, started: new Date().toISOString() };
  const BRAND = `return {font: document.fonts.check('13.6px "Open Sans"') && Array.from(document.fonts).some(function(f){return f.family.replace(/"/g,'')==='Open Sans' && f.status==='loaded';}),
    logo: (function(i){return i ? [i.naturalWidth, i.naturalHeight] : null;})(document.querySelector('img[data-wsda-logo]')),
    badges: Array.from(document.querySelectorAll('.badge')).map(function(b){return b.textContent.trim();}),
    glossary: (function(g){return g ? {open: g.open, terms: Array.from(g.querySelectorAll('dt')).map(function(x){return x.textContent;})} : null;})(document.querySelector('footer.foot details.glossary')),
    icon: /^data:image\\/x-icon;base64,/.test(document.querySelector('link[rel="icon"]').href), title: document.title};`;
  const brandOk = (b, name) => {
    check(b.font && b.logo && b.logo[0] === 1760 && b.logo[1] === 724 && b.badges.length === 0,
      'UI Safari: ' + name + ': Open Sans loaded, the logo drawn, no badge', b);
    check(b.icon && / — /.test(b.title) && /WSDA Animal Services/.test(b.title), 'UI Safari: ' + name + ': the WSDA symbol as the tab icon, the tab title', b.title);
    // Five terms, with "Shaded map (choropleth)".
    check(b.glossary && !b.glossary.open && b.glossary.terms.join() === 'CVI,Premises,WA-to-WA,Bundle,Shaded map (choropleth)',
      'UI Safari: ' + name + ': the glossary in the footer, closed, five terms', b.glossary);
  };
  const glossaryClick = async name => {
    await d.run(`document.querySelector('footer.foot details.glossary').scrollIntoView(); return true;`);
    await d.click('footer.foot details.glossary summary');
    await sleep(300);
    check(await d.run(`return document.querySelector('footer.foot details.glossary').open;`), 'UI Safari: ' + name + ': a click opens the glossary');
  };
  let d, timer;
  try {
    d = await launch();
    result.safari = d.version;
    await d.size(1400, 1000);
    async function suite() {
      // Landing page
      await d.goto(PAGE);
      await d.waitFor('window.WSDA && WSDA.landing && document.fonts.status === "loaded"', 15000, 'landing page');
      await d.run('window.__errors=[];addEventListener("error",function(e){__errors.push(String(e.message))});return true;');
      brandOk(await d.run(BRAND), 'landing page');
      await glossaryClick('landing page');

      // CVI page with the Full tier
      await d.goto(new URL('cvi/index.html', new URL('.', PAGE)).href);
      await d.waitFor('window.CVIWA && CVIWA.state && CVIWA.state.mapHandle && document.fonts.status === "loaded"', 20000, 'CVI page');
      await d.run('window.__errors=[];addEventListener("error",function(e){__errors.push(String(e.message))});return true;');
      const v0 = await d.run('return CVIWA.state.version;');
      await d.run(SET_FILES, '#file-input', [{ name: 'tier_full_master.csv', b64: fs.readFileSync(tierFull).toString('base64') }]);
      await d.waitFor('CVIWA.state.master && !CVIWA.state.loading && CVIWA.state.version > ' + v0, 30000, 'master loaded');
      brandOk(await d.run(BRAND), 'CVI page');
      const buttons = await d.run(`return {reset: document.getElementById('reset-all').textContent.trim(),
        icons: ['run-export', 'preview-map', 'preview-stats', 'preview-charts', 'preview-table'].filter(function(id){var b=document.getElementById(id);return b && b.querySelector('.btn-icon svg');}).length};`);
      check(buttons.reset === 'Reset All' && buttons.icons === 5, 'UI Safari: CVI page: "Reset All", the export buttons with their icons', buttons);
      // A "?" note opened by a real click: the spotlight's, reworded.
      await d.run(`var b=document.querySelector('button.tip[data-help="spotlight"]'); b.scrollIntoView({block:'center'}); return true;`);
      await d.click('button.tip[data-help="spotlight"]');
      await sleep(300);
      const help = await d.run(`var n=document.getElementById('help-spotlight'); return {shown: !n.hidden, text: n.textContent,
        expanded: document.querySelector('button.tip[data-help="spotlight"]').getAttribute('aria-expanded')};`);
      check(help.shown && help.expanded === 'true' && help.text === 'Spotlighted counties stay at full strength; the others fade to about 10%. Leave empty to show every county the same.',
        'UI Safari: CVI page: a "?" opened by a click shows its reworded note', help);
      // Preview Stats: its added lines.
      await d.run(`var s=document.getElementById('export-section'); s.open=true; s.scrollIntoView(); return true;`);
      await d.click('#preview-stats');
      await d.waitFor(`document.getElementById('preview-dialog').open && document.querySelector('#preview-dialog .stats-text')`, 10000, 'stats');
      const stats = await d.run(`return document.querySelector('#preview-dialog .stats-text').textContent;`);
      check(/^  Quarters:  Q1, Q2, Q3, Q4$/m.test(stats) && /^  Unique CVIs:      [\d,]+$/m.test(stats) && /^  each end \(Inbound and Outbound\): [\d,]+ movements here\.$/m.test(stats)
        && /^CHANGE FROM THE PREVIOUS QUARTER \(\d{4} Q\d to \d{4} Q\d\)$/m.test(stats), 'UI Safari: CVI page: Preview Stats with the quarters, Unique CVIs, the note and the change',
      stats.split('\n').slice(8, 24));
      await d.run(`document.getElementById('preview-dialog').close(); return true;`);
      // "Show as table" under the first chart, by a real click.
      await d.run(`document.querySelector('[data-layout="split"]').click(); return true;`);
      await d.waitFor(`document.querySelector('#chart-grid .chart-card .chart-table-toggle')`, 15000, 'charts');
      await d.run(`document.querySelector('#chart-grid .chart-card .chart-table-toggle').scrollIntoView({block:'center'}); return true;`);
      await d.click('#chart-grid .chart-card .chart-table-toggle');
      await sleep(400);
      const table = await d.run(`var c=document.querySelector('#chart-grid .chart-card'), t=c.querySelector('.chart-table-toggle');
        return {text: t.textContent, expanded: t.getAttribute('aria-expanded'), rows: c.querySelectorAll('.chart-table tbody tr').length};`);
      check(table.text === 'Hide table' && table.expanded === 'true' && table.rows > 0, 'UI Safari: CVI page: "Show as table" opens the chart\'s numbers', table);
      // County Focus: the facility list draws a mark per layer.
      const facDir = path.join(TABLES, 'tier_full');
      const facFiles = fs.readdirSync(facDir).filter(f => /^(wa_state_|usda_wa_|synthetic_)/.test(f) && f.endsWith('.csv'));
      const texts = {};
      facFiles.forEach(f => { texts[f] = fs.readFileSync(path.join(facDir, f), 'utf8'); });
      await d.run(`document.getElementById('show-focus').click(); return true;`);
      await d.waitFor('CVIWA.state.focusHandle && CVIWA.state.focusHandle.ready', 20000, 'focus map');
      const marks = await d.run(`var t=args[0], files={}; Object.keys(t).forEach(function(k){files[k]=new File([t[k]], k, {type:'text/csv'});});
        var keyOf={'usda_wa_slaughter_facilities.csv':'slaughterhouses','wa_state_fairs.csv':'fairgrounds','wa_state_public_livestock_markets.csv':'markets',
          'wa_state_feedlots.csv':'feedlots','wa_state_restricted_holding_facilities.csv':'restricted'};
        var d0={}; Object.keys(files).forEach(function(n){ if (keyOf[n]) d0[keyOf[n]]={file:files[n]}; });
        await CVIWA.setFacilityFiles(d0); await new Promise(function(r){setTimeout(r,800);});
        return Array.from(document.querySelectorAll('#fo-fac-list .facility-mark-box')).map(function(m){return m.dataset.shape + ' ' + (m.querySelector('svg') ? 'svg' : 'none');});`, texts);
      check(marks.length === 5 && new Set(marks.map(m => m.split(' ')[0])).size === 5 && marks.every(m => / svg$/.test(m)),
        'UI Safari: County Focus: five facility layers, five different marks drawn', marks);
      await glossaryClick('CVI page');
      let errors = await d.run('var e = window.__errors || []; window.__errors = []; return e;');
      check(!errors.length, 'UI Safari: CVI page: no page errors', errors);
      fs.writeFileSync(path.join(out, 'safari_ui_' + mode + '_cvi.png'), Buffer.from(await d.screenshot(), 'base64'));

      // Infrastructure dashboard with its sample
      await d.goto(new URL('infrastructure/index.html', new URL('.', PAGE)).href);
      await d.waitFor('window.WSDA && WSDA.infrastructure && WSDA.infrastructure.state && document.fonts.status === "loaded"', 20000, 'Infrastructure');
      await d.run('window.__errors=[];addEventListener("error",function(e){__errors.push(String(e.message))});return true;');
      await d.run(SET_FILES, '#files-input', [{ name: 'infrastructure_synthetic.zip', b64: fs.readFileSync(infraZip).toString('base64') }]);
      await d.waitFor('WSDA.infrastructure.state.facilityFiles > 0 && !WSDA.infrastructure.state.loading', 30000, 'sample loaded');
      await sleep(1000);
      brandOk(await d.run(BRAND), 'Infrastructure');
      const cards = await d.run(`return Array.from(document.querySelectorAll('#facility-cards .facility-mark-box')).map(function(m){return m.dataset.shape;});`);
      check(cards.length >= 5 && new Set(cards).size === cards.length, 'UI Safari: Infrastructure: each count card with its own mark', cards);
      await glossaryClick('Infrastructure');
      errors = await d.run('var e = window.__errors || []; window.__errors = []; return e;');
      check(!errors.length, 'UI Safari: Infrastructure: no page errors', errors);
    }
    await Promise.race([suite(), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('UI Safari four-minute limit')), 240000);
    })]);
  } catch (e) {
    check(false, 'UI Safari suite stopped', e && e.stack);
    try { fs.writeFileSync(path.join(out, 'safari_ui_' + mode + '_failed.png'), Buffer.from(await d.screenshot(), 'base64')); } catch (e2) { /* window may be gone */ }
  } finally {
    clearTimeout(timer);
    if (d) await d.close();
  }
  Object.assign(result, { passed: pass, failed: fail, failures, notes, finished: new Date().toISOString() });
  fs.writeFileSync(path.join(out, 'safari_ui_' + mode + '.json'), JSON.stringify(result, null, 2) + '\n');
  failures.forEach(f => console.error('  FAIL ' + f));
  console.log('UI Safari ' + (result.safari || '') + ' (' + mode + '): ' + pass + ' passed, ' + fail + ' failed');
  process.exitCode = fail ? 1 : 0;
}
if (process.argv.includes('--ui')) runUI().catch(e => { console.error(e.stack); process.exitCode = 2; });

// ── The WA State and County Focus GIF, and the shaded maps ────────────────────────────────────────────────────────
// Shared by --gif and --ch: the CVI page opened in Safari at 1400 x 1000 with the Full tier
// (test-tables/tier_full_master.csv), page errors trapped, and the export's ZIP kept from the bytes handed to the
// download (S7_CAPTURE: nothing is saved).
async function partOpenCvi(d) {
  await d.size(1400, 1000);
  await d.goto(new URL('cvi/index.html', new URL('.', PAGE)).href);
  await d.waitFor('window.CVIWA && CVIWA.timeseries && CVIWA.choropleth && CVIWA.state && CVIWA.state.mapHandle && ' +
    'CVIWA.state.mapHandle.ready', 30000, 'CVI page');
  await d.run(S7_ERROR_TRAP);
  await d.run(S7_CAPTURE);
  const v0 = await d.run('return CVIWA.state.version;');
  await d.run(SET_FILES, '#file-input', [{ name: path.basename(MC_TIER_FULL), b64: fs.readFileSync(MC_TIER_FULL).toString('base64') }]);
  await d.waitFor('CVIWA.state.master && !CVIWA.state.loading && CVIWA.state.version > ' + v0, 20000, 'master loaded');
  await sleep(800);
}
// A real click on Export, then the ZIP's entries from the captured download.
async function partExport(d) {
  const n = await d.run('return window.__s7downloads.length;');
  await d.run(`document.getElementById('export-section').open = true;
    document.getElementById('run-export').scrollIntoView({ block: 'center' }); return true;`);
  await d.click('#run-export');
  await d.waitFor('!CVIWA.state.exporting && window.__s7downloads.length > ' + n + ' && window.__s7downloads[' + n + '].b64',
    120000, 'export');
  const dl = await d.run('return window.__s7downloads[' + n + '];');
  return s7ReadZip(Buffer.from(dl.b64, 'base64'));
}
// Only the given export formats ticked (the boxes set as the Chrome suites set them; Export itself is a real click).
const CO_FORMATS = `var list = args[0];
  document.getElementById('export-section').open = true;
  document.querySelectorAll('input[name=export-format]').forEach(function (i) { if (!i.disabled) i.checked = list.indexOf(i.value) >= 0; });
  document.getElementById('export-gif').dispatchEvent(new Event('change'));
  var s = document.getElementById('export-gif-by'); s.value = 'quarter'; s.dispatchEvent(new Event('change'));
  return true;`;
// Safari's own decoder opens a GIF (base64): its size, and the share of its first frame's pixels equal to the
// page the GIF's first frame was drawn from.
const CO_GIF_FIRST = `var bin = atob(args[0]), u = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  var url = URL.createObjectURL(new Blob([u], { type: 'image/gif' })), img = new Image();
  await new Promise(function (res, rej) { img.onload = res; img.onerror = function () { rej(new Error('GIF not opened')); }; img.src = url; });
  var cv = document.createElement('canvas'); cv.width = img.naturalWidth; cv.height = img.naturalHeight;
  var g = cv.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0);
  var got = g.getImageData(0, 0, cv.width, cv.height).data;
  var size = CVIWA.timeseries.size(), B = WSDA.branded;
  // The first frame scored against the page drawn for frame 1 and for frame 2, so a GIF that opened on
  // the wrong frame fails (the two pages differ only in their circles and the period strip).
  var score = async function (parts) {
    var want = (await B.pixels(B.svg(parts, size), size)).data, same = 0;
    for (var k = 0; k < got.length; k += 4) if (got[k] === want[k] && got[k + 1] === want[k + 1] && got[k + 2] === want[k + 2]) same++;
    return same / (got.length / 4);
  };
  var same = await score(CVIWA.state.lastGif.parts[0]), other = await score(CVIWA.state.lastGif.parts[1]);
  URL.revokeObjectURL(url);
  return { width: img.naturalWidth, height: img.naturalHeight, same: same, other: other };`;
async function partRun(name, file, body) {
  const mode = PAGE.startsWith('file:') ? 'file' : 'http';
  const out = path.join(ROOT, 'local-test-artifacts', 'safari');
  fs.mkdirSync(out, { recursive: true });
  if (!fs.existsSync(MC_TIER_FULL)) { console.error('Missing ' + MC_TIER_FULL + ' (run node tests/synthetic/make_test_tables.js).'); process.exit(2); }
  const result = { page: PAGE, started: new Date().toISOString(),
    limitation: 'Synthetic FileList; network/CSP unobservable; the ZIP checked from the bytes handed to the download, not saved.' };
  let d, timer;
  try {
    d = await launch();
    result.safari = d.version;
    await Promise.race([body(d, result), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(name + ' Safari eight-minute limit')), 480000);
    })]);
    const errors = await d.run('var e = window.__errors || []; window.__errors = []; return e;');
    check(!errors.length, name + ' Safari: no page errors (window.onerror and unhandled rejections)', errors);
  } catch (e) {
    check(false, name + ' Safari suite stopped', e && e.stack);
    try { fs.writeFileSync(path.join(out, 'safari_' + file + '_' + mode + '_failed.png'), Buffer.from(await d.screenshot(), 'base64')); } catch (e2) { /* window may be gone */ }
  } finally {
    clearTimeout(timer);
    if (d) await d.close();
  }
  Object.assign(result, { passed: pass, failed: fail, failures, notes, finished: new Date().toISOString() });
  fs.writeFileSync(path.join(out, 'safari_' + file + '_' + mode + '.json'), JSON.stringify(result, null, 2) + '\n');
  failures.forEach(f => console.error('  FAIL ' + f));
  notes.forEach(n => console.log('  note ' + n));
  console.log(name + ' Safari ' + (result.safari || '') + ' (' + mode + '): ' + pass + ' passed, ' + fail + ' failed');
  process.exitCode = fail ? 1 : 0;
}

// ---- The WA State and County Focus GIF: node tests/browser/run_safari.js --gif -------------------------------------
// Over http: SAFARI_PAGE_URL=http://127.0.0.1:8765/index.html node tests/browser/run_safari.js --gif
// With real pointer clicks: the GIF box offered on WA State, grayed with its reason while "Show lines between WA
// counties" is on and free again after; Export by quarter: the ZIP's GIF under CVI's name pattern, export_params.json's
// interval, "GIF frame i of n: label" for each frame; the file read block by block here (GIF89a, 1650 x 1275, loop
// forever, one frame per quarter, 0.8 s and the last 2.4 s); Safari's own decoder opens it and its first frame
// matches the page drawn for it. The same on County Focus (two counties), with the box grayed while "Hide CVI
// circles" is on. Writes local-test-artifacts/safari/safari_gif_<file|http>.json.
async function runGIF() {
  await partRun('GIF', 'gif', async (d, result) => {
    await partOpenCvi(d);
    const box = `var g = document.getElementById('export-gif'), w = document.getElementById('export-gif-why');
      return { shown: g.getClientRects().length > 0, disabled: g.disabled, why: w.hidden ? null : w.textContent };`;
    // The box grayed while a switch is on (a real click on, then off).
    const grayedBy = async (id, reason, tag) => {
      await d.click('#' + id);
      await sleep(1200);
      const on = await d.run(box);
      check(on.disabled && on.why !== null && reason.test(on.why), 'GIF Safari: ' + tag + ': grayed with its reason', on);
      await d.click('#' + id);
      await sleep(1200);
      const off = await d.run(box);
      check(off.shown && !off.disabled && off.why === null, 'GIF Safari: ' + tag + ': free again after', off);
    };
    result.views = {};
    for (const view of ['wa', 'focus']) {
      const tag = view === 'wa' ? 'WA State' : 'County Focus';
      await d.click('#show-' + view);
      const handle = view === 'wa' ? 'mapHandle' : 'focusHandle';
      await d.waitFor('CVIWA.state.' + handle + ' && CVIWA.state.' + handle + '.ready', 30000, view + ' map');
      if (view === 'focus') {
        await d.run(`var boxes = [].slice.call(document.querySelectorAll('#fo-counties input'));
          boxes.forEach(function (b, i) { if (b.checked !== (i < 2)) { b.checked = i < 2; b.dispatchEvent(new Event('change')); } }); return true;`);
      }
      await sleep(900);
      await d.run(`document.getElementById('export-section').open = true; return true;`);
      const at = await d.run(box);
      check(at.shown && !at.disabled, 'GIF Safari: ' + tag + ' offers the GIF', at);
      if (view === 'wa') await grayedBy('mv-on', /Show lines between WA counties/, 'WA State, movement lines on');
      else await grayedBy('fo-hide', /Hide CVI circles/, 'County Focus, "Hide CVI circles" on');
      await d.run(CO_FORMATS, ['branded_gif']);
      await d.run(`window.__gifTexts = []; var t = document.getElementById('gif-progress-text');
        new MutationObserver(function () { if (t.textContent && window.__gifTexts[window.__gifTexts.length - 1] !== t.textContent) window.__gifTexts.push(t.textContent); })
          .observe(t, { childList: true, characterData: true, subtree: true }); return true;`);
      const t0 = Date.now();
      const entries = await partExport(d);
      const ms = Date.now() - t0;
      const lg = await d.run(`var g = CVIWA.state.lastGif; return { view: g.view, labels: g.models.map(function (m) { return m.frame.label; }),
        delays: g.models.map(function (m) { return m.frame.delay; }), texts: window.__gifTexts };`);
      // The frames the view should have, worked out here from the loaded rows (not from the GIF's code):
      // each year-quarter of 2024 and 2025 holding a row the view draws (WA State: an Inbound or Outbound row; County
      // Focus: an Inbound row into, or an Outbound row out of, the two counties ticked), in time order.
      const expected = await d.run(`var rows = CVIWA.state.master.rows, view = args[0], seen = {};
        var picked = [].slice.call(document.querySelectorAll('#fo-counties input')).filter(function (b) { return b.checked; })
          .map(function (b) { return b.value; });
        rows.forEach(function (r) {
          if (r['Reporting.Year'] !== 2024 && r['Reporting.Year'] !== 2025) return;
          var inb = r.Movement === 'Inbound', outb = r.Movement === 'Outbound';
          if (!inb && !outb) return;
          if (view === 'focus' && !((inb && picked.indexOf(r['Dest.County']) >= 0) || (outb && picked.indexOf(r['Origin.County']) >= 0))) return;
          seen[r['Reporting.Year'] + '-' + r['Reporting.Quarter']] = true;
        });
        return Object.keys(seen).sort();`, view);
      check(JSON.stringify(lg.labels) === JSON.stringify(expected), 'GIF Safari: ' + tag + ': a frame for each quarter ' +
        'that has rows in the view, in time order', { got: lg.labels, expected });
      const want = view === 'wa' ? /\/CVI_County_Map_TimeSeries_2024-2025_INB\+OUT\.gif$/
        : /\/CVI_CountyFocus_TimeSeries_[A-Za-z-]+_[A-Za-z0-9-]+_2024-2025\.gif$/;
      const gif = entries.find(e => /\.gif$/.test(e.name));
      check(!!gif && want.test(gif.name) && lg.view === view, 'GIF Safari: ' + tag + ': the ZIP holds the GIF under its name',
        entries.map(e => e.name));
      const params = (entries.find(e => e.name.endsWith('/export_params.json')) || { data: Buffer.from('') }).data.toString('utf8');
      check(params.includes('"gif_frame_interval": "quarter"'), 'GIF Safari: ' + tag + ': export_params.json names the frame interval');
      const blocks = gif ? s9GifBlocks(gif.data) : null;
      const n = lg.labels.length;
      check(blocks && blocks.signature === 'GIF89a' && blocks.width === 1650 && blocks.height === 1275 && blocks.loop === 0 &&
        blocks.trailer && !blocks.error, 'GIF Safari: ' + tag + ': the GIF\'s screen, endless loop and trailer',
      blocks && Object.assign({}, blocks, { frames: blocks.frames.length }));
      check(blocks && n > 1 && blocks.frames.length === n &&
        JSON.stringify(blocks.frames.map(f => f.delay)) === JSON.stringify(lg.delays) && lg.delays[n - 1] === 240 &&
        lg.delays.slice(0, -1).every(x => x === 80) && blocks.frames.every(f => f.width === 1650 && f.height === 1275),
      'GIF Safari: ' + tag + ': one frame per quarter, 0.8 s and the last 2.4 s', blocks && blocks.frames.map(f => f.delay));
      check(JSON.stringify(lg.texts) === JSON.stringify(['Preparing the GIF frames…'].concat(lg.labels.map((l, i) =>
        'GIF frame ' + (i + 1) + ' of ' + n + ': ' + l))), 'GIF Safari: ' + tag + ': "GIF frame i of n: label" for each frame', lg.texts);
      const shown = await d.run(CO_GIF_FIRST, gif ? gif.data.toString('base64') : '');
      check(shown.width === 1650 && shown.height === 1275 && shown.same > 0.97 && shown.same - shown.other > 0.002,
        'GIF Safari: ' + tag + ': Safari opens the GIF; its first frame matches the first page, clearly better than the ' +
        'second', shown);
      result.views[view] = { frames: n, bytes: gif && gif.data.length, firstFrameSame: shown.same, exportMs: ms };
    }
  });
}
if (process.argv.includes('--gif')) runGIF().catch(e => { console.error(e.stack); process.exitCode = 2; });

// ---- Shaded counties and states: node tests/browser/run_safari.js --ch ---------------------------------------------
// Over http: SAFARI_PAGE_URL=http://127.0.0.1:8765/index.html node tests/browser/run_safari.js --ch
// The page expressions are the Chrome suite's own (tests/browser/run_ch_browser.js, read from its source, not run),
// so both browsers judge the shading the same way. With real pointer clicks: WA State's "Show counties as: Shaded
// counties": the controls that follow (Display Mode and Color palette grayed with their reasons), every county's
// drawn fill its class's color, white county lines, a county's rendered pixel in its class color at 80%; Outbound
// unticked (a real click), Inbound drawn in the Blues; then Outbound and 2024 only: Preview Map's page shaded as the
// live map, and its pixels as Safari draws the PNG (each county in its class color at the fill opacity, or the
// hatch); Export with the PNG and the GIF (export_params.json records the shaded map; every GIF frame shaded with one
// set of classes); back to Circles. National Flow's "Show states as: Shaded states": no lines, each state's fill its
// class's color, Washington white, white state lines; Preview Map's page shaded as the live map with no lines; back
// to Lines. Writes local-test-artifacts/safari/safari_ch_<file|http>.json.
// The Chrome suite's source, read when the CH step first needs it (read at load, every Safari mode would fail to start
// without that file).
let CH_SRC = null;
// One of the Chrome suite's top-level constants (a page expression, or a function returning one), evaluated here. A
// constant runs from its "const NAME = " line to the next line starting at column 0 with a declaration or a comment
// (the nine read here all end so; anything else after one would be read as part of it and fail to evaluate).
function chConst(name) {
  if (CH_SRC === null) CH_SRC = fs.readFileSync(path.join(ROOT, 'tests', 'browser', 'run_ch_browser.js'), 'utf8');
  const head = '\nconst ' + name + ' = ';
  const start = CH_SRC.indexOf(head);
  if (start < 0) throw new Error('tests/browser/run_ch_browser.js has no constant ' + name);
  const rest = CH_SRC.slice(start + head.length);
  const end = rest.search(/\n(const |let |function |async function |\/\/ )/);
  return new Function('return ' + rest.slice(0, end).trim().replace(/;$/, ''))();
}
async function runCH() {
  await partRun('CH', 'ch', async (d, result) => {
    const UI = chConst('UI'), EXPECT = chConst('EXPECT'), DRAWN = chConst('DRAWN'), PIXEL = chConst('PIXEL');
    const WA_PNG_PIXELS = chConst('WA_PNG_PIXELS'), FLOW_UI = chConst('FLOW_UI'), FLOW_EXPECT = chConst('FLOW_EXPECT');
    const FLOW_DRAWN = chConst('FLOW_DRAWN'), FLOW_PIXEL = chConst('FLOW_PIXEL');
    const ev = expr => d.run('return ' + expr + ';');
    const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
    const blend = (c, a, under) => c.map((x, i) => Math.round(x * a + under[i] * (1 - a)));
    const close = (a, b, tol) => a.every((x, i) => Math.abs(x - b[i]) <= tol);
    // A real click, then the map's next drawing.
    const act = async (sel, counter) => {
      const v = await ev(counter);
      await d.click(sel);
      await d.waitFor(counter + ' > ' + v, 8000, 'redrawn after ' + sel);
      await sleep(400);
    };
    await partOpenCvi(d);
    const W = 'CVIWA.state.version';

    // WA State: Shaded counties.
    await act('input[name=wa-shape][value="shaded"]', W);
    let ui = await ev(UI);
    check(ui.shape === 'shaded' && !ui.measureHidden && !ui.classesHidden && ui.scalingHidden && ui.opacityLabel ===
      'Fill opacity' && ui.opacity === '0.8' && ui.classes === 'natural', 'CH Safari: WA State: Shaded counties shows ' +
      'Measure, Shading classes (Natural breaks) and Fill opacity 80%, Circle size scaling hidden', ui);
    check(ui.modeDisabled && !ui.modeReasonHidden && ui.paletteDisabled && !ui.paletteReasonHidden,
      'CH Safari: WA State: Display Mode and Color palette grayed with their reasons', ui);
    let exp = await ev(EXPECT), drawn = await ev(DRAWN('mapHandle'));
    check(drawn.length === 39 && JSON.stringify(drawn) === JSON.stringify(exp[0]), 'CH Safari: WA State: each county\'s ' +
      'drawn fill is its class\'s color', { drawn: drawn.slice(0, 3), exp: exp[0].slice(0, 3) });
    check(await ev(`CVIWA.state.mapHandle.map.getPaintProperty('county-lines', 'line-color')`) === '#ffffff',
      'CH Safari: WA State: county lines white');
    const one = exp[0].find(c => !c.none);
    const px = await ev(PIXEL('mapHandle', one.name));
    const wantPx = blend(hex(one.color), 0.8, hex('#ececec'));
    check(close(px, wantPx, 8), 'CH Safari: WA State: ' + one.name + ' rendered in its class color at 80%', { px, want: wantPx });
    const legend = await ev(`document.getElementById('legend-panel').textContent`);
    check(/Total animals \(Combined\)/.test(legend) && /No movements/.test(legend), 'CH Safari: WA State: the legend', legend);
    // Direction is a pair of boxes, both ticked: a real click unticks Outbound, leaving Inbound.
    await act('input[name=direction][value="Outbound"]', W);
    exp = await ev(EXPECT);
    drawn = await ev(DRAWN('mapHandle'));
    const blues = await ev(`CVIWA.choropleth.FIVE.Inbound`);
    check(JSON.stringify(drawn) === JSON.stringify(exp[0]) && drawn.filter(c => !c.none).every(c => blues.indexOf(c.color) >= 0),
      'CH Safari: WA State: Outbound unticked (a real click): Inbound drawn in the Blues, each fill its class\'s', drawn.slice(0, 3));

    // Outbound and 2024 only (real clicks), as the Chrome suite's PNG part: some counties then have no movements, so
    // the PNG draws the hatch too.
    await act('input[name=direction][value="Outbound"]', W);
    await act('input[name=direction][value="Inbound"]', W);
    // The year boxes are in the closed Period fold: a real click opens it first.
    await d.click('#period-block > summary');
    await sleep(300);
    await act('#f-years input[value="2025"]', W);
    // Preview Map, then the PNG's pixels as Safari draws them.
    await d.run(`CVIWA.state.lastBranded = null; document.getElementById('export-section').open = true;
      document.getElementById('preview-map').scrollIntoView({ block: 'center' }); return true;`);
    await d.click('#preview-map');
    await d.waitFor('CVIWA.state.lastBranded && !CVIWA.state.exporting && CVIWA.previews.isOpen()', 60000, 'WA preview');
    await d.run('CVIWA.previews.close(); return true;');
    const model = await ev(`(() => { const m = CVIWA.state.lastBranded.models[0]; return { circles: m.circles && m.circles.length,
      breaks: m.shade && m.shade.breaks, counties: m.shade && m.shade.counties.map(c => [c.name, c.none ? null : c.color]) }; })()`);
    const live = await ev(`({ breaks: CVIWA.state.shade.cls.breaks, counties: CVIWA.state.mapHandle.shadeDrawn.map(c => [c.name, c.none ? null : c.color]) })`);
    check(JSON.stringify(model.breaks) === JSON.stringify(live.breaks) && JSON.stringify(model.counties) ===
      JSON.stringify(live.counties) && model.circles === 0, 'CH Safari: WA State: Preview Map\'s page shaded as the live map', model);
    const png = await d.run('return await ' + WA_PNG_PIXELS + ';');
    const missing = png.samples.filter(x => x.missing).map(x => x.name);
    const bad = png.samples.filter(x => !x.missing).filter(x => (x.none
      ? !(x.px.every(v => v >= 185) && Math.max(...x.px) - Math.min(...x.px) <= 8)
      : !close(x.px, blend(hex(x.color), png.opacity, [255, 255, 255]), 8)));
    check(missing.length <= 4 && png.samples.length === 39 && !bad.length && png.samples.some(x => x.none),
      'CH Safari: WA State, Outbound 2024: the PNG drawn by Safari, each county in its class color at the fill ' +
      'opacity, or the hatch (some hatched)', { missing, bad: bad.slice(0, 4), hatched: png.samples.filter(x => x.none).length });
    result.waPng = { samples: png.samples.length, missing: missing.length, hatched: png.samples.filter(x => x.none).length };

    // Export: the PNG and the GIF.
    await d.run(CO_FORMATS, ['branded_png', 'branded_gif']);
    const entries = await partExport(d);
    const names = entries.map(e => e.name.split('/').pop());
    check(names.some(n => /^CVI_County_Map_.*\.png$/.test(n)) && names.some(n => /TimeSeries.*\.gif$/.test(n)),
      'CH Safari: WA State: the export holds the PNG and the GIF', names);
    const params = JSON.parse((entries.find(e => /export_params\.json$/.test(e.name)) || { data: '{}' }).data.toString());
    check(params.map_style === 'shaded' && params.shade_measure === 'total_animals' && params.shade_classes === 'natural_breaks',
      'CH Safari: WA State: export_params.json records the shaded map', params);
    const gifBreaks = await ev(`CVIWA.state.lastGif.models.map(m => m.shade && m.shade.breaks)`);
    check(gifBreaks.length > 1 && gifBreaks.every(x => x && JSON.stringify(x) === JSON.stringify(gifBreaks[0])),
      'CH Safari: WA State: every GIF frame shaded with one set of classes', gifBreaks.length);
    await act('input[name=wa-shape][value="circles"]', W);
    ui = await ev(UI);
    check(ui.shape === 'circles' && ui.opacityLabel === 'Circle opacity' && await ev(`CVIWA.state.mapHandle.shadeDrawn.length === 0`),
      'CH Safari: WA State: back on Circles, nothing shaded', ui);

    // National Flow: Shaded states.
    await d.click('#show-flow');
    await d.waitFor('CVIWA.state.flowHandle && CVIWA.state.flowHandle.ready && CVIWA.flowState.drawn', 30000, 'flow map');
    await sleep(800);
    const F = 'CVIWA.flowState.version';
    await act('input[name=fl-shape][value="shaded"]', F);
    const fu = await ev(FLOW_UI);
    check(fu.shape === 'shaded' && !fu.classesHidden && fu.scalingHidden && fu.multDisabled && fu.multReason &&
      fu.paletteDisabled && fu.paletteReason, 'CH Safari: National Flow: Shaded states, the line controls grayed with their reasons', fu);
    check(await ev(`CVIWA.state.flowHandle.drawn.length === 0`), 'CH Safari: National Flow: no lines drawn while shaded');
    const fexp = await ev(FLOW_EXPECT), fdrawn = await ev(FLOW_DRAWN);
    check(fexp.length > 0 && JSON.stringify(fdrawn) === JSON.stringify(fexp), 'CH Safari: National Flow: each state\'s fill ' +
      'is its class\'s color', { drawn: fdrawn.slice(0, 3), exp: fexp.slice(0, 3) });
    const st0 = fexp.find(x => x.color && x.code !== 'WA');
    const spx = await ev(FLOW_PIXEL(st0.code));
    check(close(spx, blend(hex(st0.color), 0.8, hex('#ececec')), 10), 'CH Safari: National Flow: ' + st0.code +
      ' rendered in its class color', { px: spx, want: blend(hex(st0.color), 0.8, hex('#ececec')) });
    const wa = await ev(FLOW_PIXEL('WA'));
    check(wa.every(x => x >= 250), 'CH Safari: National Flow: Washington drawn white', wa);
    check(await ev(`CVIWA.state.flowHandle.map.getPaintProperty('state-lines', 'line-color')`) === '#ffffff',
      'CH Safari: National Flow: state lines white while shaded');
    await d.run(`CVIWA.state.lastBranded = null; document.getElementById('preview-map').scrollIntoView({ block: 'center' }); return true;`);
    await d.click('#preview-map');
    await d.waitFor('CVIWA.state.lastBranded && !CVIWA.state.exporting && CVIWA.previews.isOpen()', 60000, 'Flow preview');
    await d.run('CVIWA.previews.close(); return true;');
    const fm = await ev(`(() => { const m = CVIWA.state.lastBranded.models[0]; return { lines: m.lines && m.lines.length,
      breaks: m.shade && m.shade.breaks, states: m.shade && m.shade.states.map(x => [x.code, x.color]) }; })()`);
    const fl = await ev(`({ breaks: CVIWA.flowState.shade.cls.breaks, states: CVIWA.flowState.shade.states.map(s => [s.code, s.none ? null : s.color]) })`);
    check(JSON.stringify(fm.breaks) === JSON.stringify(fl.breaks) && JSON.stringify(fm.states) === JSON.stringify(fl.states) &&
      fm.lines === 0, 'CH Safari: National Flow: Preview Map\'s page shaded as the live map, no lines', fm);
    await act('input[name=fl-shape][value="lines"]', F);
    check(await ev(`CVIWA.state.flowHandle.drawn.length > 0 && CVIWA.state.flowHandle.shadeDrawn.length === 0`),
      'CH Safari: National Flow: back on Lines, the lines drawn again');
  });
}
if (process.argv.includes('--ch')) runCH().catch(e => { console.error(e.stack); process.exitCode = 2; });

// ---- Emergency Response: node tests/browser/run_safari.js --em ------------------------------------------------------
// Over http: SAFARI_PAGE_URL=http://127.0.0.1:8765/index.html node tests/browser/run_safari.js --em
// In Safari at 1400 x 1000: the folder bundle with a GeoJSON zone (test-tables/em_bundle) loaded on the landing page is
// checked for Emergency; a real click on its Open button opens the Emergency page in its own window with the
// positives, the feedlots and the zone file unchanged; on the Emergency page, the sample loaded through its file
// input: the map's positives, rings and sites, every fold closed, the boxes; a real click on the type's "?" opens its
// note with the two links; with the small CVI master, a real click on "CVI movements" gives Chrome's three CVIs; the
// Export's files and ZIP (its download call recorded, so the session saves nothing to Downloads). E1b: a real click on
// "Show past positives"; "Detected between" as Safari's date box; real clicks on Play and Pause; a real arrow key on
// the slider; real clicks on km | miles; the zone hover by a real pointer move; a real click on a column of "Positives
// over time"; a real click on "Map picture (PNG)", the picture drawn and encoded by Safari (its blob read, nothing
// saved); the synthetic screwworm outbreak picking its type and zones. Needs node tests/synthetic/make_em_fixtures.js and the
// Emergency Chrome suite's sample (local-test-artifacts/em/sample/). Writes local-test-artifacts/em/safari_em_<mode>.json.
async function runEM() {
  const mode = PAGE.startsWith('file:') ? 'file' : 'http';
  const out = path.join(ROOT, 'local-test-artifacts', 'em');
  const tables = path.join(ROOT, 'test-tables'), samplePath = path.join(out, 'sample', 'emergency_synthetic.zip');
  for (const f of [samplePath, path.join(tables, 'em_bundle', 'zones.geojson'), path.join(tables, 'em_cvi_master.csv')]) {
    if (!fs.existsSync(f)) {
      console.error('Missing ' + f + ' (run node tests/synthetic/make_em_fixtures.js and node tests/browser/run_em_browser.js load first).');
      process.exit(2);
    }
  }
  const b64 = f => ({ name: path.basename(f), b64: fs.readFileSync(f).toString('base64') });
  const result = { page: PAGE, started: new Date().toISOString(),
    limitation: 'Synthetic FileList (no folder paths); network and policy reports unobservable; the export checked from the page, not a saved file.' };
  let d, timer;
  try {
    d = await launch();
    result.safari = d.version;
    await d.size(1400, 1000);
    const errorsOn = 'window.__errors=[];addEventListener("error",function(e){__errors.push(String(e.message))});addEventListener("unhandledrejection",function(e){__errors.push(String(e.reason))});return true;';
    async function suite() {
      // The landing page: the bundle with its zone file, sent to the Emergency window by a real click.
      await d.goto(PAGE);
      await d.waitFor('window.WSDA && WSDA.landing && WSDA.guide', 15000, 'landing page');
      await d.run(errorsOn);
      const landing = await d.handle();
      const bundle = ['bundle.json', 'emergency_case_sites.csv', 'wa_state_feedlots.csv', 'zones.geojson'].map(n => b64(path.join(tables, 'em_bundle', n)));
      let v0 = await d.run('return WSDA.landing.state.version;');
      await d.run(SET_FILES, '#files-input', bundle);
      await d.waitFor('WSDA.landing.state.version > ' + v0 + ' && !WSDA.landing.state.loading && !WSDA.landing.checklist.state.busy', 20000, 'bundle checked');
      const st = await d.run(`return { selected: WSDA.landing.state.selected, open: document.getElementById('next-open').hidden ? null : document.getElementById('next-open').textContent,
        found: WSDA.landing.checklist.state.result.datasets.filter(function(x){return x.status==='found';}).map(function(x){return x.id;}) };`);
      check(st.selected === 'emergency' && st.open === 'Open Emergency Response' && st.found.join() === 'positives,feedlots,zones',
        'EM Safari: the bundle with a zone file is checked for Emergency, ready to open', st);
      const before = await d.handles();
      await d.click('#next-open');
      let em = null;
      for (let i = 0; i < 100 && !em; i++) { em = (await d.handles()).find(h => !before.includes(h)) || null; if (!em) await sleep(100); }
      check(!!em, 'EM Safari: a real click opens the Emergency page in a new window');
      if (em) {
        await d.switchTo(em);
        await d.waitFor('window.WSDA && WSDA.emergency && WSDA.emergency.state.version > 0 && !WSDA.emergency.state.loading', 20000, 'Emergency loaded');
        const got = await d.run(`var s=WSDA.emergency.state, out={};for (var k in s.datasets) out[k]=await s.datasets[k].file.text();return {files:out,source:s.source};`);
        check(got.source === 'hub' && Object.keys(got.files).sort().join() === 'feedlots,positives,zones'
          && got.files.zones === fs.readFileSync(path.join(tables, 'em_bundle', 'zones.geojson'), 'utf8'),
        'EM Safari: the Emergency window received the positives, the feedlots and the zone file unchanged', Object.keys(got.files));
        await d.switchTo(landing);
      }
      // The Emergency page on its own, with the sample.
      await d.goto(new URL('emergency/index.html', new URL('.', PAGE)).href);
      await d.waitFor('window.WSDA && WSDA.emergency && WSDA.emergency.state.map.ready', 20000, 'Emergency map');
      await d.run(errorsOn);
      v0 = await d.run('return WSDA.emergency.state.version;');
      await d.run(SET_FILES, '#files-input', [b64(samplePath)]);
      await d.waitFor('WSDA.emergency.state.version > ' + v0 + ' && !WSDA.emergency.state.loading && WSDA.emergency.state.map.drawn && WSDA.emergency.state.map.drawn.positives > 0', 20000, 'sample drawn');
      const page = await d.run(`var s=WSDA.emergency.state;return { drawn: s.map.drawn, zones: s.mapData.zones,
        folds: ['load-fold','positives-fold','layers-fold','options-fold'].map(function(id){return document.getElementById(id).open;}),
        boxes: ['box-positives','box-last','box-inside'].map(function(id){return document.querySelector('#'+id+' strong').textContent;}) };`);
      check(page.drawn.positives === 6 && page.zones === 12 && page.drawn.inside > 0 && page.drawn.outside > 0 && page.folds.every(function (x) { return !x; })
        && page.boxes[0] === '6' && page.boxes[1] === 'Oct 5, 2026' && Number(page.boxes[2]) > 0,
      'EM Safari: the sample: six current positives (the past one hidden), twelve rings, sites inside and faded, every fold closed, the boxes', page);
      await d.click('button.tip[data-help="em-type"]');
      const help = await d.run(`return { open: document.getElementById('positives-fold').open, note: !document.getElementById('help-em-type').hidden,
        links: Array.from(document.querySelectorAll('#em-type-links a')).map(function(a){return a.target+' '+a.rel;}) };`);
      check(help.open && help.note && help.links.length === 2 && help.links.every(function (l) { return l === '_blank noopener noreferrer'; }),
        'EM Safari: a real click on the type\'s "?" opens its fold and note, with the two links opening new tabs', help);
      // With the small CVI master: the movements tab by a real click.
      v0 = await d.run('return WSDA.emergency.state.version;');
      await d.run(SET_FILES, '#files-input', [b64(samplePath), b64(path.join(tables, 'em_cvi_master.csv'))]);
      await d.waitFor('WSDA.emergency.state.version > ' + v0 + ' && !WSDA.emergency.state.loading', 20000, 'master loaded');
      await d.click('#show-cvi');
      const cvi = await d.run(`return { line: (document.querySelector('#cvi-result .result-line') || {}).textContent,
        cvis: Array.from(document.querySelectorAll('#cvi-result tbody tr')).map(function(r){return r.cells[0].textContent;}).sort() };`);
      check(cvi.line === '3 CVIs, 1,265 animals, left from or arrived inside the zones: 2 origins and 2 destinations inside.'
        && cvi.cvis.join() === 'EM-0001,EM-0002,EM-0003', 'EM Safari: a real click on "CVI movements" gives the three CVIs Chrome and R give', cvi);
      // The download itself is replaced by a recorder (a Safari test session would save the ZIP to Downloads).
      await d.run(`WSDA.sample.download = function (name, bytes) { window.__download = { name: name, size: bytes.length }; };
        document.getElementById('em-export').click(); return true;`);
      const ex = await d.run(`return { download: window.__download || null, files: (WSDA.emergency.state.lastExport || []).filter(function(e){return !e.dir;}).map(function(e){return e.name.replace(/^[^/]+\\//,'');}).sort(),
        line: document.getElementById('em-export-result').textContent };`);
      check(ex.files.join() === 'cvi_movements.csv,export_params.json,inside_the_zones.csv,layers.csv,left_out.csv,positives.csv,zones.csv,zones.geojson'
        && /^Exported \d{4}-\d\d-\d\d_Emergency\.zip/.test(ex.line) && ex.download && /_Emergency\.zip$/.test(ex.download.name)
        && ex.download.size > 0, 'EM Safari: Export makes the eight files into one ZIP and says so', ex);
      await d.click('#show-inside');

      // ---- E1b ----
      const S = 'WSDA.emergency.state';
      await d.run(`document.getElementById('positives-fold').open = true; return true;`);
      await d.click('#em-past');
      const past = await d.run(`var s=${S};return { positives: s.mapData.positives, past: s.mapData.past, box: document.querySelector('#box-positives strong').textContent };`);
      check(past.positives === 7 && past.past === 1 && past.box === '6',
        'EM Safari: a real click on "Show past positives" draws the past one; the "Positives" box still counts six', past);
      await d.click('#em-past');
      // "Detected between": Safari's own date box, set as a picker sets it.
      const win = await d.run(`var i=document.getElementById('em-to');i.value='2026-09-05';i.dispatchEvent(new Event('change'));
        var s=${S};return { type: i.type, end: s.window.end, positives: s.mapData.positives, last: document.querySelector('#box-last strong').textContent };`);
      check(win.type === 'date' && win.end === '2026-09-05' && win.positives === 2 && win.last === 'Sep 2, 2026',
        'EM Safari: "Detected between" is a date box in Safari; a second date of Sep 5 shows the two positives current then', win);
      await d.run(`var i=document.getElementById('em-to');i.value='';i.dispatchEvent(new Event('change'));return true;`);
      // The play: real clicks on Play and Pause; then a real arrow key on the slider.
      await d.click('#em-play');
      const playing = await d.run(`var s=${S};return { playing: s.playing, button: document.getElementById('em-play').textContent, at: s.stepAt, end: s.window.end };`);
      await sleep(1600);
      const later = await d.run(`return ${S}.stepAt;`);
      await d.click('#em-play');
      const paused = await d.run(`var s=${S};return { playing: s.playing, button: document.getElementById('em-play').textContent, at: s.stepAt };`);
      check(playing.playing && playing.button === 'Pause' && playing.at === 0 && playing.end === '2026-07-18' && later >= 1
        && !paused.playing && paused.button === 'Play by week' && paused.at >= later,
      'EM Safari: real clicks on Play and Pause: the play starts on the first week, steps once a second and stops where it is', [playing, later, paused]);
      await foreground();
      await d.run(`document.getElementById('em-step').focus();return document.activeElement.id;`);
      await d.key('\uE014');
      const keyed = await d.run(`var s=${S};return { at: s.stepAt, label: document.getElementById('em-step-label').textContent, playing: s.playing };`);
      check(keyed.at === paused.at + 1 && new RegExp('^Up to .+ \u00b7 week ' + (keyed.at + 1) + ' of \\d+$').test(keyed.label) && !keyed.playing,
        'EM Safari: a real right-arrow key on the slider moves one week on', [paused.at, keyed]);
      await d.run(`var i=document.getElementById('em-step');i.value=i.max;i.dispatchEvent(new Event('input'));return true;`);
      // km | miles by real clicks: the rings shown in miles, then exactly 3 and 10 km again.
      await d.click('#em-unit-mi');
      const mi = await d.run(`return [0,1].map(function(k){return document.getElementById('em-ring-'+k).value;});`);
      await d.click('#em-unit-km');
      const km = await d.run(`return [0,1].map(function(k){return document.getElementById('em-ring-'+k).value;});`);
      check(mi.join() === '1.86,6.21' && km.join() === '3,10', 'EM Safari: real clicks on miles and km: 1.86 and 6.21 mi, then 3 and 10 km again', [mi, km]);
      // The zone hover by a real pointer move over the map.
      await d.run(`var m=${S}.map.map;m.getCanvas().scrollIntoView({block:'center'});m.fitBounds([[-120.45, 46.33], [-120.18, 46.47]], { animate: false });return true;`);
      await sleep(700);
      const at = await d.run(`var m=${S}.map.map,pt=m.project([-120.315, 46.415]),r=m.getCanvas().getBoundingClientRect();return [r.left+pt.x, r.top+pt.y];`);
      await d.move(at[0], at[1]);
      await sleep(500);
      const tip = await d.run(`return (document.querySelector('.maplibregl-popup')||{}).textContent||'';`);
      check(/^SYN-HPAI-002Infection zone \(3 km\): 25 days/.test(tip) && /Days since the last positive inside each zone, as of Oct 5, 2026$/.test(tip),
        'EM Safari: a real pointer move over a zone opens its hover: the rings under the pointer with their days since, as of the date shown', tip);
      await d.move(5, 5);
      // "Positives over time": open after the load (v2.1), and a column picked by a real click.
      check(await d.run(`return document.getElementById('em-chart-fold').open;`), 'EM Safari: the chart is open after the load');
      await d.click('.chart-col[data-col="7"]');
      const chart = await d.run(`var s=${S};return { open: document.getElementById('em-chart-fold').open, at: s.stepAt, end: s.window.end,
        columns: document.querySelectorAll('.chart-col').length };`);
      check(chart.open && chart.columns === 13 && chart.at === 7 && chart.end === '2026-09-05',
        'EM Safari: a real click on the chart\'s eighth column shows the map as of that week\'s Saturday', chart);
      await d.run(`var i=document.getElementById('em-step');i.value=i.max;i.dispatchEvent(new Event('input'));document.getElementById('em-chart-fold').open=false;return true;`);
      // The map picture: drawn and encoded by Safari; its blob read here, the save replaced (nothing goes to Downloads).
      await d.run(`window.__png=null;window.__download=null;var make=URL.createObjectURL;
        URL.createObjectURL=function(b){if(b&&b.type==='image/png')window.__png=b;return make.call(URL,b);};
        HTMLAnchorElement.prototype.click=function(){window.__download={name:this.download};};document.getElementById('export-fold').open=true;return true;`);
      await d.click('#em-png');
      await d.waitFor(`window.__png && !document.getElementById('em-png').disabled`, 60000, 'map picture drawn');
      const png = await d.run(`var u=new Uint8Array(await window.__png.arrayBuffer()),dv=new DataView(u.buffer),at=0;
        for(var i=8;i<u.length-4&&i<4096;i++){if(u[i]===112&&u[i+1]===72&&u[i+2]===89&&u[i+3]===115){at=i;break;}}
        return { sig: String.fromCharCode(u[1],u[2],u[3]), width: dv.getUint32(16), height: dv.getUint32(20), ppm: at ? dv.getUint32(at+4) : 0,
          name: (window.__download||{}).name, title: ${S}.lastPng.model.title, line: document.getElementById('em-export-result').textContent };`);
      check(png.sig === 'PNG' && png.width === 2200 && png.height === 1700 && png.ppm === 7874 && /^emergency_hpai_\d{4}-\d\d-\d\d\.png$/.test(png.name)
        && /^Saved emergency_hpai_/.test(png.line),
      'EM Safari: a real click on "Map picture (PNG)": Safari draws and encodes the 2200 x 1700 picture at 200 dpi, named for the type and the day', png);
      // The synthetic screwworm outbreak: its type and its dispersal areas as the zones.
      v0 = await d.run(`return ${S}.version;`);
      await d.run(SET_FILES, '#files-input', [b64(path.join(tables, 'em_nws_synthetic.zip'))]);
      await d.waitFor(`${S}.version > ` + v0 + ` && !${S}.loading && ${S}.map.drawn && ${S}.map.drawn.positives > 0`, 20000, 'screwworm drawn');
      const nws = await d.run(`var s=${S};return { type: document.getElementById('em-type').value, useZones: s.useZones, zones: s.mapData.zones,
        box: document.querySelector('#box-positives strong').textContent };`);
      check(nws.type === 'nws' && nws.useZones && nws.zones === 2 && nws.box === '8',
        'EM Safari: the screwworm outbreak picks New World screwworm and uses its two dispersal areas; eight current positives', nws);
      fs.writeFileSync(path.join(out, 'safari_em_' + mode + '.png'), Buffer.from(await d.screenshot(), 'base64'));
      const errors = await d.run('var e = window.__errors || []; window.__errors = []; return e;');
      check(!errors.length, 'EM Safari: no page errors', errors);
    }
    await Promise.race([suite(), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('EM Safari four-minute limit')), 240000);
    })]);
  } catch (e) {
    check(false, 'EM Safari suite stopped', e && e.stack);
    try { fs.writeFileSync(path.join(out, 'safari_em_' + mode + '_failed.png'), Buffer.from(await d.screenshot(), 'base64')); } catch (e2) { /* window may be gone */ }
  } finally {
    clearTimeout(timer);
    if (d) await d.close();
  }
  Object.assign(result, { passed: pass, failed: fail, failures, notes, finished: new Date().toISOString() });
  fs.writeFileSync(path.join(out, 'safari_em_' + mode + '.json'), JSON.stringify(result, null, 2) + '\n');
  failures.forEach(f => console.error('  FAIL ' + f));
  notes.forEach(n => console.log('  note ' + n));
  console.log('EM Safari ' + (result.safari || '') + ' (' + mode + '): ' + pass + ' passed, ' + fail + ' failed');
  process.exitCode = fail ? 1 : 0;
}
if (process.argv.includes('--em')) runEM().catch(e => { console.error(e.stack); process.exitCode = 2; });
