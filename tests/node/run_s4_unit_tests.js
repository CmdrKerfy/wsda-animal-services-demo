#!/usr/bin/env node
'use strict';
// S4 unit tests: the National Flow port (site/cvi/app/flow.js) against CVI's own map module, run by
// tests/oracle/cvi_r_oracle.R with shiny::testServer (local-test-artifacts/s4/oracle_s4_*.json): for every view of the
// S1, S2 and S4 fixtures and the three example bundle tiers, the lines (states, species groups, totals, raw widths,
// species breakdowns, ends), the drawn map (layer order, each line's color, width, tooltip and drawing order, opacity and
// hover, state lines and labels, opening view), the legend, value boxes and strip; Browse (domains, every frame by
// quarter and by year, the picker values CVI sends) and the values Reset All sends. Arcs: every vertex of the port's
// gcIntermediate() against geosphere's (oracle_s4_arcs.json) within 1e-9 degrees. The two state files: counts, codes,
// closed rings, every center inside its own outline (not AK or HI), shared borders, the label priority by area; the county and region files
// unchanged. Deliberate differences, checked as such: with Combine species the legend swatch takes the lines' color
// (CVI's is #999999); "Unique CVIs" grayed without a CVI column (CVI shows 0); Reset All also turns Browse off (CVI sends
// nothing for it); state outlines from Census 2023 (CVI: the maps package); since S1.1 the WSDA guide's
// colors in "WSDA Brand" and "Single — WSDA Orange": CVI's value is expected translated through palettes.js CVI_VALUES
// (and the S1 unit suite checks that list against CVI's palettes).
// Usage (repository root): node tests/node/run_f1_unit_tests.js, Rscript tests/oracle/cvi_r_oracle.R (or its s4 part),
// then node tests/node/run_s4_unit_tests.js     (Node >= 22, no packages)
const fs = require('fs'), path = require('path'), vm = require('vm'), crypto = require('crypto');
const ROOT = path.resolve(__dirname, '..', '..');
const SITE = path.join(ROOT, 'site');
const APP = path.join(SITE, 'cvi', 'app');
const ORACLE = path.join(ROOT, 'local-test-artifacts', 's4');
const sb = { window: {}, console };
vm.createContext(sb);
for (const f of ['csv.js', 'master.js', 'scaling.js', 'palettes.js', 'aggregate.js', 'summary.js', 'periods.js', 'flow.js'])
  vm.runInContext(fs.readFileSync(path.join(APP, f), 'utf8'), sb, { filename: f });
for (const f of ['us-states.js', 'state-centers.js'])
  vm.runInContext(fs.readFileSync(path.join(SITE, 'geo', f), 'utf8'), sb, { filename: f });
const W = sb.window.CVIWA, F = W.flow;
const STATES = sb.window.WSDA_US_STATES, CENTERS = sb.window.WSDA_STATE_CENTERS;

let pass = 0, fail = 0; const failures = [];
function check(ok, name, detail) { if (ok) pass++; else { fail++; failures.push(name + (detail ? ' :: ' + JSON.stringify(detail).slice(0, 700) : '')); } }
const arr = x => x === null || x === undefined ? [] : Array.isArray(x) ? x : [x];
const sha = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
// R's non-finite numbers reach the JSON as null (or as the strings "Inf", "-Inf", "NaN").
const eqNum = (a, b) => a === b || ((b === null || typeof b === 'string') && typeof a === 'number' && !Number.isFinite(a));
const near = (a, b, tol) => eqNum(a, b) || (typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)));

// ── Unchanged files ───────────────────────────────────────────────────────────────────────────────────────────────
const UNCHANGED = {   // as committed in 1104504
  'geo/wa-counties.js': '39cec9a3c1f98f474c4eb06ca79fedc0bb8868783041061d5b13973f498b6853',
  'geo/regions/bc.js': 'bfdf95fcc43f25875433a61ce3da24b22f273bc2d352baae0eabc0316fc9053d',
  'geo/regions/id.js': 'd0be3426acc8f2db6d6cfb842dcafe22c13aba5f0be53531d6e1bd53d853a9a2',
  'geo/regions/or.js': 'b9009cbaaa73ab9aff29288e5ca296a7dfe7f2901afe8921a4f83a39a86fc6f5' };
