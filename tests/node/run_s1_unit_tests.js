#!/usr/bin/env node
'use strict';
// S1 unit tests: the browser engine (site/cvi/app/*.js) against
//   (1) the independent hand oracle tests/synthetic/cvi_master_small_expected.json, and
//   (2) CVI's own R functions (local-test-artifacts/s1/oracle_*.json from tests/oracle/cvi_r_oracle.R), and
//   (3) F1: CVI's R functions on the master of each example bundle tier, found in the tier ZIP by the shared loader,
//   (4) S1.1 (deliberate differences), each by its own rule against CVI's values (oracle_s1_1.json, the
//       oracle's s1_1 part): palettes equal to CVI's except the listed WSDA guide colors; the Combined ("Total") color the
//       palette's first color; the legend swatch blend; the legend radii as the map draws CVI's tier values (log, linear,
//       square root: CVI's .compute_radius against the view's circles; binned: the tier's bin under the circles' own
//       breaks, from CVI's quantile/classInt/cut calls), uncapped and growing with the values.
// Usage (repository root): node tests/node/run_f1_unit_tests.js (writes the tiers), Rscript tests/oracle/cvi_r_oracle.R,
// then node tests/node/run_s1_unit_tests.js     (Node >= 22, no packages)
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.resolve(__dirname, '..', '..');
const APP = path.join(ROOT, 'site', 'cvi', 'app');
const ORACLE = path.join(ROOT, 'local-test-artifacts', 's1');
const sb = { window: {}, console };
vm.createContext(sb);
for (const f of ['csv.js', 'master.js', 'scaling.js', 'palettes.js', 'aggregate.js']) vm.runInContext(fs.readFileSync(path.join(APP, f), 'utf8'), sb, { filename: f });
const W = sb.window.CVIWA;

let pass = 0, fail = 0; const failures = [];
function check(ok, name, detail) { if (ok) pass++; else { fail++; failures.push(name + (detail ? ' :: ' + JSON.stringify(detail).slice(0, 500) : '')); } }
const arr = x => x === null || x === undefined ? [] : Array.isArray(x) ? x : [x];
const near = (a, b, tol) => a === b || (a !== null && b !== null && Math.abs(a - b) <= tol);
const TOL_R = 1e-9;
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

// ---- load checks ---------------------------------------------------------------------------------------------
const small = W.master.load(read('tests/synthetic/cvi_master_small.csv'));
const hand = JSON.parse(read('tests/synthetic/cvi_master_small_expected.json'));
check(small.ok, 'small fixture loads');
check(small.physicalRows === hand.meta.physical_rows && small.mapRows === hand.meta.map_rows && small.intrastateRows === hand.meta.intrastate_rows,
  'small: physical/map/intrastate row counts equal hand oracle', [small.physicalRows, small.mapRows, small.intrastateRows]);
check(JSON.stringify(small.yearChoices) === JSON.stringify(hand.meta.year_choices), 'small: year choices');
check(JSON.stringify(small.speciesChoices) === JSON.stringify(hand.meta.species_choices), 'small: species choices', small.speciesChoices);
for (const col of W.master.REQUIRED) {
  const txt = read('tests/synthetic/cvi_master_small.csv').split('\n');
  const hdr = txt[0].split(','), k = hdr.indexOf(col); hdr[k] = col + '_x';
  const r = W.master.load([hdr.join(',')].concat(txt.slice(1)).join('\n'));
  check(!r.ok && r.error.indexOf(col) >= 0, 'missing required column refused: ' + col);
}

