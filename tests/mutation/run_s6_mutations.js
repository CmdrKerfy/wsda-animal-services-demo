#!/usr/bin/env node
'use strict';
// Bounded S6 mutations. Each mutant changes one exact piece of code in a temporary copy of the repository; the
// complete suite named for it must then report failed assertions (a crash does not count as caught).
// Usage: node tests/mutation/run_s6_mutations.js unit|page [numbers ...]
//   unit runs every engine mutant against the shared-facilities Node suite;
//   page needs 1 to 4 mutant numbers per call, so each call stays within about eight minutes.
// The unmutated suites run first in the same copy and must pass. No installations or source-project writes.
const fs = require('fs'), path = require('path'), cp = require('child_process'), crypto = require('crypto');
const ROOT = path.resolve(__dirname, '../..');
// Logs and a ledger: local-test-artifacts/s6/mutations/.
const OUT = path.join(ROOT, 'local-test-artifacts/s6/mutations');
const TEMP = path.join(ROOT, 'local-test-artifacts/s6/mutation-copy'), COPY = path.join(TEMP, 'platform');
const FAC = 'site/shared/facilities.js', MAP = 'site/shared/facilitymap.js', UI = 'site/shared/facility-ui.js';
const DET = 'site/shared/facility-details.js', INFRA = 'site/infrastructure/app.js', CVI_UI = 'site/cvi/app/ui.js';
const FOCUS = 'site/cvi/app/focusmap.js', LAND = 'site/landing.js';
const HUB_HTML = 'site/index.html', INFRA_HTML = 'site/infrastructure/index.html', CVI_HTML = 'site/cvi/index.html';

