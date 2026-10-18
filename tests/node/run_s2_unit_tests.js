#!/usr/bin/env node
'use strict';
// S2 unit tests: the WA map summaries (site/cvi/app/summary.js) against CVI's own WA map module, run by
// tests/oracle/cvi_r_oracle.R with shiny::testServer (local-test-artifacts/s2/oracle_s2_*.json): value boxes,
// summary strip and period label for every view of the S1 fixtures, the S2 fixtures (and variants of the S2 fixture
// without its CVI column and with an infinite count) and the three example bundle tiers; R's format() cases.
// Documented deviations, checked as such:
//   Merge rule: only the loader's two copies of one intrastate row merge for "Total animals". Every view's page total must
//        equal an independent model built from the file one row at a time, and the views where it differs from CVI
//        must be exactly the expected ones (none outside the S2 fixture).
//   "Unique CVIs" grayed without a CVI column (CVI shows 0); an all-numeric CVI column (read as numbers by CVI) gives
//        the documented difference in cvi_master_s2_numcvi only.
// Usage (repository root): node tests/node/run_f1_unit_tests.js, Rscript tests/oracle/cvi_r_oracle.R, then
// node tests/node/run_s2_unit_tests.js     (Node >= 22, no packages)
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.resolve(__dirname, '..', '..');
const APP = path.join(ROOT, 'site', 'cvi', 'app');
const ORACLE = path.join(ROOT, 'local-test-artifacts', 's2');
const sb = { window: {}, console };
vm.createContext(sb);
for (const f of ['csv.js', 'master.js', 'scaling.js', 'palettes.js', 'aggregate.js', 'summary.js', 'periods.js', 'icons.js', 'map.js'])
  vm.runInContext(fs.readFileSync(path.join(APP, f), 'utf8'), sb, { filename: f });
const W = sb.window.CVIWA;

let pass = 0, fail = 0; const failures = [];
function check(ok, name, detail) { if (ok) pass++; else { fail++; failures.push(name + (detail ? ' :: ' + JSON.stringify(detail).slice(0, 600) : '')); } }
const arr = x => x === null || x === undefined ? [] : Array.isArray(x) ? x : [x];
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
// R's non-finite numbers reach the JSON as null.
const eqNum = (a, b) => a === b || (b === null && typeof a === 'number' && !Number.isFinite(a));
const animals = r => (r['Total.Animals'] === null ? 0 : r['Total.Animals']);
const sumAnimals = rows => rows.reduce((t, r) => t + animals(r), 0);
const wa = s => s !== null && s !== undefined && String(s).trim().toUpperCase() === 'WA';

// CVI's own rule (dedupe_intrastate_volume), ported only to show that the page never drops a row CVI keeps: among
// WA-to-WA rows, drop every row identical to an earlier one on all columns except Movement.
function cviDedupe(sub, header) {
  const keyCols = header.filter(h => h !== 'Movement'), seen = new Set();
  return sub.filter(r => {
    if (!wa(r['Origin.State']) || !wa(r['Dest.State'])) return true;
    const k = JSON.stringify(keyCols.map(c => r[c] === undefined ? null : r[c]));
    if (seen.has(k)) return false; seen.add(k); return true;
  });
}

// Changes made after loading, the same as the oracle makes them in R.
function variant(meta, loaded) {
  if (meta.cvi_column_dropped) { loaded.header = loaded.header.filter(h => h !== 'CVI'); loaded.rows.forEach(r => { delete r.CVI; }); }
  if (meta.infinite_s014) loaded.rows.forEach(r => { if (r.CVI === 'S014') r['Total.Animals'] = Infinity; });
  return loaded;
}
// Independent model of the page's merge-rule total: each data line of the file is loaded on its own, so the copies of one
// intrastate row are known without the page's pairing. A file row counts the animals of its map rows in the view,
// once when both of its copies are in the view and CVI's test calls it WA-to-WA.
function rowModel(text, meta) {
  const lines = text.replace(/\r\n/g, '\n').split('\n').filter(l => l.length);
  const parsed = W.csv.parse(text);
  check(parsed.rows.length === lines.length - 1, meta.name + ': one file row per line (model precondition)', [parsed.rows.length, lines.length - 1]);
  return lines.slice(1).map(l => variant(meta, W.master.load(lines[0] + '\n' + l + '\n')));
}
function modelTotal(singles, f) {
  let t = 0;
  for (const one of singles) {
    const sub = W.summary.mapRows(one, f);
    if (!sub) continue;
    if (sub.length === 2 && wa(sub[0]['Origin.State']) && wa(sub[0]['Dest.State'])) t += animals(sub[0]);
    else t += sumAnimals(sub);
  }
  return t;
}
// CVI's count when its loader reads an all-numeric CVI column as numbers.
function numericCviCount(sub) {
  const s = new Set();
  sub.forEach(r => { const v = r.CVI === null || r.CVI === undefined ? '' : String(r.CVI).trim(); if (v) s.add(Number(v)); });
  return s.size;
}

