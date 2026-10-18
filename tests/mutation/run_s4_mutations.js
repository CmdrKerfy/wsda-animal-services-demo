#!/usr/bin/env node
'use strict';
// S4 mutation checks. Each mutation is applied to a copy of the repository's site and
// tests (local-test-artifacts/s4/mutation-copy/, deleted at the end), one at a time, and must make a suite fail:
//   unit: mutations of site/cvi/app/flow.js against node tests/node/run_s4_unit_tests.js;
//   page: mutations of the page (ui.js, flowmap.js) against node tests/browser/run_s4_browser.js (about 4.6 minutes
//         each, Chrome in the foreground as the suite needs).
// The copy first runs the unmutated suite (it must pass); after each mutation the copied file is restored and checked by
// SHA-256, and at the end the repository's copies of the mutated files are checked unchanged by SHA-256. A mutation is
// "caught" only when the suite runs to its summary line and reports at least one failed check; a suite that stops
// without it is a "SUITE ERROR" (not caught), except where the list expects that stop (e.g. a TypeError). Each suite run
// is stopped after 9 minutes (with SIGINT, so the browser suite closes its Chrome).
// Usage (repository root, after the S4 oracle files and the F1 tiers exist; see tests/README.md):
//   node tests/mutation/run_s4_mutations.js unit|page [number ...]     (numbers: run only those, 1-based, as listed;
//   0 alone: only the unmutated run)
// Optional: S4_STRIDE (passed to the browser suite), CHROME_BIN. S4_PAGE_URL is not passed on (the copy is tested).
// Node >= 22, no packages.
const fs = require('fs'), path = require('path'), cp = require('child_process'), crypto = require('crypto');
const ROOT = path.resolve(__dirname, '..', '..');
const COPY = path.join(ROOT, 'local-test-artifacts', 's4', 'mutation-copy');
const sha = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

