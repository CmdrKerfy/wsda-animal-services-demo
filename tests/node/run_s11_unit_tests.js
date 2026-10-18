#!/usr/bin/env node
'use strict';
// S11 unit tests (Premise Lookup): the shared engine
// site/shared/proximity.js and the CVI rules of site/cvi/app/lookup.js against CVI's own run_proximity_query, run on
// the same scenarios by tests/oracle/s11_proximity_oracle.R (local-test-artifacts/s11/oracle_s11.json).
//
//   - every scenario of tests/synthetic/make_s11_fixtures.js, field by field: the status, skipped sites and rows, the
//     sites used with their radii, every matched row (the endpoint flags, matched sites, nearest site and ring), every
//     membership row with its ring, the per-site counts and the summary; without a CVI column, which rows share a
//     record number;
//   - the distances from 300 rows to 60 sites against geosphere's (the function CVI calls);
//   - the page's collapse rule (repeated rows count each time) beside CVI's: equal except where the file repeats a
//     within-state row, and there by exactly the repeated rows (worked out here from the fixture's list);
//   - hand-worked cases computed in this file, independent of both: the distance by another formula, a point exactly
//     on the radius and one meter outside, the antimeridian and a pole, out-of-range points, the radius lists, the
//     ring choice, the sites' buffers, zones with holes and two parts, R's rounding, and a small table for the
//     endpoint rule, the rows CVI cannot check, the counts and both collapse rules;
//   - the branded proximity PNG (brandedmaps.proximity) against CVI's own page (render_branded_proximity_map
//     through its module, oracle_s11_png.json), case by case: the run's sites, counts and summary, the title, rows and
//     boxes, every text of the QUERY SITES panel with its size and place, the MAP KEY (CVI's rows, one row per radius
//     where CVI's colors would not match the rings, the facility rows with their counts inside, CVI's places in CVI's
//     style), the map's box, rings, matched points, sites and names, the facilities inside (worked out here), the inset
//     and the scale bar; the recorded differences (the page's ring colors, names beside the markers, the source line);
//     hand cases for the triangle's area, zones, a facilities-only page, the population layers and export_params.json;
//   - "Find coordinates" against CVI's module (geocode_find, its network steps stubbed by the reference):
//     the coordinates and text on a hit, the empty box, the page's offline wording where CVI would have gone online,
//     the cache files the page refuses, and hand cases for the address rule;
//   - a check for each limit and fix that the unit suite can see (very large outlines, facilities and names, oversized
//     zone files, formula-like CSV text, address file encodings, repeated facilities, bidirectional controls), the name
//     placer against a plain search written out here;
//   - the tab's own steps against CVI's module (mod_premise_lookup.R, run by the reference through
//     shiny::testServer): the pasted rows, the uploaded files, the sites added one by one, the cell edits, the band
//     radii check, and Run query from the tab's inputs to its notifications and result (the page's prepareRun, query
//     and afterRun in turn), with the page's two recorded differences checked as such (an empty default buffer; repeated
//     rows counted each time); and hand cases for the tiles, the matched-CVI table, what the match map draws and the
//     buffer rings (each vertex on the matching edge, by the engine's own distance).
//
// Usage (repository root): node tests/synthetic/make_s11_fixtures.js, Rscript tests/oracle/s11_proximity_oracle.R
// (as a background job), then node tests/node/run_s11_unit_tests.js (Node >= 22, no packages)

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');
const ORACLE = path.join(ROOT, 'local-test-artifacts', 's11', 'oracle_s11.json');
const FIXTURES = path.join(ROOT, 'local-test-artifacts', 's11', 'fixtures', 'scenarios.json');
for (const f of [FIXTURES, ORACLE]) {
  if (!fs.existsSync(f)) {
    console.log('Missing ' + path.relative(ROOT, f) + ': run node tests/synthetic/make_s11_fixtures.js and Rscript ' +
      'tests/oracle/s11_proximity_oracle.R first.');
    process.exit(1);
  }
}
const REF = JSON.parse(fs.readFileSync(ORACLE, 'utf8'));
const FX = JSON.parse(fs.readFileSync(FIXTURES, 'utf8'));
const FIXTURES_SHA = require('crypto').createHash('sha256').update(fs.readFileSync(FIXTURES)).digest('hex');

// The page's modules in their own context.
const ctx = { window: {}, console, TextEncoder, TextDecoder, Blob, DecompressionStream };
ctx.window.window = ctx.window;
vm.createContext(ctx);
// Also the zone reader (with zip.js), the population files and place lookup, the county outlines and
// facilities.js (the Washington test), and exports.js (the CSV writers), and the branded page (brand.js,
// branded.js, tiles.js, labels.js, brandedmaps.js) and the Streets data.
for (const f of ['cvi/app/csv.js', 'cvi/app/master.js', 'cvi/app/scaling.js', 'cvi/app/summary.js',
  'shared/proximity.js', 'cvi/app/lookup.js', 'cvi/app/exports.js', 'shared/zip.js', 'shared/zones.js',
  'geo/citylimits-wa.js', 'geo/places-wa.js', 'shared/population.js', 'geo/wa-counties.js', 'shared/facilities.js',
  'cvi/app/palettes.js', 'shared/brand.js', 'shared/branded.js', 'shared/tiles.js', 'shared/labels.js', 'cvi/app/brandedmaps.js',
  'geo/streets-wa.js']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'site', f), 'utf8'), ctx, { filename: f });
}
const PX = ctx.window.WSDA.proximity;
const ZONES = ctx.window.WSDA.zones;
const W = ctx.window.CVIWA;

let pass = 0, fail = 0;
const failures = [];
function check(ok, name, detail) {
  if (ok) pass++;
  else {
    fail++;
    failures.push(name + (detail === undefined ? '' : ' :: ' + JSON.stringify(detail).slice(0, 400)));
  }
}
const list = x => (x === null || x === undefined ? [] : Array.isArray(x) ? x : [x]);
const same = (a, b) => (a === null || a === undefined ? b === null || b === undefined : a === b);
const near = (a, b, tol) => (a === null || b === null ? a === b : Math.abs(a - b) <= tol);

check(REF.fixtures_sha === FIXTURES_SHA, 'Reference: made from these fixtures (SHA-256 of scenarios.json)',
  [REF.fixtures_sha, FIXTURES_SHA]);

// ── The scenarios against CVI's engine ─────────────────────────────────────────────────────────────────────────
const masters = new Map();
function masterOf(rel) {
  if (!masters.has(rel)) masters.set(rel, W.master.load(fs.readFileSync(path.join(ROOT, rel), 'utf8')));
  return masters.get(rel);
}
// The sites as the Premise Lookup tab passes them: in Single mode without the per-site band lists.
function run(sc, collapse) {
  const sites = sc.sites.map(s => {
    const c = Object.assign({}, s);
    if (sc.mode !== 'bands') delete c.bands_csv;
    return c;
  });
  return W.lookup.query(masterOf(sc.master), sites, { defaultKm: sc.default_buffer_km, endpoint: sc.endpoint,
    filters: sc.filters, bands: sc.mode === 'bands' ? sc.bands : null, collapse });
}
// Without a CVI column the record numbers may differ from CVI's; the same rows must share one (a one-to-one map).
function oneToOne(pairs) {
  const ab = new Map(), ba = new Map();
  return pairs.every(([a, b]) => {
    if (ab.has(a) && ab.get(a) !== b) return false;
    if (ba.has(b) && ba.get(b) !== a) return false;
    ab.set(a, b);
    ba.set(b, a);
    return true;
  });
}
const tally = { scenarios: 0, matched: 0, membership: 0, sites: 0 };
const results = {};
for (const sc of FX.scenarios) {
  const ref = REF.scenarios.find(r => r.name === sc.name);
  const t = 'Scenario ' + sc.name + ': ';
  if (!ref) {
    check(false, t + 'in the reference');
    continue;
  }
  const r = run(sc, 'cvi');
  results[sc.name] = r;
  tally.scenarios++;
  check(r.status === ref.status, t + 'status', [r.status, ref.status]);
  check(r.hasCvi === ref.has_cvi, t + 'CVI column present', [r.hasCvi, ref.has_cvi]);
  check(r.skippedSites === ref.n_skipped_sites, t + 'sites skipped', [r.skippedSites, ref.n_skipped_sites]);
  if (ref.n_skipped_coords !== null && ref.n_skipped_coords !== undefined) {
    check(r.skippedCoords === ref.n_skipped_coords, t + 'CVIs that cannot be checked', [r.skippedCoords,
      ref.n_skipped_coords]);
  }
  if (ref.missing_cols) {
    check(JSON.stringify(r.missingCols) === JSON.stringify(list(ref.missing_cols)), t + 'missing columns',
      r.missingCols);
  }
  if (ref.bands_mode !== null && ref.bands_mode !== undefined) {
    check(r.bandsMode === ref.bands_mode, t + 'band mode', [r.bandsMode, ref.bands_mode]);
  }
  if (ref.sites_used) {
    const s = r.sites || [];
    const ok = s.length === ref.sites_used.length && ref.sites_used.every((u, k) => s[k].id === u.site_id &&
      s[k].name === u.name && s[k].lat === u.lat && s[k].lon === u.long && s[k].bufferKm === u.buffer_km &&
      same(s[k].bufferUser, u.buffer_km_user) &&
      (!u.bands || JSON.stringify(s[k].radii) === JSON.stringify(list(u.bands))));
    check(ok, t + 'sites used, their buffers and rings', s.map(x => [x.id, x.bufferKm, x.bufferUser, x.radii]));
    tally.sites += s.length;
  }
  if (!ref.matched) continue;

  // Matched rows, in order.
  const m = r.matched || [];
  check(m.length === ref.matched.length, t + 'matched rows', [m.length, ref.matched.length]);
  const n = Math.min(m.length, ref.matched.length);
  let bad = null;
  for (let i = 0; i < n && !bad; i++) {
    const a = m[i], b = ref.matched[i];
    const fields = ['Movement', 'Species.Group', 'Reporting.Year', 'Reporting.Quarter'];
    const coordsOk = ['Origin.Lat', 'Origin.Long', 'Dest.Lat', 'Dest.Long'].every(c => same(PX.number(a[c]), b[c]));
    const ok = fields.every(c => a[c] === b[c]) && same(a['Total.Animals'], b['Total.Animals']) && coordsOk &&
      (!r.hasCvi || a.CVI === b.CVI) && a.hitOrigin === b.hit_origin && a.hitDest === b.hit_dest &&
      a.matchedSites === b.matched_sites && same(a.nearestSiteKm, b.nearest_site_km) &&
      same(a.nearestBandKm, b.nearest_band_km);
    if (!ok) bad = { row: i, page: [a.CVI, a.Movement, a.hitOrigin, a.hitDest, a.matchedSites, a.nearestSiteKm,
      a.nearestBandKm], cvi: [b.CVI, b.Movement, b.hit_origin, b.hit_dest, b.matched_sites, b.nearest_site_km,
      b.nearest_band_km] };
  }
  check(!bad && n === ref.matched.length, t + 'every matched row: fields, endpoints, sites, nearest site and ring',
    bad);
  if (!r.hasCvi) {
    check(oneToOne(m.slice(0, n).map((a, i) => [a.CVI, ref.matched[i].CVI])), t + 'rows sharing a record number');
  }
  tally.matched += n;

  // Membership, in CVI's order.
  const mb = r.membership || [];
  check(mb.length === ref.membership.length, t + 'membership rows', [mb.length, ref.membership.length]);
  const k = Math.min(mb.length, ref.membership.length);
  let badM = null;
  for (let j = 0; j < k && !badM; j++) {
    const a = mb[j], b = ref.membership[j];
    if (a.row + 1 !== b.row_id || a.site !== b.site_id || a.hitOrigin !== b.hit_origin || a.hitDest !== b.hit_dest ||
      a.bandKm !== b.band_km || (r.hasCvi && a.cvi !== b.CVI)) badM = { j, page: a, cvi: b };
  }
  check(!badM && k === ref.membership.length, t + 'every membership row with its ring', badM);
  if (!r.hasCvi) check(oneToOne(mb.slice(0, k).map((a, j) => [a.cvi, ref.membership[j].CVI])), t + 'membership ids');
  tally.membership += k;

  // Counts and summary.
  for (const [mine, theirs] of [['siteCvis', 'site_cvi_counts'], ['siteOrigins', 'site_origin_counts'],
    ['siteDests', 'site_dest_counts']]) {
    check(JSON.stringify(r[mine]) === JSON.stringify(list(ref[theirs])), t + theirs, [r[mine], ref[theirs]]);
  }
  const s = ref.summary;
  check(r.summary.cvis === s.n_cvis && r.summary.animals === s.n_animals && r.summary.origins === s.n_origins &&
    r.summary.dests === s.n_dests && r.summary.sitesHit === s.n_sites_hit, t + 'summary', [r.summary, s]);
}
check(tally.scenarios === FX.scenarios.length && tally.matched > 3000 && tally.membership > 4000,
  'Scenarios: all compared, with thousands of rows', tally);
// The scenarios reach every status and both buffer styles, so none of the comparisons above is idle.
const statuses = new Set(Object.values(results).map(r => r.status));
check(['ok', 'no_match', 'empty_sites', 'no_filter_match', 'missing_coord_cols'].every(x => statuses.has(x)),
  'Scenarios: every status reached', [...statuses]);

// ── Distances against geosphere's ──────────────────────────────────────────────────────────────────────────────
{
  const d = REF.distances;
  const sc = FX.scenarios.find(x => x.name === d.scenario);
  const rows = masterOf(sc.master).rows.slice(0, d.rows);
  let compared = 0, worst = 0, nulls = 0, mismatch = null;
  for (const side of ['origin', 'dest']) {
    const tag = side === 'origin' ? 'Origin' : 'Dest';
    rows.forEach((row, i) => sc.sites.forEach((s, k) => {
      const mine = PX.distanceKm(PX.number(row[tag + '.Lat']), PX.number(row[tag + '.Long']), s.lat, s.long);
      const theirs = d[side][i][k];
      if (mine === null || theirs === null) {
        if (mine !== theirs && !mismatch) mismatch = [side, i, k, mine, theirs];
        nulls++;
        return;
      }
      worst = Math.max(worst, Math.abs(mine - theirs));
      compared++;
    }));
  }
  check(!mismatch, 'Distances: missing exactly where geosphere\'s are', mismatch);
  check(compared === 2 * d.rows * sc.sites.length - nulls && compared > 30000 && worst <= 1e-6,
    'Distances: within 1 mm of geosphere\'s for every pair', { compared, worst });
  tally.distances = compared;
  tally.worstKm = worst;
}

// ── The page's collapse rule beside CVI's ──────────────────────────────────────────────────────────────────────────
{
  let sameEverywhere = true, checkedScenarios = 0;
  for (const sc of FX.scenarios) {
    if (sc.name === 'dup_rows') continue;
    const a = results[sc.name], b = run(sc, 'loader');
    checkedScenarios++;
    if (a.status !== b.status || (a.summary && (a.summary.animals !== b.summary.animals ||
      a.matched.length !== b.matched.length))) sameEverywhere = false;
  }
  check(sameEverywhere && checkedScenarios === FX.scenarios.length - 1,
    'Collapse: the page\'s rule equals CVI\'s where no within-state row is repeated', checkedScenarios);
  // dup_rows: the rows the fixture repeated that are within Washington and matched count once more each.
  const sc = FX.scenarios.find(x => x.name === 'dup_rows');
  const cvi = results.dup_rows, page = run(sc, 'loader');
  const full = W.master.load(fs.readFileSync(path.join(ROOT, FX.full), 'utf8'));
  const SRC = W.master.SOURCE_ROW;
  const repeatedIntra = FX.repeatedRows.map(n => full.rows.find(r => r[SRC] === n - 1 && r.Movement === 'Inbound' &&
    r['Origin.State'] === 'WA' && r['Dest.State'] === 'WA')).filter(Boolean);
  const matchedKeys = new Set(cvi.matched.map(r => r.CVI));
  const extra = repeatedIntra.filter(r => matchedKeys.has(r.CVI));
  const extraAnimals = extra.reduce((t, r) => t + r['Total.Animals'], 0);
  check(extra.length > 0 && page.matched.length - cvi.matched.length === extra.length &&
    page.summary.animals - cvi.summary.animals === extraAnimals,
  'Collapse: with repeated within-state rows, the page\'s rule keeps each repeat once more',
  { repeats: extra.length, rows: [page.matched.length, cvi.matched.length], animals: [page.summary.animals,
    cvi.summary.animals, extraAnimals] });
  check(JSON.stringify(page.membership) === JSON.stringify(cvi.membership) && page.summary.cvis === cvi.summary.cvis,
    'Collapse: membership and distinct counts do not depend on the rule');
}