// ---- (1) hand oracle -------------------------------------------------------------------------------------------
function optsFrom(f, mode, scaling, nBins, loaded) {
  return { species: arr(f.species), years: arr(f.years).map(Number), quarters: arr(f.quarters), direction: arr(f.direction),
    rawSpecies: arr(f.raw_species), mode, scaling, nBins, hasSpecies: loaded.hasSpecies };
}
let handN = 0;
for (const v of hand.views) for (const sc of ['log', 'sqrt', 'linear']) {
  const got = W.aggregate.build(small.rows, optsFrom(v.filters, v.mode, sc, 5, small));
  check(got.length === v.rows.length, 'hand ' + v.name + '/' + sc + ': circle count', [got.length, v.rows.length]);
  for (const e of v.rows) {
    handN++;
    const g = got.find(x => x.county === e.county && x.direction === e.direction);
    check(g && g.total_animals === e.total_animals && g.lat === e.lat && g.lon === e.lon && near(g.radius_px, e.radius[sc], TOL_R),
      'hand ' + v.name + '/' + sc + ' ' + e.county + ' ' + e.direction, { got: g && [g.total_animals, g.lat, g.lon, g.radius_px], want: [e.total_animals, e.lat, e.lon, e.radius[sc]] });
  }
}

// ---- (2) CVI R oracle ------------------------------------------------------------------------------------------
let rViews = 0, rRows = 0, rLegends = 0;
const haveOracle = fs.existsSync(path.join(ORACLE, 'oracle_engine.json'));
check(haveOracle, 'R oracle present (run: Rscript tests/oracle/cvi_r_oracle.R)');
// Compares the engine's result for every view of one R oracle file with R (circles, tooltips, legend tiers).
function compareViews(fx, o, ld) {
  check(ld.ok && ld.physicalRows === o.load.physical_rows && ld.mapRows === o.load.map_rows, fx + ': row counts equal R', [ld.physicalRows, ld.mapRows, o.load]);
  check(JSON.stringify(ld.yearChoices) === JSON.stringify(arr(o.load.year_choices)), fx + ': year choices equal R');
  check(JSON.stringify(ld.speciesChoices) === JSON.stringify(arr(o.load.species_choices)), fx + ': species choices equal R', [ld.speciesChoices, o.load.species_choices]);
  for (const v of o.views) {
    rViews++;
    const tag = fx + ' ' + v.scenario + ' ' + arr(v.filters.direction).join('+') + ' ' + v.mode + ' ' + v.scaling + '/' + v.n_bins;
    let got, err = null;
    try { got = W.aggregate.build(ld.rows, optsFrom(v.filters, v.mode, v.scaling, v.n_bins, ld)); } catch (e) { err = e.message; }
    if (v.error) { check(err !== null, tag + ': R errored, JS must too', { r: v.error, js: err }); continue; }
    if (err) { check(false, tag + ': JS threw', err); continue; }
    const want = arr(v.rows);
    check(got.length === want.length, tag + ': circle count', [got.length, want.length]);
    const live = W.aggregate.liveTooltips(got);
    for (const e of want) {
      rRows++;
      const i = got.findIndex(x => x.county === e.county && x.direction === e.direction), g = got[i];
      check(g && g.total_animals === e.total_animals && g.lat === e.lat && g.lon === e.lon && near(g.radius_px, e.radius_px, TOL_R),
        tag + ' ' + e.county + '/' + e.direction, { got: g && [g.total_animals, g.lat, g.lon, g.radius_px], want: [e.total_animals, e.lat, e.lon, e.radius_px] });
      if (g) {
        check(g.builder_tooltip === e.builder_tooltip, tag + ' builder tooltip ' + e.county, [g.builder_tooltip, e.builder_tooltip]);
        check(live[i] === e.live_tooltip, tag + ' live tooltip ' + e.county, [live[i], e.live_tooltip]);
      }
    }
    if (want.length) {
      rLegends++;
      const t = W.scaling.legendTiers(got.map(r => r.total_animals), v.scaling, v.n_bins);
      const L = v.legend;
      const ok = (t === null && (L === null || L === undefined)) || (t && L && arr(L.values).length === t.values.length &&
        arr(L.values).every((x, k) => near(x, t.values[k], TOL_R)) && arr(L.radii).every((x, k) => near(x, t.radii[k], TOL_R)));
      check(ok, tag + ': legend tiers', { js: t, r: L });
    }
  }
}
if (haveOracle) {
  for (const fx of ['cvi_master_small', 'cvi_master_wa39'])
    compareViews(fx, JSON.parse(fs.readFileSync(path.join(ORACLE, 'oracle_' + fx + '.json'), 'utf8')), W.master.load(read('tests/synthetic/' + fx + '.csv')));
  const eng = JSON.parse(fs.readFileSync(path.join(ORACLE, 'oracle_engine.json'), 'utf8'));
  for (const c of eng.radius) {
    const vals = arr(c.values).map(x => x === null ? null : x);
    let got, err = null;
    try { got = W.scaling.computeRadius(vals, c.scaling, 4, 48, c.n_bins); } catch (e) { err = e.message; }
    const tag = 'radius ' + c.scaling + '/' + c.n_bins + ' n=' + vals.length;
    if (c.error) { check(err !== null, tag + ': R errored', c.error); continue; }
    check(!err && arr(c.radius).every((x, k) => near(x, got[k], TOL_R)), tag, { values: vals.slice(0, 12), js: got && got.slice(0, 12), r: arr(c.radius).slice(0, 12) });
    const t = W.scaling.legendTiers(vals, c.scaling, c.n_bins), L = c.legend;
    check((t === null && !L) || (t && L && arr(L.values).every((x, k) => near(x, t.values[k], TOL_R)) && arr(L.radii).every((x, k) => near(x, t.radii[k], TOL_R)) && arr(L.values).length === t.values.length),
      tag + ': legend', { js: t, r: L });
  }
  for (const c of eng.fisher) {
    let got, err = null;
    try { got = W.scaling.fisherBreaks(arr(c.x), c.n); } catch (e) { err = e.message; }
    const tag = 'fisher n=' + c.n + ' len=' + arr(c.x).length;
    if (c.error) { check(err !== null, tag + ': R errored', c.error); continue; }
    const want = arr(c.brks);
    check(!err && got.length === want.length && want.every((x, k) => near(x, got[k], 1e-9)), tag, { x: arr(c.x).slice(0, 20), js: got, r: want });
  }
  for (const c of eng.format) {
    const got = W.scaling.formatR(arr(c.x).map(W.scaling.rRound));
    check(JSON.stringify(got) === JSON.stringify(arr(c.out)), 'format ' + JSON.stringify(c.x), { js: got, r: c.out });
  }
}

