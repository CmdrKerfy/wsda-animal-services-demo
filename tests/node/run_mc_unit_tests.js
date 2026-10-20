#!/usr/bin/env node
'use strict';
// MC unit tests: the within-state movement rules (site/cvi/app/movement.js) against the R reference
// tests/oracle/mc_oracle.R (local-test-artifacts/mc/oracle_mc_<fixture>.json), on synthetic data.
//
// For every fixture and scenario of the reference (the page's loader reads the same file as CVI's loader there):
//   - the page's counting rules, against the reference's R aggregation written from the same rules: rows counted,
//     rows left out and why, each county's point, the county pairs (also by species group), the movement lines (top
//     pairs, widths) and rings (within one county), the county grid, the county numbers, and the pairs touching a
//     spotlight;
//   - CVI's former line map (build_intrastate_line_data(), run unchanged in the reference): the page's pairs from
//     the rows that map uses (one copy of each Intrastate row and the rows coded Import, two different counties)
//     equal CVI's totals, apart from pairs with a blank or "N/A" county, which the page leaves out (by design);
//     where CVI's pairs are not split by changed county points, the page's width rule gives CVI's widths, and the
//     page's species colors are CVI's line colors.
// Then a few hand cases: the sentence under the view and the county test.
//
// Also chart cross-filtering (site/cvi/app/crossfilter.js), against part 2 of
// the reference (local-test-artifacts/mc/oracle_mc_cf_<fixture>.json), for every fixture, Map View and scenario:
//   - each chart the page shows that is a CVI drawer chart, with the scenario's chart filters, against CVI's own
//     chart: a species or period filter equals that sidebar pick through CVI's module; a place, pair or premises
//     filter equals CVI's chart on the rows R filtered itself; the chart a filter comes from keeps all its bars.
//     Animals and CVI records. Where the page's rows and CVI's differ already without chart filters (the County Focus
//     WA guard and the page's merge rule for repeated rows), the scenario's charts are counted and left out;
//   - the map's rows: species and period filter them as the sidebar pick does (CVI's row count, and the page's own
//     sidebar pick);
//   - sums: after a click on a bar or point, the other charts' rows add up to its value (animals and CVI records),
//     and so do their bars where every row is drawn;
// and on hand cases: what each mark stands for, toggling, combining, chips and messages, dropping a filter when
// the sidebar changes, Browse and Compare, highlights, the movement view's rule.
//
// Usage (repository root): node tests/node/run_f1_unit_tests.js (writes the tiers),
// node tests/synthetic/make_cvi_s7_fixtures.js (the S7 fixture), Rscript tests/oracle/mc_oracle.R,
// then node tests/node/run_mc_unit_tests.js [fixture ...]   (Node >= 22, no packages)

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');
const APP = path.join(ROOT, 'site', 'cvi', 'app');
const ORACLE = path.join(ROOT, 'local-test-artifacts', 'mc');
const TIERS = path.join(ROOT, 'local-test-artifacts', 'f1', 'tiers');
const S7_FIXTURE = path.join(ROOT, 'local-test-artifacts', 's7', 'fixtures', 'cvi_master_s7.csv');

const FIXTURES = {
  movement: path.join(ROOT, 'tests', 'synthetic', 'cvi_master_movement.csv'),
  s2: path.join(ROOT, 'tests', 'synthetic', 'cvi_master_s2.csv'),
  s4: path.join(ROOT, 'tests', 'synthetic', 'cvi_master_s4.csv'),
  tier_full: path.join(TIERS, 'full', 'CVI_Consolidated_Master.csv'),
  tier_partner: path.join(TIERS, 'partner', 'partner_county_totals.csv'),
  tier_public: path.join(TIERS, 'public', 'CVI_Consolidated_Master.csv')
};

const sandbox = { window: {}, console };
vm.createContext(sandbox);
const APP_FILES = ['csv.js', 'master.js', 'scaling.js', 'palettes.js', 'aggregate.js', 'summary.js', 'flow.js',
  'focus.js', 'charts.js', 'movement.js', 'crossfilter.js', 'exports.js'];
for (const f of APP_FILES) {
  vm.runInContext(fs.readFileSync(path.join(APP, f), 'utf8'), sandbox, { filename: f });
}
vm.runInContext(fs.readFileSync(path.join(ROOT, 'site', 'geo', 'state-centers.js'), 'utf8'), sandbox);
const W = sandbox.window.CVIWA;
const M = W.movement;
const C = W.charts;
const CF = W.crossfilter;

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
const near = (a, b) => typeof a === 'number' && typeof b === 'number'
  && Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b));
const list = x => (x === null || x === undefined ? [] : Array.isArray(x) ? x : [x]);
// An R data frame with no rows is written as [] (and an empty named list as []).
const table = x => (Array.isArray(x) ? x : []);

// Compares two lists of objects field by field, in order; numbers within 1e-9.
function sameRows(got, want, fields) {
  if (got.length !== want.length) return { length: [got.length, want.length] };
  for (let i = 0; i < want.length; i++) {
    for (const f of fields) {
      const g = got[i][f];
      const w = want[i][f];
      const ok = typeof w === 'number' ? near(g, w) : g === w;
      if (!ok) return { row: i, field: f, got: g, want: w };
    }
  }
  return null;
}
function compareRows(name, got, want, fields) {
  const diff = sameRows(got, want, fields);
  check(diff === null, name, diff);
}

const cmpC = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const byPairKey = (a, b) => cmpC(a.origin, b.origin) || cmpC(a.dest, b.dest) || cmpC(a.species || '', b.species || '');

// ── One scenario ───────────────────────────────────────────────────────────────────────────────────────────────
function runScenario(fixture, loaded, sc) {
  const name = fixture + ' ' + sc.name;
  const filters = {
    species: list(sc.filters.species),
    years: list(sc.filters.years).map(Number),
    quarters: list(sc.filters.quarters),
    rawSpecies: list(sc.filters.rawSpecies)
  };
  const opts = { scaling: sc.scaling, nBins: sc.nBins, cap: sc.cap };
  const r = M.rows(loaded, filters);

  check(r.counted.length === sc.records, name + ': rows counted', [r.counted.length, sc.records]);
  check(r.leftOut.noCounty === sc.leftOut.noCounty && r.leftOut.noPoint === sc.leftOut.noPoint,
    name + ': rows left out (no county, no county point)', [r.leftOut, sc.leftOut]);
  tally('scenarios');

  const pts = M.points(r.counted);
  const wantPts = Array.isArray(sc.points) ? {} : sc.points;
  check(JSON.stringify(Object.keys(pts)) === JSON.stringify(Object.keys(wantPts)), name + ': counties with a point',
    [Object.keys(pts), Object.keys(wantPts)]);
  check(Object.keys(wantPts).every(c => pts[c] && pts[c].lat === wantPts[c].lat && pts[c].lon === wantPts[c].lon),
    name + ': each county\'s point');

  const pairs = M.pairs(r.counted);
  compareRows(name + ': pairs (order, animals, records, unique CVIs)', pairs, table(sc.pairs),
    ['origin', 'dest', 'animals', 'records', 'cvis']);
  compareRows(name + ': pairs by species group', M.pairs(r.counted, { bySpecies: true }),
    table(sc.pairsBySpecies), ['origin', 'dest', 'species', 'animals', 'records']);
  tally('pairs');

  compareRows(name + ': movement lines (top ' + sc.cap + ', widths)', M.lines(pairs, opts), table(sc.lines),
    ['origin', 'dest', 'animals', 'records', 'width_px']);
  compareRows(name + ': movement rings (within one county)', M.rings(pairs, opts), table(sc.rings),
    ['county', 'animals', 'records', 'radius_px']);
  compareRows(name + ': county numbers', M.countyTotals(pairs), table(sc.counties),
    ['county', 'within', 'sent', 'received', 'withinRecords', 'sentRecords', 'receivedRecords']);
  const g = M.grid(pairs);
  check(JSON.stringify(g.counties) === JSON.stringify(list(sc.grid.counties)), name + ': county grid counties',
    [g.counties, sc.grid.counties]);
  compareRows(name + ': county grid cells', g.cells.slice().sort(byPairKey),
    table(sc.grid.cells).slice().sort(byPairKey), ['origin', 'dest', 'animals', 'records']);
  sc.touching.forEach(t => {
    compareRows(name + ': pairs touching ' + list(t.counties).join(' and '), M.touching(pairs, list(t.counties)),
      table(t.pairs), ['origin', 'dest', 'animals', 'records']);
  });
  tally('options');

  // The summary the page will use gives the same as the parts.
  const s = M.summary(loaded, filters, opts);
  check(s.records === r.counted.length && s.pairs.length === pairs.length && s.lines.length === table(sc.lines).length
    && s.rings.length === table(sc.rings).length, name + ': summary() agrees with its parts');

  if (sc.cvi) compareWithCvi(name, r.counted, sc);
  checkRanks(name, r.counted, sc);
  checkMapView(name, r.counted, sc, opts);
  if (sc.name === 'default' || sc.name === 'one_group') checkChartRanking(name, loaded, r.counted);
}