// ── Hand-worked cases, independent of the engine ───────────────────────────────────────────────────────────────
const R_KM = 6378.137;
const rad = d => d * Math.PI / 180;
// The great-circle distance from unit vectors (the chord, then its angle): another formula than the haversine.
function chordKm(lat1, lon1, lat2, lon2) {
  const v = (la, lo) => [Math.cos(rad(la)) * Math.cos(rad(lo)), Math.cos(rad(la)) * Math.sin(rad(lo)),
    Math.sin(rad(la))];
  const a = v(lat1, lon1), b = v(lat2, lon2);
  const c = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  return 2 * Math.asin(c / 2) * R_KM;
}
{
  // 2,000 pairs across Washington and beyond, from a fixed sequence.
  let seed = 7, worstRel = 0;
  const next = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 2000; i++) {
    const p = [44 + next() * 6, -126 + next() * 10, 44 + next() * 6, -126 + next() * 10];
    const a = PX.distanceKm(...p), b = chordKm(...p);
    worstRel = Math.max(worstRel, Math.abs(a - b) / Math.max(b, 1e-9));
  }
  check(worstRel < 1e-9, 'Hand: the haversine agrees with the chord formula on 2,000 pairs', worstRel);
  check(Math.abs(PX.distanceKm(46, -120, 47, -120) - R_KM * Math.PI / 180) < 1e-9,
    'Hand: one degree of latitude is 6,378.137 x pi / 180 km');
  check(near(PX.distanceKm(0, 179.99, 0, -179.99), 0.02 * R_KM * Math.PI / 180, 1e-9),
    'Hand: across the antimeridian the short way (2.23 km)', PX.distanceKm(0, 179.99, 0, -179.99));
  check(near(PX.distanceKm(90, 0, 89.99, 123), 0.01 * R_KM * Math.PI / 180, 1e-9),
    'Hand: at the pole the longitude does not matter', PX.distanceKm(90, 0, 89.99, 123));
  check(PX.distanceKm(90, 180, -90, -180) !== null && PX.distanceKm(90.0001, 0, 0, 0) === null &&
    PX.distanceKm(0, -180.5, 0, 0) === null && PX.distanceKm(null, 0, 0, 0) === null,
  'Hand: latitude -90 to 90 and longitude -180 to 180 usable, anything else not');
  check(PX.distanceKm(47, -122, 47, -122) === 0, 'Hand: a point on the site is 0 km away');
}
{
  // On the radius and one meter outside: a point due north of the site.
  const site = PX.prepareSites([{ name: 'S', lat: 47, long: -120, buffer_km: 5 }], { defaultKm: 3 }).sites;
  const north = km => [47 + km / R_KM * 180 / Math.PI, -120];
  const at = north(5), out = north(5.001);
  const onKm = PX.distanceKm(at[0], at[1], 47, -120);
  const exact = PX.prepareSites([{ name: 'S', lat: 47, long: -120, buffer_km: onKm }], { defaultKm: 3 }).sites;
  check(PX.match([{ lat: at[0], lon: at[1] }], exact)[0].length === 1, 'Hand: a point exactly on the radius matches',
    onKm);
  check(PX.match([{ lat: out[0], lon: out[1] }], site)[0].length === 0 && near(PX.distanceKm(out[0], out[1], 47, -120),
    5.001, 1e-9), 'Hand: one meter outside does not');
  check(PX.match([{ lat: north(4.999)[0], lon: -120 }], site)[0].length === 1, 'Hand: one meter inside does');
  const hits = PX.match([{ lat: 47, lon: -120 }, null, { lat: 95, lon: -120 }, { lat: '47.01', lon: ' -120 ' }],
    PX.prepareSites([{ name: 'a', lat: 47.5, long: -120, buffer_km: 100 }, { name: 'b', lat: 47, long: -120 }],
      { defaultKm: 3 }).sites);
  check(JSON.stringify(hits.map(h => h.map(x => x.site))) === '[[0,1],[],[],[0,1]]',
    'Hand: hits in site order; a missing or out-of-range point none; text read as a number', hits);
}
{
  const r = PX.parseRadii;
  const cases = [['5, 10, 20', [5, 10, 20]], ['20;5 10 5', [5, 10, 20]], ['x, -3', null], [[3, 10, 20], [3, 10, 20]],
    ['', null], ['1e1', [10]], [null, null], ['0, 2', [2]], [' 4 ,, 2 ', [2, 4]], [[null], null], ['Inf, 3', [3]]];
  const bad = cases.filter(([x, want]) => JSON.stringify(r(x)) !== JSON.stringify(want));
  check(!bad.length, 'Hand: radius lists read as CVI reads them (' + cases.length + ' cases)',
    bad.map(c => [c[0], r(c[0])]));
  const g = PX.ringOf;
  const rings = [[0, 3], [3, 3], [3.0000001, 10], [10, 10], [19.99, 20], [20, 20], [25, 20]];
  const badR = rings.filter(([km, want]) => g([3, 10, 20], km) !== want);
  check(!badR.length, 'Hand: a match belongs to the smallest ring holding it (7 cases)', badR);
}
{
  const p = PX.prepareSites([
    { name: 'own', lat: 47, long: -120, buffer_km: 12 }, { name: 'zero', lat: 47, long: -120, buffer_km: 0 },
    { name: 'neg', lat: 47, long: -120, buffer_km: -1 }, { name: 'text', lat: 47, long: -120, buffer_km: 'x' },
    { name: 'bands', lat: 47, long: -120, buffer_km: 30, bands_csv: '2 4' }, { name: 'bad', lat: 91, long: 0 },
    { name: 'none', lat: null, long: -120 }], { defaultKm: 7 });
  const s = p.sites;
  check(p.skipped === 2 && s.length === 5 && s.map(x => x.id).join() === '1,2,3,4,5',
    'Hand: unusable sites skipped and counted, the rest numbered in order', p.skipped);
  check(s[0].bufferKm === 12 && s[0].bufferUser === 12 && [1, 2, 3].every(k => s[k].bufferKm === 7 &&
    s[k].bufferUser === null), 'Hand: a positive buffer is the site\'s own, anything else takes the default');
  check(JSON.stringify(s[4].radii) === '[2,4]' && s[4].bufferKm === 4 && s[4].bufferUser === 30 && p.bandsMode,
    'Hand: a site\'s band list replaces its buffer; its outer ring is its radius; band mode on', s[4]);
  const q = PX.prepareSites([{ name: 'a', lat: 47, long: -120, bands_csv: '' }, { name: 'b', lat: 47, long: -120,
    buffer_km: 9 }], { defaultKm: 3, bands: [5, 10] });
  check(JSON.stringify(q.sites.map(x => x.radii)) === '[[5,10],[5,10]]' && q.sites[1].bufferKm === 10 && q.bandsMode,
    'Hand: global bands for sites without their own (their buffers ignored)');
  const z = PX.prepareSites([{ name: 'a', lat: 47, long: -120, bands_csv: '' }], { defaultKm: 3 });
  const w = PX.prepareSites([{ name: 'a', lat: 47, long: -120, bands_csv: 'x' }], { defaultKm: 3 });
  check(!z.bandsMode && w.bandsMode && JSON.stringify(w.sites[0].radii) === '[3]',
    'Hand: band mode follows a written band list, even one with no usable radius (CVI\'s rule)');
}
{
  // Zones: a square with a square hole, and a second square elsewhere.
  const sq = (x0, y0, s) => [[x0, y0], [x0 + s, y0], [x0 + s, y0 + s], [x0, y0 + s], [x0, y0]];
  const zone = { type: 'MultiPolygon', coordinates: [[sq(-121, 46, 2), sq(-120.5, 46.5, 1)], [sq(-118, 47, 0.5)]] };
  const inside = [[-120.8, 46.2], [-117.8, 47.2]], hole = [[-120, 47]], outside = [[-122, 46.5], [-118.6, 47.2]];
  check(inside.every(p => PX.inZone(p[0], p[1], zone)) && !hole.some(p => PX.inZone(p[0], p[1], zone)) &&
    !outside.some(p => PX.inZone(p[0], p[1], zone)),
  'Hand: zone test: inside both parts, not in the hole, not outside');
  const poly = { type: 'Polygon', coordinates: [sq(-121, 46, 2), sq(-120.5, 46.5, 1)] };
  check(PX.inZone(-120.8, 46.2, poly) && !PX.inZone(-120, 47, poly), 'Hand: zone test on a Polygon with a hole');
  const sites = PX.prepareSites([{ name: 'z', lat: 0, long: 0, zone: poly }], { defaultKm: 3 }).sites;
  const hits = PX.match([{ lat: 46.2, lon: -120.8 }, { lat: 47, lon: -120 }, { lat: 0, lon: 0 }], sites);
  check(hits[0].length === 1 && hits[0][0].km === 0 && !hits[1].length && !hits[2].length,
    'Hand: a zone replaces the site\'s circle; a point inside is 0 km away', hits);
}
{
  const r2 = W.lookup.round2;
  const cases = [[0.125, 0.12], [0.135, 0.14], [2.675, 2.67], [1.005, 1], [2.5, 2.5], [0.375, 0.38], [12.344999, 12.34],
    [5.17, 5.17], [0, 0]];
  const bad = cases.filter(([x, want]) => r2(x) !== want);
  check(!bad.length, 'Hand: R\'s round(x, 2) (' + cases.length + ' cases)', bad.map(c => [c[0], r2(c[0])]));
}
{
  // A small table: the site at (47, -120), 5 km; points due north at 0, 3, 7 and 4 km, by hand.
  const north = km => (47 + km / R_KM * 180 / Math.PI).toFixed(6);
  const header = ['CVI', 'Species.Group', 'Reporting.Year', 'Reporting.Quarter', 'Movement', 'Total.Animals',
    'Origin.State', 'Origin.County', 'Origin.County.Lat', 'Origin.County.Long', 'Dest.State', 'Dest.County',
    'Dest.County.Lat', 'Dest.County.Long', 'Origin.Lat', 'Origin.Long', 'Dest.Lat', 'Dest.Long'];
  const row = (cvi, mv, n, os, ds, oLat, dLat, oLon, dLon) => [cvi, 'Cattle', '2025', 'Q1', mv, String(n), os, 'Yakima',
    '46.5', '-120.5', ds, 'Yakima', '46.5', '-120.5', oLat, oLon === undefined ? '-120' : oLon, dLat,
    dLon === undefined ? '-120' : dLon].join(',');
  const lines = [header.join(','),
    row('X1', 'Export', 10, 'WA', 'OR', north(0), '44'),            // origin inside, at the site
    row('X2', 'Import', 20, 'ID', 'WA', '44', north(3)),            // destination inside, 3 km
    row('X3', 'Export', 30, 'WA', 'CA', north(7), '40'),            // neither (7 km)
    row('X4', 'Intrastate', 40, 'WA', 'WA', north(4), north(1)),    // both inside: origin 4 km, destination 1 km
    row('X4', 'Intrastate', 40, 'WA', 'WA', north(4), north(1)),    // the same row again
    row('X5', 'Export', 50, 'WA', 'OR', '', '44', '', '-120'),      // origin missing
    row('X6', 'Export', 60, 'WA', 'OR', '95', '200', '-120', '-120')]; // both out of range
  const master = W.master.load(lines.join('\n') + '\n');
  const sites = [{ name: 'S', lat: 47, long: -120, buffer_km: 5 }];
  const q = (endpoint, collapse) => W.lookup.query(master, sites, { defaultKm: 3, endpoint, collapse });
  const e = q('either', 'cvi'), o = q('origin', 'cvi'), d = q('dest', 'cvi'), page = q('either', 'loader');
  const cvis = r => [...new Set(r.matched.map(x => x.CVI))].sort().join();
  check(cvis(e) === 'X1,X2,X4' && cvis(o) === 'X1,X4' && cvis(d) === 'X2,X4',
    'Hand table: the endpoint rule picks the rows by hand', [cvis(e), cvis(o), cvis(d)]);
  check(e.skippedCoords === 1 && o.skippedCoords === 2 && d.skippedCoords === 1,
    'Hand table: CVIs that cannot be checked: either X6; origin X5 and X6; destination X6',
    [e.skippedCoords, o.skippedCoords, d.skippedCoords]);
  const x4 = e.matched.find(x => x.CVI === 'X4');
  check(x4.hitOrigin && x4.hitDest && x4.nearestSiteKm === 1 && o.matched.find(x => x.CVI === 'X4').nearestSiteKm === 4,
    'Hand table: the nearest distance is the nearer endpoint, or the one asked for', [x4.nearestSiteKm]);
  // The loader made Inbound and Outbound copies of both X4 rows: CVI keeps one, the page one per file row.
  const animals = r => r.summary.animals;
  check(animals(e) === 10 + 20 + 40 && animals(page) === 10 + 20 + 40 + 40 && e.summary.cvis === 3 &&
    e.summary.origins === 2 && e.summary.dests === 2 && e.summary.sitesHit === 1,
  'Hand table: animals 70 (CVI), 110 (the page\'s rule); 3 CVIs, 2 origin and 2 destination points',
  [animals(e), animals(page), e.summary]);
  // X2's destination exactly on the radius counts; with the radius a meter shorter it does not.
  const x2 = master.rows.find(x => x.CVI === 'X2');
  const edge = PX.distanceKm(PX.number(x2['Dest.Lat']), PX.number(x2['Dest.Long']), 47, -120);
  const at = km => W.lookup.query(master, [{ name: 'S', lat: 47, long: -120, buffer_km: km }],
    { defaultKm: 3, endpoint: 'dest', collapse: 'cvi' }).matched.some(x => x.CVI === 'X2');
  check(at(edge) && !at(edge - 0.001), 'Hand table: a destination exactly on the radius matches, a meter beyond not',
    edge);
  const none = W.master.load(lines.join('\n').replace(/^CVI,/, 'ID,') + '\n');
  const nq = W.lookup.query(none, sites, { defaultKm: 3, endpoint: 'either', collapse: 'cvi' });
  const ids = nq.matched.map(x => x.CVI);
  check(!nq.hasCvi && nq.summary.cvis === 3 && new Set(ids).size === 3 && ids.every(x => /^row_\d+$/.test(x)),
    'Hand table: without a CVI column each movement record gets one number (the X4 copies share theirs)', ids);
}

// ── The tab's own steps against CVI's module ───────────────────────────────────────────────────────────────────
// CVI's notification types against the page's message levels; R's NA (written null) and Inf (written "Inf").
const LEVEL = { warning: ['warn'], error: ['err'], message: ['ok', 'info'], default: ['ok', 'info'] };
const sameNote = (page, cvi) => !!page && !!cvi && page.text === cvi.text && (LEVEL[cvi.type] || []).indexOf(page.level) >= 0;
const sameNotes = (page, cvi) => page.length === cvi.length && page.every((m, i) => sameNote(m, cvi[i]));
const rNum = v => (v === 'Inf' ? Infinity : v === '-Inf' ? -Infinity : v === undefined ? null : v);
const sameSite = (p, c) => same(p.name, c.name) && same(p.lat, rNum(c.lat)) && same(p.long, rNum(c.long)) &&
  same(p.buffer_km, rNum(c.buffer_km)) && same(p.bands_csv, c.bands_csv);
const sameSites = (page, cvi) => page.length === cvi.length && page.every((p, i) => sameSite(p, cvi[i]));
const MOD = REF.module, FM = FX.module;
check(!!MOD && MOD.pastes.length === FM.pastes.length && MOD.uploads.length === FM.uploads.length &&
  MOD.adds.length === FM.adds.length && MOD.edits.length === FM.edits.length && MOD.bands.length === FM.bands.length &&
  MOD.runs.length === FM.runs.length, 'Module: the reference ran every step list',
MOD && [MOD.pastes.length, MOD.uploads.length, MOD.adds.length, MOD.edits.length, MOD.bands.length, MOD.runs.length]);
tally.module = 0;
FM.pastes.forEach((cs, i) => {
  const cvi = MOD.pastes[i], r = W.lookup.parsePaste(cs.text);
  check(sameSites(r.sites, cvi.sites), 'Paste "' + cs.name + '": the sites table as CVI\'s', [r.sites, cvi.sites]);
  // A recorded difference: lines with fewer than three parts count as
  // skipped, so the page's count is CVI's plus those lines (counted here from the text, independently).
  const short = cs.text.split('\n').map(l => l.trim()).filter(l => l !== '')
    .filter(l => l.replace(/[,\t]\s*$/, '').split(/[,\t]/).length < 3).length;
  const want = cvi.notes.map(n => (short && /^Added /.test(n.text) ? Object.assign({}, n, { text: n.text.replace(/( Skipped (\d+) unparseable line\(s\)\.)?$/,
    (m, all, k) => ' Skipped ' + (Number(k || 0) + short) + ' unparseable line(s).') }) : n));
  check(r.shortLines === short && sameNotes([W.lookup.pasteMessage(r)], want), 'Paste "' + cs.name + '": CVI\'s ' +
    'notification' + (short ? ', with the ' + short + ' short line(s) counted as skipped (a recorded difference)' : ''),
  [W.lookup.pasteMessage(r), want, r.shortLines, short]);
  tally.module++;
});
FM.uploads.forEach((cs, i) => {
  const cvi = MOD.uploads[i], r = W.lookup.parseUpload(fs.readFileSync(path.join(ROOT, cs.file), 'utf8'));
  check(sameSites(r.sites || [], cvi.sites), 'Upload "' + cs.name + '": the sites table as CVI\'s', [r.sites, cvi.sites]);
  check(sameNotes([r.message], cvi.notes), 'Upload "' + cs.name + '": CVI\'s notification', [r.message, cvi.notes]);
  tally.module++;
});
{
  const table = [];
  FM.adds.forEach((a, k) => {
    const r = W.lookup.addSiteRule(table.length, { name: a.name, lat: a.lat, long: a.long, buffer: a.buffer });
    if (r.site) table.push(r.site);
    const cvi = MOD.adds[k];
    check(sameSites(table, cvi.sites), 'Add ' + (k + 1) + ' ("' + a.name + '"): the sites table as CVI\'s',
      [table, cvi.sites]);
    check(sameNotes([r.message], cvi.notes), 'Add ' + (k + 1) + ': CVI\'s notification', [r.message, cvi.notes]);
    tally.module++;
  });
}
FM.edits.forEach((cs, i) => {
  const table = cs.sites.map(x => ({ name: x.name, lat: PX.number(x.lat), long: PX.number(x.long),
    buffer_km: PX.number(x.buffer_km === undefined ? null : x.buffer_km),
    bands_csv: x.bands_csv === undefined ? null : x.bands_csv }));
  cs.edits.forEach((e, k) => {
    W.lookup.editCell(table[e.row - 1], W.lookup.editField(cs.mode, e.col), e.value);
    check(sameSites(table, MOD.edits[i][k].sites), 'Edit ' + cs.mode + ' ' + (k + 1) + ' (row ' + e.row + ', column ' +
      e.col + ', "' + e.value + '"): the sites table as CVI\'s', [table, MOD.edits[i][k].sites]);
    tally.module++;
  });
});
FM.bands.forEach((text, i) => {
  const cvi = MOD.bands[i], r = W.lookup.validateBands(text);
  const radii = r.radii || null, want = cvi.radii === null || cvi.radii === undefined ? null : list(cvi.radii).map(rNum);
  check(JSON.stringify(radii) === JSON.stringify(want), 'Bands "' + text + '": the radii as CVI\'s', [radii, want]);
  const notes = r.radii ? (r.note ? [r.note] : []) : [r.message];
  check(sameNotes(notes, cvi.notes), 'Bands "' + text + '": CVI\'s notifications', [notes, cvi.notes]);
  tally.module++;
});
// Run query: the page's steps from the same inputs, every notification in CVI's order and the result.
FM.runs.forEach((cs, i) => {
  const cvi = MOD.runs[i], name = 'Run "' + cs.name + '"';
  const sites = cs.sites.map(x => ({ name: x.name, lat: PX.number(x.lat), long: PX.number(x.long),
    buffer_km: PX.number(x.buffer_km === undefined ? null : x.buffer_km),
    bands_csv: x.bands_csv === undefined ? null : x.bands_csv }));
  const plan = W.lookup.prepareRun({ master: masterOf(cs.master), loading: false, sites, mode: cs.mode,
    defaultKm: cs.default_buffer_km, bandsText: cs.band_radii, endpoint: cs.endpoint,
    years: cs.years.map(Number), quarters: cs.quarters, species: cs.species });
  let notes = plan.messages, res = null, keep = null;
  if (!plan.stop) {
    res = W.lookup.query(masterOf(cs.master), plan.args.sites, plan.args.opts);
    const after = W.lookup.afterRun(res);
    notes = notes.concat(after.messages);
    keep = after.keep;
  }
  tally.module++;
  if (cs.name === 'empty default buffer') {
    // A recorded difference: the page stops and asks for the default; CVI runs and matches only the site with its
    // own buffer.
    check(plan.stop && notes.length === 1 && notes[0].text === 'Enter a default buffer (km).' && cvi.result &&
      cvi.result.summary.n_sites_hit === 1, name + ': the page asks for the default buffer (a recorded difference); ' +
      'CVI matches only the site with its own buffer', [notes, cvi.result && cvi.result.summary]);
    return;
  }
  check(sameNotes(notes, cvi.notes), name + ': CVI\'s notifications, in order', [notes, cvi.notes]);
  const stored = keep === 'store' ? res : null;
  check(!stored === !cvi.result, name + ': a result shown exactly when CVI stores one', [keep, !!cvi.result]);
  if (!stored || !cvi.result) return;
  const sm = cvi.result.summary;
  check(stored.status === cvi.result.status && stored.summary.cvis === sm.n_cvis &&
    stored.summary.origins === sm.n_origins && stored.summary.dests === sm.n_dests &&
    stored.summary.sitesHit === sm.n_sites_hit && stored.bandsMode === cvi.result.bands_mode &&
    JSON.stringify(stored.sites.map(x => x.name)) === JSON.stringify(list(cvi.result.sites)),
  name + ': the status, counts, band mode and sites as CVI\'s', [stored.status, stored.summary, sm]);
  if (cs.name === 'repeated rows') {
    // By design, repeated within-state rows count each time, so the page has
    // more animals and rows than CVI; worked out again from the fixture's repeated rows inside the buffer.
    const cviRun = W.lookup.query(masterOf(cs.master), plan.args.sites, Object.assign({}, plan.args.opts, { collapse: 'cvi' }));
    check(cviRun.summary.animals === sm.n_animals && cviRun.matched.length === cvi.result.matched &&
      stored.summary.animals > sm.n_animals && stored.matched.length > cvi.result.matched,
    name + ': with CVI\'s collapse the page gives CVI\'s animals and rows; with the page\'s rule more (the repeated rows)',
    [stored.summary.animals, cviRun.summary.animals, sm.n_animals, stored.matched.length, cvi.result.matched]);
  } else {
    check(stored.summary.animals === sm.n_animals && stored.matched.length === cvi.result.matched,
      name + ': the animals and matched rows as CVI\'s', [stored.summary.animals, sm.n_animals, stored.matched.length,
        cvi.result.matched]);
  }
});

