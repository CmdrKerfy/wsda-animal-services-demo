#!/usr/bin/env node
'use strict';
// Population-context unit tests: the three data files site/geo/citylimits-wa.js, places-wa.js and tracts-wa.js against
// the independent reference tests/oracle/pc_population_oracle.R (local-test-artifacts/pc/oracle_pc.json), which reads
// the downloads itself.
//
//   - the files: their globals, sources and SHA-256 values, credits, dates, density breaks, sizes within budget;
//   - the shapes, decoded here from each file's compact format: rings closed, whole numbers, inside Washington,
//     every name's label point inside its own shape; validity, overlaps, gaps and area change as the reference
//     measured them;
//   - city limits: every Department of Revenue city once, its name and 2020 population; the join with the Census's
//     incorporated places both ways;
//   - places: every Census place once, its name, kind and population; the both-on rule (which census-designated
//     places are trimmed or dropped, and their share of land left);
//   - tracts: every tract once, population, land area, density and class; the state total;
//   - published 2020 counts, independent of all our code;
//   - CVI's places_wa.rds cross-check, as the reference found it;
//   - site/shared/population.js: decoding, classes, the two candidate ramps, the both-on rule, credits,
//     legend entries, the live map's sources and layers, the PNG parts, the names and their placement.
//
// Usage (repository root): Rscript tests/oracle/pc_population_oracle.R, then node tests/node/run_pc_unit_tests.js
// (Node >= 22, no packages)

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');
const GEO = path.join(ROOT, 'site', 'geo');
const ORACLE = path.join(ROOT, 'local-test-artifacts', 'pc', 'oracle_pc.json');

if (!fs.existsSync(ORACLE)) {
  console.log('No reference at ' + ORACLE + '. Run Rscript tests/oracle/pc_population_oracle.R first.');
  process.exit(1);
}
const REF = JSON.parse(fs.readFileSync(ORACLE, 'utf8'));

const FILES = { cities: 'citylimits-wa.js', places: 'places-wa.js', tracts: 'tracts-wa.js' };
const BUDGET_MB = { cities: 0.6, places: 1.0, tracts: 1.5 };
const sandbox = { window: {} };
vm.createContext(sandbox);
for (const f of Object.values(FILES)) {
  vm.runInContext(fs.readFileSync(path.join(GEO, f), 'utf8'), sandbox, { filename: f });
}
const CITIES = sandbox.window.WSDA_CITYLIMITS;
const PLACES = sandbox.window.WSDA_PLACES;
const TRACTS = sandbox.window.WSDA_TRACTS;

// Washington's 2020 Census population and a few places' counts, as census.gov publishes them (QuickFacts,
// "Population, Census, April 1, 2020", POP010220). The page refuses scripted requests, so these were written
// from the published figures and can be confirmed by hand at:
// https://www.census.gov/quickfacts/fact/table/WA,seattlecitywashington,spokanecitywashington,tacomacitywashington,vancouvercitywashington,spanawaycdpwashington,parklandcdpwashington/POP010220
const STATE_POP_2020 = 7705281;
const PUBLISHED = [
  { geoid: '5363000', name: 'Seattle', pop: 737015 },
  { geoid: '5367000', name: 'Spokane', pop: 228989 },
  { geoid: '5370000', name: 'Tacoma', pop: 219346 },
  { geoid: '5374060', name: 'Vancouver', pop: 190915 },
  { geoid: '5366255', name: 'Spanaway', pop: 35476 },
  { geoid: '5353335', name: 'Parkland', pop: 38623 }
];