// ── The movement view ─────────────────────────────────────────────────────────────────────────────────────────────
// Against the reference's ranking by animals (its first cap pairs between counties), pairs touching each spotlight
// and county numbers: the lines drawn, which are in full color, the badges, the hover numbers and the drawing order.
const refKey = k => k.replace('\r', '\u0000');   // the reference's "origin\rdest"
function checkMapView(name, counted, sc, opts) {
  const pairList = M.pairs(counted);
  const pts = M.points(counted);
  const key = p => p.origin + '\u0000' + p.dest;
  const ranking = list(sc.ranks.animals).map(refKey);
  const top = ranking.slice(0, sc.cap);
  const plain = M.mapView(pairList, pts, { cap: sc.cap, scaling: sc.scaling, nBins: sc.nBins });
  check(JSON.stringify(plain.lines.map(l => l.key).sort()) === JSON.stringify(top.slice().sort()) && plain.lines.every(l => l.on),
    name + ': movement view draws the busiest pairs, all in full color', [plain.lines.length, top.length]);
  // Rank groups: a line's rank is its place in the reference's ranking; ranks
  // 1-5, 6-10, 11-25 and 26 on get 7, 5, 3 and 2 px and these colors (26 on: the cap_50 scenario and spotlight
  // pairs beyond the cap).
  const refRank = l => ranking.indexOf(l.key) + 1;
  const wantStyle = rank => (rank <= 5 ? [7, '#245566'] : rank <= 10 ? [5, '#0094aa'] : rank <= 25 ? [3, '#4fb0bf']
    : [2, '#8cc5cf']);
  check(plain.lines.every(l => l.rank === refRank(l)), name + ': each line\'s rank as the reference\'s order',
    plain.lines.slice(0, 3).map(l => [l.key, l.rank, refRank(l)]));
  check(plain.lines.every(l => l.width_px === wantStyle(refRank(l))[0] && l.color === wantStyle(refRank(l))[1]),
    name + ': line widths and colors by rank group', plain.lines.slice(0, 3).map(l => [l.rank, l.width_px, l.color]));
  check(plain.lines.every(l => near(l.arrow_px, 10 + 1.6 * l.width_px)), name + ': arrowheads sized with the line');
  check(plain.lines.every((l, i) => i === 0 || plain.lines[i - 1].rank > l.rank), name + ': the top ranks drawn last');
  const wantCounties = table(sc.counties);
  check(plain.counties.length === wantCounties.length && plain.counties.every((c, i) => c.county === wantCounties[i].county
    && c.tip[1] === 'Moved within the county: ' + C.exact(wantCounties[i].within) + (wantCounties[i].within === 1 ? ' animal' : ' animals')
    && c.tip[2].indexOf(C.exact(wantCounties[i].sent) + ' ') > 0 && c.tip[3].indexOf(C.exact(wantCounties[i].received) + ' ') > 0),
  name + ': county hover numbers as the reference\'s');
  const wantRings = table(sc.rings);
  check(plain.rings.length === wantRings.length && plain.rings.every((r, i) => r.county === wantRings[i].county
    && near(r.radius_px, wantRings[i].radius_px) && r.on), name + ': rings as the reference\'s');
  sc.touching.forEach(t => {
    const spot = list(t.counties);
    const touching = table(t.pairs).filter(p => p.origin !== p.dest).map(key);
    const v = M.mapView(M.pairs(counted), pts, { cap: sc.cap, scaling: sc.scaling, nBins: sc.nBins, spotlight: spot });
    // A true spotlight (by design): only the pairs touching it, every one in full color.
    const want = touching.slice().sort();
    check(JSON.stringify(v.lines.map(l => l.key).sort()) === JSON.stringify(want),
      name + ': with ' + spot.join(' and ') + ' spotlighted, only the pairs touching them', [v.lines.length, want.length]);
    check(v.lines.every(l => l.on) && v.shown === touching.length,
      name + ': every pair touching the spotlight in full color');
    check(v.lines.every(l => l.rank === refRank(l) && l.width_px === wantStyle(refRank(l))[0]
      && l.color === wantStyle(refRank(l))[1]), name + ': with a spotlight, every line styled by its rank group',
    v.lines.filter(l => l.rank > sc.cap).slice(0, 3).map(l => [l.key, l.rank, l.width_px, l.color]));
    check(v.rings.every(r => r.on && spot.indexOf(r.county) >= 0)
      && v.rings.length === plain.rings.filter(r => spot.indexOf(r.county) >= 0).length,
    name + ': only the spotlit counties\' rings');
  });
  tally('movement views');
}

// ── The ranking by "Show charts by:" against the reference ────────────────────────────────────────────────────────
// The reference ranks the pairs between counties by animals, CVI records and unique CVIs itself, ties in R's sort
// order of the corridor chart's label (not only against the page's charts.js).
function checkRanks(name, counted, sc) {
  ['animals', 'records', 'cvis'].forEach(measure => {
    const got = M.ranked(M.pairs(counted), measure).map(p => p.origin + '\u0000' + p.dest);
    const want = list(sc.ranks[measure]).map(refKey);
    check(JSON.stringify(got) === JSON.stringify(want), name + ': pairs ranked by ' + measure + ' as the reference\'s',
      [got.slice(0, 3), want.slice(0, 3)]);
  });
  tally('rankings against the reference');
}

// ── CVI's former line map ──────────────────────────────────────────────────────────────────────────────────────
function compareWithCvi(name, counted, sc) {
  const cvi = sc.cvi;
  // The rows CVI's line map uses: the first loader copy of an Intrastate row is its Inbound copy, so the page's
  // counted Inbound rows are the Intrastate rows and the rows coded Import; CVI leaves out one-county movement.
  const cviRows = counted.filter(r => r.Movement === 'Inbound' && r['Origin.County'] !== r['Dest.County']);
  const page = M.pairs(cviRows, { bySpecies: true }).sort(byPairKey);
  const placeholder = table(cvi.placeholderPairs);
  const isPlaceholder = p => placeholder.some(q => q.origin === p.origin && q.dest === p.dest && q.species === p.species);
  const want = table(cvi.pairs).filter(p => !isPlaceholder(p));
  compareRows(name + ': CVI\'s line map totals (pairs between counties, by species group)', page, want,
    ['origin', 'dest', 'species', 'animals']);
  check(placeholder.every(p => M.countyOf(p.origin) === null || M.countyOf(p.dest) === null),
    name + ': pairs only CVI shows have a blank or "N/A" county', placeholder);
  if (placeholder.length) tally('CVI pairs with a placeholder county (deliberate difference)');
  tally('CVI comparisons');

  const rows = table(cvi.rows);
  if (!cvi.split && rows.length) {
    const widths = W.scaling.computeRadius(rows.map(x => x.total_animals), sc.scaling, M.LINE_WIDTH[0],
      M.LINE_WIDTH[1], sc.nBins);
    check(rows.every((x, i) => near(widths[i], x.line_width_px)), name + ': the width rule gives CVI\'s widths',
      rows.map((x, i) => [x.line_width_px, widths[i]]).slice(0, 5));
    tally('CVI width comparisons');
  }
  const palette = W.palettes.SPECIES_PALETTES['WSDA Default'];
  const color = group => (Object.prototype.hasOwnProperty.call(palette, group) ? palette[group] : '#999999');
  check(rows.every(x => color(x.species_group).toLowerCase() === String(x.color).toLowerCase()),
    name + ': species colors are CVI\'s line colors', rows.map(x => [x.species_group, x.color]).slice(0, 5));
}

