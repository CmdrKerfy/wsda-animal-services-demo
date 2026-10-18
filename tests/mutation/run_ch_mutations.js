#!/usr/bin/env node
'use strict';
// Shaded counties and states spot mutations: classes worked out per Compare map or per frame, the gray read as a
// class, the wrong ramp end, area left out of per square mile and the like must each be caught.
//
// Each mutant changes one exact piece of code in a temporary copy of the repository; the suite named for its group
// must then report failed checks. A suite that stops early (its only failures "ran to its end") does not count.
//   unit   site/cvi/app/choropleth.js and the PNG, GIF and export code, against tests/node/run_ch_unit_tests.js
//   page   the page's switches and live maps, against the tests/browser/run_ch_browser.js part each names
//          (file://, foreground)
//
// Usage (repository root): node tests/mutation/run_ch_mutations.js <unit|page> [numbers ...]
//                          node tests/mutation/run_ch_mutations.js list
// Run in the foreground for page (Chrome does not start from a background job). The unmutated suite runs first in
// the same copy and must pass. The copy is deleted at the end, and the repository's files are checked unchanged
// (SHA-256). Logs and a ledger: local-test-artifacts/choropleth/mutations/.
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join(ROOT, 'local-test-artifacts', 'choropleth', 'mutations');
const TEMP = path.join(ROOT, 'local-test-artifacts', 'choropleth', 'mutation-copy-' + process.argv[2]);
const COPY = path.join(TEMP, 'platform');
const CP = 'site/cvi/app/choropleth.js', BM = 'site/cvi/app/brandedmaps.js', TS = 'site/cvi/app/timeseries.js';
const EXP = 'site/cvi/app/exports.js', UI = 'site/cvi/app/ui.js', MAP = 'site/cvi/app/map.js';

