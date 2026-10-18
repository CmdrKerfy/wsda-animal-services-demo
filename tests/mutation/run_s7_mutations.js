#!/usr/bin/env node
'use strict';
// S7 mutations: changes to the chart and export rules and to the page wiring must each fail a suite. Each mutant changes one exact piece of code in a temporary copy of the repository; the suite named
// for it must then report failed checks. A suite that stops early (a crash) does not count as catching it.
//
// Usage (repository root, after the S7 fixtures and references (tests/README.md) and the F1 unit run):
//   node tests/mutation/run_s7_mutations.js unit              every rule mutant against the Node S7 unit suite
//   node tests/mutation/run_s7_mutations.js page 1 2 3        page mutants by number, each against one part of the
//                                                             S7 browser suite (Chrome, file://); 1 to 6 per call,
//                                                             so each call stays under about ten minutes
//   node tests/mutation/run_s7_mutations.js list              the numbered list
// Run in the foreground (the browser suite cannot start Chrome from a background job). The unmutated suite (or each
// part named in the call) runs first in the same copy and must pass. The copy is deleted at the end, and the
// repository's files are checked unchanged (SHA-256). Logs and a ledger: local-test-artifacts/s7/mutations/.
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join(ROOT, 'local-test-artifacts', 's7', 'mutations');
const TEMP = path.join(ROOT, 'local-test-artifacts', 's7', 'mutation-copy');
const COPY = path.join(TEMP, 'platform');
const CHARTS = 'site/cvi/app/charts.js', EXPORTS = 'site/cvi/app/exports.js', SVG = 'site/cvi/app/chartsvg.js';
const UI = 'site/cvi/app/ui.js', PREVIEWS = 'site/cvi/app/previews.js', ZIP = 'site/shared/sample.js';