for (const [f, h] of Object.entries(UNCHANGED)) check(sha(path.join(SITE, f)) === h, f + ' unchanged (SHA-256)');

// ── State files ───────────────────────────────────────────────────────────────────────────────────────────────────
const feats = STATES.states.features;
const codes = feats.map(f => f.properties.code);
check(feats.length === 49 && new Set(codes).size === 49, 'us-states: 49 outlines with unique codes', codes.length);
check(!codes.includes('AK') && !codes.includes('HI') && codes.includes('DC') && codes.includes('WA'), 'us-states: 48 contiguous states and DC, no AK or HI');
check(codes.every((c, i) => i === 0 || codes[i - 1] < c), 'us-states: sorted by code');
check(feats.every(f => /^[A-Z]{2}$/.test(f.properties.code) && f.properties.name && /^\d{2}$/.test(f.properties.fips)), 'us-states: code, name and FIPS on every outline');
check(/cb_2023_us_county_500k/.test(STATES.source) && /99d6597b1fc7767deef62e01d28d8b5dcbd578e151855f7dc0d173cbf5bf0868/.test(STATES.source)
  && STATES.attribution === 'Boundaries: U.S. Census Bureau', 'us-states: source, SHA-256 and credit');
let rings = 0, openRings = 0, shortRings = 0;
feats.forEach(f => f.geometry.coordinates.forEach(p => p.forEach(r => {
  rings++; const a = r[0], b = r[r.length - 1];
  if (a[0] !== b[0] || a[1] !== b[1]) openRings++;
  if (r.length < 4) shortRings++;
})));
check(openRings === 0 && shortRings === 0, 'us-states: every ring closed with at least 4 points', { rings, openRings, shortRings });
const size = fs.statSync(path.join(SITE, 'geo', 'us-states.js')).size;
check(size < 1024 * 1024, 'us-states: under the 1 MB budget', size);
// Point in a multipolygon (even-odd over all rings).
function inside(pt, mp) {
  let c = false;
  mp.forEach(p => p.forEach(r => {
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [xi, yi] = r[i], [xj, yj] = r[j];
      if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi) c = !c;
    }
  }));
  return c;
}
const ctrRows = CENTERS.centers;
check(ctrRows.length === 51 && new Set(ctrRows.map(c => c.state)).size === 51, 'state-centers: 51 unique codes');
check(/c00bad8aebd88a3bf8a1a6a43d06bbf8d2fdf956c2babe1da4dd201bcebd568a/.test(CENTERS.source) && /approximate/.test(CENTERS.note),
  'state-centers: source SHA-256 and the approximation note');
check(JSON.stringify(ctrRows.map(c => c.state).filter(c => c !== 'AK' && c !== 'HI').sort()) === JSON.stringify(codes.slice().sort()),
  'state-centers: the outline codes plus AK and HI');
const outside = ctrRows.filter(c => c.state !== 'AK' && c.state !== 'HI')
  .filter(c => !inside([c.lon, c.lat], feats[codes.indexOf(c.state)].geometry.coordinates)).map(c => c.state);
check(outside.length === 0, 'state-centers: every center inside its own drawn outline', outside);
check(ctrRows.every(c => Number.isFinite(c.lat) && Number.isFinite(c.lon) && Math.round(c.lat * 100) / 100 === c.lat && Math.round(c.lon * 100) / 100 === c.lon),
  'state-centers: two decimals, as CVI\'s file');