// ── The tiles, the table and the match map (hand cases) ────────────────────────────────────────────────────────
{
  const t = W.lookup.tiles({ cvis: 1234, animals: 1234567, origins: 0, dests: 7, sitesHit: 2 });
  check(JSON.stringify(t.map(x => x.label)) === JSON.stringify(['CVIs matched', 'Total animals', 'Distinct origins',
    'Distinct destinations', 'Sites with matches']) &&
    JSON.stringify(t.map(x => x.text)) === JSON.stringify(['1,234', '1,234,567', '0', '7', '2']) &&
    JSON.stringify(t.map(x => x.accent)) === JSON.stringify(['#1c5a83', '#2980b9', '#5d6873', '#5d6873', '#27ae60']),
  'Tiles: CVI\'s five labels, values with thousands marks, colors', t);
  const sc = FX.scenarios.find(x => x.name === 'bands_site_override');
  const res = run(sc, 'loader');
  const tb = W.lookup.table(res);
  check(JSON.stringify(tb.columns) === JSON.stringify(W.lookup.TABLE_COLUMNS) && tb.rows.length === res.matched.length &&
    tb.rows.every((r, k) => r[13] === res.matched[k].matchedSites && r[14] === res.matched[k].nearestSiteKm &&
      r[0] === res.matched[k].CVI),
  'Table: CVI\'s 15 columns in order, one row per matched row, the matched sites and nearest site', tb.columns);
  const noSpecies = { matched: res.matched.map(r => { const c = Object.assign({}, r); delete c.Species; return c; }) };
  check(W.lookup.table(noSpecies).columns.indexOf('Species') < 0 && W.lookup.table(noSpecies).columns.length === 14,
    'Table: a column the rows do not have is left out (CVI\'s intersect)');
  check(W.lookup.table({ matched: [] }).rows.length === 0, 'Table: no rows without matches');
  const md = W.lookup.mapData(res);
  const radii = res.sites.map(x => x.radii.length).reduce((a, b) => a + b, 0);
  const levels = [...new Set([].concat(...res.sites.map(x => x.radii)))].sort((a, b) => a - b);
  check(md.bands.length === radii && md.bands.every(f => f.properties.color ===
    W.lookup.BAND_COLORS[Math.min(levels.indexOf(f.properties.bandKm), 2)]),
  'Map: one band per radius per site, gray by its radius among all radii drawn', [md.bands.length, radii, levels]);
  check(md.origins.length === res.matched.filter(r => r.hitOrigin).length &&
    md.dests.length === res.matched.filter(r => r.hitDest).length && md.sites.length === res.sites.length,
  'Map: one point per matched row whose endpoint fell inside, and every site', [md.origins.length, md.dests.length]);
  const inBox = p => p[0] >= md.bounds[0] && p[0] <= md.bounds[2] && p[1] >= md.bounds[1] && p[1] <= md.bounds[3];
  check(md.bands.every(f => f.geometry.coordinates.every(ring => ring.every(inBox))),
    'Map: the view box holds every band', md.bounds);
  const labelled = W.lookup.mapData({ sites: [], matched: [{ hitOrigin: true, hitDest: false, 'Origin.Lat': '47',
    'Origin.Long': '-120', 'Origin.City': null, 'Origin.State': 'WA' }] });
  check(labelled.origins.length === 1 && labelled.origins[0].label === 'NA, WA' && labelled.bounds === null,
    'Map: an endpoint\'s hover text as CVI\'s paste0 ("NA, WA" for a missing city); no box without sites',
    labelled.origins);
  // Each vertex of a ring lies on the matching edge: its distance from the site by the engine's distance (checked
  // against geosphere above) equals the radius to a millimeter; holes follow the inner radius.
  let worst = 0, vertices = 0;
  md.bands.forEach(f => {
    const s = res.sites.find(x => x.id === f.properties.site);
    f.geometry.coordinates.forEach((ring, k) => {
      const want = k === 0 ? f.properties.outerKm : f.properties.innerKm;
      ring.forEach(v => {
        worst = Math.max(worst, Math.abs(PX.distanceKm(v[1], v[0], s.lat, s.lon) - want));
        vertices++;
      });
    });
  });
  check(worst < 1e-6 && vertices > 0, 'Rings: every vertex on its radius (largest difference ' +
    (worst * 1e6).toFixed(4) + ' mm over ' + vertices + ' vertices)', worst);
  check(md.bands.every(f => (f.properties.innerKm === 0) === (f.geometry.coordinates.length === 1)),
    'Rings: the innermost band a full disk, each other one a ring with a hole');
  const c = PX.circle(46, -120, 10, 360);
  check(c.length === 361 && c[0][0] === c[360][0] && c[0][1] === c[360][1] &&
    Math.abs(c[0][1] - (46 + 10 / (R_KM * Math.PI / 180))) < 1e-9 && Math.abs(c[0][0] + 120) < 1e-12,
  'Rings: 361 points, closed, the first due north by 10 km (one degree is ' + (R_KM * Math.PI / 180).toFixed(3) +
    ' km on CVI\'s sphere)', c[0]);
  const east = PX.destination(0, 179.99, 10, 90);
  check(east[0] < -179 && east[0] >= -180, 'Rings: a vertex past the antimeridian comes back as about -179.9', east);
  check(PX.bandShapes({ id: 1, name: 'Z', lat: 47, lon: -120, radii: [3], zone: { type: 'Polygon', coordinates: [] } })
    .length === 0, 'Rings: a zone site draws no ring');
}
{
  const sites = [{ name: 'A', lat: 47, long: -120, buffer_km: null, bands_csv: '1,2' }];
  const base = { master: { header: [] }, loading: false, sites, mode: 'single', defaultKm: 3, bandsText: '',
    endpoint: 'either', years: [], quarters: [], species: [] };
  const p1 = W.lookup.prepareRun(base);
  check(!p1.stop && p1.args.sites.every(x => !('bands_csv' in x)) && p1.args.opts.collapse === 'loader',
    'Run: Single mode leaves the per-site bands out; the page\'s collapse rule counts repeated rows', p1.args);
  check(W.lookup.prepareRun(Object.assign({}, base, { loading: true })).messages[0].text ===
    'The master dataset is still loading — try again in a moment.', 'Run: a master still loading stops the run');
  check(W.lookup.prepareRun(Object.assign({}, base, { master: null })).stop, 'Run: no master stops the run');
  check(W.lookup.prepareRun(Object.assign({}, base, { mode: 'bands', bandsText: '3, 10', defaultKm: null })).args.opts.bands
    .join() === '3,10', 'Run: Bands mode needs no default buffer');
}
{
  const n = W.lookup.makeNames(['name', ' lat', 'buffer km', '1st', '.5x', 'if', 'name', '', 'a-b']);
  check(JSON.stringify(n) === JSON.stringify(['name', 'X.lat', 'buffer.km', 'X1st', 'X.5x', 'if.', 'name.1', 'X',
    'a.b']), 'Upload: the header made as R\'s make.names(unique = TRUE)', n);
  check(W.lookup.TEMPLATE_CSV === '"name","lat","long","buffer_km"\n"Affected Farm A",46.5,-120.5,3\n' +
    '"Affected Farm B",47,-120,NA\n' && W.lookup.TEMPLATE_NAME === 'premise_lookup_template.csv',
  'Template: CVI\'s file as R\'s write.csv writes it');
}


// ── Zones, places, facilities inside, the CSVs ──────────────────────────────────────────────────────────────────
const ZF = FX.zones, ZR = REF.zones;
const ZDIR = path.join(ROOT, ZF.dir);
const tally3 = { zonePoints: 0, placePoints: 0, csvRuns: 0, numbers: 0 };
const blobOf = f => Object.assign(new Blob([fs.readFileSync(path.join(ZDIR, f))]), { name: f });
// The points R tested: the grid over the zones, then every origin, then every destination of the Full tier.
const fullMaster = masterOf(FX.full);
const num = v => PX.number(v);
const zonePts = ZF.points.concat(fullMaster.rows.map(r => [num(r['Origin.Long']), num(r['Origin.Lat'])]),
  fullMaster.rows.map(r => [num(r['Dest.Long']), num(r['Dest.Lat'])]));
check(ZR.n_grid === ZF.points.length && ZR.n_rows === fullMaster.rows.length,
  'Zones: the page\'s master has the reference\'s rows, in the same order count (for the endpoint points)',
  [ZR.n_rows, fullMaster.rows.length]);
// Which zones (1-based, in file order) hold a point, by the engine's even-odd test.
const holdingOf = (zones, p) => (p[0] === null || p[1] === null || !PX.usable(p[1], p[0]) ? [] :
  zones.map((z, k) => (PX.inZone(p[0], p[1], z.geometry) ? k + 1 : 0)).filter(Boolean));
