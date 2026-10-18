#!/usr/bin/env node
'use strict';
// S7 unit tests: the chart rules (site/cvi/app/charts.js) and the export and preview rules (site/cvi/app/exports.js)
// against CVI's own module, run by tests/oracle/s7_charts_oracle.R through shiny::testServer on synthetic data
// (local-test-artifacts/s7/oracle_s7_<fixture>.json and oracle_s7_formats.json).
//
// For every fixture, Map View and scenario of the reference:
//   - CVI's drawer charts (species, top places, over time, corridors, emerging vs cooling): the page's bars, their
//     order, values and colors, the titles, subtitles and gray messages; since CVI's per-direction fix P1-12 the
//     charts by direction against CVI's own chart functions on the rows the map draws (both copies of a WA-to-WA
//     movement), the totals across directions against CVI's drawer on the merged rows;
//   - the page's chart additions, against the reference's separate R rules (checked there against CVI's own charts):
//     CVI records and unique CVIs, empty periods at zero, the same quarter last year, top premises;
//   - the chart design: species colors, the export's chart set and file names, the two heatmaps against
//     CVI's export heatmaps on the same rows;
//   - the files, byte for byte: filtered_rows.csv, summary_table.csv and export_params.json (the time masked),
//     against CVI's own writer given the rows the map draws, and CVI's export as it is today where
//     exporting the drawn rows changes nothing; the folder name, the file list and the messages;
//   - the previews: the Map Data table, the Stats text (the time masked) and the dialogs' titles and footers.
// Then CVI's number, text and JSON formats on their own: 939 numbers through data.table::fwrite, scales::comma,
// the heatmaps' short labels, format(big.mark = ",") and jsonlite's pretty JSON.
//
// Deliberate differences checked as such: species bars in species colors (CVI's drawer: teal);
// titles for the other measures; top premises in place of top counties on County Focus; empty periods; the export
// keeps the rows the map draws. Where the page's merge rule (only the loader's two copies of a WA-to-WA row merge)
// gives other rows than CVI's merge (any rows equal apart from the direction), the comparisons with CVI's rows are
// counted as "WA-to-WA merge scenarios" and the page's merged rows are checked to be the larger set.
//
// Usage (repository root): node tests/node/run_f1_unit_tests.js, node tests/synthetic/make_cvi_s7_fixtures.js,
// Rscript tests/oracle/s7_charts_oracle.R, then node tests/node/run_s7_unit_tests.js [fixture ...]   (Node >= 22, no packages)

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');
const SITE = path.join(ROOT, 'site');
const APP = path.join(SITE, 'cvi', 'app');
const ORACLE = path.join(ROOT, 'local-test-artifacts', 's7');

const zlib = require('zlib');

const sandbox = { window: {}, console, TextEncoder, TextDecoder };
vm.createContext(sandbox);
const FILES = ['csv.js', 'master.js', 'scaling.js', 'palettes.js', 'aggregate.js', 'summary.js', 'flow.js',
  'focus.js', 'charts.js', 'exports.js', 'chartsvg.js', 'previews.js'];
for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(APP, f), 'utf8'), sandbox, { filename: f });
vm.runInContext(fs.readFileSync(path.join(SITE, 'geo', 'state-centers.js'), 'utf8'), sandbox);
for (const f of ['zip.js', 'sample.js']) vm.runInContext(fs.readFileSync(path.join(SITE, 'shared', f), 'utf8'), sandbox, { filename: f });
const W = sandbox.window.CVIWA;
const C = W.charts;
const E = W.exports;
const CENTERS = W.flow.centers(sandbox.window.WSDA_STATE_CENTERS);

// ── Test bookkeeping ───────────────────────────────────────────────────────────────────────────────────────────
let pass = 0;
let fail = 0;
const failures = [];
const counts = {};
function check(ok, name, detail) {
  if (ok) {
    pass++;
  } else {
    fail++;
    failures.push(name + (detail === undefined ? '' : ' :: ' + JSON.stringify(detail).slice(0, 600)));
  }
}
const tally = key => { counts[key] = (counts[key] || 0) + 1; };
// CVI's message when County Focus has no premises coordinates, as its reference records it.
const cviCoordinatesMessage = missing => 'County Focus export needs premises coordinates (' + missing.join(', ') +
  '), which are missing from this master file. Re-run Assign County Locations, Generate County Map Points, and ' +
  'Generate State Flow Lines on this data first, then reload it here.';
const near = (a, b) => typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b));
const sameNumbers = (a, b) => a.length === b.length && a.every((x, i) => near(x, b[i]));
const list = x => (x === null || x === undefined ? [] : Array.isArray(x) ? x : [x]);
const rowsOf = d => (d && d.rows ? d.rows : []);
const maskTime = s => s.replace(/"exported_at": "[^"]*"/, '"exported_at": "TIME"');
const maskGenerated = lines => lines.map(l => (l.startsWith('Generated: ') ? 'Generated: TIME' : l));
// The page's Stats text writes the quarters "Q1, Q2" and adds Unique CVIs, a note when
// WA-to-WA movements count at both ends, and the change from the previous quarter (additions by design); this takes
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

// ── The page's side of one scenario ────────────────────────────────────────────────────────────────────────────
// The reference's inputs are CVI's input names; these are the same choices in the page's terms.
function pageFilters(view, inp) {
  if (view === 'wa') {
    return { species: list(inp.county_species), years: list(inp.county_year).map(Number), quarters: list(inp.county_quarter),
      direction: list(inp.county_direction), rawSpecies: list(inp.county_species_sub), mode: inp.county_mode,
      scaling: inp.county_scaling, nBins: Number(inp.county_n_bins) };
  }
  if (view === 'flow') {
    return { species: list(inp.flow_species), years: list(inp.flow_year).map(Number), quarters: list(inp.flow_quarter),
      direction: inp.flow_direction, speciesSub: list(inp.flow_species_sub), combine: inp.flow_combine_species === true,
      scaling: inp.flow_scaling, nBins: Number(inp.flow_n_bins) };
  }
  return { counties: list(inp.intra_counties), species: list(inp.intra_species), years: list(inp.intra_year).map(Number),
    quarters: list(inp.intra_quarter), direction: inp.intra_filter_dir, rawSpecies: list(inp.intra_species_sub),
    mode: inp.intra_mode, scaling: inp.intra_scaling, nBins: Number(inp.intra_n_bins) };
}
// The rows the map draws and its aggregated rows (circles, lines or premises).
function pageView(loaded, view, f) {
  if (view === 'wa') {
    const rows = W.summary.mapRows(loaded, f) || [];
    const agg = W.aggregate.build(loaded.rows, Object.assign({}, f, { hasSpecies: loaded.hasSpecies }));
    return { rows, agg };
  }
  if (view === 'flow') {
    const rows = W.flow.mapRows(loaded, f) || [];
    return { rows, agg: W.flow.lines(loaded, f, CENTERS) || [] };
  }
  const rows = W.focus.summaryRows(loaded, f) || [];
  const built = W.focus.build(loaded, f);
  return { rows, agg: built.premises, missing: built.missingCoordinates };
}