// Shared borders: each segment (undirected) belongs to at most two outlines, never twice to one; the land neighbors of a
// few states share segments with them (one border, no sliver).
const segOwners = new Map();
feats.forEach(f => f.geometry.coordinates.forEach(p => p.forEach(r => {
  for (let i = 1; i < r.length; i++) {
    const a = r[i - 1].join(','), b = r[i].join(','), k = a < b ? a + '|' + b : b + '|' + a;
    if (!segOwners.has(k)) segOwners.set(k, []);
    segOwners.get(k).push(f.properties.code);
  }
})));
let tooMany = 0, selfTwice = 0, shared = 0;
const pairs = new Set();
for (const o of segOwners.values()) {
  if (o.length > 2) tooMany++;
  else if (o.length === 2) { if (o[0] === o[1]) selfTwice++; else { shared++; pairs.add(o.slice().sort().join('-')); } }
}
check(tooMany === 0 && selfTwice === 0 && shared > 1000, 'us-states: shared borders (each segment in at most two outlines)', { tooMany, selfTwice, shared });
const NEIGHBORS = ['ID-WA', 'OR-WA', 'ID-OR', 'CA-OR', 'CA-NV', 'MD-VA', 'DC-MD', 'DC-VA', 'OK-TX', 'ME-NH', 'MN-WI', 'CO-UT', 'AZ-NM'];
NEIGHBORS.forEach(p => check(pairs.has(p), 'us-states: ' + p + ' share one border'));
// The labels CVI shows: every center but AK and HI, in file order.
const lab = F.stateLabels(CENTERS);
check(lab.length === 49 && lab.every((l, i) => l.abbr === ctrRows.filter(c => c.state !== 'AK' && c.state !== 'HI')[i].state), 'stateLabels: 49, file order, no AK or HI');
// Label priority where labels collide: the larger state first. Areas from the bundled
// outlines; Census 2023 total areas (land and water, km2) for scale: TX 695,662, CA 423,970, MT 380,831, DC 177.
const areas = F.stateAreas(STATES), byArea = [...areas].sort((x, y) => y[1] - x[1]).map(x => x[0]);
check(areas.size === 49 && lab.every(l => areas.get(l.abbr) > 0), 'stateAreas: an area for each of the 49 labeled outlines', areas.size);
check(JSON.stringify(byArea.slice(0, 3)) === '["TX","CA","MT"]' && byArea[48] === 'DC', 'stateAreas: TX, CA, MT largest, DC smallest', [byArea.slice(0, 3), byArea[48]]);
check([['MD', 'DC'], ['MA', 'RI'], ['NJ', 'DE'], ['NY', 'CT'], ['VT', 'NH']].every(([a, b]) => areas.get(a) > areas.get(b)), 'stateAreas: MD > DC, MA > RI, NJ > DE, NY > CT, VT > NH (24,906 and 24,214 km2 in Census)');
check(Math.abs(areas.get('TX') / 695662 - 1) < 0.03 && Math.abs(areas.get('DC') / 177 - 1) < 0.05, 'stateAreas: TX and DC within a few percent of Census\'s areas', [areas.get('TX'), areas.get('DC')]);

// S1.1: the page's color for CVI's color c of species group g in palette pal (with Combine species the palette's first
// color, Cattle's): the guide's value where palettes.js records CVI's, otherwise CVI's own.
let s11Colors = 0;
function s11Color(pal, g, c, combine) {
  const rec = W.palettes.CVI_VALUES.find(r => r[0] === 'species' && r[1] === pal && r[3] === c && (r[2] === g || (combine && r[2] === 'Cattle')));
  if (!rec) return c;
  s11Colors++;
  return W.palettes.SPECIES_PALETTES[pal][rec[2]];
}
// ── Palettes ─────────────────────────────────────────────────────────────────────────────────────────────────────
const arcsFile = path.join(ORACLE, 'oracle_s4_arcs.json');
if (!fs.existsSync(arcsFile)) { console.error('No S4 oracle output in ' + ORACLE + ': run Rscript tests/oracle/cvi_r_oracle.R first.'); process.exit(2); }
const ARCS = JSON.parse(fs.readFileSync(arcsFile, 'utf8'));
check(Array.isArray(ARCS.palettes) && ARCS.palettes.length === 8, 'oracle: CVI\'s eight species palettes recorded');
if (ARCS.palettes) {
  const want = ARCS.palettes, got = W.palettes.SPECIES_PALETTES;
  check(JSON.stringify(Object.keys(got)) === JSON.stringify(want.map(p => p.name)), 'palettes: names and order as CVI', Object.keys(got));
  want.forEach(p => check(JSON.stringify(Object.entries(got[p.name] || {})) === JSON.stringify(p.colors.map(c => [c.species, s11Color(p.name, c.species, c.color, false)])),
    'palette ' + p.name + ': species and hex values as CVI (S1.1: the guide\'s where listed)'));
}