const WANT_NAMES = ['Control area A', 'Two pastures', 'Ring with a hole', 'Zone 4'];
// Exactly on one of the geometry's edges (the cross product zero within the segment's box), worked out here.
function onAnEdge(p, g) {
  const polygons = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  return polygons.some(rings => rings.some(ring => ring.some((a, k) => {
    const b = ring[k + 1];
    if (!b) return false;
    const cross = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    return cross === 0 && p[0] >= Math.min(a[0], b[0]) && p[0] <= Math.max(a[0], b[0]) &&
      p[1] >= Math.min(a[1], b[1]) && p[1] <= Math.max(a[1], b[1]);
  })));
}
async function day3() {
  // Each readable format in Node (KML needs the browser's XML reader: the Chrome suite's "day3" part checks it), and the
  // files only the page reads.
  for (const f of ZF.files.read.filter(x => !/\.kml$/.test(x)).concat(ZF.files.pageOnly)) {
    const r = await ZONES.read(blobOf(f));
    const want = ZF.expect[f];
    check(JSON.stringify(r.zones.map(z => z.name)) === JSON.stringify(want.names) && r.skipped === want.skipped &&
      r.broken === want.broken, 'Zones ' + f + ': ' + want.names.length + ' zones named by the page\'s rule ("name" in ' +
      'any case, else a property holding "name", else "Zone n"); left out and counted: ' + want.skipped + ' not ' +
      'polygons, ' + want.broken + ' with unusable coordinates', [r.zones.map(z => z.name), r.skipped, r.broken]);
    r.zones.forEach(z => check(PX.inZone(z.point[0], z.point[1], z.geometry),
      'Zones ' + f + ': ' + z.name + '\'s point lies inside it', z.point));
    const ref = ZR.files[f];
    if (!ref) continue;   // page only: checked above
    const parts = r.zones.map(z => (z.geometry.type === 'Polygon' ? 1 : z.geometry.coordinates.length));
    check(JSON.stringify(parts) === JSON.stringify(list(ref.parts)), 'Zones ' + f + ': the parts as sf reads them',
      [parts, ref.parts]);
    // A point exactly on an outline may fall either way (the engine's rule, and GEOS breaks the tie otherwise): such
    // points are left out of the comparison and counted (a premises can sit on a fixture's edge).
    let bad = 0, hits = 0, onEdge = 0;
    zonePts.forEach((p, i) => {
      if (p[0] !== null && p[1] !== null && r.zones.some(z => onAnEdge(p, z.geometry))) { onEdge++; return; }
      const got = holdingOf(r.zones, p), want = list(ref.holding[i]);
      hits += want.length;
      if (JSON.stringify(got) !== JSON.stringify(want)) bad++;
      tally3.zonePoints++;
    });
    check(bad === 0 && hits > 50 && onEdge <= 20,   // the newer fixtures sit on premises points, so a few lie on corners
      'Zones ' + f + ': for ' + zonePts.length + ' points, the zones holding ' +
      'each one equal sf and GEOS\'s (' + hits + ' hits; ' + onEdge + ' exactly on an edge left out)', { bad, hits, onEdge });
  }
  // .prj texts read by the page only: the same zones as zones_shp.zip.
  const base = JSON.stringify((await ZONES.read(blobOf('zones_shp.zip'))).zones);
  // (A read that throws fails its check, not the suite.)
  const zonesOrError = async (read) => { try { return JSON.stringify((await read()).zones); } catch (e) { return String(e); } };
  for (const f of ZF.files.sameAs) {
    check(await zonesOrError(() => ZONES.read(blobOf(f))) === base, 'Zones ' + f + ': accepted (' +
      (/2011/.test(f) ? 'ESRI NAD 1983 2011' : /ensemble/.test(f) ? 'WKT2 with a datum ensemble' : 'WKT2 WGS 84') +
      '), the same zones as zones_shp.zip');
  }
  // The L-shaped barn (20 m by 12 m): its point is its centroid, worked out here in meters (the bottom
  // bar 20 x 4 and the upright 4 x 8: 7.714 m east, 3.714 m north of its corner), to 2e-6 degrees.
  const barn = (await ZONES.read(blobOf('zones_footprints.geojson'))).zones[0];
  const bc = barn.geometry.coordinates[0], bx = Math.min(...bc.map(p => p[0])), by = Math.min(...bc.map(p => p[1]));
  const mLat = 1 / (6378137 * Math.PI / 180), mLon = mLat / Math.cos(by * Math.PI / 180);
  const bcx = (80 * 10 + 32 * 2) / 112, bcy = (80 * 2 + 32 * 8) / 112;
  check(Math.abs(barn.point[0] - (bx + bcx * mLon)) < 2e-6 && Math.abs(barn.point[1] - (by + bcy * mLat)) < 2e-6,
    'Zones: a 20 m L-shaped barn\'s point is its centroid (worked out here in meters)', [barn.point, bx + bcx * mLon, by + bcy * mLat]);
  // Hole cases, worked out here: a hole touching its outline and the hole in a nested island are outside.
  const holes = (await ZONES.read(blobOf('zones_holes_shp.zip'))).zones;
  const [t1, t2, nest] = holes.map(z => z.geometry);
  const ring0 = g => (g.type === 'Polygon' ? g.coordinates[0] : g.coordinates[0][0]);
  const corner = g => [Math.min(...ring0(g).map(p => p[0])), Math.min(...ring0(g).map(p => p[1]))];
  const cT = corner(t1), cR = corner(t2), cN = corner(nest);
  check(t1.type === 'Polygon' && t1.coordinates.length === 2 && !PX.inZone(cT[0] + 0.02, cT[1] + 0.025, t1) &&
    PX.inZone(cT[0] + 0.035, cT[1] + 0.005, t1), 'Zones: a hole whose first point touches the outline\'s top edge stays a ' +
    'hole (its middle outside, the rest inside)');
  check(t2.type === 'Polygon' && t2.coordinates.length === 2 && !PX.inZone(cR[0] + 0.028, cR[1] + 0.02, t2),
    'Zones: a hole touching the outline\'s right edge stays a hole');
  check(nest.type === 'MultiPolygon' && nest.coordinates.length === 2 && !PX.inZone(cN[0] + 0.05, cN[1] + 0.05, nest) &&
    PX.inZone(cN[0] + 0.035, cN[1] + 0.05, nest) && !PX.inZone(cN[0] + 0.025, cN[1] + 0.05, nest) &&
    PX.inZone(cN[0] + 0.01, cN[1] + 0.05, nest), 'Zones: nested rings (outline, hole, island, hole in the island): ' +
    'inside, outside, inside, outside from the edge in');
  // Zone A's centroid (worked out here) lies in the U's notch, so the page's point comes from the widest span.
  const g = (await ZONES.read(blobOf('zones.geojson'))).zones;
  const ring = g[0].geometry.coordinates[0];
  let a2 = 0, cx = 0, cy = 0;
  for (let i = 0; i + 1 < ring.length; i++) {
    const f = ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
    a2 += f; cx += (ring[i][0] + ring[i + 1][0]) * f; cy += (ring[i][1] + ring[i + 1][1]) * f;
  }
  check(!PX.inZone(cx / (3 * a2), cy / (3 * a2), g[0].geometry) && PX.inZone(g[0].point[0], g[0].point[1], g[0].geometry),
    'Zones: a U-shaped zone\'s centroid is outside it; the page\'s point is inside', [cx / (3 * a2), cy / (3 * a2), g[0].point]);
  const hole = ZF.premises.holeCenter;
  check(!PX.inZone(hole[1], hole[0], g[2].geometry) && PX.inZone(hole[1] + 0.03, hole[0], g[2].geometry),
    'Zones: the premises at the hole\'s center is outside the ring; a point 0.03 degrees east is inside');

  // Files the page refuses, each with a message naming the file and why.
  const WANT = {
    'broken.geojson': /^"broken\.geojson" could not be read as GeoJSON/,
    'broken.kml': null,   // KML: the Chrome part
    'points_only.geojson': /^No polygons in "points_only\.geojson" \(2 shapes that are not polygons left out\)/,
    'zones_epsg2927.geojson': /is in the coordinate system urn:ogc:def:crs:EPSG::2927\. Save it in longitude and latitude/,
    'zones_meters.geojson': /has coordinates outside longitude and latitude ranges \(for example 500000, 100000\)/,
    'zones_nad27_shp.zip': /uses the datum D_North_American_1927, not WGS 84 or NAD 83/,
    'zones_projected_shp.zip': /is in a projected coordinate system \(NAD_1983_HARN_StatePlane_Washington_South_FIPS_4602_Feet\)/,
    'zones_no_prj_shp.zip': /has no \.prj file, so its coordinate system is unknown/,
    'zones_points_shp.zip': /^No polygons in "zones_points_shp\.zip": its shapefile holds points/,
    'zones.kmz': /^"zones\.kmz" is a KMZ \(a zipped KML\)\. Unzip it/,
    'not_a_zone.txt': /^"not_a_zone\.txt" is not a zone file the page reads/,
    'zones_cut_shp.zip': /^"zones_cut_shp\.zip" has a damaged \.shp: a record runs past the end of the file\.$/,
    'zones_bad_dbf_shp.zip': /in "zones_bad_dbf_shp\.zip" has a damaged \.dbf \(its header does not match its records\)\.$/,
    'zones_short_dbf_shp.zip': /in "zones_short_dbf_shp\.zip" has a damaged \.dbf \(its header does not match its records\)\.$/,
    'zones_bad_parts_shp.zip': /has a damaged \.shp: its parts are out of order \(record 1\)\.$/,
    'zones_not_a_zip.zip': /^"zones_not_a_zip\.zip" could not be opened as a ZIP file/,
    'kmz_renamed.zip': /holds a KML file \(doc\.kml\), not a shapefile: it may be a KMZ renamed \.zip/,
    'zones_unusable.geojson': /^No polygons in "zones_unusable\.geojson" \(3 polygons with unusable coordinates left out\)/
  };
  for (const f of ZF.files.refused) {
    if (!WANT[f]) continue;
    let err = null;
    try { await ZONES.read(blobOf(f)); } catch (e) { err = e; }
    check(err && err.name === 'ZoneError' && WANT[f].test(err.message), 'Zones: ' + f + ' is refused with its message',
      err && err.message);
  }
  // The format from the first bytes when the name says nothing; the limits.
  const enc = new TextEncoder();
  check(ZONES.formatOf('x', enc.encode('{"type":"Feature"}')) === 'geojson' &&
    ZONES.formatOf('x', enc.encode('<?xml version="1.0"?>\n<kml xmlns="x">')) === 'kml' &&
    ZONES.formatOf('x', new Uint8Array([0x50, 0x4b, 3, 4])) === 'zip' && ZONES.formatOf('x', enc.encode('a,b')) === null,
  'Zones: a file without a known extension is recognized by its first bytes');
  const square = (x, y) => [[[x, y], [x + 0.001, y], [x + 0.001, y + 0.001], [x, y]]];
  const many = { type: 'FeatureCollection', features: Array.from({ length: 1001 }, (v, i) => ({ type: 'Feature',
    properties: {}, geometry: { type: 'Polygon', coordinates: square(-120 + i * 0.002, 47) } })) };
  let e1 = null;
  try { ZONES.readGeoJson(JSON.stringify(many), 'many.geojson'); } catch (e) { e1 = e; }
  check(e1 && /has more than 1,000 polygons; the page reads at most 1,000 zones/.test(e1.message),
    'Zones: more than 1,000 zones refused', e1 && e1.message);
  const big = Array.from({ length: 500001 }, (v, i) => [-120 + 0.1 * Math.cos(i / 80000), 47 + 0.1 * Math.sin(i / 80000)]);
  let e2 = null;
  try { ZONES.readGeoJson(JSON.stringify({ type: 'Polygon', coordinates: [big] }), 'big.geojson'); } catch (e) { e2 = e; }
  check(e2 && /points in its outlines; the page reads at most 500,000/.test(e2.message),
    'Zones: more than 500,000 outline points refused', e2 && e2.message);
  // Refused before reading: a file over 64 MB (never read: its text() would fail), a .shp over 16 MB.
  let e3 = null;
  try {
    await ZONES.read({ name: 'parcels.geojson', size: 70 * 1024 * 1024, slice: () => { throw new Error('read'); },
      text: () => { throw new Error('read'); } });
  } catch (e) { e3 = e; }
  check(e3 && e3.name === 'ZoneError' && /^"parcels\.geojson" is 70\.0 MB; the page reads zone files up to 64\.0 MB/.test(e3.message),
    'Zones: a file over 64 MB refused before it is read', e3 && e3.message);
  const prjEntry = { path: 'z/z.prj', size: 10, read: async () => new TextEncoder().encode('GEOGCS["x",DATUM["D_WGS_1984"]]') };
  let e4 = null;
  try {
    await ZONES.readShapefile([{ path: 'z/z.shp', size: 17 * 1024 * 1024, read: () => { throw new Error('read'); } },
      prjEntry], 'big.zip', []);
  } catch (e) { e4 = e; }
  check(e4 && /is 17\.0 MB; the page reads shapefiles up to 16\.0 MB/.test(e4.message),
    'Zones: a .shp over 16 MB refused before it is unpacked', e4 && e4.message);
  // GeometryCollections nested 5,000 deep: refused with a message, not a crash (only 20 levels are read).
  let deep = '{"type":"Polygon","coordinates":[[[-120,47],[-120.1,47],[-120.1,47.1],[-120,47]]]}';
  for (let k = 0; k < 5000; k++) deep = '{"type":"GeometryCollection","geometries":[' + deep + ']}';
  let e5 = null;
  try { ZONES.readGeoJson(deep, 'deep.geojson'); } catch (e) { e5 = e; }
  check(e5 && e5.name === 'ZoneError' && /^No polygons in "deep\.geojson" \(1 shape that is not a polygon left out\)/.test(e5.message),
    'Zones: collections nested 5,000 deep refused with a message', e5 && e5.message);
  // Bytes after the last record (the header gives the file's length) are ignored.
  const zipped = await ctx.window.WSDA.zip.open(blobOf('zones_shp.zip'));
  const entries = await Promise.all(zipped.entries.map(async e => {
    const bytes = await e.read();
    const data = /\.shp$/.test(e.path) ? new Uint8Array([...bytes, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) : bytes;
    return { path: e.path, size: data.length, read: async () => data };
  }));
  check(await zonesOrError(() => ZONES.readShapefile(entries, 'tail.zip', [])) === base,
    'Zones: bytes after the last shape record are ignored (the header\'s file length)');
  // A UTF-8 name cut in the middle of a letter at the field's end keeps its other letters.
  const name = new TextEncoder().encode('Ålesund Å');   // 11 bytes; the field holds 10
  const dbfBytes = new Uint8Array(32 + 32 + 1 + 11 + 1);
  const dv = new DataView(dbfBytes.buffer);
  dbfBytes[0] = 3; dv.setUint32(4, 1, true); dv.setUint16(8, 65, true); dv.setUint16(10, 11, true);
  'NAME'.split('').forEach((c, i) => { dbfBytes[32 + i] = c.charCodeAt(0); });
  dbfBytes[43] = 67; dbfBytes[48] = 10; dbfBytes[64] = 0x0d; dbfBytes[65] = 0x20;
  dbfBytes.set(name.subarray(0, 10), 66);
  const dbf = ZONES.readDbf(dbfBytes, '');
  check(dbf && dbf.records[0].NAME === 'Ålesund', 'Zones: a .dbf name cut inside a UTF-8 letter keeps the letters before it',
    dbf && dbf.records[0]);
  // A .dbf of 2-byte records holds millions of them (2.1 million in 4 MB; 16.8 million in the 32 MB
  // the page allows); only as many as the .shp has shapes are read. 4 MB here, so a reader without the limit fails
  // this check rather than running the suite out of memory.
  const bigDbfBytes = new Uint8Array(4 * 1024 * 1024);
  const bigDbfView = new DataView(bigDbfBytes.buffer);
  bigDbfBytes[0] = 3; bigDbfView.setUint32(4, 2097119, true); bigDbfView.setUint16(8, 65, true);
  bigDbfView.setUint16(10, 2, true);
  'NAME'.split('').forEach((c, i) => { bigDbfBytes[32 + i] = c.charCodeAt(0); });
  bigDbfBytes[43] = 67; bigDbfBytes[48] = 1; bigDbfBytes[64] = 0x0d;
  bigDbfBytes.fill(0x20, 65);
  const bigDbfStart = Date.now();
  const bigDbf = ZONES.readDbf(bigDbfBytes, '', 3);
  check(bigDbf && bigDbf.records.length === 3 && Date.now() - bigDbfStart < 1000,
    'Zones: a .dbf with millions of records reads only as many as the shapes',
    bigDbf && { records: bigDbf.records.length, ms: Date.now() - bigDbfStart });
  // A zone of 499,000 outline points through the map's data (a single function call cannot take that many).
  const bigRing = [];
  for (let k = 0; k < 499000; k++) bigRing.push([-120 + 0.2 * Math.cos(2 * Math.PI * k / 499000), 47 + 0.1 * Math.sin(2 * Math.PI * k / 499000)]);
  bigRing.push(bigRing[0]);
  let mdBig = null, eBig = null;
  try {
    mdBig = W.lookup.mapData({ sites: [{ id: 1, name: 'Big', lat: 47, lon: -120, radii: [0],
      zone: { type: 'Polygon', coordinates: [bigRing] } }], matched: [] }, null);
  } catch (e) { eBig = e; }
  check(!eBig && mdBig && Math.abs(mdBig.bounds[0] + 120.2) < 1e-9 && Math.abs(mdBig.bounds[2] + 119.8) < 1e-9 &&
    Math.abs(mdBig.bounds[1] - 46.9) < 1e-6 && Math.abs(mdBig.bounds[3] - 47.1) < 1e-6,
  'Map: a zone of 499,000 outline points gives the view its box (no error)', eBig ? String(eBig) : mdBig && mdBig.bounds);

  // Zones as sites in a CVI query (the zones replace circles): the rows matched are those with an endpoint inside a
  // zone by sf and GEOS; each such match is 0 km away, in ring 0, and names the zones holding it.
  const zsites = g.map(z => ({ name: z.name, lat: z.point[1], long: z.point[0], buffer_km: 25, zone: z.geometry }));
  const plan = W.lookup.prepareRun({ master: fullMaster, loading: false, sites: zsites, mode: 'single', defaultKm: 3,
    bandsText: '', endpoint: 'either', years: [], quarters: [], species: [] });
  check(!plan.stop && plan.args.sites.every(x => x.zone), 'Zones: Run query keeps each zone in Single mode');
  const zres = W.lookup.query(fullMaster, plan.args.sites, Object.assign({}, plan.args.opts, { collapse: 'cvi' }));
  const ref = ZR.files['zones.geojson'], nG = ZF.points.length, nR = fullMaster.rows.length;
  const wantRows = fullMaster.rows.map((r, i) => list(ref.holding[nG + i]).concat(list(ref.holding[nG + nR + i])))
    .map(h => [...new Set(h)].sort((p, q) => p - q));
  const wantCount = wantRows.filter(h => h.length).length;
  check(zres.status === 'ok' && zres.matched.every(r => r.nearestSiteKm === 0 && r.nearestBandKm === 0) &&
    zres.membership.every(x => x.bandKm === 0), 'Zones: every zone match is 0 km away, in ring 0', zres.status);
  // The membership (before the collapse) holds one row per master row with a hit, in the master's order: its zones
  // must be the ones sf and GEOS hold an endpoint of that row in.
  const perRow = new Map();
  zres.membership.forEach(x => perRow.set(x.row, (perRow.get(x.row) || []).concat([x.site])));
  const engineRows = [...perRow.keys()].sort((p, q) => p - q).map(k => perRow.get(k).sort((p, q) => p - q));
  const refRows = wantRows.filter(h => h.length);
  check(engineRows.length === wantCount && JSON.stringify(engineRows) === JSON.stringify(refRows),
    'Zones: the rows matched and the zones holding them equal sf and GEOS\'s (' + wantCount + ' rows)',
    [engineRows.length, wantCount]);
  const names = zres.matched.map(r => r.matchedSites);
  check(names.length > 0 && names.every(n => n.split('; ').every(x => WANT_NAMES.indexOf(x) >= 0)),
    'Zones: each matched row names its zones', names.slice(0, 3));
  tally3.zoneRows = wantCount;

  // ── Places (population.placeAt and the page's text) ──
  const PN = ctx.window.WSDA.population;
  const C = ctx.window.WSDA_CITYLIMITS.cities, PL = ctx.window.WSDA_PLACES;
  // Every city's label point names that city; every census-designated place's label point that no city limits
  // reach names that place (the build put each label inside its shape).
  let badCity = 0;
  C.forEach(c => { const p = PN.placeAt(c.label[0], c.label[1]); if (!p || p.geoid !== c.geoid || p.kind !== 'city') badCity++; });
  check(badCity === 0, 'Places: each of the ' + C.length + ' cities\' label points names that city', badCity);
  const cdps = PL.places.filter(x => x.kind === 'cdp' && x.trim === 'none');
  let badCdp = 0;
  cdps.forEach(c => { const p = PN.placeAt(c.label[0], c.label[1]); if (!p || p.geoid !== c.geoid || p.kind !== 'cdp') badCdp++; });
  check(cdps.length > 100 && badCdp === 0, 'Places: each of the ' + cdps.length + ' untrimmed census-designated places\' ' +
    'label points names that place', badCdp);
  // A grid over Washington, each point worked out here with this file's own polygon test over the decoded shapes.
  const inPoly = (x, y, rings) => rings.reduce((k, r) => {
    let c = false;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      if ((r[i][1] > y) !== (r[j][1] > y) && x < (r[j][0] - r[i][0]) * (y - r[i][1]) / (r[j][1] - r[i][1]) + r[i][0]) c = !c;
    }
    return c ? !k : k;
  }, false);
  const holds = (item, x, y) => item.shape.some(poly => inPoly(x, y, poly.map(PN.decodeRing)));
  let badGrid = 0, kinds = { city: 0, cdp: 0, none: 0 };
  for (let y = 45.6; y <= 49.0; y += 0.085) {
    for (let x = -124.6; x <= -117.0; x += 0.085) {
      const city = C.find(c => holds(c, x, y));
      const cdp = city ? null : PL.places.find(p => p.kind === 'cdp' && holds(p, x, y));
      const want = city ? city.geoid : cdp ? cdp.geoid : null;
      const p = PN.placeAt(x, y);
      if ((p ? p.geoid : null) !== want) badGrid++;
      kinds[city ? 'city' : cdp ? 'cdp' : 'none']++;
      tally3.placePoints++;
    }
  }
  check(badGrid === 0 && kinds.city > 10 && kinds.cdp > 5, 'Places: a grid of ' + tally3.placePoints + ' points over ' +
    'Washington, each place worked out here (city limits first, then census-designated places)', { badGrid, kinds });
  check(W.lookup.placeText({ name: 'Yakima', kind: 'city' }, true) === 'Yakima' &&
    W.lookup.placeText({ name: 'Spanaway', kind: 'cdp' }, true) === 'Spanaway CDP' &&
    W.lookup.placeText(null, true) === 'Outside city limits' && W.lookup.placeText(null, false) === 'Outside Washington',
  'Places: the column\'s text (a city, "<name> CDP", outside city limits, outside Washington)');

  // ── Facilities inside ──
  // A layer of points placed here at known distances from two sites (this file's own spherical step), and the Full
  // tier's origins as a layer for the zones.
  const step = (lat, lon, km, bearing) => {   // the point km away along a bearing, on CVI's sphere
    const d = km / R_KM, p1 = rad(lat), l1 = rad(lon), b = rad(bearing);
    const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
    const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
    return [p2 * 180 / Math.PI, l2 * 180 / Math.PI];
  };
  const S1 = { name: 'Site one', lat: 46.6, long: -120.5 }, S2 = { name: 'Site two', lat: 47.2, long: -119.9, buffer_km: 10 };
  const KMS = [0.2, 1.5, 2.999, 3.001, 4.5, 9.9, 10.1, 19.5, 25];
  const pts = [];
  [S1, S2].forEach((s, k) => KMS.forEach((km, j) => {
    const [la, lo] = step(s.lat, s.long, km, 37 + 41 * j);
    pts.push({ name: s.name + ' at ' + km, display: s.name + ' at ' + km, lat: la, lon: lo, county: 'Test', townName: j === 1 ? 'Town' : '' });
  }));
  const layers = [{ key: 'test', label: 'Test points', color: '#123456', points: pts },
    { key: 'other', label: 'Other points', color: '#654321', points: pts.slice(0, 3) }];
  const single = PX.prepareSites([S1, S2], { defaultKm: 3 }).sites;
  const fs1 = W.lookup.facilitiesInside(single, layers);
  // Expected here: the chord-formula distance at most the site's buffer (3 km, or Site two's own 10 km).
  const expectRows = (sites, ringOf) => {
    const out = [];
    sites.forEach(s => layers.forEach(l => {
      const found = l.points.map(p => ({ p, km: chordKm(p.lat, p.lon, s.lat, s.lon) })).filter(x => x.km <= s.bufferKm + 1e-9)
        .sort((a, b) => a.km - b.km);
      found.forEach(x => out.push([s.name, l.key, x.p.name, W.lookup.round2(x.km), ringOf(s, x.km)]));
    }));
    return out;
  };
  const rowsOf = fac => fac.rows.map(r => [r.siteName, r.layer, r.name, r.km, r.bandKm]);
  const ring1 = (s) => s.bufferKm;
  check(JSON.stringify(rowsOf(fs1)) === JSON.stringify(expectRows(single, ring1)) && fs1.total === fs1.rows.length &&
    fs1.total === 12,
    'Facilities: Single buffers (3 km, and Site two\'s own 10 km): the points inside by this file\'s distance, nearest ' +
    'first, distances rounded as R\'s round(x, 2), per site and layer', [rowsOf(fs1), fs1.total]);
  check(JSON.stringify(fs1.counts.map(c => [c.name, c.byLayer.test, c.byLayer.other, c.total])) ===
    JSON.stringify([['Site one', 3, 3, 6], ['Site two', 6, 0, 6]]), 'Facilities: the counts per site and layer (worked ' +
    'out from the distances placed: 0.2, 1.5 and 2.999 km inside 3 km; up to 9.9 km inside 10 km)', fs1.counts);
  const banded = PX.prepareSites([S1, S2], { defaultKm: 3, bands: [3, 10, 20] }).sites;
  const fs2 = W.lookup.facilitiesInside(banded, layers);
  const ringB = (s, km) => [3, 10, 20].find(r => r >= km - 1e-12);
  check(JSON.stringify(rowsOf(fs2)) === JSON.stringify(expectRows(banded, ringB)) &&
    fs2.rows.some(r => r.bandKm === 20) && fs2.rows.some(r => r.bandKm === 3),
  'Facilities: Concentric bands 3 / 10 / 20: each point in the smallest ring holding it', rowsOf(fs2));
  const ct = W.lookup.facilityCounts(fs2, banded);
  check(JSON.stringify(ct.columns) === JSON.stringify(['Site', 'Buffer', 'Test points', 'Other points', 'Total']) &&
    JSON.stringify(ct.rows[0]) === JSON.stringify(['Site one', '3 / 10 / 20 km', 8, 3, 11]),
  'Facilities: the counts table (site, buffer, one column per layer, total)', ct);
  const ft = W.lookup.facilityTable(fs1);
  check(JSON.stringify(ft.columns) === JSON.stringify(W.lookup.FACILITY_TABLE_COLUMNS) &&
    JSON.stringify(ft.rows[0]) === JSON.stringify(['Site one', 'Test points', 'Site one at 0.2', 0.2, 3, 'Test', null]),
  'Facilities: the list\'s columns and first row', ft.rows[0]);
  const twoSites = W.lookup.facilitiesInside(PX.prepareSites([S1, Object.assign({}, S1, { name: 'Site one again' })],
    { defaultKm: 3 }).sites, layers);
  check(twoSites.total === 12 && W.lookup.facilitiesMessage(twoSites).text ===
    'Found 6 facilities inside the buffers or zones of 2 site(s).', 'Facilities: the run\'s line counts each facility ' +
    'once, though two buffers hold it (12 listings, 6 facilities)', W.lookup.facilitiesMessage(twoSites).text);
  check(W.lookup.facilitiesMessage(fs1).text === 'Found 12 facilities inside the buffers or zones of 2 site(s).' &&
    W.lookup.facilitiesMessage(W.lookup.facilitiesInside(single, [])).level === 'info',
  'Facilities: the run\'s line (found, or none inside)');
  // The Full tier's origins as a layer, against the zones: inside exactly where sf and GEOS hold them.
  const originLayer = [{ key: 'origins', label: 'Origins', color: '#000000', points: fullMaster.rows.map((r, i) => ({
    name: 'row ' + i, lat: num(r['Origin.Lat']), lon: num(r['Origin.Long']) })).filter(p => p.lat !== null && p.lon !== null) }];
  const zprep = PX.prepareSites(zsites, { defaultKm: 3 }).sites;
  const fz = W.lookup.facilitiesInside(zprep, originLayer);
  let wantZ = 0;
  zprep.forEach((s, k) => fullMaster.rows.forEach((r, i) => { if (list(ref.holding[nG + i]).indexOf(k + 1) >= 0) wantZ++; }));
  check(fz.total === wantZ && fz.rows.every(r => r.km === 0 && r.bandKm === 0 && r.zone),
    'Facilities: inside the zones exactly where sf and GEOS hold the points (' + wantZ + '), each 0 km, ring 0',
    [fz.total, wantZ]);

  // ── The match map's data with zones and facilities ──
  // A facility inside two sites' buffers is listed twice; fed twice here, the map still draws it once.
  const twice = Object.assign({}, fs1, { rows: fs1.rows.concat(fs1.rows) });
  const md = W.lookup.mapData({ sites: zprep.concat(single.map((s, i) => Object.assign({}, s, { id: 5 + i }))), matched: [] }, twice);
  const zf = md.bands.filter(f => f.properties.zone);
  check(zf.length === 4 && zf.every(f => f.properties.color === '#fcb614') && md.legend.zones === 4 &&
    md.legend.rings.length === 2 && md.legend.rings[0].km === 3 && md.legend.rings[1].km === 10,
  'Map: zones drawn in the inner color; the legend lists the zones and each ring radius', md.legend);
  const zv = [].concat(...zprep.map(s => (s.zone.type === 'Polygon' ? s.zone.coordinates[0] : [].concat(...s.zone.coordinates.map(p => p[0])))));
  check(zv.every(p => p[0] >= md.bounds[0] && p[0] <= md.bounds[2] && p[1] >= md.bounds[1] && p[1] <= md.bounds[3]),
    'Map: the view holds every zone');
  check(md.facilities.length === 12 && JSON.stringify(md.legend.facilities) === JSON.stringify([
    { label: 'Test points', color: '#123456', n: 9 }, { label: 'Other points', color: '#654321', n: 3 }]),
  'Map: one dot per facility and layer, however often it is listed (12), counted per layer in the legend',
  [md.facilities.length, md.legend.facilities]);

  // ── The CSVs ──
  // Numbers as write.table writes them, one by one (the reference wrote each).
  let badNum = 0;
  FX.csvNumbers.forEach((x, i) => {
    if (W.exports.writeNumber(x) !== list(REF.csv_numbers)[i]) badNum++;
    tally3.numbers++;
  });
  check(badNum === 0 && FX.csvNumbers.length > 100, 'CSV: ' + FX.csvNumbers.length + ' numbers written as R\'s ' +
    'write.table writes them', FX.csvNumbers.map((x, i) => [W.exports.writeNumber(x), list(REF.csv_numbers)[i]])
    .filter(p => p[0] !== p[1]).slice(0, 4));
  // The matched rows: CVI's own Export CSV for each Run query case (its module, run by the reference), byte for byte.
  FM.runs.forEach((cs, i) => {
    const cvi = MOD.runs[i];
    const sites = cs.sites.map(x => ({ name: x.name, lat: PX.number(x.lat), long: PX.number(x.long),
      buffer_km: PX.number(x.buffer_km === undefined ? null : x.buffer_km),
      bands_csv: x.bands_csv === undefined ? null : x.bands_csv }));
    const plan = W.lookup.prepareRun({ master: masterOf(cs.master), loading: false, sites, mode: cs.mode,
      defaultKm: cs.default_buffer_km, bandsText: cs.band_radii, endpoint: cs.endpoint,
      years: cs.years.map(Number), quarters: cs.quarters, species: cs.species });
    if (plan.stop) return;
    const res = W.lookup.query(masterOf(cs.master), plan.args.sites, plan.args.opts);
    if (W.lookup.afterRun(res).keep !== 'store') return;
    tally3.csvRuns++;
    const page = W.exports.lookupMatchesCsv(masterOf(cs.master), res).text;
    if (cs.name === 'repeated rows') {
      // The page's rule keeps the repeated within-state rows: with CVI's collapse the file is CVI's; with the page's
      // rule it has CVI's lines and exactly the extra rows.
      const cviRule = W.lookup.query(masterOf(cs.master), plan.args.sites, Object.assign({}, plan.args.opts, { collapse: 'cvi' }));
      const a = page.split('\n'), b = cvi.csv.split('\n');
      check(W.exports.lookupMatchesCsv(masterOf(cs.master), cviRule).text === cvi.csv &&
        a.length - b.length === res.matched.length - cviRule.matched.length && b.every(line => a.indexOf(line) >= 0),
      'CSV "' + cs.name + '": with CVI\'s collapse, CVI\'s file byte for byte; with the page\'s rule, CVI\'s lines and the repeated rows',
      [a.length, b.length]);
      return;
    }
    check(page === cvi.csv, 'CSV "' + cs.name + '": the matched rows exactly as CVI\'s Export CSV writes them',
      page.split('\n').find((line, k) => line !== cvi.csv.split('\n')[k]));
  });
  check(tally3.csvRuns === 13, 'CSV: compared with CVI\'s file in every run case that shows a result (13)', tally3.csvRuns);
  const facCsv = W.exports.lookupFacilitiesCsv(fs1.rows).text.split('\n');
  check(facCsv[0] === '"site","site_lat","site_long","layer","facility","facility_lat","facility_long","distance_km",' +
    '"band_km","county","town"' && facCsv.length === fs1.rows.length + 2 &&
    facCsv[2] === '"Site one",46.6,-120.5,"Test points","Site one at 1.5",' + W.exports.writeNumber(pts[1].lat) + ',' +
    W.exports.writeNumber(pts[1].lon) + ',1.5,3,"Test","Town"',
  'CSV: the facilities inside, one line per site and facility, written the same way', facCsv.slice(0, 3));
  check(W.exports.writeField('Inf', 'double') === 'Inf' && W.exports.writeField('-Inf', 'double') === '-Inf' &&
    W.exports.writeField('NaN', 'double') === 'NA' && W.exports.writeField(null, 'double') === 'NA' &&
    W.exports.writeNumber(NaN) === 'NA', 'CSV: Inf and -Inf written as R writes them, NaN and a missing value as NA ' +
    '(as R\'s write.csv writes them)');
  check(W.exports.lookupFacilitiesCsv([]).text === '"Note"\n"No facilities inside the buffers."\n' &&
    W.exports.lookupMatchesCsv(fullMaster, { matched: [] }).text === '"Note"\n"No matches."\n',
  'CSV: with nothing to list, a one-cell note (CVI\'s for the matched rows)');
  const params = JSON.parse(W.exports.lookupParams({ masterFile: 'm.csv', mode: 'bands', defaultKm: 3, bands: [3, 10, 20],
    endpoint: 'either', years: [2024, 2025], quarters: ['Q1'], species: [], layers: ['Feedlots'],
    sites: [{ name: 'A', lat: 46.5, long: -120.5, buffer_km: null, bands_csv: '1, 2' },
      { name: 'Z', lat: 47, long: -121, buffer_km: null, bands_csv: null, zoneFile: 'z.kml' },
      { name: null, lat: 47.5, long: -120, buffer_km: 5, bands_csv: null }],
    formats: ['matches_csv', 'facilities_csv'], counts: { cvis: 12, facilities: 4 } }, new Date(2026, 9, 14, 9, 5, 7)));
  check(params.tool === 'premise_lookup' && params.buffer_style === 'concentric_bands' &&
    JSON.stringify(params.band_radii_km) === '[3,10,20]' && JSON.stringify(params.default_buffer_km) === '{}' &&
    params.quarters === 'Q1' && JSON.stringify(params.species) === '{}' && params.facility_layers === 'Feedlots' &&
    JSON.stringify(params.sites) === JSON.stringify(['A (46.5, -120.5; bands 1, 2 km)', 'Z (47, -121; zone from z.kml)',
      ' (47.5, -120; global bands)']) &&
    params.cvis_matched === 12 && params.facilities_inside === 4 && params.exported_at === '2026-10-14 09:05:07',
  'CSV: export_params.json for a Premise Lookup export', params);

  // ── Run query without a master (facilities only) ──
  const fo = W.lookup.prepareRun({ master: null, loading: false, sites: [S1], mode: 'single', defaultKm: 3,
    bandsText: '', endpoint: 'either', years: [], quarters: [], species: [], facilitiesOnly: true });
  const fo2 = W.lookup.prepareRun({ master: null, loading: false, sites: [], mode: 'single', defaultKm: 3,
    bandsText: '', endpoint: 'either', years: [], quarters: [], species: [], facilitiesOnly: true });
  check(!fo.stop && fo.args.sites.length === 1 && fo2.stop && fo2.messages[0].text === 'Add at least one site with valid lat/long.',
    'Run: facilities only skips the master\'s checks and keeps the others');
}