// [name, file, exact original text, replacement, Chrome part (page only)]
const GROUPS = {
  unit: [
    ['Compare: classes from the left map only', CP, '    for (const rows of rowsList) {',
      '    for (const rows of rowsList.slice(0, 1)) {'],
    ['GIF: classes per frame (no shared set)', TS, "if (view === 'wa' && shade && o.sharedScale && frames.length) {",
      'if (false) {'],
    ['"No movements" read as the lowest class', CP, '      if (!good(v) || v <= 0) return null;',
      '      if (!good(v)) return null;'],
    ['the ramp turned around (dark end first)', CP,
      'out.push(from[Math.round((i * (from.length - 1)) / (k - 1))]);',
      'out.push(from[from.length - 1 - Math.round((i * (from.length - 1)) / (k - 1))]);'],
    ['per square mile without the area', CP, 'per.set(county, total / LAND_SQ_MI[county]);',
      'per.set(county, total);'],
    ['a value on a break goes to the class above', CP, '      return S().bincode([v], breaks)[0];',
      '      return Math.min(n, S().bincode([v], breaks)[0] + (breaks.indexOf(v) > 0 ? 1 : 0));'],
    ['Fisher\'s padded low end kept', CP, '      breaks[0] = lo;\n', '      breaks[0] = breaks[0];\n'],
    ['more than five classes allowed', CP, 'const MAX_CLASSES = 5;', 'const MAX_CLASSES = 7;'],
    ['PNG: No movements drawn in land gray (no hatch)', BM,
      "const fill = c && !c.none ? c.color : 'url(#ch-hatch-wa)';", "const fill = c && !c.none ? c.color : '#e8e8e8';"],
    ['PNG: gray county lines on the shaded map', BM,
      "BR.num(op) + '\" stroke=\"' + CP().LINE + '\" stroke-width=\"' + BR.num(BR.linePt(0.5))",
      "BR.num(op) + '\" stroke=\"#8a8a8a\" stroke-width=\"' + BR.num(BR.linePt(0.5))"],
    ['PNG: spotlight dims nothing', BM, 'const dim = spot.size > 0 && !spot.has(feat.properties.name);',
      'const dim = false;'],
    ['County Focus PNG: gray lines kept on the Default background', BM,
      "const plainLine = streets ? '#8a8a8a' : '#ffffff';", "const plainLine = '#8a8a8a';"],
    ['Flow PNG: Washington in its old blue, not the white hub', BM, "code === 'WA' ? FLOW_THEME.waHub",
      "code === 'WA' ? FLOW_THEME.waFill"],
    ['export_params.json without the shading', EXP, '    if (!sh) return;\n    const breaks', '    return;\n    const breaks'],
    // The PNG's spacing.
    ['one Top 3 list keeps the full box', BM, ': !split && style.compactTop ? 0.1425 : 0.285;',
      ': 0.285;'],
    ['the shaded legend kept at CVI\'s circle-legend height', BM, ".concat(popRows), { bottom: 0.045, minH: 0, maxH });",
      ".concat(popRows), { bottom: 0.045, minH: legendH, maxH });"],
    ['the title keeps "TOTAL ANIMAL" on Animals per square mile', BM,
      "const perSqMi = !!shaded && input.shade.measure === 'per_sq_mi';", 'const perSqMi = false;'],
    ['the spotlight outline drawn near-black again', CP, "const OUTLINE = { color: '#ffffff', live: 3, png: 2.0 };",
      "const OUTLINE = { color: '#1f1f1f', live: 3, png: 2.0 };"],
    ['the Top 3 Movements box at its full height', BM, 'topH: style.compactTop ? 0.1425 : 0.285, pop });',
      'topH: 0.285, pop });'],
    ['the movement legend back to "Ranks"', 'site/cvi/app/movement.js',
      "const busiestLabel = (first, last) => (first === last ? ordinal(first) : ordinal(first) + '\\u2013' + ordinal(last)) +\n    ' busiest';",
      "const busiestLabel = (first, last) => (first === last ? 'Rank ' + first : 'Ranks ' + first + '\\u2013' + last);"],
    // Alaska and Hawaii insets, county names, labels and the shaded Top 5.
    ['Flow PNG: Alaska and Hawaii boxes left out', BM, 'const codes = input.insets || IN.present(input.lines.map(a => a.state));',
      'const codes = [];'],
    ['Flow PNG: the line to an inset state keeps its arc', BM,
      'const end = insets.anchors.get(String(ln.state).toUpperCase());', 'const end = null;'],
    ['GIF: the inset boxes frame by frame', TS,
      'const insets = IN ? IN.present([].concat(...fr.frames.map(x => x.lines.map(a => a.state)))) : undefined;',
      'const insets = undefined;'],
    ['county names matched exactly again', CP,
      "return COUNTY_KEYS.get(String(name).trim().replace(/\\s+/g, ' ').toLowerCase()) || null;",
      'return LAND_SQ_MI[name] ? name : null;'],
    ['per square mile labels without extra digits', CP, 'while (extra < 4 && clash(extra)) extra++;', ''],
    ['the shaded Top 3 split by direction again', BM,
      'const split = !shaded && (input.topSplit', 'const split = (input.topSplit'],
    ['the GIF\'s Top 3 decided frame by frame', TS,
      'if (view === \'wa\') return Object.assign({}, input, { rows: x.rows, f, scale, band, shade, topSplit });',
      'if (view === \'wa\') return Object.assign({}, input, { rows: x.rows, f, scale, band, shade });'],
    ['export_params.json without the GIF\'s classes', EXP, 'p.gif_shade_breaks = breaks(gif);', ''],
    ['the shaded Top 5 back to a Top 3', BM, 'const SHADE_TOP = 5;', 'const SHADE_TOP = 3;'],
    ['the shaded Top 5 without its In and Out', BM, "return { title, color: '#1c5a83', columns: ['Total', 'In', 'Out'],",
      "return { title, color: '#1c5a83', columns: ['Total', 'Out', 'In'],"]
  ],
  page: [
    ['Compare: the live classes from the left map only', UI,
      'const cls = CP.countyClasses(rowsList, st.shadeMeasure,', 'const cls = CP.countyClasses(rowsList.slice(0, 1), ' +
      'st.shadeMeasure,', 'wa'],
    ['population density not grayed while shaded', UI, "|| (l === 'density' && fill);", ';', 'wa'],
    ['the movement lines do not take over the shading', UI,
      "const isShaded = () => st.mapStyle === 'shaded' && !st.movementOn;",
      "const isShaded = () => st.mapStyle === 'shaded';", 'wa'],
    ['live county lines not white while shaded', MAP,
      '? Object.assign({}, c, { line: root.CVIWA.choropleth.LINE }) : c),', '? c : c),', 'wa'],
    // (A first version, the fill layer's filter dropped, changed nothing drawn: the hatch layer covers those counties
    // anyway. Replaced.)
    ['live: the hatch drawn over every county', MAP,
      "{ id: 'choro-none', type: 'fill', source: 'choro_source', filter: ['get', 'none'],",
      "{ id: 'choro-none', type: 'fill', source: 'choro_source',", 'wa'],
    ['Reset All keeps the shaded map', UI, "st.mapStyle = 'circles'; st.shadeMeasure = 'total';",
      "st.shadeMeasure = 'total';", 'wa'],
    ['live: the circles\' opacity used for the fill', UI,
      'shade: st.shade ? { counties: st.shade.maps[0], opacity: st.fillOpacity } : null });',
      'shade: st.shade ? { counties: st.shade.maps[0], opacity: st.opacity } : null });', 'wa'],
    ['Display Mode not grayed while shaded', UI,
      "doc.querySelectorAll('input[name=mode]').forEach(r => { r.disabled = on; });",
      "doc.querySelectorAll('input[name=mode]').forEach(r => { r.disabled = false; });", 'wa'],
    ['Flow: the lines still drawn while shaded', UI, 'W.flowmap.draw(flowMap, fl.shade ? null : fl.drawn);',
      'W.flowmap.draw(flowMap, fl.drawn);', 'flow'],
    ['Flow: a picked state dims nothing', UI, 'dim: pick.size > 0 && !pick.has(code), picked: pick.has(code) };',
      'dim: false, picked: pick.has(code) };', 'flow'],
    ['the GIF drawn with circles (shading not handed over)', UI,
      'regions: b.regions, background, population: b.population,\n        shade: b.shade }',
      'regions: b.regions, background, population: b.population }', 'png'],
    ['export_params.json not told of the shading', UI,
      'shade: ch.branded.shade && Object.assign({ cls: shadeClassesAt(inp, ch),\n',
      'shade: null && Object.assign({ cls: shadeClassesAt(inp, ch),\n', 'png'],
    // Alaska and Hawaii insets and the hover without animal counts.
    ['Flow: the lines to Alaska and Hawaii left on the map', 'site/cvi/app/flowmap.js',
      'const lines = all.filter(a => !insetState(st, a.state));', 'const lines = all;', 'insets'],
    ['the hover of a county without animal counts gives no records', UI,
      'if (c.none && records) return', 'if (false) return', 'records']
  ]
};