// ── Hand cases ─────────────────────────────────────────────────────────────────────────────────────────────────
function handCases() {
  check(M.leftOutText({ noCounty: 0, noPoint: 0 }) === null, 'hand: nothing left out, no sentence');
  check(M.leftOutText({ noCounty: 1, noPoint: 0 }) === '1 within-state row is not shown: 1 has no county.',
    'hand: one row without a county', M.leftOutText({ noCounty: 1, noPoint: 0 }));
  check(M.leftOutText({ noCounty: 2, noPoint: 1 })
    === '3 within-state rows are not shown: 2 have no county, 1 has no county point.',
  'hand: rows without a county and without a point', M.leftOutText({ noCounty: 2, noPoint: 1 }));
  check(M.leftOutText({ noCounty: 0, noPoint: 4 }) === '4 within-state rows are not shown: 4 have no county point.',
    'hand: rows without a point', M.leftOutText({ noCounty: 0, noPoint: 4 }));
  const none = [null, undefined, '', '  ', 'N/A', 'n/a', 'NA', ' na '];
  check(none.every(v => M.countyOf(v) === null), 'hand: missing, blank and "N/A" are no county');
  check(M.countyOf('King') === 'King' && M.countyOf('Nash') === 'Nash' && M.countyOf('N/A County') === 'N/A County'
    && M.countyOf(' King ') === 'King', 'hand: county names kept as written, without surrounding spaces');
  // Rows that did not come from the loader (no file row number) are never merged.
  const row = (o, d) => ({ Movement: 'Inbound', 'Origin.State': 'WA', 'Dest.State': 'WA', 'Species.Group': 'Cattle',
    'Reporting.Year': 2025, 'Reporting.Quarter': 'Q1', 'Total.Animals': 5, 'Origin.County': o, 'Dest.County': d,
    'Origin.County.Lat': 47, 'Origin.County.Long': -120, 'Dest.County.Lat': 46, 'Dest.County.Long': -119 });
  const loaded = { rows: [row('A', 'B'), row('A', 'B'), Object.assign(row('A', 'B'), { 'Dest.State': 'wa' }),
    Object.assign(row('A', 'B'), { Movement: null }), Object.assign(row('A', 'B'), { 'Origin.County.Lat': Infinity })],
  hasSpecies: false };
  const r = M.rows(loaded, { species: ['Cattle'], years: [2025], quarters: ['Q1'], rawSpecies: ['x'] });
  check(r.counted.length === 2 && r.leftOut.noPoint === 1,
    'hand: two equal rows without file numbers both count; lowercase "wa" and no Movement do not; an infinite '
    + 'point is no point; Refine by species is ignored without a Species column', [r.counted.length, r.leftOut]);
  const p = M.pairs(r.counted);
  check(p.length === 1 && p[0].animals === 10 && p[0].records === 2, 'hand: one pair of two rows', p);

  // The curve: from A to B, cut back by the arrowhead's room, the arrowhead's base at its end pointing toward B, A to
  // B and B to A apart.
  const a = [-120.5, 46.6];
  const b = [-119.2, 46.2];
  const k = Math.cos(47 * Math.PI / 180);
  const dist = (x, y) => Math.hypot((x[0] - y[0]) * k, x[1] - y[1]);
  const ab = M.curve(a, b, 0.2);
  const ba = M.curve(b, a, 0.2);
  const whole = M.curve(a, b, 0);
  const close = (x, y) => Math.abs(x[0] - y[0]) < 1e-9 && Math.abs(x[1] - y[1]) < 1e-9;
  check(close(ab.line[0], a) && close(ab.line[ab.line.length - 1], ab.head.at), 'hand: a curve from A to the arrowhead\'s base');
  check(close(whole.line[whole.line.length - 1], b) && close(whole.head.at, b), 'hand: without room the curve reaches B');
  let along = 0;
  for (let i = 1; i < ab.line.length; i++) along += dist(ab.line[i], ab.line[i - 1]);
  let wholeLength = 0;
  for (let i = 1; i < whole.line.length; i++) wholeLength += dist(whole.line[i], whole.line[i - 1]);
  check(Math.abs(wholeLength - along - 0.2) < 1e-3, 'hand: the curve cut back by the room, measured along it',
    [wholeLength, along]);
  const short = M.curve(a, [-120.45, 46.58], 0.2);
  let shortAlong = 0;
  for (let i = 1; i < short.line.length; i++) shortAlong += dist(short.line[i], short.line[i - 1]);
  const shortWhole = dist(a, [-120.45, 46.58]);
  check(shortAlong > 0.55 * shortWhole, 'hand: a short line keeps at least 60% of its length', [shortAlong, shortWhole]);
  // The bearing points toward B: a step from the base along it comes closer to B.
  const rad = ab.head.bearing * Math.PI / 180;
  const stepped = [ab.head.at[0] + 0.05 * Math.sin(rad) / k, ab.head.at[1] + 0.05 * Math.cos(rad)];
  check(dist(stepped, b) < dist(ab.head.at, b) - 0.04, 'hand: the arrowhead points along the line toward B', ab.head);
  check(Math.hypot(ab.middle[0] - ba.middle[0], ab.middle[1] - ba.middle[1]) > 0.05, 'hand: A to B and B to A do not overlap');
  // Rank groups: ranks 1-5, 6-10, 11-25, then 26 and beyond.
  const groups = [1, 5, 6, 10, 11, 25, 26, 50, 73].map(M.tierOf);
  check(JSON.stringify(groups) === JSON.stringify([0, 0, 1, 1, 2, 2, 3, 3, 3]), 'hand: rank groups', groups);
  check(M.mapView(M.pairs([]), {}, {}).cap === 10, 'hand: Top 10 when nothing says otherwise');
  // Badges, a picked pair, the hover text.
  const rowsAB = [row('Yakima', 'Benton'), row('Yakima', 'Benton'), row('King', 'Pierce'),
    Object.assign(row('King', 'King'), { 'Total.Animals': 1 })];
  const list2 = M.pairs(rowsAB);
  const pts2 = M.points(rowsAB);
  const bySp = M.pairs(rowsAB, { bySpecies: true });
  const v = M.mapView(list2, pts2, { cap: 1, badges: ['King\u0000Pierce'], bySpecies: bySp });
  check(v.lines.length === 2 && v.lines.find(l => l.dest === 'Pierce').badge === 1 && v.lines.find(l => l.dest === 'Benton').badge === null,
    'hand: a badge\'s pair is drawn even outside the cap, with its number', v.lines.map(l => [l.key, l.badge]));
  check(JSON.stringify(v.lines.find(l => l.dest === 'Benton').tip) === JSON.stringify(['Yakima \u2192 Benton',
    '10 animals in 2 CVI records', 'Top species: Cattle']), 'hand: a line\'s hover text', v.lines.find(l => l.dest === 'Benton').tip);
  check(v.rings.length === 1 && v.rings[0].county === 'King' && JSON.stringify(v.counties.find(c => c.county === 'King').tip)
    === JSON.stringify(['King County', 'Moved within the county: 1 animal', 'Sent to other WA counties: 5 animals',
      'Received from other WA counties: 0 animals']), 'hand: a ring and a county\'s hover text', v.counties);
  const picked = M.mapView(list2, pts2, { cap: 5, picked: ['Yakima\u0000Benton'], spotlight: ['King'] });
  check(picked.lines.filter(l => l.on).map(l => l.key).join() === 'Yakima\u0000Benton' && picked.rings.every(r => !r.on),
    'hand: a picked corridor alone in full color, rings faded, whatever the spotlight');
  check(M.betweenRows(rowsAB).length === 3, 'hand: the corridor chart\'s rows leave out movement within a county');

  // Ranking by "Show charts by:". Yakima to Benton: 10 animals in 2 records, 1 unique CVI; King to
  // Pierce: 5 animals in 1 record; Adams to Asotin: 1 animal in 3 records with 3 unique CVIs (one blank, one with
  // spaces around it, counted once with its twin); Asotin to Adams: 1 record, as King to Pierce, its label first.
  const withCvi = (r, cvi) => Object.assign(r, { CVI: cvi });
  const rowsM = [withCvi(row('Yakima', 'Benton'), 'C1'), withCvi(row('Yakima', 'Benton'), 'C1'),
    withCvi(row('King', 'Pierce'), 'C2'),
    withCvi(Object.assign(row('Adams', 'Asotin'), { 'Total.Animals': 1 }), 'C3'),
    withCvi(Object.assign(row('Adams', 'Asotin'), { 'Total.Animals': 0 }), ' C4 '),
    withCvi(Object.assign(row('Adams', 'Asotin'), { 'Total.Animals': 0 }), 'C4'),
    withCvi(Object.assign(row('Asotin', 'Adams'), { 'Total.Animals': 0 }), '')];
  const listM = M.pairs(rowsM);
  const cvisOf = (o, d) => listM.find(p => p.origin === o && p.dest === d).cvis;
  check(cvisOf('Yakima', 'Benton') === 1 && cvisOf('Adams', 'Asotin') === 2 && cvisOf('Asotin', 'Adams') === 0,
    'hand: unique CVIs per pair (blank left out, spaces trimmed)', listM);
  const order = measure => M.ranked(listM, measure).map(p => p.origin + '-' + p.dest).join(' ');
  check(order('animals') === 'Yakima-Benton King-Pierce Adams-Asotin Asotin-Adams', 'hand: ranked by animals', order('animals'));
  check(order('records') === 'Adams-Asotin Yakima-Benton Asotin-Adams King-Pierce',
    'hand: ranked by CVI records, ties in label order', order('records'));
  check(order('cvis') === 'Adams-Asotin King-Pierce Yakima-Benton Asotin-Adams', 'hand: ranked by unique CVIs', order('cvis'));
  const ptsM = M.points(rowsM);
  const vM = M.mapView(listM, ptsM, { cap: 2, measure: 'records' });
  check(vM.lines.map(l => l.key).sort().join() === ['Adams\u0000Asotin', 'Yakima\u0000Benton'].join()
    && vM.lines.find(l => l.origin === 'Adams').rank === 1 && vM.lines.find(l => l.origin === 'Adams').value === 3
    && vM.measure === 'records', 'hand: Top 2 by CVI records', vM.lines.map(l => [l.key, l.rank, l.value]));
  const vC = M.mapView(listM, ptsM, { cap: 1, measure: 'cvis' });
  check(JSON.stringify(vC.lines[0].tip) === JSON.stringify(['Adams \u2192 Asotin', '1 animal in 3 CVI records',
    '2 unique CVIs']), 'hand: a line\'s hover names its unique CVIs when ranked by them', vC.lines[0].tip);

  // "King " (a quoted cell with a space) and "King" are one county: one pair, a ring for King to
  // King, the corridor chart's bar and a corridor click's rows the same 17 animals, the spotlight trimmed too.
  const rowsT = [Object.assign(row('King', 'Pierce'), { 'Total.Animals': 10 }),
    Object.assign(row('King ', 'Pierce'), { 'Total.Animals': 7 }), Object.assign(row('King', 'King '), { 'Total.Animals': 4 })];
  const listT = M.pairs(rowsT);
  check(listT.length === 2 && listT[0].origin === 'King' && listT[0].animals === 17 && listT[1].dest === 'King',
    'hand: county names with surrounding spaces are one county', listT);
  const vT = M.mapView(listT, M.points(rowsT), { spotlight: ['King '] });
  check(vT.lines.length === 1 && vT.lines[0].on && vT.rings.length === 1 && vT.rings[0].on && M.betweenRows(rowsT).length === 2,
    'hand: one line, a ring within King, the spotlight "King " is King', [vT.lines.length, vT.rings.length]);
  const barT = C.build('corridors', { rows: M.betweenRows(rowsT) }, { view: 'wa', measure: 'animals' });
  const keptT = rowsT.filter(CF.test('wa', 'pair', ['King\u0000Pierce']));
  check(barT.bars.length === 1 && barT.bars[0].value === 17 && keptT.reduce((n, r) => n + r['Total.Animals'], 0) === 17,
    'hand: a corridor click\'s rows add up to its bar', [barT.bars, keptT.length]);
  // Tied animals in the chart's label order, not C-locale order ("adams" after "Yakima" in C order).
  const rowsC = [row('King', 'Pierce'), row('Yakima', 'Benton'), row('adams', 'Asotin'),
    Object.assign(row('Lewis', 'Mason'), { 'Total.Animals': 1 })];
  const barC = C.build('corridors', { rows: M.betweenRows(rowsC) }, { view: 'wa', measure: 'animals' });
  const mapC = M.ranked(M.pairs(rowsC), 'animals').map(p => p.origin + '  \u2192  ' + p.dest);
  check(JSON.stringify(mapC) === JSON.stringify(barC.bars.map(b => b.label)) && mapC[0] === 'adams  \u2192  Asotin',
    'hand: ties in animals in the corridor chart\'s order', [mapC, barC.bars.map(b => b.label)]);
}