// ---- (3) F1: the master loaded from each example bundle tier ---------------------------------------------------
// Each tier ZIP goes through the shared loader and recognition (site/shared, as in the landing page); the master it
// finds is compared with CVI's R functions run on that tier (oracle_tier_<tier>.json), and R's tier results with
// R's single-CSV results for cvi_master_wa39.csv (the tiers' source rows). Full and Public carry every column the
// WA map uses and must give identical results in every view. Partner has only the 13 required columns, so as its
// columns allow: identical in every view except that (a) the hover breakdown CVI's builder computes per species
// is by species group only (the live map does not show it) and (b) "Refine by species" cannot apply, so CVI
// draws the whole group (the "cattle_raw" views equal Partner's own "cattle" views).
async function tiers() {
  const TIERS = path.join(ROOT, 'local-test-artifacts', 'f1', 'tiers');
  const have = haveOracle && ['full', 'partner', 'public'].every(t => fs.existsSync(path.join(ORACLE, 'oracle_tier_' + t + '.json')));
  check(have, 'R tier oracle present (run: node tests/node/run_f1_unit_tests.js, then Rscript tests/oracle/cvi_r_oracle.R)');
  if (!have) return;
  for (const f of ['zip.js', 'load.js', 'recognize.js', 'bundle.js']) require(path.join(ROOT, 'site', 'shared', f));
  require(path.join(ROOT, 'site', 'cvi', 'datasets.js'));
  const { load: L, recognize: R, bundle: B } = globalThis.WSDA, CVI = globalThis.WSDA.profiles.cvi;
  const single = JSON.parse(fs.readFileSync(path.join(ORACLE, 'oracle_cvi_master_wa39.json'), 'utf8'));
  const key = v => { const f = v.filters;
    return JSON.stringify([v.scenario, arr(f.species), arr(f.years), arr(f.quarters), arr(f.direction), arr(f.raw_species), v.mode, v.scaling, v.n_bins]); };
  const result = (v, dropBuilder) => JSON.stringify({ rows: arr(v.rows).map(r => dropBuilder ? Object.assign({}, r, { builder_tooltip: null }) : r), legend: v.legend, error: v.error });
  for (const tier of ['full', 'partner', 'public']) {
    const o = JSON.parse(fs.readFileSync(path.join(ORACLE, 'oracle_tier_' + tier + '.json'), 'utf8'));
    const zip = fs.readFileSync(path.join(TIERS, tier + '.zip'));
    const loaded = await L.fromFileList([new File([zip], tier + '.zip')], 'files');
    const bundle = await B.read(loaded.items);
    const rec = await R.recognize(loaded.items, CVI, { files: B.filesFor(bundle, CVI) });
    const m = rec.datasets.find(d => d.id === 'master');
    check(m && m.status === 'found', tier + ' tier: master recognized in the ZIP', m && m.status);
    if (!m || m.status !== 'found') continue;
    const item = loaded.items.find(i => i.id === m.fileId);
    const bytes = await item.read();
    check(Buffer.compare(Buffer.from(bytes), fs.readFileSync(path.join(ROOT, o.meta.fixture))) === 0, tier + ' tier: master in the ZIP equals the folder copy R read', o.meta.fixture);
    compareViews('tier ' + tier, o, W.master.load(new TextDecoder().decode(bytes)));
    // R tier vs R single CSV
    check(JSON.stringify(o.load) === JSON.stringify(single.load), tier + ' tier: R row counts and choices equal the single CSV');
    const own = new Map(o.views.map(v => [key(v), v]));
    let same = 0, builderOnly = 0, refineIgnored = 0;
    o.views.forEach((v, i) => {
      const s = single.views[i];
      if (key(v) !== key(s)) { check(false, tier + ' tier: view order', i); return; }
      if (tier !== 'partner' || (v.scenario !== 'cattle' && v.scenario !== 'cattle_raw')) {
        check(result(v) === result(s), tier + ' tier ' + key(v) + ': identical to the single CSV'); same++;
      } else if (v.scenario === 'cattle') {
        check(result(v, true) === result(s, true), tier + ' tier ' + key(v) + ': identical apart from the builder hover breakdown'); builderOnly++;
      } else {
        const asCattle = own.get(key(Object.assign({}, v, { scenario: 'cattle', filters: Object.assign({}, v.filters, { raw_species: [] }) })));
        check(asCattle && result(v) === result(asCattle), tier + ' tier ' + key(v) + ': refine by species ignored without Species, as in CVI'); refineIgnored++;
      }
    });
    tierNotes.push(`${tier}: ${same} views identical to the single CSV` + (tier === 'partner' ? `, ${builderOnly} identical apart from the builder hover breakdown, ${refineIgnored} with "Refine by species" ignored (no Species column)` : ''));
  }
}
const tierNotes = [];