// Against the same oracle file: icons, spotlight choices and layers, Reset All.
let nSpotMaps = 0;
function s2aDay2(o, name, loaded) {
  // Icons: unchanged copies of the SVGs CVI draws (bsicons; line breaks aside).
  const flat = s => String(s).replace(/\n/g, ''), BOX_ICONS = ['stack', 'file-earmark-medical', 'geo-alt', 'tags'];
  check(arr(o.icons).every((s, i) => flat(s) === W.icons[BOX_ICONS[i]]), name + ': box icons identical to CVI\'s');
  check(flat(o.alert_icon) === W.icons['info-circle'], name + ': alert icon identical to CVI\'s');
  // Spotlight choices as CVI offers them on load (origin and destination counties, out-of-state names included).
  const choices = W.summary.spotlightChoices(loaded);
  check(JSON.stringify(choices) === JSON.stringify(arr(o.load.spotlight_choices)), name + ': spotlight choices', { got: choices, want: o.load.spotlight_choices });
  // Spotlight layers: CVI's .build_county_map() on the default view's circles, per pick and opacity.
  const all = { species: loaded.speciesChoices, years: loaded.yearChoices, quarters: ['Q1', 'Q2', 'Q3', 'Q4'], rawSpecies: [] };
  for (const s of arr(o.spotlight)) {
    nSpotMaps++;
    const id = name + ' spotlight ' + s.pick + ' ' + arr(s.direction).join('+') + ' ' + s.mode + ' ' + s.opacity;
    const d = W.aggregate.build(loaded.rows, Object.assign({}, all, { direction: arr(s.direction), mode: s.mode, scaling: 'log', nBins: 5, hasSpecies: loaded.hasSpecies }));
    const drawn = W.map.drawOrder(d).map(i => d[i]);   // as map.draw
    const sp = W.summary.spotlightSplit(drawn, arr(s.spotlight)), hover = Math.min(1, s.opacity + 0.25);
    const page = !drawn.length ? [] : sp.all ? [{ id: 'circles', opacity: s.opacity, hover, circles: sp.all }]
      : [{ id: 'circles_dim', opacity: W.summary.DIM_OPACITY, hover: null, circles: sp.dim }]
        .concat(sp.spot.length ? [{ id: 'circles_spotlight', opacity: s.opacity, hover, circles: sp.spot }] : []);
    const want = arr(s.layers);
    check(drawn.length === s.n_circles, id + ': circle count', [drawn.length, s.n_circles]);
    check(page.length === want.length && page.every((l, k) => {
      const w = want[k], wc = arr(w.circles);
      return l.id === w.id && l.opacity === w.opacity && l.hover === (w.hover_opacity === undefined ? null : w.hover_opacity)
        && l.circles.length === wc.length && l.circles.every((c, j) => c.county === wc[j].county && c.direction === wc[j].direction
          && (wc[j].radius_px === null ? Number.isNaN(c.radius_px) || c.radius_px === null   // R's NA radius (infinite count)
            : Math.abs(c.radius_px - wc[j].radius_px) <= 1e-9 * Math.max(1, Math.abs(wc[j].radius_px))));
    }), id + ': layers, opacities and circles in drawing order', { page: page.map(l => [l.id, l.opacity, l.hover, l.circles.length]), want: want.map(l => [l.id, l.opacity, l.hover_opacity, arr(l.circles).length]) });
  }
  // Reset All: the page's defaults against CVI's reset messages for the WA map controls the browser has.
  const msg = k => { const m = arr(o.reset).find(x => x.id === k); return m ? m.msg : undefined; };
  const val = k => (msg(k) || {}).value, r = W.summary.resetDefaults(loaded), same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  check(same(arr(val('county_species')), r.species) && same(arr(val('county_species_sub')), r.speciesSub)
    && same(arr(val('county_year')), r.years.map(String)) && same(arr(val('county_quarter')), r.quarters)
    && same(arr(val('county_direction')), r.direction) && val('county_mode') === r.mode && val('county_scaling') === r.scaling
    && val('county_n_bins') === String(r.nBins) && val('county_opacity') === r.opacity && val('county_palette') === r.palette
    && val('show_county_labels') === r.labels, name + ': Reset All defaults as CVI', { cvi: arr(o.reset).slice(0, 22), page: r });
  check(msg('county_spotlight') !== undefined && val('county_spotlight') === undefined && same(r.spotlight, []),
    name + ': CVI\'s reset sends no spotlight value (leaves it); the page clears it (by design)');
  check(!arr(o.reset).some(x => /county_lines|show_county_lines/.test(x.id)), name + ': CVI\'s reset leaves county lines alone (so does the page)');
}