// [name, file, exact original text, replacement]; each must fail the Node S7 unit suite.
const UNIT = [
  ['top 10 bars instead of 12', CHARTS,
    'const N = 12;           // bars per chart', 'const N = 10;           // bars per chart'],
  ['empty periods not shown', CHARTS,
    'if (qn !== null && k > lo && k < hi && !periods.has(k))', 'if (false)'],
  ['same quarter last year compared with the quarter before', CHARTS,
    'prev = curr - 10;', 'prev = curr - 1;'],
  ['unique CVIs counted as records', CHARTS,
    "if (measure === 'cvis') return SUM().uniqueCvis(rows);", "if (measure === 'cvis') return rows.length;"],
  ['Emerging ties in the other order', CHARTS,
    '.sort((a, b) => a.value - b.value).reverse();', '.sort((a, b) => b.value - a.value);'],
  ['heatmap ties in locale order instead of dplyr\'s', CHARTS,
    'const totals = [...groups.keys()].sort(cmpC)', 'const totals = [...groups.keys()].sort(collate)'],
  ['Outbound above Inbound in "Top counties"', CHARTS,
    "const bars = ['Inbound', 'Outbound'].map(dir => {", "const bars = ['Outbound', 'Inbound'].map(dir => {"],
  ['top premises grouped by city', CHARTS,
    '.map(p => ({ key: p.premises_id,', '.map(p => ({ key: p.city,'],
  ['species bars teal instead of species colors', CHARTS,
    'color: speciesColor(t.key), valueLabel', 'color: COLORS.single, valueLabel'],
  ['over-time chart exported with one period', CHARTS,
    "const exported = periods < 2 ? ids.filter(id => id !== 'over_time')",
    "const exported = periods < 1 ? ids.filter(id => id !== 'over_time')"],
  ['top premises file named as CVI\'s top_farms.png', CHARTS,
    "top_premises: 'top_premises.png'", "top_premises: 'top_farms.png'"],
  ['fwrite tie written in scientific form', EXPORTS,
    'return sign + (fixed.length <= sci.length ? fixed : sci);', 'return sign + (fixed.length < sci.length ? fixed : sci);'],
  ['empty text written unquoted', EXPORTS, "if (s === '') return '\"\"';", "if (s === '') return '';"],
  ['TRUE/FALSE read as text', EXPORTS,
    "if (LOGICAL.test(v)) return ['logical', 'character'];", "if (false) return ['logical', 'character'];"],
  ['Map Data rounded by toFixed instead of R\'s round', EXPORTS,
    'const round3 = x => roundR(x, 3);', 'const round3 = x => Number(x.toFixed(3));'],
  ['filtered_rows.csv without merging a movement\'s loader copies', EXPORTS,
    'const rows = SUM().dedupeVolume(mapRows);', 'const rows = mapRows;'],
  ['no facility layer written as [] instead of {}', EXPORTS,
    'opts.layersOn && opts.layersOn.length ? opts.layersOn : null', 'opts.layersOn && opts.layersOn.length ? opts.layersOn : []'],
  ['folder name lists every County Focus county', EXPORTS,
    "area = f.counties.length <= 3 ? f.counties.map(alnum).join('-') : f.counties.length + 'Counties';",
    "area = f.counties.map(alnum).join('-');"],
  ['Stats lists more than 10 top places', EXPORTS,
    '.sort((a, b) => b[1] - a[1]).slice(0, 10);', '.sort((a, b) => b[1] - a[1]).slice(0, 11);'],
  ['a single value written as a list in export_params.json', EXPORTS,
    'return v.length === 1 ? jsonValue(v[0]) :', 'return v.length === -1 ? jsonValue(v[0]) :'],
  // CVI's per-direction fix P1-12: each chart counts the rows it should.
  ['top counties from the merged rows (CVI\'s current code)', CHARTS,
    "if (id === 'top_places') return topPlaces(drawn, opts);", "if (id === 'top_places') return topPlaces(merged, opts);"],
  ['over time from the merged rows (CVI\'s current code)', CHARTS,
    "if (id === 'over_time') return overTime(drawn, opts);", "if (id === 'over_time') return overTime(merged, opts);"],
  ['emerging vs cooling from the merged rows (CVI\'s current code)', CHARTS,
    "if (id === 'emerging') return emerging(drawn, opts);", "if (id === 'emerging') return emerging(merged, opts);"],
  ['species from both copies of a WA-to-WA movement', CHARTS,
    "if (id === 'species') return species(merged, opts);", "if (id === 'species') return species(drawn, opts);"],
  ['corridors from both copies of a WA-to-WA movement', CHARTS,
    "if (id === 'corridors') return corridors(merged, opts);", "if (id === 'corridors') return corridors(drawn, opts);"],
  // Missing premises coordinates, escaping, the PNG resolution, ZIP dates and the preview search.
  ['top premises not grayed without premises coordinates', CHARTS,
    'if (missingCoordinates && missingCoordinates.length) {', 'if (false) {'],
  ['SVG attributes not escaped', SVG,
    "(typeof a[n] === 'number' ? num(a[n]) : esc(a[n]))", "(typeof a[n] === 'number' ? num(a[n]) : a[n])"],
  ['control characters kept in the SVG', SVG,
    "const esc = s => String(s).replace(/[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\uFFFE\\uFFFF]/g, '')",
    'const esc = s => String(s)'],
  ['PNG resolution rounded to 5,906 per meter, not CVI\'s 5,905', SVG,
    'const ppm = Math.floor(dpi / 0.0254);', 'const ppm = Math.round(dpi / 0.0254);'],
  ['default ZIP date a day late', ZIP,
    '(9 << 5) | 15;', '(9 << 5) | 16;'],
  ['search words all needed in one cell, not across the row', PREVIEWS,
    "if (s.length && !holdsAll(r.map(v => cellText(v).toLowerCase()).join('  '), s)) return false;",
    'if (s.length && !r.some(v => holdsAll(cellText(v).toLowerCase(), s))) return false;'],
  ['a quoted phrase split into words', PREVIEWS,
    '.match(/"[^"]*"|[^\\s"]+/g)', '.match(/[^\\s"]+/g)']
];