// ── Arcs ─────────────────────────────────────────────────────────────────────────────────────────────────────────
let maxDev = 0, vertices = 0;
function sameArc(got, want, name) {
  const ok = got.length === want.length && got.every((p, i) => {
    const dx = Math.abs(p[0] - want[i][0]), dy = Math.abs(p[1] - want[i][1]);
    if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) return eqNum(p[0], want[i][0]) && eqNum(p[1], want[i][1]);
    maxDev = Math.max(maxDev, dx, dy); vertices++;
    return dx <= 1e-9 && dy <= 1e-9;
  });
  check(ok, name, { n: got.length, want: want.length });
}
ARCS.centers.forEach(c => {
  const ctr = ctrRows.find(r => r.state === c.state);
  sameArc(F.gcIntermediate(F.WA_ANCHOR, [ctr.lon, ctr.lat], 200, true), c.coords, 'arc to ' + c.state + ' (gcIntermediate, 202 points)');
  sameArc(F.arc(ctr.lon, ctr.lat), c.coords, 'arc to ' + c.state + ' (arc)');
});
ARCS.probes.forEach((p, i) => {
  let got = null, err = null;
  try { got = F.gcIntermediate(p.from, p.to, 200, true); } catch (e) { err = e.message; }
  if (p.error) check(err !== null, 'arc probe ' + i + ': stops where geosphere stops (' + p.error + ')', err);
  else { check(err === null, 'arc probe ' + i + ': no error', err); if (got) sameArc(got, p.coords, 'arc probe ' + i + ' ' + JSON.stringify([p.from, p.to])); }
});

// ── Views ────────────────────────────────────────────────────────────────────────────────────────────────────────
const ctr = F.centers(CENTERS);
const fOf = inp => ({ direction: inp.flow_direction, species: arr(inp.flow_species), speciesSub: arr(inp.flow_species_sub),
  years: arr(inp.flow_year).map(Number), quarters: arr(inp.flow_quarter), combine: !!inp.flow_combine_species,
  scaling: inp.flow_scaling, nBins: Number(inp.flow_n_bins), opacity: inp.flow_opacity, multiplier: inp.flow_width_mult,
  palette: inp.flow_palette, labels: !!inp.show_state_labels, lines: !!inp.flow_show_state_lines });
const stats = { files: 0, views: 0, lines: 0, drawn: 0, legendDev: 0, cviGrayed: 0, frames: 0, numcvi: 0, states0: 0 };