// [name, file, exact original text, replacement, suite argument]
const UNIT = [
  ['manifest whitelist skips the personal-name screen', FAC,
    "filter(h => header.includes(h) && !EXCLUDED.test(h))", "filter(h => header.includes(h))", '--facilities'],
  ['automatic detection skips the personal-name screen', FAC,
    "|| EXCLUDED.test(h) || types[h]", "|| types[h]", '--facilities'],
  ['species columns capped at 30 values', FAC,
    "(/species/i.test(h) ? 200 : 30)", "(/species/i.test(h) ? 30 : 30)", '--facilities'],
  ['single-value columns offered', FAC, "n >= 2 && n <= ", "n >= 1 && n <= ", '--facilities'],
  ['commas split values', FAC, "String(v).split(/[|;]/)", "String(v).split(/[|;,]/)", '--facilities'],
  ['pickers combined with OR instead of AND', FAC, "columns.every(h => {", "columns.some(h => {", '--facilities'],
  ['values in one picker combined with AND instead of OR', FAC,
    "tokens(p.values[h]).some(v => selected.includes(v))", "selected.every(v => tokens(p.values[h]).includes(v))", '--facilities'],
  ['counts taken from the unfiltered rows', FAC, "count: points.length", "count: l.points.length", '--facilities'],
  ['missing precision becomes town-level', FAC,
    "const geoSource = flag || 'existing';", "const geoSource = flag || 'google_city';", '--facilities'],
  ['town-level qualifier dropped', FAC, "? ' (town-level location)' : '';", "? '' : '';", '--facilities'],
  ['stale picks kept after new files', FAC,
    "picks[l.key][h] = values.filter(v => l.choices[h] && l.choices[h].includes(v));", "picks[l.key][h] = values.slice();", '--facilities'],
  ['row identity not tied to the file revision', FAC,
    "id: String(revision) + ':' + index + ':' + ordinal", "id: index + ':' + ordinal", '--facilities'],
  // R's number and logical reading, the columns kept, the name fallback and unusable layers
  ['NaN, Inf and Infinity read as text', FAC,
    "R_DECIMAL.test(t) || R_HEX.test(t) || R_SPECIAL.test(t)", "R_DECIMAL.test(t) || R_HEX.test(t)", '--facilities'],
  ['logical values trimmed before the test', FAC,
    "v.every(x => R_LOGICAL.test(String(x)))", "v.every(x => R_LOGICAL.test(String(x).trim()))", '--facilities'],
  ['points keep every supplied column', FAC,
    "columns.forEach(h => { values[h] = cells[h]; });", "Object.keys(cells).forEach(h => { values[h] = cells[h]; });", '--facilities'],
  ['name fallback takes a screened column', FAC,
    "c !== 'ref_name' && !EXCLUDED.test(c));", "c !== 'ref_name');", '--facilities'],
  ['geo_source not trimmed', FAC, "String(r[precisionIndex]).trim()", "String(r[precisionIndex])", '--facilities'],
  ['picks of an unusable layer dropped silently', FAC,
    "      if (isUsable(key)) continue;\n", "      continue;\n", '--facilities']
];
const PAGE = [
  ['all supplied columns sent to the map', MAP,
    "properties: { row_id: p.id, ref_name: p.name, ref_display: p.display }",
    "properties: { row_id: p.id, ref_name: p.name, ref_display: p.display, ref_values: JSON.stringify(p.values) }", '--facilities'],
  ['stale cluster leaves accepted', MAP, "if (stale()) return;", "if (false) return;", '--facilities'],
  ['cluster hover lists 14 names', MAP, ".filter(Boolean).slice(0, 15)", ".filter(Boolean).slice(0, 14)", '--facilities'],
  ['Infrastructure loses keyboard focus after a change', UI,
    "if (e && !e.disabled) e.focus({ preventScroll: true });", "if (false) e.focus({ preventScroll: true });", '--facilities'],
  // "Details show every supplied column" was removed: points now keep only the filter columns, so that
  // mutant shows the same rows as the code (it cannot be caught). Engine mutant 15 guards the columns kept instead.
  ['details name parsed as HTML', DET,
    "title.textContent = point.name || 'Unnamed facility';", "title.innerHTML = point.name || 'Unnamed facility';", '--focus'],
  ['County Focus loses keyboard focus after a change', CVI_UI,
    "root.WSDA.facilityUI.preserve($('fo-fac-list'), buildFacilityList);", "buildFacilityList();", '--focus'],
  ['Reset All reselects every layer', INFRA,
    "    state.selectedLayers = [];\n    state.attributes = Object.create(null);\n    state.activity = activityDefaults();",
    "    state.selectedLayers = state.prepared.layers.filter(l => l.usable).map(l => l.key);\n    state.attributes = Object.create(null);\n    state.activity = activityDefaults();",
    '--activity'],
  ['facility county filter also filters CVI activity', INFRA,
    "C.aggregate.build(m.rows, Object.assign({}, a, { hasSpecies: m.hasSpecies }))",
    "C.aggregate.build(m.rows.filter(r => !state.counties.length || state.counties.includes(r['Origin.County']) || state.counties.includes(r['Dest.County'])), Object.assign({}, a, { hasSpecies: m.hasSpecies }))",
    '--activity'],
  // Loading, details pop-ups, next steps and county counts
  ['a checklist change during a load is dropped', INFRA,
    "if (state.loading) state.republish = true;", "if (state.loading) return;", '--entry'],
  ['County Focus facility details stay open on a map click', FOCUS,
    "new Popup({ maxWidth: 'min(360px, 85vw)', className: 'focus-click focus-fac-click' })",
    "new Popup({ closeOnClick: false, maxWidth: 'min(360px, 85vw)', className: 'focus-click focus-fac-click' })", '--focus'],
  ['any drag opens the loader', INFRA,
    "if (types.includes('Files')) $('load-fold').open = true;", "$('load-fold').open = true;", '--entry'],
  ['next step says "in Datasets below" twice', LAND,
    "const where = / in Datasets below$/.test(reason) ? '' : ' in Datasets below';",
    "const where = ' in Datasets below';", '--entry'],
  ['a conflicted layer says "file not supplied"', INFRA,
    "if (!l.usable && conflicts && conflicts.has(l.key)) {", "if (false) {", '--entry'],
  ['Infrastructure counts border points in every county', INFRA,
    "geometry: p => !picks.size || picks.has(p.county)", "geometry: p => !picks.size || p.counties.some(c => picks.has(c))", '--facilities'],
  ['list scroll positions not restored', UI,
    "scrolled.forEach(([id, top]) => {", "[].forEach(([id, top]) => {", '--facilities'],
  // Species refinement, filter folds, spacing and the basemap picker
  ['Refine by species needs exactly one Species Group', INFRA,
    "const usable = !!(m && m.hasSpecies);", "const usable = !!(m && m.hasSpecies && a.species.length === 1);", '--activity'],
  ['attribute filters start open', UI, "fold.open = openFolds.has(memory);", "fold.open = true;", '--facilities'],
  ['attribute filter fold forgets it was opened', UI,
    "if (fold.open) openFolds.add(memory); else openFolds.delete(memory);", "openFolds.delete(memory);", '--facilities'],
  ['hub card help line beside the button', HUB_HTML,
    ".card-open-help { display: block;", ".card-open-help { display: inline;", '--entry'],
  ['Infrastructure sections without the CVI spacing', INFRA_HTML,
    ".section-body { padding: 0.75rem 0.85rem 0.4rem; }", ".section-body { padding: 0; }", '--activity'],
  ['Basemap picker opens on its first tile basemap', INFRA,
    "  $('infra-basemap').value = '';", "  void 0;", '--facilities'],
  // Layout of the switches, legend names and layer rows
  ['neighbor counties switch loses its indent', INFRA_HTML,
    "margin-top: 0.15rem; margin-bottom: 0.15rem;", "margin: 0.15rem 0;", '--facilities'],
  ['wrapped legend name continues under the dot', INFRA,
    "      line.className = 'lg-line';\n", "", '--facilities'],
  ['layer rows without County Focus row layout', INFRA_HTML,
    ".facility-layer label.fac-row { display: flex;", ".facility-layer label.fac-row { display: block;", '--facilities'],
  ['County Focus layer rows wrap a long name under the checkbox', CVI_HTML,
    ".facility-layer label.fac-row { display: flex; align-items: flex-start; }",
    ".facility-layer label.fac-row { display: flex; flex-wrap: wrap; }", '--focus']
];