// ── The branded proximity PNG ────────────────────────────────────────────────────────────────────────────────────
// Each case of scenarios.json "pngs" against CVI's own page (render_branded_proximity_map through its module,
// recorded by the R reference in oracle_s11_png.json): the page runs the same query with its own engine, then
// brandedmaps.proximity draws the page; CVI's style (branded.CVI_STYLE) is used where CVI's places are compared.
// Independent of both: the facilities inside worked out here from CVI's own overlay points with this file's haversine,
// the triangle's area, and hand cases CVI has no page for (zones, a facilities-only run, the population layers).
const PNG_REF_FILE = path.join(ROOT, 'local-test-artifacts', 's11', 'oracle_s11_png.json');
const tally4 = { cases: 0, texts: 0, points: 0, corners: {} };
function day4() {
  if (!fs.existsSync(PNG_REF_FILE)) {
    check(false, 'PNG: the reference oracle_s11_png.json exists (run the R reference)');
    return;
  }
  const PR = JSON.parse(fs.readFileSync(PNG_REF_FILE, 'utf8'));
  check(PR.fixtures_sha === FIXTURES_SHA && PR.cases.length === FX.pngs.length,
    'PNG: the reference was made from these fixtures, one record per case', [PR.cases.length, FX.pngs.length]);
  const BM = W.brandedmaps, BR = ctx.window.WSDA.branded;
  const COUNTIES = ctx.window.CVIWA_GEO.counties.features;
  const DATE = new Date(2026, 9, 14);   // the reference's pinned date
  const OVERLAY_KEYS = { overlay_slaughter_sf: 'slaughterhouses', overlay_fair_sf: 'fairgrounds',
    overlay_markets_sf: 'markets', overlay_feedlots_sf: 'feedlots', overlay_restricted_sf: 'restricted' };
  const REG = new Map(ctx.window.WSDA.facilities.BUILTIN.map(b => [b.key, b]));
  const texts = p => p.plot.layers.filter(l => l.geom === 'GeomText').map(l => l.data[0]);
  const pts = p => p.plot.layers.filter(l => l.geom === 'GeomPoint').map(l => l.data[0]);
  const multiset = list => list.map(q => q[0].toFixed(6) + ',' + q[1].toFixed(6)).sort().join(';');
  const hav = (lat1, lon1, lat2, lon2) => {
    const R = 6378137, t = Math.PI / 180;
    const a = Math.sin((lat2 - lat1) * t / 2) ** 2 + Math.cos(lat1 * t) * Math.cos(lat2 * t) * Math.sin((lon2 - lon1) * t / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(a))) / 1000;
  };
  function pageRun(cs) {
    const m = masterOf(cs.master);
    const plan = W.lookup.prepareRun({ master: m, loading: false, sites: cs.sites.map(s => Object.assign({ buffer_km: null }, s)),
      mode: cs.mode, defaultKm: cs.default_buffer_km, bandsText: cs.band_radii, endpoint: cs.endpoint,
      years: cs.years.map(Number), quarters: cs.quarters, species: cs.species });
    return { m, plan, res: plan.stop ? null : W.lookup.query(m, plan.args.sites, plan.args.opts) };
  }
  for (const pc of FX.pngs) {
    const rec = PR.cases.find(c => c.name === pc.name);
    const tag = pc.name;
    if (!rec || !rec.page) { check(false, 'PNG: ' + tag + ' recorded by the reference', rec && rec.error); continue; }
    tally4.cases++;
    const { m, plan, res } = pageRun(pc.run);
    if (!res) { check(false, 'PNG: ' + tag + ' the page runs the query', plan.messages); continue; }
    const cv = rec.render;
    // The run itself: the page's sites, counts and summary are CVI's.
    check(res.status === rec.status && res.sites.length === cv.sites.length && res.sites.every((s, i) => s.name === cv.sites[i].name &&
      s.lat === cv.sites[i].lat && s.lon === cv.sites[i].long), 'PNG: ' + tag + ' the sites drawn are CVI\'s', cv.sites);
    const sm = cv.summary;
    check(res.summary.cvis === sm.n_cvis && res.summary.animals === sm.n_animals && res.summary.origins === sm.n_origins &&
      res.summary.dests === sm.n_dests && res.summary.sitesHit === sm.n_sites_hit, 'PNG: ' + tag + ' the summary is CVI\'s', [res.summary, sm]);
    check(JSON.stringify(res.siteCvis) === JSON.stringify(list(cv.site_match_counts)) &&
      JSON.stringify(res.siteOrigins) === JSON.stringify(list(cv.site_origin_counts)) &&
      JSON.stringify(res.siteDests) === JSON.stringify(list(cv.site_dest_counts)), 'PNG: ' + tag + ' the per-site counts are CVI\'s');
    // The facility layers: CVI's own points of each ticked layer (from the same files), as the page's layers.
    const layers = Object.keys(cv.overlays || {}).map(k => {
      const reg = REG.get(OVERLAY_KEYS[k]);
      const o = cv.overlays[k];
      return { key: reg.key, label: reg.liveLabel, pngLabel: reg.label, color: reg.color,
        points: list(o.name).map((n, i) => ({ name: n, lon: list(o.lon)[i], lat: list(o.lat)[i] })) };
    }).sort((a, b) => [...REG.keys()].indexOf(a.key) - [...REG.keys()].indexOf(b.key));
    check(layers.length === pc.overlays.length, 'PNG: ' + tag + ' CVI drew the layers ticked', layers.map(l => l.key));
    const fac = layers.length ? W.lookup.facilitiesInside(res.sites, layers) : null;
    const input = { sites: res.sites, bandsMode: res.bandsMode, endpoint: plan.args.opts.endpoint, summary: res.summary,
      siteCvis: res.siteCvis, siteOrigins: res.siteOrigins, siteDests: res.siteDests, matched: res.matched,
      filters: plan.args.opts.filters, universe: m.speciesChoices, counties: COUNTIES, date: DATE, fac, labels: pc.labels,
      background: pc.basemap === 'flat' ? 'standard' : pc.basemap,
      streets: pc.basemap === 'vector:streets' ? ctx.window.WSDA_STREETS : null };
    const built = BM.proximity(input);
    const cvi = BM.proximity(input, BR.CVI_STYLE);
    const md = built.model;
    const pg = rec.page;
    const [mapPlot, headerPlot] = pg;
    const labels = pg.filter(e => e.kind === 'label');
    const plots = pg.filter(e => e.kind === 'plot');
    const [, , boxPlot, panelPlot, keyPlot, insetPlot, scalePlot] = plots;

    // Page, header, rows.
    check(rec.png.width === BR.pixelSize(200).width && rec.png.height === BR.pixelSize(200).height &&
      md.fileName === 'premise_proximity_2026-10-14.png', 'PNG: ' + tag + ' page size and CVI\'s file name', [rec.png, md.fileName]);
    const ht = texts(headerPlot);
    check(md.title === ht[2].label && md.titleSize === ht[2].size, 'PNG: ' + tag + ' title and its size', [md.title, ht[2].label]);
    const wantLabels = [md.meta.left, md.meta.right, md.stats.left[0].prefix, md.stats.left[0].value];
    check(JSON.stringify(labels.map(l => l.label)) === JSON.stringify(wantLabels), 'PNG: ' + tag + ' endpoint, date and period',
      [labels.map(l => l.label), wantLabels]);
    // Value boxes.
    const bt = boxPlot.plot.layers.slice(1).map(l => l.data.map(d => d.label));
    check(near(boxPlot.x, 0.46, 1e-9) && near(boxPlot.width, BR.LAYOUT.mapW - 0.46, 1e-9) &&
      JSON.stringify(boxPlot.plot.layers[0].data.map(r => r.fill.toLowerCase())) === JSON.stringify(md.boxes.map(b => b.color)) &&
      JSON.stringify(bt[0]) === JSON.stringify(md.boxes.map(b => b.value)) &&
      JSON.stringify(bt[1]) === JSON.stringify(md.boxes.map(b => b.label)), 'PNG: ' + tag + ' Sites, CVIs and Animals boxes', [bt, md.boxes]);

    // The QUERY SITES panel: region, every text with its size and place.
    check(near(panelPlot.x, BR.LAYOUT.gutterX, 1e-9) && near(panelPlot.y, md.panelY, 1e-9) && near(panelPlot.height, 0.46, 1e-9),
      'PNG: ' + tag + ' panel region', [panelPlot.y, md.panelY]);
    // Each text: [label, size, y, x, hjust] (x and hjust: the left column at 0.05, the right at 0.96, as CVI's), in
    // CVI's style (the page's own panel lists 8 at most, by matches: checked below).
    const P = cvi.model.panel;
    const want = [['QUERY SITES', 3.4, 1 - P.hdrH / 2, 0.5, 0.5], ['Site', 2.5, P.colKeyY, 0.05, 0],
      [md.panelKey, 2.5, P.colKeyY, 0.96, 1]];
    for (const r of P.rows) {
      want.push([r.name, r.nameSize, r.nameY, 0.05, 0], [r.count, r.countSize, r.nameY, 0.96, 1]);
      if (r.subLeft) want.push([r.subLeft, r.subSize, r.subY, 0.05, 0]);
      if (r.od) want.push([r.od, r.subSize, r.odY, r.odRight ? 0.96 : 0.05, r.odRight ? 1 : 0]);
    }
    if (P.more) want.push([P.more, 2.7, P.footTop + 0.02, 0.5, 0.5]);
    if (P.empty) want.push(['No sites', 3.0, (P.rowsTop + P.footTop) / 2, 0.5, 0.5]);
    md.footer.forEach(([l, v], i) => want.push([l, 3.4, P.footTop - 0.050 - i * 0.064, 0.06, 0],
      [v, 3.9, P.footTop - 0.050 - i * 0.064, 0.94, 1]));
    const got = texts(panelPlot).map(t => [t.label, t.size, t.y, t.x, t.hjust]);
    check(got.length === want.length && got.every((g, i) => g[0] === want[i][0] && near(g[1], want[i][1], 1e-9) &&
      near(g[2], want[i][2], 1e-9) && near(g[3], want[i][3], 1e-9) && g[4] === want[i][4]),
    'PNG: ' + tag + ' panel texts, sizes, places and sides', { cvi: got.slice(0, 12), page: want.slice(0, 12) });
    // The page draws each line on the side CVI does (the SVG's text anchor for the orig / dest line).
    const svgP = BR.svg(cvi.parts);
    check(P.rows.filter(r => r.od).every(r => (svgP.indexOf('text-anchor="end">' + BR.esc(r.od) + '<') >= 0) === r.odRight),
      'PNG: ' + tag + ' the orig / dest lines drawn on their side');
    // The page's panel (by design): at most 8 sites, the most matches first (ties in table order), every
    // name at one size and within the column (cut with "…"), and a note of the sites not listed.
    const PP = md.panel;
    const counts = res.siteCvis;
    const wantOrder = res.sites.map((x, i) => i).sort((a, b) => counts[b] - counts[a] || a - b).slice(0, 8);
    const room = r => (0.96 - 0.05) * BR.px(BR.LAYOUT.gutterW) - BR.textWidth(r.count, BR.textPt(r.countSize), true) - 6;
    const full = i => String(res.sites[i].name);
    check(JSON.stringify(PP.order) === JSON.stringify(wantOrder) && PP.rows.every((r, k) => r.site === wantOrder[k] &&
      r.count === String(counts[wantOrder[k]].toLocaleString('en-US'))) &&
      new Set(PP.rows.map(r => r.nameSize)).size <= 1 &&
      PP.rows.every(r => BR.textWidth(r.name, BR.textPt(r.nameSize), true) <= room(r) + 1e-9) &&
      PP.rows.every(r => r.name === full(r.site) || (/…$/.test(r.name) && full(r.site).indexOf(r.name.slice(0, -1)) === 0)) &&
      (res.sites.length > 8 ? PP.more === (res.sites.length - 8) + ' more site' + (res.sites.length === 9 ? '' : 's') +
        ' not listed (ranked by matches)' : PP.more === null),
    'PNG: ' + tag + ' the page\'s panel: 8 sites at most, by matches, one name size, names within the column, the note',
    PP.rows.map(r => [r.site, r.name, r.nameSize, r.count]).concat([PP.more]));
    // County names: whole unless the line would run into the counts on its right, measured here.
    const ctyOk = PP.rows.every(r => {
      const full = BM.siteCounty(res.sites[r.site], COUNTIES);
      if (!full) return true;
      const subPt = BR.textPt(r.subSize);
      const room = (0.96 - 0.05) * BR.px(BR.LAYOUT.gutterW) - (r.od && r.odRight ? BR.textWidth(r.od, subPt) + 6 : 0);
      const fits = BR.textWidth(r.subLeft, subPt) <= room + 1e-9;
      const whole = r.subLeft.indexOf(full) === 0;
      const wholeFits = BR.textWidth(r.subLeft.replace(/^[^·]*?(?=  ·|$)/, full), subPt) <= room + 1e-9;
      return fits && (whole || !wholeFits);
    });
    check(ctyOk, 'PNG: ' + tag + ' county names whole where they fit, cut with "…" only when they do not',
      PP.rows.map(r => [r.subLeft, r.od]));
    tally4.countiesWhole = (tally4.countiesWhole || 0) + PP.rows.filter(r => BM.siteCounty(res.sites[r.site], COUNTIES) &&
      r.subLeft.indexOf(BM.siteCounty(res.sites[r.site], COUNTIES)) === 0).length;
    // The inset: on a corner whose box touches no site triangle (worked out here), when one is
    // free; CVI's style keeps the bottom right.
    const ib = md.inset.box;
    const underInset = md.sites.filter(q => q.x + 4 > ib.x0 && q.x - 4 < ib.x1 && q.y + 4 > ib.y0 && q.y - 4 < ib.y1);
    // CVI's corner (bottom right), worked out here from the page's fixed layout: which site triangles lie under it.
    const brX0 = BR.px(BR.LAYOUT.mapW - 0.138), brY0 = BR.py(0.030 + 0.0715), brY1 = BR.py(0.030);
    const underCvi = md.sites.filter(q => q.x + 4 > brX0 && q.y + 4 > brY0 && q.y - 4 < brY1).map(q => q.name);
    const anyClear = md.inset.scores.some(c => c.covers === 0);
    check((anyClear ? md.inset.covers === 0 && underInset.length === 0 : md.inset.covers > 0) &&
      (!underCvi.length || md.inset.corner !== 'bottom right'), 'PNG: ' + tag + ' the inset covers no site when a corner is ' +
      'clear (' + md.inset.corner + ')', { corner: md.inset.corner, under: underInset.map(q => q.name), underCvi, scores: md.inset.scores });
    if (tag === 'single, three sites') {
      check(underCvi.length === 1 && /^Farm B/.test(underCvi[0]) && md.inset.corner !== 'bottom right',
        'PNG: single, three sites: Farm B lies under CVI\'s corner, so the inset moved', underCvi);
    }
    check(cvi.model.inset.corner === 'bottom right', 'PNG: ' + tag + ' CVI\'s style keeps the inset at the bottom right');
    tally4.corners[md.inset.corner] = (tally4.corners[md.inset.corner] || []).concat([tag]);
    // The key's rows packed: each next row within 16 points, never overlapping.
    // A heading between two rows (FACILITY LOCATIONS) adds its own line, so only rows with no heading between count.
    const kr = md.keyRows;
    const itemsRows = md.keyItems.map((it, i) => (it.type === 'row' ? i : -1)).filter(i => i >= 0);
    const headed = k => md.keyItems.slice(itemsRows[k - 1] + 1, itemsRows[k]).some(it => it.type !== 'row');
    check(kr.length > 1 && kr.length === itemsRows.length && kr.every((r, k) => !k || ((headed(k) || r.y - kr[k - 1].y <= 16) &&
      r.y - kr[k - 1].y >= r.r + kr[k - 1].r - 1e-9)) &&
      md.keyHeight <= cvi.model.keyHeight + 1e-9, 'PNG: ' + tag + ' the key\'s rows packed, never overlapping',
    kr.map(r => Math.round(r.y * 10) / 10));
    tally4.texts += got.length;

    // The MAP KEY: CVI's texts where the page keeps CVI's labels; one row per radius where CVI's colors would not
    // match the rings drawn (a recorded difference); the facility rows name the ticked layers with their counts inside.
    const kt = texts(keyPlot).map(t => t.label);
    const pageKey = md.keyItems.map(i => i.label);
    const ringLabel = l => /^(Search buffer|Search zone|Inner zone|Middle zone|Outer zone|Zone \d)/.test(l);
    const strip = a => a.filter(l => !ringLabel(l) && !/^Within /.test(l) && l !== 'FACILITY LOCATIONS' &&
      !list(layers).some(x => l.indexOf(x.pngLabel) === 0));
    check(JSON.stringify(strip(kt)) === JSON.stringify(strip(pageKey)), 'PNG: ' + tag + ' key: site, origins and destinations as CVI\'s',
      [kt, pageKey]);
    if (md.ringMode === 'radius') {
      check((kt.indexOf('Search buffer') >= 0 || kt.some(l => /zone/.test(l))) && pageKey.filter(l => /^Within /.test(l)).length ===
        md.levels.length, 'PNG: ' + tag + ' key: one row per radius drawn where CVI\'s rows would not match the rings', [kt, pageKey]);
    } else {
      check(JSON.stringify(kt.filter(ringLabel)) === JSON.stringify(pageKey.filter(ringLabel)), 'PNG: ' + tag +
        ' key: the ring rows as CVI\'s', [kt, pageKey]);
    }
    if (layers.length) {
      const facRows = md.keyItems.filter(i => / inside$/.test(i.label));
      const inKt = kt.filter(l => layers.some(x => x.pngLabel === l));
      check(kt.indexOf('FACILITY LOCATIONS') >= 0 && pageKey.indexOf('FACILITY LOCATIONS') >= 0 &&
        facRows.every(i => inKt.indexOf(i.label.split(':')[0]) >= 0), 'PNG: ' + tag + ' key: facility rows are CVI\'s layers, ' +
        'with the counts inside', [inKt, facRows.map(i => i.label)]);
    }
    // CVI's style places the key's rows where CVI's do (same items: no facility or ring-row difference).
    if (JSON.stringify(kt) === JSON.stringify(cvi.model.keyItems.map(i => i.label))) {
      const ky = pts(keyPlot).map(q => q.y);
      check(near(keyPlot.y, cvi.model.keyY, 1e-9) && near(keyPlot.height, cvi.model.keyHeight, 1e-9) &&
        cvi.model.keyRows.length === ky.length && cvi.model.keyRows.every((r, i) => near(r.frac, ky[i], 1e-9)),
      'PNG: ' + tag + ' key: CVI\'s style puts the rows at CVI\'s places', [ky, cvi.model.keyRows.map(r => r.frac)]);
    }
    // The page's own key: rows never overlap, the box below the panel.
    check(md.keyY + md.keyHeight <= md.panelY - 0.008 + 1e-9, 'PNG: ' + tag + ' key below the panel', [md.keyY, md.keyHeight]);

    // The map: the box CVI fits (its limits after aspect correction), the rings, points, sites and their names.
    check(near(md.corrected.west, mapPlot.plot.x_range[0], 1e-6) && near(md.corrected.east, mapPlot.plot.x_range[1], 1e-6) &&
      near(md.corrected.south, mapPlot.plot.y_range[0], 1e-6) && near(md.corrected.north, mapPlot.plot.y_range[1], 1e-6),
    'PNG: ' + tag + ' map box as CVI\'s (buffers + 10%, at least 0.15 degrees, aspect-corrected)',
    { page: md.corrected, cvi: [mapPlot.plot.x_range, mapPlot.plot.y_range] });
    const ML = mapPlot.plot.layers;
    // CVI's rings: the polygon layer outlined in its ring grays (Streets adds polygon layers of its own).
    const polyLayer = ML.find(l => l.geom === 'GeomSf' && l.data.length && ['#9aa3ab', '#b3bbc2', '#cfd4d9']
      .indexOf(String(l.data[0].colour).toLowerCase()) >= 0);
    check(polyLayer && polyLayer.rows === md.rings.filter(r => !r.zone).length, 'PNG: ' + tag + ' one ring per site and band',
      [polyLayer && polyLayer.rows, md.rings.length]);
    const pointLayers = ML.filter(l => l.geom === 'GeomSf' && JSON.stringify(list(l.geometry)) === '["POINT"]');
    const byFill = c => pointLayers.find(l => String(l.data[0].fill).toUpperCase().indexOf(c.toUpperCase()) === 0);
    const oL = byFill('#F0A06E'), dL = byFill('#1C9CD9');
    const sL = pointLayers.find(l => l.data[0].shape === 24 && l.data[0].fill === '#c0392b' && l.data[0].size === 6);
    check(multiset(md.origins.map(q => [q.lon, q.lat])) === multiset(oL ? oL.data.map(d => [d.x, d.y]) : []) &&
      multiset(md.dests.map(q => [q.lon, q.lat])) === multiset(dL ? dL.data.map(d => [d.x, d.y]) : []),
    'PNG: ' + tag + ' matched origins and destinations drawn as CVI\'s', [md.origins.length, oL && oL.rows, md.dests.length, dL && dL.rows]);
    tally4.points += md.origins.length + md.dests.length;
    check(sL && multiset(md.sites.map(q => [q.lon, q.lat])) === multiset(sL.data.map(d => [d.x, d.y])) &&
      sL.data.every(d => d.size === 6 && d.stroke === 1 && d.fill === '#c0392b'), 'PNG: ' + tag + ' sites as CVI\'s triangles');
    // The page draws each site CVI places as a bullseye (by design), at the same place: a white-centered red
    // ring and a red dot, on the map and in the inset.
    const rings = [...BR.svg(built.parts).matchAll(/<circle cx="([\d.]+)" cy="([\d.]+)" r="([\d.]+)" fill="#ffffff" stroke="#c0392b"[^>]*\/><circle cx="\1" cy="\2" r="([\d.]+)" fill="#c0392b"/g)];
    const onMap = md.sites.filter(q => rings.some(t => Math.abs(Number(t[1]) - q.x) < 0.01 && Math.abs(Number(t[2]) - q.y) < 0.01));
    check(onMap.length === md.sites.length && rings.length === md.sites.length + md.insetSites + 1,
      'PNG: ' + tag + ' each site a bullseye at its place (and in the inset and the key\'s Query site row)', [onMap.length, md.sites.length, rings.length, md.insetSites]);
    const shadow = ML.find(l => l.geom === 'GeomShadowText' && l.data[0].fontface === 'bold' && l.data[0].size === 3.4);
    check(shadow && JSON.stringify(shadow.data.map(d => d.label).sort()) === JSON.stringify(md.siteNames.map(n => n.name).sort()) &&
      shadow.data.every(d => d.size === 3.4 && d.fontface === 'bold' && d.colour === '#222222'), 'PNG: ' + tag + ' site names as CVI\'s');
    // Facilities: exactly the points of CVI's layers inside a buffer, by this file's own distance (the edge counts).
    if (layers.length) {
      const inside = layers.map(l => ({ key: l.key, pts: l.points.filter(q => res.sites.some(s =>
        hav(s.lat, s.lon, q.lat, q.lon) <= Math.max(...s.radii) + 1e-9)) })).filter(l => l.pts.length);
      check(JSON.stringify(inside.map(l => l.key)) === JSON.stringify(md.facilities.map(l => l.key)) &&
        inside.every((l, i) => multiset(l.pts.map(q => [q.lon, q.lat])) === multiset(md.facilities[i].points.map(q => [q.lon, q.lat]))),
      'PNG: ' + tag + ' facilities drawn: those inside a buffer (worked out here)', [inside.map(l => l.pts.length),
        md.facilities.map(l => l.points.length)]);
      const other = BM.proximity(Object.assign({}, input, { labels: !pc.labels })).model;
      const total = md.facilities.reduce((n, l) => n + l.points.length, 0);
      check(total > 0 && md.facilityNames.length === (pc.labels ? total : 0) && other.facilityNames.length === (pc.labels ? 0 : total),
        'PNG: ' + tag + ' facility names exactly when Show facility labels is ticked (and none when it is not)',
        [md.facilityNames.length, other.facilityNames.length]);
    }
    // Inset, scale bar.
    check(near(insetPlot.x, BR.LAYOUT.mapW - 0.138, 1e-9) && insetPlot.plot.layers[1].rows === md.insetSites,
      'PNG: ' + tag + ' inset with one mark per site');
    const sbt = texts(scalePlot).map(t => t.label);
    const seg = scalePlot.plot.layers[0].data[0];
    check(md.scale && JSON.stringify(sbt) === JSON.stringify([md.scale.kmLabel, md.scale.miLabel]) &&
      Math.abs(md.scale.frac - (seg.xend - seg.x)) / (seg.xend - seg.x) < 0.05, 'PNG: ' + tag + ' scale bar', [sbt, md.scale]);

    // Recorded differences: rings in the page's three colors by radius among all radii; names beside the markers.
    const svg = BR.svg(built.parts);
    const H = ['#fcb614', '#8fc965', '#a7d7e2'];   // the page's ring colors, by design
    check(md.ringColors.every((c, i) => c === H[Math.min(i, 2)]) && md.rings.every(r =>
      svg.indexOf('fill="' + r.color + '" fill-opacity="' + BM.PROX_RING_OPACITY + '"') >= 0), 'PNG: ' + tag + ' rings in the page\'s colors');
    check(md.siteNames.every(n => !(n.at.box.x0 < md.sites.find(s => s.name === n.name).x && n.at.box.x1 >
      md.sites.find(s => s.name === n.name).x && n.at.box.y0 < md.sites.find(s => s.name === n.name).y &&
      n.at.box.y1 > md.sites.find(s => s.name === n.name).y)), 'PNG: ' + tag + ' site names beside their markers, not on them');
    check(svg.indexOf('>' + BR.esc(md.source) + '<') >= 0 && /^Data: WSDA Animal Services CVI records/.test(md.source),
      'PNG: ' + tag + ' source line', md.source);
  }

  // ── Hand cases ──
  // R's filled triangle has the circle's area (engine.c: TRC0 = sqrt(4 pi / (3 sqrt 3))), worked out here.
  const tri = BM.shapeMark(24, 0, 0, 6, 1, '#000', 1, '#fff').match(/M([-\d.]+) ([-\d.]+)L([-\d.]+) ([-\d.]+)L([-\d.]+) ([-\d.]+)Z/)
    .slice(1).map(Number);
  const triArea = Math.abs((tri[2] - tri[0]) * (tri[5] - tri[1]) - (tri[4] - tri[0]) * (tri[3] - tri[1])) / 2;
  const fs6 = 6 * 72.27 / 25.4 + 1 * (96 / 25.4) / 2;
  check(Math.abs(triArea - Math.PI * (0.375 * fs6) ** 2) / triArea < 0.01, 'PNG: the site triangle has the area of R\'s circle',
    [triArea, Math.PI * (0.375 * fs6) ** 2]);
  check(JSON.stringify([1, 2, 3, 4].map(n => BM.genericZoneLabels(n))) === JSON.stringify([['Search zone'],
    ['Inner zone', 'Outer zone'], ['Inner zone', 'Middle zone', 'Outer zone'],
    ['Zone 1 (inner)', 'Zone 2', 'Zone 3', 'Zone 4 (outer)']]), 'PNG: CVI\'s generic zone names (.generic_zone_labels)');
  // Zones: a zone site is drawn as its polygon in the inner color, "Zone" in the panel, "Zone (from file)" in the key.
  const sq = { type: 'Polygon', coordinates: [[[-120.6, 46.5], [-120.4, 46.5], [-120.4, 46.7], [-120.6, 46.7], [-120.6, 46.5]]] };
  const zp = PX.prepareSites([{ name: 'Square', lat: 46.6, long: -120.5, zone: sq }, { name: 'Circle', lat: 47, long: -120,
    buffer_km: 5 }], { defaultKm: 3 });
  const zm = BM.proximity({ sites: zp.sites, bandsMode: false, endpoint: 'either', summary: { cvis: 0, animals: 0, origins: 0,
    dests: 0, sitesHit: 0 }, siteCvis: [0, 0], siteOrigins: [0, 0], siteDests: [0, 0], matched: [],
  filters: { year: [], quarter: [], species: [] }, universe: [], counties: COUNTIES, date: DATE }).model;
  check(zm.rings.some(r => r.zone && r.color === BM.PROX_RING[0]) && zm.panel.rows[0].subLeft === 'Yakima  ·  Zone' &&
    zm.panel.rows[1].subLeft === 'Grant  ·  5 km' && zm.keyItems.some(i => i.label === 'Zone (from file)'),
  'PNG: a zone drawn in the inner color, "Zone" in the panel, "Zone (from file)" in the key', [zm.panel.rows, zm.keyItems]);
  check(zm.corrected.west <= -120.6 && zm.corrected.east >= -119.9, 'PNG: the map box holds the zone and the buffer');
  // A facilities-only page (no CVI match): its title, boxes, panel column and footer count the facilities inside.
  const fl = [{ key: 'feedlots', label: 'Feedlots', pngLabel: 'Feedlots', color: '#0097a7', points: [{ name: 'F1', lat: 46.6,
    lon: -120.5 }, { name: 'F2', lat: 46.61, lon: -120.5 }, { name: 'Far', lat: 48, lon: -118 }] }];
  const fp = PX.prepareSites([{ name: 'One', lat: 46.6, long: -120.5 }, { name: 'Two', lat: 47.5, long: -122 }], { defaultKm: 3 });
  const ff = W.lookup.facilitiesInside(fp.sites, fl);
  const fm = BM.proximity({ sites: fp.sites, bandsMode: false, facilitiesOnly: true, fac: ff, counties: COUNTIES, date: DATE,
    filters: { year: [], quarter: [], species: [] } }).model;
  check(fm.title === 'FACILITY PROXIMITY ASSESSMENT - 2 SITES' && JSON.stringify(fm.boxes.map(b => b.value)) === '["2","2","1"]' &&
    fm.panelKey === 'Facilities' && fm.panel.rows[0].count === '2' && fm.panel.rows[1].count === '0' && !fm.panel.rows[0].od &&
    JSON.stringify(fm.footer) === '[["Facilities inside","2"],["Layers","1"],["Sites w/ hits","1"]]' &&
    fm.keyItems.some(i => i.label === 'Feedlots: 2 inside') && fm.origins.length === 0 &&
    fm.source === 'Data: facility layers as loaded · County boundaries: U.S. Census Bureau',
  'PNG: a facilities-only page counts the facilities inside', fm);
  // The population layers: drawn under the data, their rows in the key or a corner box, their credits in the source line,
  // and names by the map's width (every place under 100 km across, else 10,000 people or more).
  const pop = { on: { cities: true, places: true, density: false }, ramp: ctx.window.WSDA.population.DEFAULT_RAMP };
  const pm = BM.proximity({ sites: fp.sites.slice(0, 1), bandsMode: false, endpoint: 'either', summary: { cvis: 0, animals: 0,
    origins: 0, dests: 0, sitesHit: 0 }, siteCvis: [0], siteOrigins: [0], siteDests: [0], matched: [],
  filters: { year: [], quarter: [], species: [] }, universe: [], counties: COUNTIES, date: DATE, population: pop });
  const PNm = ctx.window.WSDA.population;
  check(pm.model.population && pm.model.population.names.length > 0 &&
    pm.model.source.indexOf(PNm.CITY_CREDIT) >= 0 && BR.svg(pm.parts).indexOf('POPULATION CONTEXT') >= 0,
  'PNG: population layers with their names, key rows and credits', pm.model.population && pm.model.population.names.length);
  const big = new Set(PNm.names(pop.on, { min: 10000 }).map(n => n.name));
  check(pm.model.population.names.some(n => !big.has(n.name)), 'PNG: a narrow map (under 100 km) names places under 10,000 too',
    pm.model.population.names.map(n => n.name));
  const wide = BM.proximity({ sites: PX.prepareSites([{ name: 'W', lat: 47.6, long: -122.3 }, { name: 'E', lat: 47.6, long: -117.4 }],
    { defaultKm: 3 }).sites, bandsMode: false, endpoint: 'either', summary: { cvis: 0, animals: 0, origins: 0, dests: 0,
    sitesHit: 0 }, siteCvis: [0, 0], siteOrigins: [0, 0], siteDests: [0, 0], matched: [], filters: { year: [], quarter: [],
    species: [] }, universe: [], counties: COUNTIES, date: DATE, population: pop }).model;
  check(wide.population.names.length > 0 && wide.population.names.every(n => big.has(n.name)),
    'PNG: a wide map names only places of 10,000 people or more', wide.population.names.map(n => n.name));
  const none = BM.proximity({ sites: fp.sites.slice(0, 1), bandsMode: false, endpoint: 'either', summary: { cvis: 0, animals: 0,
    origins: 0, dests: 0, sitesHit: 0 }, siteCvis: [0], siteOrigins: [0], siteDests: [0], matched: [],
  filters: { year: [], quarter: [], species: [] }, universe: [], counties: COUNTIES, date: DATE, population: null });
  check(!none.model.population && BR.svg(none.parts).indexOf('POPULATION CONTEXT') < 0, 'PNG: nothing added while every layer is off');
  // ── Further branded-page cases ──
  const base = { bandsMode: false, endpoint: 'either', summary: { cvis: 0, animals: 0, origins: 0, dests: 0, sitesHit: 0 },
    matched: [], filters: { year: [], quarter: [], species: [] }, universe: [], counties: COUNTIES, date: DATE };
  // A long layer name in the key wraps inside the box (each line within the room beside the mark, worked out here).
  const longLayer = [{ key: 'syn', label: 'Synthetic Custom Meat Processors (geocoded addresses)', pngLabel:
    'Synthetic Custom Meat Processors (geocoded addresses)', color: '#1c5a83', points: [{ name: 'M1', lat: 46.6, lon: -120.5 }] }];
  const lp = PX.prepareSites([{ name: 'One', lat: 46.6, long: -120.5 }], { defaultKm: 3 });
  const lm = BM.proximity(Object.assign({}, base, { sites: lp.sites, siteCvis: [0], siteOrigins: [0], siteDests: [0],
    fac: W.lookup.facilitiesInside(lp.sites, longLayer) }));
  const lsvg = BR.svg(lm.parts);
  const roomKey = (BR.px(BR.LAYOUT.gutterW) - 10) * (1 - 0.28) - 4;
  const keyRow = lm.model.keyRows.find(r => /Synthetic/.test(r.label));
  const kl = keyRow ? keyRow.label.split(' ').join(' ') : '';
  const drawnLines = (lsvg.match(/>([^<]*)<\/text>/g) || []).map(t => t.slice(1, -7))
    .filter(t => /Synthetic|Custom|Meat|Processors|geocoded|addresses/.test(t));
  check(keyRow && drawnLines.length >= 2 && drawnLines.every(t => BR.textWidth(t, BR.textPt(3.0)) <= roomKey + 1e-9) &&
    drawnLines.join(' ') === 'Synthetic Custom Meat Processors (geocoded addresses): 1 inside',
  'PNG: a long layer name in the key wraps onto lines that fit the box', { drawnLines, kl });
  // On Satellite the site names are the theme's light color on its dark halo.
  const sat = BR.svg(BM.proximity(Object.assign({}, base, { sites: lp.sites, siteCvis: [0], siteOrigins: [0], siteDests: [0],
    background: 'raster:esri_satellite' })).parts);
  const T = ctx.window.WSDA.tiles.THEMES.satellite;
  check(new RegExp('fill="' + T.label + '"[^>]*font-weight="bold"[^>]*stroke="' + T.labelFill + '"[^>]*>One<').test(sat),
    'PNG: on Satellite the site names are light on a dark halo', T);
  // The facilities drawn over the sites: a facility at a site comes after (over) its triangle.
  const mapPart = lm.parts[0];   // the map alone (the key draws its own samples)
  const triAt = mapPart.indexOf('fill="#c0392b"');
  const dotAt = mapPart.indexOf('fill="#1c5a83" fill-opacity="1"');
  check(triAt > 0 && dotAt > triAt, 'PNG: a facility at a site is drawn over the site\'s triangle', [triAt, dotAt]);
  // A county page (option B): framed on the county and holding the rings, the county lit in the inset, its title.
  const cp = PX.prepareSites([{ name: 'Edge', lat: 46.75, long: -118.98 }], { defaultKm: 20 });
  const cm = BM.proximity(Object.assign({}, base, { sites: cp.sites, siteCvis: [0], siteOrigins: [0], siteDests: [0],
    area: { counties: [BM.siteCounty(cp.sites[0], COUNTIES)], title: 'X COUNTY' } }));
  const cb = BR.bounds(COUNTIES.filter(c => c.properties.name === cm.model.area[0]));
  const ring = PX.circle(cp.sites[0].lat, cp.sites[0].lon, 20);
  const ext = cm.model.extent;
  check(cm.model.area.length === 1 && / - 1 SITE - X COUNTY$/.test(cm.model.title) && ext.west <= cb.west && ext.east >= cb.east &&
    ext.south <= cb.south && ext.north >= cb.north && ring.every(p => p[0] >= ext.west && p[0] <= ext.east && p[1] >= ext.south &&
      p[1] <= ext.north) && BR.svg(cm.parts).indexOf('fill="' + BR.DEFAULTS.insetFocus + '"') >= 0,
  'PNG: a county page holds its county and the ring, names the county in its title and lights it in the inset',
  { area: cm.model.area, ext, cb });
  const ep3 = JSON.parse(W.exports.lookupParams({ masterFile: 'm.csv', mode: 'single', defaultKm: 3, bands: null,
    endpoint: 'either', years: [], quarters: [], species: [], sites: [], layers: [], formats: ['branded_png'],
    counts: { cvis: null, facilities: null }, png: { background: 'standard', quality: 'standard', resolution: 'standard',
      labels: false, counties: true }, population: null, countyPages: ['Benton', 'Douglas'] }, new Date(2026, 9, 14, 9, 5, 7)));
  check(JSON.stringify(ep3.county_pngs) === '["Benton","Douglas"]', 'PNG: export_params.json lists the county pages', ep3);

  // export_params.json with the PNG: its choices and the population layers it draws.
  const ep = JSON.parse(W.exports.lookupParams({ masterFile: 'm.csv', mode: 'single', defaultKm: 3, bands: null, endpoint: 'either',
    years: [], quarters: [], species: [], sites: [], layers: [], formats: ['branded_png'], counts: { cvis: null, facilities: null },
    png: { background: 'raster:esri_relief', quality: 'high', resolution: 'standard', labels: true },
    population: { city_limits: true, population_centers: false, population_density: false,
      sources: { city_limits: { source: 'WA DOR', downloaded: '2026-10-13', quarter: '2026 Q4', population_year: 2020 },
        population_centers: null, population_density: null } } }, new Date(2026, 9, 14, 9, 5, 7)));
  check(ep.png_background === 'raster:esri_relief' && ep.export_quality === 'high' && ep.png_resolution === 'standard' &&
    ep.facility_labels_on_png === true && ep.population_layers === 'city_limits' &&
    ep.population_sources === 'WA DOR, downloaded 2026-10-13 (2026 Q4); 2020 population: U.S. Census Bureau',
  'PNG: export_params.json names the PNG\'s choices and population layers', ep);
  const ep2 = JSON.parse(W.exports.lookupParams({ masterFile: 'm.csv', mode: 'single', defaultKm: 3, bands: null, endpoint: 'either',
    years: [], quarters: [], species: [], sites: [], layers: [], formats: ['matches_csv'], counts: { cvis: 1, facilities: null },
    png: { background: 'vector:streets', quality: 'standard', resolution: 'standard', labels: false }, population: null },
  new Date(2026, 9, 14, 9, 5, 7)));
  check(!('png_background' in ep2) && !('population_layers' in ep2), 'PNG: no PNG fields without the PNG in the export', ep2);
}

