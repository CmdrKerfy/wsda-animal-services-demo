#!/usr/bin/env node
'use strict';
// MC mutations: the filter rules, the drop rule, the highlight and the movement counting must each fail a suite, and
// so must the movement view's, the ranking's and the export texts' later changes. Each mutant changes one exact piece
// of code in a temporary copy of the repository; the suite named for it must then report failed checks. A suite that stops early (a crash) does not count as catching it.
//
// Usage (repository root, after the MC fixtures and references (tests/README.md) and the F1 unit run):
//   node tests/mutation/run_mc_mutations.js unit 1 2 3      rule mutants by number (all when none is named) against
//                                                           the Node MC unit suite; about 30 s each, so name up to
//                                                           about 15 per call to stay under ten minutes
//   node tests/mutation/run_mc_mutations.js page 1 2 3      page mutants by number, each against one part of the MC
//                                                           browser suite (Chrome, file://); 1 to 6 per call
//   node tests/mutation/run_mc_mutations.js list            the numbered list
// Run in the foreground (the browser suite cannot start Chrome from a background job). The unmutated suite (or each
// part named in the call) runs first in the same copy and must pass. The copy is deleted at the end, and the
// repository's files are checked unchanged (SHA-256). Logs and a ledger: local-test-artifacts/mc/mutations/.
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join(ROOT, 'local-test-artifacts', 'mc', 'mutations');
const TEMP = path.join(ROOT, 'local-test-artifacts', 'mc', 'mutation-copy');
const COPY = path.join(TEMP, 'platform');
const CF = 'site/cvi/app/crossfilter.js', MV = 'site/cvi/app/movement.js', EXPORTS = 'site/cvi/app/exports.js';
const UI = 'site/cvi/app/ui.js', MAP = 'site/cvi/app/map.js', SVG = 'site/cvi/app/chartsvg.js';
const FLOWMAP = 'site/cvi/app/flowmap.js', FOCUSMAP = 'site/cvi/app/focusmap.js', HTML = 'site/cvi/index.html';