// S2b: period modes, against CVI's module driven through Browse and Compare (oracle "periods"): the slider's periods,
// what each position puts in the pickers, the labels and header, playback speeds, the right map's circles, the boxes
// and strip in each state, and the period part of Reset All. Deliberate differences, checked as
// such: the Browse header by year names the year shown (CVI reads the year-quarter list); the right map ignores a
// hidden "Refine by species" pick.
const nPeriod = { frames: 0, compare: 0, headerByYear: 0, hiddenRefine: 0, leftRefine: 0 };
const sameCircles = (page, want) => {
  const w = arr(want);
  const close = (a, b) => (b === null ? a === null || Number.isNaN(a) || !Number.isFinite(a) : Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b)));
  return page.length === w.length && page.every((c, j) => c.county === w[j].county && c.direction === w[j].direction
    && eqNum(c.total_animals, w[j].total_animals) && close(c.lat, w[j].lat) && close(c.lon, w[j].lon) && close(c.radius_px, w[j].radius_px));
};
const pageCircles = (loaded, f) => (f.species.length && f.quarters.length && f.direction.length && f.years.length)
  ? W.aggregate.build(loaded.rows, Object.assign({ scaling: 'log', nBins: 5, hasSpecies: loaded.hasSpecies }, f)) : [];
// The value boxes and strip the page shows for filters f, against CVI's (merge rule, grayed CVI box and an all-numeric CVI
// column as in the view checks above).
function boxesAndStrip(loaded, f, wvb, wst, id) {
  const got = W.summary.summary(loaded, f), vb = W.summary.valueBoxes(got);
  let deviates = false;
  if (got) { const sub = W.summary.mapRows(loaded, f), cvis = new Set(cviDedupe(sub, loaded.header)); deviates = W.summary.dedupeVolume(sub).some(r => !cvis.has(r)); }
  check(vb.state === wvb.state, id + ': value box state', [vb.state, wvb.state]);
  if (vb.state === 'metrics' && wvb.state === 'metrics') {
    const wm = arr(wvb.metrics);
    vb.metrics.forEach((m, i) => {
      const e = wm[i] || {};
      const ok = (i === 0 && deviates) ? m.text === W.scaling.formatR([got.total_animals])[0]
        : m.disabled ? e.text === '0'
        : (i === 1 && loaded.header.indexOf('CVI') >= 0 && e.text !== m.text && /numcvi/.test(id)) ? true
        : m.text === e.text;
      check(ok && m.label === e.label, id + ': box ' + i, [m.text, e.text]);
    });
  }
  const st = W.summary.strip(loaded, f, pageCircles(loaded, f));
  check(st.state === wst.state, id + ': strip state', [st.state, wst.state]);
  if (st.state === 'summary' && wst.state === 'summary') {
    const wi = arr(wst.items);
    check(st.items.length === wi.length && st.items.every((it, i) => it.label === wi[i].label && it.text === wi[i].text), id + ': strip', { got: st.items, want: wi });
  }
}
function s2bPeriods(o, name, loaded) {
  const p = o.periods, P = W.periods;
  check(!!p, name + ': period oracle present');
  if (!p) return;
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const dom = P.domains(loaded), nq = dom.quarter.length, ny = dom.year.length;
  check(same(dom.quarter, arr(p.domains.quarter)) && same(dom.year, arr(p.domains.year)), name + ': slider periods', { got: dom, want: p.domains });
  const all = { species: loaded.speciesChoices.slice(), rawSpecies: [], direction: ['Inbound', 'Outbound'], mode: 'side_by_side' };
  const s = { periodMode: 'single', years: loaded.yearChoices.slice(), quarters: P.QUARTERS.slice(), timeStep: 'quarter', timeIndex: P.middle(nq) };
  check(P.header(s, dom) === p.single.header, name + ': Single header', [P.header(s, dom), p.single.header]);
  const msgVal = (ms, id) => { const m = arr(ms).find(x => x.id === id); return m ? m.msg.value : undefined; };
  const picks = st => ({ years: arr(st.years).map(Number), quarters: arr(st.quarters) });

  // The slider CVI sends at load (CVI's own message, not a copy of its formula): one position per
  // year-quarter, in the middle.
  const ls = arr(o.load.messages).find(x => x.id === 'county_time_slider');
  check(!!ls && Number(ls.msg.value) === P.middle(nq) && Number(ls.msg.max) === Math.max(1, nq), name + ': slider at load as CVI sends it (middle of the quarters)',
    ls && [ls.msg.value, ls.msg.max, P.middle(nq), nq]);

  // Entering Browse: the hidden checkboxes flip, the slider sits in the middle and its period fills the pickers.
  const e = p.browse_enter, fr0 = P.frame(dom, 'quarter', P.middle(nq));
  check(msgVal(e.messages, 'county_time_enabled') === true && msgVal(e.messages, 'county_compare_enabled') === false, name + ': Browse flips the hidden checkboxes');
  check(Number(e.slider) === P.middle(nq) && same(picks(e), fr0), name + ': Browse starts in the middle', [e.slider, picks(e), fr0]);
  Object.assign(s, { periodMode: 'browse' }, fr0);
  check(e.time_label === P.timeLabel(dom, 'quarter', s.timeIndex) && e.header === P.header(s, dom), name + ': Browse label and header', [e.time_label, e.header, P.header(s, dom)]);

  // Every frame, by quarter then by year.
  let last = null;
  for (const fr of arr(p.browse_frames)) {
    nPeriod.frames++;
    const id = name + ' browse ' + fr.step + ' ' + fr.index, want = P.frame(dom, fr.step, fr.index);
    check(same(picks(fr), want), id + ': pickers', [picks(fr), want]);
    Object.assign(s, { timeStep: fr.step, timeIndex: fr.index }, want);
    check(fr.time_label === P.timeLabel(dom, fr.step, fr.index), id + ': label', [fr.time_label, P.timeLabel(dom, fr.step, fr.index)]);
    if (fr.step === 'quarter') check(fr.header === P.header(s, dom), id + ': header as CVI', [fr.header, P.header(s, dom)]);
    else {
      // CVI's header reads position i of the year-quarter list; the page names the year on the map.
      const cvi = fr.index <= nq ? 'Browse: ' + dom.quarter[fr.index - 1] : 'Browse over time';
      check(fr.header === cvi && P.header(s, dom) === 'Browse: ' + fr.time_label, id + ': header by year (deliberate difference)', [fr.header, cvi, P.header(s, dom)]);
      if (fr.header !== P.header(s, dom)) nPeriod.headerByYear++;
    }
    boxesAndStrip(loaded, Object.assign({}, all, want), fr.value_boxes, fr.strip, id);
    last = want;
  }
  const sw = p.browse_year_switch;
  check(Number(sw.slider) === P.middle(ny) && same(picks(sw), P.frame(dom, 'year', P.middle(ny))), name + ': Step by Year moves to the middle year', [sw.slider, picks(sw)]);

  // Speeds: the slider's Play interval for each choice, loop off; the position is kept when the speed changes.
  // The page's picker against CVI's rendered one (values, labels, order, default).
  const sc = arr(p.speed_choices);
  check(sc.length === P.SPEEDS.length && sc.every((c, i) => Number(c.value) === P.SPEEDS[i].ms && c.label === P.SPEEDS[i].label)
    && sc.filter(c => c.selected).map(c => Number(c.value)).join() === String(P.DEFAULT_SPEED), name + ': playback speeds and labels as CVI\'s picker', { page: P.SPEEDS, cvi: sc });
  for (const sp of arr(p.speeds))
    check(Number(sp.interval) === Number(sp.speed) && sp.loop === 'FALSE' && Number(sp.min) === 1 && Number(sp.max) === ny && Number(sp.from) === ny,
      name + ': slider at speed ' + sp.speed, sp);

  // Leaving Browse keeps the last period in the pickers.
  const lv = p.browse_leave;
  check(msgVal(lv.messages, 'county_time_enabled') === false && same(picks(lv), last), name + ': leaving Browse keeps the last period', [picks(lv), last]);
  check(lv.header === P.header(Object.assign({}, s, { periodMode: 'single' }, last), dom), name + ': Single header after Browse', lv.header);

  // Compare.
  check(msgVal(p.compare_enter.messages, 'county_compare_enabled') === true && msgVal(p.compare_enter.messages, 'county_time_enabled') === false,
    name + ': Compare flips the hidden checkboxes');
  for (const c of arr(p.compare)) {
    nPeriod.compare++;
    const id = name + ' compare ' + c.case + ' ' + arr(c.direction).join('+') + ' ' + c.mode;
    const r = c.right, cs = { periodMode: 'compare', species: loaded.speciesChoices.slice(), years: arr(c.years).map(Number), quarters: arr(c.quarters),
      speciesBEnabled: r.species_b_enabled, speciesB: arr(r.species_b), speciesBSub: arr(r.species_b_sub), yearsB: arr(r.years_b).map(Number), quartersB: arr(r.quarters_b) };
    if (c.left) Object.assign(cs, { species: arr(c.left.species), speciesSub: arr(c.left.species_sub) }); else cs.speciesSub = [];
    const left = { species: cs.species, rawSpecies: cs.speciesSub, years: cs.years, quarters: cs.quarters, direction: arr(c.direction), mode: c.mode };
    const right = Object.assign({ direction: left.direction, mode: c.mode }, P.rightFilters(cs));
    check(c.label_a === W.summary.periodLabel(cs.years, cs.quarters) && c.label_b === W.summary.periodLabel(cs.yearsB, cs.quartersB), id + ': map labels', [c.label_a, c.label_b]);
    check(c.header === P.header(cs, dom), id + ': header', [c.header, P.header(cs, dom)]);
    check(sameCircles(pageCircles(loaded, left), c.circles_a), id + ': left map circles');
    if (c.case === 'b_raw_hidden') {
      // CVI filters the right map by the hidden refine; the page does not (it shows the shared species, all of them).
      const cviModel = Object.assign({}, right, { rawSpecies: cs.speciesBSub });
      check(sameCircles(pageCircles(loaded, cviModel), c.circles_b), id + ': CVI applies the hidden refine (model)');
      check(right.rawSpecies.length === 0 && sameCircles(pageCircles(loaded, right), c.circles_a), id + ': page right map ignores it (deliberate difference)');
      if (!sameCircles(pageCircles(loaded, right), c.circles_b)) nPeriod.hiddenRefine++;
    } else check(sameCircles(pageCircles(loaded, right), c.circles_b), id + ': right map circles', { page: pageCircles(loaded, right).length, cvi: arr(c.circles_b).length });
    // The left map's refine does not reach the right map (CVI); the page's note is shown exactly then.
    check(P.refineNote(cs) === (cs.speciesSub.length > 0), id + ': left-refine note shown only while the left map is refined', cs.speciesSub);
    // Views where the refined left map and the right map differ (none without a Species column, where CVI ignores the
    // refine, or where nothing matches); the right map itself is checked against CVI above.
    if (c.case === 'a_raw' && cs.speciesSub.length && !sameCircles(pageCircles(loaded, left), c.circles_b)) nPeriod.leftRefine++;
    boxesAndStrip(loaded, left, c.value_boxes, c.strip, id + ' (boxes follow the left map)');
  }

  // Reset All, period part: CVI's messages for these controls; nothing for the slider, its step or speed.
  const rv = k => { const m = arr(o.reset).find(x => x.id === k); return m ? m.msg.value : undefined; }, d = P.resetDefaults(loaded);
  check(rv('county_period_mode') === d.periodMode && rv('county_compare_enabled') === false && rv('county_species_b_enabled') === d.speciesBEnabled
    && same(arr(rv('county_species_b')), d.speciesB) && same(arr(rv('county_species_b_sub')), d.speciesBSub)
    && same(arr(rv('county_year_b')), d.yearsB.map(String)) && same(arr(rv('county_quarter_b')), d.quartersB), name + ': Reset All, period part as CVI', d);
  check(!arr(o.reset).some(x => /county_time_(slider|step|speed)/.test(x.id)), name + ': Reset All leaves the slider, step and speed (as CVI)');
}