const FLOW = 'site/cvi/app/flow.js', UI = 'site/cvi/app/ui.js', FMAP = 'site/cvi/app/flowmap.js';
const UNIT = [   // [name, file, text, replacement]
  ['projection not globe', FLOW, "projection: 'globe' }", "projection: 'mercator' }"],
  ['all.equal: old averaged rule', FLOW, "const tol = Math.sqrt(Number.EPSILON), idx = [0, 1].filter(i => a[i] !== b[i]);", "const tol = 1.5e-8, idx = [0, 1];"],
  ['palette lookup through the prototype', FLOW, "return own(p, group) ? p[group] : '#999999';", "return p[group] !== undefined ? p[group] : '#999999';"],
  ['legend heading always shown', FLOW, "widthHeader: widths.length > 0 }", "widthHeader: true }"],
  ['missing direction as Combined', FLOW, "const dir = f.direction || 'inbound';", "const dir = f.direction || 'combined';"],
  ['Movement used in the corridor', FLOW, "const isIn = r => r['Dest.State'] === 'WA'", "const isIn = r => r.Movement === 'Inbound' && r['Dest.State'] === 'WA'"],
  ['case-insensitive WA', FLOW, "const isIn = r => r['Dest.State'] === 'WA' && r['Origin.State'] !== null && r['Origin.State'] !== 'WA';",
    "const isIn = r => r['Dest.State'] === 'WA' && r['Origin.State'] !== null && String(r['Origin.State']).toUpperCase() !== 'WA';"],
  ['states without a center kept', FLOW, "agg = agg.filter(a => ctr.has(a.state))", "agg = agg.filter(a => ctr.has(a.state) || true)",
    /TypeError: Cannot read properties of undefined \(reading 'lat'\)/],   // a state without a center has no end: the suite stops
  ['anchor from the centers file', FLOW, "a.coords = arc(a.dest_lon, a.dest_lat);", "a.coords = arc(a.dest_lon, a.dest_lat).map((p, k) => k === 0 ? [-120.45, 47.38] : p);"],
  ['arc formula linear', FLOW, "out.push([lon / toRad, lat / toRad]);", "out.push([p1[0] + (p2[0] - p1[0]) * f, p1[1] + (p2[1] - p1[1]) * f]);"],
  ['widths scaled per species', FLOW, "const w = S().computeRadius(agg.map(a => a.total_animals), f.scaling, 1, 12, f.nBins);",
    "const w = agg.map(a => { const grp = agg.filter(b => b.species_group === a.species_group); return S().computeRadius(grp.map(b => b.total_animals), f.scaling, 1, 12, f.nBins)[grp.indexOf(a)]; });"],
  ['multiplier not applied', FLOW, "width: a.line_width_px * mult }", "width: a.line_width_px }"],
  ['combine color from the wrong entry', FLOW, "return p[Object.keys(p)[0]];", "return p[Object.keys(p)[1]];"],
  ['unnamed group not gray', FLOW, "return own(p, group) ? p[group] : '#999999';", "return own(p, group) ? p[group] : '#888888';"],
  ['draw order reversed', FLOW, "(d[j].width - d[i].width) || (i - j)", "(d[i].width - d[j].width) || (i - j)"],
  ['breakdown raw species for two groups', FLOW, "const useRaw = f.species.length === 1 && loaded.hasSpecies;", "const useRaw = f.species.length <= 2 && loaded.hasSpecies;"],
  ['domain with WA-to-WA rows', FLOW, "&& ((r['Origin.State'] === 'WA') !== (r['Dest.State'] === 'WA'))", "&& true"],
  ['States box not limited to centers', FLOW, "s !== 'WA' && ctr && ctr.has(s)", "s !== 'WA'"],
  ['Reset All leaves Combine off', FLOW, "combine: true, scaling: 'natural'", "combine: false, scaling: 'natural'"],
  ['labels include AK and HI', FLOW, "skip: ['AK', 'HI']", "skip: []"],
  ['legend bar not rounded', FLOW, "px: Math.max(1, S().rRound(tiers.radii[i] * mult))", "px: Math.max(1, Math.round(tiers.radii[i] * mult))"],
  ['label priority not by area', FLOW, "s + ring(p[0]) - p.slice(1)", "s + p[0].length - p.slice(1)"],
  ['tooltip totals rounded (Combine species)', FLOW, "const t = fmt(d.map(a => a.total_animals));\n      d.forEach((a, i) => { a.tooltip = '<strong>' + a.state + '</strong><br/>Total: '",
    "const t = fmt(d.map(a => Math.round(a.total_animals)));\n      d.forEach((a, i) => { a.tooltip = '<strong>' + a.state + '</strong><br/>Total: '"]
];
const PAGE = [
  ['Flow map made on page open', UI, "renderAll();\n  renderSummaries([]);\n})(window);", "renderAll();\n  renderSummaries([]);\n  startFlow();\n})(window);"],
  ['WA filters lost after visiting Flow (Flow direction written into the WA state)', UI,
    "if (r.checked) { fl.direction = r.value; scheduleFlow(); }", "if (r.checked) { fl.direction = r.value; st.direction = [r.value === 'inbound' ? 'Inbound' : 'Outbound']; scheduleFlow(); }"],
  ['WA camera lost after visiting Flow (fit on the way back)', UI, "liveMaps().forEach(m => m.map.resize());\n      paintSummaries(st.valueBoxes, st.strip);",
    "liveMaps().forEach(m => m.map.resize()); fitMaps();\n      paintSummaries(st.valueBoxes, st.strip);"],
  ['WA boxes and strip kept from the Flow view after the switch back', UI, "liveMaps().forEach(m => m.map.resize());\n      paintSummaries(st.valueBoxes, st.strip);",
    "liveMaps().forEach(m => m.map.resize());\n      paintSummaries(fl.valueBoxes || st.valueBoxes, fl.strip || st.strip);"],
  ['Flow files loaded again on each visit', UI, "if (!flowMap && !flowFailed) startFlow();", "if (!flowFailed) startFlow();"],
  ['Play keeps running after a view switch', UI, "stopPlay(); stopFlowPlay();\n    st.view = v;", "stopPlay();\n    st.view = v;"],
  ['Reset All keeps Flow\'s Browse on', UI, "Object.assign(fl, FL.resetDefaults(st.master));", "Object.assign(fl, FL.resetDefaults(st.master), { browse: fl.browse });"],
  ['state labels not switched live', UI, "fl.labels = e.target.checked; if (flowLive()) W.flowmap.setLabels(flowMap, fl.labels);", "fl.labels = e.target.checked;"],
  ['camera back to the opening view on every recompute', FMAP, "    st.drawn = features;\n  }", "    st.drawn = features; fitView(st);\n  }"],
  ['Fit to Lower 48 as CVI (the lower 48\'s box)', FMAP, "st.map.jumpTo({ center: F().VIEW.center, zoom: F().VIEW.zoom, bearing: 0, pitch: 0 });",
    "st.map.fitBounds([[-124.8, 24.4], [-66.9, 49.4]], { duration: 0 });"],
  ['hover opacity not raised', FMAP, "map.setFeatureState({ source: SOURCE, id: f.id }, { hover: true });", "map.setFeatureState({ source: SOURCE, id: f.id }, { hover: false });"],
  ['tooltip node passes markup through', FMAP, "const box = root.document.createElement('div');\n    let cur = box;",
    "const box = root.document.createElement('div'); box.innerHTML = String(html); return box;\n    let cur = box;"],
  ['popup shows the tooltip as HTML', FMAP, ".setDOMContent(tooltipNode(f.properties.tooltip))", ".setHTML(f.properties.tooltip)"],
  ['screenshot without the state labels', FMAP, "(st.labelsVisible ? st.labels.filter(labelShown) : [])", "[]"],
  ['screenshot without the Census credit', FMAP, "root.CVIWA.map.drawAttribution(g, out, k, st.lastAttribution);", ""],
  ['lines drawn at one fixed width', FMAP, "'line-width': ['get', 'width']", "'line-width': 2"],
  ['lines drawn in one fixed color', FMAP, "'line-color': ['get', 'color']", "'line-color': '#245566'"],
  ['state labels overlap (no room check)', FMAP, "if (boxes.some(o => o[0] < b[2] && b[0] < o[2] && o[1] < b[3] && b[1] < o[3])) show = false;", "if (false) show = false;"],
  ['the smaller state\'s label kept', FMAP, "|| (i - j)).map(i => st.labels[i]);", "|| (i - j)).map(i => st.labels[i]).reverse();"],
  ['labels behind the globe shown and drawn', FMAP, "let show = !(tr && typeof tr.isLocationOccluded === 'function' && tr.isLocationOccluded(m.getLngLat()));", "let show = true;"],
  ['legend open state per view', UI, "(t === 'legend-toggle-b' ? [[t, panel]] : LEGENDS)", "[[t, panel]]"],
  ['Browse snaps the camera back on each frame', UI, "$('fl-time-slider').addEventListener('input', e => {\n", "$('fl-time-slider').addEventListener('input', e => {\n    if (flowLive()) W.flowmap.fitView(flowMap);\n"],
  ['Flow failure leaves the state switches on', UI, "$('fl-labels').disabled = true; $('fl-lines').disabled = true;", ""],
  ['boxes after a failed load as "no records"', UI, "    if (!flowGeo) {\n      fl.valueBoxes = { state: 'alert'", "    if (false) {\n      fl.valueBoxes = { state: 'alert'"],
  ['no WebGL reported as a file that could not be loaded', UI, "} catch (e) { flowError(); recomputeFlow(); return; }", "} catch (e) { flowError(String(e.message)); return; }"]
];