// ── Comparing a chart with CVI's drawer chart ──────────────────────────────────────────────────────────────────
// CVI's chart record: { empty } or { title, subtitle, slots (bottom to top, or periods left to right), data, marks }.
function compareDrawer(id, page, cvi, name) {
  if (cvi.empty !== undefined) {
    check(page.empty === cvi.empty, name + ': gray message as CVI', { page: page.empty, cvi: cvi.empty });
    return;
  }
  check(page.empty === null, name + ': drawn as CVI draws it', page.empty);
  if (page.empty !== null) return;
  const rows = cvi.data.rows;
  if (id === 'species' || id === 'corridors') {
    const key = id === 'species' ? 'g' : 'pair';
    const top = cvi.slots.slice().reverse();
    check(JSON.stringify(page.bars.map(b => b.label)) === JSON.stringify(top), name + ': bars and order', { page: page.bars.map(b => b.label), cvi: top });
    check(sameNumbers(page.bars.map(b => b.value), top.map(k => rows.find(r => r[key] === k).a)), name + ': values');
    check(page.title === (id === 'species' ? 'Animals by species group' : 'Top movement corridors') && page.title === cvi.title,
      name + ': title', [page.title, cvi.title]);
    if (id === 'corridors') check(page.bars.every(b => b.color === '#245566') && cvi.marks.every(m => m.color === '#245566'), name + ': teal bars');
    if (id === 'species') {
      // Question 10: species colors in place of CVI's teal.
      check(cvi.marks.every(m => m.color === '#245566'), name + ': CVI draws teal');
      check(page.bars.every(b => b.color === C.speciesColor(b.label)), name + ': species colors');
    }
    if (cvi.labels) check(JSON.stringify(page.bars.map(b => b.valueLabel)) === JSON.stringify(cvi.labels.slice().reverse()), name + ': value labels', [page.bars.map(b => b.valueLabel), cvi.labels]);
    return;
  }
  if (id === 'top_places') {
    const top = cvi.slots.slice().reverse();
    check(JSON.stringify(page.groups.map(g => g.label)) === JSON.stringify(top), name + ': places and order', { page: page.groups.map(g => g.label), cvi: top });
    const pageBars = [].concat(...page.groups.map(g => g.bars.map(b => g.label + '|' + b.series + '|' + b.value + '|' + b.color)));
    const cviBars = rows.map(r => {
      const color = r.mv === 'Inbound' ? '#1C9CD9' : '#F0A06E';
      return r.geo + '|' + r.mv + '|' + r.a + '|' + color;
    });
    check(JSON.stringify(pageBars.slice().sort()) === JSON.stringify(cviBars.slice().sort()), name + ': bars per direction', { page: pageBars, cvi: cviBars });
    // A recorded difference: Inbound above Outbound in each place (CVI's ggplot puts
    // Outbound on top).
    const both = page.groups.filter(g => g.bars.length === 2);
    if (both.length) {
      check(both.every(g => g.bars[0].series === 'Inbound' && g.bars[1].series === 'Outbound'), name + ': Inbound above Outbound',
        both.map(g => g.bars.map(b => b.series)));
    }
    check(page.title === cvi.title, name + ': title', [page.title, cvi.title]);
    return;
  }
  if (id === 'over_time') {
    // CVI's periods are those with data; the page adds the empty ones between; compared where both have them.
    const periods = cvi.slots;
    check(periods.every(p => page.periods.includes(p)), name + ': CVI periods on the axis', { page: page.periods, cvi: periods });
    let same = true;
    rows.forEach(r => {
      const s = page.series.find(x => x.name === r.mv);
      const v = s ? s.values[page.periods.indexOf(r.label)] : undefined;
      if (!near(v, r.a)) same = false;
    });
    check(same, name + ': values per period and direction');
    check(page.title === cvi.title, name + ': title', [page.title, cvi.title]);
    check(page.pointsOnly === !cvi.lines, name + ': points only with one period');
    return;
  }
  if (id === 'emerging') {
    const top = cvi.slots.slice().reverse();
    check(JSON.stringify(page.bars.map(b => b.label)) === JSON.stringify(top), name + ': places and order', { page: page.bars.map(b => b.label), cvi: top });
    check(sameNumbers(page.bars.map(b => b.value), top.map(k => rows.find(r => r.geo === k).delta)), name + ': changes');
    check(page.subtitle === cvi.subtitle && page.title === cvi.title, name + ': title and subtitle', [page.subtitle, cvi.subtitle]);
    check(page.bars.every(b => b.color === (b.value >= 0 ? '#2e7d4f' : '#a23b3b')), name + ': green rises, red falls');
  }
}

// ── The chart additions' references ────────────────────────────────────────────────────────────────────────────
function compareReference(id, page, ref, name) {
  if (ref.empty !== undefined) {
    check(page.empty === ref.empty, name + ': gray message', { page: page.empty, ref: ref.empty });
    return;
  }
  check(page.empty === null, name + ': drawn', page.empty);
  if (page.empty !== null) return;
  if (id === 'species' || id === 'corridors') {
    check(JSON.stringify(page.bars.map(b => b.label)) === JSON.stringify(ref.bars.map(b => b.key)), name + ': bars and order', { page: page.bars.map(b => b.label), ref: ref.bars.map(b => b.key) });
    check(sameNumbers(page.bars.map(b => b.value), ref.bars.map(b => b.value)), name + ': values');
  } else if (id === 'top_places') {
    check(JSON.stringify(page.groups.map(g => g.label)) === JSON.stringify(list(ref.order)), name + ': places and order');
    const p = [].concat(...page.groups.map(g => g.bars.map(b => g.label + '|' + b.series + '|' + b.value))).sort();
    const r = ref.bars.map(b => b.key + '|' + b.series + '|' + b.value).sort();
    check(JSON.stringify(p) === JSON.stringify(r), name + ': bars per direction', { p, r });
  } else if (id === 'over_time') {
    check(JSON.stringify(page.periods) === JSON.stringify(list(ref.periods)), name + ': every period between the first and last', { page: page.periods, ref: ref.periods });
    const p = [].concat(...page.series.map(s => s.values.map((v, i) => page.periods[i] + '|' + s.name + '|' + v))).sort();
    const r = ref.points.map(x => x.period + '|' + x.series + '|' + x.value).sort();
    check(JSON.stringify(p) === JSON.stringify(r), name + ': values, empty periods at zero', { p, r });
  } else if (id === 'emerging') {
    check(JSON.stringify(page.bars.map(b => b.label)) === JSON.stringify(ref.bars.map(b => b.key).reverse()), name + ': places and order');
    check(sameNumbers(page.bars.map(b => b.value), ref.bars.map(b => b.value).reverse()), name + ': changes');
    check(page.from === ref.from && page.to === ref.to, name + ': periods compared', [page.from, page.to, ref.from, ref.to]);
  }
}

// ── One fixture ────────────────────────────────────────────────────────────────────────────────────────────────
const TYPE_OF_R = { integer: 'integer', numeric: 'double', character: 'character', logical: 'logical', IDate: 'date',
  POSIXct: 'datetime', integer64: 'integer64' };

function runFixture(file) {
  const o = JSON.parse(fs.readFileSync(path.join(ORACLE, file), 'utf8'));
  const fx = o.fixture;
  const loaded = W.master.load(fs.readFileSync(path.join(ROOT, o.file), 'utf8'));
  check(loaded.ok && loaded.physicalRows === o.physical_rows && loaded.mapRows === o.map_rows, fx + ': loaded as CVI loads it');

  // Column types, as CVI's reader gives them (exports.js columnTypes).
  const types = E.columnTypes(loaded);
  const typeErrors = Object.keys(o.column_types).filter(c => types[c] !== TYPE_OF_R[o.column_types[c]]);
  check(typeErrors.length === 0, fx + ': column types as CVI reads them', typeErrors.map(c => [c, types[c], o.column_types[c]]));

  for (const view of ['wa', 'flow', 'focus']) {
    for (const [scName, rec] of Object.entries(o.views[view])) {
      const name = fx + ' ' + view + ' ' + scName;
      tally('scenarios');
      runScenario(loaded, types, view, rec, name);
    }
  }
}