// ── The map's ranking and the corridor chart ─────────────────────────────────────────────────────────────────────
// For each measure, the movement view's first 12 pairs are the corridor chart's 12 bars (same pairs, same order,
// same values), the chart drawn by charts.js from the same rows.
function checkChartRanking(name, loaded, counted) {
  ['animals', 'records', 'cvis'].forEach(measure => {
    if (!C.measureAvailable(loaded, measure).ok) return;
    const chart = C.build('corridors', { rows: M.betweenRows(counted) }, { view: 'wa', measure });
    if (chart.empty) return;
    const v = M.mapView(M.pairs(counted), M.points(counted), { cap: 50, measure });
    const mapTop = v.lines.slice().sort((a, b) => a.rank - b.rank).slice(0, chart.bars.length)
      .map(l => l.origin + '  \u2192  ' + l.dest + ' ' + l.value);
    const chartTop = chart.bars.map(b => b.label + ' ' + b.value);
    check(JSON.stringify(mapTop) === JSON.stringify(chartTop), name + ': the map\'s top pairs by ' + measure
      + ' are the corridor chart\'s bars', [mapTop.slice(0, 4), chartTop.slice(0, 4)]);
    tally('chart rankings');
  });
}

// ── Chart cross-filtering ──────────────────────────────────────────────────────────────────────────────────────
const CF_FIXTURES = {
  movement: FIXTURES.movement,
  s4: FIXTURES.s4,
  s7: S7_FIXTURE,
  tier_full: FIXTURES.tier_full,
  tier_partner: FIXTURES.tier_partner
};

// The reference's sidebar (CVI's input names) in the page's terms (as the S7 suite reads them).
function pageFilters(view, inp) {
  if (view === 'wa') {
    return { species: list(inp.county_species), years: list(inp.county_year).map(Number),
      quarters: list(inp.county_quarter), direction: list(inp.county_direction),
      rawSpecies: list(inp.county_species_sub), mode: inp.county_mode };
  }
  if (view === 'flow') {
    return { species: list(inp.flow_species), years: list(inp.flow_year).map(Number), quarters: list(inp.flow_quarter),
      direction: inp.flow_direction, speciesSub: list(inp.flow_species_sub), combine: inp.flow_combine_species === true };
  }
  return { counties: list(inp.intra_counties), species: list(inp.intra_species), years: list(inp.intra_year).map(Number),
    quarters: list(inp.intra_quarter), direction: inp.intra_filter_dir, rawSpecies: list(inp.intra_species_sub),
    mode: inp.intra_mode };
}
// The rows of a view under the sidebar alone (both loader copies, as the map draws them).
function sidebarRows(loaded, view, f) {
  if (view === 'wa') return W.summary.mapRows(loaded, f) || [];
  if (view === 'flow') return W.flow.mapRows(loaded, f) || [];
  return W.focus.summaryRows(loaded, f) || [];
}
// The page's chart filters for a scenario of the reference, set by toggling each value in.
function stateOf(view, filters) {
  let st = CF.create();
  const add = (kind, values) => values.forEach(value => { st = CF.toggle(st, view, { kind, value }); });
  add('species', list(filters.species));
  if (filters.period) add('period', [filters.period.label]);
  add('place', list(filters.place));
  add('pair', list(filters.pair).map(p => CF.pairValue(...p.split('\r'))));
  add('premises', list(filters.premises));
  return st;
}
const chartOpts = (view, f, measure) => ({ view, measure, compare: 'previous', years: f.years.map(String),
  quarters: f.quarters });

// A page chart against CVI's chart record ({ empty } or { slots, rows, subtitle }) for one measure. CVI's records
// chart is its animals chart on rows whose animals are 1, so its title and subtitle still say animals.
function compareCviChart(id, page, cvi, measure, name) {
  if (cvi.empty !== undefined) {
    check(page.empty === cvi.empty, name + ': gray message as CVI', { page: page.empty, cvi: cvi.empty });
    return;
  }
  check(page.empty === null, name + ': drawn as CVI draws it', page.empty);
  if (page.empty !== null) return;
  const rows = table(cvi.rows);
  const slots = list(cvi.slots);
  if (id === 'species' || id === 'corridors') {
    const key = id === 'species' ? 'g' : 'pair';
    const top = slots.slice().reverse();
    check(JSON.stringify(page.bars.map(b => b.label)) === JSON.stringify(top), name + ': bars and order',
      { page: page.bars.map(b => b.label), cvi: top });
    const values = top.map(k => (rows.find(r => r[key] === k) || {}).a);
    check(page.bars.length === values.length && page.bars.every((b, i) => near(b.value, values[i])), name + ': values',
      { page: page.bars.map(b => b.value), cvi: values });
  } else if (id === 'top_places') {
    const top = slots.slice().reverse();
    check(JSON.stringify(page.groups.map(g => g.label)) === JSON.stringify(top), name + ': places and order',
      { page: page.groups.map(g => g.label), cvi: top });
    const p = [].concat(...page.groups.map(g => g.bars.map(b => g.label + '|' + b.series + '|' + b.value))).sort();
    const c = rows.map(r => r.geo + '|' + r.mv + '|' + r.a).sort();
    check(JSON.stringify(p) === JSON.stringify(c), name + ': bars per direction', { p, c });
  } else if (id === 'over_time') {
    check(slots.every(x => page.periods.includes(x)), name + ': CVI\'s periods on the axis',
      { page: page.periods, cvi: slots });
    const wrong = rows.filter(r => {
      const s = page.series.find(x => x.name === r.mv);
      return !s || !near(s.values[page.periods.indexOf(r.label)], r.a);
    });
    check(wrong.length === 0, name + ': values per period and direction', wrong.slice(0, 3));
    // Periods the page adds are empty ones, at zero.
    const added = page.periods.filter(x => !slots.includes(x));
    check(added.every(x => page.series.every(s => s.values[page.periods.indexOf(x)] === 0)),
      name + ': the periods only the page shows are at zero', added);
  } else if (id === 'emerging') {
    const top = slots.slice().reverse();
    check(JSON.stringify(page.bars.map(b => b.label)) === JSON.stringify(top), name + ': places and order',
      { page: page.bars.map(b => b.label), cvi: top });
    const values = top.map(k => (rows.find(r => r.geo === k) || {}).delta);
    check(page.bars.every((b, i) => near(b.value, values[i])), name + ': changes');
    if (measure === 'animals') check(page.subtitle === cvi.subtitle, name + ': periods compared', [page.subtitle, cvi.subtitle]);
  }
}