const mode = process.argv[2], pick = process.argv.slice(3).map(Number);
if (mode !== 'unit' && mode !== 'page') { console.error('Usage: node tests/mutation/run_s4_mutations.js unit|page [number ...]'); process.exit(2); }
const LIST = (mode === 'unit' ? UNIT : PAGE).map((m, i) => [i + 1].concat(m)).filter(m => !pick.length || pick.includes(m[0]));
const SUITE = mode === 'unit' ? 'tests/node/run_s4_unit_tests.js' : 'tests/browser/run_s4_browser.js';
const SUMMARY = mode === 'unit' ? /S4 unit: .*/ : /S4 browser .*/;

// The copy: the site and the tests, the S4 oracle files and the variant CSV (local-test-artifacts/s4), the F1 tiers.
const need = [path.join(ROOT, 'local-test-artifacts', 's4', 'oracle_s4_arcs.json'), path.join(ROOT, 'local-test-artifacts', 'f1', 'tiers')];
if (need.some(p => !fs.existsSync(p))) { console.error('Missing oracle files or F1 tiers: run the F1 unit tests and Rscript tests/oracle/cvi_r_oracle.R s4 first.'); process.exit(2); }
const files = [...new Set(LIST.map(m => m[2]))];
const before = Object.fromEntries(files.map(f => [f, sha(path.join(ROOT, f))]));
fs.rmSync(COPY, { recursive: true, force: true });
fs.cpSync(path.join(ROOT, 'site'), path.join(COPY, 'site'), { recursive: true });
fs.cpSync(path.join(ROOT, 'tests'), path.join(COPY, 'tests'), { recursive: true, filter: src => !src.startsWith(__dirname) });   // not this runner
const S4 = path.join(ROOT, 'local-test-artifacts', 's4');
fs.mkdirSync(path.join(COPY, 'local-test-artifacts', 's4'), { recursive: true });
for (const f of fs.readdirSync(S4)) if (/^oracle_s4_.*\.json$|\.csv$/.test(f)) fs.copyFileSync(path.join(S4, f), path.join(COPY, 'local-test-artifacts', 's4', f));
fs.cpSync(path.join(ROOT, 'local-test-artifacts', 'f1', 'tiers'), path.join(COPY, 'local-test-artifacts', 'f1', 'tiers'), { recursive: true });