const EXPECTED_DEVIATION_VIEWS ={ cvi_master_s2: 34, cvi_master_s2_nocvi: 58, cvi_master_s2_inf: 34 };
const files = fs.existsSync(ORACLE) ? fs.readdirSync(ORACLE).filter(f => /^oracle_s2_.*\.json$/.test(f)).sort() : [];
check(files.length === 9, 'S2 oracle files present (run: Rscript tests/oracle/cvi_r_oracle.R)', files);
let nViews = 0, nAlert = 0, nMessage = 0, nNumCvi = 0;
const cmp = { less: 0, more: 0, countyGap: 0, countyGapMin: Infinity };
const devViews = {};
for (const file of files) {
  const o = JSON.parse(fs.readFileSync(path.join(ORACLE, file), 'utf8'));
  const name = o.meta.name, text = read(o.meta.fixture);
  const loaded = variant(o.meta, W.master.load(text));
  check(loaded.ok, name + ': loads');
  const singles = rowModel(text, o.meta);
  const numericCvi = o.meta.cvi_column_class === 'numeric';
  check(numericCvi === (name === 'cvi_master_s2_numcvi'), name + ': CVI column read as numbers by CVI only in the numeric fixture', o.meta.cvi_column_class);
  check(arr(o.icons).length === 4, name + ': four box icons captured', arr(o.icons).length);
  // Rows in the file and map rows, as CVI counts them.
  check(loaded.physicalRows === o.load.physical_rows && loaded.mapRows === o.load.map_rows, name + ': physical and map rows',
    [loaded.physicalRows, loaded.mapRows, o.load.physical_rows, o.load.map_rows]);
  s2aDay2(o, name, loaded);
  s2bPeriods(o, name, loaded);
  devViews[name] = 0;
  for (const v of o.views) {
    nViews++;
    const f = { species: arr(v.filters.species), years: arr(v.filters.years).map(Number), quarters: arr(v.filters.quarters),
      direction: arr(v.filters.direction), rawSpecies: arr(v.filters.raw_species), mode: v.mode };
    const id = name + ' ' + v.scenario + ' ' + f.direction.join('+') + ' ' + v.mode;
    const got = W.summary.summary(loaded, f);
    const want = v.summary;
    check((got === null) === (want === null), id + ': summary present', [got, want]);
    let deviates = false;
    if (got && want) {
      const sub = W.summary.mapRows(loaded, f);
      const cvis = cviDedupe(sub, loaded.header);
      check(eqNum(sumAnimals(cvis), want.total_animals), id + ': CVI\'s de-duplication rule reproduces CVI\'s total', [sumAnimals(cvis), want.total_animals]);
      check(got.total_animals === modelTotal(singles, f), id + ': merge-rule total equals the row-by-row model', [got.total_animals, modelTotal(singles, f)]);
      const mine = new Set(W.summary.dedupeVolume(sub)), cviSet = new Set(cvis);
      check([...cviSet].every(r => mine.has(r)), id + ': the merge rule never drops a row CVI keeps');
      deviates = [...mine].some(r => !cviSet.has(r));
      if (deviates) devViews[name]++;
      check(got.n_counties === want.n_counties, id + ': WA counties', [got.n_counties, want.n_counties]);
      check(got.top_species === want.top_species, id + ': top species', [got.top_species, want.top_species]);
      if (loaded.header.indexOf('CVI') < 0) check(got.n_cvis === null && want.n_cvis === 0, id + ': no CVI column: grayed here, 0 in CVI', [got.n_cvis, want.n_cvis]);
      else if (numericCvi) {
        check(want.n_cvis === numericCviCount(sub), id + ': CVI counts the numbers of an all-numeric CVI column', [want.n_cvis, numericCviCount(sub)]);
        if (got.n_cvis !== want.n_cvis) nNumCvi++;
      } else check(got.n_cvis === want.n_cvis, id + ': unique CVIs', [got.n_cvis, want.n_cvis]);
    }
    // Value boxes as drawn.
    const vb = W.summary.valueBoxes(got), wvb = v.value_boxes;
    check(vb.state === wvb.state, id + ': value box state', [vb.state, wvb.state]);
    if (vb.state === 'alert' && wvb.state === 'alert') {
      nAlert++;
      check(JSON.stringify(vb.lines) === JSON.stringify(arr(wvb.lines)) && vb.icon === wvb.icon, id + ': alert text', [vb, wvb]);
    } else if (vb.state === 'metrics' && wvb.state === 'metrics') {
      const wm = arr(wvb.metrics);
      check(vb.metrics.length === wm.length, id + ': four boxes', vb.metrics.length);
      vb.metrics.forEach((m, i) => {
        const e = wm[i] || {};
        check(m.label === e.label && m.icon === e.icon && m.accent.toLowerCase() === e.accent.toLowerCase(), id + ': box ' + i + ' label, icon, accent', [m, e]);
        if (i === 0 && deviates) {
          // (with an infinite count both totals print "Inf")
          check(m.text === W.scaling.formatR([got.total_animals])[0] && (m.text !== e.text || !Number.isFinite(got.total_animals)),
            id + ': total box shows the merge-rule total', [m.text, e.text]);
        } else if (m.disabled) {
          check(i === 1 && e.text === '0' && m.reason === W.summary.NO_CVI_REASON && m.short === 'Needs the CVI column', id + ': CVI box grayed with the reason (short in the box)', [m, e]);
        } else if (i === 1 && numericCvi && got.n_cvis !== want.n_cvis) {
          check(m.text === String(got.n_cvis) && e.text === String(want.n_cvis), id + ': numeric-CVI box: documented difference', [m, e]);
        } else {
          check(m.text === e.text && m.text === e.value && m.zero === e.zero, id + ': box ' + i + ' value and zero style', [m, e]);
        }
      });
    }
    // Summary strip, from the circles the S1 builder draws.
    const circles = (f.species.length && f.quarters.length && f.direction.length && f.years.length)
      ? W.aggregate.build(loaded.rows, Object.assign({ scaling: 'log', nBins: 5, hasSpecies: loaded.hasSpecies }, f)) : [];
    const st = W.summary.strip(loaded, f, circles), wst = v.strip;
    // How the strip's Animals and Counties compare with the boxes, for the help text below.
    if (got && st.state === 'summary') {
      const stripAnimals = circles.reduce((t, c) => (c.total_animals === null || Number.isNaN(c.total_animals) ? t : t + c.total_animals), 0);
      if (Number.isFinite(got.total_animals)) { if (stripAnimals < got.total_animals) cmp.less++; else if (stripAnimals > got.total_animals) cmp.more++; }
      const stripCounties = new Set(circles.map(c => c.county)).size;
      cmp.countyGap = Math.max(cmp.countyGap, got.n_counties - stripCounties); cmp.countyGapMin = Math.min(cmp.countyGapMin, got.n_counties - stripCounties);
    }
    check(st.state === wst.state, id + ': strip state', [st.state, wst.state]);
    if (st.state === 'summary' && wst.state === 'summary') {
      const wi = arr(wst.items);
      check(st.items.length === wi.length && st.items.every((it, i) => it.label === wi[i].label && it.text === wi[i].text),
        id + ': strip items', { got: st.items, want: wi });
    } else if (st.state === 'message' && wst.state === 'message') {
      nMessage++;
      const shown = st.lines.map(l => l.replace(/\s+/g, ' ').trim());  // as a browser shows them
      check(JSON.stringify(shown) === JSON.stringify(arr(wst.lines)), id + ': strip message', { got: shown, want: wst.lines });
    }
  }
  check(devViews[name] === (EXPECTED_DEVIATION_VIEWS[name] || 0), name + ': views where the merge-rule total differs from CVI',
    [devViews[name], EXPECTED_DEVIATION_VIEWS[name] || 0]);
}
check(nNumCvi > 0, 'numeric-CVI fixture shows the documented difference in some views', nNumCvi);
// The help text's claims hold on the oracle views: the strip's Animals is above the box in some views and below it in
// others, and the WA counties box is never below the strip's Counties and at most one above it.
check(cmp.more > 0 && cmp.less > 0 && /more than Total animals/.test(W.summary.HELP_STRIP) && /can also be less/.test(W.summary.HELP_STRIP),
  'help text: the strip can be more or less than Total animals, and both happen', cmp);