const mode = process.argv[2];
const picks = process.argv.slice(3).map(Number);
if (mode === 'list') {
  Object.keys(GROUPS).forEach(g => GROUPS[g].forEach((m, i) => console.log(g + ' ' + (i + 1) + '. ' + m[0] + ' (' + m[1] + ')')));
  process.exit(0);
}
if (!GROUPS[mode] || picks.some(n => !Number.isInteger(n) || n < 1 || n > GROUPS[mode].length)) {
  throw new Error('Use: <unit|page> [numbers ...] | list');
}
const list = GROUPS[mode].map((m, i) => ({ n: i + 1, name: m[0], file: m[1], from: m[2], to: m[3], part: m[4] }))
  .filter(m => !picks.length || picks.includes(m.n));

const sha = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const files = [...new Set(list.map(m => m.file))];
const before = Object.fromEntries(files.map(f => [f, sha(path.join(ROOT, f))]));

// One run of the group's suite in the copy (page: the parts named): the summary, the failed checks and whether it
// stopped early.
function runSuite(label, parts) {
  const started = Date.now();
  const args = mode === 'page' ? ['tests/browser/run_ch_browser.js'].concat(parts) : ['tests/node/run_ch_unit_tests.js'];
  const r = cp.spawnSync(process.execPath, args, { cwd: COPY, encoding: 'utf8', maxBuffer: 64 << 20,
    timeout: 8 * 60000, killSignal: 'SIGINT' });
  const output = (r.stdout || '') + (r.stderr || '');
  fs.writeFileSync(path.join(OUT, mode + '-' + label + '.log'), output);
  const m = [...output.matchAll(/(\d+) passed, (\d+) failed/g)].pop();
  const fails = output.split('\n').filter(l => /^\s*FAIL /.test(l));
  const onlyStopped = fails.length > 0 && fails.every(l => /ran to its end/.test(l));
  const crashed = !m || onlyStopped || r.signal !== null;
  return { status: r.status, passed: m ? Number(m[1]) : null, failed: m ? Number(m[2]) : null, crashed,
    firstFails: fails.slice(0, 4).map(l => l.slice(0, 200)), seconds: Math.round((Date.now() - started) / 1000) };
}