// ── "Find coordinates": the address lookup, offline ──────────────────────────────────────────────────────────────
// Each typed address against CVI's module (geocode_find, run by the reference with its two network steps stubbed):
// a hit gives CVI's coordinates and text; an empty box CVI's text; where CVI found nothing in its cache (and would
// have gone online) the page gives its offline wording instead (a recorded difference): "Load a geocode
// cache file" while no usable file is loaded, else "No match". The files the page refuses are those the generator
// lists; the main file's rows and the rows passed over are the generator's counts, written there by hand.
const tally5 = { cases: 0, hits: 0, online: 0 };
function day5() {
  const G = FX.geocode, CG = REF.module && REF.module.geocode;
  check(!!G && !!CG && CG.length === G.cases.length, 'Find coordinates: the reference ran every address case', CG && CG.length);
  if (!G || !CG) return;
  const L = W.lookup;
  const CVI_MISS = 'Could not resolve that address (service unreachable or no match). Enter lat/long manually.';
  const NO_FILE = 'Load a geocode cache file to look up addresses, or enter lat/long manually.';
  const NO_MATCH = 'No match for that address in the geocode cache file. Enter lat/long manually.';
  const caches = {};
  Object.keys(G.files).forEach(name => {
    const r = L.parseGeocodeCache(fs.readFileSync(path.join(ROOT, G.dir, name), 'utf8'), name);
    const want = G.files[name];
    if (want.refused) {
      check(!r.rows && r.message && r.message.level === 'err' && r.message.text.indexOf(name) === 0,
        'Find coordinates: ' + name + ' is refused with a message naming it', r.message);
      caches[name] = null;
    } else {
      const passed = r.rows ? r.rows.filter(x => !L.findAddress({ rows: [x] }, x.address)).length : -1;
      check(!!r.rows && r.rows.length === want.rows && passed === want.passed,
        'Find coordinates: ' + name + ' gives ' + want.rows + ' rows, ' + want.passed + ' passed over', [r.rows && r.rows.length, passed]);
      caches[name] = r.rows ? r : null;
    }
  });
  G.cases.forEach((cs, i) => {
    const cvi = CG[i], label = 'Find coordinates: "' + cs.address + '" with ' + (cs.cache || 'no file');
    const cache = cs.cache ? caches[cs.cache] : null;
    const r = L.geocodeRule(cs.address, cache);
    check(cvi.address === cs.address, label + ': the reference ran this case', cvi.address);
    if (cvi.level === 'success') {
      tally5.hits++;
      check(r.message.level === 'ok' && r.message.text === cvi.text, label + ': CVI\'s text', [r.message, cvi.text]);
      check(r.lat === cvi.lat && r.long === cvi.long, label + ': CVI\'s coordinates in the boxes',
        [r.lat, r.long, cvi.lat, cvi.long]);
      check(cvi.online === false, label + ': CVI answered from its cache, offline', cvi.online);
    } else if (cvi.text === CVI_MISS) {
      tally5.online++;
      check(cvi.online === true && cvi.level === 'warning', label + ': CVI found nothing and would have gone online',
        [cvi.online, cvi.level]);
      check(r.lat === undefined && r.message.level === 'warn' && r.message.text === (cache ? NO_MATCH : NO_FILE),
        label + ': the page\'s offline message, no coordinates (recorded difference)', r);
    } else {
      check(cvi.text === 'Enter a street address first.' && cvi.level === 'warning' && cvi.online === false,
        label + ': CVI asks for an address', cvi);
      check(r.lat === undefined && r.message.level === 'warn' && r.message.text === cvi.text, label + ': CVI\'s text', r);
    }
    tally5.cases++;
  });
  check(tally5.hits >= 6 && tally5.online >= 8, 'Find coordinates: the cases cover hits and misses', tally5);

  // Hand cases, independent of CVI and of the fixtures.
  const n = L.normalizeAddress;
  check(n('  "12  Main\tSt"  ') === '12 main st', 'Find coordinates: normalize trims, drops quotes, joins white space', n('  "12  Main\tSt"  '));
  check(n("'x'") === 'x' && n('"a"b"') === 'a"b' && n('\vA\fB\r') === 'a b' && n(null) === null && n('""') === '',
    'Find coordinates: normalize as R (quotes only at the ends; a vertical tab and form feed are white space)', [n("'x'"), n('"a"b"'), n('\vA\fB\r'), n('""')]);
  const two = { rows: [{ address: 'A', key: 'a', lat: null, long: -120 }, { address: 'A ', key: 'a', lat: 47, long: -120 },
    { address: 'a', key: 'a', lat: 46, long: -119 }] };
  const f = L.findAddress(two, ' a ');
  check(f && f.lat === 47 && f.matchedAddress === 'A ', 'Find coordinates: the first usable row wins', f);
  check(L.findAddress({ rows: [{ address: 'B', key: 'b', lat: 90.000001, long: 0 }] }, 'b') === null &&
    L.findAddress({ rows: [{ address: 'B', key: 'b', lat: 90, long: -180 }] }, 'b') !== null,
  'Find coordinates: coordinates must be within range, the edges allowed');
  const g = L.geocodeRule('b', { rows: [{ address: 'B', key: 'b', lat: 47.1234565, long: -120.12345649 }] });
  check(g.lat === 47.123457 || g.lat === 47.123456, 'Find coordinates: six decimals', g.lat);
  check(g.long === -120.123456, 'Find coordinates: six decimals, rounded', g.long);
  const miss = L.geocodeRule('Nowhere', { rows: [] });
  check(miss.message.text === NO_MATCH && L.geocodeRule('Nowhere', null).message.text === NO_FILE,
    'Find coordinates: the two offline messages', [miss.message.text]);
}