let fileArcs = new Map();   // CVI's arc for each state in the current oracle file
function compareLines(got, want, id) {
  const w = arr(want);
  check((got === null) === (want === null || !w.length), id + ': lines drawn or not', [got && got.length, w.length]);
  if (!got || !w.length) return;
  check(got.length === w.length, id + ': line count', [got.length, w.length]);
  got.forEach((a, i) => {
    const e = w[i] || {};
    check(a.state === e.state && a.species_group === e.species_group && eqNum(a.total_animals, e.total_animals)
      && near(a.line_width_px, e.line_width_px, 1e-12) && a.species_breakdown === e.species_breakdown
      && a.dest_lat === e.dest_lat && a.dest_lon === e.dest_lon, id + ': line ' + i, { got: [a.state, a.species_group, a.total_animals, a.line_width_px, a.species_breakdown], want: e });
    check(e.arc_same === true, id + ': CVI drew the same arc for ' + e.state + ' in every view');
    const ca = fileArcs.get(a.state);
    check(ca && a.coords.length === ca.length && a.coords.every((p, k) => Math.abs(p[0] - ca[k][0]) <= 1e-9 && Math.abs(p[1] - ca[k][1]) <= 1e-9),
      id + ': line ' + i + ' arc (from Washington\'s anchor) as CVI\'s', a.coords[0]);
  });
  stats.lines += got.length;
}
// CVI reads an all-numeric CVI column as numbers ("00123", "123" and "123.0" are one certificate there, three on the page;
// real CVI numbers always mix letters and digits). Documented in tests/synthetic/README.md; allowed only in
// cvi_master_s2_numcvi, and CVI's count must then be the number of distinct numeric values.
const numericCvis = sub => new Set(sub.map(r => r.CVI).filter(v => v !== null && v !== undefined && String(v).trim() !== '').map(v => Number(v))).size;
function compareBoxes(loaded, f, wvb, id) {
  const got = F.summary(loaded, f, ctr), vb = F.valueBoxes(got);
  check(vb.state === wvb.state, id + ': value box state', [vb.state, wvb.state]);
  if (vb.state === 'alert' && wvb.state === 'alert') check(JSON.stringify(vb.lines) === JSON.stringify(arr(wvb.lines)), id + ': alert text');
  if (vb.state === 'metrics' && wvb.state === 'metrics') {
    const wm = arr(wvb.metrics);
    check(vb.metrics.length === wm.length, id + ': four boxes');
    const noCvi = loaded.header.indexOf('CVI') < 0;
    check(!!vb.metrics[1].disabled === noCvi, id + ': Unique CVIs grayed exactly when the table has no CVI column', [vb.metrics[1].disabled, noCvi]);
    if (vb.metrics[2].text === '0' && wm[2] && wm[2].text === '0') stats.states0++;
    vb.metrics.forEach((m, i) => {
      const e = wm[i] || {};
      const numcvi = i === 1 && /^cvi_master_s2_numcvi /.test(id) && m.text !== e.text;
      if (numcvi) stats.numcvi++;
      const ok = m.disabled ? e.text === '0' : numcvi ? e.text === String(numericCvis(F.mapRows(loaded, f))) : m.text === e.text;
      if (m.disabled) stats.cviGrayed++;
      check(ok && m.label === e.label && m.icon === e.icon && m.accent.toLowerCase() === String(e.accent).toLowerCase()
        && (m.disabled || m.zero === e.zero), id + ': box ' + i, { got: [m.label, m.text, m.icon, m.accent, m.zero], want: e });
    });
  }
}
function compareStrip(f, ls, wst, id) {
  const st = F.strip(f, ls);
  check(st.state === wst.state, id + ': strip state', [st.state, wst.state]);
  if (st.state === 'summary' && wst.state === 'summary') {
    const wi = arr(wst.items);
    check(st.items.length === wi.length && st.items.every((it, i) => it.label === wi[i].label && it.text === wi[i].text), id + ': strip', { got: st.items, want: wi });
  } else if (st.state === 'message' && wst.state === 'message') check(JSON.stringify(st.lines) === JSON.stringify(arr(wst.lines)), id + ': strip message', wst.lines);
}
function compareLegend(ls, f, wl, id) {
  const lg = F.legend(ls, f);
  if (wl.state === 'message') { check(lg === null && JSON.stringify(arr(wl.lines)) === '["No data loaded"]', id + ': legend "No data loaded"', wl.lines); return; }
  check(lg !== null, id + ': legend shown');
  if (!lg) return;
  const ws = arr(wl.species), ww = arr(wl.widths);
  check(lg.species.length === ws.length, id + ': legend species count', [lg.species.length, ws.length]);
  lg.species.forEach((s, i) => {
    const e = ws[i] || {};
    // Deliberate difference (answer 7.3): with Combine species CVI's swatch is gray, the page's the lines' color.
    const colorOk = f.combine ? (e.color === '#999999' && s.color === F.singleColor(f.palette)) : s.color === s11Color(f.palette, s.label, e.color, false);
    if (f.combine) stats.legendDev++;
    check(s.label === e.label && colorOk, id + ': legend species ' + i, { got: s, want: e });
  });
  check(lg.widths.length === ww.length && lg.widths.every((x, i) => x.px === ww[i].px && x.label === ww[i].label)
    && lg.widthHeader === wl.line_width_header, id + ': legend widths and "Line width" heading', { got: lg.widths, want: ww });
}
function compareLayers(ls, f, layers, id) {
  const L = arr(layers), ids = L.map(l => l.id);
  const d = F.draw(ls, f);
  const want = ['state-lines'].concat(d ? ['flow_lines'] : [], f.labels ? ['state-labels'] : []);
  check(JSON.stringify(ids) === JSON.stringify(want), id + ': layers in order', { got: ids, want });
  const sl = L.find(l => l.id === 'state-lines');
  if (sl) check(sl.paint['line-color'] === F.STATE_LINES.color && sl.paint['line-width'] === F.STATE_LINES.width
    && sl.paint['line-opacity'] === F.STATE_LINES.opacity && sl.layout.visibility === (f.lines ? 'visible' : 'none'), id + ': state lines style and visibility');
  const lb = L.find(l => l.id === 'state-labels');
  if (lb) {
    const ex = F.stateLabels(CENTERS), fs_ = arr(lb.features);
    check(lb.layout['text-size'] === F.STATE_LABELS.size && lb.paint['text-color'] === F.STATE_LABELS.color
      && lb.paint['text-halo-color'] === F.STATE_LABELS.halo && lb.paint['text-halo-width'] === F.STATE_LABELS.haloWidth, id + ': state label style');
    check(fs_.length === ex.length && fs_.every((x, i) => x.abbr === ex[i].abbr && x.lon === ex[i].lon && x.lat === ex[i].lat), id + ': state labels at the centers, no AK or HI');
  }
  const fl = L.find(l => l.id === 'flow_lines');
  if (fl && d) {
    stats.drawn++;
    check(near(d.opacity, fl.paint['line-opacity'], 1e-15) && near(d.hoverOpacity, fl.hover_options.line_opacity, 1e-15)
      && fl.layout['line-cap'] === 'round' && fl.layout['line-join'] === 'round' && fl.tooltip === 'tooltip_text', id + ': line layer opacity, hover, caps');
    const wf = arr(fl.features);
    check(d.lines.length === wf.length, id + ': drawn line count', [d.lines.length, wf.length]);
    d.lines.forEach((a, i) => {
      const e = wf[i] || {};
      check(a.state === e.state && a.species_group === e.species_group && a.color === s11Color(f.palette, e.species_group, e.color, f.combine) && near(a.width, e.line_width_px, 1e-12)
        && a.tooltip === e.tooltip_text && e.n_vertices === a.coords.length, id + ': drawn line ' + i,
        { got: [a.state, a.species_group, a.color, a.width, a.tooltip, a.coords.length], want: e });
    });
  }
}