// Whether the page's merged chart rows differ from CVI's chart rows without any chart filter: the County Focus WA
// guard and the page's merge rule for repeated rows can make them differ (S7 suite).
// The charts by direction count both loader copies of a WA-to-WA movement; the others the merged rows (CVI's
// per-direction fix P1-12). The rows a chart counts, from the rows chartRows gives it.
const BY_DIRECTION = ['top_places', 'over_time', 'emerging'];
const countedRows = (chart, rows) => (BY_DIRECTION.includes(chart) ? rows : W.summary.dedupeVolume(rows));

function baseDiffers(loaded, view, base, chart) {
  const f = pageFilters(view, base.sidebar);
  const rows = countedRows(chart, sidebarRows(loaded, view, f));
  return rows.length !== base.charts[chart].rows;
}

function runCrossfilterScenario(fx, loaded, view, sc, base) {
  const name = fx + ' ' + view + ' ' + sc.name;
  const f = pageFilters(view, sc.sidebar);
  const rows = sidebarRows(loaded, view, f);
  const st = stateOf(view, sc.filters);
  tally('cross-filter scenarios');

  // The map, its value boxes and strip: species and period filter them exactly as the sidebar pick does (the page's
  // own builders given the pick), and the rows are as many as CVI's map draws for that pick.
  const mf = CF.mapFilters(view, f, st);
  const picked = Object.assign({}, f);
  if (list(sc.filters.species).length) picked.species = list(sc.filters.species);
  if (sc.filters.period && view !== 'focus') {
    picked.years = [Number(sc.filters.period.year)];
    picked.quarters = [sc.filters.period.quarter];
  }
  const mapped = sidebarRows(loaded, view, mf);
  const same = (a, b, what) => check(JSON.stringify(a) === JSON.stringify(b), name + ': ' + what + ' as the sidebar pick\'s');
  same(mapped.length, sidebarRows(loaded, view, picked).length, 'map rows');
  if (view === 'wa') {
    const opts = { direction: f.direction, mode: 'side_by_side', scaling: 'log', nBins: 5, hasSpecies: loaded.hasSpecies };
    const circles = W.aggregate.build(loaded.rows, Object.assign({}, opts, mf));
    same(circles, W.aggregate.build(loaded.rows, Object.assign({}, opts, picked)), 'circles and their hover text');
    same(W.summary.summary(loaded, mf), W.summary.summary(loaded, picked), 'value boxes');
    same(W.summary.strip(loaded, mf, circles), W.summary.strip(loaded, picked, circles), 'strip');
  } else if (view === 'flow') {
    const ctr = W.flow.centers(sandbox.window.WSDA_STATE_CENTERS);
    const opts = { scaling: 'log', nBins: 5 };
    same(W.flow.lines(loaded, Object.assign({}, opts, mf), ctr), W.flow.lines(loaded, Object.assign({}, opts, picked), ctr),
      'lines');
    same(W.flow.summary(loaded, mf, ctr), W.flow.summary(loaded, picked, ctr), 'value boxes');
  } else {
    const opts = { scaling: 'log', nBins: 5 };
    const built = W.focus.build(loaded, Object.assign({}, opts, mf));
    same(built.premises, W.focus.build(loaded, Object.assign({}, opts, picked)).premises, 'premises');
    same(W.focus.summary(loaded, mf, built), W.focus.summary(loaded, picked), 'value boxes');
  }
  tally('maps as the sidebar pick');
  if (!(view === 'focus' && baseDiffers(loaded, view, base, 'species'))) {
    check(mapped.length === sc.map_rows, name + ': map rows as CVI\'s map', [mapped.length, sc.map_rows]);
  }

  for (const id of Object.keys(sc.charts)) {
    const rec = sc.charts[id];
    const chartRows = CF.chartRows(view, rows, st, id);
    const counted = countedRows(id, chartRows).length;
    if (counted !== rec.rows) {
      // Allowed only where the rows already differ without chart filters (deliberate rules).
      check(baseDiffers(loaded, view, base, id), name + ' ' + id + ': rows differ from CVI\'s only by deliberate rules',
        [counted, rec.rows]);
      tally('charts left out (rows differ from CVI by deliberate rules)');
      continue;
    }
    for (const measure of ['animals', 'records']) {
      const page = C.build(id, { rows: chartRows }, chartOpts(view, f, measure));
      compareCviChart(id, page, rec[measure], measure, name + ' ' + id + ' ' + measure);
    }
    tally('charts against CVI');
  }
}

// Sums: a click on a bar or point, then the other charts' rows add up to the clicked mark's value, and so do their bars
// where every row is drawn. Every clickable mark of the base view, animals and CVI records. Since CVI's per-direction
// fix P1-12 a mark of a chart by direction counts both copies of a WA-to-WA movement and a mark of species or corridors
// counts it once, so the other charts' rows are added up the way the clicked chart counts them; each chart's bars add
// up to its own rows as it counts them.
function runSums(fx, loaded, view, base) {
  const f = pageFilters(view, base.sidebar);
  const rows = sidebarRows(loaded, view, f);
  const ctx = { periodMode: 'single' };
  const charts = view === 'focus' ? ['species', 'top_premises', 'corridors', 'emerging'] : C.CHARTS[view];
  const built = view === 'focus' ? W.focus.build(loaded, Object.assign({ scaling: 'log', nBins: 5 }, f)) : null;
  for (const measure of ['animals', 'records']) {
    const opts = chartOpts(view, f, measure);
    const input = { rows, premises: built ? built.premises : undefined };
    for (const id of charts) {
      const chart = C.build(id, input, opts);
      if (chart.empty) continue;
      const marks = [];
      if (id === 'species' || id === 'corridors') chart.bars.forEach(b => marks.push({ mark: b, value: b.value }));
      if (id === 'top_places') chart.groups.forEach(g => marks.push({ mark: g, value: g.total }));
      if (id === 'over_time') {
        chart.periods.forEach((p, i) => marks.push({ mark: p, value: chart.series.reduce((t, s) => t + s.values[i], 0) }));
      }
      if (id === 'top_premises') chart.panels.forEach(pn => pn.bars.forEach(b => marks.push({ mark: b, value: b.value })));
      for (const { mark, value } of marks) {
        const pick = CF.pickOf(view, chart, mark, ctx);
        // A corridor on Flow stands for its state (both directions), so its rows are not the bar's.
        if (!pick || (view === 'flow' && id === 'corridors')) continue;
        const st = CF.toggle(CF.create(), view, pick);
        const label = fx + ' ' + view + ' ' + id + ' ' + JSON.stringify(pick.value) + ' ' + measure;
        // The clicked chart keeps all its bars.
        check(JSON.stringify(C.build(id, { rows: CF.chartRows(view, rows, st, id), premises: input.premises }, opts))
          === JSON.stringify(chart), label + ': the clicked chart keeps all its bars');
        for (const other of charts.filter(x => x !== id && x !== 'top_premises')) {
          if (CF.ownKind(other, view) === pick.kind) {
            // A chart that sets the same kind (on WA State a county is picked from two charts) keeps its rows too.
            check(CF.chartRows(view, rows, st, other) === rows, label + ': ' + other + ' keeps all its rows (same kind)');
            continue;
          }
          const r = countedRows(id, CF.chartRows(view, rows, st, other));
          // "Top states" and the over-time chart draw a bar or point per direction, so a row without a Movement
          // value is in a state's or period's rows but not in its bar (on Flow, where the state does not depend
          // on the direction). The other charts then add up to the bar plus exactly those rows.
          const undrawn = id === 'top_places' || id === 'over_time' ? r.filter(x => !x.Movement) : [];
          const extra = C.total(undrawn, measure);
          check(near(C.total(r, measure), value + extra), label + ': ' + other + '\'s rows add up to the clicked value'
            + (extra ? ' and the rows without a direction' : ''), [C.total(r, measure), value, extra]);
          tally(extra ? 'sums with rows without a direction' : 'sums');
          const drawn = C.build(other, { rows: CF.chartRows(view, rows, st, other) }, opts);
          const own = countedRows(other, CF.chartRows(view, rows, st, other));
          const sum = barsSum(drawn, own, view);
          if (sum !== null) {
            check(near(sum, C.total(own, measure)), label + ': ' + other + '\'s bars add up to its rows', [sum, C.total(own, measure)]);
            tally('chart sums');
          }
        }
      }
    }
  }
}
// The sum of a chart's bars or points when they show every row (null when the chart cannot show them all: more
// than 12 bars, rows without the chart's key, or a change chart).
function barsSum(chart, rows, view) {
  if (chart.empty) return null;
  if (chart.id === 'species' && chart.bars.length < 12 && rows.every(r => (r['Species.Group'] || '').trim())) {
    return chart.bars.reduce((t, b) => t + b.value, 0);
  }
  if (chart.id === 'top_places' && chart.groups.length < 12
    && rows.every(r => C.placeOf(r, view) !== null && r.Movement)) {
    return chart.groups.reduce((t, g) => t + g.total, 0);
  }
  if (chart.id === 'over_time' && rows.every(r => C.periodOf(r).key !== null && r.Movement)) {
    return chart.series.reduce((t, s) => t + s.values.reduce((a, b) => a + b, 0), 0);
  }
  return null;
}