const ENV = Object.assign({}, process.env); delete ENV.S4_PAGE_URL;
// The result of one suite run: failed (the number of failed checks in its summary line; null without one), the summary
// or the error that stopped it, the first failure.
const runSuite = () => {
  const t0 = Date.now();
  const r = cp.spawnSync(process.execPath, [SUITE], { cwd: COPY, encoding: 'utf8', env: ENV, maxBuffer: 64 << 20, timeout: 9 * 60000, killSignal: 'SIGINT' });
  const out = (r.stdout || '') + (r.stderr || ''), sum = out.match(SUMMARY), m = sum && sum[0].match(/(\d+) failed/);
  const err = (out.match(/^\w*Error: .*/m) || [out.trim().split('\n').slice(-1)[0] || ''])[0].slice(0, 160);
  return { status: r.status, failed: m ? Number(m[1]) : null, line: sum ? sum[0] : 'suite stopped' + (r.error ? ' (' + r.error.code + ')' : '') + ': ' + err,
    err, first: (out.match(/^FAIL .*/m) || [''])[0].slice(0, 220), s: Math.round((Date.now() - t0) / 1000) };
};
// A passing unmutated run is remembered by the SHA-256 of everything copied (local-test-artifacts/s4/
// mutation-baseline.json), so a later call on the same files runs only its mutations (one browser run is about 4.6
// minutes).
const treeHash = () => {
  const h = crypto.createHash('sha256');
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).sort((x, y) => (x.name < y.name ? -1 : 1)).forEach(e => {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p); else h.update(path.relative(COPY, p) + '\0').update(fs.readFileSync(p));
  });
  walk(COPY); return h.digest('hex');
};
const BASE = path.join(S4, 'mutation-baseline.json'), key = [mode, treeHash(), ENV.S4_STRIDE || '', ENV.CHROME_BIN || ''].join(' ');
let caught = 0, applied = 0, restored = true;
try {
  let known = null;
  try { known = JSON.parse(fs.readFileSync(BASE, 'utf8'))[key] || null; } catch (e) { /* none yet */ }
  const base = known ? Object.assign({ status: 0, failed: 0 }, known, { line: known.line + ' (remembered from ' + known.at + ')' }) : runSuite();
  if (!known && base.status === 0 && base.failed === 0) {
    let all = {}; try { all = JSON.parse(fs.readFileSync(BASE, 'utf8')); } catch (e) { /* new file */ }
    all[key] = { line: base.line, s: base.s, at: new Date().toISOString() }; fs.writeFileSync(BASE, JSON.stringify(all, null, 1));
  }
  console.log('unmutated copy: ' + base.line + ' (' + base.s + ' s)');
  if (base.status !== 0 || base.failed !== 0) { console.log('The unmutated copy does not pass; no mutation run.'); process.exitCode = 1; }
  else for (const [n, name, file, a, b, stop] of LIST) {
    const p = path.join(COPY, file), orig = fs.readFileSync(p, 'utf8'), h = sha(p);
    const count = orig.split(a).length - 1;
    if (count !== 1) { console.log(n + '. NOT APPLIED (' + count + ' matches) ' + name); continue; }
    applied++;
    fs.writeFileSync(p, orig.replace(a, () => b));
    let r;
    try { r = runSuite(); } finally { fs.writeFileSync(p, orig); }
    if (sha(p) !== h) restored = false;
    const ok = r.failed !== null ? r.failed > 0 : !!(stop && stop.test(r.err));
    if (ok) caught++;
    console.log(n + '. ' + (ok ? 'caught ' : r.failed === null ? 'SUITE ERROR ' : 'MISSED ') + name + ' -> ' + r.line + ' (' + r.s + ' s)' + (r.first ? '\n     ' + r.first : ''));
  }
} finally {
  fs.rmSync(COPY, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
const unchanged = files.every(f => sha(path.join(ROOT, f)) === before[f]);
console.log(mode + ': ' + caught + ' of ' + applied + ' applied mutations caught (' + LIST.length + ' listed); copy restored after each: ' + restored
  + '; the mutated files unchanged in the repository (SHA-256): ' + unchanged + '; copy deleted: ' + !fs.existsSync(COPY));
if (caught !== LIST.length || !restored || !unchanged) process.exitCode = 1;