// [name, file, exact original text, replacement]; each must fail the Node MC unit suite.
const UNIT = [
  // The chart filter rules (crossfilter.js).
  ['a chart also filtered by its own kind', CF,
    'const kinds = VIEW_KINDS[view].filter(k => k !== own && state[view][k].length);',
    'const kinds = VIEW_KINDS[view].filter(k => state[view][k].length);'],
  ['kinds combined with "or"', CF, 'return r => tests.every(t => t(r));', 'return r => tests.some(t => t(r));'],
  ['a place tested after the merge, as before CVI\'s per-direction fix P1-12', CF,
    'return rows.filter(allOf(view, state, kinds));',
    'return root.CVIWA.summary.dedupeVolume(rows).filter(allOf(view, state, kinds));'],
  ['several periods as every year and quarter', CF, 'if (v.period.length > 1) {', 'if (false) {'],
  ['the Compare right map takes a species filter despite its own species', CF,
    'if (v.species.length && !(opts && opts.ownSpecies)) {', 'if (v.species.length) {'],
  ['over-time points clickable while browsing', CF,
    "if (view === 'focus' || !ctx || ctx.periodMode !== 'single') return null;", "if (view === 'focus') return null;"],
  ['"Non-WA" bars clickable', CF,
    "return mark.label === NON_WA ? null : { kind: 'place', value: mark.label };", "return { kind: 'place', value: mark.label };"],
  // The drop rule.
  ['nothing dropped when the sidebar removes its rows', CF,
    "drop(kind, v[kind].filter(x => !has(x)), 'rows');", "drop(kind, [], 'rows');"],
  ['a period filter kept while browsing', CF, "ctx.periodMode !== 'single') drop('period'", "false) drop('period'"],
  ['a corridor filter kept with the movement view off', CF, "drop('pair', v.pair, 'movement off');", 'void 0;'],
  // The highlight (County Focus).
  ['the County Focus highlight ignores a picked county', CF,
    'if (counties.size && !counties.has(C().countyLabel(p.county))) return;', ''],
  // The movement counting (movement.js).
  ['loader copies counted twice', MV, 'if (seen.has(fileRow)) continue;', 'if (false) continue;'],
  ['movement within a county left out', MV, 'const within = list => list.filter(p => p.origin === p.dest);',
    'const within = list => [];'],
  ['"N/A" read as a county', MV, "if (t === '' || t.toUpperCase() === 'N/A' || t.toUpperCase() === 'NA') return null;",
    "if (t === '' || t.toUpperCase() === 'NA') return null;"],
  ['a loose state test (lowercase "wa")', MV, "const isWa = s => s === 'WA';", "const isWa = s => String(s).toUpperCase() === 'WA';"],
  ['the earliest year\'s point', MV, 'const better = !b || year > b.year', 'const better = !b || year < b.year'],
  ['rows without a county counted as without a point', MV, 'leftOut.noCounty++;', 'leftOut.noPoint++;'],
  // The movement view's arrows and Top 10.
  ['the curve not cut back for the arrowhead', MV, 'let left = Math.min(room || 0, 0.4 * length);', 'let left = 0;'],
  ['the arrowhead pointing back', MV, 'Math.atan2(to[0] - from[0], to[1] - from[1])', 'Math.atan2(from[0] - to[0], from[1] - to[1])'],
  ['Top 25 by default', MV, 'const SHOWN_DEFAULT = 10;', 'const SHOWN_DEFAULT = 25;'],
  ['arrowheads not sized with the line', MV, 'const arrowLength = w => 10 + 1.6 * w;', 'const arrowLength = w => 18;'],
  // Rank groups and the ranking by "Show charts by:".
  ['Top 10 in one rank group', MV, 'const TIER_LAST_RANK = [5, 10, 25];', 'const TIER_LAST_RANK = [10, 25];'],
  ['rank group widths reversed', MV, 'const TIER_WIDTH = [7, 5, 3, 2];', 'const TIER_WIDTH = [2, 3, 5, 7];'],
  ['the first two group colors swapped', MV, "const TIER_COLORS = ['#245566', '#0094aa',", "const TIER_COLORS = ['#0094aa', '#245566',"],
  ['the top ranks drawn first', MV, '|| b.rank - a.rank);', '|| a.rank - b.rank);'],
  ['always ranked by animals', MV, "const f = MEASURE_FIELD[measure] || 'animals';", "const f = 'animals';"],
  ['ties not in the chart\'s label order', MV, "b[f] - a[f] || label(a).localeCompare(label(b), 'en')", 'b[f] - a[f]'],
  ['unique CVIs not trimmed', MV, "String(r.CVI).trim();", 'String(r.CVI);'],
  // County names trimmed, ties, corridors, empty pickers, hints and the fourth group's color.
  ['county names kept with their spaces', MV, "    return t;\n  }\n  // A row's county",
    "    return String(v);\n  }\n  // A row's county"],
  ['a WA corridor click tests untrimmed names', CF,
    "set.has(pairValue(trimmed(r['Origin.County']), trimmed(r['Dest.County'])))",
    "set.has(pairValue(r['Origin.County'], r['Dest.County']))"],
  ['ties in animals in pairs() order', MV, 'return between(list).slice().sort(',
    "return f === 'animals' ? between(list) : between(list).slice().sort("],
  ['a corridor tested against the sidebar\'s rows', CF,
    "if (kind === 'pair' && view === 'wa' && ctx && ctx.pairRows) source = ctx.pairRows;", 'void 0;'],
  ['chart filters dropped while a picker is empty', CF,
    'if (ctx && ctx.pickerEmpty) return { state: withView(state, view, v), dropped };', 'void 0;'],
  ['no "why not" hint while browsing', CF, "if (mode === 'browse') return 'Browse sets", "if (false) return 'Browse sets"],
  ['the fourth rank group in another color', MV, "'#4fb0bf', '#8cc5cf'];", "'#4fb0bf', '#000000'];"],
  // The export texts.
  ['no chart filter line in the Stats text', EXPORTS, 'if (f.chartFilters && f.chartFilters.length) lines.push(', 'if (false) lines.push('],
  ['no chart_filters in export_params.json', EXPORTS, 'if (f.chartFilters && f.chartFilters.length) p.chart_filters = f.chartFilters;', ''],
  ['no chart filters in a chart\'s caption', EXPORTS, 'if (f.chartFilters && f.chartFilters.length) parts.push(', 'if (false) parts.push('],
  ['several chart filters written as one text', EXPORTS, 'lines.push(\'  Chart filters: \' + f.chartFilters.join(\'; \'));',
    'lines.push(\'  Chart filters: \' + f.chartFilters[0]);'],
  // A true spotlight: only the pairs and rings touching it.
  ['a spotlight keeps the busiest other pairs (faded)', MV, 'const trueSpot = spot.size > 0 && !picked.size;',
    'const trueSpot = false;'],
  ['a spotlight keeps the other counties\' rings', MV, 'rings: trueSpot ? ringsOut.filter(r => r.on) : ringsOut,',
    'rings: ringsOut,']
];