// Every premises' rows give its key (focus.js premisesKey), so a premises filter finds exactly its rows.
function runPremisesKeys(fx, loaded, view, base) {
  if (view !== 'focus') return;
  const f = pageFilters(view, base.sidebar);
  const built = W.focus.build(loaded, Object.assign({ scaling: 'log', nBins: 5 }, f));
  if (built.missingCoordinates.length) return;
  const bad = built.premises.filter(p => !p.row_indices.every(i => W.focus.premisesKey(loaded.rows[i])
    === p.direction + '\r' + p.group_key));
  check(built.premises.length > 0 && bad.length === 0, fx + ': each premises\' rows carry its key', bad.slice(0, 2));
  // The County Focus highlight: a picked pair lights the premises with a row in it; a county, its premises.
  const corr = C.build('corridors', { rows: sidebarRows(loaded, view, f) }, chartOpts(view, f, 'animals'));
  if (!corr.empty) {
    const pick = CF.pickOf('focus', corr, corr.bars[0], {});
    const st = CF.toggle(CF.create(), 'focus', pick);
    const lit = CF.focusHighlight(built.premises, loaded.rows, st);
    const [o, d] = corr.bars[0].label.split('  →  ');
    const want = built.premises.filter(p => p.row_indices.some(i => {
      const r = loaded.rows[i];
      return C.countyLabel(r['Origin.County']) === o && C.countyLabel(r['Dest.County']) === d;
    })).map(p => p.direction + '\r' + p.group_key).sort();
    check(JSON.stringify([...lit].sort()) === JSON.stringify(want) && want.length > 0,
      fx + ': a corridor click lights the premises with a row in it', [lit.size, want.length]);
    const county = f.counties[0];
    const lit2 = CF.focusHighlight(built.premises, loaded.rows, CF.toggle(CF.create(), 'focus', { kind: 'place', value: county }));
    const want2 = built.premises.filter(p => p.county === county).map(p => p.direction + '\r' + p.group_key).sort();
    check(JSON.stringify([...lit2].sort()) === JSON.stringify(want2), fx + ': a county click lights its premises');
    tally('highlight checks');
  }
}

// Several periods picked: the map takes their years and quarters and a further row rule (keep) for the exact pairs.
// Each builder given the rule must equal the same builder given only the rows that pass it.
function runKeep(fx, loaded, view, base) {
  const f = pageFilters(view, base.sidebar);
  const rows = sidebarRows(loaded, view, f);
  const labels = [...new Set(rows.map(r => C.periodOf(r)).filter(p => p.key !== null).map(p => p.label))].sort();
  if (labels.length < 3 || view === 'focus') return;
  let st = CF.create();
  [labels[0], labels[labels.length - 1]].forEach(value => { st = CF.toggle(st, view, { kind: 'period', value }); });
  const mf = CF.mapFilters(view, f, st);
  const name = fx + ' ' + view + ' two periods';
  check(typeof mf.keep === 'function', name + ': a row rule for the exact pairs');
  if (!mf.keep) return;
  const only = Object.assign({}, loaded, { rows: loaded.rows.filter(mf.keep) });
  const plain = Object.assign({}, mf, { keep: undefined });
  const same = (a, b, what) => check(JSON.stringify(a) === JSON.stringify(b), name + ': ' + what + ' with the rule as on its rows');
  if (view === 'wa') {
    const opts = { direction: f.direction, mode: 'side_by_side', scaling: 'log', nBins: 5, hasSpecies: loaded.hasSpecies };
    same(W.aggregate.build(loaded.rows, Object.assign({}, opts, mf)), W.aggregate.build(only.rows, Object.assign({}, opts, plain)),
      'circles');
    same(W.summary.summary(loaded, mf), W.summary.summary(only, plain), 'value boxes');
    const m = W.movement.summary(loaded, Object.assign({ rawSpecies: [] }, mf));
    same(m.pairs, W.movement.summary(only, Object.assign({ rawSpecies: [] }, plain)).pairs, 'movement pairs');
  } else {
    const ctr = W.flow.centers(sandbox.window.WSDA_STATE_CENTERS);
    same(W.flow.lines(loaded, Object.assign({ scaling: 'log', nBins: 5 }, mf), ctr),
      W.flow.lines(only, Object.assign({ scaling: 'log', nBins: 5 }, plain), ctr), 'lines');
    same(W.flow.summary(loaded, mf, ctr), W.flow.summary(only, plain, ctr), 'value boxes');
  }
  // County Focus has no period chart; its builders take the premises rule (crossfilter.premisesRule) the same way.
  tally('row rules in the builders');
}
function runFocusKeep(fx, loaded, base) {
  const f = pageFilters('focus', base.sidebar);
  const g = loaded.speciesChoices[0];
  const keep = CF.premisesRule(CF.toggle(CF.create(), 'focus', { kind: 'species', value: g }));
  check(typeof keep === 'function', fx + ' focus: a species filter gives the premises a row rule');
  if (typeof keep !== 'function') return;
  const only = Object.assign({}, loaded, { rows: loaded.rows.filter(keep) });
  const opts = Object.assign({ scaling: 'log', nBins: 5 }, f);
  const a = W.focus.build(loaded, Object.assign({ keep }, opts)).premises;
  const b = W.focus.build(only, opts).premises;
  const brief = list => list.map(p => [p.direction, p.group_key, p.total_animals, p.n_shipments, p.premises_id]);
  check(JSON.stringify(brief(a)) === JSON.stringify(brief(b)), fx + ' focus: premises with the rule as on its rows');
  const sa = W.focus.summary(loaded, Object.assign({ keep }, f));
  const sb = W.focus.summary(only, f);
  check(JSON.stringify(sa && [sa.total_animals, sa.n_cvis, sa.top_species]) === JSON.stringify(sb && [sb.total_animals, sb.n_cvis, sb.top_species]),
    fx + ' focus: value boxes with the rule as on its rows');
  tally('row rules in the builders');
}

function runCrossfilterFixture(fx) {
  const file = path.join(ORACLE, 'oracle_mc_cf_' + fx + '.json');
  if (!fs.existsSync(file)) {
    console.error('Missing ' + path.relative(ROOT, file) + ': run Rscript tests/oracle/mc_oracle.R first.');
    process.exit(2);
  }
  const oracle = JSON.parse(fs.readFileSync(file, 'utf8'));
  const loaded = W.master.load(fs.readFileSync(CF_FIXTURES[fx], 'utf8'));
  for (const view of ['wa', 'flow', 'focus']) {
    const scenarios = oracle.views[view];
    const base = scenarios.find(sc => sc.name === 'none');
    check(!!base && scenarios.length > 5, fx + ' ' + view + ': the reference has scenarios', scenarios.length);
    scenarios.forEach(sc => runCrossfilterScenario(fx, loaded, view, sc, base));
    runSums(fx, loaded, view, base);
    runPremisesKeys(fx, loaded, view, base);
    if (view === 'focus') runFocusKeep(fx, loaded, base);
    else runKeep(fx, loaded, view, base);
  }
  console.log('  ' + fx + ': cross-filter scenarios ' + ['wa', 'flow', 'focus'].map(v => oracle.views[v].length).join(' / '));
}