check(cmp.countyGap === 1 && cmp.countyGapMin === 0 && /one higher/.test(W.summary.HELP_STRIP), 'help text: the WA counties box is at most one above the strip\'s Counties', cmp);

// The merge rule by hand on the S2 fixture (all periods, both directions): CVI keeps one of the two identical S001 rows (30),
// one of the Import/Export pair S004 (12) and, without the CVI column, one of S024/S025 (15). The page keeps them
// all, so its total is the same with or without the column: 101,359 + 30 + 12 = 101,344 + 30 + 12 + 15 = 101,401.
{
  const s2 = W.master.load(read('tests/synthetic/cvi_master_s2.csv'));
  const all = { species: s2.speciesChoices, years: s2.yearChoices, quarters: ['Q1', 'Q2', 'Q3', 'Q4'], direction: ['Inbound', 'Outbound'], rawSpecies: [] };
  const withCol = W.summary.summary(s2, all);
  s2.header = s2.header.filter(h => h !== 'CVI'); s2.rows.forEach(r => { delete r.CVI; });
  const without = W.summary.summary(s2, all);
  check(withCol.total_animals === 101401 && without.total_animals === 101401, 'merge rule by hand: the page counts S001 twice, S004 twice, S024/S025 twice',
    [withCol.total_animals, without.total_animals]);
  check(withCol.n_cvis === 23 && without.n_cvis === null, 'by hand: 23 distinct CVIs (blank, NA and " S007 " handled), none without the column');
  // S003 is marked Intrastate but goes to Oregon: CVI does not merge its two copies (its states are not both WA).
  const s003 = W.summary.mapRows(s2, Object.assign({}, all, { species: ['Swine'], years: [2024], quarters: ['Q3'] }));
  check(s003.length === 2 && W.summary.dedupeVolume(s003).length === 2, 'merge rule by hand: S003 (Intrastate to OR) keeps both copies, as CVI');
  // Pairing does not depend on row order: the copies carry their file row (hidden: not a column, not enumerated).
  const again = W.master.load(read('tests/synthetic/cvi_master_s2.csv'));
  check(W.summary.summary(Object.assign({}, again, { rows: again.rows.slice().reverse() }), all).total_animals === 101401,
    'merge rule: rows reversed after loading give the same total');
  const SRC = W.master.SOURCE_ROW, intra = again.rows.filter(r => r.CVI === 'S002');
  check(intra.length === 2 && intra[0][SRC] === intra[1][SRC] && JSON.stringify(Object.keys(intra[0])) === JSON.stringify(again.header),
    'loader copies share a hidden file-row number (not a column)');
}