// County Focus rows without the page's WA guard (a deliberate difference: the counted end's state must be "WA"; CVI
// checks the county name only). Used to explain a County Focus row count that differs from CVI's.
function focusRowsWithoutGuard(loaded, f) {
  const sp = new Set(f.species), yr = new Set(f.years), qt = new Set(f.quarters), cty = new Set(f.counties);
  const raw = new Set(f.rawSpecies);
  return loaded.rows.filter(r => {
    const end = r.Movement === 'Inbound' ? 'Dest' : r.Movement === 'Outbound' ? 'Origin' : null;
    const dirOk = f.direction === 'combined' || r.Movement === (f.direction === 'inbound' ? 'Inbound' : 'Outbound');
    return end !== null && dirOk && sp.has(r['Species.Group']) && yr.has(r['Reporting.Year'])
      && qt.has(r['Reporting.Quarter']) && cty.has(r[end + '.County']) && (!raw.size || !loaded.hasSpecies || raw.has(r.Species));
  });
}

function runScenario(loaded, types, view, rec, name) {
  const f = pageFilters(view, rec.inputs);
  const pv = pageView(loaded, view, f);
  const merged = W.summary.dedupeVolume(pv.rows);
  const cviRows = rec.approved.rows;
  // The page and CVI select the same rows unless a deliberate difference says otherwise; those scenarios are counted and
  // the reason checked, and the comparisons that need CVI's rows are left out for them.
  let sameRows = pv.rows.length === cviRows && merged.length === rec.chart_rows;
  if (pv.rows.length !== cviRows) {
    tally('County Focus WA-guard scenarios');
    check(view === 'focus' && focusRowsWithoutGuard(loaded, f).length === cviRows,
      name + ': only the page\'s WA guard makes the rows differ from CVI\'s', [pv.rows.length, cviRows]);
  } else if (merged.length !== rec.chart_rows) {
    // The page's merge rule keeps rows CVI's merge drops; never the other way round.
    tally('WA-to-WA merge scenarios');
    check(merged.length > rec.chart_rows, name + ': the page\'s merge keeps more rows than CVI', [merged.length, rec.chart_rows]);
  }
  // A deliberate County Focus difference: with County Focus "Combined" and premises in one direction only, CVI's premises
  // builder fails (its map shows none; its Map Data says there is no data); the page draws that direction's premises.
  const a1 = view === 'focus' && f.direction === 'combined' && pv.agg.length > 0 && rec.approved.rows > 0
    && rec.approved.summary_table_csv === null;
  if (a1) {
    tally('County Focus one-direction Combined scenarios');
    check(new Set(pv.agg.map(p => p.direction)).size === 1, name + ': one-direction Combined only with premises in one direction');
    sameRows = false;
  }
  const opts = { view, measure: 'animals', compare: 'previous', years: f.years.map(String), quarters: f.quarters };
  const input = { rows: pv.rows, premises: pv.agg };

  // Without premises coordinates (the Partner and Public tiers) County Focus's top premises chart is grayed with that
  // reason, and its other charts are drawn from the rows as usual.
  if (view === 'focus' && pv.missing.length) {
    const charts = C.chartsFor('focus', Object.assign({}, input, { missingCoordinates: pv.missing }), opts, false);
    const plain = C.chartsFor('focus', input, opts, false);
    const tp = charts.find(c => c.id === 'top_premises');
    check(tp.empty === 'Needs premises coordinates (' + pv.missing.join(', ') + ')', name + ': top premises grayed with the missing coordinates', tp.empty);
    check(JSON.stringify(charts.filter(c => c.id !== 'top_premises')) === JSON.stringify(plain.filter(c => c.id !== 'top_premises')),
      name + ': the other County Focus charts drawn as usual without premises coordinates');
    tally('County Focus scenarios without premises coordinates');
  }

  // Drawer charts against CVI's (the same rows only). The totals across directions (species, corridors) against
  // CVI's drawer, on the merged rows; the charts by direction (top places, over time, emerging vs cooling) against
  // CVI's own chart functions on the rows the map draws (CVI's per-direction fix P1-12), which need only the drawn
  // rows to be the same, so the WA-to-WA merge scenarios are compared too.
  const BY_DIRECTION = ['top_places', 'over_time', 'emerging'];
  const drawnSame = pv.rows.length === cviRows && !a1;
  const shown = C.CHARTS[view];
  for (const id of ['species', 'top_places', 'over_time', 'corridors', 'emerging']) {
    if (!shown.includes(id)) continue;   // County Focus shows top premises in place of top counties (by design)
    const byDirection = BY_DIRECTION.includes(id);
    if (!(byDirection ? drawnSame : sameRows)) continue;
    compareDrawer(id, C.build(id, input, opts), byDirection ? rec.drawer_drawn[id] : rec.drawer[id], name + ' ' + id);
    tally(byDirection ? 'drawer charts by direction (rows as drawn)' : 'drawer charts across directions (merged rows)');
    // Where the merge drops rows, CVI's drawer today differs: count those scenarios, to show the fix is exercised.
    if (byDirection && JSON.stringify(rec.drawer_drawn[id]) !== JSON.stringify(rec.drawer[id])) tally('P1-12 scenarios (CVI\'s merged chart differs)');
  }

  // Question 9 references: every measure, empty periods, the same quarter last year (by direction: the same drawn
  // rows; across directions: the same merged rows).
  for (const measure of Object.keys(rec.q9)) {
    const refs = rec.q9[measure];
    const o2 = Object.assign({}, opts, { measure });
    for (const id of ['species', 'top_places', 'corridors', 'over_time', 'emerging']) {
      if (!(BY_DIRECTION.includes(id) ? drawnSame : sameRows)) continue;
      compareReference(id, C.build(id, input, o2), refs[id], name + ' ' + id + ' ' + measure);
      tally('measure references');
    }
    if (drawnSame) {
      compareReference('emerging', C.build('emerging', input, Object.assign({}, o2, { compare: 'last_year' })),
        refs.emerging_last_year, name + ' emerging last year ' + measure);
      tally('measure references');
    }
  }

  // The page's files and previews: CVI's own writer and Stats text given the rows the map draws.
  const ap = rec.approved;
  if (!ap.filtered_rows_csv) {
    check(pv.rows.length === 0, name + ': no rows on the map, as CVI', pv.rows.length);
  } else {
    if (sameRows) {
      const page = E.filteredRowsCsv(loaded, pv.rows, types);
      check(page.text === ap.filtered_rows_csv, name + ': filtered_rows.csv byte for byte', firstDifference(page.text, ap.filtered_rows_csv));
      tally('filtered_rows.csv');
      const stats = E.statsLines(view, f, pv.rows, pv.agg, new Date());
      check(JSON.stringify(maskGenerated(cviStatsForm(stats))) === JSON.stringify(maskGenerated(list(ap.stats))), name + ': Stats text (the page\'s additions taken out)', firstDifference(maskGenerated(cviStatsForm(stats)).join('\n'), maskGenerated(list(ap.stats)).join('\n')));
      tally('Stats texts');
      compareHeatmaps(view, input, opts, ap, name);
    }
    if (!a1) {   // in that case CVI writes no summary table; the page's premises rows are checked by the S5 suites
      const table = E.summaryTableCsv(view, pv.agg, f.combine);
      check(table === ap.summary_table_csv, name + ': summary_table.csv byte for byte', firstDifference(table || '', ap.summary_table_csv || ''));
      tally('summary_table.csv');
    }
    if (view === 'focus' && ap.top_premises) comparePremises(input, opts, ap.top_premises, name);
  }

  // CVI's export as it is today: where exporting the drawn rows changes nothing, its files equal the page's.
  const ex = rec.export;
  const q3Free = (view === 'wa' && !f.rawSpecies.length) || (view === 'focus' && !f.rawSpecies.length)
    || (view === 'flow' && !f.speciesSub.length && f.direction !== 'combined');
  if (ex.folder && ap.filtered_rows_csv && q3Free) {
    check(ex.filtered_rows_csv === ap.filtered_rows_csv, name + ': without refine or Flow Combined, filtered_rows.csv equals CVI\'s export');
    if (view !== 'flow') check(ex.summary_table_csv === ap.summary_table_csv, name + ': summary_table.csv equals CVI\'s export');
    tally('CVI exports unchanged by exporting the drawn rows');
  }
  compareExport(loaded, view, f, rec, pv, name, sameRows);
  if (!a1) comparePreviews(view, f, rec, pv, name, sameRows);
}