// ── Test bookkeeping ───────────────────────────────────────────────────────────────────────────────────────────
let pass = 0;
let fail = 0;
const failures = [];
const counts = {};
function check(ok, name, detail) {
  const part = name.split(':')[0];
  counts[part] = (counts[part] || 0) + 1;
  if (ok) {
    pass++;
  } else {
    fail++;
    failures.push(name + (detail === undefined ? '' : ' :: ' + JSON.stringify(detail).slice(0, 600)));
  }
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const byId = rows => new Map(rows.map(r => [r.geoid, r]));

// ── Shapes: decoding and geometry ──────────────────────────────────────────────────────────────────────────────
// A ring is [lon0, lat0, dlon1, dlat1, ...] in whole units of 1/10,000 degree (each file's "encoding" field).
function decodeRing(v) {
  const pts = [];
  let x = 0;
  let y = 0;
  for (let i = 0; i < v.length; i += 2) {
    x += v[i];
    y += v[i + 1];
    pts.push([x / 1e4, y / 1e4]);
  }
  return pts;
}
function insideRing(pt, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
// Inside the shape: inside a polygon's outline and in none of its holes.
function insideShape(pt, shape) {
  return shape.some(poly => {
    const rings = poly.map(decodeRing);
    return insideRing(pt, rings[0]) && !rings.slice(1).some(h => insideRing(pt, h));
  });
}
function checkShapes(tag, items) {
  let rings = 0;
  const bad = { empty: [], notWhole: [], open: [], short: [], outside: [], label: [] };
  for (const it of items) {
    if (!Array.isArray(it.shape) || !it.shape.length || it.shape.some(p => !p.length)) bad.empty.push(it.geoid);
    for (const poly of it.shape || []) {
      for (const v of poly) {
        rings++;
        if (!v.every(Number.isInteger) || v.length % 2) bad.notWhole.push(it.geoid);
        const pts = decodeRing(v);
        if (pts.length < 4) bad.short.push(it.geoid);
        if (!same(pts[0], pts[pts.length - 1])) bad.open.push(it.geoid);
        if (pts.some(([x, y]) => x < -124.9 || x > -116.9 || y < 45.5 || y > 49.1)) bad.outside.push(it.geoid);
      }
    }
    if (it.label !== undefined && !(Array.isArray(it.label) && insideShape(it.label, it.shape))) {
      bad.label.push(it.geoid + ' ' + (it.name || ''));
    }
  }
  check(bad.empty.length === 0, tag + ': every item has a shape with rings', bad.empty);
  check(bad.notWhole.length === 0, tag + ': rings are whole-number pairs', bad.notWhole);
  check(bad.short.length === 0, tag + ': rings have at least 4 points', bad.short);
  check(bad.open.length === 0, tag + ': rings are closed', bad.open);
  check(bad.outside.length === 0, tag + ': every point lies in Washington', bad.outside);
  const labeled = items.filter(it => it.label !== undefined).length;
  check(labeled === 0 || bad.label.length === 0, tag + ': every label point lies inside its own shape', bad.label);
  return { rings, labelsOutside: bad.label.length };
}

// ── The files ──────────────────────────────────────────────────────────────────────────────────────────────────
function checkFiles() {
  check(!!CITIES && !!PLACES && !!TRACTS, 'Files: the three globals are defined');
  for (const [k, f] of Object.entries(FILES)) {
    const mb = fs.statSync(path.join(GEO, f)).size / 1e6;
    check(mb <= BUDGET_MB[k], 'Files: ' + f + ' within its ' + BUDGET_MB[k] + ' MB budget', mb);
    const text = fs.readFileSync(path.join(GEO, f), 'utf8');
    check(text.startsWith('/* Generated by build/derive_population.R'), 'Files: ' + f + ' names its build script');
  }
  const src = REF.meta.sources;
  check(same(CITIES.sha256, { 'dor_city_boundaries.geojson': src['dor_city_boundaries.geojson'],
    'wa2020.pl.zip': src['wa2020.pl.zip'] }), 'Files: city limits carry the sources\' SHA-256', CITIES.sha256);
  check(same(PLACES.sha256, { 'cb_2020_53_place_500k.zip': src['cb_2020_53_place_500k.zip'],
    'wa2020.pl.zip': src['wa2020.pl.zip'], 'dor_city_boundaries.geojson': src['dor_city_boundaries.geojson'] }),
  'Files: places carry the sources\' SHA-256', PLACES.sha256);
  check(same(TRACTS.sha256, { 'cb_2020_53_tract_500k.zip': src['cb_2020_53_tract_500k.zip'],
    'wa2020.pl.zip': src['wa2020.pl.zip'] }), 'Files: tracts carry the sources\' SHA-256', TRACTS.sha256);
  const census = 'Population: U.S. Census Bureau, 2020 Census';
  check(CITIES.credit === 'City limits: WA Department of Revenue', 'Files: the city-limits credit', CITIES.credit);
  check(CITIES.populationCredit === census && PLACES.credit === census && TRACTS.credit === census,
    'Files: the Census credit on all three');
  check(CITIES.downloaded === '2026-10-13' && CITIES.quarter === '2026 Q4', 'Files: the city limits\' download date' +
    ' and quarter', [CITIES.downloaded, CITIES.quarter]);
  check(CITIES.populationYear === 2020 && PLACES.year === 2020 && TRACTS.year === 2020, 'Files: the year 2020');
  check(same(TRACTS.breaks, [10, 50, 250, 1000, 5000]), 'Files: the six fixed density classes\' breaks',
    TRACTS.breaks);
  for (const d of [CITIES, PLACES, TRACTS]) {
    check(typeof d.encoding === 'string' && d.encoding.includes('1/10,000 degree'), 'Files: the shape format is' +
      ' described in the file');
    check(typeof d.source === 'string' && d.source.length > 40, 'Files: the source is described in the file');
  }
}

// ── City limits ────────────────────────────────────────────────────────────────────────────────────────────────
function checkCities() {
  const ours = CITIES.cities;
  const ref = REF.dor.cities;
  check(REF.dor.rows_without_place.length === 0, 'Cities: no Department of Revenue row lacks a place code',
    REF.dor.rows_without_place);
  check(ref.every(c => c.names_in_pieces === 1), 'Cities: each city\'s pieces carry one name');
  check(ours.length === ref.length, 'Cities: one entry per Department of Revenue city', [ours.length, ref.length]);
  check(new Set(ours.map(c => c.geoid)).size === ours.length, 'Cities: no city twice');
  const want = byId(ref);
  // Each city carries the 2020 Census name (the reference's place name), and the Department of Revenue's name as
  // dorName only where the two differ.
  const censusName = byId(REF.places);
  for (const c of ours) {
    const r = want.get(c.geoid);
    check(!!r, 'Cities: ' + c.geoid + ' is a Department of Revenue city');
    if (!r) continue;
    const census = censusName.get(c.geoid);
    check(!!census && c.name === census.name, 'Cities: ' + c.geoid + ' the 2020 Census name', [c.name, census && census.name]);
    check((c.dorName || c.name) === r.name && (c.dorName === undefined || c.dorName !== c.name),
      'Cities: ' + c.geoid + ' the Department of Revenue\'s name kept where it differs', [c.dorName, r.name]);
    check(c.pop === r.pop, 'Cities: ' + c.geoid + ' 2020 population', [c.pop, r.pop]);
  }
  // The join: every city is a Census incorporated place, and the reverse; the names that differ are listed.
  check(REF.join.only_dor.length === 0, 'Cities: every city matches a Census incorporated place', REF.join.only_dor);
  check(REF.join.only_census.length === 0, 'Cities: every Census incorporated place has city limits',
    REF.join.only_census);
  const places = byId(PLACES.places);
  check(ours.every(c => places.has(c.geoid) && places.get(c.geoid).kind !== 'cdp' &&
    places.get(c.geoid).pop === c.pop), 'Cities: each city\'s population equals its Census place\'s');
  return checkShapes('Cities', ours);
}

// ── Places and the both-on rule ────────────────────────────────────────────────────────────────────────────────
function checkPlaces() {
  const ours = PLACES.places;
  const ref = REF.places;
  check(ours.length === ref.length, 'Places: one entry per Census place', [ours.length, ref.length]);
  check(new Set(ours.map(p => p.geoid)).size === ours.length, 'Places: no place twice');
  const want = byId(ref);
  for (const p of ours) {
    const r = want.get(p.geoid);
    check(!!r, 'Places: ' + p.geoid + ' is a Census place');
    if (!r) continue;
    check(p.name === r.name && p.kind === r.kind && p.pop === r.pop, 'Places: ' + p.geoid + ' name, kind and' +
      ' population', [p.name, p.kind, p.pop, r.name, r.kind, r.pop]);
  }
  const cdps = byId(REF.cdps);
  for (const p of ours.filter(q => q.kind === 'cdp')) {
    const r = cdps.get(p.geoid);
    check(!!r && p.trim === r.trim, 'Places: ' + p.geoid + ' ' + p.name + ' trim (both outline layers on)',
      [p.trim, r && r.trim]);
  }
  check(ours.filter(q => q.kind !== 'cdp').every(q => q.trim === undefined), 'Places: cities and towns carry no' +
    ' trim');
  const trimmed = PLACES.cdpOutsideCities;
  const clipped = ours.filter(q => q.trim === 'clipped').map(q => q.geoid).sort();
  check(same(trimmed.map(t => t.geoid).sort(), clipped), 'Places: a trimmed shape for every trimmed place, and' +
    ' only for those', [trimmed.length, clipped.length]);
  for (const t of trimmed) {
    const r = cdps.get(t.geoid);
    check(!!r && Math.abs(t.share - r.share) <= 0.005, 'Places: ' + t.geoid + ' ' + t.name + ' share of land left',
      [t.share, r && r.share]);
  }
  const s1 = checkShapes('Places', ours);
  const s2 = checkShapes('Trimmed', trimmed);
  return { rings: s1.rings + s2.rings, trimmed: trimmed.length, dropped: ours.filter(q => q.trim === 'dropped').length };
}

// ── Tracts ─────────────────────────────────────────────────────────────────────────────────────────────────────
function checkTracts() {
  const ours = TRACTS.tracts;
  const ref = REF.tracts;
  check(ours.length === ref.length, 'Tracts: one entry per boundary-file tract', [ours.length, ref.length]);
  check(new Set(ours.map(t => t.geoid)).size === ours.length, 'Tracts: no tract twice');
  const want = byId(ref);
  for (const t of ours) {
    const r = want.get(t.geoid);
    check(!!r, 'Tracts: ' + t.geoid + ' is a boundary-file tract');
    if (!r) continue;
    check(t.pop === r.pop && t.aland === r.aland, 'Tracts: ' + t.geoid + ' population and land area',
      [t.pop, t.aland, r.pop, r.aland]);
    check(Math.abs(t.density - r.density) <= 0.05 + 1e-9, 'Tracts: ' + t.geoid + ' density', [t.density, r.density]);
    check(t.class === r.class, 'Tracts: ' + t.geoid + ' density class', [t.class, r.class]);
  }
  const total = ours.reduce((s, t) => s + t.pop, 0);
  check(total === STATE_POP_2020, 'Tracts: the populations add up to Washington\'s 2020 total', total);
  check(REF.state_pop === STATE_POP_2020, 'Tracts: the PL file\'s state row is the published total', REF.state_pop);
  const ids = new Set(ours.map(t => t.geoid));
  check(REF.water_tracts.length > 0 && REF.water_tracts.every(w => w.pop === 0 && w.aland === 0 && !ids.has(w.geoid)),
    'Tracts: the tracts left out are water only (no land, no people)', REF.water_tracts.length);
  const perClass = [0, 0, 0, 0, 0, 0];
  for (const t of ours) perClass[t.class]++;
  check(perClass.every(n => n > 0), 'Tracts: every density class is used', perClass);
  const s = checkShapes('Tracts', ours);
  return { rings: s.rings, perClass };
}

// ── Published counts, CVI's places, shape quality ──────────────────────────────────────────────────────────────
function checkPublished() {
  const places = byId(PLACES.places);
  const cities = byId(CITIES.cities);
  for (const p of PUBLISHED) {
    const ours = places.get(p.geoid);
    check(!!ours && ours.name === p.name && ours.pop === p.pop, 'Published: ' + p.name + ' 2020 population',
      ours && [ours.name, ours.pop]);
    if (cities.has(p.geoid)) {
      check(cities.get(p.geoid).pop === p.pop, 'Published: ' + p.name + ' city limits carry it');
    }
  }
}
function checkCviPlaces() {
  const c = REF.cvi_places;
  if (!c.available) {
    console.log('  (CVI\'s places_wa.rds not found; its cross-check skipped)');
    return null;
  }
  check(c.common === REF.places.length && c.only_cvi.length === 0 && c.only_census.length === 0,
    'CVI places: the same places by GEOID', [c.common, c.only_cvi, c.only_census]);
  // A name that changed after 2020 must be one where the Department of Revenue already uses the newer name.
  const dorName = byId(REF.dor.cities);
  check(c.names_differ.every(d => dorName.has(d.geoid) && dorName.get(d.geoid).name === d.cvi),
    'CVI places: every name changed since 2020 is the Department of Revenue\'s name', c.names_differ);
  // CVI's file is a later TIGER vintage, in which a census-designated place loses the land a city annexed: the
  // places it shrinks by more than 1% should mostly be the ones the trim rule trims, by a similar share. (Some
  // shrink for other boundary corrections, away from any city.)
  const cdps = byId(REF.cdps);
  const shrunk = c.cdp_land.filter(d => d.ratio < 0.99);
  const trimmed = shrunk.filter(d => cdps.get(d.geoid).trim === 'clipped');
  check(c.cdp_land.every(d => d.ratio <= 1.01), 'CVI places: no census-designated place gained land after 2020');
  check(trimmed.length >= 0.75 * shrunk.length, 'CVI places: most places that lost land after 2020 are trimmed',
    [trimmed.length, shrunk.length]);
  for (const d of trimmed) {
    check(Math.abs(cdps.get(d.geoid).share - d.ratio) <= 0.10, 'CVI places: ' + d.name + ' share of land left near' +
      ' the later vintage\'s', [cdps.get(d.geoid).share, d.ratio]);
  }
  c.shrunk = shrunk.map(d => d.name + ' ' + d.ratio.toFixed(3) + '/' + cdps.get(d.geoid).share.toFixed(3) +
    (cdps.get(d.geoid).trim === 'clipped' ? '' : ' (not trimmed)'));
  return c;
}
function checkShapeQuality() {
  const q = REF.shapes;
  for (const [k, n] of Object.entries(q.invalid)) check(n === 0, 'Shapes: no invalid shape in ' + k, n);
  check(q.tract_overlap_m2 < 10000, 'Shapes: tracts overlap by under 1 ha in all', q.tract_overlap_m2);
  check(q.tract_gap_m2 < 1000, 'Shapes: gaps between tracts under 1,000 m2 in all', q.tract_gap_m2);
  check(q.tract_area_change_median < 0.005, 'Shapes: tract areas move by a median under 0.5%',
    q.tract_area_change_median);
  check(q.tract_area_change_max < 0.10, 'Shapes: no tract area moves by 10% or more', q.tract_area_change_max);
  const pageShas = REF.meta.page_files;
  const crypto = require('crypto');
  for (const [k, f] of Object.entries(FILES)) {
    const sha = crypto.createHash('sha256').update(fs.readFileSync(path.join(GEO, f))).digest('hex');
    check(sha === pageShas[k], 'Shapes: the reference measured this ' + f, [sha, pageShas[k]]);
  }
}

// ── site/shared/population.js ────────────────────────────────────────────────────────────────────────────────
// The module in its own context with the page pieces it uses (branded.js for text widths and path data) and the
// county outlines; every expectation is worked out here from the files and the reference, not from the module.
const SITE = path.join(ROOT, 'site');
const mod = { window: {} };
mod.window.window = mod.window;
vm.createContext(mod);
for (const f of ['shared/brand.js', 'shared/branded.js', 'geo/wa-counties.js', 'geo/citylimits-wa.js', 'geo/places-wa.js',
  'geo/tracts-wa.js', 'shared/population.js']) {
  const src = fs.readFileSync(path.join(SITE, f), 'utf8').replace(/typeof window !== 'undefined' \? window : globalThis/, 'window');
  vm.runInContext(src, mod, { filename: f });
}
const PM = mod.window.WSDA.population;
const BRM = mod.window.WSDA.branded;
const COUNTY_FEATURES = mod.window.CVIWA_GEO.counties.features;

// OKLab lightness and distance (Björn Ottosson's formulas), for the ramps.
function oklab(hex) {
  const lin = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(u => (u <= 0.04045 ? u / 12.92 : Math.pow((u + 0.055) / 1.055, 2.4)));
  const [r, g, b] = lin;
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s, 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s];
}
const labDist = (a, b) => Math.hypot(...oklab(a).map((v, i) => v - oklab(b)[i]));

const ALL_ON = [];
for (const cities of [false, true]) {
  for (const places of [false, true]) {
    for (const density of [false, true]) ALL_ON.push({ cities, places, density });
  }
}
const onName = on => Object.keys(on).filter(k => on[k]).join('+') || 'none';

function checkModule() {
  const out = {};
  // Decoding: every ring of the three files as the suite decodes it.
  let rings = 0;
  let wrong = 0;
  for (const items of [CITIES.cities, PLACES.places, PLACES.cdpOutsideCities, TRACTS.tracts]) {
    for (const it of items) {
      const g = PM.geometry(it);
      it.shape.forEach((poly, i) => poly.forEach((ring, j) => {
        rings++;
        if (!same(g.coordinates[i][j], decodeRing(ring))) wrong++;
      }));
    }
  }
  check(rings > 0 && wrong === 0, 'Module: every ring decoded as the suite decodes it', { rings, wrong });
  out.rings = rings;

  // Classes: the page's density breaks, and every tract's class as the reference classed it.
  const edges = [[0, 0], [9.99, 0], [10, 1], [49.99, 1], [50, 2], [249.99, 2], [250, 3], [999.99, 3], [1000, 4],
    [4999.99, 4], [5000, 5], [1e6, 5]];
  for (const [d, k] of edges) check(PM.classOf(d) === k, 'Module: class of ' + d + ' is ' + k, PM.classOf(d));
  const refClass = new Map(REF.tracts.map(r => [r.geoid, r.class]));
  const off = TRACTS.tracts.filter(x => PM.classOf(x.density) !== refClass.get(x.geoid));
  check(off.length === 0, 'Module: every tract classed as the reference classed it', off.slice(0, 5).map(x => x.geoid));
  check(same(PM.BREAKS, TRACTS.breaks), 'Module: the breaks are the data file\'s', PM.BREAKS);
  check(same(PM.CLASS_LABELS, ['Under 10', '10 – 50', '50 – 250', '250 – 1,000', '1,000 – 5,000', '5,000 and over']),
    'Module: class labels', PM.CLASS_LABELS);

  // Ramps: six colors each, one hue from light to dark (OKLab lightness falling at every step), none equal to a
  // color the pages use for data; the nearest data color is printed for reference.
  const dataColors = new Set();
  for (const f of ['cvi/app/palettes.js', 'shared/facilities.js']) {
    (fs.readFileSync(path.join(SITE, f), 'utf8').match(/#[0-9a-fA-F]{6}\b/g) || []).forEach(h => dataColors.add(h.toLowerCase()));
  }
  ['#245566', '#1c5a83', '#7a3e9d'].forEach(h => dataColors.add(h));   // WSDA teal and blue, the movement ring
  out.nearest = {};
  for (const [key, r] of Object.entries(PM.RAMPS)) {
    check(r.colors.length === 6, 'Module: ramp ' + key + ' has six colors', r.colors.length);
    const L = r.colors.map(c => oklab(c)[0]);
    check(L.every((v, i) => i === 0 || v < L[i - 1] - 0.03), 'Module: ramp ' + key + ' gets darker at every step',
      L.map(v => v.toFixed(3)));
    check(r.colors.every(c => !dataColors.has(c.toLowerCase())), 'Module: ramp ' + key + ' reuses no data color');
    let best = null;
    for (const c of r.colors) {
      for (const d of dataColors) {
        const dist = labDist(c, d);
        if (!best || dist < best.dist) best = { ramp: c, data: d, dist };
      }
    }
    out.nearest[key] = best.ramp + ' / ' + best.data + ' ' + best.dist.toFixed(3);
  }
  // Lavender is the one ramp, at 65% (by design).
  check(same(Object.keys(PM.RAMPS), ['lavender']) && PM.DEFAULT_RAMP === 'lavender' && same(PM.RAMPS.lavender.colors,
    ['#f0eff7', '#d8d5ea', '#b9b3d8', '#958cc0', '#6f65a3', '#4b4380']) && PM.DENSITY_OPACITY === 0.65,
  'Module: lavender is the one density ramp, at 65%', [Object.keys(PM.RAMPS), PM.DEFAULT_RAMP]);

  // The both-on rule: cities from the Department of Revenue only; census-designated places only, the
  // trimmed ones with their trimmed shape, the dropped ones left out; one layer alone draws its own file.
  const refCdp = new Map(REF.cdps.map(r => [r.geoid, r]));
  const both = PM.outlines({ cities: true, places: true });
  const keptCdps = REF.cdps.filter(r => r.trim !== 'dropped');
  check(both.cities.length === REF.dor.cities.length, 'Module: both on, every city from the city limits',
    both.cities.length);
  check(both.places.length === keptCdps.length && both.places.every(x => x.kind === 'cdp'),
    'Module: both on, census-designated places only, the dropped ones left out', both.places.length);
  // (null-safe reads: a place missing from the reference fails the checks, it does not stop the suite)
  const trimOf = x => (refCdp.get(x.geoid) || {}).trim;
  const trimmedOk = both.places.filter(x => trimOf(x) === 'clipped').every(x => {
    const t = PLACES.cdpOutsideCities.find(c => c.geoid === x.geoid);
    return t && same(x.shape, t.shape) && same(x.label, t.label);
  });
  check(trimmedOk, 'Module: both on, each trimmed place drawn with its trimmed shape and label point');
  const untrimmedOk = both.places.filter(x => trimOf(x) === 'none').every(x =>
    same(x.shape, (PLACES.places.find(q => q.geoid === x.geoid) || {}).shape));
  check(untrimmedOk, 'Module: both on, an untrimmed place keeps its own shape');
  check(PM.outlines({ places: true }).places.length === REF.places.length && PM.outlines({ places: true }).cities.length === 0,
    'Module: population centers alone draw every Census place');
  check(PM.outlines({ cities: true }).places.length === 0, 'Module: city limits alone draw no place');

  // Credits and legend entries for every combination of the switches.
  for (const on of ALL_ON) {
    const want = (on.cities ? ['City limits: WA Department of Revenue'] : [])
      .concat(on.places || on.density ? ['Population: U.S. Census Bureau, 2020 Census'] : []);
    check(same(PM.credits(on), want), 'Module: PNG credits, ' + onName(on), PM.credits(on));
    const live = (on.cities ? ['City limits: WA Department of Revenue'] : [])
      .concat(on.cities || on.places || on.density ? ['Population: U.S. Census Bureau, 2020 Census'] : []);
    check(same(PM.credits(on, { live: true }), live), 'Module: live map credits, ' + onName(on));
    for (const key of Object.keys(PM.RAMPS)) {
      const entries = PM.legendEntries(on, key);
      const lines = entries.filter(e => e.type === 'line').map(e => e.label + (e.dash ? ' (dashed)' : ''));
      const wantLines = (on.cities ? ['City limits (current)'] : [])
        .concat(on.places && !on.cities ? ['City or town, 2020'] : [])
        .concat(on.places ? ['Census-designated place (dashed)'] : []);
      check(same(lines, wantLines), 'Module: legend lines, ' + onName(on) + ', ' + key, lines);
      const sw = entries.filter(e => e.type === 'swatch');
      check(on.density ? same(sw.map(e => e.color), PM.RAMPS[key].colors) && same(sw.map(e => e.label), PM.CLASS_LABELS) &&
        entries.some(e => e.type === 'title' && e.label === 'People per sq mi of land (2020)') : sw.length === 0,
      'Module: legend swatches, ' + onName(on) + ', ' + key);
    }
  }

  // The live map's sources and layers.
  for (const on of ALL_ON) {
    const mp = PM.mapParts(on, { ramp: 'lavender' });
    check(same(mp.layers.map(l => l.id), PM.LAYER_IDS), 'Module: live layers in drawing order, ' + onName(on));
    const vis = Object.fromEntries(mp.layers.map(l => [l.id, l.layout.visibility === 'visible']));
    check(vis['pc-density'] === on.density && vis['pc-places-fill'] === on.places && vis['pc-places-cdp'] === on.places &&
      vis['pc-cities-line'] === on.cities, 'Module: live layers shown as the switches, ' + onName(on), vis);
    const nPlaces = mp.sources.pc_places.data.features.length;
    check(nPlaces === (on.places && on.cities ? keptCdps.length : REF.places.length),
      'Module: live places source follows the both-on rule, ' + onName(on), nPlaces);
  }
  const mp = PM.mapParts({ density: true }, { ramp: 'lavender' });
  const expr = mp.layers[0].paint['fill-color'];
  check(PM.RAMPS.lavender.colors.every((c, k) => expr[expr.indexOf(k) + 1] === c), 'Module: live density colors by class');
  check(mp.sources.pc_density.data.features.length === REF.tracts.length, 'Module: live density has every tract');
  check(mp.sources.pc_cities.attribution.indexOf('WA Department of Revenue') >= 0 &&
    mp.sources.pc_cities.attribution.indexOf('U.S. Census Bureau') >= 0, 'Module: the city limits source credits both');
  const cdpLayer = mp.layers.find(l => l.id === 'pc-places-cdp');
  check(Array.isArray(cdpLayer.paint['line-dasharray']), 'Module: census-designated places dashed on the live map');

  // The PNG parts.
  const fit = BRM.fitMercator({ west: -124.85, east: -116.85, south: 45.4, north: 49.1 }, BRM.panel(0, 0, 0.77, 0.9, 0));
  const none = PM.svgParts({ cities: false, places: false, density: false }, fit.project, {});
  check(none.density === '' && none.outlines === '', 'Module: nothing drawn with every layer off');
  const all = PM.svgParts({ cities: true, places: true, density: true }, fit.project, {});
  const nPaths = s => (s.match(/<path /g) || []).length;
  check(nPaths(all.density) === REF.tracts.length, 'Module: PNG density draws every tract statewide', nPaths(all.density));
  const used = new Set((all.density.match(/fill="#[0-9a-f]{6}"/g) || []).map(s => s.slice(6, 13)));
  check([...used].every(c => PM.RAMPS.lavender.colors.indexOf(c) >= 0), 'Module: PNG density uses the ramp only');
  check(/^<g opacity="0.65">/.test(all.density), 'Module: PNG density drawn at 65% as one group');
  check(nPaths(all.outlines) === REF.dor.cities.length + keptCdps.length &&
    (all.outlines.match(/stroke-dasharray/g) || []).length === keptCdps.length,
  'Module: PNG outlines, both on: every city solid and every kept census-designated place dashed');
  const alone = PM.svgParts({ places: true }, fit.project, {});
  check((alone.outlines.match(/stroke-dasharray/g) || []).length === REF.cdps.length &&
    nPaths(alone.outlines) === REF.places.length, 'Module: PNG outlines, population centers alone');
  const yakima = COUNTY_FEATURES.filter(f => f.properties.name === 'Yakima');
  const yb = BRM.bounds(yakima);
  const cut = PM.svgParts({ density: true, places: true }, fit.project, { extent: yb, clip: yakima, id: 't' });
  check(/<clipPath id="pc-clip-t-density">/.test(cut.density) && /<clipPath id="pc-clip-t-outlines">/.test(cut.outlines),
    'Module: PNG layers cut to the counties given');
  const inYb = TRACTS.tracts.filter(x => {
    const pts = x.shape.flatMap(poly => decodeRing(poly[0]));
    return pts.some(([lon, lat]) => lon >= yb.west && lon <= yb.east && lat >= yb.south && lat <= yb.north) ||
      (Math.min(...pts.map(q => q[0])) <= yb.east && Math.max(...pts.map(q => q[0])) >= yb.west &&
        Math.min(...pts.map(q => q[1])) <= yb.north && Math.max(...pts.map(q => q[1])) >= yb.south);
  });
  check(nPaths(cut.density) - 1 === inYb.length, 'Module: PNG density skips tracts outside the box',
    [nPaths(cut.density) - 1, inYb.length]);

  // Names: the threshold, the both-on sources, the county filter, the order.
  const dorPop = new Map(REF.dor.cities.map(r => [r.geoid, r.pop]));
  const want10k = REF.dor.cities.filter(r => r.pop >= 10000).length + keptCdps.filter(r =>
    REF.places.find(q => q.geoid === r.geoid).pop >= 10000).length;
  const n10k = PM.names({ cities: true, places: true }, { min: 10000 });
  check(n10k.length === want10k, 'Module: both on, names of 10,000 or more', [n10k.length, want10k]);
  check(n10k.every((n, i) => i === 0 || n10k[i - 1].pop >= n.pop), 'Module: names largest first');
  check(n10k.filter(n => n.kind === 'city').every(n => dorPop.has(CITIES.cities.find(x => x.name === n.name).geoid)),
    'Module: both on, city names from the city limits');
  check(PM.names({ places: true }, { min: 10000 }).length === REF.places.filter(r => r.pop >= 10000).length,
    'Module: population centers alone, names of 10,000 or more');
  const yNames = PM.names({ cities: true, places: true }, { min: 0, counties: yakima });
  const ring0 = yakima[0].geometry.type === 'Polygon' ? [yakima[0].geometry.coordinates] : yakima[0].geometry.coordinates;
  const inYak = ([lon, lat]) => ring0.some(p => insideRing([lon, lat], p[0]) && !p.slice(1).some(h => insideRing([lon, lat], h)));
  const wantY = CITIES.cities.filter(x => inYak(x.label)).length +
    PM.outlines({ cities: true, places: true }).places.filter(x => inYak(x.label)).length;
  check(yNames.length === wantY && yNames.length > 0, 'Module: names of the counties given only', [yNames.length, wantY]);
  out.yakimaNames = yNames.length;

  // Placement: inside the area, no two names overlapping, clear of the boxes taken; a name goes over a mark only when
  // none of its five spots (on its point; right, left, above or below it) is clear of the marks and the names before
  // it (by design, names may go over the circles on every map). The spots are worked out here from that
  // description, not taken from the module.
  const area = { x0: 0, x1: 560, y0: 40, y1: 600 };
  const taken = [{ x0: 200, x1: 260, y0: 300, y1: 310 }];
  const marks = [{ x: 400, y: 420, r: 30 }, { x: 150, y: 450, r: 25 }, { x: 330, y: 250, r: 60 }];
  const pt = BRM.textPt(2.5);
  const items = PM.names({ cities: true, places: true }, { min: 10000 });
  const r = PM.placeNames(items, fit.project, pt, area, taken, marks);
  const overlap = (a, b) => Math.min(a.x1, b.x1) > Math.max(a.x0, b.x0) && Math.min(a.y1, b.y1) > Math.max(a.y0, b.y0);
  const hitsMark = b => marks.some(m => {
    const dx = m.x - Math.max(b.x0, Math.min(m.x, b.x1));
    const dy = m.y - Math.max(b.y0, Math.min(m.y, b.y1));
    return dx * dx + dy * dy < m.r * m.r;
  });
  const bxs = r.placed.map(x => x.box);
  check(bxs.every(b => b.x0 >= area.x0 && b.x1 <= area.x1 && b.y0 >= area.y0 && b.y1 <= area.y1),
    'Module: names inside the area');
  check(bxs.every((b, i) => bxs.every((o, j) => i === j || !overlap(b, o))), 'Module: no two names overlap');
  check(bxs.every(b => !taken.some(t => overlap(b, t))), 'Module: names clear of the boxes taken');
  check(r.placed.length + r.dropped.length === items.length, 'Module: every name placed or left out');
  const before = taken.slice();
  let overOk = true;
  let overCount = 0;
  for (const n of r.placed) {
    const item = items.find(x => x.name === n.name);
    const [px, py] = fit.project(item.lon, item.lat);
    const w = BRM.textWidth(n.name, pt, false) + 2;
    const h = pt * 1.1;
    const g = pt * 0.4;
    const clear = [[px, py], [px + w / 2 + g, py], [px - w / 2 - g, py], [px, py - h - g / 2], [px, py + h + g / 2]]
      .map(([x, y]) => ({ x0: x - w / 2, x1: x + w / 2, y0: y - h / 2, y1: y + h / 2 }))
      .filter(b => b.x0 >= area.x0 && b.x1 <= area.x1 && b.y0 >= area.y0 && b.y1 <= area.y1)
      .filter(b => !before.some(u => overlap(u, b)) && !hitsMark(b));
    if (hitsMark(n.box) !== n.over || (n.over && clear.length)) overOk = false;
    if (n.over) overCount++;
    before.push(n.box);
  }
  check(overOk && overCount > 0, 'Module: a name goes over a mark only when it has no clear spot', overCount);
  out.namesOverMarks = overCount;
  const markup = PM.nameMarkup(r.placed, pt);
  check((markup.match(/<text /g) || []).length === r.placed.length &&
    (markup.match(/font-style="italic"/g) || []).length === r.placed.filter(x => x.kind === 'cdp').length,
  'Module: one text per name, census-designated places in italics');

  // The live map's hover text, and the Census names in both layers.
  const sedro = CITIES.cities.find(c => c.geoid === '5363210');
  check(same(PM.hoverLines('cities', { name: sedro.name, pop: sedro.pop }), ['Sedro-Woolley',
    'City limits, current (WA Department of Revenue, ' + CITIES.quarter + ')',
    '2020 population 12,421 (U.S. Census Bureau)']), 'Module: hover text of a city', PM.hoverLines('cities', sedro));
  check(PM.hoverLines('cities', { name: 'New Town', pop: null })[2] === '2020 population not available',
    'Module: hover text of a city with no 2020 count');
  check(same(PM.hoverLines('places', { name: 'Spanaway', kind: 'cdp', pop: 35476 }), ['Spanaway',
    'Census-designated place', '2020 population 35,476']) && PM.hoverLines('places', { name: 'Harrah', kind: 'town',
    pop: 585 })[1] === 'City or town (2020 Census limits)', 'Module: hover text of a place');
  check(same(PM.hoverLines('density', { density: 2362.4, pop: 4925 }), ['Census tract, 2020',
    '2,362 people per sq mi of land', '2020 population 4,925']), 'Module: hover text of a tract');
  const census = byId(REF.places);
  check(['5336395', '5336850', '5363210'].every(id => {
    const c = CITIES.cities.find(x => x.geoid === id);
    return c.name === census.get(id).name && PM.names({ cities: true }, {}).some(n => n.name === census.get(id).name);
  }), 'Module: the 2020 Census name in the city limits layer (Krupp (Marlin), LaCrosse, Sedro-Woolley)');

  // export_params.json: each switch, and each drawn layer's source and date.
  const ep = PM.exportParams({ cities: true, places: false, density: true });
  check(ep.city_limits === true && ep.population_centers === false && ep.population_density === true &&
    same(ep.sources.city_limits, { source: 'City limits: WA Department of Revenue', downloaded: CITIES.downloaded,
      quarter: CITIES.quarter, population_year: 2020 }) && ep.sources.population_centers === null &&
    same(ep.sources.population_density, { source: 'Population: U.S. Census Bureau, 2020 Census', year: 2020 }),
  'Module: export_params.json records the switches and sources', ep);
  const epOff = PM.exportParams(null);
  check(!epOff.city_limits && !epOff.population_centers && !epOff.population_density &&
    Object.values(epOff.sources).every(v => v === null), 'Module: export_params.json with every layer off');
  // A file that loads but is damaged counts as not loaded, like a missing one: a tract without a
  // shape, a class out of range, an empty list, no list. The real file counts again once it is back.
  const realTracts = mod.window.WSDA_TRACTS;
  const damaged = [{ tracts: [{ geoid: '1', pop: 1, class: 2 }] }, { tracts: [{ geoid: '1', pop: 1, class: 9, shape: [] }] },
    { tracts: [] }, { nothing: true }];
  const refused = damaged.map(d => {
    mod.window.WSDA_TRACTS = d;
    return PM.loaded('density') === null;
  });
  mod.window.WSDA_TRACTS = realTracts;
  check(refused.every(Boolean) && PM.loaded('density') === realTracts, 'Module: a damaged density file is refused ' +
    'like a missing one', refused);
  return out;
}


// ── The branded PNGs with the layers ───────────────────────────────────────────────────────────────────────────
// The CVI page's WA State and County Focus pages, built in their own context from the S9 reference's Full tier
// default scenario (its master file and choices), with each switch combination. Expectations from the
// written rules, not from the module: the "POPULATION CONTEXT" rows and their labels, the credits joined
// to the source line, nothing added while every layer is off, the names drawn over the circles.
// The space between the "POPULATION CONTEXT" heading's baseline and the top of what follows it in the markup: a
// sample's box, or the next line of text (its baseline less its capital height, 0.72 of its size).
function spaceUnderHeading(svg) {
  const m = /<text [^>]*y="(-?[\d.]+)" font-size="([\d.]+)"[^>]*>POPULATION CONTEXT<\/text>/.exec(svg);
  if (!m) return { space: -1, size: 0, heading: false };
  const next = /<(rect|text) [^>]*?y="(-?[\d.]+)"(?: [^>]*?font-size="([\d.]+)")?/.exec(svg.slice(m.index + m[0].length));
  if (!next) return { space: -1, size: +m[2], next: false };
  const top = next[1] === 'rect' ? +next[2] : +next[2] - 0.72 * +next[3];
  return { space: Math.round((top - +m[1]) * 100) / 100, size: +m[2], next: next[1] };
}

// The space between the last outline row (its sample's box, or its label's descenders, 0.21 of its size below the
// baseline) and the top of the "People per sq mi of land (2020)" title (its baseline less 0.72 of its size).
function spaceAboveDensity(svg) {
  const t = /<text [^>]*y="(-?[\d.]+)" font-size="([\d.]+)"[^>]*>People per sq mi of land \(2020\)<\/text>/.exec(svg);
  if (!t) return { space: -1, title: false };
  const before = svg.slice(svg.lastIndexOf('POPULATION CONTEXT', t.index), t.index);
  const rects = [...before.matchAll(/<rect x="[^"]*" y="(-?[\d.]+)" width="[^"]*" height="([\d.]+)"/g)];
  const labels = [...before.matchAll(/<text [^>]*y="(-?[\d.]+)" font-size="([\d.]+)"[^>]*>(City limits \(current\)|City or town, 2020|Census-designated place)<\/text>/g)];
  if (!rects.length || !labels.length) return { space: -1, rows: false };
  const r = rects[rects.length - 1], l = labels[labels.length - 1];
  const bottom = Math.max(+r[1] + +r[2], +l[1] + 0.21 * +l[2]);
  return { space: Math.round((+t[1] - 0.72 * +t[2] - bottom) * 100) / 100, size: +t[2], after: l[3] };
}

function checkPages() {
  const S9_DIR = path.join(ROOT, 'local-test-artifacts', 's9');
  const orc = path.join(S9_DIR, 'oracle_s9_tier_full.json');
  if (!fs.existsSync(orc)) {
    console.log('  (the S9 reference is not here; the branded page checks skipped: run Rscript tests/oracle/s9_branded_oracle.R)');
    return null;
  }
  const o = JSON.parse(fs.readFileSync(orc, 'utf8'));
  const pg = { window: {}, console, TextEncoder, TextDecoder };
  pg.window.window = pg.window;
  vm.createContext(pg);
  const APP = path.join(SITE, 'cvi', 'app');
  for (const f of ['csv.js', 'master.js', 'scaling.js', 'palettes.js', 'aggregate.js', 'chartsvg.js', 'periods.js',
    'summary.js', 'flow.js', 'focus.js', 'charts.js', 'movement.js', 'crossfilter.js', 'exports.js']) {
    vm.runInContext(fs.readFileSync(path.join(APP, f), 'utf8'), pg, { filename: f });
  }
  for (const f of ['shared/zip.js', 'shared/brand.js', 'shared/branded.js', 'shared/tiles.js', 'shared/labels.js',
    'geo/wa-counties.js', 'geo/citylimits-wa.js', 'geo/places-wa.js', 'geo/tracts-wa.js', 'shared/population.js',
    'cvi/app/brandedmaps.js']) {
    const src = fs.readFileSync(path.join(SITE, f), 'utf8').replace(/typeof window !== 'undefined' \? window : globalThis/, 'window');
    vm.runInContext(src, pg, { filename: f });
  }
  const W = pg.window.CVIWA;
  const B = pg.window.WSDA.branded;
  const counties = pg.window.CVIWA_GEO.counties.features;
  const master = W.master.load(fs.readFileSync(path.join(ROOT, o.file), 'utf8'));
  const list = x => (x === null || x === undefined ? [] : Array.isArray(x) ? x : [x]);
  const wi = o.views.wa.default.inputs;
  const f = { species: list(wi.county_species), years: list(wi.county_year).map(Number), quarters: list(wi.county_quarter),
    direction: list(wi.county_direction), rawSpecies: list(wi.county_species_sub), mode: wi.county_mode,
    scaling: wi.county_scaling, nBins: Number(wi.county_n_bins) };
  const rows = W.aggregate.build(master.rows, Object.assign({}, f, { hasSpecies: master.hasSpecies }));
  const wa = pop => W.brandedmaps.wa({ rows, f, universe: master.speciesChoices, palette: wi.county_palette,
    opacity: wi.county_opacity, title: '', date: new Date(2026, 9, 13), counties, population: pop });
  // The same page with extra inputs (the movement view and its filters).
  const waWith = (pop, extra) => W.brandedmaps.wa(Object.assign({ rows, f, universe: master.speciesChoices,
    palette: wi.county_palette, opacity: wi.county_opacity, title: '', date: new Date(2026, 9, 13), counties,
    population: pop }, extra));
  const fi = o.views.focus.default.inputs;
  const ff = { counties: ['Yakima'], species: list(fi.intra_species), rawSpecies: list(fi.intra_species_sub),
    years: list(fi.intra_year).map(Number), quarters: list(fi.intra_quarter), direction: fi.intra_filter_dir,
    mode: fi.intra_mode, scaling: fi.intra_scaling, nBins: Number(fi.intra_n_bins), opacity: fi.intra_opacity,
    hideCircles: false };
  const premises = W.focus.build(master, ff).premises;
  const focus = pop => W.brandedmaps.focus({ premises, f: ff, universe: master.speciesChoices, title: '',
    date: new Date(2026, 9, 13), counties, background: 'standard', streets: null, population: pop });
  const focusWith = (pop, extra) => W.brandedmaps.focus(Object.assign({ premises, f: ff, universe: master.speciesChoices,
    title: '', date: new Date(2026, 9, 13), counties, background: 'standard', streets: null, population: pop },
  extra));
  const svgOf = built => B.svg(built.parts);
  const textOf = svg => (svg.match(/>[^<>]+</g) || []).map(t => t.slice(1, -1));
  const SOURCE = 'Data: WSDA Animal Services CVI records · County boundaries: U.S. Census Bureau';
  const CITY = 'City limits: WA Department of Revenue';
  const CENSUS = 'Population: U.S. Census Bureau, 2020 Census';
  const CLASSES = ['Under 10', '10 – 50', '50 – 250', '250 – 1,000', '1,000 – 5,000', '5,000 and over'];
  const out = { where: {} };

  const offSvg = svgOf(wa(null));
  check(svgOf(wa({ on: { cities: false, places: false, density: false }, ramp: 'lavender' })) === offSvg,
    'Pages: WA State with every switch off draws the picture without the layers, byte for byte');
  check(!textOf(offSvg).includes('POPULATION CONTEXT') && textOf(offSvg).includes(SOURCE),
    'Pages: WA State without the layers: no legend rows, CVI\'s source line');
  // The Infrastructure dashboard's legend rows at its two scales (Branded 1, Report 0.62), as its pages ask
  // brandedmaps.populationLegend for them, in a legend column of their own.
  for (const on of ALL_ON.filter(x => x.cities || x.places || x.density)) {
    for (const [style, k, width] of [['Branded', 1, undefined], ['Report', 0.62, 120]]) {
      const rows = W.brandedmaps.populationLegend({ on, ramp: 'lavender' }, k, width);
      const gap = spaceUnderHeading(B.legendColumn(rows, { bottom: 0.9, minH: 0.1, maxH: 0.6 }).parts);
      check(gap.space >= 0.6 * gap.size, 'Pages: Infrastructure ' + style + ' rows ' + onName(on) +
        ' space under the POPULATION CONTEXT heading', gap);
      if (on.density && (on.cities || on.places)) {
        const above = spaceAboveDensity(B.legendColumn(rows, { bottom: 0.9, minH: 0.1, maxH: 0.6 }).parts);
        check(above.space >= 0.8 * above.size, 'Pages: Infrastructure ' + style + ' rows ' + onName(on) +
          ' space above the density title', above);
      }
    }
  }
  for (const on of ALL_ON.filter(x => x.cities || x.places || x.density)) {
    const tag = onName(on);
    for (const [view, build] of [['WA State', wa], ['County Focus (Yakima)', focus]]) {
      const built = build({ on, ramp: 'lavender' });
      const t = textOf(svgOf(built));
      const wantLines = [].concat(on.cities ? ['City limits (current)'] : [],
        on.places && !on.cities ? ['City or town, 2020'] : [], on.places ? ['Census-designated place'] : []);
      const noLines = ['City limits (current)', 'City or town, 2020', 'Census-designated place']
        .filter(x => wantLines.indexOf(x) < 0);
      check(t.filter(x => x === 'POPULATION CONTEXT').length === 1 && wantLines.every(x => t.includes(x)) &&
        noLines.every(x => !t.includes(x)), 'Pages: ' + view + ' ' + tag + ' legend rows', wantLines);
      check(on.density === (t.includes('People per sq mi of land (2020)') && CLASSES.every(x => t.includes(x))),
        'Pages: ' + view + ' ' + tag + ' density classes in the legend only with density');
      const credits = [].concat(on.cities ? [CITY] : [], on.places || on.density ? [CENSUS] : []);
      check(t.includes(SOURCE + ' · ' + credits.join(' · ')), 'Pages: ' + view + ' ' + tag + ' source line credits',
        credits);
      // The legend's samples never touch; when the rows do not fit the column they are in a box over a
      // corner of the map, clear of the circles and names where a corner allows.
      check(!built.model.legendOverlap, 'Pages: ' + view + ' ' + tag + ' the legend\'s samples do not touch');
      // Space under the heading ("City limits" sat too close to POPULATION CONTEXT): from the heading's
      // baseline to the top of the next row, at least 0.6 of the heading's size (3.5 points before, 7.9 now).
      const gap = spaceUnderHeading(svgOf(built));
      check(gap.space >= 0.6 * gap.size, 'Pages: ' + view + ' ' + tag + ' space under the POPULATION CONTEXT heading',
        gap);
      // More space between "Census-designated place" and the density title: at least 0.8 of the title's size (about
      // 0.4 before).
      if (on.density && (on.cities || on.places)) {
        const above = spaceAboveDensity(svgOf(built));
        check(above.space >= 0.8 * above.size, 'Pages: ' + view + ' ' + tag + ' space above the density title', above);
      }
      out.where[built.model.population.legend] = (out.where[built.model.population.legend] || 0) + 1;
    }
  }
  // All three on: the legend's samples do not touch; WA State's place names come after the last circle in the map.
  const all = wa({ on: { cities: true, places: true, density: true }, ramp: 'lavender' });
  const yak = focus({ on: { cities: true, places: true, density: true }, ramp: 'lavender' });
  const cb = yak.model.population.corner;
  // With all three on, Yakima's rows do not fit the legend column (checked, not skipped).
  check(!!cb, 'Pages: County Focus (Yakima), all three on: the population rows in a corner box',
    yak.model.population.legend);
  if (cb) {
    const mp = yak.model.mapPanel;
    check(cb.left >= mp.left && cb.left + cb.width <= mp.left + mp.width && cb.top >= mp.top &&
      cb.top + cb.height <= mp.top + mp.height, 'Pages: County Focus\'s population box inside the map', [cb, mp]);
  }
  out.cornerTrials = checkCornerAndFacilityNames(focusWith);
  out.focusSizes = checkFocusSizes(W, master, ff, focusWith, svgOf);
  out.movement = checkMovementPages(W, master, f, waWith);
  // CVI's export_params.json names the population layers only when the export holds the branded map.
  const pp = pg.window.WSDA.population.exportParams({ cities: true, places: false, density: true });
  const fx = { species: ['Cattle'], years: [2024], quarters: ['Q1'], direction: ['Inbound'] };
  const withMap = W.exports.exportParams('wa', fx, { formats: ['aggregated', 'branded_png'], population: pp },
    new Date(2026, 9, 13));
  const tablesOnly = W.exports.exportParams('wa', fx, { formats: ['aggregated'], population: pp }, new Date(2026, 9, 13));
  check(/"population_layers": \["city_limits", "population_density"\]/.test(withMap) &&
    !/population_/.test(tablesOnly), 'Pages: export_params.json names the population layers only with the branded map',
  [withMap.slice(-300), tablesOnly.slice(-200)]);
  const mapSvg = all.parts[0];
  const firstName = all.model.population.names[0];
  check(!!firstName && mapSvg.indexOf('>' + B.esc(firstName.name) + '</text>') > mapSvg.lastIndexOf('<circle'),
    'Pages: WA State place names drawn over the circles', firstName && firstName.name);
  // The drawing order inside the map: the density (its group at 65%), then the outlines (mid gray at
  // 6%), then the county lines drawn again over them, then the circles. Read from the markup, values written out.
  for (const [view, built] of [['WA State', all], ['County Focus (Yakima)', yak]]) {
    const svg = built.parts[0];
    const densityAt = svg.indexOf('<g opacity="0.65">');
    const outlineAt = svg.indexOf('fill="#737373" fill-opacity="0.06"');
    const lastOutline = svg.lastIndexOf('fill="#737373" fill-opacity="0.06"');
    const circleAt = svg.indexOf('<circle');
    const linesAgain = svg.indexOf('fill="none" stroke=', lastOutline);
    check(densityAt >= 0 && outlineAt > densityAt && linesAgain > lastOutline &&
      (circleAt < 0 || linesAgain < circleAt) && (circleAt < 0 || lastOutline < circleAt),
    'Pages: ' + view + ' drawing order density, outlines, county lines, circles',
    [densityAt, outlineAt, lastOutline, linesAgain, circleAt]);
  }
  out.waNames = all.model.population.names.length;
  out.waNamesOver = all.model.population.names.filter(n => n.over).length;
  return out;
}

// ── County Focus's size circles ─────────────────────────────────────────────────────────────────────────────────
// An earlier version let the largest ANIMALS / PREMISES circle overlap "Circle size: natural breaks, 5 classes"
// (Yakima, natural breaks). For each scaling and class count from 3 to 7, with the layers off, the two outlines and all
// three: the legend's rows are not drawn closer, no two samples touch, and the sizing line's capitals sit below every
// size circle. Ten classes do not fit beside the Top box in any arrangement, so they are not judged.
function checkFocusSizes(W, master, ff, focusWith, svgOf) {
  const bad = [];
  let judged = 0;
  const rows = {};
  for (const scaling of ['log', 'sqrt', 'linear', 'quantile', 'natural']) {
    for (const nBins of [3, 4, 5, 6, 7]) {
      const f = Object.assign({}, ff, { scaling, nBins });
      const premises = W.focus.build(master, f).premises;
      for (const on of [null, { cities: true, places: true, density: false }, { cities: true, places: true, density: true }]) {
        const built = focusWith(on && { on, ramp: 'lavender' }, { premises, f });
        const m = built.model;
        const svg = svgOf(built);
        const line = /<text [^>]*y="(-?[\d.]+)" font-size="([\d.]+)"[^>]*>Circle size: [^<]*<\/text>/.exec(svg);
        const sizes = m.legendCircles.filter(c => m.legend.labels.indexOf(c.label) >= 0);
        const lowest = Math.max(...sizes.map(c => c.y + c.r));
        const clear = line ? +line[1] - 0.72 * +line[2] - lowest : -1;
        judged++;
        rows[m.legendAcross ? 'across ' + m.legendAcrossRows : 'column'] =
          (rows[m.legendAcross ? 'across ' + m.legendAcrossRows : 'column'] || 0) + 1;
        if (m.legendSqueezed || m.legendOverlap || sizes.length !== m.legend.labels.length || !(clear >= 0)) {
          bad.push([scaling, nBins, on ? onName(on) : 'off', m.legendSqueezed, m.legendOverlap, Math.round(clear * 100) / 100]);
        }
      }
    }
  }
  check(judged === 75 && bad.length === 0, 'Pages: County Focus (Yakima) size circles clear of each other and of the ' +
    'sizing line, 5 scalings x 3 to 7 classes x 3 layer sets (' + judged + ' judged)', bad.slice(0, 6));
  // The reported case is drawn in two rows of circles (it overlapped as one squeezed column).
  const f = Object.assign({}, ff, { scaling: 'natural', nBins: 5 });
  const nat = focusWith({ on: { cities: true, places: true, density: false }, ramp: 'lavender' },
    { premises: W.focus.build(master, f).premises, f }).model;
  check(nat.legendAcrossRows === 2 && !nat.legendOverlap, 'Pages: County Focus (Yakima), natural breaks, 5 classes: ' +
    'the size circles in two rows', [nat.legendAcrossRows, nat.legendOverlap]);
  return { judged, rows };
}

// ── The corner box against facility names, the movement view, the trimmed shapes ─────────────────
const meetBox = (a, b) => Math.min(a.x1, b.x1) > Math.max(a.x0, b.x0) && Math.min(a.y1, b.y1) > Math.max(a.y0, b.y0);
const circleTouches = (c, b) => {
  const dx = c.x - Math.max(b.x0, Math.min(c.x, b.x1));
  const dy = c.y - Math.max(b.y0, Math.min(c.y, b.y1));
  return dx * dx + dy * dy < c.r * c.r;
};
// County Focus (Yakima, density on) with seeded synthetic facilities and their names shown: a corner box that was
// clear (not the fallback) covers no facility marker and no facility name.
function checkCornerAndFacilityNames(focusWith) {
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  let judged = 0;
  let fallbacks = 0;
  const bad = [];
  // The WA inset may leave the bottom right: the corner box never lies on it, the
  // fallback included.
  const onInset = [];
  const insetCorners = {};
  for (let t = 0; t < 60; t++) {
    const pts = [];
    const n = 3 + Math.floor(rnd() * 10);
    for (let i = 0; i < n; i++) {
      pts.push({ name: 'Long facility name number ' + i, lon: -121.6 + rnd() * 1.8, lat: 46.0 + rnd() * 1.1 });
    }
    const b = focusWith({ on: { cities: false, places: false, density: true }, ramp: 'lavender' },
      { facilities: [{ key: 'f1', label: 'Test', color: '#d62728', points: pts }], nameLayers: ['f1'] });
    const pop = b.model.population;
    if (!pop.corner) continue;
    const ib = b.model.inset.box;
    const cb = { x0: pop.corner.left, x1: pop.corner.left + pop.corner.width, y0: pop.corner.top,
      y1: pop.corner.top + pop.corner.height };
    if (meetBox(cb, ib)) onInset.push(t);
    insetCorners[b.model.inset.corner] = (insetCorners[b.model.inset.corner] || 0) + 1;
    if (pop.cornerFallback) { fallbacks++; continue; }
    judged++;
    const c = pop.corner;
    const box = { x0: c.left, x1: c.left + c.width, y0: c.top, y1: c.top + c.height };
    const names = (b.model.facilityNames || []).filter(x => x.at && x.at.box && meetBox(x.at.box, box));
    const marks = b.model.facilities[0].points.filter(q => q.x >= box.x0 && q.x <= box.x1 && q.y >= box.y0 &&
      q.y <= box.y1);
    if (names.length || marks.length) bad.push(t);
  }
  check(judged >= 40 && !bad.length, 'Pages: a clear County Focus corner box covers no facility name or marker (' +
    judged + ' trials judged, ' + fallbacks + ' with no clear corner)', bad);
  check(!onInset.length, 'Pages: the County Focus corner box never lies on the WA inset (inset corners: ' +
    JSON.stringify(insetCorners) + ')', onInset);
  return { judged, fallbacks, insetCorners };
}
// The WA State movement view with the outline layers on, over the Full tier and the movement fixture (all years with
// every species and with each species, at caps 5 and 10; each year with every species at cap 10): no place name
// touches a numbered badge, and no county name touches one except at the name placer's last resort, step (d).
// Badges are circles of radius 8 at their recorded centers.
function checkMovementPages(W, full, f, wa) {
  const MV = W.movement;
  const fixture = W.master.load(fs.readFileSync(path.join(ROOT, 'tests', 'synthetic', 'cvi_master_movement.csv'), 'utf8'));
  let views = 0;
  let badgesSeen = 0;
  let stepD = 0;
  let countyChecked = 0;
  const placeOver = [];
  const countyOver = [];
  for (const [tag, master] of [['full', full], ['movement', fixture]]) {
    const years = [...new Set(master.rows.map(r => r['Reporting.Year']))];
    const species = [...new Set(master.rows.map(r => r['Species.Group']))];
    const cases = [];
    for (const sps of [species].concat(species.map(x => [x]))) for (const cap of [5, 10]) cases.push([years, sps, cap]);
    for (const y of years) cases.push([[y], species, 10]);
    for (const [ys, sps, cap] of cases) {
      const r = MV.rows(master, { species: sps, years: ys, quarters: ['Q1', 'Q2', 'Q3', 'Q4'], rawSpecies: [] });
      if (!r.counted.length) continue;
      const pairs = MV.pairs(r.counted);
      const top = pairs.filter(q => q.origin !== q.dest).sort((a, b) => b.animals - a.animals).slice(0, 3)
        .map(q => MV.pairKey(q.origin, q.dest));
      const view = MV.mapView(pairs, MV.points(r.counted), { cap, badges: top,
        bySpecies: MV.pairs(r.counted, { bySpecies: true }) });
      const fq = Object.assign({}, f, { species: sps, years: ys.map(Number) });
      const m = wa({ on: { cities: true, places: true, density: false }, ramp: 'lavender' },
        { movement: { view }, f: fq }).model;
      views++;
      const badges = (m.badges || []).map(b => ({ x: b.x, y: b.y, r: 8 }));
      badgesSeen += badges.length;
      for (const n of m.population ? m.population.names : []) {
        if (badges.some(b => circleTouches(b, n.box))) placeOver.push(tag + ' ' + n.name);
      }
      for (const n of m.names || []) {
        if (n.step === 'd') { stepD++; continue; }
        countyChecked++;
        if (badges.some(b => circleTouches(b, n.box))) countyOver.push(tag + ' ' + n.name + ' (' + n.step + ')');
      }
    }
  }
  check(views >= 20 && badgesSeen > 0 && countyChecked > 0, 'Pages: movement view built over both fixtures',
    [views, badgesSeen, countyChecked]);
  check(!placeOver.length, 'Pages: movement view, no place name over a numbered badge', placeOver.slice(0, 5));
  check(!countyOver.length, 'Pages: movement view, no county name over a numbered badge (placement steps a to c)',
    countyOver.slice(0, 5));
  return { views, badges: badgesSeen, stepD };
}
// The trimmed census-designated places measured, independent of the stored share: points sampled
// inside each trimmed shape lie outside current city limits (a 3% allowance for slivers along shared edges), and the
// part of the untrimmed place inside city limits is about 1 - share (within 6 points).
function checkTrimmedShapes() {
  // Shapes decoded once: each polygon as its decoded rings, with the shape's bounding box.
  const decode = shape => {
    const polys = shape.map(poly => poly.map(decodeRing));
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const rings of polys) for (const [x, y] of rings[0]) {
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
    return { polys, box: { x0, x1, y0, y1 } };
  };
  const inside = (pt, d) => pt[0] >= d.box.x0 && pt[0] <= d.box.x1 && pt[1] >= d.box.y0 && pt[1] <= d.box.y1 &&
    d.polys.some(rings => insideRing(pt, rings[0]) && !rings.slice(1).some(h => insideRing(pt, h)));
  const cities = CITIES.cities.map(c => decode(c.shape));
  const inCity = pt => cities.some(c => inside(pt, c));
  const sample = shape => {
    const d = decode(shape);
    const b = d.box;
    const pts = [];
    for (let i = 0; i < 24; i++) {
      for (let j = 0; j < 24; j++) {
        const pt = [b.x0 + (i + 0.5) * (b.x1 - b.x0) / 24, b.y0 + (j + 0.5) * (b.y1 - b.y0) / 24];
        if (inside(pt, d)) pts.push(pt);
      }
    }
    return pts;
  };
  const off = [];
  for (const t of PLACES.cdpOutsideCities) {
    const kept = sample(t.shape);
    const keptIn = kept.filter(inCity).length / Math.max(1, kept.length);
    const place = PLACES.places.find(q => q.geoid === t.geoid);
    const all = sample(place.shape);
    const allIn = all.filter(inCity).length / Math.max(1, all.length);
    if (!kept.length || keptIn > 0.03 || Math.abs(allIn - (1 - t.share)) > 0.06) {
      off.push([t.name, kept.length, +keptIn.toFixed(3), +allIn.toFixed(3), t.share]);
    }
  }
  check(!off.length, 'Places: every trimmed shape lies outside current city limits, and the part cut off matches its' +
    ' share (' + PLACES.cdpOutsideCities.length + ' places sampled)', off.slice(0, 5));
}

checkFiles();
const mo = checkModule();
const pages = checkPages();
const c = checkCities();
const p = checkPlaces();
const t = checkTracts();
checkPublished();
const cvi = checkCviPlaces();
checkShapeQuality();
checkTrimmedShapes();
for (const [k, v] of Object.entries(counts)) console.log('  ' + k + ': ' + v);
console.log('  rings: city limits ' + c.rings + ', places ' + p.rings + ', tracts ' + t.rings +
  '; census-designated places trimmed ' + p.trimmed + ', dropped ' + p.dropped + '; tracts per density class ' +
  t.perClass.join(', '));
const diffs = REF.join.name_diffs;
console.log('  names differing between the Department of Revenue and the Census: ' +
  (diffs.length ? diffs.map(d => d.geoid + ' "' + d.name_dor + '" / "' + d.name_census + '"').join('; ') : 'none'));
if (cvi) {
  console.log('  CVI places_wa.rds: cities and towns whose land area differs from 2020 (annexed or changed since): ' +
    cvi.city_land_differs);
  console.log('  CVI places_wa.rds: census-designated places with less land after 2020 (later / ours): ' +
    cvi.shrunk.join('; '));
}
console.log('  population.js: ' + mo.rings + ' rings decoded; names in Yakima County with both outline layers ' +
  mo.yakimaNames + '; nearest page data color per ramp (OKLab distance): ' +
  Object.entries(mo.nearest).map(([k, v]) => k + ' ' + v).join('; '));
if (pages) {
  console.log('  branded pages: WA State all three on, ' + pages.waNames + ' place names (' + pages.waNamesOver +
    ' over the circles); where the population rows went, over every switch combination: ' +
    Object.entries(pages.where).map(([k, v]) => k + ' ' + v).join(', '));
  console.log('  movement view: ' + pages.movement.views + ' pages, ' + pages.movement.badges + ' badges, county names' +
    ' at step (d) ' + pages.movement.stepD + '; County Focus corner box: ' + pages.cornerTrials.judged +
    ' trials judged, ' + pages.cornerTrials.fallbacks + ' with no clear corner; WA inset corners: ' +
    Object.entries(pages.cornerTrials.insetCorners).map(([k, v]) => k + ' ' + v).join(', '));
}
failures.slice(0, 40).forEach(x => console.log('FAIL ' + x));
console.log('PC unit: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