// R's format() as the boxes and strip use it (format_cases_s2.json): doubles via formatR, the CVI count as a whole number.
{
  const fc = path.join(ORACLE, 'format_cases_s2.json');
  check(fs.existsSync(fc), 'format cases present');
  if (fs.existsSync(fc)) {
    const cases = JSON.parse(fs.readFileSync(fc, 'utf8'));
    const num = s => s === null ? null : s === 'Inf' ? Infinity : s === '-Inf' ? -Infinity : s === 'NaN' ? NaN : Number(s);
    cases.double.forEach(c => { const x = arr(c.x).map(num), got = W.scaling.formatR(x);
      check(JSON.stringify(got) === JSON.stringify(arr(c.out)), 'format() double ' + JSON.stringify(c.x), { got, want: c.out }); });
    cases.integer.forEach(c => { const n = arr(c.x)[0];
      const box = W.summary.valueBoxes({ total_animals: 1, n_cvis: n, n_counties: 1, top_species: 'x' }).metrics[1].text;
      check(box === arr(c.out)[0], 'format() integer CVI count ' + n, { got: box, want: c.out }); });
  }
}

// Period labels: CVI's rules on hand cases (the strip above checks them against CVI on every view).
const P = W.summary.periodLabel;
[[[2024, 2025], ['Q1', 'Q2', 'Q3', 'Q4'], '2024/2025 Q1-Q4'], [[2023, 2024, 2026], ['Q3', 'Q1'], '2023-2026 Q1, Q3'],
 [[2025], ['Q2'], '2025 Q2'], [[], [], '— —'], [[2026, 2023], ['Q4', 'Q1', 'Q2'], '2023/2026 Q1, Q2, Q4']]
  .forEach(([y, q, want]) => check(P(y, q) === want, 'period label ' + want, P(y, q)));