function firstDifference(a, b) {
  if (a === b) return undefined;
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  return { at: i, page: a.slice(Math.max(0, i - 60), i + 80), cvi: b.slice(Math.max(0, i - 60), i + 80) };
}

// The heatmaps against CVI's export heatmaps (the page's rows), for each measure.
function compareHeatmaps(view, input, opts, ap, name) {
  for (const measure of Object.keys(ap.heatmaps)) {
    const ref = ap.heatmaps[measure];
    const o2 = Object.assign({}, opts, { measure });
    const parts = view === 'focus' ? ['species'] : ['species', 'places'];
    for (const part of parts) {
      const r = ref[part];
      if (ref.periods < 2) continue;
      if (!r) continue;
      const page = C.build(part === 'species' ? 'species_heatmap' : 'place_heatmap', input, o2);
      check(JSON.stringify(page.rows) === JSON.stringify(list(r.order)), name + ' ' + part + ' heatmap ' + measure + ': rows', { page: page.rows, ref: r.order });
      const p = page.cells.map(c => c.column + '|' + c.row + '|' + c.value).sort();
      const q = r.cells.map(c => c.period + '|' + c.key + '|' + c.value).sort();
      check(JSON.stringify(p) === JSON.stringify(q), name + ' ' + part + ' heatmap ' + measure + ': cells', { p, q });
      tally('heatmaps');
    }
  }
}

// Top premises against the reference's list from CVI's premises.
function comparePremises(input, opts, ref, name) {
  for (const measure of Object.keys(ref)) {
    const page = C.build('top_premises', input, Object.assign({}, opts, { measure }));
    for (const dir of ['Inbound', 'Outbound']) {
      const r = rowsOf({ rows: ref[measure][dir] });
      const panel = (page.panels || []).find(p => p.series === dir);
      const bars = panel ? panel.bars : [];
      check(JSON.stringify(bars.map(b => b.label)) === JSON.stringify(r.map(x => x.label)) && sameNumbers(bars.map(b => b.value), r.map(x => x.value)),
        name + ' top premises ' + measure + ' ' + dir, { page: bars.map(b => b.label + ' ' + b.value), ref: r });
    }
    tally('top premises');
  }
}

// CVI's folder name from the page's: above 3 County Focus counties the page's area part is "<n>Counties" (by design),
// where CVI lists every county (its counties in pick order, letters and digits only).
function cviFocusName(pageName, f, label) {
  if (!f.counties || f.counties.length <= 3 || (label || '').trim()) return pageName;
  const listed = f.counties.map(c => c.replace(/[^A-Za-z0-9]/g, '')).join('-');
  return pageName.replace('_CountyFocus_' + f.counties.length + 'Counties_', '_CountyFocus_' + listed + '_');
}

// The export: the page's notes, folder name, parameters and file list against CVI's export.
function compareExport(loaded, view, f, rec, pv, name, sameRows) {
  const ex = rec.export;
  const notes = ex.notes.map(n => n.text);
  if (!ex.folder && notes[0] === 'Could not create export folder — check folder permissions.') {
    // CVI's County Focus export names every picked county in the folder name; with many counties the name passes the
    // 255-byte limit for a file name and CVI's export fails. The page names them "<n>Counties" above 3, so its
    // name stays short.
    const label = rec.inputs.export_label || '';
    const pageName = E.folderName(view, f, loaded.speciesChoices, label, new Date());
    const cviName = cviFocusName(pageName, f, label);
    check(view === 'focus' && Buffer.byteLength(cviName) > 255, name + ': CVI fails only on a folder name over 255 bytes', cviName.length);
    check(Buffer.byteLength(pageName) <= 255 && pageName.indexOf('_' + f.counties.length + 'Counties_') > 0,
      name + ': the page\'s folder name says "<n>Counties" and stays short', pageName);
    tally('CVI export failures on a long folder name');
    return;
  }
  if (!ex.folder) {
    // CVI's coordinates message names steps of its own R pipeline; the page writes plain words instead (deliberate
    // difference), so the reference is CVI's words and the page's message is checked beside it.
    const coordinates = view === 'focus' && f.counties.length && pv.missing.length;
    const expected = view === 'focus' && !f.counties.length ? E.MESSAGES.focusCountyExport
      : coordinates ? cviCoordinatesMessage(pv.missing) : E.MESSAGES.noRowsExport;
    check(notes.length === 1 && notes[0] === expected, name + ': export message', notes);
    if (coordinates) {
      check(E.focusCoordinatesMessage(pv.missing) === 'County Focus export needs premises coordinates (' +
        pv.missing.join(', ') + '), which this master file does not have. Ask for a CVI master table that includes ' +
        'them, then load it again.', name + ': the page\'s coordinates message in plain words');
    }
    return;
  }
  const date = ex.folder.slice(0, 10);
  const now = new Date(date + 'T12:00:00');
  const label = rec.inputs.export_label || '';
  const folder = E.folderName(view, f, loaded.speciesChoices, label, now);
  check(cviFocusName(folder, f, label) === ex.folder, name + ': folder name', [folder, ex.folder]);
  if (view === 'focus' && f.counties.length > 3 && !label.trim()) tally('folder names with "<n>Counties" as the area');
  const params = E.exportParams(view, f, { label, formats: ['csv', 'summary_csv', 'charts'], layersOn: [] }, now);
  check(maskTime(params) === maskTime(ex.export_params_json), name + ': export_params.json byte for byte (time masked)', firstDifference(maskTime(params), maskTime(ex.export_params_json)));
  check(/"exported_at": "\d{4}-\d\d-\d\d \d\d:\d\d:\d\d"/.test(params), name + ': export time as CVI writes it');
  check(notes.length === 1 && notes[0] === 'Exported to data/map_exports/' + ex.folder, name + ': CVI\'s notification read');
  // CVI's result lists the files it wrote; the page lists its files the same way (its charts are the page's chart set).
  const csvRows = E.filteredRowsCsv(loaded, pv.rows).rows;
  const z = E.zipEntries(ex.folder, { filteredRows: { text: '', rows: csvRows }, summaryTable: pv.agg.length ? 'x' : null,
    charts: [], params: '{}' });
  const cviLines = list(ex.result).slice(1).filter(l => !l.startsWith('charts/'));
  const refineOrCombined = (f.rawSpecies && f.rawSpecies.length) || (f.speciesSub && f.speciesSub.length) || f.direction === 'combined';
  if (!refineOrCombined && sameRows) check(JSON.stringify(z.written) === JSON.stringify(cviLines), name + ': files listed as CVI lists them', { page: z.written, cvi: cviLines });
  check(z.entries.every(e => e.name.startsWith(ex.folder + '/')), name + ': ZIP entries inside the export folder');
  // The heatmaps are exported exactly when CVI's export writes its heatmaps.
  const charts = C.chartsFor(view, { rows: pv.rows, premises: pv.agg }, { measure: 'animals', compare: 'previous',
    years: f.years.map(String), quarters: f.quarters }, true);
  const cviFiles = list(ex.files);
  if (!refineOrCombined) {
    check(charts.some(c => c.id === 'species_heatmap') === cviFiles.includes('charts/temporal_heatmap.png'), name + ': species heatmap exported when CVI exports it');
    check(charts.some(c => c.id === 'place_heatmap') === cviFiles.includes('charts/entity_heatmap.png'), name + ': place heatmap exported when CVI exports it');
  }
  check(charts.every(c => !c.empty), name + ': no gray-message chart in the export');
  // CVI's export PNGs: 8 inches (or more with many periods) at 150 dpi, so 1,200 pixels or wider (the device drops
  // a fraction of a pixel: 11.4 inches are 1,709 pixels).
  (ex.charts || []).forEach(c => check(c.png && c.png.width >= 1200 && Math.abs(c.png.width - c.width_in * c.dpi) <= 1
    && Math.abs(c.png.height - c.height_in * c.dpi) <= 1, name + ': CVI chart ' + c.file + ' size', [c.png, c.width_in, c.height_in]));
}