// Only the inputs the S6 suites read are copied; their outputs land in the copy and are deleted with it.
const ARTIFACTS = ['local-test-artifacts/s6/day1', 'local-test-artifacts/s6/day2/fixtures', 'local-test-artifacts/s6/day3/fixtures',
  'local-test-artifacts/s6/day5/infrastructure/fixtures', 'local-test-artifacts/s6/day5/activity_reference.json', 'local-test-artifacts/f1/tiers'];

const mode = process.argv[2], picks = process.argv.slice(3).map(Number);
if (!['unit', 'page'].includes(mode) || picks.some(n => !Number.isInteger(n) || n < 1)) throw new Error('Use unit|page [numbers ...]');
const all = mode === 'unit' ? UNIT : PAGE;
if (picks.some(n => n > all.length)) throw new Error('Unknown mutation number');
if (mode === 'page' && (picks.length < 1 || picks.length > 4)) throw new Error('Page calls take 1 to 4 mutant numbers.');
const list = all.map((m, i) => [i + 1, ...m]).filter(m => !picks.length || picks.includes(m[0]));
const sha = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const files = [...new Set(list.map(m => m[2]))];
const before = Object.fromEntries(files.map(f => [f, sha(path.join(ROOT, f))]));
const suite = mode === 'unit' ? 'tests/node/run_s6_unit_tests.js' : 'tests/browser/run_s6_browser.js';
const env = { ...process.env };
let caught = 0, restored = true;

if (fs.existsSync(TEMP)) throw new Error('Existing mutation-copy: inspect interrupted work before restarting.');
fs.mkdirSync(OUT, { recursive: true });
const results = [];
try {
  for (const d of ['site', 'tests']) fs.cpSync(path.join(ROOT, d), path.join(COPY, d), { recursive: true });
  for (const a of ARTIFACTS) fs.cpSync(path.join(ROOT, a), path.join(COPY, a), { recursive: true });

  const run = (arg, name) => {
    const t = Date.now();
    const r = cp.spawnSync(process.execPath, [suite, arg, '--by-part'], { cwd: COPY, env, encoding: 'utf8',
      maxBuffer: 64 << 20, timeout: 7 * 60000, killSignal: 'SIGINT' });
    const out = (r.stdout || '') + (r.stderr || '');
    fs.writeFileSync(path.join(OUT, mode + '-' + name + '.log'), out);
    const m = out.match(/S6 [^\n]*?(\d+) passed, (\d+) failed/);
    // A suite that stops (map never ready, timeout) is a crash, not a caught mutant.
    const crashed = /FAIL complete [^\n]*suite|suite error/.test(out);
    return { status: r.status, failed: m ? Number(m[2]) : null, crashed, summary: m ? m[0] : 'SUITE ERROR',
      seconds: Math.round((Date.now() - t) / 1000) };
  };
  for (const arg of [...new Set(list.map(m => m[5]))]) {
    const base = run(arg, 'baseline' + arg);
    console.log('unmutated ' + arg + ': ' + JSON.stringify(base));
    results.push({ baseline: arg, ...base });
    if (base.status !== 0 || base.failed !== 0) throw new Error('The complete unmutated suite must pass before mutations');
  }
  for (const [n, name, file, a, b, arg] of list) {
    const p = path.join(COPY, file), orig = fs.readFileSync(p, 'utf8'), h = sha(p);
    const count = orig.split(a).length - 1;
    if (count !== 1) throw new Error(n + ' ' + name + ': expected exactly one match, got ' + count);
    fs.writeFileSync(p, orig.replace(a, () => b));
    let r;
    try { r = run(arg, String(n)); } finally { fs.writeFileSync(p, orig); }
    restored = restored && sha(p) === h;
    const ok = r.status === 1 && r.failed !== null && r.failed > 0 && !r.crashed;
    if (ok) caught++; else process.exitCode = 1;
    results.push({ n, name, file, suite: arg, caught: ok, ...r });
    console.log(n + '. ' + (ok ? 'caught' : r.crashed || r.failed === null ? 'CRASHED (not counted)' : 'MISSED') + ' ' + name + ': ' + JSON.stringify(r));
  }
} finally {
  fs.rmSync(TEMP, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  fs.writeFileSync(path.join(OUT, mode + '-' + (picks.join('-') || 'all') + '.json'), JSON.stringify(results, null, 2));
}
const unchanged = files.every(f => sha(path.join(ROOT, f)) === before[f]);
console.log(mode + ': ' + caught + ' of ' + list.length + ' mutations caught; copy restored: ' + restored
  + '; repository files unchanged: ' + unchanged + '; copy deleted: ' + !fs.existsSync(TEMP));
if (caught !== list.length || !restored || !unchanged) process.exitCode = 1;