// [name, file, exact original text, replacement, part of the S7 browser suite]; each must fail that part.
const PAGE = [
  ['spotlight list not updated on a bar click', UI,
    "    renderList('spotlight');\n    renderCharts();\n    schedule();", '    renderCharts();\n    schedule();', 'spotlight'],
  ['Enter does not spotlight', UI,
    "if (e.key !== 'Enter' && e.key !== ' ') return;", "if (e.key !== ' ') return;", 'spotlight'],
  ['Non-WA bars clickable (as the N/A county)', UI,
    "    if (label === 'Non-WA') return null;\n", "    if (label === 'Non-WA') label = 'N/A';\n", 'spotlight'],
  ['charts follow the right map in Compare', UI,
    '      quarters: per.quarters.slice() };\n    const charts = CH.chartsFor(st.view, chartInput(), opts, false);',
    "      quarters: per.quarters.slice() };\n    if (st.view === 'wa' && st.periodMode === 'compare') opts.years = st.yearsB.map(String);\n    const charts = CH.chartsFor(st.view, chartInput(), opts, false);",
    'spotlight'],
  ['Reset All also resets the layout', UI,
    "    setStyles('auto', 'auto');   // CVI: label and boundary style back to Auto",
    "    setStyles('auto', 'auto');   // CVI: label and boundary style back to Auto\n    st.layouts[st.view] = 'map';\n    applyLayout();",
    'spotlight'],
  ['charts beside the map in narrow windows', UI,
    'const BELOW_WIDTH = 1200;', 'const BELOW_WIDTH = 900;', 'layout'],
  ['Unique CVIs never grayed', UI,
    "measureSel.querySelector('option[value=\"cvis\"]').disabled = !cvis.ok;",
    "measureSel.querySelector('option[value=\"cvis\"]').disabled = false;", 'measure'],
  ['hover text of a mark replaced by its label', SVG,
    'spot ? {} : markAttrs(opts, b.hover)', 'spot ? {} : markAttrs(opts, r.label)', 'charts'],
  ['bars listed bottom to top', SVG,
    'const cy = box.y + unit * (t + 1.1);', 'const cy = box.y + unit * (n - t + 0.1);', 'charts'],
  ['chart PNGs at the page\'s size', SVG,
    'const o = Object.assign({ width: size.width, height: size.height,', 'const o = Object.assign({ width: 640, height: 320,', 'png'],
  ['Emerging subtitle not drawn', SVG,
    'if (chart.subtitle) line(chart.subtitle, g.pt.subtitle, INK.subtitle);',
    "if (chart.subtitle && chart.id !== 'emerging') line(chart.subtitle, g.pt.subtitle, INK.subtitle);", 'measure'],
  ['export text at the page\'s 12 pt', SVG,
    'const SCREEN_BASE_PT = 12, EXPORT_BASE_PT = 14;', 'const SCREEN_BASE_PT = 12, EXPORT_BASE_PT = 12;', 'checkpoint'],
  ['top-premises card back to 448 px', SVG,
    "(chart.id === 'top_premises' ? 560 : 320)", "(chart.id === 'top_premises' ? 448 : 320)", 'checkpoint'],
  ['Map Data numbers sorted as text', PREVIEWS,
    "else if (typeof x === 'number' && typeof y === 'number') c = x - y;", 'else if (false) c = x - y;', 'previews'],
  ['Map Data with 10 rows per page', PREVIEWS, 'const PAGE_SIZE = 15;', 'const PAGE_SIZE = 10;', 'previews'],
  ['previews without County Focus\'s county check', UI,
    "    if (st.view === 'focus' && !fo.counties.length) {\n      previewMessage(EX.MESSAGES.focusCountyPreview);",
    '    if (false) {\n      previewMessage(EX.MESSAGES.focusCountyPreview);', 'previews'],
  ['Escape in the search box leaves the dialog open', PREVIEWS,
    "      if (e.key !== 'Escape') return;\n      e.preventDefault();\n      close();",
    "      if (e.key !== 'Escape') return;", 'previews'],
  ['a click inside the dialog closes it', PREVIEWS, '      if (pressedOnBackdrop && onBackdrop(e)) close();', '      close();', 'previews'],
  ['ZIP entries dated a month early', ZIP, '((d.getMonth() + 1) << 5)', '((d.getMonth()) << 5)', 'exports'],
  ['files written in another order than CVI\'s', EXPORTS,
    "    if (parts.filteredRows) {\n      add('filtered_rows.csv', parts.filteredRows.text);\n      written.push('filtered_rows.csv (' + S().comma(parts.filteredRows.rows) + ' rows)');\n    }\n    if (parts.summaryTable) { add('summary_table.csv', parts.summaryTable); written.push('summary_table.csv'); }",
    "    if (parts.summaryTable) { add('summary_table.csv', parts.summaryTable); written.push('summary_table.csv'); }\n    if (parts.filteredRows) {\n      add('filtered_rows.csv', parts.filteredRows.text);\n      written.push('filtered_rows.csv (' + S().comma(parts.filteredRows.rows) + ' rows)');\n    }",
    'exports'],
  ['"Exports this session" keeps four', EXPORTS,
    'return [{ name: zipName, time: now }].concat(history || []).slice(0, 5);',
    'return [{ name: zipName, time: now }].concat(history || []).slice(0, 4);', 'exports'],
  ['Reset All clears the Optional Filename', UI,
    "    setStyles('auto', 'auto');   // CVI: label and boundary style back to Auto",
    "    setStyles('auto', 'auto');   // CVI: label and boundary style back to Auto\n    $('export-label').value = '';",
    'exports'],
  // Exports, previews and the page charts.
  ['export chart names follow the Map View after the click', UI,
    'const name = CH.fileName(c.id, ch.view);', 'const name = CH.fileName(c.id, st.view);', 'exports'],
  ['export_params.json follows the Map View after the click', UI,
    'parts.params = EX.exportParams(view, inp.f,', 'parts.params = EX.exportParams(st.view, inp.f,', 'exports'],
  ['Preview Charts without "Drawing…"', UI, "    b.textContent = 'Drawing…';\n", '', 'exports'],
  ['a drag from inside released beside the dialog closes it', PREVIEWS,
    '      if (pressedOnBackdrop && onBackdrop(e)) close();', '      if (onBackdrop(e)) close();', 'previews'],
  ['PNG without its 150-dpi pHYs chunk', SVG,
    'resolve(new root.Blob([pngWithDpi(new Uint8Array(buf), o.dpi, root.WSDA.zip.crc32)],', 'resolve(new root.Blob([new Uint8Array(buf)],', 'png'],
  ['page charts without the missing premises coordinates', UI,
    'missingCoordinates: fo.built ? fo.built.missingCoordinates : [] };', 'missingCoordinates: [] };', 'subsets'],
  ['SVG text not escaped', SVG,
    "text: (s, a) => parts.push('<text' + attrs(a) + '>' + esc(s) + '</text>')",
    "text: (s, a) => parts.push('<text' + attrs(a) + '>' + s + '</text>')", 'special']
];