function comparePreviews(view, f, rec, pv, name, sameRows) {
  const pr = rec.previews;
  const focusNone = view === 'focus' && !f.counties.length;
  const tNotes = pr.preview_table.notes.map(n => n.text);
  if (focusNone) {
    for (const b of ['preview_table', 'preview_stats', 'preview_charts']) {
      check(pr[b].notes.length === 1 && pr[b].notes[0].text === E.MESSAGES.focusCountyPreview, name + ' ' + b + ': message');
    }
    return;
  }
  if (!pr.preview_table.modal) {
    check(!pv.agg.length && tNotes[0] === E.MESSAGES.noDataTable, name + ': Map Data message', tNotes);
  } else {
    const t = pr.preview_table.table;
    const page = E.mapDataPreview(view, pv.agg, f.combine);
    check(JSON.stringify(page.columns) === JSON.stringify(list(t.columns)), name + ': Map Data columns', [page.columns, t.columns]);
    const cviRows = t.rows;
    check(JSON.stringify(page.rows) === JSON.stringify(cviRows), name + ': Map Data rows and rounding', firstDifference(JSON.stringify(page.rows), JSON.stringify(cviRows)));
    check(page.title === pr.preview_table.modal.title && page.footer === pr.preview_table.modal.footer, name + ': Map Data title and footer', [page.title, pr.preview_table.modal.title]);
    tally('Map Data previews');
  }
  if (!pr.preview_stats.modal) {
    check(pr.preview_stats.notes[0].text === E.MESSAGES.noRowsStats, name + ': Stats message');
    check(pr.preview_charts.notes[0].text === E.MESSAGES.noRowsCharts, name + ': Charts message');
  } else {
    const page = E.statsPreview(view, f, pv.rows, pv.agg, new Date());
    check(page.title === pr.preview_stats.modal.title && page.footer === pr.preview_stats.modal.footer, name + ': Stats title and footer');
    const refineOrCombined = (f.rawSpecies && f.rawSpecies.length) || (f.speciesSub && f.speciesSub.length) || f.direction === 'combined';
    if (!refineOrCombined && sameRows) {
      check(maskGenerated(cviStatsForm(page.text.split('\n'))).join('\n') === maskGenerated(pr.preview_stats.modal.pre.split('\n')).join('\n'), name + ': Stats text equals CVI\'s dialog without refine or Flow Combined (the page\'s additions taken out)');
    }
    check(pr.preview_charts.modal.footer === E.MESSAGES.chartsFooter && /^Charts preview \(\d\)$/.test(pr.preview_charts.modal.title), name + ': Charts dialog footer and title form');
    check(E.chartsPreviewTitle(4) === 'Charts preview (4)', name + ': Charts dialog title');
  }
}

// ── Formats ────────────────────────────────────────────────────────────────────────────────────────────────────
function runFormats() {
  const fm = JSON.parse(fs.readFileSync(path.join(ORACLE, 'oracle_s7_formats.json'), 'utf8'));
  const bad = [];
  fm.fwrite.inputs.forEach((s, i) => { const got = E.fwriteNumber(Number(s)); if (got !== fm.fwrite.outputs[i]) bad.push([s, got, fm.fwrite.outputs[i]]); });
  check(bad.length === 0, 'fwrite numbers: ' + fm.fwrite.inputs.length + ' values as data.table writes them', bad.slice(0, 10));
  fm.comma.forEach(c => check(JSON.stringify(C.commaLabels(list(c.input))) === JSON.stringify(list(c.output)), 'scales::comma ' + JSON.stringify(c.input), [C.commaLabels(list(c.input)), c.output]));
  fm.short.forEach(c => check(JSON.stringify(C.shortLabels(list(c.input))) === JSON.stringify(list(c.output)), 'short labels ' + JSON.stringify(c.input), [C.shortLabels(list(c.input)), c.output]));
  // format(x, big.mark = ","): one value as the Stats text formats it (exports.js fmt), several together as R pads them.
  let formatted = 0;
  fm.format_big_mark.forEach(c => {
    const xs = list(c.input);
    const got = xs.length === 1 ? [E.fmt(xs[0])] : W.scaling.formatR(xs);
    const ok = JSON.stringify(got) === JSON.stringify(list(c.output));
    if (ok) formatted++;
    else check(false, 'format(big.mark) ' + JSON.stringify(c.input), [got, c.output]);
  });
  check(formatted === fm.format_big_mark.length, 'format(big.mark): ' + formatted + ' of ' + fm.format_big_mark.length + ' as R');
  // round(x, 3) as R rounds (Preview Map Data).
  if (fm.round3) {
    const wrong = [];
    fm.round3.inputs.forEach((s, i) => { const got = E.round3(Number(s)); if (got !== Number(fm.round3.outputs[i])) wrong.push([s, got, fm.round3.outputs[i]]); });
    check(wrong.length === 0, 'round(x, 3): ' + fm.round3.inputs.length + ' values as R rounds them', wrong.slice(0, 8));
  }
  fm.json.forEach((c, i) => {
    const got = E.jsonObject(jsonInput(c.input));
    check(got === c.output, 'jsonlite pretty JSON case ' + (i + 1), firstDifference(got, c.output));
  });
  // Text fields as fwrite quotes them (from a probe in R: quotes only with a comma, quote or line break).
  check(E.csvText('a b') === 'a b' && E.csvText(' lead') === ' lead' && E.csvText('') === '""' && E.csvText(null) === ''
    && E.csvText('q"t') === '"q""t"' && E.csvText('nl\nx') === '"nl\nx"' && E.csvText('semi;c') === 'semi;c' && E.csvText('comma,c') === '"comma,c"',
  'text fields quoted as fwrite quotes them');
}
// The reference's JSON inputs as the page's values: R's NULL arrives as null (written {}), a single value unboxed.
function jsonInput(o) {
  const out = {};
  Object.keys(o).forEach(k => { out[k] = o[k]; });
  return out;
}