const files = fs.readdirSync(ORACLE).filter(f => /^oracle_s4_.*\.json$/.test(f) && f !== 'oracle_s4_arcs.json').sort();
check(files.length >= 8, 'oracle: S1, S2, S4 fixtures and three tiers present', files);
for (const file of files) {
  const o = JSON.parse(fs.readFileSync(path.join(ORACLE, file), 'utf8'));
  const name = o.meta.name, text = fs.readFileSync(path.join(ROOT, o.meta.fixture), 'utf8');
  const loaded = W.master.load(text);
  check(loaded.ok, name + ': loads');
  // cvi_master_s4_noflow: the oracle's variant without rows that have exactly one end "WA" (both states present), made the
  // same way after loading; the pickers' choices follow the rows left, as CVI's do.
  if (o.meta.variant_noflow) {
    loaded.rows = loaded.rows.filter(r => !(r['Origin.State'] !== null && r['Dest.State'] !== null && ((r['Origin.State'] === 'WA') !== (r['Dest.State'] === 'WA'))));
    loaded.speciesChoices = [...new Set(loaded.rows.map(r => r['Species.Group']).filter(v => v !== null && v !== ''))].sort(W.master.collate);
    loaded.yearChoices = [...new Set(loaded.rows.map(r => r['Reporting.Year']).filter(v => v !== null))].sort((a, b) => a - b);
    // With no such rows CVI's quarter list is not empty but the single period "-" (paste0 on zero rows),
    // so CVI does not fall back for the Quarter step (the slider has one position, labeled "-", and changes nothing); for
    // the Year step it falls back to the file's years. The page falls back for both (by design);
    // checked here as exactly that difference.
    check(JSON.stringify(arr(o.domains.quarter)) === '["-"]' && !arr(o.domains.year).length && arr(o.domains.all_quarter).length > 0,
      name + ': CVI\'s Flow quarter list is the single period "-", its year list empty', o.domains);
    stats.noFlowQuirk = true;
  }
  const quirk = !!o.meta.variant_noflow;
  check(o.meta.centers_sha256 === 'c00bad8aebd88a3bf8a1a6a43d06bbf8d2fdf956c2babe1da4dd201bcebd568a', name + ': CVI ran on the bundled centers (written back byte-identical)');
  check(o.active_map === 'flow', name + ': Map View switched CVI to National Flow');
  stats.files++;
  fileArcs = new Map(arr(o.arcs).map(a => [a.state, a.coords]));
  // Opening view and controls.
  check(o.map.center[0] === F.VIEW.center[0] && o.map.center[1] === F.VIEW.center[1] && o.map.zoom === F.VIEW.zoom
    && o.map.projection === F.VIEW.projection, name + ': opening view and projection (globe)', o.map);
  check(o.map.navigation_control.position === 'top-left' && o.map.screenshot_control.position === 'top-right', name + ': navigation top left, screenshot top right');
  // Domains and the slider on load.
  const dom = F.domains(loaded);
  const wq = arr(o.domains.quarter).length && !quirk ? arr(o.domains.quarter) : arr(o.domains.all_quarter);
  const wy = arr(o.domains.year).length ? arr(o.domains.year) : arr(o.domains.all_year);
  check(JSON.stringify(dom.quarter) === JSON.stringify(wq), name + ': Flow quarter domain', { got: dom.quarter, want: wq });
  check(JSON.stringify(dom.year) === JSON.stringify(wy), name + ': Flow year domain', { got: dom.year, want: wy });
  if (o.slider_load && quirk) check(Number(o.slider_load.max) === 1 && Number(o.slider_load.value) === 1, name + ': CVI\'s slider on load: one position ("-")', o.slider_load);
  else if (o.slider_load) check(Number(o.slider_load.max) === Math.max(1, dom.quarter.length) && Number(o.slider_load.value) === W.periods.middle(dom.quarter.length),
    name + ': slider on load (range and middle)', o.slider_load);
  for (const v of o.views) {
    stats.views++;
    const id = name + ' ' + v.scenario + ' ' + v.inputs.flow_direction + (v.inputs.flow_combine_species ? ' combine' : '');
    const f = fOf(v.inputs);
    const ls = F.lines(loaded, f, ctr);
    compareLines(ls, v.lines, id);
    compareLayers(ls, f, v.layers, id);
    compareLegend(ls, f, v.legend, id);
    compareBoxes(loaded, f, v.value_boxes, id);
    compareStrip(f, ls, v.strip, id);
  }
  // Browse: every frame by quarter and by year; CVI's picker values and the page's frame() agree, and so does all else.
  const base = F.resetDefaults(loaded);
  for (const fr of arr(o.browse.frames)) {
    stats.frames++;
    const id = name + ' browse ' + fr.step + ' ' + fr.index;
    if (quirk && fr.step === 'quarter') {   // CVI's "-" period: the pickers stay as they were (every year, all quarters)
      check(fr.label === '-' && JSON.stringify(arr(fr.years)) === JSON.stringify(base.years.map(String)) && JSON.stringify(arr(fr.quarters)) === JSON.stringify(base.quarters),
        id + ': CVI\'s "-" period changes no picker', fr);
      continue;
    }
    const fp = W.periods.frame(dom, fr.step, fr.index);
    check(fp !== null && JSON.stringify(fp.years.map(String)) === JSON.stringify(arr(fr.years)) && JSON.stringify(fp.quarters) === JSON.stringify(arr(fr.quarters)),
      id + ': pickers', { got: fp, want: [fr.years, fr.quarters] });
    check(W.periods.timeLabel(dom, fr.step, fr.index) === fr.label, id + ': period label', [W.periods.timeLabel(dom, fr.step, fr.index), fr.label]);
    if (!fp) continue;
    const f = Object.assign({}, base, { years: fp.years, quarters: fp.quarters });
    const ls = F.lines(loaded, f, ctr), wl = arr(fr.lines);
    check((ls === null) === (wl.length === 0) && (!ls || (ls.length === wl.length && ls.every((a, i) => a.state === wl[i].state
      && a.species_group === wl[i].species_group && eqNum(a.total_animals, wl[i].total_animals) && near(a.line_width_px, wl[i].line_width_px, 1e-12)))),
      id + ': lines', { got: ls && ls.map(a => [a.state, a.total_animals]), want: wl });
    compareStrip(f, ls, fr.strip, id);
    compareBoxes(loaded, f, fr.value_boxes, id);
  }
  // Browse turned on, the switch to years and Browse turned off (CVI's messages applied, then read).
  const en = o.browse.enter, mid = W.periods.middle(dom.quarter.length), fe = W.periods.frame(dom, 'quarter', mid);
  if (quirk) check(en.label === '-' && arr(en.messages).length === 0, name + ': Browse on with CVI\'s "-" period: nothing sent', en);
  else check(en.slider === mid && en.label === W.periods.timeLabel(dom, 'quarter', mid) && fe
    && JSON.stringify(fe.years.map(String)) === JSON.stringify(arr(en.years)) && JSON.stringify(fe.quarters) === JSON.stringify(arr(en.quarters)),
    name + ': Browse on: the middle period in the pickers', { got: fe, want: en });
  const ys = o.browse.year_switch, ny = dom.year.length, midY = W.periods.middle(ny), fy = W.periods.frame(dom, 'year', midY);
  const sl = arr(ys.messages).filter(m => m.id === 'flow_time_slider');
  check(sl.length === 1 && Number(sl[0].msg.value) === midY && Number(sl[0].msg.max) === Math.max(1, ny) && Number(sl[0].msg.min) === 1,
    name + ': switch to years: slider rescaled to the years, middle position', sl);
  check(ys.slider === midY && ys.label === W.periods.timeLabel(dom, 'year', midY) && fy
    && JSON.stringify(fy.years.map(String)) === JSON.stringify(arr(ys.years)) && JSON.stringify(fy.quarters) === JSON.stringify(arr(ys.quarters)),
    name + ': switch to years: the middle year, all quarters', { got: fy, want: ys });
  // Browse off: CVI sends nothing and the pickers keep the last frame shown (the page must do the same; day-2 browser check).
  const lastF = arr(o.browse.frames).slice(-1)[0];
  check(arr(o.browse.leave.messages).length === 0 && lastF && JSON.stringify(arr(o.browse.leave.years)) === JSON.stringify(arr(lastF.years))
    && JSON.stringify(arr(o.browse.leave.quarters)) === JSON.stringify(arr(lastF.quarters)), name + ': Browse off keeps the last frame (CVI)', o.browse.leave);
  // A missing direction counts as Inbound in the boxes (CVI: input$flow_direction %||% "inbound").
  const fNoDir = Object.assign({}, base, { direction: undefined });
  check(JSON.stringify(F.summary(loaded, fNoDir, ctr)) === JSON.stringify(F.summary(loaded, Object.assign({}, base, { direction: 'inbound' }), ctr)),
    name + ': boxes without a direction = Inbound (CVI\'s default)');
  // Reset All: the values CVI sends for the Flow map, against the page's defaults.
  const msg = {}; arr(o.reset).forEach(m => { msg[m.id] = m.msg; });
  const sel = id => (msg[id] ? (msg[id].value !== undefined ? msg[id].value : msg[id].selected) : undefined);
  const want = {
    flow_direction: base.direction, flow_species: base.species, flow_species_sub: base.speciesSub, flow_year: base.years.map(String),
    flow_quarter: base.quarters, flow_width_mult: base.multiplier, flow_scaling: base.scaling, flow_n_bins: String(base.nBins),
    flow_opacity: base.opacity, show_state_labels: base.labels, flow_show_state_lines: base.lines, flow_palette: base.palette,
    flow_combine_species: base.combine };
  for (const [k, val] of Object.entries(want)) {
    const g = sel(k);
    check(g !== undefined && JSON.stringify(arr(g).map(String)) === JSON.stringify(arr(val).map(String)), name + ': Reset All ' + k, { cvi: g, page: val });
  }
  check(msg.flow_time_enabled === undefined && base.browse === false, name + ': Reset All and Browse (CVI sends nothing; the page turns it off)');
}

check(stats.noFlowQuirk === true, 'oracle: the file without cross-border rows (cvi_master_s4_noflow) checked');
check(stats.states0 > 0, 'oracle: views with States 0 (partners without a center only) covered', stats.states0);
console.log('S4 unit: ' + pass + ' passed, ' + fail + ' failed');
console.log('  ' + stats.files + ' oracle files, ' + stats.views + ' views (' + stats.drawn + ' with lines drawn, ' + stats.lines + ' lines), '
  + stats.frames + ' browse frames; arcs: ' + vertices + ' vertices, largest difference ' + maxDev.toExponential(2) + ' degrees');
console.log('  deliberate differences seen: S1.1 guide colors ' + s11Colors + ', legend swatch with Combine species ' + stats.legendDev + ', Unique CVIs grayed ' + stats.cviGrayed
  + ', all-numeric CVI column (cvi_master_s2_numcvi only) ' + stats.numcvi + '; views with States 0: ' + stats.states0);
if (fail) { failures.slice(0, 40).forEach(f => console.log('FAIL ' + f)); if (failures.length > 40) console.log('... and ' + (failures.length - 40) + ' more'); }
process.exit(fail ? 1 : 0);