// ── Limits and fixes ─────────────────────────────────────────────────────────────────────────────────────────────
// Each check fails on the code before the fix. Expected values are worked out here (the facilities, the CSV cells,
// the shapes) or come from the plain rule each fix keeps (the name placer's old brute-force search, below).
const tallyZ = {};
async function auditFixes() {
  const LB = ctx.window.WSDA.labels, EXP = W.exports, BR = ctx.window.WSDA.branded, BM = W.brandedmaps;
  const COUNTIES = ctx.window.CVIWA_GEO.counties.features, DATE = new Date(2026, 9, 14);
  const ringOf = (n, cx, cy, rx, ry, clockwise) => {
    const r = [];
    for (let k = 0; k < n; k++) {
      const t = 2 * Math.PI * k / n * (clockwise ? -1 : 1);
      r.push([cx + rx * Math.cos(t), cy + ry * Math.sin(t)]);
    }
    r.push(r[0]);
    return r;
  };
  // One outline of 300,000 points is kept, and its point lies inside it.
  let z1 = null, e1 = null;
  try { z1 = ZONES.readGeoJson(JSON.stringify({ type: 'Polygon', coordinates: [ringOf(300000, -120, 47, 0.2, 0.1, false)] }), 'big.geojson'); }
  catch (e) { e1 = e; }
  const zz = z1 && z1.zones && z1.zones[0];
  check(!e1 && zz && PX.inZone(zz.point[0], zz.point[1], zz.geometry), 'Limits: an outline of 300,000 points read, its point inside',
    e1 ? e1.message : zz && zz.point);
  // 200,000 facilities of one layer inside one buffer: no error, each counted.
  const many = [];
  for (let k = 0; k < 200000; k++) many.push({ name: 'F' + k, lat: 47 + (k % 400) * 1e-5, lon: -120 + Math.floor(k / 400) * 1e-5 });
  const s2 = PX.prepareSites([{ name: 'Wide', lat: 47.002, long: -119.998, buffer_km: 50 }], { defaultKm: 3 }).sites;
  let f2 = null, e2 = null;
  try { f2 = W.lookup.facilitiesInside(s2, [{ key: 'all', label: 'All', color: '#000', points: many }]); } catch (e) { e2 = e; }
  check(!e2 && f2 && f2.total === 200000 && f2.counts[0].total === 200000, 'Limits: 200,000 facilities inside one buffer, no error',
    e2 ? e2.message : f2 && f2.total);
  // The name placer gives the places a plain search over every placed box and marker gives (the rule before the
  // grid, written out here), on random layouts, and 600 names among 20,000 markers in well under a second.
  const meet = (a, b) => Math.min(a.x1, b.x1) > Math.max(a.x0, b.x0) && Math.min(a.y1, b.y1) > Math.max(a.y0, b.y0);
  const touches = (c, b) => {
    const dx = c.x - Math.max(b.x0, Math.min(c.x, b.x1)), dy = c.y - Math.max(b.y0, Math.min(c.y, b.y1));
    return dx * dx + dy * dy < c.r * c.r;
  };
  function plainPlace(names, markers, soft, area, pt, taken) {
    const placed = (taken || []).slice(), out = [];
    const DIRS = [[1, 0], [-1, 0], [0, -1], [0, 1], [1, -1], [-1, -1], [1, 1], [-1, 1]];
    for (const n of names) {
      const w = Math.max(...n.lines.map(l => BR.textWidth(l, pt))) + 2, h = n.lines.length * pt * LB.LINE;
      let best = null;
      for (let ring = 0; ring < 8 && !(best && best.free && !best.soft); ring++) {
        const gap = n.r + 2 + ring * pt * 1.4;
        DIRS.forEach(([dx, dy], k) => {
          const x = n.x + dx * (gap + w / 2), y = n.y + dy * (gap + h / 2);
          const b = { x0: x - w / 2, x1: x + w / 2, y0: y - h / 2, y1: y + h / 2 };
          const off = b.x0 < area.x0 || b.x1 > area.x1 || b.y0 < area.y0 || b.y1 > area.y1;
          const hit = placed.some(p => meet(p, b)) || markers.some(m => touches(m, b));
          const softHit = soft.some(c => touches(c, b));
          const free = !off && !hit;
          const score = (free ? 0 : 1e6) + (off ? 1e5 : 0) + (softHit ? 1e3 : 0) + ring * 10 + k;
          if (!best || score < best.score) best = { x, y, b, free, soft: softHit, score };
        });
      }
      placed.push(best.b);
      out.push([best.x, best.y, best.free]);
    }
    return out;
  }
  let seed = 11, same = 0;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let t = 0; t < 60; t++) {
    const pt = 6 + rnd() * 8, pick = () => [rnd() * 2200, rnd() * 1700];
    const names = Array.from({ length: 1 + Math.floor(rnd() * 60) }, (v, i) => { const [x, y] = pick();
      return { lines: LB.wrapName('Site ' + i + ' ' + 'x'.repeat(Math.floor(rnd() * 40))), x, y, r: 2 + rnd() * 6 }; });
    const markers = Array.from({ length: Math.floor(rnd() * 300) }, () => { const [x, y] = pick(); return { x, y, r: rnd() * 10 }; });
    const soft = Array.from({ length: Math.floor(rnd() * 40) }, () => { const [x, y] = pick(); return { x, y, r: rnd() * 80 }; });
    const taken = Array.from({ length: Math.floor(rnd() * 20) }, () => { const [x, y] = pick();
      return { x0: x, x1: x + rnd() * 100, y0: y, y1: y + rnd() * 20 }; });
    if (t % 6 === 1) { markers.push({ x: NaN, y: 5, r: 3 }); taken.push({ x0: -Infinity, x1: 50, y0: 0, y1: 10 }); soft.push({ x: 900, y: 700, r: 1e6 }); }
    const area = { x0: 0, x1: 2200 * (0.6 + rnd() * 0.4), y0: 0, y1: 1700 };
    const got = LB.place(names, markers, soft, area, pt, taken).map(p => [p.x, p.y, p.free]);
    if (JSON.stringify(got) === JSON.stringify(plainPlace(names, markers, soft, area, pt, taken))) same++;
  }
  check(same === 60, 'Limits: the name placer\'s places equal the plain search\'s on 60 random layouts', same);
  const bigNames = Array.from({ length: 600 }, (v, i) => ({ lines: ['Site ' + i], x: rnd() * 2200, y: rnd() * 1700, r: 4 }));
  const bigMarks = Array.from({ length: 20000 }, () => ({ x: rnd() * 2200, y: rnd() * 1700, r: 3 }));
  let t0 = Date.now();
  LB.place(bigNames, bigMarks, [], { x0: 0, x1: 2200, y0: 0, y1: 1700 }, 9, []);
  tallyZ.placeMs = Date.now() - t0;
  check(tallyZ.placeMs < 3000, 'Limits: 600 names among 20,000 markers placed in under 3 s (was about 100 s)', tallyZ.placeMs);
  // Names of 100,000 characters (sites and a facility layer) through the branded page: built in under 3 s,
  // each cut name a prefix of its name ending in "…", short enough for its line.
  const long = 'Long name '.repeat(10000);
  const sl = PX.prepareSites(Array.from({ length: 8 }, (v, i) => ({ name: long + i, lat: 46.6 + i * 0.05, long: -120.5, buffer_km: 3 })),
    { defaultKm: 3 }).sites;
  const fl = [{ key: 'x', label: long, pngLabel: long, color: '#0097a7', points: [{ name: 'F1', lat: 46.6, lon: -120.5 }] }];
  const fz = W.lookup.facilitiesInside(sl, fl);
  t0 = Date.now();
  let m4 = null, e4 = null;
  try { m4 = BM.proximity({ sites: sl, bandsMode: false, facilitiesOnly: true, fac: fz, counties: COUNTIES, date: DATE,
    filters: { year: [], quarter: [], species: [] } }).model; } catch (e) { e4 = e; }
  tallyZ.longMs = Date.now() - t0;
  check(!e4 && m4 && tallyZ.longMs < 3000 && m4.panel.rows.length === 8 &&
    m4.panel.rows.every(r => /…$/.test(r.name) && r.name.length < 200 && long.indexOf(r.name.slice(0, -1)) === 0),
  'Limits: 100,000-character names: the page built in under 3 s, every panel name cut to fit',
    e4 ? e4.message : [tallyZ.longMs, m4 && m4.panel.rows.map(r => r.name.length)]);
  // The halving search gives the answer of taking off one character at a time, on random widths and rooms.
  let cutSame = 0;
  for (let t = 0; t < 300; t++) {
    const widths = Array.from({ length: Math.floor(rnd() * 60) }, () => rnd() * 9);
    const room = rnd() * 200, fits = k => widths.slice(0, k).reduce((a, w) => a + w, 0) + 5 <= room;
    let k = widths.length;
    while (k > 0 && !fits(k)) k--;
    if (BM.longestFitting(widths.length, fits) === k) cutSame++;
  }
  check(cutSame === 300, 'Limits: the halving cut equals the one-character-at-a-time cut on 300 cases', cutSame);
  // A shapefile record with an outline and a hole of 100,000 points each: read in under 3 s, the hole outside.
  const shpOf = rings => {
    const n = rings.reduce((k, r) => k + r.length, 0), len = 44 + 4 * rings.length + 16 * n;
    const b = new Uint8Array(100 + 8 + len), v = new DataView(b.buffer);
    v.setInt32(0, 9994, false); v.setInt32(24, (100 + 8 + len) / 2, false); v.setInt32(28, 1000, true); v.setInt32(32, 5, true);
    v.setInt32(100, 1, false); v.setInt32(104, len / 2, false);
    const c = 108;
    v.setInt32(c, 5, true); v.setInt32(c + 36, rings.length, true); v.setInt32(c + 40, n, true);
    let at = 0;
    rings.forEach((r, k) => { v.setInt32(c + 44 + 4 * k, at, true); at += r.length; });
    let q = c + 44 + 4 * rings.length;
    rings.forEach(r => r.forEach(p => { v.setFloat64(q, p[0], true); v.setFloat64(q + 8, p[1], true); q += 16; }));
    return b;
  };
  const prj = { path: 'z/z.prj', size: 40, read: async () => new TextEncoder().encode('GEOGCS["x",DATUM["D_WGS_1984"]]') };
  const shp5 = shpOf([ringOf(100000, -120, 47, 0.2, 0.2, true), ringOf(100000, -120, 47, 0.1, 0.1, false)]);
  t0 = Date.now();
  let z5 = null, e5 = null;
  try { z5 = await ZONES.readShapefile([{ path: 'z/z.shp', size: shp5.length, read: async () => shp5 }, prj], 'lake.zip', []); }
  catch (e) { e5 = e; }
  tallyZ.holeMs = Date.now() - t0;
  const g5 = z5 && z5.zones[0] && z5.zones[0].geometry;
  check(!e5 && g5 && tallyZ.holeMs < 3000 && !PX.inZone(-120, 47, g5) && PX.inZone(-120.15, 47, g5),
    'Limits: an outline and a hole of 100,000 points read in under 3 s, the hole outside', e5 ? e5.message : tallyZ.holeMs);
  // A .prj, .cpg or .dbf larger than the page reads is refused before it is unpacked (read() would fail).
  const never = () => { throw new Error('unpacked'); };
  const shpSmall = shpOf([ringOf(8, -120, 47, 0.2, 0.2, true)]);
  for (const [entry, re] of [[{ path: 'z/z.prj', size: 300 * 1048576, read: never }, /has a \.prj of 300\.0 MB, more than the 0\.1 MB/],
    [{ path: 'z/z.cpg', size: 70000, read: never }, /has a \.cpg of 0\.1 MB/], [{ path: 'z/z.dbf', size: 40 * 1048576, read: never }, /has a \.dbf of 40\.0 MB, more than the 32\.0 MB/]]) {
    const list = [{ path: 'z/z.shp', size: shpSmall.length, read: async () => shpSmall }, entry];
    if (!/\.prj$/.test(entry.path)) list.push(prj);
    let e6 = null;
    try { await ZONES.readShapefile(list, 'side.zip', []); } catch (e) { e6 = e; }
    check(e6 && e6.name === 'ZoneError' && re.test(e6.message), 'Limits: an oversized ' + entry.path.slice(-4) + ' refused before unpacking',
      e6 && e6.message);
  }
  // The facilities CSV writes formula-like text with an apostrophe in front; other text and numbers as before.
  const csv8 = EXP.lookupFacilitiesCsv(['=SUM(1)', '+1', '-2', '@x', 'Plain'].map((nm, k) => ({ siteName: k ? 'Site' : '=Site',
    siteLat: 47, siteLon: -120, layerLabel: 'Feedlots', name: nm, lat: 47, lon: -120.5, km: 1, bandKm: 3, county: 'Yakima',
    town: null }))).text;
  check(['"\'=SUM(1)"', '"\'+1"', '"\'-2"', '"\'@x"', '"Plain"', '"\'=Site"'].every(c => csv8.indexOf(c) >= 0) && csv8.indexOf('"=SUM') < 0 &&
    csv8.indexOf(',-120,') >= 0, 'Limits: formula-like text in the facilities CSV starts with an apostrophe', csv8.split('\n').slice(0, 3));
  // Blank lines are not rows; a NUL refuses the file; "�" and an open quote add notes.
  const L = W.lookup;
  const b10 = L.parseGeocodeCache('address,lat,long\n\n"A",47,-120\n\n\n"B",46,-119\n', 'b.csv');
  check(b10.rows && b10.rows.length === 2 && !b10.notes.length, 'Limits: blank lines are not addresses', b10.rows && b10.rows.length);
  const u10 = L.parseGeocodeCache('a\u0000d\u0000d\u0000r\u0000e\u0000s\u0000s\u0000', 'u.csv');
  check(!u10.rows && /^u\.csv is not UTF-8 text \(it looks like UTF-16\)/.test(u10.message.text), 'Limits: a UTF-16 file refused for its encoding',
    u10.message);
  const w10 = L.parseGeocodeCache('address,lat,long\n"12 Pe�a Rd",47,-120\n', 'w.csv');
  check(w10.rows && w10.notes.length === 1 && /is not all UTF-8 text/.test(w10.notes[0].text), 'Limits: text not UTF-8 gets a note', w10.notes);
  const q10 = L.parseGeocodeCache('address,lat,long\n"A,47,-120\n"B",46,-119\n', 'q.csv');
  check(q10.rows && q10.notes.some(n => /quote mark that is never closed/.test(n.text)), 'Limits: a quote left open gets a note', q10.notes);
  // A facility listed twice counts once in the per-site counts; the rows keep both lines of the file.
  const s12 = PX.prepareSites([{ name: 'One', lat: 46.6, long: -120.5 }], { defaultKm: 3 }).sites;
  const f12 = L.facilitiesInside(s12, [{ key: 'f', label: 'Feedlots', color: '#000', points: [{ name: 'Twice', lat: 46.6, lon: -120.5 },
    { name: 'Twice', lat: 46.6, lon: -120.5 }, { name: 'Once', lat: 46.601, lon: -120.5 }] }]);
  check(f12.counts[0].byLayer.f === 2 && f12.counts[0].total === 2 && f12.rows.length === 3,
    'Limits: a facility listed twice counted once per site; both lines listed', [f12.counts[0], f12.rows.length]);
  // The WA inset shows only the sites inside its frame; a site in Oregon stays off it (and off
  // the source line under it), while the main map still draws all five.
  const s3 = PX.prepareSites(['47.7365,-123.6044', '45.925566,-120.7793', '46.6,-120.5', '43.9436,-120.5413',
    '46.20655,-117.41975'].map((t, i) => ({ name: 'S' + i, lat: Number(t.split(',')[0]), long: Number(t.split(',')[1]) })),
  { defaultKm: 3 }).sites;
  const b3 = BM.proximity({ sites: s3, bandsMode: false, endpoint: 'either', summary: { cvis: 0, animals: 0, origins: 0,
    dests: 0, sitesHit: 0 }, siteCvis: [0, 0, 0, 0, 0], siteOrigins: [0, 0, 0, 0, 0], siteDests: [0, 0, 0, 0, 0], matched: [],
  filters: { year: [], quarter: [], species: [] }, universe: [], counties: COUNTIES, date: DATE });
  const box3 = b3.model.inset.box, svg3 = BR.svg(b3.parts);
  // Query sites are bullseyes by design (CVI: red triangles): the white-centered red rings.
  const tri3 = [...svg3.matchAll(/<circle cx="([\d.]+)" cy="([\d.]+)" r="[\d.]+" fill="#ffffff" stroke="#c0392b"/g)]
    .map(t => [Number(t[1]), Number(t[2])]);
  const small = tri3.filter(([x, y]) => x >= box3.x0 - 30 && x <= box3.x1 + 30 && y >= box3.y0 - 30);
  check(b3.model.insetSites === 4 && b3.model.sites.length === 5 && small.length === 4 &&
    small.every(([x, y]) => x >= box3.x0 && x <= box3.x1 && y >= box3.y0 && y <= box3.y1),
  'WA inset: shows the four Washington sites only, every mark inside its box; the map draws all five',
    { insetSites: b3.model.insetSites, small, box3 });
  // Bidirectional controls are dropped from the PNG's text.
  const t18 = BR.text('Farm ‮drow‬ ⁦x⁩', 0, 0, { pt: 10 });
  check(!/[؜‎‏‪-‮⁦-⁩]/.test(t18) && t18.indexOf('Farm drow x') >= 0,
    'Limits: bidirectional controls dropped from a name on the PNG', t18);
}