// ── Pure rules on hand cases ───────────────────────────────────────────────────────────────────────────────────
function runHandCases() {
  // Measures: titles and availability.
  const noCvi = { header: ['Species.Group'] };
  check(!C.measureAvailable(noCvi, 'cvis').ok && C.measureAvailable(noCvi, 'cvis').reason === W.summary.NO_CVI_REASON, 'Unique CVIs not offered without a CVI column, with the reason');
  check(C.measureAvailable(noCvi, 'records').ok && C.measureAvailable(noCvi, 'animals').ok, 'animals and records always offered');
  const row = (o) => Object.assign({ 'Species.Group': 'Cattle', 'Reporting.Year': 2025, 'Reporting.Quarter': 'Q3', Movement: 'Inbound',
    'Total.Animals': 10, 'Origin.State': 'OR', 'Dest.State': 'WA', 'Origin.County': 'N/A', 'Dest.County': 'King', CVI: 'A' }, o);
  const rows = [row({}), row({ 'Total.Animals': 5, CVI: 'A' }), row({ 'Dest.County': 'Yakima', CVI: 'B' })];
  // The corridor chart under National Flow, where CVI draws it (since MC the WA State one reads "within Washington").
  const titles = m => ['species', 'top_places', 'over_time', 'corridors'].map(id => C.build(id, { rows },
    { view: id === 'corridors' ? 'flow' : 'wa', measure: m, years: ['2025'], quarters: ['Q3'] }).title);
  check(JSON.stringify(titles('animals')) === JSON.stringify(['Animals by species group', 'Top counties by animal volume', 'Animal volume over time', 'Top movement corridors']), 'titles for animals are CVI\'s');
  check(JSON.stringify(titles('records')) === JSON.stringify(['CVI records by species group', 'Top counties by CVI records', 'CVI records over time', 'Top movement corridors by CVI records']), 'titles for CVI records');
  check(JSON.stringify(titles('cvis')) === JSON.stringify(['Unique CVIs by species group', 'Top counties by unique CVIs', 'Unique CVIs over time', 'Top movement corridors by unique CVIs']), 'titles for unique CVIs');
  const sp = m => C.build('species', { rows }, { view: 'wa', measure: m }).bars[0].value;
  check(sp('animals') === 25 && sp('records') === 3 && sp('cvis') === 2, 'the three measures on three rows (25 animals, 3 records, 2 unique CVIs)');
  // Hover text: exact values with the measure's word.
  const tp = C.build('top_places', { rows }, { view: 'wa', measure: 'animals' });
  check(tp.groups[0].bars[0].hover === 'King — Inbound: 15 animals', 'hover text with the exact value', tp.groups[0].bars[0].hover);
  check(C.build('species', { rows: [row({ 'Total.Animals': 1 })] }, { view: 'wa', measure: 'records' }).bars[0].hover === 'Cattle: 1 CVI record', 'hover text in the singular');
  check(C.exact(1234567.5) === '1,234,567.5' && C.exact(0.1 + 0.2) === '0.3', 'exact numbers without floating-point noise');
  // Clickable bars only on the WA State map (click-to-spotlight).
  check(tp.clickable === true && C.build('top_places', { rows }, { view: 'flow' }).clickable === false, 'top places clickable on WA State only');
  // Same quarter last year: not selected, selected without rows, selected with rows.
  const ly = (years, extra) => C.build('emerging', { rows: rows.concat(extra || []) }, { view: 'wa', compare: 'last_year', years, quarters: ['Q3'] });
  check(ly(['2025']).empty === 'Same quarter last year (2024 Q3) is not in the selected years', 'last year not selected: the chart says so');
  const e1 = ly(['2024', '2025']);
  check(e1.empty === null && e1.subtitle === 'Change in animals: 2024 Q3  \u2192  2025 Q3' && e1.bars[0].label === 'King' && e1.bars[0].value === 15,
    'last year selected without rows: every place rises by its whole total', e1);
  const e2 = ly(['2024', '2025'], [row({ 'Reporting.Year': 2024, 'Total.Animals': 40 })]);
  check(e2.bars.map(b => b.label + ' ' + b.value).join(',') === 'Yakima 10,King -25', 'last year with rows: changes, largest rise first', e2.bars);
  // Empty periods only between the first and last period with data, only the selected quarters.
  const ot = C.build('over_time', { rows: [row({ 'Reporting.Year': 2024, 'Reporting.Quarter': 'Q1' }), row({ 'Reporting.Year': 2025, 'Reporting.Quarter': 'Q1' })] },
    { view: 'wa', years: ['2023', '2024', '2025', '2026'], quarters: ['Q1', 'Q3'] });
  check(JSON.stringify(ot.periods) === JSON.stringify(['2024 Q1', '2024 Q3', '2025 Q1']) && ot.series[0].values.join(',') === '10,0,10',
    'empty periods: selected quarters between the first and last with data, at zero', ot.periods);
  // Species colors: CVI's species colors, gray for a group no palette names.
  check(C.speciesColor('Cattle') === '#4E79A7' && C.speciesColor('Camelids') === '#999999' && C.speciesColor('constructor') === '#999999', 'species colors and gray for others');
  // File names.
  const names = ['species', 'top_places', 'over_time', 'corridors', 'emerging', 'top_premises', 'species_heatmap', 'place_heatmap'];
  check(JSON.stringify(names.map(n => C.fileName(n, 'wa'))) === JSON.stringify(['species_breakdown.png', 'top_counties.png', 'volume_over_time.png',
    'corridors.png', 'emerging_cooling.png', 'top_premises.png', 'temporal_heatmap.png', 'entity_heatmap.png']) && C.fileName('top_places', 'flow') === 'top_states.png', 'export file names');
  // The charts each view shows.
  check(JSON.stringify(C.CHARTS) === JSON.stringify({ wa: ['species', 'top_places', 'over_time', 'emerging'],
    flow: ['species', 'top_places', 'over_time', 'corridors'], focus: ['species', 'top_premises', 'corridors', 'emerging'] }), 'four charts per view');
  // Export result and history.
  const r = E.exportResult('x.zip', ['a.csv'], []);
  check(r.ok && r.lines[0] === 'Exported x.zip: handed to your browser to save, usually your Downloads folder.' && r.lines[1] === 'a.csv', 'export result names the file and where it went');
  const r2 = E.exportResult('x.zip', ['a.csv'], ['charts: failed']);
  check(!r2.ok && JSON.stringify(r2.lines) === JSON.stringify(['Partial export: x.zip', 'Written: a.csv', 'Errors: charts: failed']), 'partial export as CVI words it');
  let h = [];
  for (let i = 1; i <= 7; i++) h = E.addToHistory(h, 'e' + i + '.zip', new Date(2026, 9, 11, 9, i));
  check(h.length === 5 && h[0].name === 'e7.zip' && h[4].name === 'e3.zip', 'Exports this session: the last five, newest first');
  // County Focus: overlays as written when layers are on.
  const fp = E.exportParams('focus', { species: ['Cattle'], years: [2025], quarters: ['Q3'], counties: ['King'], direction: 'combined' },
    { label: '', formats: ['csv'], layersOn: ['markets'] }, new Date(2026, 9, 11, 9, 5, 7));
  check(fp.indexOf('"overlays_active": "markets"') > 0 && fp.indexOf('"exported_at": "2026-10-11 09:05:07"') > 0, 'one facility layer on: written as a plain value; local time');
  // R's round(x, 3) results, from R 4.4.3.
  check(E.round3(46.9645) === 46.964 && E.round3(46.9835) === 46.984 && E.round3(47.7495) === 47.749
    && E.round3(-121.8125) === -121.812 && E.round3(0.0625) === 0.062, 'round(x, 3) on values R checked');
  check(E.fmt(1600228.5) === '1,600,228' && E.fmt(100000) === '1e+05' && E.fmt(14.5) === '14.5', 'format(x, big.mark) on values R checked');
  // County Focus folder names: up to 3 counties listed as CVI's; above 3 "<n>Counties" in the area part too.
  const focusF = counties => ({ species: ['Cattle'], years: [2025], quarters: ['Q3'], counties, direction: 'combined' });
  const day = new Date(2026, 9, 11, 9, 5, 7);
  check(E.folderName('focus', focusF(['Yakima', 'King', 'Grays Harbor']), ['Cattle', 'Swine'], '', day)
    === '2026-10-11_CountyFocus_Yakima-King-GraysHarbor_Cattle_InboundOutbound_GraysHarborKingYakima',
  'County Focus folder name with 3 counties lists them', E.folderName('focus', focusF(['Yakima', 'King', 'Grays Harbor']), ['Cattle', 'Swine'], '', day));
  check(E.folderName('focus', focusF(['Yakima', 'King', 'Grays Harbor', 'Adams']), ['Cattle', 'Swine'], '', day)
    === '2026-10-11_CountyFocus_4Counties_Cattle_InboundOutbound_4Counties',
  'County Focus folder name with 4 counties says "4Counties"', E.folderName('focus', focusF(['Yakima', 'King', 'Grays Harbor', 'Adams']), ['Cattle', 'Swine'], '', day));
  check(E.folderName('wa', { species: ['Cattle'], years: [2025], quarters: ['Q3'], direction: ['Inbound'] }, ['Cattle'], '', day)
    === '2026-10-11_WAState_AllSpecies_Inbound', 'WA State folder name unchanged');
  check(E.focusCoordinatesMessage(['Origin.Lat', 'Origin.Long']) === 'County Focus export needs premises coordinates (Origin.Lat, Origin.Long), which this master file does not have. Ask for a CVI master table that includes them, then load it again.', 'County Focus coordinates message');
  runAuditCases(row);
}