// Period modes on hand cases without an R run: no periods, one period, a quoted empty
// quarter, where Play stops, the left-refine note.
{
  const PP = W.periods, same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const mk = rows => ({ rows, yearChoices: [...new Set(rows.map(r => r['Reporting.Year']).filter(y => y !== null))].sort() });
  const none = PP.domains(mk([{ 'Reporting.Year': null, 'Reporting.Quarter': 'Q1' }]));
  check(same(none, { quarter: [], year: [] }) && PP.frame(none, 'quarter', 1) === null && PP.timeLabel(none, 'year', 1) === '—'
    && PP.header({ periodMode: 'browse', timeStep: 'quarter', timeIndex: 1 }, none) === 'Browse over time', 'periods: no periods (no frame, "—", "Browse over time")', none);
  const one = PP.domains(mk([{ 'Reporting.Year': 2025, 'Reporting.Quarter': 'Q3' }]));
  check(same(one.quarter, ['2025-Q3']) && PP.middle(1) === 1 && PP.playStart(1, 1) === 1 && PP.nextIndex(1, 1) === null
    && same(PP.frame(one, 'quarter', 1), { years: [2025], quarters: ['Q3'] }), 'periods: one period (middle 1, Play has no next frame)', one);
  const blank = PP.domains(mk([{ 'Reporting.Year': 2024, 'Reporting.Quarter': '' }, { 'Reporting.Year': 2024, 'Reporting.Quarter': 'Q2' }]));
  check(same(blank.quarter, ['2024-', '2024-Q2']) && PP.frame(blank, 'quarter', 1) === null && same(PP.frame(blank, 'quarter', 2), { years: [2024], quarters: ['Q2'] }),
    'periods: a quoted empty quarter ("2024-") leaves the pickers as they are (R strsplit drops the empty end)', blank);
  check(PP.nextIndex(2, 3) === 3 && PP.nextIndex(3, 3) === null && PP.playStart(3, 3) === 1, 'periods: the step onto the last period is the last one Play takes');
  const cs = { periodMode: 'compare', speciesBEnabled: false, speciesSub: ['Dairy cattle'] };
  check(PP.refineNote(cs) && !PP.refineNote(Object.assign({}, cs, { speciesBEnabled: true })) && !PP.refineNote(Object.assign({}, cs, { speciesSub: [] }))
    && !PP.refineNote(Object.assign({}, cs, { periodMode: 'single' })), 'periods: the left-refine note only in Compare, with a left refine and the shared species');
}

console.log('S2 summaries: ' + nViews + ' views from ' + files.length + ' oracle files (' + nAlert + ' with the no-match alert, '
  + nMessage + ' with the strip diagnostic); merge-rule deviation in ' + Object.values(devViews).reduce((a, b) => a + b, 0) + ' views '
  + JSON.stringify(devViews) + '; numeric-CVI difference in ' + nNumCvi + ' views; ' + nSpotMaps + ' spotlight maps');
console.log('S2b periods: ' + nPeriod.frames + ' Browse frames, ' + nPeriod.compare + ' Compare views; header by year differs from CVI in '
  + nPeriod.headerByYear + ' frames, hidden right-map refine in ' + nPeriod.hiddenRefine + ' views (deliberate differences); left refine not shared in '
  + nPeriod.leftRefine + ' views (as CVI)');
check(nPeriod.leftRefine > 0, 'Compare with a refined left map exercised (oracle case a_raw)', nPeriod.leftRefine);
if (failures.length) { console.log(failures.slice(0, 40).join('\n')); if (failures.length > 40) console.log('… ' + (failures.length - 40) + ' more'); }
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