// ── Cross-filter hand cases ────────────────────────────────────────────────────────────────────────────────────
function crossfilterHandCases() {
  const row = o => Object.assign({ 'Species.Group': 'Cattle', 'Reporting.Year': 2025, 'Reporting.Quarter': 'Q2',
    Movement: 'Inbound', 'Total.Animals': 10, 'Origin.State': 'OR', 'Dest.State': 'WA', 'Origin.County': 'N/A',
    'Dest.County': 'King' }, o);
  // What a mark stands for.
  const bars = (id, labels) => ({ id, empty: null, bars: labels.map(label => ({ label, value: 1 })) });
  // value(): a pick's value, or null when there is none, so a wrong pick fails a check instead of stopping the suite.
  const value = p => (p ? p.value : null);
  check(value(CF.pickOf('wa', bars('species', ['Cattle']), { label: 'Cattle' })) === 'Cattle', 'pick: a species bar');
  check(CF.pickOf('wa', { id: 'top_places', empty: null }, { label: 'Non-WA' }) === null
    && CF.pickOf('wa', { id: 'emerging', empty: null }, { label: 'Non-WA' }) === null, 'pick: "Non-WA" cannot be clicked');
  check(CF.pickOf('wa', { id: 'top_places', empty: 'No geographic data' }, { label: 'King' }) === null,
    'pick: a grayed chart offers nothing');
  const ot = { id: 'over_time', empty: null };
  check(value(CF.pickOf('wa', ot, '2025 Q2', { periodMode: 'single' })) === '2025 Q2'
    && CF.pickOf('wa', ot, '2025 Q2', { periodMode: 'browse' }) === null
    && CF.pickOf('flow', ot, '2025 Q2', { periodMode: 'compare' }) === null,
  'pick: a period point only in Single period');
  const corr = { id: 'corridors', empty: null };
  check(value(CF.pickOf('flow', corr, { label: 'WA  →  OR' })) === 'OR'
    && value(CF.pickOf('flow', corr, { label: 'ID  →  WA' })) === 'ID'
    && CF.pickOf('flow', corr, { label: 'WA  →  WA' }) === null, 'pick: a Flow corridor picks its non-WA state');
  const fp = CF.pickOf('focus', corr, { label: 'Yakima  →  Non-WA' });
  check(!!fp && fp.kind === 'pair' && fp.value === 'Yakima\u0000Non-WA', 'pick: a County Focus corridor picks the pair', fp);
  const pp = CF.pickOf('focus', { id: 'top_premises', empty: null }, { label: 'Yakima #2', premises: 'Inbound\re:7' });
  check(!!pp && pp.kind === 'premises' && pp.value === 'Inbound\re:7' && pp.label === 'Yakima #2', 'pick: a premises bar');
  check(value(CF.pickOf('wa', bars('corridors', []), { label: 'Yakima  →  Benton' })) === 'Yakima\u0000Benton',
    'pick: the WA State movement corridor picks the pair');

  // Toggling, combining, views apart, chips.
  let st = CF.create();
  st = CF.toggle(st, 'wa', { kind: 'species', value: 'Cattle' });
  st = CF.toggle(st, 'wa', { kind: 'species', value: 'Swine' });
  st = CF.toggle(st, 'wa', { kind: 'period', value: '2025 Q2' });
  check(JSON.stringify(st.wa.species) === '["Cattle","Swine"]' && !CF.isActive(st, 'flow'),
    'toggle: values add up within a kind; other views keep their own');
  const st2 = CF.toggle(st, 'wa', { kind: 'species', value: 'Cattle' });
  check(JSON.stringify(st2.wa.species) === '["Swine"]' && JSON.stringify(st.wa.species) === '["Cattle","Swine"]',
    'toggle: a second click removes the value; the earlier state is unchanged');
  const rows = [row({}), row({ 'Species.Group': 'Swine' }), row({ 'Reporting.Quarter': 'Q3' }),
    row({ 'Species.Group': 'Equine' })];
  const sidebar = { species: ['Cattle', 'Equine', 'Swine'], years: [2024, 2025], quarters: ['Q1', 'Q2', 'Q3'] };
  const mf = CF.mapFilters('wa', sidebar, st);
  check(JSON.stringify([mf.species, mf.years, mf.quarters]) === '[["Cattle","Swine"],[2025],["Q2"]]' && !mf.keep,
    'combine: the map takes the groups both pick and the one period as that year and quarter', mf);
  const own = CF.mapFilters('wa', sidebar, st, { ownSpecies: true });
  check(own.species.length === 3 && JSON.stringify(own.quarters) === '["Q2"]',
    'Compare: a right map with its own species ignores the species filter, not the period');
  const two = CF.mapFilters('wa', sidebar, CF.toggle(st, 'wa', { kind: 'period', value: '2024 Q3' }));
  const kept = rows.concat([row({ 'Reporting.Year': 2024, 'Reporting.Quarter': 'Q2' }),
    row({ 'Reporting.Year': 2024, 'Reporting.Quarter': 'Q3' })]).filter(two.keep || (() => false));
  const pairOf = r => r['Reporting.Year'] + ' ' + r['Reporting.Quarter'];
  check(JSON.stringify([two.years, two.quarters]) === '[[2024,2025],["Q2","Q3"]]'
    && kept.length === 4 && kept.every(r => pairOf(r) === '2025 Q2' || pairOf(r) === '2024 Q3'),
  'combine: two periods as their exact year and quarter pairs, not every combination', [two.years, two.quarters, kept.length]);
  st = CF.setPlaces(st, 'wa', ['King', 'Pierce']);
  st = CF.toggle(st, 'focus', { kind: 'premises', value: 'Inbound\re:7', label: 'Yakima #2' });
  check(JSON.stringify(CF.chips(st, 'wa').map(c => c.text)) === JSON.stringify(['Species group: Cattle, Swine',
    'Period: 2025 Q2', 'Spotlight: King, Pierce']), 'chips: one per kind, in order', CF.chips(st, 'wa'));
  check(CF.chips(st, 'focus')[0].text === 'Premises: Yakima #2', 'chips: a premises by its label');
  check(CF.chips(CF.toggle(CF.create(), 'flow', { kind: 'place', value: 'OR' }), 'flow')[0].text === 'State: OR'
    && CF.chips(CF.toggle(CF.create(), 'wa', { kind: 'pair', value: 'Yakima\u0000Benton' }), 'wa')[0].text
      === 'Corridor: Yakima → Benton', 'chips: a state and a corridor');
  check(CF.removeKind(st, 'wa', 'species').wa.species.length === 0 && CF.removeKind(st, 'wa', 'species').wa.period.length === 1,
    'chip ×: removes that kind only');
  check(!CF.isActive(CF.clearView(st, 'wa'), 'wa') && CF.isActive(CF.clearView(st, 'wa'), 'focus'),
    'Clear chart filters: that view only');
  check(CF.hoverText('wa', { kind: 'place', value: 'King' }, false) === 'Click to add King to Spotlight Counties.'
    && CF.hoverText('wa', { kind: 'place', value: 'King' }, true) === 'Click to remove King from Spotlight Counties.'
    && CF.hoverText('flow', { kind: 'species', value: 'Cattle' }, true) === 'Click to remove the filter for Cattle.'
    && CF.hoverText('focus', { kind: 'premises', value: 'k', label: 'Yakima #2' }, false) === 'Click to filter by Yakima #2.',
  'hover text (on WA State a county keeps S7\'s words)');

  // Dropping when the sidebar changes.
  let d = CF.reconcile('wa', st, rows.filter(r => r['Species.Group'] !== 'Cattle'), { periodMode: 'single', movementOn: false });
  check(JSON.stringify(d.state.wa.species) === '["Swine"]' && d.dropped.length === 1 && d.dropped[0].kind === 'species'
    && JSON.stringify(d.state.wa.place) === '["King","Pierce"]',
  'drop: a species the sidebar no longer has; the spotlight is kept', d.dropped);
  check(CF.dropMessage('wa', d.dropped) === 'Chart filter removed (Species group: Cattle). The sidebar filters no longer include it.',
    'drop: the message', CF.dropMessage('wa', d.dropped));
  d = CF.reconcile('wa', st, rows, { periodMode: 'browse', movementOn: false });
  check(d.state.wa.period.length === 0 && d.state.wa.species.length === 2
    && CF.dropMessage('wa', d.dropped) === 'Chart filter removed (Period: 2025 Q2). Browse and Compare set the period.',
  'drop: the period filter when Browse sets the period', CF.dropMessage('wa', d.dropped));
  const withPair = CF.toggle(CF.create(), 'wa', { kind: 'pair', value: 'Yakima\u0000Benton' });
  // The corridor's rows are there, so only the movement view being off can drop it.
  const pairRows = [row({ 'Origin.State': 'WA', 'Origin.County': 'Yakima', 'Dest.County': 'Benton' })];
  const off = CF.reconcile('wa', withPair, pairRows, { periodMode: 'single', movementOn: false });
  check(off.state.wa.pair.length === 0 && off.dropped.length === 1 && off.dropped[0].reason === 'movement off'
    && CF.reconcile('wa', withPair, pairRows, { periodMode: 'single', movementOn: true }).state.wa.pair.length === 1,
  'drop: a corridor when the movement view is off, though its rows are there; kept while it is on', off.dropped);
  check(CF.reconcile('wa', st, rows, { periodMode: 'single', movementOn: false }).dropped.length === 0,
    'drop: nothing when every value still has rows');
  const flowSt = CF.toggle(CF.create(), 'flow', { kind: 'place', value: 'OR' });
  check(CF.reconcile('flow', flowSt, [row({ 'Origin.State': 'WA', 'Dest.State': 'ID', Movement: 'Outbound' })], {}).state.flow.place.length === 0,
    'drop: a state without rows after a sidebar change');
  const focusSt = CF.toggle(CF.create(), 'focus', { kind: 'premises', value: 'Inbound\re:7', label: 'Yakima #2' });
  const fd = CF.reconcile('focus', focusSt, [], {});
  check(CF.dropMessage('focus', fd.dropped) === 'Chart filter removed (Premises: Yakima #2). The sidebar filters no longer include it.',
    'drop: a premises named by its label');
  // A corridor is tested against the movement view's rows (it ignores Direction), so unticking
  // Inbound does not drop a corridor the view still draws; without them, the sidebar's rows as before.
  const ctxOn = more => Object.assign({ periodMode: 'single', movementOn: true }, more);
  check(CF.reconcile('wa', withPair, [], ctxOn({ pairRows })).dropped.length === 0
    && CF.reconcile('wa', withPair, [], ctxOn({})).dropped.length === 1,
  'drop: a corridor kept while the movement view\'s rows still have it');
  // By design, while a required picker is empty, nothing is dropped for rows; the period
  // mode and the movement view still drop theirs.
  const both = CF.toggle(CF.toggle(withPair, 'wa', { kind: 'species', value: 'Cattle' }), 'wa',
    { kind: 'period', value: '2025 Q2' });
  const waited = CF.reconcile('wa', both, [], ctxOn({ pickerEmpty: true }));
  check(waited.dropped.length === 0 && waited.state.wa.species.length === 1 && waited.state.wa.period.length === 1
    && waited.state.wa.pair.length === 1, 'drop: nothing dropped while a picker is empty', waited.dropped);
  const still = CF.reconcile('wa', both, [], { periodMode: 'browse', movementOn: false, pickerEmpty: true });
  check(JSON.stringify(still.dropped.map(x => x.reason)) === '["period mode","movement off"]',
    'drop: with a picker empty, the period mode and the movement view still drop theirs', still.dropped);
  check(CF.reconcile('focus', focusSt, [], { pickerEmpty: true }).dropped.length === 0
    && CF.reconcile('flow', flowSt, [], { pickerEmpty: true }).dropped.length === 0,
  'drop: nothing dropped on Flow and County Focus while a picker is empty');
  // The over-time chart's hover says why its points cannot be clicked, only while browsing or
  // comparing, not on County Focus (no period filter there).
  const otc = { id: 'over_time', empty: null };
  check(CF.noPickText('wa', otc, { periodMode: 'browse' }) === 'Browse sets the period, so the points cannot be clicked.'
    && CF.noPickText('flow', otc, { periodMode: 'browse' }) === 'Browse sets the period, so the points cannot be clicked.'
    && CF.noPickText('wa', otc, { periodMode: 'compare' })
      === 'Each map has its own period in Compare, so the points cannot be clicked.'
    && CF.noPickText('wa', otc, { periodMode: 'single' }) === null && CF.noPickText('focus', otc, { periodMode: 'browse' }) === null
    && CF.noPickText('wa', { id: 'species', empty: null }, { periodMode: 'browse' }) === null,
  'pick: the over-time hover says why its points cannot be clicked');

  // A place is where each copy counts (CVI's per-direction fix P1-12): an Intrastate row's Inbound copy at its
  // destination and its Outbound copy at its origin, so picking either county keeps that county's copy.
  const SRC = W.master.SOURCE_ROW;
  const copy = (movement, n) => Object.defineProperty(row({ Movement: movement, 'Origin.State': 'WA',
    'Origin.County': 'King', 'Dest.County': 'Pierce' }), SRC, { value: n });
  const intra = [copy('Inbound', 5), copy('Outbound', 5)];
  const at = place => CF.chartRows('wa', intra, CF.setPlaces(CF.create(), 'wa', [place]), 'species');
  check(at('Pierce').length === 1 && at('Pierce')[0].Movement === 'Inbound'
    && at('King').length === 1 && at('King')[0].Movement === 'Outbound',
  'place: a WA-to-WA movement counts at each end in the charts (its copy there)');
  const bothEnds = CF.chartRows('wa', intra, CF.setPlaces(CF.create(), 'wa', ['King', 'Pierce']), 'species');
  check(bothEnds.length === 2 && W.summary.dedupeVolume(bothEnds).length === 1,
    'place: with both ends picked, both copies stay and the species chart counts the movement once');
  check(CF.chartRows('wa', intra, CF.setPlaces(CF.create(), 'wa', ['King']), 'top_places') === intra,
    'place: the place charts keep all their rows');

  // The movement view's corridor chart: the pairs touching the spotlight.
  const mv = CF.movementChartRule(CF.setPlaces(CF.create(), 'wa', ['King'])) || (() => false);
  check(mv(intra[0]) && mv(intra[1]) && !mv(row({ 'Origin.County': 'Yakima', 'Dest.County': 'Benton' })),
    'movement chart: rows touching a spotlighted county');
  check(CF.movementChartRule(CF.create()) === null, 'movement chart: no rule without a spotlight');
  check(CF.ownKind('corridors', 'wa') === 'pair' && CF.ownKind('corridors', 'flow') === 'place'
    && CF.ownKind('top_premises', 'focus') === 'premises', 'each chart\'s own kind');
}