// ── The per-direction charts reconciled by hand (CVI's P1-12 and P1-13) ─────────────────────────────────────────
// The charts by direction count the rows as the map draws them (a WA-to-WA movement as Outbound at its origin and
// Inbound at its destination); the totals across directions count each movement once. Every expected number below
// was worked out by hand from the rows listed, not by the page's code.
function runReconciliation() {
  const SRC = W.master.SOURCE_ROW;
  const wa = { view: 'wa', measure: 'animals', compare: 'previous' };
  const barsOf = chart => chart.groups.map(g => [g.label, g.total].concat(g.bars.map(b => b.series + ' ' + b.value)));
  const linesOf = chart => chart.series.map(s => [s.name].concat(s.values));
  const speciesOf = chart => chart.bars.map(b => [b.label, b.value]);

  // 1. Five movements, worked out by hand. The loader's two copies of a WA-to-WA movement share a source row.
  let n = 0;
  const movement = (o, d, animals, quarter, both) => {
    const r = { 'Species.Group': 'Cattle', 'Reporting.Year': 2025, 'Reporting.Quarter': quarter, 'Total.Animals': animals,
      'Origin.State': o === 'ID' ? 'ID' : 'WA', 'Dest.State': d === 'OR' ? 'OR' : 'WA',
      'Origin.County': o === 'ID' ? 'N/A' : o, 'Dest.County': d === 'OR' ? 'N/A' : d };
    const id = n++;
    const copies = both ? ['Inbound', 'Outbound'] : [o === 'ID' ? 'Inbound' : 'Outbound'];
    return copies.map(mv => Object.defineProperty(Object.assign({ Movement: mv }, r), SRC, { value: id }));
  };
  const rows = [].concat(
    movement('Yakima', 'King', 100, 'Q1', true),   // Q1: King Inbound 100, Yakima Outbound 100
    movement('King', 'King', 20, 'Q1', true),      // Q1: King Inbound 20 and Outbound 20 (within one county)
    movement('King', 'OR', 30, 'Q1', false),       // Q1: King Outbound 30
    movement('ID', 'Yakima', 40, 'Q2', false),     // Q2: Yakima Inbound 40
    movement('Yakima', 'Benton', 10, 'Q2', true)); // Q2: Benton Inbound 10, Yakima Outbound 10
  // Top counties: King 120 in + 50 out = 170; Yakima 40 in + 110 out = 150; Benton 10 in.
  const tp = C.build('top_places', { rows }, wa);
  check(JSON.stringify(barsOf(tp)) === JSON.stringify([['King', 170, 'Inbound 120', 'Outbound 50'],
    ['Yakima', 150, 'Inbound 40', 'Outbound 110'], ['Benton', 10, 'Inbound 10']]),
  'P1-12 by hand: top counties count each copy at its own end', barsOf(tp));
  // Over time: Q1 Inbound 100 + 20 = 120, Outbound 100 + 20 + 30 = 150; Q2 Inbound 40 + 10 = 50, Outbound 10.
  const ot = C.build('over_time', { rows }, Object.assign({}, wa, { years: ['2025'], quarters: ['Q1', 'Q2'] }));
  check(JSON.stringify(linesOf(ot)) === JSON.stringify([['Inbound', 120, 50], ['Outbound', 150, 10]]),
    'P1-12 by hand: one line per direction, both copies counted', linesOf(ot));
  // Emerging vs cooling, Q1 to Q2 per county: King 170 to 0, -170; Yakima 100 (out) to 40 + 10 = 50, -50; Benton 0
  // to 10, +10; listed from the largest rise to the largest fall.
  const em = C.build('emerging', { rows }, wa);
  check(JSON.stringify(em.bars.map(b => [b.label, b.value])) === JSON.stringify([['Benton', 10], ['Yakima', -50], ['King', -170]]),
    'P1-12 by hand: emerging vs cooling per county, each copy at its own end', em.bars.map(b => [b.label, b.value]));
  // Across directions each movement once: 100 + 20 + 30 + 40 + 10 = 200 cattle.
  check(JSON.stringify(speciesOf(C.build('species', { rows }, wa))) === JSON.stringify([['Cattle', 200]]),
    'P1-12 by hand: the species total counts each movement once');
  // Corridors once each: Yakima → King 100, King → Non-WA 30, King → King 20, Yakima → Benton 10, Non-WA → Yakima 40.
  const cor = C.build('corridors', { rows }, Object.assign({}, wa, { view: 'focus' }));
  check(cor.bars.reduce((t, b) => t + b.value, 0) === 200 && cor.bars.length === 5,
    'P1-12 by hand: the corridors count each movement once', speciesOf(cor));

  // 2. One period of the S7 fixture, 2025 Q3, from the file through the loader, against sums worked out by hand from
  //    its rows (Import: Inbound at the destination; Export: Outbound at the origin; Intrastate: both):
  //    Import OR → Yakima 330, ID → King 25, CA → Spokane (no count, 0); Export King → CA 18, Pierce → OR 4;
  //    Intrastate King → Pierce 52, Yakima → Yakima 900.
  const file = path.join(ROOT, 'local-test-artifacts', 's7', 'fixtures', 'cvi_master_s7.csv');
  const loaded = W.master.load(fs.readFileSync(file, 'utf8'));
  const q3 = loaded.rows.filter(r => Number(r['Reporting.Year']) === 2025 && r['Reporting.Quarter'] === 'Q3');
  // Inbound: 330 + 25 + 0 + 52 + 900 = 1,307; Outbound: 18 + 4 + 52 + 900 = 974 (CVI's merged chart: 22).
  const ot3 = C.build('over_time', { rows: q3 }, Object.assign({}, wa, { years: ['2025'], quarters: ['Q3'] }));
  check(JSON.stringify(linesOf(ot3)) === JSON.stringify([['Inbound', 1307], ['Outbound', 974]]),
    'P1-13 by hand: 2025 Q3 of the S7 fixture, animals per direction', linesOf(ot3));
  // Counties: Yakima 1,230 in + 900 out = 2,130; King 25 in + 70 out = 95; Pierce 52 in + 4 out = 56; Spokane 0 in.
  const tp3 = C.build('top_places', { rows: q3 }, wa);
  // (The loader reads "Yakima County" as "Yakima", as CVI's.)
  check(JSON.stringify(barsOf(tp3)) === JSON.stringify([['Yakima', 2130, 'Inbound 1230', 'Outbound 900'],
    ['King', 95, 'Inbound 25', 'Outbound 70'], ['Pierce', 56, 'Inbound 52', 'Outbound 4'],
    ['Spokane', 0, 'Inbound 0']]), 'P1-13 by hand: 2025 Q3 of the S7 fixture, counties per direction', barsOf(tp3));
  // Species, each movement once: Poultry 900 + 0, Cattle 330 + 18 + 52 = 400, Swine 25, Camelids 4 (1,329 in all).
  const sp3 = speciesOf(C.build('species', { rows: q3 }, wa));
  check(JSON.stringify(sp3) === JSON.stringify([['Poultry', 900], ['Cattle', 400], ['Swine', 25], ['Camelids', 4]]),
    'P1-13 by hand: 2025 Q3 of the S7 fixture, species once per movement', sp3);
  tally('hand reconciliations');
}