(async () => {
await day3();
day4();
day5();
await auditFixes();
console.log('  limits and fixes: name placer ' + tallyZ.placeMs + ' ms, long names ' + tallyZ.longMs + ' ms, detailed hole ' +
  tallyZ.holeMs + ' ms');
console.log('  Find coordinates: ' + tally5.cases + ' address lookups against CVI\'s module, ' + tally5.hits + ' found in the cache, ' +
  tally5.online + ' where CVI would have gone online');
console.log('  scenarios: ' + tally.scenarios + ' compared with CVI\'s engine, ' + tally.matched + ' matched rows, ' +
  tally.membership + ' membership rows, ' + tally.sites + ' sites; statuses ' + [...statuses].join(', '));
console.log('  module: ' + tally.module + ' steps compared with CVI\'s module');
console.log('  distances: ' + tally.distances + ' pairs against geosphere, largest difference ' +
  (tally.worstKm * 1e6).toExponential(2) + ' mm');
console.log('  zones and CSVs: ' + tally3.zonePoints + ' zone points against sf and GEOS (' + tally3.zoneRows + ' rows matched by ' +
  'zones), ' + tally3.placePoints + ' place points, ' + tally3.csvRuns + ' CSVs against CVI\'s, ' + tally3.numbers +
  ' numbers against write.table');
console.log('  branded PNG: ' + tally4.cases + ' branded PNG cases against CVI\'s page, ' + tally4.texts + ' panel texts, ' +
  tally4.points + ' matched points, ' + tally4.countiesWhole + ' county names whole; inset corners ' + Object.keys(tally4.corners).map(k => k + ' ' + tally4.corners[k].length)
  .join(', '));
failures.slice(0, 40).forEach(x => console.log('FAIL ' + x));
console.log('S11 unit: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FAIL the suite stopped: ' + (e && e.stack || e)); process.exit(1); });