// ---- (4) S1.1: the three deliberate differences, each by its own rule ---------------------------------------------
// The guide's values chosen for the page, written here independently of palettes.js.
const GUIDE = { direction: { 'WSDA Brand': { Outbound: '#f07325' }, 'Single — WSDA Orange': { Inbound: '#f07325', Outbound: '#f07325' } },
  species: { 'WSDA Brand': { 'Exotic Hoofstock': '#f07325', Poultry: '#0094aa', 'Small Ruminants': '#8bc04a', Swine: '#fcb614' },
    'Single — WSDA Orange': { Cattle: '#f07325', Equids: '#f07325', 'Exotic Hoofstock': '#f07325', Poultry: '#f07325', 'Small Ruminants': '#f07325', Swine: '#f07325', Other: '#f07325' } } };
const s11 = { palettes: 0, changed: [], views: 0, tiers: 0, overCap: 0, continuous: 0, binned: 0, binnedNotCvi: 0 };
const s11File = path.join(ORACLE, 'oracle_s1_1.json');
check(fs.existsSync(s11File), 'S1.1 oracle present (run: Rscript tests/oracle/cvi_r_oracle.R, part s1_1)');
if (fs.existsSync(s11File)) {
  const o = JSON.parse(fs.readFileSync(s11File, 'utf8'));
  // Palettes: every CVI entry equal on the page, except the guide's values (and CVI_VALUES records CVI's for each).
  for (const [kind, cvi, page] of [['direction', o.direction_palettes, W.palettes.DIRECTION_PALETTES], ['species', o.species_palettes, W.palettes.SPECIES_PALETTES]]) {
    check(JSON.stringify(Object.keys(page)) === JSON.stringify(cvi.map(p => p.name)), 'S1.1 ' + kind + ' palettes: same names and order as CVI', Object.keys(page));
    for (const p of cvi) {
      check(JSON.stringify(Object.keys(page[p.name] || {})) === JSON.stringify(p.colors.map(c => c.key)), 'S1.1 ' + kind + ' ' + p.name + ': same entries as CVI');
      for (const c of p.colors) {
        s11.palettes++;
        const g = (GUIDE[kind][p.name] || {})[c.key], got = (page[p.name] || {})[c.key];
        const rec = W.palettes.CVI_VALUES.find(x => x[0] === kind && x[1] === p.name && x[2] === c.key);
        if (g) {
          s11.changed.push(kind + ' ' + p.name + ' / ' + c.key + ': CVI ' + c.color + ' -> page ' + got);
          check(got === g && rec && rec[3] === c.color && c.color.toLowerCase() !== g, 'S1.1 ' + kind + ' ' + p.name + '/' + c.key + ': the guide value, CVI\'s recorded', { got, guide: g, cvi: c.color, rec });
        } else check(got === c.color && !rec, 'S1.1 ' + kind + ' ' + p.name + '/' + c.key + ': CVI\'s value', { got, cvi: c.color });
      }
    }
  }
  check(W.palettes.CVI_VALUES.length === s11.changed.length, 'S1.1: every recorded CVI value is a changed entry', [W.palettes.CVI_VALUES.length, s11.changed.length]);
  // Combined: "Total" is the palette's first color (Inbound) for every palette, on the map and in the legend; an
  // unknown palette name falls back to WSDA Default, as CVI's lookup.
  for (const [name, p] of Object.entries(W.palettes.DIRECTION_PALETTES)) {
    check(W.palettes.circleColor(name, 'Total') === p.Inbound && W.palettes.legendColor(name, 'Total') === p.Inbound, 'S1.1 Total color = first color: ' + name);
    check(['Inbound', 'Outbound'].every(d => W.palettes.circleColor(name, d) === p[d] && W.palettes.legendColor(name, d) === p[d]), 'S1.1 direction colors unchanged by the rule: ' + name);
  }
  check(W.palettes.circleColor('No such palette', 'Total') === '#1C9CD9', 'S1.1 Total color for an unknown palette: WSDA Default\'s first');
  // Legend swatch: the color at the opacity over the land (pixels read from the page: #74919c, #6f94ad).
  const B = W.palettes.blend;
  check(B('#245566', '0.6', '#ececec') === '#74919c' && B('#1c5a83', 0.6, '#ececec') === '#6f94ad' && B('#245566', 1, '#ececec') === '#245566'
    && B('#F0A06E', 0, '#ffffff') === '#ffffff' && B('#1C9CD9', 0.2, '#ffffff') === '#d2ebf7', 'S1.1 swatch blend');
  // Legend radii: CVI's tier values, each radius CVI's .compute_radius against the view's circles; no cap; growing.
  const files = {};
  for (const e of o.legend) {
    const f = files[e.file] || (files[e.file] = JSON.parse(fs.readFileSync(path.join(ORACLE, e.file), 'utf8')));
    const v = f.views[e.view - 1], vals = arr(v.rows).map(r => r.total_animals);
    const got = W.scaling.legendRadii(vals, e.scaling, e.n_bins), want = arr(e.radii), wv = arr(e.values);
    s11.views++; s11.tiers += want.length; s11.overCap += want.filter(r => r > 20 + 1e-9).length;
    const binned = e.scaling === 'quantile' || e.scaling === 'natural';
    if (binned) { s11.binned++; if (arr(v.legend.radii).some((x, k) => !near(x, want[k], TOL_R))) s11.binnedNotCvi++; } else s11.continuous++;
    check(got && got.values.length === wv.length && wv.every((x, k) => near(x, got.values[k], TOL_R)) && want.every((x, k) => near(x, got.radii[k], TOL_R))
      && arr(v.legend.radii).every((x, k) => near(x, got.cviRadii[k], TOL_R)) && got.radii.every((r, k) => !k || r >= got.radii[k - 1] - 1e-12),
      'S1.1 legend radii ' + e.file + ' #' + e.view + ' ' + e.scaling + '/' + e.n_bins, { got, want, values: wv });
  }
  check(s11.views > 2000 && s11.overCap > 0, 'S1.1 legend: views compared and radii above CVI\'s 20 px cap among them', s11);
  // The binned views are checked against the data's own bins (oracle, from CVI's quantile/classInt/cut calls), not
  // against CVI's tier-only radii: some of them must differ from CVI's, or the check could not fail.
  check(s11.binned > 2000 && s11.continuous > 500 && s11.binnedNotCvi > 0, 'S1.1 legend: binned views checked against the data\'s bins, some unlike CVI\'s tier-only radii', s11);
  { const g = W.scaling.legendRadii([0, 120, 2750, 400, 120], 'natural', 3);   // 917.5 is in 400's bin, drawn at 26
    check(g && JSON.stringify(g.radii) === '[4,26,48]' && JSON.stringify(g.cviRadii) === '[4,4,48]' && W.scaling.computeRadius([0, 120, 2750, 400, 120], 'natural', 4, 48, 3)[3] === 26,
      'S1.1 legend: a binned tier at its bin\'s radius on the map (917.5 case)', g); }
  check(W.scaling.legendRadii([5], 'log', 5) === null && W.scaling.legendRadii([], 'linear', 5) === null, 'S1.1 legend: none with fewer than two circles, as CVI');
}

// ---- report ---------------------------------------------------------------------------------------------------
tiers().catch(e => check(false, 'tier checks threw', e.stack)).then(() => {
  console.log('hand-oracle circles compared: ' + handN + '; R views: ' + rViews + ', circles: ' + rRows + ', legends: ' + rLegends);
  tierNotes.forEach(n => console.log('  tier ' + n));
  console.log('S1.1 (deliberate differences): palette entries ' + s11.palettes + ', changed to the guide ' + s11.changed.length + '; legend radii ' + s11.views + ' views (' + s11.continuous + ' log/linear/sqrt, ' + s11.binned + ' binned, ' + s11.binnedNotCvi + ' of them unlike CVI\'s tier-only radii), ' + s11.tiers + ' tiers (' + s11.overCap + ' above CVI\'s 20 px cap)');
  s11.changed.forEach(c => console.log('  ' + c));
  failures.forEach(f => console.log('  FAIL ' + f));
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
});