// ── Edge cases: special characters, PNG density, ZIP dates, search, column names ─────────────────────────────────
function runAuditCases(row) {
  const S = W.chartsvg;
  // Text from the file with HTML and XML special characters is written as text, in the page's charts (hover
  // text and labels) and in an export picture's caption.
  const odd = 'A<b>&"\'B';
  const rows = [row({ 'Species.Group': odd, 'Dest.County': 'C<img src=x>&D' })];
  const forms = [C.build('species', { rows }, { view: 'wa' }), C.build('top_places', { rows }, { view: 'wa' })];
  const spotChoices = () => null;
  forms.forEach(c => {
    const page = S.svg(c, { width: 600, interactive: true, spotlight: [], spotChoices, measure: 'animals', idPrefix: 't' });
    const exp = S.svg(c, { width: 1200, dpi: 150, caption: 'WA State | ' + odd, footer: 'x', interactive: false });
    [page, exp].forEach((m, i) => {
      check(!/<b>|<img/.test(m) && /&lt;(b|img src=x)&gt;&amp;/.test(m), c.id + (i ? ' export' : ' page') + ': file text with special characters escaped');
    });
  });
  check(S.svg(forms[0], { width: 600, interactive: true, spotlight: [], spotChoices, measure: 'animals', idPrefix: 't' })
    .indexOf('A&lt;b&gt;&amp;&quot;&#39;B') > 0, 'species group with special characters written as its text');
  // Control characters from the file are left out of the markup (XML forbids them).
  const ctrl = C.build('top_places', { rows: [row({ 'Dest.County': 'King\u0001\u001F' })] }, { view: 'wa' });
  const ctrlSvg = S.svg(ctrl, { width: 1200, dpi: 150, caption: 'c\u0002', footer: 'x', interactive: false });
  check(!/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(ctrlSvg) && ctrlSvg.indexOf('King') > 0, 'control characters removed from the SVG');
  // A PNG gets a pHYs chunk of 150 dpi (5,905 pixels per meter, CVI's value) right after IHDR, with a CRC
  // worked out here by Node's own zlib.
  const chunk = (type, data) => {
    const t = Buffer.from(type, 'latin1'), len = Buffer.alloc(4), crc = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    crc.writeUInt32BE(zlib.crc32(Buffer.concat([t, data])));
    return Buffer.concat([len, t, data, crc]);
  };
  const ihdr = Buffer.from([0, 0, 0, 2, 0, 0, 0, 1, 8, 2, 0, 0, 0]);
  const sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  const before = Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', Buffer.from([1, 2, 3])), chunk('IEND', Buffer.alloc(0))]);
  const after = Buffer.from(S.pngWithDpi(new Uint8Array(before), 150, sandbox.window.WSDA.zip.crc32));
  const phys = Buffer.alloc(9);
  phys.writeUInt32BE(5905, 0);
  phys.writeUInt32BE(5905, 4);
  phys[8] = 1;
  const want = Buffer.concat([before.subarray(0, 33), chunk('pHYs', phys), before.subarray(33)]);
  check(after.equals(want), 'PNG: pHYs 150 dpi right after IHDR, the rest unchanged', after.subarray(33, 54).toString('hex'));
  // Without a date, the ZIP writer stamps every entry 2026-09-15 12:00:00 (MS-DOS time 0x6000, date 0x5D2F),
  // in the local and the central headers.
  const z = Buffer.from(sandbox.window.WSDA.sample.zip([{ name: 'a/', dir: true }, { name: 'a/b.txt', data: 'x' }]));
  const stamps = [];
  for (let i = 0; i + 4 <= z.length; i++) {
    const sigAt = z.readUInt32LE(i);
    if (sigAt === 0x04034b50) stamps.push([z.readUInt16LE(i + 10), z.readUInt16LE(i + 12)]);
    if (sigAt === 0x02014b50) stamps.push([z.readUInt16LE(i + 12), z.readUInt16LE(i + 14)]);
  }
  check(stamps.length === 4 && stamps.every(([t, d]) => t === 0x6000 && d === 0x5D2F), 'ZIP default date 2026-09-15 12:00 in every header', stamps);
  // The Map Data search and filters match word by word, as DT's smart search.
  const P = W.previews;
  const t = [['King', 'Inbound', 5], ['King', 'Outbound', 3], ['Yakima', 'Inbound', 25]];
  const hits = (search, filters) => P.filterRows(t, search, filters).map(r => r[0] + ' ' + r[1]).join(', ');
  check(hits('king inbound') === 'King Inbound', 'search: every word, each anywhere in the row', hits('king inbound'));
  check(hits('  INB  ') === 'King Inbound, Yakima Inbound', 'search: one word, any case, spaces ignored');
  check(hits('"king inbound"') === '', 'search: a quoted phrase is one word (cells are apart)', hits('"king inbound"'));
  check(hits('', ['', 'bound in', '']) === 'King Inbound, Yakima Inbound', 'column filter: every word in that cell');
  check(hits('', ['', '', '25']) === 'Yakima Inbound', 'column filter on a number: its text');
  // A column named "__proto__" is left out; the rows and filtered_rows.csv stay whole.
  const protoHead = W.master.REQUIRED.concat(['__proto__', 'Note']);
  const protoRow = v => ['Cattle', '2025', 'Q1', 'Inbound', '5', 'OR', 'WA', 'Lane', '44', '-123', 'King', '47.5',
    '-122', v, 'n'].join(',');
  const protoLoaded = W.master.load(protoHead.join(',') + '\n' + protoRow('') + '\n' + protoRow('x') + '\n');
  let protoCsv = null, protoError = null;
  try { protoCsv = E.filteredRowsCsv(protoLoaded, protoLoaded.rows).text; } catch (e) { protoError = e.message; }
  check(protoLoaded.ok && protoLoaded.header.indexOf('__proto__') < 0 &&
    protoLoaded.rows.every(r => Object.getPrototypeOf(r) !== null && !Object.prototype.hasOwnProperty.call(r, '__proto__') &&
      r.Note === 'n') &&
    protoCsv && protoCsv.split('\n')[0] === W.master.REQUIRED.concat(['Note']).join(',') && protoCsv.split('\n').length === 4,
    'a column named __proto__ is left out; filtered_rows.csv is written whole', protoError || protoCsv);
}

// ── Run ────────────────────────────────────────────────────────────────────────────────────────────────────────
// Optional arguments name fixtures to check alone (for example: s7 tier_full).
const only = process.argv.slice(2);
const oracleFiles = (fs.existsSync(ORACLE) ? fs.readdirSync(ORACLE) : [])
  .filter(f => /^oracle_s7_.+\.json$/.test(f) && f !== 'oracle_s7_formats.json')
  .filter(f => !only.length || only.includes(f.replace(/^oracle_s7_|\.json$/g, '')))
  .sort();
if (!oracleFiles.length) {
  console.error('No S7 reference found. Run: Rscript tests/oracle/s7_charts_oracle.R');
  process.exit(2);
}
// Each part under a guard: an error thrown inside one (a broken chart can make a later step read something that is
// not there) is one failed check, and the suite still reaches its summary.
const guarded = (name, fn) => {
  try { fn(); } catch (e) { check(false, name + ' stopped: ' + String(e && e.stack || e).split('\n').slice(0, 2).join(' ')); }
};
for (const f of oracleFiles) guarded('fixture ' + f, () => runFixture(f));
guarded('formats', runFormats);
guarded('hand cases', runHandCases);
guarded('reconciliation', runReconciliation);

console.log('S7 unit: fixtures ' + oracleFiles.map(f => f.replace(/^oracle_s7_|\.json$/g, '')).join(', '));
console.log('S7 unit: ' + Object.entries(counts).map(([k, v]) => v + ' ' + k).join(', '));
failures.slice(0, 40).forEach(x => console.log('FAIL ' + x));
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