// The inputs the two suites read; their outputs land in the copy and are deleted with it.
const S7_REFERENCES = fs.readdirSync(path.join(ROOT, 'local-test-artifacts', 's7'))
  .filter(f => /^oracle_s7_.*\.json$/.test(f)).map(f => 'local-test-artifacts/s7/' + f);
const ARTIFACTS = ['local-test-artifacts/s7/fixtures', 'local-test-artifacts/f1/tiers', 'test-tables'].concat(S7_REFERENCES);

const mode = process.argv[2];
const picks = process.argv.slice(3).map(Number);
if (mode === 'list') {
  UNIT.forEach((m, i) => console.log('unit ' + (i + 1) + '. ' + m[0] + ' (' + m[1] + ')'));
  PAGE.forEach((m, i) => console.log('page ' + (i + 1) + '. ' + m[0] + ' (' + m[1] + ', part ' + m[4] + ')'));
  process.exit(0);
}
if (!['unit', 'page'].includes(mode) || picks.some(n => !Number.isInteger(n) || n < 1)) {
  throw new Error('Use: unit [numbers ...] | page <1 to 6 numbers> | list');
}
const all = mode === 'unit' ? UNIT : PAGE;
if (picks.some(n => n > all.length)) throw new Error('Unknown mutant number');
if (mode === 'page' && (picks.length < 1 || picks.length > 6)) throw new Error('Page calls take 1 to 6 mutant numbers.');
const list = all.map((m, i) => ({ n: i + 1, name: m[0], file: m[1], from: m[2], to: m[3], part: m[4] || null }))
  .filter(m => !picks.length || picks.includes(m.n));