// [name, file, exact original text, replacement, part of the MC browser suite]; each must fail that part.
const PAGE = [
  // Chart filters on the page.
  ['the WA map ignores the chart filters', UI, '    const fm = waMapFilters();\n    // req()',
    '    const fm = { species: st.species, years: st.years, quarters: st.quarters };\n    // req()', 'wa'],
  ['the charts ignore the chart filters', UI, 'rows: W.crossfilter.chartRows(view, input.rows, cf, id)', 'rows: input.rows', 'wa'],
  ['no drop on a sidebar change', UI, '    if (!r.dropped.length) return;\n    st.cf = r.state;', '    return;\n    st.cf = r.state;', 'wa'],
  ['Reset All keeps the chart filters', UI,
    '    st.cf = W.crossfilter.create(); st.cfMessage = null;   // MC: Reset All clears every chart filter', '', 'wa'],
  ['National Flow lines never dimmed', FLOWMAP, 'const DIM_OPACITY = 0.10;', 'const DIM_OPACITY = 1;', 'flow'],
  ['County Focus premises never highlighted', FOCUSMAP, 'const DIM_OPACITY = 0.10;', 'const DIM_OPACITY = 1;', 'focus'],
  ['click buttons without their click text', SVG, "'data-hover': hover, 'data-click': p.click }", "'data-hover': hover }", 'marks'],
  // The movement view.
  ['the circles stay shown under the movement view', MAP,
    "    LAYERS.forEach(([id]) => map.setLayoutProperty(id, 'visibility', st.mc ? 'none' : 'visible'));\n", '', 'movement'],
  ['no badges', UI, 'badges = chart.bars.slice(0, 3)', 'badges = chart.bars.slice(0, 0)', 'movement'],
  ['lines all one teal', MAP, "paint: { 'line-color': ['get', 'c'], 'line-width': ['get', 'w']",
    "paint: { 'line-color': MC_TEAL, 'line-width': ['get', 'w']", 'movement'],
  ['the arrowhead\'s tip at the line\'s end', MAP, "'icon-anchor': 'bottom'", "'icon-anchor': 'top'", 'movement'],
  ['arrowheads not turned along the line', MAP, "'icon-rotate': ['get', 'b']", "'icon-rotate': 0", 'movement'],
  ['no arrowhead pictures', MAP, 'if (/^mc-arrow-#[0-9a-f]{6}$/.test(e.id)) map.addImage', 'if (false) map.addImage', 'movement'],
  ['Top 25 when the page opens', UI, 'movementOn: false, movementCap: W.movement.SHOWN_DEFAULT', 'movementOn: false, movementCap: 25', 'movement'],
  ['Reset All puts Top 25 back', UI, 'st.movementOn = false; st.movementCap = W.movement.SHOWN_DEFAULT;',
    'st.movementOn = false; st.movementCap = 25;', 'movement'],
  ['the switch\'s label at the page\'s default size', HTML,
    'cursor: pointer; font-size: 0.85rem; line-height: 1.3; }\n  .mv-switch input', 'cursor: pointer; line-height: 1.3; }\n  .mv-switch input', 'movement'],
  // County names, the ranking and the legend.
  ['the measure does not redraw the map', UI,
    "    if (st.movementOn) schedule(0);\n    if (!(st.view === 'wa' && st.movementOn)) renderCharts();",
    '    renderCharts();', 'movement'],
  // The measure's redraw, the hint and empty Direction pickers.
  ['the measure redraws the map only on the WA view', UI,
    "    if (st.movementOn) schedule(0);\n    if (!(st.view === 'wa' && st.movementOn)) renderCharts();",
    "    if (st.view === 'wa' && st.movementOn) schedule(0);\n    else renderCharts();", 'movement'],
  ['no "why not" hint on the page', UI, 'noPick: noPickHint, ', '', 'wa'],
  ['chart filters dropped while no Direction is ticked', UI, 'return { pickerEmpty, pairRows };',
    'return { pickerEmpty: false, pairRows };', 'movement'],
  ['the map not ranked by the measure', UI, 'measure: st.chartMeasure,\n      scaling: st.scaling,', "measure: 'animals',\n      scaling: st.scaling,", 'movement'],
  ['county names unchanged under the movement view', MAP, "st.map.getContainer().classList.toggle('mc-on', !!v);", '', 'movement'],
  ['the screenshot\'s county names as before', MAP, 'const mv = !!st.mc && !region', 'const mv = false && !region', 'movement'],
  ['the legend shows the top group only', UI, 'if (!inTier.length) return;', 'if (!inTier.length || tier > 0) return;', 'movement'],
  ['legend sample lines in one teal', UI, "+ '\" y2=\"9\" stroke=\"' + l.color + '\" stroke-width=\"'",
    "+ '\" y2=\"9\" stroke=\"#245566\" stroke-width=\"'", 'movement'],
  // Exports and previews with chart filters.
  ['WA exports ignore the chart filters', UI, '      const fm = waMapFilters();\n      const f = { species: fm.species,',
    '      const fm = { species: st.species, years: st.years, quarters: st.quarters };\n      const f = { species: fm.species,', 'exports'],
  ['Flow exports ignore the chart filters', UI, "Object.assign(W.crossfilter.mapFilters('flow', flowFilters(), st.cf), { chartFilters })",
    'Object.assign(flowFilters(), { chartFilters })', 'exports'],
  ['County Focus exports ignore the chart filters', UI, "Object.assign(W.crossfilter.mapFilters('focus', focusOpts(), st.cf), { chartFilters })",
    "Object.assign(focusOpts(), { chartFilters: [] })", 'exports'],
  ['exports without the chart filters\' names', UI, 'const chartFilters = W.crossfilter.chips(cfState(), st.view).map(c => c.text);',
    'const chartFilters = [];', 'exports'],
  ['exported charts not counted as on screen', UI, 'const shown = chartsNow(ch.opts, ids)', 'const shown = CH.chartsFor(ch.view, input, ch.opts, true)', 'exports'],
  ['no faint marks in exported charts', UI, 'measure: ch.opts.measure, pickOf, fade })', 'measure: ch.opts.measure })', 'exports'],
  ['faint marks on the page only', SVG, 'if (!opts.pickOf || !opts.fade || !opts.fade(chart)) return false;',
    'if (!opts.interactive || !opts.pickOf || !opts.fade || !opts.fade(chart)) return false;', 'exports'],
  ['a spotlight takes rows out of the files', UI, '      return { f, rows: W.summary.mapRows(m, f) || [], agg, missing: [] };',
    "      return { f, rows: (W.summary.mapRows(m, f) || []).filter(r => !st.spotlight.length || st.spotlight.includes(r['Dest.County'])), agg, missing: [] };", 'exports'],
  ['no corridor chart exported with the movement view', UI, "    if (ch.view === 'wa' && st.movementOn) ids = ids.concat(['corridors']);\n", '', 'exports']
];

// The inputs the two suites read; their outputs land in the copy and are deleted with it.
const MC_REFERENCES = fs.readdirSync(path.join(ROOT, 'local-test-artifacts', 'mc'))
  .filter(f => /^oracle_mc_.*\.json$/.test(f)).map(f => 'local-test-artifacts/mc/' + f);
const ARTIFACTS = ['local-test-artifacts/s7/fixtures', 'local-test-artifacts/f1/tiers', 'test-tables'].concat(MC_REFERENCES);

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
  const args = mode === 'unit' ? ['tests/node/run_mc_unit_tests.js'] : ['tests/browser/run_mc_browser.js', part];
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