if (fs.existsSync(TEMP)) throw new Error('A mutation-copy folder exists: inspect the interrupted run before starting again.');
fs.mkdirSync(OUT, { recursive: true });
const results = [];
let caught = 0;
let restored = true;
try {
  for (const d of ['site', 'tests', 'test-tables']) fs.cpSync(path.join(ROOT, d), path.join(COPY, d), { recursive: true });
  const allParts = [...new Set(list.map(m => m.part).filter(Boolean))];
  const base = runSuite('baseline', allParts);
  console.log('unmutated: ' + JSON.stringify(base));
  results.push(Object.assign({ baseline: mode }, base));
  if (base.status !== 0 || base.failed !== 0 || base.crashed) throw new Error('The unmutated suite must pass before mutations.');
  for (const m of list) {
    const p = path.join(COPY, m.file);
    const original = fs.readFileSync(p, 'utf8');
    const hash = sha(p);
    const count = original.split(m.from).length - 1;
    if (count !== 1) throw new Error(m.n + '. ' + m.name + ': expected exactly one match, found ' + count);
    fs.writeFileSync(p, original.replace(m.from, () => m.to));
    let r;
    try {
      r = runSuite(String(m.n), m.part ? [m.part] : []);
    } finally {
      fs.writeFileSync(p, original);
    }
    restored = restored && sha(p) === hash;
    const ok = r.status === 1 && r.failed > 0 && !r.crashed;
    if (ok) caught++;
    results.push(Object.assign({ n: m.n, name: m.name, file: m.file, caught: ok }, r));
    const verdict = ok ? 'caught' : r.crashed ? 'STOPPED (not counted)' : 'MISSED';
    console.log(m.n + '. ' + verdict + ': ' + m.name + ' (' + r.passed + ' passed, ' + r.failed + ' failed, ' + r.seconds + ' s)');
    (r.firstFails || []).forEach(l => console.log('     ' + l));
  }
} finally {
  fs.rmSync(TEMP, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  fs.writeFileSync(path.join(OUT, mode + '-' + (picks.join('-') || 'all') + '.json'), JSON.stringify(results, null, 2) + '\n');
}
const unchanged = files.every(f => sha(path.join(ROOT, f)) === before[f]);
console.log(mode + ': ' + caught + ' of ' + list.length + ' mutants caught; copy restored: ' + restored
  + '; repository files unchanged: ' + unchanged + '; copy deleted: ' + !fs.existsSync(TEMP));
if (caught !== list.length || !restored || !unchanged) process.exitCode = 1;