const sha = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const files = [...new Set(list.map(m => m.file))];
const before = Object.fromEntries(files.map(f => [f, sha(path.join(ROOT, f))]));

// One run of the suite in the copy: the summary line, and whether it stopped early.
function runSuite(part, label) {
  const args = mode === 'unit' ? ['tests/node/run_s7_unit_tests.js'] : ['tests/browser/run_s7_browser.js', part];
  const started = Date.now();
  const r = cp.spawnSync(process.execPath, args, { cwd: COPY, encoding: 'utf8', maxBuffer: 64 << 20,
    timeout: 6 * 60000, killSignal: 'SIGINT' });
  const output = (r.stdout || '') + (r.stderr || '');
  fs.writeFileSync(path.join(OUT, mode + '-' + label + '.log'), output);
  const m = output.match(/(\d+) passed, (\d+) failed\s*$/);
  // The browser suite reports a stop as "FAIL run stopped"; a timeout ends without the summary.
  const crashed = !m || /FAIL run stopped/.test(output) || r.signal !== null;
  return { status: r.status, passed: m ? Number(m[1]) : null, failed: m ? Number(m[2]) : null, crashed,
    seconds: Math.round((Date.now() - started) / 1000) };
}

if (fs.existsSync(TEMP)) throw new Error('A mutation-copy folder exists: inspect the interrupted run before starting again.');
fs.mkdirSync(OUT, { recursive: true });
const results = [];
let caught = 0;
let restored = true;
try {
  for (const d of ['site', 'tests']) fs.cpSync(path.join(ROOT, d), path.join(COPY, d), { recursive: true });
  for (const a of ARTIFACTS) fs.cpSync(path.join(ROOT, a), path.join(COPY, a), { recursive: true });

  const parts = mode === 'unit' ? [null] : [...new Set(list.map(m => m.part))];
  for (const part of parts) {
    const base = runSuite(part, 'baseline' + (part ? '-' + part : ''));
    console.log('unmutated' + (part ? ' ' + part : '') + ': ' + JSON.stringify(base));
    results.push(Object.assign({ baseline: part || 'unit' }, base));
    if (base.status !== 0 || base.failed !== 0 || base.crashed) throw new Error('The unmutated suite must pass before mutations.');
  }
  for (const m of list) {
    const p = path.join(COPY, m.file);
    const original = fs.readFileSync(p, 'utf8');
    const hash = sha(p);
    const count = original.split(m.from).length - 1;
    if (count !== 1) throw new Error(m.n + '. ' + m.name + ': expected exactly one match, found ' + count);
    fs.writeFileSync(p, original.replace(m.from, () => m.to));
    let r;
    try {
      r = runSuite(m.part, String(m.n));
    } finally {
      fs.writeFileSync(p, original);
    }
    restored = restored && sha(p) === hash;
    const ok = r.status === 1 && r.failed > 0 && !r.crashed;
    if (ok) caught++;
    results.push(Object.assign({ n: m.n, name: m.name, file: m.file, part: m.part, caught: ok }, r));
    const verdict = ok ? 'caught' : r.crashed ? 'STOPPED (not counted)' : 'MISSED';
    console.log(m.n + '. ' + verdict + ': ' + m.name + ' (' + r.passed + ' passed, ' + r.failed + ' failed, ' + r.seconds + ' s)');
  }
} finally {
  fs.rmSync(TEMP, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  fs.writeFileSync(path.join(OUT, mode + '-' + (picks.join('-') || 'all') + '.json'), JSON.stringify(results, null, 2) + '\n');
}
const unchanged = files.every(f => sha(path.join(ROOT, f)) === before[f]);
console.log(mode + ': ' + caught + ' of ' + list.length + ' mutants caught; copy restored: ' + restored
  + '; repository files unchanged: ' + unchanged + '; copy deleted: ' + !fs.existsSync(TEMP));
if (caught !== list.length || !restored || !unchanged) process.exitCode = 1;