// ── Exports name the chart filters ───────────────────────────────────────────────────────────────────────────────
// The Stats text, export_params.json and a chart's caption with f.chartFilters (the chip bar's texts): one more line
// or entry, and with none (absent or empty) exactly CVI's form as before.
function exportHandCases() {
  const EX = W.exports;
  const now = new Date(2026, 9, 12, 14, 5, 9);
  const base = { species: ['Cattle', 'Swine'], years: [2025], quarters: ['Q1', 'Q2'], direction: ['Inbound', 'Outbound'] };
  const rows = [{ 'Species.Group': 'Cattle', 'Total.Animals': 12, Movement: 'Inbound', 'Origin.State': 'OR', 'Dest.State': 'WA',
    'Origin.County': 'N/A', 'Dest.County': 'King' }];
  const chips = ['Species group: Cattle', 'Spotlight: King, Pierce'];
  const withChips = Object.assign({}, base, { chartFilters: chips });
  const plain = EX.statsLines('wa', base, rows, [], now);
  const named = EX.statsLines('wa', withChips, rows, [], now);
  const at = plain.indexOf('  Direction: Inbound, Outbound');
  check(at > 0 && JSON.stringify(named) === JSON.stringify(plain.slice(0, at + 1)
    .concat(['  Chart filters: Species group: Cattle; Spotlight: King, Pierce'], plain.slice(at + 1))),
  'exports: the Stats text names the chart filters on one line after Direction', named.slice(at - 1, at + 3));
  check(JSON.stringify(EX.statsLines('wa', Object.assign({}, base, { chartFilters: [] }), rows, [], now)) === JSON.stringify(plain),
    'exports: no chart filters, the Stats text as before');
  const opts = { label: '', formats: ['csv'], layersOn: [] };
  const params = EX.exportParams('wa', withChips, opts, now).split('\n');
  const one = EX.exportParams('wa', Object.assign({}, base, { chartFilters: ['Period: 2025 Q2'] }), opts, now).split('\n');
  const none = EX.exportParams('wa', base, opts, now);
  // The chart filters come last among the choices, just before the coordinates line and "exported_at".
  const stamp = params.findIndex(l => l.indexOf('"coordinates"') >= 0);
  check(params[stamp - 1] === '  "chart_filters": ["Species group: Cattle", "Spotlight: King, Pierce"],'
    && one[one.findIndex(l => l.indexOf('"coordinates"') >= 0) - 1] === '  "chart_filters": "Period: 2025 Q2",'
    && params[stamp + 1].indexOf('"exported_at"') >= 0,
  'exports: export_params.json lists the chart filters before exported_at (one value written plain)', [params[stamp - 1], one]);
  check(none.indexOf('chart_filters') < 0 && EX.exportParams('wa', Object.assign({}, base, { chartFilters: [] }), opts, now) === none,
    'exports: no chart filters, export_params.json as before');
  const caption = EX.chartCaption('wa', withChips, ['Cattle', 'Swine']);
  check(caption === EX.chartCaption('wa', base, ['Cattle', 'Swine']) + ' | Chart filters: Species group: Cattle; Spotlight: King, Pierce',
    'exports: a chart\'s caption ends with the chart filters', caption);
}

// ── Run ────────────────────────────────────────────────────────────────────────────────────────────────────────
const asked = process.argv.slice(2);
const names = asked.length ? asked.filter(n => FIXTURES[n]) : Object.keys(FIXTURES);
for (const fixture of names) {
  const file = path.join(ORACLE, 'oracle_mc_' + fixture + '.json');
  if (!fs.existsSync(file)) {
    console.error('Missing ' + path.relative(ROOT, file) + ': run Rscript tests/oracle/mc_oracle.R first.');
    process.exit(2);
  }
  const oracle = JSON.parse(fs.readFileSync(file, 'utf8'));
  const loaded = W.master.load(fs.readFileSync(FIXTURES[fixture], 'utf8'));
  check(loaded.ok, fixture + ': the page\'s loader reads the file');
  oracle.scenarios.forEach(sc => runScenario(fixture, loaded, sc));
  console.log('  ' + fixture + ': ' + oracle.scenarios.length + ' scenarios');
}
handCases();
const cfNames = asked.length ? asked.filter(n => CF_FIXTURES[n]) : Object.keys(CF_FIXTURES);
cfNames.forEach(runCrossfilterFixture);
crossfilterHandCases();
exportHandCases();

console.log('  ' + Object.entries(counts).map(([k, v]) => v + ' ' + k).join(', '));
failures.slice(0, Number(process.env.MC_SHOW || 25)).forEach(f => console.log('FAIL ' + f));
console.log('MC unit tests: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
